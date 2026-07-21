import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("Step 5.1 mostra Scegli file e poi Aggiungi file", () => {
  assert.match(html, /id="pdf-select-files-button"[\s\S]*?>Scegli file<\/button>/);
  assert.match(html, /pickerButton\.innerText = total > 0 \? "Aggiungi file" : "Scegli file"/);
  assert.match(html, /Dopo il primo PDF usa <strong>Aggiungi file<\/strong>/);
});

test("Step 5.1 mantiene una coda additiva separata dall'input nativo", () => {
  assert.match(html, /let PDF_PENDING_FILES = \[\]/);
  assert.match(html, /PDF_PENDING_FILES\.push\(/);
  assert.match(html, /LEAD_STATE\.pdfDocuments = \[\.\.\.LEAD_STATE\.pdfDocuments, \.\.\.results\]/);
  assert.match(html, /event\.target\.value = ""/);
});

test("Step 5.1 permette la rimozione del singolo PDF", () => {
  assert.match(html, /window\.rimuoviFilePdf = function rimuoviFilePdf/);
  assert.match(html, /doc\.upload_id !== id/);
  assert.match(html, /class="pdf-file-remove"/);
});

test("Step 5.1 blocca conferma e fusione per documenti non omogenei", () => {
  assert.match(html, /merge_blocked: true/);
  assert.match(html, /button\.disabled = mixedDocuments \|\| mergeBlocked/);
  assert.match(html, /Nessun valore è stato scelto o unito automaticamente/);
  assert.match(html, /Nessun campo verrà autocompilato finché il conflitto non è risolto/);
});

test("Step 5.1 analizza soltanto i nuovi PDF in attesa", () => {
  assert.match(html, /const pendingEntries = \[\.\.\.PDF_PENDING_FILES\]/);
  assert.match(html, /const files = pendingEntries\.map\(\(entry\) => entry\.file\)/);
  assert.match(html, /processedIds/);
});

test("Step 5.1 non disabilita la conferma dei PDF già analizzati quando la coda è vuota", () => {
  assert.match(html, /if \(LEAD_STATE\.pdfDocuments\.length\) \{[\s\S]*?configuraConfermaPdfPronta\(LEAD_STATE\.pdfDocuments\)/);
  assert.match(html, /Nessun nuovo PDF da analizzare/);
});
