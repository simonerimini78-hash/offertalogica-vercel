import test from "node:test";
import assert from "node:assert/strict";
import {
  PDF_PURE_AI_QUESTION_IDS,
  PDF_PURE_AI_READER_VERSION,
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
  }));
}

function setAnswer(answers, questionId, patch) {
  const answer = answers.find((item) => item.question_id === questionId);
  Object.assign(answer, {
    found: true,
    value_text: null,
    value_number: null,
    unit: null,
    period: "none",
    page: 1,
    label: questionId,
    evidence: "evidenza",
    confidence: 95,
    ...patch,
  });
}

function documentOutput({ kind = "bill", commodity = "electricity", answers = emptyAnswers() } = {}) {
  return {
    document: { kind, commodity, customer_type: "consumer", page_count: 2 },
    answers,
  };
}

function rejectedReason(normalized, questionId) {
  return normalized.ai.rejected_questions.find((item) => item.question_id === questionId)?.reason || null;
}

test("validazione semantica generale: rifiuta il consumo del periodo fatturato come consumo annuo", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "fornitore", { value_text: "Fornitore Test", evidence: "Fornitore Test" });
  setAnswer(answers, "pod", { value_text: "IT001E12345678", evidence: "POD IT001E12345678" });
  setAnswer(answers, "consumo_luce_kwh", {
    value_text: "4.084,0 kWh",
    value_number: 4084,
    unit: "kWh",
    label: "Consumi fatturati",
    evidence: "CONSUMI FATTURATI (kWh) 4.084,0",
  });

  const normalized = normalizePureAiOutput(documentOutput({ answers }));
  assert.equal(normalized.consumo_luce_kwh, undefined);
  assert.equal(rejectedReason(normalized, "consumo_luce_kwh"), "semantic_consumption_not_annual");
  assert.equal(normalized.field_status.consumo_luce_kwh.status, "mancante");
  assert.equal(normalized.readiness.confronto.luce.status, "incompleto");
});

test("validazione semantica generale: accetta soltanto un totale annuale esplicito", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "fornitore", { value_text: "Fornitore Test", evidence: "Fornitore Test" });
  setAnswer(answers, "pod", { value_text: "IT001E12345678", evidence: "POD IT001E12345678" });
  setAnswer(answers, "consumo_luce_kwh", {
    value_text: "2.740 kWh",
    value_number: 2740,
    unit: "kWh",
    label: "Consumo annuo",
    evidence: "Consumo annuo complessivo ultimi 12 mesi: 2.740 kWh",
  });

  const normalized = normalizePureAiOutput(documentOutput({ answers }));
  assert.equal(normalized.consumo_luce_kwh, 2740);
  assert.equal(rejectedReason(normalized, "consumo_luce_kwh"), null);
});

test("validazione semantica generale: rifiuta il prezzo medio complessivo della fornitura", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "fornitore", { value_text: "Fornitore Test", evidence: "Fornitore Test" });
  setAnswer(answers, "pod", { value_text: "IT001E12345678", evidence: "POD IT001E12345678" });
  setAnswer(answers, "prezzo_luce_eur_kwh", {
    value_text: "0,15 €/kWh",
    value_number: 0.15,
    unit: "€/kWh",
    label: "Costo medio unitario della fornitura",
    evidence: "COSTO MEDIO UNITARIO DELLA FORNITURA 0,15 €/kWh",
  });

  const normalized = normalizePureAiOutput(documentOutput({ answers }));
  assert.equal(normalized.prezzo_luce_eur_kwh, undefined);
  assert.equal(rejectedReason(normalized, "prezzo_luce_eur_kwh"), "semantic_price_average_or_total");
  assert.equal(normalized.field_status.prezzo_luce_eur_kwh.status, "mancante");
});

test("validazione semantica generale: accetta il prezzo medio della sola spesa di vendita", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "prezzo_luce_eur_kwh", {
    value_text: "0,152429 €/kWh",
    value_number: 0.152429,
    unit: "€/kWh",
    label: "Prezzo medio",
    evidence: "di cui spesa per la vendita di energia elettrica 37,47 € 0,152429 €/kWh",
  });

  const normalized = normalizePureAiOutput(documentOutput({ answers }));
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.152429);
  assert.equal(rejectedReason(normalized, "prezzo_luce_eur_kwh"), null);
  const diagnostic = normalized.diagnostics.find((item) => item.field === "prezzo_luce_eur_kwh");
  assert.equal(diagnostic?.source_role, "sales_component_rate");
  assert.equal(diagnostic?.usable_for_comparison, true);
});

