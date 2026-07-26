import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  PDF_PURE_AI_QUESTION_IDS,
  PDF_PURE_AI_READER_VERSION,
  buildPdfPureAiRequest,
  extractPdfPureAi,
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
    confidence: 92,
    ...patch,
  });
}

function electricityOutput() {
  const answers = emptyAnswers();
  setAnswer(answers, "fornitore", { value_text: "Hera Comm", evidence: "Fornitore Hera Comm" });
  setAnswer(answers, "customer_type", { value_text: "Domestico residente", evidence: "Tipologia cliente Domestico residente" });
  setAnswer(answers, "intestatario", { value_text: "Mario Rossi", evidence: "Intestatario Mario Rossi" });
  setAnswer(answers, "codice_fiscale", { value_text: "RSSMRA80A01H501U", evidence: "Codice fiscale RSSMRA80A01H501U" });
  setAnswer(answers, "pod", { value_text: "IT001E12345678", evidence: "POD IT001E12345678" });
  setAnswer(answers, "potenza_impegnata_kw", { value_text: "3 kW", value_number: 3, unit: "kW", evidence: "Potenza impegnata 3 kW" });
  setAnswer(answers, "consumo_luce_kwh", { value_text: "2.740 kWh", value_number: 2740, unit: "kWh", evidence: "Consumo annuo 2.740 kWh" });
  setAnswer(answers, "prezzo_luce_eur_kwh", { value_text: "0,123456 €/kWh", value_number: 0.123456, unit: "€/kWh", evidence: "di cui vendita energia elettrica 0,123456 €/kWh" });
  setAnswer(answers, "quota_fissa_vendita_luce", { value_text: "7,10 €/mese", value_number: 7.1, unit: "€/mese", period: "month", evidence: "di cui vendita energia elettrica 7,10 €/mese" });
  setAnswer(answers, "tipo_prezzo_luce", { value_text: "Variabile", evidence: "Tipo prezzo Variabile" });
  setAnswer(answers, "indice_riferimento_luce", { value_text: "PUN", evidence: "Indice PUN" });
  setAnswer(answers, "spread_luce_eur_kwh", { value_text: "0,025 €/kWh", value_number: 0.025, unit: "€/kWh", evidence: "Spread 0,025 €/kWh" });
  return {
    document: { kind: "bill", commodity: "electricity", customer_type: "consumer", page_count: 4 },
    answers,
  };
}

test("buildPdfPureAiRequest invia direttamente il PDF originale", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pure-ai-native-"));
  const filePath = path.join(dir, "bolletta.pdf");
  await fs.writeFile(filePath, "%PDF-test");
  const request = await buildPdfPureAiRequest({ filePath, model: "test-model" });
  const content = request.input[1].content;
  const fileInput = content.find((item) => item.type === "input_file");
  assert.ok(fileInput.file_data.startsWith("data:application/pdf;base64,"));
  assert.equal(content.some((item) => item.type === "input_image"), false);
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.equal(request.store, false);
  assert.equal(request.max_output_tokens, 6500);
  await fs.rm(dir, { recursive: true, force: true });
});

test("normalizePureAiOutput mantiene il contratto e annualizza solo la quota mensile", () => {
  const normalized = normalizePureAiOutput(electricityOutput(), {
    model: "test-model",
    responseId: "resp_test",
    transportMode: "pdf_originale",
    timings: { request_build_ms: 3, openai_ms: 900, total_ms: 903 },
  });

  assert.equal(normalized.kind, "bolletta");
  assert.equal(normalized.commodity, "luce");
  assert.equal(normalized.customer_type, "privato");
  assert.equal(normalized.consumo_luce_kwh, 2740);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, 85.2);
  assert.equal(normalized.ai.transport_mode, "pdf_originale");
  assert.equal(normalized.ai.reader_version, PDF_PURE_AI_READER_VERSION);
  assert.equal(normalized.ai.openai_ms, 900);
  const fixed = normalized.data_contract.fields.quota_fissa_vendita_luce_eur_anno;
  assert.equal(fixed.provenance.source, "ai");
  assert.equal(fixed.provenance.origin, "pdf_visual_ai");
  assert.equal(fixed.derivation.original_value, 7.1);
  assert.equal(fixed.derivation.factor, 12);
  assert.equal(fixed.autofill.allowed, true);
});

