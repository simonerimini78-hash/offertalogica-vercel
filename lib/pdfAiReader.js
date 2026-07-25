import fs from "node:fs/promises";
import {
  PDF_AI_CRITICAL_MODEL,
  PDF_AI_PRIMARY_MODEL,
  pdfAiConfig,
} from "./pdfAiConfig.js";
import { aiPdfToCandidates, pdfFieldNames } from "./pdfReaderContract.js";

export const PDF_AI_ADAPTER_VERSION = "step8-clean-reader-v5-2-exact-general-page-map";
export { PDF_AI_PRIMARY_MODEL };
export const PDF_AI_ESCALATION_MODEL = PDF_AI_CRITICAL_MODEL;

const CANDIDATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "field", "value_text", "value_number", "unit", "commodity", "page", "label",
    "evidence", "semantic_role", "confidence", "agrees_with", "contradicts",
  ],
  properties: {
    field: { type: "string" },
    value_text: { type: ["string", "null"] },
    value_number: { type: ["number", "null"] },
    unit: { type: ["string", "null"] },
    commodity: {
      type: "string",
      enum: ["electricity", "gas", "dual", "not_applicable", "unknown"],
    },
    page: { type: ["integer", "null"] },
    label: { type: ["string", "null"] },
    evidence: { type: "string", maxLength: 360 },
    semantic_role: {
      type: "string",
      enum: [
        "actual_customer_value", "expected_or_estimated_customer_value", "offer_value",
        "billing_period", "contract_period", "threshold", "example", "discount",
        "penalty", "network_component", "sales_component", "tax", "identifier",
        "classification", "unknown",
      ],
    },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    agrees_with: {
      type: "array",
      items: { type: "string", enum: ["parser", "ocr"] },
    },
    contradicts: {
      type: "array",
      items: { type: "string", enum: ["parser", "ocr"] },
    },
  },
};


const CONSUMPTION_OBSERVATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["commodity", "page", "label", "value_number", "unit", "period_role", "evidence", "confidence"],
  properties: {
    commodity: { type: "string", enum: ["electricity", "gas", "unknown"] },
    page: { type: ["integer", "null"] },
    label: { type: ["string", "null"], maxLength: 220 },
    value_number: { type: ["number", "null"] },
    unit: { type: ["string", "null"], maxLength: 60 },
    period_role: { type: "string", enum: ["annual", "billing_period", "monthly", "meter_reading", "other", "unknown"] },
    evidence: { type: "string", maxLength: 420 },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
  },
};

