import test from "node:test";
import assert from "node:assert/strict";
import { extractPdfDataFromText, PDF_PARSER_VERSION } from "../lib/pdfExtract.js";
import { extractOfferDetails, normalizeOfferDate } from "../lib/pdfOfferDetails.js";
import { pdfFieldDefinition } from "../lib/pdfReaderContract.js";

test("Step 3 Estra luce: estrae contratto, formula, spread contestualizzato e validità", () => {
  const result = extractPdfDataFromText(`
    Estra Energie BOLLETTA ENERGIA ELETTRICA Totale da pagare 325,09 euro.
    Consumo annuo 1.330,300 kWh POD IT001E51344941.
    di cui spesa per la vendita di energia elettrica 0,188041 €/kWh
    di cui spesa per la vendita di energia elettrica 11,110000 €/mese
    Box dell'offerta - spesa per la vendita di energia elettrica
    Nome dell'offerta commerciale: ESTRA NATURA LUCE
    Codice offerta: 001231ESVFL01XXE77XX12122509GYNL
    Tipologia offerta: Prezzo variabile
    Tipologia prezzo offerta: per fasce
    Periodicità aggiornamento indice: MENSILE
    Formula per il calcolo dell'energia: PUN FASCE + SPREAD + DISPACCIAMENTO
    Valori assunti dalla formula per il calcolo dell'energia (€/kWh):
    PUN FASCE 0,11788700 F1
    SPREAD 0,03190000 05/2026 - 06/2026
    DISPACCIAMENTO 0,00000000
    Decorrenza condizioni economiche: 05/01/2026
    Scadenza condizioni economiche: 01/04/2027
    Onere di recesso anticipato: nessuno
  `);

  assert.equal(PDF_PARSER_VERSION, "v102-validation-completeness-step4");
  assert.equal(result.nome_offerta_luce, "ESTRA NATURA LUCE");
  assert.equal(result.codice_offerta_luce, "001231ESVFL01XXE77XX12122509GYNL");
  assert.equal(result.tipo_prezzo_luce, "variabile");
  assert.match(result.tipo_prezzo_evidenza_luce, /prezzo variabile/i);
  assert.equal(result.indice_riferimento_luce, "PUN");
  assert.equal(result.spread_luce_eur_kwh, 0.0319);
  assert.equal(result.struttura_prezzo_luce, "per fasce");
  assert.equal(result.periodicita_aggiornamento_indice_luce, "mensile");
  assert.equal(result.decorrenza_condizioni_economiche_luce, "2026-01-05");
  assert.equal(result.scadenza_condizioni_economiche_luce, "2027-04-01");
  assert.equal(result.formula_prezzo_luce, "PUN FASCE + SPREAD + DISPACCIAMENTO");
  assert.deepEqual(result.componenti_prezzo_luce, ["PUN fasce", "spread", "dispacciamento"]);
  assert.equal(result.onere_recesso_anticipato_luce, "nessuno");
  assert.ok(!result.warnings.includes("spread_luce_unita_non_esplicita"));
  assert.equal(result.confidence, "high");
});

test("Step 3 Estra gas: mantiene separati indice, spread, formula e struttura", () => {
  const result = extractPdfDataFromText(`
    Estra Energie BOLLETTA GAS NATURALE Totale da pagare 248,33 euro.
    Consumo annuo 171 Smc PDR 03081000466501.
    di cui spesa per la vendita di gas naturale 0,561228 €/Smc
    di cui spesa per la vendita di gas naturale 11,000000 €/mese
    Box dell'offerta - spesa per la vendita di gas naturale
    Nome dell'offerta commerciale: ESTRA NATURA GAS
    Codice offerta: 001231GSVML01XXF46XX12122506GYNG
    Tipologia offerta: Prezzo variabile
    Tipologia prezzo offerta: monorario
    Periodicità aggiornamento indice: MENSILE
    Formula per il calcolo del gas naturale: PSV + SPREAD
    Valori assunti dalla formula per il calcolo gas naturale (€/Smc):
    PSV 0,49163482
    SPREAD 0,09000000
    Decorrenza condizioni economiche: 05/01/2026
    Scadenza condizioni economiche: 01/04/2027
    Onere di recesso anticipato: nessuno
  `);

  assert.equal(result.nome_offerta_gas, "ESTRA NATURA GAS");
  assert.equal(result.indice_riferimento_gas, "PSV");
  assert.equal(result.spread_gas_eur_smc, 0.09);
  assert.equal(result.struttura_prezzo_gas, "monorario");
  assert.equal(result.formula_prezzo_gas, "PSV + SPREAD");
  assert.deepEqual(result.componenti_prezzo_gas, ["PSV", "spread"]);
  assert.ok(!result.warnings.includes("spread_gas_unita_non_esplicita"));
});

