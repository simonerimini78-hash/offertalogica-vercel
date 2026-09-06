import crypto from "node:crypto";

export function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function normalizeConfiguredOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    return parsed.origin;
  } catch {
    return "";
  }
}

function configuredOrigins() {
  const defaults = [
    "https://offertalogica.it",
    "https://www.offertalogica.it",
    "https://offertalogica-vercel.vercel.app",
  ];
  const custom = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => normalizeConfiguredOrigin(origin))
    .filter(Boolean);
  const vercel = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ]
    .map((origin) => normalizeConfiguredOrigin(origin))
    .filter(Boolean);
  return new Set([...defaults, ...custom, ...vercel]);
}

function requestHost(req) {
  return String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
}

function isSameDeploymentOrigin(req, origin) {
  const host = requestHost(req);
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

export function requireAllowedOrigin(req, res) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return true;
  const normalizedOrigin = normalizeConfiguredOrigin(origin);
  if (!normalizedOrigin) {
    json(res, 403, { ok: false, error: "Origine richiesta non autorizzata" });
    return false;
  }
  if (configuredOrigins().has(normalizedOrigin)) return true;
  if (isSameDeploymentOrigin(req, normalizedOrigin)) return true;
  json(res, 403, { ok: false, error: "Origine richiesta non autorizzata" });
  return false;
}

export function requireAllowedBrowserOrigin(req, res) {
  const origin = String(req?.headers?.origin || "").trim();
  if (!origin) {
    json(res, 403, { ok: false, error: "Origine richiesta non autorizzata" });
    return false;
  }
  return requireAllowedOrigin(req, res);
}

export function method(req, res, allowed) {
  if (allowed.includes(req.method)) return true;
  res.setHeader("Allow", allowed.join(", "));
  json(res, 405, { ok: false, error: "Metodo non consentito" });
  return false;
}

export async function readJson(req) {
  const chunks = [];
  const maxBytes = Number(process.env.MAX_JSON_BYTES || 200_000);
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) throw new Error("Richiesta troppo grande");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();
}

const LEAD_SESSION_VERSION = 1;
const DEFAULT_LEAD_SESSION_TTL_SECONDS = 3600;

function leadSessionSecret() {
  const configured = String(process.env.LEAD_SESSION_SECRET || "").trim();
  if (Buffer.byteLength(configured, "utf8") >= 32) return configured;
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    const developmentFallback = String(process.env.OTP_SECRET || "").trim();
    if (Buffer.byteLength(developmentFallback, "utf8") >= 32) return developmentFallback;
  }
  throw new Error("lead_session_secret_not_configured");
}

function leadSessionTtlSeconds() {
  const parsed = Number(process.env.LEAD_SESSION_TTL_SECONDS || DEFAULT_LEAD_SESSION_TTL_SECONDS);
  if (!Number.isFinite(parsed)) return DEFAULT_LEAD_SESSION_TTL_SECONDS;
  return Math.max(300, Math.min(7200, Math.floor(parsed)));
}

function leadSessionCookieName() {
  return String(process.env.NODE_ENV || "").trim().toLowerCase() === "production"
    ? "__Host-ol_lead_session"
    : "ol_lead_session";
}

function parseCookies(req) {
  const raw = String(req?.headers?.cookie || "");
  const result = new Map();
  raw.split(";").forEach((part) => {
    const index = part.indexOf("=");
    if (index <= 0) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) result.set(key, value);
  });
  return result;
}

function leadSessionSignature(encodedPayload, secret) {
  return crypto.createHmac("sha256", secret)
    .update(`offertalogica-lead-session:${encodedPayload}`)
    .digest("base64url");
}

function safeEqualText(actualValue, expectedValue) {
  const actual = Buffer.from(String(actualValue || ""), "utf8");
  const expected = Buffer.from(String(expectedValue || ""), "utf8");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function createLeadSessionToken(leadId, { now = Date.now() } = {}) {
  const normalizedLeadId = String(leadId || "").trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(normalizedLeadId)) throw new Error("lead_session_invalid_lead");
  const ttlSeconds = leadSessionTtlSeconds();
  const payload = {
    v: LEAD_SESSION_VERSION,
    sub: normalizedLeadId,
    iat: Number(now),
    exp: Number(now) + ttlSeconds * 1000,
    nonce: crypto.randomBytes(12).toString("base64url"),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = leadSessionSignature(encodedPayload, leadSessionSecret());
  return { token: `${encodedPayload}.${signature}`, ttlSeconds };
}

export function leadSessionSubject(req, { now = Date.now() } = {}) {
  const token = parseCookies(req).get(leadSessionCookieName()) || "";
  const [encodedPayload, signature, extra] = String(token).split(".");
  if (!encodedPayload || !signature || extra) return "";
  let expectedSignature;
  try {
    expectedSignature = leadSessionSignature(encodedPayload, leadSessionSecret());
  } catch {
    return "";
  }
  if (!safeEqualText(signature, expectedSignature)) return "";
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return "";
  }
  if (payload?.v !== LEAD_SESSION_VERSION) return "";
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(String(payload?.sub || ""))) return "";
  if (!Number.isFinite(Number(payload?.iat)) || !Number.isFinite(Number(payload?.exp))) return "";
  if (Number(payload.exp) <= Number(now) || Number(payload.iat) > Number(now) + 60_000) return "";
  return String(payload.sub);
}

export function setLeadSessionCookie(res, leadId) {
  const { token, ttlSeconds } = createLeadSessionToken(leadId);
  const secure = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
  const attributes = [
    `${leadSessionCookieName()}=${token}`,
    "Path=/",
    `Max-Age=${ttlSeconds}`,
    "HttpOnly",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : []),
  ];
  res.setHeader("Set-Cookie", attributes.join("; "));
  return ttlSeconds;
}

export function requireLeadSession(req, res, leadId) {
  const normalizedLeadId = String(leadId || "").trim();
  if (!normalizedLeadId || leadSessionSubject(req) !== normalizedLeadId) {
    json(res, 403, { ok: false, error: "Sessione di verifica non valida o scaduta" });
    return false;
  }
  return true;
}
