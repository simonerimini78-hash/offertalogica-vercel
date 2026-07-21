import test from "node:test";
import assert from "node:assert/strict";
import { pdfiumBitmapToBmp } from "../lib/pdfOcrBitmap.js";

test("Step 7: converte bitmap grigia PDFium in BMP 24 bit valido", () => {
  // Riga superiore: nero, bianco. Riga inferiore: grigio scuro, grigio chiaro.
  const bmp = pdfiumBitmapToBmp(Uint8Array.from([0, 255, 64, 192]), 2, 2);
  assert.equal(bmp.toString("ascii", 0, 2), "BM");
  assert.equal(bmp.readUInt32LE(2), bmp.length);
  assert.equal(bmp.readUInt32LE(10), 54);
  assert.equal(bmp.readInt32LE(18), 2);
  assert.equal(bmp.readInt32LE(22), 2);
  assert.equal(bmp.readUInt16LE(28), 24);

  const rowStride = 8;
  const firstStoredRow = 54;
  // BMP è bottom-up: la prima riga memorizzata è quella inferiore.
  assert.deepEqual([...bmp.subarray(firstStoredRow, firstStoredRow + 6)], [64, 64, 64, 192, 192, 192]);
  assert.deepEqual([...bmp.subarray(firstStoredRow + rowStride, firstStoredRow + rowStride + 6)], [0, 0, 0, 255, 255, 255]);
});

test("Step 7: accetta anche bitmap BGRA", () => {
  const bmp = pdfiumBitmapToBmp(Uint8Array.from([10, 20, 30, 255]), 1, 1);
  const gray = bmp[54];
  assert.equal(bmp[55], gray);
  assert.equal(bmp[56], gray);
  assert.ok(gray >= 10 && gray <= 30);
});

test("Step 7: rifiuta dimensioni o buffer incoerenti", () => {
  assert.throws(() => pdfiumBitmapToBmp(new Uint8Array(), 0, 1), /Dimensioni bitmap/);
  assert.throws(() => pdfiumBitmapToBmp(Uint8Array.from([1, 2]), 2, 2), /Formato bitmap/);
});
