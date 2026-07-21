import { applyPdfDataContract } from "./pdfDataContract.js";
import { applyPdfFieldValidation } from "./pdfFieldValidation.js";
import { runPdfAiFallback, runPdfAiFallbackImages } from "./pdfAiReader.js";
import {
  canonicalPdfField,
  createPdfCandidate,
  legacyPdfToCandidates,
  pdfFieldDefinition,
  validatePdfCandidate,
} from "./pdfReaderContract.js";
import { isMissingPdfValue, scorePdfResult } from "./pdfOcrPolicy.js";

export const PDF_AI_FALLBACK_PIPELINE_VERSION = "v106.8.4-business-consultant-readiness-1";

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
const IDENTIFIER_FIELDS = new Set([
  "pod", "pdr", "codice_fiscale", "codice_cliente",
  "codice_offerta", "codice_offerta_luce", "codice_offerta_gas",
  "codice_prodotto_fornitore", "codice_prodotto_fornitore_luce", "codice_prodotto_fornitore_gas",
]);

const BUSINESS_LEGAL_ENTITY_PATTERN = /\b(?:S\.?\s*R\.?\s*L\.?|S\.?\s*P\.?\s*A\.?|S\.?\s*A\.?\s*S\.?|S\.?\s*N\.?\s*C\.?|S\.?\s*S\.?|SOCIET[AÀ]|COOPERATIVA|CONSORZIO|IMPRESA|AZIENDA|DITTA)\b/i;
const EXPLICIT_VAT_LABEL_PATTERN = /(?:P\.?\s*IVA|PARTITA\s+IVA|VAT(?:\s+ID)?)/i;
const EXPLICIT_TAX_LABEL_PATTERN = /(?:CODICE\s+FISCALE|C\.?\s*F\.?|P\.?\s*IVA|PARTITA\s+IVA|VAT(?:\s+ID)?)/i;
const SUPPLIER_PRODUCT_CODE_LABEL_PATTERN = /\b(?:codice\s+prodotto|product\s+code|codice\s+articolo|codice\s+prodotto\s+attivo)\b/i;
const OFFICIAL_OFFER_CODE_LABEL_PATTERN = /\b(?:codice\s+offerta|codice\s+condizioni(?:\s+economiche)?|codice\s+cte|offer\s+code)\b/i;
const AVERAGE_UNIT_COST_LABEL_PATTERN = /\b(?:costo|spesa)\s+medio(?:a)?\s+unitari[oa]|\bcosto\s+unitari[oa]\s+medio|\baverage\s+unit\s+cost\b/i;
const BILLED_PERIOD_CONSUMPTION_LABEL_PATTERN = /\b(?:consumi?\s+fatturati?|consumo\s+(?:del|nel)\s+periodo|periodo\s+fatturato|consumption\s+for\s+the\s+billing\s+period)\b/i;
const EXPLICIT_COMMITTED_POWER_LABEL_PATTERN = /\b(?:potenza\s+(?:contrattualmente\s+)?impegnata|committed\s+power)\b/i;
const EXPLICIT_AVAILABLE_POWER_LABEL_PATTERN = /\b(?:potenza\s+disponibile|available\s+power)\b/i;

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
  deadlineAt = null,
  env = process.env,
} = {}) {
  if (String(env.PDF_AI_MODE || "off").trim().toLowerCase() !== "fallback") {
    return { attempt: false, reason: "disabled" };
  }
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
  if (["codice_prodotto_fornitore", "codice_prodotto_fornitore_luce", "codice_prodotto_fornitore_gas"].includes(field)) {
    const normalized = source.replace(/\s+/g, "");
    return /^[A-Z0-9_.-]{4,100}$/.test(normalized) ? normalized : null;
  }
  return source || null;
}

