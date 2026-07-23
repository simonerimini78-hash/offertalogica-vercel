import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  pdfAiPreviewEnvironment,
  runPdfAiEndpointObservation,
} from "../lib/pdfAiEndpoint.js";
import { pdfAiConfig } from "../lib/pdfAiConfig.js";
import { runPdfAiShadowObservation } from "../lib/pdfAiShadow.js";
import {
  buildArchivedNormalizedData,
  shouldArchivePdf,
} from "../lib/pdfArchive.js";

const NOW = 1_000_000;

function shadowConfig() {
  return pdfAiConfig({
    PDF_AI_MODE: "shadow",
    PDF_AI_MODEL: "visual-model",
    PDF_AI_TIMEOUT_MS: "12000",
    PDF_AI_RESERVE_MS: "3000",
  });
}

function endpointInput(extra = {}) {
  return {
    filePath: "/tmp/bolletta.pdf",
    filename: "bolletta.pdf",
    fileSizeBytes: 500_000,
    normalized: {
      kind: "bolletta",
      commodity: "gas",
      fornitore: "Fornitore Test",
      pdr: "03081000752041",
      page_count: 2,
    },
    deadlineAt: NOW + 20_000,
    config: shadowConfig(),
    previewEnvironment: true,
    archiveReady: true,
    ...extra,
  };
}

test("Step 8.4.2: riconosce esclusivamente Vercel Preview", () => {
  assert.equal(pdfAiPreviewEnvironment({ VERCEL_ENV: "preview" }), true);
  assert.equal(pdfAiPreviewEnvironment({ VERCEL_ENV: "production" }), false);
  assert.equal(pdfAiPreviewEnvironment({ VERCEL_ENV: "development" }), false);
  assert.equal(pdfAiPreviewEnvironment({}), false);
});

test("Step 8.4.2: produzione non legge né invia il PDF", async () => {
  let reads = 0;
  let calls = 0;
  const result = await runPdfAiEndpointObservation(endpointInput({
    previewEnvironment: false,
    readFile: async () => { reads += 1; return Buffer.from("%PDF-"); },
    shadowRunner: async () => { calls += 1; return {}; },
  }));
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "preview_environment_required");
  assert.equal(result.diagnostics.endpoint.preview_environment, false);
  assert.equal(reads, 0);
  assert.equal(calls, 0);
});

test("Step 8.4.2: la Preview non richiede pagina o token staff separati", async () => {
  let reads = 0;
  let calls = 0;
  const result = await runPdfAiEndpointObservation(endpointInput({
    readFile: async () => { reads += 1; return Buffer.from("%PDF-1.4\nTEST"); },
    shadowRunner: async () => {
      calls += 1;
      return { status: "observed", diagnostics: {}, observation: { review_plan: { applied: false } } };
    },
  }));
  assert.equal(result.status, "observed");
  assert.equal(result.diagnostics.endpoint.activation, "automatic_preview");
  assert.equal("staff_authorized" in result.diagnostics.endpoint, false);
  assert.equal(reads, 0);
  assert.equal(calls, 1);
});

test("Step 8.4.2: modalità off non legge il PDF e non chiama lo shadow", async () => {
  let reads = 0;
  let calls = 0;
  const result = await runPdfAiEndpointObservation(endpointInput({
    config: pdfAiConfig({ PDF_AI_MODE: "off", PDF_AI_MODEL: "visual-model" }),
    readFile: async () => { reads += 1; return Buffer.from("%PDF-"); },
    shadowRunner: async () => { calls += 1; return {}; },
  }));
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "shadow_mode_required");
  assert.equal(reads, 0);
  assert.equal(calls, 0);
});

test("Step 8.4.2: senza archivio privato non legge né invia il PDF", async () => {
  let reads = 0;
  let calls = 0;
  const result = await runPdfAiEndpointObservation(endpointInput({
    archiveReady: false,
    readFile: async () => { reads += 1; return Buffer.from("%PDF-"); },
    shadowRunner: async () => { calls += 1; return {}; },
  }));
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "private_archive_required");
  assert.equal(reads, 0);
  assert.equal(calls, 0);
});

