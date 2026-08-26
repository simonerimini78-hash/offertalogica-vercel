import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import {
  buildSitePdfAiEconomicEntry,
  createSitePdfUsageMeter,
  estimateSitePdfAiUsdCost,
  recordSitePdfAiEconomicEvent,
  siteCustomerType,
} from "../lib/sitePdfAiEconomics.js";

test("misura tutte le chiamate Responses senza alterare la risposta", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    id: "resp_test_1",
    usage: {
      input_tokens: 1000,
      input_tokens_details: { cached_tokens: 400 },
      output_tokens: 200,
      output_tokens_details: { reasoning_tokens: 50 },
      total_tokens: 1200,
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
  const meter = createSitePdfUsageMeter({ fetchImpl });
  const response = await meter.transport({
    request: { model: "gpt-4.1-2025-04-14", input: [] },
    apiKey: "test-key",
    profile: "primary",
  });
  assert.equal(response.ok, true);
  assert.equal(meter.totals.inputTokens, 1000);
  assert.equal(meter.totals.cachedInputTokens, 400);
  assert.equal(meter.totals.outputTokens, 200);
  assert.equal(meter.totals.reasoningTokens, 50);
  assert.equal(meter.totals.calls.length, 1);
  assert.deepEqual(meter.totals.responseIds, ["resp_test_1"]);
});

test("calcola il costo USD distinguendo input cache e output", () => {
  const cost = estimateSitePdfAiUsdCost({
    inputTokens: 1000,
    cachedInputTokens: 400,
    outputTokens: 200,
  }, "gpt-4.1-2025-04-14");
  assert.equal(cost, 0.003);
  assert.equal(estimateSitePdfAiUsdCost({ inputTokens: 1, outputTokens: 1 }, "modello-non-censito"), null);
});

test("classifica separatamente privato business e sconosciuto", () => {
  assert.equal(siteCustomerType("privato"), "consumer");
  assert.equal(siteCustomerType("consumer"), "consumer");
  assert.equal(siteCustomerType("business"), "business");
  assert.equal(siteCustomerType("P.IVA"), "business");
  assert.equal(siteCustomerType(""), "unknown");
});

test("distingue costo sostenuto, stimato e non prezzato in base al cambio disponibile", () => {
  const usage = {
    inputTokens: 1000,
    cachedInputTokens: 400,
    outputTokens: 200,
    reasoningTokens: 50,
    totalTokens: 1200,
    calls: [{ responseId: "resp" }],
    responseIds: ["resp"],
  };
  const priced = buildSitePdfAiEconomicEntry({
    eventId: "evt-1",
    usage,
    model: "gpt-4.1-2025-04-14",
    customerType: "business",
    fx: { usdToEur: 0.86, stale: false, source: "premium_verified_ecb_snapshot", ecbReferenceDate: "2026-08-26" },
  });
  assert.equal(priced.status, "incurred");
  assert.equal(priced.category, "site_pdf_ai_business");
  assert.equal(priced.original_amount, 0.003);
  assert.equal(priced.amount_gross_eur, 0.00258);
  assert.equal(priced.metadata.openai_calls, 1);

  const stale = buildSitePdfAiEconomicEntry({
    eventId: "evt-2",
    usage,
    model: "gpt-4.1-2025-04-14",
    customerType: "privato",
    fx: { usdToEur: 0.86, stale: true, source: "premium_verified_ecb_snapshot" },
  });
  assert.equal(stale.status, "estimated");
  assert.equal(stale.category, "site_pdf_ai_consumer");
  assert.equal(stale.amount_gross_eur, 0.00258);
  assert.equal(stale.original_currency, "USD");

  const unpriced = buildSitePdfAiEconomicEntry({
    eventId: "evt-3",
    usage,
    model: "gpt-4.1-2025-04-14",
    customerType: "privato",
    fx: null,
  });
  assert.equal(unpriced.status, "unpriced");
  assert.equal(unpriced.amount_gross_eur, null);
});

