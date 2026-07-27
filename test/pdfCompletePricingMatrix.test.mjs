import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  PDF_PURE_AI_QUESTION_IDS,
  normalizePureAiOutput,
} from "../lib/pdfPureAiReader.js";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

function emptyAnswers() {
  return PDF_PURE_AI_QUESTION_IDS.map((question_id) => ({
    question_id,
    found: false,
    value_text: null,
    value_number: null,
    unit: null,
    period: "none",
    page: null,
    label: null,
    evidence: null,
    confidence: 0,
  }));
}

function setAnswer(answers, questionId, patch) {
  const answer = answers.find((item) => item.question_id === questionId);
  assert.ok(answer, `Domanda ${questionId} non trovata`);
  Object.assign(answer, {
    found: true,
    value_text: null,
    value_number: null,
    unit: null,
    period: "none",
    page: 1,
    label: null,
    evidence: "evidenza",
    confidence: 100,
    ...patch,
  });
}

function output({ kind = "offer_sheet", commodity = "electricity", customerType = "consumer", answers }) {
  return {
    document: { kind, commodity, customer_type: customerType, page_count: 5 },
    answers,
  };
}

function rejectedReason(normalized, questionId) {
  return normalized.ai.rejected_questions.find((item) => item.question_id === questionId)?.reason || null;
}

