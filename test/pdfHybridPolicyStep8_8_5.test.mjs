import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_EXTRACTABLE_FIELDS,
  PDF_HYBRID_POLICY_VERSION,
  applyCrossSourceConsensus,
  buildPdfQualityReport,
  mergeAiResult,
  mergeOcrResult,
  quarantineUnsafeRequiredValues,
  synchronizeCommodityFields,
} from "../lib/pdfHybridPolicy.js";

function baseGas() {
  return {
    kind: "bolletta",
    commodity: "gas",
    recognized: true,
    diagnostics: [],
    warnings: [],
  };
}

test("espone il contratto completo necessario al coordinatore ibrido", () => {
  assert.equal(PDF_HYBRID_POLICY_VERSION, "v106.8.6-offer-code-separation-1");
  for (const field of ["consumo_gas_smc", "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno", "pdr", "codice_fiscale"]) {
    assert.ok(AI_EXTRACTABLE_FIELDS.includes(field), field);
  }
});

test("il report qualità richiede i campi gas ancora irrisolti", () => {
  const report = buildPdfQualityReport({ ...baseGas(), fornitore: "Unoenergy" });
  for (const field of ["consumo_gas_smc", "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno", "pdr", "intestatario", "codice_fiscale", "codice_cliente", "indirizzo_fornitura"]) {
    assert.ok(report.missingFields.includes(field), field);
  }
  assert.equal(report.shouldUseAi, true);
});

test("il POD e il PDR riallineano la commodity senza cancellare dati", () => {
  assert.equal(synchronizeCommodityFields({ pod: "IT001E53942290" }).commodity, "luce");
  assert.equal(synchronizeCommodityFields({ pdr: "03081000752041" }).commodity, "gas");
  assert.equal(synchronizeCommodityFields({ pod: "IT001E53942290", pdr: "03081000752041" }).commodity, "dual");
});

test("due codici cliente OCR differenti restano fuori dall'autofill", () => {
  const merged = mergeOcrResult(baseGas(), {
    codice_cliente: "0308100752041",
    diagnostics: [{ field: "codice_cliente", value: "0308100752041", source_snippet: "Codice Cliente 0308100752041" }],
  }, {
    combinedText: "Codice Cliente 0308100752041\nCodice Cliente 10095846",
    pageTexts: ["Codice Cliente 0308100752041\nCodice Cliente 10095846"],
  });
  assert.equal(merged.normalized.codice_cliente ?? null, null);
  assert.ok(merged.diagnostics.rejectedFields.some((item) => item.field === "codice_cliente" && item.reason === "ambiguous_ocr_candidates"));
});

test("un nome offerta che è una frase di bolletta viene respinto", () => {
  const merged = mergeOcrResult(baseGas(), {
    nome_offerta: "Le bollette precedenti risultano regolarmente pagate.",
    diagnostics: [{ field: "nome_offerta", value: "Le bollette precedenti risultano regolarmente pagate." }],
  });
  assert.equal(merged.normalized.nome_offerta ?? null, null);
  assert.ok(merged.diagnostics.rejectedFields.some((item) => item.reason === "invalid_offer_name_semantics"));
});

test("consumo del periodo e costo medio IA non diventano dati contrattuali", () => {
  const merged = mergeAiResult(baseGas(), {
    fields: { consumo_gas_smc: 53.46, prezzo_gas_eur_smc: 0.63 },
    evidence: [
      { field: "consumo_gas_smc", page: 1, quote: "Consumo fatturato 53,46 Smc", confidence: 0.99 },
      { field: "prezzo_gas_eur_smc", page: 1, quote: "Costo medio unitario 0,63 EUR/Smc", confidence: 0.99 },
    ],
  });
  assert.equal(merged.normalized.consumo_gas_smc ?? null, null);
  assert.equal(merged.normalized.prezzo_gas_eur_smc ?? null, null);
  assert.ok(merged.diagnostics.rejectedFields.some((item) => item.reason === "billing_period_not_annual_consumption"));
  assert.ok(merged.diagnostics.rejectedFields.some((item) => item.reason === "average_unit_cost_not_contract_price"));
});

