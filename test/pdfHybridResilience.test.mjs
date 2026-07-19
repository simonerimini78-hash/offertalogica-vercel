import test from "node:test";
import assert from "node:assert/strict";
import { buildPdfDiagnostics, extractPdfDataFromText } from "../lib/pdfExtract.js";
import { enhancePdfAnalysis } from "../lib/pdfHybrid.js";

test("il parser nativo resta disponibile se i moduli OCR e IA non si caricano", async () => {
  const native = {
    kind: "bolletta",
    commodity: "luce",
    recognized: true,
    confidence: "high",
    warnings: [],
    needsReview: false,
    page_count: 1,
    consumo_luce_kwh: 2700,
    prezzo_luce_eur_kwh: 0.14,
    quota_fissa_vendita_luce_eur_anno: 120,
    diagnostics: [
      { field: "consumo_luce_kwh", required: true, status: "found", value: 2700 },
      { field: "prezzo_luce_eur_kwh", required: true, status: "found", value: 0.14 },
      { field: "quota_fissa_vendita_luce_eur_anno", required: true, status: "found", value: 120 },
    ],
  };

  const result = await enhancePdfAnalysis({
    filePath: "/tmp/non-usato.pdf",
    filename: "test.pdf",
    nativeNormalized: native,
    pageTexts: ["Consumo annuo 2700 kWh prezzo 0,14 €/kWh"],
    loadOcr: async () => { throw new Error("OCR_IMPORT_FAILED"); },
    loadAi: async () => { throw new Error("AI_IMPORT_FAILED"); },
  });

  assert.equal(result.normalized.consumo_luce_kwh, 2700);
  assert.equal(result.normalized.prezzo_luce_eur_kwh, 0.14);
  assert.equal(result.normalized.analysis.mode, "native");
  assert.equal(result.normalized.analysis.ocr_module_loaded, false);
  assert.equal(result.normalized.analysis.ai_module_loaded, false);
});

test("OCR termina prima dell’IA e i campi gas vengono rivalutati dopo la scansione", async () => {
  const native = {
    kind: "unknown",
    commodity: "unknown",
    fornitore: "",
    recognized: false,
    confidence: "low",
    warnings: ["testo_pdf_assente_o_insufficiente"],
    needsReview: true,
    page_count: 1,
    diagnostics: [
      { field: "fornitore", required: true, status: "missing", value: null },
      { field: "kind", required: true, status: "missing", value: null },
      { field: "commodity", required: true, status: "missing", value: null },
    ],
  };

  const events = [];
  let requestedFields = [];
  const ocrText = "unoenergy Bolletta Gas Naturale PDR 03081000752041";
  const ocrNormalized = {
    kind: "bolletta",
    commodity: "gas",
    fornitore: "Unoenergy",
    page_count: 1,
    diagnostics: [
      { field: "fornitore", value: "Unoenergy", page: 1, source_snippet: "unoenergy", confidence: "high" },
      { field: "kind", value: "bolletta", page: 1, source_snippet: "Bolletta Gas Naturale", confidence: "medium" },
      { field: "commodity", value: "gas", page: 1, source_snippet: "Gas Naturale PDR 03081000752041", confidence: "medium" },
    ],
  };

  const result = await enhancePdfAnalysis({
    filePath: "/tmp/non-usato.pdf",
    filename: "scansione.pdf",
    nativeNormalized: native,
    pageTexts: [""],
    loadOcr: async () => ({
      pdfOcrConfig: () => ({ mode: "verify", timeoutMs: 30_000 }),
      runPdfOcr: async () => {
        events.push("ocr:start");
        await new Promise((resolve) => setTimeout(resolve, 20));
        events.push("ocr:end");
        return {
          used: true,
          reason: "completed",
          selectedPages: [{ page: 1 }],
          pages: [{ page: 1, status: "completed", confidence: 90 }],
          pageTexts: [ocrText],
          combinedText: ocrText,
          normalized: ocrNormalized,
        };
      },
    }),
    loadAi: async () => ({
      pdfAiConfig: () => ({ mode: "verify", model: "test", timeoutMs: 45_000 }),
      analyzePdfWithFinalAi: async ({ requestedFields: fields }) => {
        events.push("ai:start");
        requestedFields = fields;
        return { used: false, reason: "test_no_result" };
      },
    }),
  });

  assert.ok(events.indexOf("ocr:end") < events.indexOf("ai:start"));
  for (const field of [
    "consumo_gas_smc",
    "prezzo_gas_eur_smc",
    "quota_fissa_vendita_gas_eur_anno",
    "pdr",
    "intestatario",
    "codice_fiscale",
    "codice_cliente",
    "indirizzo_fornitura",
  ]) {
    assert.ok(requestedFields.includes(field), field);
  }
  assert.equal(result.normalized.analysis.strategy, "field_contracts_then_period_aware_evidence_arbitration");
  assert.equal(result.normalized.analysis.quality_after_ocr.recognized, true);
});


