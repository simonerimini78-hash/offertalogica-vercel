import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  PDF_PURE_AI_READER_VERSION,
  buildPdfPureAiRequest,
  extractPdfPureAi,
  normalizePureAiOutput,
} from "../lib/pdfPureAiReader.js";

const value = (number, text, unit, label, evidence, page = 1, period = "none") => ({
  value: number, value_text: text, unit, period, page, label, evidence, confidence: 100,
});

function gasOutput() {
  return {
    document: { kind: "bill", commodity: "gas", customer_type: "consumer", page_count: 11 },
    supplies: [{
      commodity: "gas", provider: "Dolomiti Energia Mercato SpA", offer_name: "GAS ITALY CASA_R", offer_code: "000139GPVML01XXW70860WR000000000",
      annual_consumption: value(1883, "1.883", "Smc/anno", "CONSUMO ANNUO", "CONSUMO ANNUO mc 1.883 FINO AL 31/03/26", 4),
      annual_band_consumptions: [],
      primary_price: value(0.687479, "0,687479", "€/Smc", "materia prima gas", "SPESA PER LA VENDITA materia prima gas €/Smc 0,687479", 7),
      price_items: [
        { label: "MATERIA PRIMA GAS", value: 0.565747, value_text: "0,565747", unit: "€/Smc", period: "none", band: null, page: 3, evidence: "MATERIA PRIMA GAS 0,565747", confidence: 100 },
        { label: "SPREAD", value: 0.121732, value_text: "0,121732", unit: "€/Smc", period: "none", band: null, page: 3, evidence: "SPREAD 0,121732", confidence: 100 },
      ],
      fixed_fee: value(12, "12,000000", "€/pdr/mese", "commercializzazione vendita fissa", "commercializzazione vendita fissa 12,000000 €/pdr/mese", 7, "month"),
      price_type: "variable", price_structure: "binomia", index: "PSVDA", multiplier: null, spread: 0.121732,
      formula: "MATERIA PRIMA GAS + SPREAD", periodicity: "mensile", committed_power_kw: null, available_power_kw: null,
      pricing_page: 3, pricing_evidence: "MATERIA PRIMA GAS 0,565747 SPREAD 0,121732", confidence: 100,
    }],
    additional_data: [],
  };
}

test("richiesta IA libera usa il modulo diretto e una lista economica aperta", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ia-libera-form-"));
  const filePath = path.join(dir, "bolletta.pdf");
  await fs.writeFile(filePath, "%PDF-test");
  const request = await buildPdfPureAiRequest({ filePath, model: "test-model" });
  const schema = request.text.format.schema;
  const supply = schema.properties.supplies.items.properties;
  assert.equal(request.text.format.name, "offertalogica_ia_libera_direct_form");
  assert.deepEqual(schema.required, ["document", "supplies", "additional_data"]);
  assert.ok(supply.primary_price);
  assert.ok(supply.price_items);
  assert.equal(supply.price, undefined);
  assert.equal(supply.single, undefined);
  assert.match(request.input[0].content[0].text, /Non adattare il documento a uno schema tariffario predefinito/);
  await fs.rm(dir, { recursive: true, force: true });
});

test("Dolomiti: il prezzo presente nel documento arriva direttamente al modulo", () => {
  const normalized = normalizePureAiOutput(gasOutput(), { model: "test-model" });
  assert.equal(normalized.prezzo_gas_eur_smc, 0.687479);
  assert.equal(normalized.consumo_gas_smc, 1883);
  assert.equal(normalized.quota_fissa_vendita_gas_eur_anno, 144);
  assert.equal(normalized.readiness.confronto.gas.status, "completo");
  assert.equal(normalized.data_contract.fields.prezzo_gas_eur_smc.autofill.allowed, true);
  assert.equal(normalized.adaptive_form.supplies[0].price_items.length, 2);
});

test("catena di custodia conserva il raw IA separato dal normalizzato", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ia-libera-trace-"));
  const filePath = path.join(dir, "bolletta.pdf");
  await fs.writeFile(filePath, "%PDF-test");
  const raw = gasOutput();
  const normalized = await extractPdfPureAi({
    filePath, apiKey: "test-key", model: "test-model",
    transport: async () => ({ id: "resp_test", output_text: JSON.stringify(raw) }),
    env: { PDF_AI_TIMEOUT_MS: "9000", PDF_AI_FILE_ID_THRESHOLD_BYTES: "12000000" },
  });
  assert.equal(normalized.ai.reader_version, PDF_PURE_AI_READER_VERSION);
  assert.equal(normalized._reader_trace.raw_ai.supplies[0].primary_price.value, 0.687479);
  assert.equal(normalized.prezzo_gas_eur_smc, 0.687479);
  await fs.rm(dir, { recursive: true, force: true });
});
