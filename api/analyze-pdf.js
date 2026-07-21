import fs from "node:fs/promises";
import formidable from "formidable";
import { json, method, requireAllowedOrigin } from "../lib/http.js";
import { extractPdfWithControlledOcr } from "../lib/pdfExtractWithOcr.js";
import { applyControlledPdfAiFallback } from "../lib/pdfAiFallback.js";
import { archivePdfAnalysis } from "../lib/pdfArchive.js";
import { runPdfReaderShadow } from "../lib/pdfReaderShadow.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";

export const config = {
  api: { bodyParser: false },
};

const ACCEPTED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/octet-stream",
]);

function parseForm(req) {
  const maxFileSize = Number(process.env.MAX_PDF_BYTES || 8_000_000);
  const form = formidable({
    multiples: false,
    maxFileSize,
    allowEmptyFiles: false,
    filter: (part) => ACCEPTED_UPLOAD_MIME_TYPES.has(part.mimetype || ""),
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => {
      if (error) reject(error);
      else resolve({ fields, files });
    });
  });
}

function fieldValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function parseArchiveContext(fields = {}) {
  const raw = fieldValue(fields.archiveContext);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function isRealPdf(filePath) {
  const handle = await fs.open(filePath, "r");
  try {
    const signature = Buffer.alloc(5);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    return bytesRead === signature.length && signature.toString("ascii") === "%PDF-";
  } finally {
    await handle.close();
  }
}

function publicError(error) {
  const message = String(error?.message || "");
  if (/maxFileSize|max file size|too large/i.test(message)) {
    return { status: 413, error: "PDF troppo grande" };
  }
  if (/password|encrypted|protected/i.test(message)) {
    return { status: 422, error: "PDF protetto o cifrato" };
  }
  return { status: 400, error: "Errore analisi PDF" };
}

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedOrigin(req, res)) return;
  if (!(await enforceRateLimit(req, res, { label: "analyze-pdf", ...rateLimitConfig("PDF", 15) }))) return;

  let temporaryFilePath = "";
  let fileMetadata = null;
  let archiveContext = {};
  let validPdf = false;
  const configuredDeadlineMs = Number.parseInt(process.env.PDF_ANALYSIS_DEADLINE_MS || "55000", 10);
  const analysisDeadlineMs = Number.isFinite(configuredDeadlineMs)
    ? Math.max(24_000, Math.min(55_000, configuredDeadlineMs))
    : 55_000;
  const analysisDeadlineAt = Date.now() + analysisDeadlineMs;
  try {
    const { fields, files } = await parseForm(req);
    archiveContext = parseArchiveContext(fields);
    const file = Array.isArray(files.pdf) ? files.pdf[0] : files.pdf;
    if (!file) return json(res, 400, { ok: false, error: "PDF mancante o formato non accettato" });

    temporaryFilePath = file.filepath;
    fileMetadata = {
      originalFilename: file.originalFilename || file.newFilename || "documento.pdf",
      mimeType: file.mimetype || "application/pdf",
      fileSize: Number(file.size || 0),
    };
    if (!(await isRealPdf(temporaryFilePath))) {
      return json(res, 415, { ok: false, error: "Il file caricato non è un PDF valido" });
    }
    validPdf = true;

    const aiFallbackConsent = /^(?:1|true|yes|on)$/i.test(String(fieldValue(fields.aiFallbackConsent) || "").trim());
    const ocrNormalized = await extractPdfWithControlledOcr(temporaryFilePath, {
      filename: fileMetadata.originalFilename,
      deadlineAt: analysisDeadlineAt,
    });
    const normalized = await applyControlledPdfAiFallback(temporaryFilePath, {
      filename: fileMetadata.originalFilename,
      normalized: ocrNormalized,
      consentGranted: aiFallbackConsent,
      deadlineAt: analysisDeadlineAt,
    });
    const canRunShadow = analysisDeadlineAt - Date.now() >= 3_000;
    const shadow = canRunShadow
      ? await runPdfReaderShadow({
        filePath: temporaryFilePath,
        filename: fileMetadata.originalFilename,
        legacyNormalized: normalized,
        deadlineAt: analysisDeadlineAt,
      }).catch((error) => ({
        enabled: true,
        mode: "shadow",
        pipeline_version: "shadow-gpt41-v1",
        public_output: "legacy_unchanged",
        error: String(error?.message || "shadow_pipeline_error").slice(0, 300),
      }))
      : {
        enabled: true,
        mode: "shadow",
        pipeline_version: "shadow-gpt41-v1",
        public_output: "legacy_unchanged",
        skipped: "analysis_deadline_near",
      };
    const archive = await archivePdfAnalysis({
      filePath: temporaryFilePath,
      ...fileMetadata,
      normalized,
      shadow,
      context: archiveContext,
    }).catch(() => ({ stored: false, reason: "archive_error" }));
    return json(res, 200, { ok: true, normalized, archive });
  } catch (error) {
    if (validPdf && temporaryFilePath && fileMetadata) {
      await archivePdfAnalysis({
        filePath: temporaryFilePath,
        ...fileMetadata,
        error,
        context: archiveContext,
      }).catch(() => {});
    }
    const mapped = publicError(error);
    return json(res, mapped.status, { ok: false, error: mapped.error });
  } finally {
    if (temporaryFilePath) {
      await fs.unlink(temporaryFilePath).catch(() => {});
    }
  }
}
