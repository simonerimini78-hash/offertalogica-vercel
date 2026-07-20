export const PDF_OCR_PIPELINE_VERSION = "v105.2-vercel-assets-1";

const CORE_FIELDS = [
  "fornitore",
  "consumo_luce_kwh",
  "consumo_gas_smc",
  "prezzo_luce_eur_kwh",
  "prezzo_gas_eur_smc",
  "quota_fissa_vendita_luce_eur_anno",
  "quota_fissa_vendita_gas_eur_anno",
  "potenza_impegnata_kw",
  "pod",
  "pdr",
  "intestatario",
  "codice_fiscale",
  "codice_cliente",
  "indirizzo_fornitura",
  "nome_offerta_luce",
  "nome_offerta_gas",
  "codice_offerta_luce",
  "codice_offerta_gas",
];

const HIGH_VALUE_FIELDS = new Set([
  "pod",
  "pdr",
  "codice_fiscale",
  "consumo_luce_kwh",
  "consumo_gas_smc",
  "prezzo_luce_eur_kwh",
  "prezzo_gas_eur_smc",
]);

export function isMissingPdfValue(value) {
  return value === null || value === undefined || value === "" || value === "unknown";
}

export function usefulPdfFieldCount(normalized = {}) {
  return CORE_FIELDS.reduce((count, key) => count + (isMissingPdfValue(normalized[key]) ? 0 : 1), 0);
}

export function scorePdfResult(normalized = {}) {
  let score = 0;
  for (const key of CORE_FIELDS) {
    if (isMissingPdfValue(normalized[key])) continue;
    score += HIGH_VALUE_FIELDS.has(key) ? 3 : 1;
  }
  if (normalized.recognized) score += 3;
  if (["luce", "gas", "dual"].includes(normalized.commodity)) score += 2;
  if (["bolletta", "scheda_offerta"].includes(normalized.kind)) score += 1;
  return score;
}

function booleanSetting(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  return !/^(?:0|false|no|off)$/i.test(String(value).trim());
}

function combinedTextLength(pageTexts = []) {
  return pageTexts.reduce((total, page) => total + String(page || "").trim().length, 0);
}

function filenameAllowed(filename, patternSource) {
  const source = String(patternSource || "").trim();
  if (!source) return true;
  try {
    return new RegExp(source, "i").test(String(filename || ""));
  } catch {
    return false;
  }
}

export function shouldAttemptControlledOcr({
  normalized = {},
  pageTexts = [],
  filename = "",
  env = process.env,
} = {}) {
  if (!booleanSetting(env.PDF_OCR_ENABLED, true)) {
    return { attempt: false, reason: "disabled" };
  }

  if (!filenameAllowed(filename, env.PDF_OCR_FILENAME_PATTERN)) {
    return { attempt: false, reason: "filename_not_allowed" };
  }

  const textChars = Math.max(
    Number(normalized.textExtracted || 0),
    combinedTextLength(pageTexts),
  );
  const usefulFields = usefulPdfFieldCount(normalized);
  const hasStrongDeterministicResult = Boolean(normalized.recognized) && usefulFields >= 2;

  if (hasStrongDeterministicResult) {
    return { attempt: false, reason: "deterministic_result_available", textChars, usefulFields };
  }

  const insufficientText = textChars < 80 || (normalized.warnings || []).includes("testo_pdf_assente_o_insufficiente");
  const needsFallback = !normalized.recognized || usefulFields < 2;

  if (!insufficientText) {
    return { attempt: false, reason: "text_layer_available", textChars, usefulFields };
  }
  if (!needsFallback) {
    return { attempt: false, reason: "deterministic_result_protected", textChars, usefulFields };
  }

  return {
    attempt: true,
    reason: usefulFields > 0 ? "insufficient_text_layer" : "missing_text_layer",
    textChars,
    usefulFields,
  };
}

export function ocrMaxPages(env = process.env) {
  const requested = Number.parseInt(env.PDF_OCR_MAX_PAGES || "2", 10);
  if (!Number.isFinite(requested)) return 2;
  return Math.max(1, Math.min(3, requested));
}

export function ocrScale(env = process.env) {
  const requested = Number.parseFloat(env.PDF_OCR_SCALE || "2.2");
  if (!Number.isFinite(requested)) return 2.2;
  return Math.max(1.5, Math.min(3, requested));
}

export function selectOcrPageIndexes(pageCount, maxPages = 2) {
  const count = Math.max(0, Number.parseInt(pageCount || 0, 10));
  if (!count) return [];
  const limit = Math.max(1, Math.min(3, Number.parseInt(maxPages || 2, 10)));
  return Array.from({ length: Math.min(count, limit) }, (_, index) => index);
}

export function isMaterialOcrImprovement(base = {}, candidate = {}) {
  const baseScore = scorePdfResult(base);
  const candidateScore = scorePdfResult(candidate);
  const candidateFields = usefulPdfFieldCount(candidate);
  return candidateScore >= baseScore + 3 && (candidate.recognized || candidateFields >= 2);
}
