import test from "node:test";
import assert from "node:assert/strict";
import { normalizePureAiOutput } from "../lib/pdfPureAiReader.js";

function identity({ provider = null, offerName = null, offerCode = null, page = 1, evidence = null, confidence = 100 } = {}) {
  return {
    provider,
    offer_name: offerName,
    offer_code: offerCode,
    page,
    evidence: evidence || [provider, offerName].filter(Boolean).join(" - ") || null,
    confidence,
  };
}

function annualConsumption({ total = null, f1 = null, f2 = null, f3 = null, f23 = null, unit, page, label = "Consumo annuo", evidence, confidence = 100 }) {
  return { total, f1, f2, f3, f23, unit, page, label, evidence, confidence };
}

function price({
  type = "unknown", single = null, f0 = null, f1 = null, f2 = null, f3 = null, f23 = null,
  index = null, multiplier = null, spread = null, formula = null, periodicity = null,
  unit, page, label = "Condizioni economiche", evidence, confidence = 100,
}) {
  return {
    type, single, f0, f1, f2, f3, f23, index, multiplier, spread, formula, periodicity,
    unit, page, label, evidence, confidence,
  };
}

function fixedFee({
  value = null, valueText = null, unit = null, period = "none", page = null,
  label = null, evidence = null, confidence = 0,
  sectionTotalValue = null, sectionTotalValueText = null, sectionTotalUnit = null,
  sectionTotalPeriod = "none", sectionTotalPage = null, sectionTotalLabel = null,
  sectionTotalEvidence = null, sectionTotalConfidence = 0,
} = {}) {
  return {
    value,
    value_text: valueText,
    unit,
    period,
    page,
    label,
    evidence,
    confidence,
    section_total_value: sectionTotalValue,
    section_total_value_text: sectionTotalValueText,
    section_total_unit: sectionTotalUnit,
    section_total_period: sectionTotalPeriod,
    section_total_page: sectionTotalPage,
    section_total_label: sectionTotalLabel,
    section_total_evidence: sectionTotalEvidence,
    section_total_confidence: sectionTotalConfidence,
  };
}

function compactDocument({ kind, commodity, supplies, additionalData = [] }) {
  return {
    document: { kind, commodity, customer_type: "consumer", page_count: 14 },
    supplies,
    additional_data: additionalData,
  };
}

test("bolletta dual Plenitude: estrae 6/6 dati economici e conserva le formule", () => {
  const output = compactDocument({
    kind: "bill",
    commodity: "dual",
    supplies: [
      {
        commodity: "electricity",
        identity: identity({ provider: "Eni Plenitude", offerName: "Fixa Time Luce Base", page: 5 }),
        annual_consumption: annualConsumption({
          total: 2196, unit: "kWh", page: 7,
          evidence: "Consumo annuo dal 01/05/2025 al 30/04/2026 2.196 kWh",
        }),
        price: price({
          type: "fixed", single: 0.149077, unit: "€/kWh", page: 5,
          formula: "Corrispettivo Energia * 1,1 (perdite) - Sconto Domiciliazione * 1,1 (perdite) + Dispacciamento",
          evidence: "di cui spesa per la vendita di energia elettrica 0,149077 €/kWh; Formula prevista: Corrispettivo Energia * 1,1 (perdite) - Sconto Domiciliazione * 1,1 (perdite) + Dispacciamento",
        }),
        fixed_fee: fixedFee({
          value: 12.105, valueText: "12,105 €/mese", unit: "€/mese", period: "month", page: 5,
          label: "di cui spesa per la vendita di energia elettrica",
          evidence: "Quota fissa - di cui spesa per la vendita di energia elettrica 12,105 €/mese",
          confidence: 100,
          sectionTotalValue: 14.025, sectionTotalValueText: "14,025 €/mese", sectionTotalUnit: "€/mese",
          sectionTotalPeriod: "month", sectionTotalPage: 5, sectionTotalLabel: "Quota fissa totale",
          sectionTotalEvidence: "Quota fissa totale 14,025 €/mese", sectionTotalConfidence: 100,
        }),
      },
      {
        commodity: "gas",
        identity: identity({ provider: "Eni Plenitude", offerName: "Fixa Time Gas Base", page: 2 }),
        annual_consumption: annualConsumption({
          total: 1363, unit: "Smc", page: 4,
          evidence: "Consumo annuo dal 01/05/2025 al 30/04/2026 1.363 Smc",
        }),
        price: price({
          type: "fixed", single: 0.410829, unit: "€/Smc", page: 2,
          formula: "Corrispettivo Gas - Sconto Domiciliazione",
          evidence: "di cui spesa per la vendita di gas naturale 0,410829 €/Smc; Formula prevista: Corrispettivo Gas - Sconto Domiciliazione",
        }),
        fixed_fee: fixedFee({
          value: 12, valueText: "12,00 €/mese", unit: "€/mese", period: "month", page: 2,
          label: "di cui spesa per la vendita di gas naturale",
          evidence: "Quota fissa - di cui spesa per la vendita di gas naturale 12,00 €/mese",
          confidence: 100,
          sectionTotalValue: 16.25, sectionTotalValueText: "16,25 €/mese", sectionTotalUnit: "€/mese",
          sectionTotalPeriod: "month", sectionTotalPage: 2, sectionTotalLabel: "Quota fissa totale",
          sectionTotalEvidence: "Quota fissa totale 16,25 €/mese", sectionTotalConfidence: 100,
        }),
      },
    ],
  });

  const normalized = normalizePureAiOutput(output);
  assert.equal(normalized.consumo_luce_kwh, 2196);
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.149077);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, 145.26);
  assert.equal(normalized.consumo_gas_smc, 1363);
  assert.equal(normalized.prezzo_gas_eur_smc, 0.410829);
  assert.equal(normalized.quota_fissa_vendita_gas_eur_anno, 144);
  assert.match(normalized.formula_prezzo_luce, /Corrispettivo Energia/);
  assert.match(normalized.formula_prezzo_gas, /Corrispettivo Gas/);
  assert.equal(normalized.quota_fissa_dettaglio_luce.selected_for_comparison, "commercial_component");
  assert.equal(normalized.quota_fissa_dettaglio_gas.selected_for_comparison, "commercial_component");
  assert.equal(normalized.readiness.confronto.luce.status, "completo");
  assert.equal(normalized.readiness.confronto.gas.status, "completo");
});

