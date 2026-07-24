import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const JPEG_START = 0xffd8;
const JPEG_END = 0xffd9;
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);
const MAX_IMAGE_DIMENSION = 10_000;
const MAX_IMAGE_PIXELS = 40_000_000;
const PAGE_MAX_WIDTH = 595.28;
const PAGE_MAX_HEIGHT = 841.89;

function jpegDimensions(buffer) {
  if (
    !Buffer.isBuffer(buffer)
    || buffer.length < 12
    || buffer.readUInt16BE(0) !== JPEG_START
    || buffer.readUInt16BE(buffer.length - 2) !== JPEG_END
  ) {
    throw new Error("raster_archive_invalid_jpeg");
  }

  let offset = 2;
  while (offset + 4 <= buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) break;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 8) break;
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      if (
        width < 1
        || height < 1
        || width > MAX_IMAGE_DIMENSION
        || height > MAX_IMAGE_DIMENSION
        || width * height > MAX_IMAGE_PIXELS
      ) {
        throw new Error("raster_archive_invalid_dimensions");
      }
      return { width, height };
    }
    offset += segmentLength;
  }
  throw new Error("raster_archive_dimensions_not_found");
}

function pdfPageSize(width, height) {
  const scale = Math.min(PAGE_MAX_WIDTH / width, PAGE_MAX_HEIGHT / height, 1);
  return {
    width: Number((width * scale).toFixed(3)),
    height: Number((height * scale).toFixed(3)),
  };
}

function textBuffer(value) {
  return Buffer.from(String(value), "ascii");
}

function streamObject(dictionary, stream) {
  return Buffer.concat([
    textBuffer(`<< ${dictionary} /Length ${stream.length} >>\nstream\n`),
    stream,
    textBuffer("\nendstream"),
  ]);
}

function serializePdf(objects) {
  const header = Buffer.concat([
    textBuffer("%PDF-1.4\n%"),
    Buffer.from([0xe2, 0xe3, 0xcf, 0xd3]),
    textBuffer("\n"),
  ]);
  const chunks = [header];
  const offsets = [0];
  let length = header.length;

  for (let index = 0; index < objects.length; index += 1) {
    const objectNumber = index + 1;
    const body = Buffer.isBuffer(objects[index]) ? objects[index] : textBuffer(objects[index]);
    const chunk = Buffer.concat([
      textBuffer(`${objectNumber} 0 obj\n`),
      body,
      textBuffer("\nendobj\n"),
    ]);
    offsets[objectNumber] = length;
    chunks.push(chunk);
    length += chunk.length;
  }

  const xrefOffset = length;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`,
    `startxref\n${xrefOffset}\n%%EOF\n`,
  ].join("");
  chunks.push(textBuffer(xref));
  return Buffer.concat(chunks);
}

export async function buildRasterArchivePdf(imageFiles = []) {
  if (!Array.isArray(imageFiles) || imageFiles.length === 0) {
    throw new Error("raster_archive_pages_missing");
  }

  const pages = [];
  for (const imageFile of imageFiles) {
    if (String(imageFile?.mimeType || "").toLowerCase() !== "image/jpeg") {
      throw new Error("raster_archive_requires_jpeg");
    }
    const buffer = await fs.readFile(imageFile.filePath);
    const dimensions = jpegDimensions(buffer);
    pages.push({
      buffer,
      dimensions,
      page: Number(imageFile.page || pages.length + 1),
    });
  }
  pages.sort((left, right) => left.page - right.page);

  const objects = [];
  const pageObjectNumbers = pages.map((_, index) => 3 + index * 3);
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] >>`);

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const pageObjectNumber = pageObjectNumbers[index];
    const contentObjectNumber = pageObjectNumber + 1;
    const imageObjectNumber = pageObjectNumber + 2;
    const pageSize = pdfPageSize(page.dimensions.width, page.dimensions.height);
    const content = textBuffer(
      `q\n${pageSize.width} 0 0 ${pageSize.height} 0 0 cm\n/Im0 Do\nQ`,
    );

    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageSize.width} ${pageSize.height}] `
      + `/Resources << /XObject << /Im0 ${imageObjectNumber} 0 R >> >> `
      + `/Contents ${contentObjectNumber} 0 R >>`,
    );
    objects.push(streamObject("", content));
    objects.push(streamObject(
      `/Type /XObject /Subtype /Image /Width ${page.dimensions.width} `
      + `/Height ${page.dimensions.height} /ColorSpace /DeviceRGB `
      + "/BitsPerComponent 8 /Filter /DCTDecode",
      page.buffer,
    ));
  }

  const pdf = serializePdf(objects);
  const filePath = path.join(
    os.tmpdir(),
    `offertalogica-raster-archive-${crypto.randomUUID()}.pdf`,
  );
  await fs.writeFile(filePath, pdf, { flag: "wx" });
  return {
    filePath,
    fileSize: pdf.length,
    pageCount: pages.length,
    source: "client_raster_reconstruction",
  };
}
