import fs from "node:fs/promises";
import formidable from "formidable";
import { json, method, requireAllowedOrigin } from "../lib/http.js";
import { defaultPdfQuestionTransport } from "../lib/pdfAiQuestionSession.js";
import { pdfAiConfig } from "../lib/pdfAiConfig.js";
import { indexUploadedPdfPage } from "../lib/pdfAiPageIndex.js";
import { formValue, safeInteger, sessionErrorResponse } from "../lib/pdfAnalysisApi.js";
import { publicPdfAnalysisSession, readPdfAnalysisSession, savePdfAnalysisSession } from "../lib/pdfAnalysisSessionStore.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";

export const config = { api: { bodyParser: false } };
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function parseForm(req) {
  const form = formidable({
    multiples: false,
    maxFiles: 1,
    maxFileSize: 3_700_000,
    maxTotalFileSize: 3_800_000,
    allowEmptyFiles: false,
    filter: (part) => IMAGE_TYPES.has(part.mimetype || ""),
  });
  return new Promise((resolve, reject) => form.parse(req, (error, fields, files) => error ? reject(error) : resolve({ fields, files })));
}

async function validImage(file) {
  const bytes = await fs.readFile(file.filepath);
  if (bytes.length < 12) return false;
  if (file.mimetype === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (file.mimetype === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (file.mimetype === "image/webp") return bytes.subarray(0,4).toString("ascii") === "RIFF" && bytes.subarray(8,12).toString("ascii") === "WEBP";
  return false;
}

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedOrigin(req, res)) return;
  if (!(await enforceRateLimit(req, res, { label: "pdf-analysis-page", ...rateLimitConfig("PDF_PAGE", 160) }))) return;
  let temporaryPath = "";
  let uploadedFileId = "";
  try {
    const { fields, files } = await parseForm(req);
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
      filename: `pagina-${String(pageNumber).padStart(3,"0")}.${extension}`,
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
    }].sort((a,b) => a.page-b.page);
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
