import { json, method } from "../lib/http.js";
import { checkStore, persistentStoreConfigured } from "../lib/store.js";

function requestToken(req) {
  const auth = String(req.headers.authorization || "");
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const url = new URL(req.url || "/api/health", `https://${req.headers.host || "offertalogica.it"}`);
  return String(url.searchParams.get("token") || "").trim();
}

function isAuthorized(req) {
  const expected = String(process.env.HEALTHCHECK_TOKEN || "").trim();
  return Boolean(expected && requestToken(req) === expected);
}

export default async function handler(req, res) {
  if (!method(req, res, ["GET"])) return;
  if (!isAuthorized(req)) return json(res, 404, { ok: false, error: "Not found" });

  const startedAt = Date.now();
  try {
    const storageOk = await checkStore();
    json(res, storageOk ? 200 : 500, {
      ok: storageOk,
      storage: persistentStoreConfigured() ? "redis" : "memory",
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
