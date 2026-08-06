import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const bills = await readFile(new URL("../public/app-premium-bills.js", import.meta.url), "utf8");
const staff = await readFile(new URL("../public/staff.js", import.meta.url), "utf8");
const staffHtml = await readFile(new URL("../public/staff.html", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/premium-complimentary-trial-restore-v0.36.13.sql", import.meta.url), "utf8");
const verify = await readFile(new URL("../supabase/premium-complimentary-trial-restore-v0.36.13-verify.sql", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

test("v0.36.13 chiarisce che il totale riguarda gli importi delle bollette", () => {
  assert.match(app, /Totale importi delle bollette/);
  assert.doesNotMatch(app, /Spesa cloud registrata/);
  assert.match(bills, /Somma degli importi di/);
  assert.match(bills, /bollette archiviate/);
  assert.match(bills, /Nessuna bolletta con importo disponibile/);
});

test("v0.36.13 salva i giorni residui della prova prima dell omaggio", () => {
  assert.match(migration, /complimentary_restore_trial boolean/);
  assert.match(migration, /complimentary_trial_period_start timestamptz/);
  assert.match(migration, /complimentary_trial_remaining_seconds bigint/);
  assert.match(migration, /current_period_end - v_period_start/);
  assert.match(migration, /v_subscription\.status = 'trialing'/);
  assert.match(migration, /v_subscription\.plan_code = 'premium-beta'/);
});

test("v0.36.13 ripristina la prova residua alla revoca dell omaggio", () => {
  assert.match(migration, /status = 'trialing'/);
  assert.match(migration, /plan_code = 'premium-beta'/);
  assert.match(migration, /included_bills_per_year = 4/);
  assert.match(migration, /provider = 'offertalogica-beta'/);
  assert.match(migration, /restored_trial/);
  assert.match(migration, /trial_ends_at/);
  assert.match(migration, /make_interval/);
});

test("v0.36.13 ripristina la prova anche alla scadenza naturale dell omaggio", () => {
  assert.match(migration, /create or replace function public\.premium_refresh_trial_lifecycle/);
  assert.match(migration, /subscription\.complimentary_restore_trial = true/);
  assert.match(migration, /subscription\.current_period_end <= now\(\)/);
  assert.match(migration, /archive_access_until = now\(\).*interval '90 days'/s);
});

test("v0.36.13 mantiene le bollette dell omaggio nel conteggio della prova", () => {
  assert.match(migration, /Le bollette caricate durante[\s\S]+concorrono al limite di quattro/);
  assert.match(migration, /current_period_start = coalesce\(subscription\.complimentary_trial_period_start, subscription\.created_at\)/);
  assert.doesNotMatch(migration, /delete from public\.premium_bills/i);
});

test("v0.36.13 aggiorna il messaggio staff in base al risultato reale", () => {
  assert.match(staff, /data\?\.restored_trial/);
  assert.match(staff, /La prova gratuita residua è stata ripristinata/);
  assert.match(staff, /L’archivio è ora in sola lettura/);
  assert.match(staff, /verranno ripristinati i giorni residui/);
});

test("v0.36.13 include migrazione verificabile e aggiorna app staff e cache", () => {
  assert.match(verify, /premium_complimentary_trial_restore_v0\.36\.13_ok/);
  assert.match(app, /APP Premium v0\.36\.20/);
  assert.match(staffHtml, /Area staff unica v0\.36\.20/);
  assert.match(sw, /offertalogica-premium-v03620/);
});
