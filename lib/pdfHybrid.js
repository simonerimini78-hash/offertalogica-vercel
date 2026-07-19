import { buildPdfDiagnostics, extractPdfWithPages, PDF_PARSER_VERSION } from "./pdfExtract.js";
import { applyConsumptionDecisions, arbitrateConsumptionEvidence } from "./pdfEvidenceArbitration.js";
import {
  AI_EXTRACTABLE_FIELDS,
  applyCrossSourceConsensus,
  buildPdfQualityReport,
  mergeAiDiagnostics,
  mergeAiResult,
  mergeConsensusDiagnostics,
  mergeOcrDiagnostics,
  mergeOcrResult,
  quarantineUnsafeRequiredValues,
  synchronizeCommodityFields,
} from "./pdfHybridPolicy.js";

function nativeFailure(error) {
  return {
    parser_version: PDF_PARSER_VERSION,
    page_count: null,
    diagnostics: [],
    kind: "unknown",
    commodity: "unknown",
    recognized: false,
    confidence: "low",
    warnings: ["native_parser_failed"],
    textExtracted: 0,
    needsReview: true,
    native_parser_failed: true,
    native_parser_error: String(error?.code || error?.name || "PDF_NATIVE_ERROR").slice(0, 100),
  };
}

function compactQuality(report = {}) {
  return {
    recognized: Boolean(report.recognized),
    completeness: Number(report.completeness || 0),
    missingFields: report.missingFields || [],
    reviewFields: report.reviewFields || [],
    reasons: report.reasons || [],
  };
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function appendWarning(normalized, warning) {
  normalized.warnings = unique([...(normalized.warnings || []), warning]);
}

function combinePageTexts(nativePageTexts = [], ocrPageTexts = []) {
  const length = Math.max(nativePageTexts.length, ocrPageTexts.length);
  return Array.from({ length }, (_, index) => [nativePageTexts[index], ocrPageTexts[index]].filter(Boolean).join("\n"));
}

function rebuildHybridDiagnostics(normalized, pageTexts, ocrDiagnostics, aiDiagnostics, consensusDiagnostics) {
  let diagnostics = buildPdfDiagnostics(normalized, pageTexts);
  if (ocrDiagnostics) diagnostics = mergeOcrDiagnostics(diagnostics, ocrDiagnostics, normalized);
  if (aiDiagnostics) diagnostics = mergeAiDiagnostics(diagnostics, aiDiagnostics, normalized);
  if (consensusDiagnostics) diagnostics = mergeConsensusDiagnostics(diagnostics, consensusDiagnostics, normalized);
  return diagnostics;
}

function requestedAiFields(nativeReport, afterOcrReport, mode, ocrMergeDiagnostics = {}) {
  if (mode === "all") return [...AI_EXTRACTABLE_FIELDS];
  return unique([
    ...(nativeReport.requiredFields || []),
    ...(nativeReport.missingFields || []),
    ...(nativeReport.reviewFields || []),
    ...(afterOcrReport.missingFields || []),
    ...(afterOcrReport.reviewFields || []),
    ...(ocrMergeDiagnostics.acceptedFields || []),
    ...((ocrMergeDiagnostics.conflicts || []).map((item) => item.field)),
  ]);
}

function aiModeAllows(report, mode) {
  if (["verify", "all"].includes(mode)) return true;
  if (mode === "problematic") return report.shouldUseAi;
  return false;
}

async function loadModule(loader, failureCode) {
  try {
    return { ok: true, module: await loader() };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.code || error?.message || failureCode).slice(0, 180),
    };
  }
}

