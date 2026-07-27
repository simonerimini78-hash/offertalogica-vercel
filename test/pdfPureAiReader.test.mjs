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

test("buildPdfPureAiRequest invia il PDF con schema compatto per il confronto", async () => {
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
  assert.equal(request.max_output_tokens, 1800);
  assert.deepEqual(request.text.format.schema.required, ["document", "electricity", "gas"]);
  assert.ok(request.text.format.schema.properties.electricity.properties.annual_consumption);
  assert.ok(request.text.format.schema.properties.electricity.properties.price);
  assert.ok(request.text.format.schema.properties.electricity.properties.fixed_fee);
  assert.equal(request.text.format.schema.properties.answers, undefined);
  assert.match(content[1].text, /consumo annuo/i);
  assert.match(content[1].text, /prezzo commerciale/i);
  assert.match(content[1].text, /quota fissa/i);
  assert.doesNotMatch(content[1].text, /consumo_luce_kwh|prezzo_luce_f0_eur_kwh|quota_fissa_vendita_luce/i);
  await fs.rm(dir, { recursive: true, force: true });
});

test("normalizePureAiOutput accetta una risposta sparsa e conserva i dati parziali", () => {
  const full = electricityOutput();
  const sparse = {
    document: full.document,
    answers: full.answers.filter((item) => item.found),
  };
  const normalized = normalizePureAiOutput(sparse, {
    model: "test-model",
    responseId: "resp_sparse",
  });

  assert.equal(sparse.answers.length < PDF_PURE_AI_QUESTION_IDS.length, true);
  assert.equal(normalized.fornitore, "Hera Comm");
  assert.equal(normalized.pod, "IT001E12345678");
  assert.equal(normalized.consumo_luce_kwh, 2740);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, 85.2);
  assert.equal(normalized.ai.accepted_count >= 8, true);
});

test("richiesta unica: non esistono più profili full ed essential duplicati", async () => {
  const first = await buildPdfPureAiRequest({ fileId: "file_test", profile: "full" });
  const second = await buildPdfPureAiRequest({ fileId: "file_test", profile: "essential" });
  assert.equal(first.max_output_tokens, 1800);
  assert.equal(second.max_output_tokens, 1800);
  assert.deepEqual(first.text.format.schema, second.text.format.schema);
  assert.equal(first.text.format.name, "offertalogica_comparison_essentials");
  assert.equal(first.text.format.schema.properties.answers, undefined);
});

test("timeout: esegue una sola chiamata e non avvia un secondo tentativo costoso", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pure-ai-timeout-single-"));
  const filePath = path.join(dir, "documento.pdf");
  await fs.writeFile(filePath, "%PDF-test");
  let calls = 0;
  await assert.rejects(
    extractPdfPureAi({
      filePath,
      apiKey: "test-key",
      env: { PDF_AI_TIMEOUT_MS: "9000" },
      transport: async () => {
        calls += 1;
        throw new Error("openai_timeout");
      },
    }),
    /openai_timeout/,
  );
  assert.equal(calls, 1);
  await fs.rm(dir, { recursive: true, force: true });
});