test("bolletta Hera: conserva -6,10 €/mese e usa separatamente il totale netto 3,22 €/mese", () => {
  const output = compactDocument({
    kind: "bill",
    commodity: "electricity",
    supplies: [{
      commodity: "electricity",
      identity: identity({ provider: "HERA COMM S.p.A.", offerName: "Servizio Tutele Graduali D", page: 6 }),
      annual_consumption: annualConsumption({
        total: 1628.91, unit: "kWh", page: 7,
        evidence: "Consumo annuo aggiornato dal 01.06.2025 al 31.05.2026 1.628,91 kWh",
      }),
      price: price({
        type: "variable", single: 0.152429, f1: 0.117891, f2: 0.144582, f3: 0.132897,
        index: "PUN Index GME", periodicity: "Mensile", unit: "€/kWh", page: 6,
        formula: "Corrispettivo CELD per fascia + Dispacciamento + Sbilanciamento + Componente di perequazione",
        evidence: "di cui spesa per la vendita di energia elettrica 0,152429 €/kWh; Indice di riferimento PUN Index GME; periodicità Mensile",
      }),
      fixed_fee: fixedFee({
        value: -6.1, valueText: "-6,100000 €/mese", unit: "€/mese", period: "month", page: 6,
        label: "di cui spesa per la vendita di energia elettrica",
        evidence: "di cui spesa per la vendita di energia elettrica -12,20 € -6,100000 €/mese",
        confidence: 100,
        sectionTotalValue: 3.22, sectionTotalValueText: "3,22 €/mese", sectionTotalUnit: "€/mese",
        sectionTotalPeriod: "month", sectionTotalPage: 6, sectionTotalLabel: "Quota fissa",
        sectionTotalEvidence: "QUOTA FISSA 2 mesi 6,44 € 3,22 €/mese", sectionTotalConfidence: 100,
      }),
    }],
  });

  const normalized = normalizePureAiOutput(output);
  assert.equal(normalized.consumo_luce_kwh, 1628.91);
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.152429);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, 38.64);
  assert.equal(normalized.quota_fissa_dettaglio_luce.commercial_component.value, -6.1);
  assert.equal(normalized.quota_fissa_dettaglio_luce.section_total.value, 3.22);
  assert.equal(normalized.quota_fissa_dettaglio_luce.selected_for_comparison, "section_total");
  assert.equal(normalized.data_contract.fields.quota_fissa_vendita_luce_eur_anno.derivation.original_value, 3.22);
  assert.equal(normalized.readiness.confronto.luce.status, "completo");
});

test("quota commerciale negativa senza totale netto: resta leggibile ma non altera il confronto", () => {
  const output = compactDocument({
    kind: "bill",
    commodity: "electricity",
    supplies: [{
      commodity: "electricity",
      identity: identity({ provider: "Fornitore Test", page: 1 }),
      annual_consumption: annualConsumption({ total: 1200, unit: "kWh", page: 2, evidence: "Consumo annuo ultimi 12 mesi 1.200 kWh" }),
      price: price({ type: "fixed", single: 0.12, unit: "€/kWh", page: 2, evidence: "Spesa per la vendita di energia elettrica 0,12 €/kWh" }),
      fixed_fee: fixedFee({
        value: -5, valueText: "-5,00 €/mese", unit: "€/mese", period: "month", page: 2,
        label: "Quota fissa vendita", evidence: "Quota fissa vendita -5,00 €/mese", confidence: 100,
      }),
    }],
  });

  const normalized = normalizePureAiOutput(output);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, undefined);
  assert.equal(normalized.quota_fissa_dettaglio_luce.commercial_component.value, -5);
  assert.equal(normalized.quota_fissa_dettaglio_luce.selected_for_comparison, null);
  assert.equal(normalized.readiness.confronto.luce.status, "incompleto");
});

