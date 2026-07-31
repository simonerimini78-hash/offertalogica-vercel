import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Funzione ${name} non trovata`);
  const braceStart = html.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = braceStart; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }
  throw new Error(`Fine funzione ${name} non trovata`);
}

function routingContext() {
  const context = {
    URL,
    window: { location: { origin: "https://offertalogica.it" } },
    SWITCHO_INTEGRATION_CONFIG: {
      enabled: false,
      landingUrl: "",
      catalogVersion: "pending-contract",
      catalog: [],
    },
    offertaAttivabileOnline: (offer) => Boolean(
      offer?.destinationType === "affiliazione"
      && offer?.destinationStatus === "attiva"
      && offer?.link
      && offer.link !== "#"
      && offer?.monetizzazione?.attiva !== false
    ),
    chiaveFornitoreDaNome: (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, ""),
  };
  vm.createContext(context);
  [
    "normalizzaIdentificativoCanale",
    "identificativiEsattiOfferta",
    "identificativiEsattiCatalogoSwitcho",
    "trovaCorrispondenzaSwitchoEsatta",
    "urlSwitchoPerCorrispondenza",
    "determinaCanaliAttivazione",
  ].forEach((name) => vm.runInContext(`${extractFunction(name)}; globalThis.${name} = ${name};`, context));
  return context;
}

test("Switcho: la fondazione resta disattivata senza contratto e catalogo", () => {
  assert.match(html, /const SWITCHO_INTEGRATION_CONFIG = Object\.freeze\(\{[\s\S]*enabled: false/);
  assert.match(html, /catalogVersion: "pending-contract"/);
  assert.match(html, /catalog: Object\.freeze\(\[\]\)/);
});

test("routing: conserva il percorso diretto esistente quando Switcho è disattivato", () => {
  const context = routingContext();
  const offer = {
    provider: "E.ON",
    destinationType: "affiliazione",
    destinationStatus: "attiva",
    link: "https://example.com/direct",
    monetizzazione: { attiva: true },
  };
  const result = context.determinaCanaliAttivazione(offer);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    directAvailable: true,
    switchoAvailable: false,
    exactSwitchoMatch: false,
    route: "direct",
    switchoUrl: "",
    switchoReference: "",
  });
});

test("routing: lo stesso fornitore non basta per dichiarare un'offerta Switcho", () => {
  const context = routingContext();
  const offer = {
    provider: "Fornitore X",
    certificazione: { codici: { luce: "ARERA-001" } },
  };
  const config = {
    enabled: true,
    landingUrl: "https://partner.example/switcho",
    catalog: [{ provider: "Fornitore X", offerCode: "ARERA-999", active: true }],
  };
  const result = context.determinaCanaliAttivazione(offer, config);
  assert.equal(result.exactSwitchoMatch, false);
  assert.equal(result.switchoAvailable, false);
  assert.equal(result.route, "informational_only");
});

test("routing: una corrispondenza esatta abilita Switcho", () => {
  const context = routingContext();
  const offer = {
    provider: "Fornitore X",
    certificazione: { codici: { luce: "ARERA-001" } },
  };
  const config = {
    enabled: true,
    landingUrl: "https://partner.example/switcho",
    catalog: [{ provider: "Fornitore X", areraCode: "ARERA-001", catalogOfferId: "SW-42", active: true }],
  };
  const result = context.determinaCanaliAttivazione(offer, config);
  assert.equal(result.exactSwitchoMatch, true);
  assert.equal(result.switchoAvailable, true);
  assert.equal(result.route, "switcho");
  assert.equal(result.switchoReference, "SW-42");
  assert.equal(result.switchoUrl, "https://partner.example/switcho");
});

test("routing: offerta disponibile su entrambi i canali", () => {
  const context = routingContext();
  const offer = {
    provider: "Fornitore X",
    destinationType: "affiliazione",
    destinationStatus: "attiva",
    link: "https://example.com/direct",
    monetizzazione: { attiva: true },
    switcho: { offerCode: "SW-OFFER-1" },
  };
  const config = {
    enabled: true,
    landingUrl: "https://partner.example/switcho",
    catalog: [{ provider: "Fornitore X", offerCode: "SW-OFFER-1", active: true }],
  };
  const result = context.determinaCanaliAttivazione(offer, config);
  assert.equal(result.directAvailable, true);
  assert.equal(result.switchoAvailable, true);
  assert.equal(result.route, "direct_and_switcho");
});

test("normalizzazione: conserva solo metadati Switcho espliciti", () => {
  const source = extractFunction("normalizzaSwitchoOfferta");
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${source}; globalThis.normalize = normalizzaSwitchoOfferta;`, context);
  const result = context.normalize({
    catalogOfferId: " SW-1 ",
    offerCode: " CODE-1 ",
    providerKey: " provider-x ",
    landingUrl: " https://partner.example/path ",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    catalogOfferId: "SW-1",
    offerCode: "CODE-1",
    providerKey: "provider-x",
    landingUrl: "https://partner.example/path",
    active: true,
  });
  assert.match(html, /switcho: normalizzaSwitchoOfferta\(offerta\.switcho\)/);
});
