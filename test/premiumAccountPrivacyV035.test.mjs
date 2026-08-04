import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const auth = await readFile(new URL("../public/app-auth.js", import.meta.url), "utf8");
const staffHtml = await readFile(new URL("../public/staff.html", import.meta.url), "utf8");
const staff = await readFile(new URL("../public/staff.js", import.meta.url), "utf8");
const api = await readFile(new URL("../api/premium-ai-analysis.js", import.meta.url), "utf8");
const backend = await readFile(new URL("../lib/premiumAiBackend.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/premium-account-privacy-v0.35.sql", import.meta.url), "utf8");
const verify = await readFile(new URL("../supabase/premium-account-privacy-v0.35-verify.sql", import.meta.url), "utf8");
const privacy = await readFile(new URL("../public/privacy-premium.html", import.meta.url), "utf8");
const terms = await readFile(new URL("../public/termini-condizioni.html", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

test("v0.35 aggiunge recupero e cambio password tramite Supabase Auth", () => {
  assert.match(app, /id="premiumForgotPassword"/);
  assert.match(app, /id="premiumRecoveryForm"/);
  assert.match(app, /id="premiumChangePasswordForm"/);
  assert.match(auth, /resetPasswordForEmail/);
  assert.match(auth, /PASSWORD_RECOVERY/);
  assert.match(auth, /auth\.updateUser\(\{ password \}\)/);
  assert.match(auth, /auth\.signOut\(\)/);
});

test("la registrazione richiede accettazioni non preselezionate e versionate", () => {
  for (const name of ["accept_terms", "accept_privacy", "accept_cloud"]) {
    assert.match(app, new RegExp(`name="${name}" type="checkbox" required`));
  }
  assert.doesNotMatch(app, /type="checkbox"[^>]*checked/);
  for (const version of [
    "premium-terms-v0.35-2026-08-03",
    "premium-privacy-v0.35-2026-08-03",
    "premium-cloud-ai-v0.35-2026-08-03",
  ]) assert.match(migration, new RegExp(version));
  for (const version of [
    "premium-terms-v0.36.7-2026-08-04",
    "premium-privacy-v0.36.6-2026-08-04",
    "premium-cloud-ai-v0.36.6-2026-08-04",
  ]) assert.match(auth, new RegExp(version));
  assert.match(auth, /premium_legal_acceptance: "accepted"/);
});

test("il database blocca nuove operazioni senza accettazioni correnti ma conserva la gestione dati", () => {
  assert.match(migration, /create or replace function public\.premium_has_current_acceptances/);
  assert.match(migration, /premium_has_service_access[\s\S]*premium_has_current_acceptances/);
  assert.match(migration, /account_status in \('active', 'deletion_requested'\)/);
  assert.match(migration, /premium_accept_current_terms/);
  assert.match(migration, /server_recorded_at/);
  assert.doesNotMatch(migration, /drop table/i);
});

test("la richiesta di cancellazione è reversibile e la cancellazione completa richiede admin, richiesta e storage vuoto", () => {
  assert.match(app, /id="premiumDeletionRequest"/);
  assert.match(app, /id="premiumDeletionCancel"/);
  assert.match(auth, /premium_request_account_deletion/);
  assert.match(auth, /premium_cancel_account_deletion_request/);
  assert.match(migration, /premium_staff_complete_account_deletion/);
  assert.match(migration, /premium_account_deletion_not_requested/);
  assert.match(migration, /premium_account_storage_not_empty/);
  assert.match(migration, /delete from auth\.users/);
  assert.match(migration, /premium_staff_account_delete_blocked/);
  assert.match(staff, /Elimina account completo/);
  assert.match(staff, /CANCELLA_ACCOUNT/);
});

test("staff mostra configurazione operativa senza esporre segreti", () => {
  assert.match(staffHtml, /Configurazione operativa/);
  assert.match(staffHtml, /id="systemConfigGrid"/);
  assert.match(staff, /action: "config_status"/);
  assert.match(api, /persistentRateLimitConfigured/);
  assert.match(api, /pricing,/);
  assert.match(api, /modelDefaultApplied/);
  assert.match(api, /staff\.role !== "admin"/);
  assert.match(backend, /PREMIUM_ADMIN_REQUIRED/);
  assert.doesNotMatch(staff, /sb_secret_/i);
  assert.doesNotMatch(api, /openAiApiKey:\s*backend\.openAiApiKey/);
  assert.doesNotMatch(api, /serviceKey:\s*backend\.serviceKey/);
});

test("informativa e termini descrivono archivio Premium, IA, accesso staff e cancellazione", () => {
  assert.match(privacy, /archivio cloud/i);
  assert.match(privacy, /analisi automatica/i);
  assert.match(privacy, /richiede esplicitamente il controllo umano/i);
  assert.match(privacy, /cancellazione completa/i);
  assert.match(terms, /id="premium"/);
  assert.match(terms, /area Premium separata/i);
  assert.match(sw, /offertalogica-premium-v0367/);
  assert.match(sw, /privacy-premium\.html/);
  assert.match(app, /APP Premium v0\.36\.7/);
});

test("la verifica SQL copre funzioni, permessi e vincoli di cancellazione", () => {
  for (const name of [
    "profile_deletion_columns_present",
    "current_acceptances_function_present",
    "service_access_requires_acceptances",
    "signup_trigger_records_versions",
    "account_delete_requires_request",
    "account_delete_checks_storage_empty",
    "account_delete_blocks_active_staff",
    "anon_cannot_execute_account_functions",
  ]) assert.match(verify, new RegExp(name));
});

test("v0.35 non aggiunge funzioni Vercel", async () => {
  const files = (await readdir(new URL("../api/", import.meta.url))).filter(name => name.endsWith(".js"));
  assert.equal(files.length, 12);
});
