import {
  buildPdfAiImageRequest,
  pdfAiMode,
  PDF_AI_PRIMARY_MODEL,
} from "./pdfAiReader.js";
import { aiPdfToCandidates } from "./pdfReaderContract.js";

export const PDF_AI_RASTER_BATCH_VERSION = "2.4.7-batched-raster-1";

const MAX_BATCH_PAGES = 3;
const DEFAULT_BATCH_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_TIMEOUT_MS = 12_000;
const DEFAULT_EMERGENCY_TIMEOUT_MS = 10_000;

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedTimeout(value, { min = 2_000, max = 30_000, fallback = 10_000 } = {}) {
  return Math.max(min, Math.min(max, finiteNumber(value, fallback)));
}

function remainingMs(deadlineAt, reserveMs = 1_000) {
  if (!deadlineAt) return Number.POSITIVE_INFINITY;
  return Number(deadlineAt) - Date.now() - reserveMs;
}

function splitIntoBatches(imageFiles, size = MAX_BATCH_PAGES) {
  const ordered = [...(imageFiles || [])]
    .filter((item) => item?.filePath)
    .sort((left, right) => Number(left.page || 0) - Number(right.page || 0));
  const batches = [];
  for (let index = 0; index < ordered.length; index += size) {
    batches.push(ordered.slice(index, index + size));
  }
  return batches;
}

async function defaultTransport({ request, apiKey, signal }) {
  return fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal,
  });
}

function responseOutputText(body) {
  if (typeof body?.output_text === "string") return body.output_text;
  for (const item of body?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "refusal") throw new Error(`openai_refusal:${content.refusal || "refused"}`);
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

async function transportBody(result) {
  if (result && typeof result.json === "function") {
    if (result.ok === false) {
      const text = await result.text().catch(() => "");
      throw new Error(`openai_http_${result.status}:${text.slice(0, 240)}`);
    }
    return result.json();
  }
  return result;
}

function compact(value, maxLength = 360) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => compact(value, 500)).filter(Boolean))];
}

function candidateKey(candidate) {
  const value = candidate?.normalized_value ?? candidate?.value_number ?? candidate?.value_text ?? "";
  return [candidate?.field, candidate?.page, candidate?.semantic_role, String(value).trim().toLowerCase()].join("|");
}

function mergeCommodity(values) {
  const set = new Set(values.filter((value) => ["electricity", "gas", "dual"].includes(value)));
  if (set.has("dual") || (set.has("electricity") && set.has("gas"))) return "dual";
  if (set.has("electricity")) return "electricity";
  if (set.has("gas")) return "gas";
  return "unknown";
}

function mergeDocumentType(values) {
  const priority = ["bill", "synthetic_sheet", "cte", "combined_offer_document", "placet", "bill_guide", "bill_facsimile"];
  for (const value of priority) {
    if (values.includes(value)) return value;
  }
  return "unknown";
}

function mergeQuality(results) {
  const visualValues = results.map((result) => result.quality?.visual_quality);
  const tableValues = results.map((result) => result.quality?.table_density);
  return {
    native_text_quality: "none",
    visual_quality: visualValues.includes("good") ? "good" : visualValues.includes("readable") ? "readable" : "unknown",
    table_density: tableValues.includes("high") ? "high" : tableValues.includes("medium") ? "medium" : "low",
    ocr_recommended: true,
  };
}

function mergePageMap(results, pageCount) {
  const byPage = new Map();
  for (const result of results) {
    for (const item of result.page_map || []) {
      const page = Number(item?.page || 0);
      if (!page || page > pageCount) continue;
      const summary = compact(item.summary, 360);
      const existing = byPage.get(page);
      if (!existing || summary.length > compact(existing.summary, 360).length) {
        byPage.set(page, {
          page,
          role: compact(item.role, 100) || "unknown",
          summary: summary || "Pagina analizzata visualmente.",
        });
      }
    }
  }
  return Array.from({ length: pageCount }, (_, index) => byPage.get(index + 1) || {
    page: index + 1,
    role: "unknown",
    summary: "Pagina non restituita nella mappa visuale; verificare i candidati associati.",
  });
}