test("il consenso OCR e IA rende utilizzabili i tre dati gas di calcolo", () => {
  const ocr = {
    ...baseGas(),
    consumo_gas_smc: 120,
    prezzo_gas_eur_smc: 0.631892,
    quota_fissa_vendita_gas_eur_anno: 67.32,
    diagnostics: [
      { field: "consumo_gas_smc", source_snippet: "Consumo annuo dal 28/02/2025 al 28/02/2026 120 Smc" },
      { field: "prezzo_gas_eur_smc", source_snippet: "spesa per la vendita di gas naturale 0,631892 €/Smc" },
      { field: "quota_fissa_vendita_gas_eur_anno", source_snippet: "spesa per la vendita di gas naturale 5,610000 €/mese" },
    ],
  };
  const ai = {
    fields: {
      consumo_gas_smc: 120,
      prezzo_gas_eur_smc: 0.631892,
      quota_fissa_vendita_gas_eur_anno: 67.32,
    },
    evidence: [
      { field: "consumo_gas_smc", quote: "Consumo annuo dal 28/02/2025 al 28/02/2026 120 Smc", confidence: 0.98 },
      { field: "prezzo_gas_eur_smc", quote: "spesa per la vendita di gas naturale 0,631892 €/Smc", confidence: 0.98 },
      { field: "quota_fissa_vendita_gas_eur_anno", quote: "spesa per la vendita di gas naturale 5,610000 €/mese", confidence: 0.98 },
    ],
  };
  const ocrMerged = mergeOcrResult(baseGas(), ocr, { combinedText: ocr.diagnostics.map((item) => item.source_snippet).join("\n") });
  const aiMerged = mergeAiResult(ocrMerged.normalized, ai);
  const consensus = applyCrossSourceConsensus({
    nativeNormalized: baseGas(),
    ocrNormalized: ocr,
    aiResult: ai,
    normalized: aiMerged.normalized,
    sourceContext: { ocrCombinedText: ocr.diagnostics.map((item) => item.source_snippet).join("\n") },
  });
  const final = quarantineUnsafeRequiredValues(consensus.normalized);
  for (const field of ["consumo_gas_smc", "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno"]) {
    assert.ok(consensus.diagnostics.agreements.includes(field), field);
    assert.ok(final.field_sources[field].includes("ocr"), field);
    assert.ok(final.field_sources[field].includes("ai"), field);
  }
  assert.equal(final.calculation_ready, true);
  assert.deepEqual(final.blocked_calculation_fields, []);
});

test("un valore economico proveniente da una sola fonte viene messo in quarantena", () => {
  const final = quarantineUnsafeRequiredValues({
    ...baseGas(),
    consumo_gas_smc: 120,
    prezzo_gas_eur_smc: 0.63,
    quota_fissa_vendita_gas_eur_anno: 67.32,
    field_sources: {
      consumo_gas_smc: ["ocr"],
      prezzo_gas_eur_smc: ["ocr"],
      quota_fissa_vendita_gas_eur_anno: ["ocr"],
    },
    diagnostics: [
      { field: "consumo_gas_smc", source_snippet: "Consumo annuo 120 Smc", method: "ocr_then_text_pattern" },
      { field: "prezzo_gas_eur_smc", source_snippet: "Prezzo gas 0,63 €/Smc", method: "ocr_then_text_pattern" },
      { field: "quota_fissa_vendita_gas_eur_anno", source_snippet: "Quota fissa 67,32 €/anno", method: "ocr_then_text_pattern" },
    ],
  });
  assert.equal(final.calculation_ready, false);
  assert.deepEqual(new Set(final.blocked_calculation_fields), new Set(["consumo_gas_smc", "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno"]));
});

