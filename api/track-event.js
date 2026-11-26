import crypto from "node:crypto";
import { clientIp, json, method, readJson, requireAllowedOrigin } from "../lib/http.js";
import { persistAnalyticsEvent } from "../lib/customerDb.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";
import { getJson } from "../lib/store.js";

// Security Step 7A — only analytics events actually used by OffertaLogica
// may enter the public analytics endpoint. Unknown/custom event names are
// rejected instead of being written to lead_events.
const ALLOWED_EVENT_TYPES = new Set([
  "customer_segment_selected",
  "business_calculation_incomplete",
  "business_calculation_completed",
  "business_lead_modal_requested",
  "comparison_incomplete_data",
  "comparison_started",
  "comparison_missing_current_price",
  "comparison_completed",
  "offers_rendered",
  "offers_unlocked",
  "offers_bill_prompt_dismissed",
  "offers_bill_prompt_clicked",
  "lead_modal_opened",
  "lead_modal_closed",
  "lead_form_invalid",
  "lead_created_client",
  "otp_request_started",
  "otp_sent",
  "otp_failed",
  "otp_failed_preview_fallback",
  "otp_verify_missing_code",
  "otp_verify_started",
  "otp_verified",
  "otp_verify_failed",
  "activation_channel_choice_opened",
  "activation_channel_selected",
  "activation_data_copied",
  "activation_assistant_opened",
  "offer_click_locked",
  "offer_consent_opened",
  "offer_partner_consent_missing",
  "offer_partner_consent_confirmed",
  "offer_request_missing_link",
  "offer_request_started",
  "offer_request_recorded",
  "offer_request_failed",
  "offer_redirect",
  "partner_funnel_opened",
  "assistance_prompt_shown",
  "assistance_prompt_closed",
  "assistance_guide_opened",
  "assistance_callback_started",
  "assistance_callback_verified",
  "pdf_no_file_selected",
  "pdf_analysis_started",
  "pdf_analysis_completed",
  "pdf_data_confirmed",
  "pdf_autofill_preview_opened",
  "pdf_autofill_preview_confirmed",
  "pdf_reset",
  "switcho_observed_offer_selected",
  "social_entry_viewed",
  "social_entry_saving_ready",
  "social_entry_saving_fallback",
  "social_entry_offer_clicked",

  // Landing analytics already consumed by the Staff dashboard.
  "landing_view",
  "landing_self_service_click",
  "landing_assisted_click",

  // P13 — telemetria strumenti usata dal Gestionale Linee/Strumenti.
  "interactive_tool_event",
]);

// These events describe security- or revenue-relevant funnel stages. They are
// accepted only when the submitted lead exists server-side and has completed OTP.
const VERIFIED_LEAD_EVENT_TYPES = new Set([
  "otp_verified",
  "offers_unlocked",
  "offer_consent_opened",
  "offer_partner_consent_confirmed",
  "offer_request_started",
  "offer_request_recorded",
  "offer_redirect",
  "assistance_callback_verified",
]);

// At these stages /api/offer-consent has already written the authoritative
// selected offer into the server-side lead. Cross-check client analytics against it.
const SERVER_OFFER_MATCH_EVENT_TYPES = new Set([
  "offer_request_recorded",
  "offer_redirect",
]);

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

function requestHeader(req, name, max = 500) {
  const normalized = String(name || "").trim().toLowerCase();
  const value = req?.headers?.[normalized];
  if (Array.isArray(value)) return text(value.join(" "), max);
  return text(value, max);
}

// Synthetic QA is deliberately excluded at ingress, before rate limits and
// analytics persistence. Only the server-side hash of a random QA token is
// configured in production. Browserless sets two Secure, host-only cookies:
// ol_site_qa_token (HttpOnly secret) and ol_site_qa_run (non-secret run id).
// Unknown, partial, duplicated or invalid QA cookies fail closed.
const QA_TOKEN_COOKIE = "ol_site_qa_token";
const QA_RUN_COOKIE = "ol_site_qa_run";
const QA_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const QA_RUN_PATTERN = /^QA-[A-Za-z0-9_-]{8,80}$/;

