import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import formidable from "formidable";
import { json, method, requireAllowedBrowserOrigin } from "../lib/http.js";
import { extractBillPhotoPureAi, extractPdfPureAi, PDF_PURE_AI_DEFAULT_MODEL } from "../lib/pdfPureAiReader.js";
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
import { persistAnalyticsEvent } from "../lib/customerDb.js";

export const config = {
  api: { bodyParser: false },
};

const PDF_INGRESS_VERSION = "pdf-ingress-v1.0.3";
const JSON_BODY_LIMIT = 64_000;
const ACCEPTED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/octet-stream",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function envPositiveInteger(name, fallback, { min = 1, max = 100_000 } = {}) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function pdfAiKillSwitchEnabled() {
  return String(process.env.PDF_AI_KILL_SWITCH || "").trim().toLowerCase() === "true";
}

async function enforcePdfAiGlobalGuards(req, res) {
  const hourlyLimit = envPositiveInteger("PDF_AI_GLOBAL_HOURLY_LIMIT", 120, { max: 20_000 });
  if (!(await enforceRateLimit(req, res, {
    label: "analyze-pdf-global-hour",
    identifier: "site-pdf-ai-global",
    limit: hourlyLimit,
    windowSeconds: 3600,
  }))) return false;

  const dailyLimit = envPositiveInteger("PDF_AI_GLOBAL_DAILY_LIMIT", 600, { max: 100_000 });
  if (!(await enforceRateLimit(req, res, {
    label: "analyze-pdf-global-day",
    identifier: "site-pdf-ai-global",
    limit: dailyLimit,
    windowSeconds: 86400,
  }))) return false;

  return true;
}

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

function normalizedPhotoSource(value) {
  const source = String(fieldValue(value) || "").trim().toLowerCase();
  return ["camera", "gallery"].includes(source) ? source : "upload";
}

