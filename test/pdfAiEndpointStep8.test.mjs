import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  pdfAiConsentFromFields,
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
    staffAuthorized: true,
    archiveReady: true,
    ...extra,
  };
}

test("Step 8.4: il consenso AI arriva soltanto dal campo esplicito dedicato", () => {
  assert.equal(pdfAiConsentFromFields({ pdfAiConsent: "si" }), true);
  assert.equal(pdfAiConsentFromFields({ pdfAiConsent: ["true"] }), true);
  assert.equal(pdfAiConsentFromFields({ pdfAiConsent: "false" }), false);
  assert.equal(pdfAiConsentFromFields({ archiveContext: JSON.stringify({ consentService: true }) }), false);
  assert.equal(pdfAiConsentFromFields({ consentService: true, consent: true }), false);
});

test("Step 8.4: riconosce esclusivamente Vercel Preview", () => {
  assert.equal(pdfAiPreviewEnvironment({ VERCEL_ENV: "preview" }), true);
  assert.equal(pdfAiPreviewEnvironment({ VERCEL_ENV: "production" }), false);
  assert.equal(pdfAiPreviewEnvironment({ VERCEL_ENV: "development" }), false);
  assert.equal(pdfAiPreviewEnvironment({}), false);
});

test("Step 8.4: consenso contraffatto in produzione non legge né invia il PDF", async () => {
  let reads = 0;
  let calls = 0;
  const result = await runPdfAiEndpointObservation(endpointInput({
    userConsent: true,
    previewEnvironment: false,
    staffAuthorized: true,
    readFile: async () => { reads += 1; return Buffer.from("%PDF-"); },
    shadowRunner: async () => { calls += 1; return {}; },
  }));
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "preview_environment_required");
  assert.equal(result.diagnostics.endpoint.preview_environment, false);
  assert.equal(reads, 0);
  assert.equal(calls, 0);
});

test("Step 8.4: Preview senza autorizzazione staff non legge né invia il PDF", async () => {
  let reads = 0;
  let calls = 0;
  const result = await runPdfAiEndpointObservation(endpointInput({
    userConsent: true,
    previewEnvironment: true,
    staffAuthorized: false,
    readFile: async () => { reads += 1; return Buffer.from("%PDF-"); },
    shadowRunner: async () => { calls += 1; return {}; },
  }));
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "staff_authorization_required");
  assert.equal(result.diagnostics.endpoint.staff_authorized, false);
  assert.equal(reads, 0);
  assert.equal(calls, 0);
});

test("Step 8.4: modalità off non legge il PDF e non chiama lo shadow", async () => {
  let reads = 0;
  let calls = 0;
  const result = await runPdfAiEndpointObservation(endpointInput({
    config: pdfAiConfig({ PDF_AI_MODE: "off", PDF_AI_MODEL: "visual-model" }),
    userConsent: true,
    readFile: async () => { reads += 1; return Buffer.from("%PDF-"); },
    shadowRunner: async () => { calls += 1; return {}; },
  }));
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "shadow_mode_required");
  assert.equal(reads, 0);
  assert.equal(calls, 0);
});

test("Step 8.4: senza archivio privato non legge né invia il PDF", async () => {
  let reads = 0;
  let calls = 0;
  const result = await runPdfAiEndpointObservation(endpointInput({
    userConsent: true,
    archiveReady: false,
    readFile: async () => { reads += 1; return Buffer.from("%PDF-"); },
    shadowRunner: async () => { calls += 1; return {}; },
  }));
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "private_archive_required");
  assert.equal(reads, 0);
  assert.equal(calls, 0);
});

test("Step 8.4: senza consenso esplicito la policy nega prima della lettura del file", async () => {
  let reads = 0;
  const result = await runPdfAiEndpointObservation(endpointInput({
    userConsent: false,
    readFile: async () => { reads += 1; return Buffer.from("%PDF-"); },
  }));
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "missing_explicit_consent");
  assert.equal(result.attempted, false);
  assert.equal(reads, 0);
});