test("regressione 504: la chiamata IA parte senza rasterizzazione che consuma il budget", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pure-ai-budget-"));
  const filePath = path.join(dir, "bolletta.pdf");
  await fs.writeFile(filePath, "%PDF-test");
  let capturedRequest;
  const startedAt = Date.now();
  const normalized = await extractPdfPureAi({
    filePath,
    apiKey: "test-key",
    deadlineAt: Date.now() + 10_500,
    transport: async ({ request }) => {
      capturedRequest = request;
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      return { id: "resp_budget", output_text: JSON.stringify(electricityOutput()) };
    },
  });
  assert.ok(Date.now() - startedAt >= 1_000);
  assert.equal(capturedRequest.input[1].content.some((item) => item.type === "input_file"), true);
  assert.equal(normalized.ai.transport_mode, "pdf_originale");
  assert.equal(normalized.consumo_luce_kwh, 2740);
  await fs.rm(dir, { recursive: true, force: true });
});

test("usa PDF_AI_PRIMARY_MODEL senza ereditare la vecchia variabile shadow", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pure-ai-model-"));
  const filePath = path.join(dir, "bolletta.pdf");
  await fs.writeFile(filePath, "%PDF-test");
  let capturedModel;
  await extractPdfPureAi({
    filePath,
    apiKey: "test-key",
    env: { PDF_AI_TIMEOUT_MS: "12000" },
    model: "gpt-4.1-test-primary",
    transport: async ({ request }) => {
      capturedModel = request.model;
      return { id: "resp_model", output_text: JSON.stringify(electricityOutput()) };
    },
  });
  assert.equal(capturedModel, "gpt-4.1-test-primary");
  await fs.rm(dir, { recursive: true, force: true });
});

test("retry mirato: un HTTP 500 OpenAI viene ritentato una sola volta e poi può riuscire", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pure-ai-retry-500-"));
  const filePath = path.join(dir, "bolletta.pdf");
  await fs.writeFile(filePath, "%PDF-test");
  let attempts = 0;
  const normalized = await extractPdfPureAi({
    filePath,
    apiKey: "test-key",
    env: { PDF_AI_TIMEOUT_MS: "12000", PDF_AI_RETRY_DELAY_MS: "0" },
    transport: async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: { message: "temporary server error" } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      return { id: "resp_retry_success", output_text: JSON.stringify(electricityOutput()) };
    },
  });
  assert.equal(attempts, 2);
  assert.equal(normalized.ai.openai_attempts, 2);
  assert.equal(normalized.ai.retry_count, 1);
  assert.equal(normalized.consumo_luce_kwh, 2740);
  await fs.rm(dir, { recursive: true, force: true });
});

test("retry mirato: due HTTP 500 OpenAI producono errore dopo esattamente due tentativi", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pure-ai-retry-double-500-"));
  const filePath = path.join(dir, "bolletta.pdf");
  await fs.writeFile(filePath, "%PDF-test");
  let attempts = 0;
  await assert.rejects(
    extractPdfPureAi({
      filePath,
      apiKey: "test-key",
      env: { PDF_AI_TIMEOUT_MS: "12000", PDF_AI_RETRY_DELAY_MS: "0" },
      transport: async () => {
        attempts += 1;
        return new Response(JSON.stringify({ error: { message: "temporary server error" } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      },
    }),
    /openai_http_500/,
  );
  assert.equal(attempts, 2);
  await fs.rm(dir, { recursive: true, force: true });
});

test("retry mirato: un HTTP 400 OpenAI non viene ritentato", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pure-ai-no-retry-400-"));
  const filePath = path.join(dir, "bolletta.pdf");
  await fs.writeFile(filePath, "%PDF-test");
  let attempts = 0;
  await assert.rejects(
    extractPdfPureAi({
      filePath,
      apiKey: "test-key",
      env: { PDF_AI_TIMEOUT_MS: "12000", PDF_AI_RETRY_DELAY_MS: "0" },
      transport: async () => {
        attempts += 1;
        return new Response(JSON.stringify({ error: { message: "bad request" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      },
    }),
    /openai_http_400/,
  );
  assert.equal(attempts, 1);
  await fs.rm(dir, { recursive: true, force: true });
});