test("preferisce nel ledger il cambio BCE gia verificato da Premium", async () => {
  const calls = [];
  const now = Date.parse("2026-08-26T12:00:00Z");
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("premium_analysis_runs")) {
      return new Response(JSON.stringify([{
        created_at: "2026-08-26T10:00:00Z",
        usage_details: {
          pricing_verified_eur: true,
          usd_to_eur_rate: 0.85,
          eur_to_usd_rate: 1.17647059,
          ecb_reference_date: "2026-08-26",
        },
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("", { status: 201 });
  };
  const result = await recordSitePdfAiEconomicEvent({
    eventId: "evt-ledger",
    usage: {
      inputTokens: 1000,
      cachedInputTokens: 0,
      outputTokens: 250,
      reasoningTokens: 0,
      totalTokens: 1250,
      calls: [{ responseId: "resp-ledger" }],
      responseIds: ["resp-ledger"],
    },
    model: "gpt-4.1-2025-04-14",
    customerType: "business",
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-test" },
    fetchImpl,
    nowMs: now,
  });
  assert.equal(result.stored, true);
  assert.equal(result.status, "incurred");
  assert.equal(calls.length, 2);
  const inserted = JSON.parse(calls[1].init.body);
  assert.equal(inserted.source_system, "site_pdf_ai");
  assert.equal(inserted.category, "site_pdf_ai_business");
  assert.equal(inserted.status, "incurred");
  assert.equal(inserted.metadata.fx_source, "premium_verified_ecb_snapshot");
  assert.ok(inserted.amount_gross_eur > 0);
});

test("usa il cambio BCE diretto quando non esistono ancora analisi Premium con cambio verificato", async () => {
  const calls = [];
  const now = Date.parse("2026-08-26T12:00:00Z");
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, init });
    if (target.includes("premium_analysis_runs")) {
      return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.includes("ecb.europa.eu")) {
      return new Response("<gesmes:Envelope><Cube><Cube time='2026-08-26'><Cube currency='USD' rate='1.17'/></Cube></Cube></gesmes:Envelope>", {
        status: 200,
        headers: { "content-type": "application/xml" },
      });
    }
    return new Response("", { status: 201 });
  };
  const result = await recordSitePdfAiEconomicEvent({
    eventId: "evt-direct-ecb",
    usage: {
      inputTokens: 1000,
      cachedInputTokens: 0,
      outputTokens: 250,
      reasoningTokens: 0,
      totalTokens: 1250,
      calls: [{ responseId: "resp-direct-ecb" }],
      responseIds: ["resp-direct-ecb"],
    },
    model: "gpt-4.1-2025-04-14",
    customerType: "privato",
    env: { SUPABASE_URL: "https://fallback.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-test" },
    fetchImpl,
    nowMs: now,
  });
  assert.equal(result.stored, true);
  assert.equal(result.status, "incurred");
  assert.equal(calls.length, 3);
  assert.match(calls[1].url, /ecb\.europa\.eu/);
  const inserted = JSON.parse(calls[2].init.body);
  assert.equal(inserted.category, "site_pdf_ai_consumer");
  assert.equal(inserted.status, "incurred");
  assert.equal(inserted.metadata.fx_source, "ecb_reference_rate_direct");
  assert.equal(inserted.metadata.fx_reference_date, "2026-08-26");
  assert.ok(inserted.amount_gross_eur > 0);
});

test("non effettua scritture quando OpenAI non e stato chiamato", async () => {
  let fetchCalls = 0;
  const result = await recordSitePdfAiEconomicEvent({
    eventId: "evt-empty",
    usage: { calls: [] },
    model: "gpt-4.1-2025-04-14",
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-test" },
    fetchImpl: async () => { fetchCalls += 1; return new Response("", { status: 500 }); },
  });
  assert.deepEqual(result, { stored: false, reason: "no_openai_calls" });
  assert.equal(fetchCalls, 0);
});


test("l'endpoint pubblico usa il meter sia per il percorso riuscito sia per gli errori", async () => {
  const source = await fs.readFile(new URL("../api/analyze-pdf.js", import.meta.url), "utf8");
  assert.match(source, /createSitePdfUsageMeter\(\)/);
  assert.match(source, /transport:\s*aiUsageMeter\.transport/);
  assert.match(source, /recordAiEconomicCost\(\{ outcome: "success", normalized \}\)/);
  assert.match(source, /recordAiEconomicCost\(\{ outcome: "failed", error \}\)/);
  assert.match(source, /customerType:\s*normalized\?\.customer_type \|\| archiveContext\?\.customerType/);
});
