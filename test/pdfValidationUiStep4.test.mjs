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

test("la prima lettura mostra il confronto e non anticipa i dati di attivazione", () => {
  for (const marker of [
    "Stato confronto luce",
    "Stato confronto gas",
    "Dati economici essenziali non autocompilati",
    "I dati necessari all’attivazione non sono richiesti in questa fase",
  ]) assert.ok(html.includes(marker), `manca ${marker}`);
  for (const marker of [
    "Stato dati bolletta luce",
    "Stato dati bolletta gas",
    "Stato attivazione completa luce",
    "Stato attivazione completa gas",
    "Dati bolletta mancanti luce",
    "Dati comuni da integrare per l’attivazione",
  ]) assert.ok(!html.includes(marker), `non deve comparire ${marker}`);
  assert.ok(!html.includes("sameSupplyAddress ?"));
});

test("il merge browser conserva metadati di validazione Step 4", () => {
  for (const field of ["field_status", "readiness", "dati_bolletta", "validation_notes", "validation_issues", "completeness"]) {
    assert.ok(html.includes(field), `manca ${field}`);
  }
});


test("la sintesi iniziale non espone dati personali o checklist di attivazione", () => {
  const start = html.indexOf("function renderPdfSummary");
  const end = html.indexOf("window.azzeraPdfEModulo", start);
  const summarySource = html.slice(start, end);
  for (const marker of [
    "Intestatario:",
    "Potenza impegnata luce:",
    "Potenza disponibile luce:",
    "IBAN o modalità di pagamento",
    "documento di identità",
  ]) assert.ok(!summarySource.includes(marker), `non deve comparire ${marker}`);
});


test("quote fisse negative: il modulo e il calcolo conservano crediti e sconti", () => {
  for (const marker of [
    'negativoAmmesso: true',
    'config.negativoAmmesso ? true',
    'const quotaFissaVendita = numeroSicuro(quotaFissaAnnua, 0);',
    'pdfAutofillHasValue(merged.quota_fissa_vendita_luce_eur_anno)',
    'pdfAutofillHasValue(merged.quota_fissa_vendita_gas_eur_anno)',
  ]) assert.ok(html.includes(marker), `manca ${marker}`);
  assert.ok(!html.includes('const quotaFissaVendita = Math.max(0, numeroSicuro(quotaFissaAnnua, 0));'));
});
