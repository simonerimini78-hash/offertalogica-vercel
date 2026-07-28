import fs from "node:fs/promises";
import { applyPdfDataContract } from "./pdfDataContract.js";
import { applyPdfFieldValidation } from "./pdfFieldValidation.js";

export const PDF_PURE_AI_READER_VERSION = "pure-ai-native-pdf-v2.0.1-ia-libera-compact-form";
export const PDF_PURE_AI_DEFAULT_MODEL = "gpt-4.1-2025-04-14";
export const PDF_PURE_AI_QUESTION_IDS = Object.freeze([
  "fornitore",
  "fornitore_luce",
  "fornitore_gas",
  "customer_type",
  "intestatario",
  "codice_fiscale",
  "codice_cliente",
  "codice_cliente_luce",
  "codice_cliente_gas",
  "indirizzo_fornitura_luce",
  "pod",
  "potenza_impegnata_kw",
  "potenza_disponibile_kw",
  "consumo_luce_kwh",
  "consumo_luce_f1_kwh",
  "consumo_luce_f2_kwh",
  "consumo_luce_f3_kwh",
  "consumo_luce_f23_kwh",
  "prezzo_luce_eur_kwh",
  "prezzo_luce_f0_eur_kwh",
  "prezzo_luce_f1_eur_kwh",
  "prezzo_luce_f2_eur_kwh",
  "prezzo_luce_f3_eur_kwh",
  "prezzo_luce_f23_eur_kwh",
  "quota_fissa_vendita_luce",
  "nome_offerta_luce",
  "codice_offerta_luce",
  "tipo_prezzo_luce",
  "indice_riferimento_luce",
  "spread_luce_eur_kwh",
  "moltiplicatore_indice_luce",
  "periodicita_aggiornamento_indice_luce",
  "struttura_prezzo_luce",
  "formula_prezzo_luce",
  "decorrenza_condizioni_economiche_luce",
  "scadenza_condizioni_economiche_luce",
  "indirizzo_fornitura_gas",
  "pdr",
  "consumo_gas_smc",
  "prezzo_gas_eur_smc",
  "quota_fissa_vendita_gas",
  "nome_offerta_gas",
  "codice_offerta_gas",
  "tipo_prezzo_gas",
  "indice_riferimento_gas",
  "spread_gas_eur_smc",
  "moltiplicatore_indice_gas",
  "periodicita_aggiornamento_indice_gas",
  "formula_prezzo_gas",
  "decorrenza_condizioni_economiche_gas",
  "scadenza_condizioni_economiche_gas"
]);
export const PDF_PURE_AI_REQUEST_QUESTION_IDS = Object.freeze([]);

const REQUEST_PROFILE = "ia_libera_compact_form_v3";
const FIELD_PURPOSES = Object.freeze([
  "annual_consumption", "band_consumption", "unit_price", "band_price", "price_component",
  "fixed_fee", "price_type", "price_structure", "index", "spread", "multiplier", "formula",
  "power_committed", "power_available", "periodicity", "other",
]);

const REQUEST_FIELD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["purpose", "label", "value_text", "value_number", "unit", "period", "band", "page"],
  properties: {
    purpose: { type: "string", enum: FIELD_PURPOSES },
    label: { type: "string", minLength: 1, maxLength: 120 },
    value_text: { type: ["string", "null"], maxLength: 240 },
    value_number: { type: ["number", "null"] },
    unit: { type: ["string", "null"], maxLength: 40 },
    period: { type: "string", enum: ["none", "month", "year"] },
    band: { type: "string", enum: ["none", "f0", "f1", "f2", "f3", "f23"] },
    page: { type: ["integer", "null"], minimum: 1 },
  },
};

const REQUEST_SUPPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["commodity", "provider", "offer_name", "offer_code", "fields"],
  properties: {
    commodity: { type: "string", enum: ["electricity", "gas"] },
    provider: { type: ["string", "null"], maxLength: 240 },
    offer_name: { type: ["string", "null"], maxLength: 300 },
    offer_code: { type: ["string", "null"], maxLength: 180 },
    fields: { type: "array", minItems: 0, maxItems: 22, items: REQUEST_FIELD_SCHEMA },
  },
};

const REQUEST_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["document", "supplies"],
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
    supplies: { type: "array", minItems: 0, maxItems: 2, items: REQUEST_SUPPLY_SCHEMA },
  },
};

const SYSTEM_PROMPT = `Leggi integralmente il PDF e compila direttamente il modulo economico, come farebbe una persona.

Per ogni fornitura luce o gas restituisci solo le righe realmente utili al confronto:
- annual_consumption: consumo annuo o ultimi 12 mesi;
- band_consumption: consumo annuo F1/F2/F3/F23;
- unit_price: prezzo unitario corrente della sola vendita o materia energia/gas;
- band_price: prezzo F0/F1/F2/F3/F23;
- price_component: componente corrente che partecipa al prezzo;
- fixed_fee: quota fissa della vendita/commercializzazione, con segno e periodicità originali;
- price_type, price_structure, index, spread, multiplier, formula, periodicity;
- power_committed e power_available per la luce.

Regole:
- usa le etichette reali del documento e copia i numeri senza arrotondare;
- escludi rete, trasporto, oneri, imposte e IVA dai prezzi di vendita;
- non usare consumi del solo periodo come consumi annui;
- non inventare e non creare righe vuote o duplicate;
- non cercare né restituire dati personali, POD, PDR, indirizzi o codici cliente;
- massimo 22 righe per fornitura, scegliendo solo quelle necessarie a compilare il modulo;
- restituisci esclusivamente JSON conforme allo schema.`;

