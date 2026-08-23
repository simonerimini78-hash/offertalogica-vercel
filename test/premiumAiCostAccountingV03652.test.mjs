import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createMeteredOpenAiTransport,
  createUsageMeter,
  insertPremiumAiCostEvent,
  reconcilePremiumAiCostEvents,
} from "../lib/premiumAiBackend.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const api = fs.readFileSync(path.join(root, "api/premium-ai-analysis.js"), "utf8");

function jsonResponse(body, status = 200) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const config = {
  supabaseUrl: "https://example.supabase.co",
  serviceKey: "service-key",
};

const bill = { id: "bill-1", user_id: "user-1" };
const run = { id: "run-1", origin: "customer_upload" };
const usage = {
  inputTokens: 1000,
  cachedInputTokens: 200,
  outputTokens: 500,
  reasoningTokens: 10,
  totalTokens: 1500,
  responseIds: ["resp-1"],
  calls: [{ response_id: "resp-1", input_tokens: 1000, output_tokens: 500 }],
};
const pricingMetadata = {
  pricing_verified_eur: true,
  pricing_version: "premium-ecb-eur-v0.36.43",
  pricing_mode: "openai_usd_x_ecb",
  usd_to_eur_rate: 0.854774,
  eur_to_usd_rate: 1.1699,
  ecb_reference_date: "2026-08-21",
  accounting_version: "premium-ai-accounting-v0.36.52",
};

test("v0.36.52 contabilizza ogni risposta OpenAI prima di restituirla al parser", async () => {
  const meter = createUsageMeter();
  const order = [];
  const transport = createMeteredOpenAiTransport({
    meter,
    fetchImpl: async () => {
      order.push("openai");
      return jsonResponse({
        id: "resp-checkpoint",
        model: "gpt-4.1-2025-04-14",
        usage: {
          input_tokens: 1200,
          input_tokens_details: { cached_tokens: 300 },
          output_tokens: 400,
          total_tokens: 1600,
        },
      });
    },
    onUsage: async ({ totals }) => {
      order.push("checkpoint-start");
      assert.equal(totals.totalTokens, 1600);
      assert.equal(totals.cachedInputTokens, 300);
      await Promise.resolve();
      order.push("checkpoint-end");
    },
  });

  const body = await transport({ request: { model: "x" }, apiKey: "key", attempt: 1, profile: "primary" });
  order.push("parser");
  assert.equal(body.id, "resp-checkpoint");
  assert.deepEqual(order, ["openai", "checkpoint-start", "checkpoint-end", "parser"]);
});

test("v0.36.52 non trasforma mai un costo sconosciuto in zero", async () => {
  let called = false;
  await assert.rejects(
    () => insertPremiumAiCostEvent({
      config,
      bill,
      run,
      usage,
      estimatedCostEur: null,
      model: "gpt-4.1-2025-04-14",
      fetchImpl: async () => { called = true; return jsonResponse([]); },
    }),
    /premium_ai_cost_required/,
  );
  assert.equal(called, false);
});

