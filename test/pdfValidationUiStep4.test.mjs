import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");

test("Step 4 presenta date complete e parziali senza punti interrogativi", () => {
  assert.ok(html.includes("function formatPdfValidityLine"));
  assert.ok(html.includes("Scadenza condizioni ${commodityLabel}: ${to}"));
  assert.ok(html.includes("Decorrenza condizioni ${commodityLabel}: ${from}"));
  assert.ok(!html.includes('formatPdfContractDate(merged.decorrenza_condizioni_economiche_gas) || "?"'));
  assert.ok(!html.includes('formatPdfContractDate(merged.decorrenza_condizioni_economiche_luce) || "?"'));
});

test("Step 4 mostra sempre gli indirizzi per commodity e gli stati di readiness", () => {
  for (const marker of [
    "Indirizzo luce:",
    "Indirizzo gas:",
    "Stato confronto luce",
    "Stato confronto gas",
    "Stato attivazione luce",
    "Stato attivazione gas",
  ]) assert.ok(html.includes(marker), `manca ${marker}`);
  assert.ok(!html.includes("sameSupplyAddress ?"));
});

test("il merge browser conserva metadati di validazione Step 4", () => {
  for (const field of ["field_status", "readiness", "validation_notes", "validation_issues", "completeness"]) {
    assert.ok(html.includes(field), `manca ${field}`);
  }
});
