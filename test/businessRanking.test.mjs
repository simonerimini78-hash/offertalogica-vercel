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

function buildBusinessContext({ business = [], dualBusiness = [] } = {}) {
  const names = [
    "calcolaCostoVenditaBusiness",
    "creaCandidatoBusinessSingolo",
    "creaCandidatoBusinessDual",
    "creaCandidatoBusinessSeparato",
    "selezionaRankingBusiness",
    "costruisciRankingBusiness",
  ];
  const source = names.map(extractFunction).join("\n");
  const context = {
    OFFERTE_ARERA_BUSINESS: business,
    OFFERTE_ARERA_DUAL_BUSINESS: dualBusiness,
    DATI_ARERA_MENU_META: { fonte: "ARERA test" },
  };
  vm.createContext(context);
  vm.runInContext(`${source}; globalThis.rankBusiness = costruisciRankingBusiness; globalThis.costBusiness = calcolaCostoVenditaBusiness;`, context);
  return context;
}

const luce = (providerKey, prezzo, quotaFissaAnnua, tipo = "fisso") => ({
  providerKey,
  providerLabel: providerKey.toUpperCase(),
  fornitore: providerKey.toUpperCase(),
  commodity: "luce",
  customerType: "business",
  tipo,
  nome: `Luce ${providerKey}`,
  codice: `L-${providerKey}`,
  prezzo,
  quotaFissaAnnua,
  fonte: "ARERA test",
});
const gas = (providerKey, prezzo, quotaFissaAnnua, tipo = "fisso") => ({
  providerKey,
  providerLabel: providerKey.toUpperCase(),
  fornitore: providerKey.toUpperCase(),
  commodity: "gas",
  customerType: "business",
  tipo,
  nome: `Gas ${providerKey}`,
  codice: `G-${providerKey}`,
  prezzo,
  quotaFissaAnnua,
  fonte: "ARERA test",
});

const profile = {
  consumoLuceKwh: 10000,
  consumoGasSmc: 1000,
  costoAttualeLuce: 2500,
  costoAttualeGas: 1000,
  costoAttuale: 3500,
  attivita: "agricoltura",
};

test("battaglia 01: il costo business usa solo consumo, prezzo e quota fissa di vendita", () => {
  const context = buildBusinessContext();
  assert.equal(context.costBusiness(10000, 0.15, 120), 1620);
  assert.equal(context.costBusiness(1000, 0.6, 100), 700);
  assert.equal(context.costBusiness(-1, 0.6, 100), null);
});

test("battaglia 01: il ranking luce usa solo offerte customerType business", () => {
  const context = buildBusinessContext({
    business: [
      luce("cheap", 0.10, 100),
      luce("mid", 0.12, 100),
      { ...luce("consumer", 0.01, 1), customerType: "privato" },
    ],
  });
  const luceOnly = { ...profile, consumoGasSmc: null, costoAttualeGas: null, costoAttuale: 2500 };
  const ranked = context.rankBusiness(luceOnly, 9);
  assert.deepEqual(Array.from(ranked, (item) => item.provider), ["CHEAP", "MID"]);
  assert.equal(ranked[0].posizioneEconomica, 1);
  assert.equal(ranked[0].costo, 1100);
  assert.equal(ranked[0].differenza, 1400);
});

test("battaglia 01: per luce+gas confronta dual ufficiali e forniture separate", () => {
  const dual = {
    providerKey: "dualco",
    providerLabel: "DUALCO",
    fornitore: "DUALCO",
    fornitura: "dual",
    customerType: "business",
    tipo: "fisso",
    nome: "Dual Business",
    codice: "D-DUALCO",
    codiceOffertaLuce: "DL-DUALCO",
    codiceOffertaGas: "DG-DUALCO",
    fonte: "ARERA test",
    luce: luce("dualco", 0.11, 100),
    gas: gas("dualco", 0.55, 100),
  };
  const context = buildBusinessContext({
    business: [luce("l1", 0.10, 100), luce("l2", 0.14, 100), gas("g1", 0.50, 100), gas("g2", 0.65, 100)],
    dualBusiness: [dual],
  });
  const ranked = context.rankBusiness(profile, 9);
  assert.ok(ranked.some((item) => item.separate === true));
  assert.ok(ranked.some((item) => item.separate === false && item.ambito === "dual"));
  assert.equal(ranked[0].provider, "L1 + G1");
  assert.equal(ranked[0].costo, 1700);
  assert.equal(ranked[0].differenza, 1800);
});

