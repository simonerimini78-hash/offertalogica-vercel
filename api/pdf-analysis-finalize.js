import { json, method, requireAllowedOrigin } from "../lib/http.js";
import { authorizedSessionFromJson, sessionErrorResponse } from "../lib/pdfAnalysisApi.js";
import { deleteOpenAiSessionFiles } from "../lib/pdfAnalysisCleanup.js";
import { mergePdfAiQuestionSession } from "../lib/pdfAiQuestionMerge.js";
import { updatePdfAnalysisRuntime } from "../lib/pdfArchive.js";
import { publicPdfAnalysisSession, savePdfAnalysisSession } from "../lib/pdfAnalysisSessionStore.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";

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
  };
}

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedOrigin(req, res)) return;
  if (!(await enforceRateLimit(req, res, { label: "pdf-analysis-finalize", ...rateLimitConfig("PDF", 30) }))) return;
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
    const pseudoSession = {
      status: results.some((item) => item.status === "completed") ? "completed" : "failed",
      reason: results.some((item) => item.status === "completed") ? null : "no_completed_questions",
      partial: results.some((item) => !["completed", "not_found", "skipped"].includes(item.status)),
      model: "gpt-4.1-2025-04-14",
      results,
      accepted: results.filter((item) => item.status === "completed").map((item) => item.result),
      elapsed_ms: results.reduce((sum, item) => sum + Number(item.elapsed_ms || 0), 0),
      session_version: "step8-session-v2-page-by-page",
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
