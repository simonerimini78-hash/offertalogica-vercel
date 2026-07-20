import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

function contractField(value, { status = "completo", allowed = true } = {}) {
  return {
    normalized_value: value,
    status,
    autofill: { allowed },
  };
}

function billData(fields) {
  return {
    kind: "bolletta",
    data_contract: { fields },
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
  let syncCount = 0;
  const context = {
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
    },
    providerValue(value) {
      return String(value || "").toLowerCase().replace(/\s+/g, "-");
    },
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
    sincronizzaConsumiNuovaOfferta() {
      syncCount += 1;
    },
    testoHtmlSicuro(value) {
      return String(value ?? "");
    },
    trackEvent() {},
    LEAD_STATE: { customerType: "privato", pdfAutofill: {} },
    window: { setTimeout() {} },
  };
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}
this.helpers = {
  pdfSafeAutofillValue,
  buildPdfAutofillSpecs,
  buildPdfAutofillPreviewRows,
  pdfAutofillMarkManualField,
  pdfAutofillClearManualFields,
  pdfAutofillValuesEqual,
  applicaRigheAutocompilazionePdf,
  aggiornaPulsanteAnteprimaPdf,
};`, context);
  return {
    ...context.helpers,
    elements,
    syncCount: () => syncCount,
  };
}

test("Step 6 contiene una vera anteprima selettiva prima della compilazione", () => {
  assert.match(html, /id="pdf-autofill-preview-backdrop"/);
  assert.match(html, /Anteprima dei dati da inserire/);
  assert.match(html, /data-pdf-autofill-index/);
  assert.match(html, /await apriAnteprimaAutocompilazionePdf\(data\)/);
  assert.match(html, /applicaDatiPdfAlModulo\(data, selectedAutofillRows\)/);
});

test("Step 6 seleziona automaticamente un campo vuoto", () => {
  const { buildPdfAutofillPreviewRows } = loadPreviewHelpers({
    "in-luce-prezzo-att": fakeElement(""),
  });
  const rows = buildPdfAutofillPreviewRows(billData({
    prezzo_luce_eur_kwh: contractField(0.188041),
  }));
  const row = rows.find((item) => item.field === "prezzo_luce_eur_kwh");
  assert.ok(row);
  assert.equal(row.status, "campo_vuoto");
  assert.equal(row.selected, true);
  assert.equal(row.manually_protected, false);
});

test("Step 6 protegge un valore inserito manualmente e differente", () => {
  const helpers = loadPreviewHelpers({
    "in-luce-prezzo-att": fakeElement("0.22"),
  });
  helpers.pdfAutofillMarkManualField("in-luce-prezzo-att");
  const rows = helpers.buildPdfAutofillPreviewRows(billData({
    prezzo_luce_eur_kwh: contractField(0.188041),
  }));
  const row = rows.find((item) => item.field === "prezzo_luce_eur_kwh");
  assert.equal(row.status, "valore_manuale_protetto");
  assert.equal(row.selected, false);
  assert.equal(row.manually_protected, true);
  assert.equal(helpers.elements["in-luce-prezzo-att"].value, "0.22");
});

test("Step 6 permette di sostituire il valore manuale soltanto con selezione esplicita", () => {
  const helpers = loadPreviewHelpers({
    "in-luce-prezzo-att": fakeElement("0.22"),
  });
  helpers.pdfAutofillMarkManualField("in-luce-prezzo-att");
  const row = helpers.buildPdfAutofillPreviewRows(billData({
    prezzo_luce_eur_kwh: contractField(0.188041),
  })).find((item) => item.field === "prezzo_luce_eur_kwh");

  helpers.applicaRigheAutocompilazionePdf([]);
  assert.equal(helpers.elements["in-luce-prezzo-att"].value, "0.22");

  row.selected = true;
  helpers.applicaRigheAutocompilazionePdf([row]);
  assert.equal(helpers.elements["in-luce-prezzo-att"].value, "0.188041");
});

test("Step 6 riconosce come equivalente una quota mensile già uguale al valore annuale", () => {
  const helpers = loadPreviewHelpers({
    "in-gas-fisso-att": fakeElement("12"),
    "in-gas-fisso-att-unita": fakeElement("mese", { tagName: "SELECT" }),
  });
  const row = helpers.buildPdfAutofillPreviewRows(billData({
    quota_fissa_vendita_gas_eur_anno: contractField(144),
  })).find((item) => item.field === "quota_fissa_vendita_gas_eur_anno");
  assert.equal(row.same_value, true);
  assert.equal(row.disabled, true);
  assert.equal(row.selected, false);
  assert.equal(row.status, "gia_presente");
});

test("Step 6 protegge anche un campo secondario svuotato manualmente", () => {
  const helpers = loadPreviewHelpers({
    "in-luce-cons-att": fakeElement("1330.3"),
    "in-luce-cons-nuov": fakeElement(""),
  });
  helpers.pdfAutofillMarkManualField("in-luce-cons-nuov");
  const row = helpers.buildPdfAutofillPreviewRows(billData({
    consumo_luce_kwh: contractField(1330.3),
  })).find((item) => item.field === "consumo_luce_kwh");
  assert.equal(row.same_value, false);
  assert.equal(row.manually_protected, true);
  assert.equal(row.selected, false);
});

test("Step 6 non propone campi parziali o vietati dal contratto", () => {
  const { buildPdfAutofillSpecs } = loadPreviewHelpers({});
  const specs = buildPdfAutofillSpecs(billData({
    prezzo_luce_eur_kwh: contractField(0.18, { status: "da_verificare", allowed: false }),
    consumo_luce_kwh: contractField(1200),
  }));
  assert.ok(specs.some((item) => item.field === "consumo_luce_kwh"));
  assert.ok(!specs.some((item) => item.field === "prezzo_luce_eur_kwh"));
});

test("Step 6 non cancella più indiscriminatamente i campi prima dell'applicazione", () => {
  const start = html.indexOf("function applicaDatiPdfAlModulo(data)");
  const end = html.indexOf("assicuraSchedeOfferte();", start);
  const source = html.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(source, /\]\.forEach\(clearField\)/);
  assert.match(source, /applicaRigheAutocompilazionePdf\(selectedRows\)/);
});

test("Step 6 consente di continuare senza modifiche", () => {
  assert.match(html, /Continua senza modifiche/);
  assert.match(html, /button\.disabled = false/);
  assert.match(html, /Nessun campo è stato modificato/);
});

test("Step 6 registra soltanto eventi manuali attendibili", () => {
  assert.match(html, /if \(!event\?\.isTrusted\) return/);
  assert.match(html, /document\.addEventListener\("input", registraModificaManualePdf, true\)/);
  assert.match(html, /document\.addEventListener\("change", registraModificaManualePdf, true\)/);
});

test("Step 6 conserva il nome esteso del fornitore nei campi business testuali", () => {
  const { buildPdfAutofillSpecs } = loadPreviewHelpers({});
  const specs = buildPdfAutofillSpecs(billData({
    fornitore_luce: contractField("Estra Energie"),
  }), "business");
  const provider = specs.find((item) => item.field === "fornitore_luce");
  assert.equal(provider.transform, null);
  assert.deepEqual([...provider.target_ids], ["business-fornitore"]);
});
