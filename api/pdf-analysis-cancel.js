import { json, method, requireAllowedOrigin } from "../lib/http.js";
import { authorizedSessionFromJson, sessionErrorResponse } from "../lib/pdfAnalysisApi.js";
import { deleteOpenAiSessionFiles } from "../lib/pdfAnalysisCleanup.js";
import { deletePdfAnalysisSession } from "../lib/pdfAnalysisSessionStore.js";

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedOrigin(req, res)) return;
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
