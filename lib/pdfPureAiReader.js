import fs from "node:fs/promises";
import { applyPdfDataContract } from "./pdfDataContract.js";
import { applyPdfFieldValidation } from "./pdfFieldValidation.js";

export const PDF_PURE_AI_READER_VERSION = "pure-ai-native-pdf-v2.0.0-ia-libera-form";
export const PDF_PURE_AI_DEFAULT_MODEL = "gpt-4.1-2025-04-14";

// Compatibilità con replay e test storici. La nuova richiesta non usa più
// una domanda rigida per ciascuna casella: questi identificatori servono solo
// per importare risposte archiviate nel vecchio formato.
export const PDF_PURE_AI_QUESTION_IDS = Object.freeze([
  "fornitore", "fornitore_luce", "fornitore_gas", "customer_type", "intestatario", "codice_fiscale",
  "codice_cliente", "codice_cliente_luce", "codice_cliente_gas", "indirizzo_fornitura_luce", "pod",
  "potenza_impegnata_kw", "potenza_disponibile_kw", "consumo_luce_kwh", "consumo_luce_f1_kwh",
  "consumo_luce_f2_kwh", "consumo_luce_f3_kwh", "consumo_luce_f23_kwh", "prezzo_luce_eur_kwh",
  "prezzo_luce_f0_eur_kwh", "prezzo_luce_f1_eur_kwh", "prezzo_luce_f2_eur_kwh",
  "prezzo_luce_f3_eur_kwh", "prezzo_luce_f23_eur_kwh", "quota_fissa_vendita_luce",
  "nome_offerta_luce", "codice_offerta_luce", "tipo_prezzo_luce", "indice_riferimento_luce",
  "spread_luce_eur_kwh", "moltiplicatore_indice_luce", "periodicita_aggiornamento_indice_luce",
  "struttura_prezzo_luce", "formula_prezzo_luce", "decorrenza_condizioni_economiche_luce",
  "scadenza_condizioni_economiche_luce", "indirizzo_fornitura_gas", "pdr", "consumo_gas_smc",
  "prezzo_gas_eur_smc", "quota_fissa_vendita_gas", "nome_offerta_gas", "codice_offerta_gas",
  "tipo_prezzo_gas", "indice_riferimento_gas", "spread_gas_eur_smc", "moltiplicatore_indice_gas",
  "periodicita_aggiornamento_indice_gas", "formula_prezzo_gas", "decorrenza_condizioni_economiche_gas",
  "scadenza_condizioni_economiche_gas",
]);
export const PDF_PURE_AI_REQUEST_QUESTION_IDS = Object.freeze([]);

const REQUEST_PROFILE = "ia_libera_direct_form_v2";

const VALUE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["value", "value_text", "unit", "period", "page", "label", "evidence", "confidence"],
  properties: {
    value: { type: ["number", "null"] },
    value_text: { type: ["string", "null"], maxLength: 180 },
    unit: { type: ["string", "null"], maxLength: 80 },
    period: { type: "string", enum: ["none", "month", "year"] },
    page: { type: ["integer", "null"], minimum: 1 },
    label: { type: ["string", "null"], maxLength: 220 },
    evidence: { type: ["string", "null"], maxLength: 700 },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
  },
});

const PRICE_ITEM_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["label", "value", "value_text", "unit", "period", "band", "page", "evidence", "confidence"],
  properties: {
    label: { type: "string", minLength: 1, maxLength: 220 },
    value: { type: ["number", "null"] },
    value_text: { type: ["string", "null"], maxLength: 180 },
    unit: { type: ["string", "null"], maxLength: 80 },
    period: { type: "string", enum: ["none", "month", "year"] },
    band: { type: ["string", "null"], maxLength: 30 },
    page: { type: ["integer", "null"], minimum: 1 },
    evidence: { type: ["string", "null"], maxLength: 700 },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
  },
});

const BAND_CONSUMPTION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["band", "value", "unit", "page", "label", "evidence", "confidence"],
  properties: {
    band: { type: "string", minLength: 1, maxLength: 30 },
    value: { type: ["number", "null"] },
    unit: { type: ["string", "null"], maxLength: 80 },
    page: { type: ["integer", "null"], minimum: 1 },
    label: { type: ["string", "null"], maxLength: 220 },
    evidence: { type: ["string", "null"], maxLength: 700 },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
  },
});

const SUPPLY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "commodity", "provider", "offer_name", "offer_code", "annual_consumption", "annual_band_consumptions",
    "primary_price", "price_items", "fixed_fee", "price_type", "price_structure", "index", "multiplier",
    "spread", "formula", "periodicity", "committed_power_kw", "available_power_kw", "pricing_page",
    "pricing_evidence", "confidence",
  ],
  properties: {
    commodity: { type: "string", enum: ["electricity", "gas"] },
    provider: { type: ["string", "null"], maxLength: 240 },
    offer_name: { type: ["string", "null"], maxLength: 300 },
    offer_code: { type: ["string", "null"], maxLength: 160 },
    annual_consumption: VALUE_SCHEMA,
    annual_band_consumptions: { type: "array", maxItems: 6, items: BAND_CONSUMPTION_SCHEMA },
    primary_price: VALUE_SCHEMA,
    price_items: { type: "array", maxItems: 18, items: PRICE_ITEM_SCHEMA },
    fixed_fee: VALUE_SCHEMA,
    price_type: { type: "string", enum: ["fixed", "variable", "hybrid", "unknown"] },
    price_structure: { type: ["string", "null"], maxLength: 180 },
    index: { type: ["string", "null"], maxLength: 180 },
    multiplier: { type: ["number", "null"] },
    spread: { type: ["number", "null"] },
    formula: { type: ["string", "null"], maxLength: 700 },
    periodicity: { type: ["string", "null"], maxLength: 160 },
    committed_power_kw: { type: ["number", "null"] },
    available_power_kw: { type: ["number", "null"] },
    pricing_page: { type: ["integer", "null"], minimum: 1 },
    pricing_evidence: { type: ["string", "null"], maxLength: 900 },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
  },
});

