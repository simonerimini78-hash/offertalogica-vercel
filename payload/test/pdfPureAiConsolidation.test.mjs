import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const legacyRuntimeFiles = [
  "pdfAiReader.js", "pdfEvidenceArbitration.js", "pdfEvidencePolicy.js", "pdfExtract.js",
  "pdfExtractWithOcr.js", "pdfHybrid.js", "pdfOcr.js", "pdfOcrBitmap.js", "pdfOcrMerge.js",
  "pdfOcrPolicy.js", "pdfOcrText.js", "pdfOfferDetails.js", "pdfReaderContract.js",
  "pdfReaderShadow.js", "pdfSemanticSegments.js",
];

async function exists(relative) {
  try { await fs.access(path.join(root, relative)); return true; } catch { return false; }
}

test("il runtime PDF usa soltanto il lettore visuale IA consolidato", async () => {
  const api = await fs.readFile(path.join(root, "api/analyze-pdf.js"), "utf8");
  assert.match(api, /extractPdfPureAi/);
  assert.doesNotMatch(api, /pdfOcr|pdfExtract|pdfHybrid|pdfReaderShadow/);
  for (const filename of legacyRuntimeFiles) {
    assert.equal(await exists(`lib/${filename}`), false, `file legacy ancora presente: lib/${filename}`);
  }
});

test("package e deployment non includono dipendenze OCR o parser legacy", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  for (const dependency of ["@hyzyla/pdfium", "@tesseract.js-data/ita", "pdf-parse", "tesseract.js"]) {
    assert.equal(pkg.dependencies?.[dependency], undefined, `dipendenza legacy: ${dependency}`);
  }
  assert.equal(pkg.scripts?.["test:pdf-ocr-step7"], undefined);
  const vercel = JSON.parse(await fs.readFile(path.join(root, "vercel.json"), "utf8"));
  assert.equal(vercel.functions?.["api/analyze-pdf.js"]?.includeFiles, undefined);
});

test("documentazione del lettore è unica e aggiornata", async () => {
  const obsolete = [
    "LEGGIMI-DIAGNOSTICA-IA-v1.0.4.md",
    "LEGGIMI-RETRY-OPENAI-v1.0.5.md",
    "LEGGIMI-v1.0.6-OPENAI-FILE-ID.md",
    "RELEASE-PUNTO7-OCR.md",
    "docs/PDF-READER-SHADOW.md",
  ];
  for (const relative of obsolete) assert.equal(await exists(relative), false, `documento obsoleto: ${relative}`);
  const readme = await fs.readFile(path.join(root, "LEGGIMI-LETTURA-SOLO-IA.md"), "utf8");
  assert.match(readme, /pure-ai-native-pdf-v1\.0\.3/);
  assert.match(readme, /openai_file_id|file_id/);
  assert.match(readme, /20\.000\.000 byte/);
});

test("il progetto conserva esattamente 12 route API", async () => {
  const entries = await fs.readdir(path.join(root, "api"), { withFileTypes: true });
  const routes = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".js"));
  assert.equal(routes.length, 12);
});
