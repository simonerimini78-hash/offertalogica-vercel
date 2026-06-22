import { json, method, readJson, requireAllowedOrigin } from "../lib/http.js";
import { notifyLeadVerified } from "../lib/notify.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";
import { getJson, setJson } from "../lib/store.js";

const ALLOWED_OFFER_DOMAINS = [
  "eon-energia.com",
  "a2a.it",
  "magisenergia.it",
  "octopusenergy.it",
  "irenluceegas.it",
  "nen.it",
  "enel.it",
  "eniplenitude.com",
  "alperia.eu",
  "sorgenia.it",
  "tradedoubler.com",
];

function sanitizeOffer(input = {}) {
  return {
    id: String(input.id || "").slice(0, 40),
    name: String(input.name || "").slice(0, 160),
    link: String(input.link || "").slice(0, 500),
    provider: String(input.provider || "").slice(0, 120),
    destinationType: String(input.destinationType || "partner_lead").slice(0, 60),
    destinationStatus: String(input.destinationStatus || "pending_destination").slice(0, 80),
  };
}

function sanitizeTracking(input = {}) {
  return {
    source: String(input.source || "offer_click").slice(0, 60),
    page: String(input.page || "").slice(0, 220),
    clickedAt: String(input.clickedAt || "").slice(0, 40),
    userAgent: String(input.userAgent || "").slice(0, 220),
  };
}

function isAllowedOfferLink(link) {
  try {
    const url = new URL(link);
    if (url.protocol !== "https:") return false;
    return ALLOWED_OFFER_DOMAINS.some((domain) => (
      url.hostname === domain || url.hostname.endsWith(`.${domain}`)
    ));
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedOrigin(req, res)) return;
  if (!(await enforceRateLimit(req, res, { label: "offer-consent", ...rateLimitConfig("OFFER_CONSENT", 60) }))) return;

  try {
    const body = await readJson(req);
    const leadId = String(body.leadId || "").trim();
    const accepted = Boolean(body.accepted);
    const selectedOffer = sanitizeOffer(body.offer);
    const tracking = sanitizeTracking(body.tracking);
    const acceptedAt = new Date().toISOString();

    if (!leadId) return json(res, 400, { ok: false, error: "Lead mancante" });
    if (!accepted) return json(res, 400, { ok: false, error: "Consenso commerciale non confermato" });
    if (!selectedOffer.name || !isAllowedOfferLink(selectedOffer.link)) {
      return json(res, 400, { ok: false, error: "Offerta non valida" });
    }

    const lead = await getJson(`lead:${leadId}`);
    if (!lead) return json(res, 404, { ok: false, error: "Lead non trovato" });
    if (lead.status !== "verified") return json(res, 403, { ok: false, error: "Lead non verificato" });

    const updatedLead = {
      ...lead,
      selectedOffer,
      monetization: {
        status: selectedOffer.destinationStatus === "attiva" ? "ready_to_redirect" : "partner_request_recorded",
        destinationType: selectedOffer.destinationType,
        destinationStatus: selectedOffer.destinationStatus,
        provider: selectedOffer.provider,
        offerId: selectedOffer.id,
        offerName: selectedOffer.name,
        link: selectedOffer.link,
        trackedAt: acceptedAt,
        tracking,
      },
      consents: {
        ...lead.consents,
        marketing: Boolean(lead.consents?.marketing),
        partners: true,
        offerConsent: {
          accepted: true,
          acceptedAt,
          offer: selectedOffer,
          tracking,
          version: lead.consents?.privacyVersion || "privacy-lead-v1",
        },
      },
    };

    try {
      const notification = await notifyLeadVerified(updatedLead, "offer_partner_consent");
      updatedLead.notification = {
        webhookSent: !notification.skipped,
        sentAt: notification.skipped ? null : new Date().toISOString(),
        event: "offer_partner_consent",
      };
    } catch (notificationError) {
      updatedLead.notification = {
        webhookSent: false,
        error: notificationError.message || "Errore invio webhook",
        failedAt: new Date().toISOString(),
        event: "offer_partner_consent",
      };
    }

    await setJson(`lead:${leadId}`, updatedLead, Number(process.env.LEAD_RETENTION_DAYS || 30) * 24 * 3600);
    json(res, 200, {
      ok: true,
      status: "received",
      webhookSent: Boolean(updatedLead.notification?.webhookSent),
      redirectUrl: selectedOffer.destinationStatus === "attiva" ? selectedOffer.link : "",
    });
  } catch (error) {
    json(res, 400, { ok: false, error: error.message || "Errore consenso offerta" });
  }
}
