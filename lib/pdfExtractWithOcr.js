import {
  buildPdfDiagnostics,
  extractPdfDataFromText,
  extractPdfWithPages,
} from "./pdfExtract.js";
import { mergeOcrCandidate } from "./pdfOcrMerge.js";
import {
  PDF_OCR_PIPELINE_VERSION,
  scorePdfResult,
  shouldAttemptControlledOcr,
} from "./pdfOcrPolicy.js";
import { runControlledPdfOcr } from "./pdfOcr.js";
import { hasComparableOcrCore, normalizePdfOcrCandidate, normalizePdfOcrText } from "./pdfOcrText.js";

function ocrFailure(base, policy, startedAt, error) {
  return {
    ...base,
    ocr: {
      pipeline_version: PDF_OCR_PIPELINE_VERSION,
      attempted: true,
      applied: false,
      reason: "ocr_error",
      trigger: policy.reason,
      elapsed_ms: Date.now() - startedAt,
      error: String(error?.message || "ocr_error").slice(0, 180),
    },
    warnings: [...new Set([...(base.warnings || []), "ocr_non_disponibile"])],
    needsReview: true,
  };
}

export async function extractPdfWithControlledOcr(filePath, {
  filename = "documento.pdf",
  deadlineAt,
  env = process.env,
} = {}) {
  const startedAt = Date.now();
  const deterministic = await extractPdfWithPages(filePath);
  const base = deterministic.normalized;
  const policy = shouldAttemptControlledOcr({
    normalized: base,
    pageTexts: deterministic.pageTexts,
    filename,
    env,
  });

  if (!policy.attempt) {
    return {
      ...base,
      ocr: {
        pipeline_version: PDF_OCR_PIPELINE_VERSION,
        attempted: false,
        applied: false,
        reason: policy.reason,
      },
    };
  }

  try {
    const ocr = await runControlledPdfOcr(filePath, {
      pageCount: base.page_count,
      deadlineAt,
      env,
      onPageText: ({ pageTexts }) => {
        const interimText = normalizePdfOcrText(pageTexts.join("\n"));
        const interim = normalizePdfOcrCandidate(extractPdfDataFromText(interimText), { text: interimText });
        // Per il confronto non basta il solo POD/PDR: cerca anche consumo e prezzo.
        // Per le offerte variabili continua fino alla pagina successiva quando la
        // formula dichiara lo spread ma il valore non è ancora stato recuperato.
        const variableLuceMissingSpread = interim.tipo_prezzo_luce === "variabile"
          && Array.isArray(interim.componenti_prezzo_luce)
          && interim.componenti_prezzo_luce.includes("spread")
          && !Number.isFinite(interim.spread_luce_eur_kwh);
        const variableGasMissingSpread = interim.tipo_prezzo_gas === "variabile"
          && Array.isArray(interim.componenti_prezzo_gas)
          && interim.componenti_prezzo_gas.includes("spread")
          && !Number.isFinite(interim.spread_gas_eur_smc);
        if (variableLuceMissingSpread || variableGasMissingSpread) return true;
        return !(scorePdfResult(interim) >= 12 && hasComparableOcrCore(interim));
      },
    });
    const normalizedOcrPages = ocr.pageTexts.map(normalizePdfOcrText);
    const ocrText = normalizedOcrPages.join("\n");
    const candidate = normalizePdfOcrCandidate(extractPdfDataFromText(ocrText), { text: ocrText });
    candidate.page_count = base.page_count;
    candidate.diagnostics = buildPdfDiagnostics(candidate, normalizedOcrPages);

    return mergeOcrCandidate({
      base,
      candidate,
      pageTexts: normalizedOcrPages,
      pageCount: base.page_count,
      diagnosticsBuilder: buildPdfDiagnostics,
      ocrMeta: {
        pipeline_version: PDF_OCR_PIPELINE_VERSION,
        attempted: true,
        engine: "tesseract.js",
        language: "ita",
        trigger: policy.reason,
        pages: ocr.pages,
        text_chars: ocrText.length,
        elapsed_ms: ocr.elapsed_ms,
        stopped_reason: ocr.stopped_reason,
        asset_mode: ocr.asset_mode,
      },
    });
  } catch (error) {
    return ocrFailure(base, policy, startedAt, error);
  }
}
