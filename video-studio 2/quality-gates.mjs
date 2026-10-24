#!/usr/bin/env node
// Video Studio v0.6.0 – read-only pre-render editorial gates.
// These checks intentionally cannot approve a video: mobile viewing, photography,
// sound design and source/licence review always require a human sign-off.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRAME, OFFICIAL_LOGO_SHA256, intersects, VIDEO_STUDIO_VERSION } from './core.mjs';

const VALID_ROLES = new Set(['hook', 'context', 'value', 'action', 'cta']);
const SAFE = Object.freeze({ x: 75, y: 270, width: 930, height: 980 });
const MIN = Object.freeze({ hook: 100, headline: 90, secondary: 52, logoWidth: 220 });
function rect(r) {
  return r && ['x', 'y', 'width', 'height'].every(k => Number.isInteger(r[k])) &&
    r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 &&
    r.x + r.width <= FRAME.width && r.y + r.height <= FRAME.height;
}
function within(box, area) {
  return rect(box) && box.x >= area.x && box.y >= area.y &&
    box.x + box.width <= area.x + area.width && box.y + box.height <= area.y + area.height;
}
function string(s) { return typeof s === 'string' && s.trim().length > 0; }
function words(s) { return string(s) ? s.trim().split(/\s+/u).length : 0; }
function result(gate, code, message, scene = null) { return { gate, code, message, ...(scene ? { scene } : {}) }; }
function validHash(s) { return typeof s === 'string' && /^[a-f0-9]{64}$/i.test(s); }
function timings(job) {
  let start = 0;
  return (job.scenes || []).map(s => {
    const v = { id: s?.id, start_ms: start, end_ms: start + (Number.isInteger(s?.duration_ms) ? s.duration_ms : 0) };
    start = v.end_ms;
    return v;
  });
}
// This specification is an additional, opt-in quality contract, not a substitute
// for the legacy job schema. A legacy job is intentionally marked NOT READY.
export function evaluateQualityGates(job) {
  const issues = [];
  const add = (g, c, m, sid) => issues.push(result(g, c, m, sid));
  if (!job || typeof job !== 'object' || !Array.isArray(job.scenes)) {
    return { engine_version: VIDEO_STUDIO_VERSION, quality_status: 'blocked',
      issues: [result('G1', 'JOB_MISSING', 'Job di produzione con scene mancante')],
      requires_human_review: true, publication_authorized: false };
  }
  if (!['instagram_reel', 'facebook_reel'].includes(job.platform)) add('G0', 'PLATFORM', 'Destinazione non supportata');
  const safe = SAFE; // Conservative Reel ad canvas; target-specific organic UI still requires visual preview.
  const timeline = timings(job);
  const duration = timeline.length ? timeline.at(-1).end_ms : 0;
  if (duration !== FRAME.durationMs) add('G1', 'DURATION', 'Timeline differente dal profilo iniziale 15 s');
  if (job.scenes.length < 3 || job.scenes.length > 5) add('G1', 'SCENE_COUNT', 'Servono 3–5 scene con funzioni narrative chiare');
  if (!string(job.article?.id) || !string(job.article?.version)) add('G0', 'ARTICLE', 'Snapshot articolo mancante');
  const roles = job.scenes.map(s => s?.quality?.role);
  if (roles[0] !== 'hook' || roles.at(-1) !== 'cta') add('G1', 'NARRATIVE_ARC', 'Prima scena hook e ultima scena CTA obbligatorie');
  if (!roles.some(r => r === 'value')) add('G1', 'VALUE', 'Manca una risposta/informazione concreta');
  if (!roles.every(r => VALID_ROLES.has(r))) add('G1', 'ROLE_UNVERIFIED', 'Funzione narrativa assente o non riconosciuta');
  for (const [i, s] of job.scenes.entries()) {
    const q = s?.quality && typeof s.quality === 'object' ? s.quality : {};
    const sid = string(s?.id) ? s.id : `scena_${i+1}`;
    if (!string(q.headline) || words(q.headline) > 9) add('G1', 'HEADLINE_COPY', 'Titolo assente o oltre 9 parole', sid);
    const fontMinimum = i === 0 ? MIN.hook : MIN.headline;
    if (!Number.isFinite(q.headline_font_px) || q.headline_font_px < fontMinimum)
      add('G1', 'HEADLINE_SIZE', `Titolo sotto ${fontMinimum} px nel master`, sid);
    if (string(q.secondary_text) && (!Number.isFinite(q.secondary_font_px) || q.secondary_font_px < MIN.secondary))
      add('G1', 'SECONDARY_SIZE', 'Testo secondario sotto 52 px nel master', sid);
    if (!within(q.headline_region, safe)) add('G1', 'HEADLINE_SAFE', 'Titolo fuori area conservativa centrale', sid);
    if (string(q.secondary_text) && !within(q.secondary_region, safe)) add('G1', 'SECONDARY_SAFE', 'Testo secondario fuori area conservativa centrale', sid);
    if (!Array.isArray(q.protected_regions) || q.protected_regions.some(b => !rect(b)))
      add('G1', 'SUBJECT_REVIEW', 'Aree protette non documentate o non valide', sid);
    else {
      if (rect(q.headline_region) && q.protected_regions.some(b => intersects(q.headline_region, b)))
        add('G1', 'SUBJECT_OCCLUSION', 'Titolo sovrapposto a un soggetto protetto', sid);
      if (rect(q.secondary_region) && q.protected_regions.some(b => intersects(q.secondary_region, b)))
        add('G1', 'SUBJECT_OCCLUSION', 'Sottotitolo sovrapposto a un soggetto protetto', sid);
    }
    if (q.negative_space_reviewed !== true) add('G1', 'NEGATIVE_SPACE', 'Relazione soggetto-testo non verificata visivamente', sid);
    if (q.mobile_preview_reviewed !== true) add('G2', 'MOBILE_REVIEW', 'Lettura a 360×640 non approvata', sid);
    if (q.contrast_reviewed !== true) add('G2', 'CONTRAST_REVIEW', 'Contrasto sulle zone più difficili non approvato', sid);
    // Do not infer visual presence from an original file's existence.
    if (i === 0 || i === job.scenes.length - 1) {
      if (q.logo_sha256 !== OFFICIAL_LOGO_SHA256 || !within(q.logo_region, safe) || q.logo_region.width < MIN.logoWidth)
        add('G1', 'BRAND', 'Logo originale riconoscibile non attestato per hook/CTA', sid);
      if (q.logo_visibility_reviewed !== true) add('G2', 'BRAND_MOBILE', 'Presenza e dimensione logo nel frame finale non approvate', sid);
    }
  }
  const m = job.music || {};
  const d = m.direction || {};
  if (!validHash(m.sha256) || m.segment?.status !== 'approved' || m.license?.status !== 'approved' ||
      !m.license?.allowed_platforms?.includes(job.platform))
    add('G0', 'MUSIC_RIGHTS', 'Segmento, hash o autorizzazione musicale insufficienti');
  if (!Number.isInteger(d.hook_cue_ms) || d.hook_cue_ms < 0 || d.hook_cue_ms > 2000)
    add('G1', 'MUSIC_HOOK', 'Cue iniziale 0–2 s non documentato');
  if (!Array.isArray(d.change_cues_ms) || d.change_cues_ms.length < 1 ||
      !d.change_cues_ms.every(t => Number.isInteger(t) && t >= 2000 && t < 13000))
    add('G1', 'MUSIC_CUES', 'Nessun cambiamento musicale motivato associabile al racconto');
  const cta = timeline.at(-1);
  if (!cta || cta.start_ms > 12000 || cta.end_ms !== FRAME.durationMs)
    add('G1', 'CTA_TIMING', 'CTA assente o priva del tempo minimo di lettura');
  if (!Number.isInteger(d.fade_start_ms) || !Number.isInteger(d.fade_duration_ms) ||
      d.fade_duration_ms < 800 || d.fade_duration_ms > 1500 ||
      d.fade_start_ms + d.fade_duration_ms !== FRAME.durationMs ||
      (cta && d.fade_start_ms - cta.start_ms < 1000))
    add('G1', 'MUSIC_OUTRO', 'La CTA deve iniziare prima di una dissolvenza musicale da 0,8–1,5 s');
  if (d.audition_reviewed !== true || !string(d.audition_reviewer))
    add('G2', 'MUSIC_REVIEW', 'Attacco, cue e uscita non ascoltati e approvati da un revisore');
  // The outcome is never an editorial sign-off: metadata cannot prove aesthetics,
  // actual logo pixels, factual claims or licensing entitlement.
  return { engine_version: VIDEO_STUDIO_VERSION, policy_version: 'audiovisual-v1',
    quality_status: issues.length ? 'blocked' : 'ready_for_human_master_review',
    issues, requires_human_review: true, publication_authorized: false,
    checks: { profile: '1080x1920-15s', reel_safe_region: safe,
      hook_min_px: MIN.hook, headline_min_px: MIN.headline, secondary_min_px: MIN.secondary,
      logo_min_width_px: MIN.logoWidth, review_required_for_organic_ui: true },
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    if (process.argv.length !== 4 || process.argv[2] !== '--job')
      throw new Error('Uso: node video-studio/quality-gates.mjs --job /path/job.json');
    const input = JSON.parse(await readFile(resolve(process.argv[3]), 'utf8'));
    const out = evaluateQualityGates(input);
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    if (out.quality_status === 'blocked') process.exitCode = 2;
  })().catch(err => { process.stderr.write(`${err.message}\n`); process.exitCode = 1; });
}