const ADDITIONAL_DATA_SCHEMA = Object.freeze({
  type: "array",
  maxItems: 14,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["field", "commodity", "value_text", "value_number", "unit", "page", "label", "evidence", "confidence"],
    properties: {
      field: {
        type: "string",
        enum: [
          "provider", "offer_name", "offer_code", "pod", "pdr", "customer_name", "tax_code", "customer_code",
          "supply_address", "committed_power_kw", "available_power_kw", "contract_code", "meter_serial",
          "billing_frequency",
        ],
      },
      commodity: { type: "string", enum: ["common", "electricity", "gas"] },
      value_text: { type: ["string", "null"], maxLength: 360 },
      value_number: { type: ["number", "null"] },
      unit: { type: ["string", "null"], maxLength: 80 },
      page: { type: ["integer", "null"], minimum: 1 },
      label: { type: ["string", "null"], maxLength: 220 },
      evidence: { type: ["string", "null"], maxLength: 700 },
      confidence: { type: "integer", minimum: 0, maximum: 100 },
    },
  },
});

const REQUEST_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["document", "supplies", "additional_data"],
  properties: {
    document: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "commodity", "customer_type", "page_count"],
      properties: {
        kind: { type: "string", enum: ["bill", "offer_sheet", "unknown"] },
        commodity: { type: "string", enum: ["electricity", "gas", "dual", "unknown"] },
        customer_type: { type: "string", enum: ["consumer", "business", "unknown"] },
        page_count: { type: ["integer", "null"], minimum: 1 },
      },
    },
    supplies: { type: "array", minItems: 1, maxItems: 2, items: SUPPLY_SCHEMA },
    additional_data: ADDITIONAL_DATA_SCHEMA,
  },
});

const SYSTEM_PROMPT = `Sei il lettore visuale di OffertaLogica. Leggi integralmente il PDF come farebbe una persona che deve compilare il modulo della fornitura attuale.

OBIETTIVO
Per ogni fornitura luce o gas presente, restituisci direttamente i dati che inseriresti nel modulo. Non adattare il documento a uno schema tariffario predefinito e non eliminare una voce solo perché ha un nome insolito.

CAMPI PRINCIPALI
- annual_consumption: il consumo annuo o degli ultimi 12 mesi. Non usare il consumo del solo periodo fatturato.
- primary_price: il valore unitario che inseriresti nel campo “Quanto paghi la luce/gas?”. In una bolletta preferisci il prezzo unitario esplicito della sola spesa per la vendita/materia energia o gas, esclusi rete, oneri, imposte e IVA. In una scheda sintetica usa il prezzo dell'offerta corrente. Se non esiste un unico valore da inserire, usa null.
- fixed_fee: la quota fissa della sola vendita/commercializzazione, con valore, segno e periodicità esattamente come stampati. Non convertirla.

STRUTTURA LIBERA
- In price_items copia tutte le voci economiche utili che compaiono nel documento: prezzi unici, F0, F1, F2, F3, F23, materia prima, componenti, sconti e altri valori unitari. Usa l'etichetta originale. Non calcolare medie, somme o differenze.
- In annual_band_consumptions copia i consumi annui per fascia quando sono esplicitamente riferiti a un anno o agli ultimi 12 mesi.
- Copia anche tipo prezzo, struttura, indice, moltiplicatore, spread, formula e periodicità quando presenti.

REGOLE MINIME
- Cerca in tutte le pagine.
- Copia i numeri senza arrotondare e senza cambiare segno.
- Non inventare dati e non usare esempi, condizioni future o valori di rete/oneri come prezzo di vendita.
- Se un dato non è presente usa null o un array vuoto.
- Per consumo, prezzo principale e quota fissa indica pagina, etichetta ed evidence.
- In additional_data conserva soltanto POD/PDR, intestatario, codice fiscale, codice cliente, indirizzo, potenza e altri dati chiaramente incontrati; non rallentare la lettura per cercare dati secondari.

Restituisci esclusivamente JSON conforme allo schema.`;

const USER_PROMPT = `Leggi il documento e compila direttamente il modulo libero. Mantieni in price_items tutte le voci economiche utili così come appaiono nel PDF.`;

function compact(value, maxLength = 700) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeCode(field, value) {
  const text = compact(value, 180).toUpperCase();
  if (!text) return null;
  if (field === "pdr") return text.replace(/\D/g, "");
  return text.replace(/[^A-Z0-9_.-]/g, "");
}

