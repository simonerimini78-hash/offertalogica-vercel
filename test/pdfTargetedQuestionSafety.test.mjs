import test from "node:test";
import assert from "node:assert/strict";
import {
  PDF_PURE_AI_QUESTION_IDS,
  PDF_PURE_AI_READER_VERSION,
  buildPdfPureAiRequest,
  normalizePureAiOutput,
} from "../lib/pdfPureAiReader.js";

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
    source_role: "unknown",
    usable_for_comparison: false,
    certainty: "not_available",
    reason: "dato non disponibile",
    coverage_months: null,
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
    source_role: "contract_term",
    usable_for_comparison: true,
    certainty: "certain",
    reason: "valore letterale nelle condizioni economiche",
    coverage_months: null,
    ...patch,
  });
}

function output({ kind = "bill", commodity = "electricity", customerType = "business", answers, document = {} }) {
  return {
    document: {
      kind,
      commodity,
      customer_type: customerType,
      page_count: 5,
      classification_evidence: kind === "offer_sheet" ? "SCHEDA SINTETICA" : "POD e codice cliente",
      billing_period_start: null,
      billing_period_end: null,
      supply_start_date: null,
      ...document,
    },
    answers,
  };
}

function rejectedReason(normalized, questionId) {
  return normalized.ai.rejected_questions.find((item) => item.question_id === questionId)?.reason || null;
}

test("validazione backend compatta: rifiuta i tre falsi positivi Free senza metadati prodotti dall'IA", () => {
  const answers = [
    { question_id: "fornitore", found: true, value_text: "Free Luce&Gas S.r.l.", value_number: null, unit: null, period: "none", page: 1, label: "Fornitore", evidence: "Free Luce&Gas S.r.l.", confidence: 100 },
    { question_id: "pod", found: true, value_text: "IT001E53942290", value_number: null, unit: null, period: "none", page: 2, label: "POD", evidence: "POD IT001E53942290", confidence: 100 },
    { question_id: "consumo_luce_kwh", found: true, value_text: "1.479,56 kWh", value_number: 1479.56, unit: "kWh", period: "none", page: 2, label: "RIEPILOGO DEI CONSUMI", evidence: "RIEPILOGO DEI CONSUMI (ultimi 12 mesi) - CONSUMO DA INIZIO FORNITURA TOTALE 1.479,56 kWh", confidence: 100 },
    { question_id: "prezzo_luce_eur_kwh", found: true, value_text: "0,055492 €/kWh", value_number: 0.055492, unit: "€/kWh", period: "none", page: 2, label: "COSTO MEDIO DELLA FORNITURA", evidence: "Costo unitario della materia Energia 0,055492 €/kWh", confidence: 100 },
    { question_id: "quota_fissa_vendita_luce", found: true, value_text: "10,154033 €", value_number: 10.154033, unit: "EUR", period: "month", page: 5, label: "Corr. Commercializzazione e Vendita", evidence: "Corr. Commercializzazione e Vendita 10,154033 1,00 10,15", confidence: 100 },
  ];
  const normalized = normalizePureAiOutput({
    document: { kind: "bill", commodity: "electricity", customer_type: "business", page_count: 7 },
    answers,
  });

  assert.equal(normalized.consumo_luce_kwh, undefined);
  assert.equal(normalized.prezzo_luce_eur_kwh, undefined);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, undefined);
  assert.equal(rejectedReason(normalized, "consumo_luce_kwh"), "semantic_consumption_period_conflict");
  assert.equal(rejectedReason(normalized, "prezzo_luce_eur_kwh"), "semantic_price_average_or_total");
  assert.equal(rejectedReason(normalized, "quota_fissa_vendita_luce"), "semantic_fixed_month_not_evidenced");
});

