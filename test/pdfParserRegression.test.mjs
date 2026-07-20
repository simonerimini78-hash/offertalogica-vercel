import test from "node:test";
import assert from "node:assert/strict";
import { extractPdfDataFromText, PDF_PARSER_VERSION } from "../lib/pdfExtract.js";

test("regressione Hera dual: mantiene separate luce e gas e riconosce la struttura ibrida", () => {
  const result = extractPdfDataFromText(`
    Hera Comm BOLLETTA LUCE E GAS
    Totale da pagare 180,00 euro Periodo di fatturazione giugno 2026
    Consumo annuo: 1.008,00 kWh Codice POD IT001E12345678
    Consumo annuo: 851,00 Smc Codice PDR 12345678901234
    Box dell'offerta Spesa per la vendita di gas naturale
    Nome offerta: Hera Hybrid Casa Gas_L_B - V21
    Indice di riferimento: PSV day ahead
    Tipologia di offerta: Struttura di prezzo non convenzionale
    Codice offerta: 000415GTVML01XX000HHYXGCXMXBXV21
    Box dell'offerta Spesa per la vendita di energia elettrica
    Nome offerta: Hera Hybrid Casa EE_L_B - V21
    Indice di riferimento: PUN Index GME
    Tipologia di offerta: Struttura di prezzo non convenzionale
    Codice offerta: 000415ETVML01XX000HHYXECXMXBXV21
  `);

  assert.equal(PDF_PARSER_VERSION, "v99-baseline-step1");
  assert.equal(result.commodity, "dual");
  assert.equal(result.nome_offerta_luce, "Hera Hybrid Casa EE_L_B - V21");
  assert.equal(result.codice_offerta_luce, "000415ETVML01XX000HHYXECXMXBXV21");
  assert.equal(result.tipo_prezzo_luce, "ibrido");
  assert.equal(result.indice_riferimento_luce, "PUN Index GME");
  assert.equal(result.nome_offerta_gas, "Hera Hybrid Casa Gas_L_B - V21");
  assert.equal(result.codice_offerta_gas, "000415GTVML01XX000HHYXGCXMXBXV21");
  assert.equal(result.tipo_prezzo_gas, "ibrido");
  assert.equal(result.indice_riferimento_gas, "PSV day ahead");
  assert.equal(result.nome_offerta, null);
  assert.equal(result.codice_offerta, null);
  assert.equal(result.tipo_prezzo, "ibrido");
  assert.equal(result.indice_riferimento, null);
});

test("regressione Plenitude dual: non sovrascrive i dati luce con quelli gas", () => {
  const result = extractPdfDataFromText(`
    Eni Plenitude BOLLETTA LUCE E GAS Totale da pagare 260,43 euro
    Periodo di fatturazione maggio e giugno 2026
    In un anno hai consumato 1.363 Smc Codice PDR 12345678901234
    In un anno hai consumato 2.196 kWh Codice POD IT001E12345678
    Box dell'offerta Caratteristiche della mia offerta Gas naturale
    Nome offerta: Fixa Time Gas Base
    Codice offerta: 026160GSFML38XXGFIXATIVBAS111125
    Tipologia offerta: a prezzo fisso
    Box dell'offerta Caratteristiche della mia offerta Energia elettrica
    Nome offerta: Fixa Time Luce Base
    Codice offerta: 026160ESFML38XXLFIXATIVBAS111125
    Tipologia offerta: a prezzo fisso
  `);

  assert.equal(result.commodity, "dual");
  assert.equal(result.nome_offerta_luce, "Fixa Time Luce Base");
  assert.equal(result.codice_offerta_luce, "026160ESFML38XXLFIXATIVBAS111125");
  assert.equal(result.tipo_prezzo_luce, "fisso");
  assert.equal(result.nome_offerta_gas, "Fixa Time Gas Base");
  assert.equal(result.codice_offerta_gas, "026160GSFML38XXGFIXATIVBAS111125");
  assert.equal(result.tipo_prezzo_gas, "fisso");
  assert.equal(result.nome_offerta, null);
  assert.equal(result.codice_offerta, null);
  assert.equal(result.tipo_prezzo, "fisso");
});

