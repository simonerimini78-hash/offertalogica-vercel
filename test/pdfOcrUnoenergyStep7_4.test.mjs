import test from "node:test";
import assert from "node:assert/strict";
import { extractPdfDataFromText } from "../lib/pdfExtract.js";
import { normalizePdfOcrCandidate, normalizePdfOcrText } from "../lib/pdfOcrText.js";
import { PDF_OCR_PIPELINE_VERSION } from "../lib/pdfOcrPolicy.js";

function parsedCandidate(raw) {
  const text = normalizePdfOcrText(raw);
  return normalizePdfOcrCandidate(extractPdfDataFromText(text), { text });
}

test("Step 7.4 recupera i dati economici Unoenergy luce dalla tabella OCR", () => {
  const result = parsedCandidate(`
@ unoenergy
BENEVENTI ROBERTA
VIA DECIO RAGGI 195
47121 FORLI (FC)
C.F. BNVRRT60L59D704L
CONSUMO ANNUO: Da 31/03/2025 a 31/03/2026 : 573 kWh
ENERGIA ELETTRICA - Servizio Mercato Libero
Codice cliente POD
10095846 IT001E48606003
SCONTRINO DELL'ENERGIA
INDIRIZZO FORNITURA: VIA DECIO RAGGI 195 - 47121 FORLI FC
POD/PDR: IT001E48606003
POTENZA IMPIEGATA: 3,00 KW
Di cui spesa perla vendita d'energia elettica | 0,175360 €
NOME OFFERTA: RISERVATO AGILE
PREZZO INDICIZZATO MENSILE
PER FASCE
Prezzo = (PUN medio mensile Fascia N + Spread Fascia N) + Prezzo Dispacciamento
SPREAD_F1 0,012500
SPREAD_F2 0,012500
SPREAD_F3 0,012500
PUN_MEDIO_MESE_F1 0,143020
OCR_CROP_SCONTRINO
Quota per consumi 125 0,220480 €
Di cui spesa per la vendita di energia elettrica 0,175360 €
Di cui spesa per la rete e gli oneri 0,045120 €
Quota Fissa 74700006
Di cui spesa per la vendita di energia elettrica 5,5560000 €
1 920000€
Quota potenza
`);

  assert.equal(result.commodity, "luce");
  assert.equal(result.prezzo_luce_eur_kwh, 0.17536);
  assert.equal(result.quota_fissa_vendita_luce_eur_anno, 66.6);
  assert.equal(result.potenza_impegnata_kw, 3);
  assert.equal(result.codice_cliente, "10095846");
  assert.equal(result.intestatario, "BENEVENTI ROBERTA");
  assert.equal(result.indirizzo_fornitura_luce, "VIA DECIO RAGGI 195 - 47121 FORLI FC");
  assert.equal(result.indice_riferimento_luce, "PUN");
  assert.equal(result.struttura_prezzo_luce, "per fasce");
  assert.equal(result.periodicita_aggiornamento_indice_luce, "mensile");
  assert.equal(result.spread_luce_eur_kwh, 0.0125);
  assert.ok(result.warnings.includes("quota_fissa_luce_ocr_derivata_da_triad_tabella"));
  assert.ok(result.warnings.includes("spread_luce_ocr_unita_inferita_da_formula_pun"));
});

test("Step 7.4 converte lo spread gas €/GJ soltanto con formula moltiplicativa e PCS", () => {
  const result = parsedCandidate(`
@ unoenergy
Gas Naturale - Servizio Mercato Libero
Codice Cliente 10095846 PDR 03081000752041
SCONTRINO DELL'ENERGIA
INDIRIZZO DI FORNITURA: VIA DECIO RAGGI 195 - 47121 FORLI FC
POD/PDR: 03081000752041
CONSUMO ANNUO: Da 28/02/2025 a 28/02/2026: 120 Smc
Di cui spesa per la vendita di gas naturale 0,6311892 €/Smc
Quota fissa Di cui spesa per la vendita di gas naturale 5,610000 €/mese
NOME OFFERTA: RISERVATO AGILE
PREZZO INDICIZZATO MENSILE
Prezzo = [Prezzo PSV_mese(€/GJ) + Spread(€/GJ)] * PCS_località(GJ/Smc)
SPREAD 3,8139622
PREZZO PCS GJ/0.038466
SPREAD 3,813622
PREZZO PCS GJ 0.038466
Indice di riferimento PSV MESE
Periodicità aggiornamento indice MENSILE
`);

  assert.equal(result.commodity, "gas");
  assert.equal(result.spread_gas_eur_smc, 0.1466948);
  assert.notEqual(result.spread_gas_eur_smc, 3.8139622);
  assert.ok(result.warnings.includes("spread_gas_ocr_derivato_da_eur_gj_per_pcs"));
});

test("Step 7.4 non converte lo spread gas senza il segno di moltiplicazione", () => {
  const result = parsedCandidate(`
unoenergy Gas Naturale PDR 03081000752041
NOME OFFERTA: RISERVATO AGILE
SPREAD 3,813622
PREZZO PCS GJ 0.038466
`);
  assert.equal(result.spread_gas_eur_smc, null);
});

test("Step 7.4 espone la nuova versione della pipeline", () => {
  assert.equal(PDF_OCR_PIPELINE_VERSION, "v105.6-ocr-large-photo-scaling-1");
});
