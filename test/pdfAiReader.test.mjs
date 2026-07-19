import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildPdfAiRequest, PDF_AI_PRIMARY_MODEL, runPdfAiShadow } from "../lib/pdfAiReader.js";

async function withPdf(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ol-ai-reader-"));
  const filePath = path.join(dir, "test.pdf");
  await fs.writeFile(filePath, Buffer.from("%PDF-1.4\nshadow test"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return filePath;
}

function validAiOutput() {
  return {
    document: { document_type: "bill", supplier: "Test Energia", commodity: "electricity", customer_type: "consumer", page_count: 1 },
    quality: { native_text_quality: "good", visual_quality: "good", table_density: "low", ocr_recommended: false },
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
  const oldMode = process.env.PDF_AI_MODE;
  delete process.env.PDF_AI_MODE;
  let calls = 0;
  const result = await runPdfAiShadow({ transport: async () => { calls += 1; } });
  if (oldMode === undefined) delete process.env.PDF_AI_MODE;
  else process.env.PDF_AI_MODE = oldMode;
  assert.equal(result.status, "disabled");
  assert.equal(calls, 0);
});

test("in shadow senza chiave segnala indisponibilità senza inviare il PDF", async () => {
  const oldMode = process.env.PDF_AI_MODE;
  process.env.PDF_AI_MODE = "shadow";
  let calls = 0;
  const result = await runPdfAiShadow({ apiKey: "", transport: async () => { calls += 1; } });
  if (oldMode === undefined) delete process.env.PDF_AI_MODE;
  else process.env.PDF_AI_MODE = oldMode;
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "missing_openai_api_key");
  assert.equal(calls, 0);
});

test("costruisce una richiesta Responses privata, pinned e a schema strict", async (t) => {
  const filePath = await withPdf(t);
  const request = await buildPdfAiRequest({ filePath, pageCount: 8 });
  assert.equal(request.model, PDF_AI_PRIMARY_MODEL);
  assert.equal(request.store, false);
  assert.equal(request.input[1].content[0].detail, "high");
  assert.match(request.input[1].content[0].file_data, /^data:application\/pdf;base64,/);
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
});

test("il trasporto mock restituisce candidati IA senza chiamate reali", async (t) => {
  const filePath = await withPdf(t);
  const oldMode = process.env.PDF_AI_MODE;
  process.env.PDF_AI_MODE = "shadow";
  let captured;
  const result = await runPdfAiShadow({
    filePath,
    apiKey: "test-key",
    legacyNormalized: { parser_version: "legacy", page_count: 1, diagnostics: [] },
    transport: async ({ request }) => {
      captured = request;
      return { id: "resp_test", output_text: JSON.stringify(validAiOutput()) };
    },
  });
  if (oldMode === undefined) delete process.env.PDF_AI_MODE;
  else process.env.PDF_AI_MODE = oldMode;
  assert.equal(result.status, "completed");
  assert.equal(result.response_id, "resp_test");
  assert.equal(result.candidates[0].field, "consumo_luce_kwh");
  assert.equal(result.candidates[0].source, "ai");
  assert.equal(captured.store, false);
});

test("un errore del provider resta confinato nello shadow", async (t) => {
  const filePath = await withPdf(t);
  const oldMode = process.env.PDF_AI_MODE;
  process.env.PDF_AI_MODE = "shadow";
  const result = await runPdfAiShadow({
    filePath,
    apiKey: "test-key",
    legacyNormalized: { diagnostics: [] },
    transport: async () => { throw new Error("provider_down"); },
  });
  if (oldMode === undefined) delete process.env.PDF_AI_MODE;
  else process.env.PDF_AI_MODE = oldMode;
  assert.equal(result.status, "failed");
  assert.match(result.reason, /provider_down/);
});
