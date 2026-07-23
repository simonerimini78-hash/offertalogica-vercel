import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runPdfAiEndpointObservation } from "../lib/pdfAiEndpoint.js";
import { pdfAiConfig } from "../lib/pdfAiConfig.js";
import { runPdfAiFallback } from "../lib/pdfAiReader.js";

async function withPdf(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ol-ai-consolidated-"));
  const filePath = path.join(dir, "bolletta-foto.pdf");
  await fs.writeFile(filePath, Buffer.from("%PDF-1.4\nconsolidated test"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return filePath;
}

function generalOutput({ includeEconomic = false } = {}) {
  const candidates = [
    {
      field: "fornitore", value_text: "HERA COMM S.p.A.", value_number: null, unit: null,
      commodity: "dual", page: 1, label: "Fornitore", evidence: "HERA COMM S.p.A.",
      semantic_role: "identifier", confidence: 96, agrees_with: [], contradicts: [],
    },
    {
      field: "pod", value_text: "IT001E49734340", value_number: null, unit: null,
      commodity: "electricity", page: 2, label: "POD", evidence: "POD IT001E49734340",
      semantic_role: "identifier", confidence: 96, agrees_with: [], contradicts: [],
    },
    {
      field: "pdr", value_text: "03081001496205", value_number: null, unit: null,
      commodity: "gas", page: 3, label: "PDR", evidence: "PDR 03081001496205",
      semantic_role: "identifier", confidence: 96, agrees_with: [], contradicts: [],
    },
    {
      field: "consumo_luce_kwh", value_text: null, value_number: 732.8, unit: "kWh/anno",
      commodity: "electricity", page: 2, label: "Consumo annuo", evidence: "Consumo annuo 732,8 kWh",
      semantic_role: "actual_customer_value", confidence: 94, agrees_with: [], contradicts: [],
    },
    {
      field: "consumo_gas_smc", value_text: null, value_number: 516.41, unit: "Smc/anno",
      commodity: "gas", page: 3, label: "Consumo annuo", evidence: "Consumo annuo 516,41 Smc",
      semantic_role: "actual_customer_value", confidence: 94, agrees_with: [], contradicts: [],
    },
  ];
  if (includeEconomic) {
    candidates.push(
      {
        field: "prezzo_luce_eur_kwh", value_text: null, value_number: 0.180313, unit: "EUR/kWh",
        commodity: "electricity", page: 4, label: "Spesa per la vendita di energia elettrica - componente energia",
        evidence: "Spesa per la vendita di energia elettrica componente energia 0,180313 €/kWh",
        semantic_role: "sales_component", confidence: 95, agrees_with: [], contradicts: [],
      },
      {
        field: "quota_fissa_vendita_luce_eur_anno", value_text: null, value_number: 85.2, unit: "EUR/POD/anno",
        commodity: "electricity", page: 4, label: "Quota fissa commercializzazione vendita energia elettrica",
        evidence: "Quota fissa commercializzazione vendita energia elettrica 85,20 €/POD/anno",
        semantic_role: "sales_component", confidence: 95, agrees_with: [], contradicts: [],
      },
    );
  }
  return {
    document: { document_type: "bill", supplier: "HERA COMM S.p.A.", commodity: "dual", customer_type: "consumer", page_count: 5 },
    quality: { native_text_quality: "none", visual_quality: "readable", table_density: "high", ocr_recommended: true },
    page_map: [
      { page: 1, role: "summary", summary: "Dati cliente" },
      { page: 4, role: "economic", summary: "Dettaglio economico luce" },
      { page: 5, role: "economic", summary: "Dettaglio economico gas" },
    ],
    candidates,
    conflicts: [],
    review_reasons: [],
  };
}

function generalOutputWithUnsafeEconomics() {
  const output = generalOutput();
  output.candidates.push(
    {
      field: "prezzo_luce_eur_kwh", value_text: null, value_number: 0.225209, unit: "EUR/kWh",
      commodity: "electricity", page: 4, label: "Prezzo medio totale", evidence: "Prezzo medio totale 0,225209 €/kWh",
      semantic_role: "sales_component", confidence: 95, agrees_with: [], contradicts: [],
    },
    {
      field: "quota_fissa_vendita_luce_eur_anno", value_text: null, value_number: 22.8, unit: "EUR/POD/anno",
      commodity: "electricity", page: 4, label: "Quota fissa rete", evidence: "Quota fissa rete 22,80 €/POD/anno",
      semantic_role: "sales_component", confidence: 95, agrees_with: [], contradicts: [],
    },
    {
      field: "prezzo_gas_eur_smc", value_text: null, value_number: 0.718778, unit: "EUR/Smc",
      commodity: "gas", page: 5, label: "Costo medio totale", evidence: "Costo medio totale 0,718778 €/Smc",
      semantic_role: "sales_component", confidence: 95, agrees_with: [], contradicts: [],
    },
    {
      field: "quota_fissa_vendita_gas_eur_anno", value_text: null, value_number: 30, unit: "EUR/PDR/anno",
      commodity: "gas", page: 5, label: "Quota fissa trasporto rete", evidence: "Quota fissa trasporto rete 30,00 €/PDR/anno",
      semantic_role: "sales_component", confidence: 95, agrees_with: [], contradicts: [],
    },
  );
  return output;
}

function economicOutput() {
  const row = (overrides) => ({
    page: 4,
    commodity: "electricity",
    section_label: "Spesa per la vendita",
    row_label: "Componente energia",
    quantity_number: null,
    quantity_unit: null,
    unit_value_number: null,
    unit_value_unit: null,
    amount_number: null,
    amount_unit: "EUR",
    component_role: "other",
    evidence: "riga economica",
    confidence: 95,
    ...overrides,
  });
  return {
    document: { document_type: "bill", commodity: "dual", customer_type: "consumer", page_count: 5 },
    rows: [
      row({
        commodity: "electricity", page: 4, row_label: "Componente energia vendita",
        unit_value_number: 0.180313, unit_value_unit: "EUR/kWh", component_role: "sales_variable",
        evidence: "Spesa per la vendita di energia elettrica componente energia 0,180313 €/kWh",
      }),
      row({
        commodity: "electricity", page: 4, row_label: "Quota fissa commercializzazione vendita",
        unit_value_number: 7.1, unit_value_unit: "EUR/POD/mese", component_role: "sales_fixed",
        evidence: "Quota fissa commercializzazione vendita energia elettrica 7,10 €/POD/mese",
      }),
      row({
        commodity: "electricity", page: 4, row_label: "Prezzo medio totale",
        unit_value_number: 0.225209, unit_value_unit: "EUR/kWh", component_role: "average_or_total",
        evidence: "Prezzo medio totale 0,225209 €/kWh",
      }),
      row({
        commodity: "gas", page: 5, section_label: "Spesa per la vendita gas", row_label: "Materia prima gas",
        unit_value_number: 0.44075, unit_value_unit: "EUR/Smc", component_role: "sales_variable",
        evidence: "Spesa per la vendita gas naturale materia prima gas 0,440750 €/Smc",
      }),
      row({
        commodity: "gas", page: 5, section_label: "Spesa per la vendita gas", row_label: "Quota fissa commercializzazione vendita gas",
        unit_value_number: 10, unit_value_unit: "EUR/PDR/mese", component_role: "sales_fixed",
        evidence: "Quota fissa commercializzazione vendita gas naturale 10,00 €/PDR/mese",
      }),
      row({
        commodity: "gas", page: 5, section_label: "Rete", row_label: "Trasporto e distribuzione",
        unit_value_number: 0.278028, unit_value_unit: "EUR/Smc", component_role: "network_variable",
        evidence: "Rete trasporto e distribuzione 0,278028 €/Smc",
      }),
    ],
    conditions: [
      {
        field: "indice_riferimento_luce", value_text: "PUN Index", value_number: null, unit: null,
        commodity: "electricity", page: 4, label: "Indice", evidence: "Indice PUN Index",
        semantic_role: "offer_value", confidence: 92,
      },
      {
        field: "indice_riferimento_gas", value_text: "PSV day ahead", value_number: null, unit: null,
        commodity: "gas", page: 5, label: "Indice", evidence: "Indice PSV day ahead",
        semantic_role: "offer_value", confidence: 92,
      },
    ],
  };
}

function sequentialTransport(outputs, requests) {
  return async ({ request }) => {
    requests.push(request);
    const output = outputs.shift();
    if (!output) throw new Error("unexpected_extra_ai_call");
    return { id: `resp_${requests.length}`, output_text: JSON.stringify(output) };
  };
}

test("Step 8.8.8.8: una sola chiamata quando il passaggio generale è già completo", async (t) => {
  const filePath = await withPdf(t);
  const requests = [];
  const result = await runPdfAiFallback({
    filePath,
    filename: "bolletta.pdf",
    legacyNormalized: { parser_version: "legacy", page_count: 5, commodity: "luce", diagnostics: [] },
    parserCandidates: [],
    deadlineAt: Date.now() + 40_000,
    env: { PDF_AI_MODE: "shadow", PDF_AI_TIMEOUT_MS: "20000" },
    apiKey: "test-key",
    transport: sequentialTransport([generalOutput({ includeEconomic: true })], requests),
  });
  assert.equal(result.status, "completed");
  assert.equal(result.attempts, 1);
  assert.equal(result.economic_recovery_attempted, false);
  assert.equal(requests.length, 1);
  assert.equal("detail" in requests[0].input[1].content[0], false);
  assert.equal(requests[0].background, false);
});

test("Step 8.8.8.8: il secondo e ultimo passaggio inventaria solo le righe economiche", async (t) => {
  const filePath = await withPdf(t);
  const requests = [];
  const result = await runPdfAiFallback({
    filePath,
    filename: "bolletta.pdf",
    legacyNormalized: { parser_version: "legacy", page_count: 5, commodity: "dual", diagnostics: [] },
    parserCandidates: [],
    deadlineAt: Date.now() + 45_000,
    env: { PDF_AI_MODE: "shadow", PDF_AI_TIMEOUT_MS: "20000" },
    apiKey: "test-key",
    transport: sequentialTransport([generalOutputWithUnsafeEconomics(), economicOutput()], requests),
  });
  assert.equal(result.status, "completed");
  assert.equal(result.attempts, 2);
  assert.equal(result.economic_recovery_attempted, true);
  assert.equal(result.economic_recovery_completed, 1);
  assert.equal(result.economic_recovery_rows, 6);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].text.format.name, "offertalogica_pdf_economic_row_inventory");
  const fields = new Set(result.candidates.map((candidate) => candidate.field));
  assert.equal(fields.has("prezzo_luce_eur_kwh"), true);
  assert.equal(fields.has("prezzo_gas_eur_smc"), true);
  assert.equal(fields.has("quota_fissa_vendita_luce_eur_anno"), true);
  assert.equal(fields.has("quota_fissa_vendita_gas_eur_anno"), true);
});

