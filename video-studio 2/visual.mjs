#!/usr/bin/env node
// Local photo selection, crop protection, composition previews. No image-generation or publication calls.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, rm, stat, access, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeArticle, FRAME, LOGO_PANEL, TEXT_SAFE, VIDEO_STUDIO_VERSION, intersects } from './core.mjs';
import { prepareRenderJob } from './storyboard.mjs';
import { composeFrame, measureLine, panelHeight } from './scene-graphics.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOGO = join(PROJECT, 'public/assets/logo-offertalogica-header.png');
const { width: WIDTH, height: HEIGHT } = FRAME;
const OUT_WIDTH = 832;
const LINE_LIMIT = 3;
const MARGIN = 32;
const TEXT_Y = [240, 570, 900, 1240];

function demand(ok, reason) { if (!ok) throw new Error(`VIDEO_STUDIO_VISUAL: ${reason}`); }
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function withinRepository(path) { const rel = relative(PROJECT, path); return !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel); }
function requireOutsideRepository(output) {
  demand(isAbsolute(output || '') && resolve(output) !== '/' && !withinRepository(resolve(output)), 'directory output deve essere assoluta, privata e fuori repository');
}
function rect(box, w, h) {
  return box && ['x', 'y', 'width', 'height'].every(k => Number.isInteger(box[k])) &&
    box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0 && box.x + box.width <= w && box.y + box.height <= h;
}
function cropMetrics(w, h) {
  // Exact 9:16 output ratio, without stretching the image.
  if (w * 16 >= h * 9) {
    const cropH = Math.floor(h / 16) * 16;
    return { width: cropH * 9 / 16, height: cropH, maxLeft: w - cropH * 9 / 16, maxTop: h - cropH };
  }
  const cropW = Math.floor(w / 9) * 9;
  return { width: cropW, height: cropW * 16 / 9, maxLeft: w - cropW, maxTop: h - cropW * 16 / 9 };
}
function projectedRect(b, crop) {
  const scale = WIDTH / crop.width;
  return {
    x: Math.floor((b.x - crop.left) * scale), y: Math.floor((b.y - crop.top) * scale),
    width: Math.ceil(b.width * scale), height: Math.ceil(b.height * scale),
  };
}
function protectedInsideSourceCrop(box, crop) {
  // Extra crop margin is required around people, hands, and narrative objects.
  const pad = Math.min(24, Math.floor(Math.min(crop.width, crop.height) * 0.025));
  return box.x >= crop.left + pad && box.y >= crop.top + pad &&
    box.x + box.width <= crop.left + crop.width - pad && box.y + box.height <= crop.top + crop.height - pad;
}
function cropCandidates(w, h) {
  const base = cropMetrics(w, h);
  demand(base.width >= WIDTH && base.height >= HEIGHT, 'crop 9:16 insufficiente per 1080x1920 senza upscaling');
  const coords = [0, .125, .25, .375, .5, .625, .75, .875, 1];
  const result = [];
  for (const x of coords) for (const y of coords) {
    const c = { left: Math.round(base.maxLeft * x), top: Math.round(base.maxTop * y), width: base.width, height: base.height };
    if (!result.some(v => v.left === c.left && v.top === c.top)) result.push(c);
  }
  return result;
}
function layoutOptions(lineCount, isLast, regions) {
  const h = panelHeight(lineCount);
  return TEXT_Y.map(y => ({ x: TEXT_SAFE.x + 16, y, width: OUT_WIDTH, height: h }))
    .filter(r => r.y + r.height <= TEXT_SAFE.y + TEXT_SAFE.height &&
      (!isLast || !intersects(r, LOGO_PANEL)) && regions.every(p => !intersects(p, r)));
}
async function wrapText(text) {
  if (typeof text !== 'string' || !text.trim()) return { lines: [], reason: 'testo mancante: revisione necessaria' };
  demand(text.length <= 1200, 'testo suggerito troppo lungo');
  const words = text.trim().split(/\s+/u);
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (test.length <= 100 && await measureLine(test) <= OUT_WIDTH - 2 * MARGIN) { current = test; continue; }
    if (!current) return { lines: [], reason: `parola troppo lunga per la composizione: ${word.slice(0, 30)}` };
    lines.push(current);
    current = word;
    if (current.length > 100 || await measureLine(current) > OUT_WIDTH - 2 * MARGIN || lines.length >= LINE_LIMIT) {
      return { lines: [], reason: 'testo troppo lungo per 3 righe: richiede sintesi editoriale approvata' };
    }
  }
  if (current) lines.push(current);
  return lines.length <= LINE_LIMIT ? { lines, reason: null } : { lines: [], reason: 'testo troppo lungo per 3 righe' };
}
async function photoMeta(item) {
  demand(item && typeof item.id === 'string' && /^[a-z0-9_-]{1,60}$/i.test(item.id), 'ID foto non valido');
  demand(isAbsolute(item.file || '') && !/^\w+:\/\//.test(item.file), `${item.id}: foto deve essere file locale assoluto`);
  const path = resolve(item.file);
  const s = await stat(path);
  demand(s.isFile() && s.size >= 4096 && s.size <= 50 * 1024 * 1024, `${item.id}: file mancante o troppo grande`);
  const meta = await sharp(path).metadata();
  demand(['jpeg', 'png', 'webp'].includes(meta.format) && meta.width >= 1080 && meta.height >= 1920, `${item.id}: formato o risoluzione insufficiente`);
  demand(!meta.orientation || meta.orientation === 1, `${item.id}: rotazione EXIF presente, normalizzare prima la verifica delle aree protette`);
  demand(Array.isArray(item.protected_regions) && item.protected_regions.every(p => rect(p, meta.width, meta.height)), `${item.id}: rettangoli protetti fuori sorgente`);
  demand(item.protected_regions_reviewed === true && typeof item.reviewed_by === 'string' && item.reviewed_by.trim(), `${item.id}: aree protette non confermate da revisore`);
  demand(typeof item.image_reviewed_clean === 'boolean', `${item.id}: attestazione foto pulita obbligatoria`);
  demand(Array.isArray(item.scene_ids) && item.scene_ids.length && item.scene_ids.every(v => /^scene_[1-4]$/.test(v)), `${item.id}: assegnazione scene mancante`);
  demand(typeof item.rights_note === 'string' && item.rights_note.trim(), `${item.id}: origine/diritti immagine non documentati`);
  return { ...item, file: path, width: meta.width, height: meta.height, file_sha256: sha(await readFile(path)) };
}
function bestGeometry(photo, lineCount, isLast) {
  const options = [];
  for (const crop of cropCandidates(photo.width, photo.height)) {
    if (!photo.protected_regions.every(p => protectedInsideSourceCrop(p, crop))) continue;
    const protectedRegions = photo.protected_regions.map(p => projectedRect(p, crop));
    if (!protectedRegions.every(p => rect(p, WIDTH, HEIGHT))) continue;
    if (isLast && protectedRegions.some(p => intersects(p, LOGO_PANEL))) continue;
    for (const text of layoutOptions(lineCount, isLast, protectedRegions)) {
      const centerX = crop.left + crop.width / 2;
      const centerY = crop.top + crop.height / 2;
      const centerPenalty = Math.abs(centerX - photo.width / 2) / photo.width + Math.abs(centerY - photo.height / 2) / photo.height;
      const safeDist = protectedRegions.length ? Math.min(...protectedRegions.map(p => Math.abs((p.y + p.height / 2) - (text.y + text.height / 2)))) : 500;
      options.push({ crop, protectedRegions, textRegion: text,
        score: 2 * Math.min(safeDist / 500, 1) - centerPenalty - TEXT_Y.indexOf(text.y) * 0.03 });
    }
  }
  options.sort((a, b) => b.score - a.score || a.crop.left - b.crop.left || a.crop.top - b.crop.top);
  return options[0] || null;
}

export async function proposeVisualPlan(draft, inventory, { texts = {} } = {}) {
  demand(draft?.draft_schema_version === 1 && draft.scenes?.length === 4 && draft.status === 'needs_human_review', 'storyboard v0.2 non valido');
  const { fingerprint } = freezeArticle(draft.article);
  demand(fingerprint === draft.source_fingerprint, 'articolo sorgente cambiato dopo il congelamento');
  demand(inventory && Array.isArray(inventory.photos) && inventory.photos.length >= 1 && inventory.photos.length <= 100, 'inventario foto mancante');
  demand(texts && typeof texts === 'object' && !Array.isArray(texts), 'testi per scena non validi');
  const photos = await Promise.all(inventory.photos.map(photoMeta));
  demand(new Set(photos.map(p => p.id)).size === photos.length, 'ID foto duplicato');
  const usage = new Map();
  const result = [];
  for (const [index, scene] of draft.scenes.entries()) {
    demand(scene.id === `scene_${index + 1}`, 'ordine scene non compatibile');
    const customLines = texts[scene.id];
    demand(customLines === undefined || (Array.isArray(customLines) && customLines.length >= 1 && customLines.length <= 3 && customLines.every(v => typeof v === 'string' && v.trim() && v.length <= 100)), 'testi personalizzati non validi');
    const formatted = customLines ? { lines: customLines, reason: null } : await wrapText(scene.text_suggestion);
    const invalidLine = formatted.lines.length ? (await Promise.all(formatted.lines.map(measureLine))).some(width => width > OUT_WIDTH - 2 * MARGIN) : false;
    const textIssue = formatted.reason || (invalidLine ? 'riga oltre larghezza utile: riformulare testo' : null);
    let choices = [];
    if (formatted.lines.length && !textIssue) {
      for (const photo of photos.filter(p => p.scene_ids.includes(scene.id))) {
        const candidate = bestGeometry(photo, formatted.lines.length, index === draft.scenes.length - 1);
        if (candidate) choices.push({ ...candidate, photo, rank: candidate.score - (usage.get(photo.id) || 0) * 2 });
      }
    }
    choices.sort((a, b) => b.rank - a.rank || a.photo.id.localeCompare(b.photo.id));
    const chosen = choices[0];
    if (chosen) usage.set(chosen.photo.id, (usage.get(chosen.photo.id) || 0) + 1);
    const reasons = [];
    if (textIssue) reasons.push(textIssue);
    if (!chosen) reasons.push('nessuna fotografia con crop 9:16, aree protette e spazio testo compatibili');
    if (chosen && !chosen.photo.image_reviewed_clean) reasons.push('foto non ancora approvata come pulita');
    reasons.push('testo e correttezza editoriale da approvare prima del render');
    result.push({
      id: scene.id, duration_ms: scene.duration_ms, editorial_goal: scene.editorial_goal,
      claim_ids: scene.suggested_claim_id ? [scene.suggested_claim_id] : [],
      text_lines: formatted.lines, text_region: chosen?.textRegion || null,
      image: chosen ? `scene-photos/${scene.id}.png` : null,
      image_reviewed_clean: chosen?.photo.image_reviewed_clean === true,
      protected_regions: chosen?.protectedRegions || [],
      source_photo_id: chosen?.photo.id || null, photo_sha256: chosen?.photo.file_sha256 || null,
      photo_rights_note: chosen?.photo.rights_note || null, source_crop: chosen?.crop || null,
      review_reasons: reasons, needs_text_review: true,
      status: chosen && !textIssue ? 'needs_human_review' : 'blocked',
      _source_file: chosen?.photo.file || null,
    });
  }
  return { visual_schema_version: 1, engine_version: VIDEO_STUDIO_VERSION, source_fingerprint: fingerprint,
    platform: draft.platform, scenes: result, status: result.some(s => s.status === 'blocked') ? 'blocked' : 'needs_human_review',
    note: 'Il progetto NON approva automaticamente testi, diritti, soggetti o musica. Nessun Reel pubblicabile senza revisione.' };
}

// Approval remains an explicit human action, distinct from automatically finding a feasible composition.
// The resulting job must be saved beside visual-plan.json for its relative image paths to resolve.
export function prepareReviewedVisualJob(draft, plan, { reviewedBy, approvedMessage, claimSourceIds,
  music, article = draft?.article, approveTexts = false, approveImages = false } = {}) {
  demand(plan?.status === 'needs_human_review' && plan?.visual_schema_version === 1 && plan.scenes?.length === 4,
    'piano visuale incompleto o bloccato');
  demand(approveTexts === true && approveImages === true, 'conferma esplicita di testo, foto e layout mancante');
  demand(plan.source_fingerprint === draft?.source_fingerprint, 'fingerprint della fonte non coincide');
  const scenes = plan.scenes.map(scene => {
    demand(scene.status === 'needs_human_review' && scene.image_reviewed_clean === true &&
      scene.image && /^[a-f0-9]{64}$/.test(scene.output_image_sha256 || '') &&
      scene.text_region && scene.text_lines.length > 0 && scene.photo_rights_note,
    `scene ${scene.id}: revisione o asset incompleti`);
    return {
      id: scene.id, duration_ms: scene.duration_ms, editorial_goal: scene.editorial_goal,
      image: scene.image, image_sha256: scene.output_image_sha256,
      image_reviewed_clean: true, text_lines: [...scene.text_lines],
      text_region: structuredClone(scene.text_region), protected_regions: structuredClone(scene.protected_regions),
      claim_ids: [...scene.claim_ids],
    };
  });
  return prepareRenderJob(draft, { article, reviewedBy, approvedMessage, claimSourceIds, scenes, music,
    platform: plan.platform });
}

export async function materializeVisualPlan(plan, outputDir) {
  requireOutsideRepository(outputDir);
  const dest = resolve(outputDir);
  demand(plan?.visual_schema_version === 1 && plan.scenes?.length === 4, 'piano visuale invalido');
  try { await access(dest); demand(false, 'output già esistente: non sovrascrivo'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await mkdir(dirname(dest), { recursive: true });
  const temp = await mkdtemp(join(dirname(dest), '.vs-visual-'));
  try {
    const logo = await readFile(LOGO);
    const save = structuredClone(plan);
    for (const [index, scene] of plan.scenes.entries()) {
      if (!scene._source_file || !scene.source_crop || !scene.image) continue;
      const photoDest = join(temp, scene.image);
      demand(sha(await readFile(scene._source_file)) === scene.photo_sha256, `${scene.id}: fotografia modificata dopo il piano`);
      await mkdir(dirname(photoDest), { recursive: true });
      await sharp(scene._source_file).extract(scene.source_crop).resize(WIDTH, HEIGHT).png().toFile(photoDest);
      save.scenes[index].output_image_sha256 = sha(await readFile(photoDest));
      if (scene.status !== 'blocked') {
        const preview = join(temp, 'previews', `${scene.id}.png`);
        await mkdir(dirname(preview), { recursive: true });
        await composeFrame({ photoFile: photoDest, scene, isLast: index === plan.scenes.length - 1,
          logoBytes: logo, outputFile: preview });
      }
    }
    for (const scene of save.scenes) delete scene._source_file;
    await writeFile(join(temp, 'visual-plan.json'), JSON.stringify(save, null, 2), { flag: 'wx', mode: 0o600 });
    await rename(temp, dest);
    return { path: join(dest, 'visual-plan.json'), status: plan.status, previews: plan.scenes.filter(s => s.status !== 'blocked').length };
  } catch (error) { await rm(temp, { recursive: true, force: true }); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    const args = process.argv.slice(2);
    demand(args.length === 6 && args[0] === '--draft' && args[2] === '--photos' && args[4] === '--out',
      'uso: node video-studio/visual.mjs --draft storyboard.json --photos inventory.json --out /absolute/private/output-dir');
    const draft = JSON.parse(await readFile(resolve(args[1]), 'utf8'));
    const data = JSON.parse(await readFile(resolve(args[3]), 'utf8'));
    const plan = await proposeVisualPlan(draft, data, { texts: data.texts || {} });
    return materializeVisualPlan(plan, args[5]);
  })().then(v => console.log(JSON.stringify(v)))
    .catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
