import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const catalog = JSON.parse(fs.readFileSync(new URL("../public/data/offerte-switcho-osservate.json", import.meta.url), "utf8"));
const sourceCatalog = JSON.parse(fs.readFileSync(new URL("../data/offerte-switcho-osservate.json", import.meta.url), "utf8"));

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

function offer(name) {
  const result = catalog.offerte.find((item) => item.nome === name);
  assert.ok(result, `Offerta non trovata: ${name}`);
  return result;
}

test("catalogo osservato: contiene le 15 offerte comunicate e resta non instradabile", () => {
  assert.equal(catalog.offerte.length, 15);
  assert.equal(catalog.routingEnabled, false);
  assert.equal(catalog.osservatoIl, "2026-07-31");
  assert.deepEqual(catalog, sourceCatalog);
  assert.ok(catalog.offerte.every((item) => !item.switchoReference));
});

test("catalogo osservato: tutti i fornitori sono già presenti nel primo menu", () => {
  const providerKeys = [...new Set(catalog.offerte.map((item) => item.providerKey))];
  assert.equal(providerKeys.length, 12);
  providerKeys.forEach((key) => {
    assert.match(html, new RegExp(`<option value="${key}">`, "i"), `Provider ${key} assente dal menu`);
  });
});

test("catalogo osservato: conserva le formule indicizzate comunicate", () => {
  const octopus = offer("Octopus Flex Luce e Gas");
  assert.equal(octopus.luce.formula.indice, "pun");
  assert.equal(octopus.luce.formula.spread, 0.0088);
  assert.equal(octopus.gas.formula.indice, "psv");
  assert.equal(octopus.gas.formula.spread, 0.06);

  const pulsee = offer("Pulsee PER TE Index");
  assert.equal(pulsee.luce.formula.spread, 0);
  assert.equal(pulsee.gas.formula.spread, 0.042);

  const a2a = offer("A2A Smart Casa");
  assert.equal(a2a.luce.formula.spread, 0.025003);
  assert.equal(a2a.gas.formula.spread, 0.12);
});

test("catalogo osservato: conserva prezzi, quote e durata delle offerte fisse", () => {
  const dolomiti = offer("Dolomiti Fisso Luce e Gas 36 Web");
  assert.equal(dolomiti.durataMesi, 36);
  assert.equal(dolomiti.luce.prezzoVariabile, 0.129);
  assert.equal(dolomiti.gas.prezzoVariabile, 0.5285);
  assert.equal(dolomiti.luce.quotaFissaAnnua, 72);
  assert.equal(dolomiti.gas.quotaFissaAnnua, 72);

  const eni = offer("Eni Plenitude Fixa Time Smart 24");
  assert.equal(eni.durataMesi, 24);
  assert.equal(eni.luce.prezzoVariabile, 0.099);
  assert.equal(eni.gas.prezzoVariabile, 0.44);
});

test("catalogo osservato: promozioni non confermate non vengono conteggiate", () => {
  const names = ["NeN Surf Luce e Gas", "Magis Energia Wave Power Luce e Gas", "E.ON FlexClick"];
  names.forEach((name) => {
    const item = offer(name);
    const euroDiscount = item.promozioni.find((promo) => promo.tipo === "sconto_euro_per_fornitura");
    assert.ok(euroDiscount, `Sconto euro mancante: ${name}`);
    assert.equal(euroDiscount.conteggiatoNelCalcolo, false);
  });
});

test("catalogo osservato: registra il risultato della verifica ARERA senza forzare equivalenze", () => {
  assert.equal(offer("Dolomiti Fisso Luce e Gas 36 Web").areraMatch.status, "exact_components");
  assert.equal(offer("Lene Leggera Luce 24 e Superleggera Gas 24").areraMatch.status, "not_found_in_2026_07_31_import");
  assert.equal(offer("E.ON Luce e Gas Insieme").areraMatch.status, "same_name_conditions_mismatch");
  assert.equal(offer("Octopus Fissa Luce e Gas").areraMatch.status, "partial_conditions_mismatch");
});

test("menu offerte: distingue le offerte dello stesso fornitore per tipo tariffa", () => {
  const context = {
    OFFERTE_SWITCHO_OSSERVATE: catalog.offerte,
    offertaCoerenteConFornitura: (item, scope) => scope === "dual" ? item.fornitura === "dual" : true,
    offertaCalcolabileConIndici: () => true,
    Number,
  };
  vm.createContext(context);
  vm.runInContext(`${extractFunction("offertaSwitchoOsservataCoerente")}; ${extractFunction("offerteSwitchoOsservatePerFornitore")}; globalThis.findOffers = offerteSwitchoOsservatePerFornitore;`, context);
  const eniFixed = context.findOffers("eni", "fisso", "dual");
  assert.deepEqual(JSON.parse(JSON.stringify(eniFixed.map((item) => item.nome))), [
    "Eni Plenitude Fixa Time Smart 24",
    "Eni Plenitude Fixa Time Casa",
  ]);
  const eonVariable = context.findOffers("eon", "variabile", "dual");
  assert.deepEqual(JSON.parse(JSON.stringify(eonVariable.map((item) => item.nome))), ["E.ON FlexClick"]);
  const eonFixed = context.findOffers("eon", "fisso", "dual");
  assert.deepEqual(JSON.parse(JSON.stringify(eonFixed.map((item) => item.nome))), ["E.ON Luce e Gas Insieme"]);
});

test("interfaccia: aggiunge un secondo menu per scegliere l'offerta specifica", () => {
  assert.match(html, /id="switcho-observed-offer-panel" hidden/);
  assert.match(html, /id="switcho-observed-offer-select"/);
  assert.match(html, /Offerte osservate su Switcho il 31 luglio 2026/);
  assert.match(html, /caricaOfferteSwitchoOsservate\(\)/);
  assert.match(html, /applicaOffertaSwitchoOsservataSelezionata\(\)/);
});

test("sicurezza: il catalogo osservato non entra nella graduatoria pubblica", () => {
  const unified = extractFunction("selezionaOfferteCommercialiUnificate");
  const providerBest = extractFunction("miglioreNuovaOffertaPerFornitore");
  assert.doesNotMatch(unified, /OFFERTE_SWITCHO_OSSERVATE/);
  assert.doesNotMatch(providerBest, /OFFERTE_SWITCHO_OSSERVATE/);
  assert.match(html, /routingEligible: false/);
  assert.doesNotMatch(html, /SWITCHO_INTEGRATION_CONFIG[\s\S]{0,250}enabled: true/);
});
