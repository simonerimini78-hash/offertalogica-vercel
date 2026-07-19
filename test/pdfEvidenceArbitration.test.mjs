import test from "node:test";
import assert from "node:assert/strict";
import {
  arbitrateConsumptionEvidence,
  collectConsumptionObservations,
  selectAnnualConsumptionFromText,
} from "../lib/pdfEvidenceArbitration.js";
import { buildPdfDiagnostics, extractPdfDataFromText } from "../lib/pdfExtract.js";
import { enhancePdfAnalysis } from "../lib/pdfHybrid.js";

const EDISON_CONSUMPTION = [
  "Consumo fatturato 53,46 Smc di cui Effettivi 01/05/2026 - 30/06/2026 53,46 Smc Totali 53,46 Smc",
  "Consumo annuo aggiornato dal 01/07/2025 al 30/06/2026 1.653,86 Smc",
  "Consumo progressivo annuo da gennaio 2026 945,20 Smc",
].join("\n");

test("classifica separatamente fatturato, rolling 12 mesi e progressivo YTD Edison", () => {
  const observations = collectConsumptionObservations([EDISON_CONSUMPTION], { source: "native" });
  assert.ok(observations.some((item) => item.value === 53.46 && item.role === "consumo_fatturato_periodo"));
  assert.ok(observations.some((item) => item.value === 1653.86 && item.role === "consumo_annuo_12_mesi"));
  assert.ok(observations.some((item) => item.value === 945.2 && item.role === "consumo_progressivo_anno_corrente"));
  assert.equal(selectAnnualConsumptionFromText(EDISON_CONSUMPTION, "smc"), 1653.86);
});

test("il progressivo da gennaio non compete con il consumo completo di 12 mesi", () => {
  const result = arbitrateConsumptionEvidence({
    nativePageTexts: [EDISON_CONSUMPTION],
    sourceAvailability: { parser: "completed", ocr: "not_required", ai: "not_required" },
  });
  const decision = result.decisions.consumo_gas_smc;
  assert.equal(decision.status, "found");
  assert.equal(decision.value, 1653.86);
  assert.equal(decision.selected_candidate.role, "consumo_annuo_12_mesi");
  assert.ok(decision.excluded_candidates.some((item) => item.value === 945.2
    && item.reason === "year_to_date_not_complete_annual_consumption"));
});

test("un timeout OCR è neutro: il dato annuale nativo forte prevale su un dato IA non annuale", () => {
  const result = arbitrateConsumptionEvidence({
    nativePageTexts: [EDISON_CONSUMPTION],
    ocrPageTexts: [""],
    aiResult: {
      fields: { consumo_gas_smc: 53.46 },
      evidence: [{ field: "consumo_gas_smc", page: 1, quote: "Consumo fatturato 53,46 Smc", confidence: 0.99 }],
    },
    sourceAvailability: { parser: "completed", ocr: "timeout", ai: "completed" },
  });

  const decision = result.decisions.consumo_gas_smc;
  assert.equal(decision.status, "found");
  assert.equal(decision.value, 1653.86);
  assert.equal(decision.source_availability.ocr, "timeout");
  assert.equal(decision.source_assessment.ocr.relation, "unavailable");
  assert.ok(decision.excluded_candidates.some((item) => item.value === 53.46 && item.role === "consumo_fatturato_periodo"));
});

test("una diversa annualità proposta dall'IA ma non presente nelle fonti resta esclusa", () => {
  const result = arbitrateConsumptionEvidence({
    nativePageTexts: ["Consumo annuo aggiornato 1.653,86 Smc"],
    aiResult: {
      fields: { consumo_gas_smc: 1800 },
      evidence: [{ field: "consumo_gas_smc", page: 1, quote: "Consumo annuo aggiornato 1.800 Smc", confidence: 0.99 }],
    },
    sourceAvailability: { parser: "completed", ocr: "timeout", ai: "completed" },
  });

  const decision = result.decisions.consumo_gas_smc;
  assert.equal(decision.status, "found");
  assert.equal(decision.value, 1653.86);
  assert.ok(decision.competing_annual_candidates.some((item) => item.value === 1800 && item.accepted === false));
});

