import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../public/app.html', import.meta.url), 'utf8');
const utilities = await readFile(new URL('../public/app-utilities.js', import.meta.url), 'utf8');
const sw = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/premium-utilities-v0.24.sql', import.meta.url), 'utf8');
const verify = await readFile(new URL('../supabase/premium-utilities-v0.24-verify.sql', import.meta.url), 'utf8');

test('Premium v0.25 aggiunge la gestione utenze senza cambiare la navigazione principale', () => {
  assert.match(html, /APP Premium v0\.(?:30(?:\.\d+)?|31C|32)/);
  assert.match(html, /id="premiumUtilitiesCard"/);
  assert.match(html, /id="premiumUtilityForm"/);
  assert.match(html, /id="premiumUtilityList"/);
  assert.match(html, /<script src="\/app-utilities\.js"><\/script>/);
  assert.match(html, /OffertaLogicaPremiumUtilities\?\.init\(\)/);
  assert.equal((html.match(/data-tab="/g) || []).length, 4);
});

test('Le utenze restano consultabili in sola gestione, mentre le modifiche richiedono un abbonamento valido', () => {
  assert.match(utilities, /profile\?\.account_status !== "active"/);
  assert.match(utilities, /ACTIVE_SUBSCRIPTION_STATUSES\.has\(subscription\.status\)/);
  assert.match(utilities, /current_period_end/);
  assert.match(utilities, /maintenanceMode = !subscription/);
  assert.match(utilities, /La modifica delle utenze richiede un abbonamento attivo/);
  assert.match(utilities, /Sola gestione/);
});

test('Il modulo gestisce creazione, modifica, eliminazione e tipi luce gas dual', () => {
  assert.match(utilities, /\.from\("premium_utilities"\)/);
  assert.match(utilities, /\.insert\(payload\)/);
  assert.match(utilities, /\.update\(payload\)/);
  assert.match(utilities, /\.delete\(\)/);
  assert.match(utilities, /\.eq\("user_id", currentUser\.id\)/);
  assert.match(utilities, /electricity/);
  assert.match(utilities, /gas/);
  assert.match(utilities, /dual/);
  assert.match(utilities, /expected_bills_per_year: 12/);
  assert.match(utilities, /window\.confirm/);
});

test('I dati utente sono renderizzati con nodi testuali e non con HTML dinamico', () => {
  assert.match(utilities, /document\.createElement/);
  assert.match(utilities, /textContent = utility\.label/);
  assert.doesNotMatch(utilities, /innerHTML\s*=/);
  assert.doesNotMatch(utilities, /service_role/i);
  assert.doesNotMatch(utilities, /sb_secret_/i);
});

test('La migrazione fa rispettare sul database il limite di utenze del piano', () => {
  assert.match(migration, /create or replace function public\.premium_can_add_utility\(\)/i);
  assert.match(migration, /included_utilities/);
  assert.match(migration, /premium_has_service_access\(\)/);
  assert.match(migration, /create policy premium_utilities_owner_insert/i);
  assert.match(migration, /premium_can_add_utility\(\)/);
  assert.match(verify, /insert_policy_enforces_limit/);
  assert.doesNotMatch(migration, /drop table/i);
});

test('La cache Premium include il nuovo modulo ed è separata dalla v0.23', () => {
  assert.match(sw, /offertalogica-premium-v(?:30\d*|031c|032)/);
  assert.match(sw, /"\/app-utilities\.js"/);
  assert.doesNotMatch(sw, /offertalogica-premium-v23/);
  assert.doesNotMatch(sw, /offertalogica-app-v22/);
});
