import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyControlledPdfAiFallback,
  PDF_AI_FALLBACK_PIPELINE_VERSION,
} from "../lib/pdfAiFallback.js";
import { aiPdfToCandidates, pdfFieldDefinition } from "../lib/pdfReaderContract.js";

async function withPdf(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ol-ai-sorgenia-"));
  const filePath = path.join(dir, "sorgenia-foto.pdf");
  await fs.writeFile(filePath, Buffer.from("%PDF-1.4\nphotographed bill"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return filePath;
}

function candidate({ field, valueText = null, valueNumber = null, unit = null, role, evidence, confidence = 90, page = 1 }) {
  return {
    field,
    value_text: valueText,
    value_number: valueNumber,
    unit,
    commodity: "electricity",
    page,
    label: field.replaceAll("_", " "),
    evidence,
    semantic_role: role,
    confidence,
    agrees_with: [],
    contradicts: [],
  };
}

function sorgeniaOutput() {
  return {
    document: {
      document_type: "bill",
      supplier: "Sorgenia",
      commodity: "electricity",
      customer_type: "business",
      page_count: 2,
    },
    quality: {
      native_text_quality: "none",
      visual_quality: "readable",
      table_density: "high",
      ocr_recommended: true,
    },
    page_map: [
      { page: 1, role: "bill_main", summary: "Bolletta per la fornitura di energia elettrica nel mercato libero" },
      { page: 2, role: "bill_details", summary: "Dati tecnici della fornitura e consumi fatturati" },
    ],
    candidates: [
      candidate({ field: "fornitore", valueText: "Sorgenia", role: "classification", evidence: "Sorgenia logo at top of page 1", confidence: 96 }),
      candidate({ field: "commodity", valueText: "electricity", role: "classification", evidence: "Bolletta per la fornitura di energia elettrica", confidence: 95 }),
      candidate({ field: "customer_type", valueText: "business", role: "classification", evidence: "Romagna Allevamenti Societa' Agricola S.S. and P.IVA 02525880395", confidence: 90 }),
      candidate({ field: "intestatario", valueText: "ROMAGNA ALLEVAMENTI SOCIETA' AGRICOLA S.S.", role: "actual_customer_value", evidence: "ROMAGNA ALLEVAMENTI SOCIETA' AGRICOLA S.S.", confidence: 90 }),
      candidate({ field: "codice_cliente", valueText: "4615991", role: "identifier", evidence: "CODICE CLIENTE 4615991", confidence: 90 }),
      candidate({ field: "indirizzo_fornitura", valueText: "VICOLO SANTA CROCE, 2/AX - 48125 RAVENNA (RA)", role: "actual_customer_value", evidence: "POD ... di VICOLO SANTA CROCE, 2/AX - 48125, RAVENNA (RA)", confidence: 90 }),
      candidate({ field: "pod", valueText: "IT001E53942290", role: "identifier", evidence: "POD IT001E53942290", confidence: 95 }),
      candidate({ field: "potenza_disponibile_kw", valueNumber: 11, unit: "kW", role: "actual_customer_value", evidence: "Potenza disponibile: 11,0 kW", confidence: 90, page: 2 }),
      candidate({ field: "potenza_impegnata_kw", valueNumber: 10, unit: "kW", role: "actual_customer_value", evidence: "Potenza impegnata: 10,0 kW", confidence: 90, page: 2 }),
      candidate({ field: "consumo_luce_kwh", valueNumber: 4084, unit: "kWh", role: "actual_customer_value", evidence: "Consumi fatturati dicembre 2018/gennaio 2019: 4.084,0 kWh", confidence: 96 }),
    ],
    conflicts: [],
    review_reasons: ["Il documento non espone un consumo annuo né le condizioni economiche complete"],
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

test("il contratto ammette i ruoli visuali corretti per fornitore, intestatario e indirizzo", () => {
  assert.equal(pdfFieldDefinition("fornitore").roles.includes("classification"), true);
  assert.equal(pdfFieldDefinition("intestatario").roles.includes("actual_customer_value"), true);
  assert.equal(pdfFieldDefinition("indirizzo_fornitura").roles.includes("actual_customer_value"), true);
});

test("il tipo documento viene derivato dai metadati visuali quando il modello omette il candidato kind", () => {
  const output = sorgeniaOutput();
  const candidates = aiPdfToCandidates(output, "test-model");
  const kind = candidates.find((item) => item.field === "kind");
  assert.equal(kind?.normalized_value, "bill");
  assert.equal(kind?.semantic_role, "classification");
  assert.equal(kind?.source, "ai");
});

test("la bolletta Sorgenia fotografata completa i dati anagrafici ma non trasforma il consumo bimestrale in annuo", async (t) => {
  const filePath = await withPdf(t);
  const output = sorgeniaOutput();
  const result = await applyControlledPdfAiFallback(filePath, {
    filename: "sorgenia 2.pdf",
    normalized: baseUnknown(),
    env,
    apiKey: "test-key",
    transport: async () => ({ id: "resp_sorgenia_step8_4", output_text: JSON.stringify(output) }),
  });

  assert.equal(result.ai.pipeline_version, PDF_AI_FALLBACK_PIPELINE_VERSION);
  assert.equal(result.ai.applied, true);
  assert.equal(result.kind, "bolletta");
  assert.equal(result.commodity, "luce");
  assert.equal(result.recognized, true);
  assert.equal(result.fornitore, "Sorgenia");
  assert.equal(result.fornitore_luce, "Sorgenia");
  assert.equal(result.customer_type, "business");
  assert.equal(result.intestatario, "ROMAGNA ALLEVAMENTI SOCIETA' AGRICOLA S.S.");
  assert.equal(result.codice_cliente, "4615991");
  assert.equal(result.codice_cliente_luce, "4615991");
  assert.equal(result.indirizzo_fornitura_luce, "VICOLO SANTA CROCE, 2/AX - 48125 RAVENNA (RA)");
  assert.equal(result.pod, "IT001E53942290");
  assert.equal(result.potenza_disponibile_kw, 11);
  assert.equal(result.potenza_impegnata_kw, 10);
  assert.equal(result.consumo_luce_kwh ?? null, null);
  assert.equal(result.ai.rejected_fields.some((item) => item.field === "consumo_luce_kwh" && item.reason === "value_or_unit_not_safe"), true);

  const reviewFields = result.data_contract.autofill_plan.review_fields.map((item) => item.source_field);
  for (const field of ["fornitore_luce", "intestatario", "codice_cliente_luce", "indirizzo_fornitura_luce", "pod", "potenza_impegnata_kw"]) {
    assert.equal(reviewFields.includes(field), true, `${field} deve essere selezionabile solo con conferma esplicita`);
  }
  assert.equal(reviewFields.includes("codice_cliente"), false, "il codice cliente generico non deve duplicare quello luce");
});

test("i rifiuti AI espongono dettagli utili senza contenere il PDF", async (t) => {
  const filePath = await withPdf(t);
  const result = await applyControlledPdfAiFallback(filePath, {
    normalized: baseUnknown(),
    env,
    apiKey: "test-key",
    transport: async () => ({ id: "resp_sorgenia_reject", output_text: JSON.stringify(sorgeniaOutput()) }),
  });
  const rejected = result.ai.rejected_fields.find((item) => item.field === "consumo_luce_kwh");
  assert.equal(rejected.reason, "value_or_unit_not_safe");
  assert.equal(rejected.confidence, 96);
  assert.equal(rejected.unit, "kWh");
  assert.match(rejected.label, /consumo luce kwh/i);
  assert.equal(Object.hasOwn(rejected, "file_data"), false);
});
