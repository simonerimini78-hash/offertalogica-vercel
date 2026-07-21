import fs from "node:fs/promises";
import {
  buildPdfAiImageRequest,
  pdfAiMode,
  PDF_AI_PRIMARY_MODEL,
} from "./pdfAiReader.js";
import { aiPdfToCandidates } from "./pdfReaderContract.js";

export const PDF_AI_RASTER_BATCH_VERSION = "2.4.9.5-economic-row-inventory";


const CORE_RECOVERY_FIELDS = Object.freeze([
  "commodity",
  "pod", "pdr",
  "consumo_luce_kwh", "consumo_gas_smc",
  "nome_offerta_luce", "nome_offerta_gas",
  "codice_offerta_luce", "codice_offerta_gas"
]);

const ECONOMIC_CONDITION_FIELDS = Object.freeze([
  "tipo_prezzo_luce", "tipo_prezzo_gas",
  "indice_riferimento_luce", "indice_riferimento_gas",
  "spread_luce_eur_kwh", "spread_gas_eur_smc",
  "formula_prezzo_luce", "formula_prezzo_gas",
  "periodicita_aggiornamento_indice_luce", "periodicita_aggiornamento_indice_gas"
]);

const ECONOMIC_OUTPUT_FIELDS = Object.freeze([
  "prezzo_luce_eur_kwh", "prezzo_gas_eur_smc",
  "quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno",
  ...ECONOMIC_CONDITION_FIELDS
]);

function documentSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["document_type", "commodity", "customer_type", "page_count"],
    properties: {
      document_type: { type: "string", enum: ["bill", "synthetic_sheet", "cte", "combined_offer_document", "placet", "unknown"] },
      commodity: { type: "string", enum: ["electricity", "gas", "dual", "unknown"] },
      customer_type: { type: "string", enum: ["consumer", "business", "unknown"] },
      page_count: { type: ["integer", "null"] }
    }
  };
}

function recoverySchema(fields) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["document", "candidates"],
    properties: {
      document: documentSchema(),
      candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["field", "value_text", "value_number", "unit", "commodity", "page", "label", "evidence", "semantic_role", "confidence"],
          properties: {
            field: { type: "string", enum: fields },
            value_text: { type: ["string", "null"] },
            value_number: { type: ["number", "null"] },
            unit: { type: ["string", "null"] },
            commodity: { type: "string", enum: ["electricity", "gas", "dual", "not_applicable", "unknown"] },
            page: { type: ["integer", "null"] },
            label: { type: ["string", "null"] },
            evidence: { type: "string", maxLength: 420 },
            semantic_role: { type: "string", enum: ["actual_customer_value", "offer_value", "billing_period", "contract_period", "identifier", "classification", "sales_component", "unknown"] },
            confidence: { type: "integer", minimum: 0, maximum: 100 }
          }
        }
      }
    }
  };
}

const ECONOMIC_ROW_ROLES = Object.freeze([
  "sales_variable",
  "sales_fixed",
  "network_variable",
  "network_fixed",
  "power",
  "tax",
  "average_or_total",
  "consumption",
  "discount_or_adjustment",
  "other"
]);

const ECONOMIC_INVENTORY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["document", "rows", "conditions"],
  properties: {
    document: documentSchema(),
    rows: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "page", "commodity", "section_label", "row_label",
          "quantity_number", "quantity_unit",
          "unit_value_number", "unit_value_unit",
          "amount_number", "amount_unit",
          "component_role", "evidence", "confidence"
        ],
        properties: {
          page: { type: ["integer", "null"] },
          commodity: { type: "string", enum: ["electricity", "gas", "unknown"] },
          section_label: { type: ["string", "null"], maxLength: 180 },
          row_label: { type: ["string", "null"], maxLength: 240 },
          quantity_number: { type: ["number", "null"] },
          quantity_unit: { type: ["string", "null"], maxLength: 60 },
          unit_value_number: { type: ["number", "null"] },
          unit_value_unit: { type: ["string", "null"], maxLength: 60 },
          amount_number: { type: ["number", "null"] },
          amount_unit: { type: ["string", "null"], maxLength: 40 },
          component_role: { type: "string", enum: ECONOMIC_ROW_ROLES },
          evidence: { type: "string", maxLength: 520 },
          confidence: { type: "integer", minimum: 0, maximum: 100 }
        }
      }
    },
    conditions: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "value_text", "value_number", "unit", "commodity", "page", "label", "evidence", "semantic_role", "confidence"],
        properties: {
          field: { type: "string", enum: ECONOMIC_CONDITION_FIELDS },
          value_text: { type: ["string", "null"] },
          value_number: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
          commodity: { type: "string", enum: ["electricity", "gas", "dual", "not_applicable", "unknown"] },
          page: { type: ["integer", "null"] },
          label: { type: ["string", "null"] },
          evidence: { type: "string", maxLength: 420 },
          semantic_role: { type: "string", enum: ["offer_value", "classification", "unknown"] },
          confidence: { type: "integer", minimum: 0, maximum: 100 }
        }
      }
    }
  }
};