test("due valori annuali espliciti e diversi senza periodo costituiscono ambiguità reale", () => {
  const result = arbitrateConsumptionEvidence({
    nativePageTexts: ["Consumo annuo 1.653,86 Smc\nConsumo annuale aggiornato 1.800,00 Smc"],
    sourceAvailability: { parser: "completed", ocr: "not_required", ai: "not_required" },
  });

  const decision = result.decisions.consumo_gas_smc;
  assert.equal(decision.status, "review");
  assert.equal(decision.value, null);
  assert.equal(decision.decision_rule, "ambiguous_multiple_complete_annual_periods");
  assert.equal(decision.competing_annual_candidates.length, 2);
});

test("due valori diversi riferiti allo stesso periodo annuale bloccano il calcolo", () => {
  const result = arbitrateConsumptionEvidence({
    nativePageTexts: [[
      "Consumo annuo dal 01/07/2025 al 30/06/2026 1.653,86 Smc",
      "Consumo annuale dal 01/07/2025 al 30/06/2026 1.800,00 Smc",
    ].join("\n")],
    sourceAvailability: { parser: "completed", ocr: "not_required", ai: "not_required" },
  });
  const decision = result.decisions.consumo_gas_smc;
  assert.equal(decision.status, "review");
  assert.equal(decision.decision_rule, "conflicting_complete_annual_evidence_same_period");
});

test("tra due annualità complete di periodi diversi seleziona la più recente", () => {
  const result = arbitrateConsumptionEvidence({
    nativePageTexts: [[
      "Consumo annuo dal 01/07/2024 al 30/06/2025 1.500,00 Smc",
      "Consumo annuo dal 01/07/2025 al 30/06/2026 1.653,86 Smc",
    ].join("\n")],
    sourceAvailability: { parser: "completed", ocr: "not_required", ai: "not_required" },
  });
  const decision = result.decisions.consumo_gas_smc;
  assert.equal(decision.status, "found");
  assert.equal(decision.value, 1653.86);
  assert.equal(decision.decision_rule, "latest_complete_annual_period");
});

test("su una scansione l'IA da sola non rende operativo un consumo annuale", () => {
  const result = arbitrateConsumptionEvidence({
    nativePageTexts: [""],
    ocrPageTexts: [""],
    aiResult: {
      fields: { consumo_gas_smc: 120 },
      evidence: [{ field: "consumo_gas_smc", page: 1, quote: "Consumo annuo 120 Smc", confidence: 0.99 }],
    },
    sourceAvailability: { parser: "completed", ocr: "timeout", ai: "completed" },
  });

  const decision = result.decisions.consumo_gas_smc;
  assert.equal(decision.status, "review");
  assert.equal(decision.candidate_value, 120);
  assert.equal(decision.decision_rule, "annual_candidate_not_independently_grounded");
});

test("OCR con unità lievemente corrotta e IA concorde possono confermare una scansione", () => {
  const result = arbitrateConsumptionEvidence({
    nativePageTexts: [""],
    ocrPageTexts: ["CONSUMO ANNUO dal 28/02/2025 al 28/02/2026 120 Sme"],
    ocrPageConfidences: { 1: 0.82 },
    aiResult: {
      fields: { consumo_gas_smc: 120 },
      evidence: [{ field: "consumo_gas_smc", page: 1, quote: "CONSUMO ANNUO dal 28/02/2025 al 28/02/2026 120 Smc", confidence: 0.98 }],
    },
    sourceAvailability: { parser: "completed", ocr: "completed", ai: "completed" },
  });

  const decision = result.decisions.consumo_gas_smc;
  assert.equal(decision.status, "found");
  assert.equal(decision.value, 120);
  assert.equal(decision.decision_rule, "complete_annual_ocr_ai_agreement");
});

test("numero OCR compatto 165386 non crea una seconda annualità ma supporta approssimativamente 1653,86", () => {
  const result = arbitrateConsumptionEvidence({
    nativePageTexts: [EDISON_CONSUMPTION],
    ocrPageTexts: ["Consumo annuo aggiornato dal 01/07/2025 al 30/06/2026 165386 Sme"],
    aiResult: {
      fields: { consumo_gas_smc: 1653.86 },
      evidence: [{ field: "consumo_gas_smc", page: 1, quote: "Consumo annuo aggiornato dal 01/07/2025 al 30/06/2026 1.653,86 Smc", confidence: 0.99 }],
    },
    sourceAvailability: { parser: "completed", ocr: "completed", ai: "completed" },
  });
  const decision = result.decisions.consumo_gas_smc;
  assert.equal(decision.status, "found");
  assert.equal(decision.value, 1653.86);
  assert.equal(decision.source_assessment.ocr.relation, "supports_approximate");
  assert.equal(decision.selected_candidate.approximate_ocr_support.length, 1);
  assert.ok(decision.excluded_candidates.some((item) => item.value === 165386
    && item.reason === "ocr_number_format_corrupted"));
});

