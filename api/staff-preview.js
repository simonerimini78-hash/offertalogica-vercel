import crypto from "node:crypto";
import { json, method, readJson, requireAllowedOrigin } from "../lib/http.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";
import { requireStaffSession } from "../lib/staffSessionAuth.js";

const SIGNED_TOKEN_VERSION = "v2";
const SIGNED_TOKEN_SCOPE = "staff-preview";
const SIGNED_TOKEN_TTL_SECONDS = 4 * 60 * 60;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function previewSigningSecret() {
  return String(
    process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY
    || "",
  ).trim();
}

function issueSignedPreviewToken() {
  const secret = previewSigningSecret();
  if (!secret) return "";
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    scope: SIGNED_TOKEN_SCOPE,
    iat: now,
    exp: now + SIGNED_TOKEN_TTL_SECONDS,
    nonce: crypto.randomBytes(12).toString("hex"),
  })).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${SIGNED_TOKEN_VERSION}.${payload}`)
    .digest("base64url");
  return `${SIGNED_TOKEN_VERSION}.${payload}.${signature}`;
}

function signedPreviewTokenValid(token) {
  const secret = previewSigningSecret();
  if (!secret) return false;

  const [version, payload, signature, extra] = String(token || "").split(".");
  if (extra !== undefined || version !== SIGNED_TOKEN_VERSION || !payload || !signature) return false;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${version}.${payload}`)
    .digest("base64url");
  if (!safeEqual(signature, expectedSignature)) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    const issuedAt = Number(data?.iat || 0);
    const expiresAt = Number(data?.exp || 0);
    return data?.scope === SIGNED_TOKEN_SCOPE
      && Number.isFinite(issuedAt)
      && Number.isFinite(expiresAt)
      && issuedAt <= now + 60
      && expiresAt > now
      && expiresAt - issuedAt <= SIGNED_TOKEN_TTL_SECONDS;
  } catch {
    return false;
  }
}

function previewTokenValid(token) {
  const expectedToken = String(process.env.STAFF_PREVIEW_TOKEN || "").trim();
  if (expectedToken && safeEqual(token, expectedToken)) return true;
  return signedPreviewTokenValid(token);
}

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedOrigin(req, res)) return;
  if (!(await enforceRateLimit(req, res, { label: "staff-preview", ...rateLimitConfig("STAFF_PREVIEW", 20) }))) return;

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

      const token = issueSignedPreviewToken() || expectedToken;
      if (!token) {
        return json(res, 503, {
          ok: false,
          error: "Modalità verifica sito non configurata sul backend Staff",
          code: "staff_preview_signing_missing",
        });
      }

      return json(res, 200, {
        ok: true,
        url: `https://offertalogica.it/#staff=${encodeURIComponent(token)}`,
      });
    }

    if (action && action !== "verify") {
      return json(res, 400, { ok: false, error: "Azione staff non valida" });
    }

    const token = String(body.token || "").trim();
    if (!previewTokenValid(token)) {
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
