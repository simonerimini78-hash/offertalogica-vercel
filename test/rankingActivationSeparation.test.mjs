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

test("blocco 04: il ranking economico non favorisce il canale di attivazione", () => {
  const source = extractFunction("selezionaRankingEconomicoPerMenu");
  const context = { NUMERO_OFFERTE_RANKING_MENU: 9 };
  vm.createContext(context);
  vm.runInContext(`${source}; globalThis.selectRanking = selezionaRankingEconomicoPerMenu;`, context);

  const item = (id, posizioneEconomica, costo, attivabileOnline) => ({
    posizioneEconomica,
    costo,
    differenza: 1000 - costo,
    attivabileOnline,
    offerta: { id },
  });
  const mixed = [
    item("online-4", 4, 400, true),
    item("assistita-1", 1, 100, false),
    item("online-2", 2, 200, true),
    item("assistita-3", 3, 300, false),
    item("online-10", 10, 1000, true),
    item("assistita-5", 5, 500, false),
    item("online-6", 6, 600, true),
    item("assistita-7", 7, 700, false),
    item("online-8", 8, 800, true),
    item("assistita-9", 9, 900, false),
  ];

  const selected = context.selectRanking(mixed, 9);
  assert.deepEqual(
    Array.from(selected, (entry) => entry.offerta.id),
    ["assistita-1", "online-2", "assistita-3", "online-4", "assistita-5", "online-6", "assistita-7", "online-8", "assistita-9"],
  );
});

test("blocco 04: la visualizzazione usa un solo gruppo da nove offerte", () => {
  assert.match(html, /const NUMERO_OFFERTE_RANKING_MENU = 9;/);
  assert.match(html, /selezionaRankingEconomicoPerMenu\(\s*ordinateRanking,\s*NUMERO_OFFERTE_RANKING_MENU\s*\)/s);
  assert.match(html, /"offerte-ranking-group"/);
  assert.match(html, /gruppoVisuale: "ranking"/);
  assert.doesNotMatch(html, /NUMERO_OFFERTE_PARTNER_MENU/);
  assert.doesNotMatch(html, /NUMERO_OFFERTE_CONSULENTE_MENU/);
  assert.doesNotMatch(html, /selezionaPartnerAttivabiliPerMenu/);
  assert.doesNotMatch(html, /selezionaConsulentiPerMenu/);
});

test("blocco 04: il percorso di attivazione resta un attributo separato", () => {
  assert.match(html, /const attivabiliVisibili = visibili\.filter\(\(item\) => item\.attivabileOnline\)/);
  assert.match(html, /const assistiteVisibili = visibili\.filter\(\(item\) => !item\.attivabileOnline\)/);
  assert.match(html, /Posizione economica \$\{item\.posizioneEconomica\}/);
  assert.match(html, /Percorso da verificare/);
  assert.match(html, /Attivabile online/);
  assert.match(html, /activePartnerOffersCount: attivabiliVisibili\.length/);
  assert.match(html, /consultantOffersCount: assistiteVisibili\.length/);
  assert.match(html, /rankingOffersCount: visibili\.length/);
});
