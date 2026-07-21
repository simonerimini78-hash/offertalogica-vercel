import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { buildPdfDataContract } from "../lib/pdfDataContract.js";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

function completeStatus() {
  return { status: "completo", reason: null, evidence: null };
}

function loadMergeHelpers() {
  const start = html.indexOf("function firstValue");
  const end = html.indexOf("window.azzeraPdfEModulo", start);
  assert.ok(start > 0 && end > start);
  const context = {
    risultatoPdfUtilizzabile: (doc) => Boolean(doc && !doc.error && doc.recognized !== false),
    testoHtmlSicuro: (value) => String(value ?? ""),
  };
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}\nthis.helpers = { mergePdfDocuments, renderPdfSummary, analyzePdfDocumentIsolation };`, context);
  return context.helpers;
}

function supplyDoc({ commodity, provider, code, pod, pdr }) {
  const base = {
    parser_version: "v103-safe-data-contract-step5",
    kind: "bolletta",
    commodity,
    recognized: true,
    confidence: "high",
    fornitore: provider,
    intestatario: "ROBERTO BENEVENTI",
    codice_fiscale: "BNVRRT60L19D704H",
    codice_cliente: code,
    customer_type: "privato",
    pod: pod || null,
    pdr: pdr || null,
    consumo_luce_kwh: commodity === "luce" ? 1330.3 : null,
    prezzo_luce_eur_kwh: commodity === "luce" ? 0.188041 : null,
    quota_fissa_vendita_luce_eur_anno: commodity === "luce" ? 133.32 : null,
    consumo_gas_smc: commodity === "gas" ? 171 : null,
    prezzo_gas_eur_smc: commodity === "gas" ? 0.561228 : null,
    quota_fissa_vendita_gas_eur_anno: commodity === "gas" ? 132 : null,
    indirizzo_fornitura_luce: commodity === "luce" ? "VIA BRANDO BRANDI 72, 47121 FORLI FC" : null,
    indirizzo_fornitura_gas: commodity === "gas" ? "VIA BRANDO BRANDI 72, 47121 FORLI FC" : null,
    field_status: {
      fornitore: completeStatus(),
      intestatario: completeStatus(),
      codice_fiscale: completeStatus(),
      codice_cliente: completeStatus(),
      ...(commodity === "luce" ? {
        pod: completeStatus(),
        consumo_luce_kwh: completeStatus(),
        prezzo_luce_eur_kwh: completeStatus(),
        quota_fissa_vendita_luce_eur_anno: completeStatus(),
        indirizzo_fornitura_luce: completeStatus(),
      } : {
        pdr: completeStatus(),
        consumo_gas_smc: completeStatus(),
        prezzo_gas_eur_smc: completeStatus(),
        quota_fissa_vendita_gas_eur_anno: completeStatus(),
        indirizzo_fornitura_gas: completeStatus(),
      }),
    },
  };
  return { ...base, data_contract: buildPdfDataContract(base) };
}

test("Step 5.2 mette il codice cliente dentro la singola utenza del contratto", () => {
  const luce = supplyDoc({
    commodity: "luce",
    provider: "Estra Energie",
    code: "192693025",
    pod: "IT001E51344941",
  });
  assert.equal(luce.data_contract.contract_version, "1.3.0");
  assert.equal(luce.data_contract.fields.codice_cliente_luce.normalized_value, "192693025");
  assert.equal(luce.data_contract.fields.codice_cliente_luce.autofill.allowed, true);
  assert.equal(luce.data_contract.fields.codice_cliente_gas.status, "non_applicabile");
  assert.equal(luce.data_contract.supplies.luce.customer_code, "192693025");
  assert.equal(luce.data_contract.customer.customer_codes.luce, "192693025");
});

test("Step 5.2 unisce luce e gas dello stesso cliente con codici cliente diversi", () => {
  const { mergePdfDocuments } = loadMergeHelpers();
  const merged = mergePdfDocuments([
    supplyDoc({ commodity: "luce", provider: "Estra Energie", code: "192693025", pod: "IT001E51344941" }),
    supplyDoc({ commodity: "gas", provider: "Estra Energie", code: "192695348", pdr: "03081000765318" }),
  ]);
  assert.equal(merged.merge_blocked, undefined);
  assert.equal(merged.commodity, "dual");
  assert.equal(merged.codice_cliente_luce, "192693025");
  assert.equal(merged.codice_cliente_gas, "192695348");
  assert.equal(merged.codice_cliente, undefined);
  assert.equal(merged.data_contract.customer.customer_code, null);
  assert.deepEqual(
    JSON.parse(JSON.stringify(merged.data_contract.customer.customer_codes)),
    { luce: "192693025", gas: "192695348" },
  );
  assert.equal(merged.data_contract.fields.codice_cliente.status, "non_applicabile");
  assert.equal(merged.data_contract.fields.codice_cliente.status_reason, "codici_specifici_per_utenza");
  assert.equal(merged.data_contract.fields.codice_cliente_luce.autofill.allowed, true);
  assert.equal(merged.data_contract.fields.codice_cliente_gas.autofill.allowed, true);
  assert.ok(!merged.data_contract.autofill_plan.blocked_fields.some((item) => item.source_field === "codice_cliente"));
});

test("Step 5.2 consente fornitori diversi per luce e gas dello stesso cliente", () => {
  const { mergePdfDocuments, analyzePdfDocumentIsolation } = loadMergeHelpers();
  const luce = supplyDoc({ commodity: "luce", provider: "Fornitore Luce A", code: "LUCE-1001", pod: "IT001E51344941" });
  const gas = supplyDoc({ commodity: "gas", provider: "Fornitore Gas B", code: "GAS-9002", pdr: "03081000765318" });
  const isolation = analyzePdfDocumentIsolation([luce, gas]);
  assert.equal(isolation.blocked, false);
  const merged = mergePdfDocuments([luce, gas]);
  assert.equal(merged.merge_blocked, undefined);
  assert.equal(merged.fornitore_luce, "Fornitore Luce A");
  assert.equal(merged.fornitore_gas, "Fornitore Gas B");
  assert.equal(merged.codice_cliente_luce, "LUCE-1001");
  assert.equal(merged.codice_cliente_gas, "GAS-9002");
  assert.equal(merged.pod, "IT001E51344941");
  assert.equal(merged.pdr, "03081000765318");
});

test("Step 5.2 mostra due codici cliente nel riepilogo quando sono differenti", () => {
  const { mergePdfDocuments, renderPdfSummary } = loadMergeHelpers();
  const docs = [
    { ...supplyDoc({ commodity: "luce", provider: "Estra Energie", code: "192693025", pod: "IT001E51344941" }), filename: "Bolletta-estra-luce.pdf" },
    { ...supplyDoc({ commodity: "gas", provider: "Estra Energie", code: "192695348", pdr: "03081000765318" }), filename: "Bolletta-estra-gas.pdf" },
  ];
  const summary = renderPdfSummary(docs, mergePdfDocuments(docs));
  assert.match(summary, /Codice cliente luce: 192693025/);
  assert.match(summary, /Codice cliente gas: 192695348/);
  assert.doesNotMatch(summary, /Non autocompilati automaticamente: codice cliente(?:[<,]|$)/);
});

test("Step 5.2 conserva un solo codice comune quando coincide", () => {
  const { mergePdfDocuments, renderPdfSummary } = loadMergeHelpers();
  const docs = [
    { ...supplyDoc({ commodity: "luce", provider: "Hera Comm", code: "1003507407", pod: "IT001E51379686" }), filename: "luce.pdf" },
    { ...supplyDoc({ commodity: "gas", provider: "Hera Comm", code: "1003507407", pdr: "03081000767573" }), filename: "gas.pdf" },
  ];
  const merged = mergePdfDocuments(docs);
  assert.equal(merged.codice_cliente, "1003507407");
  const summary = renderPdfSummary(docs, merged);
  assert.match(summary, /Codice cliente: 1003507407/);
  assert.doesNotMatch(summary, /Codice cliente luce:/);
  assert.doesNotMatch(summary, /Codice cliente gas:/);
});
