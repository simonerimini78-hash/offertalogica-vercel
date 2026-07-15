import test from "node:test";
import assert from "node:assert/strict";
import { extractPdfDataFromText } from "../lib/pdfExtract.js";

test("mantiene 0.123 come valore decimale per il prezzo", () => {
  const result = extractPdfDataFromText(`
    BOLLETTA ENERGIA ELETTRICA
    Spesa per la vendita di energia elettrica quota per consumi 0.123 €/kWh
    Consumo annuo 2.700 kWh
    Codice POD IT001E12345678
  `);

  assert.equal(result.prezzo_luce_eur_kwh, 0.123);
  assert.equal(result.consumo_luce_kwh, 2700);
  assert.equal(result.recognized, true);
});

test("non usa il primo prezzo generico senza contesto", () => {
  const result = extractPdfDataFromText(`
    BOLLETTA GAS NATURALE
    Sconto domiciliazione -0,021620 €/Smc
    Consumo annuo 700 Smc
    Codice PDR 12345678901234
  `);

  assert.equal(result.prezzo_gas_eur_smc, null);
  assert.equal(result.consumo_gas_smc, 700);
  assert.equal(result.pdr, "12345678901234");
});

test("un documento senza dati energetici resta non riconosciuto", () => {
  const result = extractPdfDataFromText("Documento informativo generico senza dati di fornitura.");

  assert.equal(result.kind, "unknown");
  assert.equal(result.commodity, "unknown");
  assert.equal(result.recognized, false);
  assert.ok(result.warnings.includes("nessun_dato_utile_rilevato"));
});

test("mantiene separate potenza impegnata e disponibile", () => {
  const result = extractPdfDataFromText(`
    BOLLETTA ENERGIA ELETTRICA
    Potenza impegnata 3,0 kW
    Potenza disponibile 3,3 kW
    Consumo annuo 2700 kWh
    Codice POD IT001E12345678
  `);

  assert.equal(result.potenza_impegnata_kw, 3);
  assert.equal(result.potenza_disponibile_kw, 3.3);
});

test("normalizza POD con spazi e accetta solo PDR di 14 cifre", () => {
  const result = extractPdfDataFromText(`
    BOLLETTA DUAL
    Codice POD IT 001 E 12345678
    Codice PDR 1234 5678 9012 34
    Consumo annuo 2700 kWh
    Consumo annuo 700 Smc
  `);

  assert.equal(result.pod, "IT001E12345678");
  assert.equal(result.pdr, "12345678901234");
  assert.equal(result.commodity, "dual");
});

test("scarta un prezzo palesemente fuori intervallo", () => {
  const result = extractPdfDataFromText(`
    BOLLETTA ENERGIA ELETTRICA
    Spesa per la vendita di energia elettrica quota per consumi 123 €/kWh
    Consumo annuo 2700 kWh
    Codice POD IT001E12345678
  `);

  assert.equal(result.prezzo_luce_eur_kwh, null);
  assert.ok(result.warnings.includes("prezzo_luce_fuori_intervallo"));
});

test("legge una bolletta Dolomiti luce completa", () => {
  const result = extractPdfDataFromText(`
    Dolomiti Energia ENERGIA ELETTRICA MERCATO LIBERO Fattura
    Consumo annuo (kWh): 12.681
    Codice POD: IT001E53941825 Indirizzo di fornitura: VIA CELLETTA, 23, RAVENNA
    Potenza impegnata: 6 kW
    QUOTA PER CONSUMI 2.911,000 kWh 0,228983 €/kWh
    di cui spesa per vendita energia elettrica 0,183957 €/kWh
    QUOTA FISSA 2 mesi 12,350000 €/mese
    di cui spesa per vendita energia elettrica 10,430000 €/mese
    Codice cliente: 20142254 Codice Fiscale: RMNSMN78T23D704K
  `);
  assert.equal(result.consumo_luce_kwh, 12681);
  assert.equal(result.prezzo_luce_eur_kwh, 0.183957);
  assert.equal(result.quota_fissa_vendita_luce_eur_anno, 125.16);
  assert.equal(result.potenza_impegnata_kw, 6);
});

