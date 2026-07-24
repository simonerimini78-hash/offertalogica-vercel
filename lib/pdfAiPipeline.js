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
  createPdfCandidate,
  legacyPdfToCandidates,
  pdfFieldDefinition,
} from "./pdfReaderContract.js";
import { arbitratePdfCandidates } from "./pdfEvidencePolicy.js";
import { isMissingPdfValue } from "./pdfOcrPolicy.js";

export const PDF_AI_PIPELINE_VERSION = "step8-clean-single-pipeline-v4-timeout-safe-diagnostics";

const IDENTIFIER_FIELDS = new Set(["pod", "pdr", "codice_fiscale", "codice_cliente"]);
const OFFER_CODE_FIELDS = new Set(["codice_offerta_luce", "codice_offerta_gas"]);
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
const SALES_PRICE_PATTERN = /\b(?:prezzo\s+(?:energia|gas|materia)|costo\s+per\s+consumi|corrispettivo\s+(?:energia|gas|consumo)|componente\s+(?:energia|gas|materia)|materia\s+(?:prima|gas|energia)|spesa\s+(?:per\s+la\s+)?vendita|prezzo\s+di\s+vendita|condizioni\s+economiche)\b/i;
const FIXED_SALES_PATTERN = /\b(?:quota\s+fissa|corrispettivo\s+fisso|commercializzazione|vendita\s+fissa|ccv)\b/i;
const ANNUAL_CONSUMPTION_PATTERN = /\b(?:consumo\s+annuo|consumo\s+annuale|consumi\s+annui|ultimi\s+12\s+mesi|rolling\s*12|annual\s+consumption)\b/i;
const POD_LABEL_PATTERN = /\b(?:pod|punto\s+di\s+prelievo)\b/i;
const PDR_LABEL_PATTERN = /\b(?:pdr|punto\s+di\s+riconsegna)\b/i;
const TAX_LABEL_PATTERN = /\b(?:codice\s+fiscale|c\.?\s*f\.?|partita\s+iva|p\.?\s*iva)\b/i;
const CUSTOMER_CODE_LABEL_PATTERN = /\b(?:codice\s+cliente|numero\s+cliente|customer\s+(?:code|number))\b/i;
const SPREAD_PATTERN = /\b(?:spread|delta|maggiorazione)\b/i;
const OFFER_CODE_LABEL_PATTERN = /\bcodice\s+(?:dell[’\']?\s*)?offerta\b/i;
const OFFER_CODE_VALUE_PATTERN = /^[A-Z0-9][A-Z0-9._\/-]{11,79}$/i;

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

function normalizedCommodity(value) {
  const source = compact(value, 80).toLowerCase();
  if (["electricity", "luce"].includes(source)) return "luce";
  if (source === "gas") return "gas";
  if (source === "dual") return "dual";
  return "unknown";
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function structuredEvidence(parts = []) {
  return compact(parts.filter(Boolean).join(" | "), 360);
}

function consumptionCandidateFromObservation(observation, index) {
  if (observation?.period_role !== "annual") return null;
  const commodity = normalizedCommodity(observation?.commodity);
  const field = commodity === "luce"
    ? "consumo_luce_kwh"
    : commodity === "gas"
      ? "consumo_gas_smc"
      : null;
  const value = finitePositive(observation?.value_number);
  const unit = compact(observation?.unit, 60);
  if (!field || value === null || !unit) return null;
  if (commodity === "luce" && !/kwh/i.test(unit)) return null;
  if (commodity === "gas" && !/(?:smc|std\.?\s*m3|standard\s*m3)/i.test(unit)) return null;
  const evidence = structuredEvidence([
    observation?.label ? `Etichetta: ${observation.label}` : "",
    observation?.evidence,
  ]);
  if (!ANNUAL_CONSUMPTION_PATTERN.test(evidence)) return null;
  return createPdfCandidate({
    id: `ai:consumption_inventory:${field}:${index}`,
    field,
    value_number: value,
    normalized_value: value,
    unit: commodity === "luce" ? "kWh/anno" : "Smc/anno",
    normalized_unit: commodity === "luce" ? "kWh/anno" : "Smc/anno",
    commodity,
    page: observation?.page,
    label: observation?.label || "Consumo annuale",
    evidence,
    semantic_role: "actual_customer_value",
    source: "ai",
    source_version: "structured-consumption-inventory-v1",
    confidence: observation?.confidence,
    method: "gpt41_visual_consumption_inventory",
    warnings: ["structured_consumption_inventory"],
  }, index);
}

function economicCandidateFromRow(row, index) {
  const commodity = normalizedCommodity(row?.commodity);
  if (!["luce", "gas"].includes(commodity)) return null;
  const role = compact(row?.component_role, 80);
  if (!["sales_variable", "sales_fixed"].includes(role)) return null;
  const rate = finitePositive(row?.unit_rate_number);
  const rateUnit = compact(row?.unit_rate_unit, 80);
  if (rate === null || !rateUnit) return null;
  const evidence = structuredEvidence([
    row?.section_label ? `Sezione: ${row.section_label}` : "",
    row?.row_label ? `Riga: ${row.row_label}` : "",
    row?.evidence,
  ]);
  if (!evidence) return null;

  if (role === "sales_variable") {
    const expectedUnit = commodity === "luce" ? /(?:€|eur)\s*\/?\s*kwh/i : /(?:€|eur)\s*\/?\s*smc/i;
    if (!expectedUnit.test(rateUnit)) return null;
    return createPdfCandidate({
      id: `ai:economic_inventory:price:${commodity}:${index}`,
      field: commodity === "luce" ? "prezzo_luce_eur_kwh" : "prezzo_gas_eur_smc",
      value_number: rate,
      normalized_value: rate,
      unit: commodity === "luce" ? "EUR/kWh" : "EUR/Smc",
      normalized_unit: commodity === "luce" ? "EUR/kWh" : "EUR/Smc",
      commodity,
      page: row?.page,
      label: compact([row?.section_label, row?.row_label].filter(Boolean).join(" — "), 180) || "Componente vendita",
      evidence,
      semantic_role: "sales_component",
      source: "ai",
      source_version: "structured-economic-inventory-v1",
      confidence: row?.confidence,
      method: "gpt41_visual_economic_inventory",
      warnings: ["structured_economic_inventory"],
    }, index);
  }

  const monthly = row?.period_unit === "month" || /(?:€|eur)\s*\/?\s*(?:mese|month)/i.test(rateUnit);
  const annual = row?.period_unit === "year" || /(?:€|eur)\s*\/?\s*(?:anno|year|pod\s*\/\s*anno|pdr\s*\/\s*anno)/i.test(rateUnit);
  if (!monthly && !annual) return null;
  const normalizedValue = monthly ? Number((rate * 12).toFixed(8)) : rate;
  const field = commodity === "luce"
    ? "quota_fissa_vendita_luce_eur_anno"
    : "quota_fissa_vendita_gas_eur_anno";
  const candidate = createPdfCandidate({
    id: `ai:economic_inventory:fixed:${commodity}:${index}`,
    field,
    value_number: normalizedValue,
    normalized_value: normalizedValue,
    unit: commodity === "luce" ? "EUR/POD/anno" : "EUR/PDR/anno",
    normalized_unit: commodity === "luce" ? "EUR/POD/anno" : "EUR/PDR/anno",
    commodity,
    page: row?.page,
    label: compact([row?.section_label, row?.row_label].filter(Boolean).join(" — "), 180) || "Quota fissa vendita",
    evidence,
    semantic_role: "sales_component",
    source: "ai",
    source_version: "structured-economic-inventory-v1",
    confidence: row?.confidence,
    method: "gpt41_visual_economic_inventory",
    warnings: monthly
      ? ["structured_economic_inventory", "monthly_value_annualized_deterministically"]
      : ["structured_economic_inventory"],
  }, index);
  if (monthly) {
    candidate.derivation = {
      type: "monthly_to_annual",
      original_value: rate,
      original_unit: rateUnit,
      factor: 12,
      derived_value: normalizedValue,
    };
  }
  return candidate;
}

export function candidatesFromStructuredInventories(ai = {}) {
  const observations = (ai.consumption_observations || [])
    .map(consumptionCandidateFromObservation)
    .filter(Boolean);
  const economic = (ai.economic_rows || [])
    .map(economicCandidateFromRow)
    .filter(Boolean);
  const seen = new Set();
  return [...observations, ...economic].filter((candidate) => {
    const key = `${candidate.field}|${valueKey(candidate.normalized_value)}|${candidate.page || 0}|${candidate.method}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function consumptionInventoryReason(observation) {
  if (observation?.period_role !== "annual") return `informational_${observation?.period_role || "unknown"}`;
  const commodity = normalizedCommodity(observation?.commodity);
  if (!['luce', 'gas'].includes(commodity)) return "commodity_unknown";
  if (finitePositive(observation?.value_number) === null) return "value_not_positive";
  const unit = compact(observation?.unit, 60);
  if (!unit) return "unit_missing";
  if (commodity === "luce" && !/kwh/i.test(unit)) return "unit_not_kwh";
  if (commodity === "gas" && !/(?:smc|std\.?\s*m3|standard\s*m3)/i.test(unit)) return "unit_not_smc";
  const evidence = structuredEvidence([observation?.label, observation?.evidence]);
  if (!ANNUAL_CONSUMPTION_PATTERN.test(evidence)) return "annual_label_missing";
  return null;
}

function economicInventoryReason(row) {
  const commodity = normalizedCommodity(row?.commodity);
  if (!['luce', 'gas'].includes(commodity)) return "commodity_unknown";
  const role = compact(row?.component_role, 80);
  if (!['sales_variable', 'sales_fixed'].includes(role)) return `informational_${role || "unknown"}`;
  const rate = finitePositive(row?.unit_rate_number);
  const rateUnit = compact(row?.unit_rate_unit, 80);
  if (rate === null) return "unit_rate_not_positive";
  if (!rateUnit) return "unit_rate_unit_missing";
  if (!structuredEvidence([row?.section_label, row?.row_label, row?.evidence])) return "evidence_missing";
  if (role === "sales_variable") {
    const expected = commodity === "luce" ? /(?:€|eur)\s*\/?\s*kwh/i : /(?:€|eur)\s*\/?\s*smc/i;
    if (!expected.test(rateUnit)) return "sales_price_unit_mismatch";
    return null;
  }
  const monthly = row?.period_unit === "month" || /(?:€|eur)\s*\/?\s*(?:mese|month)/i.test(rateUnit);
  const annual = row?.period_unit === "year" || /(?:€|eur)\s*\/?\s*(?:anno|year|pod\s*\/\s*anno|pdr\s*\/\s*anno)/i.test(rateUnit);
  if (!monthly && !annual) return "fixed_fee_period_missing";
  return null;
}

function promotedCandidateMatch(candidate, promoted = []) {
  return promoted.some((item) => item.field === candidate.field
    && valueKey(item.value) === valueKey(candidate.normalized_value)
    && Number(item.page || 0) === Number(candidate.page || 0));
}

function rejectedCandidateMatch(candidate, rejected = []) {
  return rejected.find((item) => item.field === candidate.field
    && valueKey(item.value) === valueKey(candidate.normalized_value)
    && Number(item.page || 0) === Number(candidate.page || 0));
}

export function structuredInventoryDiagnostics(ai = {}, { promoted = [], rejected = [] } = {}) {
  const consumptions = (ai.consumption_observations || []).slice(0, 24).map((observation, index) => {
    const candidate = consumptionCandidateFromObservation(observation, index);
    const conversionReason = consumptionInventoryReason(observation);
    const safetyRejection = candidate ? rejectedCandidateMatch(candidate, rejected) : null;
    const decision = !candidate
      ? "informational_or_rejected"
      : promotedCandidateMatch(candidate, promoted)
        ? "promoted_for_review"
        : safetyRejection
          ? "rejected_by_safety"
          : "accepted_not_promoted";
    return {
      page: Number(observation?.page || 0) || null,
      commodity: normalizedCommodity(observation?.commodity),
      label: compact(observation?.label, 160) || null,
      value: Number.isFinite(Number(observation?.value_number)) ? Number(observation.value_number) : null,
      unit: compact(observation?.unit, 60) || null,
      period_role: compact(observation?.period_role, 60) || "unknown",
      decision,
      candidate_field: candidate?.field || null,
      reason: conversionReason || safetyRejection?.reason || (decision === "accepted_not_promoted" ? "arbitration_or_existing_value" : null),
      evidence: compact(observation?.evidence, 260) || null,
    };
  });
  const economics = (ai.economic_rows || []).slice(0, 30).map((row, index) => {
    const candidate = economicCandidateFromRow(row, index);
    const conversionReason = economicInventoryReason(row);
    const safetyRejection = candidate ? rejectedCandidateMatch(candidate, rejected) : null;
    const decision = !candidate
      ? "informational_or_rejected"
      : promotedCandidateMatch(candidate, promoted)
        ? "promoted_for_review"
        : safetyRejection
          ? "rejected_by_safety"
          : "accepted_not_promoted";
    return {
      page: Number(row?.page || 0) || null,
      commodity: normalizedCommodity(row?.commodity),
      section_label: compact(row?.section_label, 140) || null,
      row_label: compact(row?.row_label, 180) || null,
      row_relation: compact(row?.row_relation, 40) || "unknown",
      component_role: compact(row?.component_role, 60) || "unknown",
      unit_rate: Number.isFinite(Number(row?.unit_rate_number)) ? Number(row.unit_rate_number) : null,
      unit_rate_unit: compact(row?.unit_rate_unit, 60) || null,
      period_unit: compact(row?.period_unit, 40) || "unknown",
      decision,
      candidate_field: candidate?.field || null,
      reason: conversionReason || safetyRejection?.reason || (decision === "accepted_not_promoted" ? "arbitration_or_existing_value" : null),
      evidence: compact(row?.evidence, 300) || null,
    };
  });
  return { consumptions, economics };
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
    if (!["actual_customer_value", "offer_value", "sales_component"].includes(candidate.semantic_role)) {
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
    const derivation = candidate.derivation;
    const validMonthlyDerivation = derivation?.type === "monthly_to_annual"
      && finitePositive(derivation.original_value) !== null
      && MONTHLY_PATTERN.test(String(derivation.original_unit || ""))
      && Number(derivation.factor) === 12
      && Math.abs(Number(derivation.original_value) * 12 - value) < 0.000001;
    if (MONTHLY_PATTERN.test(`${evidence} ${candidate.normalized_unit || candidate.unit || ""}`) && !validMonthlyDerivation) {
      return "monthly_fixed_fee_not_annualized";
    }
    if (!validMonthlyDerivation && !ANNUAL_PATTERN.test(`${evidence} ${candidate.normalized_unit || candidate.unit || ""}`)) {
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

  if (OFFER_CODE_FIELDS.has(field)) {
    const evidence = evidenceText(candidate);
    const value = compact(candidate.normalized_value, 100).toUpperCase();
    if (!OFFER_CODE_LABEL_PATTERN.test(evidence)) return "offer_code_label_missing";
    if (!OFFER_CODE_VALUE_PATTERN.test(value)) return "offer_code_format_invalid";
    candidate.normalized_value = value;
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
    source_version: candidate.source_version || null,
    derivation: candidate.derivation || null,
  };
}

function markReview(fieldStatus, field, reason, evidence = null) {
  fieldStatus[field] = {
    status: "da_verificare",
    reason,
    evidence,
  };
}

function promoteMissingDocumentMetadata(merged, ai, reviewOverrides, promoted) {
  const document = ai?.document || {};
  const proposals = [
    ["kind", normalizeClassification("kind", document.document_type)],
    ["commodity", normalizeClassification("commodity", document.commodity)],
    ["customer_type", normalizeClassification("customer_type", document.customer_type)],
    ["fornitore", compact(document.supplier, 180) || null],
  ];
  let promotedCount = 0;
  for (const [field, value] of proposals) {
    if (!value || (!isMissingPdfValue(merged[field]) && merged[field] !== "unknown")) continue;
    merged[field] = value;
    promotedCount += 1;
    const evidence = `Metadato documento IA: ${field}=${value}`;
    merged.diagnostics.push({
      field,
      label: "Classificazione documento",
      value,
      status: "review",
      confidence: "medium",
      page: 1,
      source_snippet: evidence,
      method: "gpt41_visual_document_metadata",
    });
    promoted.push({
      field,
      value,
      status: "review",
      page: 1,
      evidence,
      method: "document_metadata_consensus",
    });
    reviewOverrides.set(field, {
      reason: "classificazione_documento_ia",
      evidence,
    });
  }
  return promotedCount;
}

function mergeCompletedPdfAi(base, ai, parserCandidates) {
  const structuredCandidates = candidatesFromStructuredInventories(ai);
  const structuredFields = new Set(structuredCandidates.map((candidate) => candidate.field));
  const directCandidates = (ai.candidates || []).filter((candidate) => {
    const field = canonicalPdfField(candidate?.field);
    return !structuredFields.has(field);
  });
  const aiWithStructuredCandidates = {
    ...ai,
    candidates: [...directCandidates, ...structuredCandidates],
  };
  const { accepted, rejected, modelConflictFields } = filterSafePdfAiCandidates(aiWithStructuredCandidates);
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
      derivation: selected.derivation || null,
    });
    if (review) {
      reviewOverrides.set(field, {
        reason: IDENTIFIER_FIELDS.has(field) ? "identificativo_letto_solo_da_ia" : "valore_letto_solo_da_ia",
        evidence: compact(selected.evidence, 240),
      });
    }
  }

  const documentMetadataPromoted = promoteMissingDocumentMetadata(
    merged,
    ai,
    reviewOverrides,
    promoted,
  );
  const firstValidation = applyPdfFieldValidation(merged);
  firstValidation.field_status = { ...(firstValidation.field_status || {}) };
  for (const [field, detail] of reviewOverrides) {
    markReview(firstValidation.field_status, field, detail.reason, detail.evidence);
  }
  firstValidation.ai = {
    applied: true,
    pipeline_version: PDF_AI_PIPELINE_VERSION,
    reader_version: ai?.reader_version || null,
    filled_fields: unique(promoted.map((item) => item.field)),
    structured_consumption_count: Array.isArray(ai?.consumption_observations) ? ai.consumption_observations.length : 0,
    structured_economic_row_count: Array.isArray(ai?.economic_rows) ? ai.economic_rows.length : 0,
  };
  firstValidation.needsReview = Boolean(
    firstValidation.needsReview
    || reviewOverrides.size
    || rejected.length
    || modelConflictFields.size,
  );
  const recognizedByClassification = ["bolletta", "scheda_offerta"].includes(firstValidation.kind)
    && ["luce", "gas", "dual"].includes(firstValidation.commodity);
  if (recognizedByClassification) {
    firstValidation.recognized = true;
    if (!["high", "medium"].includes(firstValidation.confidence)) firstValidation.confidence = "medium";
  }
  firstValidation.warnings = unique([
    ...(firstValidation.warnings || []),
    reviewOverrides.size ? "dati_ia_da_verificare" : "",
    documentMetadataPromoted ? "classificazione_documento_ia_da_verificare" : "",
    structuredCandidates.length ? "inventari_strutturati_ia_applicati" : "",
    rejected.length ? "candidati_ia_scartati" : "",
    conflicts.length ? "conflitti_ia_non_promossi" : "",
  ]);
  const revalidated = applyPdfFieldValidation(firstValidation);
  const normalized = applyPdfDataContract(revalidated);
  return {
    normalized,
    arbitration,
    promoted,
    rejected,
    conflicts,
    inventoryDiagnostics: structuredInventoryDiagnostics(ai, { promoted, rejected }),
  };
}

function aiAudit({
  policy,
  ai,
  arbitration = null,
  promoted = [],
  rejected = [],
  conflicts = [],
  inventoryDiagnostics = { consumptions: [], economics: [] },
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
      consumption_observation_count: Array.isArray(ai?.consumption_observations) ? ai.consumption_observations.length : 0,
      economic_row_count: Array.isArray(ai?.economic_rows) ? ai.economic_rows.length : 0,
      inventory_diagnostics: inventoryDiagnostics,
    },
    arbitration,
    promoted,
    rejected,
    conflicts,
  };
}

function publicPdfAiReason(rawReason) {
  const reason = compact(rawReason, 300).toLowerCase();
  if (!reason) return null;
  for (const allowed of [
    "disabled",
    "filename_not_allowed",
    "shadow_archive_unavailable",
    "missing_openai_api_key",
    "insufficient_reserved_budget",
    "insufficient_time_budget",
    "all_ai_batches_failed",
  ]) {
    if (reason === allowed) return allowed;
  }
  if (reason.includes("timeout")) return "openai_timeout";
  if (reason.includes("openai_http_")) return "openai_http_error";
  if (reason.includes("safe_merge_failed")) return "safe_merge_failed";
  return "ai_error";
}

export function publicPdfAiStatus(audit = {}) {
  const status = audit?.ai?.status || (audit?.enabled ? "not_started" : "skipped");
  const rawReason = status === "completed" ? null : audit?.ai?.reason || audit?.reason;
  return {
    mode: audit?.mode || "off",
    status,
    reason: publicPdfAiReason(rawReason),
    public_output: audit?.public_output || "step7_unchanged",
    candidate_count: Number(audit?.ai?.candidate_count || 0),
    promoted_count: Array.isArray(audit?.promoted) ? audit.promoted.length : 0,
    partial: Boolean(audit?.ai?.partial),
    consumption_observation_count: Number(audit?.ai?.consumption_observation_count || 0),
    economic_row_count: Number(audit?.ai?.economic_row_count || 0),
    inventories: audit?.ai?.inventory_diagnostics || { consumptions: [], economics: [] },
    batches: (audit?.ai?.batches || []).map((batch) => ({
      id: batch.id,
      phase: batch.phase,
      profile: batch.profile,
      pages: batch.pages,
      page_selection: batch.page_selection || null,
      status: batch.status,
      reason: publicPdfAiReason(batch.reason),
      elapsed_ms: batch.elapsed_ms,
      candidate_count: batch.candidate_count,
      consumption_observation_count: batch.consumption_observation_count || 0,
      economic_row_count: batch.economic_row_count || 0,
      document_commodity: batch.document_commodity || null,
    })),
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
        inventoryDiagnostics: merged.inventoryDiagnostics,
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
      inventoryDiagnostics: merged.inventoryDiagnostics,
      publicOutput: "safe_review_merge",
    }),
  };
}
