import test from "node:test";
import assert from "node:assert/strict";
import {
  PDF_DATA_CONTRACT_VERSION,
  buildPdfDataContract,
  applyPdfDataContract,
} from "../lib/pdfDataContract.js";

function completeStatus() {
  return { status: "completo", reason: null, evidence: null };
}

function baseDual() {
  return {
    parser_version: "fixture-contract-v1",
    page_count: 4,
    textExtracted: 9000,
    kind: "bolletta",
    commodity: "dual",
    recognized: true,
    confidence: "high",
    needsReview: false,
    fornitore: "Hera Comm",
    customer_type: "privato",
    intestatario: "FILIPPO PAGLIAI",
    codice_fiscale: "PGLFPP81M07D704Q",
    codice_cliente: "1003507407",
    consumo_luce_kwh: 1008,
    prezzo_luce_eur_kwh: 0.190954,
    quota_fissa_vendita_luce_eur_anno: 145.2,
    potenza_impegnata_kw: 3,
    potenza_disponibile_kw: 3.3,
    pod: "IT001E51379686",
    indirizzo_fornitura_luce: "VIALE FULCIERI PAULUCCI CALBOLI 138 47121 FORLI FC",
    nome_offerta_luce: "Hera Hybrid Casa EE_L_B - V21",
    codice_offerta_luce: "000415ETVML01XX000HHYXECXMXBXV21",
    tipo_prezzo_luce: "ibrido",
    indice_riferimento_luce: "PUN Index GME",
    consumo_gas_smc: 851,
    prezzo_gas_eur_smc: 0.498828,
    quota_fissa_vendita_gas_eur_anno: 144,
    pdr: "03081000767573",
    indirizzo_fornitura_gas: "VIALE FULCIERI PAULUCCI CALBOLI 138 47121 FORLI FC",
    nome_offerta_gas: "Hera Hybrid Casa Gas_L_B - V21",
    codice_offerta_gas: "000415GTVML01XX000HHYXGCXMXBXV21",
    tipo_prezzo_gas: "ibrido",
    indice_riferimento_gas: "PSV day ahead",
    field_status: Object.fromEntries([
      "fornitore", "customer_type", "intestatario", "codice_fiscale", "codice_cliente",
      "consumo_luce_kwh", "prezzo_luce_eur_kwh", "quota_fissa_vendita_luce_eur_anno",
      "potenza_impegnata_kw", "potenza_disponibile_kw", "pod", "indirizzo_fornitura_luce",
      "nome_offerta_luce", "codice_offerta_luce", "tipo_prezzo_luce", "indice_riferimento_luce",
      "consumo_gas_smc", "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno",
      "pdr", "indirizzo_fornitura_gas", "nome_offerta_gas", "codice_offerta_gas",
      "tipo_prezzo_gas", "indice_riferimento_gas",
    ].map((field) => [field, completeStatus()])),
    readiness: {
      confronto: { luce: { status: "completo" }, gas: { status: "completo" } },
      dati_bolletta: { luce: { status: "completo" }, gas: { status: "completo" } },
      attivazione: { luce: { status: "incompleto" }, gas: { status: "incompleto" } },
    },
    completeness: { score: 95 },
    diagnostics: [{
      field: "consumo_luce_kwh",
      label: "Consumo annuo luce",
      value: 1008,
      status: "found",
      confidence: "high",
      page: 2,
      source_snippet: "Consumo annuo 1.008 kWh",
      source_match: "1.008 kWh",
      method: "annual_consumption_semantic",
    }],
  };
}

test("Step 5 produce un contratto JSON stabile e versionato", () => {
  const contract = buildPdfDataContract(baseDual());
  assert.equal(contract.schema, "offertalogica.pdf-data");
  assert.equal(contract.contract_version, PDF_DATA_CONTRACT_VERSION);
  assert.equal(contract.contract_version, "1.2.0");
  assert.equal(contract.parser.mode, "deterministic");
  assert.equal(contract.document.commodity, "dual");
  assert.equal(contract.supplies.luce.annual_consumption, 1008);
  assert.equal(contract.supplies.gas.annual_consumption, 851);
  assert.equal(contract.autofill_plan.requires_user_confirmation, true);
});

test("Step 5 conserva valore normalizzato, provenienza ed evidenza", () => {
  const contract = buildPdfDataContract(baseDual());
  const field = contract.fields.consumo_luce_kwh;
  assert.equal(field.normalized_value, 1008);
  assert.equal(field.original_value, "1.008");
  assert.equal(field.original_value_kind, "source_literal");
  assert.equal(field.unit, "kWh/anno");
  assert.equal(field.provenance.source, "parser");
  assert.equal(field.provenance.origin, "pdf_native_text");
  assert.equal(field.provenance.method, "annual_consumption_semantic");
  assert.equal(field.evidence.available, true);
  assert.equal(field.evidence.quality, "literal_value");
  assert.equal(field.evidence.literal_value_present, true);
  assert.equal(field.evidence.literal_value, "1.008");
  assert.equal(field.evidence.page, 2);
  assert.match(field.evidence.snippet, /1\.008 kWh/);
});

