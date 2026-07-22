import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { buildPdfAiPreview } from "../lib/pdfAiPreview.js";

test("Step 8.4.2: la lettura visuale non dipende da pagine o token staff", async () => {
  const endpoint = await fs.readFile(new URL("../api/analyze-pdf.js", import.meta.url), "utf8");
  assert.doesNotMatch(endpoint, /hasValidStaffToken/);
  assert.match(endpoint, /const aiPreview = previewEnvironment \? buildPdfAiPreview/);
});

test("Step 8.4.2: il frontend non contiene checkbox o testo di consenso AI", async () => {
  const source = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(source, /pdf-ai-consent/i);
  assert.doesNotMatch(source, /pdfAiConsent/);
  assert.doesNotMatch(source, /Consento l.invio/i);
});

test("Step 8.4.2: la Preview legge automaticamente e divide i PDF fotografici grandi", async () => {
  const source = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(source, /PDF_DIRECT_UPLOAD_MAX_BYTES = 3_500_000/);
  assert.match(source, /PDF_LARGE_UPLOAD_CHUNK_BYTES = 2_400_000/);
  assert.match(source, /PDF_LARGE_UPLOAD_MAX_BYTES = 25_000_000/);
  assert.match(source, /uploadMode: "assemble"/);
  assert.doesNotMatch(source, /X-Staff-Token/);
  assert.match(source, /Dati letti dalla fotografia — da verificare/);
  assert.match(source, /Nessun elemento viene inserito automaticamente nel modulo/);
});

test("Step 8.4.2: la vista AI contiene solo candidati sanitizzati e revisionabili", () => {
  const preview = buildPdfAiPreview({
    status: "observed",
    observation: {
      document: { document_type: "bill", commodity: "electricity", customer_type: "consumer", page_count: 2 },
      review_plan: {
        review_fields: [{
          field: "fornitore",
          normalized_value: "Energia Test",
          page: 1,
          label: "Fornitore",
          evidence: "Fornitore Energia Test",
          confidence: 93,
        }],
        corroborated_fields: [{
          field: "pod",
          normalized_value: "IT001E12345678",
          page: 1,
          evidence: "POD IT001E12345678",
          confidence: 96,
        }],
        conflicts: [],
      },
    },
  });
  assert.equal(preview.review_only, true);
  assert.equal(preview.automatic_fill, false);
  assert.equal(preview.fields[0].value, "Energia Test");
  assert.equal(preview.corroborated[0].status, "confermato_parser_ocr");
  assert.equal(JSON.stringify(preview).includes("api_key"), false);
});

test("Step 8.4.2: nessuna vista AI viene restituita per skip o errore", () => {
  assert.equal(buildPdfAiPreview({ status: "skipped" }), null);
  assert.equal(buildPdfAiPreview({ status: "error" }), null);
  assert.equal(buildPdfAiPreview(null), null);
});
