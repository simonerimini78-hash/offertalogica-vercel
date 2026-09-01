import { json, method, requireAllowedOrigin } from "../lib/http.js";
import { deleteCustomerAnalytics, deleteCustomerLeads, listCustomerLeads } from "../lib/customerDb.js";
import { premiumAiConfig, readBearerToken } from "../lib/premiumAiBackend.js";
import { isStaffAdminRole } from "../lib/staffRoles.js";
import { del } from "../lib/store.js";
import { requireStaffSession } from "../lib/staffSessionAuth.js";
import { writeStaffAudit } from "../lib/staffAudit.js";

const MANAGEMENT_RELEASE = "0.36.91";
const CUSTOMER_PAGE_SIZE = 1000;
const CUSTOMER_MAX_ROWS = 20000;
const BUSINESS_ALIASES = new Set(["business", "azienda", "aziende", "piva", "p.iva", "impresa"]);
const CONSUMER_ALIASES = new Set(["privato", "consumer", "casa", "domestico", "persona"]);
const MANAGEMENT_INTERACTIVE_TOOL_EVENT = "interactive_tool_event";
const MANAGEMENT_NATIVE_TELEMETRY_TOOL_CODES = new Set([
  "fotovoltaico",
  "fotovoltaico_agricoltura",
  "climatizzazione_pdc",
]);
const MANAGEMENT_DERIVED_TELEMETRY_TOOL_CODES = new Set([
  "energia_comparatore",
]);
const MANAGEMENT_UNAVAILABLE_TELEMETRY_TOOL_CODES = new Set([
  "speed_test",
]);
const MANAGEMENT_ENERGY_EVENT_ACTIONS = Object.freeze({
  landing_view: "page_view",
  comparison_started: "started",
  comparison_completed: "completed",
  offer_redirect: "cta_clicked",
});
const MANAGEMENT_SWITCHO_CANONICAL_EVENT = "switcho_landing_opened";
const MANAGEMENT_SWITCHO_FALLBACK_EVENTS = new Set([
  "landing_assisted_click",
  "business_switcho_requested",
  "offer_switcho_redirect",
  "assistance_switcho_redirect",
]);
const MANAGEMENT_SWITCHO_DEDUPE_MS = 15000;
const BUSINESS_DATA_DELETE_MAX_LEADS = 1000;
const BUSINESS_DATA_DELETE_MAX_EVENTS = 5000;
const FALLBACK_BUSINESS_CATALOG = Object.freeze({
  fallback: true,
  lines: [
    { line_code: "energia", label: "Energia", status: "active", lead_enabled: true, monetization_enabled: true, sort_order: 10 },
    { line_code: "fotovoltaico", label: "Fotovoltaico", status: "active", lead_enabled: true, monetization_enabled: true, sort_order: 20 },
    { line_code: "climatizzazione", label: "Pompe di calore / climatizzazione", status: "active", lead_enabled: true, monetization_enabled: true, sort_order: 30 },
  ],
  tools: [
    { tool_code: "speed_test", business_line_code: null, label: "Speed Test", page_path: "/speed-test.html", source_aliases: ["speed_test", "seo_speed_test"], status: "active", lead_enabled: false, monetization_enabled: false, sort_order: 5 },
    { tool_code: "energia_comparatore", business_line_code: "energia", label: "Comparatore luce e gas", page_path: "/", source_aliases: ["energia", "comparatore", "calcolatore", "site_free", "direct"], status: "active", lead_enabled: true, monetization_enabled: true, sort_order: 10 },
    { tool_code: "fotovoltaico", business_line_code: "fotovoltaico", label: "Fotovoltaico", page_path: "/fotovoltaico.html", source_aliases: ["fotovoltaico", "fotovoltaico_business", "seo_fotovoltaico"], status: "active", lead_enabled: true, monetization_enabled: true, sort_order: 20 },
    { tool_code: "fotovoltaico_agricoltura", business_line_code: "fotovoltaico", label: "Fotovoltaico Azienda Agricola", page_path: "/fotovoltaico.html", source_aliases: ["fotovoltaico_agricoltura"], status: "active", lead_enabled: true, monetization_enabled: true, sort_order: 21 },
    { tool_code: "climatizzazione_pdc", business_line_code: "climatizzazione", label: "Pompe di calore / climatizzazione", page_path: "/climatizzazione-pompa-di-calore.html", source_aliases: ["climatizzazione_pdc", "seo_climatizzazione_pdc"], status: "active", lead_enabled: true, monetization_enabled: true, sort_order: 30 },
  ],
});

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