const ECONOMIC_ROW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "commodity", "page", "section_label", "row_label", "row_relation",
    "quantity_number", "quantity_unit", "amount_number", "amount_unit",
    "unit_rate_number", "unit_rate_unit", "period_unit", "component_role",
    "price_basis", "validity_role", "formula_text", "index_reference",
    "evidence", "confidence",
  ],
  properties: {
    commodity: { type: "string", enum: ["electricity", "gas", "unknown"] },
    page: { type: ["integer", "null"] },
    section_label: { type: ["string", "null"], maxLength: 180 },
    row_label: { type: ["string", "null"], maxLength: 240 },
    row_relation: { type: "string", enum: ["parent", "child", "standalone", "unknown"] },
    quantity_number: { type: ["number", "null"] },
    quantity_unit: { type: ["string", "null"], maxLength: 60 },
    amount_number: { type: ["number", "null"] },
    amount_unit: { type: ["string", "null"], maxLength: 60 },
    unit_rate_number: { type: ["number", "null"] },
    unit_rate_unit: { type: ["string", "null"], maxLength: 60 },
    period_unit: { type: "string", enum: ["month", "year", "none", "unknown"] },
    component_role: {
      type: "string",
      enum: [
        "sales_variable", "sales_fixed", "network_variable", "network_fixed",
        "power", "tax", "average_or_total", "consumption", "discount_or_adjustment",
        "other", "unknown",
      ],
    },
    price_basis: {
      type: "string",
      enum: [
        "total_unit_price", "spread", "index_value", "fixed_charge",
        "single_component", "average_or_total", "not_applicable", "unknown",
      ],
    },
    validity_role: {
      type: "string",
      enum: ["current_contract", "future_or_renewal", "expired", "unclear"],
    },
    formula_text: { type: ["string", "null"], maxLength: 220 },
    index_reference: { type: ["string", "null"], maxLength: 100 },
    evidence: { type: "string", maxLength: 520 },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
  },
};

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
        document_type: {
          type: "string",
          enum: [
            "bill", "bill_guide", "bill_facsimile", "synthetic_sheet", "cte",
            "combined_offer_document", "placet", "unknown",
          ],
        },
        supplier: { type: ["string", "null"] },
        commodity: {
          type: "string",
          enum: ["electricity", "gas", "dual", "unknown"],
        },
        customer_type: {
          type: "string",
          enum: ["consumer", "business", "unknown"],
        },
        page_count: { type: ["integer", "null"] },
      },
    },
    quality: {
      type: "object",
      additionalProperties: false,
      required: ["native_text_quality", "visual_quality", "table_density", "ocr_recommended"],
      properties: {
        native_text_quality: {
          type: "string",
          enum: ["good", "partial", "poor", "none", "unknown"],
        },
        visual_quality: {
          type: "string",
          enum: ["good", "readable", "poor", "unknown"],
        },
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
    candidates: { type: "array", items: CANDIDATE_SCHEMA },
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

const GENERAL_PAGE_MAP_SCHEMA = {
  type: "array",
  maxItems: 4,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["page", "role", "summary", "domains", "signals"],
    properties: {
      page: { type: "integer", minimum: 1 },
      role: { type: "string", maxLength: 100 },
      summary: { type: "string", maxLength: 220 },
      domains: {
        type: "array",
        maxItems: 6,
        items: {
          type: "string",
          enum: [
            "electricity", "gas", "shared_identity", "offer_terms",
            "totals_taxes", "instructions", "unknown",
          ],
        },
      },
      signals: {
        type: "object",
        additionalProperties: false,
        required: [
          "customer_identity", "activation_identifiers", "annual_consumption",
          "economic_terms", "offer_name_or_code",
        ],
        properties: {
          customer_identity: { type: "boolean" },
          activation_identifiers: { type: "boolean" },
          annual_consumption: { type: "boolean" },
          economic_terms: { type: "boolean" },
          offer_name_or_code: { type: "boolean" },
        },
      },
    },
  },
};

const GENERAL_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["document", "quality", "page_map", "review_reasons"],
  properties: {
    document: OUTPUT_SCHEMA.properties.document,
    quality: OUTPUT_SCHEMA.properties.quality,
    page_map: GENERAL_PAGE_MAP_SCHEMA,
    review_reasons: {
      type: "array",
      maxItems: 4,
      items: { type: "string", maxLength: 180 },
    },
  },
};

function exactGeneralPageMapSchema(expectedPages = []) {
  const pages = [...new Set(expectedPages.map(Number).filter((page) => Number.isInteger(page) && page > 0))];
  if (!pages.length) return GENERAL_PAGE_MAP_SCHEMA;
  return {
    ...GENERAL_PAGE_MAP_SCHEMA,
    minItems: pages.length,
    maxItems: pages.length,
    items: {
      ...GENERAL_PAGE_MAP_SCHEMA.items,
      properties: {
        ...GENERAL_PAGE_MAP_SCHEMA.items.properties,
        page: {
          ...GENERAL_PAGE_MAP_SCHEMA.items.properties.page,
          enum: pages,
        },
      },
    },
  };
}

function exactGeneralOutputSchema(expectedPages = []) {
  return {
    ...GENERAL_OUTPUT_SCHEMA,
    properties: {
      ...GENERAL_OUTPUT_SCHEMA.properties,
      page_map: exactGeneralPageMapSchema(expectedPages),
    },
  };
}

