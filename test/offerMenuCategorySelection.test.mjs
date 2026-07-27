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

function coherentSupply(offer, supply) {
  if (supply === "luce") return Boolean(offer.luce) && !offer.gas;
  if (supply === "gas") return Boolean(offer.gas) && !offer.luce;
  if (supply === "dual") return offer.fornitura === "dual" && Boolean(offer.luce && offer.gas);
  if (supply === "separate") return offer.fornitura === "separate" && Boolean(offer.luce && offer.gas);
  return false;
}

test("partner menu: seleziona soltanto offerte della tariffa e fornitura richieste", () => {
  const source = extractFunction("selezionaPartnerAttivabiliPerMenu");
  const context = {
    NUMERO_OFFERTE_PARTNER_MENU: 6,
    offertaCoerenteConFornitura: coherentSupply,
    deduplicaPartnerAttivabili: (items) => items,
  };
  vm.createContext(context);
  vm.runInContext(`${source}; globalThis.selectPartners = selezionaPartnerAttivabiliPerMenu;`, context);

  const item = (id, tipo, fornitura, luce, gas, costo, attivabileOnline = true) => ({
    attivabileOnline,
    costo,
    differenza: 100 - costo,
    offerta: { id, tipo, fornitura, luce: luce ? {} : null, gas: gas ? {} : null },
  });
  const mixed = [
    item("fixed-light-1", "fisso", "separate", true, false, 500),
    item("fixed-light-2", "fisso", "separate", true, false, 450),
    item("variable-light", "variabile", "separate", true, false, 300),
    item("fixed-gas", "fisso", "separate", false, true, 250),
    item("fixed-dual", "fisso", "dual", true, true, 200),
    item("inactive-fixed-light", "fisso", "separate", true, false, 100, false),
  ];

  const selected = context.selectPartners(mixed, "fisso", "luce", 6);
  assert.deepEqual(Array.from(selected, (entry) => entry.offerta.id), ["fixed-light-2", "fixed-light-1"]);
  assert.ok(selected.every((entry) => entry.offerta.tipo === "fisso"));
  assert.ok(selected.every((entry) => coherentSupply(entry.offerta, "luce")));
  assert.ok(selected.every((entry) => entry.attivabileOnline));
});

test("partner menu: le schede mono-fornitura usano il nome ARERA della categoria", () => {
  const source = extractFunction("offertaPartnerConPrezziArera");
  assert.match(source, /const nomiArera = \[luce\?\.nome, gas\?\.nome\]/);
  assert.match(source, /nome: `\$\{providerLabel\} - \$\{nomiArera\}`/);
  assert.match(source, /categoriaMenu: \{ tipo: offerta\.tipo, fornitura: categoriaFornitura \}/);
});

test("composizione 6+3: il selettore riceve esplicitamente i valori del menu", () => {
  assert.match(
    html,
    /selezionaPartnerAttivabiliPerMenu\(\s*partnerAttivabiliCoerenti,\s*tipoTariffa,\s*tipoFornitura,\s*NUMERO_OFFERTE_PARTNER_MENU\s*\)/s,
  );
});
