import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const api = await readFile(new URL("../api/premium-ai-analysis.js", import.meta.url), "utf8");

function section(startMarker, endMarker) {
  const start = api.indexOf(startMarker);
  assert.ok(start >= 0, `marker mancante: ${startMarker}`);
  const end = endMarker ? api.indexOf(endMarker, start + startMarker.length) : api.length;
  assert.ok(end > start, `marker finale mancante: ${endMarker}`);
  return api.slice(start, end);
}

test("v0.36.53 mantiene il listino BCE e aggiunge una versione contabile separata", () => {
  assert.match(api, /PREMIUM_COST_PRICING_VERSION = "premium-ecb-eur-v0\.36\.43"/);
  assert.match(api, /PREMIUM_AI_ACCOUNTING_VERSION = "premium-ai-accounting-v0\.36\.52"/);
  assert.match(api, /PREMIUM_PROVIDER_RECONCILIATION_VERSION = "premium-provider-reconciliation-v0\.36\.53"/);
});

test("il preflight del prezzo avviene prima di creare ogni run IA", () => {
  const pricingPositions = [...api.matchAll(/pricingSnapshot = await requireVerifiedPremiumPricing/g)].map(match => match.index);
  const runPositions = [...api.matchAll(/run = await createPremiumAnalysisRun/g)].map(match => match.index);
  assert.equal(pricingPositions.length, 2);
  assert.equal(runPositions.length, 2);
  assert.ok(pricingPositions[0] < runPositions[0]);
  assert.ok(pricingPositions[1] < runPositions[1]);
});

test("ogni risposta OpenAI viene contabilizzata e checkpointata prima di tornare al parser", () => {
  const transport = section("async function createAccountedOpenAiTransport", "function serviceHeaders");
  assert.ok(transport.indexOf("meter?.capture?.") < transport.indexOf("await onUsage"));
  assert.ok(transport.indexOf("await onUsage") < transport.indexOf("return body"));
  assert.match(api, /checkpointPremiumAiRunCost\(\{/);
  assert.match(api, /estimated_cost_eur: accounting\.estimatedCostEur/);
  assert.match(api, /cost_checkpointed_at/);
});

test("un costo sconosciuto non viene mai trasformato in zero", () => {
  assert.doesNotMatch(api, /estimatedCostEur\s*\?\?\s*0/);
  assert.match(api, /if \(cost === null\) throw new Error\("premium_ai_cost_required"\)/);
  assert.match(api, /cost_eur: cost/);
  assert.doesNotMatch(api, /insertPremiumAiCostEvent/);
});

test("il registro costi è idempotente a livello applicativo e ripara eventi discordanti", () => {
  const upsert = section("async function upsertPremiumAiCostEvent", "async function syncPremiumAiCostEvent");
  assert.match(upsert, /analysis_run_id: `eq\.\$\{run\.id\}`/);
  assert.match(upsert, /method: "PATCH"/);
  assert.match(upsert, /method: "POST"/);
  const reconcile = section("async function reconcilePremiumAiCostEventsLocal", "function redactedApiKeyMatches");
  assert.match(reconcile, /cost_eur,quantity/);
  assert.match(reconcile, /eventMatches/);
  assert.match(reconcile, /repaired \+= 1/);
  assert.match(reconcile, /restored \+= 1/);
});

test("i run falliti conservano token, costo, dettagli e response id già consumati", () => {
  const failures = api.match(/failedAccounting/g) || [];
  assert.ok(failures.length >= 6);
  assert.match(api, /estimated_cost_eur: failedAccounting\.estimatedCostEur/);
  assert.match(api, /usage_details: failedAccounting\.usageDetails/);
  assert.match(api, /response_ids: Array\.isArray\(meter\?\.totals\?\.responseIds\)/);
  assert.doesNotMatch(api, /\.catch\(\(\) => null\)/);
});

test("la chiave operativa viene marcata solo con fingerprint non reversibile", () => {
  assert.match(api, /createHash\("sha256"\)/);
  assert.match(api, /provider_key_fingerprint/);
  const providerReturn = section("async function reconcileOpenAiProviderCosts", "function publicPremiumAccountingError");
  assert.doesNotMatch(providerReturn, /OPENAI_ADMIN_KEY\s*:/);
  assert.doesNotMatch(providerReturn, /openAiApiKey\s*:/);
});

test("la riconciliazione provider usa Admin API e filtra Usage e Costs per la stessa api_key_id", () => {
  assert.match(api, /OPENAI_ADMIN_KEY/);
  assert.match(api, /\/organization\/projects/);
  assert.match(api, /\/api_keys\?/);
  assert.match(api, /\/organization\/usage\/completions/);
  assert.match(api, /\/organization\/usage\/web_search_calls/);
  assert.match(api, /\/organization\/costs/);
  assert.match(api, /appendArrayParam\(completionQuery, "api_key_ids", \[identity\.apiKeyId\]\)/);
  assert.match(api, /appendArrayParam\(webQuery, "api_key_ids", \[identity\.apiKeyId\]\)/);
  assert.match(api, /appendArrayParam\(costQuery, "api_key_ids", \[identity\.apiKeyId\]\)/);
  assert.match(api, /costDeltaUsd/);
  assert.match(api, /usageMatches/);
});

test("la riconciliazione OpenAI è esplicita e non rallenta config_status con chiamate Admin", () => {
  const providerAction = section('if (body?.action === "provider_cost_reconciliation")', 'if (body?.action === "config_status")');
  assert.match(providerAction, /verifyPremiumStaff/);
  assert.match(providerAction, /permission: "view_ai_costs"/);
  assert.match(providerAction, /reconcileOpenAiProviderCosts/);
  const configStatus = section('if (body?.action === "config_status")', "if (offerDecision)");
  assert.match(configStatus, /openAiAdminConfigured/);
  assert.doesNotMatch(configStatus, /reconcileOpenAiProviderCosts/);
  assert.doesNotMatch(configStatus, /openAiAdminRequest/);
});

test("gli errori contabili bloccano l'analisi invece di produrre un costo non verificato", () => {
  assert.match(api, /PREMIUM_AI_ACCOUNTING_UNAVAILABLE/);
  assert.match(api, /premium_ai_pricing_unavailable/);
  assert.match(api, /premium_ai_cost_required/);
  assert.match(api, /publicPremiumAccountingError\(redError\)/);
  assert.match(api, /publicPremiumAccountingError\(error\)/);
});
