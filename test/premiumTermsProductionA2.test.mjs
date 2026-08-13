import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const terms = await readFile(new URL("../public/termini-condizioni.html", import.meta.url), "utf8");

test("A2 rimuove i residui commerciali pre-lancio dai Termini Premium", () => {
  assert.match(terms, /<h3>Prova gratuita<\/h3>/);
  assert.doesNotMatch(terms, /Prova gratuita beta/i);
  assert.doesNotMatch(terms, /prova beta/i);
  assert.doesNotMatch(terms, /Quando la vendita sarà attivata/i);
  assert.doesNotMatch(terms, /quando il pagamento sarà attivo/i);
  assert.match(terms, /L’acquisto dell’abbonamento richiede una conferma separata/);
});

test("A2 preserva prezzi, rinnovo, trial, retention e recesso già approvati", () => {
  for (const expected of [
    "30 giorni",
    "massimo di quattro bollette complessive",
    "90 giorni successivi",
    "fino a 60 bollette per ogni periodo annuale",
    "massimo di 30 bollette per ciascuna abitazione",
    "3,99 € al mese",
    "47,88 € IVA inclusa",
    "59,88 € IVA inclusa all’anno",
    "4,99 € al mese",
    "Il rinnovo è annuale e automatico",
    "rimborso integrale entro 14 giorni",
    "premium-terms-v0.36.22-2026-08-06",
  ]) assert.match(terms, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
