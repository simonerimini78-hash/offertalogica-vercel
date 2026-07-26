import test from "node:test";
import assert from "node:assert/strict";
import { classifyPdfAnalysisError, pdfAnalysisDiagnosticLog } from "../lib/pdfAnalysisDiagnostics.js";

test("classifica gli errori OpenAI senza esporre il corpo HTTP nel codice diagnostico", () => {
  const result = classifyPdfAnalysisError(new Error('openai_http_400:{"error":{"message":"file too large"}}'));
  assert.equal(result.diagnosticCode, "OPENAI_HTTP_400");
  assert.match(result.internalMessage, /file too large/);
});

test("classifica le risposte incomplete con il motivo", () => {
  assert.equal(
    classifyPdfAnalysisError(new Error("openai_incomplete:max_output_tokens")).diagnosticCode,
    "OPENAI_INCOMPLETE_MAX_OUTPUT_TOKENS",
  );
});

test("distingue output vuoto, rifiuto e output invalido", () => {
  assert.equal(classifyPdfAnalysisError(new Error("openai_empty_output")).diagnosticCode, "OPENAI_EMPTY_OUTPUT");
  assert.equal(classifyPdfAnalysisError(new Error("openai_refusal:blocked")).diagnosticCode, "OPENAI_REFUSAL");
  assert.equal(classifyPdfAnalysisError(new Error("openai_invalid_output")).diagnosticCode, "OPENAI_INVALID_OUTPUT");
});

test("costruisce un log strutturato con tempi, ingresso e archivio", () => {
  const payload = pdfAnalysisDiagnosticLog({
    error: new Error("openai_incomplete:max_output_tokens"),
    publicCode: "AI_INVALID_RESULT",
    stage: "openai_analysis",
    ingressMode: "supabase_signed_upload",
    fileMetadata: { originalFilename: "Irina.pdf", fileSize: 9_000_000 },
    elapsedMs: 47_100,
    remainingMs: 4_900,
    archive: { stored: false, reason: "insufficient_time_budget" },
  });
  assert.equal(payload.diagnostic_code, "OPENAI_INCOMPLETE_MAX_OUTPUT_TOKENS");
  assert.equal(payload.stage, "openai_analysis");
  assert.equal(payload.ingress_mode, "supabase_signed_upload");
  assert.equal(payload.file_size, 9_000_000);
  assert.equal(payload.archive.reason, "insufficient_time_budget");
});
