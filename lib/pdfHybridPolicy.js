/**
 * OffertaLogica PDF hybrid policy.
 *
 * This module is deliberately self-contained: the hybrid orchestrator must
 * remain able to load even when OCR or AI adapters are unavailable.
 */

export const PDF_HYBRID_POLICY_VERSION = "v106.8.5-hybrid-policy-recovery-1";

export const AI_EXTRACTABLE_FIELDS = Object.freeze([
  "kind",
  "commodity",
  "fornitore",
  "customer_type",
  "intestatario",
  "codice_fiscale",
  "codice_cliente",
  "indirizzo_fornitura",
  "pod",
  "pdr",
  "potenza_impegnata_kw",
  "potenza_disponibile_kw",
  "consumo_luce_kwh",
  "consumo_gas_smc",
  "consumo_gas_mc",
  "prezzo_luce_eur_kwh",
  "prezzo_gas_eur_smc",
  "quota_fissa_vendita_luce_eur_anno",
  "quota_fissa_vendita_gas_eur_anno",
  "nome_offerta",
  "nome_offerta_luce",
  "nome_offerta_gas",
  "codice_offerta",
  "codice_offerta_luce",
  "codice_offerta_gas",
  "codice_prodotto_fornitore",
  "codice_prodotto_fornitore_luce",
  "codice_prodotto_fornitore_gas",
  "tipo_prezzo",
  "tipo_prezzo_luce",
  "tipo_prezzo_gas",
  "indice_riferimento",
  "indice_riferimento_luce",
  "indice_riferimento_gas",
  "spread_luce_eur_kwh",
  "spread_gas_eur_smc",
]);

const CONTROL_FIELDS = new Set([
  "analysis",
  "analysis_mode",
  "calculation_ready",
  "confidence",
  "data_contract",
  "diagnostics",
  "field_decisions",
  "field_sources",
  "field_status",
  "needsReview",
  "ocr",
  "page_count",
  "parser_version",
  "readiness",
  "recognized",
  "textExtracted",
  "warnings",
]);

const CLASSIFICATION_FIELDS = new Set(["kind", "commodity", "customer_type", "tipo_prezzo", "tipo_prezzo_luce", "tipo_prezzo_gas"]);
const IDENTIFIER_FIELDS = new Set([
  "pod",
  "pdr",
  "codice_fiscale",
  "codice_cliente",
  "codice_cliente_luce",
  "codice_cliente_gas",
  "codice_offerta",
  "codice_offerta_luce",
  "codice_offerta_gas",
  "codice_prodotto_fornitore",
  "codice_prodotto_fornitore_luce",
  "codice_prodotto_fornitore_gas",
]);
const ECONOMIC_FIELDS = new Set([
  "consumo_luce_kwh",
  "consumo_gas_smc",
  "consumo_gas_mc",
  "prezzo_luce_eur_kwh",
  "prezzo_gas_eur_smc",
  "quota_fissa_vendita_luce_eur_anno",
  "quota_fissa_vendita_gas_eur_anno",
  "spread_luce_eur_kwh",
  "spread_gas_eur_smc",
]);
const CALCULATION_FIELDS = Object.freeze({
  luce: ["consumo_luce_kwh", "prezzo_luce_eur_kwh", "quota_fissa_vendita_luce_eur_anno"],
  gas: ["consumo_gas_smc", "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno"],
});

const BILLING_PERIOD_PATTERN = /\b(?:consum[oi]\s+fatturat[oi]|consumo\s+(?:del|nel)\s+periodo|periodo\s+fatturato|billing\s+period)\b/i;
const EXPLICIT_ANNUAL_PATTERN = /\b(?:consumo\s+(?:annuo|annuale)|ultimi\s+12\s+mesi|365\s+giorni|annual\s+consumption)\b/i;
const AVERAGE_COST_PATTERN = /\b(?:(?:costo|spesa)\s+medio(?:a)?\s+unitari[oa]|prezzo\s+medio|average\s+unit\s+cost)\b/i;
const CONTRACT_PRICE_PATTERN = /\b(?:prezzo\s+energia|corrispettivo\s+(?:energia|gas)|componente\s+energia|pun\s*\+|psv\s*\+|spread|materia\s+(?:energia|gas)|spesa\s+per\s+la\s+vendita)\b/i;
const OFFER_GARBAGE_PATTERN = /\b(?:bollette?\s+precedenti|regolarmente\s+pagat[ea]|totale\s+da\s+pagare|scadenza|gentile\s+cliente|fattura)\b/i;

