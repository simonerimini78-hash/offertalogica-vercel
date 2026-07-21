import assert from "node:assert/strict";
import test from "node:test";

import {
  explicitVisualIdentifierThreshold,
  isValidItalianFiscalCode,
  isValidItalianTaxId,
  recoverItalianFiscalCode,
  recoverItalianTaxIdCandidate,
} from "../lib/pdfAiVisualRecovery.js";

const VALID_CF = "RSSRNI80A01H501T";
const OCR_NOISY_CF = "RSSRN0180A01H501T";

test("valida codice fiscale e partita IVA senza accettare lunghezze errate", () => {
  assert.equal(isValidItalianFiscalCode(VALID_CF), true);
  assert.equal(isValidItalianTaxId("12345678901"), false);
  assert.equal(isValidItalianTaxId(OCR_NOISY_CF), false);
});

test("recupera un codice fiscale solo con correzione OCR univoca e intestatario coerente", () => {
  assert.equal(recoverItalianFiscalCode(OCR_NOISY_CF, "IRINA ROSSI"), VALID_CF);
  assert.equal(recoverItalianFiscalCode(OCR_NOISY_CF, "CLIENTE DIVERSO"), null);
});

test("il candidato recuperato resta IA da confermare esplicitamente", () => {
  const recovered = recoverItalianTaxIdCandidate({
    holder: "IRINA ROSSI",
    candidate: {
      field: "codice_fiscale",
      value_text: OCR_NOISY_CF,
      normalized_value: OCR_NOISY_CF,
      label: "Codice fiscale",
      evidence: `Codice fiscale: ${OCR_NOISY_CF}`,
      page: 2,
      confidence: 95,
      commodity: "dual",
      source_version: "test-model",
    },
  });
  assert.equal(recovered.value, VALID_CF);
  assert.equal(recovered.confidence, 93);
  assert.equal(recovered.method, "controlled_italian_tax_id_ocr_recovery");
  assert.ok(recovered.warnings.includes("requires_explicit_user_confirmation"));
});

test("abbassa la soglia solo per PDR e POD formalmente validi con etichetta esplicita", () => {
  assert.equal(explicitVisualIdentifierThreshold({
    field: "pdr",
    normalized_value: "03081001496205",
    label: "Punto di riconsegna (PDR)",
    evidence: "PDR: 03081001496205",
  }), 88);
  assert.equal(explicitVisualIdentifierThreshold({
    field: "pod",
    normalized_value: "IT001E44733440",
    label: "Punto di prelievo (POD)",
    evidence: "POD: IT001E44733440",
  }), 88);
  assert.equal(explicitVisualIdentifierThreshold({
    field: "pod",
    normalized_value: "IT001E473440",
    label: "POD",
    evidence: "POD: IT001E473440",
  }), null);
  assert.equal(explicitVisualIdentifierThreshold({
    field: "pdr",
    normalized_value: "03081001496205",
    label: "Numero pratica",
    evidence: "03081001496205",
  }), null);
});
