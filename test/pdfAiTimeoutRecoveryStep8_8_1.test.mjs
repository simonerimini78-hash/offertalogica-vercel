import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  PDF_AI_ADAPTER_VERSION,
  runPdfAiFallbackImages,
} from "../lib/pdfAiReader.js";
import {
  PDF_AI_FALLBACK_PIPELINE_VERSION,
  applyControlledPdfAiImageFallback,
} from "../lib/pdfAiFallback.js";

async function withRasterPages(t, count = 2) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ol-ai-recovery-"));
  const files = [];
  for (let index = 0; index < count; index += 1) {
    const filePath = path.join(dir, `page-${index + 1}.jpg`);
    await fs.writeFile(filePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]));
    files.push({ filePath, mimeType: "image/jpeg", page: index + 1 });
  }
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return files;
}

function emergencyOutput() {
  return {
    document: {
      document_type: "bill",
      supplier: "Sorgenia",
      commodity: "electricity",
      customer_type: "business",
      page_count: 2,
    },
    candidates: [
      {
        field: "fornitore",
        value_text: "Sorgenia",
        value_number: null,
        unit: null,
        commodity: "electricity",
        page: 1,
        label: "Logo fornitore",
        evidence: "Sorgenia",
        semantic_role: "classification",
        confidence: 95,
      },
      {
        field: "kind",
        value_text: "bill",
        value_number: null,
        unit: null,
        commodity: "electricity",
        page: 1,
        label: "Bolletta energia elettrica",
        evidence: "BOLLETTA PER LA FORNITURA DI ENERGIA ELETTRICA",
        semantic_role: "classification",
        confidence: 95,
      },
      {
        field: "commodity",
        value_text: "electricity",
        value_number: null,
        unit: null,
        commodity: "electricity",
        page: 1,
        label: "Fornitura",
        evidence: "ENERGIA ELETTRICA",
        semantic_role: "classification",
        confidence: 95,
      },
      {
        field: "pod",
        value_text: "IT001E53942290",
        value_number: null,
        unit: null,
        commodity: "electricity",
        page: 1,
        label: "POD",
        evidence: "POD IT001E53942290",
        semantic_role: "identifier",
        confidence: 95,
      },
      {
        field: "codice_cliente",
        value_text: "4615991",
        value_number: null,
        unit: null,
        commodity: "electricity",
        page: 1,
        label: "CODICE CLIENTE",
        evidence: "CODICE CLIENTE 4615991",
        semantic_role: "identifier",
        confidence: 95,
      },
    ],
  };
}

function baseline() {
  return {
    parser_version: "v106.2-client-raster-transport-1",
    page_count: 2,
    diagnostics: [],
    kind: "unknown",
    commodity: "unknown",
    recognized: false,
    confidence: "low",
    warnings: ["pdf_grande_rasterizzato_nel_browser", "ai_verifica_utente_richiesta"],
    textExtracted: 0,
    needsReview: true,
  };
}

test("Step 8.8.1 espone le nuove versioni di recupero timeout", () => {
  assert.equal(PDF_AI_ADAPTER_VERSION, "2.4.1");
  assert.equal(PDF_AI_FALLBACK_PIPELINE_VERSION, "v106.8.1-timeout-recovery-1");
});

test("dopo openai_timeout esegue un recupero compatto sulla prima pagina", async (t) => {
  const imageFiles = await withRasterPages(t);
  const requests = [];
  let calls = 0;
  const result = await runPdfAiFallbackImages({
    imageFiles,
    filename: "sorgenia 2.pdf",
    legacyNormalized: baseline(),
    deadlineAt: Date.now() + 20_000,
    env: {
      PDF_AI_MODE: "fallback",
      PDF_AI_TIMEOUT_MS: "42000",
      PDF_AI_EMERGENCY_TIMEOUT_MS: "9000",
    },
    apiKey: "test-key",
    transport: async ({ request }) => {
      requests.push(request);
      calls += 1;
      if (calls === 1) throw new Error("openai_timeout");
      return { id: "resp_emergency", output_text: JSON.stringify(emergencyOutput()) };
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.status, "completed");
  assert.equal(result.attempts, 2);
  assert.equal(result.recovered_from, "openai_timeout");
  assert.equal(result.request_profile, "emergency");
  assert.equal(result.primary_timeout_ms, 19_000);
  assert.ok(result.recovery_timeout_ms >= 5_000);

  const recoveryRequest = requests[1];
  const recoveryContent = recoveryRequest.input[1].content;
  assert.equal(recoveryRequest.max_output_tokens, 1_200);
  assert.equal(recoveryRequest.text.format.name, "offertalogica_pdf_emergency_identity");
  assert.equal(recoveryContent.filter((item) => item.type === "input_image").length, 1);
  assert.equal(recoveryContent.find((item) => item.type === "input_image").detail, "low");
  assert.match(recoveryRequest.input[0].content, /emergency visual reader/i);
});

test("il recupero timeout produce almeno un documento riconosciuto invece di unknown", async (t) => {
  const imageFiles = await withRasterPages(t);
  let calls = 0;
  const normalized = await applyControlledPdfAiImageFallback(imageFiles, {
    filename: "sorgenia 2.pdf",
    normalized: baseline(),
    deadlineAt: Date.now() + 20_000,
    env: {
      PDF_AI_MODE: "fallback",
      PDF_AI_TIMEOUT_MS: "42000",
      PDF_AI_EMERGENCY_TIMEOUT_MS: "9000",
    },
    apiKey: "test-key",
    transport: async () => {
      calls += 1;
      if (calls === 1) throw new Error("openai_timeout");
      return { id: "resp_emergency", output_text: JSON.stringify(emergencyOutput()) };
    },
  });

  assert.equal(normalized.kind, "bolletta");
  assert.equal(normalized.commodity, "luce");
  assert.equal(normalized.recognized, true);
  assert.equal(normalized.pod, "IT001E53942290");
  assert.equal(normalized.codice_cliente_luce, "4615991");
  assert.equal(normalized.ai.applied, true);
  assert.equal(normalized.ai.attempts, 2);
  assert.equal(normalized.ai.recovered_from, "openai_timeout");
  assert.equal(normalized.ai.request_profile, "emergency");
});

test("errori diversi dal timeout non vengono ritentati", async (t) => {
  const imageFiles = await withRasterPages(t);
  let calls = 0;
  const result = await runPdfAiFallbackImages({
    imageFiles,
    filename: "sorgenia 2.pdf",
    legacyNormalized: baseline(),
    deadlineAt: Date.now() + 20_000,
    env: { PDF_AI_MODE: "fallback", PDF_AI_TIMEOUT_MS: "42000" },
    apiKey: "test-key",
    transport: async () => {
      calls += 1;
      throw new Error("provider_down");
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "provider_down");
});

test("non avvia il recupero quando il budget residuo è insufficiente", async (t) => {
  const imageFiles = await withRasterPages(t);
  let calls = 0;
  const result = await runPdfAiFallbackImages({
    imageFiles,
    filename: "sorgenia 2.pdf",
    legacyNormalized: baseline(),
    deadlineAt: Date.now() + 4_000,
    env: { PDF_AI_MODE: "fallback", PDF_AI_TIMEOUT_MS: "42000" },
    apiKey: "test-key",
    transport: async () => {
      calls += 1;
      throw new Error("openai_timeout");
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.status, "failed");
  assert.equal(result.recovery_attempted, false);
  assert.equal(result.recovery_reason, "insufficient_time_budget");
});