const SYSTEM_PROMPT = `You are the visual-semantic PDF reader inside OffertaLogica. Read Italian electricity and gas bills and offer documents.

Return evidence-grounded candidates only. You are not the final decision-maker.
- Extract only values explicitly present in the original document.
- Never guess, calculate, sum, average, annualize or convert a value.
- Keep electricity and gas values separate, including in dual documents.
- For every candidate return the original page, nearby label, short literal evidence, unit, commodity and semantic role.
- Distinguish customer values from estimates, examples, thresholds, discounts, taxes, network charges and offer values.
- Parser and OCR hints are untrusted. Agree or contradict them only when the document visually supports it.
- Use only requested OffertaLogica field names.
- A POD, PDR, tax code or customer code requires a clear nearby identifier label.
- Annual consumption requires a literal annual or rolling-12-month label.
- A contractual sales price requires a coherent sales-price label, the correct EUR/kWh or EUR/Smc unit and the correct commodity.
- Average bill prices, total spend, network, transport, taxes, power charges, dispatching and capacity are not contractual sales prices.
- A fixed monthly charge must remain monthly and must never be converted to an annual charge.
- If evidence is absent or ambiguous, return no candidate.
- Return JSON matching the supplied schema and no prose.`;

const GENERAL_RASTER_PROMPT = `You are the page-routing pass inside OffertaLogica for difficult rasterized Italian energy documents.

Your only task is to classify the document at a high level and build a concise map of the supplied pages.
- Do not extract customer codes, POD, PDR, tax codes, offer codes, consumptions, prices, fees, dates or addresses.
- Do not transcribe tables or return economic rows.
- Return exactly one page_map item for every supplied page.
- For each page, state its main role, a short routing summary, every applicable domain and the five requested boolean signals.
- Mark both electricity and gas on a mixed page. Never force a mixed page into only one commodity.
- "annual_consumption" is true only when the page visibly contains annual/12-month consumption, not meter readings.
- "economic_terms" is true for contractual sales prices, index/spread formulas or fixed sales charges, not merely for a bill total.
- "activation_identifiers" is true for POD/PDR; "customer_identity" is true for holder, tax code or customer code.
- The text after each image gives its original page number. Preserve that number in page_map.
- Return JSON matching the supplied schema and no prose.`;

const CRITICAL_FIELDS = {
  critical_luce: [
    "fornitore", "kind", "commodity", "customer_type", "intestatario", "codice_fiscale",
    "codice_cliente", "pod", "indirizzo_fornitura", "indirizzo_fornitura_luce",
    "prezzo_luce_eur_kwh", "quota_fissa_vendita_luce_eur_anno",
    "potenza_impegnata_kw", "potenza_disponibile_kw", "nome_offerta_luce",
    "codice_offerta_luce", "tipo_prezzo_luce", "indice_riferimento_luce",
    "spread_luce_eur_kwh",
  ],
  critical_gas: [
    "fornitore", "kind", "commodity", "customer_type", "intestatario", "codice_fiscale",
    "codice_cliente", "pdr", "indirizzo_fornitura", "indirizzo_fornitura_gas",
    "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno",
    "nome_offerta_gas", "codice_offerta_gas", "tipo_prezzo_gas",
    "indice_riferimento_gas", "spread_gas_eur_smc",
  ],
};