test("validazione semantica generale: continua a rifiutare il prezzo medio totale della quota consumi", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "prezzo_luce_eur_kwh", {
    value_text: "0,197462 €/kWh",
    value_number: 0.197462,
    unit: "€/kWh",
    label: "Prezzo medio",
    evidence: "Quota per consumi 245,819 kWh 48,54 € 0,197462 €/kWh",
  });

  const normalized = normalizePureAiOutput(documentOutput({ answers }));
  assert.equal(normalized.prezzo_luce_eur_kwh, undefined);
  assert.equal(rejectedReason(normalized, "prezzo_luce_eur_kwh"), "semantic_price_average_or_total");
});

test("validazione semantica generale: accetta il prezzo commerciale esplicito", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "fornitore", { value_text: "Fornitore Test", evidence: "Fornitore Test" });
  setAnswer(answers, "pod", { value_text: "IT001E12345678", evidence: "POD IT001E12345678" });
  setAnswer(answers, "prezzo_luce_eur_kwh", {
    value_text: "0,123456 €/kWh",
    value_number: 0.123456,
    unit: "€/kWh",
    label: "Prezzo energia",
    evidence: "Prezzo della componente energia elettrica: 0,123456 €/kWh",
  });

  const normalized = normalizePureAiOutput(documentOutput({ answers }));
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.123456);
  assert.equal(rejectedReason(normalized, "prezzo_luce_eur_kwh"), null);
});

test("validazione semantica generale: rifiuta componenti regolate come prezzo o quota fissa di vendita", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "fornitore", { value_text: "Fornitore Test", evidence: "Fornitore Test" });
  setAnswer(answers, "pod", { value_text: "IT001E12345678", evidence: "POD IT001E12345678" });
  setAnswer(answers, "prezzo_luce_eur_kwh", {
    value_text: "0,02 €/kWh",
    value_number: 0.02,
    unit: "€/kWh",
    evidence: "Corrispettivo di trasporto energia 0,02 €/kWh",
  });
  setAnswer(answers, "quota_fissa_vendita_luce", {
    value_text: "24 €/anno",
    value_number: 24,
    unit: "€/anno",
    period: "year",
    evidence: "Quota fissa gestione contatore 24 €/anno",
  });

  const normalized = normalizePureAiOutput(documentOutput({ answers }));
  assert.equal(rejectedReason(normalized, "prezzo_luce_eur_kwh"), "semantic_price_regulated_or_fixed_component");
  assert.equal(rejectedReason(normalized, "quota_fissa_vendita_luce"), "semantic_fixed_fee_regulated_component");
  assert.equal(normalized.prezzo_luce_eur_kwh, undefined);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, undefined);
});

test("scheda sintetica generale: riclassifica un documento offerta senza dati cliente e usa i target nuova offerta", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "fornitore", { value_text: "Energia Test", evidence: "Energia Test" });
  setAnswer(answers, "nome_offerta_luce", { value_text: "Offerta Luce Chiara", evidence: "Nome offerta: Offerta Luce Chiara" });
  setAnswer(answers, "codice_offerta_luce", { value_text: "OFF123456789", evidence: "Codice offerta OFF123456789" });
  setAnswer(answers, "prezzo_luce_eur_kwh", {
    value_text: "0,109 €/kWh",
    value_number: 0.109,
    unit: "€/kWh",
    evidence: "Prezzo energia elettrica 0,109 €/kWh",
  });
  setAnswer(answers, "quota_fissa_vendita_luce", {
    value_text: "10 €/mese",
    value_number: 10,
    unit: "€/mese",
    period: "month",
    evidence: "Corrispettivo fisso di vendita 10 €/mese",
  });
  setAnswer(answers, "tipo_prezzo_luce", { value_text: "fisso", evidence: "Tipologia prezzo: fisso" });

  const normalized = normalizePureAiOutput(documentOutput({ kind: "unknown", commodity: "unknown", answers }));
  assert.equal(normalized.kind, "scheda_offerta");
  assert.equal(normalized.commodity, "luce");
  assert.equal(normalized.recognized, true);
  assert.equal(normalized.ai.document_kind_declared, "unknown");
  assert.equal(normalized.ai.document_kind_resolved, "scheda_offerta");
  assert.equal(normalized.data_contract.fields.prezzo_luce_eur_kwh.autofill.use, "new_offer");
  assert.deepEqual(normalized.data_contract.fields.prezzo_luce_eur_kwh.autofill.targets, ["in-luce-prezzo-nuov"]);
});