function explicitTaxIdFromText(value) {
  const source = compact(value, 600).toUpperCase();
  if (!source || !EXPLICIT_TAX_LABEL_PATTERN.test(source)) return null;
  const label = "(?:CODICE\\s+FISCALE|C\\.?\\s*F\\.?|P\\.?\\s*IVA|PARTITA\\s+IVA|VAT(?:\\s+ID)?)";
  const prefix = `${label}\\s*(?:N(?:UMERO)?\\.?|[:#-])?\\s*`;
  const numeric = source.match(new RegExp(`${prefix}(\\d(?:[ .-]?\\d){10})(?!\\d)`, "i"));
  if (numeric) return normalizeIdentifier("codice_fiscale", numeric[1]);
  const personal = source.match(new RegExp(`${prefix}([A-Z]{6}[ .-]?\\d{2}[ .-]?[A-Z][ .-]?\\d{2}[ .-]?[A-Z][ .-]?\\d{3}[ .-]?[A-Z])`, "i"));
  return personal ? normalizeIdentifier("codice_fiscale", personal[1]) : null;
}

function addExplicitTaxIdCandidate(ai) {
  if ((ai.candidates || []).some((candidate) => canonicalPdfField(candidate.field) === "codice_fiscale")) return;
  const evidenceSources = [
    ...(ai.candidates || []).map((candidate) => ({
      text: `${candidate.label || ""} ${candidate.evidence || ""}`,
      candidate,
      page: candidate.page,
      confidence: candidate.confidence,
      commodity: candidate.commodity,
      sourceVersion: candidate.source_version,
    })),
    ...(ai.page_map || []).map((page) => ({
      text: page.summary || "",
      candidate: null,
      page: page.page,
      confidence: 92,
      commodity: ai.document?.commodity || "unknown",
      sourceVersion: ai.model || "unknown",
    })),
  ];
  const matches = evidenceSources
    .map((source) => ({ ...source, value: explicitTaxIdFromText(source.text) }))
    .filter((source) => source.value);
  const values = unique(matches.map((source) => source.value));
  if (values.length !== 1) return;
  const best = matches
    .filter((source) => source.value === values[0])
    .sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0))[0];
  ai.candidates.push(createPdfCandidate({
    field: "codice_fiscale",
    value_text: values[0],
    normalized_value: values[0],
    commodity: best.commodity || ai.document?.commodity || "unknown",
    page: Number(best.page || 1),
    label: EXPLICIT_VAT_LABEL_PATTERN.test(best.text) ? "P.IVA" : "Codice fiscale",
    evidence: compact(best.text, 360),
    semantic_role: "identifier",
    source: "ai",
    source_version: best.sourceVersion || ai.model || "unknown",
    confidence: Math.max(94, Number(best.confidence || 0)),
    method: "controlled_explicit_tax_id_recovery",
    warnings: ["derived_from_explicit_visual_tax_label"],
  }, ai.candidates.length));
}

function businessEvidenceFromSelected(merged, selected) {
  const holder = selected.find((item) => item.field === "intestatario");
  if (holder && BUSINESS_LEGAL_ENTITY_PATTERN.test(String(merged.intestatario || ""))) {
    return {
      page: holder.page || 1,
      confidence: Math.max(90, Number(holder.confidence || 0)),
      evidence: compact(`Ragione sociale ${merged.intestatario}; forma giuridica esplicita, classificazione business`, 360),
      label: "Tipo cliente derivato dalla ragione sociale",
    };
  }
  const taxId = selected.find((item) => item.field === "codice_fiscale" && EXPLICIT_VAT_LABEL_PATTERN.test(`${item.label || ""} ${item.evidence || ""}`));
  if (taxId) {
    return {
      page: taxId.page || 1,
      confidence: Math.max(92, Number(taxId.confidence || 0)),
      evidence: compact(`${taxId.evidence}; P.IVA esplicita, classificazione business`, 360),
      label: "Tipo cliente derivato dalla P.IVA",
    };
  }
  return null;
}

