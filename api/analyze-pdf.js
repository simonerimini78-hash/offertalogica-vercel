import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import formidable from "formidable";
import { json, method, requireAllowedOrigin } from "../lib/http.js";
import { extractPdfPureAi } from "../lib/pdfPureAiReader.js";
import {
  archivePdfAnalysis,
  createPdfDirectUpload,
  deletePdfDirectUpload,
  downloadPdfDirectUpload,
} from "../lib/pdfArchive.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";

export const config = {
  api: { bodyParser: false },
};

const PDF_INGRESS_VERSION = "pdf-ingress-v1.0.2";
const JSON_BODY_LIMIT = 64_000;
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

async function parseJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > JSON_BODY_LIMIT) throw new Error("json_body_too_large");
    chunks.push(buffer);
  }
  if (!chunks.length) throw new Error("json_body_missing");
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    return parsed;
  } catch {
    throw new Error("json_body_invalid");
  }
}

function fieldValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizedArchiveContext(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseArchiveContext(fields = {}) {
  return normalizedArchiveContext(fieldValue(fields.archiveContext));
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
  if (/maxFileSize|max file size|too large|pdf_upload_too_large/i.test(message)) {
    return { status: 413, code: "PDF_TOO_LARGE", error: "PDF troppo grande" };
  }
  if (/pdf_upload_not_configured/.test(message)) {
    return { status: 503, code: "PDF_DIRECT_UPLOAD_NOT_CONFIGURED", error: "Caricamento protetto dei PDF grandi non configurato" };
  }
  if (/pdf_upload_expired/.test(message)) {
    return { status: 410, code: "PDF_UPLOAD_EXPIRED", error: "Caricamento PDF scaduto. Riprova." };
  }
  if (/pdf_upload_invalid_ticket|pdf_upload_invalid_size|pdf_upload_invalid_mime|json_body_/.test(message)) {
    return { status: 400, code: "PDF_UPLOAD_INVALID", error: "Richiesta di caricamento PDF non valida" };
  }
  if (/pdf_upload_missing/.test(message)) {
    return { status: 404, code: "PDF_UPLOAD_MISSING", error: "PDF caricato non trovato. Riprova." };
  }
  if (/pdf_upload_size_mismatch/.test(message)) {
    return { status: 422, code: "PDF_UPLOAD_SIZE_MISMATCH", error: "Il PDF caricato non corrisponde al file selezionato" };
  }
  if (/pdf_upload_/.test(message)) {
    return { status: 502, code: "PDF_UPLOAD_FAILED", error: "Caricamento protetto del PDF non riuscito" };
  }
  if (/password|encrypted|protected/i.test(message)) {
    return { status: 422, code: "PDF_PROTECTED", error: "PDF protetto o cifrato" };
  }
  if (/openai_missing_api_key/.test(message)) {
    return { status: 503, code: "AI_NOT_CONFIGURED", error: "Lettura IA non configurata" };
  }
  if (/openai_timeout|deadline|insufficient_time_budget/.test(message)) {
    return { status: 504, code: "AI_TIMEOUT", error: "La lettura IA ha richiesto troppo tempo. Riprova." };
  }
  if (/openai_http_429/.test(message)) {
    return { status: 503, code: "AI_BUSY", error: "Servizio IA temporaneamente occupato. Riprova." };
  }
  if (/openai_|pure_ai_/.test(message)) {
    return { status: 502, code: "AI_INVALID_RESULT", error: "La lettura IA non ha restituito un risultato utilizzabile" };
  }
  return { status: 400, code: "PDF_ANALYSIS_ERROR", error: "Errore analisi PDF" };
}

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedOrigin(req, res)) return;

  let temporaryFilePath = "";
  let directUploadTicket = "";
  let fileMetadata = null;
  let archiveContext = {};
  let validPdf = false;
  let ingressMode = "vercel_multipart";
  const configuredDeadlineMs = Number.parseInt(process.env.PDF_ANALYSIS_DEADLINE_MS || "52000", 10);
  const analysisDeadlineMs = Number.isFinite(configuredDeadlineMs)
    ? Math.max(24_000, Math.min(52_000, configuredDeadlineMs))
    : 52_000;
  const analysisDeadlineAt = Date.now() + analysisDeadlineMs;

  try {
    const contentType = String(req.headers?.["content-type"] || "").toLowerCase();
    if (contentType.includes("application/json")) {
      const body = await parseJsonBody(req);
      const rateLabel = body.action === "create_upload" ? "analyze-pdf-upload" : "analyze-pdf";
      if (!(await enforceRateLimit(req, res, { label: rateLabel, ...rateLimitConfig("PDF", 15) }))) return;
      if (body.action === "create_upload") {
        const upload = await createPdfDirectUpload({
          originalFilename: body.filename,
          mimeType: body.mimeType,
          fileSize: body.fileSize,
        });
        return json(res, 200, { ok: true, upload });
      }
      if (body.action !== "analyze_uploaded_pdf") throw new Error("json_body_invalid_action");
      directUploadTicket = String(body.uploadTicket || "");
      archiveContext = normalizedArchiveContext(body.archiveContext);
      temporaryFilePath = path.join(os.tmpdir(), `offertalogica-pdf-${crypto.randomUUID()}.pdf`);
      fileMetadata = await downloadPdfDirectUpload({
        ticket: directUploadTicket,
        destinationPath: temporaryFilePath,
      });
      ingressMode = "supabase_signed_upload";
    } else {
      if (!(await enforceRateLimit(req, res, { label: "analyze-pdf", ...rateLimitConfig("PDF", 15) }))) return;
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
    }

    if (!(await isRealPdf(temporaryFilePath))) {
      return json(res, 415, { ok: false, error: "Il file caricato non è un PDF valido" });
    }
    validPdf = true;

    const normalized = await extractPdfPureAi({
      filePath: temporaryFilePath,
      filename: fileMetadata.originalFilename,
      deadlineAt: analysisDeadlineAt,
    });
    normalized.ai = {
      ...(normalized.ai || {}),
      ingress_mode: ingressMode,
      ingress_version: PDF_INGRESS_VERSION,
    };
    const canArchive = analysisDeadlineAt - Date.now() >= 7_000;
    const archive = canArchive
      ? await archivePdfAnalysis({
        filePath: temporaryFilePath,
        ...fileMetadata,
        normalized,
        context: archiveContext,
      }).catch(() => ({ stored: false, reason: "archive_error" }))
      : { stored: false, reason: "insufficient_time_budget" };
    return json(res, 200, { ok: true, normalized, archive });
  } catch (error) {
    if (validPdf && temporaryFilePath && fileMetadata && analysisDeadlineAt - Date.now() >= 7_000) {
      await archivePdfAnalysis({
        filePath: temporaryFilePath,
        ...fileMetadata,
        error,
        context: archiveContext,
      }).catch(() => {});
    }
    const mapped = publicError(error);
    return json(res, mapped.status, { ok: false, code: mapped.code, error: mapped.error });
  } finally {
    if (directUploadTicket) await deletePdfDirectUpload(directUploadTicket).catch(() => {});
    if (temporaryFilePath) await fs.unlink(temporaryFilePath).catch(() => {});
  }
}
