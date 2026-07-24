import { createPdfAiBudgetPlan, pdfAiConfig } from "./pdfAiConfig.js";
import { runPdfAiPass } from "./pdfAiReader.js";

export const PDF_AI_RASTER_BATCH_VERSION = "step8-clean-targeted-raster-v3-timeout-safe-map";

const LUCE_FIELDS = new Set([
  "pod", "consumo_luce_kwh", "potenza_impegnata_kw", "potenza_disponibile_kw",
  "prezzo_luce_eur_kwh", "quota_fissa_vendita_luce_eur_anno", "nome_offerta_luce",
  "codice_offerta_luce", "tipo_prezzo_luce", "indice_riferimento_luce",
  "spread_luce_eur_kwh", "indirizzo_fornitura_luce",
]);
const GAS_FIELDS = new Set([
  "pdr", "consumo_gas_smc", "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno",
  "nome_offerta_gas", "codice_offerta_gas", "tipo_prezzo_gas", "indice_riferimento_gas",
  "spread_gas_eur_smc", "indirizzo_fornitura_gas",
]);
const SHARED_IDENTITY_FIELDS = new Set([
  "fornitore", "kind", "commodity", "customer_type", "intestatario", "codice_fiscale",
  "codice_cliente", "indirizzo_fornitura",
]);
const LUCE_CONTEXT = /\b(?:luce|elettric|energia\s+elettrica|pod|punto\s+di\s+prelievo|kwh|pun)\b/i;
const GAS_CONTEXT = /\b(?:gas(?:\s+naturale)?|pdr|punto\s+di\s+riconsegna|smc|psv|ttf)\b/i;
const ECONOMIC_CONTEXT = /\b(?:prezz|corrispettiv|quota|commercializz|vendita|materia\s+(?:energia|prima)|condizioni\s+economiche|indice|spread|formula|di\s+cui)\b/i;
const IDENTITY_CONTEXT = /\b(?:cliente|intestat|codice\s+fiscale|partita\s+iva|fornitore|societ[aà]\s+emittente)\b/i;

function orderedImages(imageFiles = []) {
  return [...imageFiles]
    .filter((item) => item?.filePath)
    .sort((left, right) => Number(left.page || 0) - Number(right.page || 0));
}

function splitPages(images, size = 3) {
  const groups = [];
  for (let index = 0; index < images.length; index += size) groups.push(images.slice(index, index + size));
  return groups;
}

function requestedCriticalProfiles() {
  // Raster documents can be misclassified by Step 7. Running both commodity passes keeps
  // the maximum at four calls while avoiding the loss of one side of a dual document.
  return ["critical_luce", "critical_gas"];
}

export function buildRasterBatchPlan({
  imageFiles = [],
  legacyNormalized = {},
  deadlineAt = null,
  now = Date.now(),
  env = process.env,
} = {}) {
  const images = orderedImages(imageFiles);
  const budget = createPdfAiBudgetPlan({ deadlineAt, now, raster: true, env });
  const config = pdfAiConfig(env);
  const general = splitPages(images, 3).map((batch, index) => ({
    id: `general-${index + 1}`,
    phase: "general",
    profile: "general",
    model: config.model,
    pages: batch.map((item) => Number(item.page)),
  }));
  const allPages = images.map((item) => Number(item.page));
  const critical = requestedCriticalProfiles(legacyNormalized.commodity).map((profile) => ({
    id: profile.replace("_", "-"),
    phase: "critical",
    profile,
    model: config.criticalModel,
    pages: allPages,
  }));
  return {
    version: PDF_AI_RASTER_BATCH_VERSION,
    createdAt: new Date(now).toISOString(),
    pageCount: images.length,
    mode: config.mode,
    budget,
    calls: [...general, ...critical],
  };
}

function imagesForPages(images, pages) {
  const selected = new Set((pages || []).map(Number));
  return images.filter((item) => selected.has(Number(item.page)));
}

function compact(value, maxLength = 600) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function candidateTargetsProfile(candidate, profile) {
  const field = String(candidate?.field || "");
  const commodity = String(candidate?.commodity || "").toLowerCase();
  if (profile === "critical_luce") {
    return LUCE_FIELDS.has(field) || ["luce", "electricity"].includes(commodity);
  }
  return GAS_FIELDS.has(field) || commodity === "gas";
}

