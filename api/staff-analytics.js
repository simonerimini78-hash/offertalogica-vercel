import { json, method, requireAllowedOrigin } from "../lib/http.js";
import { deleteCustomerAnalytics, listCustomerAnalytics } from "../lib/customerDb.js";
import { isStaffAdminRole } from "../lib/staffRoles.js";
import { requireStaffSession } from "../lib/staffSessionAuth.js";
import { writeStaffAudit } from "../lib/staffAudit.js";

const CUSTOMER_DB_SUPABASE_URL =
  process.env.CUSTOMER_DB_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "";

const CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY =
  process.env.CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";

const CUSTOMER_DB_EVENTS_TABLE = process.env.CUSTOMER_DB_EVENTS_TABLE || "lead_events";
const CAMPAIGN_BASELINE_ISO = "2026-09-02T22:00:00.000Z";
const CAMPAIGN_BASELINE_LABEL = "3 settembre 2026, 00:00";
const LANDING_AUTOMATIC_DATA_ORIGIN = "landing_average_profile";
const LANDING_PATH_EVENTS = Object.freeze({
  view: "landing_view",
  selfService: "landing_self_service_click",
  assisted: "landing_assisted_click",
});
const LANDING_RANGES = new Set(["7d", "30d", "all"]);
const HUMAN_INTERACTION_EVENTS = new Set([
  "landing_self_service_click",
  "landing_assisted_click",
  "landing_free_app_click",
  "landing_premium_app_click",
  "comparison_started",
  "offer_consent_opened",
  "lead_modal_opened",
  "otp_request_started",
  "comparison_path_selected",
  "pdf_picker_opened",
  "pdf_file_selected",
  "pdf_analysis_started",
  "pdf_analysis_interrupted",
  "activation_data_copied",
  "business_photovoltaic_tool_opened",
  "assistance_callback_verified",
  "offer_switcho_redirect",
  "switcho_landing_opened",
  "offer_redirect",
]);

function customerDbConfiguredForLandingAnalytics() {
  return Boolean(CUSTOMER_DB_SUPABASE_URL && CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY);
}

function customerDbBaseUrl() {
  return String(CUSTOMER_DB_SUPABASE_URL || "").replace(/\/+$/, "");
}

function customerDbIsLegacyJwtKey(key) {
  return String(key || "").split(".").length === 3;
}

function customerDbReadHeaders() {
  const headers = {
    apikey: CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY,
    Accept: "application/json",
  };
  if (customerDbIsLegacyJwtKey(CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY)) {
    headers.Authorization = `Bearer ${CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY}`;
  }
  return headers;
}

function normalizeLandingRange(value) {
  const normalized = String(value || "30d").trim().toLowerCase();
  return LANDING_RANGES.has(normalized) ? normalized : "30d";
}

function landingRangeFrom(range) {
  const days = range === "7d" ? 7 : range === "30d" ? 30 : null;
  const requestedFrom = days ? new Date(Date.now() - days * 86400000).toISOString() : CAMPAIGN_BASELINE_ISO;
  return new Date(requestedFrom).getTime() < new Date(CAMPAIGN_BASELINE_ISO).getTime()
    ? CAMPAIGN_BASELINE_ISO
    : requestedFrom;
}

const LANDING_SIGNAL_EVENT_TYPES = new Set([
  ...Object.values(LANDING_PATH_EVENTS),
  ...HUMAN_INTERACTION_EVENTS,
]);
const LANDING_SIGNAL_PAGE_SIZE = 1000;
const LANDING_SIGNAL_MAX_ROWS = 20000;

function percentage(part, total) {
  if (!total) return null;
  return Math.round((part / total) * 1000) / 10;
}

function landingSignalEvent(row = {}) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  return {
    id: String(row?.id || ""),
    eventType: String(row?.event_type || row?.eventType || ""),
    sessionId: String(payload.sessionId || row?.sessionId || ""),
    trafficAgent: String(payload.trafficAgent || row?.trafficAgent || ""),
    trafficReason: String(payload.trafficReason || row?.trafficReason || ""),
  };
}

