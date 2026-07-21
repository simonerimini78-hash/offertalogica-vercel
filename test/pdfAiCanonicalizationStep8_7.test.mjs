import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyControlledPdfAiFallback,
  PDF_AI_FALLBACK_PIPELINE_VERSION,
} from "../lib/pdfAiFallback.js";
import {
  buildPdfAiImageRequest,
  PDF_AI_ADAPTER_VERSION,
} from "../lib/pdfAiReader.js";

async function withFixture(t, extension = ".pdf") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ol-ai-canonical-step8-7-"));
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
  label = null,
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
    label: label || field.replaceAll("_", " "),
    evidence,
    semantic_role: role,
    confidence,
    agrees_with: [],
    contradicts: [],
  };
}

function visualOutput({ commodity = "electricity", holderEvidence = "Customer name on page 1", includeTax = false } = {}) {
  const candidates = [
    candidate({ field: "kind", valueText: "bill", role: "classification", evidence: "BOLLETTA PER LA FORNITURA DI ENERGIA ELETTRICA", confidence: 90, commodity }),
    candidate({ field: "commodity", valueText: commodity, role: "classification", evidence: "Electricity supply with POD", confidence: 90, commodity }),
    candidate({ field: "fornitore", valueText: "Sorgenia", role: "classification", evidence: "Sorgenia logo", commodity }),
    candidate({ field: "intestatario", valueText: "Romagna Allevamenti Societa' Agricola S.S.", role: "actual_customer_value", evidence: holderEvidence, commodity }),
    candidate({ field: "codice_cliente", valueText: "4615991", role: "identifier", evidence: "CODICE CLIENTE 4615991", commodity }),
    candidate({ field: "indirizzo_fornitura", valueText: "Vicolo Santa Croce, 2/AX - 48125 Ravenna (RA)", role: "actual_customer_value", evidence: "Address below POD", commodity }),
    candidate({ field: "pod", valueText: "IT001E53942290", role: "identifier", evidence: "POD IT001E53942290", commodity }),
    candidate({ field: "nome_offerta", valueText: "Soluzione Luce Flexi", role: "offer_value", evidence: "Prodotto attivo: Soluzione Luce Flexi", confidence: 90, page: 2, commodity }),
    candidate({ field: "potenza_impegnata_kw", valueNumber: 10, unit: "kW", role: "actual_customer_value", evidence: "Potenza impegnata: 10,0 kW", page: 2, commodity }),
    candidate({ field: "consumo_luce_kwh", valueNumber: 4084, unit: "kWh", role: "actual_customer_value", evidence: "Consumi fatturati del periodo 4084 kWh", commodity }),
    candidate({ field: "prezzo_luce_eur_kwh", valueNumber: 0.15, unit: "EUR/kWh", role: "actual_customer_value", evidence: "Costo medio unitario materia energia 0,15 EUR/kWh", confidence: 90, page: 2, commodity }),
  ];
  if (includeTax) {
    candidates.push(candidate({ field: "codice_fiscale", valueText: "02525880395", role: "identifier", evidence: "P.IVA 02525880395", label: "P.IVA", commodity }));
  }
  return {
    document: {
      document_type: "bill",
      supplier: "Sorgenia",
      commodity,
      customer_type: "unknown",
      page_count: 2,
    },
    quality: { native_text_quality: "none", visual_quality: "readable", table_density: "high", ocr_recommended: true },
    page_map: [
      { page: 1, role: "summary", summary: "Customer, POD and bill summary" },
      { page: 2, role: "details", summary: "Product and technical data" },
    ],
    candidates,
    conflicts: [],
    review_reasons: [],
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

async function runVisual(t, output) {
  const filePath = await withFixture(t);
  return applyControlledPdfAiFallback(filePath, {
    filename: "sorgenia 2.pdf",
    normalized: baseUnknown(),
    env,
    apiKey: "test-key",
    transport: async () => ({ id: "resp_step8_7", output_text: JSON.stringify(output) }),
  });
}

test("il nome offerta generico viene canonicalizzato nel campo luce del modulo", async (t) => {
  const result = await runVisual(t, visualOutput());

  assert.equal(PDF_AI_FALLBACK_PIPELINE_VERSION, "v106.8-ai-review-provenance-1");
  assert.equal(result.nome_offerta, "Soluzione Luce Flexi");
  assert.equal(result.nome_offerta_luce, "Soluzione Luce Flexi");
  assert.equal(result.field_status.nome_offerta_luce.status, "da_verificare");
  assert.equal(result.data_contract.supplies.luce.offer.name, "Soluzione Luce Flexi");
  assert.equal(result.data_contract.fields.nome_offerta_luce.review_required, true);
});

test("il profilo business viene derivato solo da una ragione sociale esplicita", async (t) => {
  const result = await runVisual(t, visualOutput());

  assert.equal(result.customer_type, "business");
  assert.equal(result.data_contract.customer.profile, "business");
  assert.equal(result.ai.filled_fields.includes("customer_type"), true);
  assert.equal(result.warnings.includes("ai_customer_type_derivato_da_evidenza_aziendale"), true);
  assert.match(result.ai.field_meta.customer_type.evidence, /forma giuridica esplicita/i);
  assert.equal(result.data_contract.fields.customer_type.review_required, true);
});

test("una P.IVA esplicita presente nell'evidenza viene recuperata come codice fiscale canonico", async (t) => {
  const output = visualOutput({ holderEvidence: "Customer header: Romagna Allevamenti Societa' Agricola S.S. - P.IVA 02525880395" });
  const result = await runVisual(t, output);

  assert.equal(result.codice_fiscale, "02525880395");
  assert.equal(result.data_contract.customer.tax_id, "02525880395");
  assert.equal(result.ai.filled_fields.includes("codice_fiscale"), true);
  assert.equal(result.ai.field_meta.codice_fiscale.label, "P.IVA");
  assert.equal(result.data_contract.fields.codice_fiscale.review_required, true);
});

test("il piano di autofill espone un solo codice cliente per una fornitura luce", async (t) => {
  const result = await runVisual(t, visualOutput({ includeTax: true }));
  const reviewFields = result.data_contract.autofill_plan.review_fields;
  const customerRows = reviewFields.filter((item) => ["codice_cliente", "codice_cliente_luce"].includes(item.source_field));

  assert.equal(result.data_contract.autofill_plan.policy_version, "1.3.0");
  assert.equal(customerRows.length, 1);
  assert.equal(customerRows[0].source_field, "codice_cliente_luce");
  assert.equal(customerRows[0].target, "activation.codice_cliente_luce");
  assert.equal(result.data_contract.fields.codice_cliente.autofill.reason, "rappresentato_da_codice_cliente_luce");
  assert.equal(result.data_contract.customer.customer_code, "4615991");
});

test("la canonicalizzazione non trasforma consumo del periodo o costo medio in dati di confronto", async (t) => {
  const result = await runVisual(t, visualOutput());

  assert.equal(result.consumo_luce_kwh ?? null, null);
  assert.equal(result.prezzo_luce_eur_kwh ?? null, null);
  assert.equal(result.data_contract.supplies.luce.annual_consumption, null);
  assert.equal(result.data_contract.supplies.luce.sales_price, null);
  assert.equal(result.ai.rejected_fields.some((item) => item.field === "consumo_luce_kwh"), true);
  assert.equal(result.ai.rejected_fields.some((item) => item.field === "prezzo_luce_eur_kwh"), true);
});

test("il prompt visuale richiede checklist identità e campi offerta specifici per commodity", async (t) => {
  const imagePath = await withFixture(t, ".jpg");
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

  assert.equal(PDF_AI_ADAPTER_VERSION, "2.4.0");
  assert.match(prompt, /identity checklist/i);
  assert.match(prompt, /11-digit P\.IVA/i);
  assert.match(prompt, /nome_offerta_luce/);
  assert.match(prompt, /Do not emit both a generic and a commodity-specific duplicate/i);
});