function pageScoresForProfile(results, profile) {
  const scores = new Map();
  const add = (page, points) => {
    const normalized = Number(page || 0);
    if (!normalized) return;
    scores.set(normalized, (scores.get(normalized) || 0) + points);
  };
  const targetPattern = profile === "critical_luce" ? LUCE_CONTEXT : GAS_CONTEXT;

  for (const result of results || []) {
    for (const candidate of result?.candidates || []) {
      const page = Number(candidate?.page || 0);
      const field = String(candidate?.field || "");
      const context = `${compact(candidate?.label, 180)} ${compact(candidate?.evidence, 360)}`;
      if (candidateTargetsProfile(candidate, profile)) add(page, 10);
      if (SHARED_IDENTITY_FIELDS.has(field)) add(page, 2);
      if (targetPattern.test(context)) add(page, 5);
      if (ECONOMIC_CONTEXT.test(context)) add(page, 3);
      if (IDENTITY_CONTEXT.test(context)) add(page, 1);
    }
    for (const item of result?.page_map || []) {
      const context = `${compact(item?.role, 160)} ${compact(item?.summary, 520)}`;
      if (targetPattern.test(context)) add(item?.page, 8);
      if (ECONOMIC_CONTEXT.test(context)) add(item?.page, 4);
      if (IDENTITY_CONTEXT.test(context)) add(item?.page, 2);
    }
  }
  return scores;
}

export function selectCriticalPages({
  results = [],
  images = [],
  profile,
  maxPages = 4,
} = {}) {
  const ordered = orderedImages(images);
  const available = new Set(ordered.map((item) => Number(item.page)));
  const scores = pageScoresForProfile(results, profile);
  let pages = [...scores.entries()]
    .filter(([page]) => available.has(Number(page)))
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])
    .slice(0, Math.max(1, maxPages))
    .map(([page]) => Number(page));

  const balancedFallback = [];
  let left = 0;
  let right = ordered.length - 1;
  while (left <= right) {
    balancedFallback.push(ordered[left]);
    if (right !== left) balancedFallback.push(ordered[right]);
    left += 1;
    right -= 1;
  }
  if (!pages.length) pages = balancedFallback.slice(0, maxPages).map((item) => Number(item.page));
  const selected = new Set(pages);
  for (const item of balancedFallback) {
    if (pages.length >= maxPages) break;
    const page = Number(item.page);
    if (selected.has(page)) continue;
    selected.add(page);
    pages.push(page);
  }
  return pages.sort((left, right) => left - right);
}

export function refineCriticalPlan(plan, generalResults, images) {
  const ordered = orderedImages(images);
  const allPages = ordered.map((item) => Number(item.page));
  const generalCalls = plan.calls.filter((entry) => entry.phase === "general");
  const completedWithMap = (generalResults || []).filter((result) => {
    if (result?.status !== "completed" || !Array.isArray(result?.page_map) || result.page_map.length === 0) return false;
    const expectedPages = (result.pages || []).map(Number).filter(Boolean);
    const mappedPages = new Set(result.page_map.map((item) => Number(item?.page || 0)).filter(Boolean));
    return expectedPages.length > 0 && expectedPages.every((page) => mappedPages.has(page));
  });
  const completeGeneralMap = generalCalls.length > 0 && completedWithMap.length === generalCalls.length;
  const fallbackSelection = completedWithMap.length > 0
    ? "all_pages_partial_general_map"
    : "all_pages_no_general_map";

  return {
    ...plan,
    calls: plan.calls.map((entry) => entry.phase !== "critical"
      ? entry
      : completeGeneralMap
        ? {
          ...entry,
          pages: selectCriticalPages({ results: generalResults, images, profile: entry.profile }),
          page_selection: "general_evidence_map",
        }
        : {
          ...entry,
          pages: allPages,
          page_selection: fallbackSelection,
        }),
  };
}

