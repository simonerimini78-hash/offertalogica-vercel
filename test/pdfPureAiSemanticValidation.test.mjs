import test from "node:test";
import assert from "node:assert/strict";
import { PDF_PURE_AI_READER_VERSION, normalizePureAiOutput } from "../lib/pdfPureAiReader.js";

const empty = () => ({ value: null, value_text: null, unit: null, period: "none", page: null, label: null, evidence: null, confidence: 0 });
const supply = (annual) => ({
  commodity: "gas", provider: "Test", offer_name: null, offer_code: null, annual_consumption: annual,
  annual_band_consumptions: [], primary_price: empty(), price_items: [], fixed_fee: empty(), price_type: "unknown",
  price_structure: null, index: null, multiplier: null, spread: null, formula: null, periodicity: null,
  committed_power_kw: null, available_power_kw: null, pricing_page: 1, pricing_evidence: null, confidence: 100,
});

test("salvaguardia minima: non usa il consumo del solo periodo come annuale", () => {
  const annual = { value: 246.66, value_text: "246,66", unit: "Smc", period: "none", page: 4, label: "Consumi fatturati", evidence: "Consumi fatturati 01/03/26-31/03/26 246,66 Smc", confidence: 100 };
  const n = normalizePureAiOutput({ document: { kind: "bill", commodity: "gas", customer_type: "consumer", page_count: 4 }, supplies: [supply(annual)], additional_data: [] });
  assert.equal(n.consumo_gas_smc, undefined);
  assert.equal(n.adaptive_form.supplies[0].annual_consumption.value, 246.66);
});

test("IA libera: il primary_price non viene scartato da classificazioni semantiche successive", () => {
  const s = supply({ value: 1883, value_text: "1.883", unit: "Smc/anno", period: "none", page: 4, label: "Consumo annuo", evidence: "Consumo annuo 1.883 Smc", confidence: 100 });
  s.primary_price = { value: 0.687479, value_text: "0,687479", unit: "€/Smc", period: "none", page: 7, label: "materia prima gas", evidence: "SPESA PER LA VENDITA materia prima gas 0,687479 €/Smc", confidence: 100 };
  const n = normalizePureAiOutput({ document: { kind: "bill", commodity: "gas", customer_type: "consumer", page_count: 7 }, supplies: [s], additional_data: [] });
  assert.equal(n.prezzo_gas_eur_smc, 0.687479);
  assert.equal(n.ai.filled_fields.includes("prezzo_gas_eur_smc"), true);
});

test("versione lettore IA libera aggiornata", () => {
  assert.equal(PDF_PURE_AI_READER_VERSION, "pure-ai-native-pdf-v2.0.0-ia-libera-form");
});