test("regressione Free Luce&Gas: non usa come annuale il consumo da inizio fornitura di due mesi", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "fornitore", {
    value_text: "Free Luce&Gas S.r.l.",
    evidence: "Free Luce&Gas S.r.l.",
    source_role: "identity",
  });
  setAnswer(answers, "pod", {
    value_text: "IT001E53942290",
    evidence: "RIEPILOGO DATI POD IT001E53942290",
    source_role: "customer_data",
  });
  setAnswer(answers, "consumo_luce_kwh", {
    value_text: "1.479,56 kWh",
    value_number: 1479.56,
    unit: "kWh",
    page: 2,
    label: "RIEPILOGO DEI CONSUMI (ultimi 12 mesi)",
    evidence: "RIEPILOGO DEI CONSUMI (ultimi 12 mesi) CONSUMO DA INIZIO FORNITURA: F1 457,51 kWh F2 365,61 kWh F3 656,44 kWh TOTALE 1.479,56 kWh. Periodi presenti: 07/2019 e 08/2019.",
    source_role: "period_total",
    usable_for_comparison: false,
    certainty: "certain",
    reason: "totale da inizio fornitura con due mesi disponibili",
    coverage_months: 2,
  });

  const normalized = normalizePureAiOutput(output({ answers, document: {
    billing_period_start: "01/08/2019",
    billing_period_end: "31/08/2019",
    supply_start_date: "01/07/2019",
  } }));

  assert.equal(normalized.consumo_luce_kwh, undefined);
  assert.equal(rejectedReason(normalized, "consumo_luce_kwh"), "semantic_consumption_period_conflict");
  assert.equal(normalized.readiness.confronto.luce.status, "incompleto");
});

test("regressione Free Luce&Gas: rifiuta costo unitario della materia come prezzo contrattuale", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "fornitore", { value_text: "Free Luce&Gas S.r.l.", evidence: "Free Luce&Gas S.r.l.", source_role: "identity" });
  setAnswer(answers, "pod", { value_text: "IT001E53942290", evidence: "POD IT001E53942290", source_role: "customer_data" });
  setAnswer(answers, "prezzo_luce_eur_kwh", {
    value_text: "0,055492 €/kWh",
    value_number: 0.055492,
    unit: "€/kWh",
    page: 2,
    label: "COSTO MEDIO DELLA FORNITURA",
    evidence: "COSTO MEDIO DELLA FORNITURA - Costo unitario della materia Energia 0,055492 €/kWh",
    source_role: "average_cost",
    usable_for_comparison: false,
    reason: "costo medio informativo e non condizione contrattuale",
  });

  const normalized = normalizePureAiOutput(output({ answers }));
  assert.equal(normalized.prezzo_luce_eur_kwh, undefined);
  assert.equal(rejectedReason(normalized, "prezzo_luce_eur_kwh"), "semantic_price_average_or_total");
});

test("regressione Free Luce&Gas: non annualizza una quota senza periodicità stampata", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "fornitore", { value_text: "Free Luce&Gas S.r.l.", evidence: "Free Luce&Gas S.r.l.", source_role: "identity" });
  setAnswer(answers, "pod", { value_text: "IT001E53942290", evidence: "POD IT001E53942290", source_role: "customer_data" });
  setAnswer(answers, "quota_fissa_vendita_luce", {
    value_text: "10,154033 €",
    value_number: 10.154033,
    unit: "EUR",
    period: "month",
    page: 5,
    label: "Corr. Commercializzazione e Vendita",
    evidence: "Corr. Commercializzazione e Vendita 10,154033 1,00 10,15",
    source_role: "contract_term",
    usable_for_comparison: false,
    certainty: "review",
    reason: "periodicità mensile non stampata nella riga",
  });

  const normalized = normalizePureAiOutput(output({ answers }));
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, undefined);
  assert.equal(rejectedReason(normalized, "quota_fissa_vendita_luce"), "semantic_answer_not_certain");
});

