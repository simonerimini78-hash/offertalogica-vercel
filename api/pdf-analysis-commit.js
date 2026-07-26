import { json, method, requireAllowedOrigin } from "../lib/http.js";
import { authorizedSessionFromJson, sessionErrorResponse } from "../lib/pdfAnalysisApi.js";
import { buildPdfAnalysisPlan, publicPdfAnalysisPlan } from "../lib/pdfAnalysisPlan.js";
import { publicPdfAnalysisSession, savePdfAnalysisSession } from "../lib/pdfAnalysisSessionStore.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedOrigin(req, res)) return;
  if (!(await enforceRateLimit(req, res, { label: "pdf-analysis-commit", ...rateLimitConfig("PDF", 30) }))) return;
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
      planVersion: "step8-question-plan-v2-sequential",
      plan: publicPdfAnalysisPlan(session.plan),
    });
  } catch (error) {
    if (sessionErrorResponse(res, error) !== false) return;
    return json(res, 400, { ok: false, error: "Impossibile preparare le domande PDF" });
  }
}
