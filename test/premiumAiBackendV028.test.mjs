import assert from "node:assert/strict";
import test from "node:test";
import {
  analysisCompletionStatus,
  createMeteredOpenAiTransport,
  createUsageMeter,
  estimatePremiumAiCost,
  premiumAiConfig,
  sanitizePremiumAnalysisData,
} from "../lib/premiumAiBackend.js";

test("Premium v0.28 legge configurazione server e non inventa tariffe IA", () => {
  const config = premiumAiConfig({
    SUPABASE_URL: "https://example.supabase.co/",
    SUPABASE_SECRET_KEY: "sb_secret_test",
    OPENAI_API_KEY: "test-openai",
    PDF_AI_PRIMARY_MODEL: "model-test",
  });
  assert.equal(config.supabaseUrl, "https://example.supabase.co");
  assert.equal(config.serviceKey, "sb_secret_test");
  assert.equal(config.model, "model-test");
  assert.equal(config.pricing.inputPerMillion, null);
  assert.equal(config.pricing.outputPerMillion, null);
  assert.equal(estimatePremiumAiCost({ inputTokens: 100, outputTokens: 20 }, config.pricing), null);
});

test("Il costo stimato usa token normali, cache e output solo con tariffe configurate", () => {
  const cost = estimatePremiumAiCost({
    inputTokens: 1_000_000,
    cachedInputTokens: 200_000,
    outputTokens: 100_000,
  }, {
    inputPerMillion: 2,
    cachedInputPerMillion: 0.5,
    outputPerMillion: 8,
  });
  assert.equal(cost, 2.5);
});

test("Il trasporto OpenAI misura tutte le chiamate Responses senza esporre chiavi", async () => {
  const meter = createUsageMeter();
  const transport = createMeteredOpenAiTransport({
    meter,
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers.Authorization, "Bearer api-test");
      return new Response(JSON.stringify({
        id: "resp_test",
        model: "model-test",
        usage: {
          input_tokens: 120,
          input_tokens_details: { cached_tokens: 20 },
          output_tokens: 30,
          output_tokens_details: { reasoning_tokens: 5 },
          total_tokens: 150,
        },
        output_text: "{}",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const body = await transport({ request: { model: "model-test" }, apiKey: "api-test", attempt: 1, profile: "primary" });
  assert.equal(body.id, "resp_test");
  assert.equal(meter.totals.inputTokens, 120);
  assert.equal(meter.totals.cachedInputTokens, 20);
  assert.equal(meter.totals.outputTokens, 30);
  assert.equal(meter.totals.responseIds[0], "resp_test");
});

test("La bozza IA elimina il contenuto grezzo e resta esplicitamente soggetta a revisione", () => {
  const sanitized = sanitizePremiumAnalysisData({
    recognized: true,
    commodity: "luce",
    consumo_luce_kwh: 2000,
    _reader_trace: {
      trace_version: "trace",
      response_id: "resp_1",
      raw_ai: { personal: "non conservare" },
      primary_raw_ai: { raw: true },
      recovery_raw_ai: { raw: true },
    },
  }, { inputTokens: 10, outputTokens: 5, totalTokens: 15, calls: [] });
  assert.equal(sanitized._reader_trace.raw_ai, undefined);
  assert.equal(sanitized._reader_trace.primary_raw_ai, undefined);
  assert.equal(sanitized._premium_analysis.staff_review_required, true);
  assert.equal(sanitized._premium_analysis.customer_visible, false);
});

test("La completezza richiede consumo, prezzo e quota fissa per ogni fornitura", () => {
  assert.deepEqual(analysisCompletionStatus({
    recognized: true,
    commodity: "luce",
    consumo_luce_kwh: 2000,
    prezzo_luce_eur_kwh: 0.12,
    quota_fissa_vendita_luce_eur_anno: 120,
  }), { status: "completed", missing: [] });

  const partial = analysisCompletionStatus({
    recognized: true,
    commodity: "gas",
    consumo_gas_smc: 800,
    prezzo_gas_eur_smc: 0.4,
  });
  assert.equal(partial.status, "partial");
  assert.deepEqual(partial.missing, ["quota_fissa_vendita_gas_eur_anno"]);
});

import { Readable } from "node:stream";
import { createPremiumAiAnalysisHandler } from "../api/premium-ai-analysis.js";

function jsonResponse(body, status = 200) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); },
    end(value = "") { this.body += String(value); },
  };
}