const CRITICAL_PROMPTS = {
  critical_luce: `${SYSTEM_PROMPT}

Focus only on electricity and shared customer identity. This is a targeted recovery pass, not a full bill transcription.
- Re-check POD character by character and copy customer identifiers only from clearly labelled rows.
- Return at most 6 distinct electricity consumption observations. Prioritize literal annual or rolling-12-month values, then billing-period or monthly values. Omit individual meter readings, repeated values and intermediate calculations unless they are the only evidence or resolve a conflict. Do not put consumption in candidates.
- Return at most 10 economic rows and only when they can plausibly represent the current offer's electricity sales price, index/spread formula or fixed sales charge. Keep quantity, total amount and printed unit rate separate.
- Classify price_basis strictly: total_unit_price is the complete current contractual unit price; spread is only the add-on to an index; index_value is the index itself; fixed_charge is a time-based sales charge; single_component is one component that is not the complete price.
- Mark future_or_renewal for values that apply only after a future month, renewal or expiry. They are not current prices.
- Never label PUN, PUN Index GME, an index value, "+ spread", delta, dispatching, capacity or one child component as total_unit_price.
- Copy the printed index name and formula into index_reference and formula_text when present.
- Do not reconstruct bill totals, taxes, network, transport, power, system charges or generic spending summaries. Include a non-sales row only when it is immediately adjacent and necessary to distinguish it from a sales row.
- Preserve parent and indented child rows separately when both are relevant. A child row labelled "di cui" must not be merged into its parent.
- For fixed sales rows preserve the printed monthly or annual unit. Never annualize in the model.
- Return price/index/spread/offer candidates only when explicitly labelled and visually supported. Prefer no value over a weak or inferred value.
- Omit gas-only values and return empty arrays when no relevant observation or row is present.`,
  critical_gas: `${SYSTEM_PROMPT}

Focus only on gas and shared customer identity. This is a targeted recovery pass, not a full bill transcription.
- Re-check all 14 PDR digits and copy customer identifiers only from clearly labelled rows.
- Return at most 6 distinct gas consumption observations. Prioritize literal annual or rolling-12-month values, then billing-period or monthly values. Omit individual meter readings, repeated values and intermediate calculations unless they are the only evidence or resolve a conflict. Do not put consumption in candidates.
- Return at most 10 economic rows and only when they can plausibly represent the current offer's gas sales price, index/spread formula or fixed sales charge. Keep quantity, total amount and printed unit rate separate.
- Classify price_basis strictly: total_unit_price is the complete current contractual unit price; spread is only the add-on to an index; index_value is the index itself; fixed_charge is a time-based sales charge; single_component is one component that is not the complete price.
- Mark future_or_renewal for values that apply only after a future month, renewal or expiry. They are not current prices.
- Never label PSV, PSBIL, TTF, an index value, "+ spread", delta, balancing, dispatching or one child component as total_unit_price.
- Copy the printed index name and formula into index_reference and formula_text when present.
- Do not reconstruct bill totals, taxes, network, transport, system charges or generic spending summaries. Include a non-sales row only when it is immediately adjacent and necessary to distinguish it from a sales row.
- Preserve parent and indented child rows separately when both are relevant. A child row labelled "di cui" must not be merged into its parent.
- For fixed sales rows preserve the printed monthly or annual unit. Never annualize in the model.
- Return price/index/spread/offer candidates only when explicitly labelled and visually supported. Prefer no value over a weak or inferred value.
- Omit electricity-only values and return empty arrays when no relevant observation or row is present.`,
};

function boundedTimeout(value, fallback = 12_000) {
  const parsed = Number(value ?? fallback);
  return Math.max(2_000, Math.min(48_000, Number.isFinite(parsed) ? parsed : fallback));
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
  return pdfAiConfig(env).mode;
}

export function choosePdfInputDetail({ pageCount = 0, diagnostics = [] } = {}) {
  const denseEvidence = diagnostics.some((item) => String(item?.source_snippet || "").length >= 280);
  return Number(pageCount || 0) >= 6 || denseEvidence ? "high" : "low";
}