test("battaglia 01: il tipo di attività non altera il ranking economico", () => {
  const context = buildBusinessContext({ business: [luce("a", 0.10, 100), luce("b", 0.11, 80)] });
  const base = { ...profile, consumoGasSmc: null, costoAttualeGas: null, costoAttuale: 2500 };
  const agricolo = context.rankBusiness({ ...base, attivita: "agricoltura" }, 9);
  const ufficio = context.rankBusiness({ ...base, attivita: "ufficio" }, 9);
  assert.deepEqual(
    Array.from(agricolo, (item) => [item.provider, item.costo]),
    Array.from(ufficio, (item) => [item.provider, item.costo]),
  );
  assert.doesNotMatch(extractFunction("costruisciRankingBusiness"), /attivita/);
});

test("battaglia 01: il loader mantiene cataloghi privati e business separati", () => {
  const loader = extractFunction("applicaDatiAreraMenu");
  assert.match(html, /let OFFERTE_ARERA_BUSINESS = \[\];/);
  assert.match(html, /let OFFERTE_ARERA_DUAL_BUSINESS = \[\];/);
  assert.match(loader, /data\?\.offerteBusiness/);
  assert.match(loader, /data\?\.offerteDualBusiness/);
  assert.match(loader, /riga\.customerType === "business"/);
  assert.match(loader, /OFFERTE_ARERA_BUSINESS = businessPulite/);
  assert.match(loader, /OFFERTE_ARERA_DUAL_BUSINESS = dualBusinessPulite/);
});

test("battaglia 01: il profilo non somma fasce parziali come consumo annuo completo", () => {
  const profileSource = extractFunction("leggiProfiloBusiness");
  assert.match(profileSource, /const fasceComplete = \[f1, f2, f3\]\.every/);
  assert.match(profileSource, /const fasceParziali = bandValues\.length > 0 && !fasceComplete/);
  assert.match(profileSource, /F1\/F2\/F3 complete oppure consumo annuo luce totale/);
});

test("battaglia 01: l'output business espone ranking economico e conserva assistenza come passo successivo", () => {
  assert.match(html, /id="business-ranking" hidden/);
  const calculate = html.slice(html.indexOf("window.calcolaBusiness = function calcolaBusiness"), html.indexOf("window.apriLeadBusiness = function apriLeadBusiness"));
  assert.match(calculate, /costruisciRankingBusiness\(profile, 9\)/);
  assert.match(calculate, /costoBenchmark: migliore\?\.costo \?\? null/);
  assert.match(calculate, /risparmioStimato: migliore\?\.differenza \?\? 0/);
  assert.match(calculate, /rankingOffersCount: ranking\.length/);
  assert.match(html, /onclick="apriLeadBusiness\(\)">Prosegui con la richiesta/);
  assert.match(html, /Rete, oneri, imposte e IVA non sono inclusi nella stima/);
});

test("battaglia 01: non introduce nuove API o fetch dedicati al business ranking", () => {
  const businessBlock = html.slice(html.indexOf("function calcolaCostoVenditaBusiness"), html.indexOf("window.apriLeadBusiness = function apriLeadBusiness"));
  assert.doesNotMatch(businessBlock, /fetch\s*\(/);
  assert.doesNotMatch(businessBlock, /\/api\//);
});