test("la scansione gas usa consenso OCR+IA sui dati di calcolo e scarta i falsi positivi", async () => {
  const ocrText = [
    "unoenergy Bolletta Gas Naturale Mercato Libero",
    "Codice Cliente 0308100752041",
    "Codice Cliente 10095846",
    "BENEVENTI ROBERTA Gentile cliente, VIA DECIO RAGGI 195",
    "C.F.: BNVRRT60L59D704L 47121 FORLI FC",
    "PDR 03081000752041",
    "INDIRIZZO DI FORNITURA: VIA DECIO RAGGI 195 + 47121 FORLI FC",
    "Consumo annuo dal 28/02/2025 al 28/02/2026 120 Smc",
    "QUANTITÀ PREZZO MEDIO €/Smc IMPORTI € di cui spesa per la vendita di gas naturale 0,631892 €/Smc",
    "Quota fissa 2 mesi 9,800000 €/mese di cui spesa per la vendita di gas naturale 5,610000 €/mese",
    "NOME OFFERTA: Le bollette precedenti risultano regolarmente pagate.",
    "PREZZO INDICIZZATO MENSILE Indice di riferimento PSV MESE SPREAD 3,813622",
  ].join("\n");

  const native = extractPdfDataFromText("");
  native.page_count = 1;
  native.diagnostics = buildPdfDiagnostics(native, [""]);
  const ocrNormalized = extractPdfDataFromText(ocrText);
  ocrNormalized.page_count = 1;
  ocrNormalized.diagnostics = buildPdfDiagnostics(ocrNormalized, [ocrText]);

  let requestedFields = [];
  const result = await enhancePdfAnalysis({
    filePath: "/tmp/non-usato.pdf",
    filename: "unoenergy-scansione.pdf",
    nativeNormalized: native,
    pageTexts: [""],
    loadOcr: async () => ({
      pdfOcrConfig: () => ({ mode: "verify", timeoutMs: 30_000 }),
      runPdfOcr: async () => ({
        used: true,
        reason: "completed",
        selectedPages: [{ page: 1 }],
        pages: [{ page: 1, status: "completed", confidence: 83 }],
        pageTexts: [ocrText],
        combinedText: ocrText,
        normalized: ocrNormalized,
      }),
    }),
    loadAi: async () => ({
      pdfAiConfig: () => ({ mode: "verify", model: "test", timeoutMs: 45_000 }),
      analyzePdfWithFinalAi: async ({ requestedFields: fields }) => {
        requestedFields = fields;
        return {
          used: true,
          result: {
            fields: {
              fornitore: "Unoenergy",
              kind: "bolletta",
              commodity: "gas",
              customer_type: "privato",
              consumo_gas_smc: 120,
              prezzo_gas_eur_smc: 0.631892,
              quota_fissa_vendita_gas_eur_anno: 67.32,
              pdr: "03081000752041",
              intestatario: "BENEVENTI ROBERTA",
              codice_fiscale: "BNVRRT60L59D704L",
              codice_cliente: null,
              indirizzo_fornitura: "VIA DECIO RAGGI 195 47121 FORLI FC",
              nome_offerta: null,
              tipo_prezzo: "variabile",
              indice_riferimento: "PSV",
              spread_gas_eur_smc: null,
            },
            evidence: [
              { field: "fornitore", page: 1, quote: "unoenergy", confidence: 0.98 },
              { field: "kind", page: 1, quote: "Bolletta Gas Naturale", confidence: 0.98 },
              { field: "commodity", page: 1, quote: "Gas Naturale", confidence: 0.98 },
              { field: "customer_type", page: 1, quote: "C.F.: BNVRRT60L59D704L", confidence: 0.98 },
              { field: "consumo_gas_smc", page: 1, quote: "Consumo annuo dal 28/02/2025 al 28/02/2026 120 Smc", confidence: 0.98 },
              { field: "prezzo_gas_eur_smc", page: 1, quote: "di cui spesa per la vendita di gas naturale 0,631892 €/Smc", confidence: 0.98 },
              { field: "quota_fissa_vendita_gas_eur_anno", page: 1, quote: "Quota fissa 2 mesi di cui spesa per la vendita di gas naturale 5,610000 €/mese", confidence: 0.98 },
              { field: "pdr", page: 1, quote: "PDR 03081000752041", confidence: 0.98 },
              { field: "intestatario", page: 1, quote: "BENEVENTI ROBERTA", confidence: 0.98 },
              { field: "codice_fiscale", page: 1, quote: "C.F.: BNVRRT60L59D704L", confidence: 0.98 },
              { field: "indirizzo_fornitura", page: 1, quote: "INDIRIZZO DI FORNITURA: VIA DECIO RAGGI 195 47121 FORLI FC", confidence: 0.98 },
              { field: "tipo_prezzo", page: 1, quote: "PREZZO INDICIZZATO MENSILE", confidence: 0.98 },
              { field: "indice_riferimento", page: 1, quote: "Indice di riferimento PSV MESE", confidence: 0.98 },
            ],
            document_confidence: 0.98,
            needs_review: false,
            notes: [],
          },
        };
      },
    }),
  });

  for (const field of ["consumo_gas_smc", "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno"]) {
    assert.ok(requestedFields.includes(field), field);
    assert.ok(result.normalized.analysis.consensus_agreed_fields.includes(field), field);
  }
  assert.equal(result.normalized.consumo_gas_smc, 120);
  assert.equal(result.normalized.prezzo_gas_eur_smc, 0.631892);
  assert.ok(Math.abs(result.normalized.quota_fissa_vendita_gas_eur_anno - 67.32) < 1e-9);
  assert.equal(result.normalized.pdr, "03081000752041");
  assert.equal(result.normalized.intestatario, "BENEVENTI ROBERTA");
  assert.equal(result.normalized.codice_fiscale, "BNVRRT60L59D704L");
  assert.equal(result.normalized.indirizzo_fornitura, "VIA DECIO RAGGI 195 47121 FORLI FC");
  assert.equal(result.normalized.codice_cliente, null);
  assert.equal(result.normalized.nome_offerta, null);
  assert.equal(result.normalized.spread_gas_eur_smc, null);
  assert.equal(result.normalized.calculation_ready, true);
  assert.deepEqual(result.normalized.blocked_calculation_fields, []);
  assert.ok(result.normalized.analysis.ocr_rejected_fields.some((item) => item.field === "codice_cliente" && item.reason === "ambiguous_ocr_candidates"));
  assert.ok(result.normalized.analysis.ocr_rejected_fields.some((item) => item.field === "nome_offerta" && item.reason === "invalid_offer_name_semantics"));
  assert.ok(result.normalized.analysis.ocr_rejected_fields.some((item) => item.field === "spread_gas_eur_smc" && item.reason === "spread_unit_missing"));
});