export async function buildPdfAiRequest({
  filePath,
  filename = "documento.pdf",
  parserVersion = "unknown",
  parserCandidates = [],
  pageCount = 0,
  diagnostics = [],
  model = PDF_AI_PRIMARY_MODEL,
  profile = "document",
} = {}) {
  if (!filePath) throw new Error("filePath_required");
  const bytes = await fs.readFile(filePath);
  const inputDetail = choosePdfInputDetail({ pageCount, diagnostics });
  const critical = Boolean(CRITICAL_FIELDS[profile]);
  const context = {
    parser_version: parserVersion,
    requested_fields: critical ? CRITICAL_FIELDS[profile] : pdfFieldNames(),
    parser_and_ocr_candidates: parserCandidates.map(candidateHint),
    source_transport: "original_pdf",
    original_filename: filename,
    document_page_count: Number(pageCount || 0) || null,
    request_profile: profile,
  };
  return {
    model,
    store: false,
    max_output_tokens: critical ? 4_200 : inputDetail === "high" ? 6_500 : 4_200,
    input: [
      { role: "system", content: critical ? CRITICAL_PROMPTS[profile] : SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "input_file",
            filename,
            file_data: `data:application/pdf;base64,${bytes.toString("base64")}`,
          },
          {
            type: "input_text",
            text: `Analyze the PDF using these untrusted parser/OCR hints:\n${JSON.stringify(context)}`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: critical ? `offertalogica_pdf_${profile}` : "offertalogica_pdf_candidates",
        strict: true,
        schema: outputSchemaForProfile(profile),
      },
    },
  };
}

function normalizeImageMime(value) {
  const mime = String(value || "").trim().toLowerCase();
  return ["image/jpeg", "image/png", "image/webp"].includes(mime) ? mime : "image/jpeg";
}

function outputSchemaForProfile(profile, expectedPages = []) {
  if (profile === "general") return exactGeneralOutputSchema(expectedPages);
  const fields = CRITICAL_FIELDS[profile];
  if (!fields) return OUTPUT_SCHEMA;
  return {
    ...OUTPUT_SCHEMA,
    required: [...OUTPUT_SCHEMA.required, "consumption_observations", "economic_rows"],
    properties: {
      ...OUTPUT_SCHEMA.properties,
      page_map: {
        ...OUTPUT_SCHEMA.properties.page_map,
        maxItems: 8,
      },
      candidates: {
        type: "array",
        maxItems: 24,
        items: {
          ...CANDIDATE_SCHEMA,
          properties: {
            ...CANDIDATE_SCHEMA.properties,
            field: { type: "string", enum: fields },
          },
        },
      },
      conflicts: {
        ...OUTPUT_SCHEMA.properties.conflicts,
        maxItems: 6,
      },
      review_reasons: {
        type: "array",
        maxItems: 6,
        items: { type: "string", maxLength: 180 },
      },
      consumption_observations: {
        type: "array",
        maxItems: 6,
        items: CONSUMPTION_OBSERVATION_SCHEMA,
      },
      economic_rows: {
        type: "array",
        maxItems: 10,
        items: ECONOMIC_ROW_SCHEMA,
      },
    },
  };
}

