import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("Step 6 presenta valore corrente e valore PDF affiancati", () => {
  assert.match(html, /<small>Nel modulo<\/small>/);
  assert.match(html, /<small>Dal PDF<\/small>/);
  assert.match(html, /current_display/);
  assert.match(html, /incoming_display/);
});

test("Step 6 espone azioni sicure di selezione", () => {
  assert.match(html, /id="pdf-autofill-select-empty"/);
  assert.match(html, /id="pdf-autofill-clear-selection"/);
  assert.match(html, /id="pdf-autofill-cancel"/);
  assert.match(html, /id="pdf-autofill-apply"/);
  assert.doesNotMatch(html, />Seleziona tutti e sovrascrivi</);
});

test("Step 6 permette la chiusura senza modificare il modulo", () => {
  assert.match(html, /Annulla, non modificare il modulo/);
  assert.match(html, /chiudiAnteprimaAutocompilazionePdf\(null\)/);
  assert.match(html, /Anteprima chiusa: il modulo non è stato modificato/);
});

test("Step 6 chiude l'anteprima con Escape e clic sullo sfondo", () => {
  assert.match(html, /event\.target\?\.id === "pdf-autofill-preview-backdrop"/);
  assert.match(html, /pdf-autofill-preview-backdrop"\)\?\.style\.display === "flex"/);
});

test("Step 6 conserva la sicurezza dello Step 5", () => {
  assert.match(html, /entry\?\.autofill\?\.allowed/);
  assert.match(html, /entry\.status !== "completo"/);
  assert.match(html, /!data\.merge_blocked && !data\.mixed_documents/);
});

test("Step 6 mappa nel modulo anche i fornitori presenti nel corpus PDF", () => {
  for (const [key, label] of [
    ["estra", "Estra Energie"],
    ["free", "Free Luce&amp;Gas"],
    ["butangas", "ButanGas"],
    ["unoenergy", "Unoenergy"],
  ]) {
    assert.match(html, new RegExp(`<option value="${key}">${label}<\\/option>`));
  }
  assert.match(html, /\["estra", \["estra", "estra energie"\]\]/);
  assert.match(html, /\["butangas", \["butangas", "butan gas"\]\]/);
});
