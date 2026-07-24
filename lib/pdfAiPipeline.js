import { applyPdfDataContract } from "./pdfDataContract.js";
import { applyPdfFieldValidation } from "./pdfFieldValidation.js";
import {
  createPdfAiBudgetPlan,
  filenameAllowedByPdfAi,
  pdfAiConfig,
} from "./pdfAiConfig.js";
import { runPdfAiPass } from "./pdfAiReader.js";
import { runDeterministicPdfAiRaster } from "./pdfAiRasterBatchedReader.js";
import {
  canonicalPdfField,
  legacyPdfToCandidates,
  pdfFieldDefinition,
} from "./pdfReaderContract.js";
import { arbitratePdfCandidates } from "./pdfEvidencePolicy.js";
import { isMissingPdfValue } from "./pdfOcrPolicy.js";

export const PDF_AI_PIPELINE_VERSION = "step8-clean-single-pipeline-v1";

const IDENTIFIER_FIELDS = new Set(["pod", "pdr", "codice_fiscale", "codice_cliente"]);
const NUMERIC_FIELDS = new Set([
  "consumo_luce_kwh",
  "consumo_gas_smc",
  "prezzo_luce_eur_kwh",
  "prezzo_gas_eur_smc",
  "quota_fissa_vendita_luce_eur_anno",
  "quota_fissa_vendita_gas_eur_anno",
  "potenza_impegnata_kw",
  "potenza_disponibile_kw",
  "spread_luce_eur_kwh",
  "spread_gas_eur_smc",
]);
const CLASSIFICATION_FIELDS = new Set([
  "kind",
  "commodity",
  "customer_type",
  "tipo_prezzo",
  "tipo_prezzo_luce",
  "tipo_prezzo_gas",
]);

const ANNUAL_PATTERN = /\b(?:annuo|annua|annuale|anno|ultimi\s+12\s+mesi|rolling\s*12|12\s+months?)\b/i;
const MONTHLY_PATTERN = /\b(?:mese|mensile|al\s+mese|\/\s*mese|month|monthly)\b/i;
const AVERAGE_OR_BILL_PATTERN = /\b(?:prezzo|costo|spesa)\s+medi[oa]|costo\s+medio\s+unitario|totale\s+(?:bolletta|fattura)|spesa\s+del\s+periodo|importo\s+fattura\b/i;
const NON_SALES_PATTERN = /\b(?:trasporto|rete|oneri|impost[ae]|iva|accise?|potenza|dispacciamento|capacita|capacity|perequazione|misura)\b/i;
const SALES_PRICE_PATTERN = /\b(?:prezzo\s+(?:energia|gas|materia)|costo\s+per\s+consumi|corrispettivo\s+(?:energia|gas|consumo)|componente\s+(?:energia|gas|materia)|materia\s+prima|prezzo\s+di\s+vendita|condizioni\s+economiche)\b/i;
const FIXED_SALES_PATTERN = /\b(?:quota\s+fissa|corrispettivo\s+fisso|commercializzazione|vendita\s+fissa|ccv)\b/i;
const ANNUAL_CONSUMPTION_PATTERN = /\b(?:consumo\s+annuo|consumo\s+annuale|consumi\s+annui|ultimi\s+12\s+mesi|rolling\s*12|annual\s+consumption)\b/i;
const POD_LABEL_PATTERN = /\b(?:pod|punto\s+di\s+prelievo)\b/i;
const PDR_LABEL_PATTERN = /\b(?:pdr|punto\s+di\s+riconsegna)\b/i;
const TAX_LABEL_PATTERN = /\b(?:codice\s+fiscale|c\.?\s*f\.?|partita\s+iva|p\.?\s*iva)\b/i;
const CUSTOMER_CODE_LABEL_PATTERN = /\b(?:codice\s+cliente|numero\s+cliente|customer\s+(?:code|number))\b/i;
const SPREAD_PATTERN = /\b(?:spread|delta|maggiorazione)\b/i;

function compact(value, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function evidenceText(candidate) {
  return `${compact(candidate.label, 180)} ${compact(candidate.evidence, 360)}`.trim();
}

function valueKey(value) {
  if (typeof value === "number" && Number.isFinite(value)) return `number:${value.toPrecision(12)}`;
  return `text:${compact(value).toLowerCase()}`;
}

function candidateNumber(candidate) {
  const value = Number(candidate.normalized_value);
  return Number.isFinite(value) ? value : null;
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
    const normalized = source.replace(/[\s.-]/g, "");
    return /^(?:[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]|\d{11})$/.test(normalized)
      ? normalized
      : null;
  }
  if (field === "codice_cliente") {
    const normalized = source.replace(/[\s.-]/g, "");
    return /^(?=.{6,20}$)(?=.*\d)[A-Z0-9]+$/.test(normalized) ? normalized : null;
  }
  return compact(value, 240) || null;
}

