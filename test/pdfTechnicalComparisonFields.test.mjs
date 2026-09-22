import test from "node:test";
import assert from "node:assert/strict";
import { normalizePureAiOutput } from "../lib/pdfPureAiReader.js";

function row(purpose, label, valueNumber = null, valueText = null, unit = null, period = "none") {
  return { purpose, label, value_number: valueNumber, value_text: valueText, unit, period, band: "none", page: 1, confidence: 100, evidence: `${label} ${valueText ?? valueNumber ?? ""}` };
}

test("PDF completo alimenta i campi tecnici espliciti del motore senza deduzioni", () => {
  const monthly = Array.from({ length: 12 }, (_, index) => row(
    "monthly_consumption",
    `2026-${String(index + 1).padStart(2, "0")}`,
    225,
    "225",
    "kWh",
    "month",
  ));

  const parsed = {
    document: {
      kind: "bill",
      commodity: "dual",
      customer_type: "consumer",
      page_count: 12,
      billing_period_start: "2026-08-01",
      billing_period_end: "2026-08-31",
      issue_date: "2026-09-05",
      due_date: "2026-09-25",
      total_amount_eur: 200,
      alerts: [],
    },
    supplies: [
      {
        commodity: "electricity",
        provider: "Test Energia",
        offer_name: "Test Luce",
        offer_code: "L123",
        fields: [
          row("annual_consumption", "Consumo annuo", 2700, "2700", "kWh/anno", "year"),
          row("unit_price", "Materia energia", 0.2, "0,2", "€/kWh"),
          row("fixed_fee", "Commercializzazione", 10, "10", "€/mese", "month"),
          row("power_committed", "Potenza impegnata", 3, "3", "kW"),
          row("residence_status", "Cliente domestico residente", null, "residente"),
          ...monthly,
        ],
      },
      {
        commodity: "gas",
        provider: "Test Energia",
        offer_name: "Test Gas",
        offer_code: "G123",
        fields: [
          row("annual_consumption", "Consumo annuo", 1400, "1400", "Smc/anno", "year"),
          row("unit_price", "Materia gas", 0.7, "0,7", "€/Smc"),
          row("fixed_fee", "Commercializzazione", 10, "10", "€/mese", "month"),
          row("meter_class", "Classe misuratore", null, "G4"),
          row("calorific_value", "Potere calorifico P", 0.03852, "0,03852", "GJ/Smc"),
          row("gas_tariff_area", "Ambito tariffario", null, "Nord-Orientale"),
          row("gas_excise_regime", "Regime accisa", null, "ordinario"),
          row("gas_regional_tax_profile", "Addizionale regionale", null, "Lombardia"),
        ],
      },
    ],
  };

  const normalized = normalizePureAiOutput(parsed, { model: "test-model" });
  assert.equal(normalized.residenza_luce, "residente");
  assert.deepEqual(normalized.consumi_mensili_luce_kwh, Array(12).fill(225));
  assert.equal(normalized.classe_contatore_gas, "g4-g6");
  assert.equal(normalized.potere_calorifico_gas_gj_smc, 0.03852);
  assert.equal(normalized.ambito_tariffario_gas, "nord-orientale");
  assert.equal(normalized.regime_accisa_gas, "ordinario");
  assert.equal(normalized.regime_arisgam_gas, "lombardia");
  assert.equal(normalized.data_contract.fields.residenza_luce.autofill.allowed, true);
  assert.equal(normalized.data_contract.fields.classe_contatore_gas.autofill.allowed, true);
  assert.equal(normalized.data_contract.fields.potere_calorifico_gas_gj_smc.autofill.allowed, true);
  assert.equal(normalized.data_contract.fields.consumi_mensili_luce_kwh.status, "completo");
  assert.equal(normalized.data_contract.fields.consumi_mensili_luce_kwh.autofill.allowed, false);
});
