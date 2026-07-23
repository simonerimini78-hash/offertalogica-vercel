import fs from "node:fs/promises";
import { aiPdfToCandidates, pdfFieldNames } from "./pdfReaderContract.js";

export const PDF_AI_ADAPTER_VERSION = "2.5.1-consolidated-complete";
export const PDF_AI_PRIMARY_MODEL = "gpt-4.1-mini-2025-04-14";

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["document", "quality", "page_map", "candidates", "conflicts", "review_reasons"],
  properties: {
    document: {
      type: "object",
      additionalProperties: false,
      required: ["document_type", "supplier", "commodity", "customer_type", "page_count"],
      properties: {
        document_type: { type: "string", enum: ["bill", "bill_guide", "bill_facsimile", "synthetic_sheet", "cte", "combined_offer_document", "placet", "unknown"] },
        supplier: { type: ["string", "null"] },
        commodity: { type: "string", enum: ["electricity", "gas", "dual", "unknown"] },
        customer_type: { type: "string", enum: ["consumer", "business", "unknown"] },
        page_count: { type: ["integer", "null"] },
      },
    },
    quality: {
      type: "object",
      additionalProperties: false,
      required: ["native_text_quality", "visual_quality", "table_density", "ocr_recommended"],
      properties: {
        native_text_quality: { type: "string", enum: ["good", "partial", "poor", "none", "unknown"] },
        visual_quality: { type: "string", enum: ["good", "readable", "poor", "unknown"] },
        table_density: { type: "string", enum: ["low", "medium", "high"] },
        ocr_recommended: { type: "boolean" },
      },
    },
    page_map: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["page", "role", "summary"],
        properties: {
          page: { type: "integer", minimum: 1 },
          role: { type: "string" },
          summary: { type: "string" },
        },
      },
    },
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "value_text", "value_number", "unit", "commodity", "page", "label", "evidence", "semantic_role", "confidence", "agrees_with", "contradicts"],
        properties: {
          field: { type: "string" },
          value_text: { type: ["string", "null"] },
          value_number: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
          commodity: { type: "string", enum: ["electricity", "gas", "dual", "not_applicable", "unknown"] },
          page: { type: ["integer", "null"] },
          label: { type: ["string", "null"] },
          evidence: { type: "string", maxLength: 360 },
          semantic_role: { type: "string", enum: ["actual_customer_value", "expected_or_estimated_customer_value", "offer_value", "billing_period", "contract_period", "threshold", "example", "discount", "penalty", "network_component", "sales_component", "tax", "identifier", "classification", "unknown"] },
          confidence: { type: "integer", minimum: 0, maximum: 100 },
          agrees_with: { type: "array", items: { type: "string", enum: ["parser", "ocr"] } },
          contradicts: { type: "array", items: { type: "string", enum: ["parser", "ocr"] } },
        },
      },
    },
    conflicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "description", "pages", "critical"],
        properties: {
          field: { type: "string" },
          description: { type: "string" },
          pages: { type: "array", items: { type: "integer" } },
          critical: { type: "boolean" },
        },
      },
    },
    review_reasons: { type: "array", items: { type: "string" } },
  },
};

const SYSTEM_PROMPT = `You are the visual-semantic PDF reader inside OffertaLogica. Read Italian electricity and gas bills and offer documents.

Return evidence-grounded candidates only. You are not the final decision-maker.
- Extract only values explicitly present in the original PDF.
- Never guess, calculate, sum, average, annualize or convert a value.
- Keep electricity and gas values separate, including in dual documents.
- For each candidate return page, nearby label, short literal evidence, unit, commodity and semantic role.
- Distinguish actual customer values from estimates, examples, thresholds, discounts, taxes, network charges and offer values.
- Parser hints are untrusted. Agree or contradict them only when the PDF visually supports it.
- Use only requested OffertaLogica field names. If evidence is absent, return no candidate.
- Annual consumption is valid only with an explicit annual/12-month label and the correct kWh or Smc unit.
- For sale prices, accept only an explicit sales/material/energy-supply unit row. Exclude average price, total unit cost, network, transport, distribution, taxes and power rows.
- For fixed sales fees, accept only an explicit commercialisation/fixed-sales row with a printed monthly or annual unit. Never infer a rate by division.
- Return JSON matching the supplied schema and no prose.`;

