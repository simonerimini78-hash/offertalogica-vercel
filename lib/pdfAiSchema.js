export const PDF_AI_REVIEW_SCHEMA_VERSION = "8.0.0";

export const PDF_AI_REVIEW_FIELDS = Object.freeze([
  "kind",
  "commodity",
  "fornitore",
  "customer_type",
  "intestatario",
  "codice_fiscale",
  "codice_cliente",
  "pod",
  "pdr",
  "indirizzo_fornitura",
]);

export const PDF_AI_CLASSIFICATION_FIELDS = Object.freeze([
  "kind",
  "commodity",
  "customer_type",
]);

export const PDF_AI_IDENTIFIER_FIELDS = Object.freeze(
  PDF_AI_REVIEW_FIELDS.filter((field) => !PDF_AI_CLASSIFICATION_FIELDS.includes(field)),
);

const DOCUMENT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["document_type", "commodity", "customer_type", "page_count"],
  properties: {
    document_type: {
      type: "string",
      enum: ["bill", "synthetic_sheet", "cte", "combined_offer_document", "placet", "unknown"],
    },
    commodity: { type: "string", enum: ["electricity", "gas", "dual", "unknown"] },
    customer_type: { type: "string", enum: ["consumer", "business", "unknown"] },
    page_count: { type: ["integer", "null"], minimum: 1 },
  },
});

export const PDF_AI_REVIEW_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["document", "candidates", "review_reasons"],
  properties: {
    document: DOCUMENT_SCHEMA,
    candidates: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "value_text", "page", "label", "evidence", "semantic_role", "confidence"],
        properties: {
          field: { type: "string", enum: PDF_AI_REVIEW_FIELDS },
          value_text: { type: "string", minLength: 1, maxLength: 500 },
          page: { type: "integer", minimum: 1 },
          label: { type: "string", minLength: 1, maxLength: 180 },
          evidence: { type: "string", minLength: 6, maxLength: 360 },
          semantic_role: { type: "string", enum: ["classification", "identifier"] },
          confidence: { type: "integer", minimum: 0, maximum: 100 },
        },
      },
    },
    review_reasons: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 180 },
    },
  },
});

export function expectedPdfAiSemanticRole(field) {
  if (PDF_AI_CLASSIFICATION_FIELDS.includes(field)) return "classification";
  if (PDF_AI_IDENTIFIER_FIELDS.includes(field)) return "identifier";
  return null;
}