test("classificazione generale: i dati specifici del cliente mantengono il documento come bolletta", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "fornitore", { value_text: "Energia Test", evidence: "Energia Test" });
  setAnswer(answers, "pod", { value_text: "IT001E12345678", evidence: "POD IT001E12345678" });
  setAnswer(answers, "codice_cliente", { value_text: "1234567", evidence: "Codice cliente 1234567" });
  setAnswer(answers, "nome_offerta_luce", { value_text: "Offerta Attiva", evidence: "Prodotto attivo: Offerta Attiva" });

  const normalized = normalizePureAiOutput(documentOutput({ kind: "unknown", commodity: "unknown", answers }));
  assert.equal(normalized.kind, "bolletta");
  assert.equal(normalized.commodity, "luce");
  assert.equal(normalized.data_contract.fields.fornitore_luce.autofill.use, "current_supply");
});

test("versione lettore semantico aggiornata", () => {
  assert.equal(PDF_PURE_AI_READER_VERSION, "pure-ai-native-pdf-v1.0.15");
});


test("tipo prezzo: gestisce negazioni, componenti fisse e conflitti senza forzare variabile", () => {
  const normalizeType = (valueText, evidence = valueText) => {
    const answers = emptyAnswers();
    setAnswer(answers, "tipo_prezzo_luce", { value_text: valueText, evidence });
    return normalizePureAiOutput(documentOutput({ kind: "offer_sheet", commodity: "electricity", answers }));
  };

  assert.equal(normalizeType("Prezzo fisso, non variabile").tipo_prezzo_luce, "fisso");
  assert.equal(normalizeType("Prezzo variabile, non fisso").tipo_prezzo_luce, "variabile");
  assert.equal(
    normalizeType("Prezzo variabile con corrispettivo fisso di commercializzazione").tipo_prezzo_luce,
    "variabile",
  );
  assert.equal(
    normalizeType("Offerta ibrida con componente fissa e componente variabile").tipo_prezzo_luce,
    "ibrido",
  );

  const conflict = normalizeType("Prezzo fisso e prezzo variabile");
  assert.equal(conflict.tipo_prezzo_luce, undefined);
  assert.equal(rejectedReason(conflict, "tipo_prezzo_luce"), "invalid_price_type");
});

test("validazione semantica gas: distingue consumo del periodo e accetta il prezzo medio della sola materia gas", () => {
  const invalidAnswers = emptyAnswers();
  setAnswer(invalidAnswers, "fornitore", { value_text: "Gas Test", evidence: "Gas Test" });
  setAnswer(invalidAnswers, "pdr", { value_text: "12345678901234", evidence: "PDR 12345678901234" });
  setAnswer(invalidAnswers, "consumo_gas_smc", {
    value_text: "850 Smc",
    value_number: 850,
    unit: "Smc",
    evidence: "Consumi fatturati nel periodo 850 Smc",
  });
  setAnswer(invalidAnswers, "prezzo_gas_eur_smc", {
    value_text: "0,78 €/Smc",
    value_number: 0.78,
    unit: "€/Smc",
    evidence: "Costo medio unitario della spesa per la materia gas 0,78 €/Smc",
  });
  const invalid = normalizePureAiOutput(documentOutput({ commodity: "gas", answers: invalidAnswers }));
  assert.equal(invalid.consumo_gas_smc, undefined);
  assert.equal(invalid.prezzo_gas_eur_smc, 0.78);
  assert.equal(rejectedReason(invalid, "consumo_gas_smc"), "semantic_consumption_not_annual");
  assert.equal(rejectedReason(invalid, "prezzo_gas_eur_smc"), null);

  const validAnswers = emptyAnswers();
  setAnswer(validAnswers, "fornitore", { value_text: "Gas Test", evidence: "Gas Test" });
  setAnswer(validAnswers, "pdr", { value_text: "12345678901234", evidence: "PDR 12345678901234" });
  setAnswer(validAnswers, "consumo_gas_smc", {
    value_text: "1.250 Smc",
    value_number: 1250,
    unit: "Smc",
    evidence: "Consumo annuo ultimi 12 mesi: 1.250 Smc",
  });
  setAnswer(validAnswers, "prezzo_gas_eur_smc", {
    value_text: "0,49 €/Smc",
    value_number: 0.49,
    unit: "€/Smc",
    evidence: "Prezzo materia prima gas naturale 0,49 €/Smc",
  });
  const valid = normalizePureAiOutput(documentOutput({ commodity: "gas", answers: validAnswers }));
  assert.equal(valid.consumo_gas_smc, 1250);
  assert.equal(valid.prezzo_gas_eur_smc, 0.49);
});