test("il contratto esporta tutte le funzioni importate da pdfHybrid.js", async () => {
  const policy = await import("../lib/pdfHybridPolicy.js");
  for (const name of [
    "AI_EXTRACTABLE_FIELDS",
    "applyCrossSourceConsensus",
    "buildPdfQualityReport",
    "mergeAiDiagnostics",
    "mergeAiResult",
    "mergeConsensusDiagnostics",
    "mergeOcrDiagnostics",
    "mergeOcrResult",
    "quarantineUnsafeRequiredValues",
    "synchronizeCommodityFields",
  ]) {
    assert.ok(name in policy, name);
  }
});

test("un identificativo di fornitura corregge una commodity incoerente", () => {
  assert.equal(synchronizeCommodityFields({ commodity: "gas", pod: "IT001E53942290" }).commodity, "luce");
  assert.equal(synchronizeCommodityFields({ commodity: "luce", pdr: "03081000752041" }).commodity, "gas");
});

test("la simulazione Unoenergy conserva consenso economico e rifiuti semantici", () => {
  const ocrText = [
    "unoenergy Bolletta Gas Naturale Mercato Libero",
    "Codice Cliente 0308100752041",
    "Codice Cliente 10095846",
    "PDR 03081000752041",
    "Consumo annuo dal 28/02/2025 al 28/02/2026 120 Smc",
    "di cui spesa per la vendita di gas naturale 0,631892 €/Smc",
    "di cui spesa per la vendita di gas naturale 5,610000 €/mese",
    "NOME OFFERTA: Le bollette precedenti risultano regolarmente pagate.",
    "Indice di riferimento PSV MESE SPREAD 3,813622",
  ].join("\n");
  const ocr = {
    kind: "bolletta",
    commodity: "gas",
    recognized: true,
    codice_cliente: "0308100752041",
    pdr: "03081000752041",
    consumo_gas_smc: 120,
    prezzo_gas_eur_smc: 0.631892,
    quota_fissa_vendita_gas_eur_anno: 67.32,
    nome_offerta: "Le bollette precedenti risultano regolarmente pagate.",
    spread_gas_eur_smc: 3.813622,
    diagnostics: [
      { field: "consumo_gas_smc", source_snippet: "Consumo annuo dal 28/02/2025 al 28/02/2026 120 Smc" },
      { field: "prezzo_gas_eur_smc", source_snippet: "di cui spesa per la vendita di gas naturale 0,631892 €/Smc" },
      { field: "quota_fissa_vendita_gas_eur_anno", source_snippet: "di cui spesa per la vendita di gas naturale 5,610000 €/mese" },
      { field: "nome_offerta", source_snippet: "NOME OFFERTA: Le bollette precedenti risultano regolarmente pagate." },
      { field: "spread_gas_eur_smc", source_snippet: "Indice di riferimento PSV MESE SPREAD 3,813622" },
    ],
  };
  const ai = {
    fields: {
      consumo_gas_smc: 120,
      prezzo_gas_eur_smc: 0.631892,
      quota_fissa_vendita_gas_eur_anno: 67.32,
      codice_cliente: null,
      nome_offerta: null,
      spread_gas_eur_smc: null,
    },
    evidence: [
      { field: "consumo_gas_smc", quote: "Consumo annuo dal 28/02/2025 al 28/02/2026 120 Smc", confidence: 0.98 },
      { field: "prezzo_gas_eur_smc", quote: "di cui spesa per la vendita di gas naturale 0,631892 €/Smc", confidence: 0.98 },
      { field: "quota_fissa_vendita_gas_eur_anno", quote: "di cui spesa per la vendita di gas naturale 5,610000 €/mese", confidence: 0.98 },
    ],
  };
  const ocrMerged = mergeOcrResult(baseGas(), ocr, { combinedText: ocrText, pageTexts: [ocrText] });
  assert.ok(ocrMerged.diagnostics.rejectedFields.some((item) => item.field === "codice_cliente" && item.reason === "ambiguous_ocr_candidates"));
  assert.ok(ocrMerged.diagnostics.rejectedFields.some((item) => item.field === "nome_offerta" && item.reason === "invalid_offer_name_semantics"));
  assert.ok(ocrMerged.diagnostics.rejectedFields.some((item) => item.field === "spread_gas_eur_smc" && item.reason === "spread_unit_missing"));

  const requested = new Set([
    ...buildPdfQualityReport(baseGas()).requiredFields,
    ...buildPdfQualityReport(ocrMerged.normalized).missingFields,
    ...ocrMerged.diagnostics.acceptedFields,
  ]);
  for (const field of ["consumo_gas_smc", "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno", "pdr", "intestatario", "codice_fiscale", "codice_cliente", "indirizzo_fornitura"]) {
    assert.ok(requested.has(field), field);
  }

  const aiMerged = mergeAiResult(ocrMerged.normalized, ai);
  const consensus = applyCrossSourceConsensus({
    nativeNormalized: baseGas(),
    ocrNormalized: ocr,
    aiResult: ai,
    normalized: aiMerged.normalized,
    sourceContext: { ocrCombinedText: ocrText },
  });
  const final = quarantineUnsafeRequiredValues(consensus.normalized);
  assert.equal(final.consumo_gas_smc, 120);
  assert.equal(final.prezzo_gas_eur_smc, 0.631892);
  assert.equal(final.quota_fissa_vendita_gas_eur_anno, 67.32);
  assert.equal(final.codice_cliente ?? null, null);
  assert.equal(final.nome_offerta ?? null, null);
  assert.equal(final.spread_gas_eur_smc ?? null, null);
  assert.equal(final.calculation_ready, true);
});

