import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {
  applyControlledPdfAiFallback,
  PDF_AI_FALLBACK_PIPELINE_VERSION,
} from "../lib/pdfAiFallback.js";
import { aiPdfToCandidates, PDF_CANDIDATE_CONTRACT_VERSION } from "../lib/pdfReaderContract.js";

async function withPdf(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ol-ai-module-step8-6-"));
  const filePath = path.join(dir, "sorgenia-foto.pdf");
  await fs.writeFile(filePath, Buffer.from("%PDF-1.4\nphotographed bill"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return filePath;
}

function candidate({ field, valueText = null, valueNumber = null, unit = null, role, evidence, confidence = 95, page = 1, commodity = "electricity" }) {
  return {
    field,
    value_text: valueText,
    value_number: valueNumber,
    unit,
    commodity,
    page,
    label: field.replaceAll("_", " "),
    evidence,
    semantic_role: role,
    confidence,
    agrees_with: [],
    contradicts: [],
  };
}

function actualLikeOutput({ commodity = "electricity", includeCommodityCandidate = true } = {}) {
  const candidates = [
    candidate({ field: "kind", valueText: "bill", role: "classification", evidence: "Electricity bill summary and billing details", confidence: 90, commodity }),
    candidate({ field: "fornitore", valueText: "Sorgenia", role: "classification", evidence: "Logo and name Sorgenia on pages 1 and 2", commodity }),
    candidate({ field: "customer_type", valueText: "business", role: "classification", evidence: "Societa Agricola S.S. and P.IVA 02525880395", confidence: 90, commodity }),
    candidate({ field: "intestatario", valueText: "Romagna Allevamenti Societa' Agricola S.S.", role: "actual_customer_value", evidence: "Customer name on page 1", commodity }),
    candidate({ field: "codice_fiscale", valueText: "02525880395", role: "identifier", evidence: "Codice Fiscale 02525880395", commodity }),
    candidate({ field: "codice_cliente", valueText: "4615991", role: "identifier", evidence: "CODICE CLIENTE 4615991", commodity }),
    candidate({ field: "indirizzo_fornitura", valueText: "Vicolo Santa Croce, 2/AX - 48125, Ravenna (RA)", role: "actual_customer_value", evidence: "Address below POD IT001E53942290", commodity }),
    candidate({ field: "indirizzo_fornitura_luce", valueText: "Vicolo Santa Croce, 2/AX - 48125, Ravenna (RA)", role: "actual_customer_value", evidence: "Address below POD IT001E53942290", commodity }),
    candidate({ field: "pod", valueText: "IT001E53942290", role: "identifier", evidence: "POD IT001E53942290", commodity }),
    candidate({ field: "nome_offerta_luce", valueText: "Soluzione Luce Flexi", role: "offer_value", evidence: "Prodotto Soluzione Luce Flexi", confidence: 90, commodity }),
    candidate({ field: "potenza_impegnata_kw", valueNumber: 10, unit: "kW", role: "actual_customer_value", evidence: "Potenza impegnata: 10,0 kW", page: 2, commodity }),
    candidate({ field: "potenza_disponibile_kw", valueNumber: 11, unit: "kW", role: "actual_customer_value", evidence: "Potenza disponibile: 11,0 kW", page: 2, commodity }),
    candidate({ field: "consumo_luce_kwh", valueNumber: 4084, unit: "kWh", role: "actual_customer_value", evidence: "Consumi fatturati dicembre 2018 e gennaio 2019: 4084 kWh", commodity }),
    candidate({ field: "prezzo_luce_eur_kwh", valueNumber: 0.15, unit: "EUR/kWh", role: "offer_value", evidence: "Costo medio unitario materia energia 0,15 EUR/kWh", confidence: 85, page: 2, commodity }),
    candidate({ field: "quota_fissa_vendita_luce_eur_anno", valueNumber: 0, unit: "EUR/anno", role: "offer_value", evidence: "Quota fissa non identificata con certezza", confidence: 50, page: 2, commodity }),
  ];
  if (includeCommodityCandidate) {
    candidates.splice(1, 0, candidate({ field: "commodity", valueText: commodity, role: "classification", evidence: "Electricity supply and POD shown on the bill", confidence: 90, commodity }));
  }
  return {
    document: {
      document_type: "bill",
      supplier: "Sorgenia",
      commodity,
      customer_type: "business",
      page_count: 2,
    },
    quality: { native_text_quality: "none", visual_quality: "readable", table_density: "high", ocr_recommended: true },
    page_map: [
      { page: 1, role: "summary", summary: "Electricity bill with customer, POD and billed consumption" },
      { page: 2, role: "details", summary: "Technical power data and cost details" },
    ],
    candidates,
    conflicts: [],
    review_reasons: ["Billed-period consumption is not annual consumption"],
  };
}

function baseUnknown() {
  return {
    parser_version: "v106.2-client-raster-transport-1",
    page_count: 2,
    diagnostics: [],
    kind: "unknown",
    commodity: "unknown",
    recognized: false,
    confidence: "low",
    warnings: ["pdf_grande_rasterizzato_nel_browser"],
    textExtracted: 0,
    needsReview: true,
  };
}

const env = { PDF_AI_MODE: "fallback", PDF_AI_TIMEOUT_MS: "42000" };

test("le classificazioni visuali al 90% vengono normalizzate per il modulo", async (t) => {
  const filePath = await withPdf(t);
  const result = await applyControlledPdfAiFallback(filePath, {
    filename: "sorgenia 2.pdf",
    normalized: baseUnknown(),
    env,
    apiKey: "test-key",
    transport: async () => ({ id: "resp_step8_6", output_text: JSON.stringify(actualLikeOutput()) }),
  });

  assert.equal(PDF_AI_FALLBACK_PIPELINE_VERSION, "v106.8.1-timeout-recovery-1");
  assert.equal(result.ai.applied, true);
  assert.equal(result.kind, "bolletta");
  assert.equal(result.commodity, "luce");
  assert.equal(result.recognized, true);
  assert.equal(result.field_status.pod.status, "da_verificare");
  assert.equal(result.field_status.indirizzo_fornitura_luce.status, "da_verificare");
  assert.equal(result.field_status.potenza_impegnata_kw.status, "da_verificare");
  assert.equal(result.field_status.potenza_disponibile_kw.status, "da_verificare");
  assert.equal(result.field_status.consumo_luce_kwh.status, "mancante");
  assert.equal(result.field_status.prezzo_luce_eur_kwh.status, "mancante");
  assert.equal(result.field_status.quota_fissa_vendita_luce_eur_anno.status, "mancante");
});

test("il contratto crea la fornitura luce congrua senza usare consumo bimestrale o costo medio", async (t) => {
  const filePath = await withPdf(t);
  const result = await applyControlledPdfAiFallback(filePath, {
    filename: "sorgenia 2.pdf",
    normalized: baseUnknown(),
    env,
    apiKey: "test-key",
    transport: async () => ({ id: "resp_step8_6_contract", output_text: JSON.stringify(actualLikeOutput()) }),
  });

  const luce = result.data_contract.supplies.luce;
  assert.ok(luce);
  assert.equal(result.data_contract.supplies.gas, null);
  assert.equal(luce.provider, "Sorgenia");
  assert.equal(luce.customer_code, "4615991");
  assert.equal(luce.supply_identifier, "IT001E53942290");
  assert.equal(luce.supply_address, "Vicolo Santa Croce, 2/AX - 48125, Ravenna (RA)");
  assert.equal(luce.committed_power_kw, 10);
  assert.equal(luce.available_power_kw, 11);
  assert.equal(luce.offer.name, "Soluzione Luce Flexi");
  assert.equal(luce.annual_consumption, null);
  assert.equal(luce.sales_price, null);
  assert.equal(luce.fixed_sales_fee_annual, null);
  assert.equal(result.readiness.dati_bolletta.luce.status, "da_verificare");
  assert.equal(result.readiness.confronto.luce.status, "incompleto");

  const review = new Set(result.data_contract.autofill_plan.review_fields.map((item) => item.source_field));
  for (const field of ["fornitore_luce", "intestatario", "codice_fiscale", "codice_cliente_luce", "pod", "indirizzo_fornitura_luce", "potenza_impegnata_kw"]) {
    assert.equal(review.has(field), true, `${field} deve restare selezionabile solo con conferma esplicita`);
  }
  assert.equal(review.has("codice_cliente"), false, "il codice cliente generico non deve duplicare quello luce");
  assert.equal(result.data_contract.fields.codice_cliente.autofill.reason, "rappresentato_da_codice_cliente_luce");
  assert.equal(result.data_contract.autofill_plan.safe_fields.length, 0);
});

test("la commodity viene sintetizzata dai metadati visuali quando manca il candidato esplicito", () => {
  const candidates = aiPdfToCandidates(actualLikeOutput({ includeCommodityCandidate: false }), "test-model");
  const commodity = candidates.find((item) => item.field === "commodity");
  assert.equal(PDF_CANDIDATE_CONTRACT_VERSION, "1.0.3");
  assert.equal(commodity?.normalized_value, "electricity");
  assert.equal(commodity?.semantic_role, "classification");
  assert.equal(commodity?.confidence, 94);
});

test("un POD valido corregge una classificazione gas AI incoerente senza modificare i dati tariffari", async (t) => {
  const filePath = await withPdf(t);
  const output = actualLikeOutput({ commodity: "gas" });
  const result = await applyControlledPdfAiFallback(filePath, {
    filename: "sorgenia 2.pdf",
    normalized: baseUnknown(),
    env,
    apiKey: "test-key",
    transport: async () => ({ id: "resp_step8_6_reconcile", output_text: JSON.stringify(output) }),
  });

  assert.equal(result.commodity, "luce");
  assert.equal(result.warnings.includes("ai_commodity_riallineata_a_identificativo_fornitura"), true);
  assert.equal(result.ai.rejected_fields.some((item) => item.field === "commodity" && item.reason === "classification_conflicts_with_supply_identifier"), true);
  assert.equal(result.consumo_luce_kwh ?? null, null);
  assert.equal(result.prezzo_luce_eur_kwh ?? null, null);
});

test("il pannello elimina l'indirizzo generico duplicato e le osservazioni sotto il 70%", async () => {
  const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const start = html.indexOf('const PDF_VISUAL_READING_PANEL_VERSION = "v106.8-review-provenance-panel-1";');
  const end = html.indexOf("function renderPdfSummary(documents, merged) {", start);
  const source = `${html.slice(start, end)}\nglobalThis.__collectVisual = collectPdfVisualReadingEntries;`;
  const context = vm.createContext({
    testoHtmlSicuro(value) { return String(value ?? ""); },
  });
  vm.runInContext(source, context);
  const entries = context.__collectVisual({
    commodity: "luce",
    ai: {
      applied: true,
      field_meta: {
        indirizzo_fornitura: { field: "indirizzo_fornitura", value: "Via Roma 1", page: 1, confidence: 95 },
        indirizzo_fornitura_luce: { field: "indirizzo_fornitura_luce", value: "Via Roma 1", page: 1, confidence: 95 },
      },
      rejected_fields: [
        { field: "quota_fissa_vendita_luce_eur_anno", value: 0, unit: "EUR/anno", page: 2, confidence: 50, reason: "confidence_below_threshold" },
        { field: "prezzo_luce_eur_kwh", value: 0.15, unit: "EUR/kWh", page: 2, confidence: 85, reason: "confidence_below_threshold" },
      ],
    },
  });
  assert.equal(entries.filter((entry) => entry.value === "Via Roma 1").length, 1);
  assert.equal(entries.some((entry) => entry.field === "indirizzo_fornitura_luce"), true);
  assert.equal(entries.some((entry) => entry.field === "quota_fissa_vendita_luce_eur_anno"), false);
  assert.equal(entries.some((entry) => entry.field === "prezzo_luce_eur_kwh"), true);
});