test("quote fisse generali: accetta zero e valori negativi soltanto con evidenza commerciale", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "fornitore", { value_text: "Energia Test", evidence: "Energia Test" });
  setAnswer(answers, "pod", { value_text: "IT001E12345678", evidence: "POD IT001E12345678" });
  setAnswer(answers, "quota_fissa_vendita_luce", {
    value_text: "0 €/mese",
    value_number: 0,
    unit: "€/mese",
    period: "month",
    evidence: "Quota fissa di commercializzazione e vendita 0 €/mese",
  });
  const zero = normalizePureAiOutput(documentOutput({ answers }));
  assert.equal(zero.quota_fissa_vendita_luce_eur_anno, 0);
  assert.equal(zero.field_status.quota_fissa_vendita_luce_eur_anno.status, "completo");

  const negativeAnswers = emptyAnswers();
  setAnswer(negativeAnswers, "fornitore", { value_text: "Energia Test", evidence: "Energia Test" });
  setAnswer(negativeAnswers, "pod", { value_text: "IT001E12345678", evidence: "POD IT001E12345678" });
  setAnswer(negativeAnswers, "quota_fissa_vendita_luce", {
    value_text: "-6,10 €/mese",
    value_number: -6.1,
    unit: "€/mese",
    period: "month",
    evidence: "Credito sulla quota fissa di vendita -6,10 €/mese",
  });
  const negative = normalizePureAiOutput(documentOutput({ answers: negativeAnswers }));
  assert.equal(negative.quota_fissa_vendita_luce_eur_anno, -73.2);
});


test("prezzo confrontabile generale: F0 ha priorità sul prezzo medio commerciale", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "consumo_luce_kwh", {
    value_text: "2.000 kWh", value_number: 2000, unit: "kWh",
    evidence: "Consumo annuo ultimi 12 mesi: 2.000 kWh",
  });
  setAnswer(answers, "prezzo_luce_eur_kwh", {
    value_text: "0,150000 €/kWh", value_number: 0.15, unit: "€/kWh",
    label: "Prezzo medio", evidence: "di cui spesa per la vendita di energia elettrica 0,150000 €/kWh",
  });
  setAnswer(answers, "prezzo_luce_f0_eur_kwh", {
    value_text: "0,120000 €/kWh", value_number: 0.12, unit: "€/kWh",
    label: "F0", evidence: "Prezzo componente energia F0 0,120000 €/kWh",
  });
  setAnswer(answers, "quota_fissa_vendita_luce", {
    value_text: "96 €/anno", value_number: 96, unit: "€/anno", period: "year",
    evidence: "Quota fissa commercializzazione 96 €/anno",
  });

  const normalized = normalizePureAiOutput(documentOutput({ answers }));
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.12);
  assert.equal(normalized.readiness.confronto.luce.status, "completo");
  assert.equal(
    normalized.diagnostics.find((item) => item.field === "prezzo_luce_eur_kwh")?.derivation?.type,
    "monoraria_f0_to_sales_price",
  );
});

test("prezzo confrontabile generale: calcola la media ponderata F1/F2/F3 sui consumi annui", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "consumo_luce_f1_kwh", {
    value_text: "1.000 kWh", value_number: 1000, unit: "kWh", label: "F1",
    evidence: "Consumo annuo ultimi 12 mesi F1 1.000 kWh",
  });
  setAnswer(answers, "consumo_luce_f2_kwh", {
    value_text: "500 kWh", value_number: 500, unit: "kWh", label: "F2",
    evidence: "Consumo annuo ultimi 12 mesi F2 500 kWh",
  });
  setAnswer(answers, "consumo_luce_f3_kwh", {
    value_text: "500 kWh", value_number: 500, unit: "kWh", label: "F3",
    evidence: "Consumo annuo ultimi 12 mesi F3 500 kWh",
  });
  for (const [id, band, value] of [
    ["prezzo_luce_f1_eur_kwh", "F1", 0.10],
    ["prezzo_luce_f2_eur_kwh", "F2", 0.20],
    ["prezzo_luce_f3_eur_kwh", "F3", 0.30],
  ]) setAnswer(answers, id, {
    value_text: `${value.toFixed(2).replace(".", ",")} €/kWh`, value_number: value, unit: "€/kWh", label: band,
    evidence: `Prezzo componente energia ${band} ${value.toFixed(2).replace(".", ",")} €/kWh`,
  });
  setAnswer(answers, "quota_fissa_vendita_luce", {
    value_text: "120 €/anno", value_number: 120, unit: "€/anno", period: "year",
    evidence: "Quota fissa vendita 120 €/anno",
  });

  const normalized = normalizePureAiOutput(documentOutput({ answers }));
  assert.equal(normalized.consumo_luce_kwh, 2000);
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.175);
  assert.equal(normalized.readiness.confronto.luce.status, "completo");
  const diagnostic = normalized.diagnostics.find((item) => item.field === "prezzo_luce_eur_kwh");
  assert.equal(diagnostic?.method, "deterministic_weighted_average");
  assert.equal(diagnostic?.derivation?.type, "annual_band_weighted_sales_price_f1_f2_f3");
});

