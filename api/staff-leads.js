import { json, method, requireAllowedOrigin } from "../lib/http.js";
import { deleteCustomerLeads, listCustomerLeads } from "../lib/customerDb.js";
import { del } from "../lib/store.js";
import { requireStaffSession } from "../lib/staffSessionAuth.js";

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
  });
  if (!identity) return;
  const authorizedBy = identity.authorizedBy;

  const url = new URL(req.url || "/api/staff-leads", `https://${req.headers.host || "offertalogica.it"}`);
  if (req.method === "DELETE") {
    if (authorizedBy !== "supabase" || identity.staff.role !== "admin") {
      return json(res, 403, { ok: false, error: "Operazione riservata agli amministratori" });
    }
    if (!requireAllowedOrigin(req, res)) return;

    const id = String(url.searchParams.get("id") || "").trim();
    const resetAll = url.searchParams.get("scope") === "all";
    const expectedConfirmation = resetAll ? "AZZERA_LEAD" : "ELIMINA_LEAD";
    const confirmation = String(req.headers["x-staff-confirmation"] || "").trim();
    if (confirmation !== expectedConfirmation || (!id && !resetAll)) {
      return json(res, 400, { ok: false, error: "Conferma eliminazione non valida" });
    }

    const result = await deleteCustomerLeads({ id, all: resetAll });
    if (result.ok) {
      await Promise.allSettled((result.deletedIds || []).map((leadId) => del(`lead:${leadId}`)));
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
