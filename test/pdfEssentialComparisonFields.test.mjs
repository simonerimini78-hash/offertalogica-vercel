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


test("Dolomiti reale: accetta mc come consumo annuo gas senza confonderlo con un prezzo", () => {
  const normalized = normalizePureAiOutput({
    document: document("gas"),
    supplies: [{
      commodity: "gas",
      provider: "Dolomiti Energia Mercato SpA",
      offer_name: "GAS ITALY CASA_R",
      offer_code: null,
      fields: [
        row("annual_consumption", "Consumo annuo (mc)", 1883, "mc", {
          valueText: "1.883",
          period: "year",
          page: 1,
          evidence: "Consumo annuo (mc) 1.883 1883 mc",
        }),
        row("unit_price", "Prezzo medio unitario spesa per vendita gas naturale", 0.687459, "€/Smc", {
          page: 2,
          evidence: "Prezzo medio unitario spesa per vendita gas naturale 0,687459 €/Smc",
        }),
        row("fixed_fee", "Quota fissa vendita gas naturale", 12, "€/mese", {
          period: "month",
          page: 3,
          evidence: "Quota fissa vendita gas naturale 12,00 €/mese",
        }),
      ],
    }],
  });

  assert.equal(normalized.consumo_gas_smc, 1883);
  assert.equal(normalized.prezzo_gas_eur_smc, 0.687459);
  assert.equal(normalized.quota_fissa_vendita_gas_eur_anno, 144);
  assert.equal(normalized.data_contract.readiness.confronto.gas.status, "completo");
});

test("mc resta escluso quando indica il consumo del solo periodo fatturato", () => {
  const normalized = normalizePureAiOutput({
    document: document("gas"),
    supplies: [{
      commodity: "gas",
      provider: "Test",
      offer_name: null,
      offer_code: null,
      fields: [
        row("annual_consumption", "Consumi fatturati", 74.147122, "mc", {
          period: "month",
          evidence: "Periodo oggetto di fatturazione dal 01.03.2026 al 31.03.2026 consumo totale fatturato del periodo 74,147122 mc",
        }),
      ],
    }],
  });

  assert.equal(normalized.consumo_gas_smc, undefined);
  assert.ok(normalized.data_contract.readiness.confronto.gas.missing.includes("consumo_gas_smc"));
});

test("un importo espresso in euro per mc non viene mai usato come consumo gas", () => {
  const normalized = normalizePureAiOutput({
    document: document("gas"),
    supplies: [{
      commodity: "gas",
      provider: "Test",
      offer_name: null,
      offer_code: null,
      fields: [
        row("annual_consumption", "Consumo annuo", 0.960322, "€/mc", {
          period: "year",
          evidence: "Tariffa acquedotto 0,960322 €/mc",
        }),
      ],
    }],
  });

  assert.equal(normalized.consumo_gas_smc, undefined);
});

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractPdfPureAi } from "../lib/pdfPureAiReader.js";

function toskinoPrimaryWithoutSinglePrice() {
  return {
    document: document("electricity"),
    supplies: [{
      commodity: "electricity",
      provider: "Hera Comm",
      offer_name: "Servizio Tutele Graduali D - Area Centro 1 Domestici",
      offer_code: "000415ENVFT00DXSERV_TUT_GRADUALI",
      fields: [
        row("annual_consumption", "Consumo annuo", 2743, "kWh", { period: "year", evidence: "Consumo annuo 2.743,00 kWh" }),
        row("band_consumption", "Consumo annuo F1", 1001, "kWh", { period: "year", band: "f1" }),
        row("band_consumption", "Consumo annuo F2+F3", 1742, "kWh", { period: "year", band: "f23" }),
        row("band_price", "Corrispettivo CELD fascia F1", null, "€/kWh", { band: "f1", valueText: "0,122252 - 0,117891", evidence: "Corrispettivo CELD fascia F1 0,122252 0,117891 €/kWh" }),
        row("band_price", "Corrispettivo CELD fascia F2", null, "€/kWh", { band: "f2", valueText: "0,152087 - 0,144582", evidence: "Corrispettivo CELD fascia F2 0,152087 0,144582 €/kWh" }),
        row("band_price", "Corrispettivo CELD fascia F3", null, "€/kWh", { band: "f3", valueText: "0,128295 - 0,132897", evidence: "Corrispettivo CELD fascia F3 0,128295 0,132897 €/kWh" }),
        row("price_component", "Dispacciamento (CDISPD)", 0.015531, "€/kWh"),
        row("price_component", "Sbilanciamento (CSED)", 0.00056, "€/kWh"),
        row("price_component", "Componente di perequazione (CPSTGD)", 0.00214, "€/kWh"),
        row("fixed_fee", "Quota fissa vendita energia elettrica", -6.1, "€/mese", { period: "month", evidence: "Quota fissa vendita energia elettrica -6,10 €/mese" }),
        row("price_type", "Tipologia di offerta", null, null, { valueText: "variabile" }),
        row("price_structure", "Tipologia di prezzo", null, null, { valueText: "Fasce" }),
        row("index", "Indice di riferimento", null, null, { valueText: "PUN Index GME" }),
        row("formula", "Formula di calcolo prezzo", null, null, { valueText: "Corrispettivo CELD fascia F1/F2/F3 + Dispacciamento + Sbilanciamento + Perequazione" }),
      ],
    }],
  };
}

