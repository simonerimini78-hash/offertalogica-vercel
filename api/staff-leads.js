import { json, method, requireAllowedOrigin } from "../lib/http.js";
import { deleteCustomerLeads, listCustomerLeads } from "../lib/customerDb.js";
import { isStaffAdminRole } from "../lib/staffRoles.js";
import { del } from "../lib/store.js";
import { requireStaffSession } from "../lib/staffSessionAuth.js";
import { writeStaffAudit } from "../lib/staffAudit.js";


function bodyObject(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(String(req.body || "{}"));
  } catch {
    return {};
  }
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function toCsv(leads) {
  const headers = [
    "id",
    "createdAt",
    "status",
    "customerType",
    "name",
    "email",
    "phone",
    "source",
    "dataOrigin",
    "pdfDocumentCount",
    "currentProvider",
    "luceConsumoKwh",
    "gasConsumoSmc",
    "lucePrezzoEurKwh",
    "gasPrezzoEurSmc",
    "quotaFissaLuceAnnua",
    "quotaFissaGasAnnua",
    "potenzaKw",
    "pod",
    "pdr",
    "tipoPrezzo",
    "tipoFornitura",
    "bestSaving",
    "consentService",
    "consentPartners",
    "selectedProvider",
    "selectedOffer",
    "destinationType",
    "destinationStatus",
    "monetizationStatus",
    "network",
    "expectedCommission",
  ];
  const rows = leads.map((lead) => ({
    id: lead.id,
    createdAt: lead.createdAt,
    status: lead.status,
    customerType: lead.customerType,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    source: lead.source,
    dataOrigin: lead.dataOrigin,
    pdfDocumentCount: lead.pdfDocumentCount,
    currentProvider: lead.currentSupply?.provider || "",
    luceConsumoKwh: lead.currentSupply?.luceConsumoKwh ?? "",
    gasConsumoSmc: lead.currentSupply?.gasConsumoSmc ?? "",
    lucePrezzoEurKwh: lead.currentSupply?.lucePrezzoEurKwh ?? "",
    gasPrezzoEurSmc: lead.currentSupply?.gasPrezzoEurSmc ?? "",
    quotaFissaLuceAnnua: lead.currentSupply?.quotaFissaLuceAnnua ?? "",
    quotaFissaGasAnnua: lead.currentSupply?.quotaFissaGasAnnua ?? "",
    potenzaKw: lead.comparisonProfile?.potenzaKw ?? lead.pdfData?.potenza_impegnata_kw ?? "",
    pod: lead.pdfData?.pod || "",
    pdr: lead.pdfData?.pdr || "",
    tipoPrezzo: lead.comparisonProfile?.tipoPrezzo || "",
    tipoFornitura: lead.comparisonProfile?.tipoFornitura || "",
    bestSaving: lead.bestSaving,
    consentService: lead.consents?.service,
    consentPartners: lead.consents?.partners,
    selectedProvider: lead.selectedOffer?.provider || "",
    selectedOffer: lead.selectedOffer?.name || "",
    destinationType: lead.selectedOffer?.destinationType || "",
    destinationStatus: lead.selectedOffer?.destinationStatus || "",
    monetizationStatus: lead.monetization?.status || "",
    network: lead.monetization?.network || "",
    expectedCommission: lead.monetization?.expectedCommission ?? "",
  }));
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
}

export default async function handler(req, res) {
  if (!method(req, res, ["GET", "DELETE"])) return;
  const identity = await requireStaffSession(req, res, {
    roles: ["admin"],
    permissions: req.method === "DELETE"
      ? ["view_leads", "delete_records"]
      : ["view_leads", "view_control"],
    permissionMode: req.method === "DELETE" ? "all" : "any",
  });
  if (!identity) return;
  const authorizedBy = identity.authorizedBy;

  const url = new URL(req.url || "/api/staff-leads", `https://${req.headers.host || "offertalogica.it"}`);
  if (req.method === "DELETE") {
    if (authorizedBy !== "supabase" || !isStaffAdminRole(identity.staff.role)) {
      return json(res, 403, { ok: false, error: "Operazione riservata agli amministratori" });
    }
    if (!requireAllowedOrigin(req, res)) return;

    const body = bodyObject(req);
    const id = String(url.searchParams.get("id") || body.id || "").trim();
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const resetAll = url.searchParams.get("scope") === "all" || body.scope === "all";
    const bulk = ids.length > 0;
    const expectedConfirmation = resetAll ? "AZZERA_LEAD" : bulk ? "ELIMINA_LEAD_VISIBILI" : "ELIMINA_LEAD";
    const confirmation = String(req.headers["x-staff-confirmation"] || "").trim();
    if (confirmation !== expectedConfirmation || (!id && !bulk && !resetAll)) {
      return json(res, 400, { ok: false, error: "Conferma eliminazione non valida" });
    }

    const requestedIds = [...new Set(
      [id, ...ids]
        .map((value) => String(value || "").trim().slice(0, 100))
        .filter((value) => /^[A-Za-z0-9_-]+$/.test(value))
    )].slice(0, 500);
    const targetId = !resetAll && requestedIds.length === 1 ? requestedIds[0] : null;
    const auditMetadata = {
      scope: resetAll ? "all" : requestedIds.length > 1 ? "bulk" : "single",
      requested_count: resetAll ? null : requestedIds.length,
      requested_ids: resetAll ? [] : requestedIds,
    };

    try {
      await writeStaffAudit({
        identity,
        action: "lead_deletion_authorized",
        targetType: "lead_records",
        targetId,
        metadata: auditMetadata,
        source: "api:staff-leads",
      });
    } catch (error) {
      console.error("staff-leads-audit", error);
      return json(res, 503, { ok: false, error: "Audit Staff non disponibile: eliminazione non eseguita" });
    }

    const result = await deleteCustomerLeads({ id, ids, all: resetAll });
    if (result.ok) {
      await Promise.allSettled((result.deletedIds || []).map((leadId) => del(`lead:${leadId}`)));
    }

    try {
      await writeStaffAudit({
        identity,
        action: result.ok ? "lead_deletion_completed" : "lead_deletion_failed",
        targetType: "lead_records",
        targetId,
        result: result.ok ? "success" : "error",
        reason: result.ok ? "" : String(result.error || result.status || "delete_failed"),
        metadata: {
          ...auditMetadata,
          deleted_count: result.deletedCount ?? null,
          deleted_ids: Array.isArray(result.deletedIds) ? result.deletedIds.slice(0, 500) : [],
          reset_all: Boolean(result.resetAll),
        },
        source: "api:staff-leads",
      });
    } catch (error) {
      console.error("staff-leads-audit-finalize", error);
    }

    return json(res, result.ok ? 200 : 500, {
      ...result,
      authorizedBy,
      checkedAt: new Date().toISOString(),
    });
  }

  const limit = url.searchParams.get("limit") || 50;
  const format = String(url.searchParams.get("format") || "json").toLowerCase();
  const result = await listCustomerLeads({ limit });

  if (format === "csv") {
    res.statusCode = result.ok ? 200 : 500;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `attachment; filename="offertalogica-leads-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.end(toCsv(result.leads || []));
    return;
  }

  json(res, result.ok ? 200 : 500, {
    ...result,
    authorizedBy,
    checkedAt: new Date().toISOString(),
  });
}
