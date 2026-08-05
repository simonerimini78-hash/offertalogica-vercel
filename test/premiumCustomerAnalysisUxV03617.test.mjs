import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  customerVisibleAnalysisData,
  premiumBillValuesFromAnalysis,
} from "../lib/premiumAiBackend.js";

const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const dialog = await readFile(new URL("../public/app-dialog.js", import.meta.url), "utf8");
const auth = await readFile(new URL("../public/app-auth.js", import.meta.url), "utf8");
const utilities = await readFile(new URL("../public/app-utilities.js", import.meta.url), "utf8");
const localBills = await readFile(new URL("../public/app-bills.js", import.meta.url), "utf8");
const premiumBills = await readFile(new URL("../public/app-premium-bills.js", import.meta.url), "utf8");
const staff = await readFile(new URL("../public/staff-premium.js", import.meta.url), "utf8");
const staffHtml = await readFile(new URL("../public/staff.html", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/premium-customer-analysis-ux-v0.36.17.sql", import.meta.url), "utf8");
const verify = await readFile(new URL("../supabase/premium-customer-analysis-ux-v0.36.17-verify.sql", import.meta.url), "utf8");

const screening = {
  customerStatus: "correct",
  status: "clear",
  summary: "Controllo completato.",
  reasons: [],
};

test("la whitelist cliente conserva i dati utili ed esclude dati personali e tecnici", () => {
  const visible = customerVisibleAnalysisData({
    commodity: "dual",
    fornitore: "Fornitore esempio",
    nome_offerta_luce: "Luce Casa",
    codice_offerta_luce: "ABC123",
    pod: "IT001E00000000",
    pdr: "12345678901234",
    consumo_luce_kwh: 2450,
    prezzo_luce_eur_kwh: 0.125,
    quota_fissa_vendita_luce_eur_anno: 96,
    consumo_gas_smc: 720,
    prezzo_gas_eur_smc: 0.48,
    total_amount_eur: 187.42,
    codice_fiscale: "RSSMRA00A00H000X",
    intestatario: "Mario Rossi",
    _reader_trace: { response_id: "secret" },
    _premium_analysis: { usage: { total_tokens: 1000 } },
  });

  assert.equal(visible.fornitore_luce, "Fornitore esempio");
  assert.equal(visible.consumo_luce_kwh, 2450);
  assert.equal(visible.prezzo_gas_eur_smc, 0.48);
  assert.equal(visible.total_amount_eur, 187.42);
  assert.equal("codice_fiscale" in visible, false);
  assert.equal("intestatario" in visible, false);
  assert.equal("_reader_trace" in visible, false);
  assert.equal("_premium_analysis" in visible, false);
});

test("una nuova analisi salva subito il sottoinsieme cliente sulla bolletta", () => {
  const values = premiumBillValuesFromAnalysis({
    commodity: "luce",
    fornitore_luce: "Fornitore",
    consumo_luce_kwh: 1200,
    prezzo_luce_eur_kwh: 0.11,
    quota_fissa_vendita_luce_eur_anno: 72,
  }, screening, "run-1", "2026-08-05T18:00:00.000Z");

  assert.deepEqual(values.customer_analysis_data, {
    commodity: "luce",
    fornitore_luce: "Fornitore",
    consumo_luce_kwh: 1200,
    prezzo_luce_eur_kwh: 0.11,
    quota_fissa_vendita_luce_eur_anno: 72,
  });
});

test("la migrazione sincronizza analisi nuove, validate e già esistenti senza aprire la tabella IA al cliente", () => {
  assert.match(migration, /add column if not exists customer_analysis_data jsonb/);
  assert.match(migration, /create or replace function public\.premium_customer_analysis_payload\(p_data jsonb\)/);
  assert.match(migration, /create trigger premium_analysis_runs_sync_customer_data/);
  assert.match(migration, /new\.review_status = 'validated'/);
  assert.match(migration, /with latest_run as/);
  assert.match(migration, /update public\.premium_bills bill/);
  assert.match(migration, /revoke all on function public\.premium_sync_customer_analysis_data\(\)[\s\S]*authenticated/);
  assert.doesNotMatch(migration, /create policy[\s\S]*premium_analysis_runs[\s\S]*authenticated/i);
  assert.match(verify, /bollette_con_dati_visibili/);
});

test("il cliente legge e visualizza i dati della propria bolletta senza interrogare premium_analysis_runs", () => {
  assert.match(premiumBills, /customer_analysis_data/);
  assert.match(premiumBills, /function renderCustomerAnalysisData\(bill\)/);
  assert.match(premiumBills, /Dati letti dalla bolletta/);
  assert.doesNotMatch(premiumBills, /from\("premium_analysis_runs"\)/);
});

test("tutte le conferme dell'app sono modali OffertaLogica e non mostrano l'origine Vercel", () => {
  const sources = [auth, utilities, localBills, premiumBills];
  sources.forEach(source => {
    assert.doesNotMatch(source, /window\.(?:confirm|prompt)\s*\(/);
    assert.doesNotMatch(source, /globalThis\.confirm\s*\(/);
  });
  assert.match(app, /id="premiumActionDialogLayer"/);
  assert.match(app, />OffertaLogica\.it</);
  assert.match(app, /src="\/app-dialog\.js"/);
  assert.match(dialog, /OffertaLogicaPremiumDialog/);
  assert.match(dialog, /confirm\(options = \{\}\)/);
  assert.match(dialog, /form\(options = \{\}\)/);
});

test("l'area staff mostra prima i dati, separa i dettagli tecnici e mette le anomalie prima della chiusura", () => {
  assert.match(staff, /Dati letti dalla bolletta/);
  assert.match(staff, /ai-technical/);
  assert.match(staff, /Dettagli tecnici IA e validazione/);
  const dataIndex = staff.indexOf("renderAiAssistance(body, row)");
  const anomalyIndex = staff.indexOf("renderAnomalies(body, row)");
  const finalWorkflowIndex = staff.indexOf('if (row.check.status !== "pending") renderWorkflow(body, row)');
  assert.ok(dataIndex >= 0);
  assert.ok(anomalyIndex > dataIndex);
  assert.ok(finalWorkflowIndex > anomalyIndex);
});

test("app, staff e cache sono allineati alla release corrente", () => {
  assert.match(app, /APP Premium v0\.36\.18/);
  assert.match(premiumBills, /app_version: "0\.36\.18"/);
  assert.match(staffHtml, /Area staff unica v0\.36\.18/);
  assert.match(staffHtml, /controllo costi · v0\.36\.18/);
  assert.match(sw, /offertalogica-premium-v03618/);
  assert.match(sw, /"\/app-dialog\.js"/);
});
