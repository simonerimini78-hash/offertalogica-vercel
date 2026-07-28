import test from "node:test";
import assert from "node:assert/strict";
import { normalizePureAiOutput } from "../lib/pdfPureAiReader.js";

function emptySupply() {
  return {
    identity: { provider: null, offer_name: null, page: null, evidence: null, confidence: 0 },
    annual_consumption: { total: null, f1: null, f2: null, f3: null, f23: null, unit: null, page: null, label: null, evidence: null, confidence: 0 },
    price: { type: "unknown", single: null, f0: null, f1: null, f2: null, f3: null, f23: null, index: null, multiplier: null, spread: null, formula: null, periodicity: null, unit: null, page: null, label: null, evidence: null, confidence: 0 },
    fixed_fee: { value: null, period: "none", unit: null, page: null, label: null, evidence: null, confidence: 0 },
  };
}

test("schema compatto reale Acea: conserva prezzo, fasce e quota fissa", () => {
  const electricity = emptySupply();
  electricity.identity = {
    provider: "Acea Energia", offer_name: "Acea Energia Fix", page: 1,
    evidence: "SCHEDA SINTETICA Acea Energia Fix - Venditore Acea Energia", confidence: 100,
  };
  electricity.price = {
    type: "fixed", single: 0.099, f0: 0.099, f1: 0.1006, f2: 0.1112, f3: 0.0879, f23: null,
    index: null, multiplier: null, spread: null, formula: null, periodicity: null, unit: "€/kWh", page: 2,
    label: "Corrispettivo per il consumo",
    evidence: "CONDIZIONI ECONOMICHE - Prezzo fisso per 12 mesi - Corrispettivo per il consumo F0 0,099000 €/kWh; F1 0,100600 €/kWh; F2 0,111200 €/kWh; F3 0,087900 €/kWh",
    confidence: 100,
  };
  electricity.fixed_fee = {
    value: 111, period: "year", unit: "€/anno", page: 2, label: "Corrispettivo annuo",
    evidence: "CONDIZIONI ECONOMICHE - CORRISPETTIVI DEFINITI DAL VENDITORE - Corrispettivo annuo 111,00 €/anno", confidence: 100,
  };
  const normalized = normalizePureAiOutput({
    document: { kind: "offer_sheet", commodity: "electricity", customer_type: "consumer", page_count: 9 },
    electricity,
    gas: emptySupply(),
  });
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.099);
  assert.equal(normalized.prezzo_luce_f0_eur_kwh, 0.099);
  assert.equal(normalized.prezzo_luce_f1_eur_kwh, 0.1006);
  assert.equal(normalized.prezzo_luce_f2_eur_kwh, 0.1112);
  assert.equal(normalized.prezzo_luce_f3_eur_kwh, 0.0879);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, 111);
  assert.equal(normalized.nome_offerta_luce, "Acea Energia Fix");
  assert.equal(normalized.readiness.confronto.luce.status, "completo");
});

test("schema compatto reale E.ON: conserva indice, moltiplicatore, spread e formula", () => {
  const electricity = emptySupply();
  electricity.identity = {
    provider: "E.ON Energia S.p.A.", offer_name: "E.ON LuceDinamica Click ECO", page: 1,
    evidence: "SCHEDA SINTETICA E.ON LuceDinamica Click ECO - Venditore E.ON Energia S.p.A.", confidence: 100,
  };
  electricity.price = {
    type: "variable", single: null, f0: null, f1: null, f2: null, f3: null, f23: null,
    index: "PUN Index GME", multiplier: 1.1, spread: 0.0278,
    formula: "PUN Index GME*1,1+0,0278 €/kWh", periodicity: "mensile", unit: "€/kWh", page: 1,
    label: "Prezzo materia prima energia",
    evidence: "CONDIZIONI ECONOMICHE - Prezzo variabile - Indice PUN Index GME - Periodicità indice Mensile - Totale PUN Index GME*1,1+0,0278 €/kWh",
    confidence: 100,
  };
  electricity.fixed_fee = {
    value: 192.71, period: "year", unit: "€/anno", page: 1, label: "Costo fisso anno",
    evidence: "CONDIZIONI ECONOMICHE - Costo fisso anno 192,71 €/anno", confidence: 100,
  };
  const normalized = normalizePureAiOutput({
    document: { kind: "offer_sheet", commodity: "electricity", customer_type: "business", page_count: 7 },
    electricity,
    gas: emptySupply(),
  });
  assert.equal(normalized.tipo_prezzo_luce, "variabile");
  assert.equal(normalized.indice_riferimento_luce, "PUN Index GME");
  assert.equal(normalized.moltiplicatore_indice_luce, 1.1);
  assert.equal(normalized.spread_luce_eur_kwh, 0.0278);
  assert.equal(normalized.formula_prezzo_luce, "PUN Index GME*1,1+0,0278 €/kWh");
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, 192.71);
  assert.equal(normalized.prezzo_luce_eur_kwh, undefined);
  assert.equal(normalized.prezzo_luce_f0_eur_kwh, undefined);
  assert.equal(normalized.readiness.confronto.luce.pricing_mode, "variable_formula");
  assert.equal(normalized.readiness.confronto.luce.status, "completo");
});

