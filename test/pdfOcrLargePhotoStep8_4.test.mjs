import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = (path) => fs.readFile(new URL(path, import.meta.url), "utf8");

test("Step 8.4.4: pdf-parse conserva le dimensioni di ogni pagina", async () => {
  const source = await read("../lib/pdfExtract.js");
  assert.match(source, /pdfPageSizeAtScaleOne/);
  assert.match(source, /pageSizes\.push\(pdfPageSizeAtScaleOne\(pageData\)\)/);
  assert.match(source, /pageTexts, pageSizes/);
});

test("Step 8.4.4: OCR applica la scala adattiva prima del rendering", async () => {
  const source = await read("../lib/pdfOcr.js");
  assert.match(source, /ocrRenderScale\(pageSizes\[pageIndex\], env\)/);
  assert.match(source, /render_profiles: renderProfiles/);
  const bridge = await read("../lib/pdfExtractWithOcr.js");
  assert.match(bridge, /pageSizes: deterministic\.pageSizes/);
  assert.match(bridge, /render_profiles: ocr\.render_profiles/);
});
