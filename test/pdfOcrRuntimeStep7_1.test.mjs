import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = (path) => fs.readFile(new URL(path, import.meta.url), "utf8");

test("Step 7.1: usa il modello italiano compatto LSTM", async () => {
  const source = await read("../lib/pdfOcr.js");
  assert.match(source, /4\.0\.0_best_int\/ita\.traineddata\.gz/);
  assert.doesNotMatch(source, /4\.0\.0\/ita\.traineddata\.gz/);
});

test("Step 7.1: conserva le pagine OCR già completate quando scade la pagina successiva", async () => {
  const source = await read("../lib/pdfOcr.js");
  assert.match(source, /deadline_after_partial_result/);
  assert.match(source, /completedPages\.length > 0/);
  assert.match(source, /break;/);
});

test("Step 7.1: assegna 60 secondi soltanto all'endpoint PDF", async () => {
  const config = JSON.parse(await read("../vercel.json"));
  assert.equal(config.functions["api/analyze-pdf.js"].maxDuration, 60);
  assert.equal(config.functions["api/*.js"].maxDuration, 30);
});

test("Step 7.1: il limite interno resta inferiore al limite Vercel", async () => {
  const source = await read("../api/analyze-pdf.js");
  assert.match(source, /PDF_ANALYSIS_DEADLINE_MS/);
  assert.match(source, /55_000/);
  assert.doesNotMatch(source, /Date\.now\(\) \+ 24_000/);
});