function mergeCompletedBatches(results, { model, pageCount, batchCount, failedCount, attempts, recoveredFrom = null } = {}) {
  const candidateMap = new Map();
  for (const result of results) {
    for (const candidate of result.candidates || []) {
      const key = candidateKey(candidate);
      const previous = candidateMap.get(key);
      if (!previous || Number(candidate.confidence || 0) > Number(previous.confidence || 0)) {
        candidateMap.set(key, candidate);
      }
    }
  }

  const commodityEvidence = [
    ...results.map((result) => result.document?.commodity),
    ...[...candidateMap.values()].map((candidate) => candidate.commodity),
  ];
  const documents = results.map((result) => result.document || {});
  const customerTypes = documents.map((document) => document.customer_type);
  const document = {
    document_type: mergeDocumentType(documents.map((item) => item.document_type)),
    supplier: documents.map((item) => compact(item.supplier, 120)).find(Boolean) || null,
    commodity: mergeCommodity(commodityEvidence),
    customer_type: customerTypes.includes("business") ? "business" : customerTypes.includes("consumer") ? "consumer" : "unknown",
    page_count: pageCount,
  };

  const conflictMap = new Map();
  for (const result of results) {
    for (const conflict of result.conflicts || []) {
      const key = `${conflict?.field || "unknown"}|${compact(conflict?.description, 240)}`;
      if (!conflictMap.has(key)) conflictMap.set(key, conflict);
    }
  }

  const responseIds = uniqueStrings(results.map((result) => result.response_id));
  const reviewReasons = uniqueStrings([
    ...results.flatMap((result) => result.review_reasons || []),
    `Raster letto in ${batchCount} gruppi paralleli per evitare il timeout del documento completo.`,
    failedCount ? `${failedCount} gruppo/i non hanno completato la prima lettura; sono stati mantenuti soltanto candidati con evidenza restituita.` : "",
  ]);

  return {
    status: "completed",
    model,
    response_id: responseIds.length ? responseIds.join(",").slice(0, 300) : null,
    candidates: [...candidateMap.values()],
    timeout_ms: Math.max(...results.map((result) => Number(result.timeout_ms || 0)), 0) || null,
    document,
    quality: mergeQuality(results),
    page_map: mergePageMap(results, pageCount),
    conflicts: [...conflictMap.values()],
    review_reasons: reviewReasons,
    request_profile: failedCount ? "batched_visual_partial" : "batched_visual_full",
    attempts,
    recovered_from: recoveredFrom,
    batch_count: batchCount,
    completed_batches: results.length,
    failed_batches: failedCount,
    reader_version: PDF_AI_RASTER_BATCH_VERSION,
  };
}