export function classifyLandingPathRows(rows = []) {
  const events = (Array.isArray(rows) ? rows : [])
    .map(landingSignalEvent)
    .filter((event) => event.eventType && LANDING_SIGNAL_EVENT_TYPES.has(event.eventType));

  const groups = new Map();
  events.forEach((event) => {
    const key = event.sessionId ? `session:${event.sessionId}` : `event:${event.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  });

  const eventVisitorType = new Map();
  groups.forEach((group) => {
    const visitor = visitorDescriptor(group);
    group.forEach((event) => eventVisitorType.set(event, visitor.type));
  });

  const viewCounts = {
    probable_person: 0,
    known_bot: 0,
    automation: 0,
    undetermined: 0,
  };
  const selectionCounts = {
    probable_person: { selfService: 0, assisted: 0 },
    known_bot: { selfService: 0, assisted: 0 },
    automation: { selfService: 0, assisted: 0 },
    undetermined: { selfService: 0, assisted: 0 },
  };

  events.forEach((event) => {
    const visitorType = eventVisitorType.get(event) || "undetermined";
    if (event.eventType === LANDING_PATH_EVENTS.view) {
      viewCounts[visitorType] = (viewCounts[visitorType] || 0) + 1;
      return;
    }
    if (event.eventType === LANDING_PATH_EVENTS.selfService) {
      selectionCounts[visitorType].selfService += 1;
      return;
    }
    if (event.eventType === LANDING_PATH_EVENTS.assisted) {
      selectionCounts[visitorType].assisted += 1;
    }
  });

  const views = Object.values(viewCounts).reduce((sum, value) => sum + Number(value || 0), 0);
  const probablePersonViews = viewCounts.probable_person;
  const knownBotViews = viewCounts.known_bot;
  const automationViews = viewCounts.automation;
  const suspiciousViews = knownBotViews + automationViews;
  const undeterminedViews = viewCounts.undetermined;

  const selfServiceClicks = selectionCounts.probable_person.selfService;
  const assistedClicks = selectionCounts.probable_person.assisted;
  const totalSelections = selfServiceClicks + assistedClicks;
  const rawSelfServiceClicks = Object.values(selectionCounts)
    .reduce((sum, value) => sum + value.selfService, 0);
  const rawAssistedClicks = Object.values(selectionCounts)
    .reduce((sum, value) => sum + value.assisted, 0);

  return {
    views,
    totalSelections,
    selfServiceClicks,
    assistedClicks,
    selfServiceShare: percentage(selfServiceClicks, totalSelections),
    assistedShare: percentage(assistedClicks, totalSelections),
    rawTotalSelections: rawSelfServiceClicks + rawAssistedClicks,
    rawSelfServiceClicks,
    rawAssistedClicks,
    traffic: {
      probablePersonViews,
      knownBotViews,
      automationViews,
      suspiciousViews,
      undeterminedViews,
      probablePersonShare: percentage(probablePersonViews, views),
    },
  };
}

async function fetchLandingSignalPage(from, offset, limit = LANDING_SIGNAL_PAGE_SIZE) {
  const query = new URLSearchParams({
    select: "id,event_type,created_at,payload",
    event_type: `in.(${[...LANDING_SIGNAL_EVENT_TYPES].join(",")})`,
    order: "created_at.asc",
    limit: String(limit),
    offset: String(offset),
  });
  if (from) query.set("created_at", `gte.${from}`);
  const response = await fetch(
    `${customerDbBaseUrl()}/rest/v1/${CUSTOMER_DB_EVENTS_TABLE}?${query.toString()}`,
    { method: "GET", headers: customerDbReadHeaders() },
  );
  if (!response.ok) {
    throw new Error(`Customer DB landing analytics error ${response.status}`);
  }
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

async function loadLandingSignalRows(from) {
  const rows = [];
  for (let offset = 0; offset < LANDING_SIGNAL_MAX_ROWS; offset += LANDING_SIGNAL_PAGE_SIZE) {
    const page = await fetchLandingSignalPage(from, offset);
    rows.push(...page);
    if (page.length < LANDING_SIGNAL_PAGE_SIZE) return rows;
  }

  const overflow = await fetchLandingSignalPage(from, LANDING_SIGNAL_MAX_ROWS, 1);
  if (overflow.length) {
    throw new Error("Volume statistiche landing oltre il limite di lettura sicura");
  }
  return rows;
}

async function loadLandingPathAnalytics(rangeValue) {
  const range = normalizeLandingRange(rangeValue);
  const from = landingRangeFrom(range);
  if (!customerDbConfiguredForLandingAnalytics()) {
    return {
      ok: true,
      configured: false,
      range,
      from,
      views: 0,
      totalSelections: 0,
      selfServiceClicks: 0,
      assistedClicks: 0,
      selfServiceShare: null,
      assistedShare: null,
      rawTotalSelections: 0,
      rawSelfServiceClicks: 0,
      rawAssistedClicks: 0,
      traffic: {
        probablePersonViews: 0,
        knownBotViews: 0,
        automationViews: 0,
        suspiciousViews: 0,
        undeterminedViews: 0,
        probablePersonShare: null,
      },
    };
  }

  try {
    const rows = await loadLandingSignalRows(from);
    return {
      ok: true,
      configured: true,
      range,
      from,
      ...classifyLandingPathRows(rows),
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      range,
      from,
      error: String(error?.message || error || "landing_analytics_error"),
    };
  }
}


const SWITCHO_EVENT_TYPES = ["offer_switcho_redirect", "offer_redirect", "switcho_landing_opened"];
const SWITCHO_ANALYTICS_PAGE_SIZE = 1000;
const SWITCHO_ANALYTICS_MAX_ROWS = 20000;

function switchoEventFromRow(row = {}) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  const eventType = String(row?.event_type || row?.eventType || "");
  const destinationType = String(payload.destinationType || "").trim().toLowerCase();
  const route = String(payload.route || "").trim().toLowerCase();
  const isSwitcho = eventType === "offer_switcho_redirect"
    || eventType === "switcho_landing_opened"
    || (eventType === "offer_redirect" && (destinationType === "switcho" || route === "switcho"));
  if (!isSwitcho) return null;
  return {
    id: String(row?.id || ""),
    leadId: String(row?.lead_id || ""),
    eventType,
    createdAt: row?.created_at || "",
    sessionId: String(payload.sessionId || ""),
    page: String(payload.page || ""),
    dataOrigin: String(payload.dataOrigin || ""),
    trafficSource: normalizeTrafficSource(payload.trafficSource || payload.source || payload.leadSource || "direct"),
    trafficCampaign: String(payload.trafficCampaign || ""),
    trafficMedium: String(payload.trafficMedium || ""),
    trafficTerm: String(payload.trafficTerm || ""),
    trafficContent: String(payload.trafficContent || ""),
    trafficCampaignId: String(payload.trafficCampaignId || ""),
    trafficAdGroupId: String(payload.trafficAdGroupId || ""),
    trafficCreativeId: String(payload.trafficCreativeId || ""),
    trafficMatchType: String(payload.trafficMatchType || ""),
    trafficDevice: String(payload.trafficDevice || ""),
    trafficNetwork: String(payload.trafficNetwork || ""),
    trafficReferrer: String(payload.trafficReferrer || ""),
    trafficLandingPage: String(payload.trafficLandingPage || ""),
    trafficClickIdType: String(payload.trafficClickIdType || ""),
    trafficClickId: String(payload.trafficClickId || ""),
    switchoSource: String(payload.source || ""),
    offerId: String(payload.offerId || ""),
    offerName: String(payload.offerName || ""),
    provider: String(payload.provider || ""),
    destinationType: String(payload.destinationType || ""),
    destinationStatus: String(payload.destinationStatus || ""),
    displayGroup: String(payload.displayGroup || ""),
    economyRank: Number.isFinite(Number(payload.economyRank)) ? Number(payload.economyRank) : null,
    displayRank: Number.isFinite(Number(payload.displayRank)) ? Number(payload.displayRank) : null,
    annualCost: Number.isFinite(Number(payload.annualCost)) ? Number(payload.annualCost) : null,
    annualSaving: Number.isFinite(Number(payload.annualDelta)) ? Number(payload.annualDelta) : null,
  };
}

function switchoSessionsFromEvents(events = []) {
  const groups = new Map();
  events.forEach((event) => {
    const key = event.sessionId ? `session:${event.sessionId}` : `event:${event.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  });

  const rows = [...groups.values()].map((group) => {
    const ordered = [...group].sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
    const choice = ordered.find((event) => event.eventType === "offer_switcho_redirect");
    const redirect = ordered.find((event) => event.eventType === "offer_redirect");
    const landing = ordered.find((event) => event.eventType === "switcho_landing_opened");
    const representative = landing || redirect || choice || ordered[ordered.length - 1] || {};
    const offerEvent = [choice, redirect, landing, representative].find((event) => event?.offerName || event?.provider) || representative;
    const trafficEvent = ordered.find((event) => event?.trafficSource && event.trafficSource !== "direct") || representative;
    return {
      sessionId: String(representative.sessionId || ""),
      leadId: String(representative.leadId || ""),
      createdAt: representative.createdAt || "",
      firstAt: ordered[0]?.createdAt || representative.createdAt || "",
      trafficSource: trafficEvent?.trafficSource || representative.trafficSource || "direct",
      trafficSourceLabel: trafficSourceLabel(trafficEvent?.trafficSource || representative.trafficSource || "direct"),
      trafficCampaign: trafficEvent?.trafficCampaign || representative.trafficCampaign || "",
      trafficMedium: trafficEvent?.trafficMedium || representative.trafficMedium || "",
      trafficTerm: trafficEvent?.trafficTerm || representative.trafficTerm || "",
      trafficContent: trafficEvent?.trafficContent || representative.trafficContent || "",
      trafficCampaignId: trafficEvent?.trafficCampaignId || representative.trafficCampaignId || "",
      trafficAdGroupId: trafficEvent?.trafficAdGroupId || representative.trafficAdGroupId || "",
      trafficCreativeId: trafficEvent?.trafficCreativeId || representative.trafficCreativeId || "",
      trafficMatchType: trafficEvent?.trafficMatchType || representative.trafficMatchType || "",
      trafficDevice: trafficEvent?.trafficDevice || representative.trafficDevice || "",
      trafficNetwork: trafficEvent?.trafficNetwork || representative.trafficNetwork || "",
      trafficReferrer: trafficEvent?.trafficReferrer || representative.trafficReferrer || "",
      trafficLandingPage: trafficEvent?.trafficLandingPage || representative.trafficLandingPage || "",
      trafficClickIdType: trafficEvent?.trafficClickIdType || representative.trafficClickIdType || "",
      trafficClickId: trafficEvent?.trafficClickId || representative.trafficClickId || "",
      dataOrigin: offerEvent?.dataOrigin || representative.dataOrigin || "",
      switchoSource: landing?.switchoSource || choice?.switchoSource || representative.switchoSource || "",
      offerId: offerEvent?.offerId || "",
      offerName: offerEvent?.offerName || "",
      provider: offerEvent?.provider || "",
      economyRank: offerEvent?.economyRank ?? null,
      displayRank: offerEvent?.displayRank ?? null,
      annualCost: offerEvent?.annualCost ?? null,
      annualSaving: offerEvent?.annualSaving ?? null,
      choiceRecorded: Boolean(choice),
      redirectRecorded: Boolean(redirect),
      landingOpened: Boolean(landing),
      eventsCount: ordered.length,
    };
  }).sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  return rows;
}

async function loadSwitchoAnalytics(from = CAMPAIGN_BASELINE_ISO) {
  if (!customerDbConfiguredForLandingAnalytics()) {
    return { ok: true, configured: false, rows: [], summary: { sessions: 0, offerSelections: 0, guidedSessions: 0, redirects: 0 } };
  }

  const allEvents = [];
  for (let offset = 0; offset < SWITCHO_ANALYTICS_MAX_ROWS; offset += SWITCHO_ANALYTICS_PAGE_SIZE) {
    const query = new URLSearchParams({
      select: "id,lead_id,event_type,created_at,payload",
      order: "created_at.asc",
      limit: String(SWITCHO_ANALYTICS_PAGE_SIZE),
      offset: String(offset),
      event_type: `in.(${SWITCHO_EVENT_TYPES.join(",")})`,
    });
    if (from) query.set("created_at", `gte.${from}`);
    const response = await fetch(
      `${customerDbBaseUrl()}/rest/v1/${CUSTOMER_DB_EVENTS_TABLE}?${query.toString()}`,
      { method: "GET", headers: customerDbReadHeaders() },
    );
    if (!response.ok) throw new Error(`Customer DB Switcho analytics error ${response.status}`);
    const rawRows = await response.json();
    const batch = (Array.isArray(rawRows) ? rawRows : []).map(switchoEventFromRow).filter(Boolean);
    allEvents.push(...batch);
    if (!Array.isArray(rawRows) || rawRows.length < SWITCHO_ANALYTICS_PAGE_SIZE) break;
  }

  const rows = switchoSessionsFromEvents(allEvents);
  const sourceCounts = {};
  rows.forEach((row) => increment(sourceCounts, row.trafficSource || "direct"));
  return {
    ok: true,
    configured: true,
    rows,
    summary: {
      sessions: rows.length,
      offerSelections: rows.filter((row) => row.choiceRecorded || row.offerName).length,
      guidedSessions: rows.filter((row) => !row.offerName).length,
      redirects: rows.filter((row) => row.redirectRecorded || row.landingOpened).length,
      sources: sourceEntries(sourceCounts),
    },
  };
}

function analyticsLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 200;
  return Math.max(1, Math.min(2000, Math.floor(parsed)));
}

async function loadAnalyticsTrafficSignals(limitValue, from = CAMPAIGN_BASELINE_ISO) {
  const signals = new Map();
  if (!customerDbConfiguredForLandingAnalytics()) return signals;

  const query = new URLSearchParams({
    select: "id,payload",
    order: "created_at.desc",
    limit: String(analyticsLimit(limitValue)),
  });
  if (from) query.set("created_at", `gte.${from}`);
  const response = await fetch(
    `${customerDbBaseUrl()}/rest/v1/${CUSTOMER_DB_EVENTS_TABLE}?${query.toString()}`,
    { method: "GET", headers: customerDbReadHeaders() },
  );
  if (!response.ok) {
    throw new Error(`Customer DB traffic analytics error ${response.status}`);
  }

  const rows = await response.json();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    signals.set(String(row?.id || ""), {
      trafficAgent: String(payload.trafficAgent || ""),
      trafficReason: String(payload.trafficReason || ""),
    });
  });
  return signals;
}

