import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { applyPdfDataContract } from "../lib/pdfDataContract.js";
import { applyPdfFieldValidation } from "../lib/pdfFieldValidation.js";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

function loadFrontendHelpers() {
  const start = html.indexOf("function firstValue");
  const end = html.indexOf("window.azzeraPdfEModulo", start);
  assert.ok(start > 0 && end > start);
  const context = {
    risultatoPdfUtilizzabile: (doc) => Boolean(
      doc && !doc.error && doc.recognized !== false && doc.kind !== "unknown" && doc.commodity !== "unknown"
    ),
    testoHtmlSicuro: (value) => String(value ?? ""),
  };
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}
this.helpers = { mergePdfDocuments, buildPdfAutofillSpecs };`, context);
  return context.helpers;
}

function extractFunction(name) {
  const asyncStart = html.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Funzione ${name} non trovata`);
  const braceStart = html.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = braceStart; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }
  throw new Error(`Fine funzione ${name} non trovata`);
}

function supplyDocument({ commodity, provider, customerCode, address, identifier, priceType, missingFixed = false, pages }) {
  const luce = commodity === "luce";
  const base = {
    parser_version: "pure-ai-native-pdf-v1.0.3",
    page_count: pages,
    kind: "bolletta",
    commodity,
    recognized: true,
    confidence: "medium",
    needsReview: true,
    customer_type: "privato",
    intestatario: "MARIO ROSSI",
    codice_fiscale: "RSSMRA80A01H501U",
    fornitore: provider,
    fornitore_luce: luce ? provider : null,
    fornitore_gas: luce ? null : provider,
    codice_cliente: customerCode,
    codice_cliente_luce: luce ? customerCode : null,
    codice_cliente_gas: luce ? null : customerCode,
    indirizzo_fornitura: address,
    indirizzo_fornitura_luce: luce ? address : null,
    indirizzo_fornitura_gas: luce ? null : address,
    pod: luce ? identifier : null,
    pdr: luce ? null : identifier,
    potenza_impegnata_kw: luce ? 3 : null,
    consumo_luce_kwh: luce ? 1628.91 : null,
    prezzo_luce_eur_kwh: luce ? 0.152429 : null,
    quota_fissa_vendita_luce_eur_anno: luce && !missingFixed ? 84 : null,
    consumo_gas_smc: luce ? null : 1653.86,
    prezzo_gas_eur_smc: luce ? null : 0.565095,
    quota_fissa_vendita_gas_eur_anno: luce ? null : 240,
    nome_offerta_luce: luce ? "Offerta Luce" : null,
    nome_offerta_gas: luce ? null : "Offerta Gas",
    codice_offerta_luce: luce ? "COD-LUCE" : null,
    codice_offerta_gas: luce ? null : "COD-GAS",
    tipo_prezzo_luce: luce ? priceType : null,
    tipo_prezzo_gas: luce ? null : priceType,
    indice_riferimento_luce: luce && priceType === "variabile" ? "PUN" : null,
    indice_riferimento_gas: !luce && priceType === "variabile" ? "PSV" : null,
    diagnostics: [],
    warnings: ["lettura_solo_ia_da_verificare"],
    ocr: { attempted: false, applied: false, reason: "ai_only_mode" },
    ai: {
      applied: true,
      reader_version: "pure-ai-native-pdf-v1.0.3",
      model: "gpt-4.1-2025-04-14",
      page_count: pages,
    },
  };
  return applyPdfDataContract(applyPdfFieldValidation(base));
}

function buildPair({ gasPriceType = "variabile" } = {}) {
  return {
    luce: supplyDocument({
      commodity: "luce",
      provider: "HERA COMM S.p.A.",
      customerCode: "1012697711",
      address: "VIA MULINO LOC. MONTEVEGLIO 19, 40053 VALSAMOGGIA BO",
      identifier: "IT001E49962531",
      priceType: "variabile",
      missingFixed: true,
      pages: 12,
    }),
    gas: supplyDocument({
      commodity: "gas",
      provider: "Edison Energia S.p.A.",
      customerCode: "1001133382",
      address: "VIA MULINO 19 - 40050 VALSAMOGGIA BO",
      identifier: "03081000466501",
      priceType: gasPriceType,
      pages: 11,
    }),
  };
}

