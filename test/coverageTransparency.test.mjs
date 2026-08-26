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

function loadFunctions(names, context = {}) {
  vm.createContext(context);
  const source = names.map(extractFunction).join("\n");
  const exports = names.map((name) => `globalThis.${name} = ${name};`).join("\n");
  vm.runInContext(`${source}\n${exports}`, context);
  return context;
}

test("battaglia 03: il consumer espone copertura reale e mantiene il limite di nove", () => {
  assert.match(html, /id="offers-ranking-explainer"/);
  assert.match(html, /aggiornaCoperturaConsumer\(ordinateRanking\.length, visibili\.length\)/);
  assert.match(html, /const NUMERO_OFFERTE_RANKING_MENU = 9;/);
  assert.match(html, /selezionaRankingEconomicoPerMenu\(\s*ordinateRanking,\s*NUMERO_OFFERTE_RANKING_MENU\s*\)/s);
});

test("battaglia 03: il testo consumer usa data, catalogo, compatibili e mostrate senza claim totale mercato", () => {
  const context = loadFunctions(
    ["formattaDataCatalogoCopertura", "testoCoperturaConsumer"],
    {
      OFFERTE_ARERA_MENU: Array.from({ length: 10 }, () => ({})),
      OFFERTE_ARERA_DUAL: Array.from({ length: 2 }, () => ({})),
      DATI_ARERA_MENU_META: { aggiornatoIl: "2026-08-25" },
      Math,
      Number,
      String,
    },
  );
  const text = context.testoCoperturaConsumer(7, 5);
  assert.match(text, /aggiornato al 25\/08\/2026/);
  assert.match(text, /12 offerte monitorate/);
  assert.match(text, /7 soluzioni compatibili classificate/);
  assert.match(text, /5 mostrate/);
  assert.match(text, /Ordinamento esclusivamente economico/);
  assert.match(text, /percorso di attivazione non modifica la posizione/);
  assert.doesNotMatch(text, /tutto il mercato|intero mercato|100%/i);
});

test("battaglia 03: senza catalogo ARERA caricato non mostra numeri di copertura", () => {
  const context = loadFunctions(
    ["formattaDataCatalogoCopertura", "testoCoperturaConsumer"],
    {
      OFFERTE_ARERA_MENU: [],
      OFFERTE_ARERA_DUAL: [],
      DATI_ARERA_MENU_META: { aggiornatoIl: "2026-06-27" },
      Math,
      Number,
      String,
    },
  );
  const text = context.testoCoperturaConsumer(99, 9);
  assert.equal(
    text,
    "Il costo annuo stimato mostra il risultato economico del confronto. I badge di attivazione indicano come puoi procedere con la singola offerta.",
  );
  assert.doesNotMatch(text, /99|offerte monitorate|aggiornato al/);
});

test("battaglia 03: il business distingue catalogo monitorato, offerte pertinenti e risultati mostrati", () => {
  const context = loadFunctions(
    [
      "formattaDataCatalogoCopertura",
      "calcolaCostoVenditaBusiness",
      "offertaBusinessCompatibileGenerica",
      "creaCandidatoBusinessSingolo",
      "creaCandidatoBusinessDual",
      "testoCoperturaBusiness",
    ],
    {
      OFFERTE_ARERA_BUSINESS: [
        { customerType: "business", commodity: "luce", nome: "Luce A", prezzo: 0.2, quotaFissaAnnua: 100, providerLabel: "A", codice: "LA" },
        { customerType: "business", commodity: "gas", nome: "Gas B", prezzo: 0.5, quotaFissaAnnua: 100, providerLabel: "B", codice: "GB" },
        { customerType: "business", commodity: "luce", nome: "Condominio Luce", prezzo: 0.1, quotaFissaAnnua: 50, providerLabel: "C", codice: "CL" },
      ],
      OFFERTE_ARERA_DUAL_BUSINESS: [
        {
          customerType: "business",
          fornitura: "dual",
          nome: "Dual D",
          providerLabel: "D",
          codice: "DD",
          codiceOffertaLuce: "DL",
          codiceOffertaGas: "DG",
          luce: { prezzo: 0.19, quotaFissaAnnua: 90 },
          gas: { prezzo: 0.48, quotaFissaAnnua: 90 },
        },
      ],
      DATI_ARERA_MENU_META: { aggiornatoIl: "2026-08-25", fonte: "test" },
      Math,
      Number,
      String,
    },
  );
  const profile = {
    consumoLuceKwh: 5000,
    consumoGasSmc: 1000,
    costoAttualeLuce: 1500,
    costoAttualeGas: 900,
    costoAttuale: 2400,
  };
  const text = context.testoCoperturaBusiness(profile, 3);
  assert.match(text, /Catalogo business aggiornato al 25\/08\/2026/);
  assert.match(text, /4 offerte monitorate/);
  assert.match(text, /3 offerte pertinenti alle forniture indicate/);
  assert.match(text, /3 risultati mostrati/);
  assert.doesNotMatch(text, /Condominio/);
});


