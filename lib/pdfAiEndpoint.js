import fs from "node:fs/promises";
import { pdfArchiveConfigured } from "./pdfArchive.js";
import { pdfAiConfig } from "./pdfAiConfig.js";
import { PDF_AI_SHADOW_VERSION, runPdfAiShadowObservation } from "./pdfAiShadow.js";

export const PDF_AI_ENDPOINT_VERSION = "8.4.2";

function compact(value, maxLength = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function pdfAiPreviewEnvironment(env = process.env) {
  return String(env?.VERCEL_ENV || "").trim().toLowerCase() === "preview";
}

function endpointAudit({
  archiveReady = false,
  previewEnvironment = false,
} = {}) {
  return {
    activation: "automatic_preview",
    private_archive_ready: Boolean(archiveReady),
    preview_environment: Boolean(previewEnvironment),
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
    shadow_version: PDF_AI_SHADOW_VERSION,
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

/**
 * Endpoint adapter for the private Step 8 visual path.
 *
 * The temporary PDF can be read only when the request runs on a Vercel Preview
 * and the private archive is configured. Preview deployment protection remains
 * outside this module. No browser checkbox or separate staff page is required.
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
  shadowRunner = runPdfAiShadowObservation,
  apiKey = process.env.OPENAI_API_KEY,
  transport = globalThis.fetch,
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
