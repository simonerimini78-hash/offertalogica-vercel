import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { patchPdfAiFallbackSafe, patchPdfAiReaderSafe } from "../tools/apply-step8_8_8_1.mjs";
import { verifySources } from "../tools/verify-step8_8_8_1.mjs";

function fallbackFixture() {
  return `import { applyPdfDataContract } from "./pdfDataContract.js";
import { applyPdfFieldValidation } from "./pdfFieldValidation.js";
import { runPdfAiFallback, runPdfAiFallbackImages } from "./pdfAiReader.js";
import { canonicalPdfField, createPdfCandidate } from "./pdfReaderContract.js";
export const PDF_AI_FALLBACK_PIPELINE_VERSION = "v106.8.4-business-consultant-readiness-1";
function normalizeIdentifier() { return null; }
function confidenceThreshold() { return 92; }
function explicitPowerThreshold() { return null; }
function addExplicitTaxIdCandidate(ai) {
  if ((ai.candidates || []).some((candidate) => canonicalPdfField(candidate.field) === "codice_fiscale")) return;
  const evidenceSources = [...(ai.candidates || [])];
  return evidenceSources;
}
function effectiveConfidenceThreshold(candidate) {
  return explicitPowerThreshold(candidate) ?? confidenceThreshold(candidate?.field);
}
function candidateRejection(candidate) {
  if (candidate.field === "prezzo_luce_eur_kwh") return "average_unit_cost_not_contract_price";
  if (candidate.field === "consumo_gas_smc") return "billing_period_consumption_not_annual";
  return null;
}
function unique(values) { return values; }
function mergeCompletedAiResult(base, ai, policy) {
  const modelCandidateCount = (ai.candidates || []).length;
  addExplicitTaxIdCandidate(ai);
  const aiConflictFields = new Set();
  const filledFields = [];
  return {
    request_profile: ai.request_profile || "full",
    filled_fields: unique(filledFields).sort(),
    modelCandidateCount, aiConflictFields, base, policy,
  };
}
`;
}

function readerFixture() {
  return `import fs from "node:fs/promises";
export const PDF_AI_ADAPTER_VERSION = "2.4.3";
const OUTPUT_SCHEMA = {};
const EMERGENCY_OUTPUT_SCHEMA = {};
const SYSTEM_PROMPT = \`Main prompt.
- If evidence is absent or ambiguous, return no candidate.
- Return JSON matching the supplied schema and no prose.\`;
const EMERGENCY_SYSTEM_PROMPT = \`Emergency prompt.\`;
function pdfFieldNames() { return []; }
function candidateHint(value) { return value; }
function normalizeImageMime() { return "image/jpeg"; }
export async function buildPdfAiImageRequest({ imageFiles = [], filename = "documento.pdf", parserVersion = "unknown", parserCandidates = [], pageCount = 0, diagnostics = [], model = "model", profile = "full" } = {}) {
  const emergency = profile === "emergency";
  const ordered = imageFiles;
  const requestedFields = emergency
    ? ["fornitore", "kind", "commodity", "customer_type", "intestatario", "codice_fiscale", "codice_cliente", "pod", "pdr", "indirizzo_fornitura"]
    : pdfFieldNames();
  const context = {
    parser_version: parserVersion,
    requested_fields: requestedFields,
    parser_and_ocr_candidates: emergency ? [] : parserCandidates.map(candidateHint),
    source_transport: "client_rasterized_pdf_pages",
    original_filename: filename,
    page_count: Number(pageCount || ordered.length),
    request_profile: emergency ? "emergency_first_page_identity" : "full_visual_semantic",
  };
  const imageContent = [];
  return {
    model,
    max_output_tokens: emergency ? 1_200 : 3_600,
    input: [
      { role: "system", content: emergency ? EMERGENCY_SYSTEM_PROMPT : SYSTEM_PROMPT },
      { role: "user", content: [{
        type: "input_text",
        text: emergency
          ? \`Recover only the directly visible identity and supply fields from this first page:\\n\${JSON.stringify(context)}\`
          : \`Analyze these ordered rasterized PDF pages using these untrusted parser/OCR hints:\\n\${JSON.stringify(context)}\`,
      }] },
    ],
    text: { format: {
      name: emergency ? "offertalogica_pdf_emergency_identity" : "offertalogica_pdf_candidates",
      schema: emergency ? EMERGENCY_OUTPUT_SCHEMA : OUTPUT_SCHEMA,
    } },
  };
}
async function runPdfAi() { return { status: "completed", candidates: [] }; }
export async function runPdfAiFallbackImages(options = {}) {
  const imageFiles = options.imageFiles || [];
  const primary = await runPdfAi({ ...options, requiredMode: "fallback", imageFiles, imageProfile: "full" });
  if (primary.status === "completed" || primary.reason !== "openai_timeout") return primary;
  return primary;
}
`;
}

function syntaxCheck(source, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "step8881-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, source, "utf8");
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("applica base 8.8.8 e revisione 8.8.8.1 in un solo passaggio", () => {
  const fallback = patchPdfAiFallbackSafe(fallbackFixture());
  const reader = patchPdfAiReaderSafe(readerFixture());
  assert.equal(fallback.changed, true);
  assert.equal(reader.changed, true);
  assert.match(fallback.source, /v106\.8\.8\.1-safe-consensus-recovery-1/);
  assert.match(reader.source, /PDF_AI_ADAPTER_VERSION = "2\.4\.5"/);
  syntaxCheck(fallback.source, "pdfAiFallback.mjs");
  syntaxCheck(reader.source, "pdfAiReader.mjs");
});

test("è idempotente e verifica versioni effettive", () => {
  const fallback = patchPdfAiFallbackSafe(fallbackFixture()).source;
  const reader = patchPdfAiReaderSafe(readerFixture()).source;
  assert.equal(patchPdfAiFallbackSafe(fallback).changed, false);
  assert.equal(patchPdfAiReaderSafe(reader).changed, false);
  const helper = fs.readFileSync(new URL("../lib/pdfAiVisualRecovery.js", import.meta.url), "utf8");
  const report = verifySources({ fallback, reader, helper });
  assert.equal(report.pipelineVersion, true);
  assert.equal(report.pdrConsensusRequired, true);
});
