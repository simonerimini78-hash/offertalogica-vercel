import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const staffHtml = fs.readFileSync(new URL("../public/staff-pdf.html", import.meta.url), "utf8");

test("area staff espone i campi offerta separati per luce e gas", () => {
  for (const field of [
    "nome_offerta_luce",
    "codice_offerta_luce",
    "tipo_prezzo_luce",
    "indice_riferimento_luce",
    "spread_luce_eur_kwh",
    "nome_offerta_gas",
    "codice_offerta_gas",
    "tipo_prezzo_gas",
    "indice_riferimento_gas",
    "spread_gas_eur_smc",
  ]) {
    assert.match(staffHtml, new RegExp(`\\b${field}\\b`));
  }
});

test("area staff conserva i campi generici per i record esistenti", () => {
  for (const field of ["nome_offerta", "codice_offerta", "tipo_prezzo", "indice_riferimento"]) {
    assert.match(staffHtml, new RegExp(`\\b${field}\\b`));
  }
});

test("area staff rende revisionabili consumi e prezzi per fascia e moltiplicatori", () => {
  for (const field of [
    "consumo_luce_f1_kwh",
    "consumo_luce_f2_kwh",
    "consumo_luce_f3_kwh",
    "consumo_luce_f23_kwh",
    "prezzo_luce_f0_eur_kwh",
    "prezzo_luce_f1_eur_kwh",
    "prezzo_luce_f2_eur_kwh",
    "prezzo_luce_f3_eur_kwh",
    "prezzo_luce_f23_eur_kwh",
    "moltiplicatore_indice_luce",
    "moltiplicatore_indice_gas",
  ]) {
    assert.match(staffHtml, new RegExp(`\\b${field}\\b`), `Manca ${field}`);
  }
});
