import { applyPdfDataContract } from "./pdfDataContract.js";
import { applyPdfFieldValidation } from "./pdfFieldValidation.js";
import { runPdfAiFallback } from "./pdfAiReader.js";
import { runPdfAiFallbackImages } from "./pdfAiRasterBatchedReaderEconomicV3.js";
import {
  canonicalPdfField,
  legacyPdfToCandidates,
  pdfFieldDefinition,
  validatePdfCandidate,
} from "./pdfReaderContract.js";
import { isMissingPdfValue, scorePdfResult } from "./pdfOcrPolicy.js";

export const PDF_AI_FALLBACK_PIPELINE_VERSION = "v106.8.8.7.3-complete-activation-1";

const NUMERIC_LIMITS = Object.freeze({
  consumo_luce_kwh: { min: 1, max: 100_000_000, unit: /(?:kwh)/i, annual: true },
  consumo_gas_smc: { min: 1, max: 100_000_000, unit: /(?:smc|std\.?\s*m3|standard\s*m3)/i, annual: true },
  prezzo_luce_eur_kwh: { min: 0.000001, max: 5, unit: /(?:€|eur)\s*\/?\s*kwh/i },
  prezzo_gas_eur_smc: { min: 0.000001, max: 20, unit: /(?:€|eur)\s*\/?\s*smc/i },
  quota_fissa_vendita_luce_eur_anno: { min: 0.01, max: 10_000, unit: /(?:€|eur)/i, annual: true, rejectMonthly: true },
  quota_fissa_vendita_gas_eur_anno: { min: 0.01, max: 10_000, unit: /(?:€|eur)/i, annual: true, rejectMonthly: true },
  potenza_impegnata_kw: { min: 0.1, max: 1000, unit: /\bkw\b/i },
  potenza_disponibile_kw: { min: 0.1, max: 1100, unit: /\bkw\b/i },
  spread_luce_eur_kwh: { min: 0, max: 5, unit: /(?:€|eur)\s*\/?\s*kwh/i },
  spread_gas_eur_smc: { min: 0, max: 20, unit: /(?:€|eur)\s*\/?\s*smc/i },
});

const HIGH_VALUE_FIELDS = new Set([
  "consumo_luce_kwh", "consumo_gas_smc",
  "potenza_impegnata_kw", "potenza_disponibile_kw",
  "pod", "pdr", "codice_fiscale", "codice_cliente",
  "codice_offerta", "codice_offerta_luce", "codice_offerta_gas",
]);

const CLASSIFICATION_FIELDS = new Set([
  "kind", "commodity", "customer_type", "tipo_prezzo", "tipo_prezzo_luce", "tipo_prezzo_gas",
]);

const IDENTIFIER_FIELDS = new Set([
  "pod", "pdr", "codice_fiscale", "codice_cliente",
  "codice_offerta", "codice_offerta_luce", "codice_offerta_gas",
  "codice_prodotto_fornitore", "codice_prodotto_fornitore_luce", "codice_prodotto_fornitore_gas",
]);

const DATE_FIELDS = new Set([
  "decorrenza_condizioni_economiche", "scadenza_condizioni_economiche",
  "decorrenza_condizioni_economiche_luce", "scadenza_condizioni_economiche_luce",
  "decorrenza_condizioni_economiche_gas", "scadenza_condizioni_economiche_gas",
]);

