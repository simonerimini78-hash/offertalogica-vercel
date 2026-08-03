import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/staff-premium.html", import.meta.url), "utf8");
const staff = await readFile(new URL("../public/staff-premium.js", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const api = await readFile(new URL("../api/premium-ai-analysis.js", import.meta.url), "utf8");
const backend = await readFile(new URL("../lib/premiumAiBackend.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/premium-ai-v0.28.sql", import.meta.url), "utf8");
const verify = await readFile(new URL("../supabase/premium-ai-v0.28-verify.sql", import.meta.url), "utf8");
const docs = await readFile(new URL("../docs/PREMIUM-AI-V0.28.md", import.meta.url), "utf8");

test("Premium v0.28 aggiorna versione e cache senza modificare il ramo gratuito", () => {
  assert.match(app, /APP Premium v0\.29/);
  assert.match(html, /Area riservata allo staff autorizzato · v0\.29/);
  assert.match(sw, /offertalogica-premium-v29/);
});

test("La dashboard avvia l’IA solo su richiesta staff con JWT personale", () => {
  assert.match(staff, /AVVIA PRE-ANALISI IA/);
  assert.match(staff, /\/api\/premium-ai-analysis/);
  assert.match(staff, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(staff, /client\.auth\.getSession\(\)/);
  assert.match(staff, /window\.confirm\(prompt\)/);
  assert.doesNotMatch(staff, /OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|sb_secret_/);
});

test("La bozza IA è riservata allo staff e non conclude automaticamente il controllo", () => {
  assert.match(staff, /Bozza tecnica riservata allo staff/);
  assert.match(staff, /Non modifica l’esito e non è visibile al cliente/);
  assert.match(staff, /premium_analysis_runs/);
  assert.doesNotMatch(api, /premium_staff_complete_check/);
  assert.doesNotMatch(api, /customer_message/);
  assert.match(api, /processing_status: "ready_for_review"/);
});

test("L’API valida sessione, ruolo, controllo e PDF prima di chiamare il lettore esistente", () => {
  assert.match(api, /verifyPremiumStaff/);
  assert.match(api, /loadPremiumCheckAndBill/);
  assert.match(api, /normalizePdfFileHeader/);
  assert.match(api, /extractPdfPureAi/);
  assert.match(backend, /auth\/v1\/user/);
  assert.match(backend, /premium_staff_members/);
  assert.match(backend, /premium_checks/);
  assert.match(backend, /premium_bills/);
});

test("Token, durata e costo configurabile vengono registrati senza prezzi inventati", () => {
  assert.match(api, /input_tokens/);
  assert.match(api, /output_tokens/);
  assert.match(api, /estimated_cost_eur/);
  assert.match(api, /insertPremiumAiCostEvent/);
  assert.match(docs, /PREMIUM_AI_INPUT_EUR_PER_1M_TOKENS/);
  assert.match(docs, /PREMIUM_AI_OUTPUT_EUR_PER_1M_TOKENS/);
  assert.match(docs, /tariffe non sono codificate nel repository/);
});

test("La migrazione impedisce analisi concorrenti e conserva audit tecnico", () => {
  assert.match(migration, /requested_by_staff_id/);
  assert.match(migration, /usage_details jsonb/);
  assert.match(migration, /response_ids jsonb/);
  assert.match(migration, /premium_analysis_runs_one_active_per_bill/);
  assert.match(migration, /where status in \('queued', 'running'\)/);
  assert.doesNotMatch(migration, /drop table/i);
  for (const field of [
    "requested_by_staff_column_present",
    "usage_details_column_present",
    "response_ids_column_present",
    "one_active_analysis_per_bill",
    "analysis_runs_are_staff_only",
    "cost_events_are_admin_only",
    "anon_has_no_ai_table_grants",
    "no_duplicate_active_runs"
  ]) assert.match(verify, new RegExp(field));
});