test("consumo annuale certo: accetta un totale che dimostra 12 mesi completi", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "fornitore", { value_text: "Fornitore Test", evidence: "Fornitore Test", source_role: "identity" });
  setAnswer(answers, "pod", { value_text: "IT001E12345678", evidence: "POD IT001E12345678", source_role: "customer_data" });
  setAnswer(answers, "consumo_luce_kwh", {
    value_text: "2.740 kWh",
    value_number: 2740,
    unit: "kWh",
    label: "Consumo annuo",
    evidence: "Consumo annuo complessivo dal 01/07/2025 al 30/06/2026 (12 mesi): 2.740 kWh",
    source_role: "annual_total",
    usable_for_comparison: true,
    certainty: "certain",
    reason: "totale letterale riferito a 12 mesi completi",
    coverage_months: 12,
  });

  const normalized = normalizePureAiOutput(output({ answers, customerType: "consumer" }));
  assert.equal(normalized.consumo_luce_kwh, 2740);
  assert.equal(rejectedReason(normalized, "consumo_luce_kwh"), null);
});

test("scheda sintetica Octopus: legge soltanto le condizioni economiche correnti", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "fornitore", {
    value_text: "Octopus Energy Italia Srl",
    evidence: "Venditore Octopus Energy Italia Srl",
    source_role: "identity",
  });
  setAnswer(answers, "fornitore_luce", {
    value_text: "Octopus Energy Italia Srl",
    evidence: "Venditore Octopus Energy Italia Srl",
    source_role: "identity",
  });
  setAnswer(answers, "nome_offerta_luce", {
    value_text: "Octopus Fissa 12M",
    evidence: "SCHEDA SINTETICA OCTOPUS FISSA 12M",
  });
  setAnswer(answers, "codice_offerta_luce", {
    value_text: "000129ESFML52XXXXXXXXOCTOFIXv152",
    evidence: "CODICE: 000129ESFML52XXXXXXXXOCTOFIXV152 OFFERTA ENERGIA ELETTRICA",
  });
  setAnswer(answers, "tipo_prezzo_luce", {
    value_text: "fisso",
    evidence: "CONDIZIONI ECONOMICHE Prezzo fisso 12 mesi",
  });
  setAnswer(answers, "prezzo_luce_eur_kwh", {
    value_text: "0,1364 €/kWh",
    value_number: 0.1364,
    unit: "€/kWh",
    evidence: "Corrispettivi definiti dal venditore - Prezzo componente energia 0,1364 €/kWh",
  });
  setAnswer(answers, "quota_fissa_vendita_luce", {
    value_text: "72,00 €/anno",
    value_number: 72,
    unit: "€/anno",
    period: "year",
    evidence: "Corrispettivo di commercializzazione 72,00 €/anno per utenza (6,00 €/mese)",
  });
  setAnswer(answers, "decorrenza_condizioni_economiche_luce", {
    value_text: "14/07/2026",
    evidence: "OFFERTA VALIDA DAL 14/07/2026 AL 21/07/2026",
  });
  setAnswer(answers, "scadenza_condizioni_economiche_luce", {
    value_text: "21/07/2026",
    evidence: "OFFERTA VALIDA DAL 14/07/2026 AL 21/07/2026",
  });

  const normalized = normalizePureAiOutput(output({
    kind: "offer_sheet",
    commodity: "electricity",
    customerType: "consumer",
    answers,
    document: { classification_evidence: "SCHEDA SINTETICA - OFFERTA A PREZZO FISSO" },
  }));

  assert.equal(normalized.kind, "scheda_offerta");
  assert.equal(normalized.commodity, "luce");
  assert.equal(normalized.nome_offerta_luce, "Octopus Fissa 12M");
  assert.equal(normalized.codice_offerta_luce, "000129ESFML52XXXXXXXXOCTOFIXV152");
  assert.equal(normalized.tipo_prezzo_luce, "fisso");
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.1364);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, 72);
  assert.equal(normalized.decorrenza_condizioni_economiche_luce, "2026-07-14");
  assert.equal(normalized.scadenza_condizioni_economiche_luce, "2026-07-21");
  assert.equal(normalized.readiness.confronto.luce.status, "completo");
  assert.equal(normalized.data_contract.fields.prezzo_luce_eur_kwh.autofill.use, "new_offer");
  assert.equal(normalized.data_contract.fields.quota_fissa_vendita_luce_eur_anno.autofill.use, "new_offer");
});