test("Step 8.8.8.8: l'endpoint usa davvero la pipeline consolidata senza mutare parser/OCR", async (t) => {
  const filePath = await withPdf(t);
  const normalized = {
    parser_version: "legacy",
    page_count: 5,
    recognized: false,
    kind: "unknown",
    commodity: "unknown",
    customer_type: "unknown",
    diagnostics: [],
    warnings: ["nessun_dato_utile_rilevato"],
  };
  const requests = [];
  const result = await runPdfAiEndpointObservation({
    filePath,
    filename: "bolletta.pdf",
    fileSizeBytes: 500_000,
    normalized,
    deadlineAt: Date.now() + 45_000,
    config: pdfAiConfig({ PDF_AI_MODE: "shadow", PDF_AI_MODEL: "gpt-4.1-mini-2025-04-14", PDF_AI_TIMEOUT_MS: "20000" }),
    previewEnvironment: true,
    archiveReady: true,
    apiKey: "test-key",
    transport: sequentialTransport([generalOutputWithUnsafeEconomics(), economicOutput()], requests),
  });
  assert.equal(result.endpoint_version, "8.8.8.8");
  assert.equal(result.status, "observed");
  assert.equal(result.diagnostics.endpoint.execution_order, "parser_ocr_ai");
  assert.equal(result.diagnostics.pipeline.attempts, 2);
  assert.equal(result.observation.review_plan.applied, false);
  const fields = Object.fromEntries(result.observation.review_plan.review_fields.map((entry) => [entry.field, entry.normalized_value]));
  assert.equal(fields.prezzo_luce_eur_kwh, 0.180313);
  assert.equal(fields.prezzo_gas_eur_smc, 0.44075);
  assert.equal(fields.quota_fissa_vendita_luce_eur_anno, 85.2);
  assert.equal(fields.quota_fissa_vendita_gas_eur_anno, 120);
  assert.notEqual(fields.prezzo_luce_eur_kwh, 0.225209);
  assert.notEqual(fields.prezzo_gas_eur_smc, 0.718778);
  assert.notEqual(fields.quota_fissa_vendita_luce_eur_anno, 22.8);
  assert.notEqual(fields.quota_fissa_vendita_gas_eur_anno, 30);
  assert.equal(normalized.prezzo_luce_eur_kwh, undefined);
  assert.equal(normalized.quota_fissa_vendita_gas_eur_anno, undefined);
  assert.equal(requests.length, 2);
});
