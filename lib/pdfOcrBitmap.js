function assertBitmap(data, width, height) {
  const w = Number.parseInt(width, 10);
  const h = Number.parseInt(height, 10);
  if (!Number.isInteger(w) || w <= 0 || !Number.isInteger(h) || h <= 0) {
    throw new TypeError("Dimensioni bitmap OCR non valide");
  }
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data || []);
  const pixels = w * h;
  if (bytes.length !== pixels && bytes.length !== pixels * 4) {
    throw new TypeError("Formato bitmap OCR non supportato");
  }
  return { bytes, width: w, height: h, channels: bytes.length === pixels ? 1 : 4 };
}

function grayAt(bytes, pixelIndex, channels) {
  if (channels === 1) return bytes[pixelIndex];
  const offset = pixelIndex * 4;
  // PDFium usa BGRA. La conversione ponderata conserva meglio il contrasto.
  const blue = bytes[offset];
  const green = bytes[offset + 1];
  const red = bytes[offset + 2];
  return Math.max(0, Math.min(255, Math.round((red * 77 + green * 150 + blue * 29) / 256)));
}

export function pdfiumBitmapToBmp(data, width, height) {
  const bitmap = assertBitmap(data, width, height);
  const rowStride = Math.ceil((bitmap.width * 3) / 4) * 4;
  const pixelBytes = rowStride * bitmap.height;
  const headerBytes = 54;
  const output = Buffer.alloc(headerBytes + pixelBytes, 0);

  output.write("BM", 0, 2, "ascii");
  output.writeUInt32LE(output.length, 2);
  output.writeUInt32LE(headerBytes, 10);
  output.writeUInt32LE(40, 14);
  output.writeInt32LE(bitmap.width, 18);
  output.writeInt32LE(bitmap.height, 22); // BMP bottom-up
  output.writeUInt16LE(1, 26);
  output.writeUInt16LE(24, 28);
  output.writeUInt32LE(0, 30);
  output.writeUInt32LE(pixelBytes, 34);
  output.writeInt32LE(7087, 38); // circa 180 DPI
  output.writeInt32LE(7087, 42);

  for (let outputRow = 0; outputRow < bitmap.height; outputRow += 1) {
    const sourceY = bitmap.height - 1 - outputRow;
    const rowOffset = headerBytes + outputRow * rowStride;
    for (let x = 0; x < bitmap.width; x += 1) {
      const gray = grayAt(bitmap.bytes, sourceY * bitmap.width + x, bitmap.channels);
      const pixelOffset = rowOffset + x * 3;
      output[pixelOffset] = gray;
      output[pixelOffset + 1] = gray;
      output[pixelOffset + 2] = gray;
    }
  }

  return output;
}

export function cropPdfiumBitmap(data, width, height, {
  left = 0,
  top = 0,
  right = 1,
  bottom = 1,
} = {}) {
  const bitmap = assertBitmap(data, width, height);
  const x0 = Math.max(0, Math.min(bitmap.width - 1, Math.floor(bitmap.width * left)));
  const y0 = Math.max(0, Math.min(bitmap.height - 1, Math.floor(bitmap.height * top)));
  const x1 = Math.max(x0 + 1, Math.min(bitmap.width, Math.ceil(bitmap.width * right)));
  const y1 = Math.max(y0 + 1, Math.min(bitmap.height, Math.ceil(bitmap.height * bottom)));
  const cropWidth = x1 - x0;
  const cropHeight = y1 - y0;
  const output = new Uint8Array(cropWidth * cropHeight * bitmap.channels);
  for (let y = 0; y < cropHeight; y += 1) {
    const sourceStart = ((y0 + y) * bitmap.width + x0) * bitmap.channels;
    const sourceEnd = sourceStart + cropWidth * bitmap.channels;
    output.set(bitmap.bytes.subarray(sourceStart, sourceEnd), y * cropWidth * bitmap.channels);
  }
  return { data: output, width: cropWidth, height: cropHeight };
}