const CORE_RECOVERY_PROMPT = `You are a precision transcription pass for difficult Italian electricity and gas bills from any supplier.
Read only the attached pages. Return a small set of exact, explicitly labelled values.

Annual consumption and supply rules:
- Return annual gas consumption only when the visible row or box literally says Consumo annuo, Consumo annuale, ultimi 12 mesi or an equivalent annual label and the unit is Smc.
- Return annual electricity consumption only under the same annual-label rule and the unit is kWh.
- Never use billed-period consumption, monthly quantities, meter readings or totals as annual consumption.
- Return PDR only from a visible PDR or punto di riconsegna label.
- Return POD only from a visible POD or punto di prelievo label.
- Copy identifiers character by character. Omit uncertain identifiers.
- Return offer names and official offer codes only when explicitly labelled.

Evidence must quote the exact visible label, value and unit. Do not paraphrase.
Prefer omission to guessing. Return JSON only.`;

const ECONOMIC_INVENTORY_PROMPT = `You are a table-transcription pass for difficult Italian electricity and gas bills from any supplier.
Your task is not to choose one final price immediately. First reconstruct the visible economic rows and their columns.

For every readable row in a pricing or charge table:
- copy section_label and row_label literally;
- quantity_number/quantity_unit are the billed quantity columns;
- amount_number/amount_unit are the monetary amount columns;
- unit_value_number/unit_value_unit are the printed unit-rate columns, such as €/kWh, €/Smc, €/mese or €/anno;
- never put a total amount into unit_value_number;
- preserve decimal digits exactly as visible;
- evidence must literally include the row label and all readable numbers and units.

Classify component_role:
- sales_variable only for the commodity sales/material/energy supply row;
- sales_fixed only for a fixed sales or commercialisation row;
- network_variable/network_fixed for transport, distribution, meter, network or system charges;
- power for committed/available power charges;
- average_or_total for prezzo medio, total quota consumi or other parent totals;
- consumption for consumption-only rows;
- tax for taxes, excise or VAT;
- discount_or_adjustment for rebates, adjustments or deposits;
- other when uncertain.

Important table structure:
- If a parent total row is followed by indented "di cui" rows, transcribe all readable rows separately.
- The rightmost printed unit rate of the sales "di cui" row is important.
- A fixed row may show quantity in months, an amount, and a rate in €/mese: keep all three columns.
- Do not calculate rates by division and do not annualize monthly values.

Conditions:
- In conditions, return PUN, PSV, TTF, index, price type, spread, formula and update periodicity only when literally visible.
- Do not return customer data, consumption totals, POD/PDR, supplier or document classification as conditions.

Never treat average cost, total quota consumi, network, system charges, transport, distribution, meter, power, taxes, excise, VAT, water or service charges as sales values.
Prefer a complete literal row inventory to guessing. Return JSON only.`;

async function imageContent(imageFiles) {
  const content = [];
  const ordered = [...imageFiles].sort((a, b) => Number(a.page || 0) - Number(b.page || 0));
  for (const [index, item] of ordered.entries()) {
    const bytes = await fs.readFile(item.filePath);
    const mime = ["image/jpeg", "image/png", "image/webp"].includes(String(item.mimeType || "").toLowerCase())
      ? String(item.mimeType).toLowerCase()
      : "image/jpeg";
    content.push({ type: "input_image", image_url: `data:${mime};base64,${bytes.toString("base64")}`, detail: "high" });
    content.push({ type: "input_text", text: `The preceding image is original page ${Number(item.page || index + 1)}.` });
  }
  return content;
}

async function buildRecoveryRequest({
  imageFiles, filename, model, fields, prompt, schemaName, instruction
}) {
  const content = await imageContent(imageFiles);
  content.push({
    type: "input_text",
    text: `Original file: ${filename || "documento.pdf"}. ${instruction}`
  });
  return {
    model,
    store: false,
    max_output_tokens: 1300,
    input: [
      { role: "system", content: prompt },
      { role: "user", content }
    ],
    text: {
      format: {
        type: "json_schema",
        name: schemaName,
        strict: true,
        schema: recoverySchema(fields)
      }
    }
  };
}

