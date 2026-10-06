import crypto from "node:crypto";
import { isIP } from "node:net";
import { clientIp, json, method, requireAllowedOrigin } from "../lib/http.js";
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
const CUSTOMER_DB_USAGE_EXCLUSIONS_TABLE = process.env.CUSTOMER_DB_USAGE_EXCLUSIONS_TABLE || "usage_count_exclusions";
const CAMPAIGN_BASELINE_ISO = "2026-09-02T22:00:00.000Z";
const CAMPAIGN_BASELINE_LABEL = "3 settembre 2026, 00:00";
const ANALYTICS_TIME_ZONE = "Europe/Rome";


function usageRomeDayKey(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ANALYTICS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function usagePeakWithin(timestamps, windowMs) {
  let best = 0;
  let left = 0;
  for (let right = 0; right < timestamps.length; right += 1) {
    while (timestamps[right] - timestamps[left] > windowMs) left += 1;
    best = Math.max(best, right - left + 1);
  }
  return best;
}

function usagePercentile(values, percentile) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentile) - 1));
  return sorted[index];
}

function usageObservation(events = [], now = Date.now(), exclusions = [], options = {}) {
  const requestedWindowDays = Number(options?.windowDays || 7);
  const windowDays = [1, 7, 30].includes(requestedWindowDays) ? requestedWindowDays : 7;
  const requestedTool = String(options?.tool || "all").trim().toLowerCase();
  const tool = ["all", "domestic", "business"].includes(requestedTool) ? requestedTool : "all";
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const twoHoursMs = 2 * 60 * 60 * 1000;
  const oneDayMs = 24 * 60 * 60 * 1000;
  const dedupMs = 10 * 60 * 1000;
  const cutoff = now - windowMs;
  const groups = new Map();
  const activeExclusions = new Set(
    (Array.isArray(exclusions) ? exclusions : [])
      .filter((entry) => entry?.active !== false)
      .map((entry) => `${String(entry?.subjectType || "")}:${String(entry?.subjectHash || "")}`)
      .filter((value) => !value.endsWith(":")),
  );

  const observedEventTypes = tool === "domestic"
    ? new Set(["comparison_completed"])
    : tool === "business"
      ? new Set(["business_calculation_completed"])
      : new Set(["comparison_completed", "business_calculation_completed"]);
  const ordered = events
    .filter((event) => observedEventTypes.has(String(event?.eventType || "")))
    .filter((event) => event?.usageIdentityVersion === "usage-v1" && event?.usageVisitorHash)
    .filter((event) => event?.payload?.usageExcluded !== true)
    .filter((event) => !activeExclusions.has(`visitor_hash:${String(event?.usageVisitorHash || "")}`))
    .filter((event) => !activeExclusions.has(`ip_hash:${String(event?.usageIpHash || "")}`))
    .map((event) => ({ ...event, timestamp: new Date(event.createdAt || 0).getTime() }))
    .filter((event) => Number.isFinite(event.timestamp) && event.timestamp >= cutoff && event.timestamp <= now + 60000)
    .sort((a, b) => a.timestamp - b.timestamp);

  const lastAnalysisByVisitor = new Map();
  ordered.forEach((event) => {
    const visitor = String(event.usageVisitorHash || "");
    const analysis = String(event.usageAnalysisHash || "");
    const eventType = String(event.eventType || "");
    const dedupKey = analysis ? `${visitor}:${eventType}:${analysis}` : "";
    if (dedupKey) {
      const previous = Number(lastAnalysisByVisitor.get(dedupKey) || 0);
      lastAnalysisByVisitor.set(dedupKey, event.timestamp);
      if (previous && event.timestamp - previous <= dedupMs) return;
    }
    if (!groups.has(visitor)) groups.set(visitor, []);
    groups.get(visitor).push(event);
  });

  const rows = [...groups.entries()].map(([visitorHash, visitorEvents]) => {
    const timestamps = visitorEvents.map((event) => event.timestamp).sort((a, b) => a - b);
    const sessions = new Set(visitorEvents.map((event) => String(event.sessionId || "")).filter(Boolean));
    const days = new Set(timestamps.map(usageRomeDayKey).filter(Boolean));
    const profiles = new Set(visitorEvents
      .map((event) => {
        const hash = String(event.usageAnalysisHash || "");
        return hash ? `${String(event.eventType || "")}:${hash}` : "";
      })
      .filter(Boolean));
    const domesticAnalysesWindow = visitorEvents.filter((event) => event.eventType === "comparison_completed").length;
    const businessAnalysesWindow = visitorEvents.filter((event) => event.eventType === "business_calculation_completed").length;
    const analysesWindow = timestamps.length;
    const activeDays = days.size;
    const sessionCount = sessions.size;
    const distinctProfiles = profiles.size;
    const watchCandidate = analysesWindow > 1 || activeDays > 1 || sessionCount > 1 || distinctProfiles > 1;
    return {
      visitorHash,
      firstAt: new Date(timestamps[0]).toISOString(),
      lastAt: new Date(timestamps[timestamps.length - 1]).toISOString(),
      analysesWindow,
      domesticAnalysesWindow,
      businessAnalysesWindow,
      // Alias mantenuti per compatibilità con eventuali consumer Staff precedenti.
      analyses7d: analysesWindow,
      domesticAnalyses7d: domesticAnalysesWindow,
      businessAnalyses7d: businessAnalysesWindow,
      analysesCurrent2h: timestamps.filter((value) => value >= now - twoHoursMs).length,
      analysesCurrent24h: timestamps.filter((value) => value >= now - oneDayMs).length,
      peak2h: usagePeakWithin(timestamps, twoHoursMs),
      peak24h: usagePeakWithin(timestamps, oneDayMs),
      activeDays,
      sessions: sessionCount,
      distinctProfiles,
      watchCandidate,
    };
  }).sort((a, b) => (
    b.peak24h - a.peak24h
    || b.activeDays - a.activeDays
    || b.distinctProfiles - a.distinctProfiles
    || String(b.lastAt).localeCompare(String(a.lastAt))
  ));

  const peak24hValues = rows.map((row) => row.peak24h);
  const occasionalVisitors = rows.filter((row) => !row.watchCandidate).length;
  return {
    mode: "shadow",
    identityVersion: "usage-v1",
    windowDays,
    tool,
    dedupMinutes: 10,
    summary: {
      visitors: rows.length,
      meaningfulAnalyses: rows.reduce((sum, row) => sum + row.analysesWindow, 0),
      domesticAnalyses: rows.reduce((sum, row) => sum + row.domesticAnalysesWindow, 0),
      businessAnalyses: rows.reduce((sum, row) => sum + row.businessAnalysesWindow, 0),
      occasionalVisitors,
      watchVisitors: rows.length - occasionalVisitors,
      multiDayVisitors: rows.filter((row) => row.activeDays > 1).length,
      maxPeak24h: peak24hValues.length ? Math.max(...peak24hValues) : 0,
      p50Peak24h: usagePercentile(peak24hValues, 0.50),
      p90Peak24h: usagePercentile(peak24hValues, 0.90),
    },
    rows,
  };
}

