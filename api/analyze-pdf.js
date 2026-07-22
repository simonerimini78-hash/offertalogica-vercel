import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import formidable from "formidable";
import { json, method, readJson, requireAllowedOrigin } from "../lib/http.js";
import { extractPdfWithControlledOcr } from "../lib/pdfExtractWithOcr.js";
import {
  archivePdfAnalysis,
  assembleTemporaryPdfUpload,
  deleteTemporaryPdfUpload,
  pdfArchiveConfigured,
  storeTemporaryPdfChunk,
} from "../lib/pdfArchive.js";
import { runPdfAiEndpointObservation, pdfAiPreviewEnvironment } from "../lib/pdfAiEndpoint.js";
import { buildPdfAiPreview } from "../lib/pdfAiPreview.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";

export const config = {
  api: { bodyParser: false },
};

const ACCEPTED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/octet-stream",
]);
const MULTIPART_FILE_LIMIT_BYTES = 4_000_000;
const DEFAULT_MAX_PDF_BYTES = 25_000_000;

function configuredMaxPdfBytes() {
  const requested = Number(process.env.MAX_PDF_BYTES || DEFAULT_MAX_PDF_BYTES);
  return Number.isFinite(requested)
    ? Math.max(1_000_000, Math.min(25_000_000, requested))
    : DEFAULT_MAX_PDF_BYTES;
}

