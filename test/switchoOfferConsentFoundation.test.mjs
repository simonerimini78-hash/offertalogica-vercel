import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  parseAllowedDomains,
  parseSwitchoCatalog,
  resolveOfferRedirectUrl,
  sanitizeOffer,
  validateSelectedOffer,
} from "../api/offer-consent.js";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const apiSource = fs.readFileSync(new URL("../api/offer-consent.js", import.meta.url), "utf8");

function serverConfig(overrides = {}) {
  return {
    enabled: true,
    landingUrl: "https://partner.example/switcho",
    allowedDomains: ["partner.example"],
    catalog: [{
      reference: "SW-42",
      offerId: "offer-1",
      providerKey: "fornitorex",
      landingUrl: "",
      active: true,
    }],
    ...overrides,
  };
}

function directOffer() {
  return sanitizeOffer({
    id: "direct-1",
    name: "Offerta diretta",
    link: "https://www.enel.it/offerta",
    provider: "Enel",
    destinationType: "affiliazione",
    destinationStatus: "attiva",
    activationRoute: "direct",
    activationChannel: "direct",
    directAvailable: true,
    monetization: { active: true },
  });
}

function switchoOffer(overrides = {}) {
  return sanitizeOffer({
    id: "offer-1",
    name: "Offerta assistita",
    link: "#",
    provider: "Fornitore X",
    destinationType: "partner_lead",
    destinationStatus: "da_contattare",
    activationRoute: "switcho",
    activationChannel: "switcho",
    directAvailable: false,
    switchoAvailable: true,
    exactSwitchoMatch: true,
    switchoReference: "SW-42",
    switchoUrl: "https://client-controlled.example/fake",
    ...overrides,
  });
}

test("backend: conserva il canale e i metadati Switcho sanitizzati", () => {
  const offer = switchoOffer();
  assert.equal(offer.activationRoute, "switcho");
  assert.equal(offer.activationChannel, "switcho");
  assert.equal(offer.switchoAvailable, true);
  assert.equal(offer.exactSwitchoMatch, true);
  assert.equal(offer.switchoReference, "SW-42");
});

test("backend: il percorso diretto legacy resta valido e invariato", () => {
  const offer = directOffer();
  const validation = validateSelectedOffer(offer, {
    enabled: false,
    landingUrl: "",
    allowedDomains: [],
    catalog: [],
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.redirectUrl, "https://www.enel.it/offerta");
});

test("backend: Switcho resta bloccato quando la configurazione server è disattivata", () => {
  const validation = validateSelectedOffer(switchoOffer(), serverConfig({ enabled: false }));
  assert.equal(validation.ok, false);
  assert.equal(validation.error, "Percorso assistito non disponibile");
});

test("backend: richiede corrispondenza esatta nel catalogo server", () => {
  const noMatch = validateSelectedOffer(switchoOffer(), serverConfig({ catalog: [] }));
  assert.equal(noMatch.ok, false);

  const wrongOffer = validateSelectedOffer(switchoOffer({ id: "other-offer" }), serverConfig());
  assert.equal(wrongOffer.ok, false);

  const wrongProvider = validateSelectedOffer(switchoOffer({ provider: "Altro fornitore" }), serverConfig());
  assert.equal(wrongProvider.ok, false);
});

test("backend: usa soltanto la landing server-side autorizzata", () => {
  const offer = switchoOffer();
  const validation = validateSelectedOffer(offer, serverConfig());
  assert.equal(validation.ok, true);
  assert.equal(validation.redirectUrl, "https://partner.example/switcho");
  assert.notEqual(validation.redirectUrl, offer.switchoUrl);
  assert.equal(resolveOfferRedirectUrl(offer, serverConfig()), "https://partner.example/switcho");
});

test("backend: rifiuta una landing fuori dalla whitelist server", () => {
  const validation = validateSelectedOffer(switchoOffer(), serverConfig({
    landingUrl: "https://untrusted.example/switcho",
  }));
  assert.equal(validation.ok, false);
});

test("configurazione: catalogo e host malformati non abilitano il percorso", () => {
  assert.deepEqual(parseSwitchoCatalog("not-json"), []);
  assert.deepEqual(parseAllowedDomains(" partner.example,PARTNER.EXAMPLE, "), ["partner.example"]);
  assert.match(apiSource, /SWITCHO_INTEGRATION_ENABLED/);
  assert.match(apiSource, /SWITCHO_ALLOWED_HOSTS/);
  assert.match(apiSource, /SWITCHO_OFFER_CATALOG_JSON/);
});

test("frontend: una richiesta Switcho può partire senza link diretto", () => {
  assert.match(html, /const destinazioneRichiestaDisponibile = offer\?\.activationChannel === "switcho"/);
  assert.match(html, /offer\.switchoAvailable && offer\.exactSwitchoMatch && offer\.switchoReference && offer\.switchoUrl/);
});

test("frontend: il redirect assistito non apre l'assistente del funnel diretto", () => {
  assert.match(html, /const redirectAssistitoSwitcho = offer\.activationChannel === "switcho"/);
  assert.match(html, /!redirectAssistitoSwitcho && apriAssistentePrimaDelRedirect/);
});
