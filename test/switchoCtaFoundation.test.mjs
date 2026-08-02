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

function ctaContext() {
  const context = {
    offertaSeparataMultiFornitore: () => false,
  };
  vm.createContext(context);
  vm.runInContext(`${extractFunction("testoAzioneOfferta")}; globalThis.testoAzioneOfferta = testoAzioneOfferta;`, context);
  return context;
}

test("CTA: il percorso pubblico legacy continua a mostrare Procedi", () => {
  const context = ctaContext();
  assert.equal(context.testoAzioneOfferta({}, true, { route: "direct" }, false), "Procedi");
  assert.equal(context.testoAzioneOfferta({}, false, { route: "switcho" }, false), "Procedi");
  assert.match(html, /enabled: false/);
  assert.match(html, /rankingMode: "legacy_6_plus_3"/);
});

test("CTA unificata: distingue diretto, Switcho e doppio canale", () => {
  const context = ctaContext();
  assert.equal(context.testoAzioneOfferta({}, true, { route: "direct" }, true), "Attiva online");
  assert.equal(context.testoAzioneOfferta({}, false, { route: "switcho" }, true), "Attiva con assistenza gratuita");
  assert.equal(context.testoAzioneOfferta({}, true, { route: "direct_and_switcho" }, true), "Scegli come attivare");
  assert.equal(context.testoAzioneOfferta({}, false, { route: "informational_only" }, true), "Procedi");
});

test("CTA: le forniture separate mantengono la verifica consulenziale", () => {
  const source = extractFunction("testoAzioneOfferta");
  const context = { offertaSeparataMultiFornitore: () => true };
  vm.createContext(context);
  vm.runInContext(`${source}; globalThis.testoAzioneOfferta = testoAzioneOfferta;`, context);
  assert.equal(context.testoAzioneOfferta({}, true, { route: "direct_and_switcho" }, true), "Verifica con consulente");
});

test("rendering: passa canali e flag alla CTA", () => {
  assert.match(html, /testoAzioneOfferta\(offerta, attivabileOnline, canaliAttivazione, unifiedActive\)/);
  assert.match(html, /switchoUrl: canaliAttivazione\?\.switchoUrl \|\| ""/);
});

test("selezione: conserva i metadati del canale scelto", () => {
  assert.match(html, /LEAD_STATE\.selectedOffer\.activationRoute =/);
  assert.match(html, /LEAD_STATE\.selectedOffer\.directAvailable =/);
  assert.match(html, /LEAD_STATE\.selectedOffer\.switchoAvailable =/);
  assert.match(html, /LEAD_STATE\.selectedOffer\.exactSwitchoMatch =/);
  assert.match(html, /LEAD_STATE\.selectedOffer\.switchoReference =/);
  assert.match(html, /LEAD_STATE\.selectedOffer\.switchoUrl =/);
});

test("sicurezza: nessun redirect Switcho viene ancora attivato", () => {
  const redirectSource = extractFunction("offertaConRedirectAttivo");
  assert.match(redirectSource, /destinationType === "affiliazione"/);
  assert.doesNotMatch(redirectSource, /switcho/);
  assert.doesNotMatch(html, /window\.location\.href = offer\.switchoUrl/);
  assert.doesNotMatch(html, /window\.location\.href = LEAD_STATE\.selectedOffer\.switchoUrl/);
});

test("analytics: registra il canale senza cambiare il flusso", () => {
  assert.match(html, /activationRoute: LEAD_STATE\.selectedOffer\.activationRoute/);
  assert.match(html, /switchoReference: LEAD_STATE\.selectedOffer\.switchoReference/);
  assert.match(html, /activationRoute: offer\.activationRoute/);
  assert.match(html, /switchoReference: offer\.switchoReference/);
});
