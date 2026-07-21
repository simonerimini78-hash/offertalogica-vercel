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
} from "../lib/pdfReaderContract.js";
import {
  PDF_AUTOFILL_POLICY_VERSION,
  PDF_DATA_CONTRACT_VERSION,
} from "../lib/pdfDataContract.js";
import { PDF_FIELD_VALIDATION_VERSION } from "../lib/pdfFieldValidation.js";

async function withFixture(t, extension = ".pdf") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ol-ai-review-step8-8-"));
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

function visualOutput() {
  return {
    document: {
      document_type: "bill",
      supplier: "Sorgenia",
      commodity: "electricity",
      customer_type: "business",
      page_count: 2,
    },
    quality: { native_text_quality: "none", visual_quality: "readable", table_density: "high", ocr_recommended: true },
    page_map: [
      { page: 1, role: "summary", summary: "Bolletta luce Sorgenia con cliente, P.IVA e POD" },
      { page: 2, role: "details", summary: "Prodotto attivo e dati tecnici" },
    ],
    candidates: [
      candidate({ field: "kind", valueText: "bill", role: "classification", evidence: "BOLLETTA PER LA FORNITURA DI ENERGIA ELETTRICA", confidence: 95 }),
      candidate({ field: "commodity", valueText: "electricity", role: "classification", evidence: "ENERGIA ELETTRICA NEL MERCATO LIBERO", confidence: 95 }),
      candidate({ field: "fornitore", valueText: "Sorgenia", role: "classification", evidence: "Sorgenia logo on page 1", label: "Supplier logo", confidence: 95 }),
      candidate({ field: "customer_type", valueText: "business", role: "classification", evidence: "P.IVA 02525880395 and Societa Agricola S.S.", confidence: 95 }),
      candidate({ field: "intestatario", valueText: "Romagna Allevamenti Societa' Agricola S.S.", role: "actual_customer_value", evidence: "Romagna Allevamenti Societa' Agricola S.S.", label: "Customer legal name", confidence: 95 }),
      candidate({ field: "codice_fiscale", valueText: "02525880395", role: "identifier", evidence: "P.IVA 02525880395", label: "P.IVA", confidence: 95 }),
      candidate({ field: "codice_cliente", valueText: "4615991", role: "identifier", evidence: "CODICE CLIENTE 4615991", label: "Codice cliente", confidence: 95 }),
      candidate({ field: "indirizzo_fornitura", valueText: "Vicolo Santa Croce, 2/AX - 48125, Ravenna (RA)", role: "actual_customer_value", evidence: "di VICOLO SANTA CROCE, 2/AX - 48125, RAVENNA (RA)", label: "Supply address", confidence: 95 }),
      candidate({ field: "pod", valueText: "IT001E53942290", role: "identifier", evidence: "POD IT001E53942290", label: "POD", confidence: 95 }),
      candidate({ field: "potenza_impegnata_kw", valueNumber: 10, unit: "kW", role: "actual_customer_value", evidence: "Potenza impegnata: 10,0 kW", label: "Potenza impegnata", confidence: 95, page: 2 }),
      candidate({ field: "potenza_disponibile_kw", valueNumber: 11, unit: "kW", role: "actual_customer_value", evidence: "Potenza disponibile: 11,0 kW", label: "Potenza disponibile", confidence: 95, page: 2 }),
      candidate({ field: "nome_offerta", valueText: "Soluzione Luce Flexi", role: "offer_value", evidence: "Prodotto attivo: Soluzione Luce Flexi", label: "Prodotto attivo", confidence: 90, page: 2 }),
      candidate({ field: "codice_offerta_luce", valueText: "SLFLE05201016", role: "offer_value", evidence: "Codice prodotto: SLFLE05201016", label: "Codice prodotto", confidence: 90, page: 2 }),
      candidate({ field: "consumo_luce_kwh", valueNumber: 4084, unit: "kWh", role: "actual_customer_value", evidence: "Consumi fatturati del periodo: 4084 kWh", label: "Consumi fatturati", confidence: 95 }),
      candidate({ field: "prezzo_luce_eur_kwh", valueNumber: 0.15, unit: "EUR/kWh", role: "actual_customer_value", evidence: "Costo medio unitario materia energia: 0,15 EUR/kWh", label: "Costo medio unitario materia energia", confidence: 90, page: 2 }),
    ],
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

async function runVisual(t) {
  const filePath = await withFixture(t);
  return applyControlledPdfAiFallback(filePath, {
    filename: "sorgenia 2.pdf",
    normalized: baseUnknown(),
    env,
    apiKey: "test-key",
    transport: async () => ({ id: "resp_step8_8", output_text: JSON.stringify(visualOutput()) }),
  });
}

test("i dati visuali validi restano da verificare in field_status, readiness e completezza", async (t) => {
  const result = await runVisual(t);

  assert.equal(PDF_AI_FALLBACK_PIPELINE_VERSION, "v106.8.1-timeout-recovery-1");
  for (const field of ["fornitore", "customer_type", "intestatario", "codice_fiscale", "codice_cliente", "indirizzo_fornitura_luce", "pod", "potenza_impegnata_kw", "potenza_disponibile_kw", "nome_offerta_luce"]) {
    assert.equal(result.field_status[field].status, "da_verificare", field);
    assert.equal(result.field_status[field].reason, "ai_visuale_da_confermare", field);
  }
  assert.equal(result.readiness.dati_bolletta.luce.status, "da_verificare");
  assert.equal(result.readiness.attivazione.luce.status, "da_verificare");
  assert.equal(result.readiness.confronto.luce.status, "incompleto");
  assert.ok(result.completeness.counts.da_verificare >= 10);
  assert.ok(result.completeness.verified_score < result.completeness.score);
  assert.equal(result.completeness.validation_version, "v106.8-ai-review-status-1");
});

test("i campi AI da verificare restano selezionabili solo con conferma esplicita", async (t) => {
  const result = await runVisual(t);
  const review = new Map(result.data_contract.autofill_plan.review_fields.map((row) => [row.source_field, row]));

  assert.equal(PDF_AUTOFILL_POLICY_VERSION, "1.3.0");
  assert.equal(result.data_contract.autofill_plan.policy_version, "1.3.0");
  assert.equal(result.data_contract.autofill_plan.safe_fields.length, 0);
  for (const field of ["fornitore_luce", "intestatario", "codice_fiscale", "codice_cliente_luce", "indirizzo_fornitura_luce", "pod", "potenza_impegnata_kw"]) {
    assert.equal(review.get(field)?.requires_explicit_selection, true, field);
    assert.equal(result.data_contract.fields[field].status, "da_verificare", field);
    assert.equal(result.data_contract.fields[field].review_required, true, field);
  }
});

test("gli alias luce ereditano pagina, evidenza, confidenza e metodo della lettura visuale", async (t) => {
  const result = await runVisual(t);
  const address = result.data_contract.fields.indirizzo_fornitura_luce;
  const offer = result.data_contract.fields.nome_offerta_luce;
  const customerCode = result.data_contract.fields.codice_cliente_luce;

  assert.equal(address.evidence.page, 1);
  assert.match(address.evidence.snippet, /VICOLO SANTA CROCE/i);
  assert.equal(address.provenance.confidence, 95);
  assert.equal(address.provenance.method, "openai_visual_semantic_alias");
  assert.equal(offer.evidence.page, 2);
  assert.match(offer.evidence.snippet, /Soluzione Luce Flexi/);
  assert.equal(offer.provenance.confidence, 90);
  assert.equal(customerCode.evidence.page, 1);
  assert.match(customerCode.evidence.snippet, /4615991/);
});

test("il codice prodotto del fornitore resta distinto dal codice offerta ufficiale", async (t) => {
  const result = await runVisual(t);

  assert.equal(result.codice_offerta_luce ?? null, null);
  assert.equal(result.codice_prodotto_fornitore_luce, "SLFLE05201016");
  assert.equal(result.data_contract.supplies.luce.offer.code, null);
  assert.equal(result.data_contract.supplies.luce.offer.provider_product_code, "SLFLE05201016");
  assert.equal(result.data_contract.fields.codice_prodotto_fornitore_luce.status, "da_verificare");
  assert.equal(result.data_contract.fields.codice_prodotto_fornitore_luce.autofill.reason, "campo_non_mappato");
  assert.equal(result.ai.rejected_fields.some((item) => item.value === "SLFLE05201016"), false);
});

test("consumo del periodo e costo medio restano esclusi dai campi di confronto", async (t) => {
  const result = await runVisual(t);

  assert.equal(result.consumo_luce_kwh ?? null, null);
  assert.equal(result.prezzo_luce_eur_kwh ?? null, null);
  assert.equal(result.data_contract.supplies.luce.annual_consumption, null);
  assert.equal(result.data_contract.supplies.luce.sales_price, null);
  assert.equal(result.ai.rejected_fields.some((item) => item.field === "consumo_luce_kwh"), true);
  assert.equal(result.ai.rejected_fields.some((item) => item.field === "prezzo_luce_eur_kwh"), true);
});

test("versioni, prompt e pannello espongono la distinzione del codice prodotto", async (t) => {
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

  assert.equal(PDF_AI_ADAPTER_VERSION, "2.4.1");
  assert.equal(PDF_CANDIDATE_CONTRACT_VERSION, "1.0.3");
  assert.equal(PDF_DATA_CONTRACT_VERSION, "1.3.0");
  assert.equal(PDF_FIELD_VALIDATION_VERSION, "v106.8-ai-review-status-1");
  assert.match(prompt, /codice_prodotto_fornitore_luce/);
  assert.match(prompt, /Do not map it to codice_offerta_luce\/gas/);

  const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const start = html.indexOf('const PDF_VISUAL_READING_PANEL_VERSION = "v106.8-review-provenance-panel-1";');
  const end = html.indexOf("function renderPdfSummary(documents, merged) {", start);
  const source = `${html.slice(start, end)}\nglobalThis.__collectVisual = collectPdfVisualReadingEntries;`;
  const context = vm.createContext({ testoHtmlSicuro(value) { return String(value ?? ""); } });
  vm.runInContext(source, context);
  const entries = context.__collectVisual({
    commodity: "luce",
    ai: {
      applied: true,
      field_meta: {
        codice_prodotto_fornitore_luce: { field: "codice_prodotto_fornitore_luce", value: "SLFLE05201016", page: 2, confidence: 90 },
      },
      rejected_fields: [],
    },
  });
  assert.equal(entries[0].label, "Codice prodotto fornitore luce");
});
