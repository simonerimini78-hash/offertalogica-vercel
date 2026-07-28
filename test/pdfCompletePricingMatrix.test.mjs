import test from "node:test";
import assert from "node:assert/strict";
import { normalizePureAiOutput } from "../lib/pdfPureAiReader.js";

const nil = () => ({ value: null, value_text: null, unit: null, period: "none", page: null, label: null, evidence: null, confidence: 0 });
function lightWithBands() {
  return {
    commodity: "electricity", provider: "Acea", offer_name: "Offerta fasce", offer_code: "00000000000000000001",
    annual_consumption: nil(),
    annual_band_consumptions: [
      { band: "F1", value: 1000, unit: "kWh/anno", page: 2, label: "Consumo annuo F1", evidence: "Consumo annuo F1 1.000 kWh", confidence: 100 },
      { band: "F2", value: 600, unit: "kWh/anno", page: 2, label: "Consumo annuo F2", evidence: "Consumo annuo F2 600 kWh", confidence: 100 },
      { band: "F3", value: 400, unit: "kWh/anno", page: 2, label: "Consumo annuo F3", evidence: "Consumo annuo F3 400 kWh", confidence: 100 },
    ],
    primary_price: nil(),
    price_items: [["F1", .11], ["F2", .12], ["F3", .13]].map(([band,value]) => ({ label: `Prezzo ${band}`, value, value_text: String(value), unit: "€/kWh", period: "none", band, page: 3, evidence: `Prezzo ${band} ${value} €/kWh`, confidence: 100 })),
    fixed_fee: { value: 9, value_text: "9", unit: "€/mese", period: "month", page: 3, label: "Quota fissa", evidence: "Quota fissa vendita 9 €/mese", confidence: 100 },
    price_type: "fixed", price_structure: "F1/F2/F3", index: null, multiplier: null, spread: null, formula: null, periodicity: null,
    committed_power_kw: 3, available_power_kw: 3.3, pricing_page: 3, pricing_evidence: "Prezzi F1 F2 F3", confidence: 100,
  };
}

test("consumi annui per fasce: deriva soltanto il totale matematico", () => {
  const n = normalizePureAiOutput({ document: { kind: "bill", commodity: "electricity", customer_type: "consumer", page_count: 4 }, supplies: [lightWithBands()], additional_data: [] });
  assert.equal(n.consumo_luce_kwh, 2000);
  assert.equal(n.prezzo_luce_eur_kwh, undefined);
  assert.equal(n.readiness.confronto.luce.pricing_mode, "f1_f2_f3");
});

test("scheda dual mantiene strutture luce e gas indipendenti", () => {
  const gas = {
    commodity: "gas", provider: "Acea", offer_name: "Gas Flex", offer_code: "00000000000000000002",
    annual_consumption: nil(), annual_band_consumptions: [], primary_price: nil(), price_items: [],
    fixed_fee: { value: 120, value_text: "120", unit: "€/anno", period: "year", page: 2, label: "Quota fissa", evidence: "Quota fissa 120 €/anno", confidence: 100 },
    price_type: "variable", price_structure: "indice + spread", index: "PSV", multiplier: 1, spread: 0.08,
    formula: "PSV + 0,08 €/Smc", periodicity: "mensile", committed_power_kw: null, available_power_kw: null,
    pricing_page: 2, pricing_evidence: "PSV + 0,08 €/Smc", confidence: 100,
  };
  const n = normalizePureAiOutput({ document: { kind: "offer_sheet", commodity: "dual", customer_type: "unknown", page_count: 4 }, supplies: [lightWithBands(), gas], additional_data: [] });
  assert.equal(n.tipo_prezzo_luce, "fisso");
  assert.equal(n.tipo_prezzo_gas, "variabile");
  assert.equal(n.indice_riferimento_gas, "PSV");
  assert.equal(n.adaptive_form.supplies.length, 2);
});
