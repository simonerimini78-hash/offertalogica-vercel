import { applyPdfDataContract } from "./pdfDataContract.js";
import { applyPdfFieldValidation } from "./pdfFieldValidation.js";
import { runPdfAiFallback } from "./pdfAiReader.js";
import {
  canonicalPdfField,
  legacyPdfToCandidates,
  pdfFieldDefinition,
  validatePdfCandidate,
} from "./pdfReaderContract.js";
import { isMissingPdfValue, scorePdfResult } from "./pdfOcrPolicy.js";

export const PDF_AI_FALLBACK_PIPELINE_VERSION = "v106-controlled-visual-ai-fallback-1";

const NUMERIC_LIMITS = Object.freeze({
  consumo_luce_kwh: { min: 1, max: 100_000_000, unit: /(?:kwh)/i, annual: true },
  consumo_gas_smc: { min: 1, max: 100_000_000, unit: /(?:smc|std\.?\s*m3|standard\s*m3)/i, annual: true },
  prezzo_luce_eur_kwh: { min: 0.000001, max: 5, unit: /(?:€|eur)\s*\/?\s*kwh/i },
  prezzo_gas_eur_smc: { min: 0.000001, max: 20, unit: /(?:€|eur)\s*\/?\s*smc/i },
  quota_fissa_vendita_luce_eur_anno: { min: 0.01, max: 10_000, unit: /(?:€|eur)[\s\S]{0,24}(?:anno|year|pod\s*\/\s*anno)/i, annual: true, rejectMonthly: true },
  quota_fissa_vendita_gas_eur_anno: { min: 0.01, max: 10_000, unit: /(?:€|eur)[\s\S]{0,24}(?:anno|year|pdr\s*\/\s*anno)/i, annual: true, rejectMonthly: true },
  potenza_impegnata_kw: { min: 0.1, max: 1000, unit: /\bkw\b/i },
  potenza_disponibile_kw: { min: 0.1, max: 1100, unit: /\bkw\b/i },
  spread_luce_eur_kwh: { min: 0, max: 5, unit: /(?:€|eur)\s*\/?\s*kwh/i },
  spread_gas_eur_smc: { min: 0, max: 20, unit: /(?:€|eur)\s*\/?\s*smc/i },
});

const HIGH_VALUE_FIELDS = new Set([
  "consumo_luce_kwh",
  "consumo_gas_smc",
  "prezzo_luce_eur_kwh",
  "prezzo_gas_eur_smc",
  "quota_fissa_vendita_luce_eur_anno",
  "quota_fissa_vendita_gas_eur_anno",
  "pod",
  "pdr",
]);

const CLASSIFICATION_FIELDS = new Set(["kind", "commodity", "customer_type", "tipo_prezzo", "tipo_prezzo_luce", "tipo_prezzo_gas"]);
const IDENTIFIER_FIELDS = new Set(["pod", "pdr", "codice_fiscale", "codice_cliente", "codice_offerta", "codice_offerta_luce", "codice_offerta_gas"]);