function cookieValues(req, name) {
  const raw = String(req?.headers?.cookie || "");
  const values = raw.split(";").map((part) => part.trim()).flatMap((part) => {
    const eq = part.indexOf("=");
    return eq > 0 && part.slice(0, eq).trim() === name
      ? [part.slice(eq + 1).trim()] : [];
  });
  return { values };
}

function verifiedQaSession(req) {
  const token = cookieValues(req, QA_TOKEN_COOKIE);
  const run = cookieValues(req, QA_RUN_COOKIE);
  if (!token.values.length && !run.values.length) {
    return { status: "absent" };
  }
  if (token.values.length !== 1 || run.values.length !== 1) {
    return { status: "invalid" };
  }
  const suppliedToken = token.values[0];
  const runId = run.values[0];
  const expectedHash = String(process.env.OL_QA_TOKEN_SHA256 || "").trim().toLowerCase();
  if (!QA_TOKEN_PATTERN.test(suppliedToken)
    || !QA_TOKEN_PATTERN.test(expectedHash)
    || !QA_RUN_PATTERN.test(runId)) {
    return { status: "invalid" };
  }
  const actual = crypto.createHash("sha256").update(suppliedToken, "utf8").digest();
  const expected = Buffer.from(expectedHash, "hex");
  if (!crypto.timingSafeEqual(actual, expected)) return { status: "invalid" };
  return { status: "verified", runId };
}

function classifyTrafficAgent(req) {
  const userAgent = requestHeader(req, "user-agent");
  const clientHints = requestHeader(req, "sec-ch-ua");
  const purpose = [
    requestHeader(req, "purpose", 80),
    requestHeader(req, "sec-purpose", 80),
    requestHeader(req, "x-purpose", 80),
  ].filter(Boolean).join(" ");
  const signature = `${userAgent} ${clientHints} ${purpose}`.trim();

  if (!signature) {
    return { trafficAgent: "unknown", trafficReason: "missing_client_signature" };
  }

  const knownBot = /(?:\bbot\b|crawler|spider|slurp|googlebot|google-inspectiontool|inspectiontool|bingbot|duckduckbot|baiduspider|yandexbot|applebot|petalbot|facebookexternalhit|twitterbot|linkedinbot|semrushbot|ahrefsbot|mj12bot|dotbot|uptimerobot|pingdom|chrome-lighthouse|pagespeed|gtmetrix)/i;
  if (knownBot.test(signature)) {
    return { trafficAgent: "known_bot", trafficReason: "crawler_signature" };
  }

  const automation = /(?:headlesschrome|phantomjs|selenium|playwright|puppeteer|electron|curl\/|wget\/|python-requests|python-urllib|httpclient|postmanruntime|insomnia)/i;
  if (automation.test(signature)) {
    return { trafficAgent: "automation", trafficReason: "automation_signature" };
  }

  const standardBrowser = /mozilla\//i.test(userAgent)
    && /(?:chrome|crios|safari|firefox|fxios|edg|opr)\//i.test(userAgent);
  if (standardBrowser) {
    return { trafficAgent: "browser", trafficReason: "standard_browser_signature" };
  }

  return { trafficAgent: "unknown", trafficReason: "unclassified_client_signature" };
}