async function buildEconomicInventoryRequest({ imageFiles, filename, model }) {
  const content = await imageContent(imageFiles);
  content.push({
    type: "input_text",
    text: `Original file: ${filename || "documento.pdf"}. Inventory every readable economic row on this page before deciding its role. Preserve quantity, amount and unit-rate columns separately.`
  });
  return {
    model,
    store: false,
    max_output_tokens: 2800,
    input: [
      { role: "system", content: ECONOMIC_INVENTORY_PROMPT },
      { role: "user", content }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "offertalogica_pdf_economic_row_inventory",
        strict: true,
        schema: ECONOMIC_INVENTORY_SCHEMA
      }
    }
  };
}

async function executeStructuredRequest({ request, timeoutMs, transport, apiKey, errorPrefix }) {
  const controller = new AbortController();
  let timeoutId;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error("openai_timeout"));
      }, timeoutMs);
    });
    const raw = await Promise.race([
      transport({ request, apiKey, signal: controller.signal }),
      timeoutPromise
    ]);
    const body = await transportBody(raw);
    if (body?.status === "incomplete") throw new Error(`openai_incomplete:${body?.incomplete_details?.reason || "unknown"}`);
    const outputText = responseOutputText(body);
    if (!outputText) throw new Error("openai_empty_output");
    return { body, parsed: JSON.parse(outputText) };
  } catch (error) {
    throw new Error(compact(error?.message || `${errorPrefix}_error`, 300));
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runCoreRecovery({
  imageFiles, filename, model, pageCount, timeoutMs, transport, apiKey
}) {
  try {
    const request = await buildRecoveryRequest({
      imageFiles,
      filename,
      model,
      fields: CORE_RECOVERY_FIELDS,
      prompt: CORE_RECOVERY_PROMPT,
      schemaName: "offertalogica_pdf_core_recovery",
      instruction: "Recover only annual consumption, POD/PDR, offer names and official offer codes explicitly visible on these pages."
    });
    const { body, parsed } = await executeStructuredRequest({
      request, timeoutMs, transport, apiKey, errorPrefix: "core_recovery"
    });
    if (!parsed?.document || !Array.isArray(parsed.candidates)) throw new Error("openai_invalid_core_recovery");
    const normalized = {
      ...parsed,
      quality: { native_text_quality: "none", visual_quality: "readable", table_density: "medium", ocr_recommended: true },
      page_map: imageFiles.map((item) => ({
        page: Number(item.page),
        role: "core_recovery",
        summary: "Focused supplier-neutral recovery of annual consumption, supply identifiers and offer identity."
      })),
      conflicts: [],
      review_reasons: ["Focused supplier-neutral recovery of annual consumption, supply identifiers and offer identity."]
    };
    const candidates = aiPdfToCandidates(normalized, `${model}:core-recovery`).map((candidate) => ({
      ...candidate,
      method: "openai_visual_critical_recovery",
      source_version: `${model}:core-recovery`
    }));
    return {
      status: "completed",
      model,
      response_id: compact(body?.id, 160) || null,
      candidates,
      timeout_ms: timeoutMs,
      document: normalized.document,
      quality: normalized.quality,
      page_map: normalized.page_map,
      conflicts: [],
      review_reasons: normalized.review_reasons,
      request_profile: "core-recovery"
    };
  } catch (error) {
    return {
      status: "failed",
      reason: compact(error?.message || "core_recovery_error", 300),
      model,
      timeout_ms: timeoutMs,
      candidates: []
    };
  }
}

function economicFieldForRow(row) {
  const commodity = row?.commodity === "electricity"
    ? "luce"
    : row?.commodity === "gas"
      ? "gas"
      : null;
  if (!commodity) return null;
  if (row.component_role === "sales_variable") return `prezzo_${commodity}_eur_${commodity === "luce" ? "kwh" : "smc"}`;
  if (row.component_role === "sales_fixed") return `quota_fissa_vendita_${commodity}_eur_anno`;
  return null;
}

function economicCandidateFromRow(row) {
  const field = economicFieldForRow(row);
  const value = Number(row?.unit_value_number);
  const unit = compact(row?.unit_value_unit, 60);
  if (!field || !Number.isFinite(value) || !unit) return null;

  const section = compact(row?.section_label, 180);
  const label = compact(row?.row_label, 240);
  const evidence = compact(row?.evidence, 520);
  const combinedEvidence = compact([
    section ? `Sezione: ${section}` : "",
    label ? `Riga: ${label}` : "",
    evidence
  ].filter(Boolean).join(" | "), 520);
  if (!combinedEvidence) return null;

  return {
    field,
    value_text: null,
    value_number: value,
    unit,
    commodity: row.commodity,
    page: Number(row.page || 0) || null,
    label: compact([section, label].filter(Boolean).join(" — "), 240) || null,
    evidence: combinedEvidence,
    semantic_role: row.component_role === "sales_fixed" ? "sales_component" : "actual_customer_value",
    confidence: Math.max(0, Math.min(100, Number(row.confidence || 0)))
  };
}

async function runEconomicInventoryRecovery({
  imageFiles, filename, model, pageCount, timeoutMs, transport, apiKey
}) {
  try {
    const request = await buildEconomicInventoryRequest({ imageFiles, filename, model });
    const { body, parsed } = await executeStructuredRequest({
      request, timeoutMs, transport, apiKey, errorPrefix: "economic_inventory"
    });
    if (!parsed?.document || !Array.isArray(parsed.rows) || !Array.isArray(parsed.conditions)) {
      throw new Error("openai_invalid_economic_inventory");
    }

    const rowCandidates = parsed.rows.map(economicCandidateFromRow).filter(Boolean);
    const normalized = {
      document: parsed.document,
      candidates: [...rowCandidates, ...parsed.conditions],
      quality: { native_text_quality: "none", visual_quality: "readable", table_density: "high", ocr_recommended: true },
      page_map: imageFiles.map((item) => ({
        page: Number(item.page),
        role: "economic_row_inventory",
        summary: "Supplier-neutral row-by-row transcription of pricing tables with quantity, amount and unit-rate columns kept separate."
      })),
      conflicts: [],
      review_reasons: ["Economic table rows inventoried before selecting comparable sales components."]
    };

    const allowed = new Set(ECONOMIC_OUTPUT_FIELDS);
    const candidates = aiPdfToCandidates(normalized, `${model}:economic-recovery-inventory`)
      .filter((candidate) => allowed.has(candidate.field))
      .map((candidate) => ({
        ...candidate,
        method: "openai_visual_economic_recovery",
        source_version: `${model}:economic-recovery-inventory`
      }));

    return {
      status: "completed",
      model,
      response_id: compact(body?.id, 160) || null,
      candidates,
      timeout_ms: timeoutMs,
      document: parsed.document,
      quality: normalized.quality,
      page_map: normalized.page_map,
      conflicts: [],
      review_reasons: normalized.review_reasons,
      request_profile: "economic-recovery-inventory",
      economic_rows_count: parsed.rows.length,
      economic_sales_rows_count: parsed.rows.filter((row) => ["sales_variable", "sales_fixed"].includes(row.component_role)).length,
      economic_candidate_count: candidates.length
    };
  } catch (error) {
    return {
      status: "failed",
      reason: compact(error?.message || "economic_inventory_error", 300),
      model,
      timeout_ms: timeoutMs,
      candidates: [],
      economic_rows_count: 0,
      economic_sales_rows_count: 0,
      economic_candidate_count: 0
    };
  }
}

const ECONOMIC_CANDIDATE_FIELDS = new Set(ECONOMIC_OUTPUT_FIELDS);
const ECONOMIC_PAGE_CONTEXT_PATTERN = /\b(?:prezz|corrispettiv|quota|commercializz|materia\s+energia|materia\s+prima|vendita|spesa|scontrino|dettaglio|condizioni\s+economiche|indice|pun|psv|ttf|spread|formula)\b/i;
const WEAK_ECONOMIC_PAGE_PATTERN = /\b(?:offerta|consum|fattur)\b/i;

function selectEconomicPages(results, imageFiles, maxPages = 4) {
  const scores = new Map();
  const add = (page, score) => {
    const normalized = Number(page || 0);
    if (!normalized) return;
    scores.set(normalized, Math.max(scores.get(normalized) || 0, score));
  };

  for (const result of results || []) {
    for (const candidate of result.candidates || []) {
      if (ECONOMIC_CANDIDATE_FIELDS.has(candidate.field)) add(candidate.page, 14);
      const context = `${candidate.label || ""} ${candidate.evidence || ""}`;
      if (ECONOMIC_PAGE_CONTEXT_PATTERN.test(context)) add(candidate.page, 10);
      else if (WEAK_ECONOMIC_PAGE_PATTERN.test(context)) add(candidate.page, 3);
    }
    for (const item of result.page_map || []) {
      const context = `${item.role || ""} ${item.summary || ""}`;
      if (ECONOMIC_PAGE_CONTEXT_PATTERN.test(context)) add(item.page, 9);
      else if (WEAK_ECONOMIC_PAGE_PATTERN.test(context)) add(item.page, 2);
    }
  }

  let ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]);

  const strong = ranked.filter(([, score]) => score >= 8);
  let pages = (strong.length ? strong : ranked)
    .slice(0, maxPages)
    .map(([page]) => page);

  if (!pages.length) {
    pages = (imageFiles || [])
      .map((item) => Number(item.page || 0))
      .filter(Boolean)
      .slice(0, maxPages);
  }

  const wanted = new Set(pages);
  return (imageFiles || [])
    .filter((item) => wanted.has(Number(item.page || 0)))
    .sort((a, b) => Number(a.page || 0) - Number(b.page || 0));
}

