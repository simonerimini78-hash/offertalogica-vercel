import fs from "node:fs/promises";
import formidable from "formidable";
import { json, method, requireAllowedOrigin } from "../lib/http.js";
import { extractPdfWithControlledOcr } from "../lib/pdfExtractWithOcr.js";
import { archivePdfAnalysis, pdfArchiveConfigured } from "../lib/pdfArchive.js";
import { createPdfAnalysisSession, publicPdfAnalysisSession, savePdfAnalysisSession } from "../lib/pdfAnalysisSessionStore.js";
import { formValue, parseJsonField, safeInteger, safePdfFilename, sessionErrorResponse } from "../lib/pdfAnalysisApi.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";

export const config = { api: { bodyParser: false } };

function parseForm(req) {
  const form = formidable({
    multiples: false,
    maxFiles: 1,
    maxFileSize: 4_000_000,
    maxTotalFileSize: 4_100_000,
    allowEmptyFiles: false,
    filter: (part) => !part.mimetype || ["application/pdf", "application/x-pdf", "application/octet-stream"].includes(part.mimetype),
  });
  return new Promise((resolve, reject) => form.parse(req, (error, fields, files) => error ? reject(error) : resolve({ fields, files })));
}

async function isRealPdf(filePath) {
  const bytes = await fs.readFile(filePath);
  return bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
}

function unknownBaseline({ filename, pageCount, originalBytes }) {
  return {
    parser_version: "step8-session-upload-v2",
    page_count: Number(pageCount || 0),
    diagnostics: [],
    kind: "unknown",
    commodity: "unknown",
    recognized: false,
    confidence: "low",
    warnings: ["pdf_raster_sessione_domande_singole", "verifica_utente_richiesta"],
    textExtracted: 0,
    needsReview: true,
    upload_transport: {
      mode: "client_page_by_page_high_quality",
      original_filename: filename,
      original_bytes: Number(originalBytes || 0),
      page_count: Number(pageCount || 0),
    },
  };
}

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedOrigin(req, res)) return;
  if (!(await enforceRateLimit(req, res, { label: "pdf-analysis-start", ...rateLimitConfig("PDF", 15) }))) return;
  let temporaryPath = "";
  try {
    const { fields, files } = await parseForm(req);
    const filename = safePdfFilename(fields.originalFilename || files.pdf?.originalFilename);
    const originalBytes = safeInteger(fields.originalSize, Number(files.pdf?.size || 0));
    const expectedPageCount = safeInteger(fields.pageCount, 0);
    const archiveContext = parseJsonField(fields.archiveContext, {});
    const pdf = Array.isArray(files.pdf) ? files.pdf[0] : files.pdf;
    let baseline = unknownBaseline({ filename, pageCount: expectedPageCount, originalBytes });
    let archive = { stored: false, reason: "raster_session_not_finalized" };

    if (pdf) {
      temporaryPath = pdf.filepath;
      if (!(await isRealPdf(temporaryPath))) return json(res, 415, { ok: false, error: "Il file caricato non è un PDF valido" });
      const deadlineAt = Date.now() + 48_000;
      baseline = await extractPdfWithControlledOcr(temporaryPath, { filename, deadlineAt });
      if (pdfArchiveConfigured()) {
        archive = await archivePdfAnalysis({
          filePath: temporaryPath,
          originalFilename: filename,
          mimeType: pdf.mimetype || "application/pdf",
          fileSize: Number(pdf.size || originalBytes),
          normalized: baseline,
          shadow: null,
          context: { ...archiveContext, archiveSource: "session_original_pdf" },
        }).catch(() => ({ stored: false, reason: "archive_error" }));
      }
    }

    const created = await createPdfAnalysisSession({
      filename,
      originalBytes,
      expectedPageCount,
      archiveContext,
      baseline,
    });
    created.session.archive = archive;
    const saved = await savePdfAnalysisSession(created.session);
    return json(res, 201, {
      ok: true,
      analysisId: saved.id,
      analysisToken: created.token,
      session: publicPdfAnalysisSession(saved),
      baseline: {
        parser_version: baseline.parser_version,
        recognized: Boolean(baseline.recognized),
        commodity: baseline.commodity || "unknown",
        page_count: Number(baseline.page_count || expectedPageCount || 0),
      },
    });
  } catch (error) {
    if (sessionErrorResponse(res, error) !== false) return;
    const tooLarge = /maxFileSize|maxTotalFileSize|too large/i.test(String(error?.message || ""));
    return json(res, tooLarge ? 413 : 400, { ok: false, error: tooLarge ? "PDF troppo grande per il caricamento diretto" : "Impossibile creare la sessione PDF" });
  } finally {
    if (temporaryPath) await fs.unlink(temporaryPath).catch(() => {});
  }
}