function normalizeDate(value) {
  const text = compact(value, 100);
  let match = text.match(/\b((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
  match = text.match(/\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.]((?:19|20)\d{2})\b/);
  return match ? `${match[3]}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}` : null;
}

function documentKind(value) {
  return value === "bill" ? "bolletta" : value === "offer_sheet" ? "scheda_offerta" : "unknown";
}

function documentCommodity(value) {
  return value === "electricity" ? "luce" : value === "gas" ? "gas" : value === "dual" ? "dual" : "unknown";
}

function customerType(value) {
  return value === "consumer" ? "privato" : value === "business" ? "business" : null;
}

function pageValue(value) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : null;
}

function sourceValue(entry) {
  return compact(entry?.value_text, 180) || (finite(entry?.value) !== null ? String(entry.value) : null);
}

function normalizedPeriod(value) {
  return ["month", "year"].includes(value) ? value : "none";
}

function compatibleUnit(unit, commodity, type = "price") {
  const text = compact(unit, 80).toLowerCase();
  if (!text) return true;
  if (type === "consumption") return commodity === "luce" ? /kwh/.test(text) : /smc|\bmc\b/.test(text);
  return commodity === "luce" ? /kwh/.test(text) : /smc/.test(text);
}

function annualCue(entry) {
  const text = compact([entry?.label, entry?.evidence, entry?.unit].filter(Boolean).join(" "), 1000).toLowerCase();
  return /annuo|annuale|in un anno|ultimi 12 mesi|12 mesi|dodici mesi/.test(text);
}

function normalizeBand(value) {
  const text = compact(value, 30).toUpperCase().replace(/\s+/g, "");
  const match = text.match(/F(?:0|1|2|3|23)/);
  return match ? match[0] : null;
}

function diagnostic(field, entry, value, options = {}) {
  return {
    field,
    label: compact(entry?.label, 220) || options.label || field,
    value,
    status: "review",
    confidence: Math.max(0, Math.min(100, Number(entry?.confidence || options.confidence || 0))),
    page: pageValue(entry?.page ?? options.page),
    source_snippet: compact(entry?.evidence ?? options.evidence, 900) || sourceValue(entry),
    source_match: sourceValue(entry),
    source_role: options.sourceRole || "contract_term",
    certainty: options.certainty || "certain",
    usable_for_comparison: options.usable !== false,
    verification_reason: options.verificationReason || null,
    coverage_months: options.coverageMonths ?? null,
    method: options.method || "openai_visual_ai_direct_form",
    source_version: PDF_PURE_AI_READER_VERSION,
    derivation: options.derivation || null,
  };
}

function baseNormalized(parsed, model, responseId, transportMode, timings) {
  const document = parsed?.document || {};
  return {
    parser_version: PDF_PURE_AI_READER_VERSION,
    page_count: Number(document.page_count || 0) || null,
    diagnostics: [],
    kind: documentKind(document.kind),
    commodity: documentCommodity(document.commodity),
    customer_type: customerType(document.customer_type),
    document_classification_evidence: null,
    billing_period_start: null,
    billing_period_end: null,
    supply_start_date: null,
    textExtracted: 0,
    needsReview: true,
    recognized: document.kind !== "unknown" && document.commodity !== "unknown",
    confidence: "medium",
    warnings: ["lettura_ia_libera_da_verificare"],
    ocr: { attempted: false, applied: false, reason: "ai_only_mode" },
    adaptive_form: { version: "adaptive-form-v2", supplies: [] },
    comparison_form_raw: parsed,
    activation_data_archive: Array.isArray(parsed?.additional_data) ? parsed.additional_data : [],
    quota_fissa_dettaglio_luce: null,
    quota_fissa_dettaglio_gas: null,
    ai: {
      applied: true,
      reader_version: PDF_PURE_AI_READER_VERSION,
      pipeline_version: PDF_PURE_AI_READER_VERSION,
      model,
      response_id: responseId,
      transport_mode: transportMode,
      request_build_ms: Number(timings.request_build_ms || 0),
      openai_file_upload_ms: Number(timings.openai_file_upload_ms || 0),
      openai_ms: Number(timings.openai_ms || 0),
      total_ms: Number(timings.total_ms || 0),
      input_file_bytes: Number(timings.input_file_bytes || 0) || null,
      file_id_threshold_bytes: Number(timings.file_id_threshold_bytes || 0) || null,
      openai_attempts: Math.max(1, Number(timings.openai_attempts || 1)),
      retry_count: Math.max(0, Number(timings.openai_attempts || 1) - 1),
      page_count: Number(document.page_count || 0) || null,
      accepted_count: 0,
      filled_fields: [],
      rejected_questions: [],
      document_kind_declared: documentKind(document.kind),
      document_kind_resolved: documentKind(document.kind),
      document_kind_reason: "direct_ai_document_classification",
      verification_protocol: REQUEST_PROFILE,
      activation_archive_count: Array.isArray(parsed?.additional_data) ? parsed.additional_data.length : 0,
    },
  };
}

function addField(normalized, field, value, entry, options = {}) {
  if (value === null || value === undefined || value === "") return false;
  normalized[field] = value;
  normalized.ai.filled_fields.push(field);
  normalized.diagnostics.push(diagnostic(field, entry, value, options));
  return true;
}

function fixedDetails(entry) {
  const value = finite(entry?.value);
  const period = normalizedPeriod(entry?.period);
  const valid = value !== null && period !== "none";
  const commercial = {
    value: valid ? value : null,
    value_text: valid ? (sourceValue(entry) || String(value)) : null,
    unit: valid ? (compact(entry?.unit, 80) || null) : null,
    period: valid ? period : "none",
    page: valid ? pageValue(entry?.page) : null,
    label: valid ? (compact(entry?.label, 220) || null) : null,
    evidence: valid ? (compact(entry?.evidence, 700) || null) : null,
    confidence: valid ? Math.max(0, Math.min(100, Number(entry?.confidence || 0))) : 0,
  };
  return {
    commercial_component: commercial,
    section_total: { value: null, value_text: null, unit: null, period: "none", page: null, label: null, evidence: null, confidence: 0 },
    selected_for_comparison: valid ? "commercial_component" : null,
  };
}

function addSupply(normalized, supply) {
  if (!supply || !["electricity", "gas"].includes(supply.commodity)) return;
  const commodity = supply.commodity === "electricity" ? "luce" : "gas";
  const suffix = commodity;
  const supplyEvidence = compact(supply.pricing_evidence, 900) || compact([supply.provider, supply.offer_name].filter(Boolean).join(" - "), 500);
  const supplyPage = pageValue(supply.pricing_page);
  const supplyConfidence = Number(supply.confidence || 0);

  const adaptive = {
    commodity,
    provider: compact(supply.provider, 240) || null,
    offer_name: compact(supply.offer_name, 300) || null,
    offer_code: compact(supply.offer_code, 160) || null,
    annual_consumption: supply.annual_consumption || null,
    annual_band_consumptions: Array.isArray(supply.annual_band_consumptions) ? supply.annual_band_consumptions : [],
    primary_price: supply.primary_price || null,
    price_items: Array.isArray(supply.price_items) ? supply.price_items : [],
    fixed_fee: supply.fixed_fee || null,
    price_type: supply.price_type || "unknown",
    price_structure: compact(supply.price_structure, 180) || null,
    index: compact(supply.index, 180) || null,
    multiplier: finite(supply.multiplier),
    spread: finite(supply.spread),
    formula: compact(supply.formula, 700) || null,
    periodicity: compact(supply.periodicity, 160) || null,
  };
  normalized.adaptive_form.supplies.push(adaptive);

  const identityEntry = { label: "Venditore", evidence: supplyEvidence, page: supplyPage, confidence: supplyConfidence, value_text: supply.provider };
  const provider = compact(supply.provider, 240) || null;
  if (provider) {
    addField(normalized, `fornitore_${suffix}`, provider, identityEntry, { sourceRole: "identity" });
    if (!normalized.fornitore) addField(normalized, "fornitore", provider, identityEntry, { sourceRole: "identity" });
  }
  if (supply.offer_name) addField(normalized, `nome_offerta_${suffix}`, compact(supply.offer_name, 300), { ...identityEntry, value_text: supply.offer_name, label: "Nome offerta" });
  if (supply.offer_code) addField(normalized, `codice_offerta_${suffix}`, normalizeCode(`codice_offerta_${suffix}`, supply.offer_code), { ...identityEntry, value_text: supply.offer_code, label: "Codice offerta" });

  const annual = supply.annual_consumption || {};
  const annualValue = finite(annual.value);
  if (annualValue !== null && annualValue > 0 && compatibleUnit(annual.unit, commodity, "consumption") && annualCue(annual)) {
    addField(normalized, commodity === "luce" ? "consumo_luce_kwh" : "consumo_gas_smc", annualValue, annual, { sourceRole: "annual_total", coverageMonths: 12 });
  }

  if (commodity === "luce") {
    for (const item of Array.isArray(supply.annual_band_consumptions) ? supply.annual_band_consumptions : []) {
      const band = normalizeBand(item.band || item.label);
      const value = finite(item.value);
      if (!band || !["F1", "F2", "F3", "F23"].includes(band) || value === null || value < 0 || !annualCue(item)) continue;
      addField(normalized, `consumo_luce_${band.toLowerCase()}_kwh`, value, item, { sourceRole: "annual_total", coverageMonths: 12 });
    }
  }

  const primary = supply.primary_price || {};
  const primaryValue = finite(primary.value);
  if (primaryValue !== null && primaryValue > 0 && compatibleUnit(primary.unit, commodity, "price")) {
    addField(normalized, commodity === "luce" ? "prezzo_luce_eur_kwh" : "prezzo_gas_eur_smc", primaryValue, primary);
  }

  for (const item of Array.isArray(supply.price_items) ? supply.price_items : []) {
    if (commodity !== "luce") continue;
    const band = normalizeBand(item.band || item.label);
    const value = finite(item.value);
    if (!band || !["F0", "F1", "F2", "F3", "F23"].includes(band) || value === null || value <= 0 || !compatibleUnit(item.unit, commodity, "price")) continue;
    const field = `prezzo_luce_${band.toLowerCase()}_eur_kwh`;
    if (normalized[field] === undefined) addField(normalized, field, value, item);
  }

  const fixed = supply.fixed_fee || {};
  const fixedValue = finite(fixed.value);
  const period = normalizedPeriod(fixed.period);
  const details = fixedDetails(fixed);
  normalized[`quota_fissa_dettaglio_${commodity}`] = details;
  if (fixedValue !== null && period !== "none") {
    const annualValue = period === "month" ? Number((fixedValue * 12).toFixed(6)) : fixedValue;
    addField(normalized, `quota_fissa_vendita_${suffix}_eur_anno`, annualValue, fixed, {
      derivation: {
        type: period === "month" ? "monthly_to_annual" : "annual_literal",
        original_value: fixedValue,
        original_unit: compact(fixed.unit, 80) || null,
        original_period: period,
        factor: period === "month" ? 12 : 1,
        derived_value: annualValue,
      },
    });
  }

  const typeMap = { fixed: "fisso", variable: "variabile", hybrid: "ibrido" };
  if (typeMap[supply.price_type]) addField(normalized, `tipo_prezzo_${suffix}`, typeMap[supply.price_type], { label: "Tipo prezzo", evidence: supplyEvidence, page: supplyPage, confidence: supplyConfidence, value_text: typeMap[supply.price_type] });
  if (supply.price_structure) addField(normalized, `struttura_prezzo_${suffix}`, compact(supply.price_structure, 180), { label: "Struttura prezzo", evidence: supplyEvidence, page: supplyPage, confidence: supplyConfidence, value_text: supply.price_structure });
  if (supply.index) addField(normalized, `indice_riferimento_${suffix}`, compact(supply.index, 180), { label: "Indice", evidence: supplyEvidence, page: supplyPage, confidence: supplyConfidence, value_text: supply.index });
  if (finite(supply.multiplier) !== null && Number(supply.multiplier) > 0) addField(normalized, `moltiplicatore_indice_${suffix}`, Number(supply.multiplier), { label: "Moltiplicatore", evidence: supplyEvidence, page: supplyPage, confidence: supplyConfidence, value: supply.multiplier, value_text: String(supply.multiplier) });
  if (finite(supply.spread) !== null) addField(normalized, `spread_${suffix}_${commodity === "luce" ? "eur_kwh" : "eur_smc"}`, Number(supply.spread), { label: "Spread", evidence: supplyEvidence, page: supplyPage, confidence: supplyConfidence, value: supply.spread, value_text: String(supply.spread) });
  if (supply.formula) addField(normalized, `formula_prezzo_${suffix}`, compact(supply.formula, 700), { label: "Formula", evidence: supplyEvidence, page: supplyPage, confidence: supplyConfidence, value_text: supply.formula });
  if (supply.periodicity) addField(normalized, `periodicita_aggiornamento_indice_${suffix}`, compact(supply.periodicity, 160), { label: "Periodicità", evidence: supplyEvidence, page: supplyPage, confidence: supplyConfidence, value_text: supply.periodicity });
  if (commodity === "luce") {
    if (finite(supply.committed_power_kw) !== null && Number(supply.committed_power_kw) > 0) addField(normalized, "potenza_impegnata_kw", Number(supply.committed_power_kw), { label: "Potenza impegnata", evidence: supplyEvidence, page: supplyPage, confidence: supplyConfidence, value: supply.committed_power_kw, value_text: String(supply.committed_power_kw) });
    if (finite(supply.available_power_kw) !== null && Number(supply.available_power_kw) > 0) addField(normalized, "potenza_disponibile_kw", Number(supply.available_power_kw), { label: "Potenza disponibile", evidence: supplyEvidence, page: supplyPage, confidence: supplyConfidence, value: supply.available_power_kw, value_text: String(supply.available_power_kw) });
  }
}

function addAdditionalData(normalized, items) {
  const map = {
    pod: "pod", pdr: "pdr", customer_name: "intestatario", tax_code: "codice_fiscale",
    committed_power_kw: "potenza_impegnata_kw", available_power_kw: "potenza_disponibile_kw",
  };
  for (const item of Array.isArray(items) ? items : []) {
    let field = map[item.field] || null;
    if (item.field === "provider") field = item.commodity === "electricity" ? "fornitore_luce" : item.commodity === "gas" ? "fornitore_gas" : "fornitore";
    if (item.field === "offer_name") field = item.commodity === "electricity" ? "nome_offerta_luce" : item.commodity === "gas" ? "nome_offerta_gas" : null;
    if (item.field === "offer_code") field = item.commodity === "electricity" ? "codice_offerta_luce" : item.commodity === "gas" ? "codice_offerta_gas" : null;
    if (item.field === "customer_code") field = item.commodity === "electricity" ? "codice_cliente_luce" : item.commodity === "gas" ? "codice_cliente_gas" : "codice_cliente";
    if (item.field === "supply_address") field = item.commodity === "electricity" ? "indirizzo_fornitura_luce" : item.commodity === "gas" ? "indirizzo_fornitura_gas" : "indirizzo_fornitura";
    if (!field || normalized[field] !== undefined) continue;
    const numeric = finite(item.value_number);
    let value = numeric !== null ? numeric : compact(item.value_text, 360) || null;
    if (["pod", "pdr", "codice_fiscale", "codice_cliente", "codice_cliente_luce", "codice_cliente_gas", "codice_offerta_luce", "codice_offerta_gas"].includes(field)) value = normalizeCode(field, value);
    if (value === null) continue;
    addField(normalized, field, value, { ...item, value: numeric, value_text: item.value_text }, { sourceRole: "customer_data" });
  }
  if (!normalized.codice_cliente) normalized.codice_cliente = normalized.codice_cliente_luce || normalized.codice_cliente_gas || null;
  if (!normalized.fornitore) normalized.fornitore = normalized.fornitore_luce || normalized.fornitore_gas || null;
}

function deriveAnnualTotals(normalized) {
  if (finite(normalized.consumo_luce_kwh) !== null) return;
  const f1 = finite(normalized.consumo_luce_f1_kwh);
  const f2 = finite(normalized.consumo_luce_f2_kwh);
  const f3 = finite(normalized.consumo_luce_f3_kwh);
  const f23 = finite(normalized.consumo_luce_f23_kwh);
  let value = null;
  let sources = [];
  if (f1 !== null && f23 !== null) { value = f1 + f23; sources = ["consumo_luce_f1_kwh", "consumo_luce_f23_kwh"]; }
  else if ([f1, f2, f3].every((item) => item !== null)) { value = f1 + f2 + f3; sources = ["consumo_luce_f1_kwh", "consumo_luce_f2_kwh", "consumo_luce_f3_kwh"]; }
  if (value !== null && value > 0) {
    normalized.consumo_luce_kwh = Number(value.toFixed(6));
    normalized.ai.filled_fields.push("consumo_luce_kwh");
    normalized.diagnostics.push(diagnostic("consumo_luce_kwh", {}, normalized.consumo_luce_kwh, {
      label: "Consumo annuo totale derivato dalle fasce", sourceRole: "annual_total", certainty: "derived",
      method: "deterministic_sum", coverageMonths: 12, evidence: "Somma dei consumi annui per fascia restituiti dall'IA",
      derivation: { type: "annual_bands_to_total", source_fields: sources, derived_value: normalized.consumo_luce_kwh }, confidence: 100,
    }));
  }
}

function adaptOldCompact(parsed) {
  if (!parsed?.document || !Array.isArray(parsed.supplies)) return parsed;
  if (parsed.supplies.some((supply) => Object.prototype.hasOwnProperty.call(supply || {}, "primary_price"))) return parsed;
  return {
    document: parsed.document,
    supplies: parsed.supplies.map((supply) => {
      const price = supply.price || {};
      const items = [];
      for (const band of ["f0", "f1", "f2", "f3", "f23"]) {
        if (finite(price[band]) !== null) items.push({ label: `Prezzo ${band.toUpperCase()}`, value: Number(price[band]), value_text: String(price[band]), unit: price.unit || null, period: "none", band: band.toUpperCase(), page: price.page || null, evidence: price.evidence || null, confidence: Number(price.confidence || 0) });
      }
      return {
        commodity: supply.commodity,
        provider: supply.identity?.provider || null,
        offer_name: supply.identity?.offer_name || null,
        offer_code: supply.identity?.offer_code || null,
        annual_consumption: { value: supply.annual_consumption?.total ?? null, value_text: supply.annual_consumption?.total != null ? String(supply.annual_consumption.total) : null, unit: supply.annual_consumption?.unit || null, period: "none", page: supply.annual_consumption?.page || null, label: supply.annual_consumption?.label || null, evidence: supply.annual_consumption?.evidence || null, confidence: Number(supply.annual_consumption?.confidence || 0) },
        annual_band_consumptions: ["f1", "f2", "f3", "f23"].filter((band) => finite(supply.annual_consumption?.[band]) !== null).map((band) => ({ band: band.toUpperCase(), value: Number(supply.annual_consumption[band]), unit: supply.annual_consumption?.unit || null, page: supply.annual_consumption?.page || null, label: supply.annual_consumption?.label || `Consumo ${band.toUpperCase()}`, evidence: supply.annual_consumption?.evidence || null, confidence: Number(supply.annual_consumption?.confidence || 0) })),
        primary_price: { value: price.single ?? null, value_text: price.single != null ? String(price.single) : null, unit: price.unit || null, period: "none", page: price.page || null, label: price.label || null, evidence: price.evidence || null, confidence: Number(price.confidence || 0) },
        price_items: items,
        fixed_fee: { value: supply.fixed_fee?.value ?? null, value_text: supply.fixed_fee?.value_text || (supply.fixed_fee?.value != null ? String(supply.fixed_fee.value) : null), unit: supply.fixed_fee?.unit || null, period: normalizedPeriod(supply.fixed_fee?.period), page: supply.fixed_fee?.page || null, label: supply.fixed_fee?.label || null, evidence: supply.fixed_fee?.evidence || null, confidence: Number(supply.fixed_fee?.confidence || 0) },
        price_type: price.type || "unknown",
        price_structure: items.length ? `fasce ${items.map((item) => item.band).join("/")}` : price.single != null ? "monoraria" : null,
        index: price.index || null,
        multiplier: price.multiplier ?? null,
        spread: price.spread ?? null,
        formula: price.formula || null,
        periodicity: price.periodicity || null,
        committed_power_kw: null,
        available_power_kw: null,
        pricing_page: price.page || supply.identity?.page || null,
        pricing_evidence: price.evidence || supply.identity?.evidence || null,
        confidence: Math.max(Number(price.confidence || 0), Number(supply.identity?.confidence || 0)),
      };
    }),
    additional_data: parsed.additional_data || [],
  };
}

function normalizeLegacyAnswers(parsed, options) {
  const normalized = baseNormalized({ document: parsed.document, additional_data: [] }, options.model, options.responseId, options.transportMode, options.timings);
  const fixedMap = { quota_fissa_vendita_luce: "quota_fissa_vendita_luce_eur_anno", quota_fissa_vendita_gas: "quota_fissa_vendita_gas_eur_anno" };
  for (const answer of Array.isArray(parsed.answers) ? parsed.answers : []) {
    if (!answer?.found || !PDF_PURE_AI_QUESTION_IDS.includes(answer.question_id)) continue;
    let field = fixedMap[answer.question_id] || answer.question_id;
    let value = finite(answer.value_number);
    if (value === null) value = compact(answer.value_text, 360) || null;
    if (fixedMap[answer.question_id]) {
      const period = normalizedPeriod(answer.period);
      if (finite(value) === null || period === "none") continue;
      const original = Number(value);
      value = period === "month" ? Number((original * 12).toFixed(6)) : original;
      normalized[`quota_fissa_dettaglio_${field.includes("luce") ? "luce" : "gas"}`] = fixedDetails({ ...answer, value: original });
      addField(normalized, field, value, { ...answer, value: original }, { derivation: { type: period === "month" ? "monthly_to_annual" : "annual_literal", original_value: original, original_unit: answer.unit || null, original_period: period, factor: period === "month" ? 12 : 1, derived_value: value } });
      continue;
    }
    if (field.startsWith("consumo_") && !annualCue(answer)) continue;
    if (field.startsWith("codice_") || ["pod", "pdr"].includes(field)) value = normalizeCode(field, value);
    if (field.startsWith("decorrenza_") || field.startsWith("scadenza_")) value = normalizeDate(value);
    if (value !== null) addField(normalized, field, value, answer, { sourceRole: field.startsWith("consumo_") ? "annual_total" : "contract_term" });
  }
  normalized.fornitore = normalized.fornitore || normalized.fornitore_luce || normalized.fornitore_gas || null;
  deriveAnnualTotals(normalized);
  normalized.ai.accepted_count = [...new Set(normalized.ai.filled_fields)].length;
  normalized.ai.filled_fields = [...new Set(normalized.ai.filled_fields)];
  return applyPdfDataContract(applyPdfFieldValidation(normalized));
}

export function normalizePureAiOutput(parsed, {
  model = PDF_PURE_AI_DEFAULT_MODEL,
  responseId = null,
  transportMode = "pdf_originale",
  timings = {},
} = {}) {
  if (Array.isArray(parsed?.answers)) return normalizeLegacyAnswers(parsed, { model, responseId, transportMode, timings });
  parsed = adaptOldCompact(parsed);
  if (!parsed || typeof parsed !== "object" || !parsed.document || !Array.isArray(parsed.supplies)) throw new Error("openai_invalid_output");
  const normalized = baseNormalized(parsed, model, responseId, transportMode, timings);
  for (const supply of parsed.supplies) addSupply(normalized, supply);
  addAdditionalData(normalized, parsed.additional_data);
  deriveAnnualTotals(normalized);
  normalized.ai.accepted_count = [...new Set(normalized.ai.filled_fields)].length;
  normalized.ai.filled_fields = [...new Set(normalized.ai.filled_fields)];
  return applyPdfDataContract(applyPdfFieldValidation(normalized));
}

function responseOutputText(body) {
  if (typeof body?.output_text === "string") return body.output_text;
  for (const item of body?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "refusal") throw new Error(`openai_refusal:${content.refusal || "refused"}`);
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

async function transportBody(result) {
  if (result && typeof result.json === "function") {
    if (result.ok === false) {
      const text = await result.text().catch(() => "");
      throw new Error(`openai_http_${result.status}:${text.slice(0, 300)}`);
    }
    return result.json();
  }
  return result;
}

async function defaultTransport({ request, apiKey, signal }) {
  return fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
}

async function defaultFileUploadTransport({ filePath, filename, apiKey, signal }) {
  const bytes = await fs.readFile(filePath);
  const formData = new FormData();
  formData.append("purpose", "user_data");
  formData.append("expires_after[anchor]", "created_at");
  formData.append("expires_after[seconds]", "3600");
  formData.append("file", new Blob([bytes], { type: "application/pdf" }), filename || "documento.pdf");
  return fetch("https://api.openai.com/v1/files", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: formData, signal });
}

async function defaultFileDeleteTransport({ fileId, apiKey, signal }) {
  return fetch(`https://api.openai.com/v1/files/${encodeURIComponent(fileId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${apiKey}` }, signal });
}