const MAX_BATCH_PAGES = 3;
const DEFAULT_BATCH_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_TIMEOUT_MS = 12_000;
const DEFAULT_EMERGENCY_TIMEOUT_MS = 10_000;

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedTimeout(value, { min = 2_000, max = 30_000, fallback = 10_000 } = {}) {
  return Math.max(min, Math.min(max, finiteNumber(value, fallback)));
}

function remainingMs(deadlineAt, reserveMs = 1_000) {
  if (!deadlineAt) return Number.POSITIVE_INFINITY;
  return Number(deadlineAt) - Date.now() - reserveMs;
}

function splitIntoBatches(imageFiles, size = MAX_BATCH_PAGES) {
  const ordered = [...(imageFiles || [])]
    .filter((item) => item?.filePath)
    .sort((left, right) => Number(left.page || 0) - Number(right.page || 0));
  const batches = [];
  for (let index = 0; index < ordered.length; index += size) {
    batches.push(ordered.slice(index, index + size));
  }
  return batches;
}

async function defaultTransport({ request, apiKey, signal }) {
  return fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal,
  });
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
      throw new Error(`openai_http_${result.status}:${text.slice(0, 240)}`);
    }
    return result.json();
  }
  return result;
}

function compact(value, maxLength = 360) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => compact(value, 500)).filter(Boolean))];
}

