import sharp from "sharp";

export const EDITORIAL_SOCIAL_CARD_TEMPLATE_VERSION = "offertalogica_manual_cover_v1";
export const EDITORIAL_SOCIAL_CARD_WIDTH = 1080;
export const EDITORIAL_SOCIAL_CARD_HEIGHT = 1350;
export const EDITORIAL_SOCIAL_CARD_MIME = "image/jpeg";

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20000;
const BRAND_LOGO_URL = "https://offertalogica.it/assets/logo-offertalogica-header.png";
const BRAND_NAVY = "#09213E";
const BRAND_GREEN = "#23A83F";
const BRAND_GREEN_DARK = "#0F7D33";
const MUTED = "#334155";
let cachedLogoPromise = null;

function clean(value, max = 1000) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function escapeXml(value) {
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
  for (const size of [66, 62, 58, 54, 50, 46, 42]) {
    const maxWeight = availableWidth / (size * 0.64);
    const lines = wrapLines(value, maxWeight, 4);
    if (lines.length <= 4 && lines.every((line) => textWeight(line) <= maxWeight * 1.08)) {
      return { size, lines };
    }
  }
  return { size: 40, lines: wrapLines(value, 34, 4) };
}

function summaryLayout(value, availableHeight) {
  if (!value || availableHeight < 38) return [];
  const maxLines = Math.max(0, Math.min(3, Math.floor(availableHeight / 38)));
  return wrapLines(value, 52, maxLines);
}

function textBlock(lines, { x, y, fontSize, lineHeight, weight = 400, fill = BRAND_NAVY }) {
  const safe = (Array.isArray(lines) ? lines : []).filter(Boolean);
  if (!safe.length) return "";
  const tspans = safe
    .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");
  return `<text x="${x}" y="${y}" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${tspans}</text>`;
}

function badgeFor(postType, suppliedLabel = "") {
  const explicit = clean(suppliedLabel, 42).toUpperCase();
  if (explicit) return explicit;
  if (postType === "related") return "SOLUZIONE OFFERTALOGICA";
  if (postType === "article_followup") return "APPROFONDIMENTO";
  return "IN SINTESI";
}

function badgeWidth(label) {
  return Math.min(430, Math.max(178, Math.round(textWeight(label) * 14.5 + 52)));
}

function pillSubLabel(postType) {
  if (postType === "related") return "soluzione";
  if (postType === "article_followup") return "focus";
  return "articolo";
}

