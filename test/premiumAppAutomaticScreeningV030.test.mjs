import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const bills = await readFile(new URL("../public/app-premium-bills.js", import.meta.url), "utf8");
const staff = await readFile(new URL("../public/staff-premium.js", import.meta.url), "utf8");
const api = await readFile(new URL("../api/premium-ai-analysis.js", import.meta.url), "utf8");
const backend = await readFile(new URL("../lib/premiumAiBackend.js", import.meta.url), "utf8");
const reader = await readFile(new URL("../lib/pdfPureAiReader.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/premium-auto-screening-v0.30.sql", import.meta.url), "utf8");
const verify = await readFile(new URL("../supabase/premium-auto-screening-v0.30-verify.sql", import.meta.url), "utf8");
const trafficLightMigration = await readFile(new URL("../supabase/premium-traffic-light-v0.36.3.sql", import.meta.url), "utf8");
const apiFiles = (await readdir(new URL("../api/", import.meta.url))).filter(name => name.endsWith(".js"));

test("l’upload cliente avvia automaticamente l’endpoint esistente con billId", () => {
  assert.match(bills, /await runAutomaticAnalysis\(billId, \{ announce: true \}\)/);
  assert.match(bills, /fetch\("\/api\/premium-ai-analysis"/);
  assert.match(bills, /body: JSON\.stringify\(\{ billId: id \}\)/);
  assert.match(api, /customerMode = Boolean\(body\?\.billId\) && !body\?\.checkId/);
  assert.match(api, /verifyPremiumCustomer/);
  assert.match(api, /loadPremiumCustomerBill/);
});

test("il pulsante di controllo umano compare soltanto per il rosso confermato", () => {
  assert.match(bills, /function canRequestCheck\(bill, check\)/);
  assert.match(bills, /bill\.automatic_screening_status === "review_recommended"/);
  assert.match(bills, /bill\.customer_status === "anomaly_found"/);
  assert.match(bills, /bill\.processing_status === "completed"/);
  assert.match(bills, /if \(canRequestCheck\(bill, check\)\)/);
  assert.match(trafficLightMigration, /v_screening_status <> 'review_recommended'/);
  assert.match(trafficLightMigration, /v_processing_status <> 'completed'/);
  assert.match(trafficLightMigration, /v_customer_status <> 'anomaly_found'/);
  assert.match(trafficLightMigration, /premium_bill_not_requestable/);
});

test("l’archivio mostra importo, periodo e totale annuale aggiornati dall’IA", () => {
  for (const id of ["premiumCloudSpendTotal", "premiumCloudSpendMeta", "premiumCloudSpendYear"]) {
    assert.match(app, new RegExp(`id="${id}"`));
  }
  assert.match(bills, /total_amount_eur/);
  assert.match(bills, /billing_period_start/);
  assert.match(bills, /billing_period_end/);
  assert.match(bills, /function renderCloudSpend\(\)/);
  assert.match(backend, /premiumBillValuesFromAnalysis/);
});

test("il cliente riceve solo esito sintetico mentre i dati estratti restano staff-only", () => {
  assert.match(api, /extractedData: customerMode \? undefined : extractedData/);
  assert.match(backend, /customer_visible: false/);
  assert.match(migration, /I dati grezzi IA restano in premium_analysis_runs/);
  assert.match(staff, /premium_analysis_runs/);
});

test("schema e policy impediscono al browser di falsificare uno screening", () => {
  assert.match(migration, /automatic_screening_status = 'pending'/);
  assert.match(migration, /automatic_analysis_run_id is null/);
  assert.match(migration, /premium_bills_storage_owner_insert/);
  assert.match(migration, /premium-auto-screening-v0\.30/);
  for (const field of [
    "bill_screening_columns_present",
    "analysis_origin_columns_present",
    "bill_insert_requires_pending_screening",
    "storage_insert_requires_pending_screening",
    "request_requires_exception",
    "anon_grants_absent",
  ]) assert.match(verify, new RegExp(field));
});

test("il lettore richiede importo, periodo, date e alert motivati", () => {
  for (const field of [
    "billing_period_start",
    "billing_period_end",
    "issue_date",
    "due_date",
    "total_amount_eur",
    "alerts",
    "document_alerts",
  ]) assert.match(reader, new RegExp(field));
  assert.match(reader, /Non inventare anomalie/);
});

test("v0.30 non aggiunge una tredicesima funzione Vercel", () => {
  assert.ok(apiFiles.length <= 12, `Funzioni API trovate: ${apiFiles.length}`);
  assert.ok(!apiFiles.includes("health.js"));
  assert.ok(apiFiles.includes("premium-ai-analysis.js"));
});