function candidateKey(candidate) {
  const value = candidate?.normalized_value ?? candidate?.value_number ?? candidate?.value_text ?? "";
  return [candidate?.field, candidate?.page, candidate?.semantic_role, String(value).trim().toLowerCase()].join("|");
}

function mergeCommodity(values) {
  const set = new Set(values.filter((value) => ["electricity", "gas", "dual"].includes(value)));
  if (set.has("dual") || (set.has("electricity") && set.has("gas"))) return "dual";
  if (set.has("electricity")) return "electricity";
  if (set.has("gas")) return "gas";
  return "unknown";
}

function mergeDocumentType(values) {
  const priority = ["bill", "synthetic_sheet", "cte", "combined_offer_document", "placet", "bill_guide", "bill_facsimile"];
  for (const value of priority) {
    if (values.includes(value)) return value;
  }
  return "unknown";
}

function mergeQuality(results) {
  const visualValues = results.map((result) => result.quality?.visual_quality);
  const tableValues = results.map((result) => result.quality?.table_density);
  return {
    native_text_quality: "none",
    visual_quality: visualValues.includes("good") ? "good" : visualValues.includes("readable") ? "readable" : "unknown",
    table_density: tableValues.includes("high") ? "high" : tableValues.includes("medium") ? "medium" : "low",
    ocr_recommended: true,
  };
}

function mergePageMap(results, pageCount) {
  const byPage = new Map();
  for (const result of results) {
    for (const item of result.page_map || []) {
      const page = Number(item?.page || 0);
      if (!page || page > pageCount) continue;
      const summary = compact(item.summary, 360);
      const existing = byPage.get(page);
      if (!existing || summary.length > compact(existing.summary, 360).length) {
        byPage.set(page, {
          page,
          role: compact(item.role, 100) || "unknown",
          summary: summary || "Pagina analizzata visualmente.",
        });
      }
    }
  }
  return Array.from({ length: pageCount }, (_, index) => byPage.get(index + 1) || {
    page: index + 1,
    role: "unknown",
    summary: "Pagina non restituita nella mappa visuale; verificare i candidati associati.",
  });
}

