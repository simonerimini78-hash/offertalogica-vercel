import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { buildArchivedNormalizedData } from "../lib/pdfArchive.js";
import { runPdfReaderShadow } from "../lib/pdfReaderShadow.js";

test("lo shadow non modifica il risultato legacy", async () => {
  const oldMode = process.env.PDF_AI_MODE;
  const oldArchiveMode = process.env.PDF_ARCHIVE_MODE;
  process.env.PDF_AI_MODE = "shadow";
  process.env.PDF_ARCHIVE_MODE = "all";
  const normalized = {
    parser_version: "legacy-test",
    kind: "bolletta",
    commodity: "luce",
    fornitore: "Test Energia",
    consumo_luce_kwh: 2700,
    diagnostics: [{
      field: "consumo_luce_kwh",
      label: "Consumo annuo luce",
      value: 2700,
      status: "found",
      confidence: "high",
      page: 1,
      source_snippet: "Consumo annuo 2.700 kWh",
      method: "text_pattern",
    }],
  };
  const before = structuredClone(normalized);
  const shadow = await runPdfReaderShadow({ legacyNormalized: normalized, apiKey: "", archiveReady: true });
  if (oldMode === undefined) delete process.env.PDF_AI_MODE;
  else process.env.PDF_AI_MODE = oldMode;
  if (oldArchiveMode === undefined) delete process.env.PDF_ARCHIVE_MODE;
  else process.env.PDF_ARCHIVE_MODE = oldArchiveMode;
  assert.deepEqual(normalized, before);
  assert.equal(shadow.enabled, true);
  assert.equal(shadow.public_output, "legacy_unchanged");
  assert.equal(shadow.ai.status, "unavailable");
  assert.equal(shadow.summary.parser_candidates, 1);
  assert.equal(shadow.summary.calculator_ready, false);
});

test("non invia il PDF all'IA quando l'archivio privato è spento", async () => {
  const oldMode = process.env.PDF_AI_MODE;
  const oldArchiveMode = process.env.PDF_ARCHIVE_MODE;
  process.env.PDF_AI_MODE = "shadow";
  process.env.PDF_ARCHIVE_MODE = "off";
  let calls = 0;
  const shadow = await runPdfReaderShadow({
    legacyNormalized: { diagnostics: [] },
    apiKey: "test-key",
    transport: async () => { calls += 1; },
  });
  if (oldMode === undefined) delete process.env.PDF_AI_MODE;
  else process.env.PDF_AI_MODE = oldMode;
  if (oldArchiveMode === undefined) delete process.env.PDF_ARCHIVE_MODE;
  else process.env.PDF_ARCHIVE_MODE = oldArchiveMode;
  assert.equal(shadow.enabled, false);
  assert.equal(shadow.reason, "archive_disabled");
  assert.equal(calls, 0);
});

test("non invia il PDF se l'archivio è richiesto ma non configurato", async () => {
  const oldMode = process.env.PDF_AI_MODE;
  const oldArchiveMode = process.env.PDF_ARCHIVE_MODE;
  process.env.PDF_AI_MODE = "shadow";
  process.env.PDF_ARCHIVE_MODE = "all";
  let calls = 0;
  const shadow = await runPdfReaderShadow({
    legacyNormalized: { diagnostics: [] },
    apiKey: "test-key",
    archiveReady: false,
    transport: async () => { calls += 1; },
  });
  if (oldMode === undefined) delete process.env.PDF_AI_MODE;
  else process.env.PDF_AI_MODE = oldMode;
  if (oldArchiveMode === undefined) delete process.env.PDF_ARCHIVE_MODE;
  else process.env.PDF_ARCHIVE_MODE = oldArchiveMode;
  assert.equal(shadow.enabled, false);
  assert.equal(shadow.reason, "archive_unavailable");
  assert.equal(calls, 0);
});

test("lo shadow viene aggiunto solo alla copia privata archiviata", () => {
  const normalized = { parser_version: "legacy-test", consumo_luce_kwh: 2700 };
  const shadow = { enabled: true, pipeline_version: "shadow-test" };
  const archived = buildArchivedNormalizedData(normalized, shadow);
  assert.deepEqual(normalized, { parser_version: "legacy-test", consumo_luce_kwh: 2700 });
  assert.deepEqual(archived._reader_shadow, shadow);
  assert.equal(normalized._reader_shadow, undefined);
});

test("l'endpoint pubblico conserva la risposta legacy e le API restano 12", async () => {
  const source = await fs.readFile(new URL("../api/analyze-pdf.js", import.meta.url), "utf8");
  assert.match(source, /return json\(res, 200, \{ ok: true, normalized, archive \}\)/);
  assert.doesNotMatch(source, /return json\(res, 200, \{[^}]*shadow/);
  const apiFiles = (await fs.readdir(new URL("../api/", import.meta.url))).filter((name) => name.endsWith(".js"));
  assert.equal(apiFiles.length, 12);
});