test("prezzo confrontabile generale: calcola la media ponderata F1/F23", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "consumo_luce_f1_kwh", {
    value_text: "1.000 kWh", value_number: 1000, unit: "kWh", label: "F1",
    evidence: "Consumo annuo ultimi 12 mesi F1 1.000 kWh",
  });
  setAnswer(answers, "consumo_luce_f23_kwh", {
    value_text: "2.000 kWh", value_number: 2000, unit: "kWh", label: "F23",
    evidence: "Consumo annuo ultimi 12 mesi F23 2.000 kWh",
  });
  setAnswer(answers, "prezzo_luce_f1_eur_kwh", {
    value_text: "0,10 €/kWh", value_number: 0.10, unit: "€/kWh", label: "F1",
    evidence: "Prezzo componente energia F1 0,10 €/kWh",
  });
  setAnswer(answers, "prezzo_luce_f23_eur_kwh", {
    value_text: "0,16 €/kWh", value_number: 0.16, unit: "€/kWh", label: "F23",
    evidence: "Prezzo componente energia F23 0,16 €/kWh",
  });
  setAnswer(answers, "quota_fissa_vendita_luce", {
    value_text: "84 €/anno", value_number: 84, unit: "€/anno", period: "year",
    evidence: "Quota fissa commercializzazione 84 €/anno",
  });

  const normalized = normalizePureAiOutput(documentOutput({ answers }));
  assert.equal(normalized.consumo_luce_kwh, 3000);
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.14);
  assert.equal(normalized.readiness.confronto.luce.status, "completo");
  assert.equal(
    normalized.diagnostics.find((item) => item.field === "prezzo_luce_eur_kwh")?.derivation?.type,
    "annual_band_weighted_sales_price_f1_f23",
  );
});

test("prezzo confrontabile generale: usa il prezzo medio commerciale quando mancano i consumi annui per fascia", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "consumo_luce_kwh", {
    value_text: "1.628,91 kWh", value_number: 1628.91, unit: "kWh",
    evidence: "Totale consumo annuo dal 01.06.2025 al 31.05.2026: 1.628,91 kWh",
  });
  setAnswer(answers, "prezzo_luce_eur_kwh", {
    value_text: "0,152429 €/kWh", value_number: 0.152429, unit: "€/kWh", label: "Prezzo medio",
    evidence: "di cui spesa per la vendita di energia elettrica 37,47 € 0,152429 €/kWh",
  });
  for (const [id, band, value] of [
    ["prezzo_luce_f1_eur_kwh", "F1", 0.117891],
    ["prezzo_luce_f2_eur_kwh", "F2", 0.144582],
    ["prezzo_luce_f3_eur_kwh", "F3", 0.132897],
  ]) setAnswer(answers, id, {
    value_text: String(value), value_number: value, unit: "€/kWh", label: band,
    evidence: `Corrispettivo commerciale fascia ${band} ${value} €/kWh`,
  });
  setAnswer(answers, "quota_fissa_vendita_luce", {
    value_text: "-6,10 €/mese", value_number: -6.1, unit: "€/mese", period: "month",
    evidence: "di cui spesa per la vendita di energia elettrica -6,10 €/mese",
  });

  const normalized = normalizePureAiOutput(documentOutput({ answers }));
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.152429);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, -73.2);
  assert.equal(normalized.readiness.confronto.luce.status, "completo");
  assert.equal(
    normalized.diagnostics.find((item) => item.field === "prezzo_luce_eur_kwh")?.source_role,
    "sales_component_rate",
  );
});
