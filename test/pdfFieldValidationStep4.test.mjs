import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPdfFieldValidation,
  buildPdfFieldValidation,
  completeDualSupplyAddresses,
  PDF_FIELD_VALIDATION_VERSION,
} from "../lib/pdfFieldValidation.js";
import { extractPdfDataFromText, PDF_PARSER_VERSION } from "../lib/pdfExtract.js";

function baseDual(overrides = {}) {
  return {
    commodity: "dual",
    kind: "bolletta",
    confidence: "high",
    needsReview: false,
    fornitore: "Hera Comm",
    consumo_luce_kwh: 1008,
    prezzo_luce_eur_kwh: 0.190954,
    quota_fissa_vendita_luce_eur_anno: 145.2,
    consumo_gas_smc: 851,
    prezzo_gas_eur_smc: 0.498828,
    quota_fissa_vendita_gas_eur_anno: 144,
    pod: "IT001E51379686",
    pdr: "03081000767573",
    codice_fiscale: "PGLFPP81M07D704Q",
    codice_cliente: "1003507407",
    customer_type: "privato",
    intestatario: "PAGLIA FILIPPO",
    indirizzo_fornitura_luce: "VIALE FULCIERI PAULUCCI CALBOLI 138 47121 FORLI' FC",
    indirizzo_fornitura_gas: "VIALE FULCIERI PAULUCCI CALBOLI 138",
    nome_offerta_luce: "Hera Hybrid Casa EE_L_B - V21",
    codice_offerta_luce: "000415ETVML01XX000HHYXECXMXBXV21",
    tipo_prezzo_luce: "ibrido",
    tipo_prezzo_evidenza_luce: "Struttura di prezzo non convenzionale",
    indice_riferimento_luce: "PUN Index GME",
    decorrenza_condizioni_economiche_luce: "2026-02-17",
    scadenza_condizioni_economiche_luce: "2028-02-29",
    nome_offerta_gas: "Hera Hybrid Casa Gas_L_B - V21",
    codice_offerta_gas: "000415GTVML01XX000HHYXGCXMXBXV21",
    tipo_prezzo_gas: "ibrido",
    tipo_prezzo_evidenza_gas: "Struttura di prezzo non convenzionale",
    indice_riferimento_gas: "PSV day ahead",
    decorrenza_condizioni_economiche_gas: "2026-02-24",
    scadenza_condizioni_economiche_gas: "2028-02-29",
    ...overrides,
  };
}

test("Step 4 completa soltanto indirizzi dual con stessa strada e stesso civico", () => {
  const result = completeDualSupplyAddresses(baseDual());
  assert.equal(result.normalized.indirizzo_fornitura_gas, "VIALE FULCIERI PAULUCCI CALBOLI 138 47121 FORLI' FC");
  assert.equal(result.normalized.indirizzo_fornitura_luce, "VIALE FULCIERI PAULUCCI CALBOLI 138 47121 FORLI' FC");
  assert.ok(result.notes.includes("indirizzo_gas_completato_da_indirizzo_luce_stesso_civico"));

  const different = completeDualSupplyAddresses(baseDual({
    indirizzo_fornitura_gas: "VIA ROMA 12 40100 BOLOGNA BO",
  }));
  assert.equal(different.normalized.indirizzo_fornitura_gas, "VIA ROMA 12 40100 BOLOGNA BO");
});

test("Step 4 duplica l'indirizzo comune sulle commodity dual senza inventare una località", () => {
  const address = "Viale Della Resistenza 17, 47032 Bertinoro FC";
  const result = completeDualSupplyAddresses(baseDual({
    indirizzo_fornitura: address,
    indirizzo_fornitura_luce: null,
    indirizzo_fornitura_gas: null,
  }));
  assert.equal(result.normalized.indirizzo_fornitura_luce, address);
  assert.equal(result.normalized.indirizzo_fornitura_gas, address);
});

