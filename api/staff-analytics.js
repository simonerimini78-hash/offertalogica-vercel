import { json, method } from "../lib/http.js";
import { listCustomerAnalytics } from "../lib/customerDb.js";
import { requireStaffSession } from "../lib/staffSessionAuth.js";

export default async function handler(req, res) {
  if (!method(req, res, ["GET"])) return;
  const identity = await requireStaffSession(req, res, {
    roles: ["reviewer", "admin"],
    allowHealth: true,
  });
  if (!identity) return;
  const authorizedBy = identity.authorizedBy;

  const url = new URL(req.url || "/api/staff-analytics", `https://${req.headers.host || "offertalogica.it"}`);
  const limit = url.searchParams.get("limit") || 200;
  const result = await listCustomerAnalytics({ limit });

  json(res, result.ok ? 200 : 500, {
    ...result,
    authorizedBy,
    checkedAt: new Date().toISOString(),
  });
}