test("Step 8.4: con consenso e archivio il PDF viene letto soltanto dentro il tentativo autorizzato", async () => {
  let reads = 0;
  let calls = 0;
  const result = await runPdfAiEndpointObservation(endpointInput({
    userConsent: true,
    readFile: async (path) => {
      reads += 1;
      assert.equal(path, "/tmp/bolletta.pdf");
      return Buffer.from("%PDF-1.4\nTEST");
    },
    shadowRunner: async (input) => {
      calls += 1;
      assert.equal(input.userConsent, true);
      assert.equal(input.fileSizeBytes, 500_000);
      assert.equal(input.pageCount, 2);
      const bytes = await input.loadPdfBuffer();
      assert.match(bytes.toString("ascii"), /^%PDF-/);
      return {
        shadow_version: "8.2.0",
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
  assert.equal(result.endpoint_version, "8.4.0");
  assert.equal(result.status, "observed");
  assert.equal(result.public_output_unchanged, true);
  assert.equal(result.observation.review_plan.applied, false);
});

test("Step 8.4: errore di lettura PDF resta non bloccante e non chiama il provider", async () => {
  let providerCalls = 0;
  const result = await runPdfAiShadowObservation({
    normalized: { kind: "bolletta", commodity: "luce", fornitore: "F", pod: "IT001E12345678", page_count: 1 },
    loadPdfBuffer: async () => { throw new Error("disk failure"); },
    filename: "bolletta.pdf",
    fileSizeBytes: 100_000,
    pageCount: 1,
    userConsent: true,
    deadlineAt: NOW + 20_000,
    now: NOW,
    config: shadowConfig(),
    reviewRunner: async () => { providerCalls += 1; return {}; },
  });
  assert.equal(result.status, "error");
  assert.equal(result.reason, "pdf_read_error");
  assert.equal(result.public_output_unchanged, true);
  assert.equal(providerCalls, 0);
});

test("Step 8.4: il sidecar AI entra soltanto nella copia privata archiviata", () => {
  const normalized = { parser_version: "legacy", recognized: true };
  const aiShadow = {
    endpoint_version: "8.4.0",
    status: "observed",
    public_output_unchanged: true,
    observation: { review_plan: { applied: false } },
  };
  const archived = buildArchivedNormalizedData(normalized, null, aiShadow);
  assert.equal(normalized._ai_shadow, undefined);
  assert.deepEqual(archived._ai_shadow, aiShadow);
  assert.equal(archived.parser_version, "legacy");
});

test("Step 8.4: archivio problematic conserva osservazioni da revisionare o in conflitto", () => {
  const normalized = { recognized: true, needsReview: false, warnings: [], diagnostics: [] };
  assert.equal(shouldArchivePdf({
    mode: "problematic",
    normalized,
    aiShadow: {
      status: "observed",
      observation: { review_plan: { summary: { review_field_count: 1, conflict_count: 0, ignored_candidate_count: 0 } } },
    },
  }), true);
  assert.equal(shouldArchivePdf({
    mode: "problematic",
    normalized,
    aiShadow: {
      status: "observed",
      observation: { review_plan: { summary: { review_field_count: 0, conflict_count: 0, ignored_candidate_count: 0 } } },
    },
  }), false);
});

test("Step 8.4: endpoint pubblico usa un solo shadow attivo e non espone il sidecar", async () => {
  const source = await fs.readFile(new URL("../api/analyze-pdf.js", import.meta.url), "utf8");
  assert.match(source, /runPdfAiEndpointObservation/);
  assert.doesNotMatch(source, /runPdfReaderShadow/);
  assert.match(source, /fields,/);
  assert.match(source, /previewEnvironment: pdfAiPreviewEnvironment\(process\.env\)/);
  assert.match(source, /staffAuthorized: hasValidStaffToken\(req\)/);
  assert.match(source, /aiShadow,/);
  assert.match(source, /return json\(res, 200, \{ ok: true, normalized, archive \}\)/);
  assert.doesNotMatch(source, /return json\(res, 200, \{[^}]*aiShadow/);
});
