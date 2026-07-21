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
import {
  buildPdfAiImageRequest,
  PDF_AI_ADAPTER_VERSION,
} from "../lib/pdfAiReader.js";
import { PDF_DATA_CONTRACT_VERSION } from "../lib/pdfDataContract.js";
import { PDF_FIELD_VALIDATION_VERSION } from "../lib/pdfFieldValidation.js";

async function fixture(t, extension = ".pdf") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ol-ai-step8-8-4-"));
  const filePath = path.join(dir, `fixture${extension}`);
  await fs.writeFile(filePath, extension === ".pdf" ? Buffer.from("%PDF-1.4\nvisual bill") : Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return filePath;
}

function candidate({
  field,
  valueText = null,
  valueNumber = null,
  unit = null,
  role,
  evidence,
  label,
  confidence = 95,
  page = 1,
  commodity = "electricity",
}) {
  return {
    field,
    value_text: valueText,
    value_number: valueNumber,
    unit,
    commodity,
    page,
    label,
    evidence,
    semantic_role: role,
    confidence,
    agrees_with: [],
    contradicts: [],
  };
}

function output(extraCandidates = [], customerType = "business") {
  return {
    document: {
      document_type: "bill",
      supplier: "Sorgenia",
      commodity: "electricity",
      customer_type: customerType,
      page_count: 2,
    },
    quality: {
      native_text_quality: "none",
      visual_quality: "readable",
      table_density: "high",
      ocr_recommended: true,
    },
    page_map: [
      { page: 1, role: "summary", summary: "Bolletta luce Sorgenia, P.IVA 02525880395 e POD IT001E53942290" },
      { page: 2, role: "details", summary: "Consumi fatturati, costi medi e potenze" },
    ],
    candidates: [
      candidate({ field: "kind", valueText: "bill", role: "classification", label: "Bolletta", evidence: "BOLLETTA PER LA FORNITURA DI ENERGIA ELETTRICA" }),
      candidate({ field: "commodity", valueText: "electricity", role: "classification", label: "Fornitura", evidence: "ENERGIA ELETTRICA" }),
      candidate({ field: "fornitore", valueText: "Sorgenia", role: "classification", label: "Logo", evidence: "Sorgenia" }),
      candidate({ field: "customer_type", valueText: customerType, role: "classification", label: "Cliente", evidence: customerType === "business" ? "Società Agricola S.S. - P.IVA 02525880395" : "Cliente domestico" }),
      candidate({ field: "intestatario", valueText: customerType === "business" ? "Romagna Allevamenti Societa' Agricola S.S." : "Mario Rossi", role: "actual_customer_value", label: "Intestatario", evidence: customerType === "business" ? "Romagna Allevamenti Societa' Agricola S.S." : "Mario Rossi" }),
      candidate({ field: "codice_fiscale", valueText: customerType === "business" ? "02525880395" : "RSSMRA80A01H501U", role: "identifier", label: "P.IVA / Codice fiscale", evidence: customerType === "business" ? "P.IVA 02525880395" : "Codice fiscale RSSMRA80A01H501U" }),
      candidate({ field: "pod", valueText: "IT001E53942290", role: "identifier", label: "POD", evidence: "POD IT001E53942290" }),
      ...extraCandidates,
    ],
    conflicts: [],
    review_reasons: [],
  };
}

