import test from "node:test";
import assert from "node:assert/strict";
import { pdfAiConfig } from "../lib/pdfAiConfig.js";
import { runPdfAiShadowObservation } from "../lib/pdfAiShadow.js";

const NOW = 1_000_000;

function shadowConfig(extra = {}) {
  return pdfAiConfig({
    PDF_AI_MODE: "shadow",
    PDF_AI_MODEL: "visual-model",
    PDF_AI_TIMEOUT_MS: "12000",
    PDF_AI_RESERVE_MS: "3000",
    ...extra,
  });
}

function baseInput(extra = {}) {
  return {
    normalized: { kind: "bolletta", commodity: "gas", fornitore: "Fornitore Alfa", pdr: null, page_count: 2 },
    pdfBuffer: Buffer.from("pdf-shadow-test"),
    filename: "bolletta-gas.pdf",
    deadlineAt: NOW + 20_000,
    now: NOW,
    config: shadowConfig(),
    ...extra,
  };
}

function successfulOutput(provider = "Fornitore Alfa") {
  return {
    ok: true,
    status: "completed",
    provider: "openai",
    model: "visual-model",
    client_version: "8.1.0",
    elapsed_ms: 12,
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    output: {
      document: { document_type: "bill", commodity: "gas", customer_type: "consumer", page_count: 2 },
      candidates: [{
        field: "fornitore",
        value_text: provider,
        page: 1,
        label: "Fornitore",
        evidence: `Fornitore: ${provider}`,
        semantic_role: "identifier",
        confidence: 94,
      }],
      review_reasons: ["Identità visibile"],
    },
  };
}

function planBuilder({ normalized, aiOutput }) {
  return {
    applied: false,
    deterministic_unchanged: true,
    review_fields: aiOutput.candidates,
    normalized_snapshot: normalized,
  };
}

test("Step 8.2: modalità off non chiama il provider", async () => {
  let calls = 0;
  const result = await runPdfAiShadowObservation(baseInput({
    config: pdfAiConfig({ PDF_AI_MODE: "off", PDF_AI_MODEL: "visual-model" }),
    reviewRunner: async () => { calls += 1; return successfulOutput(); },
    planBuilder,
  }));
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "disabled");
  assert.equal(calls, 0);
});

test("Step 8.2: fallback non viene eseguito dall'orchestratore shadow", async () => {
  let calls = 0;
  const result = await runPdfAiShadowObservation(baseInput({
    config: pdfAiConfig({ PDF_AI_MODE: "fallback", PDF_AI_MODEL: "visual-model" }),
    deterministicExhausted: true,
    reviewRunner: async () => { calls += 1; return successfulOutput(); },
    planBuilder,
  }));
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "shadow_mode_required");
  assert.equal(calls, 0);
});

test("Step 8.2: successo shadow produce solo sidecar revisionabile", async () => {
  const normalized = { kind: "bolletta", commodity: "gas", fornitore: null, pdr: null, page_count: 2 };
  const before = structuredClone(normalized);
  const result = await runPdfAiShadowObservation(baseInput({
    normalized,
    reviewRunner: async () => successfulOutput("Energia Gamma"),
    planBuilder,
  }));
  assert.equal(result.status, "observed");
  assert.equal(result.attempted, true);
  assert.equal(result.review_only, true);
  assert.equal(result.public_output_unchanged, true);
  assert.equal(result.observation.review_plan.applied, false);
  assert.deepEqual(normalized, before);
});

test("Step 8.2: timeout ed errori del provider non generano eccezioni", async () => {
  const timeout = await runPdfAiShadowObservation(baseInput({
    reviewRunner: async () => ({
      ok: false,
      status: "timeout",
      model: "visual-model",
      error: { code: "timeout", retryable: true },
    }),
    planBuilder,
  }));
  assert.equal(timeout.status, "timeout");
  assert.equal(timeout.reason, "timeout");
  assert.equal(timeout.observation, null);

  const failure = await runPdfAiShadowObservation(baseInput({
    reviewRunner: async () => { throw new Error("sensitive provider detail"); },
    planBuilder,
  }));
  assert.equal(failure.status, "error");
  assert.equal(failure.reason, "review_runner_error");
  assert.equal(JSON.stringify(failure).includes("sensitive provider detail"), false);
});

test("Step 8.2: output valido ma piano non costruibile resta non bloccante", async () => {
  const result = await runPdfAiShadowObservation(baseInput({
    reviewRunner: async () => successfulOutput(),
    planBuilder: () => { throw new Error("plan failure"); },
  }));
  assert.equal(result.status, "error");
  assert.equal(result.reason, "review_plan_error");
  assert.equal(result.public_output_unchanged, true);
});

test("Step 8.2: il parser della policy riceve una copia privata", async () => {
  const normalized = { kind: "bolletta", commodity: "luce", fornitore: "Fornitore Delta", pod: null, page_count: 1 };
  const result = await runPdfAiShadowObservation(baseInput({
    normalized,
    pageCount: 1,
    policyRunner: (input) => {
      input.normalized.fornitore = "MUTATO";
      return {
        attempt: false,
        reason: "test_skip",
        mode: "shadow",
        model: "visual-model",
        gaps: ["pod"],
      };
    },
    reviewRunner: async () => successfulOutput(),
    planBuilder,
  }));
  assert.equal(result.reason, "test_skip");
  assert.equal(normalized.fornitore, "Fornitore Delta");
});

test("Step 8.2: comportamento indipendente dal nome del fornitore", async () => {
  const suppliers = ["Fornitore Alfa", "Beta Servizi", "Cooperativa Energia Nord", "Venditore X"];
  for (const supplier of suppliers) {
    const normalized = { kind: "bolletta", commodity: "gas", fornitore: supplier, pdr: null, page_count: 2 };
    const result = await runPdfAiShadowObservation(baseInput({
      normalized,
      reviewRunner: async () => successfulOutput(supplier),
      planBuilder,
    }));
    assert.equal(result.status, "observed");
    assert.equal(result.observation.candidates[0].value_text, supplier);
  }
});

test("Step 8.2: dimensione e numero pagine vengono derivati senza esporre il PDF", async () => {
  let received = null;
  const pdfBuffer = Buffer.from("1234567890");
  const result = await runPdfAiShadowObservation(baseInput({
    pdfBuffer,
    normalized: { kind: "bolletta", commodity: "gas", fornitore: "F", pdr: null, page_count: 3 },
    policyRunner: (input) => {
      received = input;
      return { attempt: false, reason: "test_skip", mode: "shadow", model: "visual-model", gaps: ["pdr"] };
    },
    reviewRunner: async () => successfulOutput(),
    planBuilder,
  }));
  assert.equal(result.status, "skipped");
  assert.equal(received.fileSizeBytes, 10);
  assert.equal(received.pageCount, 3);
  assert.equal(JSON.stringify(result).includes("1234567890"), false);
});
