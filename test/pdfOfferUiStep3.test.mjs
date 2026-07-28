import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");

test("il riepilogo PDF mostra i dati economici e conserva i dettagli tecnici fuori dalla sintesi", () => {
  for (const marker of [
    "Offerta luce:",
    "Offerta gas:",
    "Spread luce:",
    "Spread gas:",
    "formatPdfValidityLine",
    "Scadenza condizioni ${commodityLabel}",
  ]) assert.ok(html.includes(marker), `manca ${marker}`);
  const start = html.indexOf("function renderPdfSummary");
  const end = html.indexOf("window.azzeraPdfEModulo", start);
  const summary = html.slice(start, end);
  assert.ok(!summary.includes("Indirizzo luce:"));
  assert.ok(!summary.includes("Indirizzo gas:"));
  assert.ok(!summary.includes("Formula luce:"));
  assert.ok(!summary.includes("Formula gas:"));
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