function boundedTimeout(value) {
  const parsed = Number(value || 20_000);
  return Math.max(4_000, Math.min(22_000, Number.isFinite(parsed) ? parsed : 20_000));
}

function candidateHint(candidate) {
  return {
    field: candidate.field,
    normalized_value: candidate.normalized_value,
    unit: candidate.normalized_unit,
    page: candidate.page,
    evidence: candidate.evidence,
    semantic_role: candidate.semantic_role,
    confidence: candidate.confidence,
  };
}

export function pdfAiMode(env = process.env) {
  const mode = String(env?.PDF_AI_MODE || "off").trim().toLowerCase();
  if (mode === "fallback") return "shadow";
  return mode === "shadow" ? "shadow" : "off";
}

function highCoveragePdf({ pageCount = 0, diagnostics = [] } = {}) {
  const denseEvidence = diagnostics.some((item) => String(item?.source_snippet || "").length >= 280);
  return Number(pageCount || 0) >= 6 || denseEvidence;
}

export async function buildPdfAiRequest({ filePath, filename = "documento.pdf", parserVersion = "unknown", parserCandidates = [], pageCount = 0, diagnostics = [], model = PDF_AI_PRIMARY_MODEL } = {}) {
  if (!filePath) throw new Error("filePath_required");
  const bytes = await fs.readFile(filePath);
  const highCoverage = highCoveragePdf({ pageCount, diagnostics });
  const context = {
    parser_version: parserVersion,
    requested_fields: pdfFieldNames(),
    parser_candidates: parserCandidates.map(candidateHint),
  };
  return {
    model,
    store: false,
    background: false,
    max_output_tokens: highCoverage ? 6_500 : 4_200,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "input_file", filename, file_data: `data:application/pdf;base64,${bytes.toString("base64")}` },
          { type: "input_text", text: `Analyze the PDF using these untrusted parser hints:\n${JSON.stringify(context)}` },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "offertalogica_pdf_shadow_candidates",
        strict: true,
        schema: OUTPUT_SCHEMA,
      },
    },
  };
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

function validateAiOutput(parsed) {
  if (!parsed || typeof parsed !== "object") throw new Error("openai_invalid_output_object");
  if (!parsed.document || !parsed.quality) throw new Error("openai_missing_document_metadata");
  for (const field of ["page_map", "candidates", "conflicts", "review_reasons"]) {
    if (!Array.isArray(parsed[field])) throw new Error(`openai_invalid_${field}`);
  }
  return parsed;
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


const ECONOMIC_CONDITION_FIELDS = Object.freeze([
  "tipo_prezzo_luce", "tipo_prezzo_gas",
  "indice_riferimento_luce", "indice_riferimento_gas",
  "spread_luce_eur_kwh", "spread_gas_eur_smc",
  "formula_prezzo_luce", "formula_prezzo_gas",
  "periodicita_aggiornamento_indice_luce", "periodicita_aggiornamento_indice_gas",
]);

const ECONOMIC_INVENTORY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["document", "rows", "conditions"],
  properties: {
    document: {
      type: "object",
      additionalProperties: false,
      required: ["document_type", "commodity", "customer_type", "page_count"],
      properties: {
        document_type: { type: "string", enum: ["bill", "synthetic_sheet", "cte", "combined_offer_document", "placet", "unknown"] },
        commodity: { type: "string", enum: ["electricity", "gas", "dual", "unknown"] },
        customer_type: { type: "string", enum: ["consumer", "business", "unknown"] },
        page_count: { type: ["integer", "null"] },
      },
    },
    rows: {
      type: "array",
      maxItems: 28,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["page", "commodity", "section_label", "row_label", "quantity_number", "quantity_unit", "unit_value_number", "unit_value_unit", "amount_number", "amount_unit", "component_role", "evidence", "confidence"],
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
          component_role: { type: "string", enum: ["sales_variable", "sales_fixed", "network_variable", "network_fixed", "power", "tax", "average_or_total", "consumption", "discount_or_adjustment", "other"] },
          evidence: { type: "string", maxLength: 520 },
          confidence: { type: "integer", minimum: 0, maximum: 100 },
        },
      },
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
          confidence: { type: "integer", minimum: 0, maximum: 100 },
        },
      },
    },
  },
};