export async function buildPdfAiImageRequest({
  imageFiles = [],
  filename = "documento.pdf",
  parserVersion = "unknown",
  parserCandidates = [],
  pageCount = 0,
  model = PDF_AI_PRIMARY_MODEL,
  profile = "general",
} = {}) {
  const ordered = [...imageFiles]
    .filter((item) => item?.filePath)
    .sort((left, right) => Number(left.page || 0) - Number(right.page || 0));
  if (!ordered.length) throw new Error("image_files_required");
  if (ordered.length > 8) throw new Error("too_many_image_pages");

  const critical = Boolean(CRITICAL_FIELDS[profile]);
  const context = {
    parser_version: parserVersion,
    requested_fields: critical ? CRITICAL_FIELDS[profile] : profile === "general" ? [] : pdfFieldNames(),
    parser_and_ocr_candidates: parserCandidates.map(candidateHint),
    source_transport: "client_rasterized_pdf_pages",
    original_filename: filename,
    document_page_count: Number(pageCount || ordered.length),
    request_profile: profile,
  };
  const content = [];
  for (const [index, item] of ordered.entries()) {
    const bytes = await fs.readFile(item.filePath);
    content.push({
      type: "input_image",
      image_url: `data:${normalizeImageMime(item.mimeType)};base64,${bytes.toString("base64")}`,
      detail: critical ? "high" : "low",
    });
    content.push({
      type: "input_text",
      text: `The preceding image is original page ${Number(item.page || index + 1)}.`,
    });
  }
  content.push({
    type: "input_text",
    text: `Read only the supplied pages under this deterministic plan:\n${JSON.stringify(context)}`,
  });

  return {
    model,
    store: false,
    max_output_tokens: critical ? 3_600 : profile === "general" ? 1_200 : 4_200,
    input: [
      {
        role: "system",
        content: critical ? CRITICAL_PROMPTS[profile] : GENERAL_RASTER_PROMPT,
      },
      { role: "user", content },
    ],
    text: {
      format: {
        type: "json_schema",
        name: `offertalogica_pdf_${profile}`,
        strict: true,
        schema: outputSchemaForProfile(profile, ordered.map((item) => Number(item.page))),
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
      if (content?.type === "refusal") {
        throw new Error(`openai_refusal:${content.refusal || "refused"}`);
      }
      if (content?.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return "";
}

function validateExactGeneralPageMap(pageMap, expectedPages = []) {
  const expected = [...new Set(expectedPages.map(Number).filter((page) => Number.isInteger(page) && page > 0))]
    .sort((left, right) => left - right);
  if (!expected.length) return;
  const actual = pageMap.map((item) => Number(item?.page || 0));
  if (actual.length !== expected.length) throw new Error("openai_invalid_page_map_count");
  if (actual.some((page) => !Number.isInteger(page) || page <= 0)) {
    throw new Error("openai_invalid_page_map_page");
  }
  if (new Set(actual).size !== actual.length) throw new Error("openai_duplicate_page_map_page");
  const sorted = [...actual].sort((left, right) => left - right);
  if (sorted.some((page, index) => page !== expected[index])) {
    throw new Error("openai_page_map_pages_mismatch");
  }
}

function validateAiOutput(parsed, { profile = "document", expectedPages = [] } = {}) {
  if (!parsed || typeof parsed !== "object") throw new Error("openai_invalid_output_object");
  if (!parsed.document || !parsed.quality) throw new Error("openai_missing_document_metadata");
  if (!Array.isArray(parsed.page_map)) throw new Error("openai_invalid_page_map");
  if (profile === "general") validateExactGeneralPageMap(parsed.page_map, expectedPages);
  if (parsed.candidates !== undefined && !Array.isArray(parsed.candidates)) {
    throw new Error("openai_invalid_candidates");
  }
  if (parsed.conflicts !== undefined && !Array.isArray(parsed.conflicts)) {
    throw new Error("openai_invalid_conflicts");
  }
  if (parsed.review_reasons !== undefined && !Array.isArray(parsed.review_reasons)) {
    throw new Error("openai_invalid_review_reasons");
  }
  if (parsed.consumption_observations !== undefined && !Array.isArray(parsed.consumption_observations)) {
    throw new Error("openai_invalid_consumption_observations");
  }
  if (parsed.economic_rows !== undefined && !Array.isArray(parsed.economic_rows)) {
    throw new Error("openai_invalid_economic_rows");
  }
  return {
    ...parsed,
    candidates: parsed.candidates || [],
    conflicts: parsed.conflicts || [],
    review_reasons: parsed.review_reasons || [],
    consumption_observations: parsed.consumption_observations || [],
    economic_rows: parsed.economic_rows || [],
  };
}

async function transportBody(result) {
  if (result && typeof result.json === "function") {
    if (result.ok === false) {
      const responseText = await result.text().catch(() => "");
      throw new Error(`openai_http_${result.status}:${responseText.slice(0, 240)}`);
    }
    return result.json();
  }
  return result;
}

export async function runPdfAiPass({
  requiredMode = null,
  filePath,
  imageFiles = [],
  filename,
  legacyNormalized = {},
  parserCandidates = [],
  deadlineAt = null,
  transport = defaultTransport,
  apiKey = process.env.OPENAI_API_KEY,
  model = null,
  env = process.env,
  profile = "document",
  timeoutMs = null,
} = {}) {
  const mode = pdfAiMode(env);
  if (mode === "off" || (requiredMode && mode !== requiredMode)) {
    return { status: "disabled", model: null, candidates: [], profile };
  }
  const resolvedModel = model || pdfAiConfig(env).model || PDF_AI_PRIMARY_MODEL;
  if (!apiKey) {
    return {
      status: "unavailable",
      reason: "missing_openai_api_key",
      model: resolvedModel,
      candidates: [],
      profile,
    };
  }

  const configuredTimeout = boundedTimeout(timeoutMs ?? env.PDF_AI_TIMEOUT_MS, 12_000);
  const remainingMs = deadlineAt ? Number(deadlineAt) - Date.now() - 750 : configuredTimeout;
  const requestTimeoutMs = Math.min(configuredTimeout, remainingMs);
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 2_000) {
    return {
      status: "skipped",
      reason: "insufficient_time_budget",
      model: resolvedModel,
      candidates: [],
      profile,
      timeout_ms: requestTimeoutMs,
    };
  }

  const request = imageFiles.length
    ? await buildPdfAiImageRequest({
      imageFiles,
      filename,
      parserVersion: legacyNormalized.parser_version,
      parserCandidates,
      pageCount: legacyNormalized.page_count,
      model: resolvedModel,
      profile,
    })
    : await buildPdfAiRequest({
      filePath,
      filename,
      parserVersion: legacyNormalized.parser_version,
      parserCandidates,
      pageCount: legacyNormalized.page_count,
      diagnostics: legacyNormalized.diagnostics,
      model: resolvedModel,
      profile,
    });

  const controller = new AbortController();
  let timeoutId;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error("openai_timeout"));
      }, requestTimeoutMs);
    });
    const raw = await Promise.race([
      transport({ request, apiKey, signal: controller.signal }),
      timeoutPromise,
    ]);
    const body = await transportBody(raw);
    if (body?.status === "incomplete") {
      throw new Error(`openai_incomplete:${body?.incomplete_details?.reason || "unknown"}`);
    }
    const outputText = responseOutputText(body);
    if (!outputText) throw new Error("openai_empty_output");
    const expectedPages = imageFiles.length
      ? imageFiles.map((item) => Number(item?.page || 0)).filter(Boolean)
      : [];
    const parsed = validateAiOutput(JSON.parse(outputText), { profile, expectedPages });
    const sourceVersion = `${resolvedModel}:${profile}:${PDF_AI_ADAPTER_VERSION}`;
    const candidates = aiPdfToCandidates(parsed, sourceVersion).map((candidate) => ({
      ...candidate,
      method: `gpt41_visual_${profile}`,
      source_version: sourceVersion,
    }));
    return {
      status: "completed",
      model: resolvedModel,
      response_id: String(body?.id || "").slice(0, 160) || null,
      candidates,
      timeout_ms: requestTimeoutMs,
      profile,
      document: parsed.document,
      quality: parsed.quality,
      page_map: parsed.page_map,
      conflicts: parsed.conflicts,
      review_reasons: parsed.review_reasons,
      consumption_observations: parsed.consumption_observations || [],
      economic_rows: parsed.economic_rows || [],
    };
  } catch (error) {
    return {
      status: "failed",
      reason: String(error?.message || "openai_error").slice(0, 300),
      model: resolvedModel,
      candidates: [],
      timeout_ms: requestTimeoutMs,
      profile,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runPdfAiShadow(options = {}) {
  return runPdfAiPass({
    ...options,
    requiredMode: "shadow",
    profile: options.profile || "document",
  });
}

export async function runPdfAiFallback(options = {}) {
  return runPdfAiPass({
    ...options,
    requiredMode: "fallback",
    profile: options.profile || "document",
  });
}