function normalizeClassification(field, value) {
  const source = compact(value, 120).toLowerCase();
  if (field === "kind") {
    if (["bill", "invoice", "bolletta"].includes(source)) return "bolletta";
    if (["synthetic_sheet", "cte", "combined_offer_document", "placet", "scheda_offerta"].includes(source)) {
      return "scheda_offerta";
    }
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
  if (field.startsWith("tipo_prezzo")) {
    if (/^(?:fixed|fisso|prezzo fisso)$/.test(source)) return "fisso";
    if (/^(?:variable|variabile|indexed|indicizzato|prezzo variabile)$/.test(source)) return "variabile";
    if (/^(?:hybrid|ibrido|non convenzionale)$/.test(source)) return "ibrido";
    return null;
  }
  return compact(value, 240) || null;
}

function commodityCompatible(field, candidateCommodity) {
  if (field.includes("_luce") || field === "pod" || field.startsWith("potenza_")) {
    return ["luce", "dual"].includes(candidateCommodity);
  }
  if (field.includes("_gas") || field === "pdr") {
    return ["gas", "dual"].includes(candidateCommodity);
  }
  return true;
}

function unitIncludes(candidate, pattern) {
  return pattern.test(compact(candidate.normalized_unit || candidate.unit, 100));
}

function economicCandidateReason(candidate) {
  const field = candidate.field;
  const evidence = evidenceText(candidate);
  const value = candidateNumber(candidate);
  if (value === null || value <= 0) return "economic_value_not_positive";
  if (!candidate.evidence || !candidate.label || !candidate.page) return "economic_evidence_incomplete";
  if (!commodityCompatible(field, candidate.commodity)) return "economic_commodity_mismatch";

  if (field === "prezzo_luce_eur_kwh" || field === "prezzo_gas_eur_smc") {
    const isLuce = field === "prezzo_luce_eur_kwh";
    if (!["actual_customer_value", "offer_value"].includes(candidate.semantic_role)) {
      return "economic_semantic_role_not_contractual";
    }
    if (AVERAGE_OR_BILL_PATTERN.test(evidence)) return "average_or_bill_cost_not_contract_price";
    if (NON_SALES_PATTERN.test(evidence)) return "regulated_or_non_sales_component";
    if (!SALES_PRICE_PATTERN.test(evidence)) return "sales_price_label_missing";
    if (!unitIncludes(candidate, isLuce ? /(?:€|eur)\s*\/?\s*kwh/i : /(?:€|eur)\s*\/?\s*smc/i)) {
      return "sales_price_unit_mismatch";
    }
    if (value > (isLuce ? 2 : 5)) return "sales_price_out_of_range";
    return null;
  }

  if (field.includes("quota_fissa_vendita")) {
    if (!["actual_customer_value", "offer_value", "sales_component"].includes(candidate.semantic_role)) {
      return "fixed_fee_semantic_role_not_sales";
    }
    if (!FIXED_SALES_PATTERN.test(evidence)) return "fixed_sales_label_missing";
    if (NON_SALES_PATTERN.test(evidence.replace(FIXED_SALES_PATTERN, ""))) {
      return "fixed_fee_non_sales_component";
    }
    if (MONTHLY_PATTERN.test(`${evidence} ${candidate.normalized_unit || candidate.unit || ""}`)) {
      return "monthly_fixed_fee_not_annualized";
    }
    if (!ANNUAL_PATTERN.test(`${evidence} ${candidate.normalized_unit || candidate.unit || ""}`)) {
      return "annual_fixed_fee_evidence_missing";
    }
    if (value > 10_000) return "fixed_fee_out_of_range";
    return null;
  }

  if (field.startsWith("spread_")) {
    const isLuce = field === "spread_luce_eur_kwh";
    if (!["offer_value", "sales_component"].includes(candidate.semantic_role)) {
      return "spread_semantic_role_not_sales";
    }
    if (!SPREAD_PATTERN.test(evidence)) return "spread_label_missing";
    if (!unitIncludes(candidate, isLuce ? /(?:€|eur)\s*\/?\s*kwh/i : /(?:€|eur)\s*\/?\s*smc/i)) {
      return "spread_unit_mismatch";
    }
    return null;
  }
  return null;
}

function candidateRejectionReason(candidate, modelConflictFields) {
  const field = canonicalPdfField(candidate?.field);
  const definition = pdfFieldDefinition(field);
  if (!definition) return "unknown_field";
  candidate.field = field;
  if (!candidate.evidence || !candidate.label || !candidate.page) return "literal_evidence_missing";
  if (modelConflictFields.has(field)) return "model_reported_conflict";
  if (!definition.roles.includes(candidate.semantic_role)) return "semantic_role_not_allowed";

  if (IDENTIFIER_FIELDS.has(field)) {
    const evidence = evidenceText(candidate);
    const expectedLabel = field === "pod"
      ? POD_LABEL_PATTERN
      : field === "pdr"
        ? PDR_LABEL_PATTERN
        : field === "codice_fiscale"
          ? TAX_LABEL_PATTERN
          : CUSTOMER_CODE_LABEL_PATTERN;
    if (!expectedLabel.test(evidence)) return "identifier_label_missing";
    const normalized = normalizeIdentifier(field, candidate.normalized_value);
    if (!normalized) return "identifier_format_invalid";
    candidate.normalized_value = normalized;
  }

  if (CLASSIFICATION_FIELDS.has(field)) {
    const normalized = normalizeClassification(field, candidate.normalized_value);
    if (!normalized) return "classification_not_supported";
    candidate.normalized_value = normalized;
  }

  if (field === "consumo_luce_kwh" || field === "consumo_gas_smc") {
    const value = candidateNumber(candidate);
    if (value === null || value <= 0 || value > 100_000_000) return "annual_consumption_out_of_range";
    if (candidate.semantic_role !== "actual_customer_value") return "consumption_not_actual_annual_value";
    if (!ANNUAL_CONSUMPTION_PATTERN.test(evidenceText(candidate))) return "annual_consumption_label_missing";
    if (!commodityCompatible(field, candidate.commodity)) return "consumption_commodity_mismatch";
    if (!unitIncludes(candidate, field === "consumo_luce_kwh" ? /kwh/i : /(?:smc|std\.?\s*m3|standard\s*m3)/i)) {
      return "consumption_unit_mismatch";
    }
  }

  if (field.startsWith("prezzo_") || field.startsWith("quota_fissa_vendita") || field.startsWith("spread_")) {
    const reason = economicCandidateReason(candidate);
    if (reason) return reason;
  }

  if (field.startsWith("potenza_")) {
    const value = candidateNumber(candidate);
    if (value === null || value <= 0 || value > 1_100) return "power_out_of_range";
    if (!unitIncludes(candidate, /\bkw\b/i)) return "power_unit_mismatch";
    if (!/\bpotenza\b/i.test(evidenceText(candidate))) return "power_label_missing";
  }

  if (NUMERIC_FIELDS.has(field) && candidateNumber(candidate) === null) return "numeric_value_invalid";
  return null;
}

export function filterSafePdfAiCandidates(ai = {}) {
  const modelConflictFields = new Set(
    (ai.conflicts || []).map((item) => canonicalPdfField(item?.field)).filter(Boolean),
  );
  const accepted = [];
  const rejected = [];
  for (const original of ai.candidates || []) {
    const candidate = { ...original };
    const reason = candidateRejectionReason(candidate, modelConflictFields);
    if (reason) {
      rejected.push({
        field: canonicalPdfField(candidate.field),
        reason,
        value: candidate.normalized_value,
        page: candidate.page,
        evidence: compact(candidate.evidence, 240),
      });
    } else {
      accepted.push(candidate);
    }
  }
  return { accepted, rejected, modelConflictFields };
}

function comparisonCoreMissing(normalized = {}) {
  const missing = [];
  if (["luce", "dual"].includes(normalized.commodity)) {
    for (const field of [
      "consumo_luce_kwh",
      "prezzo_luce_eur_kwh",
      "quota_fissa_vendita_luce_eur_anno",
    ]) {
      if (isMissingPdfValue(normalized[field])) missing.push(field);
    }
  }
  if (["gas", "dual"].includes(normalized.commodity)) {
    for (const field of [
      "consumo_gas_smc",
      "prezzo_gas_eur_smc",
      "quota_fissa_vendita_gas_eur_anno",
    ]) {
      if (isMissingPdfValue(normalized[field])) missing.push(field);
    }
  }
  return missing;
}

export function shouldRunPdfAi({
  normalized = {},
  filename = "",
  raster = false,
  archiveReady = false,
  env = process.env,
} = {}) {
  const config = pdfAiConfig(env);
  if (config.mode === "off" || config.disabled) return { attempt: false, reason: "disabled", config };
  if (!filenameAllowedByPdfAi(filename, config.filenamePattern)) {
    return { attempt: false, reason: "filename_not_allowed", config };
  }
  if (config.mode === "shadow" && !archiveReady) {
    return { attempt: false, reason: "shadow_archive_unavailable", config };
  }
  if (raster) return { attempt: true, reason: "client_rasterized_pdf", config };
  if (config.mode === "shadow") return { attempt: true, reason: "shadow_evaluation", config };

  const missingCore = comparisonCoreMissing(normalized);
  const complete = Boolean(normalized.recognized)
    && ["bolletta", "scheda_offerta"].includes(normalized.kind)
    && ["luce", "gas", "dual"].includes(normalized.commodity)
    && missingCore.length === 0;
  return complete
    ? { attempt: false, reason: "step7_result_complete", config, missing_core: [] }
    : {
      attempt: true,
      reason: normalized.recognized ? "comparison_core_incomplete" : "unrecognized_after_step7",
      config,
      missing_core: missingCore,
    };
}

function candidateDiagnostic(candidate, value, status) {
  return {
    field: candidate.field,
    label: candidate.label || candidate.field,
    value,
    status,
    confidence: Number(candidate.confidence || 0) >= 85 ? "high" : "medium",
    page: candidate.page,
    source_snippet: compact(candidate.evidence, 360),
    method: candidate.method || "gpt41_visual",
  };
}

function markReview(fieldStatus, field, reason, evidence = null) {
  fieldStatus[field] = {
    status: "da_verificare",
    reason,
    evidence,
  };
}

function mergeCompletedPdfAi(base, ai, parserCandidates) {
  const { accepted, rejected, modelConflictFields } = filterSafePdfAiCandidates(ai);
  const arbitration = arbitratePdfCandidates({
    normalized: base,
    candidates: [...parserCandidates, ...accepted],
  });
  const merged = {
    ...base,
    diagnostics: [...(base.diagnostics || [])],
    warnings: [...(base.warnings || [])],
  };
  const reviewOverrides = new Map();
  const promoted = [];
  const conflicts = [];

  for (const decision of arbitration.decisions) {
    const field = decision.field;
    if (!decision.selected) {
      if (["blocked", "needs_review"].includes(decision.status) && decision.reason === "conflicting_values") {
        conflicts.push({
          field,
          reason: "conflicting_values",
          values: unique((decision.candidates || []).map((item) => valueKey(item.normalized_value))),
        });
        reviewOverrides.set(field, {
          reason: "conflitto_tra_letture",
          evidence: (decision.candidates || []).map((item) => compact(item.evidence, 120)).filter(Boolean).join(" | "),
        });
      }
      continue;
    }

    const selected = decision.selected;
    const selectedValue = selected.normalized_value;
    if (!isMissingPdfValue(merged[field]) && merged[field] !== "unknown") {
      if (valueKey(merged[field]) !== valueKey(selectedValue)) {
        conflicts.push({
          field,
          reason: "protected_step7_value_conflicts_with_ai",
          values: [valueKey(merged[field]), valueKey(selectedValue)],
        });
        reviewOverrides.set(field, {
          reason: "conflitto_con_lettura_step7",
          evidence: compact(selected.evidence, 240),
        });
      }
      continue;
    }

    merged[field] = selectedValue;
    const review = decision.status !== "accepted";
    merged.diagnostics.push(candidateDiagnostic(selected, selectedValue, review ? "review" : "found"));
    promoted.push({
      field,
      value: selectedValue,
      status: review ? "review" : "accepted",
      page: selected.page,
      evidence: compact(selected.evidence, 240),
    });
    if (review) {
      reviewOverrides.set(field, {
        reason: IDENTIFIER_FIELDS.has(field) ? "identificativo_letto_solo_da_ia" : "valore_letto_solo_da_ia",
        evidence: compact(selected.evidence, 240),
      });
    }
  }

  const fieldValidated = applyPdfFieldValidation(merged);
  fieldValidated.field_status = { ...(fieldValidated.field_status || {}) };
  for (const [field, detail] of reviewOverrides) {
    markReview(fieldValidated.field_status, field, detail.reason, detail.evidence);
  }
  fieldValidated.needsReview = Boolean(
    fieldValidated.needsReview
    || reviewOverrides.size
    || rejected.length
    || modelConflictFields.size,
  );
  fieldValidated.warnings = unique([
    ...(fieldValidated.warnings || []),
    reviewOverrides.size ? "dati_ia_da_verificare" : "",
    rejected.length ? "candidati_ia_scartati" : "",
    conflicts.length ? "conflitti_ia_non_promossi" : "",
  ]);
  const normalized = applyPdfDataContract(fieldValidated);
  return {
    normalized,
    arbitration,
    promoted,
    rejected,
    conflicts,
  };
}

function aiAudit({
  policy,
  ai,
  arbitration = null,
  promoted = [],
  rejected = [],
  conflicts = [],
  publicOutput,
} = {}) {
  return {
    enabled: policy.attempt,
    mode: policy.config.mode,
    pipeline_version: PDF_AI_PIPELINE_VERSION,
    config_version: policy.config.version,
    public_output: publicOutput,
    reason: policy.reason,
    ai: {
      status: ai?.status || (policy.attempt ? "not_started" : "skipped"),
      reason: ai?.reason || null,
      model: ai?.model || policy.config.model,
      candidate_count: Array.isArray(ai?.candidates) ? ai.candidates.length : 0,
      partial: Boolean(ai?.partial),
      plan: ai?.plan || null,
      batches: ai?.batches || [],
    },
    arbitration,
    promoted,
    rejected,
    conflicts,
  };
}

export async function runPdfAiPipeline({
  filePath = "",
  imageFiles = [],
  filename = "documento.pdf",
  normalized = {},
  deadlineAt = null,
  archiveReady = false,
  env = process.env,
  transport,
  apiKey,
} = {}) {
  const raster = imageFiles.length > 0;
  const policy = shouldRunPdfAi({
    normalized,
    filename,
    raster,
    archiveReady,
    env,
  });
  if (!policy.attempt) {
    return {
      normalized,
      audit: aiAudit({
        policy,
        ai: null,
        publicOutput: "step7_unchanged",
      }),
    };
  }

  const parserCandidates = legacyPdfToCandidates(normalized);
  const budget = createPdfAiBudgetPlan({
    deadlineAt,
    raster,
    env,
  });
  let ai;
  try {
    ai = raster
      ? await runDeterministicPdfAiRaster({
        imageFiles,
        filename,
        legacyNormalized: normalized,
        parserCandidates,
        deadlineAt,
        env,
        transport,
        apiKey,
      })
      : await runPdfAiPass({
        filePath,
        filename,
        legacyNormalized: normalized,
        parserCandidates,
        deadlineAt,
        env,
        transport,
        apiKey,
        profile: "document",
        timeoutMs: budget.standardTimeoutMs,
      });
  } catch (error) {
    ai = {
      status: "failed",
      reason: String(error?.message || "pdf_ai_pipeline_error").slice(0, 300),
      candidates: [],
    };
  }

  if (ai.status !== "completed") {
    return {
      normalized,
      audit: aiAudit({
        policy,
        ai,
        publicOutput: policy.config.mode === "shadow"
          ? "step7_unchanged"
          : "step7_preserved_after_ai_failure",
      }),
    };
  }

  let merged;
  try {
    merged = mergeCompletedPdfAi(normalized, ai, parserCandidates);
  } catch (error) {
    return {
      normalized,
      audit: aiAudit({
        policy,
        ai: {
          ...ai,
          status: "failed",
          reason: `safe_merge_failed:${String(error?.message || "unknown").slice(0, 220)}`,
        },
        publicOutput: policy.config.mode === "shadow"
          ? "step7_unchanged"
          : "step7_preserved_after_ai_failure",
      }),
    };
  }

  if (policy.config.mode === "shadow") {
    return {
      normalized,
      audit: aiAudit({
        policy,
        ai,
        arbitration: merged.arbitration,
        promoted: merged.promoted,
        rejected: merged.rejected,
        conflicts: merged.conflicts,
        publicOutput: "step7_unchanged",
      }),
    };
  }

  return {
    normalized: merged.normalized,
    audit: aiAudit({
      policy,
      ai,
      arbitration: merged.arbitration,
      promoted: merged.promoted,
      rejected: merged.rejected,
      conflicts: merged.conflicts,
      publicOutput: "safe_review_merge",
    }),
  };
}
