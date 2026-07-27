function compact(value, maxLength = 500) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function diagnosticToken(value, fallback = "UNKNOWN") {
  const token = compact(value, 120)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return token || fallback;
}

export function classifyPdfAnalysisError(error) {
  const message = compact(error?.message || error, 500);
  let match = message.match(/^openai_http_(\d{3})\b/i);
  if (match) return { diagnosticCode: `OPENAI_HTTP_${match[1]}`, internalMessage: message };

  match = message.match(/^openai_incomplete(?::(.+))?$/i);
  if (match) {
    return {
      diagnosticCode: `OPENAI_INCOMPLETE_${diagnosticToken(match[1], "UNKNOWN")}`,
      internalMessage: message,
    };
  }

  if (/^openai_empty_output\b/i.test(message)) return { diagnosticCode: "OPENAI_EMPTY_OUTPUT", internalMessage: message };
  if (/^openai_refusal\b/i.test(message)) return { diagnosticCode: "OPENAI_REFUSAL", internalMessage: message };
  if (/^openai_invalid_output\b/i.test(message)) return { diagnosticCode: "OPENAI_INVALID_OUTPUT", internalMessage: message };
  if (/^openai_timeout\b/i.test(message)) return { diagnosticCode: "OPENAI_TIMEOUT", internalMessage: message };
  if (/^openai_insufficient_time_budget\b/i.test(message)) return { diagnosticCode: "OPENAI_INSUFFICIENT_TIME_BUDGET", internalMessage: message };
  if (/^openai_missing_api_key\b/i.test(message)) return { diagnosticCode: "OPENAI_MISSING_API_KEY", internalMessage: message };
  if (/^openai_/i.test(message)) return { diagnosticCode: diagnosticToken(message, "OPENAI_ERROR"), internalMessage: message };
  if (/^pure_ai_/i.test(message)) return { diagnosticCode: diagnosticToken(message, "PURE_AI_ERROR"), internalMessage: message };
  if (error instanceof SyntaxError) return { diagnosticCode: "OPENAI_JSON_PARSE_ERROR", internalMessage: message || "SyntaxError" };
  return { diagnosticCode: "PDF_ANALYSIS_INTERNAL_ERROR", internalMessage: message || compact(error?.name, 120) || "unknown" };
}

export function pdfAnalysisDiagnosticLog({
  error,
  publicCode,
  stage,
  ingressMode,
  fileMetadata,
  elapsedMs,
  remainingMs,
  archive,
} = {}) {
  const diagnostic = classifyPdfAnalysisError(error);
  return {
    event: "pdf_analysis_failed",
    public_code: String(publicCode || "PDF_ANALYSIS_ERROR"),
    diagnostic_code: diagnostic.diagnosticCode,
    stage: String(stage || "unknown"),
    ingress_mode: String(ingressMode || "unknown"),
    filename: compact(fileMetadata?.originalFilename || "", 180) || null,
    file_size: Number(fileMetadata?.fileSize || 0) || null,
    elapsed_ms: Math.max(0, Number(elapsedMs || 0)),
    remaining_ms: Number.isFinite(Number(remainingMs)) ? Number(remainingMs) : null,
    archive: archive && typeof archive === "object" ? archive : null,
    internal_message: diagnostic.internalMessage,
  };
}
