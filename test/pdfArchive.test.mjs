import test from "node:test";
import assert from "node:assert/strict";
import { buildArchivedNormalizedData, shouldArchivePdf } from "../lib/pdfArchive.js";

test("modalità archivio all conserva ogni PDF", () => {
  assert.equal(shouldArchivePdf({ mode: "all", normalized: { recognized: true, needsReview: false } }), true);
});

test("modalità problematic conserva solo esiti non completi", () => {
  assert.equal(shouldArchivePdf({ mode: "problematic", normalized: { recognized: true, needsReview: false, warnings: [], diagnostics: [] } }), false);
  assert.equal(shouldArchivePdf({ mode: "problematic", normalized: { recognized: true, needsReview: true, warnings: [], diagnostics: [] } }), true);
  assert.equal(shouldArchivePdf({ mode: "problematic", error: new Error("parse") }), true);
  assert.equal(shouldArchivePdf({
    mode: "problematic",
    normalized: { recognized: true, needsReview: false, warnings: [], diagnostics: [] },
    shadow: { enabled: true, arbitration: { counts: { blocked: 1 } } },
  }), true);
});

test("modalità off non conserva", () => {
  assert.equal(shouldArchivePdf({ mode: "off", normalized: { recognized: false } }), false);
});

test("i dati shadow restano nell'archivio privato senza mutare il normalizzato", () => {
  const normalized = { parser_version: "legacy", recognized: true };
  const shadow = { enabled: true, pipeline_version: "shadow-test" };
  const archived = buildArchivedNormalizedData(normalized, shadow);
  assert.equal(normalized._reader_shadow, undefined);
  assert.deepEqual(archived._reader_shadow, shadow);
});

test("archivia PDF e metadati usando storage privato e tabella diagnostica", async (t) => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { archivePdfAnalysis } = await import("../lib/pdfArchive.js");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ol-pdf-archive-"));
  const filePath = path.join(dir, "test.pdf");
  await fs.writeFile(filePath, Buffer.from("%PDF-1.4\nTEST"));

  const oldFetch = globalThis.fetch;
  const oldEnv = {
    PDF_ARCHIVE_MODE: process.env.PDF_ARCHIVE_MODE,
    PDF_ARCHIVE_BUCKET: process.env.PDF_ARCHIVE_BUCKET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  process.env.PDF_ARCHIVE_MODE = "all";
  process.env.PDF_ARCHIVE_BUCKET = "pdf-test-archive";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/rest/v1/pdf_analyses")) {
      const record = JSON.parse(String(init.body));
      return new Response(JSON.stringify([record]), { status: 201, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  };

  t.after(async () => {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  const result = await archivePdfAnalysis({
    filePath,
    originalFilename: "bolletta-test.pdf",
    normalized: {
      parser_version: "test-parser",
      recognized: true,
      kind: "bolletta",
      commodity: "luce",
      fornitore: "Test Energia",
      confidence: "high",
      needsReview: false,
      warnings: [],
      diagnostics: [],
      textExtracted: 100,
      page_count: 1,
    },
  });

  assert.equal(result.stored, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /storage\/v1\/object\/pdf-test-archive\//);
  const saved = JSON.parse(String(calls[1].init.body));
  assert.equal(saved.original_file_name, "bolletta-test.pdf");
  assert.equal(saved.parser_version, "test-parser");
  assert.equal(saved.status, "complete");
});
