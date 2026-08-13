import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/app.html", import.meta.url), "utf8");
const sw = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

test("gratuita: non propone più la prova Premium di 30 giorni", () => {
  assert.doesNotMatch(html, /PROVA PREMIUM GRATIS 30 GIORNI/i);
  assert.doesNotMatch(html, /premium-trial-link/);
  assert.doesNotMatch(html, /premium\.offertalogica\.it\/app\.html#profile/);
});

test("gratuita: mantiene solo CTA ATTIVA PREMIUM verso upgrade commerciale", () => {
  const target = 'href="https://premium.offertalogica.it/app.html?upgrade=1#profile">ATTIVA PREMIUM</a>';
  assert.equal(html.split(target).length - 1, 2);
});

test("gratuita: prezzi commerciali restano invariati", () => {
  assert.equal(html.split("47,88 €").length - 1 >= 2, true);
  assert.equal(html.split("59,88 €/anno").length - 1 >= 2, true);
});

test("gratuita: cache PWA aggiornata per distribuire la correzione", () => {
  assert.match(sw, /offertalogica-app-v29-install-simple-badge-fix-paid-upgrade-only/);
  assert.match(sw, /"\/app\.html"/);
});