test("una data contrattuale vicina non viene associata al consumo fatturato", () => {
  const observations = collectConsumptionObservations([
    "Il contratto scade il 31/03/2027. Consumo fatturato 53,46 Smc di cui Effettivi 01/05/2026 - 30/06/2026 53,46 Smc",
  ], { source: "native" });
  const billed = observations.find((item) => item.value === 53.46 && item.period);
  assert.deepEqual(billed?.period && { from: billed.period.from, to: billed.period.to, days: billed.period.days }, {
    from: "01/05/2026",
    to: "30/06/2026",
    days: 60,
  });
});

test("identificativi del contatore e valori zero non diventano candidati annuali", () => {
  const result = arbitrateConsumptionEvidence({
    nativePageTexts: ["Letture contatore n° 241200032014133645 mc. Consumo annuo 0 Smc"],
    sourceAvailability: { parser: "completed", ocr: "not_required", ai: "not_required" },
  });
  assert.equal(result.decisions.consumo_gas_smc.status, "missing");
  assert.equal(result.decisions.consumo_gas_mc.status, "missing");
  assert.ok(result.decisions.consumo_gas_mc.excluded_candidates.some((item) => item.reason === "implausible_consumption_value"));
});

test("la pipeline corregge il valore parser errato usando il ruolo semantico, anche con OCR in timeout", async () => {
  const text = [
    "Edison Bolletta Gas Naturale Totale da pagare 125,00 €",
    "DATI CLIENTE LUCA DELLA CROCE VIA MULINO 19 40050 VALSAMOGGIA BO",
    "Codice Fiscale: DLLLCU82B03E625Q Codice Cliente: 1001133382",
    EDISON_CONSUMPTION,
    "di cui spesa per la vendita di gas naturale 0,565095 €/Smc",
    "Quota fissa 2 mesi 24,01 €/mese di cui spesa per la vendita di gas naturale 20,00 €/mese",
    "Codice PDR 03081000466501 Indirizzo di fornitura: VIA MULINO 19 - 40050 VALSAMOGGIA BO",
  ].join("\n");
  const native = extractPdfDataFromText(text);
  native.page_count = 1;
  native.consumo_gas_smc = 53.46;
  native.diagnostics = buildPdfDiagnostics(native, [text]);

  const result = await enhancePdfAnalysis({
    filePath: "/tmp/non-usato.pdf",
    filename: "edison.pdf",
    nativeNormalized: native,
    pageTexts: [text],
    loadOcr: async () => ({
      pdfOcrConfig: () => ({ mode: "verify", timeoutMs: 30_000 }),
      runPdfOcr: async () => ({
        used: true,
        reason: "timeout",
        errorCode: "PDF_OCR_ALL_SELECTED_PAGES_TIMEOUT",
        selectedPages: [{ page: 1 }],
        pages: [{ page: 1, status: "failed", reason: "PDF_OCR_PAGE_TIMEOUT", confidence: null }],
        pageTexts: [""],
        combinedText: "",
        normalized: null,
      }),
    }),
    loadAi: async () => ({
      pdfAiConfig: () => ({ mode: "verify", model: "test", timeoutMs: 45_000 }),
      analyzePdfWithFinalAi: async () => ({
        used: true,
        result: {
          fields: { consumo_gas_smc: 1653.86 },
          evidence: [{ field: "consumo_gas_smc", page: 1, quote: "Consumo annuo aggiornato dal 01/07/2025 al 30/06/2026 1.653,86 Smc", confidence: 0.99 }],
          document_confidence: 0.99,
          needs_review: false,
          notes: [],
        },
      }),
    }),
  });

  assert.equal(result.normalized.consumo_gas_smc, 1653.86);
  assert.equal(result.normalized.analysis.source_availability.ocr, "timeout");
  assert.equal(result.normalized.analysis.field_arbitration.consumo_gas_smc.decision_rule, "complete_annual_native_evidence");
  assert.ok(!result.normalized.blocked_calculation_fields.includes("consumo_gas_smc"));
  assert.equal(result.normalized.analysis.ai_conflicts.length, 0);
});