function sanitizePayload(payload = {}) {
  const input = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  return {
    source: text(input.source, 80),
    page: text(input.page, 220),
    customerType: text(input.customerType, 40),
    dataOrigin: text(input.dataOrigin, 60),
    leadSource: text(input.leadSource, 60),
    trafficSource: text(input.trafficSource, 80).toLowerCase(),
    trafficMedium: text(input.trafficMedium, 80).toLowerCase(),
    trafficCampaign: text(input.trafficCampaign, 120),
    trafficTerm: text(input.trafficTerm, 120),
    trafficContent: text(input.trafficContent, 120),
    trafficReferrer: text(input.trafficReferrer, 160).toLowerCase(),
    trafficLandingPage: text(input.trafficLandingPage, 220),
    trafficClickIdType: text(input.trafficClickIdType, 20).toLowerCase(),
    toolCode: text(input.toolCode || input.tool_code, 60),
    toolAction: text(input.toolAction || input.tool_action, 40),
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

async function validateAnalyticsIntegrity(eventType, body, payload) {
  if (!VERIFIED_LEAD_EVENT_TYPES.has(eventType)) {
    return { ok: true, integrity: "public_event", leadId: text(body.leadId, 90) };
  }

  const leadId = text(body.leadId, 90);
  if (!leadId) {
    return { ok: false, status: 400, error: "Lead verificato richiesto" };
  }

  const lead = await getJson(`lead:${leadId}`);
  if (!lead || lead.status !== "verified") {
    return { ok: false, status: 403, error: "Evento non associato a un lead verificato" };
  }

  if (SERVER_OFFER_MATCH_EVENT_TYPES.has(eventType)) {
    const selectedOffer = lead.selectedOffer && typeof lead.selectedOffer === "object"
      ? lead.selectedOffer
      : {};
    const submittedOfferId = text(payload.offerId, 90);
    const submittedProvider = text(payload.provider, 100);
    const submittedOfferName = text(payload.offerName, 160);

    if (!selectedOffer.id || !submittedOfferId || String(selectedOffer.id) !== submittedOfferId) {
      return { ok: false, status: 409, error: "Offerta analytics non coerente con il lead" };
    }
    if (submittedProvider && selectedOffer.provider && String(selectedOffer.provider) !== submittedProvider) {
      return { ok: false, status: 409, error: "Fornitore analytics non coerente con il lead" };
    }
    if (submittedOfferName && selectedOffer.name && String(selectedOffer.name) !== submittedOfferName) {
      return { ok: false, status: 409, error: "Nome offerta analytics non coerente con il lead" };
    }

    return {
      ok: true,
      integrity: "verified_offer",
      leadId,
      payload: authoritativeOfferAnalyticsPayload(payload, lead),
    };
  }

  return { ok: true, integrity: "verified_lead", leadId };
}

function authoritativeOfferAnalyticsPayload(payload, lead) {
  const selectedOffer = lead?.selectedOffer && typeof lead.selectedOffer === "object"
    ? lead.selectedOffer
    : {};
  const ranking = selectedOffer?.rankingContext && typeof selectedOffer.rankingContext === "object"
    ? selectedOffer.rankingContext
    : {};
  const monetization = lead?.monetization && typeof lead.monetization === "object"
    ? lead.monetization
    : {};

  return {
    ...payload,
    offerId: text(selectedOffer.id, 90),
    offerName: text(selectedOffer.name, 160),
    provider: text(selectedOffer.provider, 100),
    destinationType: text(selectedOffer.destinationType, 60),
    destinationStatus: text(selectedOffer.destinationStatus, 60),
    displayGroup: text(ranking.displayGroup, 60),
    economyRank: numberOrNull(ranking.economyRank),
    displayRank: numberOrNull(ranking.displayRank),
    annualCost: numberOrNull(ranking.annualCost),
    annualDelta: numberOrNull(ranking.annualDelta),
    network: text(monetization.network || selectedOffer?.monetization?.network, 80),
    model: text(monetization.model || selectedOffer?.monetization?.model, 80),
    redirect: monetization.status === "ready_to_redirect",
  };
}

function requireAnalyticsBrowserOrigin(req, res) {
  const origin = String(req?.headers?.origin || "").trim();
  if (!origin) {
    json(res, 403, { ok: false, error: "Origine analytics richiesta" });
    return false;
  }
  return requireAllowedOrigin(req, res);
}

export default async function handler(req, res) {
  // Browserless preflight: GET is successful only with both verified QA cookies.
  // Anonymous GET requests keep the original 405 response.
  if (req.method === "GET") {
    const qa = verifiedQaSession(req);
    if (qa.status === "absent") return method(req, res, ["POST"]);
    if (qa.status !== "verified") return json(res, 403, { ok: false, error: "Identita QA non valida" });
    return json(res, 200, { ok: true, status: "QA_READY", qa_run_id: qa.runId });
  }
  if (!method(req, res, ["POST"])) return;
  if (!requireAnalyticsBrowserOrigin(req, res)) return;

  // Invalid/partial QA credentials fail closed. Without both QA cookies the
  // client is indistinguishable from a normal visitor: Browserless must first
  // pass the authenticated GET preflight before navigating a page.
  // Verified runs are diagnostic-only, with no lead_events write or impact on
  // the production analytics rate-limit bucket.
  const qa = verifiedQaSession(req);
  if (qa.status === "invalid") {
    return json(res, 403, { ok: false, error: "Identita QA non valida" });
  }
  if (qa.status === "verified") {
    try {
      const body = await readJson(req);
      const eventType = text(body?.eventType || body?.type, 80);
      if (!/^[a-z0-9_:-]{2,80}$/i.test(eventType) || !ALLOWED_EVENT_TYPES.has(eventType)) {
        return json(res, 400, { ok: false, error: "Evento non autorizzato" });
      }
      console.info("offertalogica_synthetic_qa_event_ignored", {
        qa_run_id: qa.runId,
        event_type: eventType,
        session_id: text(body.sessionId, 90),
        page: text(body.page, 220),
      });
      return json(res, 200, {
        ok: true, stored: false, skipped: true,
        traffic_type: "SYNTHETIC_QA", qa_run_id: qa.runId,
      });
    } catch {
      return json(res, 400, { ok: false, error: "Evento QA non valido" });
    }
  }

  if (!(await enforceRateLimit(req, res, { label: "track-event", ...rateLimitConfig("TRACK_EVENT", 240, 3600) }))) return;

  try {
    const body = await readJson(req);
    const eventType = text(body.eventType || body.type, 80);

    if (!/^[a-z0-9_:-]{2,80}$/i.test(eventType) || !ALLOWED_EVENT_TYPES.has(eventType)) {
      json(res, 400, { ok: false, error: "Evento non autorizzato" });
      return;
    }

    const payload = sanitizePayload(body.payload);
    const integrity = await validateAnalyticsIntegrity(eventType, body, payload);
    if (!integrity.ok) {
      json(res, integrity.status || 400, { ok: false, error: integrity.error || "Evento non autorizzato" });
      return;
    }

    const trustedPayload = integrity.payload || payload;

    if (VERIFIED_LEAD_EVENT_TYPES.has(eventType)) {
      if (!(await enforceRateLimit(req, res, {
        label: "track-event-verified-lead",
        identifier: integrity.leadId,
        ...rateLimitConfig("TRACK_EVENT_VERIFIED_LEAD", 30, 3600),
      }))) return;
    }

    const traffic = classifyTrafficAgent(req);
    const result = await persistAnalyticsEvent({
      eventType,
      leadId: integrity.leadId,
      sessionId: text(body.sessionId, 90),
      page: text(body.page || trustedPayload.page, 220),
      customerType: text(body.customerType || trustedPayload.customerType, 40),
      dataOrigin: text(body.dataOrigin || trustedPayload.dataOrigin, 60),
      source: text(body.source || trustedPayload.source, 80),
      payload: {
        ...trustedPayload,
        ...traffic,
        eventIntegrity: integrity.integrity,
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

export {
  authoritativeOfferAnalyticsPayload,
  sanitizePayload,
};
