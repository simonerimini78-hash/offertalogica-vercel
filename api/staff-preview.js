import crypto from "node:crypto";
import { json, method, readJson, requireAllowedOrigin } from "../lib/http.js";
import { requireStaffSession } from "../lib/staffSessionAuth.js";

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedOrigin(req, res)) return;

  try {
    const body = await readJson(req);
    const action = String(body.action || "").trim().toLowerCase();
    const expectedToken = String(process.env.STAFF_PREVIEW_TOKEN || "").trim();

    if (action === "issue") {
      const identity = await requireStaffSession(req, res, {
        roles: ["reviewer", "admin"],
        permissions: ["view_site_preview"],
      });
      if (!identity) return;

      if (!expectedToken) {
        return json(res, 503, {
          ok: false,
          error: "Modalità verifica sito non configurata sul backend Staff",
          code: "staff_preview_token_missing",
        });
      }

      return json(res, 200, {
        ok: true,
        url: `https://offertalogica.it/?staffHome=1#staff=${encodeURIComponent(expectedToken)}`,
      });
    }

    if (action && action !== "verify") {
      return json(res, 400, { ok: false, error: "Azione staff non valida" });
    }

    const token = String(body.token || "").trim();
    if (!expectedToken || !safeEqual(token, expectedToken)) {
      return json(res, 403, { ok: false, error: "Token staff non valido" });
    }

    return json(res, 200, {
      ok: true,
      mode: "staff",
      activatedAt: new Date().toISOString(),
    });
  } catch {
    return json(res, 400, { ok: false, error: "Richiesta staff non valida" });
  }
}
