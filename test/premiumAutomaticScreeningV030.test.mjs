import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyPremiumAutomaticAnalysis,
  premiumBillValuesFromAnalysis,
  sanitizePremiumAnalysisData,
} from "../lib/premiumAiBackend.js";

function completeLight(overrides = {}) {
  return {
    recognized: true,
    kind: "bolletta",
    commodity: "luce",
    total_amount_eur: 148.62,
    billing_period_start: "2026-06-01",
    billing_period_end: "2026-06-30",
    issue_date: "2026-07-03",
    due_date: "2026-07-20",
    fornitore_luce: "Fornitore Test",
    consumo_luce_kwh: 2200,
    prezzo_luce_eur_kwh: 0.12,
    quota_fissa_vendita_luce_eur_anno: 96,
    tipo_prezzo_luce: "fisso",
    document_alerts: [],
    validation_issues: [],
    ...overrides,
  };
}

test("v0.30 classifica come regolare una bolletta completa senza segnali", () => {
  const result = classifyPremiumAutomaticAnalysis(completeLight());
  assert.equal(result.status, "clear");
  assert.equal(result.customerStatus, "correct");
  assert.deepEqual(result.reasons, []);
  assert.match(result.summary, /non sono emerse anomalie/i);
});

test("v0.30 invia alle eccezioni un alert esplicito del documento", () => {
  const result = classifyPremiumAutomaticAnalysis(completeLight({
    document_alerts: [{
      code: "conguaglio",
      title: "Conguaglio presente",
      description: "La bolletta contiene un ricalcolo dichiarato.",
      severity: "medium",
    }],
  }));
  assert.equal(result.status, "review_recommended");
  assert.equal(result.customerStatus, "anomaly_found");
  assert.ok(result.reasons.some(item => item.code === "documento_conguaglio"));
});

test("v0.30 non dichiara regolare una bolletta con dati essenziali mancanti", () => {
  const result = classifyPremiumAutomaticAnalysis(completeLight({
    total_amount_eur: null,
    billing_period_end: null,
    prezzo_luce_eur_kwh: null,
  }));
  assert.equal(result.status, "inconclusive");
  assert.equal(result.customerStatus, "more_info_required");
  assert.ok(result.reasons.some(item => item.code === "importo_totale_mancante"));
  assert.ok(result.reasons.some(item => item.code === "campo_mancante_prezzo_luce_eur_kwh"));
});

test("v0.30 segnala differenze rispetto al contratto registrato", () => {
  const result = classifyPremiumAutomaticAnalysis(completeLight(), {
    contract: {
      provider_name: "Fornitore Test",
      pricing_type: "fixed",
      electricity_price_eur_kwh: 0.09,
      electricity_fixed_fee_eur_year: 96,
    },
  });
  assert.equal(result.status, "review_recommended");
  assert.ok(result.reasons.some(item => item.code === "prezzo_luce_diverso_dal_contratto"));
});

test("v0.30 aggiorna archivio e mantiene i dati grezzi fuori dalla risposta cliente", () => {
  const normalized = completeLight();
  const screening = classifyPremiumAutomaticAnalysis(normalized);
  const values = premiumBillValuesFromAnalysis(normalized, screening, "run-1", "2026-08-03T08:00:00.000Z");
  assert.equal(values.total_amount_eur, 148.62);
  assert.equal(values.billing_period_start, "2026-06-01");
  assert.equal(values.processing_status, "completed");
  assert.equal(values.automatic_screening_status, "clear");
  const sanitized = sanitizePremiumAnalysisData(normalized, { totalTokens: 100 }, screening);
  assert.equal(sanitized._premium_analysis.review_policy, "exceptions_only");
  assert.equal(sanitized._premium_analysis.customer_visible, false);
  assert.equal(sanitized._premium_analysis.staff_review_required, false);
});

import { Readable } from "node:stream";
import { createPremiumAiAnalysisHandler } from "../api/premium-ai-analysis.js";

function jsonResponse(body, status = 200) {
  return new Response(body == null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); },
    end(value = "") { this.body += String(value); },
  };
}

