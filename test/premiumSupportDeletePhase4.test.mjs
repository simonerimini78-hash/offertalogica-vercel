import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("fase 4: l'app espone eliminazione della richiesta rossa con conferma", () => {
  const js = read("public/app-support.js");
  assert.match(js, /ELIMINA RICHIESTA/);
  assert.match(js, /confirmDeleteRequest/);
  assert.match(js, /OffertaLogicaPremiumDialog/);
  assert.match(js, /deleteCurrentCase/);
});

test("fase 4: il cliente elimina solo la conversazione selezionata del proprio account", () => {
  const js = read("public/app-support.js");
  assert.match(js, /from\("premium_communications"\)[\s\S]{0,120}\.delete\(\)[\s\S]{0,200}\.eq\("user_id", session\.user\.id\)[\s\S]{0,160}\.eq\("subject", currentCase\.subject\)/);
});

test("fase 4: una risposta cliente non ricrea una pratica eliminata dallo staff", () => {
  const js = read("public/app-support.js");
  assert.match(js, /const live = await loadSupportCommunications\(\)/);
  assert.match(js, /live\.openCase\.caseId !== currentCase\.caseId/);
  assert.match(js, /potrebbe essere stata chiusa o eliminata dallo staff/);
});

test("fase 4: lo staff dispone di eliminazione definitiva separata dalla chiusura", () => {
  const js = read("public/staff.js");
  assert.match(js, /id: "staffSupportDeleteCase"/);
  assert.match(js, /ELIMINA PRATICA/);
  assert.match(js, /function deleteSupportCase/);
  assert.match(js, /CHIUDI conserva la conversazione/);
});

test("fase 4: lo staff elimina solo i messaggi della pratica selezionata", () => {
  const js = read("public/staff.js");
  assert.match(js, /from\("premium_communications"\)[\s\S]{0,120}\.delete\(\)[\s\S]{0,200}\.eq\("user_id", target\.userId\)[\s\S]{0,160}\.eq\("subject", target\.supportSubjectRaw\)/);
});

test("fase 4: lo staff non risponde a una pratica gia eliminata dal cliente", () => {
  const js = read("public/staff.js");
  assert.match(js, /const liveMessages = await loadSupportThread\(activeSupportCase\)/);
  assert.match(js, /La pratica non esiste più: potrebbe essere stata eliminata dal cliente/);
});

test("fase 4: la migrazione abilita DELETE ma limita il cliente alle sole comunicazioni support", () => {
  const sql = read("supabase/premium-support-delete-v0.36.29.sql");
  assert.match(sql, /grant delete on table public\.premium_communications to authenticated/i);
  assert.match(sql, /create policy premium_communications_owner_delete_support/i);
  assert.match(sql, /user_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /premium_has_service_access\(\)/i);
  assert.match(sql, /subject like '\[support:%'/i);
});

test("fase 4: il service worker forza la distribuzione del nuovo supporto", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /offertalogica-premium-v03629-support(?:4-(?:delete|fix1)|5-account)/);
  assert.match(sw, /"\/app-support\.js"/);
});