// Diagnostica del lettore FOTO del CALCOLATORE PUBBLICO. Nessun flusso Premium.
// Allowlist: soltanto quantità/costi tecnici e codici chiusi; niente OCR, etichette
// originali, evidenze libere, documenti, nominativi, POD/PDR o indirizzi.
const PHOTO_TECHNICAL_NUMBERS = Object.freeze([
  "total_amount_eur", "consumo_luce_kwh", "consumo_periodo_luce_kwh",
  "consumo_luce_f1_kwh", "consumo_luce_f2_kwh", "consumo_luce_f3_kwh", "consumo_luce_f23_kwh",
  "consumo_gas_smc", "consumo_periodo_gas_smc", "consumo_gas_mc",
  "consumo_periodo_gas_mc", "coefficiente_conversione_gas_c", "potenza_impegnata_kw",
  "prezzo_luce_eur_kwh", "prezzo_gas_eur_smc",
  "quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno",
  "prezzo_vendita_bolletta_luce_eur_kwh", "prezzo_vendita_bolletta_gas_eur_smc",
]);
const PHOTO_TECHNICAL_DATES = Object.freeze([
  "billing_period_start", "billing_period_end", "issue_date", "due_date",
]);
const PHOTO_SAFE_STAGES = new Set(["request_received", "json_body", "validate_photo", "openai_photo_analysis", "archive_success"]);
function photoFinite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= 100_000_000 ? number : null;
}
function photoSlug(value, max = 90) {
  const candidate = String(value || "").trim().toLowerCase();
  return /^[a-z0-9_:-]{1,90}$/.test(candidate) ? candidate.slice(0, max) : "";
}
function photoMissingEssentials(normalized = {}) {
  const groups = [];
  for (const [commodity, suffix] of [["electricity", "luce"], ["gas", "gas"]]) {
    if (![commodity, suffix, "dual"].includes(normalized?.commodity)) continue;
    const fields = [
      ["annual_consumption", suffix === "luce" ? "consumo_luce_kwh" : "consumo_gas_smc"],
      ["unit_price", suffix === "luce" ? "prezzo_luce_eur_kwh" : "prezzo_gas_eur_smc"],
      ["fixed_fee", `quota_fissa_vendita_${suffix}_eur_anno`],
    ].filter(([,field]) => photoFinite(normalized?.[field]) === null).map(([key]) => key);
    if (fields.length) groups.push({ commodity, fields });
  }
  return groups;
}
function photoMissingCode(normalized, suffix, field) {
  const value = photoFinite(normalized?.[field]);
  if (value !== null) return "present";
  // Vedere lib/pdfPureAiReader.js: in bolletta prezzo/quota fissa vengono
  // eliminati se la sottovoce VENDITA dello Scontrino non è riconciliata.
  if (normalized?.kind === "bolletta" && /^(?:prezzo_|quota_fissa_vendita_)/.test(field)) {
    const receiptRows = Array.isArray(normalized?.receipt_rows) ? normalized.receipt_rows : [];
    const count = receiptRows.filter(row => row?.commodity === suffix).length;
    return count ? "scontrino_vendita_non_riconciliato" : "scontrino_vendita_non_estratto";
  }
  return "dato_assente_o_non_validato";
}
function publicPhotoDiagnosticPayload(normalized = null, { attemptId, inputSource, elapsedMs, stage, diagnosticCode } = {}) {
  const data = normalized && typeof normalized === "object" ? normalized : {};
  const ai = data.ai && typeof data.ai === "object" ? data.ai : {};
  const numbers = {};
  for (const key of PHOTO_TECHNICAL_NUMBERS) numbers[key] = photoFinite(data[key]);
  const dates = {};
  for (const key of PHOTO_TECHNICAL_DATES) {
    const value = String(data[key] || "");
    dates[key] = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  }
  const missing = photoMissingEssentials(data);
  const missingReasons = missing.flatMap(group => group.fields.map(field => {
    const suffix = group.commodity === "electricity" ? "luce" : "gas";
    const key = field === "annual_consumption"
      ? (suffix === "luce" ? "consumo_luce_kwh" : "consumo_gas_smc")
      : field === "unit_price" ? `prezzo_${suffix}_eur_${suffix === "luce" ? "kwh" : "smc"}`
        : `quota_fissa_vendita_${suffix}_eur_anno`;
    return { commodity: group.commodity, field, reason: photoMissingCode(data, suffix, key) };
  }));
  const normalizeMissing = value => (Array.isArray(value) ? value : []).slice(0,2).map(group => ({
    commodity: ["gas", "electricity"].includes(group?.commodity) ? group.commodity : "unknown",
    fields: (Array.isArray(group?.fields) ? group.fields : []).filter(field => ["annual_consumption", "unit_price", "fixed_fee"].includes(field)),
  }));
  const charges = ["luce", "gas"].flatMap(suffix =>
    (Array.isArray(data[`bill_breakdown_${suffix}`]) ? data[`bill_breakdown_${suffix}`] : []).slice(0, 32)
      .map(row => ({ commodity: suffix, category: photoSlug(row?.category, 50), amount_eur: photoFinite(row?.amount_eur), page: photoFinite(row?.page) }))
      .filter(row => row.category && row.amount_eur !== null)
  );
  const receiptRows = (Array.isArray(data.receipt_rows) ? data.receipt_rows : []).slice(0, 32).map(row => {
    const label = String(row?.label || "").toLowerCase(); // Used only on server, NEVER persisted.
    const unitText = String(row?.unit_price || "").toLowerCase();
    const quantityText = String(row?.quantity || "").trim();
    const numberPrefix = value => {
      const matched = String(value || "").trim().match(/^(-?\d{1,8}(?:[.,]\d{1,8})?)/);
      return matched ? photoFinite(matched[1].replace(",", ".")) : null;
    };
    const safeSection = ["consumi", "fissa_potenza", "altre_partite", "accise_iva", "totale_bolletta", "canone_tv", "totale_pagare"].includes(row?.section) ? row.section : "other";
    const priceUnit = /(?:\/\s*(?:mese|mes|month)|€\s*\/\s*mes)/i.test(unitText) ? "eur_month"
      : /\/\s*(?:anno|year)/i.test(unitText) ? "eur_year"
      : /\/\s*kwh/i.test(unitText) ? "eur_kwh"
      : /\/\s*(?:smc|mc)/i.test(unitText) ? "eur_volume"
      : /\/\s*kw/i.test(unitText) ? "eur_kw" : "unknown";
    return {
      commodity: row?.commodity === "luce" ? "luce" : row?.commodity === "gas" ? "gas" : "unknown",
      section: safeSection,
      kind: ["section", "subtotal", "detail", "total"].includes(row?.kind) ? row.kind : "unknown",
      salesSubitemDetected: /di cui.*(?:spes[ae].*vendita|vendita.*energi|commercializzazion)/i.test(label),
      quantityNumber: numberPrefix(quantityText), unitPriceNumber: numberPrefix(unitText), priceUnit,
      amountEur: photoFinite(row?.amount_eur), page: photoFinite(row?.page),
    };
  });
  const comparisonReasons = Object.fromEntries(["luce", "gas"].map(suffix => [suffix, {
    precision: ["alta", "limitata", "nessuna", "unknown"].includes(data[`precisione_confronto_${suffix}`]) ? data[`precisione_confronto_${suffix}`] : "unknown",
    reasonCodes: (Array.isArray(data[`motivi_precisione_confronto_${suffix}`]) ? data[`motivi_precisione_confronto_${suffix}`] : []).filter(code => /^[a-z0-9_:-]{1,65}$/i.test(String(code))).slice(0, 8),
    source: ["prezzo_storico_scontrino_vendita", "unavailable"].includes(data[`normalizzazione_prezzo_${suffix}`]?.source)
      ? data[`normalizzazione_prezzo_${suffix}`].source : "unknown",
  }]));
  const safeEnums = (value, allowed) => allowed.includes(String(value || "")) ? String(value) : "unknown";
  return {
    photoDiagnosticVersion: "public-photo-v1",
    photoAttemptId: /^[a-f0-9-]{36}$/i.test(String(attemptId || "")) ? String(attemptId).toLowerCase() : "",
    inputSource: ["camera", "gallery"].includes(inputSource) ? inputSource : "upload",
    analysisStatus: normalized ? (data.recognized ? (missing.length ? "success_missing_data" : "success") : "unreadable") : "failed",
    analysisStage: PHOTO_SAFE_STAGES.has(stage) ? stage : "photo_analysis_failed",
    diagnosticCode: photoSlug(diagnosticCode),
    photoReader: {
      parserVersion: photoSlug(data.parser_version),
      documentKind: safeEnums(data.kind, ["bolletta", "offerta", "unknown"]),
      commodity: safeEnums(data.commodity, ["luce", "gas", "dual", "unknown"]),
      readerConfidence: safeEnums(data.confidence, ["high", "medium", "low"]),
      openaiAttempts: Math.min(2, Math.max(0, Number(ai.openai_attempts || 0))),
      recoveryAttempted: ai.recovery_attempted === true,
      recoveryAccepted: Boolean(ai.recovered_from),
      recoveryError: ["photo_recovery_no_improvement", "photo_recovery_failed", "essential_recovery_no_improvement", "essential_recovery_failed", "essential_recovery_insufficient_time_budget"].includes(String(ai.recovery_error || ""))
        ? String(ai.recovery_error) : ai.recovery_error ? /timeout|deadline/i.test(String(ai.recovery_error)) ? "recovery_timeout" : "recovery_error" : "",
      missingBefore: normalizeMissing(ai.essential_missing_before),
      missingAfter: normalizeMissing(ai.essential_missing_after),
      missingFinal: missing,
      missingReasons,
      receiptRowsLuce: (Array.isArray(data.receipt_rows) ? data.receipt_rows : []).filter(row => row?.commodity === "luce").length,
      receiptRowsGas: (Array.isArray(data.receipt_rows) ? data.receipt_rows : []).filter(row => row?.commodity === "gas").length,
      numbers, dates, charges, receiptRows, comparisonReasons,
      priceTypeLuce: safeEnums(data.tipo_prezzo_luce, ["fisso", "variabile"]),
      priceTypeGas: safeEnums(data.tipo_prezzo_gas, ["fisso", "variabile"]),
      elapsedMs: Math.max(0, Math.min(120_000, Number(elapsedMs || 0))),
    },
  };
}