test("v0.30 completa l’analisi cliente, aggiorna la bolletta e non crea controlli", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    const method = init.method || "GET";
    calls.push({ target, method, body: init.body ? String(init.body) : "" });
    if (target.endsWith("/auth/v1/user")) return jsonResponse({ id: "user-1", email: "cliente@example.it" });
    if (target.includes("/rest/v1/premium_profiles?")) return jsonResponse([{ id: "user-1", account_status: "active" }]);
    if (target.includes("/rest/v1/premium_subscriptions?")) return jsonResponse([{ id: "sub-1", user_id: "user-1", status: "active", current_period_end: "2099-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" }]);
    if (target.includes("/rest/v1/premium_bills?") && method === "GET") return jsonResponse([{ id: "bill-1", user_id: "user-1", utility_id: "utility-1", contract_id: null, commodity: "electricity", original_file_name: "bolletta.pdf", file_size: 24, storage_bucket: "premium-bills", storage_path: "user-1/bill-1.pdf", processing_status: "uploaded", customer_status: "awaiting_review", automatic_screening_status: "pending", deleted_at: null, created_at: "2026-08-03T06:00:00Z" }]);
    if (target.includes("/rest/v1/premium_contracts?")) return jsonResponse([]);
    if (target.includes("status=in.%28queued%2Crunning%29")) return jsonResponse([]);
    if (target.includes("order=run_number.desc")) return jsonResponse([]);
    if (target.endsWith("/rest/v1/premium_analysis_runs") && method === "POST") return jsonResponse([{ id: "run-1", run_number: 1 }], 201);
    if (target.includes("/storage/v1/object/sign/")) return jsonResponse({ signedURL: "https://signed.example/customer-bill.pdf" });
    if (target === "https://signed.example/customer-bill.pdf") return new Response(Buffer.from("%PDF-1.4\n%%EOF"), { status: 200, headers: { "content-type": "application/pdf" } });
    if (target.includes("/rest/v1/premium_analysis_runs?") && method === "PATCH") return jsonResponse([{ id: "run-1" }]);
    if (target.includes("/rest/v1/premium_bills?") && method === "PATCH") return new Response(null, { status: 204 });
    if (target.endsWith("/rest/v1/premium_cost_events") && method === "POST") return jsonResponse({ message: "cost log unavailable" }, 500);
    if (target === "https://api.openai.com/v1/responses") return jsonResponse({ id: "resp-1", model: "model-test", usage: { input_tokens: 80, output_tokens: 20, total_tokens: 100 }, output_text: "{}" });
    throw new Error(`Unexpected fetch ${method} ${target}`);
  };
  const handler = createPremiumAiAnalysisHandler({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_test",
      OPENAI_API_KEY: "openai-test",
      PDF_AI_PRIMARY_MODEL: "model-test",
    },
    fetchImpl,
    analyzePdf: async ({ transport }) => {
      await transport({ request: { model: "model-test" }, apiKey: "openai-test", attempt: 1, profile: "automatic" });
      return completeLight({ parser_version: "reader-v030", ai: { model: "model-test" }, warnings: [] });
    },
  });
  const req = Readable.from([Buffer.from(JSON.stringify({ billId: "bill-1" }))]);
  req.method = "POST";
  req.headers = { authorization: "Bearer customer-jwt", host: "preview.example" };
  req.socket = { remoteAddress: "127.0.0.1" };
  const res = responseRecorder();
  await handler(req, res);
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.mode, "customer_upload");
  assert.equal(body.screening.status, "clear");
  assert.equal(Object.hasOwn(body.run, "extractedData"), false);
  const billPatch = calls.find(call => call.target.includes("/rest/v1/premium_bills?") && call.method === "PATCH" && call.body.includes("total_amount_eur"));
  assert.ok(billPatch);
  assert.match(billPatch.body, /"automatic_screening_status":"clear"/);
  assert.match(billPatch.body, /"total_amount_eur":148\.62/);
  assert.ok(!calls.some(call => call.target.endsWith("/rest/v1/premium_checks") && call.method === "POST"));
});