function stableProjection(merged) {
  return {
    commodity: merged.commodity,
    fornitore: merged.fornitore ?? null,
    fornitore_luce: merged.fornitore_luce,
    fornitore_gas: merged.fornitore_gas,
    codice_cliente: merged.codice_cliente ?? null,
    codice_cliente_luce: merged.codice_cliente_luce,
    codice_cliente_gas: merged.codice_cliente_gas,
    indirizzo_fornitura: merged.indirizzo_fornitura ?? null,
    indirizzo_fornitura_luce: merged.indirizzo_fornitura_luce,
    indirizzo_fornitura_gas: merged.indirizzo_fornitura_gas,
    pod: merged.pod,
    pdr: merged.pdr,
    field_status: merged.field_status,
    readiness: merged.readiness,
    completeness: merged.completeness,
    parser: merged.data_contract?.parser,
    supplies: merged.data_contract?.supplies,
    customer: merged.data_contract?.customer,
  };
}

test("merge multi-fornitore: il risultato non dipende dall'ordine dei PDF", () => {
  const { mergePdfDocuments } = loadFrontendHelpers();
  const { luce, gas } = buildPair();
  const luceGas = mergePdfDocuments([luce, gas]);
  const gasLuce = mergePdfDocuments([gas, luce]);

  assert.deepEqual(
    JSON.parse(JSON.stringify(stableProjection(luceGas))),
    JSON.parse(JSON.stringify(stableProjection(gasLuce))),
  );
  assert.equal(luceGas.commodity, "dual");
  assert.equal(luceGas.merge_blocked, undefined);
  assert.equal(luceGas.fornitore, undefined);
  assert.equal(luceGas.indirizzo_fornitura, undefined);
  assert.equal(luceGas.fornitore_luce, "HERA COMM S.p.A.");
  assert.equal(luceGas.fornitore_gas, "Edison Energia S.p.A.");
  assert.equal(luceGas.codice_cliente_luce, "1012697711");
  assert.equal(luceGas.codice_cliente_gas, "1001133382");
  assert.equal(luceGas.field_status.consumo_luce_kwh.status, "completo");
  assert.equal(luceGas.field_status.consumo_gas_smc.status, "completo");
  assert.equal(luceGas.field_status.quota_fissa_vendita_luce_eur_anno.status, "mancante");
  assert.equal(luceGas.field_status.quota_fissa_vendita_gas_eur_anno.status, "completo");
  assert.equal(luceGas.data_contract.parser.document_count, 2);
  assert.equal(luceGas.data_contract.parser.page_count, 23);
  assert.ok(luceGas.data_contract.readiness.confronto.luce);
  assert.ok(luceGas.data_contract.readiness.confronto.gas);
  assert.equal(luceGas.data_contract.fields.fornitore.status_reason, "fornitori_specifici_per_utenza");
});

test("merge multi-fornitore: l'anteprima conserva i valori nella propria commodity", () => {
  const { mergePdfDocuments, buildPdfAutofillSpecs } = loadFrontendHelpers();
  const { luce, gas } = buildPair();
  const merged = mergePdfDocuments([gas, luce]);
  const specs = buildPdfAutofillSpecs(merged, "privato");
  const byField = Object.fromEntries(specs.map((item) => [item.field, item]));

  assert.equal(byField.fornitore_luce.value, "HERA COMM S.p.A.");
  assert.equal(byField.fornitore_gas.value, "Edison Energia S.p.A.");
  assert.equal(byField.consumo_luce_kwh.value, 1628.91);
  assert.equal(byField.consumo_gas_smc.value, 1653.86);
  assert.equal(byField.prezzo_luce_eur_kwh.value, 0.152429);
  assert.equal(byField.prezzo_gas_eur_smc.value, 0.565095);
  assert.equal(byField.quota_fissa_vendita_luce_eur_anno, undefined);
  assert.equal(byField.quota_fissa_vendita_gas_eur_anno.value, 240);
  const priceType = specs.filter((item) => item.target_ids.includes("master-luce-tipo"));
  assert.equal(priceType.length, 1);
  assert.equal(priceType[0].value, "variabile");
  assert.equal(priceType[0].label, "Tipo prezzo luce e gas");
});