function sourceAvailability({ nativeError, ocrConfig = {}, ocr = {}, aiConfig = {}, ai = {} } = {}) {
  let ocrStatus = "not_required";
  const ocrPages = Array.isArray(ocr.pages) ? ocr.pages : [];
  if (ocrConfig.mode !== "off") {
    if (ocrPages.some((item) => item?.status === "completed")) ocrStatus = "completed";
    else if (ocrPages.length && ocrPages.every((item) => /TIMEOUT|budget_exhausted/i.test(String(item?.reason || "")))) ocrStatus = "timeout";
    else if (String(ocr.reason || "") === "no_text_detected") ocrStatus = "no_text";
    else if (String(ocr.reason || "") === "no_pages_selected") ocrStatus = "not_required";
    else ocrStatus = "failed";
  }

  let aiStatus = "not_required";
  if (aiConfig.mode !== "off") {
    if (ai.used && ai.result) aiStatus = "completed";
    else if (String(ai.reason || "") === "timeout" || /TIMEOUT/i.test(String(ai.errorCode || ""))) aiStatus = "timeout";
    else if (["not_requested", "disabled"].includes(String(ai.reason || ""))) aiStatus = "not_required";
    else aiStatus = "failed";
  }

  return {
    parser: nativeError ? "failed" : "completed",
    ocr: ocrStatus,
    ai: aiStatus,
  };
}

function removeResolvedConflicts(diagnostics, resolvedFields = []) {
  const resolved = new Set(resolvedFields);
  if (!resolved.size) return diagnostics;
  return {
    ...diagnostics,
    conflicts: (diagnostics.conflicts || []).filter((item) => !resolved.has(item?.field)),
  };
}

function removeWarning(normalized, warning) {
  normalized.warnings = (normalized.warnings || []).filter((item) => item !== warning);
}

function aiFailure(error) {
  return {
    used: false,
    reason: /TIMEOUT/.test(String(error?.message || "")) ? "timeout" : "request_failed",
    errorCode: String(error?.message || "PDF_AI_ERROR").slice(0, 100),
    httpStatus: Number(error?.status || 0) || null,
    errorDetail: String(error?.detail || "").slice(0, 300) || null,
    model: String(error?.model || "").slice(0, 100) || null,
    durationMs: Number(error?.durationMs || 0) || null,
  };
}

/**
 * Parser, OCR e IA leggono il documento in modo indipendente. I valori osservati vengono
 * classificati semanticamente prima del confronto: grandezze diverse non diventano falsi
 * conflitti, mentre due evidenze esplicite dello stesso ruolo restano in revisione.
 * Un timeout rende la fonte indisponibile, non costituisce un voto contrario.
 */
