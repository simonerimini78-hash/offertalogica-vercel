import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("fase 2: l'app Premium espone la richiesta assistenza senza cambiare navigazione", () => {
  const html = read("public/app.html");
  assert.match(html, /id="premiumSupportOpen"/);
  assert.match(html, /id="premiumSupportPanel"/);
  assert.match(html, /id="premiumSupportForm"/);
  assert.match(html, /Account e accesso/);
  assert.match(html, /Abbonamento e pagamento/);
  assert.match(html, /Installazione e aggiornamento app/);
  assert.match(html, /<script src="\/app-support\.js"><\/script>/);
  assert.match(html, /OffertaLogicaPremiumSupport\?\.init\(\)/);
});

test("fase 2: premium_communications resta il canale cliente-staff, senza nuova tabella pratiche", () => {
  const js = read("public/app-support.js");
  assert.match(js, /\.from\("premium_communications"\)\.insert\(/);
  assert.match(js, /direction:\s*"user_to_staff"/);
  assert.match(js, /channel:\s*"in_app"/);
  assert.match(js, /created_by_user_id:\s*session\.user\.id/);
  assert.match(js, /`\[support:red:\$\{category\}:\$\{caseId\}\]/);
  assert.doesNotMatch(js, /fetch\(["'`]\/api\//);
  assert.doesNotMatch(js, /premium_support_cases/);
});

test("fase 2: lo staff separa risoluzione pratica e lettura messaggi", () => {
  const js = read("public/staff.js");
  const html = read("public/staff.html");
  assert.match(js, /\.from\("premium_communications"\)/);
  assert.match(js, /resolved_at/);
  assert.match(js, /type:\s*"support_request"/);
  assert.match(js, /direction:\s*"staff_to_user"/);
  assert.match(js, /CHIUDI PRATICA/);
  assert.match(js, /\.update\(\{\s*resolved_at:\s*new Date\(\)\.toISOString\(\)\s*\}\)/);
  assert.match(html, /option value="support_request">Richiesta assistenza/);
});

test("fase 2: la migrazione aggiunge resolved_at e protegge l'inserimento cliente", () => {
  const sql = read("supabase/premium-support-resolution-v0.36.30.sql");
  assert.match(sql, /add column if not exists resolved_at timestamptz/);
  assert.match(sql, /resolved_at = read_at/);
  assert.match(sql, /read_at = null/);
  assert.match(sql, /direction = 'user_to_staff'/);
  assert.match(sql, /and resolved_at is null/);
});

test("fase 2: il service worker conosce il modulo assistenza", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /"\/app-support\.js"/);
});
