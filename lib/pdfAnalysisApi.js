import { json, readJson } from "./http.js";
import { readPdfAnalysisSession } from "./pdfAnalysisSessionStore.js";

export function formValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

export function safePdfFilename(value) {
  const raw = String(formValue(value) || "documento.pdf").split(/[\\/]/).pop() || "documento.pdf";
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) || "documento.pdf";
}

export function safeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(formValue(value) || ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseJsonField(value, fallback = {}) {
  const raw = formValue(value);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export async function authorizedSessionFromJson(req) {
  const body = await readJson(req);
  const analysisId = String(body.analysisId || "").trim();
  const analysisToken = String(body.analysisToken || "").trim();
  if (!analysisId || !analysisToken) throw new Error("pdf_session_credentials_missing");
  const session = await readPdfAnalysisSession(analysisId, analysisToken);
  return { body, session, analysisId, analysisToken };
}

export function sessionErrorResponse(res, error) {
  const message = String(error?.message || "");
  if (message === "pdf_session_store_not_configured") return json(res, 503, { ok: false, error: "Archivio sessione PDF non configurato" });
  if (message === "pdf_session_not_found") return json(res, 404, { ok: false, error: "Sessione PDF non trovata" });
  if (message === "pdf_session_unauthorized") return json(res, 403, { ok: false, error: "Sessione PDF non autorizzata" });
  if (message === "pdf_session_expired") return json(res, 410, { ok: false, error: "Sessione PDF scaduta" });
  if (message === "pdf_session_credentials_missing") return json(res, 400, { ok: false, error: "Credenziali sessione PDF mancanti" });
  return false;
}
