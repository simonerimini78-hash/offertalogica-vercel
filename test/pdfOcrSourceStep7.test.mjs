import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = (path) => fs.readFile(new URL(path, import.meta.url), "utf8");

test("Step 7: l'API usa il wrapper OCR controllato e conserva i controlli esistenti", async () => {
  const source = await read("../api/analyze-pdf.js");
  assert.match(source, /extractPdfWithControlledOcr/);
  assert.match(source, /requireAllowedOrigin/);
  assert.match(source, /enforceRateLimit/);
  assert.match(source, /isRealPdf/);
  assert.match(source, /PDF_ANALYSIS_DEADLINE_MS \|\| "55000"/);
  assert.match(source, /analysisDeadlineAt = Date\.now\(\) \+ analysisDeadlineMs/);
});

test("Step 7: il motore usa italiano locale, PDFium grigio e un solo worker riutilizzato", async () => {
  const source = await read("../lib/pdfOcr.js");
  assert.match(source, /@tesseract\.js-data[\\/\"]+ita[\\/\"]+4\.0\.0_best_int/);
  assert.match(source, /colorSpace: "Gray"/);
  assert.match(source, /render: "bitmap"/);
  assert.match(source, /PDFiumLibrary\.init\(\{ wasmBinary \}\)/);
  assert.equal((source.match(/createItalianWorker\(/g) || []).length, 2);
  assert.match(source, /worker\.terminate/);
});

test("Step 7.2: parser deterministico e hotfix origini restano separati dall'OCR", async () => {
  const parser = await read("../lib/pdfExtract.js");
  const http = await read("../lib/http.js");
  assert.doesNotMatch(parser, /pdfOcr|tesseract|pdfium/i);
  assert.doesNotMatch(http, /pdfOcr|tesseract|pdfium/i);
});
