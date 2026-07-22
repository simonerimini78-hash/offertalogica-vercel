export const PDF_AI_PREVIEW_VERSION = "8.4.2";

function compact(value, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeField(entry = {}, status = "da_verificare") {
  const field = compact(entry.field, 80);
  if (!field) return null;
  const value = entry.normalized_value;
  if (value === null || value === undefined || value === "") return null;
  return {
    field,
    value,
    page: Number.isInteger(Number(entry.page)) ? Number(entry.page) : null,
    label: compact(entry.label, 180) || null,
    evidence: compact(entry.evidence, 360) || null,
    confidence: safeNumber(entry.confidence),
    status,
  };
}

function safeConflict(entry = {}) {
  const field = compact(entry.field, 80);
  if (!field) return null;
  return {
    field,
    reason: compact(entry.reason, 120) || "conflict",
    deterministic_value: entry.deterministic_value ?? null,
    ai_value: entry.ai_value ?? null,
    values: Array.isArray(entry.values) ? entry.values.slice(0, 5) : [],
    pages: Array.isArray(entry.pages) ? entry.pages.slice(0, 8) : [],
    page: Number.isInteger(Number(entry.page)) ? Number(entry.page) : null,
  };
}

/**
 * Builds the only AI data intentionally returned to an authenticated Preview.
 * It contains validated, review-only readings and never mutates normalized
 * parser/OCR fields or the autofill contract.
 */
export function buildPdfAiPreview(aiShadow) {
  if (aiShadow?.status !== "observed") return null;
  const observation = aiShadow?.observation;
  const plan = observation?.review_plan;
  if (!plan || typeof plan !== "object") return null;

  const fields = (Array.isArray(plan.review_fields) ? plan.review_fields : [])
    .map((entry) => safeField(entry, "da_verificare"))
    .filter(Boolean);
  const corroborated = (Array.isArray(plan.corroborated_fields) ? plan.corroborated_fields : [])
    .map((entry) => safeField(entry, "confermato_parser_ocr"))
    .filter(Boolean);
  const conflicts = (Array.isArray(plan.conflicts) ? plan.conflicts : [])
    .map(safeConflict)
    .filter(Boolean);

  const document = observation?.document && typeof observation.document === "object"
    ? {
        document_type: compact(observation.document.document_type, 80) || "unknown",
        commodity: compact(observation.document.commodity, 40) || "unknown",
        customer_type: compact(observation.document.customer_type, 40) || "unknown",
        page_count: Number.isInteger(Number(observation.document.page_count))
          ? Number(observation.document.page_count)
          : null,
      }
    : null;

  return {
    preview_version: PDF_AI_PREVIEW_VERSION,
    source: "ai_visual_preview",
    review_only: true,
    automatic_fill: false,
    document,
    fields,
    corroborated,
    conflicts,
    summary: {
      review_field_count: fields.length,
      corroborated_field_count: corroborated.length,
      conflict_count: conflicts.length,
    },
  };
}
