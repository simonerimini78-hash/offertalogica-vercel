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
  assert.match(source, /analysisDeadlineAt = Date\.now\(\) \+ 24_000/);
});

test("Step 7: il motore usa italiano locale, PDFium grigio e un solo worker riutilizzato", async () => {
  const source = await read("../lib/pdfOcr.js");
  assert.match(source, /@tesseract\.js-data\/ita\/4\.0\.0\/ita\.traineddata\.gz/);
  assert.match(source, /colorSpace: "Gray"/);
  assert.match(source, /render: "bitmap"/);
  assert.equal((source.match(/createItalianWorker\(/g) || []).length, 2); // definizione + una chiamata
  assert.match(source, /worker\.terminate/);
});

test("Step 7: nessuna modifica a interfaccia, parser deterministico o hotfix origini", async () => {
  const packageFiles = await fs.readdir(new URL("..", import.meta.url), { recursive: true });
  assert.equal(packageFiles.includes("public/index.html"), false);
  assert.equal(packageFiles.includes("lib/pdfExtract.js"), false);
  assert.equal(packageFiles.includes("lib/http.js"), false);
});
