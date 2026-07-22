import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  assembleTemporaryPdfUpload,
  deleteTemporaryPdfUpload,
  storeTemporaryPdfChunk,
  temporaryPdfUploadDescriptor,
} from "../lib/pdfArchive.js";

const UPLOAD_ID = "8b503d9a-7402-4df4-899e-76d67c05cd47";

function withArchiveEnv() {
  const previous = {
    PDF_ARCHIVE_MODE: process.env.PDF_ARCHIVE_MODE,
    PDF_ARCHIVE_BUCKET: process.env.PDF_ARCHIVE_BUCKET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  process.env.PDF_ARCHIVE_MODE = "all";
  process.env.PDF_ARCHIVE_BUCKET = "pdf-test-archive";
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test("Step 8.4.2: i blocchi temporanei hanno percorsi privati e indici validati", () => {
  const descriptor = temporaryPdfUploadDescriptor({ uploadId: UPLOAD_ID, chunkIndex: 1, chunkCount: 3 });
  assert.equal(descriptor.storagePath, `incoming-preview/${UPLOAD_ID}/001.part`);
  assert.throws(() => temporaryPdfUploadDescriptor({ uploadId: "../bad", chunkIndex: 0, chunkCount: 1 }), /temporary_upload_id_invalid/);
  assert.throws(() => temporaryPdfUploadDescriptor({ uploadId: UPLOAD_ID, chunkIndex: 3, chunkCount: 3 }), /temporary_chunk_index_invalid/);
});

test("Step 8.4.2: una bolletta fotografata da 20 MB rientra nel percorso a blocchi", () => {
  const fileBytes = 20_000_000;
  const chunkBytes = 2_400_000;
  const chunkCount = Math.ceil(fileBytes / chunkBytes);
  assert.equal(chunkCount, 9);
  assert.doesNotThrow(() => temporaryPdfUploadDescriptor({ uploadId: UPLOAD_ID, chunkIndex: 8, chunkCount }));
});

test("Step 8.4.2: ricompone integralmente un file simulato da 20 MB in 9 blocchi", async () => {
  const restoreEnv = withArchiveEnv();
  const originalFetch = globalThis.fetch;
  const stored = new Map();
  globalThis.fetch = async (url, init = {}) => {
    const current = String(url);
    if (init.method === "POST" && current.includes("/storage/v1/object/pdf-test-archive/incoming-preview/")) {
      stored.set(current.replace("https://supabase.test/storage/v1/object/pdf-test-archive/", ""), Buffer.from(init.body));
      return new Response(JSON.stringify({ Key: current }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (init.method === "GET" && current.includes("/storage/v1/object/authenticated/pdf-test-archive/")) {
      const key = current.replace("https://supabase.test/storage/v1/object/authenticated/pdf-test-archive/", "");
      const bytes = stored.get(key);
      return bytes
        ? new Response(bytes, { status: 200, headers: { "content-type": "application/octet-stream" } })
        : new Response("missing", { status: 404 });
    }
    return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const totalBytes = 20_000_000;
    const chunkBytes = 2_400_000;
    const chunkCount = Math.ceil(totalBytes / chunkBytes);
    for (let index = 0; index < chunkCount; index += 1) {
      const size = Math.min(chunkBytes, totalBytes - index * chunkBytes);
      const chunk = Buffer.alloc(size, index + 1);
      if (index === 0) chunk.write("%PDF-", 0, "ascii");
      await storeTemporaryPdfChunk({ uploadId: UPLOAD_ID, chunkIndex: index, chunkCount, buffer: chunk });
    }
    const rebuilt = await assembleTemporaryPdfUpload({ uploadId: UPLOAD_ID, chunkCount, expectedBytes: totalBytes });
    assert.equal(rebuilt.length, totalBytes);
    assert.equal(rebuilt.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.equal(rebuilt[2_400_000], 2);
    assert.equal(rebuilt[rebuilt.length - 1], 9);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("Step 8.4.2: i blocchi sotto il limite Vercel vengono ricomposti senza perdita di byte", async () => {
  const restoreEnv = withArchiveEnv();
  const originalFetch = globalThis.fetch;
  const stored = new Map();
  let deleteCalled = false;
  globalThis.fetch = async (url, init = {}) => {
    const current = String(url);
    if (init.method === "POST" && current.includes("/storage/v1/object/pdf-test-archive/incoming-preview/")) {
      stored.set(current.replace("https://supabase.test/storage/v1/object/pdf-test-archive/", ""), Buffer.from(init.body));
      return new Response(JSON.stringify({ Key: current }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (init.method === "GET" && current.includes("/storage/v1/object/authenticated/pdf-test-archive/")) {
      const key = current.replace("https://supabase.test/storage/v1/object/authenticated/pdf-test-archive/", "");
      const bytes = stored.get(key);
      return bytes
        ? new Response(bytes, { status: 200, headers: { "content-type": "application/octet-stream" } })
        : new Response("missing", { status: 404 });
    }
    if (init.method === "DELETE" && current.endsWith("/storage/v1/object/pdf-test-archive")) {
      deleteCalled = true;
      return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("unexpected", { status: 500 });
  };

  try {
    const first = Buffer.from("%PDF-1.7\nPRIMA-");
    const second = Buffer.from("SECONDA\n%%EOF");
    await storeTemporaryPdfChunk({ uploadId: UPLOAD_ID, chunkIndex: 0, chunkCount: 2, buffer: first });
    await storeTemporaryPdfChunk({ uploadId: UPLOAD_ID, chunkIndex: 1, chunkCount: 2, buffer: second });
    const rebuilt = await assembleTemporaryPdfUpload({ uploadId: UPLOAD_ID, chunkCount: 2, expectedBytes: first.length + second.length });
    assert.deepEqual(rebuilt, Buffer.concat([first, second]));
    await deleteTemporaryPdfUpload({ uploadId: UPLOAD_ID, chunkCount: 2 });
    assert.equal(deleteCalled, true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});


test("Step 8.4.3: i blocchi mantengono application/pdf richiesto dal bucket privato", async () => {
  const restoreEnv = withArchiveEnv();
  const originalFetch = globalThis.fetch;
  let receivedContentType = "";
  globalThis.fetch = async (url, init = {}) => {
    receivedContentType = String(init.headers?.["Content-Type"] || init.headers?.["content-type"] || "");
    if (receivedContentType !== "application/pdf") {
      return new Response(JSON.stringify({ message: "mime type application/octet-stream is not supported" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ Key: String(url) }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const stored = await storeTemporaryPdfChunk({
      uploadId: UPLOAD_ID,
      chunkIndex: 0,
      chunkCount: 1,
      buffer: Buffer.from("%PDF-1.7\nchunk"),
    });
    assert.equal(stored.stored, true);
    assert.equal(receivedContentType, "application/pdf");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("Step 8.4.2: l'endpoint gestisce blocchi e ricomposizione prima della lettura", async () => {
  const source = await fs.readFile(new URL("../api/analyze-pdf.js", import.meta.url), "utf8");
  assert.match(source, /uploadModeFromFields\(fields\) === "chunk"/);
  assert.match(source, /assembleTemporaryPdfUpload/);
  assert.match(source, /MULTIPART_FILE_LIMIT_BYTES = 4_000_000/);
  assert.match(source, /DEFAULT_MAX_PDF_BYTES = 25_000_000/);
});
