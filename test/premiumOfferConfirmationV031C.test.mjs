import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import test from "node:test";
import { createPremiumAiAnalysisHandler } from "../api/premium-ai-analysis.js";
import {
  applyPremiumOfferCustomerDecision,
  buildPremiumContractValues,
  matchPremiumOfferHistory,
} from "../lib/premiumOfferMatcher.js";
import { classifyPremiumAutomaticAnalysis } from "../lib/premiumAiBackend.js";

const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const bills = await readFile(new URL("../public/app-premium-bills.js", import.meta.url), "utf8");
const api = await readFile(new URL("../api/premium-ai-analysis.js", import.meta.url), "utf8");
const matcher = await readFile(new URL("../lib/premiumOfferMatcher.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/premium-offer-confirmation-v0.31C.sql", import.meta.url), "utf8");
const verify = await readFile(new URL("../supabase/premium-offer-confirmation-v0.31C-verify.sql", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const apiFiles = (await readdir(new URL("../api/", import.meta.url))).filter(name => name.endsWith(".js"));

function historyRecord(overrides = {}) {
  return {
    key: "luce:ABC123",
    recordType: "single",
    commodity: "luce",
    offerCode: "ABC123",
    providerName: "A2A Energia",
    offerName: "A2A Click Luce",
    customerType: "privato",
    active: true,
    versions: [{
      catalogDate: "2026-08-03",
      validFrom: "01/07/2026_00:00:00",
      validTo: "31/08/2026_23:59:59",
      priceType: "fisso",
      price: 0.13,
      annualFixedFee: 120,
      indexName: null,
      spreadEstimate: null,
    }],
    ...overrides,
  };
}

function lightBill(overrides = {}) {
  return {
    recognized: true,
    kind: "bolletta",
    commodity: "luce",
    total_amount_eur: 132.45,
    billing_period_start: "2026-07-01",
    billing_period_end: "2026-07-31",
    issue_date: "2026-08-02",
    due_date: "2026-08-20",
    fornitore_luce: "A2A Energia",
    nome_offerta_luce: "A2A Click Luce",
    codice_offerta_luce: "",
    consumo_luce_kwh: 2200,
    prezzo_luce_eur_kwh: 0.13,
    quota_fissa_vendita_luce_eur_anno: 120,
    tipo_prezzo_luce: "fisso",
    document_alerts: [],
    validation_issues: [],
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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

test("v0.31C mostra il contratto della bolletta e usa lo stesso endpoint per la conferma", () => {
  assert.match(bills, /contract_id/);
  assert.match(bills, /premium_contracts/);
  assert.match(bills, /function renderOfferCard/);
  assert.match(bills, /CONFERMA OFFERTA/);
  assert.match(bills, /NON È QUESTA/);
  assert.match(bills, /action: decision === "confirm" \? "confirm_offer" : "reject_offer"/);
  assert.match(bills, /fetch\("\/api\/premium-ai-analysis"/);
  assert.match(api, /body\?\.action === "confirm_offer"/);
  assert.match(api, /applyPremiumOfferCustomerDecision/);
  assert.match(app, /APP Premium v0\.(?:31C|32|35(?:\.1)?|36)/);
  assert.match(sw, /offertalogica-premium-v(?:031c|032|0351?|036)/);
});

test("v0.31C non aggiunge una nuova funzione Vercel", () => {
  assert.ok(apiFiles.length <= 12, `Funzioni API trovate: ${apiFiles.length}`);
  assert.ok(apiFiles.includes("premium-ai-analysis.js"));
  assert.ok(!apiFiles.includes("premium-offer-confirmation.js"));
});

test("un match probabile non verificato richiede conferma e conserva indice e spread nei candidati", () => {
  const history = {
    version: "arera-history-2026-08-03",
    updatedAt: "2026-08-03",
    offers: [
      historyRecord({
        versions: [{
          catalogDate: "2026-08-03",
          validFrom: "01/07/2026_00:00:00",
          validTo: "31/08/2026_23:59:59",
          priceType: "variabile",
          price: 0.14,
          annualFixedFee: 120,
          indexName: "PUN",
          spreadEstimate: 0.02,
        }],
      }),
      historyRecord({
        key: "luce:OTHER",
        offerCode: "OTHER",
        offerName: "A2A Click Plus Luce",
        versions: [{
          catalogDate: "2026-08-03",
          validFrom: "01/07/2026_00:00:00",
          validTo: "31/08/2026_23:59:59",
          priceType: "variabile",
          price: 0.15,
          annualFixedFee: 132,
          indexName: "PUN",
          spreadEstimate: 0.03,
        }],
      }),
    ],
  };
  const normalized = lightBill({
    tipo_prezzo_luce: "variabile",
    prezzo_luce_eur_kwh: 0.14,
    indice_riferimento_luce: "PUN",
    spread_luce_eur_kwh: 0.02,
  });
  const match = matchPremiumOfferHistory(normalized, history);
  const values = buildPremiumContractValues(normalized, match, "https://example.test/history.json");
  assert.ok(["matched", "ambiguous"].includes(match.status));
  if (!match.verified) assert.equal(values.customer_confirmation_status, "pending");
  assert.equal(values.automatic_match_candidates[0].candidates[0].indexName, "PUN");
  assert.equal(values.automatic_match_candidates[0].candidates[0].spreadEstimate, 0.02);
});

test("la conferma server-side accetta solo un candidato memorizzato nel contratto", async () => {
  const calls = [];
  const contract = {
    id: "contract-1",
    user_id: "user-1",
    utility_id: "utility-1",
    provider_name: "A2A Energia",
    offer_name: "A2A Click Luce",
    pricing_type: "fixed",
    source: "import",
    verification_status: "needs_review",
    is_current: true,
    automatic_match_status: "ambiguous",
    automatic_match_confidence: 72,
    automatic_match_method: "provider_offer_name",
    automatic_match_catalog_version: "arera-history-2026-08-03",
    automatic_match_candidates: [{
      commodity: "luce",
      status: "ambiguous",
      candidates: [{
        key: "luce:ABC123",
        commodity: "luce",
        providerName: "A2A Energia",
        offerName: "A2A Click Luce",
        offerCode: "ABC123",
        score: 82,
        priceType: "fisso",
        price: 0.13,
        annualFixedFee: 120,
        validFrom: "2026-07-01",
        validTo: "2026-08-31",
      }],
    }],
    customer_confirmation_status: "pending",
    customer_confirmed_at: null,
    customer_rejected_at: null,
    customer_selected_candidates: [],
    customer_confirmation_version: "premium-offer-confirmation-v0.31C",
  };
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    const method = init.method || "GET";
    calls.push({ target, method, body: init.body ? JSON.parse(String(init.body)) : null });
    if (target.includes("/rest/v1/premium_contracts?") && method === "GET") return jsonResponse([contract]);
    if (target.includes("/rest/v1/premium_contracts?") && method === "PATCH") return jsonResponse([{ ...contract, ...JSON.parse(String(init.body)) }]);
    if (target.includes("/rest/v1/premium_bills?") && method === "GET") return jsonResponse([{
      id: "bill-1", user_id: "user-1", contract_id: "contract-1", automatic_analysis_run_id: "run-1",
      processing_status: "completed", automatic_screening_status: "clear", deleted_at: null,
    }]);
    if (target.includes("/rest/v1/premium_analysis_runs?") && method === "GET") return jsonResponse([{
      id: "run-1", bill_id: "bill-1", status: "completed", extracted_data: lightBill(),
    }]);
    throw new Error(`Unexpected ${method} ${target}`);
  };
  const result = await applyPremiumOfferCustomerDecision({
    config: { supabaseUrl: "https://example.supabase.co", serviceKey: "sb_secret_test" },
    userId: "user-1",
    contractId: "contract-1",
    billId: "bill-1",
    decision: "confirm",
    selections: [{ commodity: "luce", key: "luce:ABC123" }],
    fetchImpl,
  });
  assert.equal(result.contract.verification_status, "verified");
  assert.equal(result.contract.customer_confirmation_status, "confirmed");
  assert.equal(result.contract.arera_offer_code_electricity, "ABC123");
  const patch = calls.find(call => call.method === "PATCH");
  assert.equal(patch.body.customer_selected_candidates[0].key, "luce:ABC123");
});

test("la conferma API riclassifica la bolletta senza una nuova chiamata OpenAI", async () => {
  const calls = [];
  const normalized = lightBill({
    tipo_prezzo_luce: "variabile",
    indice_riferimento_luce: "PUN",
    spread_luce_eur_kwh: 0.04,
  });
  const confirmedContract = {
    id: "contract-1",
    provider_name: "A2A Energia",
    offer_name: "A2A Click Luce",
    pricing_type: "indexed",
    electricity_index_name: "PUN",
    electricity_spread_eur_kwh: 0.02,
    electricity_fixed_fee_eur_year: 120,
    verification_status: "verified",
    customer_confirmation_status: "confirmed",
  };
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    const method = init.method || "GET";
    calls.push({ target, method, body: init.body ? String(init.body) : "" });
    if (target.endsWith("/auth/v1/user")) return jsonResponse({ id: "user-1" });
    if (target.includes("/rest/v1/premium_profiles?")) return jsonResponse([{ id: "user-1", account_status: "active" }]);
    if (target.includes("/rest/v1/premium_subscriptions?")) return jsonResponse([{ id: "sub-1", status: "active", current_period_end: "2099-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" }]);
    if (target.includes("/rest/v1/premium_consents?")) return jsonResponse([
      { consent_type: "terms", version: "premium-terms-v0.35-2026-08-03", granted: true, revoked_at: null },
      { consent_type: "privacy", version: "premium-privacy-v0.35-2026-08-03", granted: true, revoked_at: null },
      { consent_type: "cloud_storage", version: "premium-cloud-ai-v0.35-2026-08-03", granted: true, revoked_at: null },
    ]);
    if (target.includes("/rest/v1/premium_bills?") && method === "PATCH") return new Response(null, { status: 204 });
    if (target.includes("/rest/v1/premium_analysis_runs?") && method === "PATCH") return jsonResponse([{ id: "run-1" }]);
    throw new Error(`Unexpected ${method} ${target}`);
  };
  const handler = createPremiumAiAnalysisHandler({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_test" },
    fetchImpl,
    decideOffer: async () => ({
      decision: "confirm",
      contract: confirmedContract,
      bill: { id: "bill-1" },
      run: { id: "run-1" },
      normalized,
    }),
  });
  const req = Readable.from([Buffer.from(JSON.stringify({
    action: "confirm_offer",
    contractId: "contract-1",
    billId: "bill-1",
    selections: [{ commodity: "luce", key: "luce:ABC123" }],
  }))]);
  req.method = "POST";
  req.headers = { authorization: "Bearer customer-jwt", host: "preview.example" };
  req.socket = { remoteAddress: "127.0.0.1" };
  const res = responseRecorder();
  await handler(req, res);
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.mode, "offer_confirmation");
  assert.equal(body.screening.status, "review_recommended");
  assert.ok(body.screening.reasons.some(item => item.code === "spread_luce_diverso_dal_contratto"));
  assert.ok(!calls.some(call => call.target.includes("api.openai.com")));
  assert.ok(calls.some(call => call.target.includes("premium_bills?") && call.method === "PATCH"));
});

test("indice e spread delle offerte indicizzate vengono confrontati", () => {
  const normalized = lightBill({
    tipo_prezzo_luce: "variabile",
    indice_riferimento_luce: "PUN",
    spread_luce_eur_kwh: 0.02,
  });
  const contract = {
    provider_name: "A2A Energia",
    pricing_type: "indexed",
    electricity_index_name: "PUN",
    electricity_spread_eur_kwh: 0.02,
    electricity_fixed_fee_eur_year: 120,
  };
  assert.equal(classifyPremiumAutomaticAnalysis(normalized, { contract }).status, "clear");
  const wrongSpread = classifyPremiumAutomaticAnalysis({ ...normalized, spread_luce_eur_kwh: 0.05 }, { contract });
  assert.ok(wrongSpread.reasons.some(item => item.code === "spread_luce_diverso_dal_contratto"));
  const wrongIndex = classifyPremiumAutomaticAnalysis({ ...normalized, indice_riferimento_luce: "PUN F1" }, { contract });
  assert.ok(wrongIndex.reasons.some(item => item.code === "indice_luce_diverso_dal_contratto"));
});

test("migrazione e verifica mantengono RLS e nessun accesso anonimo", () => {
  for (const field of [
    "customer_confirmation_status",
    "customer_selected_candidates",
    "premium_contracts_customer_confirmation_status_check",
    "premium_contracts_confirmation_pending_idx",
  ]) assert.match(migration, new RegExp(field));
  for (const result of [
    "confirmation_columns_present",
    "confirmation_status_constraint_present",
    "confirmation_dates_constraint_present",
    "confirmation_pending_index_present",
    "customer_contract_mutations_disabled",
    "staff_contract_policy_present",
    "customer_contract_read_present",
    "contracts_rls_still_enabled",
    "anon_grants_absent",
  ]) assert.match(verify, new RegExp(result));
  assert.match(matcher, /premium_offer_selection_invalid/);
  assert.match(migration, /drop policy if exists premium_contracts_owner_update/);
});
