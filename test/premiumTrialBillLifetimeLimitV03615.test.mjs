import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/premium-trial-bill-lifetime-limit-v0.36.15.sql", import.meta.url), "utf8");
const verify = await readFile(new URL("../supabase/premium-trial-bill-lifetime-limit-v0.36.15-verify.sql", import.meta.url), "utf8");
const bills = await readFile(new URL("../public/app-premium-bills.js", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const auth = await readFile(new URL("../public/app-auth.js", import.meta.url), "utf8");
const terms = await readFile(new URL("../public/termini-condizioni.html", import.meta.url), "utf8");
const staff = await readFile(new URL("../public/staff.html", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

test("v0.36.15 conserva il consumo della quota anche dopo la cancellazione della bolletta", () => {
  assert.match(migration, /create table if not exists public\.premium_trial_bill_usage/);
  assert.match(migration, /bill_id uuid not null/);
  assert.doesNotMatch(migration, /bill_id uuid[^\n]*references public\.premium_bills/);
  assert.match(migration, /Registro permanente degli upload/);
  assert.match(migration, /status in \('reserved', 'committed'\)/);
});

test("la prenotazione serializza il trial e blocca il quinto upload complessivo", () => {
  assert.match(migration, /create or replace function public\.premium_reserve_trial_bill_upload/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /v_subscription\.status = 'trialing'[\s\S]*v_subscription\.plan_code = 'premium-beta'/);
  assert.match(migration, /v_usage_count >= v_limit/);
  assert.match(migration, /premium_trial_bill_limit_reached/);
  assert.match(migration, /insert into public\.premium_trial_bill_usage/);
});

test("gli upload dell omaggio con prova sospesa vengono registrati senza limitarne il Premium", () => {
  assert.match(migration, /plan_code = 'premium-complimentary'/);
  assert.match(migration, /complimentary_restore_trial = true/);
  assert.match(migration, /v_tracks_trial := v_enforces_trial_limit/);
  assert.match(migration, /case when v_enforces_trial_limit then v_limit else null end/);
});

test("un upload fallito libera soltanto una prenotazione non ancora completata", () => {
  assert.match(migration, /create or replace function public\.premium_release_trial_bill_upload/);
  assert.match(migration, /usage\.status = 'reserved'/);
  assert.match(migration, /not exists \([\s\S]*from public\.premium_bills bill/);
  assert.match(migration, /create or replace function public\.premium_mark_bill_upload_complete/);
  assert.match(migration, /from storage\.objects object/);
  assert.match(migration, /status = 'committed'/);
  assert.match(migration, /premium_bill_storage_missing/);
  assert.match(migration, /premium_release_uncommitted_bill_usage_after_delete/);
  assert.match(migration, /usage\.status = 'reserved'/);
});

test("la policy database richiede la prenotazione legata allo stesso bill id", () => {
  assert.match(migration, /create or replace function public\.premium_can_add_bill\([\s\S]*p_bill_id uuid/);
  assert.match(migration, /usage\.bill_id = p_bill_id/);
  assert.match(migration, /premium_can_add_bill\(utility_id, id\)/);
  assert.match(migration, /automatic_screening_status = 'pending'/);
});

test("il client prenota prima dell insert e conferma solo dopo il salvataggio Storage", () => {
  const reserve = bills.indexOf('client.rpc("premium_reserve_trial_bill_upload"');
  const insert = bills.indexOf('.from("premium_bills")', reserve);
  const storage = bills.indexOf('.upload(storagePath, file', insert);
  const commit = bills.indexOf('client.rpc("premium_mark_bill_upload_complete"', storage);
  assert.ok(reserve >= 0);
  assert.ok(insert > reserve);
  assert.ok(storage > insert);
  assert.ok(commit > storage);
  assert.match(bills, /premium_release_trial_bill_upload/);
  assert.match(bills, /upload_complete: false/);
  assert.match(bills, /uploadWasCommitted/);
  assert.match(bills, /app_version: "0\.36\.23"/);
});

test("eliminare una bolletta non riduce il contatore della prova", () => {
  assert.match(bills, /if \(!isBetaTrial\(\) && Number\.isFinite\(createdAt\)/);
  assert.match(bills, /premium_trial_bill_usage_count/);
  assert.match(bills, /4 bollette complessive incluse nella prova gratuita/);
  assert.match(bills, /Eliminare un documento non libera un nuovo caricamento/);
});

test("interfaccia e condizioni dichiarano la regola senza ambiguità", () => {
  assert.match(app, /4 bollette complessivamente caricate/);
  assert.match(auth, /Eliminare una bolletta non libera un nuovo caricamento/);
  assert.match(terms, /un massimo di quattro bollette complessive/);
});

test("il verificatore riconosce la policy anche quando PostgreSQL qualifica gli argomenti", () => {
  assert.match(verify, /coalesce\(with_check, ''\) ilike '%premium_can_add_bill%'/i);
  assert.doesNotMatch(verify, /with_check like '%premium_can_add_bill\(utility_id, id\)%'/i);
});

test("v0.36.15 include verifica SQL e aggiorna app staff e cache", () => {
  assert.match(verify, /premium_trial_bill_lifetime_limit_v0\.36\.15_ok/);
  assert.match(app, /APP Premium v0\.36\.23/);
  assert.match(staff, /Area staff unica v0\.36\.23/);
  assert.match(sw, /offertalogica-premium-v03623/);
});