async function fetchImageBuffer(url, label = "immagine sorgente") {
  const raw = String(url || "").trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Cover social: URL ${label} non valido`);
  }
  if (parsed.protocol !== "https:") throw new Error(`Cover social: ${label} non HTTPS`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(parsed, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`Cover social: ${label} HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_SOURCE_BYTES) throw new Error(`Cover social: ${label} troppo pesante`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error(`Cover social: ${label} vuota`);
    if (buffer.length > MAX_SOURCE_BYTES) throw new Error(`Cover social: ${label} troppo pesante`);
    return buffer;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`Cover social: timeout download ${label}`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function logoPromise() {
  if (!cachedLogoPromise) {
    cachedLogoPromise = fetchImageBuffer(BRAND_LOGO_URL, "logo OffertaLogica").catch(() => null);
  }
  return cachedLogoPromise;
}

async function prepareLogo(input) {
  if (!input?.length) return null;
  return sharp(input)
    .resize({ width: 320, height: 120, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
}

async function prepareArticleVisual(input) {
  const panelWidth = 904;
  const panelHeight = 376;
  const metadata = await sharp(input).metadata();
  const aspect = Number(metadata.width || 0) / Math.max(1, Number(metadata.height || 0));
  const fit = aspect >= 1.30 ? "cover" : "contain";
  const background = { r: 248, g: 251, b: 249, alpha: 1 };
  const resized = await sharp(input)
    .rotate()
    .resize(panelWidth, panelHeight, {
      fit,
      position: fit === "cover" ? "attention" : "centre",
      background,
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();
  const mask = Buffer.from(`<svg width="${panelWidth}" height="${panelHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="${panelWidth}" height="${panelHeight}" rx="24" ry="24" fill="#fff"/></svg>`);
  return sharp(resized).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

function baseSvg() {
  return Buffer.from(`
    <svg width="${EDITORIAL_SOCIAL_CARD_WIDTH}" height="${EDITORIAL_SOCIAL_CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#FBFDFC"/>
          <stop offset="0.56" stop-color="#F7FBF8"/>
          <stop offset="1" stop-color="#EEF8F0"/>
        </linearGradient>
        <radialGradient id="glow" cx="80%" cy="15%" r="42%">
          <stop offset="0" stop-color="#0F7D33" stop-opacity="0.10"/>
          <stop offset="1" stop-color="#0F7D33" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1080" height="1350" fill="url(#base)"/>
      <rect width="1080" height="620" fill="url(#glow)"/>
      <rect x="850" y="76" width="158" height="92" rx="34" fill="#D9E0DC" opacity="0.26"/>
      <rect x="850" y="66" width="158" height="92" rx="34" fill="#FFFFFF"/>
      <rect x="72" y="276" width="936" height="408" rx="34" fill="#0F172A" opacity="0.10"/>
      <rect x="72" y="264" width="936" height="408" rx="34" fill="#FFFFFF"/>
      <path d="M610 1340 C790 1270 880 1180 1088 900" fill="none" stroke="#23A83F" stroke-opacity="0.22" stroke-width="7"/>
    </svg>
  `);
}

function foregroundSvg({ postType, label, title, summary, hasLogo }) {
  const safeLabel = badgeFor(postType, label);
  const pillWidth = badgeWidth(safeLabel);
  const titleInfo = titleLayout(title);
  const titleLineHeight = titleInfo.size + 11;
  const titleY = 822;
  const titleBottom = titleY + ((titleInfo.lines.length - 1) * titleLineHeight);
  const summaryY = titleBottom + 62;
  const summaryLines = summaryLayout(summary, 1270 - summaryY);
  const badgeTextSize = safeLabel.length > 22 ? 18 : 20;
  const fallbackBrand = hasLogo ? "" : `<text x="72" y="108" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="38" font-weight="850" fill="#0F5132">OffertaLogica<tspan fill="#23A83F">.it</tspan></text>`;
  return Buffer.from(`
    <svg width="${EDITORIAL_SOCIAL_CARD_WIDTH}" height="${EDITORIAL_SOCIAL_CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      ${fallbackBrand}
      <rect x="74" y="172" width="74" height="4" rx="2" fill="${BRAND_GREEN}"/>
      <text x="72" y="226" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="31" font-weight="520" fill="#14324A">OffertaLogica Informa</text>
      <text x="929" y="105" text-anchor="middle" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="30" font-weight="850" fill="#14324A">1/1</text>
      <text x="929" y="134" text-anchor="middle" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="15" font-weight="760" fill="${BRAND_GREEN_DARK}">${escapeXml(pillSubLabel(postType))}</text>
      <rect x="72" y="264" width="936" height="408" rx="34" fill="none" stroke="#0F5132" stroke-opacity="0.08" stroke-width="2"/>
      <rect x="72" y="700" width="${pillWidth}" height="56" rx="28" fill="#DCF5E3"/>
      <text x="96" y="736" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="${badgeTextSize}" font-weight="820" fill="${BRAND_GREEN_DARK}">${escapeXml(safeLabel)}</text>
      ${textBlock(titleInfo.lines, { x: 72, y: titleY, fontSize: titleInfo.size, lineHeight: titleLineHeight, weight: 860, fill: BRAND_NAVY })}
      ${textBlock(summaryLines, { x: 72, y: summaryY, fontSize: 28, lineHeight: 38, weight: 540, fill: MUTED })}
      <text x="72" y="1310" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="20" font-weight="700" fill="#16324A">offertalogica.it</text>
    </svg>
  `);
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

  const [source, rawLogo] = await Promise.all([
    sourceBuffer ? Promise.resolve(sourceBuffer) : fetchImageBuffer(sourceImageUrl),
    logoBuffer ? Promise.resolve(logoBuffer) : logoPromise(),
  ]);
  const [visual, resolvedLogo] = await Promise.all([
    prepareArticleVisual(source),
    prepareLogo(rawLogo).catch(() => null),
  ]);
  const base = baseSvg();
  const foreground = foregroundSvg({
    postType,
    label,
    title: cleanTitle,
    summary: cleanSummary,
    hasLogo: Boolean(resolvedLogo?.length),
  });
  const composite = [
    { input: base, left: 0, top: 0 },
    { input: visual, left: 88, top: 280 },
  ];
  if (resolvedLogo?.length) composite.push({ input: resolvedLogo, left: 72, top: 32 });
  composite.push({ input: foreground, left: 0, top: 0 });

  const buffer = await sharp({
    create: {
      width: EDITORIAL_SOCIAL_CARD_WIDTH,
      height: EDITORIAL_SOCIAL_CARD_HEIGHT,
      channels: 3,
      background: "#FBFDFC",
    },
  })
    .composite(composite)
    .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toBuffer();

  const metadata = await sharp(buffer).metadata();
  if (metadata.width !== EDITORIAL_SOCIAL_CARD_WIDTH || metadata.height !== EDITORIAL_SOCIAL_CARD_HEIGHT || metadata.format !== "jpeg") {
    throw new Error("Cover social: output grafico non valido");
  }
  return {
    buffer,
    mimeType: EDITORIAL_SOCIAL_CARD_MIME,
    width: EDITORIAL_SOCIAL_CARD_WIDTH,
    height: EDITORIAL_SOCIAL_CARD_HEIGHT,
    templateVersion: EDITORIAL_SOCIAL_CARD_TEMPLATE_VERSION,
  };
}