test("v0.36.52 il registro costi e idempotente per analysis_run_id", async () => {
  const rows = [];
  let postCount = 0;
  let patchCount = 0;
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    const method = init.method || "GET";
    if (target.includes("/rest/v1/premium_cost_events?") && method === "GET") {
      return jsonResponse(rows.length ? [{ id: rows[0].id }] : []);
    }
    if (target.endsWith("/rest/v1/premium_cost_events") && method === "POST") {
      postCount += 1;
      rows.push({ id: "event-1", ...JSON.parse(init.body) });
      return new Response(null, { status: 204 });
    }
    if (target.includes("/rest/v1/premium_cost_events?") && method === "PATCH") {
      patchCount += 1;
      Object.assign(rows[0], JSON.parse(init.body));
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected ${method} ${target}`);
  };

  await insertPremiumAiCostEvent({
    config, bill, run, usage, estimatedCostEur: 0.011, model: "gpt-4.1-2025-04-14", pricingMetadata, fetchImpl,
  });
  await insertPremiumAiCostEvent({
    config, bill, run, usage: { ...usage, totalTokens: 1700 }, estimatedCostEur: 0.0123,
    model: "gpt-4.1-2025-04-14", pricingMetadata, fetchImpl,
  });

  assert.equal(postCount, 1);
  assert.equal(patchCount, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].analysis_run_id, "run-1");
  assert.equal(rows[0].cost_eur, 0.0123);
  assert.equal(rows[0].quantity, 1700);
  assert.equal(rows[0].metadata.pricing_verified_eur, true);
  assert.equal(rows[0].metadata.accounting_version, "premium-ai-accounting-v0.36.52");
});

test("v0.36.52 riconcilia automaticamente un run verificato privo del relativo cost event", async () => {
  const events = [];
  const verifiedRun = {
    id: "run-missing-event",
    bill_id: "bill-2",
    user_id: "user-2",
    origin: "customer_upload",
    model: "gpt-4.1-2025-04-14",
    input_tokens: 1000,
    output_tokens: 500,
    estimated_cost_eur: 0.009876,
    response_ids: ["resp-2"],
    usage_details: {
      input_tokens: 1000,
      cached_input_tokens: 100,
      output_tokens: 500,
      reasoning_tokens: 0,
      total_tokens: 1500,
      calls: [],
      pricing_verified_eur: true,
      pricing_version: "premium-ecb-eur-v0.36.43",
      pricing_mode: "openai_usd_x_ecb",
      accounting_version: "premium-ai-accounting-v0.36.52",
    },
    created_at: "2026-08-22T19:00:00Z",
  };

  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    const method = init.method || "GET";
    if (target.includes("/rest/v1/premium_analysis_runs?") && method === "GET") {
      return jsonResponse([verifiedRun]);
    }
    if (target.includes("/rest/v1/premium_cost_events?") && method === "GET") {
      if (target.includes("analysis_run_id=in.")) return jsonResponse(events.map(item => ({ id: item.id, analysis_run_id: item.analysis_run_id })));
      return jsonResponse(events.length ? [{ id: events[0].id }] : []);
    }
    if (target.endsWith("/rest/v1/premium_cost_events") && method === "POST") {
      events.push({ id: "event-restored", ...JSON.parse(init.body) });
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected ${method} ${target}`);
  };

  const result = await reconcilePremiumAiCostEvents({ config, limit: 250, fetchImpl });
  assert.deepEqual(result, { scanned: 1, eligible: 1, restored: 1, alreadyPresent: 0 });
  assert.equal(events.length, 1);
  assert.equal(events[0].analysis_run_id, verifiedRun.id);
  assert.equal(events[0].cost_eur, 0.009876);
});

test("v0.36.52 fa il preflight del costo prima di creare il run sia cliente sia verifica rossa", () => {
  const redStart = api.indexOf('if (body?.action === "verify_red")');
  const mainStart = api.indexOf('assertPremiumAiConfigured(backend);\n      customerMode =', redStart + 1);
  const red = api.slice(redStart, mainStart);
  assert.ok(red.indexOf("pricingSnapshot = await requireVerifiedPremiumPricing") >= 0);
  assert.ok(red.indexOf("pricingSnapshot = await requireVerifiedPremiumPricing") < red.indexOf("run = await createPremiumAnalysisRun"));

  const main = api.slice(mainStart);
  assert.ok(main.indexOf("pricingSnapshot = await requireVerifiedPremiumPricing") >= 0);
  assert.ok(main.indexOf("pricingSnapshot = await requireVerifiedPremiumPricing") < main.indexOf("run = await createPremiumAnalysisRun"));
  assert.doesNotMatch(main, /await verifiedPremiumAiCost\(/);
});

test("v0.36.52 salva token e costo anche nei percorsi failed e non ignora piu il registro costi", () => {
  assert.match(api, /let failedAccounting = null/);
  assert.match(api, /estimated_cost_eur: failedAccounting\.estimatedCostEur/);
  assert.match(api, /usage_details: failedAccounting\.usageDetails/);
  assert.match(api, /response_ids: Array\.isArray\(meter\?\.totals\?\.responseIds\)/);
  assert.doesNotMatch(api, /insertPremiumAiCostEvent\([\s\S]*?\)\.catch\(\(\) => null\)/);
  assert.match(api, /premium_ai_cost_event_pending/);
  assert.match(api, /reconcilePremiumAiCostEvents/);
});
