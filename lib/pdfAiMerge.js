import { createPdfCandidate, validatePdfCandidate } from "./pdfReaderContract.js";
import {
  expectedPdfAiSemanticRole,
  PDF_AI_CLASSIFICATION_FIELDS,
  PDF_AI_REVIEW_FIELDS,
} from "./pdfAiSchema.js";

export const PDF_AI_REVIEW_POLICY_VERSION = "8.0.0";

const ITALIAN_CF_PATTERN = /^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/;
const ITALIAN_VAT_PATTERN = /^\d{11}$/;
const POD_PATTERN = /^IT\d{3}E[A-Z0-9]{8}$/;
const PDR_PATTERN = /^\d{14}$/;
const CUSTOMER_CODE_PATTERN = /^(?=.{6,20}$)(?=.*\d)[A-Z0-9]+$/;

const ODD_CF_VALUES = Object.freeze({
  0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21,
  K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14,
  U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
});

const LETTER_TO_NUMBER = Object.freeze({
  A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9,
  K: 10, L: 11, M: 12, N: 13, O: 14, P: 15, Q: 16, R: 17,
  S: 18, T: 19, U: 20, V: 21, W: 22, X: 23, Y: 24, Z: 25,
});

function compact(value, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeAlnum(value) {
  return compact(value, 180).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function missing(value) {
  return value === null || value === undefined || value === "" || value === "unknown";
}

export function isValidItalianFiscalCode(value) {
  const normalized = normalizeAlnum(value);
  if (!ITALIAN_CF_PATTERN.test(normalized)) return false;
  let total = 0;
  for (let index = 0; index < 15; index += 1) {
    const character = normalized[index];
    if ((index + 1) % 2 === 1) total += ODD_CF_VALUES[character];
    else if (/\d/.test(character)) total += Number(character);
    else total += LETTER_TO_NUMBER[character];
  }
  return String.fromCharCode(65 + (total % 26)) === normalized[15];
}

export function isValidItalianVatNumber(value) {
  const normalized = normalizeAlnum(value);
  if (!ITALIAN_VAT_PATTERN.test(normalized)) return false;
  let total = 0;
  for (let index = 0; index < 10; index += 1) {
    let digit = Number(normalized[index]);
    if ((index + 1) % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    total += digit;
  }
  return (10 - (total % 10)) % 10 === Number(normalized[10]);
}

export function isValidItalianTaxId(value) {
  return isValidItalianFiscalCode(value) || isValidItalianVatNumber(value);
}

function classificationValue(field, value) {
  const source = compact(value, 100).toLowerCase();
  if (field === "kind") {
    if (["bill", "invoice", "bolletta", "fattura"].includes(source)) return "bolletta";
    if (["synthetic_sheet", "scheda_offerta", "scheda sintetica", "cte", "placet", "combined_offer_document"].includes(source)) return "scheda_offerta";
  }
  if (field === "commodity") {
    if (["electricity", "energia elettrica", "luce"].includes(source)) return "luce";
    if (["gas", "gas naturale"].includes(source)) return "gas";
    if (["dual", "luce e gas", "electricity and gas"].includes(source)) return "dual";
  }
  if (field === "customer_type") {
    if (["consumer", "private", "privato", "domestico", "domestic"].includes(source)) return "privato";
    if (["business", "azienda", "impresa", "non domestico", "non-domestic"].includes(source)) return "business";
  }
  return null;
}

export function normalizePdfAiReviewValue(field, value) {
  if (PDF_AI_CLASSIFICATION_FIELDS.includes(field)) {
    const normalized = classificationValue(field, value);
    return normalized ? { valid: true, value: normalized } : { valid: false, reason: "invalid_classification" };
  }

  if (field === "pod") {
    const normalized = normalizeAlnum(value);
    return POD_PATTERN.test(normalized)
      ? { valid: true, value: normalized }
      : { valid: false, reason: "invalid_pod" };
  }
  if (field === "pdr") {
    const normalized = normalizeAlnum(value).replace(/\D/g, "");
    return PDR_PATTERN.test(normalized)
      ? { valid: true, value: normalized }
      : { valid: false, reason: "invalid_pdr" };
  }
  if (field === "codice_fiscale") {
    const normalized = normalizeAlnum(value);
    return isValidItalianTaxId(normalized)
      ? { valid: true, value: normalized }
      : { valid: false, reason: "invalid_tax_id" };
  }
  if (field === "codice_cliente") {
    const normalized = normalizeAlnum(value);
    return CUSTOMER_CODE_PATTERN.test(normalized)
      ? { valid: true, value: normalized }
      : { valid: false, reason: "invalid_customer_code" };
  }

  const limit = field === "indirizzo_fornitura" ? 240 : 140;
  const minimum = field === "indirizzo_fornitura" ? 6 : 2;
  const normalized = compact(value, limit);
  if (normalized.length < minimum) return { valid: false, reason: "value_too_short" };
  return { valid: true, value: normalized };
}

function comparable(field, value) {
  const normalized = normalizePdfAiReviewValue(field, value);
  if (!normalized.valid) return null;
  if (["fornitore", "intestatario", "indirizzo_fornitura"].includes(field)) {
    return String(normalized.value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  }
  return String(normalized.value).toUpperCase();
}

function confidenceThreshold(field) {
  if (["pod", "pdr", "codice_fiscale", "codice_cliente"].includes(field)) return 85;
  return 80;
}

function ignored(index, field, reason, extra = {}) {
  return { index, field: field || null, reason, ...extra };
}

function candidateFromAi(raw, index, model) {
  const field = String(raw?.field || "").trim();
  if (!PDF_AI_REVIEW_FIELDS.includes(field)) return { error: ignored(index, field, "field_not_allowed") };

  const expectedRole = expectedPdfAiSemanticRole(field);
  if (raw?.semantic_role !== expectedRole) return { error: ignored(index, field, "semantic_role_mismatch") };

  const page = Number(raw?.page);
  const label = compact(raw?.label, 180);
  const evidence = compact(raw?.evidence, 360);
  const confidence = Math.round(Number(raw?.confidence));
  if (!Number.isInteger(page) || page < 1) return { error: ignored(index, field, "missing_page") };
  if (!label) return { error: ignored(index, field, "missing_label") };
  if (evidence.length < 6) return { error: ignored(index, field, "missing_evidence") };
  if (!Number.isFinite(confidence) || confidence < confidenceThreshold(field)) {
    return { error: ignored(index, field, "confidence_below_threshold", { confidence: Number.isFinite(confidence) ? confidence : null }) };
  }

  const normalized = normalizePdfAiReviewValue(field, raw?.value_text);
  if (!normalized.valid) return { error: ignored(index, field, normalized.reason) };

  const candidate = createPdfCandidate({
    field,
    value_text: typeof normalized.value === "string" ? normalized.value : null,
    normalized_value: normalized.value,
    page,
    label,
    evidence,
    semantic_role: expectedRole,
    source: "ai",
    source_version: compact(model, 120) || "unknown",
    confidence,
    method: "visual_review_step8",
    warnings: ["requires_explicit_user_confirmation"],
  }, index);
  const validation = validatePdfCandidate(candidate);
  if (!validation.valid) return { error: ignored(index, field, "candidate_contract_invalid", { errors: validation.errors }) };
  return { candidate };
}

function groupCandidates(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.field}|${comparable(candidate.field, candidate.normalized_value)}`;
    if (!groups.has(candidate.field)) groups.set(candidate.field, new Map());
    const byValue = groups.get(candidate.field);
    if (!byValue.has(key)) byValue.set(key, []);
    byValue.get(key).push(candidate);
  }
  return groups;
}

export function buildPdfAiReviewPlan({ normalized = {}, aiOutput = {}, model = aiOutput.model } = {}) {
  const acceptedCandidates = [];
  const ignoredCandidates = [];
  for (const [index, raw] of (Array.isArray(aiOutput?.candidates) ? aiOutput.candidates : []).entries()) {
    const result = candidateFromAi(raw, index, model);
    if (result.error) ignoredCandidates.push(result.error);
    else acceptedCandidates.push(result.candidate);
  }

  const reviewFields = [];
  const corroboratedFields = [];
  const conflicts = [];
  const groups = groupCandidates(acceptedCandidates);

  for (const [field, byValue] of groups.entries()) {
    const existing = normalized[field];
    const existingComparable = missing(existing) ? null : comparable(field, existing);

    if (byValue.size > 1) {
      conflicts.push({
        field,
        reason: "ai_candidate_disagreement",
        values: [...byValue.values()].map((entries) => entries[0].normalized_value),
        pages: [...new Set([...byValue.values()].flat().map((entry) => entry.page))],
      });
      continue;
    }

    const entries = [...byValue.values()][0];
    const best = [...entries].sort((left, right) => right.confidence - left.confidence)[0];
    const aiComparable = comparable(field, best.normalized_value);

    if (existingComparable !== null) {
      if (existingComparable === aiComparable) {
        corroboratedFields.push({
          field,
          normalized_value: existing,
          source: "ai_visual",
          page: best.page,
          evidence: best.evidence,
          confidence: best.confidence,
          support_count: entries.length,
        });
      } else {
        conflicts.push({
          field,
          reason: "conflicts_with_deterministic_value",
          deterministic_value: existing,
          ai_value: best.normalized_value,
          page: best.page,
          evidence: best.evidence,
        });
      }
      continue;
    }

    reviewFields.push({
      field,
      normalized_value: best.normalized_value,
      page: best.page,
      label: best.label,
      evidence: best.evidence,
      confidence: best.confidence,
      source: "ai_visual",
      source_version: best.source_version,
      support_count: entries.length,
      autofill_allowed: false,
      overwrites_deterministic: false,
      requires_user_confirmation: true,
      requires_explicit_selection: true,
    });
  }

  return {
    policy_version: PDF_AI_REVIEW_POLICY_VERSION,
    source: "ai_visual",
    applied: false,
    deterministic_unchanged: true,
    review_fields: reviewFields,
    corroborated_fields: corroboratedFields,
    conflicts,
    ignored_candidates: ignoredCandidates,
    summary: {
      received_candidate_count: Array.isArray(aiOutput?.candidates) ? aiOutput.candidates.length : 0,
      accepted_candidate_count: acceptedCandidates.length,
      review_field_count: reviewFields.length,
      corroborated_field_count: corroboratedFields.length,
      conflict_count: conflicts.length,
      ignored_candidate_count: ignoredCandidates.length,
    },
  };
}
