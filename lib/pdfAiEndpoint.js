import fs from "node:fs/promises";
import { pdfArchiveConfigured } from "./pdfArchive.js";
import { pdfAiConfig } from "./pdfAiConfig.js";
import {
  applyControlledPdfAiFallback,
  PDF_AI_FALLBACK_PIPELINE_VERSION,
} from "./pdfAiPipelineConsolidated.js";

export const PDF_AI_ENDPOINT_VERSION = "8.8.8.10";

function compact(value, maxLength = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function pdfAiPreviewEnvironment(env = process.env) {
  return String(env?.VERCEL_ENV || "").trim().toLowerCase() === "preview";
}

function endpointAudit({ archiveReady = false, previewEnvironment = false } = {}) {
  return {
    activation: "automatic_preview",
    private_archive_ready: Boolean(archiveReady),
    preview_environment: Boolean(previewEnvironment),
    execution_order: "parser_ocr_ai",
  };
}

function skippedResult({
  config,
  reason,
  diagnostics = {},
  archiveReady = false,
  previewEnvironment = false,
}) {
  return {
    shadow_version: PDF_AI_FALLBACK_PIPELINE_VERSION,
    endpoint_version: PDF_AI_ENDPOINT_VERSION,
    mode: compact(config?.mode, 30) || "off",
    attempted: false,
    status: "skipped",
    reason,
    review_only: true,
    public_output_unchanged: true,
    diagnostics: {
      endpoint: endpointAudit({ archiveReady, previewEnvironment }),
      ...diagnostics,
    },
    observation: null,
  };
}

function documentForPreview(normalized = {}) {
  const kindMap = {
    bolletta: "bill",
    scheda_offerta: "synthetic_sheet",
  };
  const commodityMap = {
    luce: "electricity",
    gas: "gas",
    dual: "dual",
  };
  return {
    document_type: kindMap[normalized.kind] || "unknown",
    commodity: commodityMap[normalized.commodity] || "unknown",
    customer_type: ["consumer", "business"].includes(normalized.customer_type)
      ? normalized.customer_type
      : "unknown",
    page_count: Number.isInteger(Number(normalized.page_count))
      ? Number(normalized.page_count)
      : null,
  };
}

function previewField(entry = {}) {
  const field = compact(entry.field, 80);
  if (!field || entry.value === null || entry.value === undefined || entry.value === "") return null;
  return {
    field,
    normalized_value: entry.value,
    page: Number.isInteger(Number(entry.page)) ? Number(entry.page) : null,
    label: compact(entry.label, 180) || null,
    evidence: compact(entry.evidence, 360) || null,
    confidence: Number.isFinite(Number(entry.confidence)) ? Number(entry.confidence) : null,
  };
}

function previewConflict(entry = {}) {
  const field = compact(entry.field, 80);
  if (!field) return null;
  return {
    field,
    reason: compact(entry.reason || entry.description, 120) || "conflict",
    values: Array.isArray(entry.values) ? entry.values.slice(0, 5) : [],
    pages: Array.isArray(entry.pages) ? entry.pages.slice(0, 8) : [],
    page: Number.isInteger(Number(entry.page)) ? Number(entry.page) : null,
  };
}

function statusFromPipeline(ai = {}) {
  const reason = compact(ai.reason, 120) || "unknown";
  if (!ai.attempted) return "skipped";
  if (ai.applied || reason === "no_material_improvement") return "observed";
  if (/timeout/i.test(reason)) return "timeout";
  return "error";
}

function pipelineObservation(result = {}, config = {}) {
  const ai = result?.ai && typeof result.ai === "object" ? result.ai : {};
  const status = statusFromPipeline(ai);
  const reviewFields = Object.values(ai.field_meta || {}).map(previewField).filter(Boolean);
  const conflicts = (Array.isArray(ai.provider_conflicts) ? ai.provider_conflicts : [])
    .map(previewConflict)
    .filter(Boolean);
  const rejectedCount = Array.isArray(ai.rejected_fields) ? ai.rejected_fields.length : 0;
  const reason = compact(ai.reason, 120) || (ai.attempted ? "pipeline_error" : "fallback_not_needed");
  const errorCode = ["error", "timeout"].includes(status) ? reason : null;

  return {
    shadow_version: PDF_AI_FALLBACK_PIPELINE_VERSION,
    mode: compact(config?.mode, 30) || "shadow",
    attempted: Boolean(ai.attempted),
    status,
    reason,
    review_only: true,
    public_output_unchanged: true,
    diagnostics: {
      pipeline: {
        version: compact(ai.pipeline_version, 80) || PDF_AI_FALLBACK_PIPELINE_VERSION,
        reader_version: compact(ai.reader_version, 80) || null,
        attempts: Number.isInteger(Number(ai.attempts)) ? Number(ai.attempts) : 0,
        request_profile: compact(ai.request_profile, 120) || null,
        elapsed_ms: Number.isFinite(Number(ai.elapsed_ms)) ? Number(ai.elapsed_ms) : null,
        candidate_count: Number.isInteger(Number(ai.candidate_count)) ? Number(ai.candidate_count) : 0,
        filled_field_count: reviewFields.length,
        rejected_field_count: rejectedCount,
        economic_recovery_attempted: Boolean(ai.economic_recovery_attempted),
        economic_recovery_completed: Number(ai.economic_recovery_completed || 0),
        economic_recovery_rows: Number(ai.economic_recovery_rows || 0),
      },
      client: {
        elapsed_ms: Number.isFinite(Number(ai.elapsed_ms)) ? Number(ai.elapsed_ms) : null,
        error: errorCode ? { code: errorCode, http_status: null } : null,
      },
    },
    observation: status === "observed" ? {
      document: documentForPreview(result),
      candidates: [],
      review_reasons: Array.isArray(ai.review_reasons) ? ai.review_reasons.slice(0, 20) : [],
      review_plan: {
        applied: false,
        review_fields: reviewFields,
        corroborated_fields: [],
        conflicts,
        summary: {
          review_field_count: reviewFields.length,
          corroborated_field_count: 0,
          conflict_count: conflicts.length,
          ignored_candidate_count: rejectedCount,
        },
      },
    } : null,
  };
}

async function runConsolidatedObservation({
  filePath,
  filename,
  normalized,
  deadlineAt,
  env,
  config,
  apiKey,
  transport,
} = {}) {
  const effectiveEnv = {
    ...process.env,
    ...(env || {}),
    PDF_AI_MODE: config?.mode || "shadow",
    ...(config?.model ? { PDF_AI_MODEL: config.model } : {}),
    ...(config?.timeout_ms ? { PDF_AI_TIMEOUT_MS: String(config.timeout_ms) } : {}),
  };
  const result = await applyControlledPdfAiFallback(filePath, {
    filename,
    normalized,
    deadlineAt,
    env: effectiveEnv,
    apiKey,
    ...(typeof transport === "function" && transport !== globalThis.fetch ? { transport } : {}),
  });
  return pipelineObservation(result, config);
}

/**
 * Private Step 8 adapter. The public parser/OCR result is never replaced:
 * only sanitised review fields are returned to the Vercel Preview.
 */
export async function runPdfAiEndpointObservation({
  filePath,
  filename = "documento.pdf",
  fileSizeBytes,
  normalized = {},
  deadlineAt,
  env,
  config = pdfAiConfig(env),
  previewEnvironment = pdfAiPreviewEnvironment(env || process.env),
  archiveReady = pdfArchiveConfigured(),
  readFile = fs.readFile,
  shadowRunner = runConsolidatedObservation,
  apiKey = process.env.OPENAI_API_KEY,
  transport,
} = {}) {
  const sharedSkip = { config, archiveReady, previewEnvironment };

  if (config.mode !== "shadow") {
    return skippedResult({ ...sharedSkip, reason: "shadow_mode_required" });
  }
  if (!previewEnvironment) {
    return skippedResult({ ...sharedSkip, reason: "preview_environment_required" });
  }
  if (!archiveReady) {
    return skippedResult({ ...sharedSkip, reason: "private_archive_required" });
  }

  const result = await shadowRunner({
    filePath,
    normalized,
    loadPdfBuffer: async () => {
      if (!filePath) throw new Error("pdf_file_path_required");
      return readFile(filePath);
    },
    filename,
    fileSizeBytes,
    pageCount: normalized?.page_count,
    deterministicExhausted: true,
    deadlineAt,
    env,
    config,
    apiKey,
    transport,
  });

  return {
    ...result,
    endpoint_version: PDF_AI_ENDPOINT_VERSION,
    public_output_unchanged: true,
    diagnostics: {
      ...(result?.diagnostics || {}),
      endpoint: endpointAudit({ archiveReady, previewEnvironment }),
    },
  };
}