function mergeCompletedBatches(results, { model, pageCount, batchCount, failedCount, attempts, recoveredFrom = null } = {}) {
  const candidateMap = new Map();
  for (const result of results) {
    for (const candidate of result.candidates || []) {
      const key = candidateKey(candidate);
      const previous = candidateMap.get(key);
      if (!previous || Number(candidate.confidence || 0) > Number(previous.confidence || 0)) {
        candidateMap.set(key, candidate);
      }
    }
  }

  const commodityEvidence = [
    ...results.map((result) => result.document?.commodity),
    ...[...candidateMap.values()].map((candidate) => candidate.commodity),
  ];
  const documents = results.map((result) => result.document || {});
  const customerTypes = documents.map((document) => document.customer_type);
  const document = {
    document_type: mergeDocumentType(documents.map((item) => item.document_type)),
    supplier: documents.map((item) => compact(item.supplier, 120)).find(Boolean) || null,
    commodity: mergeCommodity(commodityEvidence),
    customer_type: customerTypes.includes("business") ? "business" : customerTypes.includes("consumer") ? "consumer" : "unknown",
    page_count: pageCount,
  };

  const conflictMap = new Map();
  for (const result of results) {
    for (const conflict of result.conflicts || []) {
      const key = `${conflict?.field || "unknown"}|${compact(conflict?.description, 240)}`;
      if (!conflictMap.has(key)) conflictMap.set(key, conflict);
    }
  }

  const responseIds = uniqueStrings(results.map((result) => result.response_id));
  const reviewReasons = uniqueStrings([
    ...results.flatMap((result) => result.review_reasons || []),
    `Raster letto in ${batchCount} gruppi paralleli per evitare il timeout del documento completo.`,
    failedCount ? `${failedCount} gruppo/i non hanno completato la prima lettura; sono stati mantenuti soltanto candidati con evidenza restituita.` : "",
  ]);

  return {
    status: "completed",
    model,
    response_id: responseIds.length ? responseIds.join(",").slice(0, 300) : null,
    candidates: [...candidateMap.values()],
    timeout_ms: Math.max(...results.map((result) => Number(result.timeout_ms || 0)), 0) || null,
    document,
    quality: mergeQuality(results),
    page_map: mergePageMap(results, pageCount),
    conflicts: [...conflictMap.values()],
    review_reasons: reviewReasons,
    request_profile: failedCount ? "batched_visual_partial" : "batched_visual_full",
    attempts,
    recovered_from: recoveredFrom,
    batch_count: batchCount,
    completed_batches: results.length,
    failed_batches: failedCount,
    reader_version: PDF_AI_RASTER_BATCH_VERSION,
  };
}

