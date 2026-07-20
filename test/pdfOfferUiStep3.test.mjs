import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");

test("il riepilogo PDF mostra offerte, spread, validità e indirizzi per commodity", () => {
  for (const marker of [
    "Offerta luce:",
    "Offerta gas:",
    "Spread luce:",
    "Spread gas:",
    "Validità luce:",
    "Validità gas:",
    "Indirizzo luce:",
    "Indirizzo gas:",
  ]) assert.ok(html.includes(marker), `manca ${marker}`);
});

test("il merge del browser conserva i dettagli luce e gas", () => {
  for (const field of [
    "nome_offerta_luce",
    "nome_offerta_gas",
    "decorrenza_condizioni_economiche_luce",
    "decorrenza_condizioni_economiche_gas",
    "formula_prezzo_luce",
    "formula_prezzo_gas",
    "sconti_offerta_luce",
    "sconti_offerta_gas",
  ]) assert.ok(html.includes(field), `manca ${field}`);
});
