import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import * as PImage from "pureimage";

export const EDITORIAL_SOCIAL_CARD_TEMPLATE_VERSION = "offertalogica_informa_card_v2";
export const EDITORIAL_SOCIAL_CARD_WIDTH = 1080;
export const EDITORIAL_SOCIAL_CARD_HEIGHT = 1350;
export const EDITORIAL_SOCIAL_CARD_MIME = "image/jpeg";
export const EDITORIAL_SOCIAL_CARD_RENDERER = "pureimage_canvas";

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20000;
const BRAND_LOGO_URL = "https://offertalogica.it/assets/logo-offertalogica-header.png";
const FONT_REGULAR_URL = "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf";
const FONT_BOLD_URL = "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf";
const BRAND_NAVY = "#09213E";
const BRAND_GREEN = "#23A83F";
const BRAND_GREEN_DARK = "#0F7D33";
const MUTED = "#334155";
const BG = "#F8FCF9";
const PANEL = "#FFFFFF";
const BORDER = "#D9E8DE";

let cachedLogoPromise = null;
let fontsPromise = null;

function clean(value, max = 1000) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function textWeight(value) {
  return [...String(value || "")].reduce((sum, char) => {
    if (/[ilI1\s.,:;!'’]/.test(char)) return sum + 0.45;
    if (/[mwMW@%&]/.test(char)) return sum + 1.35;
    if (/[A-ZÀ-ÖØ-Þ]/.test(char)) return sum + 1.08;
    return sum + 0.9;
  }, 0);
}

function wrapLines(value, maxWeight, maxLines) {
  const words = clean(value, 1600).split(" ").filter(Boolean);
  const lines = [];
  let current = "";
  let consumed = 0;
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || textWeight(candidate) <= maxWeight) {
      current = candidate;
      consumed += 1;
      continue;
    }
    lines.push(current);
    if (lines.length >= maxLines) break;
    current = word;
    consumed += 1;
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (consumed < words.length && lines.length) {
    const last = lines.length - 1;
    lines[last] = `${lines[last].replace(/[\s.,:;!?-]+$/g, "")}…`;
  }
  return lines.slice(0, maxLines);
}

function titleLayout(value) {
  const availableWidth = EDITORIAL_SOCIAL_CARD_WIDTH - 144;
  for (const size of [64, 58, 52, 46, 42]) {
    const maxWeight = availableWidth / (size * 0.60);
    const lines = wrapLines(value, maxWeight, 4);
    if (lines.length <= 4 && lines.every((line) => textWeight(line) <= maxWeight * 1.08)) {
      return { size, lines };
    }
  }
  return { size: 38, lines: wrapLines(value, 38, 4) };
}

function summaryLayout(value, availableHeight) {
  if (!value || availableHeight < 34) return [];
  const maxLines = Math.max(0, Math.min(3, Math.floor(availableHeight / 38)));
  return wrapLines(value, 56, maxLines);
}

function badgeFor(postType, suppliedLabel = "") {
  const explicit = clean(suppliedLabel, 42).toUpperCase();
  if (explicit) return explicit;
  if (postType === "related") return "SOLUZIONE OFFERTALOGICA";
  if (postType === "article_followup") return "APPROFONDIMENTO";
  return "IN SINTESI";
}

function pillSubLabel(postType) {
  if (postType === "related") return "soluzione";
  if (postType === "article_followup") return "focus";
  return "articolo";
}

async function fetchBuffer(url, label, maxBytes = MAX_SOURCE_BYTES) {
  const raw = String(url || "").trim();
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error(`Cover social: URL ${label} non valido`); }
  if (parsed.protocol !== "https:") throw new Error(`Cover social: ${label} non HTTPS`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(parsed, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`Cover social: ${label} HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > maxBytes) throw new Error(`Cover social: ${label} troppo pesante`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error(`Cover social: ${label} vuoto`);
    if (buffer.length > maxBytes) throw new Error(`Cover social: ${label} troppo pesante`);
    return buffer;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`Cover social: timeout download ${label}`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function logoPromise() {
  if (!cachedLogoPromise) cachedLogoPromise = fetchBuffer(BRAND_LOGO_URL, "logo OffertaLogica", 2 * 1024 * 1024).catch(() => null);
  return cachedLogoPromise;
}

function imageFormat(buffer) {
  if (!buffer?.length) return "unknown";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "jpeg";
  return "unknown";
}

async function decodeImage(buffer, label = "immagine") {
  const format = imageFormat(buffer);
  const stream = Readable.from(buffer);
  if (format === "png") return PImage.decodePNGFromStream(stream);
  if (format === "jpeg") return PImage.decodeJPEGFromStream(stream);
  throw new Error(`Cover social: formato ${label} non supportato; usare JPG o PNG`);
}

async function ensureFontFile(fileName, url) {
  const dir = path.join(os.tmpdir(), "offertalogica-social-fonts");
  const target = path.join(dir, fileName);
  try {
    const stat = await fs.stat(target);
    if (stat.size > 10000) return target;
  } catch {}
  await fs.mkdir(dir, { recursive: true });
  const data = await fetchBuffer(url, `font ${fileName}`, 4 * 1024 * 1024);
  await fs.writeFile(target, data);
  return target;
}

async function ensureFonts() {
  if (!fontsPromise) {
    fontsPromise = (async () => {
      const [regularPath, boldPath] = await Promise.all([
        ensureFontFile("DejaVuSans.ttf", FONT_REGULAR_URL),
        ensureFontFile("DejaVuSans-Bold.ttf", FONT_BOLD_URL),
      ]);
      const regular = PImage.registerFont(regularPath, "OLRegular");
      const bold = PImage.registerFont(boldPath, "OLBold");
      await Promise.all([regular.load(), bold.load()]);
      return { regular: "OLRegular", bold: "OLBold" };
    })().catch((error) => {
      fontsPromise = null;
      throw error;
    });
  }
  return fontsPromise;
}

function roundedRect(ctx, x, y, width, height, radius, fillStyle, strokeStyle = null, lineWidth = 1) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill(); }
  if (strokeStyle) { ctx.strokeStyle = strokeStyle; ctx.lineWidth = lineWidth; ctx.stroke(); }
}

function drawImageCover(ctx, image, x, y, width, height) {
  const srcW = Math.max(1, Number(image?.width || 0));
  const srcH = Math.max(1, Number(image?.height || 0));
  const targetAspect = width / height;
  const sourceAspect = srcW / srcH;
  let sx = 0, sy = 0, sw = srcW, sh = srcH;
  if (sourceAspect > targetAspect) {
    sw = srcH * targetAspect;
    sx = (srcW - sw) / 2;
  } else if (sourceAspect < targetAspect) {
    sh = srcW / targetAspect;
    sy = (srcH - sh) / 2;
  }
  ctx.save();
  roundedRect(ctx, x, y, width, height, 26, null);
  ctx.clip();
  ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height);
  ctx.restore();
}

function drawTextLines(ctx, lines, { x, y, fontSize, lineHeight, fontFamily, fillStyle }) {
  ctx.fillStyle = fillStyle;
  ctx.font = `${fontSize}pt ${fontFamily}`;
  (lines || []).forEach((line, index) => ctx.fillText(line, x, y + (index * lineHeight)));
}

function collectStreamBuffer(run) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const sink = new Writable({
      write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
    });
    sink.on("finish", () => resolve(Buffer.concat(chunks)));
    sink.on("error", reject);
    Promise.resolve(run(sink)).catch(reject);
  });
}

async function encodeJpeg(image) {
  return collectStreamBuffer((sink) => PImage.encodeJPEGToStream(image, sink, 90));
}

export async function renderEditorialSocialCard({
  sourceImageUrl,
  sourceBuffer = null,
  logoBuffer = null,
  postType = "article_intro",
  label = "",
  title = "",
  summary = "",
} = {}) {
  const cleanTitle = clean(title, 220);
  const cleanSummary = clean(summary, 420);
  if (!cleanTitle) throw new Error("Cover social: titolo mancante");

  const [sourceRaw, logoRaw, fonts] = await Promise.all([
    sourceBuffer ? Promise.resolve(sourceBuffer) : fetchBuffer(sourceImageUrl, "immagine sorgente"),
    logoBuffer ? Promise.resolve(logoBuffer) : logoPromise(),
    ensureFonts(),
  ]);
  const source = await decodeImage(sourceRaw, "immagine sorgente");
  const logo = logoRaw?.length ? await decodeImage(logoRaw, "logo").catch(() => null) : null;

  const canvas = PImage.make(EDITORIAL_SOCIAL_CARD_WIDTH, EDITORIAL_SOCIAL_CARD_HEIGHT);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, EDITORIAL_SOCIAL_CARD_WIDTH, EDITORIAL_SOCIAL_CARD_HEIGHT);

  if (logo) {
    const maxW = 240;
    const maxH = 105;
    const scale = Math.min(maxW / logo.width, maxH / logo.height, 1);
    ctx.drawImage(logo, 0, 0, logo.width, logo.height, 72, 28, Math.round(logo.width * scale), Math.round(logo.height * scale));
  } else {
    ctx.fillStyle = BRAND_GREEN_DARK;
    ctx.font = `32pt ${fonts.bold}`;
    ctx.fillText("OffertaLogica.it", 72, 88);
  }

  ctx.fillStyle = BRAND_GREEN;
  ctx.fillRect(74, 166, 74, 4);
  ctx.fillStyle = "#14324A";
  ctx.font = `24pt ${fonts.regular}`;
  ctx.fillText("OffertaLogica Informa", 72, 220);

  roundedRect(ctx, 850, 54, 158, 92, 30, PANEL, BORDER, 2);
  ctx.textAlign = "center";
  ctx.fillStyle = "#14324A";
  ctx.font = `24pt ${fonts.bold}`;
  ctx.fillText("1/1", 929, 94);
  ctx.fillStyle = BRAND_GREEN_DARK;
  ctx.font = `12pt ${fonts.bold}`;
  ctx.fillText(pillSubLabel(postType), 929, 124);
  ctx.textAlign = "left";

  roundedRect(ctx, 72, 252, 936, 420, 30, PANEL, BORDER, 2);
  drawImageCover(ctx, source, 88, 268, 904, 388);

  const badge = badgeFor(postType, label);
  const badgeW = Math.min(430, Math.max(190, Math.round(textWeight(badge) * 13 + 58)));
  roundedRect(ctx, 72, 704, badgeW, 54, 27, "#DCF5E3");
  ctx.fillStyle = BRAND_GREEN_DARK;
  ctx.font = `15pt ${fonts.bold}`;
  ctx.fillText(badge, 96, 739);

  const titleInfo = titleLayout(cleanTitle);
  const titleY = 830;
  const lineHeight = titleInfo.size + 10;
  drawTextLines(ctx, titleInfo.lines, {
    x: 72, y: titleY, fontSize: titleInfo.size, lineHeight, fontFamily: fonts.bold, fillStyle: BRAND_NAVY,
  });
  const titleBottom = titleY + ((titleInfo.lines.length - 1) * lineHeight);
  const summaryY = titleBottom + 62;
  const summaryLines = summaryLayout(cleanSummary, 1268 - summaryY);
  drawTextLines(ctx, summaryLines, {
    x: 72, y: summaryY, fontSize: 24, lineHeight: 36, fontFamily: fonts.regular, fillStyle: MUTED,
  });

  ctx.fillStyle = BRAND_GREEN;
  ctx.fillRect(72, 1282, 156, 3);
  ctx.fillStyle = "#16324A";
  ctx.font = `15pt ${fonts.bold}`;
  ctx.fillText("offertalogica.it", 72, 1318);

  const buffer = await encodeJpeg(canvas);
  if (!buffer?.length) throw new Error("Cover social: output JPEG vuoto");
  return {
    buffer,
    mimeType: EDITORIAL_SOCIAL_CARD_MIME,
    width: EDITORIAL_SOCIAL_CARD_WIDTH,
    height: EDITORIAL_SOCIAL_CARD_HEIGHT,
    templateVersion: EDITORIAL_SOCIAL_CARD_TEMPLATE_VERSION,
    renderer: EDITORIAL_SOCIAL_CARD_RENDERER,
  };
}