const ECONOMIC_INVENTORY_PROMPT = `You are the second and final economic-table pass for difficult Italian electricity and gas PDFs.
Transcribe visible rows before selecting values. Work for any supplier.

For each readable economic row, copy literally:
- section and row labels;
- quantity and quantity unit;
- printed unit value and its unit;
- monetary amount and its unit;
- page and short literal evidence.

Classify rows strictly:
- sales_variable: only the commodity sales/material/energy-supply row;
- sales_fixed: only a fixed sales/commercialisation row;
- network_variable/network_fixed: network, transport, distribution, meter or system charges;
- power: committed/available power charges;
- average_or_total: average price, total unit cost, parent total or aggregate quota;
- consumption: consumption-only rows;
- tax: taxes, excise or VAT;
- discount_or_adjustment: rebates or adjustments;
- other: uncertain.

Never calculate a rate by division. Never annualize. Never place a total amount in unit_value_number.
Preserve decimal digits exactly. If parent rows have indented "di cui" children, transcribe them separately.
Only sales_variable and sales_fixed rows can become comparable price candidates later.
Return JSON only.`;

function remainingBudget(deadlineAt, reserveMs = 1_000) {
  if (!deadlineAt) return Infinity;
  return Number(deadlineAt) - Date.now() - reserveMs;
}

async function executeStructuredRequest({ request, timeoutMs, transport, apiKey }) {
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
    return { body, parsed: JSON.parse(outputText) };
  } finally {
    clearTimeout(timeoutId);
  }
}

function economicCommodityFields(legacyNormalized = {}, document = {}) {
  const commodity = String(legacyNormalized.commodity || document.commodity || "unknown").toLowerCase();
  if (["luce", "electricity"].includes(commodity)) return ["luce"];
  if (commodity === "gas") return ["gas"];
  return ["luce", "gas"];
}

const PRELIMINARY_SALES_PATTERN = /\b(?:spesa\s+per\s+la\s+vendita|vendita\s+(?:di\s+)?(?:energia\s+elettrica|gas\s+naturale)|materia\s+energia|materia\s+prima\s+gas|componente\s+energia|corrispettivo\s+energia)\b/i;
const PRELIMINARY_FIXED_PATTERN = /\b(?:quota\s+fissa|commercializzazione|ccv|pcv|pfix)\b/i;
const PRELIMINARY_EXCLUDED_PATTERN = /\b(?:prezzo\s+medio|costo\s+medio|spesa\s+media|totale|rete|oneri|trasporto|distribuzione|contatore|potenza|imposte?|accise|iva)\b/i;
const PRELIMINARY_PRICE_UNIT_PATTERN = /(?:€|eur)\s*\/?\s*(?:kwh|smc)/i;
const PRELIMINARY_FIXED_UNIT_PATTERN = /(?:€|eur)\s*\/?\s*(?:pod|pdr)?\s*\/?\s*(?:mese|month|anno|year)/i;

function hasUsableEconomicCandidate(candidates, field) {
  return candidates.some((candidate) => {
    if (candidate.field !== field || candidate.normalized_value === null || candidate.normalized_value === undefined || candidate.normalized_value === "") return false;
    const context = `${candidate.label || ""} ${candidate.evidence || ""}`;
    const unit = String(candidate.normalized_unit || candidate.unit || "");
    if (PRELIMINARY_EXCLUDED_PATTERN.test(context)) return false;
    if (["prezzo_luce_eur_kwh", "prezzo_gas_eur_smc"].includes(field)) {
      return candidate.semantic_role === "sales_component"
        && PRELIMINARY_SALES_PATTERN.test(context)
        && PRELIMINARY_PRICE_UNIT_PATTERN.test(unit);
    }
    if (["quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno"].includes(field)) {
      return candidate.semantic_role === "sales_component"
        && PRELIMINARY_FIXED_PATTERN.test(context)
        && PRELIMINARY_FIXED_UNIT_PATTERN.test(unit);
    }
    return true;
  });
}

