import { json, method, readJson, requireAllowedOrigin } from "../lib/http.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";
import { staffPreviewTokenValid } from "../lib/staffAuth.js";

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedOrigin(req, res)) return;
  if (!(await enforceRateLimit(req, res, { label: "staff-preview", ...rateLimitConfig("STAFF_PREVIEW", 20) }))) return;

  try {
    const body = await readJson(req);
    const token = String(body.token || "").trim();
    if (!staffPreviewTokenValid(token)) {
      return json(res, 403, { ok: false, error: "Token staff non valido" });
    }

    json(res, 200, {
      ok: true,
      mode: "staff",
      activatedAt: new Date().toISOString(),
    });
  } catch {
    json(res, 400, { ok: false, error: "Richiesta staff non valida" });
  }
}
