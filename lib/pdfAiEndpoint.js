import fs from "node:fs/promises";
import { pdfArchiveConfigured } from "./pdfArchive.js";
import { hasExplicitPdfAiConsent, pdfAiConfig } from "./pdfAiConfig.js";
import { PDF_AI_SHADOW_VERSION, runPdfAiShadowObservation } from "./pdfAiShadow.js";

export const PDF_AI_ENDPOINT_VERSION = "8.3.0";

function fieldValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function compact(value, maxLength = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function pdfAiConsentFromFields(fields = {}) {
  return hasExplicitPdfAiConsent(fieldValue(fields.pdfAiConsent));
}

function endpointAudit({ userConsent = false, archiveReady = false } = {}) {
  return {
    consent_source: "multipart.pdfAiConsent",
    explicit_ai_consent: Boolean(userConsent),
    private_archive_ready: Boolean(archiveReady),
  };
}

function skippedResult({ config, reason, diagnostics = {}, userConsent = false, archiveReady = false }) {
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
      endpoint: endpointAudit({ userConsent, archiveReady }),
      ...diagnostics,
    },
    observation: null,
  };
}

/**
 * Endpoint adapter for the private Step 8 shadow path.
 *
 * The adapter never writes into the normalized public result. It also refuses
 * to read the temporary PDF unless the archive is privately configured and the
 * Step 8 policy authorizes a shadow attempt with explicit user consent.
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
  archiveReady = pdfArchiveConfigured(),
  readFile = fs.readFile,
  shadowRunner = runPdfAiShadowObservation,
  apiKey = process.env.OPENAI_API_KEY,
  transport = globalThis.fetch,
} = {}) {
  if (config.mode !== "shadow") {
    return skippedResult({ config, reason: "shadow_mode_required", userConsent, archiveReady });
  }

  if (!archiveReady) {
    return skippedResult({ config, reason: "private_archive_required", userConsent, archiveReady });
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
      endpoint: endpointAudit({ userConsent, archiveReady }),
    },
  };
}