function normalizeAnalyticsMonth(value) {
  const normalized = String(value || "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(normalized) ? normalized : "";
}

function timeZoneParts(date, timeZone = ANALYTICS_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

function timeZoneOffsetMs(date, timeZone = ANALYTICS_TIME_ZONE) {
  const parts = timeZoneParts(date, timeZone);
  const reconstructed = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return reconstructed - Math.floor(date.getTime() / 1000) * 1000;
}

function zonedMidnightIso(year, month, day, timeZone = ANALYTICS_TIME_ZONE) {
  const wallClockUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  let candidate = new Date(wallClockUtc);
  let offset = timeZoneOffsetMs(candidate, timeZone);
  candidate = new Date(wallClockUtc - offset);
  const adjustedOffset = timeZoneOffsetMs(candidate, timeZone);
  if (adjustedOffset !== offset) candidate = new Date(wallClockUtc - adjustedOffset);
  return candidate.toISOString();
}

function currentAnalyticsMonth() {
  const parts = timeZoneParts(new Date(), ANALYTICS_TIME_ZONE);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}`;
}

function analyticsMonthPeriod(value) {
  const month = normalizeAnalyticsMonth(value);
  if (!month) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const rawFrom = zonedMidnightIso(year, monthNumber, 1);
  const to = zonedMidnightIso(nextYear, nextMonth, 1);
  const baselineMs = new Date(CAMPAIGN_BASELINE_ISO).getTime();
  const rawFromMs = new Date(rawFrom).getTime();
  const from = Number.isFinite(rawFromMs) && rawFromMs < baselineMs ? CAMPAIGN_BASELINE_ISO : rawFrom;
  const label = new Intl.DateTimeFormat("it-IT", { timeZone: ANALYTICS_TIME_ZONE, month: "long", year: "numeric" })
    .format(new Date(Date.UTC(year, monthNumber - 1, 15, 12)));
  return { month, from, to, label, partial: month === currentAnalyticsMonth(), timezone: ANALYTICS_TIME_ZONE };
}
function analyticsRelativeRangeFrom(period, rangeValue) {
  if (!period) return "";
  const range = normalizeLandingRange(rangeValue);
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 0;
  if (!days) return period.from;
  const periodStart = new Date(period.from).getTime();
  const periodEnd = new Date(period.to).getTime();
  const anchor = period.partial ? Date.now() : periodEnd;
  const candidate = anchor - days * 86400000;
  return new Date(Math.max(periodStart, candidate)).toISOString();
}

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
  "bill_photo_camera_opened",
  "bill_photo_gallery_opened",
  "bill_photo_selected",
  "bill_photo_analysis_started",
  "bill_photo_analysis_failed",
  "bill_photo_comparison_auto_started",
  "activation_data_copied",
  "business_photovoltaic_tool_opened",
  "assistance_callback_verified",
  "activation_channel_choice_opened",
  "activation_channel_selected",
  "provider_site_redirect",
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

function customerDbWriteHeaders(prefer = "return=representation") {
  return {
    ...customerDbReadHeaders(),
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

function usageSubjectHash(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : "";
}

function usageIpSubjectHash(ip) {
  const secret = String(process.env.USAGE_CONTROL_HASH_SECRET || "").trim();
  const normalizedIp = String(ip || "").trim();
  if (secret.length < 32 || !isIP(normalizedIp)) return "";
  return crypto.createHmac("sha256", secret).update(`usage-ip:${normalizedIp}`).digest("hex");
}

function usageExclusionRow(row = {}) {
  return {
    id: String(row.id || ""),
    subjectType: String(row.subject_type || ""),
    subjectHash: String(row.subject_hash || ""),
    label: String(row.label || ""),
    reason: String(row.reason || ""),
    active: row.active !== false,
    createdAt: row.created_at || "",
  };
}

async function listUsageCountExclusions() {
  if (!customerDbConfiguredForLandingAnalytics()) {
    return { ok: false, error: "Database clienti non configurato", rows: [] };
  }
  const query = new URLSearchParams({
    select: "id,subject_type,subject_hash,label,reason,active,created_at",
    active: "eq.true",
    order: "created_at.desc",
    limit: "500",
  });
  const response = await fetch(
    `${customerDbBaseUrl()}/rest/v1/${CUSTOMER_DB_USAGE_EXCLUSIONS_TABLE}?${query.toString()}`,
    { method: "GET", headers: customerDbReadHeaders() },
  );
  if (!response.ok) {
    return { ok: false, error: `Archivio esclusioni non disponibile (${response.status})`, rows: [] };
  }
  const payload = await response.json().catch(() => []);
  return { ok: true, rows: Array.isArray(payload) ? payload.map(usageExclusionRow) : [] };
}

async function createUsageCountExclusion({ subjectType, subjectHash, label, reason, staffUserId }) {
  const hash = usageSubjectHash(subjectHash);
  if (!hash || !["visitor_hash", "ip_hash"].includes(subjectType)) {
    return { ok: false, error: "Esclusione non valida" };
  }

  const existingQuery = new URLSearchParams({
    select: "id,subject_type,subject_hash,label,reason,active,created_at",
    subject_type: `eq.${subjectType}`,
    subject_hash: `eq.${hash}`,
    active: "eq.true",
    limit: "1",
  });
  const existingResponse = await fetch(
    `${customerDbBaseUrl()}/rest/v1/${CUSTOMER_DB_USAGE_EXCLUSIONS_TABLE}?${existingQuery.toString()}`,
    { method: "GET", headers: customerDbReadHeaders() },
  );
  if (!existingResponse.ok) return { ok: false, error: `Archivio esclusioni non disponibile (${existingResponse.status})` };
  const existingRows = await existingResponse.json().catch(() => []);
  if (Array.isArray(existingRows) && existingRows[0]) {
    return { ok: true, created: false, row: usageExclusionRow(existingRows[0]) };
  }

  const response = await fetch(`${customerDbBaseUrl()}/rest/v1/${CUSTOMER_DB_USAGE_EXCLUSIONS_TABLE}`, {
    method: "POST",
    headers: customerDbWriteHeaders(),
    body: JSON.stringify([{
      subject_type: subjectType,
      subject_hash: hash,
      label: String(label || "").trim().slice(0, 120),
      reason: String(reason || "").trim().slice(0, 500),
      active: true,
      created_by: staffUserId || null,
    }]),
  });
  if (!response.ok) return { ok: false, error: `Creazione esclusione non riuscita (${response.status})` };
  const rows = await response.json().catch(() => []);
  return { ok: true, created: true, row: usageExclusionRow(Array.isArray(rows) ? rows[0] || {} : {}) };
}

async function revokeUsageCountExclusion({ id, staffUserId }) {
  const normalizedId = String(id || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalizedId)) {
    return { ok: false, error: "Identificativo esclusione non valido" };
  }
  const query = new URLSearchParams({ id: `eq.${normalizedId}`, active: "eq.true" });
  const response = await fetch(
    `${customerDbBaseUrl()}/rest/v1/${CUSTOMER_DB_USAGE_EXCLUSIONS_TABLE}?${query.toString()}`,
    {
      method: "PATCH",
      headers: customerDbWriteHeaders(),
      body: JSON.stringify({
        active: false,
        revoked_at: new Date().toISOString(),
        revoked_by: staffUserId || null,
      }),
    },
  );
  if (!response.ok) return { ok: false, error: `Revoca esclusione non riuscita (${response.status})` };
  const rows = await response.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] || null : null;
  if (!row) return { ok: false, error: "Esclusione attiva non trovata" };
  return { ok: true, row: usageExclusionRow(row) };
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

function analyticsEventSequence(event = {}) {
  const raw = event.sessionEventSeq ?? event.session_event_seq ?? event.payload?.session_event_seq ?? event.payload?.sessionEventSeq;
  if (raw === null || raw === undefined || raw === "") return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function analyticsEventClientTimestamp(event = {}) {
  return String(event.clientTimestamp || event.client_timestamp || event.payload?.client_timestamp || event.payload?.clientTimestamp || "").trim();
}

function analyticsEventTime(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function compareAnalyticsEventOrder(a = {}, b = {}) {
  const aSeq = analyticsEventSequence(a);
  const bSeq = analyticsEventSequence(b);
  if (aSeq !== null && bSeq !== null && aSeq !== bSeq) return aSeq - bSeq;

  const aClient = analyticsEventTime(analyticsEventClientTimestamp(a));
  const bClient = analyticsEventTime(analyticsEventClientTimestamp(b));
  if (aClient !== null && bClient !== null && aClient !== bClient) return aClient - bClient;

  const aServer = analyticsEventTime(a.createdAt || a.created_at);
  const bServer = analyticsEventTime(b.createdAt || b.created_at);
  if (aServer !== null && bServer !== null && aServer !== bServer) return aServer - bServer;
  if (aServer !== null && bServer === null) return -1;
  if (aServer === null && bServer !== null) return 1;

  const aId = Number(a.id);
  const bId = Number(b.id);
  if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) return aId - bId;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

function pdfDiagnosticReason({ status = "", codes = [], missingFieldCount = 0, mixedDocuments = false, mergeBlocked = false } = {}) {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  const list = [...new Set((Array.isArray(codes) ? codes : String(codes || "").split(/[|,]/))
    .map((code) => String(code || "").trim().toUpperCase())
    .filter(Boolean))];
  const signature = list.join(" ");
  if (mixedDocuments || mergeBlocked) return "Documenti incompatibili o misti";
  if (normalizedStatus === "unrecognized") return "Documento non riconosciuto";
  if (normalizedStatus === "success_missing_data" || Number(missingFieldCount || 0) > 0) return "Dati insufficienti o da confermare";
  if (/NETWORK|FETCH|UPLOAD|DIRECT_UPLOAD|UPLOAD_/.test(signature)) return "Errore di rete o caricamento";
  if (/TIMEOUT|DEADLINE|INSUFFICIENT_TIME_BUDGET/.test(signature)) return "Timeout analisi";
  if (/PDF_INVALID|PDF_PROTECTED|PDF_TOO_LARGE|FILE_MISSING/.test(signature)) return "PDF non valido o non leggibile";
  if (/UNRECOGNIZED|NOT_RECOGNIZED/.test(signature)) return "Documento non riconosciuto";
  if (/INVALID_RESULT|INVALID_OUTPUT|EMPTY_OUTPUT|JSON_PARSE|INCOMPLETE|REFUSAL|RESPONSE_INVALID/.test(signature)) return "Risposta analisi non utilizzabile";
  if (normalizedStatus === "interrupted") return "Analisi interrotta o abbandonata";
  if (normalizedStatus === "failed" || list.length) return list.length ? `Errore interno/altro · ${list.join(", ")}` : "Errore tecnico (evento storico senza codice)";
  return "";
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
    clientTimestamp: String(payload.client_timestamp || payload.clientTimestamp || ""),
    sessionEventSeq: analyticsEventSequence({ payload }),
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
    const ordered = [...group].sort(compareAnalyticsEventOrder);
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

function switchoAnalyticsFromRawRows(rawRows = []) {
  const events = (Array.isArray(rawRows) ? rawRows : []).map(switchoEventFromRow).filter(Boolean);
  const rows = switchoSessionsFromEvents(events);
  const sourceCounts = {};
  rows.forEach((row) => increment(sourceCounts, row.trafficSource || "direct"));
  return {
    ok: true,
    configured: customerDbConfiguredForLandingAnalytics(),
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


const OFFER_ROUTE_EVENT_TYPES = [
  "activation_channel_choice_opened",
  "activation_channel_selected",
  "provider_site_redirect",
  "offer_switcho_redirect",
  "offer_redirect",
];
const OFFER_ROUTE_ANALYTICS_PAGE_SIZE = 1000;
const OFFER_ROUTE_ANALYTICS_MAX_ROWS = 20000;

function offerRouteCategory(eventType = "", payload = {}) {
  const route = String(payload.route || "").trim().toLowerCase();
  if (route === "offertalogica_partner") return "offertalogica_partner";
  if (route === "switcho_provider") return "switcho_provider";
  if (route === "provider_site") return "external_provider";
  if (route === "no_route") return "no_route";

  const channel = String(payload.channel || "").trim().toLowerCase();
  const destinationType = String(payload.destinationType || "").trim().toLowerCase();
  const destinationStatus = String(payload.destinationStatus || "").trim().toLowerCase();
  if (eventType === "provider_site_redirect") return "external_provider";
  if (eventType === "offer_redirect") return destinationType === "switcho" ? "switcho_provider" : "offertalogica_partner";
  if (eventType === "offer_switcho_redirect") return destinationType === "affiliazione" ? "offertalogica_partner" : "switcho_provider";
  if (eventType === "activation_channel_selected") {
    if (channel === "bill_upload") return "offertalogica_partner";
    if (channel === "provider_site") return "external_provider";
    if (channel === "switcho") return destinationType === "affiliazione" ? "offertalogica_partner" : "switcho_provider";
  }
  if (eventType === "activation_channel_choice_opened") {
    if (destinationType === "affiliazione" && destinationStatus === "attiva") return "offertalogica_partner";
  }
  return "";
}

function offerRouteEventFromRow(row = {}) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  const eventType = String(row?.event_type || row?.eventType || "");
  const category = offerRouteCategory(eventType, payload);
  if (!category) return null;
  return {
    id: String(row?.id || ""),
    eventType,
    createdAt: row?.created_at || "",
    sessionId: String(payload.sessionId || ""),
    provider: String(payload.provider || "").trim(),
    offerId: String(payload.offerId || "").trim(),
    offerName: String(payload.offerName || "").trim(),
    route: String(payload.route || "").trim().toLowerCase(),
    channel: String(payload.channel || "").trim().toLowerCase(),
    destinationType: String(payload.destinationType || "").trim().toLowerCase(),
    destinationStatus: String(payload.destinationStatus || "").trim().toLowerCase(),
    category,
  };
}

function summarizeOfferRouteEvents(events = []) {
  const categoryKeys = ["offertalogica_partner", "switcho_provider", "external_provider", "no_route"];
  const makeBucket = () => ({
    sessions: new Set(),
    opens: new Set(),
    billUploads: new Set(),
    switchoChoices: new Set(),
    providerRedirects: new Set(),
    partnerRedirects: new Set(),
    providerSessions: new Map(),
  });
  const state = Object.fromEntries(categoryKeys.map((key) => [key, makeBucket()]));
  const classifiedSessions = new Set();
  const providerDetails = new Map();
  const offerDetails = new Map();

  const ensureDetail = (map, key, seed = {}) => {
    if (!key) return null;
    if (!map.has(key)) {
      map.set(key, {
        key,
        provider: String(seed.provider || "").trim(),
        offerName: String(seed.offerName || "").trim(),
        categories: new Map(),
        sessions: new Set(),
        opens: new Set(),
        billUploads: new Set(),
        switchoChoices: new Set(),
        providerRedirects: new Set(),
        partnerRedirects: new Set(),
        actionSessions: new Set(),
      });
    }
    return map.get(key);
  };

  const registerDetail = (detail, event, sessionKey) => {
    if (!detail) return;
    detail.sessions.add(sessionKey);
    if (!detail.categories.has(event.category)) detail.categories.set(event.category, new Set());
    detail.categories.get(event.category).add(sessionKey);
    if (event.eventType === "activation_channel_choice_opened") detail.opens.add(sessionKey);
    if (event.eventType === "activation_channel_selected" && event.channel === "bill_upload") {
      detail.billUploads.add(sessionKey);
      detail.actionSessions.add(sessionKey);
    }
    if ((event.eventType === "activation_channel_selected" && event.channel === "switcho") || event.eventType === "offer_switcho_redirect") {
      detail.switchoChoices.add(sessionKey);
      detail.actionSessions.add(sessionKey);
    }
    if (event.eventType === "provider_site_redirect") {
      detail.providerRedirects.add(sessionKey);
      detail.actionSessions.add(sessionKey);
    }
    if (event.eventType === "offer_redirect") {
      detail.partnerRedirects.add(sessionKey);
      detail.actionSessions.add(sessionKey);
    }
  };

  events.forEach((event) => {
    const bucket = state[event.category];
    if (!bucket) return;
    const sessionKey = event.sessionId ? `session:${event.sessionId}` : `event:${event.id}`;
    bucket.sessions.add(sessionKey);
    classifiedSessions.add(sessionKey);
    if (event.eventType === "activation_channel_choice_opened") bucket.opens.add(sessionKey);
    if (event.eventType === "activation_channel_selected" && event.channel === "bill_upload") bucket.billUploads.add(sessionKey);
    if ((event.eventType === "activation_channel_selected" && event.channel === "switcho") || event.eventType === "offer_switcho_redirect") bucket.switchoChoices.add(sessionKey);
    if (event.eventType === "provider_site_redirect") bucket.providerRedirects.add(sessionKey);
    if (event.eventType === "offer_redirect") bucket.partnerRedirects.add(sessionKey);
    if (event.provider) {
      if (!bucket.providerSessions.has(event.provider)) bucket.providerSessions.set(event.provider, new Set());
      bucket.providerSessions.get(event.provider).add(sessionKey);
      registerDetail(ensureDetail(providerDetails, event.provider, { provider: event.provider }), event, sessionKey);
    }
    if (event.provider || event.offerName) {
      const offerKey = `${event.provider || "Fornitore"} - ${event.offerName || "Offerta"}`;
      registerDetail(ensureDetail(offerDetails, offerKey, { provider: event.provider, offerName: event.offerName }), event, sessionKey);
    }
  });

  const finalize = (bucket) => ({
    sessions: bucket.sessions.size,
    opens: bucket.opens.size,
    billUploads: bucket.billUploads.size,
    switchoChoices: bucket.switchoChoices.size,
    providerRedirects: bucket.providerRedirects.size,
    partnerRedirects: bucket.partnerRedirects.size,
    topProviders: [...bucket.providerSessions.entries()]
      .map(([key, sessions]) => ({ key, count: sessions.size }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
      .slice(0, 5),
  });

  const detailNetwork = (detail) => {
    const observed = [...detail.categories.entries()]
      .filter(([, sessions]) => sessions.size > 0)
      .map(([category]) => category)
      .filter((category) => category !== "no_route");
    const unique = [...new Set(observed)];
    if (unique.length === 1) return unique[0];
    if (unique.length > 1) return "mixed";
    return detail.categories.has("no_route") ? "no_route" : "unknown";
  };

  const finalizeDetailMap = (map) => [...map.values()].map((detail) => {
    const stopped = [...detail.opens].filter((sessionKey) => !detail.actionSessions.has(sessionKey)).length;
    const categoryCounts = Object.fromEntries(categoryKeys.map((category) => [category, detail.categories.get(category)?.size || 0]));
    return {
      key: detail.key,
      provider: detail.provider,
      offerName: detail.offerName,
      network: detailNetwork(detail),
      networkCounts: categoryCounts,
      sessions: detail.sessions.size,
      opens: detail.opens.size,
      billUploads: detail.billUploads.size,
      switchoChoices: detail.switchoChoices.size,
      providerRedirects: detail.providerRedirects.size,
      partnerRedirects: detail.partnerRedirects.size,
      noActionAfterOpen: stopped,
    };
  }).sort((a, b) => b.sessions - a.sessions || a.key.localeCompare(b.key));

  return {
    classifiedSessions: classifiedSessions.size,
    offertalogicaPartner: finalize(state.offertalogica_partner),
    switchoProvider: finalize(state.switcho_provider),
    externalProvider: finalize(state.external_provider),
    noRoute: finalize(state.no_route),
    providerDetails: finalizeDetailMap(providerDetails),
    offerDetails: finalizeDetailMap(offerDetails),
  };
}

async function loadOfferRouteAnalytics(from = CAMPAIGN_BASELINE_ISO) {
  const emptySummary = summarizeOfferRouteEvents([]);
  if (!customerDbConfiguredForLandingAnalytics()) {
    return { ok: true, configured: false, from, summary: emptySummary };
  }
  const allEvents = [];
  for (let offset = 0; offset < OFFER_ROUTE_ANALYTICS_MAX_ROWS; offset += OFFER_ROUTE_ANALYTICS_PAGE_SIZE) {
    const query = new URLSearchParams({
      select: "id,event_type,created_at,payload",
      order: "created_at.asc",
      limit: String(OFFER_ROUTE_ANALYTICS_PAGE_SIZE),
      offset: String(offset),
      event_type: `in.(${OFFER_ROUTE_EVENT_TYPES.join(",")})`,
    });
    if (from) query.set("created_at", `gte.${from}`);
    const response = await fetch(
      `${customerDbBaseUrl()}/rest/v1/${CUSTOMER_DB_EVENTS_TABLE}?${query.toString()}`,
      { method: "GET", headers: customerDbReadHeaders() },
    );
    if (!response.ok) throw new Error(`Customer DB offer route analytics error ${response.status}`);
    const rawRows = await response.json();
    const batch = (Array.isArray(rawRows) ? rawRows : []).map(offerRouteEventFromRow).filter(Boolean);
    allEvents.push(...batch);
    if (!Array.isArray(rawRows) || rawRows.length < OFFER_ROUTE_ANALYTICS_PAGE_SIZE) break;
  }
  return {
    ok: true,
    configured: true,
    from,
    summary: summarizeOfferRouteEvents(allEvents),
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

const ANALYTICS_RECENT_JOURNEY_MAX_ROWS = 5000;
const ANALYTICS_SUMMARY_RPC = "offertalogica_staff_analytics_summary";

function analyticsRpcMissing(status, payload = {}) {
  const code = String(payload?.code || "").trim();
  const message = String(payload?.message || payload?.error || "").toLowerCase();
  return status === 404 || code === "PGRST202" || code === "42883" || message.includes("could not find the function") || message.includes("does not exist");
}

async function loadDatabaseAnalyticsSummary(from = CAMPAIGN_BASELINE_ISO) {
  if (!customerDbConfiguredForLandingAnalytics()) return null;
  const response = await fetch(
    `${customerDbBaseUrl()}/rest/v1/rpc/${ANALYTICS_SUMMARY_RPC}`,
    {
      method: "POST",
      headers: { ...customerDbReadHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ p_from: from || CAMPAIGN_BASELINE_ISO }),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (analyticsRpcMissing(response.status, payload)) return null;
    throw new Error(`Customer DB analytics summary error ${response.status}: ${payload?.message || payload?.error || "unknown"}`);
  }
  const summary = Array.isArray(payload) ? payload[0] : payload;
  return summary && typeof summary === "object" ? summary : null;
}

async function loadRecentAnalyticsRows(from = CAMPAIGN_BASELINE_ISO, limit = ANALYTICS_RECENT_JOURNEY_MAX_ROWS) {
  if (!customerDbConfiguredForLandingAnalytics()) return [];
  const safeLimit = Math.max(1, Math.min(ANALYTICS_RECENT_JOURNEY_MAX_ROWS, Number(limit) || ANALYTICS_RECENT_JOURNEY_MAX_ROWS));
  const query = new URLSearchParams({
    select: "id,lead_id,event_type,created_at,payload",
    order: "created_at.desc",
    limit: String(safeLimit),
  });
  if (from) query.set("created_at", `gte.${from}`);
  const response = await fetch(
    `${customerDbBaseUrl()}/rest/v1/${CUSTOMER_DB_EVENTS_TABLE}?${query.toString()}`,
    { method: "GET", headers: customerDbReadHeaders() },
  );
  if (!response.ok) throw new Error(`Customer DB recent analytics error ${response.status}`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
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

const OFFER_SELECTION_EVENT_TYPES = Object.freeze([
  "offer_card_clicked",
  "activation_channel_choice_opened",
  "activation_channel_selected",
  "provider_site_redirect",
  "offer_click_locked",
  "offer_consent_opened",
  "offer_partner_consent_confirmed",
  "offer_request_started",
  "offer_request_recorded",
  "offer_switcho_redirect",
  "offer_redirect",
]);
const OFFER_SELECTION_PAGE_SIZE = 1000;
const OFFER_SELECTION_MAX_ROWS = 100000;

async function fetchOfferSelectionPage(from, offset = 0) {
  if (!customerDbConfiguredForLandingAnalytics()) return [];
  const query = new URLSearchParams({
    select: "id,event_type,created_at,payload",
    order: "created_at.asc",
    limit: String(OFFER_SELECTION_PAGE_SIZE),
    offset: String(Math.max(0, Number(offset) || 0)),
  });
  if (from) query.set("created_at", `gte.${from}`);
  query.set("event_type", `in.(${OFFER_SELECTION_EVENT_TYPES.join(",")})`);
  const response = await fetch(
    `${customerDbBaseUrl()}/rest/v1/${CUSTOMER_DB_EVENTS_TABLE}?${query.toString()}`,
    { method: "GET", headers: customerDbReadHeaders() },
  );
  if (!response.ok) throw new Error(`Customer DB offer selections error ${response.status}`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

function isCommercialOfferSelectionEvent(row, payload = {}) {
  const type = String(row?.event_type || "");
  if (type === "offer_card_clicked") return false;
  if (type === "activation_channel_choice_opened" || type === "activation_channel_selected") {
    const route = String(payload.route || "").trim();
    const channel = String(payload.channel || "").trim();
    if (route === "internal_activatable_view" || channel === "internal") return false;
    return ["offertalogica_partner", "switcho_provider", "provider_site"].includes(route)
      || ["bill_upload", "switcho", "provider_site", "partner_redirect"].includes(channel);
  }
  return true;
}

function offerSelectionSummaryFromRows(rows = []) {
  const uniqueSelections = new Map();
  const cardClickSessions = new Set();
  const cardClickSessionsBySource = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const payload = rawAnalyticsPayload(row);
    if (payload.staffMode === true || String(payload.trafficAgent || "").toLowerCase() === "automation") return;
    const provider = String(payload.provider || "").trim();
    const offerName = String(payload.offerName || "").trim();
    if (!provider && !offerName) return;
    const sessionId = String(payload.sessionId || "").trim() || `event:${row.id || ""}`;
    if (String(row?.event_type || "") === "offer_card_clicked") {
      cardClickSessions.add(sessionId);
      const sourceKey = normalizeTrafficSource(payload.trafficSource || payload.source || "direct");
      if (!cardClickSessionsBySource.has(sourceKey)) cardClickSessionsBySource.set(sourceKey, new Set());
      cardClickSessionsBySource.get(sourceKey).add(sessionId);
    }
    if (!isCommercialOfferSelectionEvent(row, payload)) return;
    const offerIdentity = String(payload.offerId || "").trim() || `${provider}::${offerName}`;
    const key = `${sessionId}::${offerIdentity}`;
    if (!uniqueSelections.has(key)) uniqueSelections.set(key, { provider, offerName });
  });

  const byProvider = {};
  const byOffer = {};
  uniqueSelections.forEach(({ provider, offerName }) => {
    if (provider) increment(byProvider, provider);
    if (offerName) increment(byOffer, `${provider || "Fornitore"} - ${offerName}`);
  });
  return {
    selections: uniqueSelections.size,
    cardClicks: cardClickSessions.size,
    cardClicksBySource: Object.fromEntries([...cardClickSessionsBySource.entries()].map(([key, sessions]) => [key, sessions.size])),
    topProviders: topEntries(byProvider, 100),
    topOffers: topEntries(byOffer, 100),
  };
}

async function loadOfferSelectionSummary(from = CAMPAIGN_BASELINE_ISO) {
  if (!customerDbConfiguredForLandingAnalytics()) return { selections: 0, cardClicks: 0, cardClicksBySource: {}, topProviders: [], topOffers: [] };
  const rows = [];
  for (let offset = 0; offset < OFFER_SELECTION_MAX_ROWS; offset += OFFER_SELECTION_PAGE_SIZE) {
    const page = await fetchOfferSelectionPage(from, offset);
    rows.push(...page);
    if (page.length < OFFER_SELECTION_PAGE_SIZE) return offerSelectionSummaryFromRows(rows);
  }
  throw new Error("Offer selections oltre il limite di lettura sicura");
}


const PHOTO_JOURNEY_EVENT_TYPES = Object.freeze([
  "bill_photo_camera_opened",
  "bill_photo_gallery_opened",
  "bill_photo_selected",
  "bill_photo_analysis_started",
  "bill_photo_analysis_completed",
  "bill_photo_analysis_failed",
  "bill_photo_comparison_auto_started",
  "offers_rendered",
]);
const PHOTO_JOURNEY_PAGE_SIZE = 1000;
const PHOTO_JOURNEY_MAX_ROWS = 100000;

async function fetchPhotoJourneyPage(from, offset = 0) {
  if (!customerDbConfiguredForLandingAnalytics()) return [];
  const query = new URLSearchParams({
    select: "id,event_type,created_at,payload",
    order: "created_at.asc",
    limit: String(PHOTO_JOURNEY_PAGE_SIZE),
    offset: String(Math.max(0, Number(offset) || 0)),
  });
  if (from) query.set("created_at", `gte.${from}`);
  query.set("event_type", `in.(${PHOTO_JOURNEY_EVENT_TYPES.join(",")})`);
  const response = await fetch(
    `${customerDbBaseUrl()}/rest/v1/${CUSTOMER_DB_EVENTS_TABLE}?${query.toString()}`,
    { method: "GET", headers: customerDbReadHeaders() },
  );
  if (!response.ok) throw new Error(`Customer DB photo journey error ${response.status}`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

function photoJourneySummaryFromRows(rows = []) {
  const groups = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const payload = rawAnalyticsPayload(row);
    if (payload.staffMode === true || String(payload.trafficAgent || "").toLowerCase() === "automation") return;
    const sessionId = String(payload.sessionId || "").trim();
    if (!sessionId) return;
    if (!groups.has(sessionId)) groups.set(sessionId, []);
    groups.get(sessionId).push({
      eventType: String(row.event_type || ""),
      createdAt: row.created_at || "",
      payload,
    });
  });

  const sets = {
    sessions: new Set(), camera: new Set(), gallery: new Set(), selected: new Set(), started: new Set(),
    completed: new Set(), complete: new Set(), missing: new Set(), unreadable: new Set(), failed: new Set(),
    autoCompare: new Set(), offersReached: new Set(),
  };

  groups.forEach((events, sessionId) => {
    const ordered = [...events].sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
    const photoEvents = ordered.filter((event) => event.eventType.startsWith("bill_photo_"));
    if (!photoEvents.length) return;
    sets.sessions.add(sessionId);
    if (photoEvents.some((event) => event.eventType === "bill_photo_camera_opened" || String(event.payload?.inputSource || "") === "camera")) sets.camera.add(sessionId);
    if (photoEvents.some((event) => event.eventType === "bill_photo_gallery_opened" || String(event.payload?.inputSource || "") === "gallery")) sets.gallery.add(sessionId);
    if (photoEvents.some((event) => event.eventType === "bill_photo_selected")) sets.selected.add(sessionId);
    if (photoEvents.some((event) => event.eventType === "bill_photo_analysis_started")) sets.started.add(sessionId);
    if (photoEvents.some((event) => event.eventType === "bill_photo_analysis_completed")) sets.completed.add(sessionId);
    if (photoEvents.some((event) => event.eventType === "bill_photo_analysis_failed")) sets.failed.add(sessionId);
    if (photoEvents.some((event) => event.eventType === "bill_photo_comparison_auto_started" || event.payload?.comparisonAutoStarted === true)) sets.autoCompare.add(sessionId);

    const statuses = photoEvents
      .filter((event) => event.eventType === "bill_photo_analysis_completed")
      .map((event) => String(event.payload?.analysisStatus || "").toLowerCase());
    if (statuses.includes("success")) sets.complete.add(sessionId);
    if (statuses.includes("success_missing_data")) sets.missing.add(sessionId);
    if (statuses.includes("unreadable") || sets.failed.has(sessionId)) sets.unreadable.add(sessionId);

    const firstPhotoAt = photoEvents
      .map((event) => new Date(event.createdAt || 0).getTime())
      .filter(Number.isFinite)
      .sort((a, b) => a - b)[0] || 0;
    if (firstPhotoAt && ordered.some((event) => event.eventType === "offers_rendered" && new Date(event.createdAt || 0).getTime() >= firstPhotoAt)) {
      sets.offersReached.add(sessionId);
    }
  });

  return {
    sessions: sets.sessions.size,
    cameraSessions: sets.camera.size,
    gallerySessions: sets.gallery.size,
    selectedSessions: sets.selected.size,
    startedSessions: sets.started.size,
    completedSessions: sets.completed.size,
    completeSessions: sets.complete.size,
    missingDataSessions: sets.missing.size,
    unreadableSessions: sets.unreadable.size,
    failedSessions: sets.failed.size,
    autoCompareSessions: sets.autoCompare.size,
    offersReachedSessions: sets.offersReached.size,
  };
}

async function loadPhotoJourneySummary(from = CAMPAIGN_BASELINE_ISO) {
  if (!customerDbConfiguredForLandingAnalytics()) return photoJourneySummaryFromRows([]);
  const rows = [];
  for (let offset = 0; offset < PHOTO_JOURNEY_MAX_ROWS; offset += PHOTO_JOURNEY_PAGE_SIZE) {
    const page = await fetchPhotoJourneyPage(from, offset);
    rows.push(...page);
    if (page.length < PHOTO_JOURNEY_PAGE_SIZE) return photoJourneySummaryFromRows(rows);
  }
  throw new Error("Photo journey oltre il limite di lettura sicura");
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
  const trigger = String(event.trigger || event.payload?.trigger || "").trim().toLowerCase();
  if (["average", "media", "profilo_medio", "arera_average_profile"].includes(raw)) return "average";
  if (["manual", "manuale", "manual_input"].includes(raw)) return "manual";
  if (["photo", "foto", "bill_photo"].includes(raw)) return "photo";
  if (["pdf", "pdf_upload"].includes(raw)) {
    if (trigger === "photo_camera_choice") return "photo";
    return "pdf";
  }
  return "";
}

function comparisonEventDataOrigin(event = {}) {
  return String(event.dataOrigin || event.payload?.dataOrigin || "").trim().toLowerCase();
}

function comparisonPathSignals(events = []) {
  const ordered = [...(Array.isArray(events) ? events : [])].sort(compareAnalyticsEventOrder);
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

    // Foto e PDF restano distinti: il frontend usa pathChoice=pdf anche per la foto,
    // ma il trigger esplicito permette di ricostruire correttamente il pulsante scelto.
    if (eventType.startsWith("bill_photo_")) {
      push("photo", "inferito");
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
  if (path === "average") return "vedi subito le offerte";
  if (path === "manual") return "manuale";
  if (path === "photo") return "foto bolletta";
  if (path === "pdf") return "pdf";
  return "";
}

function activityFunnelFromEvents(events = []) {
  const funnel = {
    photoPathSelected: 0,
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
    if (event.eventType === "comparison_path_selected" && comparisonEventPathChoice(event) === "photo") funnel.photoPathSelected += 1;
    if (event.eventType === "comparison_path_selected" && comparisonEventPathChoice(event) === "pdf") funnel.pdfPathSelected += 1;
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
    photoSelected: 0,
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
    cardClicked: 0,
    cardClickedStandard: 0,
    cardClickedPrecise: 0,
    billPersonalizationFromOffer: 0,
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
    if (pathSignals.paths.has("photo")) funnel.photoSelected += 1;
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
    if (eventTypes.has("offer_card_clicked")) funnel.cardClicked += 1;
    if (group.some((event) =>
      event.eventType === "offer_card_clicked"
      && (String(event.mode || "").toLowerCase() === "media"
        || String(event.source || "").toLowerCase() === "offer_card_media")
    )) funnel.cardClickedStandard += 1;
    if (group.some((event) =>
      event.eventType === "offer_card_clicked"
      && (String(event.mode || "").toLowerCase() === "precise"
        || String(event.source || "").toLowerCase() === "offer_card_precise")
    )) funnel.cardClickedPrecise += 1;
    if (group.some((event) =>
      event.eventType === "offers_bill_prompt_clicked"
      && ["offer_card", "offer_path", "offer_card_media"].includes(String(event.pdfUploadSource || "").toLowerCase())
    )) funnel.billPersonalizationFromOffer += 1;
    const hasCommercialActivationChoice = group.some((event) => {
      if (!["activation_channel_choice_opened", "activation_channel_selected"].includes(String(event?.eventType || ""))) return false;
      const route = String(event?.route || "").trim();
      const channel = String(event?.channel || "").trim();
      if (route === "internal_activatable_view" || channel === "internal") return false;
      return ["offertalogica_partner", "switcho_provider", "provider_site"].includes(route)
        || ["bill_upload", "switcho", "provider_site", "partner_redirect"].includes(channel);
    });
    if (hasCommercialActivationChoice || ["offer_click_locked", "offer_consent_opened", "offer_partner_consent_confirmed", "offer_switcho_redirect", "offer_redirect", "offer_request_recorded"].some((type) => eventTypes.has(type))) {
      funnel.offerAction += 1;
    }
    if (eventTypes.has("offer_redirect") || hasSwitcho) funnel.redirects += 1;
  });

  return funnel;
}

function sourceForSessionGroup(group = []) {
  const ordered = [...group].sort(compareAnalyticsEventOrder);
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
      trafficAgent: signal.trafficAgent || event.trafficAgent || "",
      trafficReason: signal.trafficReason || event.trafficReason || "",
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

async function fetchAnalyticsExportPage(from, to, offset, limit = ANALYTICS_EXPORT_PAGE_SIZE) {
  const query = new URLSearchParams({
    select: "id,lead_id,event_type,created_at,payload",
    order: "created_at.asc",
    limit: String(limit),
    offset: String(offset),
  });
  if (from) query.append("created_at", `gte.${from}`);
  if (to) query.append("created_at", `lt.${to}`);
  const response = await fetch(
    `${customerDbBaseUrl()}/rest/v1/${CUSTOMER_DB_EVENTS_TABLE}?${query.toString()}`,
    { method: "GET", headers: customerDbReadHeaders() },
  );
  if (!response.ok) throw new Error(`Customer DB analytics export error ${response.status}`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

async function loadAnalyticsExportRows(from, to = "") {
  if (!customerDbConfiguredForLandingAnalytics()) return [];
  const rows = [];
  for (let offset = 0; offset < ANALYTICS_EXPORT_MAX_ROWS; offset += ANALYTICS_EXPORT_PAGE_SIZE) {
    const page = await fetchAnalyticsExportPage(from, to, offset);
    rows.push(...page);
    if (page.length < ANALYTICS_EXPORT_PAGE_SIZE) return rows;
  }
  const overflow = await fetchAnalyticsExportPage(from, to, ANALYTICS_EXPORT_MAX_ROWS, 1);
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
      client_timestamp: p.client_timestamp || p.clientTimestamp || "",
      session_event_seq: p.session_event_seq ?? p.sessionEventSeq ?? "",
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
      article_slug: p.articleSlug || "",
      article_title: p.articleTitle || "",
      article_category: p.articleCategory || "",
      article_type: p.articleType || "",
      article_canonical: p.articleCanonical || "",
      consent_action: p.consentAction || "",
      consent_source: p.consentSource || "",
      traffic_agent: p.trafficAgent || "",
      traffic_reason: p.trafficReason || "",
      event_integrity: p.eventIntegrity || "",
      verified: p.verified ?? "",
      staff_mode: p.staffMode ?? "",
      path_choice: p.pathChoice || "",
      trigger: p.trigger || "",
      tipo_prezzo: p.tipoPrezzo || "",
      tipo_fornitura: p.tipoFornitura || "",
      regione_gas: p.regioneGas || "",
      potenza_kw: p.potenzaKw ?? "",
      luce_consumo_kwh: p.luceConsumoKwh ?? "",
      gas_consumo_smc: p.gasConsumoSmc ?? "",
      fornitore_attuale: p.fornitoreAttuale || "",
      fornitore_luce_attuale: p.fornitoreLuceAttuale || "",
      fornitore_gas_attuale: p.fornitoreGasAttuale || "",
      fornitore_nuova_offerta: p.fornitoreNuovaOfferta || "",
      context: p.context || "",
      field: p.field || "",
      mode: p.mode || "",
      has_pending_url: p.hasPendingUrl ?? "",
      assisted: p.assisted ?? "",
      business_catalog_offers_count: p.businessCatalogOffersCount ?? "",
      business_catalog_dual_offers_count: p.businessCatalogDualOffersCount ?? "",
      demo_mode: p.demoMode ?? "",
      tool_code: p.toolCode || "",
      tool_action: p.toolAction || "",
      tool_outcome: p.toolOutcome || "",
      tool_context: p.toolContext || "",
      tool_version: p.toolVersion || "",
      ranking_offers_count: p.rankingOffersCount ?? "",
      best_partner_saving: p.bestPartnerSaving ?? "",
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
      pdf_analysis_ids: p.pdfAnalysisIds ?? [],
      pdf_archive_stored: p.pdfArchiveStored ?? "",
      pdf_contract_version: p.pdfContractVersion || "",
      pdf_parser_mode: p.pdfParserMode || "",
      pdf_parser_version: p.pdfParserVersion || "",
      pdf_reader_confidence: p.pdfReaderConfidence || "",
      pdf_page_count: p.pdfPageCount ?? "",
      pdf_field_diagnostics: p.pdfFieldDiagnostics ?? [],
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
      clientTimestamp: p.client_timestamp || p.clientTimestamp || "",
      sessionEventSeq: analyticsEventSequence({ payload: p }),
      payload: p,
      dataOrigin: String(p.dataOrigin || ""),
      trafficAgent: String(p.trafficAgent || ""),
    });
  });

  const uniqueList = (values = []) => [...new Set(values.flatMap((value) => Array.isArray(value) ? value : value ? [value] : []).map((value) => String(value || "").trim()).filter(Boolean))];
  const numberValue = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

  return [...groups.values()].map((group) => {
    const ordered = [...group].sort(compareAnalyticsEventOrder);
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
    const affiliatePartnerEvent = [...ordered].reverse().find((event) => event.eventType === "partner_funnel_opened" && (
      String(event.payload?.source || "") === "affiliate_direct"
      || /\/internet-casa\.html(?:$|[?#])/i.test(String(event.payload?.page || ""))
      || /\/casa-smart\.html(?:$|[?#])/i.test(String(event.payload?.page || ""))
    ));
    const affiliatePageEvent = [...ordered].reverse().find((event) => event.eventType === "site_page_view" && (
      /\/internet-casa\.html(?:$|[?#])/i.test(String(event.payload?.page || ""))
      || /\/casa-smart\.html(?:$|[?#])/i.test(String(event.payload?.page || ""))
    ));
    const affiliateNavigationEvent = [...ordered].reverse().find((event) => ["home_discovery_clicked", "navigation_link_clicked", "site_action_clicked"].includes(event.eventType) && (
      /\/internet-casa\.html(?:$|[?#])/i.test(String(event.payload?.destination || ""))
      || /\/casa-smart\.html(?:$|[?#])/i.test(String(event.payload?.destination || ""))
    ));
    const affiliatePathValue = String(affiliatePageEvent?.payload?.page || affiliatePartnerEvent?.payload?.page || affiliateNavigationEvent?.payload?.destination || "");
    const affiliateService = /\/internet-casa\.html(?:$|[?#])/i.test(affiliatePathValue)
      ? "internet casa / mobile"
      : /\/casa-smart\.html(?:$|[?#])/i.test(affiliatePathValue) ? "casa smart" : "";
    const landingPath = hasSelf && hasAssisted ? "autonomia + guidato" : hasSelf ? "autonomia" : hasAssisted ? "guidato" : affiliateService;
    const pathSignals = comparisonPathSignals(ordered);
    const comparisonPath = comparisonPathLabel(pathSignals.latest);
    const comparisonPathSequence = pathSignals.sequence.map((item) => comparisonPathLabel(item.path)).filter(Boolean).join(" → ");
    const pathBasis = pathSignals.hasExplicit
      ? pathSignals.hasInferred ? "registrato + inferito dagli eventi" : "registrato"
      : comparisonPath ? "inferito dagli eventi storici" : "";
    const hasPhotoSignal = pathSignals.paths.has("photo");
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
      success: "successo completo",
      success_missing_data: "successo con dati mancanti / da confermare",
      partial: "analisi parziale",
      failed: "errore tecnico",
      unrecognized: "documento non riconosciuto",
      interrupted: "analisi interrotta / abbandonata",
      unknown: "esito non determinato",
    })[rawPdfOutcome] || rawPdfOutcome;
    if (!pdfOutcome && pdfInterruptedEvent) pdfOutcome = "interrotta";
    if (!pdfOutcome && pdfCompletedEvent) {
      if ((successCount || 0) > 0 && ((unrecognizedCount || 0) > 0 || (errorCount || 0) > 0 || (missingFieldCount || 0) > 0)) pdfOutcome = "analisi parziale";
      else if ((successCount || 0) > 0) pdfOutcome = "successo completo";
      else if ((errorCount || 0) > 0) pdfOutcome = "errore tecnico";
      else if ((unrecognizedCount || 0) > 0) pdfOutcome = "documento non riconosciuto";
      else pdfOutcome = "completata (storico senza dettaglio esito)";
    }
    if (!pdfOutcome && eventTypes.has("pdf_analysis_started")) pdfOutcome = "avviata, esito non registrato";
    if (!pdfOutcome && hasPdfSignal) pdfOutcome = "percorso PDF avviato";

    const missingFields = uniqueList(pdfPayloads.map((payload) => payload.missingFields));
    const diagnosticCodes = uniqueList(pdfPayloads.map((payload) => [payload.diagnosticCode, ...(Array.isArray(payload.diagnosticCodes) ? payload.diagnosticCodes : [])]));
    const analysisStages = uniqueList(pdfPayloads.map((payload) => [payload.analysisStage, ...(Array.isArray(payload.analysisStages) ? payload.analysisStages : [])]));
    const documentKinds = uniqueList(pdfPayloads.map((payload) => payload.documentKinds));
    const commodities = uniqueList(pdfPayloads.map((payload) => payload.commodities));
    const pdfReason = pdfDiagnosticReason({
      status: rawPdfOutcome,
      codes: diagnosticCodes,
      missingFieldCount: latestPdfPayload.missingFieldCount ?? missingFields.length,
      mixedDocuments: Boolean(latestPdfPayload.mixedDocuments),
      mergeBlocked: Boolean(latestPdfPayload.mergeBlocked),
    });

    const switcho = ["offer_switcho_redirect", "switcho_landing_opened", "business_switcho_requested", "assistance_switcho_redirect"]
      .some((type) => eventTypes.has(type));
    const partner = eventTypes.has("offer_redirect") || eventTypes.has("offer_partner_consent_confirmed") || eventTypes.has("partner_funnel_opened") || switcho;
    const switchoEvent = [...ordered].reverse().find((event) => ["switcho_landing_opened", "offer_switcho_redirect", "assistance_switcho_redirect", "business_switcho_requested"].includes(event.eventType));
    const visitor = visitorDescriptor(ordered);
    const leadId = ordered.map((event) => event.leadId).find(Boolean) || "";
    const offersViewed = ordered.some((event) => event.eventType === "offers_rendered" && !isAutomaticLandingPreview(event));
    const cardClicked = eventTypes.has("offer_card_clicked");
    const cardClickedStandard = ordered.some((event) =>
      event.eventType === "offer_card_clicked"
      && (String(event.payload?.mode || "").toLowerCase() === "media"
        || String(event.payload?.source || "").toLowerCase() === "offer_card_media")
    );
    const cardClickedPrecise = ordered.some((event) =>
      event.eventType === "offer_card_clicked"
      && (String(event.payload?.mode || "").toLowerCase() === "precise"
        || String(event.payload?.source || "").toLowerCase() === "offer_card_precise")
    );
    const billPersonalizationFromOffer = ordered.some((event) =>
      event.eventType === "offers_bill_prompt_clicked"
      && ["offer_card", "offer_path", "offer_card_media"].includes(String(event.payload?.pdfUploadSource || "").toLowerCase())
    );
    const hasCommercialActivationChoice = ordered.some((event) => {
      if (!["activation_channel_choice_opened", "activation_channel_selected"].includes(String(event?.eventType || ""))) return false;
      const route = String(event?.route || "").trim();
      const channel = String(event?.channel || "").trim();
      if (route === "internal_activatable_view" || channel === "internal") return false;
      return ["offertalogica_partner", "switcho_provider", "provider_site"].includes(route)
        || ["bill_upload", "switcho", "provider_site", "partner_redirect"].includes(channel);
    });
    const offerAction = hasCommercialActivationChoice || ["offer_click_locked", "offer_consent_opened", "offer_partner_consent_confirmed", "offer_switcho_redirect", "offer_redirect", "offer_request_recorded"].some((type) => eventTypes.has(type));

    const intentTerm = String(attribution.trafficTerm || "").trim();
    let intent = intentTerm;
    let intentBasis = intentTerm ? "termine/keyword disponibile" : "inferito dal comportamento";
    if (!intent) {
      if (affiliateService === "internet casa / mobile") { intent = "Vuole valutare Internet casa / mobile"; intentBasis = "inferito dal percorso servizio registrato"; }
      else if (affiliateService === "casa smart") { intent = "Vuole valutare servizi casa smart"; intentBasis = "inferito dal percorso servizio registrato"; }
      else if (hasAssisted && !hasSelf) intent = "Preferisce assistenza guidata";
      else if (comparisonPath === "foto bolletta") intent = "Vuole personalizzare il confronto con una foto";
      else if (comparisonPath === "pdf") intent = "Vuole verificare la propria bolletta";
      else if (comparisonPath === "manuale") intent = "Vuole confrontare usando i propri consumi";
      else if (comparisonPath === "vedi subito le offerte") intent = "Vuole vedere subito una prima stima";
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
    else if (eventTypes.has("pdf_analysis_interrupted")) { finalOutcome = "PDF: analisi interrotta / abbandonata"; abandonmentStage = "analisi PDF"; }
    else if (pdfCompletedEvent && rawPdfOutcome === "failed") { finalOutcome = "PDF: errore tecnico"; abandonmentStage = "analisi PDF"; }
    else if (pdfCompletedEvent && rawPdfOutcome === "unrecognized") { finalOutcome = "PDF: documento non riconosciuto"; abandonmentStage = "analisi PDF"; }
    else if (pdfCompletedEvent && rawPdfOutcome === "success_missing_data") { finalOutcome = "PDF: dati mancanti / da confermare"; abandonmentStage = "conferma dati PDF"; }
    else if (pdfCompletedEvent && rawPdfOutcome === "partial") { finalOutcome = "PDF: analisi parziale"; abandonmentStage = "verifica dati PDF"; }
    else if (pdfCompletedEvent) { finalOutcome = `PDF: ${pdfOutcome || "analisi completata"}`; abandonmentStage = "dopo analisi PDF"; }
    else if (eventTypes.has("pdf_analysis_started")) { finalOutcome = "PDF avviato senza completamento"; abandonmentStage = "analisi PDF"; }
    else if (hasPdfSignal) { finalOutcome = "Percorso PDF senza analisi avviata"; abandonmentStage = "caricamento PDF"; }
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
      foto_scelta: hasPhotoSignal,
      foto_scelta_registrata: ordered.some((event) =>
        event.eventType === "comparison_path_selected"
        && comparisonEventPathChoice(event) === "photo"
      ),
      manuale_scelto: pathSignals.paths.has("manual"),
      confronto_avviato: ordered.some((event) => event.eventType === "comparison_started" && !isAutomaticLandingPreview(event)),
      confronto_reale: hasRealComparison,
      offerte_visualizzate: offersViewed,
      card_cliccata: cardClicked,
      card_cliccata_standard: cardClickedStandard,
      card_cliccata_personalizzata: cardClickedPrecise,
      personalizzazione_da_card: billPersonalizationFromOffer,
      numero_offerte: ordered.map((event) => Number(event.payload?.visibleOffersCount)).filter((value) => Number.isFinite(value) && value > 0).pop() || "",
      pdf_scelto: hasPdfSignal,
      pdf_scelto_registrato: ordered.some((event) =>
        event.eventType === "comparison_path_selected"
        && comparisonEventPathChoice(event) === "pdf"
      ),
      pdf_picker_aperto: eventTypes.has("pdf_picker_opened"),
      pdf_file_selezionato: eventTypes.has("pdf_file_selected"),
      pdf_upload_source: selectionEvent.pdfUploadSource || latestPdfPayload.pdfUploadSource || "",
      pdf_upload_offer_id: selectionEvent.pdfUploadOfferId || latestPdfPayload.pdfUploadOfferId || "",
      pdf_upload_offer_name: selectionEvent.pdfUploadOfferName || latestPdfPayload.pdfUploadOfferName || "",
      pdf_upload_provider: selectionEvent.pdfUploadProvider || latestPdfPayload.pdfUploadProvider || "",
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
      pdf_diagnostic_reason: pdfReason,
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
    photoSelected: items.filter((row) => row.foto_scelta).length,
    manualSelected: items.filter((row) => row.manuale_scelto).length,
    pdfSelected: items.filter((row) => row.pdf_scelto).length,
    pdfStarted: items.filter((row) => row.pdf_analisi_avviata).length,
    pdfCompleted: items.filter((row) => row.pdf_analisi_completata).length,
    comparisons: items.filter((row) => row.confronto_reale).length,
    offersViewed: items.filter((row) => row.offerte_visualizzate).length,
    cardClicked: items.filter((row) => row.card_cliccata).length,
    cardClickedStandard: items.filter((row) => row.card_cliccata_standard).length,
    cardClickedPrecise: items.filter((row) => row.card_cliccata_personalizzata).length,
    billPersonalizationFromOffer: items.filter((row) => row.personalizzazione_da_card).length,
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
    return {
      eventType: String(row.event_type || ""),
      dataOrigin: String(payload.dataOrigin || ""),
      pathChoice: String(payload.pathChoice || ""),
      trigger: String(payload.trigger || ""),
    };
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
    photo: count((row) => row.foto_scelta),
    photoSelectedRecorded: count((row) => row.foto_scelta_registrata),
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
    cardClicked: count((row) => row.card_cliccata),
    cardClickedStandard: count((row) => row.card_cliccata_standard),
    cardClickedPrecise: count((row) => row.card_cliccata_personalizzata),
    billPersonalizationFromOffer: count((row) => row.personalizzazione_da_card),
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
  const existingAnalyticsMethods = ["GET", "DELETE"];
  const allowedMethods = req.method === "POST" ? [...existingAnalyticsMethods, "POST"] : existingAnalyticsMethods;
  if (!method(req, res, allowedMethods)) return;
  const identity = await requireStaffSession(req, res, {
    roles: req.method === "GET" ? ["reviewer", "admin"] : ["admin"],
    permissions: req.method === "DELETE"
      ? ["view_analytics", "delete_records"]
      : req.method === "POST"
        ? ["view_control"]
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
  if (req.method === "POST") {
    if (authorizedBy !== "supabase" || !isStaffAdminRole(identity.staff.role)) {
      return json(res, 403, { ok: false, error: "Operazione riservata agli amministratori" });
    }
    if (!requireAllowedOrigin(req, res)) return;
    if (url.searchParams.get("mode") !== "usage-exclusion") {
      return json(res, 400, { ok: false, error: "Operazione Staff non riconosciuta" });
    }

    const body = bodyObject(req);
    const action = String(body.action || "").trim().toLowerCase();
    const staffUserId = identity.user?.id || null;

    if (action === "revoke") {
      const result = await revokeUsageCountExclusion({ id: body.id, staffUserId });
      if (!result.ok) return json(res, 400, { ok: false, error: result.error || "Revoca esclusione non riuscita" });
      try {
        await writeStaffAudit({
          identity,
          action: "usage_exclusion_revoked",
          targetType: "usage_count_exclusion",
          targetId: String(body.id || ""),
          metadata: { source: "usage_control" },
          source: "api:staff-analytics",
        });
      } catch (error) {
        console.error("staff-usage-exclusion-audit", error);
      }
      return json(res, 200, { ok: true, exclusion: result.row });
    }

    let subjectType = "";
    let subjectHash = "";
    if (action === "exclude_current_ip") {
      subjectType = "ip_hash";
      subjectHash = usageIpSubjectHash(clientIp(req));
      if (!subjectHash) {
        return json(res, 503, { ok: false, error: "IP corrente non disponibile o USAGE_CONTROL_HASH_SECRET non configurato correttamente" });
      }
    } else if (action === "exclude_ip") {
      const rawIp = String(body.ip || "").trim();
      if (!isIP(rawIp)) return json(res, 400, { ok: false, error: "Indirizzo IP non valido" });
      subjectType = "ip_hash";
      subjectHash = usageIpSubjectHash(rawIp);
      if (!subjectHash) {
        return json(res, 503, { ok: false, error: "USAGE_CONTROL_HASH_SECRET non configurato correttamente" });
      }
    } else if (action === "exclude_visitor") {
      subjectType = "visitor_hash";
      subjectHash = usageSubjectHash(body.visitorHash);
      if (!subjectHash) return json(res, 400, { ok: false, error: "Visitor non valido" });
    } else {
      return json(res, 400, { ok: false, error: "Azione esclusione non valida" });
    }

    const result = await createUsageCountExclusion({
      subjectType,
      subjectHash,
      label: body.label,
      reason: body.reason,
      staffUserId,
    });
    if (!result.ok) return json(res, 500, { ok: false, error: result.error || "Creazione esclusione non riuscita" });
    try {
      await writeStaffAudit({
        identity,
        action: result.created ? "usage_exclusion_added" : "usage_exclusion_already_active",
        targetType: "usage_count_exclusion",
        targetId: result.row?.id || null,
        metadata: { subject_type: subjectType, subject_hash: subjectHash, source: "usage_control" },
        source: "api:staff-analytics",
      });
    } catch (error) {
      console.error("staff-usage-exclusion-audit", error);
    }
    return json(res, 200, { ok: true, created: result.created === true, exclusion: result.row });
  }
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
  const exportRange = String(url.searchParams.get("range") || "month").toLowerCase();
  if (format === "csv") {
    if (!customerDbConfiguredForLandingAnalytics()) {
      return sendAnalyticsCsv(res, "", `offertalogica-analytics-${new Date().toISOString().slice(0, 10)}.csv`);
    }
    try {
      const exportPeriod = exportRange === "month" ? analyticsMonthPeriod(url.searchParams.get("month") || currentAnalyticsMonth()) : null;
      const rows = await loadAnalyticsExportRows(exportPeriod?.from || analyticsExportRangeFrom(exportRange), exportPeriod?.to || "");
      const date = new Date().toISOString().slice(0, 10);
      const exportRangeLabel = exportPeriod?.month || exportRange;
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
          "pdf_missing_fields", "pdf_missing_field_count", "pdf_review_field_count", "pdf_diagnostic_reason", "pdf_diagnostic_codes", "pdf_analysis_stages", "pdf_document_kinds", "pdf_commodities", "pdf_mixed_documents", "pdf_merge_blocked",
          "pdf_dati_confermati", "pdf_autofill_aperto", "pdf_autofill_confermato", "pdf_campi_autofill", "pdf_campi_selezionati", "pdf_campi_saltati",
          "lead_id", "lead_creato", "popup_lead", "otp_richiesto", "otp_inviato", "otp_verificato", "offerta_sbloccata", "azione_offerta", "switcho", "switcho_source", "partner",
          "provider", "offerta", "ranking_economico", "ranking_visuale", "costo_annuo", "risparmio_annuo", "tempo_attivo_secondi", "tempo_landing_secondi", "tempo_calcolatore_secondi", "tempo_offerte_secondi",
          "tempo_otp_secondi", "prima_azione_secondi", "offerte_raggiunte_secondi", "esito_sessione", "abbandono_fase", "ultimo_evento"
        ];
        const filenameScope = ({
          sessions: "funnel-sessioni", paths: "percorsi", pdf: "percorso-pdf", switcho: "percorso-switcho",
          traffic: "provenienza-intento", offers: "offerte", landing: "landing"
        })[exportScope] || "sessioni";
        return sendAnalyticsCsv(res, csvFromObjects(sessionRows, headers), `offertalogica-${filenameScope}-${exportRangeLabel}-${date}.csv`);
      }
      const eventRows = analyticsEventExportRows(rows);
      const headers = [
        "id", "lead_id", "event_type", "created_at", "client_timestamp", "session_event_seq", "session_id", "page", "customer_type", "data_origin", "source", "lead_source",
        "traffic_source", "traffic_medium", "traffic_campaign", "traffic_term", "traffic_content", "traffic_campaign_id", "traffic_adgroup_id",
        "traffic_creative_id", "traffic_match_type", "traffic_device", "traffic_network", "traffic_referrer", "traffic_landing_page",
        "traffic_click_id_type", "traffic_click_id", "article_slug", "article_title", "article_category", "article_type", "article_canonical", "consent_action", "consent_source", "traffic_agent", "traffic_reason", "event_integrity", "verified", "staff_mode", "path_choice", "trigger", "tipo_prezzo", "tipo_fornitura", "regione_gas", "potenza_kw", "luce_consumo_kwh", "gas_consumo_smc", "fornitore_attuale", "fornitore_luce_attuale", "fornitore_gas_attuale", "fornitore_nuova_offerta", "context", "field", "mode", "has_pending_url", "assisted", "business_catalog_offers_count", "business_catalog_dual_offers_count", "demo_mode", "tool_code", "tool_action", "tool_outcome", "tool_context", "tool_version", "ranking_offers_count", "best_partner_saving", "best_saving",
        "pdf_document_count", "file_count", "selected_count", "accepted_count", "duplicate_count", "success_count", "unrecognized_count", "error_count", "analysis_status",
        "diagnostic_code", "diagnostic_codes", "analysis_stage", "analysis_stages", "ingress_mode", "ingress_modes", "document_kinds", "commodities", "missing_fields", "missing_field_count", "review_field_count",
        "pdf_analysis_ids", "pdf_archive_stored", "pdf_contract_version", "pdf_parser_mode", "pdf_parser_version", "pdf_reader_confidence", "pdf_page_count", "pdf_field_diagnostics",
        "field_count", "protected_count", "ocr_review_count", "skipped_count", "protected_skipped_count", "active_slot", "retained_current_documents", "retained_offer_documents", "mixed_documents", "merge_blocked",
        "gas_decision", "electricity_decision", "has_new_offer", "visible_offers_count", "active_partner_offers_count", "consultant_offers_count", "offer_id", "offer_name", "provider",
        "destination_type", "destination_status", "display_group", "economy_rank", "display_rank", "annual_cost", "annual_delta", "network", "model",
        "redirect", "routing_version", "engagement_stage", "engagement_reason", "engagement_active_seconds", "engagement_elapsed_seconds",
        "engagement_landing_seconds", "engagement_calculator_seconds", "engagement_offers_seconds", "engagement_otp_seconds",
        "engagement_first_action_seconds", "engagement_offers_reached_seconds", "telemetry", "reason", "payload_json"
      ];
      return sendAnalyticsCsv(res, csvFromObjects(eventRows, headers), `offertalogica-analytics-completo-${exportRangeLabel}-${date}.csv`);
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
  const mode = String(url.searchParams.get("mode") || "").trim().toLowerCase();
  const period = analyticsMonthPeriod(url.searchParams.get("month"));

  if (mode === "usage") {
    const now = Date.now();
    const requestedWindowDays = Number(url.searchParams.get("days") || 7);
    const windowDays = [1, 7, 30].includes(requestedWindowDays) ? requestedWindowDays : 7;
    const requestedTool = String(url.searchParams.get("tool") || "all").trim().toLowerCase();
    const tool = ["all", "domestic", "business"].includes(requestedTool) ? requestedTool : "all";
    const from = new Date(now - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const emptyUsageResult = { ok: true, configured: true, status: "ready", events: [] };
    const [domesticRaw, businessRaw, exclusions] = await Promise.all([
      tool === "business"
        ? Promise.resolve(emptyUsageResult)
        : listCustomerAnalytics({
            limit: 10000,
            from,
            eventType: "comparison_completed",
          }),
      tool === "domestic"
        ? Promise.resolve(emptyUsageResult)
        : listCustomerAnalytics({
            limit: 10000,
            from,
            eventType: "business_calculation_completed",
          }),
      listUsageCountExclusions(),
    ]);
    if (!domesticRaw.ok || !businessRaw.ok) {
      const failed = !domesticRaw.ok ? domesticRaw : businessRaw;
      return json(res, 500, { ok: false, status: failed.status || "error", error: failed.error || "usage_observation_error" });
    }
    if (!exclusions.ok) {
      return json(res, 503, { ok: false, status: "usage_exclusions_unavailable", error: exclusions.error || "Archivio esclusioni non disponibile" });
    }
    const observedEvents = [...(domesticRaw.events || []), ...(businessRaw.events || [])];
    return json(res, 200, {
      ok: true,
      configured: domesticRaw.configured && businessRaw.configured,
      status: domesticRaw.status || businessRaw.status,
      usage: {
        ...usageObservation(observedEvents, now, exclusions.rows, { windowDays, tool }),
        exclusions: exclusions.rows,
      },
      authorizedBy,
      checkedAt: new Date(now).toISOString(),
    });
  }

  if (mode === "overview") {
    let databaseSummary = null;
    try {
      databaseSummary = await loadDatabaseAnalyticsSummary(CAMPAIGN_BASELINE_ISO);
    } catch (error) {
      console.error("staff-analytics-summary", error);
    }
    if (databaseSummary) {
      return json(res, 200, {
        ok: true,
        configured: true,
        status: "ready",
        summary: databaseSummary,
        aggregationMode: "database",
        baseline: {
          from: CAMPAIGN_BASELINE_ISO,
          label: CAMPAIGN_BASELINE_LABEL,
          timezone: "Europe/Rome",
        },
        authorizedBy,
        checkedAt: new Date().toISOString(),
      });
    }

    const rawResult = await listCustomerAnalytics({ limit });
    const result = enhanceAnalyticsForStaff(analyticsFromCampaignBaseline(rawResult));
    return json(res, result.ok ? 200 : 500, {
      ok: result.ok,
      configured: result.configured,
      status: result.status,
      summary: result.summary || {},
      aggregationMode: "recent_fallback",
      baseline: {
        from: CAMPAIGN_BASELINE_ISO,
        label: CAMPAIGN_BASELINE_LABEL,
        timezone: "Europe/Rome",
      },
      authorizedBy,
      checkedAt: new Date().toISOString(),
    });
  }

  if (period && mode !== "overview") {
    try {
      const [rawResult, monthlyRows] = await Promise.all([
        listCustomerAnalytics({ limit, from: period.from, to: period.to }),
        loadAnalyticsExportRows(period.from, period.to),
      ]);
      const result = enhanceAnalyticsForStaff(analyticsFromCampaignBaseline(rawResult));
      const journeys = analyticsJourneyRows(monthlyRows);
      const exactSummary = analyticsJourneySummary(journeys, monthlyRows);
      const offerSelectionSummary = offerSelectionSummaryFromRows(monthlyRows);
      const clickedProviders = offerSelectionSummary?.topProviders?.length ? offerSelectionSummary.topProviders : exactSummary.topProviders || [];
      const clickedOffers = offerSelectionSummary?.topOffers?.length ? offerSelectionSummary.topOffers : exactSummary.topOffers || [];
      const offerRoutes = {
        ok: true,
        configured: customerDbConfiguredForLandingAnalytics(),
        from: period.from,
        to: period.to,
        summary: summarizeOfferRouteEvents(monthlyRows.map(offerRouteEventFromRow).filter(Boolean)),
      };
      const routeSummary = offerRoutes.summary || {};
      const providerRouteMap = new Map((routeSummary.providerDetails || []).map((item) => [String(item.key || "").trim().toLowerCase(), item]));
      const offerRouteMap = new Map((routeSummary.offerDetails || []).map((item) => [String(item.key || "").trim().toLowerCase(), item]));
      const decorate = (rows, routeMap) => (Array.isArray(rows) ? rows : []).map((item) => ({
        ...item,
        routeStats: routeMap.get(String(item?.key || "").trim().toLowerCase()) || null,
      }));
      const sessionFunnel = { ...(exactSummary.sessionFunnel || {}), cardClicked: Number(offerSelectionSummary.cardClicks || exactSummary.cardClicked || 0) };
      const sessionFunnelsBySource = { ...(exactSummary.sessionFunnelsBySource || {}) };
      Object.entries(offerSelectionSummary.cardClicksBySource || {}).forEach(([sourceKey, count]) => {
        sessionFunnelsBySource[sourceKey] = { ...(sessionFunnelsBySource[sourceKey] || {}), cardClicked: Number(count || 0) };
      });
      const linkedLeadIds = new Set(monthlyRows.map((row) => String(row?.lead_id || "").trim()).filter(Boolean));
      const summary = {
        ...(result.summary || {}),
        ...exactSummary,
        recentEvents: monthlyRows.length,
        linkedLeads: linkedLeadIds.size,
        attributedSessions: journeys.length,
        topProviders: decorate(clickedProviders, providerRouteMap),
        topOffers: decorate(clickedOffers, offerRouteMap),
        funnel: exactSummary.activity || exactSummary.funnel || {},
        sessionFunnel,
        sessionFunnelsBySource,
      };
      const journeySummary = {
        ...exactSummary,
        offerSelections: offerSelectionSummary.selections ?? exactSummary.offerAction ?? 0,
        topProviders: summary.topProviders,
        topOffers: summary.topOffers,
        sessionFunnel,
        sessionFunnelsBySource,
      };
      const switcho = switchoAnalyticsFromRawRows(monthlyRows);
      const landingFrom = analyticsRelativeRangeFrom(period, landingRange);
      const landingRows = monthlyRows.filter((row) => {
        const createdAt = new Date(row?.created_at || 0).getTime();
        return Number.isFinite(createdAt) && createdAt >= new Date(landingFrom).getTime();
      });
      const landingPath = {
        ok: true, configured: customerDbConfiguredForLandingAnalytics(), range: landingRange,
        from: landingFrom, to: period.to, ...classifyLandingPathRows(landingRows),
      };
      const photoJourneySummary = photoJourneySummaryFromRows(monthlyRows);
      return json(res, result.ok ? 200 : 500, {
        ...result,
        ok: result.ok,
        status: result.status,
        summary,
        journeys,
        journeySummary,
        journeyWindow: { maxEvents: monthlyRows.length, loadedEvents: monthlyRows.length, recentOnly: false },
        aggregationMode: "monthly_single_scan",
        switcho,
        offerRoutes,
        photoJourneySummary,
        landingPath,
        period,
        baseline: { from: CAMPAIGN_BASELINE_ISO, label: CAMPAIGN_BASELINE_LABEL, timezone: ANALYTICS_TIME_ZONE },
        authorizedBy,
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("staff-analytics-month", error);
      return json(res, 500, {
        ok: false, configured: customerDbConfiguredForLandingAnalytics(),
        error: String(error?.message || error || "analytics_month_error"),
        period,
        baseline: { from: CAMPAIGN_BASELINE_ISO, label: CAMPAIGN_BASELINE_LABEL, timezone: ANALYTICS_TIME_ZONE },
        authorizedBy,
        checkedAt: new Date().toISOString(),
      });
    }
  }

  if (mode === "landing" || (Number(limit) === 1 && url.searchParams.has("landingRange"))) {
    const landingPath = await loadLandingPathAnalytics(landingRange);
    return json(res, 200, {
      ok: true,
      landingPath,
      baseline: {
        from: CAMPAIGN_BASELINE_ISO,
        label: CAMPAIGN_BASELINE_LABEL,
        timezone: "Europe/Rome",
      },
      authorizedBy,
      checkedAt: new Date().toISOString(),
    });
  }

  const [rawResult, landingPath, switcho, offerRoutes, recentAnalyticsRows, databaseSummary, offerSelectionSummary, photoJourneySummary] = await Promise.all([
    listCustomerAnalytics({ limit }),
    loadLandingPathAnalytics(landingRange),
    loadSwitchoAnalytics(CAMPAIGN_BASELINE_ISO).catch((error) => ({
      ok: false, configured: true, rows: [],
      summary: { sessions: 0, offerSelections: 0, guidedSessions: 0, redirects: 0, sources: [] },
      error: String(error?.message || error || "switcho_analytics_error"),
    })),
    loadOfferRouteAnalytics(CAMPAIGN_BASELINE_ISO).catch((error) => ({
      ok: false, configured: true, from: CAMPAIGN_BASELINE_ISO,
      summary: summarizeOfferRouteEvents([]),
      error: String(error?.message || error || "offer_route_analytics_error"),
    })),
    loadRecentAnalyticsRows(CAMPAIGN_BASELINE_ISO).catch((error) => {
      console.error("staff-analytics-recent-journeys", error);
      return [];
    }),
    loadDatabaseAnalyticsSummary(CAMPAIGN_BASELINE_ISO).catch((error) => {
      console.error("staff-analytics-summary", error);
      return null;
    }),
    loadOfferSelectionSummary(CAMPAIGN_BASELINE_ISO).catch((error) => {
      console.error("staff-analytics-offer-selections", error);
      return null;
    }),
    loadPhotoJourneySummary(CAMPAIGN_BASELINE_ISO).catch((error) => {
      console.error("staff-analytics-photo-journey", error);
      return photoJourneySummaryFromRows([]);
    }),
  ]);
  const result = enhanceAnalyticsForStaff(analyticsFromCampaignBaseline(rawResult));
  const journeys = analyticsJourneyRows(recentAnalyticsRows);
  const recentJourneySummary = analyticsJourneySummary(journeys, recentAnalyticsRows);
  const exactSummary = databaseSummary && typeof databaseSummary === "object" ? databaseSummary : null;
  const rawClickedProviders = offerSelectionSummary?.topProviders?.length
    ? offerSelectionSummary.topProviders
    : (exactSummary?.topProviders?.length ? exactSummary.topProviders : recentJourneySummary.topProviders || result.summary?.topProviders || []);
  const rawClickedOffers = offerSelectionSummary?.topOffers?.length
    ? offerSelectionSummary.topOffers
    : (exactSummary?.topOffers?.length ? exactSummary.topOffers : recentJourneySummary.topOffers || result.summary?.topOffers || []);
  const routeSummary = offerRoutes?.summary && typeof offerRoutes.summary === "object" ? offerRoutes.summary : {};
  const providerRouteMap = new Map((routeSummary.providerDetails || []).map((item) => [String(item.key || "").trim().toLowerCase(), item]));
  const offerRouteMap = new Map((routeSummary.offerDetails || []).map((item) => [String(item.key || "").trim().toLowerCase(), item]));
  const decorateRouteRows = (rows, routeMap) => (Array.isArray(rows) ? rows : []).map((item) => ({
    ...item,
    routeStats: routeMap.get(String(item?.key || "").trim().toLowerCase()) || null,
  }));
  const clickedProviders = decorateRouteRows(rawClickedProviders, providerRouteMap);
  const clickedOffers = decorateRouteRows(rawClickedOffers, offerRouteMap);
  const mergedSessionFunnel = {
    ...(recentJourneySummary.sessionFunnel || {}),
    ...(exactSummary?.sessionFunnel || {}),
  };
  if (offerSelectionSummary) mergedSessionFunnel.cardClicked = Number(offerSelectionSummary.cardClicks || 0);
  const recentFunnelsBySource = recentJourneySummary.sessionFunnelsBySource || {};
  const exactFunnelsBySource = exactSummary?.sessionFunnelsBySource || {};
  const cardClicksBySource = offerSelectionSummary?.cardClicksBySource || {};
  const mergedSessionFunnelsBySource = {};
  new Set([...Object.keys(recentFunnelsBySource), ...Object.keys(exactFunnelsBySource), ...Object.keys(cardClicksBySource)]).forEach((sourceKey) => {
    mergedSessionFunnelsBySource[sourceKey] = {
      ...(recentFunnelsBySource[sourceKey] || {}),
      ...(exactFunnelsBySource[sourceKey] || {}),
      cardClicked: Number(cardClicksBySource[sourceKey] || 0),
    };
  });
  const summary = exactSummary
    ? { ...(result.summary || {}), ...exactSummary, topProviders: clickedProviders, topOffers: clickedOffers, funnel: exactSummary.activity || exactSummary.funnel || result.summary?.funnel || {} }
    : { ...(result.summary || {}), topProviders: clickedProviders, topOffers: clickedOffers };
  const journeySummary = exactSummary
    ? { ...recentJourneySummary, ...exactSummary, topProviders: clickedProviders, topOffers: clickedOffers, offerSelections: offerSelectionSummary?.selections ?? exactSummary.offerSelections ?? recentJourneySummary.offerAction ?? 0, activity: exactSummary.activity || recentJourneySummary.activity || {}, sessionFunnel: mergedSessionFunnel, sessionFunnelsBySource: mergedSessionFunnelsBySource }
    : { ...recentJourneySummary, topProviders: clickedProviders, topOffers: clickedOffers, offerSelections: offerSelectionSummary?.selections ?? recentJourneySummary.offerAction ?? 0, sessionFunnel: mergedSessionFunnel, sessionFunnelsBySource: mergedSessionFunnelsBySource };

  const responseOk = Boolean(result.ok || exactSummary);
  json(res, responseOk ? 200 : 500, {
    ...result,
    landingPath,
    ok: responseOk,
    status: exactSummary ? "ready" : result.status,
    summary,
    journeys,
    journeySummary,
    journeyWindow: {
      maxEvents: ANALYTICS_RECENT_JOURNEY_MAX_ROWS,
      loadedEvents: recentAnalyticsRows.length,
      recentOnly: true,
    },
    aggregationMode: exactSummary ? "database" : "recent_fallback",
    switcho,
    offerRoutes,
    photoJourneySummary,
    baseline: {
      from: CAMPAIGN_BASELINE_ISO,
      label: CAMPAIGN_BASELINE_LABEL,
      timezone: "Europe/Rome",
    },
    authorizedBy,
    checkedAt: new Date().toISOString(),
  });
}

const businessUsageObservation = usageObservation;
export { businessUsageObservation, usageObservation };
