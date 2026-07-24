import { pdfFieldDefinition, requiredPdfFields, validatePdfCandidate } from "./pdfReaderContract.js";

export const PDF_EVIDENCE_POLICY_VERSION = "1.0.0";

function valueKey(value) {
  if (typeof value === "number" && Number.isFinite(value)) return `number:${value.toPrecision(12)}`;
  return `text:${String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase()}`;
}

function candidateSummary(candidate) {
  return {
    id: candidate.id,
    field: candidate.field,
    normalized_value: candidate.normalized_value,
    unit: candidate.normalized_unit,
    page: candidate.page,
    evidence: candidate.evidence,
    semantic_role: candidate.semantic_role,
    source: candidate.source,
    source_version: candidate.source_version,
    confidence: candidate.confidence,
    method: candidate.method || null,
    warnings: candidate.warnings || [],
    derivation: candidate.derivation || null,
  };
}

function isAllowedRole(candidate) {
  const definition = pdfFieldDefinition(candidate.field);
  return Boolean(definition?.roles.includes(candidate.semantic_role));
}

function selectBest(candidates) {
  return [...candidates].sort((left, right) => {
    const evidenceDelta = Number(Boolean(right.evidence)) - Number(Boolean(left.evidence));
    if (evidenceDelta) return evidenceDelta;
    return right.confidence - left.confidence;
  })[0] || null;
}

export function arbitratePdfCandidates({ normalized = {}, candidates = [] } = {}) {
  const rejected = [];
  const acceptedInput = [];
  for (const candidate of candidates) {
    const validation = validatePdfCandidate(candidate);
    if (!validation.valid) {
      rejected.push({ candidate: candidateSummary(candidate), reasons: validation.errors });
      continue;
    }
    if (!isAllowedRole(candidate)) {
      rejected.push({ candidate: candidateSummary(candidate), reasons: ["semantic_role_not_allowed_for_field"] });
      continue;
    }
    acceptedInput.push(candidate);
  }

  const groupedByField = new Map();
  for (const candidate of acceptedInput) {
    if (!groupedByField.has(candidate.field)) groupedByField.set(candidate.field, []);
    groupedByField.get(candidate.field).push(candidate);
  }

  const required = requiredPdfFields(normalized);
  const fields = [...new Set([...groupedByField.keys(), ...required])].sort();
  const decisions = [];
  for (const field of fields) {
    const fieldCandidates = groupedByField.get(field) || [];
    const definition = pdfFieldDefinition(field);
    if (!fieldCandidates.length) {
      decisions.push({ field, required: required.includes(field), critical: Boolean(definition?.critical), status: "missing", reason: "no_valid_candidate", selected: null, candidates: [] });
      continue;
    }

    const groups = new Map();
    for (const candidate of fieldCandidates) {
      const key = valueKey(candidate.normalized_value);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(candidate);
    }
    if (groups.size > 1) {
      decisions.push({
        field,
        required: required.includes(field),
        critical: Boolean(definition?.critical),
        status: definition?.critical ? "blocked" : "needs_review",
        reason: "conflicting_values",
        selected: null,
        candidates: fieldCandidates.map(candidateSummary),
      });
      continue;
    }

    const agreeing = [...groups.values()][0];
    const sources = [...new Set(agreeing.map((candidate) => candidate.source))];
    const selected = selectBest(agreeing);
    const independentAgreement = sources.length >= 2;
    const aiOnlyCritical = Boolean(definition?.critical) && sources.length === 1 && sources[0] === "ai";
    decisions.push({
      field,
      required: required.includes(field),
      critical: Boolean(definition?.critical),
      status: independentAgreement ? "accepted" : "needs_review",
      reason: independentAgreement ? "independent_sources_agree" : aiOnlyCritical ? "ai_only_critical" : "single_source_only",
      selected: candidateSummary(selected),
      agreeing_sources: sources,
      candidates: agreeing.map(candidateSummary),
    });
  }

  const requiredDecisions = decisions.filter((decision) => decision.required);
  return {
    policy_version: PDF_EVIDENCE_POLICY_VERSION,
    calculator_ready: requiredDecisions.length > 0 && requiredDecisions.every((decision) => decision.status === "accepted"),
    decisions,
    rejected,
    counts: {
      input: candidates.length,
      valid: acceptedInput.length,
      accepted: decisions.filter((item) => item.status === "accepted").length,
      needs_review: decisions.filter((item) => item.status === "needs_review").length,
      blocked: decisions.filter((item) => item.status === "blocked").length,
      missing: decisions.filter((item) => item.status === "missing").length,
      rejected: rejected.length,
    },
  };
}
