import crypto from "node:crypto";
import { json, method } from "../lib/http.js";
import { checkCustomerDb } from "../lib/customerDb.js";
import { otpProviderStatus } from "../lib/otp.js";
import { checkStore, persistentStoreConfigured } from "../lib/store.js";

function requestToken(req) {
  const auth = String(req.headers.authorization || "");
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

function constantTimeTokenMatch(actual, expected) {
  const left = Buffer.from(String(actual || ""), "utf8");
  const right = Buffer.from(String(expected || ""), "utf8");
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function isAuthorized(req) {
  const token = requestToken(req);
  const healthToken = String(process.env.HEALTHCHECK_TOKEN || "").trim();
  return Boolean(healthToken && constantTimeTokenMatch(token, healthToken));
}

export default async function handler(req, res) {
  if (!method(req, res, ["GET"])) return;
  res.setHeader("Cache-Control", "no-store");
  if (!isAuthorized(req)) return json(res, 404, { ok: false, error: "Not found" });

  const startedAt = Date.now();
  try {
    const storageOk = await checkStore();
    const customerDb = await checkCustomerDb();
    const ok = storageOk && customerDb.ok;
    json(res, ok ? 200 : 500, {
      ok,
      storage: persistentStoreConfigured() ? "redis" : "memory",
      customerDb,
      sms: otpProviderStatus(),
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    });
  } catch {
    json(res, 500, {
      ok: false,
      storage: persistentStoreConfigured() ? "redis" : "memory",
      error: "Health check fallito",
      checkedAt: new Date().toISOString(),
    });
  }
}