const SUPPLIER_PRODUCT_CODE_LABEL_PATTERN = /\b(?:codice\s+prodotto|product\s+code|codice\s+articolo|codice\s+prodotto\s+attivo)\b/i;
const OFFICIAL_OFFER_CODE_LABEL_PATTERN = /\b(?:codice\s+offerta|codice\s+condizioni(?:\s+economiche)?|codice\s+cte|offer\s+code)\b/i;
const ECONOMIC_DATE_LABEL_PATTERN = /\b(?:(?:decorrenza|inizio|scadenza|validit[aà])\s+(?:delle?\s+)?condizioni\s+economiche|economic\s+conditions?\s+(?:start|expiry|expiration))\b/i;
const AVERAGE_UNIT_COST_LABEL_PATTERN = /\b(?:prezzo\s+medio|costo\s+medio|spesa\s+media|(?:prezzo|costo|spesa)\s+medio(?:a)?\s+unitari[oa]?|average\s+(?:unit\s+)?(?:price|cost))\b/i;
const BILLED_PERIOD_CONSUMPTION_LABEL_PATTERN = /\b(?:consumi?\s+fatturati?|consumo\s+(?:del|nel)\s+periodo|periodo\s+fatturato|consumption\s+for\s+the\s+billing\s+period)\b/i;
const ANNUAL_CONSUMPTION_LABEL_PATTERN = /\b(?:consumo\s+annuo|consumo\s+annuale|ultimi\s+12\s+mesi|rolling\s+12|annual\s+consumption)\b/i;
const EXPLICIT_POD_LABEL_PATTERN = /\b(?:pod|punto\s+di\s+prelievo)\b/i;
const EXPLICIT_PDR_LABEL_PATTERN = /\b(?:pdr|punto\s+di\s+riconsegna)\b/i;
const EXPLICIT_TAX_LABEL_PATTERN = /\b(?:codice\s+fiscale|c\.?\s*f\.?|p\.?\s*iva|partita\s+iva|vat(?:\s+id)?)\b/i;
const EXPLICIT_CUSTOMER_CODE_PATTERN = /\b(?:codice\s+cliente|customer\s+code)\b/i;
const EXPLICIT_COMMITTED_POWER_PATTERN = /\b(?:potenza\s+(?:contrattualmente\s+)?impegnata|committed\s+power)\b/i;
const EXPLICIT_AVAILABLE_POWER_PATTERN = /\b(?:potenza\s+disponibile|available\s+power)\b/i;

