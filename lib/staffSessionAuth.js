import crypto from "node:crypto";
import { json } from "./http.js";
import {
  premiumAiConfig,
  readBearerToken,
  verifyPremiumStaff,
} from "./premiumAiBackend.js";

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function healthToken(req) {
  const authorization = readBearerToken(req);
  const expected = String(process.env.HEALTHCHECK_TOKEN || "").trim();
  return expected && safeEqual(authorization, expected);
}

/**
 * Autorizza le API della pagina staff unica usando la sessione Supabase.
 * Il token health resta ammesso soltanto quando esplicitamente richiesto e
 * non concede mai operazioni di modifica.
 */
export async function requireStaffSession(
  req,
  res,
  {
    roles = ["reviewer", "admin"],
    allowHealth = false,
    fetchImpl = fetch,
  } = {},
) {
  if (allowHealth && req.method === "GET" && healthToken(req)) {
    return {
      authorizedBy: "health",
      user: null,
      staff: { role: "health", active: true },
    };
  }

  const accessToken = readBearerToken(req);
  if (!accessToken) {
    json(res, 401, { ok: false, error: "Sessione staff richiesta" });
    return null;
  }

  const config = premiumAiConfig();
  if (!config.supabaseUrl || !config.serviceKey) {
    json(res, 503, { ok: false, error: "Accesso staff non configurato" });
    return null;
  }

  try {
    const identity = await verifyPremiumStaff({ config, accessToken, fetchImpl });
    if (!roles.includes(identity.staff.role)) {
      json(res, 403, { ok: false, error: "Ruolo staff non autorizzato" });
      return null;
    }
    return { ...identity, authorizedBy: "supabase" };
  } catch (error) {
    const message = String(error?.message || "");
    const status = message.includes("premium_staff_access_required") ? 403 : 401;
    json(res, status, {
      ok: false,
      error: status === 403 ? "Account staff non autorizzato" : "Sessione staff non valida",
    });
    return null;
  }
}
