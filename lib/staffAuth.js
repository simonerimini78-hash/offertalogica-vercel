import crypto from "node:crypto";
import { json } from "./http.js";

const SIGNED_TOKEN_VERSION = "v2";
const SIGNED_TOKEN_SCOPE = "staff-preview";

function readToken(req) {
  const auth = String(req.headers?.authorization || "");
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const header = String(req.headers?.["x-staff-token"] || "");
  const query = String(req.query?.token || "");
  return bearer || header || query;
}

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
      && expiresAt - issuedAt <= 4 * 60 * 60;
  } catch {
    return false;
  }
}

export function staffPreviewTokenValid(token) {
  const expected = String(process.env.STAFF_PREVIEW_TOKEN || "").trim();
  if (expected && safeEqual(token, expected)) return true;
  return signedPreviewTokenValid(token);
}

export function requireStaffToken(req, res) {
  const token = readToken(req);
  if (staffPreviewTokenValid(token)) return true;

  const expected = String(process.env.STAFF_PREVIEW_TOKEN || "").trim();
  if (!expected && !previewSigningSecret()) {
    json(res, 503, { ok: false, error: "Accesso staff non configurato" });
    return false;
  }

  json(res, 401, { ok: false, error: "Token staff non valido" });
  return false;
}
