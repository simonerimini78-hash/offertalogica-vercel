import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

function fakeElement(value = "") {
  return { value: String(value), tagName: "INPUT", options: [] };
}

function loadHelpers(initialElements = {}) {
  const start = html.indexOf("function pdfContractFieldEntry");
  const end = html.indexOf("function formatPdfContractDate", start);
  assert.ok(start > 0 && end > start);
  const elements = { ...initialElements };
  const context = {
    document: { getElementById: (id) => elements[id] || null },
    providerValue: (value) => String(value || "").toLowerCase(),
    setField(id, value) {
      if (!elements[id]) elements[id] = fakeElement();
      elements[id].value = String(value);
    },
    impostaQuotaFissaAnnua() {},
    sincronizzaConsumiNuovaOfferta() {},
    testoHtmlSicuro: (value) => String(value ?? ""),
    trackEvent() {},
    LEAD_STATE: { customerType: "business", pdfAutofill: {} },
    window: { setTimeout() {} },
  };
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}
this.helpers = {
  pdfPreviewAutofillEntry,
  buildPdfAutofillPreviewRows,
  rebuildMergedPdfAutofillPlan,
};`, context);
  return { ...context.helpers, elements };
}

function aiReviewField(field, value, target, confidence = 95) {
  return {
    field,
    normalized_value: value,
    status: "da_verificare",
    provenance: {
      origin: "pdf_visual_ai",
      confidence,
    },
    autofill: {
      allowed: false,
      review_selectable: true,
      requires_explicit_selection: true,
      targets: [target],
      use: "activation_helper",
      reason: "ai_da_verificare_con_conferma_esplicita",
    },
  };
}

test("Step 8.8.3 mantiene selezionabili i campi AI con stato da_verificare", () => {
  const helpers = loadHelpers({
    "business-ragione": fakeElement(""),
    "business-piva": fakeElement(""),
    "business-fornitore": fakeElement(""),
    "business-potenza": fakeElement(""),
  });
  const contract = {
    fields: {
      intestatario: aiReviewField("intestatario", "Romagna Allevamenti Societa' Agricola S.S.", "business-ragione", 95),
      codice_fiscale: aiReviewField("codice_fiscale", "02525880395", "business-piva", 95),
      fornitore_luce: aiReviewField("fornitore_luce", "Sorgenia", "business-fornitore", 95),
      potenza_impegnata_kw: aiReviewField("potenza_impegnata_kw", 10, "business-potenza", 95),
    },
  };

  helpers.rebuildMergedPdfAutofillPlan(contract);
  assert.equal(contract.autofill_plan.safe_target_count, 0);
  assert.equal(contract.autofill_plan.review_target_count, 4);
  assert.deepEqual(
    Array.from(contract.autofill_plan.review_fields, (item) => item.source_field).sort(),
    ["codice_fiscale", "fornitore_luce", "intestatario", "potenza_impegnata_kw"],
  );

  const rows = helpers.buildPdfAutofillPreviewRows({
    kind: "bolletta",
    commodity: "luce",
    data_contract: contract,
  }, "business");
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.equal(row.review_required, true);
    assert.equal(row.selected, false);
    assert.equal(row.status, "ai_da_verificare");
  }
});

test("Step 8.8.3 non usa 100 come soglia artificiale di autofill", () => {
  const helpers = loadHelpers({ "business-piva": fakeElement("") });
  const entry = aiReviewField("codice_fiscale", "02525880395", "business-piva", 90);
  const selection = helpers.pdfPreviewAutofillEntry({ data_contract: { fields: { codice_fiscale: entry } } }, "codice_fiscale");
  assert.ok(selection);
  assert.equal(selection.review_required, true);
});

test("Step 8.8.3 continua a escludere campi mancanti o non selezionabili", () => {
  const helpers = loadHelpers();
  const missing = aiReviewField("codice_fiscale", null, "business-piva", 95);
  missing.status = "mancante";
  const unsupported = aiReviewField("codice_fiscale", "02525880395", "business-piva", 95);
  unsupported.autofill.review_selectable = false;
  assert.equal(helpers.pdfPreviewAutofillEntry({ data_contract: { fields: { codice_fiscale: missing } } }, "codice_fiscale"), null);
  assert.equal(helpers.pdfPreviewAutofillEntry({ data_contract: { fields: { codice_fiscale: unsupported } } }, "codice_fiscale"), null);
});

test("Step 8.8.3 applica la policy anche ai dati da verificare", () => {
  assert.match(html, /\["completo", "da_verificare"\]\.includes\(entry\.status\)/);
});
