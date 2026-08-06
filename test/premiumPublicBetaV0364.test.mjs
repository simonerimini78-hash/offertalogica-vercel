import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const auth = await readFile(new URL("../public/app-auth.js", import.meta.url), "utf8");
const utilities = await readFile(new URL("../public/app-utilities.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/premium-public-beta-v0.36.4.sql", import.meta.url), "utf8");
const verify = await readFile(new URL("../supabase/premium-public-beta-v0.36.4-verify.sql", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

 test("v0.36.4 mostra un solo riquadro account per stato", () => {
  assert.match(app, /id="premiumProfileSummary"[^>]*hidden/);
  assert.match(app, /id="premiumAuthCard"/);
  assert.match(app, /id="premiumAuthSignedIn"[^>]*hidden/);
  assert.match(auth, /showAccountPanels\(\{ signedIn: false \}\)/);
  assert.match(auth, /showAccountPanels\(\{ signedIn: true \}\)/);
  assert.doesNotMatch(app, /Accedi o crea il tuo account\./);
  assert.doesNotMatch(app, /<span class="pill">EMAIL<\/span>/);
  assert.doesNotMatch(app, /La registrazione non attiva un abbonamento/);
});

test("la beta pubblica crea una sola prova per gli account idonei", () => {
  assert.match(migration, /create or replace function public\.premium_activate_beta_trial\(\)/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /not public\.premium_has_current_acceptances\(\)/);
  assert.match(migration, /'trialing'/);
  assert.match(migration, /'premium-beta'/);
  assert.match(migration, /included_utilities[\s\S]*2/);
  assert.match(migration, /included_bills_per_year[\s\S]*30/);
  assert.match(migration, /interval '90 days'/);
  assert.match(migration, /reason', 'subscription_exists'/);
  assert.match(verify, /premium_public_beta_v0\.36\.4_ok/);
});

test("account e utenze tentano l’attivazione beta prima di bloccare le operazioni", () => {
  assert.match(auth, /client\.rpc\("premium_activate_beta_trial"\)/);
  assert.match(utilities, /client\.rpc\("premium_activate_beta_trial"\)/);
  assert.match(utilities, /subscription = await activateBetaTrialIfEligible/);
});

test("versione e cache PWA sono aggiornate", () => {
  assert.match(app, /APP Premium v0\.36\.25/);
  assert.match(sw, /offertalogica-premium-v03625/);
});
