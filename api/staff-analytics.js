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
const LANDING_PATH_EVENTS = Object.freeze({
  view: "landing_view",
  selfService: "landing_self_service_click",
  assisted: "landing_assisted_click",
});
const LANDING_RANGES = new Set(["7d", "30d", "all"]);
const HUMAN_INTERACTION_EVENTS = new Set([
  "landing_self_service_click",
  "landing_assisted_click",
  "offer_consent_opened",
  "lead_modal_opened",
  "otp_request_started",
  "pdf_analysis_started",
  "activation_data_copied",
  "assistance_callback_verified",
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

function landingAnalyticsHeaders() {
  const headers = {
    apikey: CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY,
    Accept: "application/json",
    Prefer: "count=exact",
    Range: "0-0",
  };
  if (customerDbIsLegacyJwtKey(CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY)) {
    headers.Authorization = `Bearer ${CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY}`;
  }
  return headers;
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
  return days ? new Date(Date.now() - days * 86400000).toISOString() : null;
}

function parseExactCount(response) {
  const contentRange = String(response.headers.get("content-range") || "");
  const total = Number(contentRange.split("/").pop());
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error("Customer DB landing analytics count missing");
  }
  return total;
}

async function countLandingEvent(eventType, from) {
  const query = new URLSearchParams({
    select: "id",
    event_type: `eq.${eventType}`,
  });
  if (from) query.set("created_at", `gte.${from}`);
  const response = await fetch(
    `${customerDbBaseUrl()}/rest/v1/${CUSTOMER_DB_EVENTS_TABLE}?${query.toString()}`,
    { method: "GET", headers: landingAnalyticsHeaders() },
  );
  if (!response.ok) {
    throw new Error(`Customer DB landing analytics error ${response.status}`);
  }
  return parseExactCount(response);
}

function percentage(part, total) {
  if (!total) return null;
  return Math.round((part / total) * 1000) / 10;
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
    };
  }

  try {
    const [views, selfServiceClicks, assistedClicks] = await Promise.all([
      countLandingEvent(LANDING_PATH_EVENTS.view, from),
      countLandingEvent(LANDING_PATH_EVENTS.selfService, from),
      countLandingEvent(LANDING_PATH_EVENTS.assisted, from),
    ]);
    const totalSelections = selfServiceClicks + assistedClicks;
    return {
      ok: true,
      configured: true,
      range,
      from,
      views,
      totalSelections,
      selfServiceClicks,
      assistedClicks,
      selfServiceShare: percentage(selfServiceClicks, totalSelections),
      assistedShare: percentage(assistedClicks, totalSelections),
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

function analyticsLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 200;
  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

async function loadAnalyticsTrafficSignals(limitValue) {
  const signals = new Map();
  if (!customerDbConfiguredForLandingAnalytics()) return signals;

  const query = new URLSearchParams({
    select: "id,payload",
    order: "created_at.desc",
    limit: String(analyticsLimit(limitValue)),
  });
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
  groups.forEach((group) => {
    const visitor = visitorDescriptor(group);
    visitorCounts[visitor.type] = (visitorCounts[visitor.type] || 0) + 1;
    group.forEach((event) => {
      event.visitorType = visitor.type;
      event.visitorLabel = visitor.label;
      event.visitorReason = visitor.reason;
      const trafficText = `Visitatore: ${visitor.label} · ${visitor.reason}`;
      event.reason = [event.reason, trafficText].filter(Boolean).join(" · ");
    });
  });

  const byProvider = {};
  const byOffer = {};
  events.forEach((event) => {
    if (event.eventType !== "offer_consent_opened") return;
    if (event.provider) increment(byProvider, event.provider);
    if (event.offerName) increment(byOffer, `${event.provider || "Fornitore"} - ${event.offerName}`);
  });

  return {
    ...result,
    events,
    summary: {
      ...(result.summary || {}),
      topProviders: topEntries(byProvider),
      topOffers: topEntries(byOffer),
      visitorSessions: visitorCounts,
    },
  };
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

  const limit = url.searchParams.get("limit") || 200;
  const landingRange = normalizeLandingRange(url.searchParams.get("landingRange"));
  const [rawResult, landingPath, trafficSignals] = await Promise.all([
    listCustomerAnalytics({ limit }),
    loadLandingPathAnalytics(landingRange),
    loadAnalyticsTrafficSignals(limit).catch(() => new Map()),
  ]);
  const result = enhanceAnalyticsForStaff(rawResult, trafficSignals);

  json(res, result.ok ? 200 : 500, {
    ...result,
    landingPath,
    authorizedBy,
    checkedAt: new Date().toISOString(),
  });
}
