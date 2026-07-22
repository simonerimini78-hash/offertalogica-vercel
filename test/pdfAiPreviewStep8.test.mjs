import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { hasValidStaffToken } from "../lib/staffAuth.js";

test("Step 8.4: il token staff viene validato senza esporlo nei risultati", () => {
  const env = { STAFF_PREVIEW_TOKEN: "token-segreto" };
  assert.equal(hasValidStaffToken({ headers: { "x-staff-token": "token-segreto" } }, env), true);
  assert.equal(hasValidStaffToken({ headers: { authorization: "Bearer token-segreto" } }, env), true);
  assert.equal(hasValidStaffToken({ headers: { "x-staff-token": "token-errato" } }, env), false);
  assert.equal(hasValidStaffToken({ headers: {} }, env), false);
  assert.equal(hasValidStaffToken({ headers: { "x-staff-token": "token-segreto" } }, {}), false);
});

test("Step 8.4: il controllo AI è nascosto e non preselezionato nel frontend", async () => {
  const source = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(source, /id="pdf-ai-consent-staff"[^>]*hidden/);
  assert.match(source, /id="pdf-ai-consent-checkbox" type="checkbox" autocomplete="off"/);
  assert.doesNotMatch(source, /id="pdf-ai-consent-checkbox"[^>]*checked/);
  assert.match(source, /staffModeAttiva\(\) && LEAD_STATE\.pdfAiPreviewAvailable/);
  assert.match(source, /LEAD_STATE\.pdfAiPreviewAvailable = Boolean\(payload\.pdfAiPreviewAvailable\)/);
});

test("Step 8.4: consenso e token sono inviati soltanto dal controllo staff Preview", async () => {
  const source = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(source, /const pdfAiConsent = Boolean\([\s\S]*pdfAiPreviewAttiva\(\)[\s\S]*pdf-ai-consent-checkbox/);
  assert.match(source, /if \(pdfAiConsent && pdfAiStaffToken\) \{/);
  assert.match(source, /formData\.append\("pdfAiConsent", "true"\)/);
  assert.match(source, /requestHeaders\["X-Staff-Token"\] = pdfAiStaffToken/);
  assert.match(source, /azzeraConsensoPdfAiStaff\(\);\n  const processedIds/);
});

test("Step 8.4: disponibilità AI dichiarata soltanto in Preview con modalità shadow", async () => {
  const source = await fs.readFile(new URL("../api/staff-preview.js", import.meta.url), "utf8");
  assert.match(source, /VERCEL_ENV[\s\S]*=== "preview"/);
  assert.match(source, /aiConfig\.mode === "shadow"/);
  assert.match(source, /pdfAiPreviewAvailable/);
  assert.match(source, /OPENAI_API_KEY/);
  assert.match(source, /pdfArchiveConfigured\(\)/);
});

test("Step 8.4: nessun candidato AI entra nella risposta pubblica", async () => {
  const source = await fs.readFile(new URL("../api/analyze-pdf.js", import.meta.url), "utf8");
  assert.match(source, /return json\(res, 200, \{ ok: true, normalized, archive \}\)/);
  assert.doesNotMatch(source, /return json\(res, 200, \{[^}]*aiShadow/);
});