async function runPlannedCall({
  entry,
  images,
  filename,
  legacyNormalized,
  parserCandidates,
  phaseTimeoutMs,
  phaseDeadlineAt,
  env,
  transport,
  apiKey,
} = {}) {
  const startedAt = Date.now();
  try {
    const result = await runPdfAiPass({
      imageFiles: imagesForPages(images, entry.pages),
      filename,
      legacyNormalized,
      parserCandidates,
      deadlineAt: phaseDeadlineAt,
      env,
      transport,
      apiKey,
      profile: entry.profile,
      model: entry.model,
      timeoutMs: phaseTimeoutMs,
    });
    return {
      ...result,
      batch_id: entry.id,
      phase: entry.phase,
      pages: entry.pages,
      page_selection: entry.page_selection || "fixed_batch",
      elapsed_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      status: "failed",
      reason: String(error?.message || "ai_batch_error").slice(0, 300),
      candidates: [],
      economic_rows: [],
      consumption_observations: [],
      profile: entry.profile,
      batch_id: entry.id,
      phase: entry.phase,
      pages: entry.pages,
      page_selection: entry.page_selection || "fixed_batch",
      elapsed_ms: Date.now() - startedAt,
    };
  }
}

async function runPhase({
  phase,
  plan,
  images,
  filename,
  legacyNormalized,
  parserCandidates,
  env,
  transport,
  apiKey,
} = {}) {
  const entries = plan.calls.filter((item) => item.phase === phase);
  const phaseBudgetMs = phase === "general" ? plan.budget.generalPhaseMs : plan.budget.criticalPhaseMs;
  const timeoutMs = phase === "general" ? plan.budget.generalRequestTimeoutMs : plan.budget.criticalRequestTimeoutMs;
  const phaseDeadlineAt = Date.now() + phaseBudgetMs;
  return Promise.all(entries.map((entry) => runPlannedCall({
    entry,
    images,
    filename,
    legacyNormalized,
    parserCandidates,
    phaseTimeoutMs: timeoutMs,
    phaseDeadlineAt,
    env,
    transport,
    apiKey,
  })));
}

function fieldCommodityScore(field) {
  if (LUCE_FIELDS.has(field)) return { electricity: field === "pod" ? 5 : 2, gas: 0 };
  if (GAS_FIELDS.has(field)) return { electricity: 0, gas: field === "pdr" ? 5 : 2 };
  return { electricity: 0, gas: 0 };
}

export function inferCommodityFromRasterEvidence(results = [], fallback = "unknown") {
  let electricity = 0;
  let gas = 0;
  for (const result of results || []) {
    for (const candidate of result?.candidates || []) {
      const score = fieldCommodityScore(String(candidate?.field || ""));
      electricity += score.electricity;
      gas += score.gas;
      const commodity = String(candidate?.commodity || "").toLowerCase();
      if (["luce", "electricity"].includes(commodity)) electricity += 1;
      if (commodity === "gas") gas += 1;
    }
    for (const observation of result?.consumption_observations || []) {
      if (observation?.commodity === "electricity") electricity += 2;
      if (observation?.commodity === "gas") gas += 2;
    }
    for (const row of result?.economic_rows || []) {
      if (row?.commodity === "electricity") electricity += 1;
      if (row?.commodity === "gas") gas += 1;
    }
    for (const page of result?.page_map || []) {
      const context = `${compact(page?.role, 160)} ${compact(page?.summary, 520)}`;
      if (LUCE_CONTEXT.test(context)) electricity += 2;
      if (GAS_CONTEXT.test(context)) gas += 2;
    }
  }
  if (electricity >= 3 && gas >= 3) return "dual";
  if (electricity >= 3 && gas < 2) return "electricity";
  if (gas >= 3 && electricity < 2) return "gas";
  return ["electricity", "gas", "dual"].includes(fallback) ? fallback : "unknown";
}

function mergedDocument(results, pageCount, legacyNormalized = {}) {
  const documents = results.map((item) => item.document).filter(Boolean);
  const suppliers = unique(documents.map((item) => item.supplier));
  const customerTypes = unique(documents.map((item) => item.customer_type).filter((item) => item !== "unknown"));
  const documentTypes = unique(documents.map((item) => item.document_type).filter((item) => item !== "unknown"));
  const metadataCommodity = unique(documents.map((item) => item.commodity).filter((item) => item !== "unknown"));
  const fallbackCommodity = metadataCommodity.includes("dual")
    ? "dual"
    : metadataCommodity.length === 1
      ? metadataCommodity[0]
      : legacyNormalized.commodity === "luce"
        ? "electricity"
        : legacyNormalized.commodity;
  return {
    document_type: documentTypes.length === 1 ? documentTypes[0] : "unknown",
    supplier: suppliers.length === 1 ? suppliers[0] : null,
    commodity: inferCommodityFromRasterEvidence(results, fallbackCommodity),
    customer_type: customerTypes.length === 1 ? customerTypes[0] : "unknown",
    page_count: pageCount,
  };
}

