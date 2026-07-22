import fs from "node:fs/promises";
import { pdfArchiveConfigured } from "./pdfArchive.js";
import { hasExplicitPdfAiConsent, pdfAiConfig } from "./pdfAiConfig.js";
import { PDF_AI_SHADOW_VERSION, runPdfAiShadowObservation } from "./pdfAiShadow.js";

export const PDF_AI_ENDPOINT_VERSION = "8.4.0";

function fieldValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function compact(value, maxLength = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function pdfAiConsentFromFields(fields = {}) {
  return hasExplicitPdfAiConsent(fieldValue(fields.pdfAiConsent));
}

export function pdfAiPreviewEnvironment(env = process.env) {
  return String(env?.VERCEL_ENV || "").trim().toLowerCase() === "preview";
}

function endpointAudit({
  userConsent = false,
  archiveReady = false,
  previewEnvironment = false,
  staffAuthorized = false,
} = {}) {
  return {
    consent_source: "multipart.pdfAiConsent",
    explicit_ai_consent: Boolean(userConsent),
    private_archive_ready: Boolean(archiveReady),
    preview_environment: Boolean(previewEnvironment),
    staff_authorized: Boolean(staffAuthorized),
  };
}

function skippedResult({
  config,
  reason,
  diagnostics = {},
  userConsent = false,
  archiveReady = false,
  previewEnvironment = false,
  staffAuthorized = false,
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
      endpoint: endpointAudit({
        userConsent,
        archiveReady,
        previewEnvironment,
        staffAuthorized,
      }),
      ...diagnostics,
    },
    observation: null,
  };
}

/**
 * Endpoint adapter for the private Step 8 shadow path.
 *
 * The adapter never writes into the normalized public result. It refuses to
 * read the temporary PDF unless the request runs on a Vercel Preview,
 * originates from an authenticated staff session, has explicit AI consent and
 * the private archive is configured.
 */
export async function runPdfAiEndpointObservation({
  filePath,
  filename = "documento.pdf",
  fileSizeBytes,
  normalized = {},
  fields = {},
  userConsent = pdfAiConsentFromFields(fields),
  deadlineAt,
  env,
  config = pdfAiConfig(env),
  previewEnvironment = pdfAiPreviewEnvironment(env || process.env),
  staffAuthorized = false,
  archiveReady = pdfArchiveConfigured(),
  readFile = fs.readFile,
  shadowRunner = runPdfAiShadowObservation,
  apiKey = process.env.OPENAI_API_KEY,
  transport = globalThis.fetch,
} = {}) {
  const sharedSkip = {
    config,
    userConsent,
    archiveReady,
    previewEnvironment,
    staffAuthorized,
  };

  if (config.mode !== "shadow") {
    return skippedResult({ ...sharedSkip, reason: "shadow_mode_required" });
  }

  if (!previewEnvironment) {
    return skippedResult({ ...sharedSkip, reason: "preview_environment_required" });
  }

  if (!staffAuthorized) {
    return skippedResult({ ...sharedSkip, reason: "staff_authorization_required" });
  }

  if (!hasExplicitPdfAiConsent(userConsent)) {
    return skippedResult({ ...sharedSkip, reason: "missing_explicit_consent" });
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
    userConsent,
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
      endpoint: endpointAudit({
        userConsent,
        archiveReady,
        previewEnvironment,
        staffAuthorized,
      }),
    },
  };
}
