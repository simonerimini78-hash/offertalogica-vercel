import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyPremiumAutomaticAnalysis } from "../lib/premiumAiBackend.js";

const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const bills = await readFile(new URL("../public/app-premium-bills.js", import.meta.url), "utf8");
const utilities = await readFile(new URL("../public/app-utilities.js", import.meta.url), "utf8");
const staff = await readFile(new URL("../public/staff-premium.js", import.meta.url), "utf8");
const reader = await readFile(new URL("../lib/pdfPureAiReader.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/premium-maintenance-v0.30.1.sql", import.meta.url), "utf8");
const verify = await readFile(new URL("../supabase/premium-maintenance-v0.30.1-verify.sql", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

function completeLight(overrides = {}) {
  return {
    recognized: true,
    kind: "bolletta",
    commodity: "luce",
    total_amount_eur: 148.62,
    billing_period_start: "2026-07-01",
    billing_period_end: "2026-07-31",
    issue_date: "2026-08-02",
    due_date: "2026-08-20",
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

test("v0.30.1 non trasforma in anomalia una scadenza oltre 30 giorni", () => {
  const result = classifyPremiumAutomaticAnalysis(completeLight({
    scadenza_condizioni_economiche_luce: "2027-01-31",
    document_alerts: [{
      code: "scadenza_condizioni",
      title: "Condizioni in scadenza",
      description: "Le condizioni scadono il 31 gennaio 2027.",
      severity: "medium",
    }],
  }), { now: new Date("2026-08-03T08:00:00Z") });
  assert.equal(result.status, "clear");
  assert.deepEqual(result.reasons, []);
});

test("v0.30.1 mantiene la richiesta di verifica quando la scadenza è entro 30 giorni", () => {
  const result = classifyPremiumAutomaticAnalysis(completeLight({
    scadenza_condizioni_economiche_luce: "2026-08-25",
    document_alerts: [{
      code: "scadenza_condizioni",
      title: "Condizioni in scadenza",
      description: "Le condizioni scadono a breve.",
      severity: "medium",
    }],
  }), { now: new Date("2026-08-03T08:00:00Z") });
  assert.equal(result.status, "review_recommended");
  assert.ok(result.reasons.some(item => item.code === "documento_scadenza_condizioni"));
});

test("l’app Premium mostra numero e spazio del cloud e non il vecchio archivio locale", () => {
  assert.match(app, /APP Premium v0\.(?:30\.2|31C|32|35)/);
  assert.match(app, /id="profileCloudBillCount"/);
  assert.match(app, /id="profileCloudBillSize"/);
  assert.doesNotMatch(app, /id="profileBillArchiveCount"/);
  assert.doesNotMatch(app, /id="profileBillArchiveSize"/);
  assert.doesNotMatch(app, /<script src="\/app-bills\.js"><\/script>/);
  assert.match(bills, /state\.profileCount = byId\("profileCloudBillCount"\)/);
  assert.match(bills, /bills\.reduce\(\(sum, bill\) => sum \+ Number\(bill\.file_size \|\| 0\), 0\)/);
  assert.match(sw, /offertalogica-premium-v(?:302|031c|032|035)/);
  assert.doesNotMatch(sw, /"\/app-bills\.js"/);
});

test("l’eliminazione utenza controlla prima le bollette collegate", () => {
  assert.match(utilities, /\.from\("premium_bills"\)/);
  assert.match(utilities, /\.eq\("utility_id", id\)/);
  assert.match(utilities, /Elimina prima le bollette associate/);
  assert.match(utilities, /premium_bills_utility_owner_fk/);
});

test("cliente e admin possono eliminare solo secondo ruoli e stato del controllo", () => {
  assert.match(bills, /hasActiveHumanCheck/);
  assert.match(bills, /\["pending", "assigned", "in_review", "more_info_required"\]/);
  const checkBranchEnd = bills.indexOf("      if (canDeleteBill(bill, check)) {");
  const automaticBranchStart = bills.indexOf("      if (check) {");
  const articleAppend = bills.indexOf("      article.append(icon, copy, badge, actions);");
  assert.ok(automaticBranchStart >= 0 && checkBranchEnd > automaticBranchStart && checkBranchEnd < articleAppend,
    "Il pulsante elimina deve essere valutato anche quando esiste un controllo concluso");
  assert.match(staff, /ELIMINA BOLLETTA/);
  assert.match(staff, /currentStaff\?\.role === "admin"/);
  assert.match(migration, /premium_bills_admin_delete/);
  assert.match(migration, /premium_bills_storage_admin_delete/);
  assert.match(migration, /drop policy if exists premium_bills_staff_all/);
  assert.match(migration, /premium_bills_staff_select/);
  assert.match(verify, /old_staff_all_policy_removed/);
  assert.match(verify, /admin_database_delete_present/);
  assert.match(verify, /admin_storage_delete_present/);
});

test("il prompt e il filtro deterministico usano la soglia di 30 giorni", () => {
  assert.match(reader, /al massimo 30 giorni/);
});