function toskinoTargetedRecovery(label = "di cui spesa per la vendita di energia elettrica", value = 0.149519) {
  return {
    document: document("electricity"),
    supplies: [{
      commodity: "electricity",
      provider: null,
      offer_name: null,
      offer_code: null,
      fields: [row("unit_price", label, value, "€/kWh", {
        evidence: `${label} 74,61 € ${String(value).replace(".", ",")} €/kWh`,
        page: 6,
        confidence: 99,
      })],
    }],
  };
}

test("Toskino reale: le fasce con due mesi non vengono trasformate in un numero inventato", () => {
  const normalized = normalizePureAiOutput(toskinoPrimaryWithoutSinglePrice());
  assert.equal(normalized.consumo_luce_kwh, 2743);
  assert.equal(normalized.prezzo_luce_eur_kwh, undefined);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, -73.2);
  assert.equal(normalized.data_contract.readiness.confronto.luce.status, "incompleto");
  assert.ok(normalized.data_contract.readiness.confronto.luce.missing.includes("prezzo_luce_eur_kwh"));
});

test("seconda lettura mirata recupera il prezzo medio vendita omesso nella prima risposta", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "offertalogica-essential-recovery-"));
  const pdf = path.join(dir, "bolletta.pdf");
  await writeFile(pdf, Buffer.from("%PDF-1.4\n% test\n"));
  const calls = [];
  try {
    const result = await extractPdfPureAi({
      filePath: pdf,
      filename: "bolletta.hera.toskino1.pdf",
      apiKey: "test-key",
      env: { PDF_AI_TIMEOUT_MS: "45000", PDF_AI_FILE_ID_THRESHOLD_BYTES: "12000000" },
      transport: async ({ request, attempt, profile }) => {
        calls.push({ request, attempt, profile });
        return attempt === 1
          ? { id: "resp-primary", output_text: JSON.stringify(toskinoPrimaryWithoutSinglePrice()) }
          : { id: "resp-recovery", output_text: JSON.stringify(toskinoTargetedRecovery()) };
      },
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].profile, "ia_libera_compact_form_v3_2");
    assert.equal(calls[1].profile, "ia_libera_essential_recovery_v1");
    assert.match(calls[0].request.input[0].content[0].text, /Scontrino dell’energia/);
    assert.match(calls[1].request.input[1].content[1].text, /electricity: unit_price/);
    assert.equal(result.prezzo_luce_eur_kwh, 0.149519);
    assert.equal(result.consumo_luce_kwh, 2743);
    assert.equal(result.quota_fissa_vendita_luce_eur_anno, -73.2);
    assert.equal(result.data_contract.readiness.confronto.luce.status, "completo");
    assert.equal(result.ai.recovery_attempted, true);
    assert.equal(result.ai.recovered_from, "ia_libera_essential_recovery_v1");
    assert.equal(result.ai.openai_attempts, 2);
    assert.deepEqual(result.ai.essential_missing_after, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("la seconda lettura non accetta il totale quota consumi come prezzo materia", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "offertalogica-essential-recovery-reject-"));
  const pdf = path.join(dir, "bolletta.pdf");
  await writeFile(pdf, Buffer.from("%PDF-1.4\n% test\n"));
  try {
    const result = await extractPdfPureAi({
      filePath: pdf,
      apiKey: "test-key",
      env: { PDF_AI_TIMEOUT_MS: "45000", PDF_AI_FILE_ID_THRESHOLD_BYTES: "12000000" },
      transport: async ({ attempt }) => attempt === 1
        ? { id: "resp-primary", output_text: JSON.stringify(toskinoPrimaryWithoutSinglePrice()) }
        : { id: "resp-recovery", output_text: JSON.stringify(toskinoTargetedRecovery("Quota per consumi", 0.194549)) },
    });

    assert.equal(result.prezzo_luce_eur_kwh, undefined);
    assert.equal(result.data_contract.readiness.confronto.luce.status, "incompleto");
    assert.equal(result.ai.recovery_attempted, true);
    assert.equal(result.ai.recovered_from, null);
    assert.equal(result.ai.recovery_error, "essential_recovery_no_improvement");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