test("converte il consumo Dolomiti gas da mc a Smc quando è presente C", () => {
  const result = extractPdfDataFromText(`
    Dolomiti Energia GAS NATURALE Fattura
    Consumo annuo (mc): 1.883
    Coefficiente correttivo (C): 1,019264
    Codice PDR: 03081000592850
    QUOTA PER CONSUMI 246 Smc 0,957992 €/Smc
    di cui spesa per vendita gas naturale 0,687459 €/Smc
    QUOTA FISSA 1 mesi 15,970000 €/mese
    di cui spesa per vendita gas naturale 12,000000 €/mese
  `);
  assert.equal(result.consumo_gas_smc, 1919.274);
  assert.equal(result.prezzo_gas_eur_smc, 0.687459);
  assert.equal(result.quota_fissa_vendita_gas_eur_anno, 144);
  assert.ok(result.warnings.includes("consumo_gas_convertito_da_mc_a_smc"));
});

test("legge il layout Plenitude con etichetta spezzata dopo il valore", () => {
  const result = extractPdfDataFromText(`
    Eni Plenitude Bolletta Gas Luce Numero Cliente 900309137686
    In un anno hai consumato 1.363 Smc e 2.196 kWh
    Indirizzo di fornitura PDR Matricola misuratore
    Viale Della Resistenza 17, Bertinoro FC 10400000417522 SMGR034
    QUOTA PER CONSUMI 205 Smc 0,681805
    di cui spesa per la vendita di gas 0,410829 84,22 €
    naturale €/Smc
    QUOTA FISSA 2 mesi 16,250000
    di cui spesa per la vendita di gas 12,000000 24,00 €
    naturale €/mese
    Indirizzo di fornitura POD Potenza Impegnata Potenza Disponibile
    Viale Della Resistenza 17, Bertinoro FC IT001E51205808 3 kW 3,3 kW
    QUOTA PER CONSUMI 401 kWh 0,194090
    di cui spesa per la vendita di energia 0,149077 59,78 €
    elettrica €/kWh
    QUOTA FISSA 2 mesi 14,025000
    di cui spesa per la vendita di energia 12,105000 24,21 €
    elettrica €/mese
  `);
  assert.equal(result.commodity, "dual");
  assert.equal(result.consumo_luce_kwh, 2196);
  assert.equal(result.consumo_gas_smc, 1363);
  assert.equal(result.prezzo_luce_eur_kwh, 0.149077);
  assert.equal(result.prezzo_gas_eur_smc, 0.410829);
  assert.equal(result.quota_fissa_vendita_luce_eur_anno, 145.26);
  assert.equal(result.quota_fissa_vendita_gas_eur_anno, 144);
});

test("legge una scheda E.ON variabile senza inventare un prezzo fisso", () => {
  const result = extractPdfDataFromText(`
    Scheda sintetica
    Offerta a prezzo variabile per la fornitura di Energia Elettrica - Clienti non domestici
    E.ON LuceDinamica Click ECO - codice offerta: 000362ESVFL01XXZM36R0M000000A000
    Indice
    PUN Index GME
    Totale PUN Index GME*1,1+0,0278 €/kWh
    Costo fisso anno Costo per potenza impegnata
    192,71 €/anno 0,00000 €/kW
  `);
  assert.equal(result.kind, "scheda_offerta");
  assert.equal(result.commodity, "luce");
  assert.equal(result.tipo_prezzo, "variabile");
  assert.equal(result.indice_riferimento, "PUN Index GME");
  assert.equal(result.spread_luce_eur_kwh, 0.0278);
  assert.equal(result.prezzo_luce_eur_kwh, null);
  assert.equal(result.quota_fissa_vendita_luce_eur_anno, 192.71);
});