test("regressione Dolomiti luce: distingue prezzo vendita, spread e quota fissa", () => {
  const result = extractPdfDataFromText(`
    Dolomiti Energia ENERGIA ELETTRICA MERCATO LIBERO Fattura
    Totale da pagare 900,00 euro Periodo di fatturazione marzo 2026
    Consumo annuo (kWh): 12.681
    Codice POD: IT001E53941825
    QUOTA PER CONSUMI 2.911,000 kWh 0,228983 €/kWh
    di cui spesa per vendita energia elettrica 0,183957 €/kWh
    QUOTA FISSA 2 mesi 12,350000 €/mese
    di cui spesa per vendita energia elettrica 10,430000 €/mese
    Box dell'offerta Nome offerta: PUN-TA CASA_R
    Codice offerta: 000139EPVFL01XXW71001W0924W00000
    Tipologia offerta: prezzo variabile
    Indice di riferimento: PUN Periodicita mensile
    PUN 0,122280 0,110570 0,143020 0,143580
    SPREAD 0,018180 0,018180 0,018180 0,018180
    PERDITE DI RETE 0,014046 0,012875 0,016120 0,016176
  `);

  assert.equal(result.commodity, "luce");
  assert.equal(result.consumo_luce_kwh, 12681);
  assert.equal(result.prezzo_luce_eur_kwh, 0.183957);
  assert.equal(result.quota_fissa_vendita_luce_eur_anno, 125.16);
  assert.equal(result.spread_luce_eur_kwh, 0.01818);
  assert.equal(result.spread_gas_eur_smc, null);
});

test("regressione Dolomiti gas: converte il consumo e non confonde rete e spread", () => {
  const result = extractPdfDataFromText(`
    Dolomiti Energia GAS NATURALE MERCATO LIBERO Fattura
    Totale da pagare 600,00 euro Periodo di fatturazione marzo 2026
    Consumo annuo (mc): 1.883
    Coefficiente correttivo (C): 1,019264
    Codice PDR: 03081000592850
    QUOTA PER CONSUMI 246 Smc 0,957992 €/Smc
    di cui spesa per vendita gas naturale 0,687459 €/Smc
    QUOTA FISSA 1 mesi 15,970000 €/mese
    di cui spesa per vendita gas naturale 12,000000 €/mese
    Box dell'offerta Nome offerta: GAS ITALY CASA_R
    Codice offerta: 000139GPVML01XXW70860WR000000000
    Tipologia offerta: prezzo variabile
    Indice di riferimento: PSV day ahead
    PSVDA 0,557700
    SPREAD 0,121732
    ONERI DI RETE 0,145000
  `);

  assert.equal(result.commodity, "gas");
  assert.equal(result.consumo_gas_smc, 1919.274);
  assert.equal(result.prezzo_gas_eur_smc, 0.687459);
  assert.equal(result.quota_fissa_vendita_gas_eur_anno, 144);
  assert.equal(result.spread_gas_eur_smc, 0.121732);
  assert.equal(result.spread_luce_eur_kwh, null);
});

