import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import formidable from "formidable";
import { json, method, requireAllowedOrigin } from "../lib/http.js";
import { extractPdfPureAi, PDF_PURE_AI_DEFAULT_MODEL } from "../lib/pdfPureAiReader.js";
import { normalizePdfFileHeader } from "../lib/pdfFileValidation.js";
import {
  archivePdfAnalysis,
  createPdfDirectUpload,
  deletePdfDirectUpload,
  downloadPdfDirectUpload,
  pdfMaxBytes,
} from "../lib/pdfArchive.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";
import { classifyPdfAnalysisError, pdfAnalysisDiagnosticLog } from "../lib/pdfAnalysisDiagnostics.js";
import { createSitePdfUsageMeter, recordSitePdfAiEconomicEvent } from "../lib/sitePdfAiEconomics.js";

export const config = {
  api: { bodyParser: false },
};

const PDF_INGRESS_VERSION = "pdf-ingress-v1.0.3";
const JSON_BODY_LIMIT = 64_000;
const ACCEPTED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/octet-stream",
]);

function parseForm(req) {
  const maxFileSize = pdfMaxBytes();
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

function publicError(error) {
  const message = String(error?.message || "");
  if (/maxFileSize|max file size|too large|pdf_upload_too_large/i.test(message)) {
    return {
      status: 413,
      code: "PDF_TOO_LARGE",
      error: "PDF troppo grande",
      fileSize: Number(error?.actualBytes || 0) || null,
      maxFileSize: Number(error?.maxBytes || pdfMaxBytes()),
    };
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
  let pdfHeader = { valid: false, sanitized: false, bytesRemoved: 0, fileSize: null };
  let analysisStage = "request_received";
  const requestStartedAt = Date.now();
  const configuredDeadlineMs = Number.parseInt(process.env.PDF_ANALYSIS_DEADLINE_MS || "52000", 10);
  const analysisDeadlineMs = Number.isFinite(configuredDeadlineMs)
    ? Math.max(24_000, Math.min(52_000, configuredDeadlineMs))
    : 52_000;
  const analysisDeadlineAt = Date.now() + analysisDeadlineMs;
  const aiAccountingEventId = crypto.randomUUID();
  const aiAccountingOccurredAt = new Date(requestStartedAt).toISOString();
  const aiModel = process.env.PDF_AI_PRIMARY_MODEL || PDF_PURE_AI_DEFAULT_MODEL;
  const aiUsageMeter = createSitePdfUsageMeter();
  let aiAccountingRecorded = false;

  async function recordAiEconomicCost({ outcome, normalized = null, error = null } = {}) {
    if (aiAccountingRecorded || aiUsageMeter.totals.calls.length === 0) return;
    aiAccountingRecorded = true;
    try {
      await recordSitePdfAiEconomicEvent({
        eventId: aiAccountingEventId,
        usage: aiUsageMeter.totals,
        model: aiModel,
        customerType: normalized?.customer_type || archiveContext?.customerType,
        outcome,
        ingressMode,
        analysisStage,
        elapsedMs: Date.now() - requestStartedAt,
        errorCode: error ? String(error?.code || error?.name || error?.message || "pdf_analysis_error").slice(0, 120) : "",
        occurredAt: aiAccountingOccurredAt,
      });
    } catch (accountingError) {
      console.error("[site-pdf-ai-accounting-error]", JSON.stringify({
        event: "site_pdf_ai_accounting_failed",
        stage: analysisStage,
        message: String(accountingError?.message || accountingError || "accounting_error").slice(0, 300),
      }));
    }
  }

  try {
    const contentType = String(req.headers?.["content-type"] || "").toLowerCase();
    if (contentType.includes("application/json")) {
      analysisStage = "json_body";
      const body = await parseJsonBody(req);
      const rateLabel = body.action === "create_upload" ? "analyze-pdf-upload" : "analyze-pdf";
      if (!(await enforceRateLimit(req, res, { label: rateLabel, ...rateLimitConfig("PDF", 15) }))) return;
      if (body.action === "create_upload") {
        analysisStage = "create_signed_upload";
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
      analysisStage = "download_signed_upload";
      fileMetadata = await downloadPdfDirectUpload({
        ticket: directUploadTicket,
        destinationPath: temporaryFilePath,
      });
      ingressMode = "supabase_signed_upload";
    } else {
      if (!(await enforceRateLimit(req, res, { label: "analyze-pdf", ...rateLimitConfig("PDF", 15) }))) return;
      analysisStage = "parse_multipart";
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

    analysisStage = "validate_pdf";
    pdfHeader = await normalizePdfFileHeader(temporaryFilePath);
    if (!pdfHeader.valid) {
      return json(res, 415, { ok: false, code: "PDF_INVALID", error: "Il file caricato non è un PDF valido" });
    }
    if (pdfHeader.sanitized && fileMetadata) fileMetadata.fileSize = pdfHeader.fileSize;
    validPdf = true;

    analysisStage = "openai_analysis";
    const normalized = await extractPdfPureAi({
      filePath: temporaryFilePath,
      filename: fileMetadata.originalFilename,
      deadlineAt: analysisDeadlineAt,
      transport: aiUsageMeter.transport,
      model: aiModel,
    });
    normalized.ai = {
      ...(normalized.ai || {}),
      ingress_mode: ingressMode,
      ingress_version: PDF_INGRESS_VERSION,
      pdf_header_normalized: Boolean(pdfHeader.sanitized),
      leading_bytes_removed: Number(pdfHeader.bytesRemoved || 0),
    };
    await recordAiEconomicCost({ outcome: "success", normalized });
    analysisStage = "archive_success";
    const canArchive = analysisDeadlineAt - Date.now() >= 7_000;
    const archive = canArchive
      ? await archivePdfAnalysis({
        filePath: temporaryFilePath,
        ...fileMetadata,
        normalized,
        context: archiveContext,
      }).catch(() => ({ stored: false, reason: "archive_error" }))
      : { stored: false, reason: "insufficient_time_budget" };
    // La risposta originale dell'IA contiene evidenze diagnostiche riservate allo staff.
    // Non viene esposta al browser pubblico.
    const { _reader_trace: _privateReaderTrace, ...publicNormalized } = normalized;
    return json(res, 200, { ok: true, normalized: publicNormalized, archive });
  } catch (error) {
    const elapsedMs = Date.now() - requestStartedAt;
    const remainingMs = analysisDeadlineAt - Date.now();
    await recordAiEconomicCost({ outcome: "failed", error });
    let archive = { stored: false, reason: "not_attempted" };
    if (validPdf && temporaryFilePath && fileMetadata && remainingMs >= 7_000) {
      try {
        archive = await archivePdfAnalysis({
          filePath: temporaryFilePath,
          ...fileMetadata,
          error,
          context: archiveContext,
        });
      } catch (archiveError) {
        archive = { stored: false, reason: "archive_error" };
        console.error("[pdf-analysis-archive-error]", JSON.stringify({
          event: "pdf_analysis_archive_failed",
          stage: analysisStage,
          ingress_mode: ingressMode,
          filename: fileMetadata?.originalFilename || null,
          file_size: Number(fileMetadata?.fileSize || 0) || null,
          message: String(archiveError?.message || archiveError || "archive_error").slice(0, 500),
        }));
      }
    } else if (validPdf && temporaryFilePath && fileMetadata) {
      archive = { stored: false, reason: "insufficient_time_budget", remaining_ms: remainingMs };
    }

    const mapped = publicError(error);
    const diagnostic = classifyPdfAnalysisError(error);
    const logPayload = pdfAnalysisDiagnosticLog({
      error,
      publicCode: mapped.code,
      stage: analysisStage,
      ingressMode,
      fileMetadata,
      elapsedMs,
      remainingMs,
      archive,
    });
    console.error("[pdf-analysis-error]", JSON.stringify(logPayload));

    const { status, ...payload } = mapped;
    return json(res, status, {
      ok: false,
      ...payload,
      diagnostic_code: diagnostic.diagnosticCode,
      analysis_stage: analysisStage,
      ingress_mode: ingressMode,
      elapsed_ms: elapsedMs,
      archive,
    });
  } finally {
    if (directUploadTicket) await deletePdfDirectUpload(directUploadTicket).catch(() => {});
    if (temporaryFilePath) await fs.unlink(temporaryFilePath).catch(() => {});
  }
}
