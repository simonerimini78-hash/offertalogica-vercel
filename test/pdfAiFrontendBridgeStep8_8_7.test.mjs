import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import {
  STEP_8_8_7_MARKER,
  patchHtml,
} from "../tools/apply-step8_8_7.mjs";
import { verifyHtml } from "../tools/verify-step8_8_7.mjs";

function fixtureHtml() {
  return `<!doctype html>
<html lang="it"><body>
<div id="pdf-autofill-preview-backdrop"></div>
<div id="pdf-autofill-preview-copy"></div>
<div id="pdf-autofill-preview-list"></div>
<button id="pdf-autofill-apply"></button>
<script>
var LEAD_STATE = { pdfAutofill: {}, customerType: "privato" };
var PDF_AUTOFILL_PREVIEW_ROWS = [];
const elements = new Map();
var document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, { id, value: "", textContent: "", style: {}, focus() {} });
    return elements.get(id);
  }
};
function risultatoPdfUtilizzabile(doc) { return Boolean(doc && !doc.error && doc.recognized !== false); }
function mergePdfDocuments(documents) {
  const validDocuments = documents.filter(risultatoPdfUtilizzabile);
  const merged = {};
  validDocuments.forEach((doc) => {
    merged.kind = doc.kind;
    if (doc.commodity === "luce" || doc.commodity === "dual" || doc.consumo_luce_kwh || doc.pod) {
      merged.fornitore_luce = doc.fornitore_luce || doc.fornitore || merged.fornitore_luce;
      merged.consumo_luce_kwh = doc.consumo_luce_kwh || merged.consumo_luce_kwh;
    }
    if (doc.commodity === "gas" || doc.commodity === "dual" || doc.consumo_gas_smc || doc.pdr) {
      merged.fornitore_gas = doc.fornitore_gas || doc.fornitore || merged.fornitore_gas;
      merged.consumo_gas_smc = doc.consumo_gas_smc || merged.consumo_gas_smc;
    }
    merged.data_contract = doc.data_contract || merged.data_contract;
  });
  const hasLuce = Boolean(merged.consumo_luce_kwh || merged.pod);
  const hasGas = Boolean(merged.consumo_gas_smc || merged.pdr);
  merged.commodity = hasLuce && hasGas ? "dual" : hasGas ? "gas" : hasLuce ? "luce" : "unknown";
  return merged;
}
function pdfSafeAutofillValue(data, field) {
  const entry = data?.data_contract?.fields?.[field];
  if (!entry?.autofill?.allowed || entry.status !== "completo") return undefined;
  return entry.normalized_value;
}
function buildPdfAutofillSpecs(data) {
  const specs = [];
  const add = (field, label, targets) => {
    const value = pdfSafeAutofillValue(data, field);
    if (value === undefined) return;
    specs.push({ id: field, field, label, value, target_ids: targets, kind: "value", compare_mode: "text", unit: null });
  };
  add("fornitore_luce", "Fornitore luce attuale", ["nome-fornitore-att"]);
  add("fornitore_gas", "Fornitore gas attuale", ["nome-fornitore-gas-att"]);
  add("consumo_luce_kwh", "Consumo annuo luce", ["in-luce-cons-att"]);
  return specs;
}
function pdfAutofillCurrentState(spec) {
  const values = spec.target_ids.map((id) => document.getElementById(id).value).filter(Boolean);
  return { has_value: values.length > 0, display: values[0] || "Campo vuoto", manually_touched: false, all_equal: false };
}
function buildPdfAutofillPreviewRows(data) {
  return buildPdfAutofillSpecs(data).map((spec, index) => {
    const current = pdfAutofillCurrentState(spec);
    return { ...spec, index, current_display: current.display, incoming_display: String(spec.value), has_current_value: current.has_value, manually_protected: false, same_value: false, selected: true, disabled: false, status: "campo_vuoto" };
  });
}
function pdfAutofillStatusLabel(status) { return status; }
function applicaRigheAutocompilazionePdf(rows) {
  rows.forEach((row) => row.target_ids.forEach((id) => { document.getElementById(id).value = String(row.value); }));
  return rows.length;
}
function apriAnteprimaAutocompilazionePdf(data) {
  PDF_AUTOFILL_PREVIEW_ROWS = buildPdfAutofillPreviewRows(data);
  return Promise.resolve(PDF_AUTOFILL_PREVIEW_ROWS);
}
</script>
</body></html>`;
}

function contextFromPatchedHtml(html) {
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  const context = vm.createContext({ console, globalThis: null });
  context.globalThis = context;
  vm.runInContext(scripts.join("\n"), context, { timeout: 2_000 });
  return context;
}

function reviewEntry(value, source = "pdf_visual_ai") {
  return {
    normalized_value: value,
    status: "da_verificare",
    review_required: true,
    provenance: { source },
    autofill: {
      allowed: false,
      review_selectable: true,
      requires_explicit_selection: true,
    },
  };
}