test("L’handler completo crea la bozza, registra audit e non pubblica un esito cliente", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || "GET";
    calls.push({ url: String(url), method, body: init.body ? String(init.body) : "" });
    if (String(url).endsWith("/auth/v1/user")) return jsonResponse({ id: "staff-1", email: "staff@example.it" });
    if (String(url).includes("/rest/v1/premium_staff_members?")) return jsonResponse([{ user_id: "staff-1", role: "admin", active: true }]);
    if (String(url).includes("/rest/v1/premium_checks?")) return jsonResponse([{ id: "check-1", bill_id: "bill-1", user_id: "user-1", status: "in_review", outcome: "pending" }]);
    if (String(url).includes("/rest/v1/premium_bills?") && method === "GET") return jsonResponse([{ id: "bill-1", user_id: "user-1", utility_id: "utility-1", commodity: "electricity", original_file_name: "bolletta.pdf", file_size: 24, storage_bucket: "premium-bills", storage_path: "user-1/bill-1.pdf", processing_status: "ready_for_review", customer_status: "in_review", deleted_at: null }]);
    if (String(url).includes("status=in.%28queued%2Crunning%29")) return jsonResponse([]);
    if (String(url).includes("order=run_number.desc")) return jsonResponse([]);
    if (String(url).endsWith("/rest/v1/premium_analysis_runs") && method === "POST") return jsonResponse([{ id: "run-1", run_number: 1 }], 201);
    if (String(url).includes("/storage/v1/object/sign/")) return jsonResponse({ signedURL: "https://signed.example/bill.pdf" });
    if (String(url) === "https://signed.example/bill.pdf") return new Response(Buffer.from("%PDF-1.4\n%%EOF"), { status: 200, headers: { "content-type": "application/pdf" } });
    if (String(url).includes("/rest/v1/premium_analysis_runs?") && method === "PATCH") return jsonResponse([{ id: "run-1" }]);
    if (String(url).includes("/rest/v1/premium_bills?") && method === "PATCH") return new Response(null, { status: 204 });
    if (String(url).endsWith("/rest/v1/premium_cost_events") && method === "POST") return new Response(null, { status: 201 });
    throw new Error(`Unexpected fetch ${method} ${url}`);
  };

  const analyzePdf = async ({ transport }) => {
    await transport({
      request: { model: "model-test" },
      apiKey: "openai-test",
      attempt: 1,
      profile: "primary",
    });
    return {
      parser_version: "reader-test",
      recognized: true,
      commodity: "luce",
      consumo_luce_kwh: 2100,
      prezzo_luce_eur_kwh: 0.12,
      quota_fissa_vendita_luce_eur_anno: 120,
      warnings: [],
      ai: { model: "model-test" },
      _reader_trace: { raw_ai: { secret: "remove" } },
    };
  };

  const meteredFetch = async (url, init) => {
    if (String(url) === "https://api.openai.com/v1/responses") {
      return jsonResponse({
        id: "resp-1",
        model: "model-test",
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
        output_text: "{}",
      });
    }
    return fetchImpl(url, init);
  };

  const handler = createPremiumAiAnalysisHandler({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_test",
      OPENAI_API_KEY: "openai-test",
      PDF_AI_PRIMARY_MODEL: "model-test",
      PREMIUM_AI_INPUT_EUR_PER_1M_TOKENS: "2",
      PREMIUM_AI_OUTPUT_EUR_PER_1M_TOKENS: "8",
    },
    fetchImpl: meteredFetch,
    analyzePdf,
  });
  const req = Readable.from([Buffer.from(JSON.stringify({ checkId: "check-1" }))]);
  req.method = "POST";
  req.headers = { authorization: "Bearer user-jwt", host: "preview.example" };
  req.socket = { remoteAddress: "127.0.0.1" };
  const res = mockResponseRecorder();
  await handler(req, res);

  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.run.status, "completed");
  assert.equal(body.run.totalTokens, 120);
  assert.equal(body.run.extractedData._reader_trace.raw_ai, undefined);
  assert.ok(calls.some(call => call.url.endsWith("/rest/v1/premium_cost_events") && call.method === "POST"));
  assert.ok(calls.some(call => call.url.includes("/rest/v1/premium_analysis_runs?") && call.method === "PATCH"));
  assert.ok(!calls.some(call => call.body.includes("premium_staff_complete_check") || call.body.includes("customer_message")));
});
