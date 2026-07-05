import crypto from "node:crypto";
import { json, method, readJson, requireAllowedOrigin } from "../lib/http.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedOrigin(req, res)) return;
  if (!(await enforceRateLimit(req, res, { label: "staff-preview", ...rateLimitConfig("STAFF_PREVIEW", 20) }))) return;

  const expectedToken = String(process.env.STAFF_PREVIEW_TOKEN || "").trim();
  if (!expectedToken) return json(res, 404, { ok: false, error: "Not found" });

  try {
    const body = await readJson(req);
    const token = String(body.token || "").trim();
    if (!safeEqual(token, expectedToken)) {
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
