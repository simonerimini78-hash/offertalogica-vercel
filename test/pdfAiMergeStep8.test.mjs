import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPdfAiReviewPlan,
  isValidItalianFiscalCode,
  isValidItalianVatNumber,
} from "../lib/pdfAiMerge.js";

function candidate(field, value, extra = {}) {
  const classification = ["kind", "commodity", "customer_type"].includes(field);
  return {
    field,
    value_text: value,
    page: 1,
    label: field.toUpperCase(),
    evidence: `${field}: ${value}`,
    semantic_role: classification ? "classification" : "identifier",
    confidence: 94,
    ...extra,
  };
}

test("Step 8 foundation: un identificativo AI valido diventa solo revisionabile", () => {
  const normalized = { kind: "bolletta", commodity: "luce", pod: null };
  const original = structuredClone(normalized);
  const plan = buildPdfAiReviewPlan({
    normalized,
    model: "visual-model",
    aiOutput: { candidates: [candidate("pod", "IT 001 E 12345678")] },
  });

  assert.deepEqual(normalized, original);
  assert.equal(plan.applied, false);
  assert.equal(plan.deterministic_unchanged, true);
  assert.equal(plan.review_fields.length, 1);
  assert.equal(plan.review_fields[0].normalized_value, "IT001E12345678");
  assert.equal(plan.review_fields[0].autofill_allowed, false);
  assert.equal(plan.review_fields[0].requires_explicit_selection, true);
  assert.equal(plan.review_fields[0].source, "ai_visual");
});

test("Step 8 foundation: AI conferma ma non duplica un valore deterministico identico", () => {
  const plan = buildPdfAiReviewPlan({
    normalized: { pod: "IT001E12345678" },
    aiOutput: { candidates: [candidate("pod", "IT001E12345678")] },
  });
  assert.equal(plan.review_fields.length, 0);
  assert.equal(plan.corroborated_fields.length, 1);
  assert.equal(plan.conflicts.length, 0);
});

test("Step 8 foundation: AI non sovrascrive un valore deterministico diverso", () => {
  const plan = buildPdfAiReviewPlan({
    normalized: { pdr: "03081000752041" },
    aiOutput: { candidates: [candidate("pdr", "03081000466501")] },
  });
  assert.equal(plan.review_fields.length, 0);
  assert.equal(plan.conflicts[0].reason, "conflicts_with_deterministic_value");
  assert.equal(plan.conflicts[0].deterministic_value, "03081000752041");
});

test("Step 8 foundation: candidati AI discordanti sullo stesso campo sono bloccati", () => {
  const plan = buildPdfAiReviewPlan({
    normalized: { pdr: null },
    aiOutput: {
      candidates: [
        candidate("pdr", "03081000752041", { page: 1 }),
        candidate("pdr", "03081000466501", { page: 2 }),
      ],
    },
  });
  assert.equal(plan.review_fields.length, 0);
  assert.equal(plan.conflicts[0].reason, "ai_candidate_disagreement");
});

test("Step 8 foundation: campi economici, evidenza insufficiente e identificativi invalidi sono scartati", () => {
  const plan = buildPdfAiReviewPlan({
    aiOutput: {
      candidates: [
        candidate("prezzo_luce_eur_kwh", "0.15"),
        candidate("pod", "IT001E12"),
        candidate("pdr", "03081000752041", { evidence: "x" }),
      ],
    },
  });
  assert.equal(plan.review_fields.length, 0);
  assert.deepEqual(plan.ignored_candidates.map((item) => item.reason), [
    "field_not_allowed",
    "invalid_pod",
    "missing_evidence",
  ]);
});

test("Step 8 foundation: CF e P.IVA richiedono checksum valido", () => {
  assert.equal(isValidItalianFiscalCode("RSSMRA85T10A562S"), true);
  assert.equal(isValidItalianFiscalCode("RSSMRA85T10A562X"), false);
  assert.equal(isValidItalianVatNumber("12345678903"), true);
  assert.equal(isValidItalianVatNumber("12345678901"), false);
});

test("Step 8 foundation: confidenza bassa o ruolo incoerente non entrano in revisione", () => {
  const plan = buildPdfAiReviewPlan({
    aiOutput: {
      candidates: [
        candidate("fornitore", "Esempio Energia", { confidence: 60 }),
        candidate("commodity", "gas", { semantic_role: "identifier" }),
      ],
    },
  });
  assert.equal(plan.review_fields.length, 0);
  assert.deepEqual(plan.ignored_candidates.map((item) => item.reason), [
    "confidence_below_threshold",
    "semantic_role_mismatch",
  ]);
});
