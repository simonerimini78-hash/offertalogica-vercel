import test from "node:test";
import assert from "node:assert/strict";
import { normalizePureAiOutput } from "../lib/pdfPureAiReader.js";

const empty = (overrides = {}) => ({ value: null, value_text: null, unit: null, period: "none", page: null, label: null, evidence: null, confidence: 0, ...overrides });
const supply = (commodity, overrides = {}) => ({
  commodity, provider: "Test Energia", offer_name: null, offer_code: null,
  annual_consumption: empty(), annual_band_consumptions: [], primary_price: empty(), price_items: [], fixed_fee: empty(),
  price_type: "unknown", price_structure: null, index: null, multiplier: null, spread: null, formula: null, periodicity: null,
  committed_power_kw: null, available_power_kw: null, pricing_page: 1, pricing_evidence: "Condizioni economiche", confidence: 100,
  ...overrides,
});

test("Hera: conserva F1/F2/F3 e le componenti senza inventare un prezzo unico", () => {
  const prices = [
    ["F1", 0.122252], ["F2", 0.152087], ["F3", 0.128295],
  ].map(([band, value]) => ({ label: `CELD ${band}`, value, value_text: String(value), unit: "€/kWh", period: "none", band, page: 5, evidence: `CELD ${band} ${value}`, confidence: 100 }));
  const output = { document: { kind: "bill", commodity: "electricity", customer_type: "consumer", page_count: 8 }, supplies: [supply("electricity", {
    annual_consumption: empty({ value: 1628.91, value_text: "1.628,91", unit: "kWh/anno", page: 4, label: "Consumo annuo", evidence: "Consumo annuo 1.628,91 kWh", confidence: 100 }),
    primary_price: empty(), price_items: prices,
    fixed_fee: empty({ value: -6.1, value_text: "-6,10", unit: "€/mese", period: "month", page: 6, label: "Quota fissa vendita", evidence: "Quota fissa vendita -6,10 €/mese", confidence: 100 }),
    price_type: "variable", price_structure: "F1/F2/F3", index: "PUN Index GME", formula: "CELD fascia + componenti comuni",
  })], additional_data: [] };
  const normalized = normalizePureAiOutput(output);
  assert.equal(normalized.prezzo_luce_eur_kwh, undefined);
  assert.equal(normalized.prezzo_luce_f1_eur_kwh, 0.122252);
  assert.equal(normalized.prezzo_luce_f2_eur_kwh, 0.152087);
  assert.equal(normalized.prezzo_luce_f3_eur_kwh, 0.128295);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, -73.2);
  assert.equal(normalized.adaptive_form.supplies[0].price_items.length, 3);
});

test("Irina: accetta i valori scelti liberamente dall'IA per i campi principali", () => {
  const output = { document: { kind: "bill", commodity: "dual", customer_type: "consumer", page_count: 14 }, supplies: [
    supply("electricity", { annual_consumption: empty({ value: 732.8, unit: "kWh/anno", page: 4, label: "Consumo annuo", evidence: "Consumo annuo 732,80 kWh", confidence: 100 }), primary_price: empty({ value: 0.180313, unit: "€/kWh", page: 6, label: "di cui spesa per la vendita", evidence: "di cui spesa per la vendita 0,180313 €/kWh", confidence: 100 }), fixed_fee: empty({ value: 7.1, unit: "€/mese", period: "month", page: 6, label: "Quota fissa vendita", evidence: "Quota fissa di cui vendita 7,10 €/mese", confidence: 100 }) }),
    supply("gas", { annual_consumption: empty({ value: 516.41, unit: "Smc/anno", page: 10, label: "Consumo annuo", evidence: "Consumo annuo 516,41 Smc", confidence: 100 }), primary_price: empty({ value: 0.44075, unit: "€/Smc", page: 12, label: "di cui spesa per la vendita", evidence: "di cui spesa per la vendita 0,440750 €/Smc", confidence: 100 }), fixed_fee: empty({ value: 10, unit: "€/mese", period: "month", page: 12, label: "Quota fissa vendita", evidence: "Quota fissa di cui vendita 10,00 €/mese", confidence: 100 }) }),
  ], additional_data: [] };
  const n = normalizePureAiOutput(output);
  assert.equal(n.consumo_luce_kwh, 732.8);
  assert.equal(n.prezzo_luce_eur_kwh, 0.180313);
  assert.equal(n.quota_fissa_vendita_luce_eur_anno, 85.2);
  assert.equal(n.consumo_gas_smc, 516.41);
  assert.equal(n.prezzo_gas_eur_smc, 0.44075);
  assert.equal(n.quota_fissa_vendita_gas_eur_anno, 120);
});