function deriveBusinessCustomerType({ merged, selected, filledFields, diagnostics, warnings }) {
  if (!isMissingPdfValue(merged.customer_type) && merged.customer_type !== "unknown") return;
  const evidence = businessEvidenceFromSelected(merged, selected);
  if (!evidence) return;
  merged.customer_type = "business";
  const derived = {
    field: "customer_type",
    value: "business",
    confidence: Math.min(96, evidence.confidence),
    page: evidence.page,
    evidence: evidence.evidence,
    label: evidence.label,
    unit: null,
  };
  selected.push(derived);
  if (!filledFields.includes("customer_type")) filledFields.push("customer_type");
  diagnostics.push({
    field: "customer_type",
    label: evidence.label,
    value: "business",
    status: "review",
    confidence: "medium",
    required: true,
    page: evidence.page,
    source_snippet: evidence.evidence,
    source_match: "business",
    method: "controlled_business_profile_derivation",
  });
  warnings.push("ai_customer_type_derivato_da_evidenza_aziendale");
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

const FIELD_CONFIDENCE_THRESHOLDS = Object.freeze({
  kind: 88,
  commodity: 88,
  fornitore: 88,
  customer_type: 88,
  intestatario: 86,
  codice_cliente: 88,
  indirizzo_fornitura: 86,
  indirizzo_fornitura_luce: 86,
  indirizzo_fornitura_gas: 86,
  potenza_impegnata_kw: 88,
  potenza_disponibile_kw: 86,
  nome_offerta: 86,
  nome_offerta_luce: 86,
  nome_offerta_gas: 86,
  codice_prodotto_fornitore: 86,
  codice_prodotto_fornitore_luce: 86,
  codice_prodotto_fornitore_gas: 86,
});

function confidenceThreshold(field) {
  if (Object.hasOwn(FIELD_CONFIDENCE_THRESHOLDS, field)) return FIELD_CONFIDENCE_THRESHOLDS[field];
  const definition = pdfFieldDefinition(field);
  if (definition?.critical) return 92;
  if (IDENTIFIER_FIELDS.has(field)) return 92;
  return 86;
}

function explicitPowerThreshold(candidate) {
  const context = `${candidate?.label || ""} ${candidate?.evidence || ""}`;
  const unit = compact(candidate?.unit || candidate?.normalized_unit, 40);
  if (!/\bkw\b/i.test(unit)) return null;
  if (candidate?.field === "potenza_impegnata_kw" && EXPLICIT_COMMITTED_POWER_LABEL_PATTERN.test(context)) return 85;
  if (candidate?.field === "potenza_disponibile_kw" && EXPLICIT_AVAILABLE_POWER_LABEL_PATTERN.test(context)) return 85;
  return null;
}

function effectiveConfidenceThreshold(candidate) {
  return explicitPowerThreshold(candidate) ?? confidenceThreshold(candidate?.field);
}

function rejectedCandidate(field, reason, candidate = null) {
  const rejected = { field, reason };
  if (!candidate) return rejected;
  rejected.semantic_role = candidate.semantic_role || null;
  rejected.confidence = Number.isFinite(Number(candidate.confidence)) ? Number(candidate.confidence) : null;
  rejected.page = Number(candidate.page || 0) || null;
  rejected.label = compact(candidate.label, 160) || null;
  rejected.unit = compact(candidate.unit || candidate.normalized_unit, 80) || null;
  rejected.value = candidate.value_number ?? candidate.value_text ?? candidate.normalized_value ?? null;
  return rejected;
}

function candidateRejection(candidate, aiConflictFields) {
  const validation = validatePdfCandidate(candidate);
  if (!validation.valid) return validation.errors.join(",");
  const definition = pdfFieldDefinition(candidate.field);
  const visualContext = `${candidate.label || ""} ${candidate.evidence || ""}`;
  if (["prezzo_luce_eur_kwh", "prezzo_gas_eur_smc"].includes(candidate.field)
    && AVERAGE_UNIT_COST_LABEL_PATTERN.test(visualContext)) {
    return "average_unit_cost_not_contract_price";
  }
  if (["consumo_luce_kwh", "consumo_gas_smc"].includes(candidate.field)
    && (candidate.semantic_role === "billing_period" || BILLED_PERIOD_CONSUMPTION_LABEL_PATTERN.test(visualContext))) {
    return "billing_period_consumption_not_annual";
  }
  if (!definition?.roles.includes(candidate.semantic_role)) return "semantic_role_not_allowed";
  if (candidate.source !== "ai") return "source_not_ai";
  if (!candidate.page || compact(candidate.evidence).length < 6) return "missing_page_or_evidence";
  if (candidate.confidence < effectiveConfidenceThreshold(candidate)) return "confidence_below_threshold";
  if (Array.isArray(candidate.contradicts) && candidate.contradicts.length) return "contradicts_existing_source";
  if (aiConflictFields.has(candidate.field)) return "provider_reported_conflict";
  return null;
}

function canonicalizeSupplierProductCodeCandidate(candidate) {
  const field = canonicalPdfField(candidate?.field);
  if (!["codice_offerta", "codice_offerta_luce", "codice_offerta_gas"].includes(field)) return field;
  const context = `${candidate?.label || ""} ${candidate?.evidence || ""}`;
  if (!SUPPLIER_PRODUCT_CODE_LABEL_PATTERN.test(context) || OFFICIAL_OFFER_CODE_LABEL_PATTERN.test(context)) return field;

  const commodity = field.endsWith("_luce") || candidate?.commodity === "luce"
    ? "luce"
    : field.endsWith("_gas") || candidate?.commodity === "gas"
      ? "gas"
      : null;
  const target = commodity ? `codice_prodotto_fornitore_${commodity}` : "codice_prodotto_fornitore";
  candidate.field = target;
  candidate.semantic_role = "identifier";
  candidate.warnings = unique([...(candidate.warnings || []), "reclassified_supplier_product_code"]);
  return target;
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
    codice_prodotto_fornitore: "Codice prodotto fornitore",
    codice_prodotto_fornitore_luce: "Codice prodotto fornitore luce",
    codice_prodotto_fornitore_gas: "Codice prodotto fornitore gas",
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

function inferredCommodityFromSupplyIdentifiers(merged = {}) {
  const hasPod = Boolean(normalizeIdentifier("pod", merged.pod));
  const hasPdr = Boolean(normalizeIdentifier("pdr", merged.pdr));
  if (hasPod && hasPdr) return "dual";
  if (hasPod) return "luce";
  if (hasPdr) return "gas";
  return null;
}

function identifierSelectionForCommodity(selected = [], commodity = null) {
  const fields = commodity === "dual" ? ["pod", "pdr"] : commodity === "luce" ? ["pod"] : commodity === "gas" ? ["pdr"] : [];
  const matches = selected.filter((item) => fields.includes(item.field));
  if (!matches.length) return null;
  return {
    page: matches.find((item) => item.page)?.page || 1,
    confidence: Math.min(...matches.map((item) => Number(item.confidence) || 0).filter((value) => value > 0)),
    evidence: matches.map((item) => `${item.field.toUpperCase()} ${item.value}`).join(" + "),
  };
}

function reconcileCommodityWithSupplyIdentifiers({ merged, selected, filledFields, rejected, warnings }) {
  const inferred = inferredCommodityFromSupplyIdentifiers(merged);
  if (!inferred) return;

  const existingIndex = selected.findIndex((item) => item.field === "commodity");
  const existingAi = existingIndex >= 0 ? selected[existingIndex] : null;
  const current = ["luce", "gas", "dual"].includes(merged.commodity) ? merged.commodity : null;
  if (current && current === inferred) return;
  if (current && !existingAi) return;

  if (current && current !== inferred) {
    rejected.push({
      field: "commodity",
      reason: "classification_conflicts_with_supply_identifier",
      confidence: existingAi?.confidence ?? null,
      page: existingAi?.page ?? null,
      label: existingAi?.label || "Fornitura rilevata",
      unit: null,
      value: current,
      inferred_value: inferred,
    });
    warnings.push("ai_commodity_riallineata_a_identificativo_fornitura");
  } else {
    warnings.push("ai_commodity_derivata_da_identificativo_fornitura");
  }

  const identifier = identifierSelectionForCommodity(selected, inferred) || { page: 1, confidence: 94, evidence: "Identificativo di fornitura valido" };
  const derived = {
    field: "commodity",
    value: inferred,
    confidence: Math.max(90, Number(identifier.confidence) || 0),
    page: identifier.page || 1,
    evidence: compact(`${identifier.evidence}; classificazione coerente con l'identificativo di fornitura`, 360),
    label: "Fornitura derivata dall'identificativo",
    unit: null,
  };
  if (existingIndex >= 0) selected.splice(existingIndex, 1);
  selected.push(derived);
  merged.commodity = inferred;
  if (!filledFields.includes("commodity")) filledFields.push("commodity");
}

function applySupplySpecificAliases(merged, filledFields, selected, diagnostics) {
  const deriveAiAlias = (target, source) => {
    if (!filledFields.includes(source)) return;
    if (!isMissingPdfValue(merged[target])) return;
    if (isMissingPdfValue(merged[source])) return;
    merged[target] = merged[source];
    if (!filledFields.includes(target)) filledFields.push(target);

    const sourceMeta = selected.find((item) => item.field === source);
    if (!sourceMeta || selected.some((item) => item.field === target)) return;
    const aliasMeta = {
      ...sourceMeta,
      field: target,
      value: merged[target],
      derived_from: source,
    };
    selected.push(aliasMeta);
    diagnostics.push({
      field: target,
      label: aliasMeta.label || labelForField(target),
      value: aliasMeta.value,
      status: "review",
      confidence: "medium",
      required: Boolean(pdfFieldDefinition(target)?.critical),
      page: aliasMeta.page,
      source_snippet: compact(aliasMeta.evidence, 360),
      source_match: compact(aliasMeta.value, 180),
      method: "openai_visual_semantic_alias",
    });
  };

  if (merged.commodity === "luce") {
    deriveAiAlias("fornitore_luce", "fornitore");
    deriveAiAlias("codice_cliente_luce", "codice_cliente");
    deriveAiAlias("indirizzo_fornitura_luce", "indirizzo_fornitura");
    deriveAiAlias("nome_offerta_luce", "nome_offerta");
    deriveAiAlias("codice_prodotto_fornitore_luce", "codice_prodotto_fornitore");
  }
  if (merged.commodity === "gas") {
    deriveAiAlias("fornitore_gas", "fornitore");
    deriveAiAlias("codice_cliente_gas", "codice_cliente");
    deriveAiAlias("indirizzo_fornitura_gas", "indirizzo_fornitura");
    deriveAiAlias("nome_offerta_gas", "nome_offerta");
    deriveAiAlias("codice_prodotto_fornitore_gas", "codice_prodotto_fornitore");
  }
  if (merged.commodity === "dual") {
    deriveAiAlias("fornitore_luce", "fornitore");
    deriveAiAlias("fornitore_gas", "fornitore");
  }
}

function mergeCompletedAiResult(base, ai, policy) {
  const modelCandidateCount = (ai.candidates || []).length;
  addExplicitTaxIdCandidate(ai);
  const aiConflictFields = new Set((ai.conflicts || []).map((item) => canonicalPdfField(item?.field)).filter(Boolean));
  const rejected = [];
  const grouped = new Map();

  for (const candidate of ai.candidates || []) {
    const field = canonicalizeSupplierProductCodeCandidate(candidate);
    candidate.field = field;
    const reason = candidateRejection(candidate, aiConflictFields);
    if (reason) {
      rejected.push(rejectedCandidate(field, reason, candidate));
      continue;
    }
    const value = normalizeCandidateValue(candidate);
    if (value === null || value === undefined || value === "") {
      rejected.push(rejectedCandidate(field, "value_or_unit_not_safe", candidate));
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

  const classificationWarnings = [];
  deriveBusinessCustomerType({
    merged,
    selected,
    filledFields,
    diagnostics,
    warnings: classificationWarnings,
  });
  reconcileCommodityWithSupplyIdentifiers({
    merged,
    selected,
    filledFields,
    rejected,
    warnings: classificationWarnings,
  });
  applySupplySpecificAliases(merged, filledFields, selected, diagnostics);
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
        candidate_count: modelCandidateCount,
        timeout_ms: ai.timeout_ms || null,
        attempts: ai.attempts || 1,
        recovered_from: ai.recovered_from || null,
        primary_timeout_ms: ai.primary_timeout_ms || null,
        recovery_timeout_ms: ai.recovery_timeout_ms || null,
        rejected_fields: rejected,
        automatic_fallback: true,
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
    ...classificationWarnings,
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
    automatic_fallback: true,
    candidate_count: modelCandidateCount,
    timeout_ms: ai.timeout_ms || null,
    attempts: ai.attempts || 1,
    recovered_from: ai.recovered_from || null,
    primary_timeout_ms: ai.primary_timeout_ms || null,
    recovery_timeout_ms: ai.recovery_timeout_ms || null,
    request_profile: ai.request_profile || "full",
    filled_fields: unique(filledFields).sort(),
    field_meta: Object.fromEntries(selected.map((item) => [item.field, item])),
    rejected_fields: rejected,
    provider_conflicts: ai.conflicts || [],
    review_reasons: ai.review_reasons || [],
    page_map: ai.page_map || [],
  };
  return applyPdfDataContract(applyPdfFieldValidation(merged));
}

function aiStatusOnly(base, policy, ai) {
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
      timeout_ms: ai?.timeout_ms || null,
      attempts: ai?.attempts || (policy.attempt ? 1 : 0),
      recovered_from: ai?.recovered_from || null,
      primary_timeout_ms: ai?.primary_timeout_ms || null,
      recovery_timeout_ms: ai?.recovery_timeout_ms || null,
      recovery_attempted: Boolean(ai?.recovery_attempted),
      recovery_reason: ai?.recovery_reason || null,
      automatic_fallback: true,
    },
  };
}

export async function applyControlledPdfAiFallback(filePath, {
  filename = "documento.pdf",
  normalized = {},
  deadlineAt = null,
  env = process.env,
  transport,
  apiKey,
} = {}) {
  const policy = shouldAttemptPdfAiFallback({ normalized, filename, deadlineAt, env });
  if (!policy.attempt) return aiStatusOnly(normalized, policy, null);

  const parserCandidates = legacyPdfToCandidates(normalized);
  const ai = await runPdfAiFallback({
    filePath,
    filename,
    legacyNormalized: normalized,
    parserCandidates,
    deadlineAt,
    env,
    transport,
    apiKey,
  });
  if (ai.status !== "completed") return aiStatusOnly(normalized, policy, ai);
  return mergeCompletedAiResult(normalized, ai, policy);
}

export async function applyControlledPdfAiImageFallback(imageFiles = [], {
  filename = "documento.pdf",
  normalized = {},
  deadlineAt = null,
  env = process.env,
  transport,
  apiKey,
} = {}) {
  const policy = shouldAttemptPdfAiFallback({ normalized, filename, deadlineAt, env });
  if (!policy.attempt) return aiStatusOnly(normalized, policy, null);

  const parserCandidates = legacyPdfToCandidates(normalized);
  const ai = await runPdfAiFallbackImages({
    imageFiles,
    filename,
    legacyNormalized: normalized,
    parserCandidates,
    deadlineAt,
    env,
    transport,
    apiKey,
  });
  if (ai.status !== "completed") return aiStatusOnly(normalized, policy, ai);
  return mergeCompletedAiResult(normalized, ai, policy);
}

