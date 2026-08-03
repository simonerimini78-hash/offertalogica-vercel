import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  classifyPremiumAutomaticAnalysis,
  PREMIUM_TRAFFIC_LIGHT_POLICY,
  qualifiesForBetterOfferWarning,
  sanitizePremiumAnalysisData,
} from "../lib/premiumAiBackend.js";

const appBills = await readFile(new URL("../public/app-premium-bills.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/premium-traffic-light-v0.36.3.sql", import.meta.url), "utf8");
const verifyMigration = await readFile(new URL("../supabase/premium-traffic-light-v0.36.3-verify.sql", import.meta.url), "utf8");
const api = await readFile(new URL("../api/premium-ai-analysis.js", import.meta.url), "utf8");

function completeLight(overrides = {}) {
  return {
    recognized: true,
    kind: "bolletta",
    commodity: "luce",
    total_amount_eur: 148.62,
    billing_period_start: "2026-06-01",
    billing_period_end: "2026-06-30",
    issue_date: "2026-07-03",
    due_date: "2026-07-20",
    fornitore_luce: "Fornitore Test",
    consumo_luce_kwh: 2200,
    prezzo_luce_eur_kwh: 0.12,
    quota_fissa_vendita_luce_eur_anno: 96,
    tipo_prezzo_luce: "fisso",
    document_alerts: [],
    validation_issues: [],
    ...overrides,
  };
}

test("v0.36.3 usa verde, giallo e rosso senza nuovi stati database", () => {
  const green = classifyPremiumAutomaticAnalysis(completeLight());
  assert.equal(green.status, "clear");
  assert.equal(green.trafficLight, "green");
  assert.equal(green.staffReviewAllowed, false);

  const yellow = classifyPremiumAutomaticAnalysis(completeLight({ prezzo_luce_eur_kwh: null }));
  assert.equal(yellow.status, "inconclusive");
  assert.equal(yellow.trafficLight, "yellow");
  assert.equal(yellow.staffReviewAllowed, false);

  const red = classifyPremiumAutomaticAnalysis(completeLight(), {
    contract: {
      provider_name: "Fornitore Test",
      pricing_type: "fixed",
      electricity_price_eur_kwh: 0.08,
      electricity_fixed_fee_eur_year: 96,
    },
  });
  assert.equal(red.status, "review_recommended");
  assert.equal(red.trafficLight, "red");
  assert.equal(red.staffReviewAllowed, true);
});

test("un conguaglio diventa rosso soltanto quando è importante", () => {
  const medium = classifyPremiumAutomaticAnalysis(completeLight({
    document_alerts: [{ code: "conguaglio", title: "Conguaglio", description: "Ricalcolo presente.", severity: "medium" }],
  }));
  assert.equal(medium.trafficLight, "yellow");

  const high = classifyPremiumAutomaticAnalysis(completeLight({
    document_alerts: [{ code: "conguaglio", title: "Conguaglio importante", description: "Ricalcolo economicamente rilevante.", severity: "high" }],
  }));
  assert.equal(high.trafficLight, "red");
  assert.equal(high.staffReviewAllowed, true);
});

test("scadenza e offerta non riconosciuta restano gialle", () => {
  const expiry = classifyPremiumAutomaticAnalysis(completeLight({
    scadenza_condizioni_economiche_luce: "2026-10-15",
    document_alerts: [{ code: "scadenza_condizioni", title: "Condizioni in scadenza", description: "Scadenza vicina.", severity: "medium" }],
  }), { now: new Date("2026-08-03T00:00:00Z") });
  assert.equal(expiry.trafficLight, "yellow");
  assert.equal(expiry.staffReviewAllowed, false);

  const unknownOffer = classifyPremiumAutomaticAnalysis(completeLight({
    _offer_match: { status: "not_found", verified: false },
  }));
  assert.equal(unknownOffer.trafficLight, "yellow");
  assert.ok(unknownOffer.reasons.some(reason => reason.code === "offerta_non_riconosciuta"));
});

