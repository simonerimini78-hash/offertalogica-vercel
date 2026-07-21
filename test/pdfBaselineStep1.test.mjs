import test from "node:test";
import assert from "node:assert/strict";
import { extractPdfDataFromText } from "../lib/pdfExtract.js";

test("recupera i consumi annui espliciti senza usare le soglie contrattuali", () => {
  const result = extractPdfDataFromText(`
    Fattura elettronica. Totale da pagare.
    Gas - Consumo annuo: 851,00 Smc
    Taglia L: Caso B (consumo annuo stimato compreso fra 501 Smc e 1.000 Smc)
    Totale consumo annuo: 851,00 Smc
    Energia elettrica - Consumo annuo: 1.008,00 kWh
    Taglia L: Caso B (consumo annuo stimato compreso fra 1.001 e 2.000 kWh)
    Totale consumo annuo: 1.008,00 kWh
  `);
  assert.equal(result.consumo_gas_smc, 851);
  assert.equal(result.consumo_luce_kwh, 1008);
});

test("supporta le formule Estra gas", () => {
  const result = extractPdfDataFromText(`
    Estra Energie S.r.l. Fattura elettronica. Totale da pagare. Gas naturale.
    Codice PDR: 03081000765318
    Quota per consumi
    di cui spesa per la materia gas naturale 0,561228 €/Smc 95,97
    Quota fissa 2 Mesi 15,190000 €/Mese 30,38
    di cui spesa per la materia gas naturale 11,000000 €/Mese 22,00
    Nome dell’offerta commerciale: ESTRA NATURA GAS
    Codice offerta: 001231GSVML01XXF46XX12122506GYNG
    Tipologia offerta: Prezzo variabile
    Formula per il calcolo del gas naturale: PSV + SPREAD
  `);
  assert.equal(result.fornitore, "Estra Energie");
  assert.equal(result.prezzo_gas_eur_smc, 0.561228);
  assert.equal(result.quota_fissa_vendita_gas_eur_anno, 132);
  assert.equal(result.nome_offerta_gas, "ESTRA NATURA GAS");
});

test("supporta Estra luce senza confondere importo bimestrale e prezzo mensile", () => {
  const result = extractPdfDataFromText(`
    Estra Energie S.r.l. Fattura elettronica. Totale da pagare. Energia Elettrica.
    Codice POD: IT001E51344941
    Quota fissa e quota potenza
    2 Mesi 20,430000 €/Mese 40,86
    di cui spesa per vendita energia elettrica 11,110000 €/Mese 22,22
    Nome dell’offerta commerciale: ESTRA NATURA LUCE
  `);
  assert.equal(result.quota_fissa_vendita_luce_eur_anno, 133.32);
  assert.equal(result.nome_offerta_luce, "ESTRA NATURA LUCE");
});

test("supporta la denominazione contratto e il prezzo storico Enel gas", () => {
  const result = extractPdfDataFromText(`
    Enel Energia. Fattura. Fornitura Gas Naturale.
    Denominazione contratto
    Giustaxte gas
    Comp.Sost.Mat.Prima contratto
    0,29000000 euro/smc
    CODICE PDR 03081000592850
    N° CLIENTE
    636 552 233 4 DATI BOLLETTA
  `);
  assert.equal(result.prezzo_gas_eur_smc, 0.29);
  assert.equal(result.nome_offerta_gas, "Giustaxte gas");
  assert.equal(result.codice_cliente, "636552233");
});

test("non usa IMPORTO come codice cliente", () => {
  const result = extractPdfDataFromText(`
    Enel Energia. Fattura. Gas naturale. PDR 03081000592850.
    codice cliente importo in euro numero conto
  `);
  assert.equal(result.codice_cliente, null);
});

test("privilegia i dati fiscali del cliente rispetto a quelli del fornitore", () => {
  const butan = extractPdfDataFromText(`
    Dati identificativi del cliente
    ALFA AGRICOLA SOC. AGR.
    VICOLO SANTA CROCE 2/A
    48125 - RAVENNA (RA)
    Codice fiscale: 01234567890
    Partita IVA: 01234567890
    ButanGas S.p.A. - Partita I.V.A. 10987654321 - Codice fiscale 10987654320
    Fattura energia elettrica. POD IT001E53942290.
  `);
  assert.equal(butan.codice_fiscale, "01234567890");
  assert.equal(butan.intestatario, "ALFA AGRICOLA SOC. AGR.");

  const free = extractPdfDataFromText(`
    Free Luce&Gas S.r.l. P.I. e C.F. : 10987654321
    FORNITURA e RIEPILOGO DEGLI IMPORTI
    ALFA AGRICOLA SOCIETA'
    VICOLO SANTA CROCE 2/A
    DATI CLIENTE
    Vicolo Santa Croce 2/A 48125 Ravenna (RA)
    01234567890
    ALFA AGRICOLA SOCIETA' AGRICOLA
    P.Iva
    Free Luce&Gas S.r.l. P.Iva : 10987654321
    Fattura energia elettrica. POD IT001E53942290.
  `);
  assert.equal(free.codice_fiscale, "01234567890");
});
