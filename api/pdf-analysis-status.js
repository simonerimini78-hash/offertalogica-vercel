import { json, method, requireAllowedOrigin } from "../lib/http.js";
import { authorizedSessionFromJson, sessionErrorResponse } from "../lib/pdfAnalysisApi.js";
import { publicPdfAnalysisPlan } from "../lib/pdfAnalysisPlan.js";
import { publicPdfAnalysisSession } from "../lib/pdfAnalysisSessionStore.js";

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedOrigin(req, res)) return;
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