test("i valori deterministici preesistenti non vengono retrocessi", () => {
  const native = quarantineUnsafeRequiredValues({
    kind: "bolletta",
    commodity: "luce",
    recognized: true,
    consumo_luce_kwh: 2700,
    prezzo_luce_eur_kwh: 0.14,
    quota_fissa_vendita_luce_eur_anno: 120,
    diagnostics: [
      { field: "consumo_luce_kwh", status: "found", value: 2700 },
      { field: "prezzo_luce_eur_kwh", status: "found", value: 0.14 },
      { field: "quota_fissa_vendita_luce_eur_anno", status: "found", value: 120 },
    ],
  });
  assert.equal(native.consumo_luce_kwh, 2700);
  assert.equal(native.prezzo_luce_eur_kwh, 0.14);
  assert.equal(native.quota_fissa_vendita_luce_eur_anno, 120);
  assert.equal(native.calculation_ready, true);
});

test("OCR e IA non sovrascrivono un valore nativo differente", () => {
  const native = {
    ...baseGas(),
    pdr: "03081000466501",
    field_sources: { pdr: ["native"] },
  };
  const ocrMerged = mergeOcrResult(native, {
    pdr: "03081000752041",
    diagnostics: [{ field: "pdr", source_snippet: "PDR 03081000752041" }],
  });
  assert.equal(ocrMerged.normalized.pdr, "03081000466501");
  assert.ok(ocrMerged.diagnostics.conflicts.some((item) => item.field === "pdr"));

  const aiMerged = mergeAiResult(native, {
    fields: { pdr: "03081000752041" },
    evidence: [{ field: "pdr", quote: "PDR 03081000752041", confidence: 0.99 }],
  });
  assert.equal(aiMerged.normalized.pdr, "03081000466501");
  assert.ok(aiMerged.diagnostics.conflicts.some((item) => item.field === "pdr"));
});

test("il consenso non può correggere un dato nativo incompatibile", () => {
  const result = applyCrossSourceConsensus({
    nativeNormalized: { ...baseGas(), pdr: "03081000466501" },
    ocrNormalized: { pdr: "03081000752041" },
    aiResult: {
      fields: { pdr: "03081000752041" },
      evidence: [{ field: "pdr", quote: "PDR 03081000752041", confidence: 0.99 }],
    },
    normalized: { ...baseGas(), pdr: "03081000466501" },
  });
  assert.equal(result.normalized.pdr, "03081000466501");
  assert.ok(result.diagnostics.rejected.some((item) => item.field === "pdr" && item.reason === "consensus_cannot_override_native"));
});