async function runRequest({
  imageFiles,
  filename,
  legacyNormalized,
  parserCandidates,
  model,
  profile,
  timeoutMs,
  transport,
  apiKey,
  lowDetail = false,
} = {}) {
  const request = await buildPdfAiImageRequest({
    imageFiles,
    filename,
    parserVersion: legacyNormalized?.parser_version,
    parserCandidates,
    pageCount: legacyNormalized?.page_count,
    diagnostics: legacyNormalized?.diagnostics,
    model,
    profile,
  });

  if (lowDetail) {
    request.max_output_tokens = Math.min(Number(request.max_output_tokens || 2_600), 2_600);
    for (const item of request.input || []) {
      for (const content of item?.content || []) {
        if (content?.type === "input_image") content.detail = "low";
      }
    }
  }

  const controller = new AbortController();
  let timeoutId;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error("openai_timeout"));
      }, timeoutMs);
    });
    const raw = await Promise.race([
      transport({ request, apiKey, signal: controller.signal }),
      timeoutPromise,
    ]);
    const body = await transportBody(raw);
    if (body?.status === "incomplete") throw new Error(`openai_incomplete:${body?.incomplete_details?.reason || "unknown"}`);
    const outputText = responseOutputText(body);
    if (!outputText) throw new Error("openai_empty_output");
    const parsed = JSON.parse(outputText);
    if (!parsed?.document || !Array.isArray(parsed?.candidates)) throw new Error("openai_invalid_output_object");
    if (profile !== "emergency") {
      for (const field of ["quality", "page_map", "conflicts", "review_reasons"]) {
        if (field === "quality" ? !parsed[field] : !Array.isArray(parsed[field])) throw new Error(`openai_invalid_${field}`);
      }
    }
    const normalizedParsed = profile === "emergency"
      ? {
        ...parsed,
        quality: { native_text_quality: "none", visual_quality: "readable", table_density: "low", ocr_recommended: true },
        page_map: [{ page: 1, role: "summary", summary: "Lettura visuale di emergenza della prima pagina." }],
        conflicts: [],
        review_reasons: ["Lettura di emergenza eseguita dopo il mancato completamento dei gruppi visuali."],
      }
      : parsed;
    return {
      status: "completed",
      model,
      response_id: compact(body?.id, 160) || null,
      candidates: aiPdfToCandidates(normalizedParsed, model),
      timeout_ms: timeoutMs,
      document: normalizedParsed.document,
      quality: normalizedParsed.quality,
      page_map: normalizedParsed.page_map,
      conflicts: normalizedParsed.conflicts,
      review_reasons: normalizedParsed.review_reasons,
      request_profile: profile,
    };
  } catch (error) {
    return {
      status: "failed",
      reason: compact(error?.message || "openai_error", 300),
      model,
      timeout_ms: timeoutMs,
      candidates: [],
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runPdfAiFallbackImages(options = {}) {
  const env = options.env || process.env;
  const model = env.PDF_AI_MODEL || options.model || PDF_AI_PRIMARY_MODEL;
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  const transport = options.transport || defaultTransport;
  const imageFiles = options.imageFiles || [];

  if (pdfAiMode(env) !== "fallback") return { status: "disabled", model: null, candidates: [] };
  if (!apiKey) return { status: "unavailable", reason: "missing_openai_api_key", model, candidates: [] };

  const batches = splitIntoBatches(imageFiles);
  if (!batches.length) return { status: "failed", reason: "image_files_required", model, candidates: [] };

  const initialBudget = remainingMs(options.deadlineAt, 5_000);
  const batchTimeoutMs = Math.min(
    boundedTimeout(env.PDF_AI_BATCH_TIMEOUT_MS, { max: 34_000, fallback: DEFAULT_BATCH_TIMEOUT_MS }),
    initialBudget,
  );
  if (!Number.isFinite(batchTimeoutMs) || batchTimeoutMs < 5_000) {
    return { status: "skipped", reason: "insufficient_time_budget", model, timeout_ms: batchTimeoutMs, candidates: [] };
  }

  const initialResults = await Promise.all(batches.map((batch) => runRequest({
    imageFiles: batch,
    filename: options.filename,
    legacyNormalized: options.legacyNormalized || {},
    parserCandidates: options.parserCandidates || [],
    model,
    profile: "full",
    timeoutMs: batchTimeoutMs,
    transport,
    apiKey,
  })));

  const completed = initialResults.filter((result) => result.status === "completed");
  const failedIndexes = initialResults
    .map((result, index) => result.status === "completed" ? -1 : index)
    .filter((index) => index >= 0);
  let attempts = batches.length;
  let recoveredFrom = null;

  if (failedIndexes.length) {
    const retryBudget = remainingMs(options.deadlineAt, 1_500);
    const retryTimeoutMs = Math.min(
      boundedTimeout(env.PDF_AI_BATCH_RETRY_TIMEOUT_MS, { max: 14_000, fallback: DEFAULT_RETRY_TIMEOUT_MS }),
      retryBudget,
    );
    if (Number.isFinite(retryTimeoutMs) && retryTimeoutMs >= 5_000) {
      const retries = await Promise.all(failedIndexes.map((index) => runRequest({
        imageFiles: batches[index],
        filename: options.filename,
        legacyNormalized: options.legacyNormalized || {},
        parserCandidates: options.parserCandidates || [],
        model,
        profile: "full",
        timeoutMs: retryTimeoutMs,
        transport,
        apiKey,
        lowDetail: true,
      })));
      attempts += retries.length;
      for (const retry of retries) {
        if (retry.status === "completed") completed.push(retry);
      }
      if (retries.some((retry) => retry.status === "completed")) recoveredFrom = "batched_retry_low_detail";
    }
  }

  let focusedRecoveryAttempted = false;
  let focusedRecoveryCompleted = 0;
  const focusedRecoveryFailures = [];
  let economicRecoveryAttempted = false;
  let economicRecoveryCompleted = 0;
  let economicRecoveryRows = 0;
  let economicRecoverySalesRows = 0;
  let economicRecoveryCandidates = 0;
  const economicRecoveryFailures = [];

  const focusedBudget = remainingMs(options.deadlineAt, 1_500);
  const focusedTimeoutMs = Math.min(18_000, focusedBudget);
  if (completed.length && Number.isFinite(focusedTimeoutMs) && focusedTimeoutMs >= 7_000) {
    focusedRecoveryAttempted = true;
    const economicPages = selectEconomicPages(completed, imageFiles);
    economicRecoveryAttempted = economicPages.length > 0;

    const coreTasks = batches.map((batch, index) => ({
      kind: "core",
      position: index + 1,
      promise: runCoreRecovery({
        imageFiles: batch,
        filename: options.filename,
        model,
        pageCount: Math.max(Number(options.legacyNormalized?.page_count || 0), imageFiles.length),
        timeoutMs: focusedTimeoutMs,
        transport,
        apiKey
      })
    }));
    const economicTasks = economicPages.map((page) => ({
      kind: "economic",
      position: Number(page.page || 0),
      promise: runEconomicInventoryRecovery({
        imageFiles: [page],
        filename: options.filename,
        model,
        pageCount: Math.max(Number(options.legacyNormalized?.page_count || 0), imageFiles.length),
        timeoutMs: focusedTimeoutMs,
        transport,
        apiKey
      })
    }));

    const tasks = [...coreTasks, ...economicTasks];
    const focusedResults = await Promise.all(tasks.map((task) => task.promise));
    attempts += focusedResults.length;

    for (const [index, result] of focusedResults.entries()) {
      const task = tasks[index];
      if (result.status === "completed") {
        completed.push(result);
        if (task.kind === "economic") {
          economicRecoveryCompleted += 1;
          economicRecoveryRows += Number(result.economic_rows_count || 0);
          economicRecoverySalesRows += Number(result.economic_sales_rows_count || 0);
          economicRecoveryCandidates += Number(result.economic_candidate_count || 0);
        } else focusedRecoveryCompleted += 1;
      } else if (task.kind === "economic") {
        economicRecoveryFailures.push({
          page: task.position,
          reason: compact(result.reason || "economic_recovery_failed", 180),
        });
      } else {
        focusedRecoveryFailures.push({
          batch: task.position,
          reason: compact(result.reason || "core_recovery_failed", 180),
        });
      }
    }
  }

  if (completed.length) {
    const failedCount = Math.max(0, batches.length - initialResults.filter((result) => result.status === "completed").length);
    const merged = mergeCompletedBatches(completed, {
      model,
      pageCount: Math.max(Number(options.legacyNormalized?.page_count || 0), imageFiles.length),
      batchCount: batches.length,
      failedCount,
      attempts,
      recoveredFrom,
    });
    const hasFocused = focusedRecoveryCompleted || economicRecoveryCompleted;
    return {
      ...merged,
      request_profile: hasFocused
        ? (failedCount ? "batched_visual_partial_plus_core_and_economic_row_inventory" : "batched_visual_full_plus_core_and_economic_row_inventory")
        : merged.request_profile,
      focused_recovery_attempted: focusedRecoveryAttempted,
      focused_recovery_completed: focusedRecoveryCompleted,
      focused_recovery_failures: focusedRecoveryFailures,
      economic_recovery_attempted: economicRecoveryAttempted,
      economic_recovery_completed: economicRecoveryCompleted,
      economic_recovery_rows: economicRecoveryRows,
      economic_recovery_sales_rows: economicRecoverySalesRows,
      economic_recovery_candidates: economicRecoveryCandidates,
      economic_recovery_failures: economicRecoveryFailures,
    };
  }

  const emergencyBudget = remainingMs(options.deadlineAt, 1_000);
  const emergencyTimeoutMs = Math.min(
    boundedTimeout(env.PDF_AI_EMERGENCY_TIMEOUT_MS, { max: 12_000, fallback: DEFAULT_EMERGENCY_TIMEOUT_MS }),
    emergencyBudget,
  );
  if (!Number.isFinite(emergencyTimeoutMs) || emergencyTimeoutMs < 5_000) {
    return {
      status: "failed",
      reason: initialResults.map((result) => result.reason).find(Boolean) || "batched_visual_failed",
      model,
      candidates: [],
      attempts,
      recovery_attempted: false,
      recovery_reason: "insufficient_time_budget",
      reader_version: PDF_AI_RASTER_BATCH_VERSION,
    };
  }

  const firstPage = splitIntoBatches(imageFiles, 1)[0];
  const emergency = await runRequest({
    imageFiles: firstPage,
    filename: options.filename,
    legacyNormalized: options.legacyNormalized || {},
    parserCandidates: [],
    model,
    profile: "emergency",
    timeoutMs: emergencyTimeoutMs,
    transport,
    apiKey,
    lowDetail: true,
  });
  attempts += 1;
  if (emergency.status === "completed") {
    return {
      ...emergency,
      attempts,
      recovered_from: "batched_visual_timeout",
      recovery_timeout_ms: emergency.timeout_ms,
      request_profile: "emergency",
      reader_version: PDF_AI_RASTER_BATCH_VERSION,
    };
  }

  return {
    status: "failed",
    reason: emergency.reason || initialResults.map((result) => result.reason).find(Boolean) || "batched_visual_failed",
    model,
    candidates: [],
    attempts,
    recovery_attempted: true,
    recovery_reason: emergency.reason || "emergency_recovery_failed",
    recovery_timeout_ms: emergency.timeout_ms || emergencyTimeoutMs,
    reader_version: PDF_AI_RASTER_BATCH_VERSION,
  };
}
