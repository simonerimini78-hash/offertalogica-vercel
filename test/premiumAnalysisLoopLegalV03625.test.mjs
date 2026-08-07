import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPremiumAnalysisRun } from "../lib/premiumAiBackend.js";

const premiumBills = await readFile(new URL("../public/app-premium-bills.js", import.meta.url), "utf8");
const appAuth = await readFile(new URL("../public/app-auth.js", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const premiumApi = await readFile(new URL("../api/premium-ai-analysis.js", import.meta.url), "utf8");

function jsonResponse(body, status = 200) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("v0.36.28 non rilancia automaticamente in loop una bolletta pending dopo un errore", () => {
  assert.doesNotMatch(premiumBills, /const recentPending[\s\S]*?runAutomaticAnalysis\(recentPending\.id\)/);
  assert.match(premiumBills, /const analysisAttemptFailures = new Set\(\)/);
  assert.match(premiumBills, /analysisAttemptFailures\.add\(id\)/);
  assert.match(premiumBills, /button\.textContent = "RIPROVA ANALISI"/);
  assert.match(premiumBills, /button\.textContent = "AVVIA ANALISI"/);
});

test("v0.36.28 mantiene i comandi stabili e distingue analisi in corso da analisi interrotta", () => {
  assert.match(premiumBills, /const ANALYSIS_STALE_MS = 90000/);
  assert.match(premiumBills, /button\.textContent = "ANALISI IN CORSO"/);
  assert.match(premiumBills, /return "Analisi interrotta"/);
  assert.match(premiumBills, /const BILL_COLUMNS = .*updated_at/);
  assert.doesNotMatch(premiumBills, /renderEnabled\(\)[\s\S]{0,700}?setBusy\(false\)/);
  assert.match(premiumBills, /const sameRows = existingIds\.length === currentIds\.length/);
  assert.match(premiumBills, /updateBillArticle\(article, bill/);
  assert.match(premiumBills, /actions\.append\(openButton, analysisButton, checkButton, requestButton, deleteButton\)/);
});

test("il riquadro condizioni sparisce dopo accettazione e si apre solo quando manca una versione corrente", () => {
  assert.match(appAuth, /state\.legalPanel\.hidden = !profile \|\| complete/);
  assert.match(appAuth, /if \(state\.legalPanel\) state\.legalPanel\.hidden = true/);
  assert.match(appAuth, /offertalogica:legal-acceptance-required/);
  assert.match(app, /addEventListener\('offertalogica:legal-acceptance-required'/);
  assert.match(app, /openTab\('profile'\)/);
  assert.match(appAuth, /const TERMS_VERSION = "premium-terms-v0\.36\.22-2026-08-06"/);
  assert.match(app, /<strong>Condizioni e informativa<\/strong><span>VERSIONE CORRENTE<\/span>/);
});

test("un conflitto di run attivo non trasforma la bolletta in analisi fallita", () => {
  assert.match(premiumApi, /const analysisAlreadyRunning = \/premium_analysis_already_running\|premium_analysis_runs_one_active\//);
  assert.match(premiumApi, /if \(bill\?\.id && !analysisAlreadyRunning\)/);
});

test("un run IA realmente attivo non viene duplicato", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    const method = init.method || "GET";
    calls.push({ target, method, body: String(init.body || "") });
    if (target.includes("status=in.%28queued%2Crunning%29")) {
      return jsonResponse([{ id: "run-active", status: "running", run_number: 1, started_at: new Date().toISOString() }]);
    }
    throw new Error(`Unexpected ${method} ${target}`);
  };

  await assert.rejects(
    () => createPremiumAnalysisRun({
      config: { supabaseUrl: "https://example.supabase.co", serviceKey: "secret" },
      bill: { id: "bill-1", user_id: "user-1" },
      origin: "customer_upload",
      staleAfterMs: 90000,
      fetchImpl,
    }),
    /premium_analysis_already_running/,
  );
  assert.equal(calls.some(call => call.method === "POST"), false);
});

test("un run IA bloccato viene chiuso e sostituito da un nuovo tentativo", async () => {
  const calls = [];
  const staleStartedAt = new Date(Date.now() - 180000).toISOString();
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    const method = init.method || "GET";
    const body = String(init.body || "");
    calls.push({ target, method, body });
    if (target.includes("status=in.%28queued%2Crunning%29")) {
      return jsonResponse([{ id: "run-stale", status: "running", run_number: 1, started_at: staleStartedAt }]);
    }
    if (target.includes("/rest/v1/premium_analysis_runs?") && method === "PATCH") {
      return jsonResponse([{ id: "run-stale" }]);
    }
    if (target.includes("order=run_number.desc")) return jsonResponse([{ run_number: 1 }]);
    if (target.endsWith("/rest/v1/premium_analysis_runs") && method === "POST") {
      return jsonResponse([{ id: "run-2", run_number: 2 }], 201);
    }
    if (target.includes("/rest/v1/premium_bills?") && method === "PATCH") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected ${method} ${target}`);
  };

  const run = await createPremiumAnalysisRun({
    config: { supabaseUrl: "https://example.supabase.co", serviceKey: "secret" },
    bill: { id: "bill-1", user_id: "user-1" },
    requestedByUserId: "user-1",
    origin: "customer_upload",
    staleAfterMs: 90000,
    fetchImpl,
  });

  assert.equal(run.id, "run-2");
  const stalePatch = calls.find(call => call.method === "PATCH" && call.target.includes("premium_analysis_runs"));
  assert.ok(stalePatch);
  assert.match(stalePatch.body, /premium_analysis_stale_recovered/);
  assert.ok(calls.some(call => call.method === "POST" && call.target.endsWith("/rest/v1/premium_analysis_runs")));
  assert.ok(calls.some(call => call.method === "PATCH" && call.target.includes("premium_bills") && call.body.includes('"automatic_screening_status":"running"')));
});
