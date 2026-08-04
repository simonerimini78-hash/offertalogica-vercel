import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const auth = await readFile(new URL("../public/app-auth.js", import.meta.url), "utf8");
const utilities = await readFile(new URL("../public/app-utilities.js", import.meta.url), "utf8");
const bills = await readFile(new URL("../public/app-premium-bills.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/premium-trial-limits-v0.36.5.sql", import.meta.url), "utf8");
const verify = await readFile(new URL("../supabase/premium-trial-limits-v0.36.5-verify.sql", import.meta.url), "utf8");
const env = await readFile(new URL("../.env.example", import.meta.url), "utf8");

test("v0.36.5 porta la prova a 30 giorni e 4 bollette", () => {
  assert.match(migration, /interval '30 days'/);
  assert.match(migration, /'premium-beta'[\s\S]*2,[\s\S]*4,[\s\S]*'offertalogica-beta'/);
  assert.match(migration, /update public\.premium_subscriptions[\s\S]*included_bills_per_year = 4/);
  assert.match(migration, /current_period_end = coalesce\(current_period_start, created_at, now\(\)\) \+ interval '30 days'/);
  assert.doesNotMatch(migration, /interval '90 days'/);
});

test("il limite bollette usa il periodo corrente e non gli ultimi 12 mesi", () => {
  assert.match(migration, /create or replace function public\.premium_can_add_bill/);
  assert.match(migration, /current_period_start/);
  assert.match(migration, /bill\.created_at >= coalesce\(\(select count_start from active_subscription\), now\(\)\)/);
  assert.doesNotMatch(migration, /bill\.created_at >= now\(\) - interval '1 year'/);
  assert.match(bills, /current_period_start/);
  assert.match(bills, /bollette prova/);
  assert.match(bills, /limite di 4 bollette incluse nella prova gratuita/);
});

test("una sola verifica staff è applicata esclusivamente al trial beta", () => {
  assert.match(migration, /v_subscription_status = 'trialing' and v_plan_code = 'premium-beta'/);
  assert.match(migration, /v_trial_check_count >= 1/);
  assert.match(migration, /premium_trial_staff_limit_reached/);
  assert.match(migration, /v_screening_status <> 'review_recommended'/);
  assert.match(bills, /trialStaffCheckUsed/);
  assert.match(bills, /CONTROLLO PROVA GIÀ USATO/);
  assert.match(bills, /La verifica staff inclusa nella prova è già stata utilizzata/);
});

test("le due utenze della prova devono riferirsi alla stessa abitazione", () => {
  assert.match(migration, /premium_normalize_supply_address/);
  assert.match(migration, /premium_utility_allowed_for_plan/);
  assert.match(migration, /status = 'trialing' and plan_code = 'premium-beta'/);
  assert.match(migration, /premium_utilities_owner_insert[\s\S]*premium_utility_allowed_for_plan\(id, address\)/);
  assert.match(migration, /premium_utilities_owner_update[\s\S]*premium_utility_allowed_for_plan\(id, address\)/);
  assert.match(utilities, /Durante la prova inserisci l’indirizzo dell’abitazione/);
  assert.match(utilities, /stessa abitazione e usare lo stesso indirizzo/);
  assert.match(app, /Obbligatorio durante la prova/);
});

test("l’interfaccia espone chiaramente i limiti senza carta", () => {
  assert.match(app, /La prova dura 30 giorni e include fino a 4 bollette/);
  assert.match(app, /Nessuna carta e nessun addebito automatico/);
  assert.match(auth, /4 bollette · 1 controllo staff/);
  assert.match(auth, /trialDaysRemaining/);
  assert.match(auth, /giorni rimanenti/);
});

test("verifica SQL, dominio Premium e versione sono aggiornati", () => {
  assert.match(verify, /premium_trial_limits_v0\.36\.5_ok/);
  assert.match(env, /https:\/\/premium\.offertalogica\.it/);
  assert.match(app, /APP Premium v0\.36\.8/);
});
