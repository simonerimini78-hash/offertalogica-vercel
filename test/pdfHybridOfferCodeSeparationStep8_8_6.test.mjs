import test from "node:test";
import assert from "node:assert/strict";
import {
  PDF_HYBRID_POLICY_VERSION,
  applyCrossSourceConsensus,
  mergeAiResult,
  mergeOcrResult,
} from "../lib/pdfHybridPolicy.js";

function baseLuce(extra = {}) {
  return {
    kind: "bolletta",
    commodity: "luce",
    recognized: true,
    diagnostics: [],
    warnings: [],
    ...extra,
  };
}

function diagnostic(field, snippet) {
  return { field, source_snippet: snippet, source_match: snippet, page: 1 };
}

function ai(fields, evidence) {
  return { fields, evidence: evidence.map(([field, quote]) => ({ field, quote, page: 1, confidence: 0.98 })) };
}

test("espone la versione dello step di separazione codici", () => {
  assert.equal(PDF_HYBRID_POLICY_VERSION, "v106.8.6-offer-code-separation-1");
});

test("IA: codice prodotto letto nel campo offerta viene riclassificato", () => {
  const result = mergeAiResult(baseLuce(), ai(
    { codice_offerta_luce: "SLFLE05201016" },
    [["codice_offerta_luce", "Codice prodotto: SLFLE05201016"]],
  ));
  assert.equal(result.normalized.codice_offerta_luce ?? null, null);
  assert.equal(result.normalized.codice_prodotto_fornitore_luce, "SLFLE05201016");
  assert.ok(result.diagnostics.acceptedFields.includes("codice_prodotto_fornitore_luce"));
  assert.deepEqual(result.diagnostics.remappedFields[0], {
    from: "codice_offerta_luce",
    to: "codice_prodotto_fornitore_luce",
    value: "SLFLE05201016",
    reason: "supplier_product_code_label_reclassification",
  });
});

test("OCR: codice prodotto non può diventare codice offerta ufficiale", () => {
  const result = mergeOcrResult(baseLuce(), {
    codice_offerta_luce: "SLFLE05201016",
    diagnostics: [diagnostic("codice_offerta_luce", "Codice prodotto attivo SLFLE05201016")],
  }, { pageTexts: ["Codice prodotto attivo SLFLE05201016"] });
  assert.equal(result.normalized.codice_offerta_luce ?? null, null);
  assert.equal(result.normalized.codice_prodotto_fornitore_luce, "SLFLE05201016");
});

test("un codice offerta con etichetta ufficiale resta codice offerta", () => {
  const value = "OFFERTA_ARERA_2026_001";
  const result = mergeAiResult(baseLuce(), ai(
    { codice_offerta_luce: value },
    [["codice_offerta_luce", `Codice offerta: ${value}`]],
  ));
  assert.equal(result.normalized.codice_offerta_luce, value);
  assert.equal(result.normalized.codice_prodotto_fornitore_luce ?? null, null);
  assert.equal(result.diagnostics.remappedFields.length, 0);
});

test("un codice senza etichetta semantica viene respinto", () => {
  const result = mergeAiResult(baseLuce(), ai(
    { codice_offerta_luce: "OFFERTA_ARERA_2026_001" },
    [["codice_offerta_luce", "OFFERTA_ARERA_2026_001"]],
  ));
  assert.equal(result.normalized.codice_offerta_luce ?? null, null);
  assert.ok(result.diagnostics.rejectedFields.some((item) => item.reason === "official_offer_code_label_missing"));
});

test("un campo prodotto con etichetta codice offerta viene corretto simmetricamente", () => {
  const value = "OFFERTA_ARERA_2026_002";
  const result = mergeAiResult(baseLuce(), ai(
    { codice_prodotto_fornitore_luce: value },
    [["codice_prodotto_fornitore_luce", `Codice CTE: ${value}`]],
  ));
  assert.equal(result.normalized.codice_prodotto_fornitore_luce ?? null, null);
  assert.equal(result.normalized.codice_offerta_luce, value);
});

