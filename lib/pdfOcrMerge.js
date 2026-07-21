import { isMaterialOcrImprovement, isMissingPdfValue } from "./pdfOcrPolicy.js";

const CONTROL_FIELDS = new Set([
  "parser_version",
  "page_count",
  "diagnostics",
  "warnings",
  "textExtracted",
  "needsReview",
  "confidence",
  "recognized",
  "ocr",
]);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function markOcrDiagnosticsForReview(diagnostics = [], ocrFields = new Set()) {
  return diagnostics.map((item) => {
    if (!ocrFields.has(item?.field) || isMissingPdfValue(item?.value)) return item;
    return {
      ...item,
      status: "review",
      confidence: "medium",
      method: item.method === "derived" ? "ocr_then_derived" : "ocr_then_text_pattern",
    };
  });
}

function preserveDeterministicDiagnostics(baseDiagnostics = [], nextDiagnostics = [], ocrFields = new Set()) {
  const deterministicByField = new Map(
    baseDiagnostics
      .filter((item) => item?.field && !ocrFields.has(item.field) && !isMissingPdfValue(item.value))
      .map((item) => [item.field, item]),
  );
  const seen = new Set();
  const merged = nextDiagnostics.map((item) => {
    seen.add(item?.field);
    return deterministicByField.get(item?.field) || item;
  });
  for (const [field, item] of deterministicByField) {
    if (!seen.has(field)) merged.push(item);
  }
  return merged;
}

export function mergeOcrCandidate({
  base = {},
  candidate = {},
  pageTexts = [],
  pageCount = null,
  ocrMeta = {},
  diagnosticsBuilder,
} = {}) {
  if (!isMaterialOcrImprovement(base, candidate)) {
    return {
      ...base,
      ocr: {
        ...ocrMeta,
        applied: false,
        reason: "no_material_improvement",
      },
    };
  }

  const merged = { ...base };
  const ocrFields = new Set();
  for (const [key, value] of Object.entries(candidate)) {
    if (CONTROL_FIELDS.has(key) || isMissingPdfValue(value)) continue;
    if (isMissingPdfValue(merged[key])) {
      merged[key] = value;
      ocrFields.add(key);
    }
  }

  if (isMissingPdfValue(merged.kind) || merged.kind === "unknown") {
    merged.kind = candidate.kind;
    ocrFields.add("kind");
  }
  if (isMissingPdfValue(merged.commodity) || merged.commodity === "unknown") {
    merged.commodity = candidate.commodity;
    ocrFields.add("commodity");
  }
  merged.recognized = Boolean(base.recognized || candidate.recognized);
  merged.page_count = pageCount || base.page_count || candidate.page_count || null;
  merged.textExtracted = pageTexts.join("\n").length;
  merged.confidence = "medium";
  merged.needsReview = true;
  merged.warnings = unique([
    ...(base.warnings || []).filter((warning) => ![
      "testo_pdf_assente_o_insufficiente",
      "nessun_dato_utile_rilevato",
    ].includes(warning)),
    ...(candidate.warnings || []).filter((warning) => ![
      "testo_pdf_assente_o_insufficiente",
      "nessun_dato_utile_rilevato",
    ].includes(warning)),
    "ocr_fallback_utilizzato",
    "ocr_verifica_utente_richiesta",
  ]);

  const rebuiltDiagnostics = typeof diagnosticsBuilder === "function"
    ? diagnosticsBuilder(merged, pageTexts)
    : candidate.diagnostics || [];
  const diagnosticsWithProtectedBase = preserveDeterministicDiagnostics(
    base.diagnostics || [],
    rebuiltDiagnostics,
    ocrFields,
  );
  merged.diagnostics = markOcrDiagnosticsForReview(diagnosticsWithProtectedBase, ocrFields);
  merged.ocr = {
    ...ocrMeta,
    applied: true,
    reason: "material_improvement",
    review_required: true,
    filled_fields: [...ocrFields].sort(),
  };
  return merged;
}