function mergedPageMap(results) {
  const seen = new Set();
  const pageMap = [];
  for (const item of results) {
    for (const entry of item.page_map || []) {
      const key = `${entry.page}:${entry.role}:${entry.summary}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pageMap.push(entry);
    }
  }
  return pageMap.sort((left, right) => Number(left.page || 0) - Number(right.page || 0));
}

function batchDiagnostics(plan, results) {
  return plan.calls.map((entry) => {
    const result = results.find((item) => item.batch_id === entry.id);
    return {
      id: entry.id,
      phase: entry.phase,
      profile: entry.profile,
      model: entry.model,
      pages: entry.pages,
      page_selection: entry.page_selection || "fixed_batch",
      status: result?.status || "not_started",
      reason: result?.reason || null,
      timeout_ms: result?.timeout_ms || null,
      elapsed_ms: result?.elapsed_ms || null,
      candidate_count: Array.isArray(result?.candidates) ? result.candidates.length : 0,
      consumption_observation_count: Array.isArray(result?.consumption_observations) ? result.consumption_observations.length : 0,
      economic_row_count: Array.isArray(result?.economic_rows) ? result.economic_rows.length : 0,
      document_commodity: result?.document?.commodity || null,
      page_map_count: Array.isArray(result?.page_map) ? result.page_map.length : 0,
      response_id: result?.response_id || null,
    };
  });
}

export async function runDeterministicPdfAiRaster({
  imageFiles = [],
  filename = "documento.pdf",
  legacyNormalized = {},
  parserCandidates = [],
  deadlineAt = null,
  env = process.env,
  transport,
  apiKey,
} = {}) {
  const images = orderedImages(imageFiles);
  let plan = buildRasterBatchPlan({ imageFiles: images, legacyNormalized, deadlineAt, env });
  if (!images.length) return { status: "failed", reason: "image_files_required", candidates: [], plan, batches: [] };
  if (!plan.budget.sufficient) {
    return {
      status: "skipped",
      reason: "insufficient_reserved_budget",
      candidates: [],
      plan,
      batches: batchDiagnostics(plan, []),
    };
  }

  const general = await runPhase({
    phase: "general", plan, images, filename, legacyNormalized, parserCandidates, env, transport, apiKey,
  });
  plan = refineCriticalPlan(plan, general, images);
  const critical = await runPhase({
    phase: "critical", plan, images, filename, legacyNormalized, parserCandidates, env, transport, apiKey,
  });
  const results = [...general, ...critical];
  const completed = results.filter((item) => item.status === "completed");
  const candidates = completed.flatMap((item) => item.candidates || []);
  const economicRows = completed.flatMap((item) => item.economic_rows || []);
  const consumptionObservations = completed.flatMap((item) => item.consumption_observations || []);
  const conflicts = completed.flatMap((item) => item.conflicts || []);
  const reviewReasons = unique(completed.flatMap((item) => item.review_reasons || []));
  const batches = batchDiagnostics(plan, results);

  if (!completed.length) {
    return {
      status: "failed",
      reason: results.map((item) => item.reason).find(Boolean) || "all_ai_batches_failed",
      candidates: [],
      economic_rows: [],
      consumption_observations: [],
      plan,
      batches,
      reader_version: PDF_AI_RASTER_BATCH_VERSION,
    };
  }

  return {
    status: "completed",
    partial: completed.length !== results.length,
    candidates,
    economic_rows: economicRows,
    consumption_observations: consumptionObservations,
    conflicts,
    review_reasons: reviewReasons,
    document: mergedDocument(completed, images.length, legacyNormalized),
    page_map: mergedPageMap(completed),
    plan,
    batches,
    reader_version: PDF_AI_RASTER_BATCH_VERSION,
    model: unique(completed.map((item) => item.model)).join(",") || null,
  };
}