test("regressione Sorgenia: una risposta compatta conserva la lettura parziale invece di annullarla", () => {
  const answers = [
    { question_id: "fornitore", found: true, value_text: "Sorgenia", value_number: null, unit: null, period: "none", page: 1, label: "Fornitore", evidence: "Sorgenia", confidence: 100 },
    { question_id: "fornitore_luce", found: true, value_text: "Sorgenia", value_number: null, unit: null, period: "none", page: 1, label: "Fornitore", evidence: "Sorgenia", confidence: 100 },
    { question_id: "customer_type", found: true, value_text: "business", value_number: null, unit: null, period: "none", page: 1, label: "Intestatario", evidence: "Romagna Allevamenti Societa' Agricola S.S.", confidence: 100 },
    { question_id: "intestatario", found: true, value_text: "Romagna Allevamenti Societa' Agricola S.S.", value_number: null, unit: null, period: "none", page: 1, label: "Intestatario", evidence: "Romagna Allevamenti Societa' Agricola S.S.", confidence: 100 },
    { question_id: "codice_fiscale", found: true, value_text: "02525880395", value_number: null, unit: null, period: "none", page: 1, label: "Codice Fiscale", evidence: "Codice Fiscale 02525880395", confidence: 100 },
    { question_id: "codice_cliente", found: true, value_text: "4615991", value_number: null, unit: null, period: "none", page: 1, label: "CODICE CLIENTE", evidence: "CODICE CLIENTE 4615991", confidence: 100 },
    { question_id: "pod", found: true, value_text: "IT001E53942290", value_number: null, unit: null, period: "none", page: 1, label: "POD", evidence: "POD IT001E53942290", confidence: 100 },
    { question_id: "potenza_impegnata_kw", found: true, value_text: "10,0 kW", value_number: 10, unit: "kW", period: "none", page: 2, label: "Potenza impegnata", evidence: "Potenza impegnata: 10,0 kW", confidence: 100 },
    { question_id: "potenza_disponibile_kw", found: true, value_text: "11,0 kW", value_number: 11, unit: "kW", period: "none", page: 2, label: "Potenza disponibile", evidence: "Potenza disponibile: 11,0 kW", confidence: 100 },
    { question_id: "nome_offerta_luce", found: true, value_text: "Soluzione Luce Flexi", value_number: null, unit: null, period: "none", page: 2, label: "Prodotto attivo", evidence: "Prodotto attivo: Soluzione Luce Flexi", confidence: 100 },
    { question_id: "codice_offerta_luce", found: true, value_text: "SLFLE052012016", value_number: null, unit: null, period: "none", page: 2, label: "Codice prodotto", evidence: "Codice prodotto: SLFLE052012016", confidence: 100 },
    { question_id: "struttura_prezzo_luce", found: true, value_text: "per fasce", value_number: null, unit: null, period: "none", page: 2, label: "FASCE DI CONSUMO", evidence: "FASCE DI CONSUMO F1-F2-F3", confidence: 100 },
  ];
  const normalized = normalizePureAiOutput({
    document: { kind: "bill", commodity: "electricity", customer_type: "business", page_count: 2 },
    answers,
  });

  assert.equal(normalized.recognized, true);
  assert.equal(normalized.fornitore, "Sorgenia");
  assert.equal(normalized.pod, "IT001E53942290");
  assert.equal(normalized.potenza_impegnata_kw, 10);
  assert.equal(normalized.nome_offerta_luce, "Soluzione Luce Flexi");
  assert.equal(normalized.codice_offerta_luce, "SLFLE052012016");
  assert.equal(normalized.readiness.confronto.luce.status, "incompleto");
  assert.equal(normalized.ai.accepted_count >= 10, true);
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


test("quota fissa negativa: conserva il segno, annualizza e abilita l’autocompilazione", () => {
  const output = electricityOutput();
  const fixedAnswer = output.answers.find((item) => item.question_id === "quota_fissa_vendita_luce");
  Object.assign(fixedAnswer, {
    value_text: "-6,10 €/mese",
    value_number: -6.1,
    unit: "€/mese",
    period: "month",
    evidence: "di cui spesa per la vendita di energia elettrica -6,10 €/mese",
  });
  const normalized = normalizePureAiOutput(output, {
    model: "test-model",
    responseId: "resp_negative_fixed",
    transportMode: "pdf_originale",
    timings: { request_build_ms: 1, openai_ms: 1, total_ms: 2 },
  });

  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, -73.2);
  assert.equal(normalized.field_status.quota_fissa_vendita_luce_eur_anno.status, "completo");
  const fixed = normalized.data_contract.fields.quota_fissa_vendita_luce_eur_anno;
  assert.equal(fixed.normalized_value, -73.2);
  assert.equal(fixed.derivation.original_value, -6.1);
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

test("HTTP 500: non ripete automaticamente una chiamata a pagamento", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pure-ai-no-retry-500-"));
  const filePath = path.join(dir, "bolletta.pdf");
  await fs.writeFile(filePath, "%PDF-test");
  let attempts = 0;
  await assert.rejects(
    extractPdfPureAi({
      filePath,
      apiKey: "test-key",
      env: { PDF_AI_TIMEOUT_MS: "12000" },
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
  assert.equal(attempts, 1);
  await fs.rm(dir, { recursive: true, force: true });
});

test("HTTP 500: l'errore viene restituito dopo un solo tentativo", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pure-ai-single-500-"));
  const filePath = path.join(dir, "bolletta.pdf");
  await fs.writeFile(filePath, "%PDF-test");
  let attempts = 0;
  await assert.rejects(
    extractPdfPureAi({
      filePath,
      apiKey: "test-key",
      env: { PDF_AI_TIMEOUT_MS: "12000" },
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
  assert.equal(attempts, 1);
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

test("buildPdfPureAiRequest usa file_id senza incorporare Base64 quando il file è già su OpenAI", async () => {
  const request = await buildPdfPureAiRequest({ fileId: "file_test_123", model: "test-model" });
  const content = request.input[1].content;
  const fileInput = content.find((item) => item.type === "input_file");
  assert.deepEqual(fileInput, { type: "input_file", file_id: "file_test_123" });
  assert.equal("file_data" in fileInput, false);
  assert.equal("filename" in fileInput, false);
});

test("PDF grande: upload temporaneo Files API, Responses con file_id e cancellazione finale", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pure-ai-file-id-"));
  const filePath = path.join(dir, "bolletta-grande.pdf");
  await fs.writeFile(filePath, Buffer.concat([Buffer.from("%PDF-test\n"), Buffer.alloc(1_100_000)]));
  let uploadCalls = 0;
  let responseCalls = 0;
  let deleteCalls = 0;
  let capturedRequest;
  const normalized = await extractPdfPureAi({
    filePath,
    filename: "bolletta-grande.pdf",
    apiKey: "test-key",
    env: {
      PDF_AI_TIMEOUT_MS: "20000",
      PDF_AI_FILE_ID_THRESHOLD_BYTES: "1000000",
      PDF_AI_FILE_UPLOAD_TIMEOUT_MS: "5000",
      PDF_AI_FILE_DELETE_TIMEOUT_MS: "500",
    },
    fileUploadTransport: async ({ filePath: uploadedPath, filename, apiKey }) => {
      uploadCalls += 1;
      assert.equal(uploadedPath, filePath);
      assert.equal(filename, "bolletta-grande.pdf");
      assert.equal(apiKey, "test-key");
      return { id: "file_large_test" };
    },
    transport: async ({ request }) => {
      responseCalls += 1;
      capturedRequest = request;
      return { id: "resp_file_id", output_text: JSON.stringify(electricityOutput()) };
    },
    fileDeleteTransport: async ({ fileId, apiKey }) => {
      deleteCalls += 1;
      assert.equal(fileId, "file_large_test");
      assert.equal(apiKey, "test-key");
      return { id: fileId, deleted: true };
    },
  });
  const fileInput = capturedRequest.input[1].content.find((item) => item.type === "input_file");
  assert.deepEqual(fileInput, { type: "input_file", file_id: "file_large_test" });
  assert.equal(uploadCalls, 1);
  assert.equal(responseCalls, 1);
  assert.equal(deleteCalls, 1);
  assert.equal(normalized.ai.transport_mode, "openai_file_id");
  assert.equal(normalized.ai.openai_file_deleted, true);
  assert.equal(normalized.ai.openai_file_delete_error, null);
  assert.equal(normalized.ai.input_file_bytes > 1_000_000, true);
  assert.equal(normalized.ai.file_id_threshold_bytes, 1_000_000);
  await fs.rm(dir, { recursive: true, force: true });
});

test("PDF piccolo: conserva il trasporto inline e non usa la Files API", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pure-ai-inline-small-"));
  const filePath = path.join(dir, "bolletta-piccola.pdf");
  await fs.writeFile(filePath, "%PDF-test");
  let uploadCalls = 0;
  let deleteCalls = 0;
  let capturedRequest;
  const normalized = await extractPdfPureAi({
    filePath,
    apiKey: "test-key",
    env: { PDF_AI_TIMEOUT_MS: "12000", PDF_AI_FILE_ID_THRESHOLD_BYTES: "1000000" },
    fileUploadTransport: async () => {
      uploadCalls += 1;
      return { id: "file_not_expected" };
    },
    transport: async ({ request }) => {
      capturedRequest = request;
      return { id: "resp_inline", output_text: JSON.stringify(electricityOutput()) };
    },
    fileDeleteTransport: async () => {
      deleteCalls += 1;
      return { deleted: true };
    },
  });
  const fileInput = capturedRequest.input[1].content.find((item) => item.type === "input_file");
  assert.equal(fileInput.file_data.startsWith("data:application/pdf;base64,"), true);
  assert.equal(uploadCalls, 0);
  assert.equal(deleteCalls, 0);
  assert.equal(normalized.ai.transport_mode, "pdf_originale");
  assert.equal(normalized.ai.openai_file_deleted, null);
  await fs.rm(dir, { recursive: true, force: true });
});

test("PDF grande: una risposta valida usa un solo upload e una sola analisi", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pure-ai-file-id-single-"));
  const filePath = path.join(dir, "bolletta-grande.pdf");
  await fs.writeFile(filePath, Buffer.concat([Buffer.from("%PDF-test\n"), Buffer.alloc(1_100_000)]));
  let uploadCalls = 0;
  let responseCalls = 0;
  let deleteCalls = 0;
  const normalized = await extractPdfPureAi({
    filePath,
    apiKey: "test-key",
    env: { PDF_AI_TIMEOUT_MS: "20000", PDF_AI_FILE_ID_THRESHOLD_BYTES: "1000000" },
    fileUploadTransport: async () => { uploadCalls += 1; return { id: "file_single_test" }; },
    transport: async ({ request }) => {
      responseCalls += 1;
      assert.equal(request.input[1].content.find((item) => item.type === "input_file").file_id, "file_single_test");
      return { id: "resp_single_file_id", output_text: JSON.stringify(electricityOutput()) };
    },
    fileDeleteTransport: async () => { deleteCalls += 1; return { deleted: true }; },
  });
  assert.equal(uploadCalls, 1);
  assert.equal(responseCalls, 1);
  assert.equal(deleteCalls, 1);
  assert.equal(normalized.ai.openai_attempts, 1);
  assert.equal(normalized.ai.retry_count, 0);
  await fs.rm(dir, { recursive: true, force: true });
});

test("PDF grande: dopo un HTTP 500 il file temporaneo OpenAI viene cancellato", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pure-ai-file-id-fail-cleanup-"));
  const filePath = path.join(dir, "bolletta-grande.pdf");
  await fs.writeFile(filePath, Buffer.concat([Buffer.from("%PDF-test\n"), Buffer.alloc(1_100_000)]));
  let uploadCalls = 0;
  let responseCalls = 0;
  let deleteCalls = 0;
  await assert.rejects(
    extractPdfPureAi({
      filePath,
      apiKey: "test-key",
      env: { PDF_AI_TIMEOUT_MS: "20000", PDF_AI_FILE_ID_THRESHOLD_BYTES: "1000000" },
      fileUploadTransport: async () => { uploadCalls += 1; return { id: "file_fail_cleanup" }; },
      transport: async () => {
        responseCalls += 1;
        return new Response(JSON.stringify({ error: { message: "temporary server error" } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      },
      fileDeleteTransport: async () => { deleteCalls += 1; return { deleted: true }; },
    }),
    /openai_http_500/,
  );
  assert.equal(uploadCalls, 1);
  assert.equal(responseCalls, 1);
  assert.equal(deleteCalls, 1);
  await fs.rm(dir, { recursive: true, force: true });
});

test("PDF grande: errore di cancellazione non annulla un'analisi riuscita e resta diagnosticato", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pure-ai-file-delete-fail-"));
  const filePath = path.join(dir, "bolletta-grande.pdf");
  await fs.writeFile(filePath, Buffer.concat([Buffer.from("%PDF-test\n"), Buffer.alloc(1_100_000)]));
  const normalized = await extractPdfPureAi({
    filePath,
    apiKey: "test-key",
    env: {
      PDF_AI_TIMEOUT_MS: "20000",
      PDF_AI_FILE_ID_THRESHOLD_BYTES: "1000000",
      PDF_AI_FILE_DELETE_TIMEOUT_MS: "500",
    },
    fileUploadTransport: async () => ({ id: "file_delete_fail" }),
    transport: async () => ({ id: "resp_delete_fail", output_text: JSON.stringify(electricityOutput()) }),
    fileDeleteTransport: async () => new Response(JSON.stringify({ error: { message: "delete failed" } }), {
      status: 500,
      headers: { "content-type": "application/json" },
    }),
  });
  assert.equal(normalized.ai.transport_mode, "openai_file_id");
  assert.equal(normalized.ai.openai_file_deleted, false);
  assert.match(normalized.ai.openai_file_delete_error, /openai_file_delete_http_500/);
  await fs.rm(dir, { recursive: true, force: true });
});

test("default Files API: usa purpose user_data, scadenza di un'ora e file_id nella Responses API", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pure-ai-default-files-api-"));
  const filePath = path.join(dir, "bolletta-grande.pdf");
  const sourceBytes = Buffer.concat([Buffer.from("%PDF-test\n"), Buffer.alloc(19_694_477 - Buffer.byteLength("%PDF-test\n"))]);
  await fs.writeFile(filePath, sourceBytes);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/v1/files") && options.method === "POST") {
      assert.ok(options.body instanceof FormData);
      assert.equal(options.body.get("purpose"), "user_data");
      assert.equal(options.body.get("expires_after[anchor]"), "created_at");
      assert.equal(options.body.get("expires_after[seconds]"), "3600");
      const uploadedFile = options.body.get("file");
      assert.equal(uploadedFile.type, "application/pdf");
      assert.equal(uploadedFile.size, sourceBytes.length);
      assert.equal(uploadedFile.name, "bolletta-grande.pdf");
      return new Response(JSON.stringify({ id: "file_default_transport" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (String(url).endsWith("/v1/responses")) {
      const request = JSON.parse(options.body);
      const fileInput = request.input[1].content.find((item) => item.type === "input_file");
      assert.deepEqual(fileInput, { type: "input_file", file_id: "file_default_transport" });
      return new Response(JSON.stringify({ id: "resp_default_transport", output_text: JSON.stringify(electricityOutput()) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (String(url).endsWith("/v1/files/file_default_transport") && options.method === "DELETE") {
      return new Response(JSON.stringify({ id: "file_default_transport", deleted: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`fetch inattesa: ${url}`);
  };
  try {
    const normalized = await extractPdfPureAi({
      filePath,
      filename: "bolletta-grande.pdf",
      apiKey: "test-key",
      env: {
        PDF_AI_TIMEOUT_MS: "20000",
        PDF_AI_FILE_ID_THRESHOLD_BYTES: "1000000",
      },
    });
    assert.equal(normalized.ai.transport_mode, "openai_file_id");
    assert.equal(normalized.ai.openai_file_deleted, true);
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