function loadCalculationHelpers() {
  const start = html.indexOf("function numeroSicuro(");
  const end = html.indexOf("function calcolaOfferta(", start);
  assert.ok(start > 0 && end > start);
  const context = {
    INDICI_MERCATO: {
      pun: { valore: 0.1 },
      psv: { valore: 0.5 },
      psbg: { valore: 0.52 },
    },
    PERDITE_RETE_LUCE_VARIABILE: 1.1,
  };
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}\nthis.helpers = { calcolaVoceEnergia, calcolaMateriaPerFasce, risolviPrezzoVariabile };`, context);
  return context.helpers;
}

test("bolletta con consumi annui F1/F2/F3: deriva soltanto somme matematiche certe", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "fornitore", { value_text: "Dolomiti Energia Mercato SpA", evidence: "Dolomiti Energia Mercato SpA" });
  setAnswer(answers, "pod", { value_text: "IT001E12345678", evidence: "POD IT001E12345678" });
  for (const [id, band, value] of [
    ["consumo_luce_f1_kwh", "F1", 4334],
    ["consumo_luce_f2_kwh", "F2", 3457],
    ["consumo_luce_f3_kwh", "F3", 4890],
  ]) {
    setAnswer(answers, id, {
      value_text: String(value), value_number: value, unit: "kWh", label: band,
      evidence: `INFORMAZIONI STORICHE - CONSUMO ANNUO kWh ${band} ${value} - FINO AL 31/03/2026`,
    });
  }
  const normalized = normalizePureAiOutput(output({ kind: "bill", answers }));
  assert.equal(normalized.consumo_luce_f23_kwh, 8347);
  assert.equal(normalized.consumo_luce_kwh, 12681);
  assert.equal(normalized.data_contract.supplies.luce.annual_consumption_bands.f1, 4334);
  assert.equal(normalized.data_contract.supplies.luce.annual_consumption_bands.f23, 8347);
});

test("scheda variabile: conserva indice per moltiplicatore più spread", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "fornitore_luce", { value_text: "E.ON Energia S.p.A.", evidence: "Venditore E.ON Energia S.p.A." });
  setAnswer(answers, "nome_offerta_luce", { value_text: "E.ON LuceDinamica Click ECO", evidence: "SCHEDA SINTETICA E.ON LuceDinamica Click ECO" });
  setAnswer(answers, "tipo_prezzo_luce", { value_text: "variabile", evidence: "CONDIZIONI ECONOMICHE Prezzo variabile" });
  setAnswer(answers, "indice_riferimento_luce", { value_text: "PUN Index GME", evidence: "CONDIZIONI ECONOMICHE Indice PUN Index GME" });
  setAnswer(answers, "moltiplicatore_indice_luce", {
    value_text: "1,1", value_number: 1.1, label: "Formula",
    evidence: "CONDIZIONI ECONOMICHE Totale PUN Index GME * 1,1 + 0,0278 €/kWh",
  });
  setAnswer(answers, "spread_luce_eur_kwh", {
    value_text: "0,0278 €/kWh", value_number: 0.0278, unit: "€/kWh", label: "Formula",
    evidence: "CONDIZIONI ECONOMICHE Totale PUN Index GME * 1,1 + 0,0278 €/kWh",
  });
  setAnswer(answers, "formula_prezzo_luce", {
    value_text: "PUN Index GME * 1,1 + 0,0278 €/kWh",
    evidence: "CONDIZIONI ECONOMICHE Prezzo variabile Totale PUN Index GME * 1,1 + 0,0278 €/kWh",
  });
  setAnswer(answers, "quota_fissa_vendita_luce", {
    value_text: "192,71 €/anno", value_number: 192.71, unit: "€/anno", period: "year",
    evidence: "CONDIZIONI ECONOMICHE Corrispettivi definiti dal venditore Costo fisso anno 192,71 €/anno",
  });
  const normalized = normalizePureAiOutput(output({ answers }));
  assert.equal(normalized.moltiplicatore_indice_luce, 1.1);
  assert.equal(normalized.spread_luce_eur_kwh, 0.0278);
  assert.equal(normalized.formula_prezzo_luce, "PUN Index GME * 1,1 + 0,0278 €/kWh");
  assert.equal(normalized.readiness.confronto.luce.status, "completo");
  assert.equal(normalized.readiness.confronto.luce.pricing_mode, "variable_formula");
});

test("scheda gas: accetta il riepilogo commerciale corrente e rifiuta il rinnovo futuro", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "fornitore_gas", { value_text: "Axpo Italia SpA", evidence: "Venditore Axpo Italia SpA" });
  setAnswer(answers, "nome_offerta_gas", { value_text: "Scegli Sereno GAS 2.0 Light", evidence: "SCHEDA SINTETICA Scegli Sereno GAS 2.0 Light" });
  setAnswer(answers, "tipo_prezzo_gas", { value_text: "fisso", evidence: "CONDIZIONI ECONOMICHE Prezzo Fisso per 24 mesi" });
  setAnswer(answers, "prezzo_gas_eur_smc", {
    value_text: "0,77154 €/Smc", value_number: 0.77154, unit: "€/Smc", label: "Costo per consumi",
    evidence: "SCHEDA SINTETICA - CONDIZIONI ECONOMICHE - Prezzo Fisso per 24 mesi - Costo per consumi 0,77154 €/Smc",
  });
  setAnswer(answers, "quota_fissa_vendita_gas", {
    value_text: "156 €/anno", value_number: 156, unit: "€/anno", period: "year",
    evidence: "SCHEDA SINTETICA - CONDIZIONI ECONOMICHE - Corrispettivi definiti dal venditore - Costo fisso anno 156 €/anno",
  });
  setAnswer(answers, "spread_gas_eur_smc", {
    value_text: "0,150 €/Smc", value_number: 0.15, unit: "€/Smc",
    evidence: "Dal 25esimo mese Corrispettivo gas PSBIL + Delta su indice 0,150 €/Smc",
  });
  const normalized = normalizePureAiOutput(output({ commodity: "gas", customerType: "business", answers }));
  assert.equal(normalized.prezzo_gas_eur_smc, 0.77154);
  assert.equal(normalized.quota_fissa_vendita_gas_eur_anno, 156);
  assert.equal(normalized.spread_gas_eur_smc, undefined);
  assert.match(rejectedReason(normalized, "spread_gas_eur_smc"), /future|contract_term/);
  assert.equal(normalized.readiness.confronto.gas.status, "completo");
});

test("scheda esclusivamente F1/F23: è leggibile senza inventare F0", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "nome_offerta_luce", { value_text: "Bioraria Vera", evidence: "SCHEDA SINTETICA Bioraria Vera" });
  setAnswer(answers, "tipo_prezzo_luce", { value_text: "fisso", evidence: "CONDIZIONI ECONOMICHE Prezzo fisso" });
  for (const [id, band, value] of [
    ["prezzo_luce_f1_eur_kwh", "F1", 0.1021],
    ["prezzo_luce_f23_eur_kwh", "F23", 0.0972],
  ]) {
    setAnswer(answers, id, {
      value_text: `${value} €/kWh`, value_number: value, unit: "€/kWh", label: band,
      evidence: `CONDIZIONI ECONOMICHE Corrispettivi definiti dal venditore ${band} ${value} €/kWh`,
    });
  }
  setAnswer(answers, "quota_fissa_vendita_luce", {
    value_text: "144 €/anno", value_number: 144, unit: "€/anno", period: "year",
    evidence: "CONDIZIONI ECONOMICHE Corrispettivi definiti dal venditore Commercializzazione e Vendita 144 €/anno",
  });
  const normalized = normalizePureAiOutput(output({ answers }));
  assert.equal(normalized.prezzo_luce_eur_kwh, undefined);
  assert.equal(normalized.prezzo_luce_f1_eur_kwh, 0.1021);
  assert.equal(normalized.prezzo_luce_f23_eur_kwh, 0.0972);
  assert.equal(normalized.readiness.confronto.luce.status, "completo");
  assert.equal(normalized.readiness.confronto.luce.pricing_mode, "f1_f23");
});

test("calcolatore: applica prezzi F1/F23 ai consumi annuali corrispondenti", () => {
  const { calcolaVoceEnergia } = loadCalculationHelpers();
  const result = calcolaVoceEnergia({
    commodity: "luce", consumo: 3000,
    consumiFasce: { f1: 1000, f23: 2000 },
    prezziFasce: { f1: 0.15, f23: 0.10 },
    quotaFissaAnnua: 0, componentiRegolate: {}, tipoTariffa: "fisso",
  });
  assert.equal(result.modalitaPrezzo, "f1_f23");
  assert.equal(result.quotaMateria, 350);
});

test("calcolatore: applica prezzi F1/F2/F3 senza medie inventate", () => {
  const { calcolaVoceEnergia } = loadCalculationHelpers();
  const result = calcolaVoceEnergia({
    commodity: "luce", consumo: 3000,
    consumiFasce: { f1: 1000, f2: 500, f3: 1500 },
    prezziFasce: { f1: 0.15, f2: 0.12, f3: 0.08 },
    quotaFissaAnnua: 0, componentiRegolate: {}, tipoTariffa: "fisso",
  });
  assert.equal(result.modalitaPrezzo, "f1_f2_f3");
  assert.equal(result.quotaMateria, 330);
});

test("calcolatore: il moltiplicatore esplicito evita di applicare due volte le perdite", () => {
  const { calcolaVoceEnergia } = loadCalculationHelpers();
  const result = calcolaVoceEnergia({
    commodity: "luce", consumo: 1000,
    formula: { tipo: "indice_moltiplicatore_spread", indice: "pun", moltiplicatore: 1.1, moltiplicatoreEsplicito: true, spread: 0.02 },
    quotaFissaAnnua: 0, componentiRegolate: {}, tipoTariffa: "variabile",
  });
  assert.equal(result.fattorePerdite, 1);
  assert.equal(result.prezzoVariabile, 0.13);
  assert.equal(result.quotaMateria, 130);
});

test("calcolatore: indice più spread senza moltiplicatore conserva la regola perdite esistente", () => {
  const { calcolaVoceEnergia } = loadCalculationHelpers();
  const result = calcolaVoceEnergia({
    commodity: "luce", consumo: 1000,
    formula: { tipo: "indice_spread", indice: "pun", spread: 0.02 },
    quotaFissaAnnua: 0, componentiRegolate: {}, tipoTariffa: "variabile",
  });
  assert.equal(result.fattorePerdite, 1.1);
  assert.ok(Math.abs(result.quotaMateria - 132) < 1e-9);
});

test("frontend: conserva nel profilo interno fasce e formula estratte dal PDF", () => {
  for (const marker of [
    "pdf-current-consumo-luce-f1",
    "pdf-current-prezzo-luce-f23",
    "pdf-offer-prezzo-luce-f1",
    "pdf-offer-moltiplicatore-luce",
    'row.kind === "pdf_profile"',
  ]) assert.ok(html.includes(marker), `Manca ${marker}`);
});

test("scheda dual: mantiene indipendenti condizioni luce e gas", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "fornitore_luce", { value_text: "Venditore Dual S.p.A.", evidence: "Sezione ENERGIA ELETTRICA - Venditore Dual S.p.A." });
  setAnswer(answers, "fornitore_gas", { value_text: "Venditore Dual S.p.A.", evidence: "Sezione GAS NATURALE - Venditore Dual S.p.A." });
  setAnswer(answers, "nome_offerta_luce", { value_text: "Dual Casa Luce", evidence: "SCHEDA SINTETICA ENERGIA ELETTRICA - Dual Casa Luce" });
  setAnswer(answers, "codice_offerta_luce", { value_text: "LUCE-DUAL-2026", evidence: "Sezione ENERGIA ELETTRICA - Codice offerta LUCE-DUAL-2026" });
  setAnswer(answers, "tipo_prezzo_luce", { value_text: "fisso", evidence: "Sezione ENERGIA ELETTRICA - Prezzo fisso per 12 mesi" });
  setAnswer(answers, "prezzo_luce_f0_eur_kwh", { value_text: "0,12 €/kWh", value_number: 0.12, unit: "€/kWh", label: "F0", evidence: "Sezione ENERGIA ELETTRICA - F0 0,12 €/kWh" });
  setAnswer(answers, "quota_fissa_vendita_luce", { value_text: "96 €/anno", value_number: 96, unit: "€/anno", period: "year", evidence: "Sezione ENERGIA ELETTRICA - Corrispettivi definiti dal venditore - Corrispettivo annuo 96 €/anno" });

  setAnswer(answers, "nome_offerta_gas", { value_text: "Dual Casa Gas", evidence: "SCHEDA SINTETICA GAS NATURALE - Dual Casa Gas" });
  setAnswer(answers, "codice_offerta_gas", { value_text: "GAS-DUAL-2026", evidence: "Sezione GAS NATURALE - Codice offerta GAS-DUAL-2026" });
  setAnswer(answers, "tipo_prezzo_gas", { value_text: "variabile", evidence: "Sezione GAS NATURALE - Prezzo variabile" });
  setAnswer(answers, "indice_riferimento_gas", { value_text: "PSV", evidence: "Sezione GAS NATURALE - CONDIZIONI ECONOMICHE - Indice PSV" });
  setAnswer(answers, "spread_gas_eur_smc", { value_text: "0,06 €/Smc", value_number: 0.06, unit: "€/Smc", evidence: "Sezione GAS NATURALE - CONDIZIONI ECONOMICHE - Formula PSV + 0,06 €/Smc" });
  setAnswer(answers, "formula_prezzo_gas", { value_text: "PSV + 0,06 €/Smc", evidence: "Sezione GAS NATURALE - CONDIZIONI ECONOMICHE - Formula PSV + 0,06 €/Smc" });
  setAnswer(answers, "quota_fissa_vendita_gas", { value_text: "84 €/anno", value_number: 84, unit: "€/anno", period: "year", evidence: "Sezione GAS NATURALE - Corrispettivi definiti dal venditore - Corrispettivo annuo 84 €/anno" });

  const normalized = normalizePureAiOutput(output({ commodity: "dual", answers }));
  assert.equal(normalized.commodity, "dual");
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.12);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, 96);
  assert.equal(normalized.indice_riferimento_gas, "PSV");
  assert.equal(normalized.spread_gas_eur_smc, 0.06);
  assert.equal(normalized.quota_fissa_vendita_gas_eur_anno, 84);
  assert.equal(normalized.readiness.confronto.luce.status, "completo");
  assert.equal(normalized.readiness.confronto.gas.status, "completo");
  assert.notEqual(normalized.codice_offerta_luce, normalized.codice_offerta_gas);
});

test("fasce: un consumo annuo pari a zero resta un dato valido e non viene trattato come mancante", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "fornitore", { value_text: "Venditore Fasce", evidence: "Venditore Fasce" });
  setAnswer(answers, "pod", { value_text: "IT001E12345678", evidence: "POD IT001E12345678" });
  for (const [id, band, value] of [
    ["consumo_luce_f1_kwh", "F1", 0],
    ["consumo_luce_f2_kwh", "F2", 1000],
    ["consumo_luce_f3_kwh", "F3", 2000],
  ]) {
    setAnswer(answers, id, {
      value_text: String(value), value_number: value, unit: "kWh", label: band,
      evidence: `CONSUMO ANNUO kWh ${band} ${value} - ultimi 12 mesi`,
    });
  }
  const normalized = normalizePureAiOutput(output({ kind: "bill", answers }));
  assert.equal(normalized.consumo_luce_f1_kwh, 0);
  assert.equal(normalized.consumo_luce_f23_kwh, 3000);
  assert.equal(normalized.consumo_luce_kwh, 3000);
});

test("formula variabile: conserva uno spread negativo esplicitamente stampato", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "nome_offerta_luce", { value_text: "Luce Sconto Indice", evidence: "SCHEDA SINTETICA - Luce Sconto Indice" });
  setAnswer(answers, "tipo_prezzo_luce", { value_text: "variabile", evidence: "CONDIZIONI ECONOMICHE - Prezzo variabile" });
  setAnswer(answers, "indice_riferimento_luce", { value_text: "PUN Index GME", evidence: "CONDIZIONI ECONOMICHE - Indice PUN Index GME" });
  setAnswer(answers, "spread_luce_eur_kwh", {
    value_text: "-0,005 €/kWh", value_number: -0.005, unit: "€/kWh", label: "Spread",
    evidence: "CONDIZIONI ECONOMICHE - Formula PUN Index GME - 0,005 €/kWh - Spread -0,005 €/kWh",
  });
  setAnswer(answers, "formula_prezzo_luce", {
    value_text: "PUN Index GME - 0,005 €/kWh",
    evidence: "CONDIZIONI ECONOMICHE - Formula PUN Index GME - 0,005 €/kWh",
  });
  setAnswer(answers, "quota_fissa_vendita_luce", {
    value_text: "120 €/anno", value_number: 120, unit: "€/anno", period: "year",
    evidence: "CONDIZIONI ECONOMICHE - Corrispettivi definiti dal venditore - Corrispettivo annuo 120 €/anno",
  });
  const normalized = normalizePureAiOutput(output({ answers }));
  assert.equal(normalized.spread_luce_eur_kwh, -0.005);
  assert.equal(normalized.readiness.confronto.luce.status, "completo");
});

test("calcolatore: mantiene uno spread negativo nella formula indicizzata", () => {
  const { calcolaVoceEnergia } = loadCalculationHelpers();
  const result = calcolaVoceEnergia({
    commodity: "luce", consumo: 1000,
    formula: { tipo: "indice_spread", indice: "pun", spread: -0.005 },
    quotaFissaAnnua: 0, componentiRegolate: {}, tipoTariffa: "variabile",
  });
  assert.equal(result.fattorePerdite, 1.1);
  assert.ok(Math.abs(result.quotaMateria - 104.5) < 1e-9);
});
