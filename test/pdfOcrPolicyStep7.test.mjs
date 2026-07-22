import test from "node:test";
import assert from "node:assert/strict";
import {
  isMaterialOcrImprovement,
  ocrMaxPages,
  ocrMaxRenderPixels,
  ocrRenderScale,
  ocrScale,
  scorePdfResult,
  selectOcrPageIndexes,
  shouldAttemptControlledOcr,
  usefulPdfFieldCount,
} from "../lib/pdfOcrPolicy.js";

test("Step 7: non avvia OCR quando il parser deterministico ha già un risultato valido", () => {
  const decision = shouldAttemptControlledOcr({
    normalized: {
      recognized: true,
      textExtracted: 1200,
      commodity: "luce",
      pod: "IT001E12345678",
      consumo_luce_kwh: 1400,
      warnings: [],
    },
    pageTexts: ["testo nativo leggibile"],
    env: {},
  });
  assert.equal(decision.attempt, false);
  assert.equal(decision.reason, "deterministic_result_available");
});

test("Step 7: avvia OCR soltanto in assenza di testo e dati utili", () => {
  const decision = shouldAttemptControlledOcr({
    normalized: {
      recognized: false,
      textExtracted: 0,
      warnings: ["testo_pdf_assente_o_insufficiente", "nessun_dato_utile_rilevato"],
    },
    pageTexts: [""],
    filename: "Bolletta-Unoenergy-gas.pdf",
    env: {},
  });
  assert.equal(decision.attempt, true);
  assert.equal(decision.reason, "missing_text_layer");
});

test("Step 7: usa OCR per completare un risultato parziale senza sovrascriverlo", () => {
  const decision = shouldAttemptControlledOcr({
    normalized: {
      recognized: false,
      textExtracted: 20,
      pod: "IT001E12345678",
      warnings: ["testo_pdf_assente_o_insufficiente"],
    },
    pageTexts: ["testo breve"],
    env: {},
  });
  assert.equal(decision.attempt, true);
  assert.equal(decision.reason, "insufficient_text_layer");
});

test("Step 7: OCR disattivabile e limitabile per nome file", () => {
  const base = {
    normalized: { recognized: false, textExtracted: 0, warnings: [] },
    pageTexts: [],
    filename: "altro.pdf",
  };
  assert.equal(shouldAttemptControlledOcr({ ...base, env: { PDF_OCR_ENABLED: "0" } }).reason, "disabled");
  assert.equal(shouldAttemptControlledOcr({ ...base, env: { PDF_OCR_FILENAME_PATTERN: "unoenergy" } }).reason, "filename_not_allowed");
});

test("Step 7: seleziona al massimo le prime tre pagine", () => {
  assert.deepEqual(selectOcrPageIndexes(8, 2), [0, 1]);
  assert.deepEqual(selectOcrPageIndexes(2, 3), [0, 1]);
  assert.deepEqual(selectOcrPageIndexes(0, 2), []);
  assert.equal(ocrMaxPages({ PDF_OCR_MAX_PAGES: "99" }), 3);
});

test("Step 7: scala OCR sempre entro il perimetro controllato", () => {
  assert.equal(ocrScale({ PDF_OCR_SCALE: "0.5" }), 1.5);
  assert.equal(ocrScale({ PDF_OCR_SCALE: "9" }), 3);
  assert.equal(ocrScale({}), 2.2);
});

test("Step 8.4.4: limita le fotografie giganti prima di creare il BMP Tesseract", () => {
  const pageSize = { width: 3096, height: 4128 };
  const scale = ocrRenderScale(pageSize, {});
  assert.ok(scale < 1, `scala attesa sotto 1, ricevuta ${scale}`);
  assert.ok(pageSize.width * pageSize.height * scale * scale <= ocrMaxRenderPixels({}) + 1);
});

test("Step 8.4.4: non riduce i normali PDF A4", () => {
  assert.equal(ocrRenderScale({ width: 595, height: 842 }, {}), 2.2);
  assert.equal(ocrRenderScale({}, {}), 2.2);
  assert.equal(ocrMaxRenderPixels({ PDF_OCR_MAX_RENDER_PIXELS: "99999999" }), 16_000_000);
});

test("Step 7: punteggio premia identificativi e dati economici", () => {
  const minimal = { recognized: true, commodity: "gas", fornitore: "Unoenergy" };
  const rich = { ...minimal, pdr: "03081000000000", consumo_gas_smc: 900, prezzo_gas_eur_smc: 0.55 };
  assert.ok(scorePdfResult(rich) > scorePdfResult(minimal));
  assert.equal(usefulPdfFieldCount(rich), 4);
  assert.equal(isMaterialOcrImprovement({}, rich), true);
});
