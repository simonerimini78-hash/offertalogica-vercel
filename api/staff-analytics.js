import { json, method, requireAllowedOrigin } from "../lib/http.js";
import { deleteCustomerAnalytics, listCustomerAnalytics } from "../lib/customerDb.js";
import { requireStaffSession } from "../lib/staffSessionAuth.js";

function bodyObject(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(String(req.body || "{}"));
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  if (!method(req, res, ["GET", "DELETE"])) return;
  const identity = await requireStaffSession(req, res, {
    roles: req.method === "DELETE" ? ["admin"] : ["reviewer", "admin"],
    allowHealth: req.method === "GET",
  });
  if (!identity) return;
  const authorizedBy = identity.authorizedBy;

  const url = new URL(req.url || "/api/staff-analytics", `https://${req.headers.host || "offertalogica.it"}`);
  if (req.method === "DELETE") {
    if (authorizedBy !== "supabase" || identity.staff.role !== "admin") {
      return json(res, 403, { ok: false, error: "Operazione riservata agli amministratori" });
    }
    if (!requireAllowedOrigin(req, res)) return;

    const body = bodyObject(req);
    const id = Number(url.searchParams.get("id") || body.id || 0);
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const resetAll = url.searchParams.get("scope") === "all" || body.scope === "all";
    const bulk = ids.length > 0;
    const expectedConfirmation = resetAll ? "AZZERA_ANALYTICS" : bulk ? "ELIMINA_ANALYTICS_VISIBILI" : "ELIMINA_EVENTO";
    const confirmation = String(req.headers["x-staff-confirmation"] || "").trim();
    if (confirmation !== expectedConfirmation || (!id && !bulk && !resetAll)) {
      return json(res, 400, { ok: false, error: "Conferma eliminazione non valida" });
    }

    const result = await deleteCustomerAnalytics({ id, ids, all: resetAll });
    return json(res, result.ok ? 200 : 500, {
      ...result,
      authorizedBy,
      checkedAt: new Date().toISOString(),
    });
  }

  const limit = url.searchParams.get("limit") || 200;
  const result = await listCustomerAnalytics({ limit });

  json(res, result.ok ? 200 : 500, {
    ...result,
    authorizedBy,
    checkedAt: new Date().toISOString(),
  });
}