test("consenso senza etichetta annuale non abilita il consumo", () => {
  const result = applyCrossSourceConsensus({
    nativeNormalized: baseGas(),
    ocrNormalized: {
      consumo_gas_smc: 120,
      diagnostics: [{ field: "consumo_gas_smc", source_snippet: "Totale 120 Smc" }],
    },
    aiResult: {
      fields: { consumo_gas_smc: 120 },
      evidence: [{ field: "consumo_gas_smc", quote: "Totale 120 Smc", confidence: 0.99 }],
    },
    normalized: baseGas(),
  });
  assert.equal(result.normalized.consumo_gas_smc ?? null, null);
  assert.ok(result.diagnostics.rejected.some((item) => item.reason === "annual_consumption_evidence_missing"));
});

test("consenso senza contesto contrattuale non abilita il prezzo", () => {
  const result = applyCrossSourceConsensus({
    nativeNormalized: baseGas(),
    ocrNormalized: {
      prezzo_gas_eur_smc: 0.63,
      diagnostics: [{ field: "prezzo_gas_eur_smc", source_snippet: "Valore 0,63 €/Smc" }],
    },
    aiResult: {
      fields: { prezzo_gas_eur_smc: 0.63 },
      evidence: [{ field: "prezzo_gas_eur_smc", quote: "Valore 0,63 €/Smc", confidence: 0.99 }],
    },
    normalized: baseGas(),
  });
  assert.equal(result.normalized.prezzo_gas_eur_smc ?? null, null);
  assert.ok(result.diagnostics.rejected.some((item) => item.reason === "contract_price_evidence_missing"));
});

test("le diagnostiche OCR, IA e consenso mantengono stati coerenti", async () => {
  const {
    mergeOcrDiagnostics,
    mergeAiDiagnostics,
    mergeConsensusDiagnostics,
  } = await import("../lib/pdfHybridPolicy.js");
  const normalized = { pdr: "03081000752041" };
  const ocrRows = mergeOcrDiagnostics([], {
    acceptedFields: ["pdr"],
    confirmedFields: [],
    rejectedFields: [],
    conflicts: [],
    evidenceByField: { pdr: { page: 1, quote: "PDR 03081000752041" } },
  }, normalized);
  assert.equal(ocrRows[0].status, "review");
  assert.equal(ocrRows[0].method, "ocr_then_text_pattern");

  const aiRows = mergeAiDiagnostics(ocrRows, {
    acceptedFields: [],
    confirmedFields: ["pdr"],
    rejectedFields: [],
    conflicts: [],
    evidenceByField: { pdr: { page: 1, quote: "PDR 03081000752041" } },
  }, normalized);
  assert.equal(aiRows[0].status, "review");
  assert.equal(aiRows[0].method, "ai_visual_semantic");

  const finalRows = mergeConsensusDiagnostics(aiRows, {
    agreements: ["pdr"],
    corrections: [],
    rejected: [],
  }, normalized);
  assert.equal(finalRows[0].status, "found");
  assert.equal(finalRows[0].confidence, "high");
  assert.equal(finalRows[0].method, "ocr_ai_consensus");
});

test("la readiness duale richiede entrambe le commodity", () => {
  const result = quarantineUnsafeRequiredValues({
    kind: "bolletta",
    commodity: "dual",
    recognized: true,
    consumo_luce_kwh: 2700,
    prezzo_luce_eur_kwh: 0.14,
    quota_fissa_vendita_luce_eur_anno: 120,
    consumo_gas_smc: 900,
    prezzo_gas_eur_smc: 0.62,
    quota_fissa_vendita_gas_eur_anno: 96,
    diagnostics: [],
  });
  assert.equal(result.calculation_ready, true);
  result.prezzo_gas_eur_smc = null;
  const incomplete = quarantineUnsafeRequiredValues(result);
  assert.equal(incomplete.calculation_ready, false);
});