test("Step 3 Plenitude dual: conserva dettagli contrattuali distinti per luce e gas", () => {
  const result = extractPdfDataFromText(`
    Eni Plenitude BOLLETTA LUCE E GAS Totale da pagare 260,43 euro.
    In un anno hai consumato 1.363 Smc PDR 12345678901234.
    In un anno hai consumato 2.196 kWh POD IT001E12345678.
    Box dell'offerta Gas naturale
    Nome offerta: Fixa Time Gas Base
    Codice offerta: 026160GSFML38XXGFIXATIVBAS111125
    Tipologia offerta: a prezzo fisso
    Codice condizioni economiche: D_GFIXATIVBAS_BASE_11112025_GAS
    Validità condizioni economiche: dal 01/01/2026 al 01/01/2027
    Frequenza fatturazione: bimestrale
    Oneri di recesso: no
    Altre caratteristiche: Gas con compensazione CO2
    Formula prevista: Corrispettivo Gas - Sconto Domiciliazione
    Sconto Domiciliazione tipo prezzo prezzo Smc euro regime iva
    DAL 01/03/2026 AL 31/03/2026 €/Smc -0,02162040 161 -3,48
    Box dell'offerta Energia elettrica
    Nome offerta: Fixa Time Luce Base
    Codice offerta: 026160ESFML38XXLFIXATIVBAS111125
    Tipologia offerta: a prezzo fisso
    Codice condizioni economiche: D_LFIXATIVBAS_BASE_11112025_LUCE
    Validità condizioni economiche: dal 01/01/2026 al 01/01/2027
    Frequenza fatturazione: bimestrale
    Tipologia prezzo: offerta monoraria
    Oneri di recesso: no
    Altre caratteristiche: Energia Verde
    Formula prevista: Corrispettivo Energia * 1,1 (perdite) - Sconto Domiciliazione * 1,1 (perdite) + Dispacciamento
    Sconto Domiciliazione tipo prezzo prezzo kWh euro regime iva
    DAL 01/03/2026 AL 31/03/2026 €/kWh -0,00615000 217 -1,33
  `);

  assert.equal(result.decorrenza_condizioni_economiche_luce, "2026-01-01");
  assert.equal(result.scadenza_condizioni_economiche_luce, "2027-01-01");
  assert.equal(result.decorrenza_condizioni_economiche_gas, "2026-01-01");
  assert.equal(result.scadenza_condizioni_economiche_gas, "2027-01-01");
  assert.equal(result.struttura_prezzo_luce, "monorario");
  assert.equal(result.frequenza_fatturazione_luce, "bimestrale");
  assert.equal(result.frequenza_fatturazione_gas, "bimestrale");
  assert.equal(result.codice_condizioni_economiche_luce, "D_LFIXATIVBAS_BASE_11112025_LUCE");
  assert.equal(result.codice_condizioni_economiche_gas, "D_GFIXATIVBAS_BASE_11112025_GAS");
  assert.equal(result.altre_caratteristiche_offerta_luce, "Energia Verde");
  assert.equal(result.altre_caratteristiche_offerta_gas, "Gas con compensazione CO2");
  assert.deepEqual(result.sconti_offerta_luce, ["Sconto domiciliazione"]);
  assert.deepEqual(result.sconti_offerta_gas, ["Sconto domiciliazione"]);
  assert.deepEqual(result.valori_sconti_offerta_luce, [
    { nome: "Sconto domiciliazione", valore: -0.00615, unita: "EUR/kWh" },
  ]);
  assert.deepEqual(result.valori_sconti_offerta_gas, [
    { nome: "Sconto domiciliazione", valore: -0.0216204, unita: "EUR/Smc" },
  ]);
  assert.equal(result.onere_recesso_anticipato_luce, "nessuno");
  assert.equal(result.onere_recesso_anticipato_gas, "nessuno");
});