test("pipeline Edison reale: OCR corrotto e progressivo YTD non bloccano il consumo rolling 12 mesi", async () => {
  const nativeText = [
    "Edison Energia Bolletta Gas Naturale",
    "DATI CLIENTE LUCA DELLA CROCE VIA MULINO 19 40050 VALSAMOGGIA BO",
    "Codice Fiscale: DLLLCU82B03E625Q Codice Cliente: 1001133382",
    EDISON_CONSUMPTION,
    "di cui spesa per la vendita di gas naturale 0,565095 €/Smc",
    "Quota fissa 2 mesi 24,01 €/mese di cui spesa per la vendita di gas naturale 20,00 €/mese",
    "Punto di fornitura VIA MULINO 19 - 40050 VALSAMOGGIA BO PDR 03081000466501",
  ].join("\n");
  const ocrText = [
    "Edison Energia Bolletta Gas Naturale",
    "Consumo fatturato 53,46 Smc",
    "Consumo annuo aggiornato dal 01/07/2025 al 30/06/2026 165386 Sme",
    "Consumo progressivo annuo da gennaio 2026 945,20 Sme",
  ].join("\n");
  const native = extractPdfDataFromText(nativeText);
  native.page_count = 1;
  native.diagnostics = buildPdfDiagnostics(native, [nativeText]);
  const ocrNormalized = extractPdfDataFromText(ocrText);
  ocrNormalized.page_count = 1;
  ocrNormalized.diagnostics = buildPdfDiagnostics(ocrNormalized, [ocrText]);

  const result = await enhancePdfAnalysis({
    filePath: "/tmp/non-usato.pdf",
    filename: "edison-runtime.pdf",
    nativeNormalized: native,
    pageTexts: [nativeText],
    loadOcr: async () => ({
      pdfOcrConfig: () => ({ mode: "verify", timeoutMs: 30_000 }),
      runPdfOcr: async () => ({
        used: true,
        reason: "completed",
        selectedPages: [{ page: 1 }],
        pages: [{ page: 1, status: "completed", confidence: 88 }],
        pageTexts: [ocrText],
        combinedText: ocrText,
        normalized: ocrNormalized,
      }),
    }),
    loadAi: async () => ({
      pdfAiConfig: () => ({ mode: "verify", model: "test", timeoutMs: 45_000 }),
      analyzePdfWithFinalAi: async () => ({
        used: true,
        result: {
          fields: {
            consumo_gas_smc: 1653.86,
            prezzo_gas_eur_smc: 0.565095,
            quota_fissa_vendita_gas_eur_anno: 240,
          },
          evidence: [
            { field: "consumo_gas_smc", page: 1, quote: "Consumo annuo aggiornato dal 01/07/2025 al 30/06/2026 1.653,86 Smc", confidence: 0.99 },
            { field: "prezzo_gas_eur_smc", page: 1, quote: "di cui spesa per la vendita di gas naturale 0,565095 €/Smc", confidence: 0.99 },
            { field: "quota_fissa_vendita_gas_eur_anno", page: 1, quote: "di cui spesa per la vendita di gas naturale 20,00 €/mese", confidence: 0.99 },
          ],
          document_confidence: 0.99,
          needs_review: false,
          notes: [],
        },
      }),
    }),
  });

  const decision = result.normalized.analysis.field_arbitration.consumo_gas_smc;
  assert.equal(result.normalized.consumo_gas_smc, 1653.86);
  assert.equal(decision.status, "found");
  assert.equal(decision.selected_candidate.role, "consumo_annuo_12_mesi");
  assert.equal(decision.source_assessment.ocr.relation, "supports_approximate");
  assert.ok(decision.excluded_candidates.some((item) => item.value === 945.2
    && item.reason === "year_to_date_not_complete_annual_consumption"));
  assert.ok(!result.normalized.blocked_calculation_fields.includes("consumo_gas_smc"));
});
