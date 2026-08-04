import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

test("v0.36.11 separa visivamente prova gratuita e Premium Casa", () => {
  assert.match(app, /class="premium-plan-grid"/);
  assert.match(app, /class="premium-plan-card premium-plan-trial"/);
  assert.match(app, /class="premium-plan-card premium-plan-paid"/);
  assert.match(app, /Prova gratuita/);
  assert.match(app, /Premium Casa/);
  assert.match(app, /Piano completo/);
});

test("v0.36.11 chiarisce i limiti esclusivi della prova", () => {
  assert.match(app, /Massimo 4 bollette/);
  assert.match(app, /Bollette senza il limite di 4 della prova/);
  assert.match(app, /Una verifica staff soltanto per un’anomalia rossa/);
  assert.match(app, /Richiesta di verifica staff in presenza di anomalie rosse/);
});

test("v0.36.11 mostra prezzo iniziale e rinnovo del piano pagato", () => {
  assert.match(app, /49,90 €/);
  assert.match(app, /59,88 € all’anno IVA inclusa/);
  assert.match(app, /4,99 € al mese/);
  assert.match(app, /APP Premium v0\.36\.15/);
  assert.match(sw, /offertalogica-premium-v03615/);
});

test("v0.36.11 mantiene il confronto responsive", () => {
  assert.match(app, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(app, /@media\(max-width:620px\).*?grid-template-columns:1fr/s);
});
