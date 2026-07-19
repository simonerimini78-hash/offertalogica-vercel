import test from "node:test";
import assert from "node:assert/strict";
import { createPdfCandidate, requiredPdfFields } from "../lib/pdfReaderContract.js";
import { arbitratePdfCandidates } from "../lib/pdfEvidencePolicy.js";

const BASE = { kind: "bolletta", commodity: "luce" };

function candidate(field, value, source, semanticRole, index = 0) {
  return createPdfCandidate({
    field,
    normalized_value: value,
    value_number: typeof value === "number" ? value : null,
    value_text: typeof value === "string" ? value : null,
    page: 1,
    evidence: `${field}: ${value}`,
    label: field,
    semantic_role: semanticRole,
    source,
    source_version: `${source}-test`,
    confidence: 90,
  }, index);
}

function roleFor(field) {
  if (["kind", "commodity", "customer_type", "tipo_prezzo"].includes(field)) return "classification";
  if (["fornitore", "pod", "pdr"].includes(field)) return "identifier";
  return "actual_customer_value";
}

test("accetta un campo quando parser e IA indipendenti concordano", () => {
  const result = arbitratePdfCandidates({
    normalized: BASE,
    candidates: [
      candidate("consumo_luce_kwh", 2700, "parser", "actual_customer_value"),
      candidate("consumo_luce_kwh", 2700, "ai", "actual_customer_value", 1),
    ],
  });
  const decision = result.decisions.find((item) => item.field === "consumo_luce_kwh");
  assert.equal(decision.status, "accepted");
  assert.deepEqual(decision.agreeing_sources.sort(), ["ai", "parser"]);
});

test("non considera due candidati dello stesso parser come due conferme", () => {
  const result = arbitratePdfCandidates({
    normalized: BASE,
    candidates: [
      candidate("consumo_luce_kwh", 2700, "parser", "actual_customer_value"),
      candidate("consumo_luce_kwh", 2700, "parser", "actual_customer_value", 1),
    ],
  });
  const decision = result.decisions.find((item) => item.field === "consumo_luce_kwh");
  assert.equal(decision.status, "needs_review");
  assert.equal(decision.reason, "single_source_only");
});

test("blocca valori critici in conflitto", () => {
  const result = arbitratePdfCandidates({
    normalized: BASE,
    candidates: [
      candidate("prezzo_luce_eur_kwh", 0.12, "parser", "actual_customer_value"),
      candidate("prezzo_luce_eur_kwh", 0.18, "ai", "actual_customer_value", 1),
    ],
  });
  const decision = result.decisions.find((item) => item.field === "prezzo_luce_eur_kwh");
  assert.equal(decision.status, "blocked");
  assert.equal(decision.selected, null);
});

test("un valore critico trovato soltanto dall'IA richiede revisione", () => {
  const result = arbitratePdfCandidates({
    normalized: BASE,
    candidates: [candidate("prezzo_luce_eur_kwh", 0.15, "ai", "actual_customer_value")],
  });
  const decision = result.decisions.find((item) => item.field === "prezzo_luce_eur_kwh");
  assert.equal(decision.status, "needs_review");
  assert.equal(decision.reason, "ai_only_critical");
});

test("rifiuta esempi e soglie usati come consumi reali", () => {
  const result = arbitratePdfCandidates({
    normalized: BASE,
    candidates: [candidate("consumo_luce_kwh", 2700, "ai", "example")],
  });
  assert.equal(result.rejected.length, 1);
  assert.deepEqual(result.rejected[0].reasons, ["semantic_role_not_allowed_for_field"]);
});

test("calculator_ready diventa true solo con tutti i campi richiesti confermati", () => {
  const values = {
    fornitore: "Test Energia",
    kind: "bolletta",
    commodity: "luce",
    consumo_luce_kwh: 2700,
    prezzo_luce_eur_kwh: 0.15,
    quota_fissa_vendita_luce_eur_anno: 120,
  };
  assert.deepEqual(requiredPdfFields(BASE).sort(), Object.keys(values).sort());
  const candidates = Object.entries(values).flatMap(([field, value], index) => [
    candidate(field, value, "parser", roleFor(field), index * 2),
    candidate(field, value, "ai", roleFor(field), index * 2 + 1),
  ]);
  const result = arbitratePdfCandidates({ normalized: BASE, candidates });
  assert.equal(result.calculator_ready, true);
});