test("scheda sintetica: non usa spesa annua stimata come prezzo dell'offerta", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "nome_offerta_luce", { value_text: "Octopus Fissa 12M", evidence: "SCHEDA SINTETICA OCTOPUS FISSA 12M" });
  setAnswer(answers, "prezzo_luce_eur_kwh", {
    value_text: "728,56 €",
    value_number: 728.56,
    unit: "€/anno",
    evidence: "SPESA ANNUA STIMATA DELL'OFFERTA - consumo annuo 2.700 kWh - 728,56 €/anno",
    source_role: "example",
    usable_for_comparison: false,
    reason: "stima per un profilo di consumo e non prezzo unitario contrattuale",
  });

  const normalized = normalizePureAiOutput(output({ kind: "offer_sheet", customerType: "consumer", answers }));
  assert.equal(normalized.prezzo_luce_eur_kwh, undefined);
  assert.equal(rejectedReason(normalized, "prezzo_luce_eur_kwh"), "semantic_price_average_or_total");
});

test("scheda sintetica: non sostituisce l'offerta corrente con la tariffa di rinnovo futuro", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "nome_offerta_luce", { value_text: "Octopus Fissa 12M", evidence: "SCHEDA SINTETICA OCTOPUS FISSA 12M" });
  setAnswer(answers, "formula_prezzo_luce", {
    value_text: "PUN Index GME + 0,0088 €/kWh",
    evidence: "Prezzo componente energia della tariffa di rinnovo in assenza di scelta del cliente: PUN Index GME + 0,0088 €/kWh",
    source_role: "example",
    usable_for_comparison: false,
    reason: "formula futura di rinnovo e non condizione dell'offerta corrente",
  });
  setAnswer(answers, "indice_riferimento_luce", {
    value_text: "PUN Index GME",
    evidence: "Valori recenti giugno 2026 - PUN Index GME",
    source_role: "example",
    usable_for_comparison: false,
    reason: "valore storico/esempio",
  });

  const normalized = normalizePureAiOutput(output({ kind: "offer_sheet", customerType: "consumer", answers }));
  assert.equal(normalized.formula_prezzo_luce, undefined);
  assert.equal(normalized.indice_riferimento_luce, undefined);
  assert.equal(rejectedReason(normalized, "formula_prezzo_luce"), "semantic_offer_field_not_contract_term");
  assert.equal(rejectedReason(normalized, "indice_riferimento_luce"), "semantic_offer_field_not_contract_term");
});

test("richiesta IA: schema compatto assegna la priorità ai dati economici e rende accessori gli altri", async () => {
  const request = await buildPdfPureAiRequest({ fileId: "file_test", filename: "documento.pdf" });
  const schema = request.text.format.schema;
  const supply = schema.properties.supplies.items.properties;
  assert.deepEqual(schema.required, ["document", "supplies", "additional_data"]);
  assert.ok(supply.annual_consumption);
  assert.ok(supply.price);
  assert.ok(supply.fixed_fee);
  assert.ok(supply.fixed_fee.properties.section_total_value);
  assert.equal(schema.properties.answers, undefined);
  assert.equal(request.max_output_tokens, 4000);
  const prompt = request.input[0].content[0].text + "\n" + request.input[1].content[1].text;
  assert.match(prompt, /priorità assoluta/i);
  assert.match(prompt, /consumo annuo/i);
  assert.match(prompt, /prezzo unitario commerciale/i);
  assert.match(prompt, /quota fissa commerciale/i);
  assert.match(prompt, /formula e componenti necessarie/i);
  assert.match(prompt, /dati aggiuntivi/i);
  assert.match(prompt, /secondari/i);
  assert.match(prompt, /rinnovi futuri/i);
});


