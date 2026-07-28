import test from "node:test";
import assert from "node:assert/strict";
import { buildPdfPureAiRequest, normalizePureAiOutput } from "../lib/pdfPureAiReader.js";

const nil = () => ({ value: null, value_text: null, unit: null, period: "none", page: null, label: null, evidence: null, confidence: 0 });

test("quota fissa senza periodicità resta visibile nel modulo adattivo ma non viene annualizzata", () => {
  const fixed = { value: 10.154033, value_text: "10,154033", unit: "€", period: "none", page: 7, label: "Quota fissa", evidence: "Quota fissa 10,154033", confidence: 100 };
  const supply = { commodity: "gas", provider: "Test", offer_name: null, offer_code: null, annual_consumption: nil(), annual_band_consumptions: [], primary_price: nil(), price_items: [], fixed_fee: fixed, price_type: "unknown", price_structure: null, index: null, multiplier: null, spread: null, formula: null, periodicity: null, committed_power_kw: null, available_power_kw: null, pricing_page: 7, pricing_evidence: null, confidence: 100 };
  const n = normalizePureAiOutput({ document: { kind: "bill", commodity: "gas", customer_type: "consumer", page_count: 7 }, supplies: [supply], additional_data: [] });
  assert.equal(n.quota_fissa_vendita_gas_eur_anno, undefined);
  assert.equal(n.adaptive_form.supplies[0].fixed_fee.value, 10.154033);
});

test("schema non contiene la vecchia casella price.single", async () => {
  const request = await buildPdfPureAiRequest({ fileId: "file_test" });
  const supply = request.text.format.schema.properties.supplies.items.properties;
  assert.equal(supply.price, undefined);
  assert.ok(supply.primary_price);
  assert.ok(supply.price_items);
});

test("scheda a fasce conserva F0/F1/F2/F3 senza calcolare un prezzo diverso", () => {
  const items = [["F0", .099], ["F1", .109], ["F2", .105], ["F3", .101]].map(([band,value]) => ({ label: `Prezzo ${band}`, value, value_text: String(value), unit: "€/kWh", period: "none", band, page: 2, evidence: `Prezzo ${band} ${value} €/kWh`, confidence: 100 }));
  const supply = { commodity: "electricity", provider: "Acea", offer_name: "Acea Flex", offer_code: "00000000000000000001", annual_consumption: nil(), annual_band_consumptions: [], primary_price: nil(), price_items: items, fixed_fee: { value: 120, value_text: "120", unit: "€/anno", period: "year", page: 2, label: "Quota fissa", evidence: "Quota fissa 120 €/anno", confidence: 100 }, price_type: "fixed", price_structure: "F0/F1/F2/F3", index: null, multiplier: null, spread: null, formula: null, periodicity: null, committed_power_kw: null, available_power_kw: null, pricing_page: 2, pricing_evidence: "Prezzi F0 F1 F2 F3", confidence: 100 };
  const n = normalizePureAiOutput({ document: { kind: "offer_sheet", commodity: "electricity", customer_type: "unknown", page_count: 2 }, supplies: [supply], additional_data: [] });
  assert.equal(n.prezzo_luce_f0_eur_kwh, .099);
  assert.equal(n.prezzo_luce_f1_eur_kwh, .109);
  assert.equal(n.prezzo_luce_f2_eur_kwh, .105);
  assert.equal(n.prezzo_luce_f3_eur_kwh, .101);
  assert.equal(n.prezzo_luce_eur_kwh, undefined);
});
