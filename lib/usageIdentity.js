import crypto from "node:crypto";
import { clientIp } from "./http.js";

const USAGE_COOKIE_TTL_SECONDS = 14 * 24 * 60 * 60;
const USAGE_IDENTITY_VERSION = "usage-v1";

function isProduction() {
  return String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
}

function cookieName() {
  return isProduction() ? "__Host-ol_usage_v1" : "ol_usage_v1";
}

function parseCookie(req, name) {
  const raw = String(req?.headers?.cookie || "");
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function validVisitorToken(value) {
  return /^[A-Za-z0-9_-]{32,80}$/.test(String(value || ""));
}

function newVisitorToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function setVisitorCookie(res, token) {
  const attributes = [
    `${cookieName()}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${USAGE_COOKIE_TTL_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isProduction()) attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function hmac(key, value) {
  return crypto.createHmac("sha256", String(key || "")).update(String(value || "")).digest("hex");
}

export function observeBusinessUsageIdentity(req, res, analysisKey = "") {
  const name = cookieName();
  let token = parseCookie(req, name);
  if (!validVisitorToken(token)) {
    token = newVisitorToken();
    setVisitorCookie(res, token);
  }

  const ip = clientIp(req);
  const globalSecret = String(process.env.USAGE_CONTROL_HASH_SECRET || "").trim();
  const normalizedAnalysisKey = String(analysisKey || "").trim().slice(0, 800);

  return {
    usageMode: "shadow",
    usageIdentityVersion: USAGE_IDENTITY_VERSION,
    usageVisitorHash: sha256(`visitor:${token}`),
    usageIpHash: globalSecret.length >= 32 && ip ? hmac(globalSecret, `usage-ip:${ip}`) : "",
    usageAnalysisHash: normalizedAnalysisKey ? hmac(token, `analysis:${normalizedAnalysisKey}`) : "",
  };
}