function parseForm(req) {
  const form = formidable({
    multiples: false,
    maxFileSize: Math.min(configuredMaxPdfBytes(), MULTIPART_FILE_LIMIT_BYTES),
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

function parseArchiveContextValue(raw) {
  if (!raw) return {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function parseArchiveContext(fields = {}) {
  return parseArchiveContextValue(fieldValue(fields.archiveContext));
}

function uploadModeFromFields(fields = {}) {
  return String(fieldValue(fields.uploadMode) || "").trim().toLowerCase();
}

function contentType(req) {
  return String(req.headers?.["content-type"] || "").toLowerCase();
}

function numericValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeOriginalFilename(value) {
  const base = String(value || "documento.pdf").split(/[\\/]/).pop() || "documento.pdf";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) || "documento.pdf";
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
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
  if (/maxFileSize|max file size|too large|pdf_too_large/i.test(message)) {
    return { status: 413, error: "PDF troppo grande" };
  }
  if (/temporary_upload_size_mismatch|temporary_chunk_missing|temporary_chunk_count_invalid/i.test(message)) {
    return { status: 400, error: "Caricamento PDF incompleto" };
  }
  if (/preview_required_for_large_upload/i.test(message)) {
    return { status: 403, error: "PDF fotografato grande disponibile solo nella Preview" };
  }
  if (/private_archive_required/i.test(message)) {
    return { status: 503, error: "Archivio privato PDF non configurato" };
  }
  if (/password|encrypted|protected/i.test(message)) {
    return { status: 422, error: "PDF protetto o cifrato" };
  }
  return { status: 400, error: "Errore analisi PDF" };
}

async function handleTemporaryChunk({ fields, files, previewEnvironment }) {
  if (!previewEnvironment) throw new Error("preview_required_for_large_upload");
  if (!pdfArchiveConfigured()) throw new Error("private_archive_required");
  const file = Array.isArray(files.pdf) ? files.pdf[0] : files.pdf;
  if (!file?.filepath) throw new Error("temporary_chunk_missing");
  const buffer = await fs.readFile(file.filepath);
  try {
    return await storeTemporaryPdfChunk({
      uploadId: fieldValue(fields.uploadId),
      chunkIndex: fieldValue(fields.chunkIndex),
      chunkCount: fieldValue(fields.chunkCount),
      buffer,
    });
  } finally {
    await fs.unlink(file.filepath).catch(() => {});
  }
}

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedOrigin(req, res)) return;
  if (!(await enforceRateLimit(req, res, { label: "analyze-pdf", ...rateLimitConfig("PDF", 20) }))) return;

  let temporaryFilePath = "";
  let fileMetadata = null;
  let archiveContext = {};
  let aiShadow = null;
  let validPdf = false;
  let temporaryUpload = null;
  const previewEnvironment = pdfAiPreviewEnvironment(process.env);
  const configuredDeadlineMs = Number.parseInt(process.env.PDF_ANALYSIS_DEADLINE_MS || "55000", 10);
  const analysisDeadlineMs = Number.isFinite(configuredDeadlineMs)
    ? Math.max(24_000, Math.min(55_000, configuredDeadlineMs))
    : 55_000;
  const analysisDeadlineAt = Date.now() + analysisDeadlineMs;

  try {
    if (contentType(req).includes("application/json")) {
      const body = await readJson(req);
      const mode = String(body.uploadMode || "").trim().toLowerCase();
      if (!previewEnvironment) throw new Error("preview_required_for_large_upload");
      if (!pdfArchiveConfigured()) throw new Error("private_archive_required");
      temporaryUpload = {
        uploadId: String(body.uploadId || ""),
        chunkCount: numericValue(body.chunkCount),
      };
      if (mode === "cleanup") {
        await deleteTemporaryPdfUpload(temporaryUpload).catch(() => {});
        return json(res, 200, { ok: true, cleaned: true });
      }
      if (mode !== "assemble") throw new Error("temporary_upload_mode_invalid");
      const expectedBytes = numericValue(body.fileSize);
      if (expectedBytes <= 0 || expectedBytes > configuredMaxPdfBytes()) throw new Error("pdf_too_large");
      const buffer = await assembleTemporaryPdfUpload({ ...temporaryUpload, expectedBytes });
      if (buffer.length > configuredMaxPdfBytes()) throw new Error("pdf_too_large");
      temporaryFilePath = path.join(os.tmpdir(), `offertalogica-${crypto.randomUUID()}.pdf`);
      await fs.writeFile(temporaryFilePath, buffer);
      archiveContext = parseArchiveContextValue(body.archiveContext);
      fileMetadata = {
        originalFilename: safeOriginalFilename(body.originalFilename),
        mimeType: "application/pdf",
        fileSize: buffer.length,
      };
    } else {
      const { fields, files } = await parseForm(req);
      if (uploadModeFromFields(fields) === "chunk") {
        const stored = await handleTemporaryChunk({ fields, files, previewEnvironment });
        return json(res, 200, { ok: true, chunk: stored });
      }
      archiveContext = parseArchiveContext(fields);
      const file = Array.isArray(files.pdf) ? files.pdf[0] : files.pdf;
      if (!file) return json(res, 400, { ok: false, error: "PDF mancante o formato non accettato" });
      temporaryFilePath = file.filepath;
      fileMetadata = {
        originalFilename: safeOriginalFilename(file.originalFilename || file.newFilename),
        mimeType: file.mimetype || "application/pdf",
        fileSize: Number(file.size || 0),
      };
    }

    if (!fileMetadata || fileMetadata.fileSize <= 0 || fileMetadata.fileSize > configuredMaxPdfBytes()) {
      throw new Error("pdf_too_large");
    }
    if (!(await isRealPdf(temporaryFilePath))) {
      return json(res, 415, { ok: false, error: "Il file caricato non è un PDF valido" });
    }
    validPdf = true;

    const normalized = await extractPdfWithControlledOcr(temporaryFilePath, {
      filename: fileMetadata.originalFilename,
      deadlineAt: analysisDeadlineAt,
    });
    aiShadow = await runPdfAiEndpointObservation({
      filePath: temporaryFilePath,
      filename: fileMetadata.originalFilename,
      fileSizeBytes: fileMetadata.fileSize,
      normalized,
      previewEnvironment,
      deadlineAt: analysisDeadlineAt,
    }).catch(() => ({
      endpoint_version: "8.4.3",
      mode: "shadow",
      attempted: false,
      status: "error",
      reason: "endpoint_shadow_error",
      review_only: true,
      public_output_unchanged: true,
      diagnostics: {},
      observation: null,
    }));
    const aiPreview = previewEnvironment ? buildPdfAiPreview(aiShadow) : null;
    const responseNormalized = aiPreview
      ? { ...normalized, ai_preview: aiPreview, needsReview: true }
      : normalized;
    const archive = await archivePdfAnalysis({
      filePath: temporaryFilePath,
      ...fileMetadata,
      normalized,
      aiShadow,
      context: archiveContext,
    }).catch(() => ({ stored: false, reason: "archive_error" }));
    return json(res, 200, { ok: true, normalized: responseNormalized, archive });
  } catch (error) {
    if (validPdf && temporaryFilePath && fileMetadata) {
      await archivePdfAnalysis({
        filePath: temporaryFilePath,
        ...fileMetadata,
        aiShadow,
        error,
        context: archiveContext,
      }).catch(() => {});
    }
    const mapped = publicError(error);
    return json(res, mapped.status, { ok: false, error: mapped.error });
  } finally {
    if (temporaryFilePath) await fs.unlink(temporaryFilePath).catch(() => {});
    if (temporaryUpload) await deleteTemporaryPdfUpload(temporaryUpload).catch(() => {});
  }
}
