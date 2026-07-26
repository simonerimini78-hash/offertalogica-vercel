import { json, method, requireAllowedOrigin } from "../lib/http.js";
import { authorizedSessionFromJson, sessionErrorResponse } from "../lib/pdfAnalysisApi.js";
import { pdfAiConfig } from "../lib/pdfAiConfig.js";
import { readPdfFieldQuestion } from "../lib/pdfAiFieldQuestion.js";
import { publicPdfAnalysisSession, savePdfAnalysisSession } from "../lib/pdfAnalysisSessionStore.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";

function acceptedCommodity(session) {
  const answer = session.answers?.document_commodity;
  const value = answer?.result?.normalizedValue;
  return ["luce", "gas", "dual"].includes(value) ? value : session.baseline?.commodity || "unknown";
}

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedOrigin(req, res)) return;
  if (!(await enforceRateLimit(req, res, { label: "pdf-analysis-question", ...rateLimitConfig("PDF_QUESTION", 400) }))) return;
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
    const config = pdfAiConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("question_timeout")), 42_000);
    let answer;
    try {
      answer = await readPdfFieldQuestion({
        questionId,
        pages: session.pages || [],
        pageCount: Number(session.expected_page_count || session.pages?.length || 0),
        apiKey,
        model: config.criticalModel,
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
