import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildPdfAiImageRequest,
  resolvePdfAiTimeoutMs,
  runPdfAiFallbackImages,
} from "../lib/pdfAiReader.js";
import { applyControlledPdfAiImageFallback } from "../lib/pdfAiFallback.js";

async function withJpeg(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ol-ai-timeout-"));
  const filePath = path.join(dir, "page-1.jpg");
  await fs.writeFile(filePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return [{ filePath, mimeType: "image/jpeg", page: 1 }];
}

function validOutput() {
  return {
    document: { document_type: "bill", supplier: "Sorgenia", commodity: "electricity", customer_type: "business", page_count: 1 },
    quality: { native_text_quality: "none", visual_quality: "readable", table_density: "high", ocr_recommended: true },
    page_map: [{ page: 1, role: "riepilogo", summary: "Dati fornitura" }],
    candidates: [],
    conflicts: [],
    review_reasons: [],
  };
}

test("Step 8.3 accetta un timeout AI fino a 48 secondi", () => {
  assert.equal(resolvePdfAiTimeoutMs({ value: "42000", now: 1_000 }), 42_000);
  assert.equal(resolvePdfAiTimeoutMs({ value: "90000", now: 1_000 }), 48_000);
  assert.equal(resolvePdfAiTimeoutMs({ value: "invalid", now: 1_000 }), 35_000);
});

test("Step 8.3 rispetta il limite complessivo della funzione", () => {
  assert.equal(resolvePdfAiTimeoutMs({ value: "42000", deadlineAt: 31_000, now: 1_000 }), 29_000);
});

test("la richiesta immagini riduce l'output massimo senza abbassare il dettaglio visuale", async (t) => {
  const imageFiles = await withJpeg(t);
  const request = await buildPdfAiImageRequest({ imageFiles, filename: "sorgenia.pdf", pageCount: 1 });
  assert.equal(request.max_output_tokens, 3_600);
  assert.equal(request.input[1].content.find((item) => item.type === "input_image").detail, "high");
});

test("il timeout effettivo viene restituito nei diagnostici del trasporto", async (t) => {
  const imageFiles = await withJpeg(t);
  const result = await runPdfAiFallbackImages({
    imageFiles,
    filename: "sorgenia.pdf",
    legacyNormalized: { parser_version: "v106.3-test", page_count: 1, diagnostics: [] },
    env: { PDF_AI_MODE: "fallback", PDF_AI_TIMEOUT_MS: "42000" },
    apiKey: "test-key",
    transport: async () => ({ id: "resp_timeout", output_text: JSON.stringify(validOutput()) }),
  });
  assert.equal(result.status, "completed");
  assert.equal(result.timeout_ms, 42_000);
});

test("il contratto pubblico espone timeout_ms quando il provider fallisce", async (t) => {
  const imageFiles = await withJpeg(t);
  const normalized = await applyControlledPdfAiImageFallback(imageFiles, {
    filename: "sorgenia.pdf",
    normalized: { parser_version: "v106.3-test", page_count: 1, diagnostics: [], kind: "unknown", commodity: "unknown", recognized: false },
    env: { PDF_AI_MODE: "fallback", PDF_AI_TIMEOUT_MS: "42000" },
    apiKey: "test-key",
    transport: async () => { throw new Error("provider_down"); },
  });
  assert.equal(normalized.ai.applied, false);
  assert.equal(normalized.ai.reason, "provider_down");
  assert.equal(normalized.ai.timeout_ms, 42_000);
});
