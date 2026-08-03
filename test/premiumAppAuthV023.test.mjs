import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../public/app.html', import.meta.url), 'utf8');
const auth = await readFile(new URL('../public/app-auth.js', import.meta.url), 'utf8');
const sw = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');

test('Premium Auth resta compatibile con la v0.25', () => {
  assert.match(html, /APP Premium v0\.30/);
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2/);
  assert.match(html, /<script src="\/app-auth\.js"><\/script>/);
  assert.match(html, /id="premiumLoginForm"/);
  assert.match(html, /id="premiumSignupForm"/);
  assert.match(html, /OffertaLogicaPremiumAuth\?\.init\(\)/);
});

test('La registrazione è marcata Premium ma non attiva un abbonamento', () => {
  assert.match(auth, /offertalogica_product:\s*"premium"/);
  assert.match(auth, /premium_profiles/);
  assert.match(auth, /premium_subscriptions/);
  assert.doesNotMatch(auth, /insert\([^)]*premium_subscriptions/i);
});

test('Il browser contiene soltanto la chiave pubblicabile', () => {
  assert.match(auth, /https:\/\/kzxdamhfmzaxonpkytcf\.supabase\.co/);
  assert.match(auth, /sb_publishable_poz1xBKiXceLCFV3u_tPIg_5_-ycHcl/);
  assert.doesNotMatch(auth, /service_role/i);
  assert.doesNotMatch(auth, /sb_secret_/i);
});

test('La sessione è persistente e la cache è separata dalla gratuita', () => {
  assert.match(auth, /persistSession:\s*true/);
  assert.match(auth, /autoRefreshToken:\s*true/);
  assert.match(auth, /detectSessionInUrl:\s*true/);
  assert.match(sw, /offertalogica-premium-v30/);
  assert.match(sw, /"\/app-auth\.js"/);
  assert.doesNotMatch(sw, /offertalogica-app-v22/);
});
