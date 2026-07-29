import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");

test("nuova analisi sostituisce i documenti e i dati della lettura precedente", () => {
  assert.match(html, /function resetModuloPrimaDiNuovaLetturaPdf\(\)/);
  assert.match(html, /LEAD_STATE\.pdfDocuments = \[\.\.\.results\]/);
  assert.doesNotMatch(html, /LEAD_STATE\.pdfDocuments = \[\.\.\.LEAD_STATE\.pdfDocuments, \.\.\.results\]/);
});

test("la lettura compila direttamente il modulo senza anteprima campo per campo", () => {
  assert.match(html, /applicaRisultatoPdfDirettamente\(results\)/);
  assert.match(html, /applicaDatiPdfAlModulo\(data\)/);
  assert.match(html, /renderModuloAdattivoPdf\(data\)/);
  assert.doesNotMatch(html, /id="pdf-confirm-data-button"/);
});