test("merge multi-fornitore: tipi prezzo diversi non vengono scelti dal frontend", () => {
  const { mergePdfDocuments, buildPdfAutofillSpecs } = loadFrontendHelpers();
  const { luce, gas } = buildPair({ gasPriceType: "fisso" });
  const merged = mergePdfDocuments([luce, gas]);
  const specs = buildPdfAutofillSpecs(merged, "privato");

  assert.equal(specs.some((item) => item.target_ids.includes("master-luce-tipo")), false);
  const blocked = merged.data_contract.autofill_plan.blocked_fields
    .filter((item) => item.reason === "target_condiviso_con_valori_in_conflitto");
  assert.ok(blocked.some((item) => item.source_field === "tipo_prezzo_luce"));
  assert.ok(blocked.some((item) => item.source_field === "tipo_prezzo_gas"));
});

test("assistente attivazione: indirizzi diversi restano separati", () => {
  const { mergePdfDocuments } = loadFrontendHelpers();
  const { luce, gas } = buildPair();
  const merged = mergePdfDocuments([luce, gas]);
  const source = [
    extractFunction("firstValue"),
    extractFunction("valoreDatoAttivazione"),
    extractFunction("valoreConUnitaAttivazione"),
    extractFunction("campiAssistenteAttivazione"),
  ].join("\n");
  const context = {
    LEAD_STATE: { pdfData: merged, customerType: "privato" },
    tipoFornituraPerCalcolo: () => "separate",
    document: { getElementById: () => ({ value: "" }) },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.campi = campiAssistenteAttivazione;`, context);
  const fields = context.campi();
  const values = Object.fromEntries(fields.map((field) => [field.label, field.value]));

  assert.equal(values["Indirizzo fornitura"], undefined);
  assert.equal(values["Indirizzo fornitura luce"], "VIA MULINO LOC. MONTEVEGLIO 19, 40053 VALSAMOGGIA BO");
  assert.equal(values["Indirizzo fornitura gas"], "VIA MULINO 19 - 40050 VALSAMOGGIA BO");
});

test("merge multi-fornitore: il piano contiene un solo target quando il valore comune coincide", () => {
  const { mergePdfDocuments } = loadFrontendHelpers();
  const { luce, gas } = buildPair();
  const merged = mergePdfDocuments([gas, luce]);
  const sharedTargets = merged.data_contract.autofill_plan.safe_fields
    .filter((item) => item.target === "master-luce-tipo");
  assert.equal(sharedTargets.length, 1);
  assert.equal(sharedTargets[0].value, "variabile");
});

test("merge dual stesso fornitore: conserva i campi comuni soltanto quando coincidono", () => {
  const { mergePdfDocuments } = loadFrontendHelpers();
  const luce = supplyDocument({
    commodity: "luce",
    provider: "Fornitore Comune",
    customerCode: "CLIENTE-COMUNE",
    address: "VIA COMUNE 1, ROMA",
    identifier: "IT001E00000001",
    priceType: "variabile",
    pages: 3,
  });
  const gas = supplyDocument({
    commodity: "gas",
    provider: "Fornitore Comune",
    customerCode: "CLIENTE-COMUNE",
    address: "VIA COMUNE 1, ROMA",
    identifier: "00000000000001",
    priceType: "variabile",
    pages: 4,
  });
  const merged = mergePdfDocuments([gas, luce]);

  assert.equal(merged.fornitore, "Fornitore Comune");
  assert.equal(merged.indirizzo_fornitura, "VIA COMUNE 1, ROMA");
  assert.equal(merged.codice_cliente, "CLIENTE-COMUNE");
});

test("ambito PDF: due fornitori letti diversi producono forniture separate senza scelta arbitraria", async () => {
  const source = extractFunction("confermaAmbitoPdf");
  const context = {
    LEAD_STATE: { gasDecision: "", electricityDecision: "" },
    ambitoConfrontoAttivo: () => "dual",
    apriDecisionePdf: async () => { throw new Error("dialogo_non_atteso"); },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.conferma = confermaAmbitoPdf;`, context);
  const scope = await context.conferma({
    kind: "bolletta",
    commodity: "dual",
    fornitore_luce: "HERA COMM S.p.A.",
    fornitore_gas: "Edison Energia S.p.A.",
  });
  assert.equal(scope, "separate");
  assert.equal(context.LEAD_STATE.electricityDecision, "detected");
  assert.equal(context.LEAD_STATE.gasDecision, "detected");
});
