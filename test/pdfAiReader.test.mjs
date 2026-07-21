import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildPdfAiRequest,
  PDF_AI_PRIMARY_MODEL,
  runPdfAiFallback,
  runPdfAiShadow,
} from "../lib/pdfAiReader.js";

async function withPdf(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ol-ai-reader-"));
  const filePath = path.join(dir, "test.pdf");
  await fs.writeFile(filePath, Buffer.from("%PDF-1.4\nvisual fallback test"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return filePath;
}

function validAiOutput() {
  return {
    document: { document_type: "bill", supplier: "Test Energia", commodity: "electricity", customer_type: "consumer", page_count: 1 },
    quality: { native_text_quality: "poor", visual_quality: "good", table_density: "low", ocr_recommended: false },
    page_map: [{ page: 1, role: "riepilogo", summary: "Dati fornitura" }],
    candidates: [{
      field: "consumo_luce_kwh",
      value_text: null,
      value_number: 2700,
      unit: "kWh/anno",
      commodity: "electricity",
      page: 1,
      label: "Consumo annuo",
      evidence: "Consumo annuo 2.700 kWh",
      semantic_role: "actual_customer_value",
      confidence: 94,
      agrees_with: ["parser"],
      contradicts: [],
    }],
    conflicts: [],
    review_reasons: [],
  };
}

test("l'adapter resta spento per default e non chiama il trasporto", async () => {
  let calls = 0;
  const result = await runPdfAiShadow({
    env: {},
    transport: async () => { calls += 1; },
  });
  assert.equal(result.status, "disabled");
  assert.equal(calls, 0);
});

test("in shadow senza chiave segnala indisponibilità senza inviare il PDF", async () => {
  let calls = 0;
  const result = await runPdfAiShadow({
    env: { PDF_AI_MODE: "shadow" },
    apiKey: "",
    transport: async () => { calls += 1; },
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "missing_openai_api_key");
  assert.equal(calls, 0);
});

test("costruisce una richiesta Responses non persistente, pinned e a schema strict", async (t) => {
  const filePath = await withPdf(t);
  const request = await buildPdfAiRequest({ filePath, pageCount: 8 });
  const fileInput = request.input[1].content[0];
  assert.equal(request.model, PDF_AI_PRIMARY_MODEL);
  assert.equal(request.store, false);
  assert.equal(fileInput.type, "input_file");
  assert.equal(Object.hasOwn(fileInput, "detail"), false);
  assert.match(fileInput.file_data, /^data:application\/pdf;base64,/);
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
});

test("il trasporto mock restituisce candidati IA senza chiamate reali", async (t) => {
  const filePath = await withPdf(t);
  let captured;
  const result = await runPdfAiShadow({
    filePath,
    apiKey: "test-key",
    env: { PDF_AI_MODE: "shadow" },
    legacyNormalized: { parser_version: "legacy", page_count: 1, diagnostics: [] },
    transport: async ({ request }) => {
      captured = request;
      return { id: "resp_test", output_text: JSON.stringify(validAiOutput()) };
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.response_id, "resp_test");
  assert.equal(result.candidates[0].field, "consumo_luce_kwh");
  assert.equal(result.candidates[0].source, "ai");
  assert.equal(captured.store, false);
});

test("il fallback non invia il PDF senza consenso esplicito", async (t) => {
  const filePath = await withPdf(t);
  let calls = 0;
  const result = await runPdfAiFallback({
    filePath,
    apiKey: "test-key",
    env: { PDF_AI_MODE: "fallback" },
    consentGranted: false,
    transport: async () => { calls += 1; },
  });
  assert.equal(result.status, "consent_required");
  assert.equal(calls, 0);
});

test("il fallback autorizzato usa lo stesso contratto strutturato", async (t) => {
  const filePath = await withPdf(t);
  let calls = 0;
  const result = await runPdfAiFallback({
    filePath,
    apiKey: "test-key",
    env: { PDF_AI_MODE: "fallback" },
    consentGranted: true,
    legacyNormalized: { parser_version: "legacy", page_count: 1, diagnostics: [] },
    transport: async () => {
      calls += 1;
      return { id: "resp_fallback", output_text: JSON.stringify(validAiOutput()) };
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.response_id, "resp_fallback");
  assert.equal(calls, 1);
});

test("un errore del provider resta confinato nello shadow", async (t) => {
  const filePath = await withPdf(t);
  const result = await runPdfAiShadow({
    filePath,
    apiKey: "test-key",
    env: { PDF_AI_MODE: "shadow" },
    legacyNormalized: { diagnostics: [] },
    transport: async () => { throw new Error("provider_down"); },
  });
  assert.equal(result.status, "failed");
  assert.match(result.reason, /provider_down/);
});