test("Step 4 marca la validità Edison con sola scadenza come parziale, non errata", () => {
  const result = applyPdfFieldValidation({
    commodity: "gas",
    kind: "bolletta",
    confidence: "high",
    needsReview: false,
    fornitore: "Edison Energia",
    consumo_gas_smc: 1653.86,
    prezzo_gas_eur_smc: 0.565095,
    quota_fissa_vendita_gas_eur_anno: 240,
    pdr: "03081000466501",
    codice_fiscale: "DLLLCU82B03E625Q",
    codice_cliente: "1001133382",
    customer_type: "privato",
    intestatario: "DELLA LUCA",
    indirizzo_fornitura: "VIA MULINO 19 - 40050 VALSAMOGGIA BO",
    indirizzo_fornitura_gas: "VIA MULINO 19 - 40050 VALSAMOGGIA BO",
    nome_offerta_gas: "Edison World Gas",
    codice_offerta_gas: "000190GPVML05XXLGWD1X001X5RINNX2",
    tipo_prezzo_gas: "variabile",
    tipo_prezzo_evidenza_gas: "prezzo variabile",
    indice_riferimento_gas: "PSV",
    decorrenza_condizioni_economiche_gas: null,
    scadenza_condizioni_economiche_gas: "2027-03-31",
  });
  assert.equal(result.field_status.validita_condizioni_economiche_gas.status, "parziale");
  assert.equal(result.field_status.validita_condizioni_economiche_gas.reason, "manca_decorrenza");
  assert.equal(result.readiness.confronto.gas.status, "completo");
  assert.ok(result.readiness.confronto.gas.partial_recommended.includes("validita_condizioni_economiche_gas"));
  assert.equal(result.confidence, "high");
  assert.equal(result.needsReview, false);
});

test("Step 4 segnala contraddizioni tra commodity, indice e tipo prezzo", () => {
  const fixedWithIndex = buildPdfFieldValidation(baseDual({
    tipo_prezzo_luce: "fisso",
    indice_riferimento_luce: "PUN",
  }));
  assert.equal(fixedWithIndex.fieldStatus.tipo_prezzo_luce.status, "da_verificare");
  assert.equal(fixedWithIndex.fieldStatus.tipo_prezzo_luce.reason, "prezzo_fisso_con_indice_o_spread");

  const wrongIndex = buildPdfFieldValidation(baseDual({ indice_riferimento_gas: "PUN" }));
  assert.equal(wrongIndex.fieldStatus.tipo_prezzo_gas.status, "da_verificare");
  assert.equal(wrongIndex.fieldStatus.indice_riferimento_gas.status, "da_verificare");
});

test("Step 4 produce readiness separate per confronto e attivazione", () => {
  const result = applyPdfFieldValidation(baseDual());
  assert.equal(result.readiness.confronto.luce.status, "completo");
  assert.equal(result.readiness.confronto.gas.status, "completo");
  assert.equal(result.readiness.attivazione.luce.status, "completo");
  assert.equal(result.readiness.attivazione.gas.status, "completo");
  assert.equal(result.completeness.validation_version, PDF_FIELD_VALIDATION_VERSION);
  assert.ok(result.completeness.score > 80);
});

test("Step 4 non rende obbligatori nome offerta e validità per un confronto economico da bolletta", () => {
  const result = applyPdfFieldValidation(baseDual({
    nome_offerta_luce: null,
    codice_offerta_luce: null,
    decorrenza_condizioni_economiche_luce: null,
    scadenza_condizioni_economiche_luce: null,
  }));
  assert.equal(result.readiness.confronto.luce.status, "completo");
  assert.deepEqual(result.readiness.confronto.luce.missing, []);
  assert.ok(result.readiness.confronto.luce.missing_recommended.includes("nome_offerta_luce"));
});

test("il parser Step 4 applica la validazione senza modificare i valori economici", () => {
  const result = extractPdfDataFromText(`
    Estra Energie BOLLETTA ENERGIA ELETTRICA Totale da pagare 70 euro.
    Consumo annuo 1.330,3 kWh POD IT001E51344941.
    di cui spesa per la vendita di energia elettrica 0,188041 €/kWh
    Quota fissa e quota potenza
    di cui spesa per vendita energia elettrica 11,110000 €/Mese 22,22
    Codice fiscale BNVRRT60L19D704H
    Indirizzo di fornitura: VIA BRANDO BRANDI 72, 47121 FORLI' FC POD IT001E51344941
    Nome dell'offerta commerciale: ESTRA NATURA LUCE
    Codice offerta: 001231ESVFL01XXE77XX12122509GYNL
    Tipologia offerta: Prezzo variabile
    Formula per il calcolo dell'energia: PUN FASCE + SPREAD + DISPACCIAMENTO
    SPREAD (€/kWh) 0,03190000
    Decorrenza condizioni economiche: 05/01/2026
    Scadenza condizioni economiche: 01/04/2027
  `);
  assert.equal(PDF_PARSER_VERSION, "v102-validation-completeness-step4");
  assert.equal(result.consumo_luce_kwh, 1330.3);
  assert.equal(result.prezzo_luce_eur_kwh, 0.188041);
  assert.equal(result.quota_fissa_vendita_luce_eur_anno, 133.32);
  assert.equal(result.field_status.validita_condizioni_economiche_luce.status, "completo");
  assert.equal(result.readiness.confronto.luce.status, "completo");
});
