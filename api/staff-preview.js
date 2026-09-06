import crypto from "node:crypto";
import { json, method, readJson, requireAllowedOrigin } from "../lib/http.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";
import { requireStaffSession } from "../lib/staffSessionAuth.js";

const STAFF_PREVIEW_TARGETS = new Set([
  "/",
  "/speed-test.html",
  "/fotovoltaico.html",
  "/climatizzazione-pompa-di-calore.html",
]);
const PREVIEW_TICKET_VERSION = "v1";
const PREVIEW_TICKET_TTL_SECONDS = 120;
const PREVIEW_TICKET_CLOCK_SKEW_SECONDS = 15;

function normalizePreviewTarget(value) {
  const target = String(value || "/").trim();
  return STAFF_PREVIEW_TARGETS.has(target) ? target : "/";
}

function previewSecret() {
  const secret = String(process.env.STAFF_PREVIEW_SECRET || "").trim();
  return Buffer.byteLength(secret, "utf8") >= 32 ? secret : "";
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function ticketSignature(payloadPart, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${PREVIEW_TICKET_VERSION}.${payloadPart}`)
    .digest("base64url");
}

function issuePreviewTicket(target, secret) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    scope: "staff-preview",
    target,
    iat: now,
    exp: now + PREVIEW_TICKET_TTL_SECONDS,
    nonce: crypto.randomBytes(16).toString("base64url"),
  };
  const payloadPart = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${PREVIEW_TICKET_VERSION}.${payloadPart}.${ticketSignature(payloadPart, secret)}`;
}

function verifyPreviewTicket(ticket, requestedTarget, secret) {
  const parts = String(ticket || "").trim().split(".");
  if (parts.length !== 3 || parts[0] !== PREVIEW_TICKET_VERSION) return null;
  const [, payloadPart, signature] = parts;
  if (!payloadPart || !signature || !safeEqual(signature, ticketSignature(payloadPart, secret))) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    const issuedAt = Number(payload?.iat);
    const expiresAt = Number(payload?.exp);
    const target = normalizePreviewTarget(payload?.target);
    if (payload?.scope !== "staff-preview") return null;
    if (!Number.isInteger(issuedAt) || !Number.isInteger(expiresAt)) return null;
    if (issuedAt > now + PREVIEW_TICKET_CLOCK_SKEW_SECONDS) return null;
    if (expiresAt <= now || expiresAt - issuedAt > PREVIEW_TICKET_TTL_SECONDS) return null;
    if (target !== normalizePreviewTarget(requestedTarget)) return null;
    if (!String(payload?.nonce || "").trim()) return null;
    return payload;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedOrigin(req, res)) return;
  if (!(await enforceRateLimit(req, res, {
    label: "staff-preview",
    ...rateLimitConfig("STAFF_PREVIEW", 20),
  }))) return;

  try {
    const body = await readJson(req);
    const action = String(body.action || "").trim().toLowerCase();
    const secret = previewSecret();

    if (!secret) {
      return json(res, 503, {
        ok: false,
        error: "Modalità verifica sito non configurata sul backend Staff",
        code: "staff_preview_secret_missing",
      });
    }

    if (action === "issue") {
      const identity = await requireStaffSession(req, res, {
        roles: ["reviewer", "admin"],
        permissions: ["view_site_preview"],
      });
      if (!identity) return;

      const target = normalizePreviewTarget(body.target);
      const ticket = issuePreviewTicket(target, secret);
      return json(res, 200, {
        ok: true,
        target,
        expiresIn: PREVIEW_TICKET_TTL_SECONDS,
        url: `https://offertalogica.it${target}#staffPreview=${encodeURIComponent(ticket)}`,
      });
    }

    if (action && action !== "verify") {
      return json(res, 400, { ok: false, error: "Azione staff non valida" });
    }

    const target = normalizePreviewTarget(body.target);
    const ticket = String(body.ticket || "").trim();
    const payload = verifyPreviewTicket(ticket, target, secret);
    if (!payload) {
      return json(res, 403, { ok: false, error: "Ticket Staff non valido o scaduto" });
    }

    return json(res, 200, {
      ok: true,
      mode: "staff",
      target,
      activatedAt: new Date().toISOString(),
    });
  } catch {
    return json(res, 400, { ok: false, error: "Richiesta staff non valida" });
  }
}
