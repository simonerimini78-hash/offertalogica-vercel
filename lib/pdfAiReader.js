import fs from "node:fs/promises";
import {
  PDF_AI_CRITICAL_MODEL,
  PDF_AI_PRIMARY_MODEL,
  pdfAiConfig,
} from "./pdfAiConfig.js";
import { aiPdfToCandidates, pdfFieldNames } from "./pdfReaderContract.js";

export const PDF_AI_ADAPTER_VERSION = "step8-clean-reader-v1";
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

const GENERAL_RASTER_PROMPT = `${SYSTEM_PROMPT}

You are reading an ordered subset of rasterized pages from one PDF.
The text after each image gives its original page number. Preserve that page number in every candidate.`;

const CRITICAL_FIELDS = {
  critical_luce: [
    "fornitore", "kind", "commodity", "customer_type", "intestatario", "codice_fiscale",
    "codice_cliente", "pod", "indirizzo_fornitura", "indirizzo_fornitura_luce",
    "consumo_luce_kwh", "prezzo_luce_eur_kwh", "quota_fissa_vendita_luce_eur_anno",
    "potenza_impegnata_kw", "potenza_disponibile_kw", "nome_offerta_luce",
    "codice_offerta_luce", "tipo_prezzo_luce", "indice_riferimento_luce",
    "spread_luce_eur_kwh",
  ],
  critical_gas: [
    "fornitore", "kind", "commodity", "customer_type", "intestatario", "codice_fiscale",
    "codice_cliente", "pdr", "indirizzo_fornitura", "indirizzo_fornitura_gas",
    "consumo_gas_smc", "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno",
    "nome_offerta_gas", "codice_offerta_gas", "tipo_prezzo_gas",
    "indice_riferimento_gas", "spread_gas_eur_smc",
  ],
};

const CRITICAL_PROMPTS = {
  critical_luce: `${SYSTEM_PROMPT}

Focus only on electricity and shared customer identity.
- Re-check POD character by character.
- Recover electricity consumption only with an annual/12-month label.
- Recover contractual electricity prices and fixed sales fees only with complete economic evidence.
- Omit gas-only values.`,
  critical_gas: `${SYSTEM_PROMPT}

Focus only on gas and shared customer identity.
- Re-check all 14 PDR digits.
- Recover gas consumption only with an annual/12-month label.
- Recover contractual gas prices and fixed sales fees only with complete economic evidence.
- Omit electricity-only values.`,
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
} = {}) {
  if (!filePath) throw new Error("filePath_required");
  const bytes = await fs.readFile(filePath);
  const detail = choosePdfInputDetail({ pageCount, diagnostics });
  const context = {
    parser_version: parserVersion,
    requested_fields: pdfFieldNames(),
    parser_and_ocr_candidates: parserCandidates.map(candidateHint),
  };
  return {
    model,
    store: false,
    max_output_tokens: detail === "high" ? 6_500 : 4_200,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "input_file",
            filename,
            file_data: `data:application/pdf;base64,${bytes.toString("base64")}`,
            detail,
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
        name: "offertalogica_pdf_candidates",
        strict: true,
        schema: OUTPUT_SCHEMA,
      },
    },
  };
}

function normalizeImageMime(value) {
  const mime = String(value || "").trim().toLowerCase();
  return ["image/jpeg", "image/png", "image/webp"].includes(mime) ? mime : "image/jpeg";
}

function outputSchemaForProfile(profile) {
  const fields = CRITICAL_FIELDS[profile];
  if (!fields) return OUTPUT_SCHEMA;
  return {
    ...OUTPUT_SCHEMA,
    properties: {
      ...OUTPUT_SCHEMA.properties,
      candidates: {
        type: "array",
        items: {
          ...CANDIDATE_SCHEMA,
          properties: {
            ...CANDIDATE_SCHEMA.properties,
            field: { type: "string", enum: fields },
          },
        },
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
    requested_fields: critical ? CRITICAL_FIELDS[profile] : pdfFieldNames(),
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
      detail: "high",
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
    max_output_tokens: critical ? 3_200 : 4_200,
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
        schema: outputSchemaForProfile(profile),
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
    const parsed = validateAiOutput(JSON.parse(outputText));
    const sourceVersion = `${resolvedModel}:${profile}`;
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
