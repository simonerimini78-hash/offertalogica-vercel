import { createRequire } from 'node:module';
import { FRAME, LOGO_PANEL, TEXT_SAFE, OFFICIAL_LOGO_SHA256, sha256 } from './core.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const FONT_PX = 64;
const LINE_PX = 80;
const PADDING = 32;
const FONT = 'DejaVu Sans Bold';
function demand(ok, message) { if (!ok) throw new Error(`VIDEO_STUDIO_GRAPHICS: ${message}`); }
function escapeXml(v) { return v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;'); }

export async function measureLine(text) {
  demand(typeof text === 'string' && text.length && text.length <= 100, 'testo assente o oltre limite');
  const meta = await sharp({ text: { text, font: `${FONT} ${FONT_PX}`, dpi: 72 } }).metadata();
  return meta.width;
}

// Keep the background panel close to the actual text instead of obscuring the full text-safe region.
export function panelHeight(lineCount) {
  demand(Number.isInteger(lineCount) && lineCount >= 1 && lineCount <= 3, 'numero righe non ammesso');
  return 88 + LINE_PX * lineCount;
}

export async function composeFrame({ photoFile, scene, isLast, logoBytes, outputFile }) {
  demand(scene?.text_region && Array.isArray(scene.text_lines) && scene.text_lines.length >= 1 && scene.text_lines.length <= 3, 'layout testo incompleto');
  const r = scene.text_region;
  const h = panelHeight(scene.text_lines.length);
  demand(Number.isInteger(r.x) && Number.isInteger(r.y) && Number.isInteger(r.width) && Number.isInteger(r.height), 'rettangolo non valido');
  demand(r.height >= h && r.x >= TEXT_SAFE.x && r.y >= TEXT_SAFE.y &&
    r.x + r.width <= TEXT_SAFE.x + TEXT_SAFE.width && r.y + r.height <= TEXT_SAFE.y + TEXT_SAFE.height, 'pannello fuori safe area');
  const texts = [];
  for (let i = 0; i < scene.text_lines.length; i++) {
    const text = scene.text_lines[i];
    const measured = await measureLine(text);
    demand(measured <= r.width - 2 * PADDING, `scene ${scene.id}: riga ${i + 1} troppo larga`);
    texts.push(`<text x="${r.x + r.width / 2}" y="${r.y + 71 + i * LINE_PX}" text-anchor="middle" font-family="DejaVu Sans" font-weight="700" font-size="${FONT_PX}" fill="#ffffff">${escapeXml(text)}</text>`);
  }
  const panel = `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${h}" rx="24" fill="#14532d" fill-opacity=".81"/>`;
  const brandPanel = isLast ? `<rect x="${LOGO_PANEL.x}" y="${LOGO_PANEL.y}" width="${LOGO_PANEL.width}" height="${LOGO_PANEL.height}" rx="25" fill="#ffffff" fill-opacity=".97"/>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME.width}" height="${FRAME.height}">${panel}${brandPanel}${texts.join('')}</svg>`;
  const layers = [{ input: Buffer.from(svg), top: 0, left: 0 }];
  if (isLast) {
    demand(Buffer.isBuffer(logoBytes) && sha256(logoBytes) === OFFICIAL_LOGO_SHA256, 'logo ufficiale errato');
    const resizedLogo = await sharp(logoBytes).resize({ width: 480 }).png().toBuffer();
    layers.push({ input: resizedLogo, left: 301, top: 1213 });
  }
  const meta = await sharp(photoFile).metadata();
  demand(['jpeg', 'png', 'webp'].includes(meta.format) && meta.width === FRAME.width && meta.height === FRAME.height && (!meta.orientation || meta.orientation === 1), 'foto ritagliata deve essere 1080x1920, senza rotazione EXIF');
  await sharp(photoFile).composite(layers).png().toFile(outputFile);
  return outputFile;
}
