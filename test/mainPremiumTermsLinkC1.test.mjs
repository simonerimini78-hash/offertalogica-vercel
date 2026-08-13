import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/termini-condizioni.html", import.meta.url), "utf8");

test("C1: il sito distingue i Termini Premium", () => {
  const matches = html.match(/https:\/\/premium\.offertalogica\.it\/termini-condizioni\.html/g) || [];
  assert.equal(matches.length, 1);
  assert.match(html, />Termini OffertaLogica Premium<\/a>/);
});

test("C1: restano invariati i Termini generali del sito", () => {
  assert.match(html, /href="\/termini-condizioni\.html">Termini e condizioni<\/a>/);
  assert.match(html, /<h1>Termini e condizioni di OffertaLogica\.<\/h1>/);
});

test("C1: restano gli accessi esistenti alle due app", () => {
  assert.match(html, /https:\/\/app\.offertalogica\.it\/app\.html/);
  assert.match(html, /https:\/\/premium\.offertalogica\.it\/app\.html/);
  assert.match(html, /ol-app-access-footer/);
});

test("C1: nessun codice del calcolatore viene introdotto nella pagina termini", () => {
  assert.doesNotMatch(html, /analyze-pdf|premium-billing|stripe/i);
});
