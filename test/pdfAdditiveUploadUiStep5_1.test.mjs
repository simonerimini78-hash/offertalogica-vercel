import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");

function loadCurrentSlotHelpers() {
  const slotStart = html.indexOf("function pdfDocumentCommodities");
  const slotEnd = html.indexOf("function pdfFileFingerprint", slotStart);
  const isolationStart = html.indexOf("function normalizePdfTaxId");
  const isolationEnd = html.indexOf("function pdfIsolationReasonLabel", isolationStart);
  assert.ok(slotStart > 0 && slotEnd > slotStart, "helper slot bollette non trovato");
  assert.ok(isolationStart > 0 && isolationEnd > isolationStart, "helper isolamento non trovato");
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${html.slice(isolationStart, isolationEnd)}\n${html.slice(slotStart, slotEnd)}\nthis.updateCurrentBills = aggiornaSlotBollettaCorrente;`, context);
  return context.updateCurrentBills;
}

const luce = (overrides = {}) => ({ kind: "bolletta", commodity: "luce", recognized: true, codice_fiscale: "RSSMRA80A01H501U", intestatario: "MARIO ROSSI", pod: "IT001E12345678", ...overrides });
const gas = (overrides = {}) => ({ kind: "bolletta", commodity: "gas", recognized: true, codice_fiscale: "RSSMRA80A01H501U", intestatario: "ROSSI MARIO", pdr: "01234567890123", ...overrides });

test("caricamento sequenziale luce poi gas conserva entrambe le bollette dello stesso cliente", () => {
  const updateCurrentBills = loadCurrentSlotHelpers();
  const result = updateCurrentBills([luce()], [gas()]);
  assert.equal(result.length, 2);
  assert.equal(Array.from(result, (doc) => doc.commodity).sort().join(","), "gas,luce");
});

test("caricamento sequenziale gas poi luce conserva entrambe le bollette dello stesso cliente", () => {
  const updateCurrentBills = loadCurrentSlotHelpers();
  const result = updateCurrentBills([gas()], [luce()]);
  assert.equal(result.length, 2);
  assert.equal(Array.from(result, (doc) => doc.commodity).sort().join(","), "gas,luce");
});

test("una nuova bolletta della stessa commodity sostituisce solo quella commodity", () => {
  const updateCurrentBills = loadCurrentSlotHelpers();
  const oldLight = luce({ filename: "luce-vecchia.pdf" });
  const newLight = luce({ filename: "luce-nuova.pdf" });
  const currentGas = gas({ filename: "gas.pdf" });
  const result = updateCurrentBills([oldLight, currentGas], [newLight]);
  assert.equal(result.length, 2);
  assert.equal(result.find((doc) => doc.commodity === "luce")?.filename, "luce-nuova.pdf");
  assert.equal(result.find((doc) => doc.commodity === "gas")?.filename, "gas.pdf");
});

test("documenti incompatibili non vengono mai fusi: il nuovo lotto resta isolato", () => {
  const updateCurrentBills = loadCurrentSlotHelpers();
  const otherGas = gas({ codice_fiscale: "BNCLGU82B03E625Q", intestatario: "LUIGI BIANCHI", pdr: "99999999999999" });
  const result = updateCurrentBills([luce()], [otherGas]);
  assert.equal(result.length, 1);
  assert.equal(result[0].codice_fiscale, "BNCLGU82B03E625Q");
});

test("il flusso di analisi usa l'aggiornamento sicuro dello slot current", () => {
  assert.match(html, /PDF_DOCUMENT_SLOTS\.current = aggiornaSlotBollettaCorrente\(PDF_DOCUMENT_SLOTS\.current, validCurrent\)/);
  assert.doesNotMatch(html, /PDF_DOCUMENT_SLOTS\.current = \[\.\.\.validCurrent\]/);
});

test("la lettura compila direttamente il modulo senza anteprima campo per campo", () => {
  assert.match(html, /applicaRisultatoPdfDirettamente\(results\)/);
  assert.match(html, /applicaDatiPdfAlModulo\(data\)/);
  assert.match(html, /renderModuloAdattivoPdf\(data\)/);
  assert.doesNotMatch(html, /id="pdf-confirm-data-button"/);
});
