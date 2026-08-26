import { json, method, requireAllowedOrigin } from "../lib/http.js";
import { deleteCustomerLeads, listCustomerLeads } from "../lib/customerDb.js";
import { premiumAiConfig, readBearerToken } from "../lib/premiumAiBackend.js";
import { isStaffAdminRole } from "../lib/staffRoles.js";
import { del } from "../lib/store.js";
import { requireStaffSession } from "../lib/staffSessionAuth.js";
import { writeStaffAudit } from "../lib/staffAudit.js";

const MANAGEMENT_RELEASE = "0.36.68";
const CUSTOMER_PAGE_SIZE = 1000;
const CUSTOMER_MAX_ROWS = 20000;
const BUSINESS_ALIASES = new Set(["business", "azienda", "aziende", "piva", "p.iva", "impresa"]);
const CONSUMER_ALIASES = new Set(["privato", "consumer", "casa", "domestico", "persona"]);

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

function cleanBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function legacyJwt(value) {
  return String(value || "").split(".").length === 3;
}

function customerDbConfig() {
  const premium = premiumAiConfig();
  return {
    url: cleanBaseUrl(
      process.env.CUSTOMER_DB_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      premium.supabaseUrl ||
      "",
    ),
    key: String(
      process.env.CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      premium.serviceKey ||
      "",
    ).trim(),
  };
}

