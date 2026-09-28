import fs from "node:fs/promises";
import { createRequire } from "node:module";
import jpegJs from "jpeg-js";
import { Resvg, initWasm } from "@resvg/resvg-wasm";

export const EDITORIAL_SOCIAL_CARD_TEMPLATE_VERSION = "offertalogica_informa_card_v2";
export const EDITORIAL_SOCIAL_CARD_WIDTH = 1080;
export const EDITORIAL_SOCIAL_CARD_HEIGHT = 1350;
export const EDITORIAL_SOCIAL_CARD_MIME = "image/jpeg";
export const EDITORIAL_SOCIAL_CARD_RENDERER = "resvg_wasm";

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

const require = createRequire(import.meta.url);
let wasmReadyPromise = null;
let logoPromiseCache = null;
let fontsPromiseCache = null;

function clean(value, max = 1000) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function xml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
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
    if (lines.length <= 4 && lines.every((line) => textWeight(line) <= maxWeight * 1.08)) return { size, lines };
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

function detectMime(buffer, fallback = "image/jpeg") {
  if (buffer?.[0] === 0x89 && buffer?.[1] === 0x50 && buffer?.[2] === 0x4e && buffer?.[3] === 0x47) return "image/png";
  if (buffer?.[0] === 0xff && buffer?.[1] === 0xd8) return "image/jpeg";
  return fallback;
}

function dataUri(buffer, mime) {
  return `data:${mime};base64,${Buffer.from(buffer).toString("base64")}`;
}

function logoPromise() {
  if (!logoPromiseCache) logoPromiseCache = fetchBuffer(BRAND_LOGO_URL, "logo OffertaLogica", 2 * 1024 * 1024).catch(() => null);
  return logoPromiseCache;
}

function fontsPromise() {
  if (!fontsPromiseCache) {
    fontsPromiseCache = Promise.all([
      fetchBuffer(FONT_REGULAR_URL, "font regolare", 4 * 1024 * 1024),
      fetchBuffer(FONT_BOLD_URL, "font grassetto", 4 * 1024 * 1024),
    ]).catch((error) => {
      fontsPromiseCache = null;
      throw error;
    });
  }
  return fontsPromiseCache;
}

async function ensureWasm() {
  if (!wasmReadyPromise) {
    wasmReadyPromise = (async () => {
      const wasmPath = require.resolve("@resvg/resvg-wasm/index_bg.wasm");
      const bytes = await fs.readFile(wasmPath);
      try {
        await initWasm(bytes);
      } catch (error) {
        if (!/already initialized/i.test(String(error?.message || error))) throw error;
      }
      return true;
    })().catch((error) => {
      wasmReadyPromise = null;
      throw error;
    });
  }
  return wasmReadyPromise;
}

function tspans(lines, x, y, lineHeight) {
  return (lines || []).map((line, index) => `<tspan x="${x}" y="${y + index * lineHeight}">${xml(line)}</tspan>`).join("");
}