function publicError(error) {
  const message = String(error?.message || "");
  if (/bill_photo_unsupported_mime|bill_photo_empty|bill_photo_file_path_required/.test(message)) {
    return { status: 415, code: "PHOTO_INVALID", error: "Foto non leggibile o formato non supportato" };
  }
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
  if (!requireAllowedBrowserOrigin(req, res)) return;
  if (pdfAiKillSwitchEnabled()) {
    res.setHeader("Retry-After", "300");
    return json(res, 503, { ok: false, code: "AI_TEMPORARILY_DISABLED", error: "Servizio IA temporaneamente non disponibile" });
  }

  let temporaryFilePath = "";
  let directUploadTicket = "";
  let fileMetadata = null;
  let archiveContext = {};
  let validPdf = false;
  let inputKind = "pdf";
  let photoSource = "";
  let ingressMode = "vercel_multipart";
  let pdfHeader = { valid: false, sanitized: false, bytesRemoved: 0, fileSize: null };
  let analysisStage = "request_received";
  const requestStartedAt = Date.now();
  // La Function ha maxDuration 60 s: l'IA deve lasciare margine a
  // contabilizzazione, archivio, risposta HTTP e pulizie.
  const configuredDeadlineMs = Number.parseInt(process.env.PDF_ANALYSIS_DEADLINE_MS || "48000", 10);
  const analysisDeadlineMs = Number.isFinite(configuredDeadlineMs)
    ? Math.max(24_000, Math.min(48_000, configuredDeadlineMs))
    : 48_000;
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
        inputKind,
        outcome,
        ingressMode,
        analysisStage,
        elapsedMs: Date.now() - requestStartedAt,
        errorCode: error ? String(error?.code || error?.name || error?.message || "pdf_analysis_error").slice(0, 120) : "",
        source: archiveContext?.source || "",
        toolCode: archiveContext?.source === "simulator" ? "simulatore_bolletta" : "",
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
          requestTimeoutMs: 8_000,
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
        requestTimeoutMs: 8_000,
      });
      ingressMode = "supabase_signed_upload";
    } else {
      if (!(await enforceRateLimit(req, res, { label: "analyze-pdf", ...rateLimitConfig("PDF", 15) }))) return;
      analysisStage = "parse_multipart";
      const { fields, files } = await parseForm(req);
      archiveContext = parseArchiveContext(fields);
      const photo = Array.isArray(files.photo) ? files.photo[0] : files.photo;
      const pdf = Array.isArray(files.pdf) ? files.pdf[0] : files.pdf;
      const file = photo || pdf;
      if (!file) return json(res, 400, { ok: false, error: "Documento mancante o formato non accettato" });

      temporaryFilePath = file.filepath;
      fileMetadata = {
        originalFilename: file.originalFilename || file.newFilename || (photo ? "foto-bolletta.jpg" : "documento.pdf"),
        mimeType: file.mimetype || (photo ? "image/jpeg" : "application/pdf"),
        fileSize: Number(file.size || 0),
      };
      inputKind = photo || PHOTO_MIME_TYPES.has(fileMetadata.mimeType) ? "photo" : "pdf";
      if (inputKind === "photo") {
        photoSource = normalizedPhotoSource(fields.inputSource);
        ingressMode = `photo_${photoSource}`;
      }
    }

    if (inputKind === "pdf") {
      analysisStage = "validate_pdf";
      pdfHeader = await normalizePdfFileHeader(temporaryFilePath);
      if (!pdfHeader.valid) {
        return json(res, 415, { ok: false, code: "PDF_INVALID", error: "Il file caricato non è un PDF valido" });
      }
      if (pdfHeader.sanitized && fileMetadata) fileMetadata.fileSize = pdfHeader.fileSize;
      validPdf = true;
    } else {
      analysisStage = "validate_photo";
      if (!PHOTO_MIME_TYPES.has(String(fileMetadata?.mimeType || "").toLowerCase())) {
        return json(res, 415, { ok: false, code: "PHOTO_INVALID", error: "Foto non leggibile o formato non supportato" });
      }
    }

    if (!(await enforcePdfAiGlobalGuards(req, res))) return;
    analysisStage = inputKind === "photo" ? "openai_photo_analysis" : "openai_analysis";
    const normalized = inputKind === "photo"
      ? await extractBillPhotoPureAi({
        filePath: temporaryFilePath,
        mimeType: fileMetadata.mimeType,
        deadlineAt: analysisDeadlineAt,
        transport: aiUsageMeter.transport,
        model: aiModel,
      })
      : await extractPdfPureAi({
        filePath: temporaryFilePath,
        filename: fileMetadata.originalFilename,
        deadlineAt: analysisDeadlineAt,
        transport: aiUsageMeter.transport,
        model: aiModel,
      });
    normalized.ai = {
      ...(normalized.ai || {}),
      input_kind: inputKind,
      input_source: inputKind === "photo" ? photoSource : "pdf",
      ingress_mode: ingressMode,
      ingress_version: inputKind === "photo" ? "bill-photo-ingress-v1" : PDF_INGRESS_VERSION,
      pdf_header_normalized: inputKind === "pdf" ? Boolean(pdfHeader.sanitized) : false,
      leading_bytes_removed: inputKind === "pdf" ? Number(pdfHeader.bytesRemoved || 0) : 0,
    };
    await recordAiEconomicCost({ outcome: "success", normalized });
    analysisStage = "archive_success";
    const canArchive = inputKind === "pdf" && analysisDeadlineAt - Date.now() >= 7_000;
    const archive = inputKind === "photo"
      ? { stored: false, reason: "photo_not_archived" }
      : canArchive
        ? await archivePdfAnalysis({
          filePath: temporaryFilePath,
          ...fileMetadata,
          normalized,
          context: archiveContext,
          requestTimeoutMs: 2_500,
        }).catch((archiveError) => ({
          stored: false,
          reason: /timeout/i.test(String(archiveError?.message || "")) ? "archive_timeout" : "archive_error",
        }))
        : { stored: false, reason: "insufficient_time_budget" };
    // Salva SOLO il risultato tecnico anonimizzato della foto dal server.
    // Il risultato non dipende dalla consegna dell'evento nel browser; non archiviamo la foto.
    let photoDiagnosticStored = null;
    if (inputKind === "photo" && archiveContext?.origin === "public_calculator" && /^[a-z0-9-]{16,90}$/i.test(String(archiveContext.sessionId || ""))) {
      const result = await persistAnalyticsEvent({
        eventType: "bill_photo_server_diagnostic",
        sessionId: String(archiveContext.sessionId).slice(0,90),
        page: "/", customerType: normalized.customer_type || "privato",
        dataOrigin: "pdf_upload", source: "public_photo_reader",
        payload: publicPhotoDiagnosticPayload(normalized, {
          attemptId: archiveContext.attemptId, inputSource: photoSource,
          elapsedMs: Date.now() - requestStartedAt, stage: analysisStage,
        }),
      });
      photoDiagnosticStored = Boolean(result.ok && !result.skipped);
      if (!photoDiagnosticStored) console.warn("photo_diagnostic_not_stored", String(result.reason || result.error || "unknown").slice(0,80));
    }
    // La risposta originale dell'IA contiene evidenze diagnostiche riservate allo staff.
    // Non viene esposta al browser pubblico.
    const { _reader_trace: _privateReaderTrace, ...publicNormalized } = normalized;
    return json(res, 200, { ok: true, inputKind, inputSource: inputKind === "photo" ? photoSource : "pdf", normalized: publicNormalized, archive,
      ...(inputKind === "photo" && archiveContext?.origin === "public_calculator" ? { photoDiagnosticStored } : {}),
    });
  } catch (error) {
    const elapsedMs = Date.now() - requestStartedAt;
    const remainingMs = analysisDeadlineAt - Date.now();
    await recordAiEconomicCost({ outcome: "failed", error });
    let archive = { stored: false, reason: "not_attempted" };
    if (inputKind === "pdf" && validPdf && temporaryFilePath && fileMetadata && remainingMs >= 7_000) {
      try {
        archive = await archivePdfAnalysis({
          filePath: temporaryFilePath,
          ...fileMetadata,
          error,
          context: archiveContext,
          requestTimeoutMs: 2_500,
        });
      } catch (archiveError) {
        archive = {
          stored: false,
          reason: /timeout/i.test(String(archiveError?.message || "")) ? "archive_timeout" : "archive_error",
        };
        console.error("[pdf-analysis-archive-error]", JSON.stringify({
          event: "pdf_analysis_archive_failed",
          stage: analysisStage,
          ingress_mode: ingressMode,
          filename: fileMetadata?.originalFilename || null,
          file_size: Number(fileMetadata?.fileSize || 0) || null,
          message: String(archiveError?.message || archiveError || "archive_error").slice(0, 500),
        }));
      }
    } else if (inputKind === "pdf" && validPdf && temporaryFilePath && fileMetadata) {
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

    if (inputKind === "photo" && archiveContext?.origin === "public_calculator" && /^[a-z0-9-]{16,90}$/i.test(String(archiveContext.sessionId || ""))) {
      await persistAnalyticsEvent({
        eventType: "bill_photo_server_diagnostic",
        sessionId: String(archiveContext.sessionId).slice(0,90), page: "/",
        customerType: archiveContext.customerType === "business" ? "business" : "privato",
        dataOrigin: "pdf_upload", source: "public_photo_reader",
        payload: publicPhotoDiagnosticPayload(null, {
          attemptId: archiveContext.attemptId, inputSource: photoSource,
          elapsedMs, stage: analysisStage, diagnosticCode: diagnostic.diagnosticCode,
        }),
      }).catch(() => {});
    }
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
    if (directUploadTicket) await deletePdfDirectUpload(directUploadTicket, { requestTimeoutMs: 2_000 }).catch(() => {});
    if (temporaryFilePath) await fs.unlink(temporaryFilePath).catch(() => {});
  }
}
