import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import { refreshControlledOcrContract } from "../lib/pdfExtractWithOcr.js";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

function ocrGasResult() {
  return {
    parser_version: "v98-test",
    page_count: 2,
    kind: "bolletta",
    commodity: "gas",
    recognized: true,
    confidence: "medium",
    needsReview: true,
    warnings: ["ocr_fallback_utilizzato", "ocr_verifica_utente_richiesta"],
    fornitore: "Unoenergy",
    customer_type: "privato",
    consumo_gas_smc: 120,
    prezzo_gas_eur_smc: 0.6311892,
    quota_fissa_vendita_gas_eur_anno: 67.32,
    pdr: "03081000752041",
    intestatario: "BENEVENTI ROBERTA",
    codice_cliente: "10095846",
    codice_fiscale: "BNVRRT60L59D704L",
    indirizzo_fornitura: "VIA DECIO RAGGI 195 - 47121 FORLI FC",
    indirizzo_fornitura_gas: "VIA DECIO RAGGI 195 - 47121 FORLI FC",
    tipo_prezzo_gas: "variabile",
    indice_riferimento_gas: "PSV",
    diagnostics: [
      { field: "fornitore", value: "Unoenergy", status: "review", confidence: "medium", method: "ocr_then_text_pattern" },
      { field: "consumo_gas_smc", value: 120, status: "review", confidence: "medium", method: "ocr_then_text_pattern" },
      { field: "prezzo_gas_eur_smc", value: 0.6311892, status: "review", confidence: "medium", method: "ocr_then_text_pattern" },
      { field: "quota_fissa_vendita_gas_eur_anno", value: 67.32, status: "review", confidence: "medium", method: "ocr_then_derived" },
    ],
    ocr: {
      applied: true,
      pipeline_version: "v105.6-ocr-autofill-preview-1",
      filled_fields: [
        "fornitore",
        "customer_type",
        "consumo_gas_smc",
        "prezzo_gas_eur_smc",
        "quota_fissa_vendita_gas_eur_anno",
        "pdr",
        "intestatario",
        "codice_cliente",
        "codice_fiscale",
        "indirizzo_fornitura",
        "indirizzo_fornitura_gas",
        "tipo_prezzo_gas",
        "indice_riferimento_gas",
      ],
    },
  };
}

function fakeElement(value = "", options = {}) {
  return {
    value: String(value),
    tagName: options.tagName || "INPUT",
    options: options.options || [],
  };
}

function loadPreviewHelpers(initialElements = {}) {
  const start = html.indexOf("function pdfContractFieldEntry");
  const end = html.indexOf("function rebuildMergedPdfAutofillPlan", start);
  assert.ok(start > 0 && end > start);
  const elements = { ...initialElements };
  const context = {
    document: { getElementById: (id) => elements[id] || null },
    providerValue: (value) => String(value || "").toLowerCase(),
    setField(id, value) {
      if (!elements[id]) elements[id] = fakeElement();
      elements[id].value = String(value);
    },
    impostaQuotaFissaAnnua(inputId, unitId, value) {
      if (!elements[inputId]) elements[inputId] = fakeElement();
      if (!elements[unitId]) elements[unitId] = fakeElement();
      elements[inputId].value = String(value);
      elements[unitId].value = "anno";
    },
    sincronizzaConsumiNuovaOfferta() {},
    testoHtmlSicuro: (value) => String(value ?? ""),
    trackEvent() {},
    LEAD_STATE: { customerType: "privato", pdfAutofill: {} },
    window: { setTimeout() {} },
  };
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}
this.helpers = {
  pdfSafeAutofillValue,
  pdfPreviewAutofillEntry,
  buildPdfAutofillSpecs,
  buildPdfAutofillPreviewRows,
  applicaRigheAutocompilazionePdf,
};`, context);
  return { ...context.helpers, elements };
}


function loadMergeHelper() {
  const start = html.indexOf("function pdfContractFieldEntry");
  const end = html.indexOf("function formatPdfContractDate", start);
  assert.ok(start > 0 && end > start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}
this.mergePdfDataContract = mergePdfDataContract;`, context);
  return context.mergePdfDataContract;
}

