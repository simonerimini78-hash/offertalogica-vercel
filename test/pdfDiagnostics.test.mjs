import test from "node:test";
import assert from "node:assert/strict";
import { buildPdfDiagnostics, extractPdfDataFromText, PDF_PARSER_VERSION } from "../lib/pdfExtract.js";

test("diagnostica luce distingue campi mancanti e non applicabili", () => {
  const page = `
    Dolomiti Energia Fattura energia elettrica
    Tipologia cliente: domestico residente
    Contratto intestato a MARIO ROSSI
    Codice Fiscale: RSSMRA80A01H501U
    Codice cliente: 12345678
    Indirizzo di fornitura: VIA ROMA 1, BOLOGNA
    Consumo annuo (kWh): 2.700
    Codice POD: IT001E12345678
    Potenza impegnata: 3 kW
    di cui spesa per vendita energia elettrica 0,183957 €/kWh
    QUOTA FISSA di cui spesa per vendita energia elettrica 10,430000 €/mese
  `;
  const normalized = extractPdfDataFromText(page);
  const diagnostics = buildPdfDiagnostics(normalized, [page]);
  const byField = Object.fromEntries(diagnostics.map((item) => [item.field, item]));

  assert.equal(normalized.parser_version, PDF_PARSER_VERSION);
  assert.equal(byField.consumo_luce_kwh.page, 1);
  assert.equal(byField.consumo_luce_kwh.required, true);
  assert.equal(byField.consumo_gas_smc.status, "not_applicable");
  assert.equal(byField.pdr.status, "not_applicable");
  assert.equal(byField.pod.status, "found");
});

test("scheda variabile richiede indice e spread ma non prezzo fisso", () => {
  const page = `
    Scheda sintetica
    Offerta a prezzo variabile per la fornitura di Energia Elettrica - Clienti non domestici
    E.ON LuceDinamica Click ECO - codice offerta: 000362ESVFL01XXZM36R0M000000A000
    Indice di riferimento: PUN Index GME
    Totale PUN Index GME*1,1+0,0278 €/kWh
    Costo fisso anno 192,71 €/anno
  `;
  const normalized = extractPdfDataFromText(page);
  const diagnostics = buildPdfDiagnostics(normalized, [page]);
  const byField = Object.fromEntries(diagnostics.map((item) => [item.field, item]));

  assert.equal(byField.indice_riferimento.required, true);
  assert.equal(byField.spread_luce_eur_kwh.required, true);
  assert.equal(byField.prezzo_luce_eur_kwh.required, false);
  assert.equal(byField.prezzo_luce_eur_kwh.status, "optional_missing");
  assert.equal(byField.codice_fiscale.status, "not_applicable");
});
