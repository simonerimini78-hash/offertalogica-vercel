import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const billsSource = await readFile(new URL("../public/app-premium-bills.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const staffSource = await readFile(new URL("../public/staff.html", import.meta.url), "utf8");
const staffPremiumSource = await readFile(new URL("../public/staff-premium.html", import.meta.url), "utf8");
const swSource = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../public/version.json", import.meta.url), "utf8"));

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Funzione ${name} non trovata`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = brace; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (["\"", "'", "`"].includes(char)) { quote = char; continue; }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Funzione ${name} incompleta`);
}

const helpers = Function(`
  ${extractFunction(billsSource, "finiteNumberOrNull")}
  ${extractFunction(billsSource, "formatUnitPrice")}
  ${extractFunction(billsSource, "analysisDataForBill")}
  function priceTypeLabel(value) {
    return ({ fixed: "Prezzo fisso", indexed: "Prezzo indicizzato", mixed: "Prezzo misto", unknown: "Tipo non definito" })[value] || "Tipo non definito";
  }
  function formatMoney(value) { return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(value)); }
  function formatDate(value) { return String(value); }
  ${extractFunction(billsSource, "offerRows")}
  return { finiteNumberOrNull, formatUnitPrice, offerRows };
`)();

test("i null contrattuali non vengono più trasformati in zero", () => {
  assert.equal(helpers.finiteNumberOrNull(null), null);
  assert.equal(helpers.finiteNumberOrNull(undefined), null);
  assert.equal(helpers.finiteNumberOrNull(""), null);
  assert.equal(helpers.finiteNumberOrNull("   "), null);
  assert.equal(helpers.finiteNumberOrNull(0), 0);
  assert.equal(helpers.finiteNumberOrNull("0"), 0);
  assert.equal(helpers.formatUnitPrice(null, "€/Smc"), "—");
  assert.doesNotMatch(billsSource, /Number\.isFinite\(Number\(contract\.(?:electricity|gas)_(?:price|fixed_fee)/);
});

test("una bolletta gas indicizzata mostra il prezzo applicato senza inventare campi luce", () => {
  const contract = {
    id: "contract-1",
    provider_name: "Dolomiti Energia Mercato SpA",
    offer_name: "GAS ITALY CASA_R",
    pricing_type: "indexed",
    electricity_price_eur_kwh: null,
    gas_price_eur_smc: null,
    electricity_fixed_fee_eur_year: null,
    gas_fixed_fee_eur_year: 144,
    electricity_index_name: null,
    gas_index_name: "PSVDA",
    gas_spread_eur_smc: 0.121732,
    gas_formula: "PSVDA + 0,121732 €/Smc",
  };
  const bill = { customer_analysis_data: { prezzo_gas_eur_smc: 0.687459 } };
  const rows = helpers.offerRows(contract, bill);
  const values = Object.fromEntries(rows);

  assert.equal(values["Prezzo gas applicato"], "0,687459 €/Smc");
  assert.equal(values["Formula gas"], "PSVDA + 0,121732 €/Smc");
  assert.match(values["Quota fissa gas"], /144/);
  assert.equal(values["Prezzo gas"], undefined);
  assert.equal(values["Prezzo luce"], undefined);
  assert.equal(values["Prezzo luce applicato"], undefined);
  assert.equal(values["Quota fissa luce"], undefined);
});

test("un prezzo contrattuale esplicito prevale sul prezzo applicato letto dalla bolletta", () => {
  const contract = {
    provider_name: "Fornitore",
    offer_name: "Offerta fissa",
    pricing_type: "fixed",
    gas_price_eur_smc: 0.44,
  };
  const bill = { customer_analysis_data: { prezzo_gas_eur_smc: 0.687459 } };
  const values = Object.fromEntries(helpers.offerRows(contract, bill));
  assert.equal(values["Prezzo gas"], "0,44 €/Smc");
  assert.equal(values["Prezzo gas applicato"], undefined);
});

test("la release v0.36.27 è allineata tra app, staff, manifest e cache", () => {
  assert.match(appSource, /APP Premium v0\.36\.27/);
  assert.match(staffSource, /Area staff unica v0\.36\.27/);
  assert.match(staffPremiumSource, /v0\.36\.27/);
  assert.match(billsSource, /app_version: "0\.36\.27"/);
  assert.match(swSource, /offertalogica-premium-v03627/);
  assert.equal(manifest.version, "0.36.27");
});