test("l’avviso offerta migliore richiede storico affidabile, scadenza e soglia economica", () => {
  assert.equal(PREMIUM_TRAFFIC_LIGHT_POLICY.singleUtilitySavingThresholdEur, 60);
  assert.equal(PREMIUM_TRAFFIC_LIGHT_POLICY.dualSavingThresholdEur, 100);
  assert.equal(qualifiesForBetterOfferWarning({ savingEur: 60, scope: "single", annualDataReliable: true, nearExpiry: true }), false);
  assert.equal(qualifiesForBetterOfferWarning({ savingEur: 60.01, scope: "single", annualDataReliable: true, nearExpiry: true }), true);
  assert.equal(qualifiesForBetterOfferWarning({ savingEur: 100, scope: "dual", annualDataReliable: true, nearExpiry: true }), false);
  assert.equal(qualifiesForBetterOfferWarning({ savingEur: 100.01, scope: "dual", annualDataReliable: true, nearExpiry: true }), true);
  assert.equal(qualifiesForBetterOfferWarning({ savingEur: 200, scope: "single", annualDataReliable: false, nearExpiry: true }), false);
  assert.equal(qualifiesForBetterOfferWarning({ savingEur: 200, scope: "single", annualDataReliable: true, nearExpiry: false }), false);

  const below = classifyPremiumAutomaticAnalysis(completeLight(), {
    savingOpportunity: { savingEur: 60, scope: "single", annualDataReliable: true, nearExpiry: true },
  });
  assert.equal(below.trafficLight, "green");

  const above = classifyPremiumAutomaticAnalysis(completeLight(), {
    savingOpportunity: { savingEur: 75, scope: "single", annualDataReliable: true, nearExpiry: true },
  });
  assert.equal(above.trafficLight, "yellow");
  assert.ok(above.reasons.some(reason => reason.code === "offerta_migliore_disponibile"));
});

test("il flag interno richiede staff soltanto sul rosso", () => {
  const yellow = classifyPremiumAutomaticAnalysis(completeLight({ prezzo_luce_eur_kwh: null }));
  const yellowData = sanitizePremiumAnalysisData(completeLight(), {}, yellow);
  assert.equal(yellowData._premium_analysis.staff_review_required, false);
  assert.equal(yellowData._premium_analysis.review_policy, "red_only_customer_requested");

  const red = classifyPremiumAutomaticAnalysis(completeLight(), {
    contract: { provider_name: "Fornitore Test", pricing_type: "fixed", electricity_price_eur_kwh: 0.08, electricity_fixed_fee_eur_year: 96 },
  });
  const redData = sanitizePremiumAnalysisData(completeLight(), {}, red);
  assert.equal(redData._premium_analysis.staff_review_required, true);
});

test("client e Supabase bloccano le richieste gialle", () => {
  assert.match(appBills, /automatic_screening_status === "review_recommended"/);
  assert.match(appBills, /bill\.customer_status === "anomaly_found"/);
  assert.match(appBills, /bill\.processing_status === "completed"/);
  assert.doesNotMatch(appBills, /\["review_recommended", "inconclusive", "failed"\]\.includes/);
  assert.match(migration, /v_screening_status <> 'review_recommended'/);
  assert.match(migration, /v_processing_status <> 'completed'/);
  assert.match(migration, /v_customer_status <> 'anomaly_found'/);
  assert.doesNotMatch(migration, /v_screening_status not in \('review_recommended', 'inconclusive', 'failed'\)/);
  assert.match(verifyMigration, /traffic_light_completed_only_missing/);
  assert.match(verifyMigration, /traffic_light_customer_red_missing/);
});

test("un PDF non leggibile chiede un nuovo tentativo e non propone lo staff", () => {
  assert.match(api, /Riprova o carica un PDF più leggibile/);
  assert.doesNotMatch(api, /Puoi richiedere il controllo umano della bolletta/);
  assert.match(appBills, /RIPROVA ANALISI/);
  assert.match(appBills, /Riprova oppure carica un PDF più leggibile/);
});
