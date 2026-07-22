import crypto from "node:crypto";
import { json } from "./http.js";

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

export function hasValidStaffToken(req, env = process.env) {
  const expected = String(env?.STAFF_PREVIEW_TOKEN || "").trim();
  if (!expected) return false;
  return safeEqual(readToken(req), expected);
}

export function requireStaffToken(req, res) {
  const expected = String(process.env.STAFF_PREVIEW_TOKEN || "").trim();
  if (!expected) {
    json(res, 503, { ok: false, error: "Accesso staff non configurato" });
    return false;
  }
  if (!hasValidStaffToken(req)) {
    json(res, 401, { ok: false, error: "Token staff non valido" });
    return false;
  }
  return true;
}
