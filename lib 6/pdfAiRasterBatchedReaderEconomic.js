import fs from "node:fs/promises";
import {
  buildPdfAiImageRequest,
  pdfAiMode,
  PDF_AI_PRIMARY_MODEL,
} from "./pdfAiReader.js";
import { aiPdfToCandidates } from "./pdfReaderContract.js";

export const PDF_AI_RASTER_BATCH_VERSION = "2.4.9.2-annual-gas-recovery";


const CRITICAL_RECOVERY_FIELDS = Object.freeze([
  "commodity",
  "pod", "pdr",
  "consumo_luce_kwh", "consumo_gas_smc",
  "nome_offerta_luce", "nome_offerta_gas",
  "codice_offerta_luce", "codice_offerta_gas",
  "prezzo_luce_eur_kwh", "prezzo_gas_eur_smc",
  "quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno",
  "tipo_prezzo_luce", "tipo_prezzo_gas",
  "indice_riferimento_luce", "indice_riferimento_gas",
  "spread_luce_eur_kwh", "spread_gas_eur_smc",
  "formula_prezzo_luce", "formula_prezzo_gas",
  "periodicita_aggiornamento_indice_luce", "periodicita_aggiornamento_indice_gas"
]);

const CRITICAL_RECOVERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["document", "candidates"],
  properties: {
    document: {
      type: "object",
      additionalProperties: false,
      required: ["document_type", "commodity", "customer_type", "page_count"],
      properties: {
        document_type: { type: "string", enum: ["bill", "synthetic_sheet", "cte", "combined_offer_document", "placet", "unknown"] },
        commodity: { type: "string", enum: ["electricity", "gas", "dual", "unknown"] },
        customer_type: { type: "string", enum: ["consumer", "business", "unknown"] },
        page_count: { type: ["integer", "null"] }
      }
    },
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "value_text", "value_number", "unit", "commodity", "page", "label", "evidence", "semantic_role", "confidence"],
        properties: {
          field: { type: "string", enum: CRITICAL_RECOVERY_FIELDS },
          value_text: { type: ["string", "null"] },
          value_number: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
          commodity: { type: "string", enum: ["electricity", "gas", "dual", "not_applicable", "unknown"] },
          page: { type: ["integer", "null"] },
          label: { type: ["string", "null"] },
          evidence: { type: "string", maxLength: 360 },
          semantic_role: { type: "string", enum: ["actual_customer_value", "offer_value", "billing_period", "contract_period", "identifier", "classification", "sales_component", "unknown"] },
          confidence: { type: "integer", minimum: 0, maximum: 100 }
        }
      }
    }
  }
};

const CRITICAL_RECOVERY_PROMPT = `You are a precision transcription pass for Italian dual electricity and gas bills.
Read only the attached pages. Return a small set of exact, explicitly labelled values.

Priority 1 — annual consumption and supply identifiers:
- Return consumo_gas_smc only when the same visible row or box literally says Consumo annuo, Consumo annuale, ultimi 12 mesi or equivalent and the unit is Smc.
- Return consumo_luce_kwh only under the same annual-label rule and the unit is kWh.
- Never use billed-period consumption, quantities of the month, meter readings or totals as annual consumption.
- Return PDR only from a visible PDR/punto di riconsegna label. Return POD only from a visible POD/punto di prelievo label. Copy every character exactly.

Priority 2 — offer and comparable economic fields:
- Return offer names and official offer codes only when explicitly labelled.
- Return electricity/gas unit price only from an explicit sales component row such as vendita energia elettrica, vendita gas naturale, materia energia or materia prima gas.
- Never return prezzo medio, costo medio, rete, oneri, trasporto, distribuzione, contatore, potenza, imposte, accise or IVA as a comparable price.
- Return a fixed sales fee only from the sales/commercialisation row. Keep a monthly visible amount as value_number with unit EUR/mese; do not annualize it.
- Return PUN/PSV/index, spread, formula and update periodicity only when literally visible. Never derive them by subtraction.

General rules:
- Evidence must quote the exact visible label, value and unit from the page.
- Prefer omission to guessing. Return at most one candidate per field on a page.
- Annual consumption has precedence over all other fields.
Return JSON only.`;