test("scheda sintetica Acea: conserva nome, tipo, quota annua e prezzi F0/F1/F2/F3", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "fornitore", {
    value_text: "Acea Energia",
    label: "Venditore",
    evidence: "SCHEDA SINTETICA - Venditore Acea Energia",
    source_role: undefined,
    usable_for_comparison: undefined,
  });
  setAnswer(answers, "nome_offerta_luce", {
    value_text: "Acea Energia Fix",
    label: "Titolo offerta",
    evidence: "SCHEDA SINTETICA ED INFORMAZIONI PRECONTRATTUALI - Acea Energia Fix",
    source_role: undefined,
    usable_for_comparison: undefined,
  });
  setAnswer(answers, "codice_offerta_luce", {
    value_text: "000774ESFML01XXRT4D4028030000000",
    label: "CODICE OFFERTA MONORARIA",
    evidence: "CODICE OFFERTA MONORARIA: 000774ESFML01XXRT4D4028030000000",
    source_role: undefined,
    usable_for_comparison: undefined,
  });
  setAnswer(answers, "tipo_prezzo_luce", {
    value_text: "fisso",
    label: "Prezzo",
    evidence: "CONDIZIONI ECONOMICHE - Prezzo fisso per 12 mesi",
    source_role: undefined,
    usable_for_comparison: undefined,
  });
  setAnswer(answers, "prezzo_luce_f0_eur_kwh", {
    value_text: "0,099000 €/kWh",
    value_number: 0.099,
    unit: "€/kWh",
    label: "F0",
    evidence: "CONDIZIONI ECONOMICHE - Corrispettivi definiti dal venditore - Corrispettivo per il consumo F0: 0,099000 €/kWh",
    source_role: undefined,
    usable_for_comparison: undefined,
  });
  setAnswer(answers, "prezzo_luce_f1_eur_kwh", {
    value_text: "0,100600 €/kWh",
    value_number: 0.1006,
    unit: "€/kWh",
    label: "F1",
    evidence: "CONDIZIONI ECONOMICHE - Corrispettivi definiti dal venditore - F1: 0,100600 €/kWh",
    source_role: undefined,
    usable_for_comparison: undefined,
  });
  setAnswer(answers, "prezzo_luce_f2_eur_kwh", {
    value_text: "0,111200 €/kWh",
    value_number: 0.1112,
    unit: "€/kWh",
    label: "F2",
    evidence: "CONDIZIONI ECONOMICHE - Corrispettivi definiti dal venditore - F2: 0,111200 €/kWh",
    source_role: undefined,
    usable_for_comparison: undefined,
  });
  setAnswer(answers, "prezzo_luce_f3_eur_kwh", {
    value_text: "0,087900 €/kWh",
    value_number: 0.0879,
    unit: "€/kWh",
    label: "F3",
    evidence: "CONDIZIONI ECONOMICHE - Corrispettivi definiti dal venditore - F3: 0,087900 €/kWh",
    source_role: undefined,
    usable_for_comparison: undefined,
  });
  setAnswer(answers, "quota_fissa_vendita_luce", {
    value_text: "111,00 €/anno",
    value_number: 111,
    unit: "€/anno",
    period: "year",
    label: "Corrispettivo annuo",
    evidence: "CONDIZIONI ECONOMICHE - CORRISPETTIVI DEFINITI DAL VENDITORE - Corrispettivo annuo 111,00 €/anno",
    source_role: undefined,
    usable_for_comparison: undefined,
  });
  setAnswer(answers, "struttura_prezzo_luce", {
    value_text: "monoraria o fasce F1/F2/F3",
    label: "Opzioni prezzo",
    evidence: "L'offerta prevede la possibilità di scegliere tra opzione monoraria o differenziata per fasce F1/F2/F3",
    source_role: undefined,
    usable_for_comparison: undefined,
  });
  setAnswer(answers, "decorrenza_condizioni_economiche_luce", {
    value_text: "03/07/2026",
    label: "VALIDA DAL",
    evidence: "OFFERTA VALIDA DAL 03/07/2026 AL 20/07/2026",
    source_role: undefined,
    usable_for_comparison: undefined,
  });
  setAnswer(answers, "scadenza_condizioni_economiche_luce", {
    value_text: "20/07/2026",
    label: "VALIDA AL",
    evidence: "OFFERTA VALIDA DAL 03/07/2026 AL 20/07/2026",
    source_role: undefined,
    usable_for_comparison: undefined,
  });

  const normalized = normalizePureAiOutput(output({
    kind: "offer_sheet",
    commodity: "electricity",
    customerType: "consumer",
    answers,
  }));

  assert.equal(normalized.nome_offerta_luce, "Acea Energia Fix");
  assert.equal(normalized.tipo_prezzo_luce, "fisso");
  assert.equal(normalized.prezzo_luce_f0_eur_kwh, 0.099);
  assert.equal(normalized.prezzo_luce_f1_eur_kwh, 0.1006);
  assert.equal(normalized.prezzo_luce_f2_eur_kwh, 0.1112);
  assert.equal(normalized.prezzo_luce_f3_eur_kwh, 0.0879);
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.099);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, 111);
  assert.equal(normalized.readiness.confronto.luce.status, "completo");
  assert.equal(normalized.readiness.dati_bolletta.luce.status, "non_applicabile");
  assert.equal(normalized.readiness.attivazione.luce.status, "non_applicabile");
  assert.deepEqual(normalized.data_contract.supplies.luce.offer.price_bands, {
    f0: 0.099,
    f1: 0.1006,
    f2: 0.1112,
    f3: 0.0879,
    f23: null,
    unit: "EUR/kWh",
  });
});

