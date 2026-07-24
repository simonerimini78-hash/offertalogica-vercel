import { createPdfAiBudgetPlan, pdfAiConfig } from "./pdfAiConfig.js";
import { runPdfAiPass } from "./pdfAiReader.js";

export const PDF_AI_RASTER_BATCH_VERSION = "step8-clean-deterministic-batches-v1";

function orderedImages(imageFiles = []) {
  return [...imageFiles]
    .filter((item) => item?.filePath)
    .sort((left, right) => Number(left.page || 0) - Number(right.page || 0));
}

function splitPages(images, size = 3) {
  const groups = [];
  for (let index = 0; index < images.length; index += size) {
    groups.push(images.slice(index, index + size));
  }
  return groups;
}

function requestedCriticalProfiles(commodity) {
  if (commodity === "luce") return ["critical_luce"];
  if (commodity === "gas") return ["critical_gas"];
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
  const budget = createPdfAiBudgetPlan({
    deadlineAt,
    now,
    raster: true,
    env,
  });
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
  const selected = new Set(pages.map(Number));
  return images.filter((item) => selected.has(Number(item.page)));
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
      elapsed_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      status: "failed",
      reason: String(error?.message || "ai_batch_error").slice(0, 300),
      candidates: [],
      profile: entry.profile,
      batch_id: entry.id,
      phase: entry.phase,
      pages: entry.pages,
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
  const phaseBudgetMs = phase === "general"
    ? plan.budget.generalPhaseMs
    : plan.budget.criticalPhaseMs;
  const timeoutMs = phase === "general"
    ? plan.budget.generalRequestTimeoutMs
    : plan.budget.criticalRequestTimeoutMs;
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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function mergedDocument(results, pageCount) {
  const documents = results.map((item) => item.document).filter(Boolean);
  const suppliers = unique(documents.map((item) => item.supplier));
  const customerTypes = unique(documents.map((item) => item.customer_type).filter((item) => item !== "unknown"));
  const commodities = unique(documents.map((item) => item.commodity).filter((item) => item !== "unknown"));
  let commodity = commodities[0] || "unknown";
  if (commodities.includes("dual") || (commodities.includes("electricity") && commodities.includes("gas"))) {
    commodity = "dual";
  } else if (commodities.length > 1) {
    commodity = "unknown";
  }
  const documentTypes = unique(documents.map((item) => item.document_type).filter((item) => item !== "unknown"));
  return {
    document_type: documentTypes.length === 1 ? documentTypes[0] : "unknown",
    supplier: suppliers.length === 1 ? suppliers[0] : null,
    commodity,
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
      status: result?.status || "not_started",
      reason: result?.reason || null,
      timeout_ms: result?.timeout_ms || null,
      elapsed_ms: result?.elapsed_ms || null,
      candidate_count: Array.isArray(result?.candidates) ? result.candidates.length : 0,
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
  const plan = buildRasterBatchPlan({
    imageFiles: images,
    legacyNormalized,
    deadlineAt,
    env,
  });
  if (!images.length) {
    return { status: "failed", reason: "image_files_required", candidates: [], plan, batches: [] };
  }
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
    phase: "general",
    plan,
    images,
    filename,
    legacyNormalized,
    parserCandidates,
    env,
    transport,
    apiKey,
  });
  const critical = await runPhase({
    phase: "critical",
    plan,
    images,
    filename,
    legacyNormalized,
    parserCandidates,
    env,
    transport,
    apiKey,
  });
  const results = [...general, ...critical];
  const completed = results.filter((item) => item.status === "completed");
  const candidates = completed.flatMap((item) => item.candidates || []);
  const conflicts = completed.flatMap((item) => item.conflicts || []);
  const reviewReasons = unique(completed.flatMap((item) => item.review_reasons || []));
  const batches = batchDiagnostics(plan, results);

  if (!completed.length) {
    return {
      status: "failed",
      reason: results.map((item) => item.reason).find(Boolean) || "all_ai_batches_failed",
      candidates: [],
      plan,
      batches,
      reader_version: PDF_AI_RASTER_BATCH_VERSION,
    };
  }

  return {
    status: "completed",
    partial: completed.length !== results.length,
    candidates,
    conflicts,
    review_reasons: reviewReasons,
    document: mergedDocument(completed, images.length),
    page_map: mergedPageMap(completed),
    plan,
    batches,
    reader_version: PDF_AI_RASTER_BATCH_VERSION,
  };
}
