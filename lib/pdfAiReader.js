import fs from "node:fs/promises";
import { aiPdfToCandidates, pdfFieldNames } from "./pdfReaderContract.js";

export const PDF_AI_ADAPTER_VERSION = "2.3.0";
export const PDF_AI_PRIMARY_MODEL = "gpt-4.1-mini-2025-04-14";
export const PDF_AI_ESCALATION_MODEL = "gpt-4.1-2025-04-14";

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
- Parser and OCR hints are untrusted. Agree or contradict them only when the PDF visually supports it.
- Use only requested OffertaLogica field names. Include classification fields (fornitore, kind, commodity, customer_type) as candidates only when the PDF contains direct evidence.
- Always return kind when the pages visibly identify a bill/invoice or an offer/conditions document.
- Treat the supplier logo or clearly printed supplier brand as fornitore; use semantic_role classification or identifier.
- Treat the named customer/company as intestatario and the supply-site address as indirizzo_fornitura; use semantic_role actual_customer_value or identifier.
- Treat labelled customer code, POD, PDR and tax/VAT code as identifiers. Treat labelled committed and available power as actual_customer_value.
- Before returning, perform an identity checklist on every page: intestatario, codice_fiscale/P.IVA, codice_cliente, customer_type, supply identifier and supply address. Do not omit a visible tax/VAT identifier because it also supports customer_type.
- The module uses codice_fiscale as the canonical tax-id field: return an explicitly labelled 11-digit P.IVA or a 16-character Italian codice fiscale in that field.
- Classify customer_type as business only with explicit evidence such as P.IVA, a legal-entity name or a non-domestic label; when that evidence is visible, return customer_type separately from codice_fiscale.
- For a single electricity document prefer nome_offerta_luce; for a single gas document prefer nome_offerta_gas. Do not emit both a generic and a commodity-specific duplicate for the same offer name.
- Prioritize identity, supply identifiers, supply address, customer code, committed power, available power and offer/product name when clearly visible.
- For annual consumption, return the actual annual or rolling-12-month customer value, never the billed-period consumption.
- For sales prices and fixed fees, exclude taxes, network charges and totals unless the label explicitly identifies the sales component requested.
- If evidence is absent or ambiguous, return no candidate.
- Return JSON matching the supplied schema and no prose.`;

export function resolvePdfAiTimeoutMs({ value, deadlineAt = null, now = Date.now() } = {}) {
  const parsed = Number(value || 35_000);
  const configured = Math.max(2_000, Math.min(48_000, Number.isFinite(parsed) ? parsed : 35_000));
  const remaining = deadlineAt ? Number(deadlineAt) - Number(now) - 1_000 : configured;
  return Math.min(configured, remaining);
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
  const mode = String(env.PDF_AI_MODE || "off").trim().toLowerCase();
  return ["shadow", "fallback"].includes(mode) ? mode : "off";
}

export function choosePdfInputDetail({ pageCount = 0, diagnostics = [] } = {}) {
  const denseEvidence = diagnostics.some((item) => String(item?.source_snippet || "").length >= 280);
  return Number(pageCount || 0) >= 6 || denseEvidence ? "high" : "low";
}

export async function buildPdfAiRequest({ filePath, filename = "documento.pdf", parserVersion = "unknown", parserCandidates = [], pageCount = 0, diagnostics = [], model = PDF_AI_PRIMARY_MODEL } = {}) {
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
          },
          { type: "input_text", text: `Analyze the PDF using these untrusted parser/OCR hints:\n${JSON.stringify(context)}` },
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
  const mime = String(value || "").toLowerCase();
  if (["image/jpeg", "image/png", "image/webp"].includes(mime)) return mime;
  return "image/jpeg";
}

export async function buildPdfAiImageRequest({ imageFiles = [], filename = "documento.pdf", parserVersion = "unknown", parserCandidates = [], pageCount = 0, diagnostics = [], model = PDF_AI_PRIMARY_MODEL } = {}) {
  const ordered = [...imageFiles]
    .filter((item) => item?.filePath)
    .sort((a, b) => Number(a.page || 0) - Number(b.page || 0));
  if (!ordered.length) throw new Error("image_files_required");
  if (ordered.length > 8) throw new Error("too_many_image_pages");

  const context = {
    parser_version: parserVersion,
    requested_fields: pdfFieldNames(),
    parser_and_ocr_candidates: parserCandidates.map(candidateHint),
    source_transport: "client_rasterized_pdf_pages",
    original_filename: filename,
    page_count: Number(pageCount || ordered.length),
  };
  const imageContent = [];
  for (const [index, item] of ordered.entries()) {
    const bytes = await fs.readFile(item.filePath);
    const mimeType = normalizeImageMime(item.mimeType);
    imageContent.push({
      type: "input_image",
      image_url: `data:${mimeType};base64,${bytes.toString("base64")}`,
      detail: "high",
    });
    imageContent.push({
      type: "input_text",
      text: `The preceding image is page ${Number(item.page || index + 1)} of ${ordered.length}.`,
    });
  }

  return {
    model,
    store: false,
    max_output_tokens: 3_600,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          ...imageContent,
          { type: "input_text", text: `Analyze these ordered rasterized PDF pages using these untrusted parser/OCR hints:\n${JSON.stringify(context)}` },
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

async function runPdfAi({
  requiredMode,
  filePath,
  imageFiles = [],
  filename,
  legacyNormalized = {},
  parserCandidates = [],
  deadlineAt = null,
  transport = defaultTransport,
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.PDF_AI_MODEL || PDF_AI_PRIMARY_MODEL,
  env = process.env,
} = {}) {
  if (pdfAiMode(env) !== requiredMode) return { status: "disabled", model: null, candidates: [] };
  if (!apiKey) return { status: "unavailable", reason: "missing_openai_api_key", model, candidates: [] };

  const timeoutMs = resolvePdfAiTimeoutMs({ value: env.PDF_AI_TIMEOUT_MS, deadlineAt });
  if (!Number.isFinite(timeoutMs) || timeoutMs < 2_000) {
    return { status: "skipped", reason: "insufficient_time_budget", model, timeout_ms: timeoutMs, candidates: [] };
  }

  const request = imageFiles.length
    ? await buildPdfAiImageRequest({
      imageFiles,
      filename,
      parserVersion: legacyNormalized.parser_version,
      parserCandidates,
      pageCount: legacyNormalized.page_count,
      diagnostics: legacyNormalized.diagnostics,
      model,
    })
    : await buildPdfAiRequest({
      filePath,
      filename,
      parserVersion: legacyNormalized.parser_version,
      parserCandidates,
      pageCount: legacyNormalized.page_count,
      diagnostics: legacyNormalized.diagnostics,
      model,
    });
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
    const parsed = validateAiOutput(JSON.parse(outputText));
    const candidates = aiPdfToCandidates(parsed, model);
    return {
      status: "completed",
      model,
      response_id: String(body?.id || "").slice(0, 160) || null,
      candidates,
      timeout_ms: timeoutMs,
      document: parsed.document,
      quality: parsed.quality,
      page_map: parsed.page_map,
      conflicts: parsed.conflicts,
      review_reasons: parsed.review_reasons,
    };
  } catch (error) {
    return { status: "failed", reason: String(error?.message || "openai_error").slice(0, 300), model, timeout_ms: timeoutMs, candidates: [] };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runPdfAiShadow(options = {}) {
  return runPdfAi({ ...options, requiredMode: "shadow" });
}

export async function runPdfAiFallback(options = {}) {
  return runPdfAi({ ...options, requiredMode: "fallback" });
}

export async function runPdfAiFallbackImages(options = {}) {
  return runPdfAi({ ...options, requiredMode: "fallback", imageFiles: options.imageFiles || [] });
}
