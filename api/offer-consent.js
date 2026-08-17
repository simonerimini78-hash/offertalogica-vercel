import { json, method, readJson, requireAllowedBrowserOrigin } from "../lib/http.js";
import { persistLeadSnapshot } from "../lib/customerDb.js";
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
  "dolomitienergia.it",
  "aceaenergia.it",
  "lene.it",
  "energiacorrente.it",
  "enel.it",
  "eniplenitude.com",
  "alperia.eu",
  "sorgenia.it",
  "tradedoubler.com",
  "awin1.com",
  "awin.com",
];

const ACTIVATION_CHANNELS = new Set(["", "direct", "switcho"]);
const ACTIVATION_ROUTES = new Set(["direct", "switcho", "direct_and_switcho", "informational_only"]);

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function sanitizeActivationChannel(value) {
  const channel = String(value || "").trim().toLowerCase();
  return ACTIVATION_CHANNELS.has(channel) ? channel : "";
}

function sanitizeActivationRoute(value) {
  const route = String(value || "").trim().toLowerCase();
  return ACTIVATION_ROUTES.has(route) ? route : "informational_only";
}

function sanitizeMonetization(input = {}) {
  const commission = input.commissionePrevista || input.expectedCommission || {};
  return {
    active: Boolean(input.attiva ?? input.active),
    network: String(input.network || "").slice(0, 80),
    programId: String(input.programId || "").slice(0, 40),
    siteId: String(input.siteId || "").slice(0, 40),
    model: String(input.modello || input.model || "").slice(0, 120),
    expectedCommission: {
      luce: numberOrNull(commission.luce),
      gas: numberOrNull(commission.gas),
      dual: numberOrNull(commission.dual),
      currency: String(commission.valuta || commission.currency || "EUR").slice(0, 8),
    },
    cookieDays: numberOrNull(input.cookieDays),
    cancellationRate: numberOrNull(input.tassoCancellazione ?? input.cancellationRate),
    epc: numberOrNull(input.epcMedio ?? input.epc),
    commercialPriority: String(input.prioritaCommerciale || input.commercialPriority || "").slice(0, 40),
  };
}

function sanitizeRankingContext(input = {}) {
  return {
    economyRank: numberOrNull(input.economyRank),
    displayGroup: String(input.displayGroup || "").slice(0, 40),
    isTopEconomic: Boolean(input.isTopEconomic),
    isActiveAffiliate: Boolean(input.isActiveAffiliate),
    annualCost: numberOrNull(input.annualCost),
    annualDelta: numberOrNull(input.annualDelta),
    bestAnnualCost: numberOrNull(input.bestAnnualCost),
    estimatedCommission: numberOrNull(input.estimatedCommission),
    network: String(input.network || "").slice(0, 80),
    commercialPriority: String(input.commercialPriority || "").slice(0, 40),
  };
}

