import { readFile } from "node:fs/promises";
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

const OFFER_CATALOG_URL = new URL("../public/data/offerte-proposte.json", import.meta.url);
let offerCatalogPromise = null;

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedNumberOrNull(value, { min = -10_000_000, max = 10_000_000, integer = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return integer ? Math.round(parsed) : parsed;
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
    economyRank: boundedNumberOrNull(input.economyRank, { min: 1, max: 1000, integer: true }),
    displayRank: boundedNumberOrNull(input.displayRank, { min: 1, max: 1000, integer: true }),
    displayGroup: String(input.displayGroup || "").slice(0, 40),
    isTopEconomic: Boolean(input.isTopEconomic),
    isActiveAffiliate: Boolean(input.isActiveAffiliate),
    annualCost: boundedNumberOrNull(input.annualCost, { min: 0, max: 10_000_000 }),
    annualDelta: boundedNumberOrNull(input.annualDelta, { min: -10_000_000, max: 10_000_000 }),
    bestAnnualCost: boundedNumberOrNull(input.bestAnnualCost, { min: 0, max: 10_000_000 }),
    estimatedCommission: boundedNumberOrNull(input.estimatedCommission, { min: 0, max: 1_000_000 }),
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

function canonicalCatalogOffer(input = {}, submitted = {}) {
  return {
    id: String(input.id ?? "").slice(0, 80),
    name: String(input.nome || "").slice(0, 160),
    link: String(input.link || "").slice(0, 500),
    provider: String(input.provider || "").slice(0, 120),
    destinationType: String(input.destinationType || "partner_lead").slice(0, 60),
    destinationStatus: String(input.destinationStatus || "pending_destination").slice(0, 80),
    activationRoute: "informational_only",
    activationChannel: sanitizeActivationChannel(submitted.activationChannel),
    directAvailable: false,
    switchoAvailable: false,
    exactSwitchoMatch: false,
    switchoReference: String(submitted.switchoReference || "").trim().slice(0, 120),
    switchoUrl: "",
    monetization: sanitizeMonetization(input.monetizzazione || {}),
    rankingContext: sanitizeRankingContext(submitted.rankingContext || {}),
  };
}

function sameCanonicalCommercialFields(submitted, canonical) {
  const fields = ["id", "name", "link", "provider", "destinationType", "destinationStatus"];
  for (const field of fields) {
    if (String(submitted?.[field] ?? "") !== String(canonical?.[field] ?? "")) return false;
  }
  return JSON.stringify(submitted?.monetization || {}) === JSON.stringify(canonical?.monetization || {});
}

async function loadOfferCatalog() {
  if (!offerCatalogPromise) {
    offerCatalogPromise = readFile(OFFER_CATALOG_URL, "utf8")
      .then((raw) => JSON.parse(raw))
      .then((data) => {
        if (!Array.isArray(data?.offerte) || data.offerte.length === 0) {
          throw new Error("Catalogo offerte vuoto");
        }
        return data.offerte;
      })
      .catch((error) => {
        offerCatalogPromise = null;
        const wrapped = new Error("Catalogo offerte server non disponibile");
        wrapped.code = "offer_catalog_unavailable";
        wrapped.cause = error;
        throw wrapped;
      });
  }
  return offerCatalogPromise;
}

function resolveCanonicalOffer(submittedOffer, catalog, config = switchoServerConfig()) {
  const source = Array.isArray(catalog)
    ? catalog.find((item) => String(item?.id ?? "") === String(submittedOffer?.id ?? ""))
    : null;
  if (!source) {
    return { ok: false, status: 409, error: "Offerta non presente nel catalogo server" };
  }

  const canonical = canonicalCatalogOffer(source, submittedOffer);
  if (!sameCanonicalCommercialFields(submittedOffer, canonical)) {
    return { ok: false, status: 409, error: "Offerta non coerente con il catalogo server" };
  }

  const directProbe = { ...canonical, activationChannel: "direct" };
  const directAvailable = shouldRedirectDirectly(directProbe);

  const switchoProbe = {
    ...canonical,
    activationChannel: "switcho",
    switchoAvailable: true,
    exactSwitchoMatch: true,
  };
  const switchoRedirectUrl = resolveSwitchoRedirectUrl(switchoProbe, config);
  const switchoAvailable = Boolean(switchoRedirectUrl);
  const route = directAvailable && switchoAvailable
    ? "direct_and_switcho"
    : directAvailable
      ? "direct"
      : switchoAvailable
        ? "switcho"
        : "informational_only";

  const requestedChannel = sanitizeActivationChannel(submittedOffer.activationChannel);
  if (requestedChannel === "direct" && !directAvailable) {
    return { ok: false, status: 409, error: "Canale diretto non disponibile per questa offerta" };
  }
  if (requestedChannel === "switcho" && !switchoAvailable) {
    return { ok: false, status: 409, error: "Percorso assistito non disponibile per questa offerta" };
  }

  const activationChannel = requestedChannel
    || (route === "direct" ? "direct" : route === "switcho" ? "switcho" : "");

  canonical.activationRoute = route;
  canonical.activationChannel = activationChannel;
  canonical.directAvailable = directAvailable;
  canonical.switchoAvailable = switchoAvailable;
  canonical.exactSwitchoMatch = switchoAvailable;
  canonical.switchoUrl = switchoAvailable ? switchoRedirectUrl : "";
  canonical.rankingContext = {
    ...canonical.rankingContext,
    isTopEconomic: canonical.rankingContext.economyRank === 1,
    isActiveAffiliate: directAvailable,
    estimatedCommission: null,
    network: canonical.monetization.network || "",
    commercialPriority: canonical.monetization.commercialPriority || "",
  };

  return { ok: true, offer: canonical };
}

function expectedCommissionForLead(offer, lead) {
  const values = offer?.monetization?.expectedCommission || {};
  const supply = String(
    lead?.calculation?.comparisonProfile?.tipoFornitura
      || lead?.calculation?.comparisonProfile?.fornitura
      || "",
  ).trim().toLowerCase();
  if (supply === "luce") return numberOrNull(values.luce);
  if (supply === "gas") return numberOrNull(values.gas);
  if (supply === "dual") return numberOrNull(values.dual);
  return null;
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
    const submittedOffer = sanitizeOffer(body.offer);
    const tracking = sanitizeTracking(body.tracking);
    const acceptedAt = new Date().toISOString();
    const switchoConfig = switchoServerConfig();

    if (!leadId) return json(res, 400, { ok: false, error: "Lead mancante" });
    if (!accepted) return json(res, 400, { ok: false, error: "Consenso commerciale non confermato" });

    const offerCatalog = await loadOfferCatalog();
    const resolvedOffer = resolveCanonicalOffer(submittedOffer, offerCatalog, switchoConfig);
    if (!resolvedOffer.ok) {
      return json(res, resolvedOffer.status || 409, { ok: false, error: resolvedOffer.error });
    }
    const selectedOffer = resolvedOffer.offer;

    const validation = validateSelectedOffer(selectedOffer, switchoConfig);
    if (!validation.ok) return json(res, 400, { ok: false, error: validation.error });
    const redirectUrl = validation.redirectUrl || "";

    const lead = await getJson(`lead:${leadId}`);
    if (!lead) return json(res, 404, { ok: false, error: "Lead non trovato" });
    if (lead.status !== "verified") return json(res, 403, { ok: false, error: "Lead non verificato" });

    selectedOffer.rankingContext = {
      ...selectedOffer.rankingContext,
      estimatedCommission: expectedCommissionForLead(selectedOffer, lead),
    };

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
    if (error?.code === "offer_catalog_unavailable") {
      return json(res, 503, { ok: false, error: "Catalogo offerte temporaneamente non disponibile" });
    }
    json(res, 400, { ok: false, error: error.message || "Errore consenso offerta" });
  }
}

export {
  canonicalCatalogOffer,
  expectedCommissionForLead,
  loadOfferCatalog,
  parseAllowedDomains,
  parseSwitchoCatalog,
  resolveCanonicalOffer,
  resolveOfferRedirectUrl,
  resolveSwitchoCatalogMatch,
  sanitizeOffer,
  sameCanonicalCommercialFields,
  switchoServerConfig,
  validateSelectedOffer,
};
