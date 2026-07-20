import test from "node:test";
import assert from "node:assert/strict";
import { mergeOcrCandidate } from "../lib/pdfOcrMerge.js";

test("Step 7: non sostituisce mai un valore deterministico già valido", () => {
  const result = mergeOcrCandidate({
    base: {
      recognized: false,
      pod: "IT001E11111111",
      diagnostics: [{ field: "pod", value: "IT001E11111111", status: "found", confidence: "high", method: "text_pattern" }],
      warnings: ["testo_pdf_assente_o_insufficiente"],
    },
    candidate: {
      recognized: true,
      kind: "bolletta",
      commodity: "luce",
      pod: "IT001E99999999",
      consumo_luce_kwh: 1234,
      prezzo_luce_eur_kwh: 0.21,
      fornitore: "Unoenergy",
      warnings: [],
    },
    pageTexts: ["testo OCR"],
    pageCount: 3,
    diagnosticsBuilder: (normalized) => [
      { field: "pod", value: normalized.pod, status: "found", confidence: "high", method: "text_pattern" },
    ],
    ocrMeta: { attempted: true },
  });

  assert.equal(result.pod, "IT001E11111111");
  assert.equal(result.consumo_luce_kwh, 1234);
  assert.equal(result.ocr.applied, true);
  assert.equal(result.needsReview, true);
  assert.equal(result.confidence, "medium");
  assert.ok(result.warnings.includes("ocr_fallback_utilizzato"));
  assert.ok(result.warnings.includes("ocr_verifica_utente_richiesta"));
  assert.equal(result.diagnostics[0].status, "found");
  assert.equal(result.diagnostics[0].method, "text_pattern");
  assert.ok(result.ocr.filled_fields.includes("consumo_luce_kwh"));
  assert.equal(result.ocr.filled_fields.includes("pod"), false);
});

test("Step 7: scarta un OCR che non migliora materialmente il risultato", () => {
  const base = {
    recognized: true,
    commodity: "gas",
    pdr: "03081000000000",
    consumo_gas_smc: 900,
    prezzo_gas_eur_smc: 0.5,
  };
  const result = mergeOcrCandidate({
    base,
    candidate: { recognized: false, fornitore: "Unoenergy" },
    ocrMeta: { attempted: true },
  });
  assert.equal(result.pdr, base.pdr);
  assert.equal(result.ocr.applied, false);
  assert.equal(result.ocr.reason, "no_material_improvement");
});