test("inserisce il bridge una sola volta", () => {
  const first = patchHtml(fixtureHtml(), "public/index.html");
  assert.equal(first.changed, true);
  assert.match(first.html, new RegExp(STEP_8_8_7_MARKER));

  const second = patchHtml(first.html, "public/index.html");
  assert.equal(second.changed, false);
  assert.equal((second.html.match(new RegExp(STEP_8_8_7_MARKER, "g")) || []).length, 1);
});

test("mantiene dual un documento visuale anche se il gas non ha campi economici ammessi", () => {
  const { html } = patchHtml(fixtureHtml());
  const context = contextFromPatchedHtml(html);
  const dataContract = {
    supplies: { luce: {}, gas: {} },
    fields: {},
    autofill_plan: { review_fields: [] },
  };
  const result = context.mergePdfDocuments([{
    kind: "bolletta",
    commodity: "dual",
    recognized: true,
    fornitore_luce: "FORNITORE TEST",
    fornitore_gas: "FORNITORE TEST",
    consumo_luce_kwh: 732.8,
    data_contract: dataContract,
  }]);
  assert.equal(result.commodity, "dual");
  assert.deepEqual(result.autofill_plan, dataContract.autofill_plan);
});

test("rende selezionabili solo i campi IA/OCR marcati da verificare", () => {
  const { html } = patchHtml(fixtureHtml());
  const context = contextFromPatchedHtml(html);
  const data = {
    kind: "bolletta",
    data_contract: {
      fields: {
        fornitore_luce: reviewEntry("FORNITORE TEST"),
        consumo_luce_kwh: reviewEntry(732.8),
        prezzo_luce_eur_kwh: {
          normalized_value: 0.225209,
          status: "mancante",
          provenance: { source: "pdf_visual_ai" },
          autofill: { allowed: false, review_selectable: false, reason: "average_unit_cost_not_contract_price" },
        },
        consumo_gas_smc: {
          normalized_value: 177.68,
          status: "mancante",
          provenance: { source: "pdf_visual_ai" },
          autofill: { allowed: false, review_selectable: false, reason: "billing_period_not_annual" },
        },
      },
    },
  };
  assert.equal(context.pdfSafeAutofillValue(data, "fornitore_luce"), "FORNITORE TEST");
  assert.equal(context.pdfSafeAutofillValue(data, "consumo_luce_kwh"), 732.8);
  assert.equal(context.pdfSafeAutofillValue(data, "prezzo_luce_eur_kwh"), undefined);
  assert.equal(context.pdfSafeAutofillValue(data, "consumo_gas_smc"), undefined);
});

test("mostra i dati di attivazione IA ma li lascia deselezionati", () => {
  const { html } = patchHtml(fixtureHtml());
  const context = contextFromPatchedHtml(html);
  const data = {
    kind: "bolletta",
    data_contract: {
      fields: {
        fornitore_luce: reviewEntry("FORNITORE TEST"),
        intestatario: reviewEntry("CLIENTE TEST"),
        codice_fiscale: reviewEntry("TSTCLN80A01H501X"),
        codice_cliente: reviewEntry("1000000000"),
        consumo_luce_kwh: reviewEntry(732.8),
      },
    },
  };
  const rows = context.buildPdfAutofillPreviewRows(data, "privato");
  const holder = rows.find((row) => row.field === "intestatario");
  const taxId = rows.find((row) => row.field === "codice_fiscale");
  const consumption = rows.find((row) => row.field === "consumo_luce_kwh");
  assert.equal(holder.kind, "activation_review");
  assert.equal(taxId.kind, "activation_review");
  assert.equal(holder.selected, false);
  assert.equal(taxId.selected, false);
  assert.equal(consumption.selected, false);
  assert.equal(holder.status, "dato_attivazione_da_confermare");
});

test("applica i campi modulo selezionati e registra separatamente quelli di attivazione", () => {
  const { html } = patchHtml(fixtureHtml());
  const context = contextFromPatchedHtml(html);
  const count = context.applicaRigheAutocompilazionePdf([
    { field: "fornitore_luce", kind: "value", value: "FORNITORE TEST", target_ids: ["nome-fornitore-att"] },
    { field: "intestatario", kind: "activation_review", value: "CLIENTE TEST", target_ids: [] },
  ]);
  assert.equal(count, 2);
  assert.equal(context.document.getElementById("nome-fornitore-att").value, "FORNITORE TEST");
  assert.equal(context.LEAD_STATE.pdfAutofill.approvedActivationFields.intestatario, "CLIENTE TEST");
});

test("rifiuta un HTML che non contiene la pipeline PDF prevista", () => {
  assert.throws(
    () => patchHtml("<html><script>console.log('x')</script></html>", "public/index.html"),
    /struttura frontend PDF non riconosciuta/,
  );
});


test("la verifica finale compila il blocco iniettato e controlla le protezioni", () => {
  const { html } = patchHtml(fixtureHtml(), "public/index.html");
  const report = verifyHtml(html, "public/index.html");
  assert.equal(report.markerCount, 1);
  assert.equal(report.preservesDualEvidence, true);
  assert.equal(report.protectsExplicitSelection, true);
  assert.equal(report.keepsDiagnosticOnlyValuesBlocked, true);
});
