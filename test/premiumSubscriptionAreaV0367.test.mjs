import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const auth = await readFile(new URL("../public/app-auth.js", import.meta.url), "utf8");
const backend = await readFile(new URL("../lib/premiumAiBackend.js", import.meta.url), "utf8");
const terms = await readFile(new URL("../public/termini-condizioni.html", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/premium-home-bill-limits-terms-v0.36.22.sql", import.meta.url), "utf8");
const verify = await readFile(new URL("../supabase/premium-home-bill-limits-terms-v0.36.22-verify.sql", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const bills = await readFile(new URL("../public/app-premium-bills.js", import.meta.url), "utf8");

const TERMS_VERSION = "premium-terms-v0.36.22-2026-08-06";
const PRIVACY_VERSION = "premium-privacy-v0.36.6-2026-08-04";
const CLOUD_VERSION = "premium-cloud-ai-v0.36.6-2026-08-04";

test("l’area Abbonamento resta coerente con il checkout Stripe controllato", () => {
  for (const id of [
    "premiumSubscriptionPanel",
    "premiumSubscriptionBadge",
    "premiumSubscriptionStatus",
    "premiumSubscriptionPeriod",
    "premiumSubscriptionCurrentPrice",
    "premiumSubscriptionNextPrice",
    "premiumSubscriptionRenewal",
    "premiumSubscriptionActionCopy",
  ]) assert.match(app, new RegExp(`id="${id}"`));
  assert.match(auth, /renderSubscriptionPanel/);
  assert.match(auth, /Nessuna conversione automatica/);
  assert.match(auth, /cancel_at_period_end/);
  assert.match(app, /id="premiumSubscriptionPurchase"/);
  assert.match(app, /ATTIVA PREMIUM · 3,99 €\/MESE\*/);
  assert.match(auth, /premium-billing/);
  assert.match(auth, /create_checkout/);
});

test("prezzi e rinnovo corrispondono alla formula commerciale approvata", () => {
  assert.match(app, /3,99 €/);
  assert.match(app, /Pagamento annuale unico di 47,88 € IVA inclusa/);
  assert.match(app, /4,99 €\/mese, addebitati 59,88 €/);
  assert.match(terms, /47,88 € IVA inclusa/);
  assert.match(terms, /59,88 €[^\n<]*all’anno/);
  assert.match(terms, /4,99 € al mese/);
  assert.match(terms, /rinnovo è annuale e automatico/i);
  assert.match(terms, /giorno precedente la data di rinnovo/i);
  assert.match(terms, /rimborso integrale entro 14 giorni/i);
  assert.match(terms, /La prova gratuita non si trasforma automaticamente in abbonamento/);
});

test("la nuova versione dei Termini è applicata in app, backend e database", () => {
  for (const source of [auth, backend, migration, verify, terms]) assert.match(source, new RegExp(TERMS_VERSION));
  for (const version of [PRIVACY_VERSION, CLOUD_VERSION]) {
    assert.match(auth, new RegExp(version));
    assert.match(backend, new RegExp(version));
    assert.match(migration, new RegExp(version));
  }
  assert.match(migration, /create or replace function public\.premium_has_current_acceptances/);
  assert.match(migration, /create or replace function public\.premium_accept_current_terms/);
  assert.match(migration, /create or replace function public\.premium_handle_new_user/);
  assert.match(verify, /premium_home_bill_limits_terms_v0.36.22_ok/);
});

test("versione PWA e limite delle funzioni Vercel restano coerenti", async () => {
  assert.match(app, /APP Premium v0\.36\.28/);
  assert.match(app, /Versione condizioni correnti: v0\.36\.22/);
  assert.match(sw, /offertalogica-premium-v03628/);
  assert.match(bills, /app_version: "0\.36\.28"/);
  const apiFiles = (await readdir(new URL("../api/", import.meta.url))).filter(name => name.endsWith(".js"));
  assert.equal(apiFiles.length, 12);
});
