import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  hasComparableOcrCore,
  normalizePdfOcrCandidate,
  normalizePdfOcrText,
} from "../lib/pdfOcrText.js";

test("normalizza SmE/SME e ricostruisce una riga annuale OCR", () => {
  const input = "CONSUMO ANNUO:\nDa 28/02/2025 a 28/02/2026: 120 SME\nConsumo totale 74 SmE";
  const output = normalizePdfOcrText(input);
  assert.match(output, /120 Smc/);
  assert.match(output, /Consumo annuo: 120 Smc/);
  assert.match(output, /74 Smc/);
});

test("il core OCR confrontabile richiede valori positivi, identificativo, consumo e prezzo", () => {
  assert.equal(hasComparableOcrCore({ recognized: true, commodity: "gas", pdr: "03081000752041", consumo_gas_smc: null, prezzo_gas_eur_smc: null }), false);
  assert.equal(hasComparableOcrCore({ recognized: true, commodity: "gas", pdr: "03081000752041", consumo_gas_smc: 120 }), false);
  assert.equal(hasComparableOcrCore({ recognized: true, commodity: "gas", pdr: "03081000752041", consumo_gas_smc: 120, prezzo_gas_eur_smc: 0.6311892 }), true);
});

test("PDR senza POD corregge una falsa classificazione duale OCR", () => {
  const corrected = normalizePdfOcrCandidate({
    recognized: true,
    commodity: "dual",
    pdr: "03081000752041",
    pod: null,
    prezzo_gas_eur_smc: 0.6311892,
    nome_offerta_luce: "RISERVATO AGILE",
    tipo_prezzo_luce: "variabile",
    indice_riferimento_luce: "PSV",
  });
  assert.equal(corrected.commodity, "gas");
  assert.equal(corrected.nome_offerta_gas, "RISERVATO AGILE");
  assert.equal(corrected.tipo_prezzo_gas, "variabile");
  assert.equal(corrected.indice_riferimento_gas, "PSV");
  assert.equal(corrected.nome_offerta_luce, null);
});

test("vercel include esplicitamente gli asset OCR runtime", () => {
  const config = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const include = config.functions["api/analyze-pdf.js"].includeFiles;
  assert.match(include, /pdfium\.wasm/);
  assert.match(include, /ita\.traineddata\.gz/);
  assert.match(include, /tesseract\.js-core/);
  assert.equal(config.functions["api/analyze-pdf.js"].maxDuration, 60);
});
