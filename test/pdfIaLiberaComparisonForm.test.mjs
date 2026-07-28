import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  PDF_PURE_AI_READER_VERSION,
  buildPdfPureAiRequest,
  normalizePureAiOutput,
} from "../lib/pdfPureAiReader.js";

function identity(provider = null, offerName = null, page = 1) {
  return { provider, offer_name: offerName, offer_code: null, page, evidence: [provider, offerName].filter(Boolean).join(" - ") || null, confidence: 100 };
}

function consumption({ total = null, f1 = null, f2 = null, f3 = null, f23 = null, unit = "kWh", page = 1, evidence = "Consumo annuo ultimi 12 mesi" } = {}) {
  return { total, f1, f2, f3, f23, unit, page, label: "Consumo annuo", evidence, confidence: 100 };
}

function price({ type = "unknown", single = null, f0 = null, f1 = null, f2 = null, f3 = null, f23 = null, index = null, multiplier = null, spread = null, formula = null, periodicity = null, unit = "€/kWh", page = 1, evidence = "Condizioni economiche" } = {}) {
  return { type, single, f0, f1, f2, f3, f23, index, multiplier, spread, formula, periodicity, unit, page, label: "Condizioni economiche", evidence, confidence: 100 };
}

function fixed({ value = null, text = null, unit = null, period = "none", page = null, evidence = null } = {}) {
  return {
    value, value_text: text, unit, period, page, label: "Quota fissa", evidence, confidence: value === null ? 0 : 100,
    section_total_value: null, section_total_value_text: null, section_total_unit: null, section_total_period: "none",
    section_total_page: null, section_total_label: null, section_total_evidence: null, section_total_confidence: 0,
  };
}

function output({ commodity = "electricity", supplies, additional = [] }) {
  return {
    document: { kind: "bill", commodity, customer_type: "consumer", page_count: 10 },
    supplies,
    additional_data: additional,
  };
}

test("IA Libera: la richiesta dice di compilare il modulo e archiviare gli altri dati", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ia-libera-"));
  try {
    const filePath = path.join(dir, "test.pdf");
    await writeFile(filePath, Buffer.from("%PDF-1.4\n%%EOF"));
    const request = await buildPdfPureAiRequest({ filePath });
    const prompt = request.input.flatMap((item) => item.content || []).map((item) => item.text || "").join("\n");
    assert.equal(PDF_PURE_AI_READER_VERSION, "pure-ai-native-pdf-v1.0.20-ia-libera");
    assert.match(prompt, /COMPILARE IL MODULO DI CONFRONTO/i);
    assert.match(prompt, /DATI DA CONSERVARE PER L'ATTIVAZIONE SUCCESSIVA/i);
    assert.match(prompt, /non esiste una pagina o una sezione obbligatoria/i);
    assert.match(prompt, /non trasform[a-z ]*automaticamente un prezzo generale in prezzo di fascia/i);
    const schema = request.text.format.schema;
    assert.ok(schema.properties.supplies);
    assert.ok(schema.properties.additional_data);
    assert.equal(schema.properties.additional_data.items.properties.field.enum, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("IA Libera: Plenitude conserva i sei dati economici senza reinterpretarli", () => {
  const normalized = normalizePureAiOutput(output({
    commodity: "dual",
    supplies: [
      {
        commodity: "electricity",
        identity: identity("Eni Plenitude", "Fixa Time Luce Base", 5),
        annual_consumption: consumption({ total: 2196, evidence: "Consumo annuo dal 01/05/2025 al 30/04/2026 2.196 kWh" }),
        price: price({ type: "fixed", single: 0.149077, evidence: "di cui spesa per la vendita di energia elettrica 0,149077 €/kWh" }),
        fixed_fee: fixed({ value: 12.105, text: "12,105000 €/mese", unit: "€/mese", period: "month", page: 5, evidence: "di cui spesa per la vendita di energia elettrica 12,105000 €/mese" }),
      },
      {
        commodity: "gas",
        identity: identity("Eni Plenitude", "Fixa Time Gas Base", 2),
        annual_consumption: consumption({ total: 1363, unit: "Smc", evidence: "In un anno hai consumato 1.363 Smc dal 01/05/2025 al 30/04/2026" }),
        price: price({ type: "fixed", single: 0.410829, unit: "€/Smc", evidence: "di cui spesa per la vendita di gas naturale 0,410829 €/Smc" }),
        fixed_fee: fixed({ value: 12, text: "12,000000 €/mese", unit: "€/mese", period: "month", page: 2, evidence: "di cui spesa per la vendita di gas naturale 12,000000 €/mese" }),
      },
    ],
  }));
  assert.equal(normalized.consumo_luce_kwh, 2196);
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.149077);
  assert.equal(normalized.quota_fissa_dettaglio_luce.commercial_component.value, 12.105);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, 145.26);
  assert.equal(normalized.consumo_gas_smc, 1363);
  assert.equal(normalized.prezzo_gas_eur_smc, 0.410829);
  assert.equal(normalized.quota_fissa_vendita_gas_eur_anno, 144);
});

test("IA Libera: un prezzo generale esplicito non viene sovrascritto dai valori F1 F2 F3", () => {
  const normalized = normalizePureAiOutput(output({
    supplies: [{
      commodity: "electricity",
      identity: identity("HERA COMM S.p.A.", "Servizio Tutele Graduali D", 6),
      annual_consumption: consumption({ total: 1628.91, evidence: "Consumo annuo dal 01.06.2025 al 31.05.2026 1.628,91 kWh" }),
      price: price({
        type: "variable", single: 0.152429, f1: 0.117891, f2: 0.144582, f3: 0.132897,
        index: "PUN Index GME", periodicity: "mensile",
        evidence: "di cui spesa per la vendita di energia elettrica 0,152429 €/kWh; valori CELD F1 0,117891 F2 0,144582 F3 0,132897",
      }),
      fixed_fee: fixed({ value: -6.1, text: "-6,100000 €/mese", unit: "€/mese", period: "month", page: 6, evidence: "di cui spesa per la vendita di energia elettrica -6,100000 €/mese" }),
    }],
  }));
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.152429);
  assert.equal(normalized.prezzo_luce_f1_eur_kwh, 0.117891);
  assert.equal(normalized.quota_fissa_dettaglio_luce.commercial_component.value, -6.1);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, -73.2);
  assert.equal(normalized.quota_fissa_dettaglio_luce.selected_for_comparison, "commercial_component");
});

