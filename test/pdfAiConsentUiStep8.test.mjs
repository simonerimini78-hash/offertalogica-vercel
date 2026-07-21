import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
const api = await fs.readFile(new URL("../api/analyze-pdf.js", import.meta.url), "utf8");
const contract = await fs.readFile(new URL("../lib/pdfDataContract.js", import.meta.url), "utf8");

test("l'interfaccia richiede un consenso facoltativo e non preselezionato", () => {
  assert.match(html, /id="pdf-ai-fallback-consent"\s+type="checkbox"/);
  assert.doesNotMatch(html, /id="pdf-ai-fallback-consent"[^>]*\bchecked\b/);
  assert.match(html, /Solo quando parser e OCR non bastano, autorizzo l’invio del PDF/);
  assert.match(html, /informativa privacy/);
});

test("il consenso viene inviato esplicitamente per ogni PDF", () => {
  assert.match(html, /formData\.append\("aiFallbackConsent", aiFallbackConsent \? "1" : "0"\)/);
  assert.match(api, /fields\.aiFallbackConsent/);
  assert.match(api, /consentGranted:\s*aiFallbackConsent/);
});

test("i campi AI sono visibili nell'anteprima ma deselezionati", () => {
  assert.match(html, /\["pdf_image_ocr", "pdf_visual_ai"\]\.includes\(entry\.provenance\?\.origin\)/);
  assert.match(html, /Lettura visuale AI da verificare e selezionare/);
  assert.match(html, /Lettura visuale AI autorizzata ma disattivata nel deployment/);
  assert.match(html, /campi provengono.*lettura visuale AI/);
  assert.match(contract, /reviewSource === "ai"/);
  assert.match(contract, /origin: aiField \? "pdf_visual_ai"/);
  assert.match(contract, /requires_explicit_selection: true/);
});

test("il reset revoca la scelta locale del consenso", () => {
  assert.match(html, /const aiConsent = document\.getElementById\("pdf-ai-fallback-consent"\)/);
  assert.match(html, /aiConsent\.checked = false/);
});
