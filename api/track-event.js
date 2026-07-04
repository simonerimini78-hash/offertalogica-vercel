import { clientIp, json, method, readJson, requireAllowedOrigin } from "../lib/http.js";
import { persistAnalyticsEvent } from "../lib/customerDb.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";

function text(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanOrNull(value) {
  if (typeof value === "boolean") return value;
  return null;
}

function sanitizePayload(payload = {}) {
  const input = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  return {
    source: text(input.source, 80),
    page: text(input.page, 220),
    customerType: text(input.customerType, 40),
    dataOrigin: text(input.dataOrigin, 60),
    leadSource: text(input.leadSource, 60),
    tipoPrezzo: text(input.tipoPrezzo, 40),
    tipoFornitura: text(input.tipoFornitura, 40),
    regioneGas: text(input.regioneGas, 80),
    potenzaKw: numberOrNull(input.potenzaKw),
    verified: booleanOrNull(input.verified),
    staffMode: booleanOrNull(input.staffMode),
    bestSaving: numberOrNull(input.bestSaving),
    pdfDocumentCount: numberOrNull(input.pdfDocumentCount),
    fileCount: numberOrNull(input.fileCount),
    successCount: numberOrNull(input.successCount),
    errorCount: numberOrNull(input.errorCount),
    visibleOffersCount: numberOrNull(input.visibleOffersCount),
    activePartnerOffersCount: numberOrNull(input.activePartnerOffersCount),
    consultantOffersCount: numberOrNull(input.consultantOffersCount),
    offerId: text(input.offerId, 90),
    offerName: text(input.offerName, 160),
    provider: text(input.provider, 100),
    destinationType: text(input.destinationType, 60),
    destinationStatus: text(input.destinationStatus, 60),
    displayGroup: text(input.displayGroup, 60),
    economyRank: numberOrNull(input.economyRank),
    displayRank: numberOrNull(input.displayRank),
    annualCost: numberOrNull(input.annualCost),
    annualDelta: numberOrNull(input.annualDelta),
    network: text(input.network, 80),
    model: text(input.model, 80),
    redirect: booleanOrNull(input.redirect),
    demoMode: booleanOrNull(input.demoMode),
    reason: text(input.reason, 100),
  };
}

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedOrigin(req, res)) return;
  if (!(await enforceRateLimit(req, res, { label: "track-event", ...rateLimitConfig("TRACK_EVENT", 240, 3600) }))) return;

  try {
    const body = await readJson(req);
    const eventType = text(body.eventType || body.type, 80);
    if (!/^[a-z0-9_:-]{2,80}$/i.test(eventType)) {
      json(res, 400, { ok: false, error: "Evento non valido" });
      return;
    }

    const payload = sanitizePayload(body.payload);
    const result = await persistAnalyticsEvent({
      eventType,
      leadId: text(body.leadId, 90),
      sessionId: text(body.sessionId, 90),
      page: text(body.page || payload.page, 220),
      customerType: text(body.customerType || payload.customerType, 40),
      dataOrigin: text(body.dataOrigin || payload.dataOrigin, 60),
      source: text(body.source || payload.source, 80),
      payload: {
        ...payload,
        ipHashSource: clientIp(req) ? "server_seen" : "",
      },
    });

    if (!result.ok && !result.skipped) {
      console.warn("customer_db_track_event_failed", result.error);
    }

    json(res, 200, {
      ok: true,
      stored: Boolean(result.ok && !result.skipped),
      skipped: Boolean(result.skipped),
    });
  } catch (error) {
    json(res, 200, { ok: true, stored: false, skipped: true });
  }
}
