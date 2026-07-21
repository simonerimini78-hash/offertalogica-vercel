import fs from "node:fs/promises";
import formidable from "formidable";
import { json, method, requireAllowedOrigin } from "../lib/http.js";
import { extractPdfWithControlledOcr } from "../lib/pdfExtractWithOcr.js";
import {
  applyControlledPdfAiFallback,
  applyControlledPdfAiImageFallback,
} from "../lib/pdfAiPipeline.js";
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
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const ACCEPTED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_RASTER_PAGES = 8;
const MAX_RASTER_TOTAL_BYTES = 4_050_000;
const MAX_RASTER_PAGE_BYTES = 2_500_000;

function parseForm(req) {
  const maxFileSize = Number(process.env.MAX_PDF_BYTES || 8_000_000);
  const form = formidable({
    multiples: true,
    maxFiles: MAX_RASTER_PAGES,
    maxFileSize: Math.max(maxFileSize, MAX_RASTER_PAGE_BYTES),
    maxTotalFileSize: Math.max(maxFileSize, MAX_RASTER_TOTAL_BYTES),
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

function safeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(fieldValue(value) || ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeFilename(value) {
  const raw = String(fieldValue(value) || "documento.pdf").split(/[\\/]/).pop() || "documento.pdf";
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) || "documento.pdf";
}

function rasterFilesFromForm(files = {}) {
  const raw = files.pages || files.page || [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((file) => file && ACCEPTED_IMAGE_MIME_TYPES.has(file.mimetype || ""))
    .sort((a, b) => String(a.originalFilename || "").localeCompare(String(b.originalFilename || "")));
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

async function validImageSignature(file) {
  const bytes = await fs.readFile(file.filepath);
  if (bytes.length < 12) return false;
  const mime = String(file.mimetype || "");
  if (mime === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8
      && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  }
  if (mime === "image/png") {
    return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mime === "image/webp") {
    return bytes.subarray(0, 4).toString("ascii") === "RIFF"
      && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

function unknownRasterBaseline({ filename, pageCount, originalBytes, rasterBytes }) {
  return {
    parser_version: "v106.2-client-raster-transport-1",
    page_count: pageCount,
    diagnostics: [],
    kind: "unknown",
    commodity: "unknown",
    recognized: false,
    confidence: "low",
    warnings: ["pdf_grande_rasterizzato_nel_browser", "ai_verifica_utente_richiesta"],
    textExtracted: 0,
    needsReview: true,
    upload_transport: {
      mode: "client_rasterized_pdf_pages",
      original_filename: filename,
      original_bytes: originalBytes,
      raster_bytes: rasterBytes,
      page_count: pageCount,
    },
  };
}

function publicError(error) {
  const message = String(error?.message || "");
  if (/maxFileSize|maxTotalFileSize|max file size|too large/i.test(message)) {
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

  const temporaryFilePaths = [];
  let pdfFilePath = "";
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

    const rasterFiles = rasterFilesFromForm(files);
    if (rasterFiles.length) {
      if (rasterFiles.length > MAX_RASTER_PAGES) {
        return json(res, 413, { ok: false, error: "Troppe pagine nel PDF fotografico" });
      }
      temporaryFilePaths.push(...rasterFiles.map((file) => file.filepath));
      const validity = await Promise.all(rasterFiles.map(validImageSignature));
      if (validity.some((valid) => !valid)) {
        return json(res, 415, { ok: false, error: "Una pagina raster non è valida" });
      }

      const filename = safeFilename(fields.originalFilename);
      const originalBytes = safeInteger(fields.originalSize, 0);
      const rasterBytes = rasterFiles.reduce((sum, file) => sum + Number(file.size || 0), 0);
      if (rasterBytes > MAX_RASTER_TOTAL_BYTES) {
        return json(res, 413, { ok: false, error: "PDF fotografico ancora troppo grande" });
      }
      const imageFiles = rasterFiles.map((file, index) => ({
        filePath: file.filepath,
        mimeType: file.mimetype || "image/jpeg",
        page: index + 1,
      }));
      const baseline = unknownRasterBaseline({
        filename,
        pageCount: imageFiles.length,
        originalBytes,
        rasterBytes,
      });
      const normalized = await applyControlledPdfAiImageFallback(imageFiles, {
        filename,
        normalized: baseline,
        deadlineAt: analysisDeadlineAt,
      });
      return json(res, 200, {
        ok: true,
        normalized,
        archive: { stored: false, reason: "client_raster_transport" },
      });
    }

    const file = Array.isArray(files.pdf) ? files.pdf[0] : files.pdf;
    if (!file) return json(res, 400, { ok: false, error: "PDF mancante o formato non accettato" });

    pdfFilePath = file.filepath;
    temporaryFilePaths.push(pdfFilePath);
    fileMetadata = {
      originalFilename: file.originalFilename || file.newFilename || "documento.pdf",
      mimeType: file.mimetype || "application/pdf",
      fileSize: Number(file.size || 0),
    };
    if (!(await isRealPdf(pdfFilePath))) {
      return json(res, 415, { ok: false, error: "Il file caricato non è un PDF valido" });
    }
    validPdf = true;

    const ocrNormalized = await extractPdfWithControlledOcr(pdfFilePath, {
      filename: fileMetadata.originalFilename,
      deadlineAt: analysisDeadlineAt,
    });
    const normalized = await applyControlledPdfAiFallback(pdfFilePath, {
      filename: fileMetadata.originalFilename,
      normalized: ocrNormalized,
      deadlineAt: analysisDeadlineAt,
    });
    const canRunShadow = analysisDeadlineAt - Date.now() >= 3_000;
    const shadow = canRunShadow
      ? await runPdfReaderShadow({
        filePath: pdfFilePath,
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
      filePath: pdfFilePath,
      ...fileMetadata,
      normalized,
      shadow,
      context: archiveContext,
    }).catch(() => ({ stored: false, reason: "archive_error" }));
    return json(res, 200, { ok: true, normalized, archive });
  } catch (error) {
    if (validPdf && pdfFilePath && fileMetadata) {
      await archivePdfAnalysis({
        filePath: pdfFilePath,
        ...fileMetadata,
        normalized: null,
        shadow: null,
        context: archiveContext,
      }).catch(() => {});
    }
    const mapped = publicError(error);
    return json(res, mapped.status, { ok: false, error: mapped.error });
  } finally {
    await Promise.all(temporaryFilePaths.map((filePath) => fs.unlink(filePath).catch(() => {})));
  }
}
