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
import {
  PDF_CANDIDATE_CONTRACT_VERSION,
  pdfFieldDefinition,
} from "../lib/pdfReaderContract.js";

async function fixture(t, extension = ".pdf") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ol-ai-step8-8-2-"));
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
  confidence = 100,
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

function output(extraCandidates = []) {
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
      { page: 1, role: "summary", summary: "Bolletta luce Sorgenia, P.IVA 02525880395 e POD" },
      { page: 2, role: "details", summary: "Costi medi unitari e dati tecnici" },
    ],
    candidates: [
      candidate({ field: "kind", valueText: "bill", role: "classification", label: "Bolletta", evidence: "BOLLETTA PER LA FORNITURA DI ENERGIA ELETTRICA" }),
      candidate({ field: "commodity", valueText: "electricity", role: "classification", label: "Fornitura", evidence: "ENERGIA ELETTRICA" }),
      candidate({ field: "fornitore", valueText: "Sorgenia", role: "classification", label: "Logo", evidence: "Sorgenia" }),
      candidate({ field: "customer_type", valueText: "business", role: "classification", label: "Cliente", evidence: "Società Agricola S.S. - P.IVA 02525880395" }),
      candidate({ field: "intestatario", valueText: "Romagna Allevamenti Societa' Agricola S.S.", role: "actual_customer_value", label: "Intestatario", evidence: "Romagna Allevamenti Societa' Agricola S.S." }),
      candidate({ field: "codice_cliente", valueText: "4615991", role: "identifier", label: "CODICE CLIENTE", evidence: "CODICE CLIENTE 4615991" }),
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

async function run(t, extraCandidates) {
  const filePath = await fixture(t);
  return applyControlledPdfAiFallback(filePath, {
    filename: "sorgenia 2.pdf",
    normalized: baseline(),
    env: { PDF_AI_MODE: "fallback", PDF_AI_TIMEOUT_MS: "42000" },
    apiKey: "test-key",
    transport: async () => ({ id: "resp_step8_8_2", output_text: JSON.stringify(output(extraCandidates)) }),
  });
}

test("codice fiscale/P.IVA con ruolo actual_customer_value resta valido e da verificare", async (t) => {
  const result = await run(t, [
    candidate({
      field: "codice_fiscale",
      valueText: "02525880395",
      role: "actual_customer_value",
      label: "P.IVA e Codice Fiscale",
      evidence: "P.IVA 02525880395 Codice Fiscale 02525880395",
    }),
  ]);

  assert.deepEqual(pdfFieldDefinition("codice_fiscale").roles, ["identifier", "actual_customer_value"]);
  assert.equal(result.codice_fiscale, "02525880395");
  assert.equal(result.field_status.codice_fiscale.status, "da_verificare");
  assert.equal(result.data_contract.customer.tax_id, "02525880395");
  assert.equal(result.data_contract.fields.codice_fiscale.review_required, true);
  assert.equal(result.data_contract.autofill_plan.review_fields.some((row) => row.source_field === "codice_fiscale"), true);
  assert.equal(result.ai.rejected_fields.some((row) => row.field === "codice_fiscale"), false);
});

test("i costi medi EUR/kWh vengono letti come osservazioni ma non diventano prezzo contrattuale", async (t) => {
  const result = await run(t, [
    candidate({
      field: "prezzo_luce_eur_kwh",
      valueNumber: 0.15,
      unit: "EUR/kWh",
      role: "billing_period",
      label: "Costo medio unitario materia energia",
      evidence: "Costo medio unitario materia energia 0,15 EUR/kWh",
      page: 2,
    }),
    candidate({
      field: "prezzo_luce_eur_kwh",
      valueNumber: 0.28,
      unit: "EUR/kWh",
      role: "billing_period",
      label: "Costo medio unitario bolletta",
      evidence: "Costo medio unitario bolletta 0,28 EUR/kWh",
      page: 2,
    }),
  ]);

  assert.equal(result.prezzo_luce_eur_kwh ?? null, null);
  assert.equal(result.data_contract.supplies.luce.sales_price, null);
  const observations = result.ai.rejected_fields.filter((row) => row.field === "prezzo_luce_eur_kwh");
  assert.equal(observations.length, 2);
  assert.deepEqual(observations.map((row) => row.value), [0.15, 0.28]);
  assert.equal(observations.every((row) => row.reason === "average_unit_cost_not_contract_price"), true);
  assert.equal(observations.every((row) => row.semantic_role === "billing_period"), true);
});

test("il filtro costo medio è stretto e non blocca un corrispettivo vendita esplicito", async (t) => {
  const result = await run(t, [
    candidate({
      field: "prezzo_luce_eur_kwh",
      valueNumber: 0.12345,
      unit: "EUR/kWh",
      role: "offer_value",
      label: "Corrispettivo energia",
      evidence: "Corrispettivo energia 0,12345 EUR/kWh",
      page: 2,
      confidence: 96,
    }),
  ]);

  assert.equal(result.prezzo_luce_eur_kwh, 0.12345);
  assert.equal(result.data_contract.supplies.luce.sales_price, 0.12345);
  assert.equal(result.ai.rejected_fields.some((row) => row.field === "prezzo_luce_eur_kwh"), false);
});

test("prompt e versioni richiedono esplicitamente i costi medi come osservazioni", async (t) => {
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

  assert.equal(PDF_AI_FALLBACK_PIPELINE_VERSION, "v106.8.4-business-consultant-readiness-1");
  assert.equal(PDF_AI_ADAPTER_VERSION, "2.4.3");
  assert.equal(PDF_CANDIDATE_CONTRACT_VERSION, "1.0.4");
  assert.match(prompt, /Costo medio unitario materia energia/);
  assert.match(prompt, /Costo medio unitario bolletta/);
  assert.match(prompt, /semantic_role billing_period/);
  assert.match(prompt, /observation-only/);
});

test("il pannello spiega che il costo medio non è un prezzo contrattuale", async () => {
  const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const start = html.indexOf('const PDF_VISUAL_READING_PANEL_VERSION = "v106.8.4-business-consultant-panel-1";');
  const end = html.indexOf("function renderPdfSummary(documents, merged) {", start);
  const source = `${html.slice(start, end)}\nglobalThis.__collectVisual = collectPdfVisualReadingEntries;\nglobalThis.__reasonLabel = pdfVisualObservationLabel;`;
  const context = vm.createContext({ testoHtmlSicuro(value) { return String(value ?? ""); } });
  vm.runInContext(source, context);

  const entries = context.__collectVisual({
    commodity: "luce",
    ai: {
      applied: true,
      field_meta: {},
      rejected_fields: [
        {
          field: "prezzo_luce_eur_kwh",
          value: 0.15,
          unit: "EUR/kWh",
          confidence: 100,
          page: 2,
          label: "Costo medio unitario materia energia",
          reason: "average_unit_cost_not_contract_price",
        },
      ],
    },
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].value, "0.15 EUR/kWh");
  assert.equal(context.__reasonLabel(entries[0].reason), "Costo medio letto, non prezzo contrattuale");
});