function baseline() {
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

async function run(t, extraCandidates, customerType = "business") {
  const filePath = await fixture(t);
  return applyControlledPdfAiFallback(filePath, {
    filename: "sorgenia 2.pdf",
    normalized: baseline(),
    env: { PDF_AI_MODE: "fallback", PDF_AI_TIMEOUT_MS: "42000" },
    apiKey: "test-key",
    transport: async () => ({ id: "resp_step8_8_4", output_text: JSON.stringify(output(extraCandidates, customerType)) }),
  });
}

test("potenze esplicitamente etichettate in kW sono ammesse a confidenza 85 e restano da verificare", async (t) => {
  const result = await run(t, [
    candidate({
      field: "potenza_impegnata_kw",
      valueNumber: 10,
      unit: "kW",
      role: "actual_customer_value",
      label: "Potenza impegnata",
      evidence: "Potenza impegnata 10,0 kW",
      confidence: 85,
      page: 2,
    }),
    candidate({
      field: "potenza_disponibile_kw",
      valueNumber: 11,
      unit: "kW",
      role: "actual_customer_value",
      label: "Potenza disponibile",
      evidence: "Potenza disponibile 11,0 kW",
      confidence: 85,
      page: 2,
    }),
  ]);

  assert.equal(result.potenza_impegnata_kw, 10);
  assert.equal(result.potenza_disponibile_kw, 11);
  assert.equal(result.field_status.potenza_impegnata_kw.status, "da_verificare");
  assert.equal(result.field_status.potenza_disponibile_kw.status, "da_verificare");
  assert.equal(result.data_contract.autofill_plan.review_fields.some((row) => row.source_field === "potenza_impegnata_kw"), true);
  assert.equal(result.ai.rejected_fields.some((row) => row.field === "potenza_impegnata_kw"), false);
});

test("la soglia ridotta non vale per un numero kW senza etichetta di potenza esplicita", async (t) => {
  const result = await run(t, [
    candidate({
      field: "potenza_impegnata_kw",
      valueNumber: 10,
      unit: "kW",
      role: "actual_customer_value",
      label: "Dato tecnico",
      evidence: "Valore tecnico 10 kW",
      confidence: 85,
      page: 2,
    }),
  ]);

  assert.equal(result.potenza_impegnata_kw ?? null, null);
  const rejected = result.ai.rejected_fields.find((row) => row.field === "potenza_impegnata_kw");
  assert.equal(rejected?.reason, "confidence_below_threshold");
});

test("consumo fatturato e costi medi restano osservazioni e non alimentano il confronto automatico", async (t) => {
  const result = await run(t, [
    candidate({
      field: "consumo_luce_kwh",
      valueNumber: 4084,
      unit: "kWh",
      role: "actual_customer_value",
      label: "Consumi fatturati",
      evidence: "Consumi fatturati 4.084,0 kWh",
      confidence: 95,
    }),
    candidate({
      field: "prezzo_luce_eur_kwh",
      valueNumber: 0.15,
      unit: "EUR/kWh",
      role: "billing_period",
      label: "Costo medio unitario della spesa per la materia energia",
      evidence: "Costo medio unitario della spesa per la materia energia 0,15 EUR/kWh",
      confidence: 90,
      page: 2,
    }),
    candidate({
      field: "prezzo_luce_eur_kwh",
      valueNumber: 0.28,
      unit: "EUR/kWh",
      role: "billing_period",
      label: "Costo medio unitario della bolletta",
      evidence: "Costo medio unitario della bolletta 0,28 EUR/kWh",
      confidence: 90,
      page: 2,
    }),
  ]);

  assert.equal(result.consumo_luce_kwh ?? null, null);
  assert.equal(result.prezzo_luce_eur_kwh ?? null, null);
  assert.equal(result.data_contract.supplies.luce.annual_consumption, null);
  assert.equal(result.data_contract.supplies.luce.sales_price, null);
  assert.equal(result.ai.rejected_fields.find((row) => row.field === "consumo_luce_kwh")?.reason, "billing_period_consumption_not_annual");
  assert.equal(result.ai.rejected_fields.filter((row) => row.field === "prezzo_luce_eur_kwh").every((row) => row.reason === "average_unit_cost_not_contract_price"), true);
});

test("una bolletta business identificata può proseguire verso il consulente pur restando incompleta per il calcolo automatico", async (t) => {
  const result = await run(t, []);
  const readiness = result.readiness.confronto.luce;

  assert.equal(readiness.status, "incompleto");
  assert.equal(readiness.automatic_comparison_ready, false);
  assert.equal(readiness.consultant_evaluation_available, true);
  assert.equal(readiness.can_continue, true);
  assert.equal(readiness.path, "business_consultant");
  assert.equal(readiness.consultant_status, "valutabile_con_consulente");
  assert.deepEqual(readiness.manual_input_required, [
    "consumo_luce_kwh",
    "prezzo_luce_eur_kwh",
    "quota_fissa_vendita_luce_eur_anno",
  ]);
  assert.equal(result.data_contract.supplies.luce.readiness.comparison.consultant_evaluation_available, true);
});

test("il percorso consulente non viene attivato automaticamente per il profilo privato", async (t) => {
  const result = await run(t, [], "consumer");
  const readiness = result.readiness.confronto.luce;
  assert.equal(readiness.status, "incompleto");
  assert.equal(readiness.consultant_evaluation_available, false);
  assert.equal(readiness.can_continue, false);
  assert.equal(readiness.path, "manual_completion");
});

test("prompt, pannello e versioni espongono osservazioni e percorso consulente senza falsificare i dati", async (t) => {
  const imagePath = await fixture(t, ".jpg");
  const request = await buildPdfAiImageRequest({
    imageFiles: [{ filePath: imagePath, page: 1, mimeType: "image/jpeg" }],
    filename: "foto-bolletta.pdf",
    parserVersion: "test",
    parserCandidates: [],
    pageCount: 1,
    diagnostics: [],
    model: "test-model",
  });
  const prompt = request.input[0].content;
  const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const helperStart = html.indexOf("function pdfReadinessFieldsLine");
  const helperEnd = html.indexOf("function normalizePdfTaxId", helperStart);
  const start = html.indexOf('const PDF_VISUAL_READING_PANEL_VERSION = "v106.8.4-business-consultant-panel-1";');
  const end = html.indexOf("function renderPdfSummary(documents, merged) {", start);
  const source = `${html.slice(helperStart, helperEnd)}\n${html.slice(start, end)}\nglobalThis.__reasonLabel = pdfVisualObservationLabel;\nglobalThis.__consultantLine = pdfConsultantComparisonLine;`;
  const context = vm.createContext({
    testoHtmlSicuro(value) { return String(value ?? ""); },
    PDF_READINESS_FIELD_LABELS: {
      consumo_luce_kwh: "consumo annuo luce",
      prezzo_luce_eur_kwh: "prezzo luce",
    },
  });
  vm.runInContext(source, context);

  assert.equal(PDF_AI_FALLBACK_PIPELINE_VERSION, "v106.8.4-business-consultant-readiness-1");
  assert.equal(PDF_AI_ADAPTER_VERSION, "2.4.3");
  assert.equal(PDF_DATA_CONTRACT_VERSION, "1.3.1");
  assert.equal(PDF_FIELD_VALIDATION_VERSION, "v106.8.4-business-consultant-readiness-1");
  assert.match(prompt, /Consumi fatturati/);
  assert.match(prompt, /semantic_role billing_period/);
  assert.equal(context.__reasonLabel("billing_period_consumption_not_annual"), "Consumo del periodo letto, non consumo annuo");
  assert.match(context.__consultantLine("Percorso aziende luce", {
    consultant_evaluation_available: true,
    manual_input_required: ["consumo_luce_kwh", "prezzo_luce_eur_kwh"],
  }), /valutabile con consulente/);
  assert.match(html, /il confronto automatico resta incompleto ma la pratica può proseguire verso una valutazione con consulente/);
});
