import crypto from "node:crypto";

const SUPABASE_URL =
  process.env.CUSTOMER_DB_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";

const LEADS_TABLE = process.env.CUSTOMER_DB_LEADS_TABLE || "lead_records";
const EVENTS_TABLE = process.env.CUSTOMER_DB_EVENTS_TABLE || "lead_events";

function configured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function baseUrl() {
  return String(SUPABASE_URL || "").replace(/\/+$/, "");
}

function tableUrl(table, query = "") {
  return `${baseUrl()}/rest/v1/${table}${query}`;
}

function isLegacyJwtKey(key) {
  return String(key || "").split(".").length === 3;
}

function headers(prefer = "return=minimal") {
  const output = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
  if (isLegacyJwtKey(SUPABASE_SERVICE_ROLE_KEY)) {
    output.Authorization = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  }
  return output;
}

function cleanUndefined(value) {
  if (Array.isArray(value)) return value.map(cleanUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, cleanUndefined(item)])
  );
}

function hashValue(value) {
  const secret = process.env.CUSTOMER_DB_HASH_SECRET || process.env.OTP_SECRET || "";
  if (!secret || !value) return null;
  return crypto.createHmac("sha256", secret).update(String(value)).digest("hex");
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scrubRecord(lead) {
  const record = cleanUndefined(JSON.parse(JSON.stringify(lead || {})));
  const ipHash = hashValue(record.meta?.ip);
  if (record.meta?.ip) delete record.meta.ip;
  if (ipHash) record.meta = { ...record.meta, ipHash };
  return record;
}

function rowFromLead(lead) {
  const calculation = lead?.calculation || {};
  const consents = lead?.consents || {};
  const proof = consents.proof || {};
  return cleanUndefined({
    id: lead.id,
    created_at: lead.meta?.createdAt || lead.verifiedAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: lead.status || null,
    customer_type: calculation.customerType || "privato",
    name: lead.name || null,
    email: lead.email || null,
    phone: lead.phone || null,
    source: proof.source || null,
    privacy_version: consents.privacyVersion || proof.version || null,
    consent_service: Boolean(consents.service ?? lead.consentService),
    consent_marketing: Boolean(consents.marketing ?? lead.consentMarketing),
    consent_partners: Boolean(consents.partners ?? lead.consentPartners),
    consent_profiling: Boolean(consents.profiling ?? lead.consentProfiling),
    best_saving: numberOrNull(calculation.bestSaving),
    selected_offer: lead.selectedOffer || null,
    calculation,
    record: scrubRecord(lead),
  });
}

async function upsertLeadRow(lead) {
  const response = await fetch(tableUrl(LEADS_TABLE, "?on_conflict=id"), {
    method: "POST",
    headers: headers("resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify([rowFromLead(lead)]),
  });
  if (!response.ok) throw new Error(`Customer DB lead error ${response.status}`);
  return true;
}

async function insertEvent(lead, eventType, payload = {}) {
  const response = await fetch(tableUrl(EVENTS_TABLE), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify([cleanUndefined({
      lead_id: lead.id,
      event_type: eventType,
      created_at: new Date().toISOString(),
      payload: {
        status: lead.status || null,
        selectedOffer: lead.selectedOffer || null,
        monetization: lead.monetization || null,
        notification: lead.notification || null,
        customerType: lead.calculation?.customerType || "privato",
        ...payload,
      },
    })]),
  });
  if (!response.ok) throw new Error(`Customer DB event error ${response.status}`);
  return true;
}

async function insertAnalyticsEvent(event = {}) {
  const eventType = String(event.eventType || "").trim().slice(0, 80);
  if (!eventType) throw new Error("Customer DB event type missing");

  const leadId = String(event.leadId || "").trim().slice(0, 80) || null;
  const response = await fetch(tableUrl(EVENTS_TABLE), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify([cleanUndefined({
      lead_id: leadId,
      event_type: eventType,
      created_at: event.createdAt || new Date().toISOString(),
      payload: {
        sessionId: event.sessionId || null,
        page: event.page || null,
        customerType: event.customerType || null,
        dataOrigin: event.dataOrigin || null,
        source: event.source || null,
        ...event.payload,
      },
    })]),
  });
  if (!response.ok) throw new Error(`Customer DB analytics event error ${response.status}`);
  return true;
}