const EXPLICIT_OFFER_NAME_PATTERN = /\b(?:nome\s+offerta|denominazione\s+offerta|offerta\s+attiva|offer\s+name)\b/i;
const BILLING_DATE_PATTERN = /\b(?:periodo\s+di\s+fatturazione|periodo\s+fatturato|dal\s+\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\s+al\s+\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/i;

const SALES_VARIABLE_COMPONENT_PATTERN = /\b(?:di\s+cui\s+)?(?:spesa|quota|componente|corrispettivo)\s+(?:variabile\s+)?(?:per\s+)?(?:la\s+)?vendita\s+(?:di\s+)?(?:energia\s+elettrica|gas\s+naturale)|\b(?:materia\s+energia|materia\s+prima\s+gas|corrispettivo\s+energia)\b/i;
const SALES_FIXED_COMPONENT_PATTERN = /\b(?:quota\s+fissa|commercializzazione|ccv|pcv|pfix)\b[\s\S]{0,180}\b(?:vendita\s+(?:di\s+)?(?:energia\s+elettrica|gas\s+naturale)|materia\s+energia|materia\s+prima\s+gas)\b|\b(?:vendita\s+(?:di\s+)?(?:energia\s+elettrica|gas\s+naturale)|materia\s+energia|materia\s+prima\s+gas)\b[\s\S]{0,180}\b(?:quota\s+fissa|commercializzazione|ccv|pcv|pfix)\b/i;
const EXCLUDED_ECONOMIC_COMPONENT_PATTERN = /\b(?:prezzo\s+medio|costo\s+medio|spesa\s+media|rete|oneri|trasporto|distribuzione|contatore|potenza|imposte?|accise|iva|canone)\b/i;
const MONTHLY_MONEY_UNIT_PATTERN = /(?:€|eur)\s*\/?\s*(?:mese|month)|(?:€|eur)\s*\/\s*(?:pod|pdr)\s*\/\s*mese/i;
const ANNUAL_MONEY_UNIT_PATTERN = /(?:€|eur)\s*\/?\s*(?:anno|year)|(?:€|eur)\s*\/\s*(?:pod|pdr)\s*\/\s*anno/i;
const PRICE_INDEX_PATTERN = /\b(?:pun(?:\s+index)?|psv(?:\s+day\s+ahead)?|ttf|indice\s+di\s+riferimento)\b/i;
const ECONOMIC_FIELDS = new Set([
  "prezzo_luce_eur_kwh", "prezzo_gas_eur_smc",
  "quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno",
  "tipo_prezzo_luce", "tipo_prezzo_gas",
  "indice_riferimento_luce", "indice_riferimento_gas",
  "spread_luce_eur_kwh", "spread_gas_eur_smc",
  "formula_prezzo_luce", "formula_prezzo_gas",
  "periodicita_aggiornamento_indice_luce", "periodicita_aggiornamento_indice_gas",
]);

function literalEvidence(candidate) {
  return compact(candidate?.evidence, 360);
}

function explicitCommodity(candidate) {
  if (candidate?.commodity === "luce") return "luce";
  if (candidate?.commodity === "gas") return "gas";
  const field = String(candidate?.field || "");
  if (field.endsWith("_luce")) return "luce";
  if (field.endsWith("_gas")) return "gas";
  const evidence = literalEvidence(candidate);
  if (/\b(?:energia\s+elettrica|luce|pod|kwh)\b/i.test(evidence)) return "luce";
  if (/\b(?:gas\s+naturale|pdr|smc)\b/i.test(evidence)) return "gas";
  return null;
}

function comparableText(value) {
  return compact(value, 500)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it")
    .replace(/[^a-z0-9]/g, "");
}

function candidatePriority(entry) {
  const candidate = entry.candidate;
  const evidence = literalEvidence(candidate);
  let score = Number(candidate.confidence || 0);
  if (/critical_recovery/i.test(String(candidate.method || ""))) score += 14;
  if (/critical-recovery/i.test(String(candidate.source_version || ""))) score += 10;
  if (candidate.field === "pod" && EXPLICIT_POD_LABEL_PATTERN.test(evidence) && normalizeIdentifier("pod", entry.value)) score += 10;
  if (candidate.field === "pdr" && EXPLICIT_PDR_LABEL_PATTERN.test(evidence) && normalizeIdentifier("pdr", entry.value)) score += 10;
  if (candidate.field === "codice_fiscale" && EXPLICIT_TAX_LABEL_PATTERN.test(evidence) && normalizeIdentifier("codice_fiscale", entry.value)) score += 10;
  if (["consumo_luce_kwh", "consumo_gas_smc"].includes(candidate.field) && ANNUAL_CONSUMPTION_LABEL_PATTERN.test(evidence)) score += 9;
  if (["codice_offerta", "codice_offerta_luce", "codice_offerta_gas"].includes(candidate.field) && OFFICIAL_OFFER_CODE_LABEL_PATTERN.test(evidence)) score += 8;
  if (DATE_FIELDS.has(candidate.field) && ECONOMIC_DATE_LABEL_PATTERN.test(evidence)) score += 8;
  if (["prezzo_luce_eur_kwh", "prezzo_gas_eur_smc"].includes(candidate.field)
    && SALES_VARIABLE_COMPONENT_PATTERN.test(evidence)
    && !EXCLUDED_ECONOMIC_COMPONENT_PATTERN.test(evidence)) score += 12;
  if (["quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno"].includes(candidate.field)
    && SALES_FIXED_COMPONENT_PATTERN.test(evidence)) score += 12;
  if (["indice_riferimento_luce", "indice_riferimento_gas", "formula_prezzo_luce", "formula_prezzo_gas"].includes(candidate.field)
    && PRICE_INDEX_PATTERN.test(evidence)) score += 8;
  return score;
}

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

export function shouldAttemptPdfAiFallback({ normalized = {}, filename = "", deadlineAt = null, env = process.env } = {}) {
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

function evidenceSignalsAnnual(candidate) {
  const evidence = literalEvidence(candidate);
  return ANNUAL_CONSUMPTION_LABEL_PATTERN.test(evidence)
    || /\b(?:ultimi\s+12\s+mesi|rolling\s+12|annual\s+consumption)\b/i.test(evidence);
}

function decimalPlaces(value) {
  const source = String(value ?? "").trim();
  const normalized = source.replace(",", ".");
  const match = normalized.match(/\.(\d+)/);
  return match ? match[1].length : 0;
}

function normalizeNumericCandidate(field, candidate) {
  const config = NUMERIC_LIMITS[field];
  if (!config) return null;
  const raw = candidate.value_number ?? candidate.normalized_value;
  const number = Number(raw);
  if (!Number.isFinite(number) || number < config.min || number > config.max) return null;
  const explicitUnit = compact(candidate.unit || candidate.normalized_unit, 80);
  const evidence = literalEvidence(candidate);
  const context = `${explicitUnit} ${candidate.label || ""} ${evidence}`;
  if (!explicitUnit || !config.unit.test(explicitUnit)) return null;

  if (["quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno"].includes(field)) {
    if (!SALES_FIXED_COMPONENT_PATTERN.test(context) || EXCLUDED_ECONOMIC_COMPONENT_PATTERN.test(context.replace(/quota\s+fissa/ig, ""))) return null;
    if (MONTHLY_MONEY_UNIT_PATTERN.test(explicitUnit)) return Math.round(number * 12 * 1_000_000) / 1_000_000;
    if (ANNUAL_MONEY_UNIT_PATTERN.test(explicitUnit) || /\b(?:annuo|annua|annuale|per\s+anno)\b/i.test(evidence)) return number;
    return null;
  }

  if (config.rejectMonthly && /\b(?:mese|month)\b/i.test(context)) return null;
  if (config.annual && !evidenceSignalsAnnual(candidate)) return null;
  return number;
}

function normalizeCandidateValue(candidate) {
  const field = canonicalPdfField(candidate.field);
  if (NUMERIC_LIMITS[field]) return normalizeNumericCandidate(field, candidate);
  if (CLASSIFICATION_FIELDS.has(field)) return normalizeClassification(field, candidate.normalized_value);
  if (IDENTIFIER_FIELDS.has(field)) return normalizeIdentifier(field, candidate.normalized_value);
  if (DATE_FIELDS.has(field)) return normalizeDate(candidate.normalized_value);

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

function canonicalizeCandidate(input) {
  const candidate = { ...input, field: canonicalPdfField(input?.field) };
  const evidence = literalEvidence(candidate);
  const context = `${candidate.label || ""} ${evidence}`;
  const commodity = explicitCommodity(candidate);

  const offerCodeFields = new Set([
    "codice_offerta", "codice_offerta_luce", "codice_offerta_gas",
    "codice_prodotto_fornitore", "codice_prodotto_fornitore_luce", "codice_prodotto_fornitore_gas",
  ]);
  if (offerCodeFields.has(candidate.field)) {
    if (OFFICIAL_OFFER_CODE_LABEL_PATTERN.test(evidence)) {
      candidate.field = commodity ? `codice_offerta_${commodity}` : "codice_offerta";
      candidate.semantic_role = "identifier";
    } else if (SUPPLIER_PRODUCT_CODE_LABEL_PATTERN.test(evidence)) {
      candidate.field = commodity ? `codice_prodotto_fornitore_${commodity}` : "codice_prodotto_fornitore";
      candidate.semantic_role = "identifier";
    }
  }

  if (DATE_FIELDS.has(candidate.field)) {
    if (ECONOMIC_DATE_LABEL_PATTERN.test(evidence) && !BILLING_DATE_PATTERN.test(evidence)) {
      candidate.semantic_role = "contract_period";
    } else {
      candidate.semantic_role = "unknown";
    }
  }
  if (candidate.field === "fornitore" && /\b(?:fornitore|supplier|servizio\s+fatturato|logo|marchio)\b/i.test(context)) {
    candidate.semantic_role = "classification";
  }
  if (["kind", "commodity", "customer_type"].includes(candidate.field)) {
    candidate.semantic_role = "classification";
  }
  if (candidate.field === "pod" && EXPLICIT_POD_LABEL_PATTERN.test(evidence)) candidate.semantic_role = "identifier";
  if (candidate.field === "pdr" && EXPLICIT_PDR_LABEL_PATTERN.test(evidence)) candidate.semantic_role = "identifier";
  if (candidate.field === "codice_fiscale" && EXPLICIT_TAX_LABEL_PATTERN.test(evidence)) candidate.semantic_role = "identifier";
  if (candidate.field === "codice_cliente" && EXPLICIT_CUSTOMER_CODE_PATTERN.test(evidence)) candidate.semantic_role = "identifier";
  if (candidate.field.startsWith("nome_offerta") && (EXPLICIT_OFFER_NAME_PATTERN.test(context) || /\bofferta\b/i.test(evidence))) {
    candidate.semantic_role = "offer_value";
  }
  if (["consumo_luce_kwh", "consumo_gas_smc"].includes(candidate.field)
    && evidenceSignalsAnnual(candidate)
    && !BILLED_PERIOD_CONSUMPTION_LABEL_PATTERN.test(evidence)) {
    candidate.semantic_role = "actual_customer_value";
  }
  if (["prezzo_luce_eur_kwh", "prezzo_gas_eur_smc"].includes(candidate.field)
    && SALES_VARIABLE_COMPONENT_PATTERN.test(evidence)
    && !AVERAGE_UNIT_COST_LABEL_PATTERN.test(evidence)
    && !EXCLUDED_ECONOMIC_COMPONENT_PATTERN.test(evidence)) {
    candidate.semantic_role = "actual_customer_value";
  }
  if (["quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno"].includes(candidate.field)
    && SALES_FIXED_COMPONENT_PATTERN.test(context)) {
    candidate.semantic_role = "sales_component";
  }
  if (["indice_riferimento_luce", "indice_riferimento_gas", "spread_luce_eur_kwh", "spread_gas_eur_smc", "formula_prezzo_luce", "formula_prezzo_gas", "periodicita_aggiornamento_indice_luce", "periodicita_aggiornamento_indice_gas"].includes(candidate.field)) {
    candidate.semantic_role = "offer_value";
  }
  if (["tipo_prezzo_luce", "tipo_prezzo_gas"].includes(candidate.field)) {
    candidate.semantic_role = "classification";
  }
  return candidate;
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
  nome_offerta: 86,
  nome_offerta_luce: 86,
  nome_offerta_gas: 86,
  codice_prodotto_fornitore: 86,
  codice_prodotto_fornitore_luce: 86,
  codice_prodotto_fornitore_gas: 86,
});

function effectiveConfidenceThreshold(candidate) {
  const field = candidate.field;
  const evidence = literalEvidence(candidate);
  const context = `${candidate.label || ""} ${evidence}`;
  const unit = compact(candidate.unit || candidate.normalized_unit, 40);

  if (field === "pod" && EXPLICIT_POD_LABEL_PATTERN.test(evidence) && normalizeIdentifier(field, candidate.normalized_value)) return 90;
  if (field === "pdr" && EXPLICIT_PDR_LABEL_PATTERN.test(evidence) && normalizeIdentifier(field, candidate.normalized_value)) return 90;
  if (field === "codice_fiscale" && EXPLICIT_TAX_LABEL_PATTERN.test(evidence) && normalizeIdentifier(field, candidate.normalized_value)) return 90;
  if (field === "codice_cliente" && EXPLICIT_CUSTOMER_CODE_PATTERN.test(evidence) && normalizeIdentifier(field, candidate.normalized_value)) return 88;
  if (["codice_offerta", "codice_offerta_luce", "codice_offerta_gas"].includes(field)
    && OFFICIAL_OFFER_CODE_LABEL_PATTERN.test(evidence)
    && normalizeIdentifier(field, candidate.normalized_value)) return 85;
  if (DATE_FIELDS.has(field) && ECONOMIC_DATE_LABEL_PATTERN.test(evidence) && !BILLING_DATE_PATTERN.test(evidence) && normalizeDate(candidate.normalized_value)) return 80;
  if (field === "potenza_impegnata_kw" && /\bkw\b/i.test(unit) && EXPLICIT_COMMITTED_POWER_PATTERN.test(context)) return 85;
  if (field === "potenza_disponibile_kw" && /\bkw\b/i.test(unit) && EXPLICIT_AVAILABLE_POWER_PATTERN.test(context)) return 85;
  if (["consumo_luce_kwh", "consumo_gas_smc"].includes(field)
    && evidenceSignalsAnnual(candidate)
    && decimalPlaces(candidate.value_number ?? candidate.normalized_value) <= 3) return 90;
  if (["prezzo_luce_eur_kwh", "prezzo_gas_eur_smc"].includes(field)
    && SALES_VARIABLE_COMPONENT_PATTERN.test(evidence)
    && !EXCLUDED_ECONOMIC_COMPONENT_PATTERN.test(evidence)) return 90;
  if (["quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno"].includes(field)
    && SALES_FIXED_COMPONENT_PATTERN.test(context)
    && (MONTHLY_MONEY_UNIT_PATTERN.test(unit) || ANNUAL_MONEY_UNIT_PATTERN.test(unit))) return 90;
  if (["indice_riferimento_luce", "indice_riferimento_gas", "formula_prezzo_luce", "formula_prezzo_gas"].includes(field)
    && PRICE_INDEX_PATTERN.test(evidence)) return 88;
  if (Object.hasOwn(FIELD_CONFIDENCE_THRESHOLDS, field)) return FIELD_CONFIDENCE_THRESHOLDS[field];
  const definition = pdfFieldDefinition(field);
  if (definition?.critical) return 92;
  if (IDENTIFIER_FIELDS.has(field)) return 92;
  return 86;
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
  const visualContext = literalEvidence(candidate);
  if (["prezzo_luce_eur_kwh", "prezzo_gas_eur_smc"].includes(candidate.field)) {
    if (AVERAGE_UNIT_COST_LABEL_PATTERN.test(visualContext)) return "average_unit_cost_not_contract_price";
    if (EXCLUDED_ECONOMIC_COMPONENT_PATTERN.test(visualContext)) return "non_sales_component_not_comparable_price";
    if (candidate.semantic_role === "billing_period" && !SALES_VARIABLE_COMPONENT_PATTERN.test(visualContext)) {
      return "billing_period_unit_value_not_sales_component";
    }
  }
  if (["consumo_luce_kwh", "consumo_gas_smc"].includes(candidate.field)
    && (candidate.semantic_role === "billing_period" || BILLED_PERIOD_CONSUMPTION_LABEL_PATTERN.test(visualContext))) {
    return "billing_period_consumption_not_annual";
  }

  const validation = validatePdfCandidate(candidate);
  if (!validation.valid) return validation.errors.join(",");
  const definition = pdfFieldDefinition(candidate.field);
  if (!definition?.roles.includes(candidate.semantic_role)) return "semantic_role_not_allowed";
  if (candidate.source !== "ai") return "source_not_ai";
  if (!candidate.page || compact(candidate.evidence).length < 6) return "missing_page_or_evidence";
  if (candidate.confidence < effectiveConfidenceThreshold(candidate)) return "confidence_below_threshold";
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
    prezzo_luce_eur_kwh: "Componente vendita luce del periodo",
    prezzo_gas_eur_smc: "Componente vendita gas del periodo",
    quota_fissa_vendita_luce_eur_anno: "Quota fissa vendita luce annualizzata",
    quota_fissa_vendita_gas_eur_anno: "Quota fissa vendita gas annualizzata",
    indice_riferimento_luce: "Indice di riferimento luce",
    indice_riferimento_gas: "Indice di riferimento gas",
    formula_prezzo_luce: "Formula prezzo luce",
    formula_prezzo_gas: "Formula prezzo gas",
    potenza_impegnata_kw: "Potenza impegnata",
    potenza_disponibile_kw: "Potenza disponibile",
    pod: "POD",
    pdr: "PDR",
    intestatario: "Intestatario",
    codice_fiscale: "Codice fiscale / P.IVA",
    codice_cliente: "Codice cliente",
    indirizzo_fornitura: "Indirizzo fornitura",
    codice_offerta_luce: "Codice offerta luce",
    codice_offerta_gas: "Codice offerta gas",
    scadenza_condizioni_economiche_luce: "Scadenza condizioni economiche luce",
    scadenza_condizioni_economiche_gas: "Scadenza condizioni economiche gas",
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
    method: /critical_recovery/i.test(String(candidate.method || "")) ? "openai_visual_critical_recovery" : "openai_visual_consolidated",
  };
}

function inferCommodity(merged, selected) {
  const direct = ["luce", "gas", "dual"].includes(merged.commodity) ? merged.commodity : null;
  const fields = new Set(selected.map((item) => item.field));
  const hasLuce = Boolean(normalizeIdentifier("pod", merged.pod))
    || [...fields].some((field) => field.endsWith("_luce"));
  const hasGas = Boolean(normalizeIdentifier("pdr", merged.pdr))
    || [...fields].some((field) => field.endsWith("_gas"));
  if (hasLuce && hasGas) return "dual";
  if (direct) return direct;
  if (hasLuce) return "luce";
  if (hasGas) return "gas";
  return null;
}

function inferKind(merged, candidates, selected) {
  if (["bolletta", "scheda_offerta"].includes(merged.kind)) return merged.kind;
  const hasSupplyIdentifier = selected.some((item) => ["pod", "pdr"].includes(item.field));
  const billEvidence = candidates.some((candidate) => {
    const context = `${candidate.label || ""} ${candidate.evidence || ""}`;
    return /\b(?:bolletta|fattura|consumo\s+annuo|prezzo\s+medio|punto\s+di\s+prelievo|punto\s+di\s+riconsegna)\b/i.test(context);
  });
  return hasSupplyIdentifier && billEvidence ? "bolletta" : null;
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

export function mergeCompletedPdfAiForReview(base, ai, policy = { reason: "unrecognized_after_parser_and_ocr" }) {
  const modelCandidateCount = (ai.candidates || []).length;
  const canonicalCandidates = (ai.candidates || []).map(canonicalizeCandidate);
  const aiConflictFields = new Set((ai.conflicts || []).map((item) => canonicalPdfField(item?.field)).filter(Boolean));
  const rejected = [];
  const grouped = new Map();
  const reviewObservations = [];

  for (const candidate of canonicalCandidates) {
    const reason = candidateRejection(candidate, aiConflictFields);
    if (reason) {
      rejected.push(rejectedCandidate(candidate.field, reason, candidate));
      if (["consumo_luce_kwh", "consumo_gas_smc", "prezzo_luce_eur_kwh", "prezzo_gas_eur_smc"].includes(candidate.field)) {
        reviewObservations.push(rejectedCandidate(candidate.field, reason, candidate));
      }
      continue;
    }
    const value = normalizeCandidateValue(candidate);
    if (value === null || value === undefined || value === "") {
      rejected.push(rejectedCandidate(candidate.field, "value_or_unit_not_safe", candidate));
      continue;
    }
    if (!grouped.has(candidate.field)) grouped.set(candidate.field, []);
    grouped.get(candidate.field).push({ candidate, value });
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
    let best;
    if (values.size === 1) {
      best = [...values.values()][0].sort((a, b) => candidatePriority(b) - candidatePriority(a))[0];
    } else {
      const ranked = entries
        .map((entry) => ({ entry, score: candidatePriority(entry) }))
        .sort((a, b) => b.score - a.score);
      const top = ranked[0];
      const second = ranked[1];
      const equivalentText = second && comparableText(top.entry.value) === comparableText(second.entry.value);
      if (equivalentText || !second || top.score >= second.score + 6) {
        best = top.entry;
        rejected.push({ field, reason: "conflicting_ai_values_resolved_by_stronger_literal_evidence" });
      } else {
        rejected.push({ field, reason: "conflicting_ai_values" });
        continue;
      }
    }
    if (!isMissingPdfValue(merged[field]) && merged[field] !== "unknown") {
      if (valueKey(merged[field]) !== valueKey(best.value)) rejected.push({ field, reason: "protected_existing_value" });
      continue;
    }
    merged[field] = best.value;
    const sourceUnit = best.candidate.normalized_unit || best.candidate.unit || null;
    const monthlyFixedFee = ["quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno"].includes(field)
      && MONTHLY_MONEY_UNIT_PATTERN.test(compact(sourceUnit, 80));
    const observedSalesPrice = ["prezzo_luce_eur_kwh", "prezzo_gas_eur_smc"].includes(field)
      && SALES_VARIABLE_COMPONENT_PATTERN.test(literalEvidence(best.candidate));
    const metadata = {
      field,
      value: best.value,
      confidence: best.candidate.confidence,
      page: best.candidate.page,
      evidence: compact(best.candidate.evidence, 360),
      label: best.candidate.label || null,
      unit: monthlyFixedFee ? (field.endsWith("_luce_eur_anno") ? "EUR/POD/anno" : "EUR/PDR/anno") : sourceUnit,
      original_value: best.candidate.value_number ?? best.candidate.value_text ?? best.candidate.normalized_value ?? null,
      original_unit: sourceUnit,
      derived: monthlyFixedFee,
      conversion_factor: monthlyFixedFee ? 12 : null,
      economic_basis: monthlyFixedFee
        ? "quota_fissa_vendita_mensile_convertita_in_annuale"
        : observedSalesPrice
          ? "componente_vendita_unitaria_effettiva_del_periodo"
          : ECONOMIC_FIELDS.has(field)
            ? "condizione_economica_esplicita"
            : null,
    };
    selected.push(metadata);
    filledFields.push(field);
    diagnostics.push(candidateDiagnostic(best.candidate, best.value));
  }

  const inferredCommodity = inferCommodity(merged, selected);
  if (inferredCommodity && merged.commodity !== inferredCommodity) {
    merged.commodity = inferredCommodity;
    const evidenceItems = selected.filter((item) => item.field === "pod" || item.field === "pdr" || item.field.endsWith("_luce") || item.field.endsWith("_gas"));
    selected.push({
      field: "commodity",
      value: inferredCommodity,
      confidence: Math.max(90, ...evidenceItems.map((item) => Number(item.confidence) || 0)),
      page: evidenceItems.find((item) => item.page)?.page || 1,
      evidence: compact(evidenceItems.map((item) => `${item.field}: ${item.value}`).join("; ") || "Evidenza energetica esplicita", 360),
      label: "Fornitura derivata da evidenze esplicite",
      unit: null,
    });
    if (!filledFields.includes("commodity")) filledFields.push("commodity");
  }

  for (const commoditySuffix of ["luce", "gas"]) {
    const typeField = `tipo_prezzo_${commoditySuffix}`;
    const indexField = `indice_riferimento_${commoditySuffix}`;
    const formulaField = `formula_prezzo_${commoditySuffix}`;
    if (isMissingPdfValue(merged[typeField])
      && (PRICE_INDEX_PATTERN.test(compact(merged[indexField], 180)) || PRICE_INDEX_PATTERN.test(compact(merged[formulaField], 420)))) {
      merged[typeField] = "variabile";
      selected.push({
        field: typeField,
        value: "variabile",
        confidence: 90,
        page: selected.find((item) => [indexField, formulaField].includes(item.field))?.page || 1,
        evidence: compact(merged[indexField] || merged[formulaField], 360),
        label: "Tipo prezzo derivato da indice esplicito",
        unit: null,
        original_value: null,
        original_unit: null,
        derived: true,
        conversion_factor: null,
        economic_basis: "classificazione_derivata_da_indice_esplicito",
      });
      filledFields.push(typeField);
    }
  }

  const inferredKind = inferKind(merged, canonicalCandidates, selected);
  if (inferredKind && merged.kind !== inferredKind) {
    merged.kind = inferredKind;
    selected.push({
      field: "kind",
      value: inferredKind,
      confidence: 90,
      page: selected.find((item) => ["pod", "pdr"].includes(item.field))?.page || 1,
      evidence: "Identificativo di fornitura valido associato a evidenze tipiche di bolletta",
      label: "Tipo documento derivato da evidenze esplicite",
      unit: null,
    });
    if (!filledFields.includes("kind")) filledFields.push("kind");
  }

  const baseScore = scorePdfResult(base);
  const nextScore = scorePdfResult(merged);
  const material = selected.length >= 2
    && selected.some((item) => HIGH_VALUE_FIELDS.has(item.field))
    && nextScore >= baseScore + 2;

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
        review_observations: reviewObservations,
        automatic_fallback: true,
      },
      warnings: unique([...(base.warnings || []), "ai_fallback_senza_miglioramento"]),
      needsReview: true,
    };
  }

  merged.recognized = ["bolletta", "scheda_offerta"].includes(merged.kind)
    && ["luce", "gas", "dual"].includes(merged.commodity)
    && selected.length >= 2;
  merged.diagnostics = diagnostics;
  merged.confidence = "medium";
  merged.needsReview = true;
  const hasObservedSalesPrice = selected.some((item) => item.economic_basis === "componente_vendita_unitaria_effettiva_del_periodo");
  const hasAnnualizedMonthlyFee = selected.some((item) => item.economic_basis === "quota_fissa_vendita_mensile_convertita_in_annuale");
  merged.warnings = unique([
    ...(base.warnings || []).filter((warning) => warning !== "nessun_dato_utile_rilevato" && warning !== "ai_fallback_senza_miglioramento"),
    "ai_fallback_utilizzato",
    "ai_verifica_utente_richiesta",
    "ai_accettazione_sicura_evidenze_esplicite",
    hasObservedSalesPrice ? "prezzo_componente_vendita_del_periodo_da_verificare" : null,
    hasAnnualizedMonthlyFee ? "quota_fissa_mensile_convertita_in_annuale_da_verificare" : null,
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
    reader_version: ai.reader_version || null,
    batch_count: ai.batch_count || null,
    completed_batches: ai.completed_batches || null,
    failed_batches: ai.failed_batches || 0,
    focused_recovery_attempted: Boolean(ai.focused_recovery_attempted),
    focused_recovery_completed: Number(ai.focused_recovery_completed || 0),
    focused_recovery_failures: Array.isArray(ai.focused_recovery_failures) ? ai.focused_recovery_failures : [],
    filled_fields: unique(filledFields).sort(),
    field_meta: Object.fromEntries(selected.map((item) => [item.field, item])),
    rejected_fields: rejected,
    review_observations: reviewObservations,
    provider_conflicts: ai.conflicts || [],
    review_reasons: ai.review_reasons || [],
    page_map: ai.page_map || [],
  };

  const validated = applyPdfDataContract(applyPdfFieldValidation(merged));
  validated.ai = merged.ai;
  validated.needsReview = true;
  validated.recognized = merged.recognized;
  validated.warnings = unique([...(validated.warnings || []), ...merged.warnings]);
  return validated;
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
  return mergeCompletedPdfAiForReview(normalized, ai, policy);
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
  return mergeCompletedPdfAiForReview(normalized, ai, policy);
}