test("regressione ButanGas business: usa PUN e rifiuta indirizzi istruttivi", () => {
  const result = extractPdfDataFromText(`
    ButanGas FATTURA ENERGIA ELETTRICA BOLLETTA
    Totale da pagare 150,00 euro Periodo di fatturazione giugno 2026
    Consumo annuo aggiornato 16.522 kWh
    BOX DELL'OFFERTA
    Denominazione commerciale offerta: BUSINESS_VARIABILE Codice offerta: 001682ESVFL08XXBUTANGMBS36XXXBVF
    Tipologia Offerta: VARIABILE
    Formula prevista dal contratto: Energia + Energia Spread PUN + Corrispettivo CDISPD
    Indice di riferimento: PUN index GME
    POD: IT001E53942290
    Indirizzo di fornitura: VICOLO SANTA CROCE, 2/A,48125 - RAVENNA (RA)
    Potenza impegnata: 10 kW
    Quota per consumi 391 kWh 0,229591 €/kWh
    di cui spesa per la vendita di energia elettrica 0,184578 €/kWh
    Energia Spread PUN:0,016000 €/kWh
    Tipologia cliente: Altri usi
    Il modulo da utilizzare lo potete trovare all'interno della documentazione contrattuale.
  `);

  assert.equal(result.commodity, "luce");
  assert.equal(result.customer_type, "business");
  assert.equal(result.tipo_prezzo_luce, "variabile");
  assert.equal(result.indice_riferimento_luce, "PUN Index GME");
  assert.equal(result.spread_luce_eur_kwh, 0.016);
  assert.equal(result.pod, "IT001E53942290");
  assert.equal(result.consumo_luce_kwh, 16522);
  assert.equal(result.potenza_impegnata_kw, 10);
  assert.equal(result.prezzo_luce_eur_kwh, 0.184578);
  assert.equal(result.intestatario, null);
  assert.equal(result.indirizzo_fornitura, "VICOLO SANTA CROCE, 2/A, 48125 - RAVENNA (RA)");

  const invalidAddress = extractPdfDataFromText(`
    ButanGas FATTURA ENERGIA ELETTRICA BOLLETTA
    Totale da pagare 150,00 euro Periodo di fatturazione giugno 2026
    Consumo annuo 16.522 kWh Codice POD IT001E53942290
    Indirizzo di fornitura: Il modulo da utilizzare lo potete trovare nella documentazione contrattuale.
  `);
  assert.equal(invalidAddress.indirizzo_fornitura, null);
  assert.ok(invalidAddress.warnings.includes("indirizzo_fornitura_non_valido"));
});


test("regressione Free Luce&Gas 2019: riconosce fornitore, business, prezzo materia, potenze e dati tabellari", () => {
  const result = extractPdfDataFromText(`
    Free Luce&Gas S.r.l. P.I. e C.F. : 11788741004 Via Dei Prati Fiscali, 199 - 00141 Roma
    Documento n° E-2019-00018699
    FORNITURA e RIEPILOGO DEGLI IMPORTI ROMAGNA ALLEVAMENTI GROUP SOCIETA' VICOLO SANTA CROCE 2/A 48125 RAVENNA
    BOLLETTA ENERGIA ELETTRICA
    COSTO MEDIO DELLA FORNITURA Costo unitario della materia Energia 0,055492 €/kWh
    Costo unitario dell'intera bolletta 0,304307 €/kWh
    RIEPILOGO DATI POD IT001E53942290 Vicolo Santa Croce 2/A Ravenna (RA)
    Imp. 10 kW - Dis. 11 kW BTA4 BASSA TENSIONE - 380V
    Codice Cliente Data Emissione Applicabile solo ai casi FRLG141176 09/09/2019
  `);

  assert.equal(result.fornitore, "Free Luce&Gas");
  assert.equal(result.kind, "bolletta");
  assert.equal(result.commodity, "luce");
  assert.equal(result.prezzo_luce_eur_kwh, 0.055492);
  assert.equal(result.potenza_impegnata_kw, 10);
  assert.equal(result.potenza_disponibile_kw, 11);
  assert.equal(result.pod, "IT001E53942290");
  assert.equal(result.intestatario, "ROMAGNA ALLEVAMENTI GROUP SOCIETA'");
  assert.equal(result.codice_cliente, "FRLG141176");
  assert.equal(result.indirizzo_fornitura, "Vicolo Santa Croce 2/A Ravenna (RA)");
  assert.equal(result.customer_type, "business");
  assert.equal(result.consumo_luce_kwh, null);
  assert.equal(result.quota_fissa_vendita_luce_eur_anno, null);
});