export function customerDbConfigured() {
  return configured();
}

export async function persistLeadSnapshot(lead, eventType, payload = {}) {
  if (!configured()) return { ok: true, skipped: true, reason: "not_configured" };
  if (!lead?.id) return { ok: false, skipped: false, error: "lead_id_missing" };
  try {
    await upsertLeadRow(lead);
    if (eventType) await insertEvent(lead, eventType, payload);
    return { ok: true, skipped: false };
  } catch (error) {
    return { ok: false, skipped: false, error: error.message || "customer_db_error" };
  }
}

export async function persistAnalyticsEvent(event = {}) {
  if (!configured()) return { ok: true, skipped: true, reason: "not_configured" };
  try {
    await insertAnalyticsEvent(event);
    return { ok: true, skipped: false };
  } catch (error) {
    return { ok: false, skipped: false, error: error.message || "customer_db_event_error" };
  }
}

export async function checkCustomerDb() {
  if (!configured()) return { ok: true, configured: false, status: "not_configured" };
  try {
    const response = await fetch(tableUrl(LEADS_TABLE, "?select=id&limit=1"), {
      method: "GET",
      headers: headers("return=minimal"),
    });
    return {
      ok: response.ok,
      configured: true,
      status: response.ok ? "ready" : `error_${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      status: "error",
      error: error.message || "customer_db_error",
    };
  }
}

function limitValue(value, fallback = 50) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

function mapLeadRow(row) {
  const record = row.record || {};
  const calculation = row.calculation || record.calculation || {};
  const selectedOffer = row.selected_offer || record.selectedOffer || null;
  const monetization = record.monetization || {};
  const current = calculation.currentSupply || calculation.current || calculation.attuale || {};
  const comparisonProfile = calculation.comparisonProfile || {};
  const pdfDocuments = Array.isArray(calculation.pdfDocuments) ? calculation.pdfDocuments : [];
  const luce = current.luce || calculation.luce || {};
  const gas = current.gas || calculation.gas || {};

  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    customerType: row.customer_type,
    name: row.name,
    email: row.email,
    phone: row.phone,
    source: row.source,
    dataOrigin: calculation.dataOrigin || comparisonProfile.dataOrigin || row.source || "",
    pdfDocumentCount: comparisonProfile.pdfDocumentCount ?? pdfDocuments.length,
    bestSaving: row.best_saving,
    privacyVersion: row.privacy_version,
    consents: {
      service: Boolean(row.consent_service),
      partners: Boolean(row.consent_partners),
      marketing: Boolean(row.consent_marketing),
      profiling: Boolean(row.consent_profiling),
    },
    currentSupply: {
      provider: current.provider || current.fornitore || calculation.fornitoreAttuale || "",
      luceConsumoKwh: luce.consumo || luce.consumoKwh || calculation.consumoLuceKwh || null,
      gasConsumoSmc: gas.consumo || gas.consumoSmc || calculation.consumoGasSmc || null,
      lucePrezzoEurKwh: luce.prezzoVariabile ?? luce.prezzo ?? null,
      gasPrezzoEurSmc: gas.prezzoVariabile ?? gas.prezzo ?? null,
      quotaFissaLuceAnnua: luce.quotaFissaAnnua ?? null,
      quotaFissaGasAnnua: gas.quotaFissaAnnua ?? null,
    },
    comparisonProfile: {
      tipoPrezzo: comparisonProfile.tipoPrezzo || "",
      tipoFornitura: comparisonProfile.tipoFornitura || "",
      regioneGas: comparisonProfile.regioneGas || "",
      potenzaKw: comparisonProfile.potenzaKw ?? null,
    },
    selectedOffer: selectedOffer ? {
      id: selectedOffer.id || "",
      provider: selectedOffer.provider || "",
      name: selectedOffer.name || selectedOffer.nome || "",
      destinationType: selectedOffer.destinationType || "",
      destinationStatus: selectedOffer.destinationStatus || "",
    } : null,
    monetization: {
      status: monetization.status || "",
      network: monetization.network || "",
      model: monetization.model || "",
      expectedCommission: monetization.expectedCommission ?? null,
      displayGroup: monetization.displayGroup || "",
      annualCost: monetization.annualCost ?? null,
      annualDelta: monetization.annualDelta ?? null,
      trackedAt: monetization.trackedAt || "",
    },
  };
}

function summaryFromRows(rows) {
  const summary = {
    recentRows: rows.length,
    byStatus: {},
    byCustomerType: {},
    withPartnerConsent: 0,
    withSelectedOffer: 0,
    expectedCommission: 0,
  };

  rows.forEach((row) => {
    summary.byStatus[row.status || "unknown"] = (summary.byStatus[row.status || "unknown"] || 0) + 1;
    summary.byCustomerType[row.customerType || "unknown"] = (summary.byCustomerType[row.customerType || "unknown"] || 0) + 1;
    if (row.consents.partners) summary.withPartnerConsent += 1;
    if (row.selectedOffer) summary.withSelectedOffer += 1;
    const commission = Number(row.monetization.expectedCommission);
    if (Number.isFinite(commission)) summary.expectedCommission += commission;
  });

  summary.expectedCommission = Math.round(summary.expectedCommission * 100) / 100;
  return summary;
}

function mapEventRow(row) {
  const payload = row.payload || {};
  return {
    id: row.id,
    leadId: row.lead_id || "",
    eventType: row.event_type || "",
    createdAt: row.created_at,
    sessionId: payload.sessionId || "",
    page: payload.page || "",
    customerType: payload.customerType || "",
    dataOrigin: payload.dataOrigin || "",
    source: payload.source || payload.leadSource || "",
    leadSource: payload.leadSource || "",
    verified: Boolean(payload.verified),
    bestSaving: numberOrNull(payload.bestSaving),
    pdfDocumentCount: numberOrNull(payload.pdfDocumentCount),
    fileCount: numberOrNull(payload.fileCount),
    successCount: numberOrNull(payload.successCount),
    errorCount: numberOrNull(payload.errorCount),
    visibleOffersCount: numberOrNull(payload.visibleOffersCount),
    activePartnerOffersCount: numberOrNull(payload.activePartnerOffersCount),
    consultantOffersCount: numberOrNull(payload.consultantOffersCount),
    offerId: payload.offerId || "",
    offerName: payload.offerName || "",
    provider: payload.provider || "",
    destinationType: payload.destinationType || "",
    destinationStatus: payload.destinationStatus || "",
    displayGroup: payload.displayGroup || "",
    economyRank: numberOrNull(payload.economyRank),
    displayRank: numberOrNull(payload.displayRank),
    annualCost: numberOrNull(payload.annualCost),
    annualDelta: numberOrNull(payload.annualDelta),
    network: payload.network || "",
    model: payload.model || "",
    redirect: Boolean(payload.redirect),
    reason: payload.reason || "",
  };
}

function increment(map, key) {
  const normalized = String(key || "").trim() || "unknown";
  map[normalized] = (map[normalized] || 0) + 1;
}

function topEntries(map, limit = 8) {
  return Object.entries(map)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

function summaryFromEvents(events) {
  const byEventType = {};
  const byCustomerType = {};
  const byDataOrigin = {};
  const byProvider = {};
  const byOffer = {};
  const sessions = new Set();
  const leads = new Set();

  const funnel = {
    pdfStarted: 0,
    pdfCompleted: 0,
    comparisons: 0,
    offersRendered: 0,
    leadModalOpened: 0,
    otpSent: 0,
    otpVerified: 0,
    offersUnlocked: 0,
    offerConsentOpened: 0,
    partnerConsentConfirmed: 0,
    redirects: 0,
    consultantRequests: 0,
    failedRequests: 0,
  };

  events.forEach((event) => {
    increment(byEventType, event.eventType);
    if (event.customerType) increment(byCustomerType, event.customerType);
    if (event.dataOrigin) increment(byDataOrigin, event.dataOrigin);
    if (event.provider) increment(byProvider, event.provider);
    if (event.offerName) increment(byOffer, `${event.provider || "Fornitore"} - ${event.offerName}`);
    if (event.sessionId) sessions.add(event.sessionId);
    if (event.leadId) leads.add(event.leadId);

    if (event.eventType === "pdf_analysis_started") funnel.pdfStarted += 1;
    if (event.eventType === "pdf_analysis_completed") funnel.pdfCompleted += 1;
    if (event.eventType === "comparison_completed") funnel.comparisons += 1;
    if (event.eventType === "offers_rendered") funnel.offersRendered += 1;
    if (event.eventType === "lead_modal_opened") funnel.leadModalOpened += 1;
    if (event.eventType === "otp_sent") funnel.otpSent += 1;
    if (event.eventType === "otp_verified") funnel.otpVerified += 1;
    if (event.eventType === "offers_unlocked") funnel.offersUnlocked += 1;
    if (event.eventType === "offer_consent_opened") funnel.offerConsentOpened += 1;
    if (event.eventType === "offer_partner_consent_confirmed") funnel.partnerConsentConfirmed += 1;
    if (event.eventType === "offer_redirect") funnel.redirects += 1;
    if (event.eventType === "offer_request_recorded") funnel.consultantRequests += 1;
    if (event.eventType === "offer_request_failed") funnel.failedRequests += 1;
  });

  return {
    recentEvents: events.length,
    uniqueSessions: sessions.size,
    linkedLeads: leads.size,
    byEventType,
    byCustomerType,
    byDataOrigin,
    topProviders: topEntries(byProvider),
    topOffers: topEntries(byOffer),
    funnel,
  };
}

export async function listCustomerLeads(options = {}) {
  if (!configured()) return { ok: true, configured: false, status: "not_configured", leads: [], summary: summaryFromRows([]) };
  const limit = limitValue(options.limit, 50);
  const query = [
    "select=id,created_at,updated_at,status,customer_type,name,email,phone,source,privacy_version,consent_service,consent_marketing,consent_partners,consent_profiling,best_saving,selected_offer,calculation,record",
    "order=created_at.desc",
    `limit=${limit}`,
  ].join("&");

  try {
    const response = await fetch(tableUrl(LEADS_TABLE, `?${query}`), {
      method: "GET",
      headers: headers("return=representation"),
    });
    if (!response.ok) {
      return { ok: false, configured: true, status: `error_${response.status}`, leads: [], summary: summaryFromRows([]) };
    }
    const rawRows = await response.json();
    const leads = Array.isArray(rawRows) ? rawRows.map(mapLeadRow) : [];
    return {
      ok: true,
      configured: true,
      status: "ready",
      limit,
      leads,
      summary: summaryFromRows(leads),
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      status: "error",
      error: error.message || "customer_db_list_error",
      leads: [],
      summary: summaryFromRows([]),
    };
  }
}

export async function listCustomerAnalytics(options = {}) {
  if (!configured()) {
    return {
      ok: true,
      configured: false,
      status: "not_configured",
      events: [],
      summary: summaryFromEvents([]),
    };
  }
  const limit = limitValue(options.limit, 100);
  const query = [
    "select=id,lead_id,event_type,created_at,payload",
    "order=created_at.desc",
    `limit=${limit}`,
  ].join("&");

  try {
    const response = await fetch(tableUrl(EVENTS_TABLE, `?${query}`), {
      method: "GET",
      headers: headers("return=representation"),
    });
    if (!response.ok) {
      return { ok: false, configured: true, status: `error_${response.status}`, events: [], summary: summaryFromEvents([]) };
    }
    const rawRows = await response.json();
    const events = Array.isArray(rawRows) ? rawRows.map(mapEventRow) : [];
    return {
      ok: true,
      configured: true,
      status: "ready",
      limit,
      events,
      summary: summaryFromEvents(events),
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      status: "error",
      error: error.message || "customer_db_analytics_error",
      events: [],
      summary: summaryFromEvents([]),
    };
  }
}