async function buildCriticalRecoveryRequest({ imageFiles, filename, model, pageCount }) {
  const content = [];
  const ordered = [...imageFiles].sort((a, b) => Number(a.page || 0) - Number(b.page || 0));
  for (const [index, item] of ordered.entries()) {
    const bytes = await fs.readFile(item.filePath);
    const mime = ["image/jpeg", "image/png", "image/webp"].includes(String(item.mimeType || "").toLowerCase())
      ? String(item.mimeType).toLowerCase()
      : "image/jpeg";
    content.push({ type: "input_image", image_url: `data:${mime};base64,${bytes.toString("base64")}`, detail: "high" });
    content.push({ type: "input_text", text: `The preceding image is original page ${Number(item.page || index + 1)}.` });
  }
  content.push({
    type: "input_text",
    text: `Original file: ${filename || "documento.pdf"}. Recover annual consumption first, then only explicitly labelled comparable economic fields on these pages.`
  });
  return {
    model,
    store: false,
    max_output_tokens: 2000,
    input: [
      { role: "system", content: CRITICAL_RECOVERY_PROMPT },
      { role: "user", content }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "offertalogica_pdf_critical_recovery",
        strict: true,
        schema: CRITICAL_RECOVERY_SCHEMA
      }
    }
  };
}

async function runCriticalRecovery({
  imageFiles, filename, model, pageCount, timeoutMs, transport, apiKey
}) {
  const request = await buildCriticalRecoveryRequest({ imageFiles, filename, model, pageCount });
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
      timeoutPromise
    ]);
    const body = await transportBody(raw);
    if (body?.status === "incomplete") throw new Error(`openai_incomplete:${body?.incomplete_details?.reason || "unknown"}`);
    const outputText = responseOutputText(body);
    if (!outputText) throw new Error("openai_empty_output");
    const parsed = JSON.parse(outputText);
    if (!parsed?.document || !Array.isArray(parsed.candidates)) throw new Error("openai_invalid_critical_recovery");
    const normalized = {
      ...parsed,
      quality: { native_text_quality: "none", visual_quality: "readable", table_density: "medium", ocr_recommended: true },
      page_map: imageFiles.map((item) => ({
        page: Number(item.page),
        role: "critical_recovery",
        summary: "Focused compact pass: annual consumption first, then supply identifiers and comparable economic sales components."
      })),
      conflicts: [],
      review_reasons: ["Compact annual-consumption-first recovery executed after the general visual pass."]
    };
    const candidates = aiPdfToCandidates(normalized, `${model}:critical-recovery`).map((candidate) => ({
      ...candidate,
      method: "openai_visual_critical_recovery",
      source_version: `${model}:critical-recovery`
    }));
    return {
      status: "completed",
      model,
      response_id: compact(body?.id, 160) || null,
      candidates,
      timeout_ms: timeoutMs,
      document: normalized.document,
      quality: normalized.quality,
      page_map: normalized.page_map,
      conflicts: [],
      review_reasons: normalized.review_reasons,
      request_profile: "critical_recovery"
    };
  } catch (error) {
    return {
      status: "failed",
      reason: compact(error?.message || "critical_recovery_error", 300),
      model,
      timeout_ms: timeoutMs,
      candidates: []
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

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

  let focusedRecoveryAttempted = false;
  let focusedRecoveryCompleted = 0;
  const focusedRecoveryFailures = [];
  const focusedBudget = remainingMs(options.deadlineAt, 1_500);
  const focusedTimeoutMs = Math.min(18_000, focusedBudget);
  if (completed.length && Number.isFinite(focusedTimeoutMs) && focusedTimeoutMs >= 7_000) {
    focusedRecoveryAttempted = true;
    const focusedResults = await Promise.all(batches.map((batch) => runCriticalRecovery({
      imageFiles: batch,
      filename: options.filename,
      model,
      pageCount: Math.max(Number(options.legacyNormalized?.page_count || 0), imageFiles.length),
      timeoutMs: focusedTimeoutMs,
      transport,
      apiKey
    })));
    attempts += focusedResults.length;
    for (const [index, focused] of focusedResults.entries()) {
      if (focused.status === "completed") {
        completed.push(focused);
        focusedRecoveryCompleted += 1;
      } else {
        focusedRecoveryFailures.push({
          batch: index + 1,
          reason: compact(focused.reason || "critical_recovery_failed", 180),
        });
      }
    }
  }

  if (completed.length) {
    const failedCount = Math.max(0, batches.length - initialResults.filter((result) => result.status === "completed").length);
    const merged = mergeCompletedBatches(completed, {
      model,
      pageCount: Math.max(Number(options.legacyNormalized?.page_count || 0), imageFiles.length),
      batchCount: batches.length,
      failedCount,
      attempts,
      recoveredFrom,
    });
    return {
      ...merged,
      request_profile: focusedRecoveryCompleted
        ? (failedCount ? "batched_visual_partial_plus_critical_recovery" : "batched_visual_full_plus_critical_recovery")
        : merged.request_profile,
      focused_recovery_attempted: focusedRecoveryAttempted,
      focused_recovery_completed: focusedRecoveryCompleted,
      focused_recovery_failures: focusedRecoveryFailures,
    };
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
