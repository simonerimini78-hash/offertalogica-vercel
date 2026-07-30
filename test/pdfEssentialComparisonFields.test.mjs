import test from "node:test";
import assert from "node:assert/strict";
import { normalizePureAiOutput } from "../lib/pdfPureAiReader.js";

function row(purpose, label, value, unit, options = {}) {
  return {
    purpose,
    label,
    value_text: options.valueText ?? String(value).replace(".", ","),
    value_number: value,
    unit,
    period: options.period ?? "none",
    band: options.band ?? "none",
    page: options.page ?? 1,
    evidence: options.evidence ?? `${label} ${value} ${unit || ""}`,
    confidence: options.confidence ?? 95,
  };
}

function document(commodity) {
  return { kind: "bill", commodity, customer_type: "consumer", page_count: 12 };
}

test("Alessio: recupera sempre i sei dati essenziali anche se prezzo e fisso sono classificati come componenti", () => {
  const normalized = normalizePureAiOutput({
    document: document("dual"),
    supplies: [
      {
        commodity: "electricity",
        provider: "Hera Comm",
        offer_name: "M Giusto Casa Luce",
        offer_code: null,
        fields: [
          row("other", "Consumo annuo aggiornato al seguente periodo", 2503, "kWh", { evidence: "Consumo annuo aggiornato al seguente periodo 2.503,00 kWh" }),
          row("price_component", "Spesa per la vendita", 0.178147, "€/kWh", { evidence: "di cui spesa per la vendita di energia elettrica 41,33 € 0,178147 €/kWh" }),
          row("price_component", "Spesa per la rete e gli oneri generali", 0.045043, "€/kWh"),
          row("price_component", "Spesa per la vendita", 3.73, "€/mese", { evidence: "di cui spesa per la vendita di energia elettrica 3,73 € 3,730000 €/mese" }),
          row("price_component", "Spesa per la rete e gli oneri generali", 1.92, "€/mese"),
        ],
      },
      {
        commodity: "gas",
        provider: "Hera Comm",
        offer_name: "M Giusto Casa Gas Neve - RV1",
        offer_code: null,
        fields: [
          row("other", "Totale consumo annuo", 542, "Smc", { evidence: "Totale consumo annuo 542,00 Smc" }),
          row("price_component", "Spesa per la vendita", 0.494692, "€/Smc", { evidence: "di cui spesa per la vendita di gas naturale 36,68 € 0,494692 €/Smc" }),
          row("price_component", "Spesa per la rete e gli oneri generali", 0.203245, "€/Smc"),
          row("price_component", "Spesa per la vendita", 4.79, "€/mese", { evidence: "di cui spesa per la vendita di gas naturale 4,79 € 4,790000 €/mese" }),
          row("price_component", "Spesa per la rete e gli oneri generali", 4.19, "€/mese"),
        ],
      },
    ],
  });

  assert.equal(normalized.consumo_luce_kwh, 2503);
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.178147);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, 44.76);
  assert.equal(normalized.consumo_gas_smc, 542);
  assert.equal(normalized.prezzo_gas_eur_smc, 0.494692);
  assert.equal(normalized.quota_fissa_vendita_gas_eur_anno, 57.48);
  assert.equal(normalized.data_contract.readiness.confronto.luce.status, "completo");
  assert.equal(normalized.data_contract.readiness.confronto.gas.status, "completo");
  assert.equal(normalized.comparison_form_raw.supplies[0].fields[1].purpose, "price_component");
  assert.equal(normalized.comparison_form_raw.supplies[1].fields[1].purpose, "price_component");
});

test("Toskino: recupera consumo, prezzo vendita e quota fissa negativa senza scegliere totale o rete", () => {
  const normalized = normalizePureAiOutput({
    document: document("electricity"),
    supplies: [{
      commodity: "electricity",
      provider: "Hera Comm",
      offer_name: "Servizio Tutele Graduali D - Area Centro 1 Domestici",
      offer_code: null,
      fields: [
        row("other", "Consumo annuo", 2743, "kWh", { evidence: "Consumo annuo 2.743,00 kWh" }),
        row("other", "Prezzo medio", 0.149519, "€/kWh", { evidence: "di cui spesa per la vendita di energia elettrica 74,61 € 0,149519 €/kWh" }),
        row("price_component", "Quota fissa e quota potenza", -4.18, "€/mese"),
        row("price_component", "Spesa per la vendita", -6.1, "€/mese", { evidence: "di cui spesa per la vendita di energia elettrica -12,20 € -6,100000 €/mese" }),
        row("price_component", "Spesa per la rete e gli oneri generali", 1.92, "€/mese"),
      ],
    }],
  });

  assert.equal(normalized.consumo_luce_kwh, 2743);
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.149519);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, -73.2);
  assert.equal(normalized.data_contract.readiness.confronto.luce.status, "completo");
});

test("non usa il consumo del periodo e blocca il confronto quando un dato essenziale manca davvero", () => {
  const normalized = normalizePureAiOutput({
    document: document("gas"),
    supplies: [{
      commodity: "gas",
      provider: "Test",
      offer_name: null,
      offer_code: null,
      fields: [
        row("annual_consumption", "Consumi fatturati", 74.147122, "Smc", { evidence: "Periodo oggetto di fatturazione dal 01.03.2026 al 31.03.2026 consumo totale fatturato del periodo 74,147122 Smc" }),
        row("fixed_fee", "Quota fissa vendita", 4.79, "€/mese", { period: "month" }),
      ],
    }],
  });

  assert.equal(normalized.consumo_gas_smc, undefined);
  assert.equal(normalized.prezzo_gas_eur_smc, undefined);
  assert.equal(normalized.data_contract.readiness.confronto.gas.status, "incompleto");
  assert.ok(normalized.data_contract.readiness.confronto.gas.missing.includes("consumo_gas_smc"));
  assert.ok(normalized.data_contract.readiness.confronto.gas.missing.includes("prezzo_gas_eur_smc"));
});
