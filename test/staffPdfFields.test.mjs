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
