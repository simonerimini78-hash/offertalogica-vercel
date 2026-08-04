import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  checkPremiumBackendReadiness,
  hasPremiumCurrentAcceptances,
  premiumAiConfig,
  verifyPremiumCustomer,
} from "../lib/premiumAiBackend.js";
import { checkPremiumOfferHistory } from "../lib/premiumOfferMatcher.js";

const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const bills = await readFile(new URL("../public/app-premium-bills.js", import.meta.url), "utf8");
const utilities = await readFile(new URL("../public/app-utilities.js", import.meta.url), "utf8");
const staff = await readFile(new URL("../public/staff.js", import.meta.url), "utf8");
const staffHtml = await readFile(new URL("../public/staff.html", import.meta.url), "utf8");
const api = await readFile(new URL("../api/premium-ai-analysis.js", import.meta.url), "utf8");
const backend = await readFile(new URL("../lib/premiumAiBackend.js", import.meta.url), "utf8");
const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

const currentConsents = [
  { consent_type: "terms", version: "premium-terms-v0.36.7-2026-08-04", granted: true, revoked_at: null },
  { consent_type: "privacy", version: "premium-privacy-v0.36.6-2026-08-04", granted: true, revoked_at: null },
  { consent_type: "cloud_storage", version: "premium-cloud-ai-v0.36.6-2026-08-04", granted: true, revoked_at: null },
];

function jsonResponse(body, status = 200) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("v0.36.6 mantiene la prova di 30 giorni e aggiorna la cache PWA", () => {
  assert.match(app, /Prova gratuita di 30 giorni/);
  assert.doesNotMatch(app, /IN SVILUPPO/);
  assert.match(app, /APP Premium v0\.36\.12/);
  assert.match(sw, /offertalogica-premium-v03612/);
  assert.match(bills, /app_version: "0\.36\.11"/);
});

test("utenze e bollette verificano le accettazioni correnti prima delle operazioni", () => {
  for (const source of [utilities, bills]) {
    assert.match(source, /client\.rpc\("premium_has_current_acceptances"\)/);
    assert.match(source, /operationBlockReason === "legal"/);
    assert.match(source, /Accetta le condizioni Premium correnti/);
    assert.match(source, /Accettazione richiesta/);
  }
  assert.match(backend, /premium_legal_acceptance_required/);
  assert.match(backend, /PREMIUM_LEGAL_ACCEPTANCE_REQUIRED/);
});

test("la verifica delle accettazioni richiede tutte e tre le versioni correnti", () => {
  assert.equal(hasPremiumCurrentAcceptances(currentConsents), true);
  assert.equal(hasPremiumCurrentAcceptances(currentConsents.slice(0, 2)), false);
  assert.equal(hasPremiumCurrentAcceptances([
    ...currentConsents.slice(0, 2),
    { ...currentConsents[2], revoked_at: "2026-08-03T00:00:00Z" },
  ]), false);
});

test("il backend cliente rifiuta l'uso operativo senza accettazioni e lo consente con record correnti", async () => {
  const config = premiumAiConfig({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test",
  });
  let consentRows = [];
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.endsWith("/auth/v1/user")) return jsonResponse({ id: "user-1" });
    if (target.includes("/rest/v1/premium_profiles?")) return jsonResponse([{ id: "user-1", account_status: "active" }]);
    if (target.includes("/rest/v1/premium_subscriptions?")) return jsonResponse([{ id: "sub-1", status: "active", current_period_end: "2099-01-01T00:00:00Z" }]);
    if (target.includes("/rest/v1/premium_consents?")) return jsonResponse(consentRows);
    throw new Error(`Unexpected fetch ${target}`);
  };

  await assert.rejects(
    verifyPremiumCustomer({ config, accessToken: "customer-token", fetchImpl }),
    /premium_legal_acceptance_required/,
  );
  consentRows = currentConsents;
  const result = await verifyPremiumCustomer({ config, accessToken: "customer-token", fetchImpl });
  assert.equal(result.user.id, "user-1");
  assert.equal(result.consents.length, 3);
});

test("il preflight backend controlla schema e bucket senza scrivere dati", async () => {
  const calls = [];
  const config = premiumAiConfig({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test",
    PREMIUM_BILLS_BUCKET: "premium-bills",
  });
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET" });
    return jsonResponse([]);
  };
  const result = await checkPremiumBackendReadiness({ config, fetchImpl });
  assert.equal(result.database.ok, true);
  assert.equal(result.storageBucket.ok, true);
  assert.ok(calls.every(call => call.method === "GET"));
  assert.ok(calls.some(call => call.url.includes("/storage/v1/bucket/premium-bills")));
});

test("il preflight storico ARERA accetta un catalogo valido", async () => {
  const status = await checkPremiumOfferHistory({
    env: { ARERA_HISTORY_URL: "https://catalog.example/history.json" },
    fetchImpl: async (url) => {
      assert.equal(String(url), "https://catalog.example/history.json");
      return jsonResponse({ version: "test-v1", updatedAt: "2026-08-03", offers: [{ key: "one" }] });
    },
  });
  assert.equal(status.ok, true);
  assert.equal(status.offers, 1);
  assert.equal(status.version, "test-v1");
});

test("la dashboard staff espone lo stato beta automatico senza segreti", () => {
  assert.match(staffHtml, /Configurazione operativa/);
  assert.match(staff, /PRONTA PER BETA/);
  for (const property of [
    "databaseOperational",
    "storageBucketOperational",
    "offerHistoryOperational",
    "persistentRateLimitOperational",
  ]) {
    assert.match(api, new RegExp(property));
    assert.match(staff, new RegExp(property));
  }
  assert.match(envExample, /premium\.offertalogica\.it/);
  assert.match(envExample, /ARERA_HISTORY_URL=/);
  assert.doesNotMatch(staff, /SUPABASE_SECRET_KEY|OPENAI_API_KEY|sb_secret_/);
});

test("v0.36 non aggiunge funzioni Vercel", async () => {
  const files = (await readdir(new URL("../api/", import.meta.url))).filter(name => name.endsWith(".js"));
  assert.equal(files.length, 12);
  assert.ok(!files.includes("health.js"));
});