test("prezzi per fasce senza F0: non inventa un prezzo unico per il confronto", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "nome_offerta_luce", {
    value_text: "Offerta Fasce",
    evidence: "SCHEDA SINTETICA - Offerta Fasce",
    source_role: undefined,
    usable_for_comparison: undefined,
  });
  setAnswer(answers, "tipo_prezzo_luce", {
    value_text: "fisso",
    evidence: "CONDIZIONI ECONOMICHE - Prezzo fisso per 12 mesi",
    source_role: undefined,
    usable_for_comparison: undefined,
  });
  for (const [id, value] of [
    ["prezzo_luce_f1_eur_kwh", 0.11],
    ["prezzo_luce_f2_eur_kwh", 0.10],
    ["prezzo_luce_f3_eur_kwh", 0.09],
  ]) {
    const band = id.match(/_(f\d+)_/)[1].toUpperCase();
    setAnswer(answers, id, {
      value_text: `${value.toFixed(2).replace(".", ",")} €/kWh`,
      value_number: value,
      unit: "€/kWh",
      label: band,
      evidence: `CONDIZIONI ECONOMICHE - Corrispettivi definiti dal venditore - ${band}: ${value} €/kWh`,
      source_role: undefined,
      usable_for_comparison: undefined,
    });
  }
  setAnswer(answers, "quota_fissa_vendita_luce", {
    value_text: "90 €/anno",
    value_number: 90,
    unit: "€/anno",
    period: "year",
    evidence: "CONDIZIONI ECONOMICHE - CORRISPETTIVI DEFINITI DAL VENDITORE - Corrispettivo annuo 90 €/anno",
    source_role: undefined,
    usable_for_comparison: undefined,
  });

  const normalized = normalizePureAiOutput(output({
    kind: "offer_sheet",
    commodity: "electricity",
    customerType: "consumer",
    answers,
  }));

  assert.equal(normalized.prezzo_luce_eur_kwh, undefined);
  assert.equal(normalized.readiness.confronto.luce.status, "completo");
  assert.deepEqual(normalized.readiness.confronto.luce.missing, []);
  assert.equal(normalized.readiness.confronto.luce.pricing_mode, "f1_f2_f3");
});
