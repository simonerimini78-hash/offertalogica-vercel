import test from "node:test";
import assert from "node:assert/strict";
import { normalizePureAiOutput } from "../lib/pdfPureAiReader.js";

function fixedFee({ value, valueText, unit = "€/mese", period = "month", page, label, evidence }) {
  return {
    value,
    value_text: valueText,
    unit,
    period,
    page,
    label,
    evidence,
    confidence: 100,
    section_total_value: null,
    section_total_value_text: null,
    section_total_unit: null,
    section_total_period: "none",
    section_total_page: null,
    section_total_label: null,
    section_total_evidence: null,
    section_total_confidence: 0,
  };
}

function supply({ commodity, annualConsumption, price, fixed }) {
  return {
    commodity,
    identity: {
      provider: "Venditore Esempio",
      offer_name: commodity === "electricity" ? "Offerta Luce" : "Offerta Gas",
      offer_code: null,
      page: 1,
      evidence: "Venditore Esempio",
      confidence: 100,
    },
    annual_consumption: annualConsumption,
    price,
    fixed_fee: fixed,
  };
}

test("semantica generale: non scarta il prezzo commerciale solo perché il riquadro contiene un mese di riferimento", () => {
  const output = {
    document: { kind: "bill", commodity: "electricity", customer_type: "consumer", page_count: 8 },
    supplies: [supply({
      commodity: "electricity",
      annualConsumption: {
        total: 2196, f1: null, f2: null, f3: null, f23: null,
        unit: "kWh", page: 7, label: "Consumo annuo",
        evidence: "Consumo annuo dal 01/05/2025 al 30/04/2026 2.196 kWh", confidence: 100,
      },
      price: {
        type: "fixed", single: 0.149077, f0: null, f1: null, f2: null, f3: null, f23: null,
        index: null, multiplier: null, spread: null,
        formula: "Corrispettivo Energia * 1,1 - Sconto + Dispacciamento", periodicity: null,
        unit: "€/kWh", page: 5, label: "di cui spesa per la vendita di energia elettrica",
        evidence: "di cui spesa per la vendita di energia elettrica 0,149077 €/kWh; Formula prevista: Corrispettivo Energia * 1,1 - Sconto + Dispacciamento; Mese di riferimento Aprile 2026",
        confidence: 100,
      },
      fixed: fixedFee({
        value: 10, valueText: "10,00 €/mese", page: 5,
        label: "Quota fissa vendita", evidence: "Quota fissa vendita 10,00 €/mese",
      }),
    })],
    additional_data: [],
  };

  const normalized = normalizePureAiOutput(output);
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.149077);
  assert.equal(normalized.tipo_prezzo_luce, "fisso");
  assert.equal(normalized.formula_prezzo_luce, "Corrispettivo Energia * 1,1 - Sconto + Dispacciamento");
});

test("semantica generale: riconosce come annuale la dicitura 'in un anno' con intervallo completo", () => {
  const output = {
    document: { kind: "bill", commodity: "gas", customer_type: "consumer", page_count: 6 },
    supplies: [supply({
      commodity: "gas",
      annualConsumption: {
        total: 1363, f1: null, f2: null, f3: null, f23: null,
        unit: "Smc", page: 1, label: "In un anno hai consumato",
        evidence: "In un anno hai consumato 1.363 Smc (dal 01/05/2025 al 30/04/2026)", confidence: 100,
      },
      price: {
        type: "fixed", single: 0.410829, f0: null, f1: null, f2: null, f3: null, f23: null,
        index: null, multiplier: null, spread: null, formula: "Corrispettivo Gas - Sconto", periodicity: null,
        unit: "€/Smc", page: 2, label: "Spesa per la vendita di gas naturale",
        evidence: "Spesa per la vendita di gas naturale 0,410829 €/Smc; Formula prevista: Corrispettivo Gas - Sconto", confidence: 100,
      },
      fixed: fixedFee({
        value: 12, valueText: "12,00 €/mese", page: 2,
        label: "Quota fissa vendita gas", evidence: "Quota fissa vendita gas 12,00 €/mese",
      }),
    })],
    additional_data: [],
  };

  const normalized = normalizePureAiOutput(output);
  assert.equal(normalized.consumo_gas_smc, 1363);
});

test("coerenza numerica generale: usa il valore letterale più vicino presente nell'evidenza della quota fissa", () => {
  const output = {
    document: { kind: "bill", commodity: "electricity", customer_type: "consumer", page_count: 8 },
    supplies: [supply({
      commodity: "electricity",
      annualConsumption: {
        total: 2196, f1: null, f2: null, f3: null, f23: null,
        unit: "kWh", page: 7, label: "Consumo annuo",
        evidence: "Consumo annuo 2.196 kWh negli ultimi 12 mesi", confidence: 100,
      },
      price: {
        type: "fixed", single: 0.15, f0: null, f1: null, f2: null, f3: null, f23: null,
        index: null, multiplier: null, spread: null, formula: null, periodicity: null,
        unit: "€/kWh", page: 5, label: "Spesa per la vendita di energia elettrica",
        evidence: "Spesa per la vendita di energia elettrica 0,15 €/kWh", confidence: 100,
      },
      fixed: fixedFee({
        value: 12, valueText: "12,000000 €/mese", page: 5,
        label: "di cui spesa per la vendita di energia elettrica",
        evidence: "di cui spesa per la vendita di energia elettrica 12,105000 24,21 € €/mese",
      }),
    })],
    additional_data: [],
  };

  const normalized = normalizePureAiOutput(output);
  assert.equal(normalized.quota_fissa_dettaglio_luce.commercial_component.value, 12.105);
  assert.equal(normalized.quota_fissa_dettaglio_luce.commercial_component.value_text, "12,105000 €/mese");
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, 145.26);
});
