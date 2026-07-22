import test from "node:test";
import assert from "node:assert/strict";
import { normalizePdfOcrCandidate } from "../lib/pdfOcrText.js";
import { PDF_OCR_PIPELINE_VERSION } from "../lib/pdfOcrPolicy.js";

test("Step 7.3: omette lo spread gas OCR quando l'unita non e esplicita", () => {
  const result = normalizePdfOcrCandidate({
    commodity: "gas",
    pdr: "03081000752041",
    spread_gas_eur_smc: 3.8139622,
    warnings: ["spread_gas_unita_non_esplicita"],
  });
  assert.equal(result.spread_gas_eur_smc, null);
  assert.ok(!result.warnings.includes("spread_gas_unita_non_esplicita"));
  assert.ok(result.warnings.includes("spread_gas_ocr_unita_ambigua_omesso"));
});

test("Step 7.3: omette anche lo spread luce OCR con unita ambigua", () => {
  const result = normalizePdfOcrCandidate({
    commodity: "luce",
    pod: "IT001E51379686",
    spread_luce_eur_kwh: 7.5,
    warnings: ["spread_luce_unita_non_esplicita"],
  });
  assert.equal(result.spread_luce_eur_kwh, null);
  assert.ok(result.warnings.includes("spread_luce_ocr_unita_ambigua_omesso"));
});

test("Step 7.3: conserva gli spread con unita esplicita", () => {
  const result = normalizePdfOcrCandidate({
    commodity: "gas",
    pdr: "03081000752041",
    spread_gas_eur_smc: 0.09,
    warnings: [],
  });
  assert.equal(result.spread_gas_eur_smc, 0.09);
  assert.deepEqual(result.warnings, []);
});

test("Step 7.3: aggiorna la versione della pipeline OCR", () => {
  assert.equal(PDF_OCR_PIPELINE_VERSION, "v105.6-ocr-large-photo-scaling-1");
});
