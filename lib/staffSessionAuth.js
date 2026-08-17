import crypto from "node:crypto";
import { json } from "./http.js";
import { staffRoleSatisfiesBaseline } from "./staffRoles.js";
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

function jwtClaims(accessToken) {
  const parts = String(accessToken || "").split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const decoded = Buffer.from(parts[1], "base64url").toString("utf8");
    const claims = JSON.parse(decoded);
    return claims && typeof claims === "object" ? claims : null;
  } catch {
    return null;
  }
}

function staffMfaSatisfied(accessToken) {
  const claims = jwtClaims(accessToken);
  return String(claims?.aal || "").trim().toLowerCase() === "aal2";
}

export async function staffPermissionAllowed({
  config,
  accessToken,
  permission,
  fetchImpl = fetch,
}) {
  const key = String(permission || "").trim();
  if (!key || !config?.supabaseUrl || !config?.serviceKey || !accessToken) return false;

  const response = await fetchImpl(
    `${config.supabaseUrl}/rest/v1/rpc/premium_staff_permission_allowed`,
    {
      method: "POST",
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_permission_key: key }),
    },
  );
  if (!response.ok) {
    throw new Error(`premium_staff_permission_check_failed:${response.status}`);
  }
  const payload = await response.json().catch(() => false);
  return payload === true || payload?.allowed === true;
}

/**
 * Autorizza le API della pagina staff unica usando la sessione Supabase.
 * Il token health resta ammesso soltanto quando esplicitamente richiesto e
 * non concede mai operazioni di modifica.
 *
 * Sicurezza MFA:
 * - verifyPremiumStaff valida prima la sessione contro Supabase;
 * - solo dopo la validazione leggiamo il claim "aal" del JWT;
 * - le API Staff richiedono aal2, cioe' password + secondo fattore.
 */
export async function requireStaffSession(
  req,
  res,
  {
    roles = ["reviewer", "admin"],
    permissions = [],
    permissionMode = "all",
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
    // Prima validiamo crittograficamente/operativamente la sessione con Supabase.
    const identity = await verifyPremiumStaff({ config, accessToken, fetchImpl });

    // Solo una sessione Staff gia' elevata ad AAL2 puo' raggiungere le API.
    // Un JWT valido ma ottenuto con sola password (AAL1) viene rifiutato.
    if (!staffMfaSatisfied(accessToken)) {
      json(res, 403, {
        ok: false,
        error: "Verifica MFA Staff richiesta",
        code: "staff_mfa_required",
      });
      return null;
    }

    if (!staffRoleSatisfiesBaseline(identity.staff.role, roles)) {
      json(res, 403, { ok: false, error: "Ruolo staff non autorizzato" });
      return null;
    }

    const requestedPermissions = [...new Set(
      (Array.isArray(permissions) ? permissions : [permissions])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    )];
    if (requestedPermissions.length) {
      const decisions = await Promise.all(
        requestedPermissions.map((permission) => staffPermissionAllowed({
          config,
          accessToken,
          permission,
          fetchImpl,
        })),
      );
      const allowed = permissionMode === "any"
        ? decisions.some(Boolean)
        : decisions.every(Boolean);
      if (!allowed) {
        json(res, 403, { ok: false, error: "Permesso Staff non autorizzato" });
        return null;
      }
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
