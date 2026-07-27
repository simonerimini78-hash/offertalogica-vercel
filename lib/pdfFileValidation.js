import fs from "node:fs/promises";

const PDF_HEADER_SCAN_BYTES = 4_096;
const PDF_VERSION_PATTERN = /%PDF-(?:1\.[0-7]|2\.0)/;

export async function normalizePdfFileHeader(filePath, {
  maxLeadingBytes = PDF_HEADER_SCAN_BYTES,
} = {}) {
  if (!filePath) throw new Error("pdf_file_path_required");
  const scanLimit = Math.max(16, Math.min(65_536, Number(maxLeadingBytes || PDF_HEADER_SCAN_BYTES)));
  const handle = await fs.open(filePath, "r");
  let scan;
  try {
    scan = Buffer.alloc(scanLimit + 16);
    const { bytesRead } = await handle.read(scan, 0, scan.length, 0);
    scan = scan.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }

  const match = PDF_VERSION_PATTERN.exec(scan.toString("latin1"));
  if (!match || match.index > scanLimit) {
    return { valid: false, sanitized: false, bytesRemoved: 0, fileSize: null };
  }

  if (match.index === 0) {
    const stats = await fs.stat(filePath);
    return { valid: true, sanitized: false, bytesRemoved: 0, fileSize: stats.size };
  }

  const bytes = await fs.readFile(filePath);
  const normalized = bytes.subarray(match.index);
  await fs.writeFile(filePath, normalized);
  return {
    valid: true,
    sanitized: true,
    bytesRemoved: match.index,
    fileSize: normalized.length,
  };
}