function ocrLightResult() {
  return {
    parser_version: "v98-test",
    page_count: 2,
    kind: "bolletta",
    commodity: "luce",
    recognized: true,
    confidence: "medium",
    needsReview: true,
    warnings: ["ocr_fallback_utilizzato", "ocr_verifica_utente_richiesta"],
    fornitore: "Unoenergy",
    customer_type: "privato",
    consumo_luce_kwh: 573,
    prezzo_luce_eur_kwh: 0.17536,
    quota_fissa_vendita_luce_eur_anno: 66.6,
    potenza_impegnata_kw: 3,
    pod: "IT001E48606003",
    intestatario: "BENEVENTI ROBERTA",
    codice_cliente: "10095846",
    codice_fiscale: "BNVRRT60L59D704L",
    indirizzo_fornitura: "VIA DECIO RAGGI 195 - 47121 FORLI FC",
    indirizzo_fornitura_luce: "VIA DECIO RAGGI 195 - 47121 FORLI FC",
    tipo_prezzo_luce: "variabile",
    indice_riferimento_luce: "PUN",
    diagnostics: [],
    ocr: {
      applied: true,
      pipeline_version: "v105.5-ocr-customer-code-reconciliation-1",
      filled_fields: [
        "fornitore", "customer_type", "consumo_luce_kwh", "prezzo_luce_eur_kwh",
        "quota_fissa_vendita_luce_eur_anno", "potenza_impegnata_kw", "pod",
        "intestatario", "codice_cliente", "codice_fiscale", "indirizzo_fornitura",
        "indirizzo_fornitura_luce", "tipo_prezzo_luce", "indice_riferimento_luce",
      ],
    },
  };
}
test("Step 7.6 rigenera il contratto dopo il merge OCR", () => {
  const refreshed = refreshControlledOcrContract(ocrGasResult());
  const price = refreshed.data_contract.fields.prezzo_gas_eur_smc;
  const provider = refreshed.data_contract.fields.fornitore_gas;

  assert.equal(refreshed.data_contract.parser.mode, "deterministic_with_controlled_ocr");
  assert.equal(price.normalized_value, 0.6311892);
  assert.equal(price.status, "completo");
  assert.equal(price.provenance.origin, "pdf_image_ocr");
  assert.equal(price.review_required, true);
  assert.equal(price.autofill.allowed, false);
  assert.equal(price.autofill.review_selectable, true);
  assert.equal(price.autofill.requires_explicit_selection, true);
  assert.equal(provider.provenance.origin, "pdf_image_ocr");
  assert.ok(refreshed.data_contract.autofill_plan.review_fields.some((item) => item.source_field === "prezzo_gas_eur_smc"));
  assert.ok(!refreshed.data_contract.autofill_plan.safe_fields.some((item) => item.source_field === "prezzo_gas_eur_smc"));
});

test("Step 7.6 mostra i valori OCR nell'anteprima ma li lascia deselezionati", () => {
  const refreshed = refreshControlledOcrContract(ocrGasResult());
  const helpers = loadPreviewHelpers({
    "nome-fornitore-gas-att": fakeElement(""),
    "in-gas-cons-att": fakeElement(""),
    "in-gas-cons-nuov": fakeElement(""),
    "in-gas-prezzo-att": fakeElement(""),
    "in-gas-fisso-att": fakeElement(""),
    "in-gas-fisso-att-unita": fakeElement("mese", { tagName: "SELECT" }),
    "master-luce-tipo": fakeElement(""),
  });
  const rows = helpers.buildPdfAutofillPreviewRows(refreshed);
  const consumption = rows.find((row) => row.field === "consumo_gas_smc");
  const price = rows.find((row) => row.field === "prezzo_gas_eur_smc");
  const fixed = rows.find((row) => row.field === "quota_fissa_vendita_gas_eur_anno");

  assert.ok(consumption);
  assert.ok(price);
  assert.ok(fixed);
  assert.equal(consumption.status, "ocr_da_verificare");
  assert.equal(consumption.review_required, true);
  assert.equal(consumption.selected, false);
  assert.equal(price.selected, false);
  assert.equal(fixed.selected, false);

  consumption.selected = true;
  price.selected = true;
  fixed.selected = true;
  helpers.applicaRigheAutocompilazionePdf([consumption, price, fixed]);
  assert.equal(helpers.elements["in-gas-cons-att"].value, "120");
  assert.equal(helpers.elements["in-gas-prezzo-att"].value, "0.6311892");
  assert.equal(helpers.elements["in-gas-fisso-att"].value, "67.32");
  assert.equal(helpers.elements["in-gas-fisso-att-unita"].value, "anno");
});

