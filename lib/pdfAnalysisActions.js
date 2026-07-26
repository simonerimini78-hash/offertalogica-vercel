import fs from "node:fs/promises";
import formidable from "formidable";
import { json, method, requireAllowedOrigin } from "./http.js";
import { defaultPdfQuestionTransport } from "./pdfAiQuestionSession.js";
import { pdfAiConfig } from "./pdfAiConfig.js";
import { indexUploadedPdfPage } from "./pdfAiPageIndex.js";
import { readPdfFieldQuestion } from "./pdfAiFieldQuestion.js";
import { extractPdfWithControlledOcr } from "./pdfExtractWithOcr.js";
import { archivePdfAnalysis, pdfArchiveConfigured, updatePdfAnalysisRuntime } from "./pdfArchive.js";
import { deleteOpenAiSessionFiles } from "./pdfAnalysisCleanup.js";
import { buildPdfAnalysisPlan, publicPdfAnalysisPlan } from "./pdfAnalysisPlan.js";
import {
  createPdfAnalysisSession,
  deletePdfAnalysisSession,
  publicPdfAnalysisSession,
  readPdfAnalysisSession,
  savePdfAnalysisSession,
} from "./pdfAnalysisSessionStore.js";
import {
  formValue,
  parseJsonField,
  safeInteger,
  safePdfFilename,
  authorizedSessionFromJson,
  sessionErrorResponse,
} from "./pdfAnalysisApi.js";
import { mergePdfAiQuestionSession } from "./pdfAiQuestionMerge.js";
import { enforceRateLimit, rateLimitConfig } from "./rateLimit.js";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PDF_TYPES = new Set(["application/pdf", "application/x-pdf", "application/octet-stream"]);
const ALLOWED_ACTIONS = new Set(["start", "page", "commit", "question", "status", "finalize", "cancel"]);

function queryAction(req) {
  const direct = Array.isArray(req?.query?.action) ? req.query.action[0] : req?.query?.action;
  if (direct) return String(direct).trim().toLowerCase();
  try {
    const url = new URL(req.url || "", "http://localhost");
    return String(url.searchParams.get("action") || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

export function pdfAnalysisAction(req) {
  const action = queryAction(req);
  return ALLOWED_ACTIONS.has(action) ? action : "";
}

function parseMultipart(req, options) {
  const form = formidable(options);
  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => error ? reject(error) : resolve({ fields, files }));
  });
}

function parseStartForm(req) {
  return parseMultipart(req, {
    multiples: false,
    maxFiles: 1,
    maxFileSize: 4_000_000,
    maxTotalFileSize: 4_100_000,
    allowEmptyFiles: false,
    filter: (part) => !part.mimetype || PDF_TYPES.has(part.mimetype),
  });
}