function needsEconomicPass(legacyNormalized, candidates, document) {
  return economicCommodityFields(legacyNormalized, document).some((suffix) => {
    const price = `prezzo_${suffix}_eur_${suffix === "luce" ? "kwh" : "smc"}`;
    const fixed = `quota_fissa_vendita_${suffix}_eur_anno`;
    const priceMissing = (legacyNormalized?.[price] === null || legacyNormalized?.[price] === undefined || legacyNormalized?.[price] === "")
      && !hasUsableEconomicCandidate(candidates, price);
    const fixedMissing = (legacyNormalized?.[fixed] === null || legacyNormalized?.[fixed] === undefined || legacyNormalized?.[fixed] === "")
      && !hasUsableEconomicCandidate(candidates, fixed);
    return priceMissing || fixedMissing;
  });
}

async function buildEconomicPdfRequest({ filePath, filename, model }) {
  const bytes = await fs.readFile(filePath);
  return {
    model,
    store: false,
    background: false,
    max_output_tokens: 5_200,
    input: [
      { role: "system", content: ECONOMIC_INVENTORY_PROMPT },
      {
        role: "user",
        content: [
          { type: "input_file", filename, file_data: `data:application/pdf;base64,${bytes.toString("base64")}` },
          { type: "input_text", text: "Inventory only the explicit economic rows and conditions. Do not infer missing numbers." },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "offertalogica_pdf_economic_row_inventory",
        strict: true,
        schema: ECONOMIC_INVENTORY_SCHEMA,
      },
    },
  };
}

function economicRawCandidate(row) {
  if (!row || !["electricity", "gas"].includes(row.commodity)) return null;
  const suffix = row.commodity === "electricity" ? "luce" : "gas";
  let field = null;
  if (row.component_role === "sales_variable") field = `prezzo_${suffix}_eur_${suffix === "luce" ? "kwh" : "smc"}`;
  if (row.component_role === "sales_fixed") field = `quota_fissa_vendita_${suffix}_eur_anno`;
  if (!field || !Number.isFinite(Number(row.unit_value_number)) || !String(row.unit_value_unit || "").trim()) return null;
  const label = [row.section_label, row.row_label].filter(Boolean).join(" — ") || null;
  return {
    field,
    value_text: null,
    value_number: Number(row.unit_value_number),
    unit: row.unit_value_unit,
    commodity: row.commodity,
    page: row.page,
    label,
    evidence: row.evidence,
    semantic_role: "sales_component",
    confidence: row.confidence,
    agrees_with: [],
    contradicts: [],
  };
}

function normalizeEconomicOutput(parsed, model) {
  if (!parsed?.document || !Array.isArray(parsed.rows) || !Array.isArray(parsed.conditions)) {
    throw new Error("openai_invalid_economic_inventory");
  }
  const rawCandidates = [
    ...parsed.rows.map(economicRawCandidate).filter(Boolean),
    ...parsed.conditions.map((candidate) => ({ ...candidate, agrees_with: [], contradicts: [] })),
  ];
  return {
    document: parsed.document,
    candidates: aiPdfToCandidates({ document: parsed.document, candidates: rawCandidates }, `${model}:economic-recovery-inventory`).map((candidate) => ({
      ...candidate,
      method: "openai_visual_economic_recovery",
      source_version: `${model}:economic-recovery-inventory`,
    })),
    row_count: parsed.rows.length,
    sales_row_count: parsed.rows.filter((row) => ["sales_variable", "sales_fixed"].includes(row.component_role)).length,
  };
}

function uniqueCandidates(candidates) {
  const map = new Map();
  for (const candidate of candidates) {
    const key = [candidate.field, candidate.page, candidate.semantic_role, candidate.normalized_value, candidate.normalized_unit].join("|");
    const previous = map.get(key);
    if (!previous || Number(candidate.confidence || 0) > Number(previous.confidence || 0)) map.set(key, candidate);
  }
  return [...map.values()];
}

async function runGeneralPdfPass({ filePath, filename, legacyNormalized, parserCandidates, model, timeoutMs, transport, apiKey }) {
  const request = await buildPdfAiRequest({
    filePath,
    filename,
    parserVersion: legacyNormalized.parser_version,
    parserCandidates,
    pageCount: legacyNormalized.page_count,
    diagnostics: legacyNormalized.diagnostics,
    model,
  });
  const { body, parsed } = await executeStructuredRequest({ request, timeoutMs, transport, apiKey });
  const validated = validateAiOutput(parsed);
  return {
    body,
    parsed: validated,
    candidates: aiPdfToCandidates(validated, `${model}:consolidated-general`).map((candidate) => ({
      ...candidate,
      method: "openai_visual_consolidated",
      source_version: `${model}:consolidated-general`,
    })),
  };
}

export async function runPdfAiFallback({
  filePath,
  filename = "documento.pdf",
  legacyNormalized = {},
  parserCandidates = [],
  deadlineAt = null,
  env = process.env,
  transport = defaultTransport,
  apiKey = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  model = env.PDF_AI_MODEL || process.env.PDF_AI_MODEL || PDF_AI_PRIMARY_MODEL,
} = {}) {
  const mode = pdfAiMode(env);
  if (mode !== "shadow") return { status: "disabled", model: null, candidates: [] };
  if (!apiKey) return { status: "unavailable", reason: "missing_openai_api_key", model, candidates: [] };
  if (!filePath) return { status: "failed", reason: "filePath_required", model, candidates: [] };

  const configuredTimeout = boundedTimeout(env.PDF_AI_TIMEOUT_MS);
  const initialRemaining = remainingBudget(deadlineAt);
  if (Number.isFinite(initialRemaining) && initialRemaining < 6_000) {
    return { status: "skipped", reason: "insufficient_time_budget", model, candidates: [] };
  }
  const generalTimeout = Math.max(4_000, Math.min(configuredTimeout, Number.isFinite(initialRemaining) ? initialRemaining - 1_000 : configuredTimeout));
  const startedAt = Date.now();

  try {
    const general = await runGeneralPdfPass({ filePath, filename, legacyNormalized, parserCandidates, model, timeoutMs: generalTimeout, transport, apiKey });
    let candidates = general.candidates;
    let attempts = 1;
    let economicRecoveryAttempted = false;
    let economicRecoveryCompleted = 0;
    let economicRecoveryRows = 0;
    let economicRecoverySalesRows = 0;
    let economicRecoveryCandidates = 0;
    const economicRecoveryFailures = [];

    const remaining = remainingBudget(deadlineAt);
    if (needsEconomicPass(legacyNormalized, candidates, general.parsed.document) && (!Number.isFinite(remaining) || remaining >= 6_000)) {
      economicRecoveryAttempted = true;
      attempts += 1;
      const economicTimeout = Math.max(4_000, Math.min(12_000, Number.isFinite(remaining) ? remaining - 1_000 : 12_000));
      try {
        const request = await buildEconomicPdfRequest({ filePath, filename, model });
        const { parsed } = await executeStructuredRequest({ request, timeoutMs: economicTimeout, transport, apiKey });
        const economic = normalizeEconomicOutput(parsed, model);
        candidates = uniqueCandidates([...candidates, ...economic.candidates]);
        economicRecoveryCompleted = 1;
        economicRecoveryRows = economic.row_count;
        economicRecoverySalesRows = economic.sales_row_count;
        economicRecoveryCandidates = economic.candidates.length;
      } catch (error) {
        economicRecoveryFailures.push({ reason: String(error?.message || "economic_inventory_error").slice(0, 180) });
      }
    }

    return {
      status: "completed",
      model,
      response_id: String(general.body?.id || "").slice(0, 160) || null,
      candidates,
      document: general.parsed.document,
      quality: general.parsed.quality,
      page_map: general.parsed.page_map,
      conflicts: general.parsed.conflicts,
      review_reasons: general.parsed.review_reasons,
      timeout_ms: configuredTimeout,
      attempts,
      request_profile: economicRecoveryAttempted ? "general_plus_economic_row_inventory" : "general",
      reader_version: PDF_AI_ADAPTER_VERSION,
      economic_recovery_attempted: economicRecoveryAttempted,
      economic_recovery_completed: economicRecoveryCompleted,
      economic_recovery_rows: economicRecoveryRows,
      economic_recovery_sales_rows: economicRecoverySalesRows,
      economic_recovery_candidates: economicRecoveryCandidates,
      economic_recovery_failures: economicRecoveryFailures,
      elapsed_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      status: "failed",
      reason: String(error?.message || "openai_error").slice(0, 300),
      model,
      candidates: [],
      attempts: 1,
      reader_version: PDF_AI_ADAPTER_VERSION,
      elapsed_ms: Date.now() - startedAt,
    };
  }
}

export async function runPdfAiShadow(options = {}) {
  return runPdfAiFallback(options);
}