test("Step 5 blocca autocompilazione dei campi parziali o da verificare", () => {
  const input = baseDual();
  input.field_status.prezzo_luce_eur_kwh = { status: "da_verificare", reason: "prezzo_incoerente" };
  input.field_status.codice_cliente = { status: "parziale", reason: "codice_incompleto" };
  const contract = buildPdfDataContract(input);
  assert.equal(contract.fields.prezzo_luce_eur_kwh.autofill.allowed, false);
  assert.equal(contract.fields.prezzo_luce_eur_kwh.autofill.reason, "stato_da_verificare");
  assert.equal(contract.fields.codice_cliente.autofill.allowed, false);
  assert.equal(contract.fields.codice_cliente.autofill.reason, "stato_parziale");
  assert.ok(contract.autofill_plan.blocked_fields.some((item) => item.source_field === "prezzo_luce_eur_kwh"));
  assert.ok(!contract.autofill_plan.safe_fields.some((item) => item.source_field === "prezzo_luce_eur_kwh"));
});

test("Step 5 non inserisce il tipo ibrido in un controllo che accetta solo fisso o variabile", () => {
  const contract = buildPdfDataContract(baseDual());
  assert.equal(contract.fields.tipo_prezzo_luce.status, "completo");
  assert.equal(contract.fields.tipo_prezzo_luce.autofill.allowed, false);
  assert.equal(contract.fields.tipo_prezzo_luce.autofill.reason, "valore_non_supportato_dal_modulo");
  assert.equal(contract.fields.tipo_prezzo_gas.autofill.allowed, false);
});

test("Step 5 ammette soltanto campi completi dopo conferma esplicita", () => {
  const input = baseDual();
  input.tipo_prezzo_luce = "variabile";
  input.tipo_prezzo_gas = "variabile";
  const contract = buildPdfDataContract(input);
  const price = contract.fields.prezzo_luce_eur_kwh;
  assert.equal(price.autofill.allowed, true);
  assert.equal(price.autofill.reason, "campo_completo_con_conferma_utente");
  assert.ok(contract.autofill_plan.safe_fields.some((item) => item.source_field === "prezzo_luce_eur_kwh" && item.target === "in-luce-prezzo-att"));
  assert.ok(contract.autofill_plan.safe_fields.every((item) => item.requires_user_confirmation === true));
});


test("Step 5 non conta come bloccati i campi della commodity non applicabile", () => {
  const input = baseDual();
  input.commodity = "luce";
  input.consumo_gas_smc = null;
  input.prezzo_gas_eur_smc = null;
  input.quota_fissa_vendita_gas_eur_anno = null;
  input.pdr = null;
  input.indirizzo_fornitura_gas = null;
  for (const field of ["consumo_gas_smc", "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno", "pdr", "indirizzo_fornitura_gas", "tipo_prezzo_gas"]) {
    input.field_status[field] = { status: "non_applicabile", reason: null };
  }
  const contract = buildPdfDataContract(input);
  assert.ok(!contract.autofill_plan.blocked_fields.some((item) => item.source_field.endsWith("gas") || item.source_field.includes("gas_")));
});

test("Step 5 espone in modo trasparente quando la sorgente non fornisce uno snippet", () => {
  const contract = buildPdfDataContract(baseDual());
  const field = contract.fields.codice_cliente;
  assert.equal(field.evidence.available, false);
  assert.equal(field.evidence.quality, "unavailable");
  assert.equal(field.evidence.note, "evidenza_testuale_non_disponibile");
  assert.equal(field.provenance.source, "parser");
});

test("Step 5 marca come contestuale uno snippet che non contiene il valore normalizzato", () => {
  const input = baseDual();
  input.diagnostics = [{
    field: "prezzo_luce_eur_kwh",
    label: "Prezzo vendita luce",
    value: 0.190954,
    status: "found",
    confidence: "high",
    page: 6,
    source_snippet: "Tariffa acquedotto 0,960322 €/mc",
    source_match: "0.19",
    method: "text_pattern",
  }];
  const field = buildPdfDataContract(input).fields.prezzo_luce_eur_kwh;
  assert.equal(field.evidence.available, true);
  assert.equal(field.evidence.quality, "context_only");
  assert.equal(field.evidence.literal_value_present, false);
  assert.equal(field.evidence.note, "snippet_disponibile_ma_valore_normalizzato_non_presente_letteralmente");
});

test("applyPdfDataContract non rimuove i campi legacy", () => {
  const input = baseDual();
  const result = applyPdfDataContract(input);
  assert.equal(result.pod, input.pod);
  assert.equal(result.pdr, input.pdr);
  assert.equal(result.consumo_luce_kwh, 1008);
  assert.ok(result.data_contract);
});