function increment(map, key) {
  const normalized = String(key || "").trim();
  if (!normalized) return;
  map[normalized] = (map[normalized] || 0) + 1;
}

function topEntries(map, limit = 8) {
  return Object.entries(map)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

function normalizeTrafficSource(value) {
  const source = String(value || "").trim().toLowerCase();
  if (!source || ["direct", "(direct)", "none", "(none)"].includes(source)) return "direct";
  if (/(google[_ -]?ads|adwords|gads|google.*(?:cpc|paid))/i.test(source)) return "google_ads";
  if (/(google[_ -]?organic|(^|\.)google\.|^google$)/i.test(source)) return "google_organic";
  if (/(instagram|l\.instagram\.com)/i.test(source)) return "instagram";
  if (/(facebook|fb\.com|l\.facebook\.com|lm\.facebook\.com)/i.test(source)) return "facebook";
  if (/(tiktok|tiktok\.com)/i.test(source)) return "tiktok";
  if (/(meta_other|meta)/i.test(source)) return "meta_other";
  return "referral_other";
}

function trafficSourceLabel(key) {
  return ({
    google_ads: "Google Ads",
    google_organic: "Google organico",
    instagram: "Instagram",
    facebook: "Facebook",
    tiktok: "TikTok",
    meta_other: "Meta non distinto",
    direct: "Diretto",
    referral_other: "Referral / altro",
  })[key] || key;
}

function sourceEntries(map) {
  return topEntries(map, 12).map((item) => ({ ...item, label: trafficSourceLabel(item.key) }));
}


function isAutomaticLandingPreview(event = {}) {
  return String(event.dataOrigin || "").trim().toLowerCase() === LANDING_AUTOMATIC_DATA_ORIGIN;
}

function isRealComparisonCompleted(event = {}) {
  return event.eventType === "comparison_completed" && !isAutomaticLandingPreview(event);
}

const COMPARISON_PATH_SIGNAL_EVENT_TYPES = new Set([
  "comparison_started",
  "comparison_completed",
  "comparison_incomplete_data",
  "comparison_missing_current_price",
  "offers_rendered",
]);

function comparisonEventPathChoice(event = {}) {
  const raw = String(event.pathChoice || event.payload?.pathChoice || "").trim().toLowerCase();
  if (["average", "media", "profilo_medio", "arera_average_profile"].includes(raw)) return "average";
  if (["manual", "manuale", "manual_input"].includes(raw)) return "manual";
  if (["pdf", "pdf_upload"].includes(raw)) return "pdf";
  return "";
}

function comparisonEventDataOrigin(event = {}) {
  return String(event.dataOrigin || event.payload?.dataOrigin || "").trim().toLowerCase();
}

function comparisonPathSignals(events = []) {
  const ordered = [...(Array.isArray(events) ? events : [])].sort((a, b) => {
    const left = new Date(a.createdAt || a.created_at || 0).getTime();
    const right = new Date(b.createdAt || b.created_at || 0).getTime();
    return left - right;
  });
  const sequence = [];
  let explicitCount = 0;
  let inferredCount = 0;
  const push = (path, basis) => {
    if (!path) return;
    if (sequence[sequence.length - 1]?.path === path) {
      if (basis === "registrato") sequence[sequence.length - 1].basis = "registrato";
      return;
    }
    sequence.push({ path, basis });
    if (basis === "registrato") explicitCount += 1;
    else inferredCount += 1;
  };

  ordered.forEach((event) => {
    const eventType = String(event.eventType || event.event_type || "");
    if (eventType === "comparison_path_selected") {
      push(comparisonEventPathChoice(event), "registrato");
      return;
    }

    // Qualunque evento PDF rappresenta un segnale reale del ramo PDF, anche nello storico.
    if (eventType.startsWith("pdf_")) {
      push("pdf", "inferito");
      return;
    }

    // Gli origin vengono usati solo su eventi di confronto significativi.
    // landing_view può ereditare manual_input e non deve mai diventare una scelta manuale.
    if (!COMPARISON_PATH_SIGNAL_EVENT_TYPES.has(eventType)) return;
    const origin = comparisonEventDataOrigin(event);
    if (!origin || origin === LANDING_AUTOMATIC_DATA_ORIGIN) return;
    if (origin === "pdf_upload") push("pdf", "inferito");
    else if (origin === "manual_input") push("manual", "inferito");
    else if (origin === "arera_average_profile") push("average", "inferito");
  });

  return {
    sequence,
    paths: new Set(sequence.map((item) => item.path)),
    latest: sequence[sequence.length - 1]?.path || "",
    hasExplicit: explicitCount > 0,
    hasInferred: inferredCount > 0,
  };
}

function comparisonPathLabel(path = "") {
  if (path === "average") return "profilo medio ARERA";
  if (path === "manual") return "manuale";
  if (path === "pdf") return "pdf";
  return "";
}

function activityFunnelFromEvents(events = []) {
  const funnel = {
    pdfPathSelected: 0,
    pdfPickerOpened: 0,
    pdfFileSelected: 0,
    pdfStarted: 0,
    pdfCompleted: 0,
    pdfInterrupted: 0,
    comparisons: 0,
    landingPreviews: 0,
    offersRendered: 0,
    leadModalOpened: 0,
    leadModalClosed: 0,
    leadFormInvalid: 0,
    otpRequestStarted: 0,
    leadCreatedClient: 0,
    otpSent: 0,
    otpFailed: 0,
    otpVerified: 0,
    offersUnlocked: 0,
    offerConsentOpened: 0,
    partnerConsentConfirmed: 0,
    redirects: 0,
    consultantRequests: 0,
    failedRequests: 0,
  };
  events.forEach((event) => {
    if (event.eventType === "comparison_path_selected" && String(event.pathChoice || "") === "pdf") funnel.pdfPathSelected += 1;
    if (event.eventType === "pdf_picker_opened") funnel.pdfPickerOpened += 1;
    if (event.eventType === "pdf_file_selected") funnel.pdfFileSelected += 1;
    if (event.eventType === "pdf_analysis_started") funnel.pdfStarted += 1;
    if (event.eventType === "pdf_analysis_completed") funnel.pdfCompleted += 1;
    if (event.eventType === "pdf_analysis_interrupted") funnel.pdfInterrupted += 1;
    if (isRealComparisonCompleted(event)) funnel.comparisons += 1;
    if (event.eventType === "comparison_completed" && isAutomaticLandingPreview(event)) funnel.landingPreviews += 1;
    if (event.eventType === "offers_rendered" && !isAutomaticLandingPreview(event)) funnel.offersRendered += 1;
    if (event.eventType === "lead_modal_opened") funnel.leadModalOpened += 1;
    if (event.eventType === "lead_modal_closed") funnel.leadModalClosed += 1;
    if (event.eventType === "lead_form_invalid") funnel.leadFormInvalid += 1;
    if (event.eventType === "otp_request_started") funnel.otpRequestStarted += 1;
    if (event.eventType === "lead_created_client") funnel.leadCreatedClient += 1;
    if (event.eventType === "otp_sent") funnel.otpSent += 1;
    if (event.eventType === "otp_failed") funnel.otpFailed += 1;
    if (event.eventType === "otp_verified") funnel.otpVerified += 1;
    if (event.eventType === "offers_unlocked") funnel.offersUnlocked += 1;
    if (event.eventType === "offer_consent_opened") funnel.offerConsentOpened += 1;
    if (event.eventType === "offer_partner_consent_confirmed") funnel.partnerConsentConfirmed += 1;
    if (event.eventType === "offer_redirect") funnel.redirects += 1;
    if (event.eventType === "offer_request_recorded") funnel.consultantRequests += 1;
    if (event.eventType === "offer_request_failed") funnel.failedRequests += 1;
  });
  return funnel;
}

function sessionFunnelFromGroups(groups = []) {
  const funnel = {
    entries: 0,
    pathSelected: 0,
    selfServiceSelected: 0,
    assistedSelected: 0,
    averageSelected: 0,
    manualSelected: 0,
    pdfSelected: 0,
    pdfStarted: 0,
    pdfCompleted: 0,
    comparisons: 0,
    offersViewed: 0,
    switcho: 0,
    leadModalOpened: 0,
    otpRequestStarted: 0,
    otpSent: 0,
    otpVerified: 0,
    offersUnlocked: 0,
    offerAction: 0,
    redirects: 0,
  };

  groups.forEach((group) => {
    const eventTypes = new Set(group.map((event) => event.eventType).filter(Boolean));
    const hasRealComparison = group.some((event) => isRealComparisonCompleted(event));
    const hasSelfService = eventTypes.has("landing_self_service_click");
    const hasAssisted = eventTypes.has("landing_assisted_click");
    const pathSignals = comparisonPathSignals(group);
    const hasPdfSignal = pathSignals.paths.has("pdf");
    const hasSwitcho = ["offer_switcho_redirect", "switcho_landing_opened", "business_switcho_requested", "assistance_switcho_redirect"]
      .some((type) => eventTypes.has(type));
    const hasRealOffers = group.some((event) => event.eventType === "offers_rendered" && !isAutomaticLandingPreview(event));

    funnel.entries += 1;
    if (hasSelfService || hasAssisted) funnel.pathSelected += 1;
    if (hasSelfService) funnel.selfServiceSelected += 1;
    if (hasAssisted) funnel.assistedSelected += 1;
    if (pathSignals.paths.has("average")) funnel.averageSelected += 1;
    if (pathSignals.paths.has("manual")) funnel.manualSelected += 1;
    if (pathSignals.paths.has("pdf")) funnel.pdfSelected += 1;
    if (eventTypes.has("pdf_analysis_started")) funnel.pdfStarted += 1;
    if (eventTypes.has("pdf_analysis_completed")) funnel.pdfCompleted += 1;
    if (hasRealComparison) funnel.comparisons += 1;
    if (hasRealOffers) funnel.offersViewed += 1;
    if (hasSwitcho) funnel.switcho += 1;
    if (eventTypes.has("lead_modal_opened")) funnel.leadModalOpened += 1;
    if (eventTypes.has("otp_request_started")) funnel.otpRequestStarted += 1;
    if (eventTypes.has("otp_sent")) funnel.otpSent += 1;
    if (eventTypes.has("otp_verified")) funnel.otpVerified += 1;
    if (eventTypes.has("offers_unlocked")) funnel.offersUnlocked += 1;
    if (["offer_consent_opened", "offer_partner_consent_confirmed", "offer_switcho_redirect", "offer_redirect", "offer_request_recorded"].some((type) => eventTypes.has(type))) {
      funnel.offerAction += 1;
    }
    if (eventTypes.has("offer_redirect") || hasSwitcho) funnel.redirects += 1;
  });

  return funnel;
}

function sourceForSessionGroup(group = []) {
  const ordered = [...group].sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
  const landing = ordered.find((event) => event.eventType === LANDING_PATH_EVENTS.view);
  const rawSource = landing?.trafficSource
    || landing?.source
    || ordered.map((event) => event.trafficSource).find(Boolean)
    || ordered.map((event) => event.source).find(Boolean)
    || "direct";
  return normalizeTrafficSource(rawSource);
}

function sessionFunnelsBySource(groups = []) {
  const grouped = new Map();
  groups.forEach((group) => {
    const source = sourceForSessionGroup(group);
    if (!grouped.has(source)) grouped.set(source, []);
    grouped.get(source).push(group);
  });
  return Object.fromEntries(
    [...grouped.entries()].map(([source, sourceGroups]) => [source, sessionFunnelFromGroups(sourceGroups)])
  );
}

function visitorDescriptor(events) {
  const agents = new Set(events.map((event) => event.trafficAgent).filter(Boolean));
  if (agents.has("known_bot")) {
    return { type: "known_bot", label: "Bot rilevato", reason: "firma tecnica di crawler/bot" };
  }
  if (agents.has("automation")) {
    return { type: "automation", label: "Automazione sospetta", reason: "firma tecnica di browser o client automatizzato" };
  }

  const explicitInteraction = events.some((event) => HUMAN_INTERACTION_EVENTS.has(event.eventType));
  if (agents.has("browser") && explicitInteraction) {
    return { type: "probable_person", label: "Probabile persona", reason: "browser standard con interazione esplicita" };
  }
  if (agents.has("browser")) {
    return { type: "undetermined", label: "Non determinabile", reason: "browser standard senza interazione esplicita registrata" };
  }
  if (agents.size) {
    return { type: "undetermined", label: "Non determinabile", reason: "client non classificabile con affidabilità" };
  }
  return { type: "undetermined", label: "Non determinabile", reason: "evento precedente al controllo bot/persona" };
}

function analyticsFromCampaignBaseline(result) {
  if (!result || !Array.isArray(result.events)) return result;
  const baselineMs = new Date(CAMPAIGN_BASELINE_ISO).getTime();
  const events = result.events.filter((event) => {
    const createdMs = new Date(event.createdAt || 0).getTime();
    return Number.isFinite(createdMs) && createdMs >= baselineMs;
  });
  return {
    ...result,
    events,
    summary: {
      recentEvents: events.length,
      uniqueSessions: 0,
      linkedLeads: 0,
      funnel: {},
    },
  };
}

function enhanceAnalyticsForStaff(result, trafficSignals = new Map()) {
  if (!result || !Array.isArray(result.events)) return result;

  const events = result.events.map((event) => {
    const signal = trafficSignals.get(String(event.id || "")) || {};
    return {
      ...event,
      trafficAgent: signal.trafficAgent || "",
      trafficReason: signal.trafficReason || "",
    };
  });

  const groups = new Map();
  events.forEach((event) => {
    const key = event.sessionId ? `session:${event.sessionId}` : `event:${event.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  });

  const visitorCounts = {
    probable_person: 0,
    known_bot: 0,
    automation: 0,
    undetermined: 0,
  };
  const trafficSourceSessions = {};
  const attributedSessionGroups = [];
  groups.forEach((group, groupKey) => {
    const visitor = visitorDescriptor(group);
    visitorCounts[visitor.type] = (visitorCounts[visitor.type] || 0) + 1;
    const hasSessionId = String(groupKey || "").startsWith("session:");
    const groupSource = sourceForSessionGroup(group);
    const sourceEligible = hasSessionId && (visitor.type === "probable_person"
      || group.some((event) => event.trafficAgent === "browser"));
    if (sourceEligible) {
      attributedSessionGroups.push(group);
      increment(trafficSourceSessions, groupSource);
    }
    group.forEach((event) => {
      event.visitorType = visitor.type;
      event.visitorLabel = visitor.label;
      event.visitorReason = visitor.reason;
      event.trafficSource = hasSessionId ? groupSource : normalizeTrafficSource(event.trafficSource || event.source);
      const trafficText = `Visitatore: ${visitor.label} · ${visitor.reason}`;
      event.reason = [event.reason, trafficText].filter(Boolean).join(" · ");
    });
  });

  const probableEvents = events.filter((event) => event.visitorType === "probable_person");
  const probableSessions = new Set(probableEvents.map((event) => event.sessionId).filter(Boolean));
  const probableLeads = new Set(probableEvents.map((event) => event.leadId).filter(Boolean));
  const byProvider = {};
  const byOffer = {};
  probableEvents.forEach((event) => {
    if (event.eventType !== "offer_consent_opened") return;
    if (event.provider) increment(byProvider, event.provider);
    if (event.offerName) increment(byOffer, `${event.provider || "Fornitore"} - ${event.offerName}`);
  });

  return {
    ...result,
    events,
    summary: {
      ...(result.summary || {}),
      rawFunnel: result.summary?.funnel || {},
      rawUniqueSessions: Number(result.summary?.uniqueSessions || 0),
      rawLinkedLeads: Number(result.summary?.linkedLeads || 0),
      funnel: activityFunnelFromEvents(events),
      sessionFunnel: sessionFunnelFromGroups(attributedSessionGroups),
      sessionFunnelsBySource: sessionFunnelsBySource(attributedSessionGroups),
      attributedSessions: attributedSessionGroups.length,
      uniqueSessions: probableSessions.size,
      linkedLeads: probableLeads.size,
      probablePersonEvents: probableEvents.length,
      topProviders: topEntries(byProvider),
      topOffers: topEntries(byOffer),
      visitorSessions: visitorCounts,
      trafficSources: sourceEntries(trafficSourceSessions),
    },
  };
}

const ANALYTICS_EXPORT_PAGE_SIZE = 1000;
const ANALYTICS_EXPORT_MAX_ROWS = 100000;

function csvEscape(value) {
  const normalized = value === null || value === undefined
    ? ""
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  return `"${normalized.replace(/"/g, '""')}"`;
}

function csvFromObjects(rows, headers) {
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
}

function analyticsExportRangeFrom(value) {
  return String(value || "baseline").toLowerCase() === "all" ? "" : CAMPAIGN_BASELINE_ISO;
}

async function fetchAnalyticsExportPage(from, offset, limit = ANALYTICS_EXPORT_PAGE_SIZE) {
  const query = new URLSearchParams({
    select: "id,lead_id,event_type,created_at,payload",
    order: "created_at.asc",
    limit: String(limit),
    offset: String(offset),
  });
  if (from) query.set("created_at", `gte.${from}`);
  const response = await fetch(
    `${customerDbBaseUrl()}/rest/v1/${CUSTOMER_DB_EVENTS_TABLE}?${query.toString()}`,
    { method: "GET", headers: customerDbReadHeaders() },
  );
  if (!response.ok) throw new Error(`Customer DB analytics export error ${response.status}`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

async function loadAnalyticsExportRows(from) {
  if (!customerDbConfiguredForLandingAnalytics()) return [];
  const rows = [];
  for (let offset = 0; offset < ANALYTICS_EXPORT_MAX_ROWS; offset += ANALYTICS_EXPORT_PAGE_SIZE) {
    const page = await fetchAnalyticsExportPage(from, offset);
    rows.push(...page);
    if (page.length < ANALYTICS_EXPORT_PAGE_SIZE) return rows;
  }
  const overflow = await fetchAnalyticsExportPage(from, ANALYTICS_EXPORT_MAX_ROWS, 1);
  if (overflow.length) throw new Error("Export analytics oltre il limite di lettura sicura: nessun CSV parziale generato");
  return rows;
}

function rawAnalyticsPayload(row = {}) {
  return row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {};
}

function analyticsEventExportRows(rows = []) {
  return rows.map((row) => {
    const p = rawAnalyticsPayload(row);
    return {
      id: row.id ?? "",
      lead_id: row.lead_id || "",
      event_type: row.event_type || "",
      created_at: row.created_at || "",
      session_id: p.sessionId || "",
      page: p.page || "",
      customer_type: p.customerType || "",
      data_origin: p.dataOrigin || "",
      source: p.source || "",
      lead_source: p.leadSource || "",
      traffic_source: p.trafficSource || "",
      traffic_medium: p.trafficMedium || "",
      traffic_campaign: p.trafficCampaign || "",
      traffic_term: p.trafficTerm || "",
      traffic_content: p.trafficContent || "",
      traffic_campaign_id: p.trafficCampaignId || "",
      traffic_adgroup_id: p.trafficAdGroupId || "",
      traffic_creative_id: p.trafficCreativeId || "",
      traffic_match_type: p.trafficMatchType || "",
      traffic_device: p.trafficDevice || "",
      traffic_network: p.trafficNetwork || "",
      traffic_referrer: p.trafficReferrer || "",
      traffic_landing_page: p.trafficLandingPage || "",
      traffic_click_id_type: p.trafficClickIdType || "",
      traffic_click_id: p.trafficClickId || "",
      traffic_agent: p.trafficAgent || "",
      traffic_reason: p.trafficReason || "",
      event_integrity: p.eventIntegrity || "",
      verified: p.verified ?? "",
      staff_mode: p.staffMode ?? "",
      path_choice: p.pathChoice || "",
      trigger: p.trigger || "",
      best_saving: p.bestSaving ?? "",
      pdf_document_count: p.pdfDocumentCount ?? "",
      file_count: p.fileCount ?? "",
      selected_count: p.selectedCount ?? "",
      accepted_count: p.acceptedCount ?? "",
      duplicate_count: p.duplicateCount ?? "",
      success_count: p.successCount ?? "",
      unrecognized_count: p.unrecognizedCount ?? "",
      error_count: p.errorCount ?? "",
      analysis_status: p.analysisStatus || "",
      diagnostic_code: p.diagnosticCode || "",
      diagnostic_codes: p.diagnosticCodes ?? [],
      analysis_stage: p.analysisStage || "",
      analysis_stages: p.analysisStages ?? [],
      ingress_mode: p.ingressMode || "",
      ingress_modes: p.ingressModes ?? [],
      document_kinds: p.documentKinds ?? [],
      commodities: p.commodities ?? [],
      missing_fields: p.missingFields ?? [],
      missing_field_count: p.missingFieldCount ?? "",
      review_field_count: p.reviewFieldCount ?? "",
      field_count: p.fieldCount ?? "",
      protected_count: p.protectedCount ?? "",
      ocr_review_count: p.ocrReviewCount ?? "",
      skipped_count: p.skippedCount ?? "",
      protected_skipped_count: p.protectedSkippedCount ?? "",
      active_slot: p.activeSlot || "",
      retained_current_documents: p.retainedCurrentDocuments ?? "",
      retained_offer_documents: p.retainedOfferDocuments ?? "",
      mixed_documents: p.mixedDocuments ?? "",
      merge_blocked: p.mergeBlocked ?? "",
      gas_decision: p.gasDecision || "",
      electricity_decision: p.electricityDecision || "",
      has_new_offer: p.hasNewOffer ?? "",
      visible_offers_count: p.visibleOffersCount ?? "",
      active_partner_offers_count: p.activePartnerOffersCount ?? "",
      consultant_offers_count: p.consultantOffersCount ?? "",
      offer_id: p.offerId || "",
      offer_name: p.offerName || "",
      provider: p.provider || "",
      destination_type: p.destinationType || "",
      destination_status: p.destinationStatus || "",
      display_group: p.displayGroup || "",
      economy_rank: p.economyRank ?? "",
      display_rank: p.displayRank ?? "",
      annual_cost: p.annualCost ?? "",
      annual_delta: p.annualDelta ?? "",
      network: p.network || "",
      model: p.model || "",
      redirect: p.redirect ?? "",
      routing_version: p.routingVersion || "",
      engagement_stage: p.engagementStage || "",
      engagement_reason: p.engagementReason || "",
      engagement_active_seconds: p.engagementActiveSeconds ?? "",
      engagement_elapsed_seconds: p.engagementElapsedSeconds ?? "",
      engagement_landing_seconds: p.engagementLandingSeconds ?? "",
      engagement_calculator_seconds: p.engagementCalculatorSeconds ?? "",
      engagement_offers_seconds: p.engagementOffersSeconds ?? "",
      engagement_otp_seconds: p.engagementOtpSeconds ?? "",
      engagement_first_action_seconds: p.engagementFirstActionSeconds ?? "",
      engagement_offers_reached_seconds: p.engagementOffersReachedSeconds ?? "",
      telemetry: p.telemetry ?? "",
      reason: p.reason || "",
      payload_json: p,
    };
  });
}

function exportSessionActiveSeconds(events = []) {
  const lastByPage = new Map();
  let total = 0;
  events.forEach((event) => {
    const p = event.payload || {};
    if (event.eventType !== "session_engagement") return;
    const current = Number(p.engagementActiveSeconds);
    if (!Number.isFinite(current) || current <= 0) return;
    const key = String(p.page || p.engagementStage || "session");
    const previous = Number(lastByPage.get(key) || 0);
    total += current >= previous ? current - previous : current;
    lastByPage.set(key, current);
  });
  return Math.round(total);
}

function analyticsSessionExportRows(rawRows = []) {
  const groups = new Map();
  rawRows.forEach((row) => {
    const p = rawAnalyticsPayload(row);
    const sessionId = String(p.sessionId || "");
    const key = sessionId ? `session:${sessionId}` : `event:${row.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      id: row.id,
      leadId: row.lead_id || "",
      eventType: String(row.event_type || ""),
      createdAt: row.created_at || "",
      payload: p,
      dataOrigin: String(p.dataOrigin || ""),
      trafficAgent: String(p.trafficAgent || ""),
    });
  });

  const uniqueList = (values = []) => [...new Set(values.flatMap((value) => Array.isArray(value) ? value : value ? [value] : []).map((value) => String(value || "").trim()).filter(Boolean))];
  const numberValue = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

  return [...groups.values()].map((group) => {
    const ordered = [...group].sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
    const first = ordered[0] || {};
    const last = ordered[ordered.length - 1] || first;
    const landing = ordered.find((event) => event.eventType === "landing_view") || first;
    const attributionEvent = ordered.find((event) => event.payload?.trafficSource && event.payload.trafficSource !== "direct") || landing || first;
    const attribution = attributionEvent.payload || {};
    const eventTypes = new Set(ordered.map((event) => event.eventType).filter(Boolean));
    const firstPayload = first.payload || {};
    const lastPayload = last.payload || {};
    const offerEvent = [...ordered].reverse().find((event) => event.payload?.offerName || event.payload?.provider) || last;
    const offerPayload = offerEvent.payload || {};
    const engagementEvents = ordered.filter((event) => event.eventType === "session_engagement");
    const engagementLast = engagementEvents[engagementEvents.length - 1]?.payload || {};
    const hasRealComparison = ordered.some((event) => event.eventType === "comparison_completed" && String(event.dataOrigin || "").toLowerCase() !== LANDING_AUTOMATIC_DATA_ORIGIN);
    const hasSelf = eventTypes.has("landing_self_service_click");
    const hasAssisted = eventTypes.has("landing_assisted_click");
    const landingPath = hasSelf && hasAssisted ? "autonomia + guidato" : hasSelf ? "autonomia" : hasAssisted ? "guidato" : "";
    const pathSignals = comparisonPathSignals(ordered);
    const comparisonPath = comparisonPathLabel(pathSignals.latest);
    const comparisonPathSequence = pathSignals.sequence.map((item) => comparisonPathLabel(item.path)).filter(Boolean).join(" → ");
    const pathBasis = pathSignals.hasExplicit
      ? pathSignals.hasInferred ? "registrato + inferito dagli eventi" : "registrato"
      : comparisonPath ? "inferito dagli eventi storici" : "";
    const hasPdfSignal = pathSignals.paths.has("pdf");

    const pdfEvents = ordered.filter((event) => event.eventType.startsWith("pdf_") || (COMPARISON_PATH_SIGNAL_EVENT_TYPES.has(event.eventType) && comparisonEventDataOrigin(event) === "pdf_upload"));
    const pdfCompletedEvent = [...pdfEvents].reverse().find((event) => event.eventType === "pdf_analysis_completed");
    const pdfInterruptedEvent = [...pdfEvents].reverse().find((event) => event.eventType === "pdf_analysis_interrupted");
    const pdfPayloads = pdfEvents.map((event) => event.payload || {});
    const latestPdfPayload = pdfCompletedEvent?.payload || pdfInterruptedEvent?.payload || pdfPayloads[pdfPayloads.length - 1] || {};
    const successCount = numberValue(latestPdfPayload.successCount);
    const unrecognizedCount = numberValue(latestPdfPayload.unrecognizedCount);
    const errorCount = numberValue(latestPdfPayload.errorCount);
    const missingFieldCount = numberValue(latestPdfPayload.missingFieldCount);
    const rawPdfOutcome = String(latestPdfPayload.analysisStatus || "").trim().toLowerCase();
    let pdfOutcome = ({
      success: "riuscita",
      success_missing_data: "riuscita con dati mancanti",
      partial: "parziale",
      failed: "fallita",
      unrecognized: "documento non riconosciuto",
      interrupted: "interrotta",
      unknown: "esito non determinato",
    })[rawPdfOutcome] || rawPdfOutcome;
    if (!pdfOutcome && pdfInterruptedEvent) pdfOutcome = "interrotta";
    if (!pdfOutcome && pdfCompletedEvent) {
      if ((successCount || 0) > 0 && ((unrecognizedCount || 0) > 0 || (errorCount || 0) > 0 || (missingFieldCount || 0) > 0)) pdfOutcome = "parziale";
      else if ((successCount || 0) > 0) pdfOutcome = "riuscita";
      else if ((unrecognizedCount || 0) > 0 || (errorCount || 0) > 0) pdfOutcome = "fallita";
      else pdfOutcome = "completata (storico senza dettaglio esito)";
    }
    if (!pdfOutcome && eventTypes.has("pdf_analysis_started")) pdfOutcome = "avviata, esito non registrato";
    if (!pdfOutcome && hasPdfSignal) pdfOutcome = "percorso PDF avviato";

    const missingFields = uniqueList(pdfPayloads.map((payload) => payload.missingFields));
    const diagnosticCodes = uniqueList(pdfPayloads.map((payload) => [payload.diagnosticCode, ...(Array.isArray(payload.diagnosticCodes) ? payload.diagnosticCodes : [])]));
    const analysisStages = uniqueList(pdfPayloads.map((payload) => [payload.analysisStage, ...(Array.isArray(payload.analysisStages) ? payload.analysisStages : [])]));
    const documentKinds = uniqueList(pdfPayloads.map((payload) => payload.documentKinds));
    const commodities = uniqueList(pdfPayloads.map((payload) => payload.commodities));

    const switcho = ["offer_switcho_redirect", "switcho_landing_opened", "business_switcho_requested", "assistance_switcho_redirect"]
      .some((type) => eventTypes.has(type));
    const partner = eventTypes.has("offer_redirect") || eventTypes.has("offer_partner_consent_confirmed") || switcho;
    const switchoEvent = [...ordered].reverse().find((event) => ["switcho_landing_opened", "offer_switcho_redirect", "assistance_switcho_redirect", "business_switcho_requested"].includes(event.eventType));
    const visitor = visitorDescriptor(ordered);
    const leadId = ordered.map((event) => event.leadId).find(Boolean) || "";
    const offersViewed = ordered.some((event) => event.eventType === "offers_rendered" && !isAutomaticLandingPreview(event));
    const offerAction = ["offer_click_locked", "offer_consent_opened", "offer_partner_consent_confirmed", "offer_switcho_redirect", "offer_redirect", "offer_request_recorded"].some((type) => eventTypes.has(type));

    const intentTerm = String(attribution.trafficTerm || "").trim();
    let intent = intentTerm;
    let intentBasis = intentTerm ? "termine/keyword disponibile" : "inferito dal comportamento";
    if (!intent) {
      if (hasAssisted && !hasSelf) intent = "Preferisce assistenza guidata";
      else if (comparisonPath === "pdf") intent = "Vuole verificare la propria bolletta";
      else if (comparisonPath === "manuale") intent = "Vuole confrontare usando i propri consumi";
      else if (comparisonPath === "profilo medio ARERA") intent = "Vuole una prima stima indicativa";
      else if (offersViewed) intent = "Sta valutando offerte";
      else intent = "Intento non determinabile";
    }

    let finalOutcome = "Nessun avanzamento rilevante";
    let abandonmentStage = "";
    if (switcho) finalOutcome = "Passaggio a Switcho";
    else if (partner) finalOutcome = "Passaggio partner";
    else if (offerAction) finalOutcome = "Azione su offerta";
    else if (offersViewed) { finalOutcome = "Offerte visualizzate"; abandonmentStage = "offerte"; }
    else if (hasRealComparison) { finalOutcome = "Confronto completato"; abandonmentStage = "dopo confronto"; }
    else if (eventTypes.has("pdf_analysis_interrupted")) { finalOutcome = "PDF interrotto"; abandonmentStage = "analisi PDF"; }
    else if (eventTypes.has("pdf_analysis_started") && !eventTypes.has("pdf_analysis_completed")) { finalOutcome = "PDF avviato senza completamento"; abandonmentStage = "analisi PDF"; }
    else if (hasPdfSignal) { finalOutcome = "Percorso PDF senza analisi completata"; abandonmentStage = "caricamento PDF"; }
    else if (eventTypes.has("comparison_started")) { finalOutcome = "Confronto avviato"; abandonmentStage = "confronto"; }
    else if (hasSelf || hasAssisted) { finalOutcome = "Percorso scelto"; abandonmentStage = hasAssisted ? "passaggio guidato" : "scelta modalità confronto"; }
    else if (eventTypes.has("landing_view")) { finalOutcome = "Solo landing"; abandonmentStage = "landing"; }

    const selectionEvent = [...ordered].reverse().find((event) => event.eventType === "pdf_file_selected")?.payload || {};
    const previewOpened = [...ordered].reverse().find((event) => event.eventType === "pdf_autofill_preview_opened")?.payload || {};
    const previewConfirmed = [...ordered].reverse().find((event) => event.eventType === "pdf_autofill_preview_confirmed")?.payload || {};
    return {
      session_id: String(firstPayload.sessionId || ""),
      first_at: first.createdAt || "",
      last_at: last.createdAt || "",
      events_count: ordered.length,
      event_types: [...eventTypes].join(" | "),
      visitor_type: visitor.type,
      visitor_label: visitor.label,
      source: normalizeTrafficSource(attribution.trafficSource || attribution.source || attribution.leadSource || "direct"),
      medium: attribution.trafficMedium || "",
      campaign: attribution.trafficCampaign || "",
      term: attribution.trafficTerm || "",
      content: attribution.trafficContent || "",
      campaign_id: attribution.trafficCampaignId || "",
      adgroup_id: attribution.trafficAdGroupId || "",
      creative_id: attribution.trafficCreativeId || "",
      match_type: attribution.trafficMatchType || "",
      device: attribution.trafficDevice || "",
      ads_network: attribution.trafficNetwork || "",
      click_id_type: attribution.trafficClickIdType || "",
      click_id: attribution.trafficClickId || "",
      referrer: attribution.trafficReferrer || "",
      landing: attribution.trafficLandingPage || landing.payload?.page || firstPayload.page || "",
      intento: intent,
      intento_base: intentBasis,
      scelta_percorso: landingPath,
      percorso_confronto: comparisonPath,
      percorso_sequenza: comparisonPathSequence,
      percorso_base: pathBasis,
      profilo_medio_scelto: pathSignals.paths.has("average"),
      manuale_scelto: pathSignals.paths.has("manual"),
      confronto_avviato: ordered.some((event) => event.eventType === "comparison_started" && !isAutomaticLandingPreview(event)),
      confronto_reale: hasRealComparison,
      offerte_visualizzate: offersViewed,
      numero_offerte: ordered.map((event) => Number(event.payload?.visibleOffersCount)).filter((value) => Number.isFinite(value) && value > 0).pop() || "",
      pdf_scelto: hasPdfSignal,
      pdf_scelto_registrato: ordered.some((event) => event.eventType === "comparison_path_selected" && String(event.payload?.pathChoice || "").toLowerCase() === "pdf"),
      pdf_picker_aperto: eventTypes.has("pdf_picker_opened"),
      pdf_file_selezionato: eventTypes.has("pdf_file_selected"),
      pdf_file_selezionati: selectionEvent.selectedCount ?? "",
      pdf_file_accettati: selectionEvent.acceptedCount ?? "",
      pdf_duplicati: selectionEvent.duplicateCount ?? "",
      pdf_analisi_avviata: eventTypes.has("pdf_analysis_started"),
      pdf_analisi_completata: eventTypes.has("pdf_analysis_completed"),
      pdf_analisi_interrotta: eventTypes.has("pdf_analysis_interrupted"),
      pdf_esito: pdfOutcome,
      pdf_file_count: latestPdfPayload.fileCount ?? "",
      pdf_success_count: latestPdfPayload.successCount ?? "",
      pdf_unrecognized_count: latestPdfPayload.unrecognizedCount ?? "",
      pdf_error_count: latestPdfPayload.errorCount ?? "",
      pdf_missing_fields: missingFields.join(" | "),
      pdf_missing_field_count: latestPdfPayload.missingFieldCount ?? (missingFields.length || ""),
      pdf_review_field_count: latestPdfPayload.reviewFieldCount ?? previewOpened.ocrReviewCount ?? "",
      pdf_diagnostic_codes: diagnosticCodes.join(" | "),
      pdf_analysis_stages: analysisStages.join(" | "),
      pdf_document_kinds: documentKinds.join(" | "),
      pdf_commodities: commodities.join(" | "),
      pdf_mixed_documents: latestPdfPayload.mixedDocuments ?? "",
      pdf_merge_blocked: latestPdfPayload.mergeBlocked ?? "",
      pdf_dati_confermati: eventTypes.has("pdf_data_confirmed"),
      pdf_autofill_aperto: eventTypes.has("pdf_autofill_preview_opened"),
      pdf_autofill_confermato: eventTypes.has("pdf_autofill_preview_confirmed"),
      pdf_campi_autofill: previewOpened.fieldCount ?? "",
      pdf_campi_selezionati: previewConfirmed.selectedCount ?? "",
      pdf_campi_saltati: previewConfirmed.skippedCount ?? "",
      lead_id: leadId,
      lead_creato: Boolean(leadId || eventTypes.has("lead_created_client")),
      popup_lead: eventTypes.has("lead_modal_opened"),
      otp_richiesto: eventTypes.has("otp_request_started"),
      otp_inviato: eventTypes.has("otp_sent"),
      otp_verificato: eventTypes.has("otp_verified"),
      offerta_sbloccata: eventTypes.has("offers_unlocked"),
      azione_offerta: offerAction,
      switcho,
      switcho_source: switchoEvent?.payload?.source || "",
      partner,
      provider: offerPayload.provider || "",
      offerta: offerPayload.offerName || "",
      ranking_economico: offerPayload.economyRank ?? "",
      ranking_visuale: offerPayload.displayRank ?? "",
      costo_annuo: offerPayload.annualCost ?? "",
      risparmio_annuo: offerPayload.annualDelta ?? lastPayload.bestSaving ?? firstPayload.bestSaving ?? "",
      tempo_attivo_secondi: exportSessionActiveSeconds(ordered),
      tempo_landing_secondi: engagementLast.engagementLandingSeconds ?? "",
      tempo_calcolatore_secondi: engagementLast.engagementCalculatorSeconds ?? "",
      tempo_offerte_secondi: engagementLast.engagementOffersSeconds ?? "",
      tempo_otp_secondi: engagementLast.engagementOtpSeconds ?? "",
      prima_azione_secondi: engagementLast.engagementFirstActionSeconds ?? "",
      offerte_raggiunte_secondi: engagementLast.engagementOffersReachedSeconds ?? "",
      esito_sessione: finalOutcome,
      abbandono_fase: abandonmentStage,
      ultimo_evento: last.eventType || "",
    };
  }).sort((a, b) => new Date(b.first_at || 0).getTime() - new Date(a.first_at || 0).getTime());
}

function analyticsJourneyRows(rawRows = []) {
  return analyticsSessionExportRows(rawRows).filter((row) => row.session_id && !["known_bot", "automation"].includes(row.visitor_type));
}

function analyticsJourneySummary(rows = [], rawRows = []) {
  const count = (predicate) => rows.filter(predicate).length;
  const funnelFromRows = (items = []) => ({
    entries: items.length,
    pathSelected: items.filter((row) => row.scelta_percorso).length,
    selfServiceSelected: items.filter((row) => String(row.scelta_percorso).includes("autonomia")).length,
    assistedSelected: items.filter((row) => String(row.scelta_percorso).includes("guidato")).length,
    averageSelected: items.filter((row) => row.profilo_medio_scelto).length,
    manualSelected: items.filter((row) => row.manuale_scelto).length,
    pdfSelected: items.filter((row) => row.pdf_scelto).length,
    pdfStarted: items.filter((row) => row.pdf_analisi_avviata).length,
    pdfCompleted: items.filter((row) => row.pdf_analisi_completata).length,
    comparisons: items.filter((row) => row.confronto_reale).length,
    offersViewed: items.filter((row) => row.offerte_visualizzate).length,
    switcho: items.filter((row) => row.switcho).length,
    leadModalOpened: items.filter((row) => row.popup_lead).length,
    otpRequestStarted: items.filter((row) => row.otp_richiesto).length,
    otpSent: items.filter((row) => row.otp_inviato).length,
    otpVerified: items.filter((row) => row.otp_verificato).length,
    offersUnlocked: items.filter((row) => row.offerta_sbloccata).length,
    offerAction: items.filter((row) => row.azione_offerta).length,
    redirects: items.filter((row) => row.partner || row.switcho).length,
  });
  const trafficCounts = {};
  const providerCounts = {};
  const offerCounts = {};
  rows.forEach((row) => {
    increment(trafficCounts, row.source || "direct");
    if (row.azione_offerta && row.provider) increment(providerCounts, row.provider);
    if (row.azione_offerta && row.offerta) increment(offerCounts, `${row.provider || "Fornitore"} - ${row.offerta}`);
  });
  const activityEvents = (Array.isArray(rawRows) ? rawRows : []).map((row) => {
    const payload = rawAnalyticsPayload(row);
    return { eventType: String(row.event_type || ""), dataOrigin: String(payload.dataOrigin || ""), pathChoice: String(payload.pathChoice || "") };
  });
  const bySource = {};
  Object.keys(trafficCounts).forEach((source) => {
    bySource[source] = funnelFromRows(rows.filter((row) => String(row.source || "direct") === source));
  });
  return {
    events: Array.isArray(rawRows) ? rawRows.length : 0,
    sessions: rows.length,
    activity: activityFunnelFromEvents(activityEvents),
    sessionFunnel: funnelFromRows(rows),
    sessionFunnelsBySource: bySource,
    trafficSources: sourceEntries(trafficCounts),
    topProviders: topEntries(providerCounts),
    topOffers: topEntries(offerCounts),
    landingSelfService: count((row) => String(row.scelta_percorso).includes("autonomia")),
    landingAssisted: count((row) => String(row.scelta_percorso).includes("guidato")),
    average: count((row) => row.profilo_medio_scelto),
    manual: count((row) => row.manuale_scelto),
    pdf: count((row) => row.pdf_scelto),
    pdfSelectedRecorded: count((row) => row.pdf_scelto_registrato),
    pdfPickerOpened: count((row) => row.pdf_picker_aperto),
    pdfFileSelected: count((row) => row.pdf_file_selezionato),
    pdfStarted: count((row) => row.pdf_analisi_avviata),
    pdfCompleted: count((row) => row.pdf_analisi_completata),
    pdfInterrupted: count((row) => row.pdf_analisi_interrotta),
    pdfWithMissingFields: count((row) => Number(row.pdf_missing_field_count || 0) > 0 || Boolean(row.pdf_missing_fields)),
    offersViewed: count((row) => row.offerte_visualizzate),
    switcho: count((row) => row.switcho),
    partner: count((row) => row.partner),
  };
}

function sendAnalyticsCsv(res, csv, filename) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.end(`\ufeff${csv}`);
}

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
    permissions: req.method === "DELETE"
      ? ["view_analytics", "delete_records"]
      : ["view_analytics", "view_control"],
    permissionMode: req.method === "DELETE" ? "all" : "any",
    allowHealth: req.method === "GET",
  });
  if (!identity) return;
  const authorizedBy = identity.authorizedBy;
  if (authorizedBy === "health") {
    return json(res, 200, {
      ok: true,
      status: "ready",
      authorizedBy,
      checkedAt: new Date().toISOString(),
    });
  }

  const url = new URL(req.url || "/api/staff-analytics", `https://${req.headers.host || "offertalogica.it"}`);
  if (req.method === "DELETE") {
    if (authorizedBy !== "supabase" || !isStaffAdminRole(identity.staff.role)) {
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

    const requestedIds = [...new Set(
      [id, ...ids]
        .map((value) => Number(value))
        .filter((value) => Number.isSafeInteger(value) && value > 0)
    )].slice(0, 500);
    const targetId = !resetAll && requestedIds.length === 1 ? String(requestedIds[0]) : null;
    const auditMetadata = {
      scope: resetAll ? "all" : requestedIds.length > 1 ? "bulk" : "single",
      requested_count: resetAll ? null : requestedIds.length,
      requested_ids: resetAll ? [] : requestedIds,
    };

    try {
      await writeStaffAudit({
        identity,
        action: "analytics_deletion_authorized",
        targetType: "lead_events",
        targetId,
        metadata: auditMetadata,
        source: "api:staff-analytics",
      });
    } catch (error) {
      console.error("staff-analytics-audit", error);
      return json(res, 503, { ok: false, error: "Audit Staff non disponibile: eliminazione non eseguita" });
    }

    const result = await deleteCustomerAnalytics({ id, ids, all: resetAll });

    try {
      await writeStaffAudit({
        identity,
        action: result.ok ? "analytics_deletion_completed" : "analytics_deletion_failed",
        targetType: "lead_events",
        targetId,
        result: result.ok ? "success" : "error",
        reason: result.ok ? "" : String(result.error || result.status || "delete_failed"),
        metadata: {
          ...auditMetadata,
          deleted_count: result.deletedCount ?? null,
          deleted_ids: Array.isArray(result.deletedIds) ? result.deletedIds.slice(0, 500) : [],
          reset_all: Boolean(result.resetAll),
        },
        source: "api:staff-analytics",
      });
    } catch (error) {
      console.error("staff-analytics-audit-finalize", error);
    }

    return json(res, result.ok ? 200 : 500, {
      ...result,
      authorizedBy,
      checkedAt: new Date().toISOString(),
    });
  }

  const format = String(url.searchParams.get("format") || "json").toLowerCase();
  const exportScope = String(url.searchParams.get("scope") || "events").toLowerCase();
  const exportRange = String(url.searchParams.get("range") || "baseline").toLowerCase();
  if (format === "csv") {
    if (!customerDbConfiguredForLandingAnalytics()) {
      return sendAnalyticsCsv(res, "", `offertalogica-analytics-${new Date().toISOString().slice(0, 10)}.csv`);
    }
    try {
      const rows = await loadAnalyticsExportRows(analyticsExportRangeFrom(exportRange));
      const date = new Date().toISOString().slice(0, 10);
      const sessionScopes = new Set(["sessions", "paths", "pdf", "switcho", "traffic", "offers", "landing"]);
      if (sessionScopes.has(exportScope)) {
        let sessionRows = analyticsJourneyRows(rows);
        if (exportScope === "paths") sessionRows = sessionRows.filter((row) => row.scelta_percorso || row.percorso_confronto || row.pdf_scelto);
        if (exportScope === "pdf") sessionRows = sessionRows.filter((row) => row.pdf_scelto);
        if (exportScope === "switcho") sessionRows = sessionRows.filter((row) => row.switcho);
        if (exportScope === "traffic") sessionRows = sessionRows.filter((row) => row.source || row.term || row.referrer || row.landing);
        if (exportScope === "offers") sessionRows = sessionRows.filter((row) => row.offerte_visualizzate || row.azione_offerta || row.provider || row.offerta);
        if (exportScope === "landing") sessionRows = sessionRows.filter((row) => row.scelta_percorso || String(row.event_types || "").includes("landing_view"));
        const headers = [
          "session_id", "first_at", "last_at", "events_count", "event_types", "visitor_type", "visitor_label",
          "source", "medium", "campaign", "term", "content", "campaign_id", "adgroup_id", "creative_id", "match_type", "device", "ads_network", "click_id_type", "click_id", "referrer", "landing",
          "intento", "intento_base", "scelta_percorso", "percorso_confronto", "percorso_sequenza", "percorso_base", "profilo_medio_scelto", "manuale_scelto", "confronto_avviato", "confronto_reale", "offerte_visualizzate", "numero_offerte",
          "pdf_scelto", "pdf_scelto_registrato", "pdf_picker_aperto", "pdf_file_selezionato", "pdf_file_selezionati", "pdf_file_accettati", "pdf_duplicati",
          "pdf_analisi_avviata", "pdf_analisi_completata", "pdf_analisi_interrotta", "pdf_esito", "pdf_file_count", "pdf_success_count", "pdf_unrecognized_count", "pdf_error_count",
          "pdf_missing_fields", "pdf_missing_field_count", "pdf_review_field_count", "pdf_diagnostic_codes", "pdf_analysis_stages", "pdf_document_kinds", "pdf_commodities", "pdf_mixed_documents", "pdf_merge_blocked",
          "pdf_dati_confermati", "pdf_autofill_aperto", "pdf_autofill_confermato", "pdf_campi_autofill", "pdf_campi_selezionati", "pdf_campi_saltati",
          "lead_id", "lead_creato", "popup_lead", "otp_richiesto", "otp_inviato", "otp_verificato", "offerta_sbloccata", "azione_offerta", "switcho", "switcho_source", "partner",
          "provider", "offerta", "ranking_economico", "ranking_visuale", "costo_annuo", "risparmio_annuo", "tempo_attivo_secondi", "tempo_landing_secondi", "tempo_calcolatore_secondi", "tempo_offerte_secondi",
          "tempo_otp_secondi", "prima_azione_secondi", "offerte_raggiunte_secondi", "esito_sessione", "abbandono_fase", "ultimo_evento"
        ];
        const filenameScope = ({
          sessions: "funnel-sessioni", paths: "percorsi", pdf: "percorso-pdf", switcho: "percorso-switcho",
          traffic: "provenienza-intento", offers: "offerte", landing: "landing"
        })[exportScope] || "sessioni";
        return sendAnalyticsCsv(res, csvFromObjects(sessionRows, headers), `offertalogica-${filenameScope}-${exportRange}-${date}.csv`);
      }
      const eventRows = analyticsEventExportRows(rows);
      const headers = [
        "id", "lead_id", "event_type", "created_at", "session_id", "page", "customer_type", "data_origin", "source", "lead_source",
        "traffic_source", "traffic_medium", "traffic_campaign", "traffic_term", "traffic_content", "traffic_campaign_id", "traffic_adgroup_id",
        "traffic_creative_id", "traffic_match_type", "traffic_device", "traffic_network", "traffic_referrer", "traffic_landing_page",
        "traffic_click_id_type", "traffic_click_id", "traffic_agent", "traffic_reason", "event_integrity", "verified", "staff_mode", "path_choice", "trigger", "best_saving",
        "pdf_document_count", "file_count", "selected_count", "accepted_count", "duplicate_count", "success_count", "unrecognized_count", "error_count", "analysis_status",
        "diagnostic_code", "diagnostic_codes", "analysis_stage", "analysis_stages", "ingress_mode", "ingress_modes", "document_kinds", "commodities", "missing_fields", "missing_field_count", "review_field_count",
        "field_count", "protected_count", "ocr_review_count", "skipped_count", "protected_skipped_count", "active_slot", "retained_current_documents", "retained_offer_documents", "mixed_documents", "merge_blocked",
        "gas_decision", "electricity_decision", "has_new_offer", "visible_offers_count", "active_partner_offers_count", "consultant_offers_count", "offer_id", "offer_name", "provider",
        "destination_type", "destination_status", "display_group", "economy_rank", "display_rank", "annual_cost", "annual_delta", "network", "model",
        "redirect", "routing_version", "engagement_stage", "engagement_reason", "engagement_active_seconds", "engagement_elapsed_seconds",
        "engagement_landing_seconds", "engagement_calculator_seconds", "engagement_offers_seconds", "engagement_otp_seconds",
        "engagement_first_action_seconds", "engagement_offers_reached_seconds", "telemetry", "reason", "payload_json"
      ];
      return sendAnalyticsCsv(res, csvFromObjects(eventRows, headers), `offertalogica-analytics-completo-${exportRange}-${date}.csv`);
    } catch (error) {
      console.error("staff-analytics-export", error);
      return json(res, 500, { ok: false, error: String(error?.message || error || "analytics_export_error") });
    }
  }

  const requestedSessionId = String(url.searchParams.get("sessionId") || "").trim().slice(0, 160);
  if (requestedSessionId) {
    const sessionRawResult = await listCustomerAnalytics({ limit: 5000, sessionId: requestedSessionId });
    const sessionResult = enhanceAnalyticsForStaff(analyticsFromCampaignBaseline(sessionRawResult), new Map());
    return json(res, sessionResult.ok ? 200 : 500, {
      ...sessionResult,
      requestedSessionId,
      baseline: {
        from: CAMPAIGN_BASELINE_ISO,
        label: CAMPAIGN_BASELINE_LABEL,
        timezone: "Europe/Rome",
      },
      authorizedBy,
      checkedAt: new Date().toISOString(),
    });
  }

  const limit = url.searchParams.get("limit") || 2000;
  const landingRange = normalizeLandingRange(url.searchParams.get("landingRange"));
  const [rawResult, landingPath, trafficSignals, switcho, fullAnalyticsRows] = await Promise.all([
    listCustomerAnalytics({ limit }),
    loadLandingPathAnalytics(landingRange),
    loadAnalyticsTrafficSignals(limit, CAMPAIGN_BASELINE_ISO).catch(() => new Map()),
    loadSwitchoAnalytics(CAMPAIGN_BASELINE_ISO).catch((error) => ({
      ok: false, configured: true, rows: [],
      summary: { sessions: 0, offerSelections: 0, guidedSessions: 0, redirects: 0, sources: [] },
      error: String(error?.message || error || "switcho_analytics_error"),
    })),
    loadAnalyticsExportRows(CAMPAIGN_BASELINE_ISO).catch((error) => {
      console.error("staff-analytics-journeys", error);
      return [];
    }),
  ]);
  const result = enhanceAnalyticsForStaff(analyticsFromCampaignBaseline(rawResult), trafficSignals);
  const journeys = analyticsJourneyRows(fullAnalyticsRows);
  const journeySummary = analyticsJourneySummary(journeys, fullAnalyticsRows);

  json(res, result.ok ? 200 : 500, {
    ...result,
    landingPath,
    journeys,
    journeySummary,
    switcho,
    baseline: {
      from: CAMPAIGN_BASELINE_ISO,
      label: CAMPAIGN_BASELINE_LABEL,
      timezone: "Europe/Rome",
    },
    authorizedBy,
    checkedAt: new Date().toISOString(),
  });
}