function sanitizeOffer(input = {}) {
  return {
    id: String(input.id || "").slice(0, 80),
    name: String(input.name || "").slice(0, 160),
    link: String(input.link || "").slice(0, 500),
    provider: String(input.provider || "").slice(0, 120),
    destinationType: String(input.destinationType || "partner_lead").slice(0, 60),
    destinationStatus: String(input.destinationStatus || "pending_destination").slice(0, 80),
    activationRoute: sanitizeActivationRoute(input.activationRoute),
    activationChannel: sanitizeActivationChannel(input.activationChannel),
    directAvailable: Boolean(input.directAvailable),
    switchoAvailable: Boolean(input.switchoAvailable),
    exactSwitchoMatch: Boolean(input.exactSwitchoMatch),
    switchoReference: String(input.switchoReference || "").trim().slice(0, 120),
    switchoUrl: String(input.switchoUrl || "").trim().slice(0, 500),
    monetization: sanitizeMonetization(input.monetization || input.monetizzazione || {}),
    rankingContext: sanitizeRankingContext(input.rankingContext || {}),
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

function isAllowedHttpsLink(link, allowedDomains) {
  try {
    const url = new URL(link);
    if (url.protocol !== "https:") return false;
    return allowedDomains.some((domain) => (
      url.hostname === domain || url.hostname.endsWith(`.${domain}`)
    ));
  } catch {
    return false;
  }
}

function isAllowedOfferLink(link) {
  return isAllowedHttpsLink(link, ALLOWED_OFFER_DOMAINS);
}

function sanitizeSwitchoCatalogItem(input = {}) {
  return {
    reference: String(input.reference || input.catalogOfferId || input.switchoReference || "").trim().slice(0, 120),
    offerId: String(input.offerId || "").trim().slice(0, 80),
    providerKey: normalizeKey(input.providerKey || input.provider),
    landingUrl: String(input.landingUrl || "").trim().slice(0, 500),
    active: input.active !== false,
  };
}

function parseSwitchoCatalog(rawValue) {
  try {
    const parsed = JSON.parse(String(rawValue || "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => sanitizeSwitchoCatalogItem(item))
      .filter((item) => item.reference);
  } catch {
    return [];
  }
}

function parseAllowedDomains(rawValue) {
  return [...new Set(String(rawValue || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean))];
}

function switchoServerConfig(env = process.env) {
  return {
    enabled: String(env.SWITCHO_INTEGRATION_ENABLED || "").trim().toLowerCase() === "true",
    landingUrl: String(env.SWITCHO_LANDING_URL || "").trim().slice(0, 500),
    allowedDomains: parseAllowedDomains(env.SWITCHO_ALLOWED_HOSTS),
    catalog: parseSwitchoCatalog(env.SWITCHO_OFFER_CATALOG_JSON),
  };
}

function resolveSwitchoCatalogMatch(offer, config = switchoServerConfig()) {
  if (!config.enabled || offer.activationChannel !== "switcho") return null;
  if (!offer.switchoAvailable || !offer.exactSwitchoMatch || !offer.switchoReference) return null;
  const reference = String(offer.switchoReference);
  const match = config.catalog.find((item) => item.active && item.reference === reference) || null;
  if (!match) return null;
  if (match.offerId && String(match.offerId) !== String(offer.id || "")) return null;
  if (match.providerKey && match.providerKey !== normalizeKey(offer.provider)) return null;
  return match;
}

function resolveSwitchoRedirectUrl(offer, config = switchoServerConfig()) {
  const match = resolveSwitchoCatalogMatch(offer, config);
  if (!match || !config.allowedDomains.length) return "";
  const redirectUrl = match.landingUrl || config.landingUrl;
  return isAllowedHttpsLink(redirectUrl, config.allowedDomains) ? redirectUrl : "";
}

function shouldRedirectDirectly(offer) {
  return (
    offer.activationChannel !== "switcho" &&
    offer.destinationStatus === "attiva" &&
    offer.destinationType === "affiliazione" &&
    Boolean(offer.monetization?.active) &&
    isAllowedOfferLink(offer.link)
  );
}

function resolveOfferRedirectUrl(offer, config = switchoServerConfig()) {
  if (offer.activationChannel === "switcho") return resolveSwitchoRedirectUrl(offer, config);
  return shouldRedirectDirectly(offer) ? offer.link : "";
}

function validateSelectedOffer(offer, config = switchoServerConfig()) {
  if (!offer.name) return { ok: false, error: "Offerta non valida" };
  if (offer.activationChannel === "switcho") {
    const redirectUrl = resolveSwitchoRedirectUrl(offer, config);
    if (!redirectUrl) return { ok: false, error: "Percorso assistito non disponibile" };
    return { ok: true, redirectUrl };
  }
  if (!isAllowedOfferLink(offer.link)) return { ok: false, error: "Offerta non valida" };
  return { ok: true, redirectUrl: resolveOfferRedirectUrl(offer, config) };
}

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedBrowserOrigin(req, res)) return;
  if (!(await enforceRateLimit(req, res, { label: "offer-consent", ...rateLimitConfig("OFFER_CONSENT", 60) }))) return;

  try {
    const body = await readJson(req);
    const leadId = String(body.leadId || "").trim();
    const accepted = Boolean(body.accepted);
    const selectedOffer = sanitizeOffer(body.offer);
    const tracking = sanitizeTracking(body.tracking);
    const acceptedAt = new Date().toISOString();
    const switchoConfig = switchoServerConfig();

    if (!leadId) return json(res, 400, { ok: false, error: "Lead mancante" });
    if (!accepted) return json(res, 400, { ok: false, error: "Consenso commerciale non confermato" });
    const validation = validateSelectedOffer(selectedOffer, switchoConfig);
    if (!validation.ok) return json(res, 400, { ok: false, error: validation.error });
    const redirectUrl = validation.redirectUrl || "";

    const lead = await getJson(`lead:${leadId}`);
    if (!lead) return json(res, 404, { ok: false, error: "Lead non trovato" });
    if (lead.status !== "verified") return json(res, 403, { ok: false, error: "Lead non verificato" });

    const updatedLead = {
      ...lead,
      selectedOffer,
      monetization: {
        status: redirectUrl ? "ready_to_redirect" : "partner_request_recorded",
        destinationType: selectedOffer.destinationType,
        destinationStatus: selectedOffer.destinationStatus,
        activationRoute: selectedOffer.activationRoute,
        activationChannel: selectedOffer.activationChannel,
        directAvailable: selectedOffer.directAvailable,
        switchoAvailable: selectedOffer.switchoAvailable,
        exactSwitchoMatch: selectedOffer.exactSwitchoMatch,
        switchoReference: selectedOffer.switchoReference,
        provider: selectedOffer.provider,
        offerId: selectedOffer.id,
        offerName: selectedOffer.name,
        link: selectedOffer.link,
        network: selectedOffer.monetization.network || selectedOffer.rankingContext.network || "",
        model: selectedOffer.monetization.model || "",
        programId: selectedOffer.monetization.programId || "",
        siteId: selectedOffer.monetization.siteId || "",
        expectedCommission: selectedOffer.rankingContext.estimatedCommission,
        expectedCommissionByCommodity: selectedOffer.monetization.expectedCommission,
        economyRank: selectedOffer.rankingContext.economyRank,
        displayGroup: selectedOffer.rankingContext.displayGroup,
        annualCost: selectedOffer.rankingContext.annualCost,
        annualDelta: selectedOffer.rankingContext.annualDelta,
        isTopEconomic: selectedOffer.rankingContext.isTopEconomic,
        isActiveAffiliate: selectedOffer.rankingContext.isActiveAffiliate,
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
    const customerDb = await persistLeadSnapshot(updatedLead, "offer_partner_consent");
    if (!customerDb.ok && !customerDb.skipped) {
      console.warn("customer_db_offer_partner_consent_failed", customerDb.error);
    }
    json(res, 200, {
      ok: true,
      status: "received",
      activationChannel: selectedOffer.activationChannel,
      webhookSent: Boolean(updatedLead.notification?.webhookSent),
      redirectUrl,
    });
  } catch (error) {
    json(res, 400, { ok: false, error: error.message || "Errore consenso offerta" });
  }
}

export {
  parseAllowedDomains,
  parseSwitchoCatalog,
  resolveOfferRedirectUrl,
  resolveSwitchoCatalogMatch,
  sanitizeOffer,
  switchoServerConfig,
  validateSelectedOffer,
};
