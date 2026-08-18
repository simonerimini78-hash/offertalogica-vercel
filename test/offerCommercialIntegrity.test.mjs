import test from "node:test";
import assert from "node:assert/strict";

import {
  expectedCommissionForLead,
  loadOfferCatalog,
  resolveCanonicalOffer,
  sanitizeOffer,
} from "../api/offer-consent.js";
import {
  authoritativeOfferAnalyticsPayload,
  sanitizePayload,
} from "../api/track-event.js";

const catalogItem = {
  id: 1,
  provider: "E.ON",
  nome: "E.ON Test",
  link: "https://www.eon-energia.com/test",
  destinationType: "affiliazione",
  destinationStatus: "attiva",
  monetizzazione: {
    attiva: true,
    network: "Tradedoubler",
    programId: "344125",
    siteId: "3487966",
    modello: "Lead",
    commissionePrevista: { luce: 25, gas: 25, dual: 49, valuta: "EUR" },
    prioritaCommerciale: "alta",
  },
};

function legitimateSubmittedOffer() {
  return sanitizeOffer({
    id: "1",
    name: "E.ON Test",
    link: "https://www.eon-energia.com/test",
    provider: "E.ON",
    destinationType: "affiliazione",
    destinationStatus: "attiva",
    activationChannel: "direct",
    monetization: catalogItem.monetizzazione,
    rankingContext: {
      economyRank: 1,
      displayRank: 1,
      displayGroup: "top",
      annualCost: 950.50,
      annualDelta: 120.25,
      estimatedCommission: 999999,
      network: "FORGED",
      commercialPriority: "FORGED",
    },
  });
}

test("catalogo server viene letto dal file pubblico della stessa build", async () => {
  const catalog = await loadOfferCatalog();
  assert.equal(Array.isArray(catalog), true);
  assert.equal(catalog[0].id, 1);
});

test("offerta legittima viene canonicalizzata dal catalogo server", () => {
  const result = resolveCanonicalOffer(
    legitimateSubmittedOffer(),
    [catalogItem],
    { enabled: false, landingUrl: "", allowedDomains: [], catalog: [] },
  );
  assert.equal(result.ok, true);
  assert.equal(result.offer.provider, "E.ON");
  assert.equal(result.offer.link, "https://www.eon-energia.com/test");
  assert.equal(result.offer.monetization.network, "Tradedoubler");
  assert.equal(result.offer.rankingContext.network, "Tradedoubler");
  assert.equal(result.offer.rankingContext.commercialPriority, "alta");
  assert.equal(result.offer.rankingContext.estimatedCommission, null);
  assert.equal(result.offer.directAvailable, true);
  assert.equal(result.offer.activationRoute, "direct");
});

test("provider o link manipolati vengono respinti", () => {
  const forgedProvider = { ...legitimateSubmittedOffer(), provider: "Fake Energy" };
  const forgedLink = { ...legitimateSubmittedOffer(), link: "https://evil.example/phish" };
  const config = { enabled: false, landingUrl: "", allowedDomains: [], catalog: [] };
  assert.equal(resolveCanonicalOffer(forgedProvider, [catalogItem], config).ok, false);
  assert.equal(resolveCanonicalOffer(forgedLink, [catalogItem], config).ok, false);
});

test("commissione client manipolata viene respinta e quella server deriva dal catalogo", () => {
  const forged = legitimateSubmittedOffer();
  forged.monetization = {
    ...forged.monetization,
    expectedCommission: { ...forged.monetization.expectedCommission, dual: 9999 },
  };
  const config = { enabled: false, landingUrl: "", allowedDomains: [], catalog: [] };
  assert.equal(resolveCanonicalOffer(forged, [catalogItem], config).ok, false);

  const legitimate = resolveCanonicalOffer(legitimateSubmittedOffer(), [catalogItem], config);
  assert.equal(
    expectedCommissionForLead(legitimate.offer, { calculation: { comparisonProfile: { tipoFornitura: "dual" } } }),
    49,
  );
});

test("analytics post-consenso usa identità e dati commerciali salvati server-side", () => {
  const clientPayload = sanitizePayload({
    offerId: "1",
    offerName: "Fake",
    provider: "Fake",
    network: "Fake Network",
    model: "Fake Model",
    annualCost: 1,
    annualDelta: 999999,
    redirect: false,
  });
  const lead = {
    selectedOffer: {
      id: "1",
      name: "E.ON Test",
      provider: "E.ON",
      destinationType: "affiliazione",
      destinationStatus: "attiva",
      monetization: { network: "Tradedoubler", model: "Lead" },
      rankingContext: {
        displayGroup: "top",
        economyRank: 1,
        displayRank: 1,
        annualCost: 950.50,
        annualDelta: 120.25,
      },
    },
    monetization: {
      status: "ready_to_redirect",
      network: "Tradedoubler",
      model: "Lead",
    },
  };
  const trusted = authoritativeOfferAnalyticsPayload(clientPayload, lead);
  assert.equal(trusted.offerName, "E.ON Test");
  assert.equal(trusted.provider, "E.ON");
  assert.equal(trusted.network, "Tradedoubler");
  assert.equal(trusted.model, "Lead");
  assert.equal(trusted.annualCost, 950.50);
  assert.equal(trusted.annualDelta, 120.25);
  assert.equal(trusted.redirect, true);
});