test("scheda sintetica ufficiale Plenitude Trend Business Luce: conserva formula PUN e costo fisso annuo", () => {
  const output = compactDocument({
    kind: "offer_sheet",
    commodity: "electricity",
    supplies: [{
      commodity: "electricity",
      identity: identity({
        provider: "Eni Plenitude S.p.A. Società Benefit",
        offerName: "Trend Business Luce",
        offerCode: "026160ESVFL44XX000TNDVLBAS130726",
        page: 1,
        evidence: "TREND BUSINESS LUCE - OFFERTA A PREZZO VARIABILE - Codice offerta 026160ESVFL44XX000TNDVLBAS130726",
      }),
      annual_consumption: annualConsumption({ total: null, unit: "kWh", page: 2, evidence: null, confidence: 0 }),
      price: price({
        type: "variable", index: "PUN", multiplier: 1.1, spread: 0.036851,
        formula: "PUN * 1,1 + 0,036851 €/kWh", periodicity: "Mensile", unit: "€/kWh", page: 2,
        evidence: "Prezzo Variabile; Indice PUN; periodicità indice Mensile; Costo per consumi - totale PUN*1,1+0,036851 €/kWh, somma dei corrispettivi della vendita di energia elettrica",
      }),
      fixed_fee: fixedFee({
        value: 192, valueText: "192 €/anno/punto di fornitura", unit: "€/anno/POD", period: "year", page: 2,
        label: "Costo fisso annuo",
        evidence: "Costo fisso annuo 192 €/anno/punto di fornitura, somma dei corrispettivi in quota fissa della Spesa per la vendita di energia elettrica",
        confidence: 100,
      }),
    }],
  });

  const normalized = normalizePureAiOutput(output);
  assert.equal(normalized.tipo_prezzo_luce, "variabile");
  assert.equal(normalized.indice_riferimento_luce, "PUN");
  assert.equal(normalized.moltiplicatore_indice_luce, 1.1);
  assert.equal(normalized.spread_luce_eur_kwh, 0.036851);
  assert.equal(normalized.formula_prezzo_luce, "PUN * 1,1 + 0,036851 €/kWh");
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, 192);
  assert.equal(normalized.kind, "scheda_offerta");
});

test("scheda sintetica ufficiale Plenitude Trend Business Gas: conserva formula PSV e costo fisso annuo", () => {
  const output = compactDocument({
    kind: "offer_sheet",
    commodity: "gas",
    supplies: [{
      commodity: "gas",
      identity: identity({
        provider: "Eni Plenitude S.p.A. Società Benefit",
        offerName: "Trend Business Gas",
        offerCode: "026160GSVML41XX0000TNDGBAS160426",
        page: 1,
        evidence: "TREND BUSINESS GAS - OFFERTA A PREZZO VARIABILE - Codice offerta 026160GSVML41XX0000TNDGBAS160426",
      }),
      annual_consumption: annualConsumption({ total: null, unit: "Smc", page: 2, evidence: null, confidence: 0 }),
      price: price({
        type: "variable", index: "PSV", multiplier: null, spread: 0.115,
        formula: "PSV + 0,115 €/Smc", periodicity: "Mensile", unit: "€/Smc", page: 2,
        evidence: "Prezzo Variabile; Indice PSV; periodicità Mensile; Costo per consumi - totale PSV + 0,115 €/Smc, somma dei corrispettivi della vendita di gas naturale",
      }),
      fixed_fee: fixedFee({
        value: 192, valueText: "192 €/anno/punto di fornitura", unit: "€/anno/PDR", period: "year", page: 2,
        label: "Costo fisso annuo",
        evidence: "Costo fisso annuo 192 €/anno/punto di fornitura, somma dei corrispettivi in quota fissa della Spesa per la vendita di gas naturale",
        confidence: 100,
      }),
    }],
  });

  const normalized = normalizePureAiOutput(output);
  assert.equal(normalized.tipo_prezzo_gas, "variabile");
  assert.equal(normalized.indice_riferimento_gas, "PSV");
  assert.equal(normalized.spread_gas_eur_smc, 0.115);
  assert.equal(normalized.formula_prezzo_gas, "PSV + 0,115 €/Smc");
  assert.equal(normalized.quota_fissa_vendita_gas_eur_anno, 192);
  assert.equal(normalized.kind, "scheda_offerta");
});