test("Step 7.6 mantiene invariata la preselezione dei campi deterministici completi", () => {
  const helpers = loadPreviewHelpers({ "in-luce-prezzo-att": fakeElement("") });
  const data = {
    kind: "bolletta",
    data_contract: {
      fields: {
        prezzo_luce_eur_kwh: {
          normalized_value: 0.188041,
          status: "completo",
          provenance: { origin: "pdf_native_text" },
          autofill: { allowed: true, review_selectable: false },
        },
      },
    },
  };
  const row = helpers.buildPdfAutofillPreviewRows(data).find((item) => item.field === "prezzo_luce_eur_kwh");
  assert.ok(row);
  assert.equal(row.review_required, false);
  assert.equal(row.selected, true);
  assert.equal(row.status, "campo_vuoto");
});

test("Step 7.6 comunica chiaramente la selezione esplicita OCR", () => {
  assert.match(html, /OCR da verificare e selezionare/);
  assert.match(html, /I dati OCR sono sempre deselezionati all’apertura/);
  assert.match(html, /entry\.autofill\?\.review_selectable/);
  assert.match(html, /ocrReviewCount/);
});


test("Step 7.6 mantiene selezionabili luce e gas OCR dopo l'unione dei documenti", () => {
  const light = refreshControlledOcrContract(ocrLightResult());
  const gas = refreshControlledOcrContract(ocrGasResult());
  const mergePdfDataContract = loadMergeHelper();
  const mergedContract = mergePdfDataContract(light.data_contract, gas.data_contract);
  const helpers = loadPreviewHelpers({
    "nome-fornitore-att": fakeElement(""),
    "nome-fornitore-gas-att": fakeElement(""),
    "master-luce-potenza": fakeElement(""),
    "master-luce-tipo": fakeElement(""),
    "in-luce-cons-att": fakeElement(""),
    "in-luce-cons-nuov": fakeElement(""),
    "in-luce-prezzo-att": fakeElement(""),
    "in-luce-fisso-att": fakeElement(""),
    "in-luce-fisso-att-unita": fakeElement("mese", { tagName: "SELECT" }),
    "in-gas-cons-att": fakeElement(""),
    "in-gas-cons-nuov": fakeElement(""),
    "in-gas-prezzo-att": fakeElement(""),
    "in-gas-fisso-att": fakeElement(""),
    "in-gas-fisso-att-unita": fakeElement("mese", { tagName: "SELECT" }),
  });
  const rows = helpers.buildPdfAutofillPreviewRows({
    kind: "bolletta",
    commodity: "dual",
    data_contract: mergedContract,
  });
  for (const field of [
    "consumo_luce_kwh", "prezzo_luce_eur_kwh", "quota_fissa_vendita_luce_eur_anno",
    "consumo_gas_smc", "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno",
  ]) {
    const row = rows.find((item) => item.field === field);
    assert.ok(row, `campo mancante: ${field}`);
    assert.equal(row.review_required, true);
    assert.equal(row.selected, false);
  }
  assert.ok(mergedContract.autofill_plan.review_target_count > 0);
  assert.equal(mergedContract.fields.prezzo_luce_eur_kwh.provenance.origin, "pdf_image_ocr");
  assert.equal(mergedContract.fields.prezzo_gas_eur_smc.provenance.origin, "pdf_image_ocr");
});
