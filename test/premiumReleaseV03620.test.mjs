import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PREMIUM_FIRST_YEAR_AMOUNT_CENTS, PREMIUM_RENEWAL_AMOUNT_CENTS } from "../supabase/functions/_shared/premium-billing-core.mjs";

const read = name => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("formula commerciale corrente: 3,99 al mese il primo anno e 4,99 dal secondo", async () => {
  const [app, auth, terms, migration, edge] = await Promise.all([
    read("public/app.html"), read("public/app-auth.js"), read("public/termini-condizioni.html"),
    read("supabase/premium-home-bill-limits-terms-v0.36.22.sql"), read("supabase/functions/premium-billing/index.ts"),
  ]);
  assert.equal(PREMIUM_FIRST_YEAR_AMOUNT_CENTS, 4788);
  assert.equal(PREMIUM_RENEWAL_AMOUNT_CENTS, 5988);
  assert.equal(PREMIUM_RENEWAL_AMOUNT_CENTS - PREMIUM_FIRST_YEAR_AMOUNT_CENTS, 1200);
  for (const source of [app, auth, terms]) {
    assert.match(source, /3,99 €/);
    assert.match(source, /47,88 €/);
    assert.match(source, /4,99 €/);
    assert.match(source, /59,88 €/);
    assert.doesNotMatch(source, /4,16 €/);
    assert.doesNotMatch(source, /49,90 €/);
  }
  for (const source of [auth, terms, migration, edge]) assert.match(source, /premium-terms-v0\.36\.22-2026-08-06/);
});

test("Liquid Glass argento v0.36.26 è visibile e mantiene logo, layout e palette OffertaLogica", async () => {
  const app = await read("public/app.html");
  assert.match(app, /v0\.36\.26 — fondo argento/);
  assert.match(app, /linear-gradient\(155deg,#eef2f0 0%,#d1d8d5 50%,#f3f5f4 100%\)/);
  assert.match(app, /backdrop-filter:blur\(32px\) saturate\(142%\)/);
  assert.match(app, /logo-offertalogica-header\.png/);
  assert.match(app, /--green:#18a84b/);
  assert.match(app, /--green-dark:#087f3a/);
  for (const id of ["view-home", "view-bill", "view-offers", "view-profile", "premiumProfileSummary", "premiumSubscriptionPanel"]) {
    assert.match(app, new RegExp(`id="${id}"`));
  }
  assert.match(app, /grid-template-columns:repeat\(4,1fr\)/);
});

test("la release v0.36.26 resta entro 12 funzioni Vercel", async () => {
  const apiFiles = (await readdir(new URL("../api/", import.meta.url))).filter(name => name.endsWith(".js"));
  assert.equal(apiFiles.length, 12);
});
