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

function selectionContext() {
  const config = {
    enabled: true,
    landingUrl: "https://partner.example/switcho",
    rankingMode: "unified",
    unifiedOfferLimit: 9,
    catalog: [{ active: true }],
  };
  const context = {
    SWITCHO_INTEGRATION_CONFIG: config,
    determinaCanaliAttivazione: (offer) => offer.channels,
    urlSwitchoPerCorrispondenza: (_match, currentConfig) => currentConfig.landingUrl,
  };
  vm.createContext(context);
  [
    "arricchisciCanaliAttivazione",
    "offertaCommercialmenteAttivabile",
    "selezionaOfferteCommercialiUnificate",
    "graduatoriaCommercialeUnificataPronta",
  ].forEach((name) => vm.runInContext(`${extractFunction(name)}; globalThis.${name} = ${name};`, context));
  return context;
}

function item(id, costo, route, extra = {}) {
  return {
    offerta: {
      id,
      channels: {
        route,
        directAvailable: route === "direct" || route === "direct_and_switcho",
        switchoAvailable: route === "switcho" || route === "direct_and_switcho",
      },
    },
    costo,
    differenza: 1000 - costo,
    compatibileRanking: true,
    filtroEsatto: true,
    ...extra,
  };
}

test("configurazione: la graduatoria pubblica resta legacy", () => {
  assert.match(html, /rankingMode: "legacy_6_plus_3"/);
  assert.match(html, /unifiedOfferLimit: 9/);
  assert.match(html, /visibili: unifiedActive[\s\S]*\? offerteUnificate[\s\S]*: \[\.\.\.attivabiliPrioritarie, \.\.\.miglioriConConsulente\]/);
});

test("selezione unificata: ordina insieme diretto e Switcho per costo", () => {
  const context = selectionContext();
  const result = context.selezionaOfferteCommercialiUnificate([
    item("direct-1", 520, "direct"),
    item("switcho-1", 470, "switcho"),
    item("both-1", 490, "direct_and_switcho"),
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.map((entry) => entry.offerta.id))), ["switcho-1", "both-1", "direct-1"]);
});

test("selezione unificata: esclude offerte soltanto informative", () => {
  const context = selectionContext();
  const result = context.selezionaOfferteCommercialiUnificate([
    item("info", 400, "informational_only"),
    item("direct", 500, "direct"),
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.map((entry) => entry.offerta.id))), ["direct"]);
});

test("selezione unificata: non duplica la stessa offerta disponibile su due canali", () => {
  const context = selectionContext();
  const result = context.selezionaOfferteCommercialiUnificate([
    item("same", 480, "direct_and_switcho"),
    item("same", 480, "direct_and_switcho"),
  ]);
  assert.equal(result.length, 1);
});

test("selezione unificata: rispetta filtro e limite", () => {
  const context = selectionContext();
  const result = context.selezionaOfferteCommercialiUnificate([
    item("wrong-filter", 410, "switcho", { filtroEsatto: false }),
    item("one", 420, "switcho"),
    item("two", 430, "direct"),
  ], 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result.map((entry) => entry.offerta.id))), ["one"]);
});

test("abilitazione: richiede flag, catalogo attivo e landing HTTPS", () => {
  const context = selectionContext();
  assert.equal(context.graduatoriaCommercialeUnificataPronta(context.SWITCHO_INTEGRATION_CONFIG), true);
  assert.equal(context.graduatoriaCommercialeUnificataPronta({
    ...context.SWITCHO_INTEGRATION_CONFIG,
    rankingMode: "legacy_6_plus_3",
  }), false);
  assert.equal(context.graduatoriaCommercialeUnificataPronta({
    ...context.SWITCHO_INTEGRATION_CONFIG,
    catalog: [],
  }), false);
});

test("rendering: registra il routing nel contesto e lo passa alla CTA protetta", () => {
  assert.match(html, /const canaliAttivazione = determinaCanaliAttivazione\(offerta\)/);
  assert.match(html, /activationRoute: canaliAttivazione\?\.route \|\| "informational_only"/);
  assert.match(html, /switchoAvailable: Boolean\(canaliAttivazione\?\.switchoAvailable\)/);
  assert.match(html, /link\.innerText = testoAzioneOfferta\(offerta, attivabileOnline, canaliAttivazione, unifiedActive\)/);
});
