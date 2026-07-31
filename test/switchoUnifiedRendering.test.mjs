import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Funzione ${name} non trovata`);
  const signatureEnd = html.indexOf(") {", start);
  assert.notEqual(signatureEnd, -1, `Firma funzione ${name} non trovata`);
  const braceStart = html.indexOf("{", signatureEnd);
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

function compositionContext() {
  const context = {
    NUMERO_OFFERTE_PARTNER_MENU: 6,
    NUMERO_OFFERTE_CONSULENTE_MENU: 3,
    SWITCHO_INTEGRATION_CONFIG: {
      enabled: false,
      rankingMode: "legacy_6_plus_3",
      unifiedOfferLimit: 9,
      catalog: [],
    },
    selezionaPartnerAttivabiliPerMenu: (items, limit) => items.slice(0, limit),
    selezionaConsulentiPerMenu: (items, partners, limit) => {
      const partnerIds = new Set(partners.map((item) => String(item?.offerta?.id || "")));
      return items.filter((item) => !partnerIds.has(String(item?.offerta?.id || ""))).slice(0, limit);
    },
    offertaCoerenteConFornitura: () => true,
    graduatoriaCommercialeUnificataPronta: (config) => Boolean(config?.ready),
    selezionaOfferteCommercialiUnificate: (items, limit) => items
      .filter((item) => ["direct", "switcho", "direct_and_switcho"].includes(item.canaliAttivazione?.route))
      .sort((a, b) => a.costo - b.costo)
      .slice(0, limit),
  };
  vm.createContext(context);
  vm.runInContext(`${extractFunction("preparaComposizioneOfferteVisibili")}; globalThis.compose = preparaComposizioneOfferteVisibili;`, context);
  return context;
}

function offer(id, costo, route, extra = {}) {
  return {
    offerta: { id, tipo: "fisso" },
    costo,
    differenza: 1000 - costo,
    attivabileCoerente: route === "direct" || route === "direct_and_switcho",
    compatibileRanking: true,
    filtroEsatto: true,
    canaliAttivazione: { route },
    ...extra,
  };
}

test("rendering unificato: il flag pubblico resta spento", () => {
  assert.match(html, /enabled: false/);
  assert.match(html, /rankingMode: "legacy_6_plus_3"/);
  assert.match(html, /catalog: Object\.freeze\(\[\]\)/);
});

test("composizione: con flag spento conserva ordine partner poi consulente", () => {
  const context = compositionContext();
  const direct = offer("direct", 500, "direct");
  const consultant = offer("consultant", 450, "informational_only");
  const result = context.compose({
    offerteCalcolate: [direct, consultant],
    ordinateRanking: [consultant, direct],
    rankingGlobale: new Map([["consultant", 1], ["direct", 2]]),
    tipoTariffa: "fisso",
    tipoFornitura: "dual",
    config: { ready: false, unifiedOfferLimit: 9 },
  });
  assert.equal(result.unifiedActive, false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.visibili.map((item) => [item.offerta.id, item.gruppoVisuale]))),
    [["direct", "attivabile"], ["consultant", "top"]],
  );
});

test("composizione: con flag pronto usa una sola graduatoria per costo", () => {
  const context = compositionContext();
  const direct = offer("direct", 500, "direct");
  const switcho = offer("switcho", 430, "switcho");
  const both = offer("both", 470, "direct_and_switcho");
  const result = context.compose({
    offerteCalcolate: [direct, switcho, both],
    ordinateRanking: [switcho, both, direct],
    rankingGlobale: new Map([["switcho", 1], ["both", 2], ["direct", 3]]),
    tipoTariffa: "fisso",
    tipoFornitura: "dual",
    config: { ready: true, unifiedOfferLimit: 9 },
  });
  assert.equal(result.unifiedActive, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.visibili.map((item) => [item.offerta.id, item.gruppoVisuale]))),
    [["switcho", "unified"], ["both", "unified"], ["direct", "unified"]],
  );
});

test("rendering: crea un gruppo unico e nasconde i due gruppi legacy", () => {
  assert.match(html, /"offerte-unificate-group"/);
  assert.match(html, /resetGruppoOfferte\(gruppoUnificato, unifiedActive && offerteUnificate\.length > 0\)/);
  assert.match(html, /resetGruppoOfferte\(gruppoPartner, !unifiedActive && attivabiliPrioritarie\.length > 0\)/);
  assert.match(html, /resetGruppoOfferte\(gruppoConsulente, !unifiedActive && miglioriConConsulente\.length > 0\)/);
});

test("social: usa il miglior risparmio commerciale solo in modalità unificata", () => {
  assert.match(html, /LEAD_STATE\.bestPartnerSaving = Math\.max\(0, \.\.\.attivabiliPrioritarie\.map\(\(item\) => item\.differenza\)\)/);
  assert.match(html, /if \(unifiedActive\) LEAD_STATE\.bestPartnerSaving = bestCommercialSaving/);
  assert.match(html, /rankingMode: unifiedActive \? "unified" : "legacy_6_plus_3"/);
  assert.match(html, /switchoOffersCount: switchoVisibleCount/);
});

test("CTA: prepara il testo per canale ma non attiva ancora il redirect Switcho", () => {
  assert.match(html, /link\.innerText = testoAzioneOfferta\(offerta, attivabileOnline, canaliAttivazione, unifiedActive\)/);
  assert.match(html, /apriConsensoOfferta\(offerta\)/);
  assert.doesNotMatch(html, /window\.location\.href = canaliAttivazione\?\.switchoUrl/);
  assert.doesNotMatch(html, /window\.location\.href = offer\.switchoUrl/);
});