async function runRequest({
  imageFiles,
  filename,
  legacyNormalized,
  parserCandidates,
  model,
  profile,
  timeoutMs,
  transport,
  apiKey,
  lowDetail = false,
} = {}) {
  const request = await buildPdfAiImageRequest({
    imageFiles,
    filename,
    parserVersion: legacyNormalized?.parser_version,
    parserCandidates,
    pageCount: legacyNormalized?.page_count,
    diagnostics: legacyNormalized?.diagnostics,
    model,
    profile,
  });

  if (lowDetail) {
    request.max_output_tokens = Math.min(Number(request.max_output_tokens || 2_600), 2_600);
    for (const item of request.input || []) {
      for (const content of item?.content || []) {
        if (content?.type === "input_image") content.detail = "low";
      }
    }
  }

  const controller = new AbortController();
  let timeoutId;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error("openai_timeout"));
      }, timeoutMs);
    });
    const raw = await Promise.race([
      transport({ request, apiKey, signal: controller.signal }),
      timeoutPromise,
    ]);
    const body = await transportBody(raw);
    if (body?.status === "incomplete") throw new Error(`openai_incomplete:${body?.incomplete_details?.reason || "unknown"}`);
    const outputText = responseOutputText(body);
    if (!outputText) throw new Error("openai_empty_output");
    const parsed = JSON.parse(outputText);
    if (!parsed?.document || !Array.isArray(parsed?.candidates)) throw new Error("openai_invalid_output_object");
    if (profile !== "emergency") {
      for (const field of ["quality", "page_map", "conflicts", "review_reasons"]) {
        if (field === "quality" ? !parsed[field] : !Array.isArray(parsed[field])) throw new Error(`openai_invalid_${field}`);
      }
    }
    const normalizedParsed = profile === "emergency"
      ? {
        ...parsed,
        quality: { native_text_quality: "none", visual_quality: "readable", table_density: "low", ocr_recommended: true },
        page_map: [{ page: 1, role: "summary", summary: "Lettura visuale di emergenza della prima pagina." }],
        conflicts: [],
        review_reasons: ["Lettura di emergenza eseguita dopo il mancato completamento dei gruppi visuali."],
      }
      : parsed;
    return {
      status: "completed",
      model,
      response_id: compact(body?.id, 160) || null,
      candidates: aiPdfToCandidates(normalizedParsed, model),
      timeout_ms: timeoutMs,
      document: normalizedParsed.document,
      quality: normalizedParsed.quality,
      page_map: normalizedParsed.page_map,
      conflicts: normalizedParsed.conflicts,
      review_reasons: normalizedParsed.review_reasons,
      request_profile: profile,
    };
  } catch (error) {
    return {
      status: "failed",
      reason: compact(error?.message || "openai_error", 300),
      model,
      timeout_ms: timeoutMs,
      candidates: [],
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runPdfAiFallbackImages(options = {}) {
  const env = options.env || process.env;
  const model = env.PDF_AI_MODEL || options.model || PDF_AI_PRIMARY_MODEL;
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  const transport = options.transport || defaultTransport;
  const imageFiles = options.imageFiles || [];

  if (pdfAiMode(env) !== "fallback") return { status: "disabled", model: null, candidates: [] };
  if (!apiKey) return { status: "unavailable", reason: "missing_openai_api_key", model, candidates: [] };

  const batches = splitIntoBatches(imageFiles);
  if (!batches.length) return { status: "failed", reason: "image_files_required", model, candidates: [] };

  const initialBudget = remainingMs(options.deadlineAt, 5_000);
  const batchTimeoutMs = Math.min(
    boundedTimeout(env.PDF_AI_BATCH_TIMEOUT_MS, { max: 34_000, fallback: DEFAULT_BATCH_TIMEOUT_MS }),
    initialBudget,
  );
  if (!Number.isFinite(batchTimeoutMs) || batchTimeoutMs < 5_000) {
    return { status: "skipped", reason: "insufficient_time_budget", model, timeout_ms: batchTimeoutMs, candidates: [] };
  }

  const initialResults = await Promise.all(batches.map((batch) => runRequest({
    imageFiles: batch,
    filename: options.filename,
    legacyNormalized: options.legacyNormalized || {},
    parserCandidates: options.parserCandidates || [],
    model,
    profile: "full",
    timeoutMs: batchTimeoutMs,
    transport,
    apiKey,
  })));

  const completed = initialResults.filter((result) => result.status === "completed");
  const failedIndexes = initialResults
    .map((result, index) => result.status === "completed" ? -1 : index)
    .filter((index) => index >= 0);
  let attempts = batches.length;
  let recoveredFrom = null;

  if (failedIndexes.length) {
    const retryBudget = remainingMs(options.deadlineAt, 1_500);
    const retryTimeoutMs = Math.min(
      boundedTimeout(env.PDF_AI_BATCH_RETRY_TIMEOUT_MS, { max: 14_000, fallback: DEFAULT_RETRY_TIMEOUT_MS }),
      retryBudget,
    );
    if (Number.isFinite(retryTimeoutMs) && retryTimeoutMs >= 5_000) {
      const retries = await Promise.all(failedIndexes.map((index) => runRequest({
        imageFiles: batches[index],
        filename: options.filename,
        legacyNormalized: options.legacyNormalized || {},
        parserCandidates: options.parserCandidates || [],
        model,
        profile: "full",
        timeoutMs: retryTimeoutMs,
        transport,
        apiKey,
        lowDetail: true,
      })));
      attempts += retries.length;
      for (const retry of retries) {
        if (retry.status === "completed") completed.push(retry);
      }
      if (retries.some((retry) => retry.status === "completed")) recoveredFrom = "batched_retry_low_detail";
    }
  }

  if (completed.length) {
    const failedCount = Math.max(0, batches.length - completed.length);
    return mergeCompletedBatches(completed, {
      model,
      pageCount: Math.max(Number(options.legacyNormalized?.page_count || 0), imageFiles.length),
      batchCount: batches.length,
      failedCount,
      attempts,
      recoveredFrom,
    });
  }

  const emergencyBudget = remainingMs(options.deadlineAt, 1_000);
  const emergencyTimeoutMs = Math.min(
    boundedTimeout(env.PDF_AI_EMERGENCY_TIMEOUT_MS, { max: 12_000, fallback: DEFAULT_EMERGENCY_TIMEOUT_MS }),
    emergencyBudget,
  );
  if (!Number.isFinite(emergencyTimeoutMs) || emergencyTimeoutMs < 5_000) {
    return {
      status: "failed",
      reason: initialResults.map((result) => result.reason).find(Boolean) || "batched_visual_failed",
      model,
      candidates: [],
      attempts,
      recovery_attempted: false,
      recovery_reason: "insufficient_time_budget",
      reader_version: PDF_AI_RASTER_BATCH_VERSION,
    };
  }

  const firstPage = splitIntoBatches(imageFiles, 1)[0];
  const emergency = await runRequest({
    imageFiles: firstPage,
    filename: options.filename,
    legacyNormalized: options.legacyNormalized || {},
    parserCandidates: [],
    model,
    profile: "emergency",
    timeoutMs: emergencyTimeoutMs,
    transport,
    apiKey,
    lowDetail: true,
  });
  attempts += 1;
  if (emergency.status === "completed") {
    return {
      ...emergency,
      attempts,
      recovered_from: "batched_visual_timeout",
      recovery_timeout_ms: emergency.timeout_ms,
      request_profile: "emergency",
      reader_version: PDF_AI_RASTER_BATCH_VERSION,
    };
  }

  return {
    status: "failed",
    reason: emergency.reason || initialResults.map((result) => result.reason).find(Boolean) || "batched_visual_failed",
    model,
    candidates: [],
    attempts,
    recovery_attempted: true,
    recovery_reason: emergency.reason || "emergency_recovery_failed",
    recovery_timeout_ms: emergency.timeout_ms || emergencyTimeoutMs,
    reader_version: PDF_AI_RASTER_BATCH_VERSION,
  };
}
