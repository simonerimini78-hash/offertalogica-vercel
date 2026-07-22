import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPdfAiReviewRequest,
  runPdfAiReview,
  validatePdfAiReviewOutput,
} from "../lib/pdfAiClient.js";

function validOutput(overrides = {}) {
  return {
    document: {
      document_type: "bill",
      commodity: "electricity",
      customer_type: "consumer",
      page_count: 2,
    },
    candidates: [
      {
        field: "pod",
        value_text: "IT001E12345678",
        page: 1,
        label: "POD",
        evidence: "POD IT001E12345678",
        semantic_role: "identifier",
        confidence: 96,
      },
    ],
    review_reasons: ["POD recovered visually"],
    ...overrides,
  };
}

function responsePayload(output = validOutput()) {
  return {
    id: "resp_test_123",
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(output) }],
      },
    ],
    usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 },
  };
}

function mockResponse({ ok = true, status = 200, payload = responsePayload(), requestId = "req_test_123" } = {}) {
  return {
    ok,
    status,
    headers: { get: (name) => name.toLowerCase() === "x-request-id" ? requestId : null },
    json: async () => payload,
  };
}

test("Step 8.1: costruisce una richiesta PDF strutturata e non persistente", () => {
  const request = buildPdfAiReviewRequest({
    pdfBuffer: Buffer.from("%PDF-test"),
    filename: "bolletta.pdf",
    model: "model-from-env",
    pageCount: 2,
    gaps: ["pod", "prezzo_luce_eur_kwh", "pod"],
  });

  assert.equal(request.model, "model-from-env");
  assert.equal(request.store, false);
  assert.equal(request.background, false);
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.equal(request.input[1].content[0].type, "input_file");
  assert.match(request.input[1].content[0].file_data, /^data:application\/pdf;base64,/);
  assert.match(request.input[1].content[1].text, /pod/);
  assert.doesNotMatch(request.input[1].content[1].text, /prezzo_luce_eur_kwh/);
  assert.doesNotMatch(JSON.stringify(request), /OPENAI_API_KEY|Bearer/);
});

test("Step 8.1: valida soltanto output con forma e ruoli esatti", () => {
  assert.equal(validatePdfAiReviewOutput(validOutput()).valid, true);
  assert.equal(validatePdfAiReviewOutput(validOutput({
    candidates: [{ ...validOutput().candidates[0], semantic_role: "classification" }],
  })).valid, false);
  assert.equal(validatePdfAiReviewOutput({ ...validOutput(), extra: true }).valid, false);
});

test("Step 8.1: esegue il trasporto iniettato e restituisce un risultato normalizzato", async () => {
  let captured;
  const transport = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return mockResponse();
  };

  const result = await runPdfAiReview({
    pdfBuffer: Buffer.from("%PDF-test"),
    filename: "bolletta.pdf",
    model: "model-from-env",
    apiKey: "secret-test-key",
    timeoutMs: 500,
    transport,
  });

  assert.equal(result.ok, true);
  assert.equal(result.output.candidates[0].field, "pod");
  assert.equal(result.response_id, "resp_test_123");
  assert.equal(result.request_id, "req_test_123");
  assert.equal(result.usage.total_tokens, 200);
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers.Authorization, "Bearer secret-test-key");
  assert.equal(captured.body.store, false);
  assert.ok(captured.options.signal instanceof AbortSignal);
});

test("Step 8.1: normalizza il timeout senza propagare eccezioni", async () => {
  const transport = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });

  const result = await runPdfAiReview({
    pdfBuffer: Buffer.from("%PDF-test"),
    model: "model-from-env",
    apiKey: "secret-test-key",
    timeoutMs: 15,
    transport,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "timeout");
  assert.equal(result.error.code, "timeout");
  assert.equal(result.error.retryable, true);
});

test("Step 8.1: rifiuta JSON provider sintatticamente invalido", async () => {
  const transport = async () => mockResponse({
    payload: {
      id: "resp_bad_json",
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "not-json" }] }],
    },
  });

  const result = await runPdfAiReview({
    pdfBuffer: Buffer.from("%PDF-test"),
    model: "model-from-env",
    apiKey: "secret-test-key",
    transport,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_provider_json");
});

test("Step 8.1: rifiuta output che non rispetta lo schema locale", async () => {
  const transport = async () => mockResponse({
    payload: responsePayload(validOutput({ candidates: [{ field: "pod" }] })),
  });

  const result = await runPdfAiReview({
    pdfBuffer: Buffer.from("%PDF-test"),
    model: "model-from-env",
    apiKey: "secret-test-key",
    transport,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_provider_output");
});

test("Step 8.1: normalizza gli errori HTTP senza esporre il messaggio provider", async () => {
  const transport = async () => mockResponse({
    ok: false,
    status: 429,
    payload: { error: { code: "rate_limit_exceeded", message: "sensitive provider detail" } },
  });

  const result = await runPdfAiReview({
    pdfBuffer: Buffer.from("%PDF-test"),
    model: "model-from-env",
    apiKey: "secret-test-key",
    transport,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "provider_http_error");
  assert.equal(result.error.http_status, 429);
  assert.equal(result.error.provider_code, "rate_limit_exceeded");
  assert.equal(result.error.retryable, true);
  assert.doesNotMatch(JSON.stringify(result), /sensitive provider detail|secret-test-key|%PDF-test/);
});

test("Step 8.1: senza chiave non invoca il trasporto", async () => {
  let called = false;
  const result = await runPdfAiReview({
    pdfBuffer: Buffer.from("%PDF-test"),
    model: "model-from-env",
    apiKey: "",
    transport: async () => {
      called = true;
      return mockResponse();
    },
  });

  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "missing_api_key");
});
