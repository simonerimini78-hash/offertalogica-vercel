import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildPdfAiImageRequest,
  runPdfAiFallbackImages,
} from "../lib/pdfAiReader.js";
import {
  applyControlledPdfAiImageFallback,
  PDF_AI_FALLBACK_PIPELINE_VERSION,
} from "../lib/pdfAiFallback.js";

async function withJpegs(t, count = 2) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ol-ai-images-"));
  const files = [];
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
  for (let index = 0; index < count; index += 1) {
    const filePath = path.join(dir, `page-${index + 1}.jpg`);
    await fs.writeFile(filePath, jpeg);
    files.push({ filePath, mimeType: "image/jpeg", page: index + 1 });
  }
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return files;
}

function aiOutput() {
  const candidate = (field, valueText, valueNumber, unit, role, evidence) => ({
    field,
    value_text: valueText,
    value_number: valueNumber,
    unit,
    commodity: "electricity",
    page: 1,
    label: field,
    evidence,
    semantic_role: role,
    confidence: 96,
    agrees_with: [],
    contradicts: [],
  });
  return {
    document: { document_type: "bill", supplier: "Sorgenia", commodity: "electricity", customer_type: "business", page_count: 2 },
    quality: { native_text_quality: "none", visual_quality: "readable", table_density: "high", ocr_recommended: true },
    page_map: [
      { page: 1, role: "riepilogo", summary: "Dati fornitura" },
      { page: 2, role: "consumi", summary: "Riepilogo consumi" },
    ],
    candidates: [
      candidate("fornitore", "Sorgenia", null, null, "identifier", "Sorgenia"),
      candidate("kind", "bill", null, null, "classification", "Bolletta per la fornitura di energia elettrica"),
      candidate("commodity", "electricity", null, null, "classification", "Energia elettrica"),
      candidate("customer_type", "business", null, null, "classification", "P.IVA 02525880395"),
      candidate("consumo_luce_kwh", null, 4084, "kWh/anno", "actual_customer_value", "Consumo annuo 4.084,0 kWh"),
      candidate("pod", "IT001E53942290", null, null, "identifier", "POD IT001E53942290"),
      candidate("potenza_impegnata_kw", null, 10, "kW", "actual_customer_value", "Potenza impegnata 10,0 kW"),
    ],
    conflicts: [],
    review_reasons: ["Verificare i dati letti dalle pagine fotografate"],
  };
}

const env = { PDF_AI_MODE: "fallback", PDF_AI_TIMEOUT_MS: "12000" };

test("la richiesta AI per PDF grande usa immagini ordinate e non reinvia il PDF originale", async (t) => {
  const imageFiles = await withJpegs(t);
  const request = await buildPdfAiImageRequest({
    imageFiles,
    filename: "sorgenia.pdf",
    parserVersion: "v106.2-test",
    pageCount: 2,
  });
  const content = request.input[1].content;
  const images = content.filter((item) => item.type === "input_image");
  assert.equal(images.length, 2);
  assert.equal(images.every((item) => item.image_url.startsWith("data:image/jpeg;base64,")), true);
  assert.equal(content.some((item) => item.type === "input_file"), false);
  assert.equal(images.every((item) => item.detail === "high"), true);
});

test("il trasporto visuale da immagini resta disattivabile e usa una sola chiamata", async (t) => {
  const imageFiles = await withJpegs(t);
  let calls = 0;
  const result = await runPdfAiFallbackImages({
    imageFiles,
    filename: "sorgenia.pdf",
    legacyNormalized: { parser_version: "v106.2-test", page_count: 2, diagnostics: [] },
    env,
    apiKey: "test-key",
    transport: async ({ request }) => {
      calls += 1;
      assert.equal(request.input[1].content.filter((item) => item.type === "input_image").length, 2);
      return { id: "resp_images", output_text: JSON.stringify(aiOutput()) };
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(calls, 1);
});

test("il fallback immagini produce campi AI revisionabili senza valori automatici", async (t) => {
  const imageFiles = await withJpegs(t);
  const normalized = await applyControlledPdfAiImageFallback(imageFiles, {
    filename: "sorgenia.pdf",
    normalized: {
      parser_version: "v106.2-client-raster-transport-1",
      page_count: 2,
      diagnostics: [],
      kind: "unknown",
      commodity: "unknown",
      recognized: false,
      confidence: "low",
      warnings: ["pdf_grande_rasterizzato_nel_browser"],
      textExtracted: 0,
      needsReview: true,
      upload_transport: { mode: "client_rasterized_pdf_pages", original_bytes: 5_753_247, raster_bytes: 1_200_000 },
    },
    env,
    apiKey: "test-key",
    transport: async () => ({ id: "resp_images", output_text: JSON.stringify(aiOutput()) }),
  });
  assert.equal(normalized.ai.pipeline_version, PDF_AI_FALLBACK_PIPELINE_VERSION);
  assert.equal(normalized.ai.applied, true);
  assert.equal(normalized.consumo_luce_kwh, 4084);
  assert.equal(normalized.pod, "IT001E53942290");
  assert.equal(normalized.upload_transport.mode, "client_rasterized_pdf_pages");
  const field = normalized.data_contract.fields.consumo_luce_kwh;
  assert.equal(field.provenance.origin, "pdf_visual_ai");
  assert.equal(field.autofill.allowed, false);
  assert.equal(field.autofill.review_selectable, true);
  assert.equal(field.autofill.requires_explicit_selection, true);
});

test("l'interfaccia devia i PDF oltre soglia verso rasterizzazione locale", async () => {
  const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /PDF_DIRECT_UPLOAD_MAX_BYTES\s*=\s*4_000_000/);
  assert.match(html, /import\("\/vendor\/pdfjs\/pdf\.mjs"\)/);
  assert.match(html, /pdf\.worker\.mjs/);
  assert.match(html, /return fetch\("\/api\/analyze-pdf", \{ method: "POST", body: formData \}\);/);
  assert.match(html, /PDF_RASTER_TARGET_BYTES\s*=\s*3_250_000/);
  assert.match(html, /file\.size[^\n]+PDF_DIRECT_UPLOAD_MAX_BYTES/);
});

test("l'endpoint immagini applica limiti inferiori al payload Vercel", async () => {
  const source = await fs.readFile(new URL("../api/analyze-pdf.js", import.meta.url), "utf8");
  assert.match(source, /MAX_RASTER_TOTAL_BYTES\s*=\s*4_050_000/);
  assert.match(source, /MAX_RASTER_PAGES\s*=\s*8/);
  assert.match(source, /client_rasterized_pdf_pages/);
  assert.match(source, /applyControlledPdfAiImageFallback/);
});

test("gli asset PDF.js necessari sono inclusi localmente", async () => {
  const root = new URL("../public/vendor/pdfjs/", import.meta.url);
  const pdf = await fs.stat(new URL("pdf.mjs", root));
  const worker = await fs.stat(new URL("pdf.worker.mjs", root));
  assert.equal(pdf.size > 500_000, true);
  assert.equal(worker.size > 1_000_000, true);
});