test("evidenza con entrambe le etichette resta in revisione", () => {
  const result = mergeAiResult(baseLuce(), ai(
    { codice_offerta_luce: "OFFERTA_ARERA_2026_003" },
    [["codice_offerta_luce", "Codice prodotto / Codice offerta: OFFERTA_ARERA_2026_003"]],
  ));
  assert.equal(result.normalized.codice_offerta_luce ?? null, null);
  assert.equal(result.normalized.codice_prodotto_fornitore_luce ?? null, null);
  assert.ok(result.diagnostics.rejectedFields.some((item) => item.reason === "ambiguous_offer_code_labels"));
});

test("un codice offerta ufficiale troppo corto non viene promosso", () => {
  const result = mergeAiResult(baseLuce(), ai(
    { codice_offerta_luce: "ABC123" },
    [["codice_offerta_luce", "Codice offerta: ABC123"]],
  ));
  assert.equal(result.normalized.codice_offerta_luce ?? null, null);
  assert.ok(result.diagnostics.rejectedFields.some((item) => item.reason === "invalid_official_offer_code"));
});

test("il prodotto non sovrascrive un codice offerta nativo già valido", () => {
  const official = "OFFERTA_ARERA_2026_NATIVE";
  const result = mergeAiResult(baseLuce({ codice_offerta_luce: official }), ai(
    { codice_offerta_luce: "SLFLE05201016" },
    [["codice_offerta_luce", "Codice prodotto: SLFLE05201016"]],
  ));
  assert.equal(result.normalized.codice_offerta_luce, official);
  assert.equal(result.normalized.codice_prodotto_fornitore_luce, "SLFLE05201016");
  assert.equal(result.diagnostics.conflicts.length, 0);
});

test("consenso OCR e IA sul codice prodotto non popola il codice offerta", () => {
  const ocr = {
    codice_offerta_luce: "SLFLE05201016",
    diagnostics: [diagnostic("codice_offerta_luce", "Codice prodotto: SLFLE05201016")],
  };
  const aiResult = ai(
    { codice_offerta_luce: "SLFLE05201016" },
    [["codice_offerta_luce", "Codice prodotto: SLFLE05201016"]],
  );
  const consensus = applyCrossSourceConsensus({
    nativeNormalized: baseLuce(),
    ocrNormalized: ocr,
    aiResult,
    normalized: baseLuce(),
  });
  assert.equal(consensus.normalized.codice_offerta_luce ?? null, null);
  assert.equal(consensus.normalized.codice_prodotto_fornitore_luce, "SLFLE05201016");
  assert.ok(consensus.diagnostics.agreements.includes("codice_prodotto_fornitore_luce"));
  assert.equal(consensus.diagnostics.corrections[0].reason, "ocr_ai_agreement_with_offer_code_reclassification");
});

test("un codice generico viene assegnato alla commodity indicata dall'evidenza", () => {
  const result = mergeAiResult({ kind: "bolletta", commodity: "dual", recognized: true, diagnostics: [] }, ai(
    { codice_offerta: "GASPROD2026" },
    [["codice_offerta", "Gas naturale PDR - Codice prodotto: GASPROD2026"]],
  ));
  assert.equal(result.normalized.codice_offerta ?? null, null);
  assert.equal(result.normalized.codice_prodotto_fornitore_gas, "GASPROD2026");
});

test("OCR e IA con etichette discordanti non ottengono consenso", () => {
  const value = "OFFERTA_ARERA_2026_004";
  const consensus = applyCrossSourceConsensus({
    nativeNormalized: baseLuce(),
    ocrNormalized: {
      codice_offerta_luce: value,
      diagnostics: [diagnostic("codice_offerta_luce", `Codice prodotto: ${value}`)],
    },
    aiResult: ai(
      { codice_offerta_luce: value },
      [["codice_offerta_luce", `Codice offerta: ${value}`]],
    ),
    normalized: baseLuce(),
  });
  assert.equal(consensus.normalized.codice_offerta_luce ?? null, null);
  assert.equal(consensus.normalized.codice_prodotto_fornitore_luce ?? null, null);
  assert.ok(consensus.diagnostics.rejected.some((item) => item.reason === "ambiguous_offer_code_labels"));
});
