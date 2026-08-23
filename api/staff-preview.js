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
  if (a.length !== b.length) return false;
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

    const token = String(body.token || "").trim();
    if (!expectedToken || !safeEqual(token, expectedToken)) {
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
