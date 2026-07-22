import test from "node:test";
import assert from "node:assert/strict";
import { pdfAiConfig } from "../lib/pdfAiConfig.js";
import {
  pdfAiIdentityGaps,
  pdfAiTimeBudget,
  shouldAttemptPdfAi,
} from "../lib/pdfAiPolicy.js";

const NOW = 1_000_000;

function fallbackConfig(extra = {}) {
  return pdfAiConfig({
    PDF_AI_MODE: "fallback",
    PDF_AI_MODEL: "visual-model",
    ...extra,
  });
}

function baseInput(extra = {}) {
  return {
    normalized: { kind: "bolletta", commodity: "gas", fornitore: "Fornitore", pdr: null },
    config: fallbackConfig(),
    deterministicExhausted: true,
    filename: "bolletta.pdf",
    fileSizeBytes: 500_000,
    pageCount: 2,
    deadlineAt: NOW + 20_000,
    now: NOW,
    ...extra,
  };
}

test("Step 8 foundation: fallback parte solo dopo parser e OCR", () => {
  assert.equal(shouldAttemptPdfAi(baseInput()).attempt, true);
  assert.equal(shouldAttemptPdfAi(baseInput({ deterministicExhausted: false })).reason, "deterministic_pipeline_not_exhausted");
});

test("Step 8 foundation: fallback non parte quando gli identificativi sono completi", () => {
  const decision = shouldAttemptPdfAi(baseInput({
    normalized: { kind: "bolletta", commodity: "gas", fornitore: "Fornitore", pdr: "03081000752041" },
  }));
  assert.equal(decision.attempt, false);
  assert.equal(decision.reason, "deterministic_identity_complete");
});

test("Step 8 foundation: dimensione, pagine, modello e budget sono bloccanti", () => {
  assert.equal(shouldAttemptPdfAi(baseInput({ fileSizeBytes: 99_000_000 })).reason, "file_too_large");
  assert.equal(shouldAttemptPdfAi(baseInput({ pageCount: 99 })).reason, "too_many_pages");
  assert.equal(shouldAttemptPdfAi(baseInput({ config: fallbackConfig({ PDF_AI_MODEL: "" }) })).reason, "missing_model");
  assert.equal(shouldAttemptPdfAi(baseInput({ deadlineAt: NOW + 3_000 })).reason, "insufficient_time_budget");
});

test("Step 8 foundation: shadow osserva con gli stessi limiti tecnici", () => {
  const config = pdfAiConfig({ PDF_AI_MODE: "shadow", PDF_AI_MODEL: "visual-model" });
  const decision = shouldAttemptPdfAi(baseInput({
    config,
    normalized: { kind: "bolletta", commodity: "luce", fornitore: "Fornitore", pod: "IT001E12345678" },
    deterministicExhausted: false,
  }));
  assert.equal(decision.attempt, true);
  assert.equal(decision.reason, "shadow_observation");
  assert.equal("requires_explicit_consent" in decision, false);
});

test("Step 8 foundation: gap commodity determina l'identificativo richiesto", () => {
  assert.deepEqual(pdfAiIdentityGaps({ kind: "bolletta", commodity: "luce", fornitore: "F", pod: null }), ["pod"]);
  assert.deepEqual(pdfAiIdentityGaps({ kind: "bolletta", commodity: "dual", fornitore: "F", pod: "IT001E12345678" }), ["pdr"]);
  assert.deepEqual(pdfAiIdentityGaps({ kind: "unknown", commodity: "unknown", fornitore: null }), ["fornitore", "kind", "commodity", "supply_identifier"]);
});

test("Step 8 foundation: il timeout lascia sempre una riserva alla funzione", () => {
  const config = fallbackConfig({ PDF_AI_TIMEOUT_MS: "12000", PDF_AI_RESERVE_MS: "3000" });
  const budget = pdfAiTimeBudget({ config, deadlineAt: NOW + 10_000, now: NOW });
  assert.equal(budget.available, true);
  assert.equal(budget.timeout_ms, 7_000);
});
