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
