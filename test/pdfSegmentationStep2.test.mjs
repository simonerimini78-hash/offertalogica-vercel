import test from "node:test";
import assert from "node:assert/strict";
import { extractPdfDataFromText, PDF_PARSER_VERSION } from "../lib/pdfExtract.js";

test("Hera dual: associa indirizzi, punti e prezzi alla commodity corretta", () => {
  const result = extractPdfDataFromText(`
    Hera Comm Bolletta luce e gas Totale da pagare 100 euro.
    Servizio idrico - Via Acqua 99 - consumo 20 mc.
    Gas naturale
    Servizio fornito in: VIA GAS 10 - 00100 ROMA RM
    Punto di riconsegna (PDR): 12345678901234
    Consumo annuo: 851 Smc
    Quota per consumi 10 Smc 0,700000 €/Smc
    di cui spesa per la vendita di gas naturale 0,498828 €/Smc
    Quota fissa 1 mesi 16,19 €/mese
    di cui spesa per la vendita di gas naturale 12,000000 €/mese
    Energia elettrica
    Servizio fornito in: VIA LUCE 20 - 00100 ROMA RM
    Punto di prelievo (POD): IT001E12345678 Potenza impegnata: 3,00 kW
    Consumo annuo: 1.008 kWh
    Quota per consumi 304 kWh 0,235987 €/kWh
    di cui spesa per la vendita di energia elettrica 0,190954 €/kWh
    Quota fissa 1 mesi 14,02 €/mese
    di cui spesa per la vendita di energia elettrica 12,100000 €/mese
  `);
  assert.equal(PDF_PARSER_VERSION, "v102-validation-completeness-step4");
  assert.equal(result.commodity, "dual");
  assert.equal(result.pdr, "12345678901234");
  assert.equal(result.pod, "IT001E12345678");
  assert.equal(result.indirizzo_fornitura_gas, "VIA GAS 10 - 00100 ROMA RM");
  assert.equal(result.indirizzo_fornitura_luce, "VIA LUCE 20 - 00100 ROMA RM");
  assert.equal(result.prezzo_gas_eur_smc, 0.498828);
  assert.equal(result.prezzo_luce_eur_kwh, 0.190954);
  assert.equal(result.quota_fissa_vendita_gas_eur_anno, 144);
  assert.equal(result.quota_fissa_vendita_luce_eur_anno, 145.2);
});

test("Edison gas: recupera l'indirizzo posto prima di codice cliente e PDR", () => {
  const result = extractPdfDataFromText(`
    Edison Energia Fattura gas naturale Totale da pagare 80 euro.
    Punto di fornitura
    VIA MULINO 19 - 40050 VALSAMOGGIA BO
    Codice Cliente 1001133382
    PDR 03081000466501
    Consumo annuo 1.653,86 Smc
  `);
  assert.equal(result.pdr, "03081000466501");
  assert.equal(result.codice_cliente, "1001133382");
  assert.equal(result.indirizzo_fornitura_gas, "VIA MULINO 19 - 40050 VALSAMOGGIA BO");
});

test("il blocco cliente prevale sulla partita IVA nella sede legale", () => {
  const result = extractPdfDataFromText(`
    Energia Alfa S.p.A. Sede legale Via Fornitore 1 - Partita IVA 10987654321 - Registro imprese - Capitale sociale.
    DATI IDENTIFICATIVI DEL CLIENTE
    CLIENTE AGRICOLO SOC. AGR. Via Cliente 2, 48125 Ravenna RA
    Codice fiscale: 01234567890
    Fattura energia elettrica Totale da pagare 50 euro POD IT001E12345678.
  `);
  assert.equal(result.codice_fiscale, "01234567890");
  assert.equal(result.intestatario, "CLIENTE AGRICOLO SOC. AGR.");
});


test("non usa il consumo idrico in mc come consumo annuo gas", () => {
  const result = extractPdfDataFromText(`
    Fattura multiservizio Totale da pagare 90 euro.
    SERVIZIO IDRICO
    Consumo annuo (mc): 999
    GAS NATURALE
    PDR: 12345678901234
    Coefficiente C: 1,020000
    Consumo del periodo 20 Smc
  `);
  assert.equal(result.commodity, "gas");
  assert.equal(result.consumo_gas_smc, null);
});

test("Estra: conserva il codice fiscale cliente e scarta la PIVA societaria", () => {
  const result = extractPdfDataFromText(`
    MERCATO LIBERO Gas naturale Totale da pagare 50 euro.
    Codice cliente 192695348
    C.F. BNVRRT60L19D704H
    Intestatario fornitura BENEVENTI ROBERTO
    PDR 12345678901234
    Estra Energie S.r.l. - Sede legale - P.IVA e C.F. 01219980529
    Registro imprese - Capitale sociale
  `);
  assert.equal(result.codice_fiscale, "BNVRRT60L19D704H");
  assert.equal(result.intestatario, "BENEVENTI ROBERTO");
  assert.equal(result.customer_type, "privato");
});
