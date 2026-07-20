import test from "node:test";
import assert from "node:assert/strict";
import { extractPdfDataFromText } from "../lib/pdfExtract.js";
import { normalizePdfOcrCandidate, normalizePdfOcrText } from "../lib/pdfOcrText.js";
import { PDF_OCR_PIPELINE_VERSION } from "../lib/pdfOcrPolicy.js";

function parsedCandidate(raw) {
  const text = normalizePdfOcrText(raw);
  return normalizePdfOcrCandidate(extractPdfDataFromText(text), { text });
}

test("Step 7.5 completa il codice cliente troncato usando l'intestazione della fornitura", () => {
  const result = parsedCandidate(`
@ unoenergy
Gas Naturale - Servizio Mercato Libero
Codice Cliente
1009584
PDR 03081000752041
CONSUMO ANNUO: Da 28/02/2025 a 28/02/2026: 120 Smc
Di cui spesa per la vendita di gas naturale 0,6311892 €/Smc

10095846
Ae uN ASI se
INDIRIZZO DI FORNITURA: VIA DECIO. RAGGI 195 + 47121 FORLI FC
POD/PDR: 03081000752041
NOME OFFERTA: RISERVATO AGILE
`);

  assert.equal(result.codice_cliente, "10095846");
  assert.equal(result.indirizzo_fornitura_gas, "VIA DECIO RAGGI 195 - 47121 FORLI FC");
  assert.ok(result.warnings.includes("codice_cliente_ocr_completato_da_intestazione_fornitura"));
});

test("Step 7.5 non sostituisce un codice cliente discordante", () => {
  const result = parsedCandidate(`
unoenergy Gas Naturale
Codice Cliente 12345678
PDR 03081000752041
87654321
INDIRIZZO DI FORNITURA: VIA DECIO RAGGI 195 - 47121 FORLI FC
CONSUMO ANNUO: Da 28/02/2025 a 28/02/2026: 120 Smc
`);

  assert.equal(result.codice_cliente, "12345678");
  assert.ok(!result.warnings.includes("codice_cliente_ocr_completato_da_intestazione_fornitura"));
});

test("Step 7.5 conserva le abbreviazioni brevi negli indirizzi", () => {
  const result = parsedCandidate(`
unoenergy Gas Naturale
Codice Cliente 10095846 PDR 03081000752041
INDIRIZZO DI FORNITURA: VIA S. MARIA 10 - 47121 FORLI FC
CONSUMO ANNUO: Da 28/02/2025 a 28/02/2026: 120 Smc
`);
  assert.equal(result.indirizzo_fornitura_gas, "VIA S. MARIA 10 - 47121 FORLI FC");
});

test("Step 7.5 espone la nuova versione della pipeline", () => {
  assert.equal(PDF_OCR_PIPELINE_VERSION, "v105.5-ocr-customer-code-reconciliation-1");
});