async function callStaffRpc(accessToken, rpcName, body = {}) {
  const config = premiumAiConfig();
  if (!config.supabaseUrl || !config.serviceKey) throw new Error("Configurazione Supabase Staff non disponibile");
  const response = await fetch(`${cleanBaseUrl(config.supabaseUrl)}/rest/v1/rpc/${rpcName}`, {
    method: "POST",
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.message || payload?.error || payload?.hint || `HTTP ${response.status}`;
    throw new Error(`${rpcName}: ${detail}`);
  }
  if (payload?.ok === false) throw new Error(payload?.error || `${rpcName}: risposta non valida`);
  return payload;
}

async function callManagementRpc(accessToken, month) {
  try {
    return await callStaffRpc(accessToken, "staff_owner_management_month", { p_month: month });
  } catch (error) {
    throw new Error(`Gestionale Supabase non disponibile: ${String(error?.message || error)}`);
  }
}

function normalizeBusinessCatalog(value) {
  const validPayload = value && typeof value === "object"
    && Array.isArray(value.lines)
    && Array.isArray(value.tools);
  if (!validPayload) {
    return {
      ...FALLBACK_BUSINESS_CATALOG,
      fallback: true,
      reason: "catalog_response_invalid",
    };
  }
  return {
    fallback: Boolean(value.fallback),
    release: value.release || "P12",
    lines: value.lines,
    tools: value.tools,
    checked_at: value.checked_at || null,
  };
}

async function loadBusinessCatalog(accessToken) {
  try {
    return normalizeBusinessCatalog(await callStaffRpc(accessToken, "staff_owner_business_catalog", { p_include_archived: true }));
  } catch (error) {
    console.warn("staff-business-catalog-fallback", String(error?.message || error));
    return { ...FALLBACK_BUSINESS_CATALOG, reason: String(error?.message || error) };
  }
}

async function loadBusinessEconomics(accessToken, period) {
  if (!validManagementInterval(period)) {
    return { available: true, tools: [], lines: [], unattributed_entries: 0, empty_by_baseline: true };
  }
  try {
    const payload = await callStaffRpc(accessToken, "staff_owner_business_economics_period", {
      p_from: period.effective_from,
      p_to: period.effective_to,
    });
    return { available: true, ...payload };
  } catch (error) {
    return { available: false, tools: [], lines: [], unattributed_entries: 0, reason: String(error?.message || error) };
  }
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

async function fetchCustomerAllRows(config, table, select) {
  const rows = [];
  for (let offset = 0; offset < CUSTOMER_MAX_ROWS; offset += CUSTOMER_PAGE_SIZE) {
    const query = new URLSearchParams({
      select,
      order: "created_at.asc",
      limit: String(CUSTOMER_PAGE_SIZE),
      offset: String(offset),
    });
    const response = await fetch(`${config.url}/rest/v1/${table}?${query.toString()}`, {
      method: "GET",
      headers: serviceReadHeaders(config.key),
    });
    if (!response.ok) throw new Error(`Customer DB ${table}: HTTP ${response.status}`);
    const page = await response.json();
    const list = Array.isArray(page) ? page : [];
    rows.push(...list);
    if (list.length < CUSTOMER_PAGE_SIZE) return rows;
  }
  throw new Error(`Customer DB ${table}: archivio oltre il limite di lettura sicura`);
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

function normalizeCatalogCode(value) {
  return String(value || "").trim().toLowerCase().slice(0, 80);
}

function normalizePagePath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw, "https://offertalogica.it").pathname || "";
  } catch {
    return raw.split(/[?#]/)[0] || "";
  }
}

function catalogToolIndex(catalog = FALLBACK_BUSINESS_CATALOG) {
  const exact = new Map();
  const aliases = new Map();
  const pages = new Map();
  for (const tool of Array.isArray(catalog?.tools) ? catalog.tools : []) {
    const code = normalizeCatalogCode(tool?.tool_code);
    if (!code) continue;
    exact.set(code, tool);
    for (const alias of Array.isArray(tool?.source_aliases) ? tool.source_aliases : []) {
      const key = normalizeCatalogCode(alias);
      if (key && !aliases.has(key)) aliases.set(key, tool);
    }
    const page = normalizePagePath(tool?.page_path);
    if (page && !pages.has(page)) pages.set(page, tool);
  }
  return { exact, aliases, pages };
}

function resolveCatalogTool(catalog, candidate = "", pagePath = "") {
  const index = catalogToolIndex(catalog);
  const code = normalizeCatalogCode(candidate);
  if (code && index.exact.has(code)) return index.exact.get(code);
  if (code && index.aliases.has(code)) return index.aliases.get(code);
  const page = normalizePagePath(pagePath);
  return page && index.pages.has(page) ? index.pages.get(page) : null;
}

function managementLeadTool(row = {}, catalog = FALLBACK_BUSINESS_CATALOG) {
  const record = row?.record && typeof row.record === "object" ? row.record : {};
  const attribution = record?.attribution && typeof record.attribution === "object" ? record.attribution : {};
  const calculation = row?.calculation && typeof row.calculation === "object"
    ? row.calculation
    : record?.calculation && typeof record.calculation === "object" ? record.calculation : {};
  const candidates = [
    attribution.toolCode,
    attribution.tool_code,
    attribution.source,
    calculation.toolCode,
    calculation.tool_code,
    calculation.dataOrigin,
    row?.source,
  ];
  const page = attribution.pagePath || attribution.page_path || "";
  for (const candidate of candidates) {
    const tool = resolveCatalogTool(catalog, candidate, page);
    if (tool) return tool;
  }
  return page ? resolveCatalogTool(catalog, "", page) : null;
}

function managementEventTool(row = {}, catalog = FALLBACK_BUSINESS_CATALOG) {
  const payload = managementPayload(row);
  for (const candidate of [payload.toolCode, payload.tool_code, payload.source, payload.dataOrigin]) {
    const tool = resolveCatalogTool(catalog, candidate, payload.page);
    if (tool) return tool;
  }
  return resolveCatalogTool(catalog, "", payload.page);
}

function managementToolTelemetryMode(tool = {}) {
  const code = normalizeCatalogCode(tool?.tool_code);
  if (MANAGEMENT_NATIVE_TELEMETRY_TOOL_CODES.has(code)) return "native";
  if (MANAGEMENT_DERIVED_TELEMETRY_TOOL_CODES.has(code)) return "derived";
  if (MANAGEMENT_UNAVAILABLE_TELEMETRY_TOOL_CODES.has(code)) return "unavailable";
  return "unknown";
}

function managementEnergyEventEligible(row = {}) {
  const payload = managementPayload(row);
  const page = normalizePagePath(payload.page);
  const source = normalizeCatalogCode(payload.source || payload.dataOrigin);
  return page === "/" || ["energia", "comparatore", "calcolatore", "site_free"].includes(source);
}

function managementBusinessEventAction(row = {}, tool = {}) {
  const eventType = managementEventType(row);
  const payload = managementPayload(row);
  if (eventType === MANAGEMENT_INTERACTIVE_TOOL_EVENT) {
    return normalizeCatalogCode(payload.toolAction || payload.tool_action);
  }
  if (normalizeCatalogCode(tool?.tool_code) === "energia_comparatore" && managementEnergyEventEligible(row)) {
    return MANAGEMENT_ENERGY_EVENT_ACTIONS[eventType] || "";
  }
  return "";
}

function newerIsoDate(currentValue, candidateValue) {
  const current = Date.parse(String(currentValue || ""));
  const candidate = Date.parse(String(candidateValue || ""));
  if (!Number.isFinite(candidate)) return currentValue || null;
  if (!Number.isFinite(current) || candidate > current) return new Date(candidate).toISOString();
  return currentValue || null;
}

function finalizeToolTelemetry(item = {}) {
  const mode = String(item.telemetry_mode || "unknown");
  item.telemetry_status = mode === "unavailable"
    ? "unavailable"
    : item.events > 0
      ? "active"
      : ["native", "derived"].includes(mode)
        ? "ready"
        : "unknown";
  return item;
}

function blankBusinessPerformance(meta = {}) {
  return {
    ...meta,
    events: 0,
    telemetry_mode: "unknown",
    telemetry_status: "unknown",
    last_event_at: null,
    views: 0,
    started: 0,
    completed: 0,
    diagnoses: 0,
    economics_evaluated: 0,
    cta_clicks: 0,
    errors: 0,
    unique_sessions: 0,
    completion_pct: null,
    leads: 0,
    verified_leads: 0,
    monetizable_leads: 0,
    lead_conversion_pct: null,
    expected_commission_eur: 0,
    analyses: 0,
    analysis_failed: 0,
    analysis_unpriced: 0,
    analysis_cost_real_eur: 0,
    analysis_cost_estimated_eur: 0,
    analysis_cost_total_eur: 0,
  };
}

function managementToolTrafficIncluded(row = {}) {
  const payload = managementPayload(row);
  const agent = String(payload.trafficAgent || "").trim().toLowerCase();
  return !["known_bot", "automation"].includes(agent);
}

function incrementBusinessEvent(item, action) {
  item.events += 1;
  if (action === "page_view") item.views += 1;
  if (action === "started") item.started += 1;
  if (action === "completed") item.completed += 1;
  if (action === "diagnosis_completed") item.diagnoses += 1;
  if (action === "economics_evaluated") item.economics_evaluated += 1;
  if (action === "cta_clicked") item.cta_clicks += 1;
  if (action === "error") item.errors += 1;
}

function mergeEconomicPerformance(item, row = {}) {
  item.analyses = Number(row?.analyses || 0);
  item.analysis_failed = Number(row?.failed || 0);
  item.analysis_unpriced = Number(row?.unpriced || 0);
  item.analysis_cost_real_eur = roundMoney(row?.cost_real_eur);
  item.analysis_cost_estimated_eur = roundMoney(row?.cost_estimated_eur);
  item.analysis_cost_total_eur = roundMoney(row?.cost_total_eur ?? (item.analysis_cost_real_eur + item.analysis_cost_estimated_eur));
}

function summarizeBusinessPerformance({ events = [], leads = [], catalog = FALLBACK_BUSINESS_CATALOG, economics = {} } = {}) {
  const toolItems = {};
  const lineItems = {};
  const toolSessions = {};
  const lineSessions = {};
  let filteredTraffic = 0;
  let unattributedLeads = 0;

  for (const line of Array.isArray(catalog?.lines) ? catalog.lines : []) {
    const code = normalizeCatalogCode(line?.line_code);
    if (!code) continue;
    lineItems[code] = blankBusinessPerformance({
      business_line_code: code,
      label: line.label || code,
      status: line.status || "draft",
      lead_enabled: Boolean(line.lead_enabled),
      monetization_enabled: Boolean(line.monetization_enabled),
    });
    lineSessions[code] = new Set();
  }

  for (const tool of Array.isArray(catalog?.tools) ? catalog.tools : []) {
    const code = normalizeCatalogCode(tool?.tool_code);
    if (!code) continue;
    toolItems[code] = blankBusinessPerformance({
      tool_code: code,
      business_line_code: normalizeCatalogCode(tool?.business_line_code) || null,
      label: tool.label || code,
      status: tool.status || "draft",
      lead_enabled: Boolean(tool.lead_enabled),
      monetization_enabled: Boolean(tool.monetization_enabled),
      page_path: tool.page_path || "",
      telemetry_mode: managementToolTelemetryMode(tool),
    });
    toolSessions[code] = new Set();
  }

  for (const row of Array.isArray(events) ? events : []) {
    const tool = managementEventTool(row, catalog);
    const code = normalizeCatalogCode(tool?.tool_code);
    if (!code || !toolItems[code]) continue;
    const action = managementBusinessEventAction(row, tool);
    if (!action) continue;
    if (!managementToolTrafficIncluded(row)) {
      filteredTraffic += 1;
      continue;
    }
    const payload = managementPayload(row);
    incrementBusinessEvent(toolItems[code], action);
    toolItems[code].last_event_at = newerIsoDate(toolItems[code].last_event_at, row?.created_at || row?.createdAt);
    const sessionId = String(payload.sessionId || payload.session_id || "").trim();
    if (sessionId) toolSessions[code].add(sessionId);
    const lineCode = normalizeCatalogCode(tool?.business_line_code);
    if (lineCode && lineItems[lineCode]) {
      incrementBusinessEvent(lineItems[lineCode], action);
      lineItems[lineCode].last_event_at = newerIsoDate(lineItems[lineCode].last_event_at, row?.created_at || row?.createdAt);
      if (sessionId) lineSessions[lineCode].add(sessionId);
    }
  }

  for (const row of Array.isArray(leads) ? leads : []) {
    const tool = managementLeadTool(row, catalog);
    const code = normalizeCatalogCode(tool?.tool_code);
    if (!code || !toolItems[code]) {
      unattributedLeads += 1;
      continue;
    }
    const verified = String(row?.status || "").trim().toLowerCase() === "verified";
    const monetizable = row?.consent_partners === true || row?.consentPartners === true;
    const record = row?.record && typeof row.record === "object" ? row.record : {};
    const commission = finiteNumber(record?.monetization?.expectedCommission);
    const addLead = (item) => {
      item.leads += 1;
      if (verified) item.verified_leads += 1;
      if (monetizable) item.monetizable_leads += 1;
      if (commission !== null && commission >= 0) item.expected_commission_eur += commission;
    };
    addLead(toolItems[code]);
    const lineCode = normalizeCatalogCode(tool?.business_line_code);
    if (lineCode && lineItems[lineCode]) addLead(lineItems[lineCode]);
  }

  const toolEconomics = Object.fromEntries((Array.isArray(economics?.tools) ? economics.tools : []).map(row => [normalizeCatalogCode(row?.tool_code), row]));
  const lineEconomics = Object.fromEntries((Array.isArray(economics?.lines) ? economics.lines : []).map(row => [normalizeCatalogCode(row?.business_line_code), row]));

  for (const [code, item] of Object.entries(toolItems)) {
    item.unique_sessions = toolSessions[code]?.size || 0;
    item.completion_pct = managementPercentage(item.completed, item.started);
    item.lead_conversion_pct = managementPercentage(item.leads, item.unique_sessions);
    item.expected_commission_eur = roundMoney(item.expected_commission_eur);
    if (toolEconomics[code]) mergeEconomicPerformance(item, toolEconomics[code]);
    finalizeToolTelemetry(item);
  }
  for (const [code, item] of Object.entries(lineItems)) {
    item.unique_sessions = lineSessions[code]?.size || 0;
    item.completion_pct = managementPercentage(item.completed, item.started);
    item.lead_conversion_pct = managementPercentage(item.leads, item.unique_sessions);
    item.expected_commission_eur = roundMoney(item.expected_commission_eur);
    if (lineEconomics[code]) mergeEconomicPerformance(item, lineEconomics[code]);
  }

  return {
    tools: {
      available: true,
      filtered_traffic: filteredTraffic,
      items: toolItems,
      unattributed_economic_entries: Number(economics?.unattributed_entries || 0),
      economics_available: economics?.available !== false,
    },
    business_lines: {
      available: true,
      items: lineItems,
      unattributed_leads: unattributedLeads,
      unattributed_economic_entries: Number(economics?.unattributed_entries || 0),
      economics_available: economics?.available !== false,
    },
  };
}

function managementEventDate(row = {}) {
  const value = Date.parse(String(row?.created_at || row?.createdAt || ""));
  return Number.isFinite(value) ? value : null;
}

function managementEventSessionId(row = {}) {
  const payload = managementPayload(row);
  return String(payload.sessionId || payload.session_id || "").trim().slice(0, 120);
}

function managementSwitchoRoute(row = {}) {
  const type = managementEventType(row);
  const payload = managementPayload(row);
  if (type === "business_switcho_requested") return "business";
  if (type === "offer_switcho_redirect") return "offer_not_activatable";
  if (type === "assistance_switcho_redirect") return "assistance";
  if (type === "landing_assisted_click") return "landing_assisted";
  const source = normalizeCatalogCode(payload.source);
  if (source === "business") return "business";
  if (source === "offer_not_activatable") return "offer_not_activatable";
  if (source === "landing_assisted") return "landing_assisted";
  if (source.startsWith("assistance_")) return "assistance";
  return "other";
}

function managementSwitchoFallbackEligible(row = {}) {
  const type = managementEventType(row);
  if (!MANAGEMENT_SWITCHO_FALLBACK_EVENTS.has(type)) return false;
  if (type !== "landing_assisted_click") return true;
  const payload = managementPayload(row);
  return normalizeCatalogCode(payload.destinationType) === "switcho" && payload.redirect !== false;
}

function switchoCanonicalNear(row, canonicalRows = []) {
  const sessionId = managementEventSessionId(row);
  const route = managementSwitchoRoute(row);
  const at = managementEventDate(row);
  return canonicalRows.some(candidate => {
    if (managementSwitchoRoute(candidate) !== route) return false;
    const candidateSession = managementEventSessionId(candidate);
    if (sessionId || candidateSession) return Boolean(sessionId && candidateSession && sessionId === candidateSession);
    const candidateAt = managementEventDate(candidate);
    return at !== null && candidateAt !== null && Math.abs(candidateAt - at) <= MANAGEMENT_SWITCHO_DEDUPE_MS;
  });
}

function summarizeSwitchoJourneys(events = []) {
  const humanRows = (Array.isArray(events) ? events : []).filter(managementToolTrafficIncluded);
  const canonicalRows = humanRows.filter(row => managementEventType(row) === MANAGEMENT_SWITCHO_CANONICAL_EVENT);
  const fallbackRows = humanRows.filter(row => managementSwitchoFallbackEligible(row) && !switchoCanonicalNear(row, canonicalRows));
  const rows = [...canonicalRows, ...fallbackRows].sort((a, b) => (managementEventDate(a) || 0) - (managementEventDate(b) || 0));
  const sessions = new Set();
  const leads = new Set();
  const routes = {
    landing_assisted: 0,
    business: 0,
    offer_not_activatable: 0,
    assistance: 0,
    other: 0,
  };
  let lastEventAt = null;

  const recent = rows.map(row => {
    const payload = managementPayload(row);
    const route = managementSwitchoRoute(row);
    const sessionId = managementEventSessionId(row);
    const leadId = managementLeadId(row);
    if (sessionId) sessions.add(sessionId);
    if (leadId) leads.add(leadId);
    if (Object.prototype.hasOwnProperty.call(routes, route)) routes[route] += 1;
    else routes.other += 1;
    lastEventAt = newerIsoDate(lastEventAt, row?.created_at || row?.createdAt);
    return {
      created_at: row?.created_at || row?.createdAt || null,
      route,
      source: String(payload.source || "").trim().slice(0, 100),
      page: String(payload.page || "").trim().slice(0, 220),
      customer_type: normalizeManagementCustomerSegment(payload.customerType ?? payload.customer_type),
      data_origin: String(payload.dataOrigin || payload.data_origin || "").trim().slice(0, 100),
      lead_linked: Boolean(leadId),
      session_present: Boolean(sessionId),
      offer_id: String(payload.offerId || "").trim().slice(0, 90),
      offer_name: String(payload.offerName || "").trim().slice(0, 160),
      provider: String(payload.provider || "").trim().slice(0, 100),
      fallback: managementEventType(row) !== MANAGEMENT_SWITCHO_CANONICAL_EVENT,
    };
  }).reverse().slice(0, 50);

  return {
    available: true,
    total: rows.length,
    unique_sessions: sessions.size,
    linked_leads: leads.size,
    without_session: rows.filter(row => !managementEventSessionId(row)).length,
    canonical_events: canonicalRows.length,
    fallback_events: fallbackRows.length,
    last_event_at: lastEventAt,
    routes,
    recent,
  };
}

function summarizeManagementSitePeriod({ events = [], leads = [], catalog = FALLBACK_BUSINESS_CATALOG, economics = {} } = {}) {
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
  const performance = summarizeBusinessPerformance({ events, leads, catalog, economics });
  const switcho = summarizeSwitchoJourneys(events);

  return { available: true, segments, total, switcho, ...performance };
}

async function loadManagementSitePeriod(period, catalog, economics) {
  const config = customerDbConfig();
  if (!config.url || !config.key) {
    return { available: false, reason: "customer_db_not_configured", segments: null, total: null };
  }
  if (!validManagementInterval(period)) {
    return { ...summarizeManagementSitePeriod({ events: [], leads: [], catalog, economics }), empty_by_baseline: true };
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
      "id,created_at,status,customer_type,source,consent_partners,calculation,record",
      period,
    ),
  ]);
  return summarizeManagementSitePeriod({ events, leads, catalog, economics });
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

function managementQualityNotes(report, currentSite, previousSite, catalog = {}) {
  const notes = [];
  if (catalog?.fallback) {
    notes.push("Catalogo Business in modalità fallback: le letture restano disponibili, ma le cancellazioni dati vengono bloccate finché il catalogo persistente non torna disponibile.");
  }
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
  const unattributedLeads = Number(currentSite?.business_lines?.unattributed_leads || 0);
  if (unattributedLeads > 0) {
    notes.push(`${unattributedLeads} lead del mese non hanno ancora un'attribuzione certa a una linea business e restano fuori dai KPI per verticale.`);
  }
  const unattributedCosts = Number(currentSite?.business_lines?.unattributed_economic_entries || 0);
  if (unattributedCosts > 0) {
    notes.push(`${unattributedCosts} costi IA Sito del mese non hanno ancora tool/linea attribuibili e restano separati.`);
  }
  if (currentSite?.business_lines?.economics_available === false) {
    notes.push("Dettaglio costi IA per linea/strumento non disponibile: il Gestionale non distribuisce il costo per stima.");
  }
  const switchoFallback = Number(currentSite?.switcho?.fallback_events || 0);
  if (switchoFallback > 0) {
    notes.push(`${switchoFallback} passaggi Switcho sono ricostruiti da eventi di percorso compatibili e deduplicati; dall'hotfix v80-fix1 il riferimento canonico è switcho_landing_opened.`);
  }
  notes.push("I costi IA Sito vengono attribuiti a una linea/strumento solo quando la registrazione economica contiene un riferimento verificabile a tool, sorgente o pagina; il Gestionale non ripartisce costi per stima.");
  notes.push("Per verticale, 'Contatti verificati' indica lead con verifica OTP completata; non equivale automaticamente a qualificazione commerciale.");
  notes.push("Le commissioni lead attese derivano solo da dati commerciali realmente registrati. Non vengono trattate come ricavi confermati.");
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
    const catalog = await loadBusinessCatalog(accessToken);
    const [currentEconomics, previousEconomics] = await Promise.all([
      loadBusinessEconomics(accessToken, report.current || {}),
      loadBusinessEconomics(accessToken, report.previous || {}),
    ]);
    const [currentSite, previousSite] = await Promise.all([
      loadManagementSitePeriod(report.current || {}, catalog, currentEconomics).catch((error) => ({ available: false, reason: String(error?.message || error) })),
      loadManagementSitePeriod(report.previous || {}, catalog, previousEconomics).catch((error) => ({ available: false, reason: String(error?.message || error) })),
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
      business_catalog: catalog,
      current,
      previous,
      quality_notes: managementQualityNotes(report, currentSite, previousSite, catalog),
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

function ownerIdentity(identity) {
  return String(identity?.staff?.role || "").trim().toLowerCase() === "owner";
}

function rpcBoolean(value) {
  return value === true || String(value || "").trim().toLowerCase() === "true";
}

async function handleManagementCatalogMutation(req, res, identity) {
  if (!ownerIdentity(identity)) return json(res, 403, { ok: false, error: "Operazione riservata al Proprietario" });
  if (!requireAllowedOrigin(req, res)) return;
  const accessToken = readBearerToken(req);
  if (!accessToken) return json(res, 401, { ok: false, error: "Sessione Staff richiesta" });
  const body = bodyObject(req);
  const action = String(body.action || "").trim().toLowerCase();

  if (action === "reset_economic_baseline") {
    if (String(body.confirmation || "").trim() !== "RINNOVA_PUNTO_ZERO") {
      return json(res, 400, { ok: false, error: "Conferma rinnovo punto zero non valida" });
    }
    try {
      await writeStaffAudit({
        identity,
        action: "economic_baseline_reset_authorized",
        targetType: "premium_economic_baselines",
        metadata: { history_deleted: false },
        source: "api:staff-leads",
      });
      const result = await callStaffRpc(accessToken, "premium_owner_reset_economic_baseline", {});
      await writeStaffAudit({
        identity,
        action: "economic_baseline_reset_completed",
        targetType: "premium_economic_baselines",
        result: "success",
        metadata: { baseline_at: result?.baseline_at || null, history_deleted: false },
        source: "api:staff-leads",
      }).catch(() => {});
      return json(res, 200, { ok: true, result, checkedAt: new Date().toISOString() });
    } catch (error) {
      await writeStaffAudit({
        identity,
        action: "economic_baseline_reset_failed",
        targetType: "premium_economic_baselines",
        result: "error",
        reason: String(error?.message || error),
        metadata: { history_deleted: false },
        source: "api:staff-leads",
      }).catch(() => {});
      return json(res, 400, { ok: false, error: String(error?.message || error) });
    }
  }

  const definitions = {
    upsert_line: ["staff_owner_upsert_business_line", {
      p_line_code: body.line_code,
      p_label: body.label,
      p_status: body.status || "draft",
      p_lead_enabled: rpcBoolean(body.lead_enabled),
      p_monetization_enabled: rpcBoolean(body.monetization_enabled),
      p_sort_order: Number(body.sort_order ?? 100),
      p_notes: body.notes || "",
    }],
    set_line_status: ["staff_owner_set_business_line_status", { p_line_code: body.line_code, p_status: body.status }],
    delete_line: ["staff_owner_delete_business_line", {
      p_line_code: body.line_code,
      p_confirmation: body.confirmation,
      p_delete_tools: rpcBoolean(body.delete_tools),
    }],
    upsert_tool: ["staff_owner_upsert_business_tool", {
      p_tool_code: body.tool_code,
      p_business_line_code: body.business_line_code || null,
      p_label: body.label,
      p_page_path: body.page_path || "",
      p_source_aliases: Array.isArray(body.source_aliases) ? body.source_aliases : [],
      p_status: body.status || "draft",
      p_lead_enabled: rpcBoolean(body.lead_enabled),
      p_monetization_enabled: rpcBoolean(body.monetization_enabled),
      p_sort_order: Number(body.sort_order ?? 100),
      p_notes: body.notes || "",
    }],
    set_tool_status: ["staff_owner_set_business_tool_status", { p_tool_code: body.tool_code, p_status: body.status }],
    delete_tool: ["staff_owner_delete_business_tool", { p_tool_code: body.tool_code, p_confirmation: body.confirmation }],
  };
  const target = definitions[action];
  if (!target) return json(res, 400, { ok: false, error: "Azione catalogo non valida" });
  try {
    const result = await callStaffRpc(accessToken, target[0], target[1]);
    return json(res, 200, { ok: true, result, checkedAt: new Date().toISOString() });
  } catch (error) {
    return json(res, 400, { ok: false, error: String(error?.message || error) });
  }
}

function targetToolCodes(catalog, scope, code) {
  const normalized = normalizeCatalogCode(code);
  const tools = Array.isArray(catalog?.tools) ? catalog.tools : [];
  if (scope === "business_tool_data") {
    const tool = tools.find(item => normalizeCatalogCode(item?.tool_code) === normalized);
    return tool ? new Set([normalizeCatalogCode(tool.tool_code)]) : new Set();
  }
  if (scope === "business_line_data") {
    return new Set(tools
      .filter(tool => normalizeCatalogCode(tool?.business_line_code) === normalized)
      .map(tool => normalizeCatalogCode(tool?.tool_code))
      .filter(Boolean));
  }
  return new Set();
}

function destructiveCandidateTools(catalog, candidate = "") {
  const normalized = normalizeCatalogCode(candidate);
  if (!normalized) return [];
  const tools = Array.isArray(catalog?.tools) ? catalog.tools : [];
  const exact = tools.filter(tool => normalizeCatalogCode(tool?.tool_code) === normalized);
  if (exact.length) return exact;
  return tools.filter(tool => (Array.isArray(tool?.source_aliases) ? tool.source_aliases : [])
    .some(alias => normalizeCatalogCode(alias) === normalized));
}

function destructivePageTools(catalog, pagePath = "") {
  const page = normalizePagePath(pagePath);
  if (!page) return [];
  return (Array.isArray(catalog?.tools) ? catalog.tools : [])
    .filter(tool => normalizePagePath(tool?.page_path) === page);
}

function destructiveAttributionMatches(row = {}, catalog = {}, targetCodes = new Set(), kind = "event") {
  const candidates = [];
  let page = "";
  if (kind === "lead") {
    const record = row?.record && typeof row.record === "object" ? row.record : {};
    const attribution = record?.attribution && typeof record.attribution === "object" ? record.attribution : {};
    const calculation = row?.calculation && typeof row.calculation === "object"
      ? row.calculation
      : record?.calculation && typeof record.calculation === "object" ? record.calculation : {};
    candidates.push(
      attribution.toolCode, attribution.tool_code, attribution.source,
      calculation.toolCode, calculation.tool_code, calculation.dataOrigin, row?.source,
    );
    page = attribution.pagePath || attribution.page_path || "";
  } else {
    const payload = managementPayload(row);
    candidates.push(payload.toolCode, payload.tool_code, payload.source, payload.dataOrigin);
    page = payload.page || "";
  }

  for (const candidate of candidates) {
    const matches = destructiveCandidateTools(catalog, candidate);
    if (!matches.length) continue;
    if (matches.length !== 1) return false;
    return targetCodes.has(normalizeCatalogCode(matches[0]?.tool_code));
  }

  const pageMatches = destructivePageTools(catalog, page);
  if (!pageMatches.length) return false;
  const possibleCodes = new Set(pageMatches.map(tool => normalizeCatalogCode(tool?.tool_code)).filter(Boolean));
  return possibleCodes.size > 0 && [...possibleCodes].every(toolCode => targetCodes.has(toolCode));
}

async function deleteLeadBatches(ids = []) {
  const deletedIds = [];
  for (let index = 0; index < ids.length; index += 150) {
    const result = await deleteCustomerLeads({ ids: ids.slice(index, index + 150) });
    if (!result.ok) throw new Error(result.error || result.status || "lead_delete_failed");
    deletedIds.push(...(result.deletedIds || []));
  }
  return deletedIds;
}

async function deleteEventBatches(ids = []) {
  let deletedCount = 0;
  for (let index = 0; index < ids.length; index += 250) {
    const result = await deleteCustomerAnalytics({ ids: ids.slice(index, index + 250) });
    if (!result.ok) throw new Error(result.error || result.status || "analytics_delete_failed");
    deletedCount += Number(result.deletedCount || 0);
  }
  return deletedCount;
}

async function handleBusinessDataDeletion(req, res, identity, body, confirmation) {
  if (!ownerIdentity(identity)) return json(res, 403, { ok: false, error: "Eliminazione dati riservata al Proprietario" });
  const scope = String(body.scope || "").trim().toLowerCase();
  const code = String(body.code || "").trim().toLowerCase();
  const expected = scope === "business_line_data" ? "ELIMINA_DATI_LINEA" : scope === "business_tool_data" ? "ELIMINA_DATI_STRUMENTO" : "";
  if (!expected || confirmation !== expected || !code) return json(res, 400, { ok: false, error: "Conferma eliminazione dati non valida" });

  const accessToken = readBearerToken(req);
  if (!accessToken) return json(res, 401, { ok: false, error: "Sessione Staff richiesta" });
  const catalog = await loadBusinessCatalog(accessToken);
  if (catalog?.fallback) {
    return json(res, 503, {
      ok: false,
      error: "Catalogo Business persistente non disponibile: eliminazione dati bloccata per sicurezza",
    });
  }
  const codes = targetToolCodes(catalog, scope, code);
  if (!codes.size) return json(res, 404, { ok: false, error: "Linea o strumento non trovato nel catalogo" });

  const config = customerDbConfig();
  if (!config.url || !config.key) return json(res, 503, { ok: false, error: "Customer DB non configurato" });
  let leads;
  let events;
  try {
    [leads, events] = await Promise.all([
      fetchCustomerAllRows(config, process.env.CUSTOMER_DB_LEADS_TABLE || "lead_records", "id,created_at,status,customer_type,source,consent_partners,calculation,record"),
      fetchCustomerAllRows(config, process.env.CUSTOMER_DB_EVENTS_TABLE || "lead_events", "id,lead_id,event_type,created_at,payload"),
    ]);
  } catch (error) {
    return json(res, 503, { ok: false, error: String(error?.message || error) });
  }

  const leadIds = (Array.isArray(leads) ? leads : [])
    .filter(row => destructiveAttributionMatches(row, catalog, codes, "lead"))
    .map(row => String(row.id || "").trim())
    .filter(Boolean);
  const leadIdSet = new Set(leadIds);
  const eventIds = (Array.isArray(events) ? events : [])
    .filter(row => destructiveAttributionMatches(row, catalog, codes, "event"))
    .filter(row => !leadIdSet.has(String(row.lead_id || "").trim()))
    .map(row => Number(row.id))
    .filter(value => Number.isSafeInteger(value) && value > 0);

  if (leadIds.length > BUSINESS_DATA_DELETE_MAX_LEADS || eventIds.length > BUSINESS_DATA_DELETE_MAX_EVENTS) {
    return json(res, 409, {
      ok: false,
      error: "Archivio troppo grande per una cancellazione sicura in una singola richiesta",
      lead_count: leadIds.length,
      standalone_event_count: eventIds.length,
      max_leads: BUSINESS_DATA_DELETE_MAX_LEADS,
      max_events: BUSINESS_DATA_DELETE_MAX_EVENTS,
    });
  }

  const auditMetadata = {
    scope,
    code,
    tool_codes: [...codes],
    lead_count: leadIds.length,
    standalone_event_count: eventIds.length,
    economic_data_deleted: false,
  };
  try {
    await writeStaffAudit({
      identity,
      action: "business_data_deletion_authorized",
      targetType: scope,
      targetId: code,
      metadata: auditMetadata,
      source: "api:staff-leads",
    });
  } catch (error) {
    return json(res, 503, { ok: false, error: "Audit Staff non disponibile: eliminazione non eseguita" });
  }

  try {
    const deletedLeadIds = await deleteLeadBatches(leadIds);
    const deletedStandaloneEvents = await deleteEventBatches(eventIds);
    await Promise.allSettled(deletedLeadIds.map(leadId => del(`lead:${leadId}`)));
    await writeStaffAudit({
      identity,
      action: "business_data_deletion_completed",
      targetType: scope,
      targetId: code,
      metadata: { ...auditMetadata, deleted_leads: deletedLeadIds.length, deleted_standalone_events: deletedStandaloneEvents },
      source: "api:staff-leads",
    }).catch(() => {});
    return json(res, 200, {
      ok: true,
      code,
      scope,
      deleted_leads: deletedLeadIds.length,
      deleted_standalone_events: deletedStandaloneEvents,
      economic_data_deleted: false,
      economic_note: "I movimenti economici restano nello storico ufficiale: per essi si usano esclusione o rettifica.",
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    await writeStaffAudit({
      identity,
      action: "business_data_deletion_failed",
      targetType: scope,
      targetId: code,
      result: "error",
      reason: String(error?.message || error),
      metadata: auditMetadata,
      source: "api:staff-leads",
    }).catch(() => {});
    return json(res, 500, { ok: false, error: String(error?.message || error) });
  }
}

export default async function handler(req, res) {
  if (!method(req, res, ["GET", "POST", "DELETE"])) return;
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

  if (req.method === "POST" && url.searchParams.get("management") === "1") {
    return handleManagementCatalogMutation(req, res, identity);
  }

  if (req.method === "DELETE") {
    if (authorizedBy !== "supabase" || !isStaffAdminRole(identity.staff.role)) {
      return json(res, 403, { ok: false, error: "Operazione riservata agli amministratori" });
    }
    if (!requireAllowedOrigin(req, res)) return;

    const body = bodyObject(req);
    const confirmation = String(req.headers["x-staff-confirmation"] || "").trim();
    if (["business_line_data", "business_tool_data"].includes(String(body.scope || "").trim().toLowerCase())) {
      return handleBusinessDataDeletion(req, res, identity, body, confirmation);
    }
    const id = String(url.searchParams.get("id") || body.id || "").trim();
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const resetAll = url.searchParams.get("scope") === "all" || body.scope === "all";
    const bulk = ids.length > 0;
    const expectedConfirmation = resetAll ? "AZZERA_LEAD" : bulk ? "ELIMINA_LEAD_VISIBILI" : "ELIMINA_LEAD";
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
