import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPremiumContractValues,
  matchAndPersistPremiumOffer,
  matchPremiumOfferHistory,
  resetPremiumOfferHistoryCacheForTests,
} from "../lib/premiumOfferMatcher.js";
import { classifyPremiumAutomaticAnalysis } from "../lib/premiumAiBackend.js";

function gasHistory(price = 0.469, overrides = {}) {
  return {
    version: "test-history",
    updatedAt: "2026-08-15",
    offers: [{
      key: "gas:EON-INSIEME",
      recordType: "single",
      commodity: "gas",
      offerCode: "EON-GAS-INSIEME",
      providerName: "E.ON Energia S.p.A.",
      offerName: "E.ON Gas Insieme",
      active: true,
      versions: [{
        catalogDate: "2026-08-01",
        validFrom: "01/08/2026_00:00:00",
        validTo: "31/08/2026_23:59:59",
        priceType: "fisso",
        price,
        annualFixedFee: 108,
        indexName: null,
        spreadEstimate: null,
      }],
      ...overrides,
    }],
  };
}

function gasBill(overrides = {}) {
  return {
    recognized: true,
    kind: "bolletta",
    commodity: "gas",
    issue_date: "2026-08-15",
    billing_period_start: "2026-07-01",
    billing_period_end: "2026-07-31",
    total_amount_eur: 95,
    fornitore_gas: "E.ON Energia",
    nome_offerta_gas: "E.ON Gas Insieme",
    codice_offerta_gas: "",
    consumo_gas_smc: 100,
    prezzo_gas_eur_smc: 0.4984,
    quota_fissa_vendita_gas_eur_anno: 108,
    tipo_prezzo_gas: "fisso",
    document_alerts: [],
    validation_issues: [],
    diagnostics: [{
      field: "prezzo_gas_eur_smc",
      label: "Corrispettivo gas",
      source_snippet: "Corrispettivo gas 0,4984 €/Smc",
    }],
    ...overrides,
  };
}

test("stesso nome ma versione economica diversa non viene certificata né proposta", () => {
  const input = gasBill();
  const match = matchPremiumOfferHistory(input, gasHistory(0.469));
  const values = buildPremiumContractValues(input, match, "https://history.test/offers.json");

  assert.ok(["matched", "ambiguous"].includes(match.status));
  assert.equal(match.verified, false);
  assert.equal(values.verification_status, "needs_review");
  assert.equal(values.customer_confirmation_status, "not_available");
  assert.equal(values.source, "bill");
  assert.equal(values.gas_price_eur_smc, 0.4984);
  assert.equal(values.arera_history_key_gas, "");
  assert.deepEqual(values.automatic_match_candidates, []);
});

test("anche il codice offerta esatto non certifica una versione economica incompatibile", () => {
  const input = gasBill({ codice_offerta_gas: "EON-GAS-INSIEME" });
  const match = matchPremiumOfferHistory(input, gasHistory(0.469));
  const values = buildPremiumContractValues(input, match, "https://history.test/offers.json");

  assert.equal(match.status, "matched");
  assert.equal(match.confidence, 100);
  assert.equal(match.verified, false);
  assert.equal(values.customer_confirmation_status, "not_available");
  assert.equal(values.gas_price_eur_smc, 0.4984);
});

test("una versione economica realmente compatibile può essere verificata automaticamente", () => {
  const input = gasBill({ codice_offerta_gas: "EON-GAS-INSIEME" });
  const match = matchPremiumOfferHistory(input, gasHistory(0.494));
  const values = buildPremiumContractValues(input, match, "https://history.test/offers.json");

  assert.equal(match.verified, true);
  assert.equal(values.verification_status, "verified");
  assert.equal(values.customer_confirmation_status, "not_required");
  assert.equal(values.source, "import");
  assert.equal(values.gas_price_eur_smc, 0.494);
  assert.equal(values.arera_history_key_gas, "gas:EON-INSIEME");
});

test("senza nome e senza codice il fingerprint economico non diventa un contratto verificato", () => {
  const input = gasBill({ nome_offerta_gas: "", codice_offerta_gas: "", prezzo_gas_eur_smc: 0.469 });
  const match = matchPremiumOfferHistory(input, gasHistory(0.469));
  const values = buildPremiumContractValues(input, match, "https://history.test/offers.json");

  assert.equal(match.verified, false);
  assert.equal(values.verification_status, "needs_review");
  assert.equal(values.customer_confirmation_status, "not_available");
  assert.deepEqual(values.automatic_match_candidates, []);
});

test("match compatibile ma non certo produce solo avviso di versione non verificata", () => {
  const screening = classifyPremiumAutomaticAnalysis({
    ...gasBill(),
    _offer_match: {
      status: "matched",
      verified: false,
      confidence: 82,
      method: "provider_offer_name",
    },
  });

  assert.notEqual(screening.trafficLight, "red");
  assert.ok(screening.reasons.some(reason => reason.code === "versione_offerta_non_verificata"));
  assert.ok(!screening.reasons.some(reason => reason.code === "offerta_da_confermare"));
});

test("un vecchio contratto customer_confirmed incerto viene declassato al nuovo controllo", async () => {
  resetPremiumOfferHistoryCacheForTests();
  const current = {
    id: "contract-1",
    user_id: "user-1",
    utility_id: "utility-1",
    provider_name: "E.ON Energia S.p.A.",
    offer_name: "E.ON Gas Insieme",
    pricing_type: "fixed",
    gas_price_eur_smc: 0.469,
    gas_fixed_fee_eur_year: 108,
    source: "import",
    verification_status: "verified",
    is_current: true,
    arera_history_key_electricity: "",
    arera_history_key_gas: "gas:EON-INSIEME",
    automatic_match_status: "matched",
    automatic_match_confidence: 82,
    automatic_match_method: "customer_confirmed",
    automatic_match_candidates: [],
    customer_confirmation_status: "confirmed",
    customer_confirmed_at: "2026-08-15T12:00:00Z",
    customer_rejected_at: null,
    customer_selected_candidates: [],
    customer_confirmation_version: "premium-offer-confirmation-v0.31C",
  };
  let patched = null;
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    const method = init.method || "GET";
    if (target === "https://history.test/offers.json") {
      return new Response(JSON.stringify(gasHistory(0.469)), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.includes("/rest/v1/premium_contracts?") && method === "GET") {
      return new Response(JSON.stringify([current]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.includes("/rest/v1/premium_contracts?") && method === "PATCH") {
      patched = JSON.parse(String(init.body));
      return new Response(JSON.stringify([{ ...current, ...patched }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected ${method} ${target}`);
  };

  const result = await matchAndPersistPremiumOffer({
    config: { supabaseUrl: "https://example.supabase.co", serviceKey: "sb_secret_test" },
    bill: { id: "bill-2", user_id: "user-1", utility_id: "utility-1" },
    normalized: gasBill(),
    fetchImpl,
    env: { ARERA_HISTORY_URL: "https://history.test/offers.json" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.contract.verification_status, "needs_review");
  assert.equal(result.contract.customer_confirmation_status, "not_available");
  assert.equal(result.contract.source, "bill");
  assert.equal(result.contract.gas_price_eur_smc, 0.4984);
  assert.ok(["matched", "ambiguous"].includes(result.status));
  assert.equal(patched.customer_confirmed_at, null);
  assert.deepEqual(patched.automatic_match_candidates, []);
});