test("IA Libera: senza F0 calcola una media semplice indicativa di F1 F2 F3", () => {
  const normalized = normalizePureAiOutput(output({
    supplies: [{
      commodity: "electricity",
      identity: identity("Fornitore Test", "Indicizzata a fasce", 2),
      annual_consumption: consumption({ total: 3000, evidence: "Consumo annuo ultimi 12 mesi 3.000 kWh" }),
      price: price({ type: "variable", f1: 0.12, f2: 0.15, f3: 0.13, index: "PUN", evidence: "Prezzo F1 0,12 €/kWh; F2 0,15 €/kWh; F3 0,13 €/kWh" }),
      fixed_fee: fixed({ value: 10, text: "10 €/mese", unit: "€/mese", period: "month", page: 2, evidence: "Quota fissa vendita 10 €/mese" }),
    }],
  }));
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.133333);
  const diagnostic = normalized.diagnostics.find((item) => item.field === "prezzo_luce_eur_kwh");
  assert.equal(diagnostic.method, "deterministic_arithmetic_average");
  assert.equal(diagnostic.derivation.estimated, true);
  assert.equal(normalized.readiness.confronto.luce.status, "completo");
});

test("IA Libera: conserva i dati secondari noti e sconosciuti per il passaggio di attivazione", () => {
  const additional = [
    { field: "pod", commodity: "electricity", value_text: "IT001E12345678", value_number: null, unit: null, page: 1, label: "POD", evidence: "POD IT001E12345678", confidence: 100 },
    { field: "codice_contratto", commodity: "electricity", value_text: "ABC-999", value_number: null, unit: null, page: 1, label: "Codice contratto", evidence: "Codice contratto ABC-999", confidence: 100 },
  ];
  const normalized = normalizePureAiOutput(output({
    supplies: [{
      commodity: "electricity",
      identity: identity("Fornitore Test", "Offerta Test", 1),
      annual_consumption: consumption({ total: 1000, evidence: "Consumo annuo ultimi 12 mesi 1.000 kWh" }),
      price: price({ type: "fixed", single: 0.1, evidence: "Prezzo energia 0,10 €/kWh" }),
      fixed_fee: fixed({ value: 8, text: "8 €/mese", unit: "€/mese", period: "month", page: 1, evidence: "Quota fissa vendita 8 €/mese" }),
    }],
    additional,
  }));
  assert.equal(normalized.pod, "IT001E12345678");
  assert.deepEqual(normalized.activation_data_archive, additional);
  assert.equal(normalized.ai.activation_archive_count, 2);
});

test("IA Libera: il campo consumo annuo non accetta un consumo dichiarato soltanto del periodo", () => {
  const normalized = normalizePureAiOutput(output({
    supplies: [{
      commodity: "electricity",
      identity: identity("Fornitore Test", "Offerta Test", 1),
      annual_consumption: consumption({ total: 450, evidence: "Consumo del periodo fatturato 450 kWh" }),
      price: price({ type: "fixed", single: 0.1, evidence: "Prezzo energia 0,10 €/kWh" }),
      fixed_fee: fixed({ value: 8, text: "8 €/mese", unit: "€/mese", period: "month", page: 1, evidence: "Quota fissa vendita 8 €/mese" }),
    }],
  }));
  assert.equal(normalized.consumo_luce_kwh, undefined);
  assert.ok(normalized.ai.rejected_questions.some((item) => item.question_id === "consumo_luce_kwh" && item.reason === "form_consumption_not_annual"));
});
