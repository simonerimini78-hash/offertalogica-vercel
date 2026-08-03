import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPremiumContractValues,
  matchPremiumOfferHistory,
} from "../lib/premiumOfferMatcher.js";

function version(overrides = {}) {
  return {
    catalogDate: "2026-08-03",
    validFrom: "01/07/2026_00:00:00",
    validTo: "31/08/2026_23:59:59",
    priceType: "fisso",
    price: 0.13,
    annualFixedFee: 120,
    indexName: null,
    spreadEstimate: null,
    ...overrides,
  };
}

function record(overrides = {}) {
  return {
    key: "luce:ABC123",
    recordType: "single",
    commodity: "luce",
    offerCode: "ABC123",
    providerName: "A2A Energia",
    offerName: "A2A Click Luce",
    customerType: "privato",
    active: true,
    versions: [version()],
    ...overrides,
  };
}

function normalized(overrides = {}) {
  return {
    commodity: "luce",
    issue_date: "2026-08-03",
    fornitore_luce: "A2A Energia",
    nome_offerta_luce: "A2A Click Luce",
    codice_offerta_luce: "ABC123",
    tipo_prezzo_luce: "fisso",
    prezzo_luce_eur_kwh: 0.13,
    quota_fissa_vendita_luce_eur_anno: 120,
    ...overrides,
  };
}

test("codice offerta esatto produce match verificato", () => {
  const result = matchPremiumOfferHistory(normalized(), {
    version: "arera-history-2026-08-03",
    updatedAt: "2026-08-03",
    offers: [record()],
  });
  assert.equal(result.status, "matched");
  assert.equal(result.verified, true);
  assert.equal(result.confidence, 100);
  assert.equal(result.supplies[0].method, "offer_code");
});

test("nome, fornitore e condizioni coerenti producono match forte", () => {
  const result = matchPremiumOfferHistory(normalized({ codice_offerta_luce: "" }), {
    version: "arera-history-2026-08-03",
    updatedAt: "2026-08-03",
    offers: [
      record(),
      record({
        key: "luce:OTHER",
        offerCode: "OTHER",
        offerName: "A2A Easy Luce",
        versions: [version({ price: 0.16, annualFixedFee: 150 })],
      }),
    ],
  });
  assert.equal(result.status, "matched");
  assert.equal(result.verified, true);
  assert.ok(result.confidence >= 90);
});

test("due offerte troppo simili restano ambigue", () => {
  const input = normalized({
    codice_offerta_luce: "",
    nome_offerta_luce: "Casa Luce",
    prezzo_luce_eur_kwh: null,
    quota_fissa_vendita_luce_eur_anno: null,
  });
  const result = matchPremiumOfferHistory(input, {
    version: "arera-history-2026-08-03",
    updatedAt: "2026-08-03",
    offers: [
      record({ key: "luce:ONE", offerCode: "ONE", offerName: "Casa Luce Uno" }),
      record({ key: "luce:TWO", offerCode: "TWO", offerName: "Casa Luce Due" }),
    ],
  });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.verified, false);
});

test("offerta indicizzata salva indice e spread ma non un prezzo fisso", () => {
  const input = normalized({
    tipo_prezzo_luce: "variabile",
    prezzo_luce_eur_kwh: 0.14,
    indice_riferimento_luce: "PUN",
    spread_luce_eur_kwh: 0.02,
    formula_prezzo_luce: "PUN + 0,02 €/kWh",
  });
  const history = {
    version: "arera-history-2026-08-03",
    updatedAt: "2026-08-03",
    offers: [
      record({
        versions: [version({
          priceType: "variabile",
          price: 0.14,
          indexName: "PUN",
          spreadEstimate: 0.02,
        })],
      }),
    ],
  };
  const match = matchPremiumOfferHistory(input, history);
  const values = buildPremiumContractValues(input, match, "https://example.test/history.json");
  assert.equal(values.pricing_type, "indexed");
  assert.equal(values.electricity_price_eur_kwh, null);
  assert.equal(values.electricity_index_name, "PUN");
  assert.equal(values.electricity_spread_eur_kwh, 0.02);
  assert.equal(values.electricity_formula, "PUN + 0,02 €/kWh");
});

test("assenza di corrispondenza crea valori provvisori da bolletta", () => {
  const input = normalized({
    fornitore_luce: "Fornitore Sconosciuto",
    nome_offerta_luce: "Offerta Riservata",
    codice_offerta_luce: "",
  });
  const match = matchPremiumOfferHistory(input, {
    version: "arera-history-2026-08-03",
    updatedAt: "2026-08-03",
    offers: [record()],
  });
  const values = buildPremiumContractValues(input, match, "https://example.test/history.json");
  assert.equal(match.status, "not_found");
  assert.equal(values.source, "bill");
  assert.equal(values.verification_status, "needs_review");
  assert.equal(values.provider_name, "Fornitore Sconosciuto");
  assert.equal(values.offer_name, "Offerta Riservata");
});

test("codice dual viene risolto nei due codici componente", () => {
  const light = record();
  const gas = record({
    key: "gas:GAS123",
    commodity: "gas",
    offerCode: "GAS123",
    offerName: "A2A Click Gas",
    versions: [version({ price: 0.49, annualFixedFee: 120 })],
  });
  const dual = {
    key: "dual:DUAL123",
    recordType: "dual",
    commodity: "dual",
    offerCode: "DUAL123",
    providerName: "A2A Energia",
    offerName: "A2A Click Luce e Gas",
    active: true,
    versions: [{
      catalogDate: "2026-08-03",
      electricityOfferCode: "ABC123",
      gasOfferCode: "GAS123",
    }],
  };
  const input = {
    ...normalized({
      commodity: "dual",
      codice_offerta_luce: "DUAL123",
      codice_offerta_gas: "DUAL123",
      fornitore_gas: "A2A Energia",
      nome_offerta_gas: "A2A Click Gas",
      tipo_prezzo_gas: "fisso",
      prezzo_gas_eur_smc: 0.49,
      quota_fissa_vendita_gas_eur_anno: 120,
    }),
  };
  const result = matchPremiumOfferHistory(input, {
    version: "arera-history-2026-08-03",
    updatedAt: "2026-08-03",
    offers: [light, gas, dual],
  });
  assert.equal(result.status, "matched");
  assert.equal(result.verified, true);
  assert.equal(result.supplies.length, 2);
  assert.equal(result.supplies[1].candidate.record.offerCode, "GAS123");
});
