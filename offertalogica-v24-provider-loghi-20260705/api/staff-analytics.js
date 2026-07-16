import { json, method } from "../lib/http.js";
import { listCustomerAnalytics } from "../lib/customerDb.js";

function requestToken(req) {
  const auth = String(req.headers.authorization || "");
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const url = new URL(req.url || "/api/staff-analytics", `https://${req.headers.host || "offertalogica.it"}`);
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

  const url = new URL(req.url || "/api/staff-analytics", `https://${req.headers.host || "offertalogica.it"}`);
  const limit = url.searchParams.get("limit") || 200;
  const result = await listCustomerAnalytics({ limit });

  json(res, result.ok ? 200 : 500, {
    ...result,
    authorizedBy,
    checkedAt: new Date().toISOString(),
  });
}