test("Step 3 Hera dual: decorrenze diverse non vengono fuse", () => {
  const result = extractPdfDataFromText(`
    Hera Comm BOLLETTA LUCE E GAS Totale da pagare 180 euro.
    Consumo annuo 1.008 kWh POD IT001E12345678.
    Consumo annuo 851 Smc PDR 12345678901234.
    Box dell'offerta Spesa per la vendita di gas naturale
    Nome offerta: Hera Hybrid Casa Gas_L_B - V21
    Indice di riferimento: PSV day ahead
    Periodicità di aggiornamento indice: Mensile
    Tipologia di offerta: Struttura di prezzo non convenzionale
    Decorrenza condizioni economiche: 24.02.2026
    Scadenza condizioni economiche: 29.02.2028
    Oneri recesso anticipato: No
    Codice offerta: 000415GTVML01XX000HHYXGCXMXBXV21
    Box dell'offerta Spesa per la vendita di energia elettrica
    Nome offerta: Hera Hybrid Casa EE_L_B - V21
    Indice di riferimento: PUN Index GME
    Periodicità di aggiornamento indice: Mensile
    Tipologia di offerta: Struttura di prezzo non convenzionale
    Tipologia di prezzo: Monoraria
    Decorrenza condizioni economiche: 17.02.2026
    Scadenza condizioni economiche: 29.02.2028
    Oneri recesso anticipato: No
    Codice offerta: 000415ETVML01XX000HHYXECXMXBXV21
  `);

  assert.equal(result.tipo_prezzo, "ibrido");
  assert.equal(result.decorrenza_condizioni_economiche, null);
  assert.equal(result.scadenza_condizioni_economiche, "2028-02-29");
  assert.equal(result.decorrenza_condizioni_economiche_luce, "2026-02-17");
  assert.equal(result.decorrenza_condizioni_economiche_gas, "2026-02-24");
  assert.equal(result.struttura_prezzo_luce, "monorario");
  assert.equal(result.periodicita_aggiornamento_indice_luce, "mensile");
  assert.equal(result.periodicita_aggiornamento_indice_gas, "mensile");
  assert.equal(result.onere_recesso_anticipato_luce, "nessuno");
  assert.equal(result.onere_recesso_anticipato_gas, "nessuno");
});

test("le date economiche sono validate e non coincidono con la scadenza di pagamento", () => {
  assert.equal(normalizeOfferDate("29.02.2028"), "2028-02-29");
  assert.equal(normalizeOfferDate("29.02.2027"), null);
  assert.equal(normalizeOfferDate("31/04/2027"), null);

  const details = extractOfferDetails(`
    Scade il 04.08.2026
    Pagare la bolletta entro la data di scadenza.
    Decorrenza condizioni economiche: 31/04/2027
    Scadenza condizioni economiche: 29/02/2027
  `, "luce");
  assert.equal(details.validFrom, null);
  assert.equal(details.validTo, null);

  const datedContract = extractOfferDetails("Scadenza contratto: 30.09.2026 Frequenza fatturazione: mensile", "gas");
  assert.equal(datedContract.contractExpiry, "2026-09-30");
});

test("il contratto campi PDF espone i nuovi dettagli senza renderli obbligatori", () => {
  assert.deepEqual(pdfFieldDefinition("decorrenza_condizioni_economiche_luce"), {
    group: "offer",
    roles: ["contract_period"],
    critical: false,
  });
  assert.equal(pdfFieldDefinition("formula_prezzo_gas")?.critical, false);
  assert.equal(pdfFieldDefinition("tipo_prezzo_evidenza_luce")?.group, "offer");
});