function missing(value) {
  return value === null || value === undefined || value === "" || value === "unknown";
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function compact(value, maxLength = 700) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cloneDiagnostics(value) {
  return Array.isArray(value) ? value.map((item) => ({ ...item })) : [];
}

function fieldEvidence(normalized, field) {
  const diagnostic = cloneDiagnostics(normalized?.diagnostics).find((item) => item?.field === field);
  return compact(diagnostic?.source_snippet || diagnostic?.source_match || diagnostic?.evidence || "");
}

function evidenceMap(aiResult = {}) {
  const result = {};
  for (const item of Array.isArray(aiResult?.evidence) ? aiResult.evidence : []) {
    const field = String(item?.field || "");
    if (!field) continue;
    const confidence = Number(item?.confidence);
    if (!result[field] || (Number.isFinite(confidence) ? confidence : 0) > (result[field].confidence || 0)) {
      result[field] = {
        field,
        page: Number.isInteger(item?.page) && item.page > 0 ? item.page : null,
        quote: compact(item?.quote),
        confidence: Number.isFinite(confidence) ? confidence : null,
      };
    }
  }
  return result;
}

function equivalent(field, left, right) {
  if (missing(left) || missing(right)) return false;
  const leftText = compact(left, 300).toLocaleUpperCase("it-IT");
  const rightText = compact(right, 300).toLocaleUpperCase("it-IT");
  if (IDENTIFIER_FIELDS.has(field)) {
    return leftText.replace(/[^A-Z0-9]/g, "") === rightText.replace(/[^A-Z0-9]/g, "");
  }
  const a = Number(left);
  const b = Number(right);
  if (Number.isFinite(a) && Number.isFinite(b)) {
    const tolerance = Math.max(1e-9, Math.abs(a) * 0.002);
    return Math.abs(a - b) <= tolerance;
  }
  return leftText === rightText;
}

function appendSource(normalized, field, source) {
  normalized.field_sources = {
    ...(normalized.field_sources || {}),
    [field]: unique([...(normalized.field_sources?.[field] || []), source]),
  };
}

function addWarning(normalized, warning) {
  normalized.warnings = unique([...(normalized.warnings || []), warning]);
}

function applicableCommodityFields(commodity) {
  const common = ["fornitore", "kind", "commodity", "customer_type", "intestatario", "codice_fiscale", "codice_cliente", "indirizzo_fornitura"];
  if (commodity === "luce") {
    return [...common, "pod", "potenza_impegnata_kw", "consumo_luce_kwh", "prezzo_luce_eur_kwh", "quota_fissa_vendita_luce_eur_anno"];
  }
  if (commodity === "gas") {
    return [...common, "pdr", "consumo_gas_smc", "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno"];
  }
  if (commodity === "dual") {
    return [...common, "pod", "pdr", "potenza_impegnata_kw", ...CALCULATION_FIELDS.luce, ...CALCULATION_FIELDS.gas];
  }
  return [...common, "pod", "pdr", ...CALCULATION_FIELDS.luce, ...CALCULATION_FIELDS.gas];
}

function normalizedClassification(field, value) {
  const source = compact(value, 100).toLowerCase();
  if (field === "kind") {
    if (["bill", "invoice", "bolletta"].includes(source)) return "bolletta";
    if (["synthetic_sheet", "scheda_offerta", "scheda sintetica", "cte", "placet"].includes(source)) return "scheda_offerta";
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
  if (/^tipo_prezzo/.test(field)) {
    if (["fixed", "fisso", "prezzo fisso"].includes(source)) return "fisso";
    if (["variable", "variabile", "indexed", "indicizzato", "prezzo variabile"].includes(source)) return "variabile";
    if (["hybrid", "ibrido"].includes(source)) return "ibrido";
  }
  return value;
}

function candidateValue(field, value) {
  if (CLASSIFICATION_FIELDS.has(field)) return normalizedClassification(field, value);
  return value;
}

function safeOfferName(value) {
  const text = compact(value, 220);
  if (!text || text.length < 2 || text.length > 100) return false;
  if (OFFER_GARBAGE_PATTERN.test(text)) return false;
  if (/[.!?]$/.test(text) && text.split(/\s+/).length > 6) return false;
  return true;
}

function safeEconomicEvidence(field, evidence, { allowConsensus = false } = {}) {
  const quote = compact(evidence, 900);
  if (/^consumo_/.test(field)) {
    if (BILLING_PERIOD_PATTERN.test(quote) && !EXPLICIT_ANNUAL_PATTERN.test(quote)) {
      return { safe: false, reason: "billing_period_not_annual_consumption" };
    }
    if (!EXPLICIT_ANNUAL_PATTERN.test(quote)) {
      return { safe: false, reason: "annual_consumption_evidence_missing" };
    }
  }
  if (/^prezzo_/.test(field)) {
    if (AVERAGE_COST_PATTERN.test(quote)) return { safe: false, reason: "average_unit_cost_not_contract_price" };
    if (!CONTRACT_PRICE_PATTERN.test(quote)) {
      return { safe: false, reason: "contract_price_evidence_missing" };
    }
  }
  if (/^spread_/.test(field)) {
    const expectedUnit = field.includes("luce") ? /(?:€|eur)\s*\/?\s*kwh/i : /(?:€|eur)\s*\/?\s*smc/i;
    if (!expectedUnit.test(quote)) return { safe: false, reason: "spread_unit_missing" };
  }
  return { safe: true, reason: null };
}

function customerCodeCandidates(text) {
  const values = [];
  for (const match of String(text || "").matchAll(/codice\s+cliente\s*[:#-]?\s*([A-Z0-9][A-Z0-9 ._-]{4,24})/gi)) {
    const value = String(match[1] || "").split(/\s{2,}|\n/)[0].replace(/[^A-Z0-9]/gi, "").toUpperCase();
    if (/^(?=.{5,20}$)(?=.*\d)[A-Z0-9]+$/.test(value)) values.push(value);
  }
  return unique(values);
}

function ocrEvidence(ocrNormalized, ocrMeta, field) {
  const diagnostic = cloneDiagnostics(ocrNormalized?.diagnostics).find((item) => item?.field === field);
  const page = Number.isInteger(diagnostic?.page) ? diagnostic.page : null;
  const pageText = page && Array.isArray(ocrMeta?.pageTexts) ? ocrMeta.pageTexts[page - 1] : "";
  return {
    field,
    page,
    quote: compact(diagnostic?.source_snippet || diagnostic?.source_match || pageText || ocrMeta?.combinedText || ""),
    confidence: diagnostic?.confidence ?? null,
  };
}

function emptyMergeDiagnostics() {
  return {
    acceptedFields: [],
    confirmedFields: [],
    rejectedFields: [],
    conflicts: [],
    evidenceByField: {},
    reviewReasons: {},
    notes: [],
  };
}

function rejectCandidate(diagnostics, field, value, reason, evidence = {}) {
  diagnostics.rejectedFields.push({ field, value, reason, page: evidence.page || null, evidence: evidence.quote || "" });
  diagnostics.reviewReasons[field] = unique([...(diagnostics.reviewReasons[field] || []), reason]);
}

export function synchronizeCommodityFields(input = {}) {
  const normalized = { ...input };
  const hasPod = !missing(normalized.pod);
  const hasPdr = !missing(normalized.pdr);
  if (hasPod && hasPdr) normalized.commodity = "dual";
  else if (hasPod && normalized.commodity !== "luce") normalized.commodity = "luce";
  else if (hasPdr && normalized.commodity !== "gas") normalized.commodity = "gas";

  const commodity = normalized.commodity;
  const aliasPairs = commodity === "luce"
    ? [["fornitore", "fornitore_luce"], ["codice_cliente", "codice_cliente_luce"], ["indirizzo_fornitura", "indirizzo_fornitura_luce"], ["nome_offerta", "nome_offerta_luce"]]
    : commodity === "gas"
      ? [["fornitore", "fornitore_gas"], ["codice_cliente", "codice_cliente_gas"], ["indirizzo_fornitura", "indirizzo_fornitura_gas"], ["nome_offerta", "nome_offerta_gas"]]
      : [];
  for (const [generic, specific] of aliasPairs) {
    if (missing(normalized[specific]) && !missing(normalized[generic])) normalized[specific] = normalized[generic];
    if (missing(normalized[generic]) && !missing(normalized[specific])) normalized[generic] = normalized[specific];
  }
  return normalized;
}

export function buildPdfQualityReport(input = {}) {
  const normalized = synchronizeCommodityFields(input);
  const requiredFields = applicableCommodityFields(normalized.commodity);
  const diagnosticByField = new Map(cloneDiagnostics(normalized.diagnostics).map((item) => [item?.field, item]));
  const missingFields = requiredFields.filter((field) => missing(normalized[field]));
  const reviewFields = requiredFields.filter((field) => {
    const status = String(diagnosticByField.get(field)?.status || normalized.field_status?.[field]?.status || "").toLowerCase();
    return ["review", "da_verificare", "invalid", "conflitto"].includes(status);
  });
  const recognized = Boolean(normalized.recognized)
    && ["bolletta", "scheda_offerta"].includes(normalized.kind)
    && ["luce", "gas", "dual"].includes(normalized.commodity);
  const completed = requiredFields.length - unique([...missingFields, ...reviewFields]).length;
  const completeness = requiredFields.length ? Math.max(0, completed / requiredFields.length) : 0;
  const reasons = [];
  if (!recognized) reasons.push("document_not_recognized");
  if (missingFields.length) reasons.push("required_fields_missing");
  if (reviewFields.length) reasons.push("required_fields_need_review");
  return {
    recognized,
    completeness,
    requiredFields,
    missingFields,
    reviewFields,
    reasons,
    shouldUseAi: !recognized || missingFields.length > 0 || reviewFields.length > 0,
  };
}

export function mergeOcrResult(base = {}, ocrNormalized = {}, ocrMeta = {}) {
  const normalized = synchronizeCommodityFields({ ...base });
  const diagnostics = emptyMergeDiagnostics();
  const combinedOcrText = [ocrMeta?.combinedText, ...(Array.isArray(ocrMeta?.pageTexts) ? ocrMeta.pageTexts : [])].filter(Boolean).join("\n");
  const ambiguousCustomerCodes = customerCodeCandidates(combinedOcrText);

  for (const [rawField, rawValue] of Object.entries(ocrNormalized || {})) {
    const field = String(rawField || "");
    if (!field || CONTROL_FIELDS.has(field) || missing(rawValue)) continue;
    const value = candidateValue(field, rawValue);
    if (missing(value)) continue;
    const evidence = ocrEvidence(ocrNormalized, ocrMeta, field);
    diagnostics.evidenceByField[field] = evidence;

    if (field === "codice_cliente" && ambiguousCustomerCodes.length > 1) {
      rejectCandidate(diagnostics, field, value, "ambiguous_ocr_candidates", evidence);
      if (missing(base[field])) normalized[field] = null;
      continue;
    }
    if (/^nome_offerta(?:_|$)/.test(field) && !safeOfferName(value)) {
      rejectCandidate(diagnostics, field, value, "invalid_offer_name_semantics", evidence);
      if (missing(base[field])) normalized[field] = null;
      continue;
    }
    const economicSafety = ECONOMIC_FIELDS.has(field) ? safeEconomicEvidence(field, evidence.quote, { allowConsensus: true }) : { safe: true };
    if (!economicSafety.safe && /^spread_/.test(field)) {
      rejectCandidate(diagnostics, field, value, economicSafety.reason, evidence);
      if (missing(base[field])) normalized[field] = null;
      continue;
    }

    if (!missing(normalized[field])) {
      if (equivalent(field, normalized[field], value)) {
        diagnostics.confirmedFields.push(field);
        appendSource(normalized, field, "ocr");
      } else {
        diagnostics.conflicts.push({ field, native_value: normalized[field], ocr_value: value, reason: "ocr_native_conflict", page: evidence.page, evidence: evidence.quote });
      }
      continue;
    }

    normalized[field] = value;
    diagnostics.acceptedFields.push(field);
    appendSource(normalized, field, "ocr");
  }

  normalized.recognized = Boolean(base.recognized || ocrNormalized.recognized || (
    ["bolletta", "scheda_offerta"].includes(normalized.kind) && ["luce", "gas", "dual"].includes(normalized.commodity)
  ));
  normalized.needsReview = true;
  if (diagnostics.conflicts.length) addWarning(normalized, "ocr_native_conflict");
  if (diagnostics.acceptedFields.length) addWarning(normalized, "ocr_verifica_utente_richiesta");
  return { normalized: synchronizeCommodityFields(normalized), diagnostics };
}

export function mergeAiResult(base = {}, aiResult = {}, sourceContext = {}) {
  const normalized = synchronizeCommodityFields({ ...base });
  const diagnostics = emptyMergeDiagnostics();
  const fields = aiResult?.fields && typeof aiResult.fields === "object" ? aiResult.fields : {};
  const evidence = evidenceMap(aiResult);

  for (const [rawField, rawValue] of Object.entries(fields)) {
    const field = String(rawField || "");
    if (!field || CONTROL_FIELDS.has(field) || missing(rawValue)) continue;
    const value = candidateValue(field, rawValue);
    if (missing(value)) continue;
    const itemEvidence = evidence[field] || { field, page: null, quote: "", confidence: null };
    diagnostics.evidenceByField[field] = itemEvidence;

    if (/^nome_offerta(?:_|$)/.test(field) && !safeOfferName(value)) {
      rejectCandidate(diagnostics, field, value, "invalid_offer_name_semantics", itemEvidence);
      continue;
    }
    if (ECONOMIC_FIELDS.has(field)) {
      const safety = safeEconomicEvidence(field, itemEvidence.quote, { allowConsensus: false });
      if (!safety.safe) {
        rejectCandidate(diagnostics, field, value, safety.reason, itemEvidence);
        continue;
      }
    }

    if (!missing(normalized[field])) {
      if (equivalent(field, normalized[field], value)) {
        diagnostics.confirmedFields.push(field);
        appendSource(normalized, field, "ai");
      } else {
        diagnostics.conflicts.push({ field, current_value: normalized[field], ai_value: value, reason: "ai_existing_value_conflict", page: itemEvidence.page, evidence: itemEvidence.quote });
      }
      continue;
    }

    normalized[field] = value;
    diagnostics.acceptedFields.push(field);
    appendSource(normalized, field, "ai");
  }

  diagnostics.notes = Array.isArray(aiResult?.notes) ? aiResult.notes.map((item) => compact(item, 300)).filter(Boolean) : [];
  normalized.needsReview = true;
  if (diagnostics.conflicts.length) addWarning(normalized, "ai_native_conflict");
  if (diagnostics.acceptedFields.length) addWarning(normalized, "ai_verifica_utente_richiesta");
  return { normalized: synchronizeCommodityFields(normalized), diagnostics };
}

function consensusEvidence(field, ocrNormalized, aiResult, sourceContext) {
  const aiEvidence = evidenceMap(aiResult)[field];
  const ocrDiagnostic = cloneDiagnostics(ocrNormalized?.diagnostics).find((item) => item?.field === field);
  const fieldSpecific = [
    ocrDiagnostic?.source_snippet,
    ocrDiagnostic?.source_match,
    aiEvidence?.quote,
  ].filter(Boolean);
  // Never mix the full OCR page with a field-specific quote: nearby labels
  // (for example “prezzo medio”) may describe a different amount.
  if (fieldSpecific.length) return compact(fieldSpecific.join(" | "), 1200);
  return compact(sourceContext?.ocrCombinedText || "", 1200);
}

export function applyCrossSourceConsensus({
  nativeNormalized = {},
  ocrNormalized = {},
  ocrMeta = {},
  aiResult = {},
  normalized = {},
  sourceContext = {},
} = {}) {
  const result = synchronizeCommodityFields({ ...normalized });
  const diagnostics = { corrections: [], agreements: [], rejected: [] };
  const aiFields = aiResult?.fields && typeof aiResult.fields === "object" ? aiResult.fields : {};
  const allFields = unique([...Object.keys(ocrNormalized || {}), ...Object.keys(aiFields)]);

  for (const field of allFields) {
    if (CONTROL_FIELDS.has(field)) continue;
    const ocrValue = candidateValue(field, ocrNormalized?.[field]);
    const aiValue = candidateValue(field, aiFields?.[field]);
    if (missing(ocrValue) || missing(aiValue)) continue;
    const evidence = consensusEvidence(field, ocrNormalized, aiResult, sourceContext);

    if (!equivalent(field, ocrValue, aiValue)) {
      diagnostics.rejected.push({ field, ocr_value: ocrValue, ai_value: aiValue, reason: "ocr_ai_disagreement" });
      continue;
    }
    if (/^nome_offerta(?:_|$)/.test(field) && !safeOfferName(aiValue)) {
      diagnostics.rejected.push({ field, value: aiValue, reason: "invalid_offer_name_semantics" });
      continue;
    }
    if (ECONOMIC_FIELDS.has(field)) {
      const safety = safeEconomicEvidence(field, evidence, { allowConsensus: true });
      if (!safety.safe) {
        diagnostics.rejected.push({ field, value: aiValue, reason: safety.reason });
        continue;
      }
    }

    diagnostics.agreements.push(field);
    const before = result[field];
    const nativeValue = nativeNormalized?.[field];
    if (!missing(nativeValue) && !equivalent(field, nativeValue, aiValue)) {
      diagnostics.rejected.push({ field, native_value: nativeValue, agreed_value: aiValue, reason: "consensus_cannot_override_native" });
      continue;
    }
    if (missing(before) || !equivalent(field, before, aiValue)) {
      result[field] = aiValue;
      diagnostics.corrections.push({ field, previous_value: missing(before) ? null : before, value: aiValue, reason: "ocr_ai_agreement" });
    }
    appendSource(result, field, "ocr");
    appendSource(result, field, "ai");
  }

  if (diagnostics.corrections.length) addWarning(result, "ocr_ai_consensus_correction");
  return { normalized: synchronizeCommodityFields(result), diagnostics };
}

function mergeDiagnosticRows(baseDiagnostics, entries, source, normalized) {
  const rows = cloneDiagnostics(baseDiagnostics);
  const index = new Map(rows.map((item, position) => [item?.field, position]));
  const evidenceByField = entries?.evidenceByField || {};
  const accepted = new Set(entries?.acceptedFields || []);
  const confirmed = new Set(entries?.confirmedFields || []);
  const conflicts = new Map((entries?.conflicts || []).map((item) => [item.field, item]));
  const rejected = new Map((entries?.rejectedFields || []).map((item) => [item.field, item]));
  const fields = unique([...accepted, ...confirmed, ...conflicts.keys(), ...rejected.keys()]);

  for (const field of fields) {
    const existing = index.has(field) ? rows[index.get(field)] : { field, required: false };
    const evidence = evidenceByField[field] || {};
    let updated = { ...existing };
    if (accepted.has(field) || confirmed.has(field)) {
      updated = {
        ...updated,
        value: normalized?.[field] ?? updated.value ?? null,
        status: source === "consensus" ? "found" : "review",
        confidence: source === "consensus" ? "high" : "medium",
        method: source === "ocr" ? "ocr_then_text_pattern" : source === "ai" ? "ai_visual_semantic" : "ocr_ai_consensus",
        page: evidence.page || updated.page || null,
        source_snippet: evidence.quote || updated.source_snippet || "",
        source_match: evidence.quote || updated.source_match || "",
      };
    }
    if (conflicts.has(field)) {
      updated = { ...updated, status: "review", confidence: "low", conflict: conflicts.get(field), calculation_blocked: ECONOMIC_FIELDS.has(field) };
    }
    if (rejected.has(field)) {
      updated = { ...updated, status: "review", confidence: "low", rejected_candidate: rejected.get(field), rejection_reason: rejected.get(field).reason };
    }
    if (index.has(field)) rows[index.get(field)] = updated;
    else {
      index.set(field, rows.length);
      rows.push(updated);
    }
  }
  return rows;
}

export function mergeOcrDiagnostics(baseDiagnostics = [], ocrDiagnostics = {}, normalized = {}) {
  return mergeDiagnosticRows(baseDiagnostics, ocrDiagnostics, "ocr", normalized);
}

export function mergeAiDiagnostics(baseDiagnostics = [], aiDiagnostics = {}, normalized = {}) {
  return mergeDiagnosticRows(baseDiagnostics, aiDiagnostics, "ai", normalized);
}

export function mergeConsensusDiagnostics(baseDiagnostics = [], consensusDiagnostics = {}, normalized = {}) {
  const entries = {
    acceptedFields: consensusDiagnostics?.agreements || [],
    confirmedFields: [],
    conflicts: [],
    rejectedFields: consensusDiagnostics?.rejected || [],
    evidenceByField: {},
  };
  return mergeDiagnosticRows(baseDiagnostics, entries, "consensus", normalized);
}

function trustedEconomicField(normalized, field) {
  const sources = new Set(normalized?.field_sources?.[field] || []);
  if (sources.has("semantic_arbitration")) return true;
  if (sources.has("native") || sources.has("parser") || sources.has("deterministic")) return true;
  if (sources.has("ocr") && sources.has("ai")) return true;

  const diagnostic = cloneDiagnostics(normalized?.diagnostics).find((item) => item?.field === field);
  const method = String(diagnostic?.method || "");
  if (/^(?:regex|text_pattern|derived|semantic_evidence_arbitration|native)/.test(method)) return true;

  // Values that entered the hybrid pipeline before field_sources existed are
  // deterministic unless the diagnostic explicitly says OCR/AI.
  if (!sources.size && !/(?:ocr|ai_visual)/i.test(method)) return true;
  return false;
}

export function quarantineUnsafeRequiredValues(input = {}) {
  const normalized = synchronizeCommodityFields({ ...input });
  const commodities = normalized.commodity === "dual" ? ["luce", "gas"] : [normalized.commodity];
  const blocked = [];
  const quarantined = [];
  const diagnostics = cloneDiagnostics(normalized.diagnostics);
  const byField = new Map(diagnostics.map((item, index) => [item?.field, index]));

  for (const commodity of commodities) {
    for (const field of CALCULATION_FIELDS[commodity] || []) {
      if (missing(normalized[field])) continue;
      const evidence = fieldEvidence(normalized, field);
      const trusted = trustedEconomicField(normalized, field);
      const safety = safeEconomicEvidence(field, evidence, { allowConsensus: trusted });
      if (trusted) continue;

      const value = normalized[field];
      normalized[field] = null;
      const reason = safety.safe ? "untrusted_single_source_economic_value" : safety.reason;
      blocked.push(field);
      quarantined.push({ field, value, reason });
      const index = byField.get(field);
      const row = {
        ...(index === undefined ? { field, required: true } : diagnostics[index]),
        value: null,
        candidate_value: value,
        status: "review",
        confidence: "low",
        calculation_blocked: true,
        quarantine_reason: reason,
      };
      if (index === undefined) {
        byField.set(field, diagnostics.length);
        diagnostics.push(row);
      } else diagnostics[index] = row;
    }
  }

  normalized.diagnostics = diagnostics;
  normalized.blocked_calculation_fields = unique(blocked);
  normalized.quarantined_fields = [...(normalized.quarantined_fields || []), ...quarantined];
  const required = commodities.flatMap((commodity) => CALCULATION_FIELDS[commodity] || []);
  normalized.calculation_ready = required.length > 0
    && required.every((field) => !missing(normalized[field]))
    && normalized.blocked_calculation_fields.length === 0;
  if (quarantined.length) {
    normalized.needsReview = true;
    addWarning(normalized, "unsafe_calculation_values_quarantined");
  }
  return normalized;
}