function serviceReadHeaders(key) {
  const headers = { apikey: key, Accept: "application/json" };
  if (legacyJwt(key)) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function normalizeManagementMonth(value) {
  const month = String(value || "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : "";
}

function validManagementInterval(period = {}) {
  const from = new Date(period?.effective_from || 0);
  const to = new Date(period?.effective_to || 0);
  return Number.isFinite(from.getTime()) && Number.isFinite(to.getTime()) && from < to;
}

async function callManagementRpc(accessToken, month) {
  const config = premiumAiConfig();
  if (!config.supabaseUrl || !config.serviceKey) throw new Error("Configurazione Supabase Staff non disponibile");
  const response = await fetch(`${cleanBaseUrl(config.supabaseUrl)}/rest/v1/rpc/staff_owner_management_month`, {
    method: "POST",
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ p_month: month }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.message || payload?.error || payload?.hint || `HTTP ${response.status}`;
    throw new Error(`Gestionale Supabase non disponibile: ${detail}`);
  }
  if (!payload || payload.ok === false) throw new Error(payload?.error || "Risposta gestionale non valida");
  return payload;
}

function buildPeriodQuery(select, period, limit, offset) {
  const query = new URLSearchParams();
  query.set("select", select);
  query.append("created_at", `gte.${period.effective_from}`);
  query.append("created_at", `lt.${period.effective_to}`);
  query.set("order", "created_at.asc");
  query.set("limit", String(limit));
  query.set("offset", String(offset));
  return query;
}

async function fetchCustomerPage(config, table, select, period, offset, limit = CUSTOMER_PAGE_SIZE) {
  const query = buildPeriodQuery(select, period, limit, offset);
  const response = await fetch(`${config.url}/rest/v1/${table}?${query.toString()}`, {
    method: "GET",
    headers: serviceReadHeaders(config.key),
  });
  if (!response.ok) throw new Error(`Customer DB ${table}: HTTP ${response.status}`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

async function fetchCustomerPeriodRows(config, table, select, period) {
  if (!validManagementInterval(period)) return [];
  const rows = [];
  for (let offset = 0; offset < CUSTOMER_MAX_ROWS; offset += CUSTOMER_PAGE_SIZE) {
    const page = await fetchCustomerPage(config, table, select, period, offset);
    rows.push(...page);
    if (page.length < CUSTOMER_PAGE_SIZE) return rows;
  }
  const overflow = await fetchCustomerPage(config, table, select, period, CUSTOMER_MAX_ROWS, 1);
  if (overflow.length) throw new Error(`Customer DB ${table}: periodo oltre il limite di lettura sicura`);
  return rows;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function managementPercentage(part, total) {
  const numerator = finiteNumber(part);
  const denominator = finiteNumber(total);
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function normalizeManagementCustomerSegment(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (BUSINESS_ALIASES.has(normalized)) return "business";
  if (CONSUMER_ALIASES.has(normalized)) return "consumer";
  return "unknown";
}

function blankManagementSegment() {
  return {
    events: 0,
    leads: 0,
    pdf_documents: 0,
    pdf_events_without_document_count: 0,
    pdf_analyses_started: 0,
    pdf_analyses_completed: 0,
    comparisons: 0,
    otp_sent: 0,
    otp_verified: 0,
    offers_unlocked: 0,
    offer_redirects: 0,
    consultant_requests: 0,
    expected_lead_commission_eur: 0,
  };
}

function managementPayload(row = {}) {
  return row?.payload && typeof row.payload === "object" ? row.payload : {};
}

function managementEventType(row = {}) {
  return String(row?.event_type || row?.eventType || "").trim();
}

function managementLeadId(row = {}) {
  return String(row?.lead_id || row?.leadId || "").trim();
}

function managementEventSegment(row = {}) {
  const payload = managementPayload(row);
  return normalizeManagementCustomerSegment(
    payload.customerType ?? payload.customer_type ?? row.customerType ?? row.customer_type,
  );
}

function managementPdfDocuments(row = {}) {
  const payload = managementPayload(row);
  for (const value of [payload.fileCount, payload.pdfDocumentCount, payload.documentCount]) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return null;
}

function managementExpectedCommission(row = {}) {
  if (managementEventType(row) !== "offer_partner_consent") return 0;
  const payload = managementPayload(row);
  const value = finiteNumber(payload?.monetization?.expectedCommission);
  return value === null || value < 0 ? 0 : value;
}

function incrementManagementEvent(segment, eventType, row) {
  segment.events += 1;
  if (eventType === "pdf_analysis_started") {
    segment.pdf_analyses_started += 1;
    const documents = managementPdfDocuments(row);
    if (documents === null) segment.pdf_events_without_document_count += 1;
    else segment.pdf_documents += documents;
  }
  if (eventType === "pdf_analysis_completed") segment.pdf_analyses_completed += 1;
  if (eventType === "comparison_completed") segment.comparisons += 1;
  if (eventType === "otp_sent") segment.otp_sent += 1;
  if (eventType === "otp_verified") segment.otp_verified += 1;
  if (eventType === "offers_unlocked") segment.offers_unlocked += 1;
  if (eventType === "offer_redirect") segment.offer_redirects += 1;
  if (eventType === "offer_request_recorded") segment.consultant_requests += 1;
  segment.expected_lead_commission_eur += managementExpectedCommission(row);
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function summarizeManagementSitePeriod({ events = [], leads = [] } = {}) {
  const segments = {
    consumer: blankManagementSegment(),
    business: blankManagementSegment(),
    unknown: blankManagementSegment(),
  };
  const linkedLeadIds = new Set();

  for (const row of Array.isArray(events) ? events : []) {
    const type = managementEventType(row);
    if (!type) continue;
    const segmentKey = managementEventSegment(row);
    const segment = segments[segmentKey] || segments.unknown;
    incrementManagementEvent(segment, type, row);
    const leadId = managementLeadId(row);
    if (leadId) linkedLeadIds.add(leadId);
  }

  for (const row of Array.isArray(leads) ? leads : []) {
    const key = normalizeManagementCustomerSegment(row?.customer_type ?? row?.customerType);
    (segments[key] || segments.unknown).leads += 1;
  }

  for (const segment of Object.values(segments)) {
    segment.expected_lead_commission_eur = roundMoney(segment.expected_lead_commission_eur);
  }

  const total = Object.values(segments).reduce((accumulator, segment) => {
    for (const [key, value] of Object.entries(segment)) {
      accumulator[key] = (accumulator[key] || 0) + Number(value || 0);
    }
    return accumulator;
  }, {});
  total.expected_lead_commission_eur = roundMoney(total.expected_lead_commission_eur);
  total.linked_leads = linkedLeadIds.size;
  total.otp_verification_pct = managementPercentage(total.otp_verified, total.otp_sent);
  total.lead_per_comparison_pct = managementPercentage(total.leads, total.comparisons);
  total.pdf_completion_pct = managementPercentage(total.pdf_analyses_completed, total.pdf_analyses_started);

  return { available: true, segments, total };
}

async function loadManagementSitePeriod(period) {
  const config = customerDbConfig();
  if (!config.url || !config.key) {
    return { available: false, reason: "customer_db_not_configured", segments: null, total: null };
  }
  if (!validManagementInterval(period)) {
    return { ...summarizeManagementSitePeriod({ events: [], leads: [] }), empty_by_baseline: true };
  }
  const [events, leads] = await Promise.all([
    fetchCustomerPeriodRows(
      config,
      process.env.CUSTOMER_DB_EVENTS_TABLE || "lead_events",
      "id,lead_id,event_type,created_at,payload",
      period,
    ),
    fetchCustomerPeriodRows(
      config,
      process.env.CUSTOMER_DB_LEADS_TABLE || "lead_records",
      "id,created_at,customer_type",
      period,
    ),
  ]);
  return summarizeManagementSitePeriod({ events, leads });
}

function managementNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeManagementPeriod(period = {}, site = {}) {
  const premium = period?.activity || {};
  const siteTotal = site?.available === false ? {} : site?.total || {};
  const finance = period?.finance || {};
  const premiumAnalyses = managementNumber(premium.premium_analyses);
  const premiumFailures = managementNumber(premium.premium_analysis_failed);
  const siteAnalyses = managementNumber(siteTotal.pdf_analyses_started);
  const siteFailures = managementNumber(period?.site_ai?.failed);
  const confirmedRevenue = managementNumber(finance.revenue_confirmed_eur);
  const expectedRevenue = managementNumber(finance.revenue_expected_eur);
  const expectedLeadCommission = managementNumber(siteTotal.expected_lead_commission_eur);

  return {
    ...period,
    site,
    totals: {
      pdf_documents: managementNumber(siteTotal.pdf_documents) + managementNumber(premium.premium_bills),
      analyses: siteAnalyses + premiumAnalyses,
      analysis_failures: siteFailures + premiumFailures,
      comparisons: managementNumber(siteTotal.comparisons),
      leads: managementNumber(siteTotal.leads),
      otp_sent: managementNumber(siteTotal.otp_sent),
      otp_verified: managementNumber(siteTotal.otp_verified),
      offers_unlocked: managementNumber(siteTotal.offers_unlocked),
      offer_redirects: managementNumber(siteTotal.offer_redirects),
      consultant_requests: managementNumber(siteTotal.consultant_requests),
      premium_bills: managementNumber(premium.premium_bills),
      premium_checks: managementNumber(premium.premium_checks),
      premium_customers: managementNumber(premium.premium_customers),
      premium_new_paid_subscriptions: managementNumber(premium.premium_new_paid_subscriptions),
      premium_cancellations: managementNumber(premium.premium_cancellations),
    },
    commercial: {
      expected_lead_commission_eur: expectedLeadCommission,
      revenue_confirmed_eur: confirmedRevenue,
      revenue_expected_ledger_eur: expectedRevenue,
      revenue_expected_plus_timestamped_leads_eur: roundMoney(expectedRevenue + expectedLeadCommission),
      lead_commission_confirmed_available: false,
    },
  };
}

function managementQualityNotes(report, currentSite, previousSite) {
  const notes = [];
  if (report?.baseline_at) {
    notes.push("Il punto zero gestionale è attivo: gli eventi precedenti restano archiviati ma non entrano nei conteggi ufficiali.");
  }
  if (currentSite?.available === false) {
    notes.push("Customer DB non disponibile: i dati Sito/lead del mese non sono stati stimati.");
  }
  if (previousSite?.available === false) {
    notes.push("Customer DB non disponibile anche per il confronto col mese precedente.");
  }
  const unknown = Number(currentSite?.segments?.unknown?.events || 0) + Number(currentSite?.segments?.unknown?.leads || 0);
  if (unknown > 0) {
    notes.push(`${unknown} eventi/lead Sito non hanno un segmento Privato/Business determinabile e restano separati.`);
  }
  const pdfWithoutCount = Number(currentSite?.total?.pdf_events_without_document_count || 0);
  if (pdfWithoutCount > 0) {
    notes.push(`${pdfWithoutCount} analisi PDF Sito non contengono nel payload il numero dei documenti: il gestionale non inventa quel conteggio.`);
  }
  notes.push("Le commissioni lead attese derivano solo da eventi offer_partner_consent con timestamp. Non vengono trattate come ricavi confermati.");
  notes.push("Il numero di clienti Premium indica clienti con attività o pagamento nel periodo; non ricostruisce retroattivamente uno stato abbonamento non storicizzato.");
  return notes;
}

async function handleManagementReport(req, res, identity, url) {
  if (String(identity?.staff?.role || "").trim().toLowerCase() !== "owner") {
    return json(res, 403, { ok: false, error: "Gestionale mensile riservato al Proprietario" });
  }

  const month = normalizeManagementMonth(url.searchParams.get("month"));
  if (!month) return json(res, 400, { ok: false, error: "Mese gestionale non valido" });

  const accessToken = readBearerToken(req);
  if (!accessToken) return json(res, 401, { ok: false, error: "Sessione Staff richiesta" });

  try {
    const report = await callManagementRpc(accessToken, month);
    const [currentSite, previousSite] = await Promise.all([
      loadManagementSitePeriod(report.current || {}).catch((error) => ({ available: false, reason: String(error?.message || error) })),
      loadManagementSitePeriod(report.previous || {}).catch((error) => ({ available: false, reason: String(error?.message || error) })),
    ]);
    const current = mergeManagementPeriod(report.current || {}, currentSite);
    const previous = mergeManagementPeriod(report.previous || {}, previousSite);

    return json(res, 200, {
      ok: true,
      release: MANAGEMENT_RELEASE,
      time_zone: report.time_zone || "Europe/Rome",
      month: report.month || month,
      baseline_at: report.baseline_at || null,
      products: Array.isArray(report.products) ? report.products : [],
      current,
      previous,
      quality_notes: managementQualityNotes(report, currentSite, previousSite),
      authorizedBy: identity.authorizedBy,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("staff-leads-management", error);
    return json(res, 500, {
      ok: false,
      error: String(error?.message || error || "Gestionale mensile non disponibile"),
      release: MANAGEMENT_RELEASE,
    });
  }
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

  if (req.method === "GET" && url.searchParams.get("management") === "1") {
    return handleManagementReport(req, res, identity, url);
  }

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
