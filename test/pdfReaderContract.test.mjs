import test from "node:test";
import assert from "node:assert/strict";
import { aiPdfToCandidates, legacyPdfToCandidates, validatePdfCandidate } from "../lib/pdfReaderContract.js";

test("converte i diagnostici legacy in candidati con pagina, evidenza e unità", () => {
  const normalized = {
    parser_version: "legacy-test",
    kind: "bolletta",
    commodity: "luce",
    diagnostics: [{
      field: "consumo_luce_kwh",
      label: "Consumo annuo luce",
      value: 2700,
      status: "found",
      confidence: "high",
      page: 2,
      source_snippet: "In un anno hai consumato 2.700 kWh",
      method: "text_pattern",
    }],
  };
  const [candidate] = legacyPdfToCandidates(normalized);
  assert.equal(candidate.field, "consumo_luce_kwh");
  assert.equal(candidate.normalized_value, 2700);
  assert.equal(candidate.normalized_unit, "kWh/anno");
  assert.equal(candidate.page, 2);
  assert.equal(candidate.semantic_role, "actual_customer_value");
  assert.equal(candidate.source, "parser");
  assert.equal(validatePdfCandidate(candidate).valid, true);
});

test("mantiene la trasformazione mensile-annuale come metodo verificabile", () => {
  const [candidate] = legacyPdfToCandidates({
    parser_version: "legacy-test",
    kind: "bolletta",
    commodity: "gas",
    diagnostics: [{
      field: "quota_fissa_vendita_gas_eur_anno",
      label: "Quota fissa gas annua",
      value: 144,
      status: "review",
      confidence: "medium",
      page: 3,
      source_snippet: "12,00 euro al mese",
      method: "monthly_times_12",
    }],
  });
  assert.equal(candidate.normalized_value, 144);
  assert.equal(candidate.normalized_unit, "EUR/PDR/anno");
  assert.equal(candidate.method, "monthly_times_12");
  assert.deepEqual(candidate.warnings, ["legacy_diagnostic_review"]);
});

test("adatta i nomi del contratto foundation ai campi reali OffertaLogica", () => {
  const [candidate] = aiPdfToCandidates({
    document: { commodity: "electricity" },
    candidates: [{
      field: "annual_consumption_electricity",
      value_text: null,
      value_number: 3100,
      unit: "kWh/anno",
      page: 1,
      label: "Consumo annuo",
      evidence: "Consumo annuo 3.100 kWh",
      semantic_role: "actual_customer_value",
      confidence: 93,
    }],
  }, "gpt-test");
  assert.equal(candidate.field, "consumo_luce_kwh");
  assert.equal(candidate.source, "ai");
  assert.equal(candidate.source_version, "gpt-test");
});
