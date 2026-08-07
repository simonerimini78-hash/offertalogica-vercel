import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/premium-trial-retention-v0.36.6.sql", import.meta.url), "utf8");
const verify = await readFile(new URL("../supabase/premium-trial-retention-v0.36.6-verify.sql", import.meta.url), "utf8");
const auth = await readFile(new URL("../public/app-auth.js", import.meta.url), "utf8");
const utilities = await readFile(new URL("../public/app-utilities.js", import.meta.url), "utf8");
const bills = await readFile(new URL("../public/app-premium-bills.js", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const backend = await readFile(new URL("../lib/premiumAiBackend.js", import.meta.url), "utf8");
const privacy = await readFile(new URL("../public/privacy-premium.html", import.meta.url), "utf8");
const terms = await readFile(new URL("../public/termini-condizioni.html", import.meta.url), "utf8");
const docs = await readFile(new URL("../docs/PREMIUM-TRIAL-RETENTION-v0.36.6.md", import.meta.url), "utf8");

test("v0.36.6 registra scadenza archivio e cancellazione dati", () => {
  assert.match(migration, /add column if not exists archive_access_until timestamptz/);
  assert.match(migration, /add column if not exists data_purged_at timestamptz/);
  assert.match(migration, /current_period_end \+ interval '90 days'/);
  assert.match(migration, /status = 'expired'/);
  assert.match(migration, /create or replace function public\.premium_refresh_trial_lifecycle\(\)/);
  assert.match(migration, /create or replace function public\.premium_has_archive_access\(\)/);
  assert.match(verify, /premium_trial_retention_v0\.36\.6_ok/);
});

test("durante i 90 giorni restano soltanto lettura e cancellazione", () => {
  for (const policy of [
    "premium_utilities_owner_select",
    "premium_utilities_owner_delete",
    "premium_contracts_owner_select",
    "premium_bills_owner_select",
    "premium_bills_owner_delete",
    "premium_checks_owner_select",
    "premium_anomalies_owner_select",
    "premium_communications_owner_select",
    "premium_bills_storage_owner_select",
    "premium_bills_storage_owner_delete",
  ]) assert.match(migration, new RegExp(`create policy ${policy}[\\s\\S]*premium_has_archive_access`));
  assert.doesNotMatch(migration, /create policy premium_(?:utilities|contracts|bills)_owner_(?:insert|update)[\s\S]*premium_has_archive_access/);
  for (const source of [auth, utilities, bills]) {
    assert.match(source, /premium_refresh_trial_lifecycle/);
    assert.match(source, /archive_access_until/);
    assert.match(source, /data_purged_at/);
  }
  assert.match(utilities, /readOnly/);
  assert.match(bills, /readOnly/);
  assert.match(auth, /SOLA LETTURA/);
});

test("la cancellazione definitiva è protetta e non elimina Storage via SQL", () => {
  assert.match(migration, /premium_trial_cleanup_candidates/);
  assert.match(migration, /left join storage\.objects object_record/);
  assert.match(migration, /storage\.foldername\(object_record\.name\)/);
  assert.match(migration, /premium_finalize_trial_data_purge/);
  assert.match(migration, /premium_cleanup_storage_not_empty/);
  assert.match(migration, /grant execute on function public\.premium_trial_cleanup_candidates\(integer\) to service_role/);
  assert.match(migration, /grant execute on function public\.premium_finalize_trial_data_purge\(uuid\) to service_role/);
  assert.doesNotMatch(migration, /delete from storage\.objects/i);
  assert.match(docs, /Storage API/);
  assert.match(docs, /cancellazione fisica automatica[\s\S]*non è attiva/i);
});

test("documenti e accettazioni descrivono la prova e i 90 giorni", () => {
  for (const version of [
    "premium-terms-v0.36.6-2026-08-04",
    "premium-privacy-v0.36.6-2026-08-04",
    "premium-cloud-ai-v0.36.6-2026-08-04",
  ]) assert.match(migration, new RegExp(version));
  for (const version of [
    "premium-terms-v0.36.22-2026-08-06",
    "premium-privacy-v0.36.6-2026-08-04",
    "premium-cloud-ai-v0.36.6-2026-08-04",
  ]) {
    assert.match(auth, new RegExp(version));
    assert.match(backend, new RegExp(version));
  }
  assert.match(terms, /La prova dura 30 giorni/);
  assert.match(terms, /90 giorni successivi/);
  assert.match(terms, /non attiva automaticamente alcun abbonamento/);
  assert.match(privacy, /Durante i 30 giorni di prova/);
  assert.match(privacy, /ulteriori 90 giorni/);
  assert.match(privacy, /premium-privacy-v0\.36\.6-2026-08-04/);
});

test("versione applicativa e limite Vercel restano coerenti", async () => {
  assert.match(app, /APP Premium v0\.36\.29/);
  assert.match(app, /Versione condizioni correnti: v0\.36\.22/);
  assert.match(app, /archivio resta consultabile, scaricabile e cancellabile per 90 giorni/);
  assert.match(sw, /offertalogica-premium-v03629/);
  assert.match(bills, /app_version: "0\.36\.29"/);
  const apiFiles = (await readdir(new URL("../api/", import.meta.url))).filter(name => name.endsWith(".js"));
  assert.equal(apiFiles.length, 12);
});