test("Step 8.4.2: Preview avvia automaticamente una sola lettura", async () => {
  let reads = 0;
  let calls = 0;
  const result = await runPdfAiEndpointObservation(endpointInput({
    readFile: async (path) => {
      reads += 1;
      assert.equal(path, "/tmp/bolletta.pdf");
      return Buffer.from("%PDF-1.4\nTEST");
    },
    shadowRunner: async (input) => {
      calls += 1;
      assert.equal("userConsent" in input, false);
      assert.equal(input.fileSizeBytes, 500_000);
      const bytes = await input.loadPdfBuffer();
      assert.match(bytes.toString("ascii"), /^%PDF-/);
      return {
        shadow_version: "v106.8.8.8-consolidated-two-pass-1",
        mode: "shadow",
        attempted: true,
        status: "observed",
        reason: "shadow_observation_completed",
        review_only: true,
        public_output_unchanged: true,
        diagnostics: {},
        observation: { review_plan: { applied: false } },
      };
    },
  }));
  assert.equal(calls, 1);
  assert.equal(reads, 1);
  assert.equal(result.endpoint_version, "8.8.8.8");
  assert.equal(result.status, "observed");
  assert.equal(result.diagnostics.endpoint.activation, "automatic_preview");
});

test("Step 8.4.2: errore di lettura PDF resta non bloccante", async () => {
  let providerCalls = 0;
  const result = await runPdfAiShadowObservation({
    normalized: { kind: "bolletta", commodity: "luce", fornitore: "F", pod: "IT001E12345678", page_count: 1 },
    loadPdfBuffer: async () => { throw new Error("disk failure"); },
    filename: "bolletta.pdf",
    fileSizeBytes: 100_000,
    pageCount: 1,
    deadlineAt: NOW + 20_000,
    now: NOW,
    config: shadowConfig(),
    reviewRunner: async () => { providerCalls += 1; return {}; },
  });
  assert.equal(result.status, "error");
  assert.equal(result.reason, "pdf_read_error");
  assert.equal(providerCalls, 0);
});

test("Step 8.4.2: il sidecar AI entra soltanto nella copia privata archiviata", () => {
  const normalized = { parser_version: "legacy", recognized: true };
  const aiShadow = {
    endpoint_version: "8.8.8.8",
    status: "observed",
    public_output_unchanged: true,
    observation: { review_plan: { applied: false } },
  };
  const archived = buildArchivedNormalizedData(normalized, null, aiShadow);
  assert.equal(normalized._ai_shadow, undefined);
  assert.deepEqual(archived._ai_shadow, aiShadow);
});

test("Step 8.4.2: archivio problematic conserva osservazioni da revisionare", () => {
  const normalized = { recognized: true, needsReview: false, warnings: [], diagnostics: [] };
  assert.equal(shouldArchivePdf({
    mode: "problematic",
    normalized,
    aiShadow: {
      status: "observed",
      observation: { review_plan: { summary: { review_field_count: 1, conflict_count: 0, ignored_candidate_count: 0 } } },
    },
  }), true);
});

test("Step 8.4.2: endpoint espone solo la vista AI sanitizzata nella Preview", async () => {
  const source = await fs.readFile(new URL("../api/analyze-pdf.js", import.meta.url), "utf8");
  assert.match(source, /buildPdfAiPreview/);
  assert.match(source, /buildPdfAiStatus/);
  assert.doesNotMatch(source, /beforeOcr:/);
  assert.match(source, /parser -> OCR controllato -> AI visuale/);
  assert.match(source, /const aiPreview = previewEnvironment \? buildPdfAiPreview/);
  assert.match(source, /ai_status: aiStatus/);
  assert.match(source, /normalized: responseNormalized/);
  assert.doesNotMatch(source, /pdfAiConsent/);
  assert.doesNotMatch(source, /return json\(res, 200, \{[^}]*aiShadow/);
});
