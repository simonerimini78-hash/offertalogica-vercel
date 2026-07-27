import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizePdfFileHeader } from "../lib/pdfFileValidation.js";

async function tempFile(t, contents) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "offertalogica-pdf-header-"));
  const filePath = path.join(dir, "documento.pdf");
  await fs.writeFile(filePath, contents);
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return filePath;
}

test("accetta un PDF con intestazione regolare senza modificarlo", async (t) => {
  const original = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
  const filePath = await tempFile(t, original);
  const result = await normalizePdfFileHeader(filePath);
  assert.deepEqual(result, {
    valid: true,
    sanitized: false,
    bytesRemoved: 0,
    fileSize: original.length,
  });
  assert.deepEqual(await fs.readFile(filePath), original);
});

test("rimuove un avviso testuale anteposto al vero header PDF", async (t) => {
  const prefix = Buffer.from("<br />\n<b>Notice</b>: Undefined index prima del documento<br />\n");
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
  const filePath = await tempFile(t, Buffer.concat([prefix, pdf]));
  const result = await normalizePdfFileHeader(filePath);
  assert.equal(result.valid, true);
  assert.equal(result.sanitized, true);
  assert.equal(result.bytesRemoved, prefix.length);
  assert.equal(result.fileSize, pdf.length);
  assert.deepEqual(await fs.readFile(filePath), pdf);
});

test("rifiuta file senza un header PDF valido nei primi 4096 byte", async (t) => {
  const filePath = await tempFile(t, Buffer.from("questo non e un PDF"));
  const result = await normalizePdfFileHeader(filePath);
  assert.equal(result.valid, false);
  assert.equal(result.sanitized, false);
});