function compact(value, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function booleanSetting(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return /^(?:1|true|yes|on)$/i.test(String(value).trim());
}

function filenameAllowed(filename, patternSource) {
  const source = String(patternSource || "").trim();
  if (!source) return true;
  try {
    return new RegExp(source, "i").test(String(filename || ""));
  } catch {
    return false;
  }
}

function comparisonCoreMissing(normalized = {}) {
  const fields = [];
  if (["luce", "dual"].includes(normalized.commodity)) {
    for (const field of ["consumo_luce_kwh", "prezzo_luce_eur_kwh", "quota_fissa_vendita_luce_eur_anno"]) {
      if (isMissingPdfValue(normalized[field])) fields.push(field);
    }
  }
  if (["gas", "dual"].includes(normalized.commodity)) {
    for (const field of ["consumo_gas_smc", "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno"]) {
      if (isMissingPdfValue(normalized[field])) fields.push(field);
    }
  }
  return fields;
}

export function shouldAttemptPdfAiFallback({
  normalized = {},
  filename = "",
  consentGranted = false,
  deadlineAt = null,
  env = process.env,
} = {}) {
  if (String(env.PDF_AI_MODE || "off").trim().toLowerCase() !== "fallback") {
    return { attempt: false, reason: "disabled" };
  }
  if (!consentGranted) return { attempt: false, reason: "consent_not_granted" };
  if (!filenameAllowed(filename, env.PDF_AI_FILENAME_PATTERN)) {
    return { attempt: false, reason: "filename_not_allowed" };
  }
  if (booleanSetting(env.PDF_AI_FALLBACK_DISABLED, false)) {
    return { attempt: false, reason: "disabled_by_kill_switch" };
  }
  const remainingMs = deadlineAt ? Number(deadlineAt) - Date.now() : Infinity;
  if (Number.isFinite(remainingMs) && remainingMs < 8_000) {
    return { attempt: false, reason: "insufficient_time_budget", remaining_ms: remainingMs };
  }

  const score = scorePdfResult(normalized);
  const missingCore = comparisonCoreMissing(normalized);
  const strongRecognized = Boolean(normalized.recognized)
    && ["bolletta", "scheda_offerta"].includes(normalized.kind)
    && ["luce", "gas", "dual"].includes(normalized.commodity)
    && score >= 12
    && missingCore.length === 0;
  if (strongRecognized) {
    return { attempt: false, reason: "deterministic_or_ocr_result_available", score, missing_core: missingCore };
  }

  const noUsefulResult = !normalized.recognized
    || normalized.kind === "unknown"
    || normalized.commodity === "unknown"
    || score < 8;
  const incompleteComparison = missingCore.length > 0;
  if (!noUsefulResult && !incompleteComparison) {
    return { attempt: false, reason: "fallback_not_needed", score, missing_core: missingCore };
  }
  return {
    attempt: true,
    reason: noUsefulResult ? "unrecognized_after_parser_and_ocr" : "comparison_core_incomplete",
    score,
    missing_core: missingCore,
  };
}

function normalizeDate(value) {
  const source = compact(value, 40);
  let match = source.match(/^((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])$/);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
  match = source.match(/^(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.]((?:19|20)\d{2})$/);
  if (match) return `${match[3]}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`;
  return null;
}

function normalizeClassification(field, value) {
  const source = compact(value, 100).toLowerCase();
  if (field === "kind") {
    if (["bill", "bolletta", "invoice"].includes(source)) return "bolletta";
    if (["synthetic_sheet", "scheda_offerta", "scheda sintetica", "cte", "combined_offer_document", "placet"].includes(source)) return "scheda_offerta";
    return null;
  }
  if (field === "commodity") {
    if (["electricity", "luce", "energia elettrica"].includes(source)) return "luce";
    if (["gas", "gas naturale"].includes(source)) return "gas";
    if (["dual", "luce e gas", "electricity and gas"].includes(source)) return "dual";
    return null;
  }
  if (field === "customer_type") {
    if (["consumer", "private", "privato", "domestico", "domestic"].includes(source)) return "privato";
    if (["business", "azienda", "impresa", "non domestico", "non-domestic"].includes(source)) return "business";
    return null;
  }
  if (["tipo_prezzo", "tipo_prezzo_luce", "tipo_prezzo_gas"].includes(field)) {
    if (/^(?:fixed|fisso|prezzo fisso)$/.test(source)) return "fisso";
    if (/^(?:variable|variabile|indexed|indicizzato|prezzo variabile)$/.test(source)) return "variabile";
    if (/^(?:hybrid|ibrido|non convenzionale)$/.test(source)) return "ibrido";
    return null;
  }
  return compact(value, 180) || null;
}

function normalizeIdentifier(field, value) {
  const source = compact(value, 140).toUpperCase();
  if (field === "pod") {
    const normalized = source.replace(/[\s.-]/g, "");
    return /^IT\d{3}E[A-Z0-9]{8}$/.test(normalized) ? normalized : null;
  }
  if (field === "pdr") {
    const normalized = source.replace(/\D/g, "");
    return /^\d{14}$/.test(normalized) ? normalized : null;
  }
  if (field === "codice_fiscale") {
    const normalized = source.replace(/[^A-Z0-9]/g, "");
    return /^(?:[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]|\d{11})$/.test(normalized) ? normalized : null;
  }
  if (field === "codice_cliente") {
    const normalized = source.replace(/[^A-Z0-9]/g, "");
    return /^(?=.{6,20}$)(?=.*\d)[A-Z0-9]+$/.test(normalized) ? normalized : null;
  }
  if (["codice_offerta", "codice_offerta_luce", "codice_offerta_gas"].includes(field)) {
    const normalized = source.replace(/\s+/g, "");
    return /^[A-Z0-9_.-]{12,100}$/.test(normalized) ? normalized : null;
  }
  return source || null;
}

function evidenceSignalsAnnual(candidate) {
  const context = `${candidate.unit || ""} ${candidate.label || ""} ${candidate.evidence || ""}`;
  return /\b(?:anno|annuo|annua|annuale|12\s*mesi|rolling\s*12|year|annual)\b/i.test(context);
}

function normalizeNumericCandidate(field, candidate) {
  const config = NUMERIC_LIMITS[field];
  if (!config) return null;
  const raw = candidate.value_number ?? candidate.normalized_value;
  const number = Number(raw);
  if (!Number.isFinite(number) || number < config.min || number > config.max) return null;
  const explicitUnit = String(candidate.unit || candidate.normalized_unit || "").trim();
  const unitContext = `${explicitUnit} ${candidate.label || ""} ${candidate.evidence || ""}`;
  if (!explicitUnit || !config.unit.test(explicitUnit)) return null;
  if (config.rejectMonthly && /(?:mese|month)/i.test(explicitUnit)) return null;
  if (config.annual && !evidenceSignalsAnnual(candidate)) return null;
  return number;
}

function normalizeCandidateValue(candidate) {
  const field = canonicalPdfField(candidate.field);
  if (NUMERIC_LIMITS[field]) return normalizeNumericCandidate(field, candidate);
  if (CLASSIFICATION_FIELDS.has(field)) return normalizeClassification(field, candidate.normalized_value);
  if (IDENTIFIER_FIELDS.has(field)) return normalizeIdentifier(field, candidate.normalized_value);
  if ([
    "decorrenza_condizioni_economiche",
    "scadenza_condizioni_economiche",
    "decorrenza_condizioni_economiche_luce",
    "scadenza_condizioni_economiche_luce",
    "decorrenza_condizioni_economiche_gas",
    "scadenza_condizioni_economiche_gas",
  ].includes(field)) return normalizeDate(candidate.normalized_value);

  const source = compact(candidate.normalized_value, field.startsWith("formula_") ? 420 : 180);
  if (!source) return null;
  if (field === "fornitore" && (source.length < 2 || source.length > 90)) return null;
  if (field === "intestatario" && (source.length < 3 || source.length > 120)) return null;
  if (field.startsWith("indirizzo_fornitura") && !/\d/.test(source)) return null;
  if (field.startsWith("nome_offerta") && source.length > 140) return null;
  return source;
}

function valueKey(value) {
  if (typeof value === "number") return `n:${value.toPrecision(12)}`;
  return `s:${compact(value, 500).toLocaleLowerCase("it")}`;
}

function confidenceThreshold(field) {
  const definition = pdfFieldDefinition(field);
  if (definition?.critical) return 92;
  if (IDENTIFIER_FIELDS.has(field)) return 92;
  return 86;
}

function candidateRejection(candidate, aiConflictFields) {
  const validation = validatePdfCandidate(candidate);
  if (!validation.valid) return validation.errors.join(",");
  const definition = pdfFieldDefinition(candidate.field);
  if (!definition?.roles.includes(candidate.semantic_role)) return "semantic_role_not_allowed";
  if (candidate.source !== "ai") return "source_not_ai";
  if (!candidate.page || compact(candidate.evidence).length < 6) return "missing_page_or_evidence";
  if (candidate.confidence < confidenceThreshold(candidate.field)) return "confidence_below_threshold";
  if (Array.isArray(candidate.contradicts) && candidate.contradicts.length) return "contradicts_existing_source";
  if (aiConflictFields.has(candidate.field)) return "provider_reported_conflict";
  return null;
}

function labelForField(field) {
  const labels = {
    fornitore: "Fornitore",
    kind: "Tipo documento",
    commodity: "Fornitura rilevata",
    customer_type: "Tipo cliente",
    consumo_luce_kwh: "Consumo annuo luce",
    consumo_gas_smc: "Consumo annuo gas",
    prezzo_luce_eur_kwh: "Prezzo vendita luce",
    prezzo_gas_eur_smc: "Prezzo vendita gas",
    quota_fissa_vendita_luce_eur_anno: "Quota fissa luce annua",
    quota_fissa_vendita_gas_eur_anno: "Quota fissa gas annua",
    potenza_impegnata_kw: "Potenza impegnata",
    potenza_disponibile_kw: "Potenza disponibile",
    pod: "POD",
    pdr: "PDR",
    intestatario: "Intestatario",
    codice_fiscale: "Codice fiscale / P.IVA",
    codice_cliente: "Codice cliente",
    indirizzo_fornitura: "Indirizzo fornitura",
    indirizzo_fornitura_luce: "Indirizzo fornitura luce",
    indirizzo_fornitura_gas: "Indirizzo fornitura gas",
  };
  return labels[field] || field.replaceAll("_", " ");
}

function candidateDiagnostic(candidate, value) {
  return {
    field: candidate.field,
    label: candidate.label || labelForField(candidate.field),
    value,
    status: "review",
    confidence: "medium",
    required: Boolean(pdfFieldDefinition(candidate.field)?.critical),
    page: candidate.page,
    source_snippet: compact(candidate.evidence, 360),
    source_match: compact(candidate.value_text ?? candidate.value_number ?? value, 180),
    method: "openai_visual_semantic",
  };
}

function applySupplySpecificAliases(merged, filledFields) {
  const deriveAiAlias = (target, source) => {
    if (!filledFields.includes(source)) return;
    if (!isMissingPdfValue(merged[target])) return;
    if (isMissingPdfValue(merged[source])) return;
    merged[target] = merged[source];
    if (!filledFields.includes(target)) filledFields.push(target);
  };

  if (merged.commodity === "luce") {
    deriveAiAlias("fornitore_luce", "fornitore");
    deriveAiAlias("codice_cliente_luce", "codice_cliente");
    deriveAiAlias("indirizzo_fornitura_luce", "indirizzo_fornitura");
  }
  if (merged.commodity === "gas") {
    deriveAiAlias("fornitore_gas", "fornitore");
    deriveAiAlias("codice_cliente_gas", "codice_cliente");
    deriveAiAlias("indirizzo_fornitura_gas", "indirizzo_fornitura");
  }
  if (merged.commodity === "dual") {
    deriveAiAlias("fornitore_luce", "fornitore");
    deriveAiAlias("fornitore_gas", "fornitore");
  }
}

function mergeCompletedAiResult(base, ai, policy) {
  const aiConflictFields = new Set((ai.conflicts || []).map((item) => canonicalPdfField(item?.field)).filter(Boolean));
  const rejected = [];
  const grouped = new Map();

  for (const candidate of ai.candidates || []) {
    const field = canonicalPdfField(candidate.field);
    candidate.field = field;
    const reason = candidateRejection(candidate, aiConflictFields);
    if (reason) {
      rejected.push({ field, reason });
      continue;
    }
    const value = normalizeCandidateValue(candidate);
    if (value === null || value === undefined || value === "") {
      rejected.push({ field, reason: "value_or_unit_not_safe" });
      continue;
    }
    if (!grouped.has(field)) grouped.set(field, []);
    grouped.get(field).push({ candidate, value });
  }

  const merged = { ...base };
  const selected = [];
  const filledFields = [];
  const diagnostics = [...(base.diagnostics || [])];

  for (const [field, entries] of grouped) {
    const values = new Map();
    for (const entry of entries) {
      const key = valueKey(entry.value);
      if (!values.has(key)) values.set(key, []);
      values.get(key).push(entry);
    }
    if (values.size !== 1) {
      rejected.push({ field, reason: "conflicting_ai_values" });
      continue;
    }
    const best = [...values.values()][0].sort((a, b) => b.candidate.confidence - a.candidate.confidence)[0];
    if (!isMissingPdfValue(merged[field]) && merged[field] !== "unknown") {
      if (valueKey(merged[field]) !== valueKey(best.value)) rejected.push({ field, reason: "protected_existing_value" });
      continue;
    }
    merged[field] = best.value;
    selected.push({
      field,
      value: best.value,
      confidence: best.candidate.confidence,
      page: best.candidate.page,
      evidence: compact(best.candidate.evidence, 360),
      label: best.candidate.label || null,
      unit: best.candidate.normalized_unit || best.candidate.unit || null,
    });
    filledFields.push(field);
    diagnostics.push(candidateDiagnostic(best.candidate, best.value));
  }

  applySupplySpecificAliases(merged, filledFields);
  const baseScore = scorePdfResult(base);
  merged.recognized = ["bolletta", "scheda_offerta"].includes(merged.kind)
    && ["luce", "gas", "dual"].includes(merged.commodity)
    && selected.length >= 2;
  const nextScore = scorePdfResult(merged);
  const material = selected.length >= 2
    && selected.some((item) => HIGH_VALUE_FIELDS.has(item.field))
    && nextScore >= baseScore + 3;

  if (!material) {
    return {
      ...base,
      ai: {
        pipeline_version: PDF_AI_FALLBACK_PIPELINE_VERSION,
        attempted: true,
        applied: false,
        reason: "no_material_improvement",
        trigger: policy.reason,
        model: ai.model || null,
        response_id: ai.response_id || null,
        candidate_count: (ai.candidates || []).length,
        rejected_fields: rejected,
        consent_granted: true,
      },
      warnings: unique([...(base.warnings || []), "ai_fallback_senza_miglioramento"]),
      needsReview: true,
    };
  }

  merged.diagnostics = diagnostics;
  merged.confidence = "medium";
  merged.needsReview = true;
  merged.warnings = unique([
    ...(base.warnings || []).filter((warning) => !["nessun_dato_utile_rilevato"].includes(warning)),
    "ai_fallback_utilizzato",
    "ai_verifica_utente_richiesta",
  ]);
  merged.ai = {
    pipeline_version: PDF_AI_FALLBACK_PIPELINE_VERSION,
    attempted: true,
    applied: true,
    reason: "material_improvement",
    trigger: policy.reason,
    model: ai.model || null,
    response_id: ai.response_id || null,
    review_required: true,
    consent_granted: true,
    candidate_count: (ai.candidates || []).length,
    filled_fields: unique(filledFields).sort(),
    field_meta: Object.fromEntries(selected.map((item) => [item.field, item])),
    rejected_fields: rejected,
    provider_conflicts: ai.conflicts || [],
    review_reasons: ai.review_reasons || [],
    page_map: ai.page_map || [],
  };
  return applyPdfDataContract(applyPdfFieldValidation(merged));
}

function aiStatusOnly(base, policy, ai, consentGranted) {
  const reason = ai?.reason || ai?.status || policy.reason;
  return {
    ...base,
    ai: {
      pipeline_version: PDF_AI_FALLBACK_PIPELINE_VERSION,
      attempted: Boolean(policy.attempt),
      applied: false,
      reason,
      trigger: policy.reason,
      model: ai?.model || null,
      consent_granted: Boolean(consentGranted),
    },
  };
}

export async function applyControlledPdfAiFallback(filePath, {
  filename = "documento.pdf",
  normalized = {},
  consentGranted = false,
  deadlineAt = null,
  env = process.env,
  transport,
  apiKey,
} = {}) {
  const policy = shouldAttemptPdfAiFallback({ normalized, filename, consentGranted, deadlineAt, env });
  if (!policy.attempt) return aiStatusOnly(normalized, policy, null, consentGranted);

  const parserCandidates = legacyPdfToCandidates(normalized);
  const ai = await runPdfAiFallback({
    filePath,
    filename,
    legacyNormalized: normalized,
    parserCandidates,
    deadlineAt,
    consentGranted,
    env,
    transport,
    apiKey,
  });
  if (ai.status !== "completed") return aiStatusOnly(normalized, policy, ai, consentGranted);
  return mergeCompletedAiResult(normalized, ai, policy);
}
