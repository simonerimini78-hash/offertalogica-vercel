import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyControlledPdfAiFallback,
  PDF_AI_FALLBACK_PIPELINE_VERSION,
  shouldAttemptPdfAiFallback,
} from "../lib/pdfAiFallback.js";

async function withPdf(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ol-ai-fallback-"));
  const filePath = path.join(dir, "scan.pdf");
  await fs.writeFile(filePath, Buffer.from("%PDF-1.4\ncontrolled visual fallback"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return filePath;
}

function baseUnknown(overrides = {}) {
  return {
    parser_version: "v105.6-test",
    page_count: 2,
    diagnostics: [],
    kind: "unknown",
    commodity: "unknown",
    recognized: false,
    confidence: "low",
    warnings: ["nessun_dato_utile_rilevato"],
    textExtracted: 0,
    needsReview: true,
    ...overrides,
  };
}

function candidate({ field, valueText = null, valueNumber = null, unit = null, role, evidence, confidence = 96, commodity = "electricity", contradicts = [] }) {
  return {
    field,
    value_text: valueText,
    value_number: valueNumber,
    unit,
    commodity,
    page: 1,
    label: field.replaceAll("_", " "),
    evidence,
    semantic_role: role,
    confidence,
    agrees_with: [],
    contradicts,
  };
}

function electricityOutput(extraCandidates = []) {
  return {
    document: { document_type: "bill", supplier: "Visual Energia", commodity: "electricity", customer_type: "consumer", page_count: 2 },
    quality: { native_text_quality: "none", visual_quality: "readable", table_density: "medium", ocr_recommended: true },
    page_map: [{ page: 1, role: "frontespizio", summary: "Riepilogo fornitura" }],
    candidates: [
      candidate({ field: "fornitore", valueText: "Visual Energia", role: "identifier", evidence: "Visual Energia" }),
      candidate({ field: "kind", valueText: "bill", role: "classification", evidence: "Bolletta energia elettrica" }),
      candidate({ field: "commodity", valueText: "electricity", role: "classification", evidence: "Energia elettrica" }),
      candidate({ field: "customer_type", valueText: "consumer", role: "classification", evidence: "Cliente domestico" }),
      candidate({ field: "consumo_luce_kwh", valueNumber: 2500, unit: "kWh/anno", role: "actual_customer_value", evidence: "Consumo annuo 2.500 kWh" }),
      candidate({ field: "prezzo_luce_eur_kwh", valueNumber: 0.2, unit: "EUR/kWh", role: "actual_customer_value", evidence: "Prezzo vendita energia 0,200000 EUR/kWh" }),
      candidate({ field: "quota_fissa_vendita_luce_eur_anno", valueNumber: 120, unit: "EUR/POD/anno", role: "sales_component", evidence: "Quota fissa vendita 120 EUR/POD/anno" }),
      candidate({ field: "pod", valueText: "IT001E12345678", role: "identifier", evidence: "POD IT001E12345678" }),
      ...extraCandidates,
    ],
    conflicts: [],
    review_reasons: ["Verificare visivamente i valori prima dell'uso"],
  };
}

function mockTransport(output, onCall = () => {}) {
  return async () => {
    onCall();
    return { id: "resp_step8_mock", output_text: JSON.stringify(output) };
  };
}

const fallbackEnv = Object.freeze({ PDF_AI_MODE: "fallback", PDF_AI_TIMEOUT_MS: "12000" });

test("il fallback resta spento senza modalità esplicita", async (t) => {
  const filePath = await withPdf(t);
  let calls = 0;
  const disabled = await applyControlledPdfAiFallback(filePath, {
    normalized: baseUnknown(),
    env: {},
    apiKey: "test-key",
    transport: mockTransport(electricityOutput(), () => { calls += 1; }),
  });
  assert.equal(disabled.ai.reason, "disabled");
  assert.equal(disabled.ai.automatic_fallback, true);
  assert.equal(calls, 0);
});

test("senza chiave API il fallback fallisce in modo controllato", async (t) => {
  const filePath = await withPdf(t);
  let calls = 0;
  const result = await applyControlledPdfAiFallback(filePath, {
    normalized: baseUnknown(),
    env: fallbackEnv,
    apiKey: "",
    transport: mockTransport(electricityOutput(), () => { calls += 1; }),
  });
  assert.equal(result.ai.attempted, true);
  assert.equal(result.ai.applied, false);
  assert.equal(result.ai.reason, "missing_openai_api_key");
  assert.equal(result.ai.automatic_fallback, true);
  assert.equal(calls, 0);
});

test("un risultato deterministico completo impedisce ogni invio all'AI", async (t) => {
  const filePath = await withPdf(t);
  const strong = baseUnknown({
    kind: "bolletta",
    commodity: "luce",
    recognized: true,
    fornitore: "Hera Comm",
    consumo_luce_kwh: 1008,
    prezzo_luce_eur_kwh: 0.190954,
    quota_fissa_vendita_luce_eur_anno: 145.2,
    pod: "IT001E51379686",
  });
  let calls = 0;
  const result = await applyControlledPdfAiFallback(filePath, {
    normalized: strong,
    env: fallbackEnv,
    apiKey: "test-key",
    transport: mockTransport(electricityOutput(), () => { calls += 1; }),
  });
  assert.equal(result.ai.applied, false);
  assert.equal(result.ai.reason, "deterministic_or_ocr_result_available");
  assert.equal(calls, 0);
});

test("il fallback completa solo campi mancanti e li espone come revisione esplicita", async (t) => {
  const filePath = await withPdf(t);
  const result = await applyControlledPdfAiFallback(filePath, {
    filename: "scan-illeggibile.pdf",
    normalized: baseUnknown(),
    env: fallbackEnv,
    apiKey: "test-key",
    transport: mockTransport(electricityOutput()),
  });

  assert.equal(result.ai.pipeline_version, PDF_AI_FALLBACK_PIPELINE_VERSION);
  assert.equal(result.ai.applied, true);
  assert.equal(result.recognized, true);
  assert.equal(result.kind, "bolletta");
  assert.equal(result.commodity, "luce");
  assert.equal(result.consumo_luce_kwh, 2500);
  assert.equal(result.prezzo_luce_eur_kwh, 0.2);
  assert.equal(result.quota_fissa_vendita_luce_eur_anno, 120);
  assert.equal(result.pod, "IT001E12345678");
  assert.equal(result.fornitore_luce, "Visual Energia");
  assert.equal(result.data_contract.parser.mode, "deterministic_with_controlled_visual_ai");

  const consumption = result.data_contract.fields.consumo_luce_kwh;
  assert.equal(consumption.provenance.origin, "pdf_visual_ai");
  assert.equal(consumption.autofill.allowed, false);
  assert.equal(consumption.autofill.review_selectable, true);
  assert.equal(consumption.autofill.requires_explicit_selection, true);
  assert.equal(result.data_contract.autofill_plan.review_fields.some((row) => row.source_field === "consumo_luce_kwh"), true);
});

test("un valore parser esistente non viene mai sovrascritto dall'AI", async (t) => {
  const filePath = await withPdf(t);
  const output = electricityOutput();
  output.candidates.find((item) => item.field === "prezzo_luce_eur_kwh").value_number = 0.99;
  output.candidates.find((item) => item.field === "prezzo_luce_eur_kwh").evidence = "Prezzo vendita energia 0,990000 EUR/kWh";
  const result = await applyControlledPdfAiFallback(filePath, {
    normalized: baseUnknown({ prezzo_luce_eur_kwh: 0.18 }),
    env: fallbackEnv,
    apiKey: "test-key",
    transport: mockTransport(output),
  });
  assert.equal(result.prezzo_luce_eur_kwh, 0.18);
  assert.equal(result.ai.rejected_fields.some((entry) => entry.field === "prezzo_luce_eur_kwh" && entry.reason === "protected_existing_value"), true);
  assert.notEqual(result.data_contract.fields.prezzo_luce_eur_kwh.provenance.origin, "pdf_visual_ai");
});

test("unità mensili non vengono accettate come quota annua", async (t) => {
  const filePath = await withPdf(t);
  const output = electricityOutput();
  const fixed = output.candidates.find((item) => item.field === "quota_fissa_vendita_luce_eur_anno");
  fixed.value_number = 10;
  fixed.unit = "EUR/mese";
  fixed.evidence = "Quota fissa vendita 10 EUR/mese";
  const result = await applyControlledPdfAiFallback(filePath, {
    normalized: baseUnknown(),
    env: fallbackEnv,
    apiKey: "test-key",
    transport: mockTransport(output),
  });
  assert.equal(result.ai.applied, true);
  assert.equal(result.quota_fissa_vendita_luce_eur_anno ?? null, null);
  assert.equal(result.ai.rejected_fields.some((entry) => entry.field === "quota_fissa_vendita_luce_eur_anno" && entry.reason === "value_or_unit_not_safe"), true);
});

test("candidati che contraddicono parser o OCR sono rifiutati", async (t) => {
  const filePath = await withPdf(t);
  const output = electricityOutput();
  const pod = output.candidates.find((item) => item.field === "pod");
  pod.contradicts = ["ocr"];
  const result = await applyControlledPdfAiFallback(filePath, {
    normalized: baseUnknown(),
    env: fallbackEnv,
    apiKey: "test-key",
    transport: mockTransport(output),
  });
  assert.equal(result.ai.applied, true);
  assert.equal(result.pod ?? null, null);
  assert.equal(result.ai.rejected_fields.some((entry) => entry.field === "pod" && entry.reason === "contradicts_existing_source"), true);
});

test("la policy richiede tempo residuo sufficiente e può limitare i nomi file", () => {
  const tooLate = shouldAttemptPdfAiFallback({
    normalized: baseUnknown(),
    filename: "scan.pdf",
    deadlineAt: Date.now() + 1000,
    env: fallbackEnv,
  });
  const blockedName = shouldAttemptPdfAiFallback({
    normalized: baseUnknown(),
    filename: "documento.pdf",
    env: { ...fallbackEnv, PDF_AI_FILENAME_PATTERN: "unoenergy" },
  });
  assert.equal(tooLate.reason, "insufficient_time_budget");
  assert.equal(blockedName.reason, "filename_not_allowed");
});
