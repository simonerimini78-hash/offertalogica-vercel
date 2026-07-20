import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

function loadIsolationHelpers() {
  const start = html.indexOf("function normalizePdfTaxId");
  const end = html.indexOf("function mergePdfDocuments", start);
  assert.ok(start > 0 && end > start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}\nthis.helpers = { normalizePdfHolder, analyzePdfDocumentIsolation, pdfIsolationReasonLabel };`, context);
  return context.helpers;
}

test("Step 5.1 consente luce e gas dello stesso cliente", () => {
  const { analyzePdfDocumentIsolation } = loadIsolationHelpers();
  const result = analyzePdfDocumentIsolation([
    { codice_fiscale: "RSSMRA80A01H501U", intestatario: "MARIO ROSSI", pod: "IT001E12345678" },
    { codice_fiscale: "RSSMRA80A01H501U", intestatario: "ROSSI MARIO", pdr: "01234567890123" },
  ]);
  assert.equal(result.blocked, false);
  assert.deepEqual([...result.reasons], []);
});

test("Step 5.1 blocca documenti con codici fiscali differenti", () => {
  const { analyzePdfDocumentIsolation } = loadIsolationHelpers();
  const result = analyzePdfDocumentIsolation([
    { codice_fiscale: "RSSMRA80A01H501U", intestatario: "MARIO ROSSI", pdr: "01234567890123" },
    { codice_fiscale: "BNCLGU82B03E625Q", intestatario: "LUIGI BIANCHI", pod: "IT001E87654321" },
  ]);
  assert.equal(result.blocked, true);
  assert.ok(result.reasons.includes("clienti_diversi_codice_fiscale"));
});

test("Step 5.1 usa l'intestatario quando il codice fiscale manca", () => {
  const { analyzePdfDocumentIsolation } = loadIsolationHelpers();
  const result = analyzePdfDocumentIsolation([
    { intestatario: "MARIO ROSSI", pod: "IT001E12345678" },
    { intestatario: "LUIGI BIANCHI", pdr: "01234567890123" },
  ]);
  assert.equal(result.blocked, true);
  assert.ok(result.reasons.includes("clienti_diversi_intestatario"));
});

test("Step 5.1 normalizza l'ordine del nome dell'intestatario", () => {
  const { normalizePdfHolder } = loadIsolationHelpers();
  assert.equal(normalizePdfHolder("Filippo Pagliai"), normalizePdfHolder("PAGLIAI FILIPPO"));
});

test("Step 5.1 blocca due forniture gas diverse dello stesso cliente", () => {
  const { analyzePdfDocumentIsolation } = loadIsolationHelpers();
  const result = analyzePdfDocumentIsolation([
    { codice_fiscale: "RSSMRA80A01H501U", intestatario: "MARIO ROSSI", pdr: "01234567890123" },
    { codice_fiscale: "RSSMRA80A01H501U", intestatario: "ROSSI MARIO", pdr: "99999999999999" },
  ]);
  assert.equal(result.blocked, true);
  assert.ok(result.reasons.includes("punti_gas_diversi"));
});

test("Step 5.1 non costruisce un riepilogo fuso quando i clienti sono diversi", () => {
  const start = html.indexOf("function normalizePdfTaxId");
  const end = html.indexOf("function renderPdfSummary", start);
  assert.ok(start > 0 && end > start);
  const context = { risultatoPdfUtilizzabile: () => true };
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}\nthis.mergePdfDocuments = mergePdfDocuments;`, context);
  const merged = context.mergePdfDocuments([
    {
      kind: "bolletta", commodity: "gas", recognized: true,
      codice_fiscale: "DLLLCU82B03E625Q", intestatario: "LUCA DELLA CROCE",
      pdr: "03081000466501", fornitore: "Edison Energia", indice_riferimento_gas: "PSV",
    },
    {
      kind: "bolletta", commodity: "dual", recognized: true,
      codice_fiscale: "PMBMNC62H60D704P", intestatario: "MONICA PAMBIANCO",
      pod: "IT001E51205808", pdr: "10400000417522", fornitore: "Eni Plenitude",
      nome_offerta_gas: "Fixa Time Gas Base", tipo_prezzo_gas: "fisso",
    },
  ]);
  assert.equal(merged.merge_blocked, true);
  assert.equal(merged.commodity, "unknown");
  assert.equal(merged.fornitore, undefined);
  assert.equal(merged.indice_riferimento_gas, undefined);
  assert.equal(merged.nome_offerta_gas, undefined);
});