const USER_PROMPT = `Compila il modulo libero con consumi, prezzi, fasce, componenti, formula e quota fissa presenti nel documento. Mantieni la struttura tariffaria originale senza produrre spiegazioni.`;

function compact(value, maxLength = 600) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function parseLocaleNumber(value) {
  const raw = compact(value, 120).replace(/[^0-9,.-]/g, "");
  if (!raw || !/\d/.test(raw)) return null;
  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  let normalized = raw;
  if (comma >= 0 && dot >= 0) normalized = comma > dot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  else if (comma >= 0) normalized = raw.replace(/\./g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}
function rowNumber(row) {
  return finite(row?.value_number) ?? parseLocaleNumber(row?.value_text);
}
function normalizePriceType(value) {
  const text = compact(value, 120).toLowerCase();
  if (/ibrid|hybrid/.test(text)) return "ibrido";
  if (/variabil|variable|indicizzat|indexed/.test(text)) return "variabile";
  if (/fiss|fixed/.test(text)) return "fisso";
  return null;
}
function normalizeCode(value) {
  return compact(value, 180).toUpperCase().replace(/\s+/g, "");
}
function documentKind(value) {
  return value === "bill" ? "bolletta" : value === "offer_sheet" ? "scheda_offerta" : "unknown";
}
function documentCommodity(value) {
  return value === "electricity" ? "luce" : value === "gas" ? "gas" : value === "dual" ? "dual" : "unknown";
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
async function openAiFileTransportBody(result, operation) {
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
    max_output_tokens: Number(maxOutputTokens || 4_500),
    input: [
      { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
      { role: "user", content: [fileInput, { type: "input_text", text: USER_PROMPT }] },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "offertalogica_compact_adaptive_form",
        description: "Modulo economico adattivo compatto, senza dati personali e senza schema tariffario rigido",
        strict: true,
        schema: REQUEST_OUTPUT_SCHEMA,
      },
    },
  };
}

function fieldRow({ purpose, label, valueText = null, valueNumber = null, unit = null, period = "none", band = "none", page = null, evidence = null, confidence = 0 }) {
  return {
    purpose,
    label: compact(label, 220) || purpose,
    value_text: valueText === null ? null : compact(valueText, 500),
    value_number: finite(valueNumber),
    unit: unit === null ? null : compact(unit, 80),
    period: ["month", "year"].includes(period) ? period : "none",
    band: ["f0", "f1", "f2", "f3", "f23"].includes(band) ? band : "none",
    page: Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : null,
    evidence: evidence === null ? null : compact(evidence, 700),
    confidence: Math.max(0, Math.min(100, Number(confidence || 0))),
  };
}

function oldCompactToAdaptive(parsed) {
  const supplies = [];
  for (const [key, commodity] of [["electricity", "electricity"], ["gas", "gas"]]) {
    const supply = (Array.isArray(parsed?.supplies) ? parsed.supplies.find((item) => item?.commodity === commodity) : null) || parsed?.[key];
    if (!supply) continue;
    const rows = [];
    const consumption = supply.annual_consumption || {};
    if (finite(consumption.total) !== null) rows.push(fieldRow({ purpose: "annual_consumption", label: consumption.label || "Consumo annuo", valueNumber: consumption.total, valueText: String(consumption.total), unit: consumption.unit, page: consumption.page, evidence: consumption.evidence, confidence: consumption.confidence }));
    if (commodity === "electricity") for (const band of ["f1", "f2", "f3", "f23"]) if (finite(consumption[band]) !== null) rows.push(fieldRow({ purpose: "band_consumption", label: `Consumo ${band.toUpperCase()}`, valueNumber: consumption[band], valueText: String(consumption[band]), unit: consumption.unit, band, page: consumption.page, evidence: consumption.evidence, confidence: consumption.confidence }));
    const price = supply.price || {};
    if (finite(price.single) !== null) rows.push(fieldRow({ purpose: "unit_price", label: price.label || "Prezzo unitario", valueNumber: price.single, valueText: String(price.single), unit: price.unit, page: price.page, evidence: price.evidence, confidence: price.confidence }));
    if (commodity === "electricity") for (const band of ["f0", "f1", "f2", "f3", "f23"]) if (finite(price[band]) !== null) rows.push(fieldRow({ purpose: "band_price", label: `Prezzo ${band.toUpperCase()}`, valueNumber: price[band], valueText: String(price[band]), unit: price.unit, band, page: price.page, evidence: price.evidence, confidence: price.confidence }));
    if (price.type && price.type !== "unknown") rows.push(fieldRow({ purpose: "price_type", label: "Tipo prezzo", valueText: price.type, page: price.page, evidence: price.evidence, confidence: price.confidence }));
    if (price.index) rows.push(fieldRow({ purpose: "index", label: "Indice", valueText: price.index, page: price.page, evidence: price.evidence, confidence: price.confidence }));
    if (finite(price.spread) !== null) rows.push(fieldRow({ purpose: "spread", label: "Spread", valueNumber: price.spread, valueText: String(price.spread), unit: price.unit, page: price.page, evidence: price.evidence, confidence: price.confidence }));
    if (finite(price.multiplier) !== null) rows.push(fieldRow({ purpose: "multiplier", label: "Moltiplicatore", valueNumber: price.multiplier, valueText: String(price.multiplier), page: price.page, evidence: price.evidence, confidence: price.confidence }));
    if (price.formula) rows.push(fieldRow({ purpose: "formula", label: "Formula", valueText: price.formula, page: price.page, evidence: price.evidence, confidence: price.confidence }));
    if (price.periodicity) rows.push(fieldRow({ purpose: "periodicity", label: "Periodicità aggiornamento", valueText: price.periodicity, page: price.page, evidence: price.evidence, confidence: price.confidence }));
    const fixed = supply.fixed_fee || {};
    if (finite(fixed.value) !== null) rows.push(fieldRow({ purpose: "fixed_fee", label: fixed.label || "Quota fissa", valueNumber: fixed.value, valueText: fixed.value_text || String(fixed.value), unit: fixed.unit, period: fixed.period, page: fixed.page, evidence: fixed.evidence, confidence: fixed.confidence }));
    supplies.push({ commodity, provider: supply.identity?.provider || null, offer_name: supply.identity?.offer_name || null, offer_code: supply.identity?.offer_code || null, fields: rows.length ? rows : [fieldRow({ purpose: "other", label: "Dato non classificato", valueText: null })] });
  }
  return { document: parsed?.document || { kind: "unknown", commodity: supplies.length === 2 ? "dual" : supplies[0]?.commodity || "unknown", customer_type: "unknown", page_count: null }, supplies };
}

const LEGACY_PURPOSE = {
  consumo_luce_kwh: ["electricity", "annual_consumption", "none"], consumo_gas_smc: ["gas", "annual_consumption", "none"],
  consumo_luce_f1_kwh: ["electricity", "band_consumption", "f1"], consumo_luce_f2_kwh: ["electricity", "band_consumption", "f2"], consumo_luce_f3_kwh: ["electricity", "band_consumption", "f3"], consumo_luce_f23_kwh: ["electricity", "band_consumption", "f23"],
  prezzo_luce_eur_kwh: ["electricity", "unit_price", "none"], prezzo_gas_eur_smc: ["gas", "unit_price", "none"],
  prezzo_luce_f0_eur_kwh: ["electricity", "band_price", "f0"], prezzo_luce_f1_eur_kwh: ["electricity", "band_price", "f1"], prezzo_luce_f2_eur_kwh: ["electricity", "band_price", "f2"], prezzo_luce_f3_eur_kwh: ["electricity", "band_price", "f3"], prezzo_luce_f23_eur_kwh: ["electricity", "band_price", "f23"],
  quota_fissa_vendita_luce: ["electricity", "fixed_fee", "none"], quota_fissa_vendita_gas: ["gas", "fixed_fee", "none"],
  tipo_prezzo_luce: ["electricity", "price_type", "none"], tipo_prezzo_gas: ["gas", "price_type", "none"],
  indice_riferimento_luce: ["electricity", "index", "none"], indice_riferimento_gas: ["gas", "index", "none"],
  spread_luce_eur_kwh: ["electricity", "spread", "none"], spread_gas_eur_smc: ["gas", "spread", "none"],
  moltiplicatore_indice_luce: ["electricity", "multiplier", "none"], moltiplicatore_indice_gas: ["gas", "multiplier", "none"],
  formula_prezzo_luce: ["electricity", "formula", "none"], formula_prezzo_gas: ["gas", "formula", "none"],
  periodicita_aggiornamento_indice_luce: ["electricity", "periodicity", "none"], periodicita_aggiornamento_indice_gas: ["gas", "periodicity", "none"],
  potenza_impegnata_kw: ["electricity", "power_committed", "none"], potenza_disponibile_kw: ["electricity", "power_available", "none"],
};
function oldAnswersToAdaptive(parsed) {
  const supplies = new Map();
  const providers = { electricity: null, gas: null };
  for (const answer of parsed?.answers || []) {
    if (!answer?.found) continue;
    if (answer.question_id === "fornitore_luce") providers.electricity = answer.value_text;
    if (answer.question_id === "fornitore_gas") providers.gas = answer.value_text;
    const map = LEGACY_PURPOSE[answer.question_id];
    if (!map) continue;
    const [commodity, purpose, band] = map;
    if (!supplies.has(commodity)) supplies.set(commodity, []);
    supplies.get(commodity).push(fieldRow({ purpose, band, label: answer.label || answer.question_id, valueText: answer.value_text, valueNumber: answer.value_number, unit: answer.unit, period: answer.period, page: answer.page, evidence: answer.evidence, confidence: answer.confidence }));
  }
  return {
    document: parsed?.document || { kind: "unknown", commodity: supplies.size === 2 ? "dual" : [...supplies.keys()][0] || "unknown", customer_type: "unknown", page_count: null },
    supplies: [...supplies.entries()].map(([commodity, fields]) => ({ commodity, provider: providers[commodity], offer_name: null, offer_code: null, fields })),
  };
}

function directFormV2ToAdaptive(parsed) {
  return {
    document: parsed?.document || { kind: "unknown", commodity: "unknown", customer_type: "unknown", page_count: null },
    supplies: (Array.isArray(parsed?.supplies) ? parsed.supplies : []).map((supply) => {
      const rows = [];
      const pushValue = (purpose, entry, band = "none") => {
        if (!entry) return;
        const number = finite(entry.value);
        const text = compact(entry.value_text, 500) || (number !== null ? String(number) : null);
        if (text === null && number === null) return;
        rows.push(fieldRow({ purpose, band: String(band || "none").toLowerCase(), label: entry.label || purpose, valueText: text, valueNumber: number, unit: entry.unit, period: entry.period, page: entry.page, evidence: entry.evidence, confidence: entry.confidence }));
      };
      pushValue("annual_consumption", supply.annual_consumption);
      for (const item of Array.isArray(supply.annual_band_consumptions) ? supply.annual_band_consumptions : []) pushValue("band_consumption", item, item.band);
      pushValue("unit_price", supply.primary_price);
      for (const item of Array.isArray(supply.price_items) ? supply.price_items : []) {
        const band = String(item?.band || "none").toLowerCase();
        pushValue(band !== "none" ? "band_price" : "price_component", item, band);
      }
      pushValue("fixed_fee", supply.fixed_fee);
      if (supply.price_type && supply.price_type !== "unknown") rows.push(fieldRow({ purpose: "price_type", label: "Tipo prezzo", valueText: supply.price_type, page: supply.pricing_page, evidence: supply.pricing_evidence, confidence: supply.confidence }));
      if (supply.price_structure) rows.push(fieldRow({ purpose: "price_structure", label: "Struttura prezzo", valueText: supply.price_structure, page: supply.pricing_page, evidence: supply.pricing_evidence, confidence: supply.confidence }));
      if (supply.index) rows.push(fieldRow({ purpose: "index", label: "Indice", valueText: supply.index, page: supply.pricing_page, evidence: supply.pricing_evidence, confidence: supply.confidence }));
      if (finite(supply.multiplier) !== null) rows.push(fieldRow({ purpose: "multiplier", label: "Moltiplicatore", valueNumber: supply.multiplier, valueText: String(supply.multiplier), page: supply.pricing_page, evidence: supply.pricing_evidence, confidence: supply.confidence }));
      if (finite(supply.spread) !== null) rows.push(fieldRow({ purpose: "spread", label: "Spread", valueNumber: supply.spread, valueText: String(supply.spread), page: supply.pricing_page, evidence: supply.pricing_evidence, confidence: supply.confidence }));
      if (supply.formula) rows.push(fieldRow({ purpose: "formula", label: "Formula", valueText: supply.formula, page: supply.pricing_page, evidence: supply.pricing_evidence, confidence: supply.confidence }));
      if (supply.periodicity) rows.push(fieldRow({ purpose: "periodicity", label: "Periodicità", valueText: supply.periodicity, page: supply.pricing_page, evidence: supply.pricing_evidence, confidence: supply.confidence }));
      if (finite(supply.committed_power_kw) !== null) rows.push(fieldRow({ purpose: "power_committed", label: "Potenza impegnata", valueNumber: supply.committed_power_kw, valueText: String(supply.committed_power_kw), unit: "kW", page: supply.pricing_page, evidence: supply.pricing_evidence, confidence: supply.confidence }));
      if (finite(supply.available_power_kw) !== null) rows.push(fieldRow({ purpose: "power_available", label: "Potenza disponibile", valueNumber: supply.available_power_kw, valueText: String(supply.available_power_kw), unit: "kW", page: supply.pricing_page, evidence: supply.pricing_evidence, confidence: supply.confidence }));
      return { commodity: supply.commodity, provider: supply.provider || null, offer_name: supply.offer_name || null, offer_code: supply.offer_code || null, fields: rows };
    }),
  };
}

function coerceAdaptive(parsed) {
  if (parsed?.document && Array.isArray(parsed?.supplies) && parsed.supplies.every((supply) => Array.isArray(supply?.fields))) return parsed;
  if (parsed?.document && Array.isArray(parsed?.supplies) && parsed.supplies.some((supply) => Object.prototype.hasOwnProperty.call(supply || {}, "primary_price"))) return directFormV2ToAdaptive(parsed);
  if (Array.isArray(parsed?.answers)) return oldAnswersToAdaptive(parsed);
  return oldCompactToAdaptive(parsed);
}

function diagnostic(field, row, value, derivation = null) {
  return {
    field,
    label: compact(row?.label, 180) || field,
    value,
    status: "review",
    confidence: Math.max(0, Math.min(100, Number(row?.confidence ?? 90))),
    page: Number.isInteger(Number(row?.page)) && Number(row.page) > 0 ? Number(row.page) : null,
    source_snippet: compact(row?.evidence, 900) || compact([row?.label, row?.value_text, row?.value_number, row?.unit].filter((item) => item !== null && item !== undefined && item !== "").join(" "), 300),
    source_match: compact(row?.value_text, 180) || (value !== null && value !== undefined ? String(value) : null),
    source_role: ["annual_consumption", "band_consumption"].includes(row?.purpose) ? "annual_total" : ["power_committed", "power_available"].includes(row?.purpose) ? "customer_data" : "contract_term",
    certainty: derivation ? "derived" : "certain",
    usable_for_comparison: true,
    verification_reason: null,
    coverage_months: ["annual_consumption", "band_consumption"].includes(row?.purpose) ? 12 : null,
    method: derivation ? "deterministic_projection" : "openai_visual_ai_direct_form",
    source_version: PDF_PURE_AI_READER_VERSION,
    derivation,
  };
}
function bestRow(rows, purpose, band = null) {
  return rows
    .filter((row) => row?.purpose === purpose && (band === null || row?.band === band))
    .filter((row) => row?.value_text !== null || finite(row?.value_number) !== null)
    .sort((a, b) => Number(b.confidence ?? 90) - Number(a.confidence ?? 90) || Number(a.page || 9999) - Number(b.page || 9999))[0] || null;
}
function setMapped(normalized, filledFields, field, row, transform = (item) => rowNumber(item)) {
  if (!row) return;
  const value = transform(row);
  if (value === null || value === undefined || value === "") return;
  normalized[field] = value;
  filledFields.push(field);
  normalized.diagnostics.push(diagnostic(field, row, value));
}
function rawFixedDetails(row) {
  if (!row) return null;
  const number = rowNumber(row);
  const valid = number !== null && ["month", "year"].includes(row.period);
  return {
    commercial_component: {
      value: valid ? number : null,
      value_text: valid ? (compact(row.value_text, 120) || String(number)) : null,
      unit: valid ? (compact(row.unit, 60) || null) : null,
      period: valid ? row.period : "none",
      page: valid ? row.page : null,
      label: valid ? row.label : null,
      evidence: valid ? (row.evidence || compact([row.label, row.value_text, row.value_number, row.unit].filter((item) => item !== null && item !== undefined && item !== "").join(" "), 300) || null) : null,
      confidence: valid ? Number(row.confidence ?? 90) : 0,
    },
    section_total: { value: null, value_text: null, unit: null, period: "none", page: null, label: null, evidence: null, confidence: 0 },
    selected_for_comparison: valid ? "commercial_component" : null,
  };
}


function rowEvidence(row) {
  return compact(row?.evidence, 700)
    || compact([row?.label, row?.value_text, row?.value_number, row?.unit].filter((item) => item !== null && item !== undefined && item !== "").join(" "), 300)
    || null;
}

function frontendEntry(row) {
  if (!row) return null;
  return {
    value: rowNumber(row),
    value_text: compact(row.value_text, 240) || (rowNumber(row) !== null ? String(rowNumber(row)) : null),
    unit: compact(row.unit, 40) || null,
    period: ["month", "year"].includes(row.period) ? row.period : "none",
    page: Number.isInteger(Number(row.page)) && Number(row.page) > 0 ? Number(row.page) : null,
    label: compact(row.label, 120) || null,
    evidence: rowEvidence(row),
    confidence: Math.max(0, Math.min(100, Number(row.confidence ?? 90))),
  };
}

function adaptiveSupplyForFrontend(supply) {
  const rows = Array.isArray(supply?.fields) ? supply.fields : [];
  const firstText = (purpose) => compact(bestRow(rows, purpose)?.value_text, 240) || null;
  const firstNumber = (purpose) => rowNumber(bestRow(rows, purpose));
  const annual = frontendEntry(bestRow(rows, "annual_consumption"));
  const bands = rows.filter((row) => row?.purpose === "band_consumption").map((row) => ({
    band: String(row.band || "none").toUpperCase(),
    ...frontendEntry(row),
  }));
  const priceItems = rows.filter((row) => ["band_price", "price_component"].includes(row?.purpose)).map((row) => ({
    label: compact(row.label, 120) || "Voce prezzo",
    value: rowNumber(row),
    value_text: compact(row.value_text, 240) || (rowNumber(row) !== null ? String(rowNumber(row)) : null),
    unit: compact(row.unit, 40) || null,
    period: ["month", "year"].includes(row.period) ? row.period : "none",
    band: row.band && row.band !== "none" ? String(row.band).toUpperCase() : null,
    page: Number.isInteger(Number(row.page)) && Number(row.page) > 0 ? Number(row.page) : null,
    evidence: rowEvidence(row),
    confidence: Math.max(0, Math.min(100, Number(row.confidence ?? 90))),
  }));
  const priceTypeIt = normalizePriceType(firstText("price_type"));
  const priceType = priceTypeIt === "fisso" ? "fixed" : priceTypeIt === "variabile" ? "variable" : priceTypeIt === "ibrido" ? "hybrid" : "unknown";
  const firstPage = rows.map((row) => Number(row?.page)).find((page) => Number.isInteger(page) && page > 0) || null;
  return {
    commodity: supply.commodity,
    provider: compact(supply.provider, 240) || null,
    offer_name: compact(supply.offer_name, 300) || null,
    offer_code: compact(supply.offer_code, 180) || null,
    annual_consumption: annual,
    annual_band_consumptions: bands,
    primary_price: frontendEntry(bestRow(rows, "unit_price")),
    price_items: priceItems,
    fixed_fee: frontendEntry(bestRow(rows, "fixed_fee")),
    price_type: priceType,
    price_structure: firstText("price_structure") || (priceItems.some((item) => item.band) ? "per fasce" : bestRow(rows, "unit_price") ? "monoraria" : null),
    index: firstText("index"),
    multiplier: firstNumber("multiplier"),
    spread: firstNumber("spread"),
    formula: firstText("formula"),
    periodicity: firstText("periodicity"),
    committed_power_kw: firstNumber("power_committed"),
    available_power_kw: firstNumber("power_available"),
    pricing_page: firstPage,
    pricing_evidence: compact(rows.map(rowEvidence).filter(Boolean).slice(0, 3).join(" | "), 700) || null,
    confidence: rows.length ? 90 : 0,
  };
}

export function normalizePureAiOutput(parsed, { model = PDF_PURE_AI_DEFAULT_MODEL, responseId = null, transportMode = "pdf_originale", timings = {} } = {}) {
  const adaptive = coerceAdaptive(parsed);
  if (!adaptive?.document || !Array.isArray(adaptive?.supplies)) throw new Error("openai_invalid_output");
  const normalized = {
    parser_version: PDF_PURE_AI_READER_VERSION,
    page_count: Number(adaptive.document.page_count || 0) || null,
    diagnostics: [],
    kind: documentKind(adaptive.document.kind),
    commodity: documentCommodity(adaptive.document.commodity),
    customer_type: adaptive.document.customer_type === "consumer" ? "privato" : adaptive.document.customer_type === "business" ? "business" : null,
    document_classification_evidence: null,
    billing_period_start: null,
    billing_period_end: null,
    supply_start_date: null,
    textExtracted: 0,
    needsReview: true,
    adaptive_form: { version: "adaptive-form-v3-compact", supplies: [] },
    comparison_form_raw: adaptive,
    activation_data_archive: [],
    componenti_prezzo_luce: [],
    componenti_prezzo_gas: [],
  };
  const filledFields = [];
  const rejected = [];
  const providers = [];

  for (const supply of adaptive.supplies) {
    if (!supply || !["electricity", "gas"].includes(supply.commodity)) continue;
    const isLight = supply.commodity === "electricity";
    const suffix = isLight ? "luce" : "gas";
    const rows = Array.isArray(supply.fields) ? supply.fields : [];
    normalized.adaptive_form.supplies.push(adaptiveSupplyForFrontend(supply));
    if (supply.provider) {
      const provider = compact(supply.provider, 240);
      normalized[`fornitore_${suffix}`] = provider;
      providers.push(provider);
      filledFields.push(`fornitore_${suffix}`);
      normalized.diagnostics.push(diagnostic(`fornitore_${suffix}`, { label: "Fornitore", value_text: provider, confidence: 100 }, provider));
    }
    if (supply.offer_name) normalized[`nome_offerta_${suffix}`] = compact(supply.offer_name, 300);
    if (supply.offer_code) normalized[`codice_offerta_${suffix}`] = normalizeCode(supply.offer_code);

    setMapped(normalized, filledFields, isLight ? "consumo_luce_kwh" : "consumo_gas_smc", bestRow(rows, "annual_consumption"));
    if (isLight) {
      for (const band of ["f1", "f2", "f3", "f23"]) setMapped(normalized, filledFields, `consumo_luce_${band}_kwh`, bestRow(rows, "band_consumption", band));
      for (const band of ["f0", "f1", "f2", "f3", "f23"]) setMapped(normalized, filledFields, `prezzo_luce_${band}_eur_kwh`, bestRow(rows, "band_price", band));
      setMapped(normalized, filledFields, "prezzo_luce_eur_kwh", bestRow(rows, "unit_price"));
      setMapped(normalized, filledFields, "potenza_impegnata_kw", bestRow(rows, "power_committed"));
      setMapped(normalized, filledFields, "potenza_disponibile_kw", bestRow(rows, "power_available"));
      if (["f0", "f1", "f2", "f3", "f23"].some((band) => bestRow(rows, "band_price", band))) normalized.struttura_prezzo_luce = "per fasce";
      else if (bestRow(rows, "unit_price")) normalized.struttura_prezzo_luce = "monoraria";
    } else setMapped(normalized, filledFields, "prezzo_gas_eur_smc", bestRow(rows, "unit_price"));

    setMapped(normalized, filledFields, `tipo_prezzo_${suffix}`, bestRow(rows, "price_type"), (row) => normalizePriceType(row.value_text));
    setMapped(normalized, filledFields, `struttura_prezzo_${suffix}`, bestRow(rows, "price_structure"), (row) => compact(row.value_text, 180));
    setMapped(normalized, filledFields, `indice_riferimento_${suffix}`, bestRow(rows, "index"), (row) => compact(row.value_text, 180));
    setMapped(normalized, filledFields, `spread_${suffix}_${isLight ? "eur_kwh" : "eur_smc"}`, bestRow(rows, "spread"));
    setMapped(normalized, filledFields, `moltiplicatore_indice_${suffix}`, bestRow(rows, "multiplier"));
    setMapped(normalized, filledFields, `formula_prezzo_${suffix}`, bestRow(rows, "formula"), (row) => compact(row.value_text, 500));
    setMapped(normalized, filledFields, `periodicita_aggiornamento_indice_${suffix}`, bestRow(rows, "periodicity"), (row) => compact(row.value_text, 160));

    const fixedRow = bestRow(rows, "fixed_fee");
    const fixedNumber = rowNumber(fixedRow);
    normalized[`quota_fissa_dettaglio_${suffix}`] = rawFixedDetails(fixedRow);
    if (fixedRow && fixedNumber !== null && ["month", "year"].includes(fixedRow.period)) {
      const annual = fixedRow.period === "month" ? Number((fixedNumber * 12).toFixed(6)) : fixedNumber;
      const field = `quota_fissa_vendita_${suffix}_eur_anno`;
      normalized[field] = annual;
      filledFields.push(field);
      normalized.diagnostics.push(diagnostic(field, fixedRow, annual, { type: fixedRow.period === "month" ? "monthly_to_annual" : "annual_literal", original_value: fixedNumber, original_period: fixedRow.period, factor: fixedRow.period === "month" ? 12 : 1, derived_value: annual }));
    }

    const components = rows.filter((row) => row?.purpose === "price_component").map((row) => ({
      label: compact(row.label, 220), value: rowNumber(row), value_text: compact(row.value_text, 300) || null, unit: compact(row.unit, 80) || null,
      period: row.period || "none", band: row.band || "none", page: row.page || null, evidence: rowEvidence(row), confidence: Number(row.confidence ?? 90),
    }));
    normalized[`componenti_prezzo_${suffix}`] = components;
  }

  if (providers.length) normalized.fornitore = providers[0];
  if (finite(normalized.consumo_luce_kwh) === null) {
    const f1 = finite(normalized.consumo_luce_f1_kwh), f2 = finite(normalized.consumo_luce_f2_kwh), f3 = finite(normalized.consumo_luce_f3_kwh), f23 = finite(normalized.consumo_luce_f23_kwh);
    const total = f1 !== null && f23 !== null ? f1 + f23 : [f1, f2, f3].every((v) => v !== null) ? f1 + f2 + f3 : null;
    if (total !== null && total > 0) {
      normalized.consumo_luce_kwh = Number(total.toFixed(6));
      filledFields.push("consumo_luce_kwh");
      normalized.diagnostics.push(diagnostic("consumo_luce_kwh", { purpose: "annual_consumption", label: "Consumo annuo derivato dalle fasce", confidence: 100, evidence: "Somma esatta delle fasce annue" }, normalized.consumo_luce_kwh, { type: "annual_bands_to_total", derived_value: normalized.consumo_luce_kwh }));
    }
  }

  const lightSignals = ["consumo_luce_kwh", "prezzo_luce_eur_kwh", "prezzo_luce_f1_eur_kwh", "quota_fissa_vendita_luce_eur_anno", "indice_riferimento_luce"].some((field) => normalized[field] !== null && normalized[field] !== undefined && normalized[field] !== "");
  const gasSignals = ["consumo_gas_smc", "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno", "indice_riferimento_gas"].some((field) => normalized[field] !== null && normalized[field] !== undefined && normalized[field] !== "");
  if (lightSignals && gasSignals) normalized.commodity = "dual";
  else if (lightSignals) normalized.commodity = "luce";
  else if (gasSignals) normalized.commodity = "gas";

  normalized.recognized = normalized.kind !== "unknown" && normalized.commodity !== "unknown" && adaptive.supplies.some((supply) => Array.isArray(supply.fields) && supply.fields.length);
  normalized.confidence = normalized.recognized ? "medium" : "low";
  normalized.warnings = ["lettura_ia_libera_da_verificare_nel_modulo"];
  normalized.ocr = { attempted: false, applied: false, reason: "ai_only_mode" };
  normalized.ai = {
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
    page_count: normalized.page_count,
    accepted_count: filledFields.length,
    filled_fields: [...new Set(filledFields)],
    rejected_questions: rejected,
    document_kind_declared: documentKind(adaptive.document.kind),
    document_kind_resolved: normalized.kind,
    document_kind_reason: "ai_direct_form",
    verification_protocol: REQUEST_PROFILE,
    activation_archive_count: 0,
  };
  return applyPdfDataContract(applyPdfFieldValidation(normalized));
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
  const useOpenAiFileId = Number(fileStats.size || 0) >= fileIdThreshold;
  let openAiFileId = "";
  let openAiFileUploadMs = 0;
  let openAiFileDeleted = null;
  let openAiFileDeleteError = null;
  let normalizedResult = null;
  let analysisError = null;
  let requestBuildMs = 0;
  const openaiStartedAt = Date.now();

  try {
    if (useOpenAiFileId) {
      const uploadTimeoutMs = Math.min(boundedFileUploadTimeout(env.PDF_AI_FILE_UPLOAD_TIMEOUT_MS), remainingBudget() - 8_000);
      if (!Number.isFinite(uploadTimeoutMs) || uploadTimeoutMs < 5_000) throw new Error("openai_insufficient_time_budget");
      const controller = new AbortController();
      let timeoutId;
      const uploadStartedAt = Date.now();
      try {
        const timeoutPromise = new Promise((_, reject) => { timeoutId = setTimeout(() => { controller.abort(); reject(new Error("openai_file_upload_timeout")); }, uploadTimeoutMs); });
        const uploadRaw = await Promise.race([fileUploadTransport({ filePath, filename, apiKey, signal: controller.signal }), timeoutPromise]);
        const uploadBody = await openAiFileTransportBody(uploadRaw, "upload");
        openAiFileId = compact(uploadBody?.id, 180);
        if (!openAiFileId) throw new Error("openai_file_upload_invalid_response");
      } finally {
        clearTimeout(timeoutId);
        openAiFileUploadMs = Date.now() - uploadStartedAt;
      }
    }

    const buildStartedAt = Date.now();
    const request = await buildPdfPureAiRequest({ filePath: useOpenAiFileId ? null : filePath, fileId: openAiFileId || null, filename, model });
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
        transportMode: useOpenAiFileId ? "openai_file_id" : "pdf_originale",
        timings: { request_build_ms: requestBuildMs, openai_file_upload_ms: openAiFileUploadMs, openai_ms: now - openaiStartedAt, total_ms: now - startedAt, openai_attempts: 1, input_file_bytes: Number(fileStats.size || 0), file_id_threshold_bytes: fileIdThreshold },
      });
      normalizedResult.ai = { ...(normalizedResult.ai || {}), request_profile: REQUEST_PROFILE, recovery_attempted: false, recovered_from: null };
      normalizedResult._reader_trace = { trace_version: "reader-trace-v3-compact-form", captured_at: new Date(now).toISOString(), response_id: compact(body?.id, 160) || null, request_profile: REQUEST_PROFILE, raw_output_chars: outputText.length, raw_ai: parsedOutput };
    } finally { clearTimeout(timeoutId); }
  } catch (error) { analysisError = error; }
  finally {
    if (openAiFileId) {
      const controller = new AbortController();
      let timeoutId;
      try {
        const timeoutMs = boundedFileDeleteTimeout(env.PDF_AI_FILE_DELETE_TIMEOUT_MS);
        const timeoutPromise = new Promise((_, reject) => { timeoutId = setTimeout(() => { controller.abort(); reject(new Error("openai_file_delete_timeout")); }, timeoutMs); });
        const deleteRaw = await Promise.race([fileDeleteTransport({ fileId: openAiFileId, apiKey, signal: controller.signal }), timeoutPromise]);
        const deleteBody = await openAiFileTransportBody(deleteRaw, "delete");
        openAiFileDeleted = deleteBody?.deleted !== false;
        if (!openAiFileDeleted) throw new Error("openai_file_delete_not_confirmed");
      } catch (error) {
        openAiFileDeleted = false;
        openAiFileDeleteError = compact(error?.message || error, 180) || "openai_file_delete_failed";
      } finally { clearTimeout(timeoutId); }
    }
  }

  if (normalizedResult) {
    normalizedResult.ai = { ...(normalizedResult.ai || {}), openai_file_upload_ms: openAiFileUploadMs, input_file_bytes: Number(fileStats.size || 0), file_id_threshold_bytes: fileIdThreshold, openai_file_deleted: openAiFileDeleted, openai_file_delete_error: openAiFileDeleteError, recovery_attempted: false, recovered_from: null, openai_attempts: 1, retry_count: 0 };
    return normalizedResult;
  }
  throw analysisError || new Error("openai_invalid_output");
}