function cardSvg({ sourceDataUri, logoDataUri, postType, label, title, summary }) {
  const cleanTitle = clean(title, 220);
  const cleanSummary = clean(summary, 420);
  const titleInfo = titleLayout(cleanTitle);
  const titleY = 830;
  const titleLineHeight = titleInfo.size + 10;
  const titleBottom = titleY + ((titleInfo.lines.length - 1) * titleLineHeight);
  const summaryY = titleBottom + 62;
  const summaryLines = summaryLayout(cleanSummary, 1268 - summaryY);
  const badge = badgeFor(postType, label);
  const badgeW = Math.min(430, Math.max(190, Math.round(textWeight(badge) * 13 + 58)));
  const logo = logoDataUri
    ? `<image href="${logoDataUri}" x="72" y="28" width="240" height="105" preserveAspectRatio="xMinYMid meet"/>`
    : `<text x="72" y="92" class="bold" font-size="42" fill="${BRAND_GREEN_DARK}">OffertaLogica<tspan fill="${BRAND_GREEN}">.it</tspan></text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${EDITORIAL_SOCIAL_CARD_WIDTH}" height="${EDITORIAL_SOCIAL_CARD_HEIGHT}" viewBox="0 0 ${EDITORIAL_SOCIAL_CARD_WIDTH} ${EDITORIAL_SOCIAL_CARD_HEIGHT}">
  <defs>
    <clipPath id="hero"><rect x="88" y="268" width="904" height="388" rx="26"/></clipPath>
    <style>
      text{font-family:'DejaVu Sans',sans-serif}.bold{font-weight:700}.regular{font-weight:400}
    </style>
  </defs>
  <rect width="1080" height="1350" fill="${BG}"/>
  ${logo}
  <rect x="74" y="166" width="74" height="4" fill="${BRAND_GREEN}"/>
  <text x="72" y="220" class="regular" font-size="31" fill="#14324A">OffertaLogica Informa</text>
  <rect x="850" y="54" width="158" height="92" rx="30" fill="${PANEL}" stroke="${BORDER}" stroke-width="2"/>
  <text x="929" y="98" text-anchor="middle" class="bold" font-size="31" fill="#14324A">1/1</text>
  <text x="929" y="128" text-anchor="middle" class="bold" font-size="16" fill="${BRAND_GREEN_DARK}">${xml(pillSubLabel(postType))}</text>
  <rect x="72" y="252" width="936" height="420" rx="30" fill="${PANEL}" stroke="${BORDER}" stroke-width="2"/>
  <image href="${sourceDataUri}" x="88" y="268" width="904" height="388" preserveAspectRatio="xMidYMid slice" clip-path="url(#hero)"/>
  <rect x="72" y="704" width="${badgeW}" height="54" rx="27" fill="#DCF5E3"/>
  <text x="96" y="740" class="bold" font-size="19" fill="${BRAND_GREEN_DARK}">${xml(badge)}</text>
  <text class="bold" font-size="${titleInfo.size}" fill="${BRAND_NAVY}">${tspans(titleInfo.lines, 72, titleY, titleLineHeight)}</text>
  <text class="regular" font-size="31" fill="${MUTED}">${tspans(summaryLines, 72, summaryY, 44)}</text>
  <rect x="72" y="1282" width="156" height="3" fill="${BRAND_GREEN}"/>
  <text x="72" y="1320" class="bold" font-size="19" fill="#16324A">offertalogica.it</text>
</svg>`;
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
  if (!cleanTitle) throw new Error("Cover social: titolo mancante");

  const [sourceRaw, logoRaw, fontBuffers] = await Promise.all([
    sourceBuffer ? Promise.resolve(Buffer.from(sourceBuffer)) : fetchBuffer(sourceImageUrl, "immagine sorgente"),
    logoBuffer ? Promise.resolve(Buffer.from(logoBuffer)) : logoPromise(),
    fontsPromise(),
    ensureWasm(),
  ]).then(([source, logo, fonts]) => [source, logo, fonts]);

  const sourceMime = detectMime(sourceRaw, "image/jpeg");
  if (![/^image\/jpeg$/i, /^image\/png$/i].some((rule) => rule.test(sourceMime))) throw new Error("Cover social: formato immagine sorgente non supportato");
  const svg = cardSvg({
    sourceDataUri: dataUri(sourceRaw, sourceMime),
    logoDataUri: logoRaw?.length ? dataUri(logoRaw, detectMime(logoRaw, "image/png")) : "",
    postType,
    label,
    title: cleanTitle,
    summary: clean(summary, 420),
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: "original" },
    font: {
      fontBuffers: fontBuffers.map((buffer) => new Uint8Array(buffer)),
      defaultFontFamily: "DejaVu Sans",
      sansSerifFamily: "DejaVu Sans",
    },
    imageRendering: 0,
    textRendering: 2,
  });
  const rendered = resvg.render();
  const width = Number(rendered.width || EDITORIAL_SOCIAL_CARD_WIDTH);
  const height = Number(rendered.height || EDITORIAL_SOCIAL_CARD_HEIGHT);
  const pixels = Buffer.from(rendered.pixels);
  const encoded = jpegJs.encode({ data: pixels, width, height }, 90);
  const buffer = Buffer.from(encoded.data);
  if (!buffer.length) throw new Error("Cover social: codifica JPEG non riuscita");

  return {
    buffer,
    mimeType: EDITORIAL_SOCIAL_CARD_MIME,
    width,
    height,
    templateVersion: EDITORIAL_SOCIAL_CARD_TEMPLATE_VERSION,
    renderer: EDITORIAL_SOCIAL_CARD_RENDERER,
  };
}
