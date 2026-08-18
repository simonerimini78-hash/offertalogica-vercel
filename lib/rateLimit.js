import crypto from "node:crypto";
import { clientIp, json } from "./http.js";
import { persistentStoreConfigured, takeRateLimit } from "./store.js";

function hashIdentifier(value) {
  return crypto.createHash("sha256").update(String(value || "unknown")).digest("hex").slice(0, 32);
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export async function enforceRateLimit(req, res, options = {}) {
  const label = options.label || "generic";
  const windowSeconds = options.windowSeconds || envNumber("RATE_LIMIT_WINDOW_SECONDS", 3600);
  const limit = options.limit || envNumber("RATE_LIMIT_DEFAULT", 60);
  const identifier = options.identifier || clientIp(req) || "unknown";
  const now = Date.now();
  const bucket = Math.floor(now / (windowSeconds * 1000));
  const resetAt = (bucket + 1) * windowSeconds * 1000;
  const key = `rate:${label}:${hashIdentifier(identifier)}:${bucket}`;
  const requiresPersistentStore = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";

  if (requiresPersistentStore && !persistentStoreConfigured()) {
    res.setHeader("Retry-After", "30");
    json(res, 503, { ok: false, error: "Servizio temporaneamente non disponibile" });
    return false;
  }

  let result;
  try {
    result = await takeRateLimit(key, limit, windowSeconds + 60);
  } catch (error) {
    console.error("rate_limit_store_failed", {
      label,
      message: String(error?.message || "rate_limit_store_error").slice(0, 180),
    });
    res.setHeader("Retry-After", "30");
    json(res, 503, { ok: false, error: "Servizio temporaneamente non disponibile" });
    return false;
  }

  if (!result.allowed) {
    const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", "0");
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
    json(res, 429, { ok: false, error: "Troppe richieste. Riprova piu tardi." });
    return false;
  }

  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, limit - result.count)));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
  return true;
}

export function rateLimitConfig(name, fallbackLimit, fallbackWindowSeconds = 3600) {
  return {
    limit: envNumber(`RATE_LIMIT_${name}_LIMIT`, fallbackLimit),
    windowSeconds: envNumber(`RATE_LIMIT_${name}_WINDOW_SECONDS`, fallbackWindowSeconds),
  };
}