function parsePageForm(req) {
  return parseMultipart(req, {
    multiples: false,
    maxFiles: 1,
    maxFileSize: 3_700_000,
    maxTotalFileSize: 3_800_000,
    allowEmptyFiles: false,
    filter: (part) => IMAGE_TYPES.has(part.mimetype || ""),
  });
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

async function validImage(file) {
  const bytes = await fs.readFile(file.filepath);
  if (bytes.length < 12) return false;
  if (file.mimetype === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8
      && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  }
  if (file.mimetype === "image/png") {
    return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (file.mimetype === "image/webp") {
    return bytes.subarray(0, 4).toString("ascii") === "RIFF"
      && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

function unknownBaseline({ filename, pageCount, originalBytes }) {
  return {
    parser_version: "step8-session-upload-v2-1-single-api",
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

async function useRateLimit(req, res, label, prefix, fallback) {
  return enforceRateLimit(req, res, { label, ...rateLimitConfig(prefix, fallback) });
}

async function handleStart(req, res) {
  if (!(await useRateLimit(req, res, "pdf-analysis-start", "PDF", 15))) return;
  let temporaryPath = "";
  try {
    const { fields, files } = await parseStartForm(req);
    const pdf = Array.isArray(files.pdf) ? files.pdf[0] : files.pdf;
    const filename = safePdfFilename(fields.originalFilename || pdf?.originalFilename);
    const originalBytes = safeInteger(fields.originalSize, Number(pdf?.size || 0));
    const expectedPageCount = safeInteger(fields.pageCount, 0);
    const archiveContext = parseJsonField(fields.archiveContext, {});
    let baseline = unknownBaseline({ filename, pageCount: expectedPageCount, originalBytes });
    let archive = { stored: false, reason: "raster_session_not_finalized" };

    if (pdf) {
      temporaryPath = pdf.filepath;
      if (!(await isRealPdf(temporaryPath))) return json(res, 415, { ok: false, error: "Il file caricato non è un PDF valido" });
      baseline = await extractPdfWithControlledOcr(temporaryPath, { filename, deadlineAt: Date.now() + 48_000 });
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

    const created = await createPdfAnalysisSession({ filename, originalBytes, expectedPageCount, archiveContext, baseline });
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

async function handlePage(req, res) {
  if (!(await useRateLimit(req, res, "pdf-analysis-page", "PDF_PAGE", 160))) return;
  let temporaryPath = "";
  let uploadedFileId = "";
  try {
    const { fields, files } = await parsePageForm(req);
    const analysisId = String(formValue(fields.analysisId) || "").trim();
    const analysisToken = String(formValue(fields.analysisToken) || "").trim();
    const pageNumber = safeInteger(fields.pageNumber, 0);
    if (!analysisId || !analysisToken || pageNumber < 1) return json(res, 400, { ok: false, error: "Dati pagina mancanti" });
    let session = await readPdfAnalysisSession(analysisId, analysisToken);
    if (!["uploading", "ready"].includes(session.status)) return json(res, 409, { ok: false, error: "La sessione non accetta altre pagine" });
    const pageFile = Array.isArray(files.page) ? files.page[0] : files.page;
    if (!pageFile) return json(res, 400, { ok: false, error: "Pagina mancante" });
    temporaryPath = pageFile.filepath;
    if (!(await validImage(pageFile))) return json(res, 415, { ok: false, error: "Pagina immagine non valida" });
    if ((session.pages || []).some((item) => Number(item.page) === pageNumber)) {
      return json(res, 409, { ok: false, error: "Pagina già caricata" });
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return json(res, 503, { ok: false, error: "Lettore IA non configurato" });
    const configAi = pdfAiConfig();
    const extension = pageFile.mimetype === "image/png" ? "png" : pageFile.mimetype === "image/webp" ? "webp" : "jpg";
    const uploaded = await defaultPdfQuestionTransport.uploadFile({
      filePath: temporaryPath,
      filename: `pagina-${String(pageNumber).padStart(3, "0")}.${extension}`,
      mimeType: pageFile.mimetype,
      purpose: "vision",
      apiKey,
    });
    uploadedFileId = uploaded?.id || "";
    if (!uploadedFileId) throw new Error("openai_page_upload_failed");
    const index = await indexUploadedPdfPage({ fileId: uploadedFileId, page: pageNumber, apiKey, model: configAi.criticalModel });
    session.pages = [...(session.pages || []), {
      page: pageNumber,
      file_id: uploadedFileId,
      mime_type: pageFile.mimetype,
      bytes: Number(pageFile.size || 0),
      index,
    }].sort((a, b) => a.page - b.page);
    session.status = "uploading";
    session = await savePdfAnalysisSession(session);
    uploadedFileId = "";
    return json(res, 201, { ok: true, page: { page: pageNumber, index }, session: publicPdfAnalysisSession(session) });
  } catch (error) {
    if (uploadedFileId) await defaultPdfQuestionTransport.deleteFile({ fileId: uploadedFileId, apiKey: process.env.OPENAI_API_KEY }).catch(() => {});
    if (sessionErrorResponse(res, error) !== false) return;
    const tooLarge = /maxFileSize|maxTotalFileSize|too large/i.test(String(error?.message || ""));
    return json(res, tooLarge ? 413 : 400, { ok: false, error: tooLarge ? "Pagina troppo grande" : "Caricamento pagina non riuscito" });
  } finally {
    if (temporaryPath) await fs.unlink(temporaryPath).catch(() => {});
  }
}

async function handleCommit(req, res) {
  if (!(await useRateLimit(req, res, "pdf-analysis-commit", "PDF", 30))) return;
  try {
    const { session: loaded } = await authorizedSessionFromJson(req);
    let session = loaded;
    const expected = Number(session.expected_page_count || 0);
    const uploaded = Array.isArray(session.pages) ? session.pages.length : 0;
    if (!uploaded) return json(res, 409, { ok: false, error: "Nessuna pagina caricata" });
    if (expected && uploaded !== expected) return json(res, 409, { ok: false, error: `Pagine caricate ${uploaded}/${expected}` });
    const baseline = session.baseline || {};
    session.plan = buildPdfAnalysisPlan({ baseline, commodity: baseline.commodity || "unknown" });
    session.status = "ready";
    session = await savePdfAnalysisSession(session);
    return json(res, 200, {
      ok: true,
      session: publicPdfAnalysisSession(session),
      planVersion: "step8-question-plan-v2-1-single-api",
      plan: publicPdfAnalysisPlan(session.plan),
    });
  } catch (error) {
    if (sessionErrorResponse(res, error) !== false) return;
    return json(res, 400, { ok: false, error: "Impossibile preparare le domande PDF" });
  }
}

function acceptedCommodity(session) {
  const value = session.answers?.document_commodity?.result?.normalizedValue;
  return ["luce", "gas", "dual"].includes(value) ? value : session.baseline?.commodity || "unknown";
}

async function handleQuestion(req, res) {
  if (!(await useRateLimit(req, res, "pdf-analysis-question", "PDF_QUESTION", 400))) return;
  try {
    const { body, session: loaded } = await authorizedSessionFromJson(req);
    let session = loaded;
    if (!["ready", "questioning"].includes(session.status)) return json(res, 409, { ok: false, error: "Sessione PDF non pronta per le domande" });
    const questionId = String(body.questionId || "").trim();
    const planItem = (session.plan || []).find((item) => item.id === questionId);
    if (!planItem) return json(res, 404, { ok: false, error: "Domanda PDF non prevista" });
    if (session.answers?.[questionId]) {
      return json(res, 200, { ok: true, cached: true, answer: session.answers[questionId], session: publicPdfAnalysisSession(session) });
    }
    const commodity = acceptedCommodity(session);
    if ((planItem.scope === "luce" && commodity === "gas") || (planItem.scope === "gas" && commodity === "luce")) {
      const skipped = { id: questionId, field: planItem.field, status: "skipped", reason: "commodity_not_present", elapsed_ms: 0 };
      session.answers = { ...(session.answers || {}), [questionId]: skipped };
      session.status = "questioning";
      session = await savePdfAnalysisSession(session);
      return json(res, 200, { ok: true, answer: skipped, session: publicPdfAnalysisSession(session) });
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return json(res, 503, { ok: false, error: "Lettore IA non configurato" });
    const configAi = pdfAiConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("question_timeout")), 42_000);
    let answer;
    try {
      answer = await readPdfFieldQuestion({
        questionId,
        pages: session.pages || [],
        pageCount: Number(session.expected_page_count || session.pages?.length || 0),
        apiKey,
        model: configAi.criticalModel,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    session.answers = { ...(session.answers || {}), [questionId]: answer };
    session.status = "questioning";
    session = await savePdfAnalysisSession(session);
    return json(res, 200, { ok: true, answer, session: publicPdfAnalysisSession(session) });
  } catch (error) {
    if (sessionErrorResponse(res, error) !== false) return;
    const timeout = /timeout|abort/i.test(String(error?.message || ""));
    return json(res, timeout ? 504 : 400, { ok: false, error: timeout ? "Tempo esaurito per la singola domanda" : "Domanda PDF non completata" });
  }
}

async function handleStatus(req, res) {
  try {
    const { session } = await authorizedSessionFromJson(req);
    return json(res, 200, {
      ok: true,
      session: publicPdfAnalysisSession(session),
      plan: publicPdfAnalysisPlan(session.plan || []),
      answers: session.answers || {},
      final: session.final || null,
    });
  } catch (error) {
    if (sessionErrorResponse(res, error) !== false) return;
    return json(res, 400, { ok: false, error: "Stato sessione PDF non disponibile" });
  }
}

function auditStatus(audit = {}) {
  return {
    mode: "session",
    status: audit?.ai?.status || "completed",
    reason: audit?.reason || null,
    public_output: audit?.public_output || "targeted_question_direct_merge",
    candidate_count: Number(audit?.promoted?.length || 0),
    promoted_count: Number(audit?.promoted?.length || 0),
    partial: Boolean(audit?.ai?.partial),
    question_count: Number(audit?.ai?.plan?.question_count || 0),
    completed_question_count: Number(audit?.ai?.plan?.completed_question_count || 0),
    page_isolated: true,
    api_endpoint_count_preserved: true,
  };
}

async function handleFinalize(req, res) {
  if (!(await useRateLimit(req, res, "pdf-analysis-finalize", "PDF", 30))) return;
  try {
    const { session: loaded } = await authorizedSessionFromJson(req);
    let session = loaded;
    if (session.final?.normalized) {
      return json(res, 200, { ok: true, normalized: session.final.normalized, archive: session.archive || null, reader: session.final.reader, session: publicPdfAnalysisSession(session) });
    }
    const results = (session.plan || []).map((item) => session.answers?.[item.id] || ({
      id: item.id,
      field: item.field,
      status: "skipped",
      reason: "question_not_executed",
      elapsed_ms: 0,
    }));
    const completed = results.some((item) => item.status === "completed");
    const pseudoSession = {
      status: completed ? "completed" : "failed",
      reason: completed ? null : "no_completed_questions",
      partial: results.some((item) => !["completed", "not_found", "skipped"].includes(item.status)),
      model: "gpt-4.1-2025-04-14",
      results,
      accepted: results.filter((item) => item.status === "completed").map((item) => item.result),
      elapsed_ms: results.reduce((sum, item) => sum + Number(item.elapsed_ms || 0), 0),
      session_version: "step8-session-v2-1-page-by-page-single-api",
      catalog_version: "step8-question-catalog-v1",
      validation_version: "step8-question-validation-v1",
      page_isolated: true,
    };
    const merged = mergePdfAiQuestionSession({ normalized: session.baseline || {}, session: pseudoSession });
    const cleanup = await deleteOpenAiSessionFiles(session);
    const reader = auditStatus(merged.audit);
    if (session.archive?.stored && session.archive?.analysisId) {
      await updatePdfAnalysisRuntime(session.archive.analysisId, { normalized: merged.normalized, shadow: merged.audit }).catch(() => {});
    }
    session.status = "finalized";
    session.pages = (session.pages || []).map((page) => ({ ...page, file_id: null, deleted: true }));
    session.final = { normalized: merged.normalized, reader, audit: merged.audit, cleanup };
    session = await savePdfAnalysisSession(session);
    return json(res, 200, { ok: true, normalized: merged.normalized, archive: session.archive || null, reader, session: publicPdfAnalysisSession(session) });
  } catch (error) {
    if (sessionErrorResponse(res, error) !== false) return;
    return json(res, 400, { ok: false, error: "Finalizzazione PDF non riuscita" });
  }
}

async function handleCancel(req, res) {
  try {
    const { session } = await authorizedSessionFromJson(req);
    const cleanup = await deleteOpenAiSessionFiles(session);
    await deletePdfAnalysisSession(session.id);
    return json(res, 200, { ok: true, cleanup });
  } catch (error) {
    if (sessionErrorResponse(res, error) !== false) return;
    return json(res, 400, { ok: false, error: "Annullamento sessione PDF non riuscito" });
  }
}

const ACTION_HANDLERS = {
  start: handleStart,
  page: handlePage,
  commit: handleCommit,
  question: handleQuestion,
  status: handleStatus,
  finalize: handleFinalize,
  cancel: handleCancel,
};

export async function handlePdfAnalysisAction(action, req, res) {
  if (!ALLOWED_ACTIONS.has(action)) return false;
  if (!method(req, res, ["POST"])) return true;
  if (!requireAllowedOrigin(req, res)) return true;
  await ACTION_HANDLERS[action](req, res);
  return true;
}