async function fileTransportBody(result, operation) {
  if (result && typeof result.json === "function") {
    if (result.ok === false) {
      const text = await result.text().catch(() => "");
      throw new Error(`openai_file_${operation}_http_${result.status}:${text.slice(0, 300)}`);
    }
    return result.json();
  }
  return result;
}

function boundedTimeout(value) {
  const parsed = Number(value || 44_000);
  return Math.max(8_000, Math.min(45_000, Number.isFinite(parsed) ? parsed : 44_000));
}
function boundedFileIdThreshold(value) {
  const parsed = Number(value ?? 12_000_000);
  return Number.isFinite(parsed) ? Math.max(1_000_000, Math.min(20_000_000, parsed)) : 12_000_000;
}
function boundedFileUploadTimeout(value) {
  const parsed = Number(value ?? 15_000);
  return Number.isFinite(parsed) ? Math.max(5_000, Math.min(20_000, parsed)) : 15_000;
}
function boundedFileDeleteTimeout(value) {
  const parsed = Number(value ?? 2_000);
  return Number.isFinite(parsed) ? Math.max(500, Math.min(3_000, parsed)) : 2_000;
}

export async function buildPdfPureAiRequest({
  filePath,
  fileId = null,
  filename = "documento.pdf",
  model = process.env.PDF_AI_PRIMARY_MODEL || PDF_PURE_AI_DEFAULT_MODEL,
  maxOutputTokens = null,
} = {}) {
  if (!filePath && !fileId) throw new Error("pure_ai_file_path_required");
  let fileInput;
  if (fileId) fileInput = { type: "input_file", file_id: String(fileId) };
  else {
    const bytes = await fs.readFile(filePath);
    fileInput = { type: "input_file", filename: filename || "documento.pdf", file_data: `data:application/pdf;base64,${bytes.toString("base64")}` };
  }
  return {
    model,
    store: false,
    temperature: 0,
    max_output_tokens: Number(maxOutputTokens || 4_000),
    input: [
      { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
      { role: "user", content: [fileInput, { type: "input_text", text: USER_PROMPT }] },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "offertalogica_ia_libera_direct_form",
        description: "Compilazione diretta del modulo adattivo luce e gas senza schema tariffario rigido",
        strict: true,
        schema: REQUEST_OUTPUT_SCHEMA,
      },
    },
  };
}