test("schema compatto Free conserva il prezzo unitario della materia ma rifiuta consumo breve e quota senza periodo", () => {
  const electricity = emptySupply();
  electricity.identity = { provider: "Free Luce&Gas", offer_name: null, page: 1, evidence: "Free Luce&Gas", confidence: 100 };
  electricity.annual_consumption = {
    total: 1479.56, f1: null, f2: null, f3: null, f23: null, unit: "kWh", page: 2,
    label: "Consumo da inizio fornitura", evidence: "CONSUMO DA INIZIO FORNITURA luglio + agosto 1479,56 kWh", confidence: 100,
  };
  electricity.price = {
    type: "fixed", single: 0.055492, f0: null, f1: null, f2: null, f3: null, f23: null,
    index: null, multiplier: null, spread: null, formula: null, periodicity: null, unit: "€/kWh", page: 2,
    label: "Costo unitario della materia Energia", evidence: "Costo unitario della materia Energia 0,055492 €/kWh", confidence: 100,
  };
  electricity.fixed_fee = {
    value: 10.154033, period: "none", unit: "€", page: 5, label: "Corr. Commercializzazione e Vendita",
    evidence: "Corr. Commercializzazione e Vendita 10,154033 1,00 10,15", confidence: 100,
  };
  const normalized = normalizePureAiOutput({
    document: { kind: "bill", commodity: "electricity", customer_type: "consumer", page_count: 7 },
    electricity,
    gas: emptySupply(),
  });
  assert.equal(normalized.consumo_luce_kwh, undefined);
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.055492);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, undefined);
  assert.equal(normalized.ai.rejected_questions.some((item) => item.question_id === "consumo_luce_kwh"), true);
  assert.equal(normalized.ai.rejected_questions.some((item) => item.question_id === "prezzo_luce_eur_kwh"), false);
});

test("regressione reale E.ON: i null non diventano prezzi zero e la formula resta variabile", () => {
  const electricity = emptySupply();
  electricity.identity = {
    provider: "E.ON Energia S.p.A.", offer_name: "E.ON LuceDinamica Click ECO", page: 1,
    evidence: "E.ON LuceDinamica Click ECO - Venditore E.ON Energia S.p.A.", confidence: 100,
  };
  electricity.price = {
    type: "variable", single: null, f0: null, f1: null, f2: null, f3: null, f23: null,
    index: "PUN Index GME", multiplier: 1.1, spread: 0.0278,
    formula: "PUN Index GME*1,1+0,0278 €/kWh", periodicity: "month", unit: "€/kWh", page: 1,
    label: "Prezzo materia prima energia", evidence: "Totale PUN Index GME*1,1+0,0278 €/kWh", confidence: 100,
  };
  electricity.fixed_fee = {
    value: 192.71, period: "year", unit: "€/anno", page: 1,
    label: "Costo fisso anno", evidence: "Costo fisso anno 192,71 €/anno", confidence: 100,
  };
  const normalized = normalizePureAiOutput({
    document: { kind: "offer_sheet", commodity: "electricity", customer_type: "business", page_count: 7 },
    electricity,
    gas: emptySupply(),
  });
  assert.equal(normalized.prezzo_luce_eur_kwh, undefined);
  assert.equal(normalized.prezzo_luce_f0_eur_kwh, undefined);
  assert.equal(normalized.prezzo_luce_f1_eur_kwh, undefined);
  assert.equal(normalized.prezzo_luce_f2_eur_kwh, undefined);
  assert.equal(normalized.prezzo_luce_f3_eur_kwh, undefined);
  assert.equal(normalized.prezzo_luce_f23_eur_kwh, undefined);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, 192.71);
  assert.equal(normalized.readiness.confronto.luce.pricing_mode, "variable_formula");
  assert.equal(normalized.readiness.confronto.luce.status, "completo");
});

test("regressione reale HERA: una bolletta con consumo annuo non viene riclassificata come scheda", () => {
  const electricity = emptySupply();
  electricity.identity = {
    provider: "HERA COMM S.p.A.", offer_name: "Servizio Tutele Graduali D - Area Centro 1 Domestici", page: 5,
    evidence: "Offerta commerciale in vigore: Servizio Tutele Graduali D - Area Centro 1 Domestici", confidence: 100,
  };
  electricity.annual_consumption = {
    total: 1628.91, f1: null, f2: null, f3: null, f23: null, unit: "kWh", page: 7,
    label: "Totale consumo annuo", evidence: "Totale consumo annuo dal 01.06.2025 al 31.05.2026: 1.628,91 kWh", confidence: 100,
  };
  electricity.price = {
    type: "variable", single: null, f0: null, f1: null, f2: null, f3: null, f23: null,
    index: "PUN Index GME", multiplier: null, spread: null,
    formula: "Corrispettivo CELD fascia F1 +0,122252/+0,117891; CELD F2 +0,152087/+0,144582; Dispacciamento +0,015531",
    periodicity: "Mensile", unit: "€/kWh", page: 6, label: "Box dell'offerta",
    evidence: "Indice PUN Index GME. Tipologia a prezzo variabile. Formula con componenti CELD per fascia.", confidence: 100,
  };
  const normalized = normalizePureAiOutput({
    document: { kind: "bill", commodity: "electricity", customer_type: "consumer", page_count: 12 },
    electricity,
    gas: emptySupply(),
  });
  assert.equal(normalized.kind, "bolletta");
  assert.equal(normalized.consumo_luce_kwh, 1628.91);
  assert.equal(normalized.prezzo_luce_eur_kwh, undefined);
  assert.equal(normalized.prezzo_luce_f0_eur_kwh, undefined);
  assert.equal(normalized.readiness.confronto.luce.pricing_mode, null);
  assert.equal(normalized.readiness.confronto.luce.missing.includes("prezzo_luce_eur_kwh"), true);
  assert.equal(normalized.readiness.dati_bolletta.luce.status, "parziale");
});