export async function enhancePdfAnalysis({
  filePath,
  filename,
  nativeNormalized,
  pageTexts = [],
  nativeError = null,
  loadOcr = () => import("./pdfOcr.js"),
  loadAi = () => import("./pdfAiFinal.js"),
} = {}) {
  const startedAt = Date.now();
  const nativeReport = buildPdfQualityReport(nativeNormalized);
  let normalized = synchronizeCommodityFields({ ...nativeNormalized, analysis_mode: "native" });

  const [ocrLoaded, aiLoaded] = await Promise.all([
    loadModule(loadOcr, "PDF_OCR_MODULE_LOAD_FAILED"),
    loadModule(loadAi, "PDF_AI_MODULE_LOAD_FAILED"),
  ]);

  const ocrConfig = ocrLoaded.ok ? ocrLoaded.module.pdfOcrConfig() : { mode: "off" };
  const aiConfig = aiLoaded.ok ? aiLoaded.module.pdfAiConfig() : { mode: "off" };

  let ocr = {
    used: false,
    reason: ocrLoaded.ok ? "disabled" : "module_load_failed",
    errorCode: ocrLoaded.ok ? null : ocrLoaded.error,
    selectedPages: [],
    pages: [],
    pageTexts: [],
    normalized: null,
  };

  if (ocrLoaded.ok && ocrConfig.mode !== "off") {
    try {
      ocr = await ocrLoaded.module.runPdfOcr({
        filePath,
        pageTexts,
        normalized: nativeNormalized,
        qualityReport: nativeReport,
        config: ocrConfig,
      });
    } catch (error) {
      ocr = {
        used: false,
        reason: String(error?.message || "PDF_OCR_FAILED").slice(0, 180),
        errorCode: String(error?.code || error?.message || "PDF_OCR_FAILED").slice(0, 180),
        selectedPages: [],
        pages: [],
        pageTexts: [],
        normalized: null,
      };
    }
  }

  let ocrMergeDiagnostics = { acceptedFields: [], confirmedFields: [], rejectedFields: [], conflicts: [], evidenceByField: {} };
  if (ocr.used && ocr.normalized) {
    const merged = mergeOcrResult(normalized, ocr.normalized, ocr);
    normalized = synchronizeCommodityFields(merged.normalized);
    ocrMergeDiagnostics = merged.diagnostics;
  } else if (ocrConfig.mode !== "off" && !["no_pages_selected"].includes(String(ocr.reason || ""))) {
    appendWarning(normalized, "ocr_stage_failed_or_incomplete");
  }

  const sourcePageTexts = combinePageTexts(pageTexts, Array.isArray(ocr.pageTexts) ? ocr.pageTexts : []);
  normalized.diagnostics = rebuildHybridDiagnostics(
    normalized,
    sourcePageTexts,
    ocr.used && ocr.normalized ? ocrMergeDiagnostics : null,
    null,
    null,
  );
  const afterOcrReport = buildPdfQualityReport(normalized);
  const aiRequestedFields = requestedAiFields(nativeReport, afterOcrReport, aiConfig.mode, ocrMergeDiagnostics);

  let ai = {
    used: false,
    reason: aiLoaded.ok ? "not_requested" : "module_load_failed",
    errorCode: aiLoaded.ok ? null : aiLoaded.error,
    httpStatus: null,
    errorDetail: null,
  };

  if (aiLoaded.ok && aiModeAllows(afterOcrReport, aiConfig.mode)) {
    try {
      ai = await aiLoaded.module.analyzePdfWithFinalAi({
        filePath,
        filename,
        nativeNormalized,
        ocrNormalized: ocr.normalized,
        requestedFields: aiRequestedFields,
        sourceSummary: {
          strategy: "independent_pdf_read_after_adaptive_ocr_field_discovery",
          ocrMode: ocrConfig.mode,
          ocrUsed: Boolean(ocr.used),
          ocrAcceptedFields: ocrMergeDiagnostics.acceptedFields || [],
          ocrRejectedFields: (ocrMergeDiagnostics.rejectedFields || []).map((item) => ({ field: item.field, reason: item.reason })),
          note: "The AI still reads the original PDF independently; OCR only determines which unresolved fields require verification.",
        },
      });
    } catch (error) {
      ai = aiFailure(error);
    }
  } else if (aiConfig.mode === "off") {
    ai.reason = "disabled";
  }

  let aiMergeDiagnostics = { acceptedFields: [], confirmedFields: [], rejectedFields: [], conflicts: [], evidenceByField: {}, reviewReasons: {}, notes: [] };
  const sourceContext = {
    nativePageTexts: pageTexts,
    ocrPageTexts: Array.isArray(ocr.pageTexts) ? ocr.pageTexts : [],
    ocrCombinedText: ocr.combinedText || "",
  };

  if (ai.used && ai.result) {
    const merged = mergeAiResult(normalized, ai.result, sourceContext);
    normalized = synchronizeCommodityFields(merged.normalized);
    aiMergeDiagnostics = merged.diagnostics;
  } else if (aiConfig.mode !== "off" && !["not_requested", "disabled"].includes(String(ai.reason || ""))) {
    appendWarning(normalized, `ai_stage_${String(ai.reason || "unavailable")}`);
  }

  normalized.diagnostics = rebuildHybridDiagnostics(
    normalized,
    sourcePageTexts,
    ocr.used && ocr.normalized ? ocrMergeDiagnostics : null,
    ai.used && ai.result ? aiMergeDiagnostics : null,
    null,
  );

  let consensusDiagnostics = { corrections: [], agreements: [], rejected: [] };
  if (ocr.used && ocr.normalized && ai.used && ai.result) {
    const consensus = applyCrossSourceConsensus({
      nativeNormalized,
      ocrNormalized: ocr.normalized,
      ocrMeta: ocr,
      aiResult: ai.result,
      normalized,
      sourceContext,
    });
    normalized = synchronizeCommodityFields(consensus.normalized);
    consensusDiagnostics = consensus.diagnostics;
    normalized.diagnostics = rebuildHybridDiagnostics(
      normalized,
      sourcePageTexts,
      ocrMergeDiagnostics,
      aiMergeDiagnostics,
      consensusDiagnostics,
    );
  }

  if (!Array.isArray(normalized.diagnostics)) normalized.diagnostics = nativeNormalized.diagnostics || [];

  const availability = sourceAvailability({ nativeError, ocrConfig, ocr, aiConfig, ai });
  const ocrPageConfidences = Object.fromEntries((ocr.pages || [])
    .filter((item) => Number.isInteger(item?.page) && Number.isFinite(Number(item?.confidence)))
    .map((item) => [item.page, Number(item.confidence) / 100]));
  const arbitration = arbitrateConsumptionEvidence({
    nativeNormalized,
    ocrNormalized: ocr.normalized || {},
    aiResult: ai.result || {},
    nativePageTexts: pageTexts,
    ocrPageTexts: Array.isArray(ocr.pageTexts) ? ocr.pageTexts : [],
    ocrPageConfidences,
    sourceAvailability: availability,
  });
  const appliedArbitration = applyConsumptionDecisions(normalized, arbitration.decisions);
  normalized = synchronizeCommodityFields(appliedArbitration.normalized);
  ocrMergeDiagnostics = removeResolvedConflicts(ocrMergeDiagnostics, appliedArbitration.resolvedFields);
  aiMergeDiagnostics = removeResolvedConflicts(aiMergeDiagnostics, appliedArbitration.resolvedFields);
  if (!(ocrMergeDiagnostics.conflicts || []).length) removeWarning(normalized, "ocr_native_conflict");
  if (!(aiMergeDiagnostics.conflicts || []).length) removeWarning(normalized, "ai_native_conflict");
  if (appliedArbitration.resolvedFields.length) appendWarning(normalized, "semantic_evidence_arbitration");

  normalized = quarantineUnsafeRequiredValues(synchronizeCommodityFields(normalized));
  const finalReport = buildPdfQualityReport(normalized);
  if (!finalReport.recognized) normalized.recognized = false;
  normalized.needsReview = Boolean(
    normalized.needsReview
    || nativeError
    || finalReport.missingFields.length
    || finalReport.reviewFields.length
    || normalized.blocked_calculation_fields?.length
    || ocrMergeDiagnostics.conflicts?.length
    || aiMergeDiagnostics.conflicts?.length
    || consensusDiagnostics.corrections?.length
  );

  const ocrCompletedPages = (ocr.pages || []).filter((item) => item.status === "completed").map((item) => item.page);
  const ocrFailedPages = (ocr.pages || []).filter((item) => ["failed", "skipped"].includes(item.status)).map((item) => item.page);
  const finalMode = ai.used
    ? (ocr.used ? "native_ocr_ai" : "native_ai")
    : (ocr.used ? "native_ocr" : "native");

  normalized.analysis_mode = finalMode;
  normalized.analysis = {
    version: "pdf-hybrid-v13-contract-period-evidence",
    strategy: "field_contracts_then_period_aware_evidence_arbitration",
    mode: finalMode,
    duration_ms: Date.now() - startedAt,
    native_failed: Boolean(nativeError),
    native_text_pages: pageTexts.length,
    ocr_module_loaded: Boolean(ocrLoaded.ok),
    ocr_module_error: ocrLoaded.ok ? null : ocrLoaded.error,
    ocr_enabled: ocrConfig.mode !== "off",
    ocr_mode: ocrConfig.mode,
    ocr_used: Boolean(ocr.used),
    ocr_reason: ocr.reason || null,
    ocr_error_code: ocr.errorCode || null,
    ocr_duration_ms: ocr.durationMs || null,
    ocr_worker_init_ms: ocr.workerInitMs || null,
    ocr_timeout_ms: ocrConfig.timeoutMs || null,
    ocr_selected_pages: (ocr.selectedPages || []).map((item) => item.page),
    ocr_completed_pages: ocrCompletedPages,
    ocr_failed_pages: ocrFailedPages,
    ocr_pages: ocr.pages || [],
    ocr_accepted_fields: ocrMergeDiagnostics.acceptedFields || [],
    ocr_confirmed_fields: ocrMergeDiagnostics.confirmedFields || [],
    ocr_rejected_fields: ocrMergeDiagnostics.rejectedFields || [],
    ocr_conflicts: ocrMergeDiagnostics.conflicts || [],
    ai_module_loaded: Boolean(aiLoaded.ok),
    ai_module_error: aiLoaded.ok ? null : aiLoaded.error,
    ai_enabled: aiConfig.mode !== "off",
    ai_mode: aiConfig.mode,
    ai_used: Boolean(ai.used),
    ai_reason: ai.reason || null,
    ai_error_code: ai.errorCode || null,
    ai_http_status: ai.httpStatus || null,
    ai_error_detail: ai.errorDetail || null,
    ai_model: ai.meta?.model || ai.model || null,
    ai_requested_model: aiConfig.model || null,
    ai_timeout_ms: aiConfig.timeoutMs || null,
    ai_duration_ms: ai.meta?.durationMs || ai.durationMs || null,
    ai_input_tokens: ai.meta?.inputTokens || null,
    ai_output_tokens: ai.meta?.outputTokens || null,
    ai_requested_fields: aiRequestedFields,
    ai_accepted_fields: aiMergeDiagnostics.acceptedFields || [],
    ai_confirmed_fields: aiMergeDiagnostics.confirmedFields || [],
    ai_rejected_fields: aiMergeDiagnostics.rejectedFields || [],
    ai_conflicts: aiMergeDiagnostics.conflicts || [],
    ai_notes: aiMergeDiagnostics.notes || [],
    consensus_corrected_fields: (consensusDiagnostics.corrections || []).map((item) => item.field),
    consensus_agreed_fields: consensusDiagnostics.agreements || [],
    consensus_rejected: consensusDiagnostics.rejected || [],
    consensus_corrections: consensusDiagnostics.corrections || [],
    source_availability: availability,
    field_arbitration: normalized.field_decisions || {},
    calculation_ready: Boolean(normalized.calculation_ready),
    blocked_calculation_fields: normalized.blocked_calculation_fields || [],
    quarantined_fields: normalized.quarantined_fields || [],
    quality_native: compactQuality(nativeReport),
    quality_after_ocr: compactQuality(afterOcrReport),
    quality_final: compactQuality(finalReport),
  };

  return { normalized, diagnostics: normalized.analysis };
}

export async function extractPdfHybrid(filePath, options = {}) {
  let nativeNormalized;
  let pageTexts = [];
  let nativeError = null;
  try {
    const native = await extractPdfWithPages(filePath);
    nativeNormalized = native.normalized;
    pageTexts = native.pageTexts;
  } catch (error) {
    if (/password|encrypted|protected/i.test(String(error?.message || ""))) throw error;
    nativeError = error;
    nativeNormalized = nativeFailure(error);
  }
  return enhancePdfAnalysis({
    filePath,
    filename: options.filename,
    nativeNormalized,
    pageTexts,
    nativeError,
  });
}
