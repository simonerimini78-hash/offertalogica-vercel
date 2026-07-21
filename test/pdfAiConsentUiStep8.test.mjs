import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
const api = await fs.readFile(new URL("../api/analyze-pdf.js", import.meta.url), "utf8");
const contract = await fs.readFile(new URL("../lib/pdfDataContract.js", import.meta.url), "utf8");

test("la lettura visuale AI è automatica e il quadro consenso è rimosso", () => {
  assert.doesNotMatch(html, /id="pdf-ai-fallback-consent"/);
  assert.doesNotMatch(html, /formData\.append\("aiFallbackConsent"/);
  assert.doesNotMatch(api, /fields\.aiFallbackConsent/);
  assert.doesNotMatch(api, /consentGranted/);
  assert.match(html, /il sistema tenta automaticamente una lettura visuale AI/);
  assert.match(html, /visualAiFallback:\s*"automatic"/);
});

test("il server applica direttamente il fallback controllato dopo parser e OCR", () => {
  assert.match(api, /applyControlledPdfAiFallback\(pdfFilePath/);
  assert.doesNotMatch(api, /aiFallbackConsent/);
});

test("i campi AI restano visibili nell'anteprima ma deselezionati", () => {
  assert.match(html, /\["pdf_image_ocr", "pdf_visual_ai"\]\.includes\(entry\.provenance\?\.origin\)/);
  assert.match(html, /Lettura visuale AI da verificare e selezionare/);
  assert.match(html, /Lettura visuale AI automatica disattivata nel deployment/);
  assert.match(html, /campi provengono.*lettura visuale AI/);
  assert.match(contract, /reviewSource === "ai"/);
  assert.match(contract, /origin: aiField \? "pdf_visual_ai"/);
  assert.match(contract, /requires_explicit_selection: true/);
});

test("il reset non contiene più stato locale per il consenso AI", () => {
  assert.doesNotMatch(html, /const aiConsent = document\.getElementById\("pdf-ai-fallback-consent"\)/);
  assert.doesNotMatch(html, /aiConsent\.checked = false/);
});