export async function extractPdfPureAi({
  filePath,
  filename = "documento.pdf",
  deadlineAt = null,
  transport = defaultTransport,
  fileUploadTransport = defaultFileUploadTransport,
  fileDeleteTransport = defaultFileDeleteTransport,
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.PDF_AI_PRIMARY_MODEL || PDF_PURE_AI_DEFAULT_MODEL,
  env = process.env,
} = {}) {
  if (!apiKey) throw new Error("openai_missing_api_key");
  if (!filePath) throw new Error("pure_ai_file_path_required");
  const startedAt = Date.now();
  const configuredTimeout = boundedTimeout(env.PDF_AI_TIMEOUT_MS || env.PDF_AI_DIRECT_TIMEOUT_MS);
  const remainingBudget = () => deadlineAt ? Number(deadlineAt) - Date.now() - 2_000 : configuredTimeout - (Date.now() - startedAt);
  if (!Number.isFinite(remainingBudget()) || remainingBudget() < 8_000) throw new Error("openai_insufficient_time_budget");

  const fileStats = await fs.stat(filePath);
  const fileIdThreshold = boundedFileIdThreshold(env.PDF_AI_FILE_ID_THRESHOLD_BYTES);
  const useFileId = Number(fileStats.size || 0) >= fileIdThreshold;
  let openAiFileId = "";
  let uploadMs = 0;
  let deleted = null;
  let deleteError = null;
  let normalizedResult = null;
  let analysisError = null;
  let requestBuildMs = 0;
  const openaiStartedAt = Date.now();

  try {
    if (useFileId) {
      const uploadTimeoutMs = Math.min(boundedFileUploadTimeout(env.PDF_AI_FILE_UPLOAD_TIMEOUT_MS), remainingBudget() - 8_000);
      if (!Number.isFinite(uploadTimeoutMs) || uploadTimeoutMs < 5_000) throw new Error("openai_insufficient_time_budget");
      const controller = new AbortController();
      let timeoutId;
      const uploadStartedAt = Date.now();
      try {
        const timeoutPromise = new Promise((_, reject) => { timeoutId = setTimeout(() => { controller.abort(); reject(new Error("openai_file_upload_timeout")); }, uploadTimeoutMs); });
        const raw = await Promise.race([fileUploadTransport({ filePath, filename, apiKey, signal: controller.signal }), timeoutPromise]);
        const body = await fileTransportBody(raw, "upload");
        openAiFileId = compact(body?.id, 180);
        if (!openAiFileId) throw new Error("openai_file_upload_invalid_response");
      } finally {
        clearTimeout(timeoutId);
        uploadMs = Date.now() - uploadStartedAt;
      }
    }

    const buildStartedAt = Date.now();
    const request = await buildPdfPureAiRequest({ filePath: useFileId ? null : filePath, fileId: openAiFileId || null, filename, model });
    requestBuildMs = Date.now() - buildStartedAt;
    const effectiveTimeout = Math.min(configuredTimeout, remainingBudget());
    if (!Number.isFinite(effectiveTimeout) || effectiveTimeout < 8_000) throw new Error("openai_insufficient_time_budget");
    const controller = new AbortController();
    let timeoutId;
    try {
      const timeoutPromise = new Promise((_, reject) => { timeoutId = setTimeout(() => { controller.abort(); reject(new Error("openai_timeout")); }, effectiveTimeout); });
      const raw = await Promise.race([transport({ request, apiKey, signal: controller.signal, attempt: 1, profile: REQUEST_PROFILE }), timeoutPromise]);
      const body = await transportBody(raw);
      if (body?.status === "incomplete") throw new Error(`openai_incomplete:${body?.incomplete_details?.reason || "unknown"}`);
      const outputText = responseOutputText(body);
      if (!outputText) throw new Error("openai_empty_output");
      const parsedOutput = JSON.parse(outputText);
      const now = Date.now();
      normalizedResult = normalizePureAiOutput(parsedOutput, {
        model,
        responseId: compact(body?.id, 160) || null,
        transportMode: useFileId ? "openai_file_id" : "pdf_originale",
        timings: {
          request_build_ms: requestBuildMs,
          openai_file_upload_ms: uploadMs,
          openai_ms: now - openaiStartedAt,
          total_ms: now - startedAt,
          openai_attempts: 1,
          input_file_bytes: Number(fileStats.size || 0),
          file_id_threshold_bytes: fileIdThreshold,
        },
      });
      normalizedResult.ai = { ...(normalizedResult.ai || {}), request_profile: REQUEST_PROFILE, recovery_attempted: false, recovered_from: null };
      normalizedResult._reader_trace = {
        trace_version: "reader-trace-v2",
        captured_at: new Date(now).toISOString(),
        response_id: compact(body?.id, 160) || null,
        request_profile: REQUEST_PROFILE,
        raw_output_chars: outputText.length,
        raw_ai: parsedOutput,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    analysisError = error;
  } finally {
    if (openAiFileId) {
      const controller = new AbortController();
      let timeoutId;
      try {
        const timeoutMs = boundedFileDeleteTimeout(env.PDF_AI_FILE_DELETE_TIMEOUT_MS);
        const timeoutPromise = new Promise((_, reject) => { timeoutId = setTimeout(() => { controller.abort(); reject(new Error("openai_file_delete_timeout")); }, timeoutMs); });
        const raw = await Promise.race([fileDeleteTransport({ fileId: openAiFileId, apiKey, signal: controller.signal }), timeoutPromise]);
        const body = await fileTransportBody(raw, "delete");
        deleted = body?.deleted !== false;
        if (!deleted) throw new Error("openai_file_delete_not_confirmed");
      } catch (error) {
        deleted = false;
        deleteError = compact(error?.message || error, 180) || "openai_file_delete_failed";
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }

  if (normalizedResult) {
    normalizedResult.ai = {
      ...(normalizedResult.ai || {}),
      openai_file_upload_ms: uploadMs,
      input_file_bytes: Number(fileStats.size || 0),
      file_id_threshold_bytes: fileIdThreshold,
      openai_file_deleted: deleted,
      openai_file_delete_error: deleteError,
      recovery_attempted: false,
      recovered_from: null,
      openai_attempts: 1,
      retry_count: 0,
    };
    return normalizedResult;
  }
  throw analysisError || new Error("openai_invalid_output");
}
