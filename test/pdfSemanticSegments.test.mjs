import test from "node:test";
import assert from "node:assert/strict";
import { scopedCommodityText, segmentPdfText } from "../lib/pdfSemanticSegments.js";

test("separa i contesti luce e gas in una bolletta dual", () => {
  const source = `
    SERVIZIO IDRICO Consumo annuo 99 mc
    Gas naturale
    Servizio fornito in: VIA GAS 10 - 00100 ROMA RM
    Punto di riconsegna (PDR): 12345678901234
    Quota per consumi 120 Smc 0,700000 €/Smc
    Nome offerta: OFFERTA GAS
    Energia elettrica
    Servizio fornito in: VIA LUCE 20 - 00100 ROMA RM
    Punto di prelievo (POD): IT001E12345678
    Quota per consumi 300 kWh 0,200000 €/kWh
    Nome offerta: OFFERTA LUCE
  `;
  const segments = segmentPdfText(source);
  const luce = scopedCommodityText(segments, "luce", source);
  const gas = scopedCommodityText(segments, "gas", source);
  assert.match(luce, /IT001E12345678/);
  assert.match(luce, /0,200000\s*€\/kWh/i);
  assert.match(gas, /12345678901234/);
  assert.match(gas, /0,700000\s*€\/Smc/i);
  assert.match(segments.offer.gas.text, /OFFERTA GAS/);
  assert.doesNotMatch(segments.offer.gas.text, /OFFERTA LUCE/);
  assert.match(segments.offer.luce.text, /OFFERTA LUCE/);
  assert.doesNotMatch(segments.offer.luce.text, /OFFERTA GAS/);
  assert.ok(segments.excluded.marker_count >= 1);
});

test("isola il blocco cliente dalle informazioni societarie del fornitore", () => {
  const source = `
    Energia Alfa S.p.A. Sede legale Via Fornitore 1
    Registro imprese - Partita IVA 10987654321 - Capitale sociale
    DATI IDENTIFICATIVI DEL CLIENTE
    CLIENTE AGRICOLO SOC. AGR.
    Via Cliente 2, 48125 Ravenna RA
    Codice fiscale 01234567890
  `;
  const segments = segmentPdfText(source);
  assert.match(segments.customer.text, /CLIENTE AGRICOLO/);
  assert.match(segments.supplier.text, /10987654321/);
  assert.ok(segments.customer.marker_count >= 1);
  assert.ok(segments.supplier.marker_count >= 1);
});

test("usa il testo completo come fallback quando manca un segmento affidabile", () => {
  const source = "Fattura generica senza marcatori tecnici";
  const segments = segmentPdfText(source);
  assert.equal(scopedCommodityText(segments, "luce", source), source);
  assert.equal(scopedCommodityText(segments, "gas", source), source);
});
