import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createPdfDirectUpload,
  deletePdfDirectUpload,
  downloadPdfDirectUpload,
} from "../lib/pdfArchive.js";

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("upload firmato: crea sessione, scarica lo stesso PDF e cancella il temporaneo", async (t) => {
  const originalFetch = globalThis.fetch;
  const env = {
    PDF_ARCHIVE_MODE: process.env.PDF_ARCHIVE_MODE,
    PDF_ARCHIVE_BUCKET: process.env.PDF_ARCHIVE_BUCKET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    MAX_PDF_BYTES: process.env.MAX_PDF_BYTES,
  };
  process.env.PDF_ARCHIVE_MODE = "all";
  process.env.PDF_ARCHIVE_BUCKET = "pdf-test-archive";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.MAX_PDF_BYTES = "8000000";

  const pdf = Buffer.from("%PDF-1.7\nDIRECT-UPLOAD-TEST");
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    calls.push({ href, init });
    if (href.includes("/object/upload/sign/")) {
      const relative = href.slice(href.indexOf("/object/upload/sign/"));
      return new Response(JSON.stringify({ url: `${relative}?token=signed-test` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (init.method === "GET" && href.includes("/storage/v1/object/pdf-test-archive/pending/")) {
      return new Response(pdf, {
        status: 200,
        headers: { "content-type": "application/pdf", "content-length": String(pdf.length) },
      });
    }
    if (init.method === "DELETE") {
      return new Response(JSON.stringify({ message: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected_fetch:${href}`);
  };

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ol-direct-upload-"));
  const destinationPath = path.join(dir, "downloaded.pdf");
  const now = Date.UTC(2026, 6, 26, 12, 0, 0);
  t.after(async () => {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const session = await createPdfDirectUpload({
    originalFilename: "bolletta grande.pdf",
    mimeType: "application/pdf",
    fileSize: pdf.length,
    now,
  });

  assert.match(session.uploadUrl, /^https:\/\/example\.supabase\.co\/storage\/v1\/object\/upload\/sign\//);
  assert.ok(session.uploadTicket.includes("."));
  assert.equal(session.maxFileSize, 8_000_000);

  const metadata = await downloadPdfDirectUpload({
    ticket: session.uploadTicket,
    destinationPath,
    now: now + 60_000,
  });
  assert.equal(metadata.originalFilename, "bolletta grande.pdf");
  assert.equal(metadata.mimeType, "application/pdf");
  assert.equal(metadata.fileSize, pdf.length);
  assert.deepEqual(await fs.readFile(destinationPath), pdf);

  await deletePdfDirectUpload(session.uploadTicket);
  assert.equal(calls.filter((call) => call.init.method === "GET").length, 1);
  assert.equal(calls.filter((call) => call.init.method === "DELETE").length, 1);
  assert.match(String(calls.find((call) => call.init.method === "DELETE")?.init.body), /pending\//);
});

test("upload firmato rifiuta ticket alterato e file oltre il limite applicativo", async (t) => {
  const originalFetch = globalThis.fetch;
  const env = {
    PDF_ARCHIVE_MODE: process.env.PDF_ARCHIVE_MODE,
    PDF_ARCHIVE_BUCKET: process.env.PDF_ARCHIVE_BUCKET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    MAX_PDF_BYTES: process.env.MAX_PDF_BYTES,
  };
  process.env.PDF_ARCHIVE_MODE = "all";
  process.env.PDF_ARCHIVE_BUCKET = "pdf-test-archive";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.MAX_PDF_BYTES = "8000000";
  globalThis.fetch = async (url) => {
    const href = String(url);
    const relative = href.slice(href.indexOf("/object/upload/sign/"));
    return new Response(JSON.stringify({ url: `${relative}?token=signed-test` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ol-direct-upload-invalid-"));
  t.after(async () => {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
    await fs.rm(dir, { recursive: true, force: true });
  });

  await assert.rejects(
    createPdfDirectUpload({ originalFilename: "troppo-grande.pdf", fileSize: 8_000_001 }),
    /pdf_upload_too_large/,
  );

  const session = await createPdfDirectUpload({ originalFilename: "test.pdf", fileSize: 20 });
  const tampered = `${session.uploadTicket.slice(0, -1)}x`;
  await assert.rejects(
    downloadPdfDirectUpload({ ticket: tampered, destinationPath: path.join(dir, "invalid.pdf") }),
    /pdf_upload_invalid_ticket/,
  );
});

test("upload firmato: il limite predefinito accetta PDF sopra 8 MB fino a 20 MB", async (t) => {
  const originalFetch = globalThis.fetch;
  const env = {
    PDF_ARCHIVE_MODE: process.env.PDF_ARCHIVE_MODE,
    PDF_ARCHIVE_BUCKET: process.env.PDF_ARCHIVE_BUCKET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    MAX_PDF_BYTES: process.env.MAX_PDF_BYTES,
  };
  process.env.PDF_ARCHIVE_MODE = "all";
  process.env.PDF_ARCHIVE_BUCKET = "pdf-test-archive";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  delete process.env.MAX_PDF_BYTES;
  globalThis.fetch = async (url) => {
    const href = String(url);
    const relative = href.slice(href.indexOf("/object/upload/sign/"));
    return new Response(JSON.stringify({ url: `${relative}?token=signed-test` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  });

  const session = await createPdfDirectUpload({ originalFilename: "irina.pdf", fileSize: 12_000_000 });
  assert.equal(session.maxFileSize, 20_000_000);
  await assert.rejects(
    createPdfDirectUpload({ originalFilename: "oltre-limite.pdf", fileSize: 20_000_001 }),
    (error) => error?.message === "pdf_upload_too_large"
      && error?.actualBytes === 20_000_001
      && error?.maxBytes === 20_000_000,
  );
});
