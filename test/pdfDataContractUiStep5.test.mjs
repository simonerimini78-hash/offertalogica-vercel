import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

function loadContractUiHelpers() {
  const start = html.indexOf("function pdfContractFieldEntry");
  const end = html.indexOf("function formatPdfContractDate", start);
  assert.ok(start > 0 && end > start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}
this.helpers = { pdfSafeAutofillValue, mergePdfDataContract };`, context);
  return context.helpers;
}

test("Step 5 usa il contratto dati per l'autocompilazione", () => {
  assert.match(html, /function pdfSafeAutofillValue\(data, field\)/);
  assert.match(html, /entry\?\.autofill\?\.allowed/);
  assert.match(html, /entry\.status !== "completo"/);
  assert.match(html, /const safe = \(field\) => pdfSafeAutofillValue\(data, field\)/);
});

test("Step 5 blocca i conflitti tra più documenti", () => {
  assert.match(html, /conflitto_tra_documenti/);
  assert.match(html, /status: "da_verificare"/);
  assert.match(html, /allowed: false/);
});

test("Step 5 rende compatto il riepilogo dual", () => {
  assert.match(html, /Fornitore luce e gas:/);
  assert.match(html, /Indirizzo luce e gas:/);
  assert.match(html, /Dati comuni da integrare per l’attivazione/);
  assert.match(html, /commonExternal/);
  assert.match(html, /Nel modulo saranno inseriti soltanto i campi completi ammessi dal contratto dati/);
  assert.match(html, /Non autocompilati automaticamente/);
});

test("Step 5 non ripristina il fallback indiscriminato ai valori PDF grezzi", () => {
  const functionStart = html.indexOf("function applicaDatiPdfAlModulo(data)");
  const functionEnd = html.indexOf("assicuraSchedeOfferte();", functionStart);
  const source = html.slice(functionStart, functionEnd);
  assert.match(source, /pdfSafeAutofillValue/);
  assert.doesNotMatch(source, /setField\("in-luce-prezzo-att", data\.prezzo_luce_eur_kwh\)/);
  assert.doesNotMatch(source, /setField\("in-gas-prezzo-att", data\.prezzo_gas_eur_smc\)/);
});


test("Step 5 applica davvero il blocco runtime ai campi non completi", () => {
  const { pdfSafeAutofillValue } = loadContractUiHelpers();
  const complete = { data_contract: { fields: { prezzo_luce_eur_kwh: { status: "completo", normalized_value: 0.18, autofill: { allowed: true } } } } };
  const review = { data_contract: { fields: { prezzo_luce_eur_kwh: { status: "da_verificare", normalized_value: 0.18, autofill: { allowed: false } } } } };
  assert.equal(pdfSafeAutofillValue(complete, "prezzo_luce_eur_kwh"), 0.18);
  assert.equal(pdfSafeAutofillValue(review, "prezzo_luce_eur_kwh"), undefined);
});

test("Step 5 trasforma un conflitto tra documenti in campo da verificare", () => {
  const { mergePdfDataContract } = loadContractUiHelpers();
  const field = (value) => ({
    field: "codice_fiscale",
    normalized_value: value,
    status: "completo",
    autofill: { allowed: true, reason: "campo_completo_con_conferma_utente", targets: ["activation.codice_fiscale"], use: "activation_helper" },
  });
  const left = { fields: { codice_fiscale: field("AAAAAA00A00A000A") }, autofill_plan: {} };
  const right = { fields: { codice_fiscale: field("BBBBBB00B00B000B") }, autofill_plan: {} };
  const merged = mergePdfDataContract(left, right);
  assert.equal(merged.fields.codice_fiscale.status, "da_verificare");
  assert.equal(merged.fields.codice_fiscale.autofill.allowed, false);
  assert.equal(merged.fields.codice_fiscale.autofill.reason, "conflitto_tra_documenti");
  assert.deepEqual([...merged.fields.codice_fiscale.alternatives], ["AAAAAA00A00A000A", "BBBBBB00B00B000B"]);
});