test("battaglia 03 v2: il ranking business chiarisce costo annuo e differenza rispetto all'attuale", () => {
  assert.match(html, /Costo annuo stimato dell'offerta/);
  assert.match(html, /Risparmio stimato rispetto all'attuale:/);
  assert.match(html, /Costo superiore all'attuale di/);
  assert.match(html, /Miglior risparmio stimato:/);
  assert.match(html, /Come leggere i risultati:/);
  assert.match(html, /Risultati basati su offerte business ARERA compatibili con il profilo aziendale inserito/);
  assert.doesNotMatch(html, /Differenza favorevole/);
  assert.doesNotMatch(html, /Migliore differenza stimata/);
});

test("battaglia 03 v3: il ranking business riusa i loghi fornitori senza alterare i dati economici", () => {
  assert.match(html, /function htmlLogoBusiness\(item\)/);
  assert.match(html, /const logoHtml = htmlLogoBusiness\(item\);/);
  assert.match(html, /className = "business-ranking-logo"/);
  assert.match(html, /business-ranking-logo \.provider-logo-shell/);

  const context = loadFunctions(
    ["brandDaRiferimento", "htmlLogoMiniComponente", "htmlLogoBusiness"],
    {
      testoHtmlSicuro(value) { return String(value || ""); },
      PROVIDER_BRANDS: {
        enel: { label: "Enel", logo: "/assets/providers/enel.png" },
        edison: { label: "Edison", logo: "/assets/providers/edison-user.png" },
      },
      chiaveFornitoreDaNome(name) {
        const value = String(name || "").toLowerCase();
        if (value.includes("enel")) return "enel";
        if (value.includes("edison")) return "edison";
        return "";
      },
      String,
      Set,
    },
  );

  const single = context.htmlLogoBusiness({ provider: "Enel" });
  assert.match(single, /provider-logo/);
  assert.match(single, /\/assets\/providers\/enel\.png/);

  const separate = context.htmlLogoBusiness({ provider: "Enel + Edison", separate: true });
  assert.match(separate, /provider-logo-split/);
  assert.match(separate, /enel\.png/);
  assert.match(separate, /edison-user\.png/);

  const missing = context.htmlLogoBusiness({ provider: "Fornitore senza logo" });
  assert.equal(missing, "");

  const ranking = extractFunction("selezionaRankingBusiness");
  assert.doesNotMatch(ranking, /logo|PROVIDER_BRANDS|htmlLogoBusiness/);
});

test("battaglia 03: la trasparenza non introduce fetch, API o criteri commerciali nel ranking", () => {
  const consumer = extractFunction("aggiornaCoperturaConsumer");
  const business = extractFunction("testoCoperturaBusiness");
  assert.doesNotMatch(`${consumer}\n${business}`, /fetch\s*\(|\/api\//i);
  const ranking = extractFunction("selezionaRankingEconomicoPerMenu");
  assert.doesNotMatch(ranking, /attivabileOnline|partner|commission|affiliate/i);
});
