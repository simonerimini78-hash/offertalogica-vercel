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
  // Switcho v80: eventi già emessi dal frontend pubblico.
  "switcho_landing_opened",
  "offer_switcho_redirect",
  "business_switcho_requested",
  "assistance_switcho_redirect",
  "social_entry_viewed",
  "social_entry_saving_ready",
  "social_entry_saving_fallback",
  "social_entry_offer_clicked",

  // Landing analytics already consumed by the Staff dashboard.
  "landing_view",
  "landing_self_service_click",
  "landing_assisted_click",

  // Funnel generico degli strumenti SEO interattivi.
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

const INTERACTIVE_TOOL_EVENT_TYPE = "interactive_tool_event";
const ALLOWED_INTERACTIVE_TOOL_CODES = new Set([
  "speed_test",
  "fotovoltaico",
  "fotovoltaico_agricoltura",
  "climatizzazione_pdc",
]);
const ALLOWED_INTERACTIVE_TOOL_ACTIONS = new Set([
  "page_view",
  "started",
  "completed",
  "diagnosis_completed",
  "economics_evaluated",
  "cta_clicked",
  "error",
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
    toolCode: text(input.toolCode, 60).toLowerCase(),
    toolAction: text(input.toolAction, 60).toLowerCase(),
    toolOutcome: text(input.toolOutcome, 100).toLowerCase(),
    toolContext: text(input.toolContext, 80).toLowerCase(),
    toolVersion: text(input.toolVersion, 40),
    reason: text(input.reason, 100),
  };
}

function validateInteractiveToolPayload(eventType, payload) {
  if (eventType !== INTERACTIVE_TOOL_EVENT_TYPE) return { ok: true };
  if (!ALLOWED_INTERACTIVE_TOOL_CODES.has(payload.toolCode)) {
    return { ok: false, status: 400, error: "Strumento interattivo non autorizzato" };
  }
  if (!ALLOWED_INTERACTIVE_TOOL_ACTIONS.has(payload.toolAction)) {
    return { ok: false, status: 400, error: "Azione strumento interattivo non autorizzata" };
  }
  return { ok: true };
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
  if (!method(req, res, ["POST"])) return;
  if (!requireAnalyticsBrowserOrigin(req, res)) return;
  if (!(await enforceRateLimit(req, res, { label: "track-event", ...rateLimitConfig("TRACK_EVENT", 240, 3600) }))) return;

  try {
    const body = await readJson(req);
    const eventType = text(body.eventType || body.type, 80);

    if (!/^[a-z0-9_:-]{2,80}$/i.test(eventType) || !ALLOWED_EVENT_TYPES.has(eventType)) {
      json(res, 400, { ok: false, error: "Evento non autorizzato" });
      return;
    }

    const payload = sanitizePayload(body.payload);
    const toolValidation = validateInteractiveToolPayload(eventType, payload);
    if (!toolValidation.ok) {
      json(res, toolValidation.status || 400, { ok: false, error: toolValidation.error || "Evento strumento non autorizzato" });
      return;
    }
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
