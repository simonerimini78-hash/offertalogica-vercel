import { clientIp, json, method, readJson, requireAllowedOrigin } from "../lib/http.js";
import { persistAnalyticsEvent } from "../lib/customerDb.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";

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

    if (!/^[a-z0-9_:-]{2,80}$/i.test(eventType) || !ALLOWED_EVENT_TYPES.has(eventType)) {
      json(res, 400, { ok: false, error: "Evento non autorizzato" });
      return;
    }

    const payload = sanitizePayload(body.payload);
    const traffic = classifyTrafficAgent(req);
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
        ...traffic,
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
