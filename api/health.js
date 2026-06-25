import { json, method } from "../lib/http.js";
import { checkCustomerDb } from "../lib/customerDb.js";
import { checkStore, persistentStoreConfigured } from "../lib/store.js";

function requestToken(req) {
  const auth = String(req.headers.authorization || "");
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const url = new URL(req.url || "/api/health", `https://${req.headers.host || "offertalogica.it"}`);
  return String(url.searchParams.get("token") || "").trim();
}

function isAuthorized(req) {
  const token = requestToken(req);
  const healthToken = String(process.env.HEALTHCHECK_TOKEN || "").trim();
  const staffToken = String(process.env.STAFF_PREVIEW_TOKEN || "").trim();
  if (healthToken && token === healthToken) return "health";
  if (staffToken && token === staffToken) return "staff";
  return "";
}

export default async function handler(req, res) {
  if (!method(req, res, ["GET"])) return;
  const authorizedBy = isAuthorized(req);
  if (!authorizedBy) return json(res, 404, { ok: false, error: "Not found" });

  const startedAt = Date.now();
  try {
    const storageOk = await checkStore();
    const customerDb = await checkCustomerDb();
    const ok = storageOk && customerDb.ok;
    json(res, ok ? 200 : 500, {
      ok,
      authorizedBy,
      storage: persistentStoreConfigured() ? "redis" : "memory",
      customerDb,
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
