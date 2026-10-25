#!/usr/bin/env node
// Offline, private preparation/finalization of a single human-reviewed Reel.
// No image generation, catalog mutation, automatic approval, API or publishing.
import { createHash } from 'node:crypto';
import { readFile, writeFile, access, lstat, realpath } from 'node:fs/promises';
import { resolve, dirname, join, isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeArticle, VIDEO_STUDIO_VERSION } from './core.mjs';
import { proposeStoryboard } from './storyboard.mjs';
import { proposeVisualPlan, materializeVisualPlan, prepareReviewedVisualJob } from './visual.mjs';
import { readCatalog, resolveApprovedSegment } from './music-library.mjs';

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function demand(ok, reason) { if (!ok) throw new Error(`VIDEO_STUDIO_PILOT: ${reason}`); }
function sha(data) { return createHash('sha256').update(data).digest('hex'); }
function encodeHtml(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
async function loadJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function saveNew(file, object) { await writeFile(file, JSON.stringify(object, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
function insideRepo(p) {
  const rel = relative(PROJECT, p);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
async function privatePath(p) {
  demand(typeof p === 'string' && isAbsolute(p), 'percorso privato assoluto obbligatorio');
  const dest = resolve(p);
  demand(dest !== '/' && !insideRepo(dest), 'non scrivere nel repository o in /');
  // Reject symlinks in existing ancestors, including redirects back into public/.
  let cursor = dest;
  while (true) {
    try {
      const info = await lstat(cursor);
      demand(!info.isSymbolicLink(), 'symlink non ammesso nel percorso privato');
      demand(!insideRepo(await realpath(cursor)), 'percorso fisico dentro il repository');
    } catch (err) { if (err.code !== 'ENOENT') throw err; }
    const parent = dirname(cursor);
    if (cursor === parent) break;
    cursor = parent;
  }
  return dest;
}
function summaryTracks(catalog, platform, mood) {
  return catalog.tracks.map(t => ({
    id: t.id, title: t.title, track_status: t.status, license_status: t.license?.status,
    allowed_for_platform: t.license?.allowed_platforms?.includes(platform) === true,
    mood_supported: t.approved_moods?.includes(mood) === true,
    segments: (t.segments || []).map(s => ({ id: s.id, start_ms: s.start_ms, end_ms: s.end_ms, status: s.status })),
  }));
}
function renderPage(draft, plan, music) {
  const scenes = plan.scenes.map((s, i) => `
    <section><h2>Scena ${i + 1} · ${s.duration_ms / 1000} s</h2>
      ${s.status === 'blocked' ? '<p class="warning">SCENA BLOCCATA</p>' : `<img alt="Anteprima scena ${i + 1}" src="previews/${encodeHtml(s.id)}.png">`}
      <p><strong>Testo proposto:</strong> ${s.text_lines.map(encodeHtml).join(' / ') || 'Non disponibile'}</p>
      <p><strong>Fonte foto:</strong> ${encodeHtml(s.source_photo_id || 'nessuna')}</p>
      <p><strong>Diritti dichiarati:</strong> ${encodeHtml(s.photo_rights_note || 'non documentati')}</p>
      <p><strong>Verifiche:</strong> ${s.review_reasons.map(encodeHtml).join('; ')}</p></section>`).join('');
  const tracks = music.tracks.map(t => `<tr><td>${encodeHtml(t.title)}</td><td>${encodeHtml(t.id)}</td><td>${encodeHtml(t.license_status)}</td><td>${encodeHtml(t.track_status)}</td><td>${t.segments.filter(s => s.status === 'approved').length}</td></tr>`).join('');
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Revisione privata Video Studio</title><style>
    body{font:16px/1.55 system-ui,Arial,sans-serif;background:#f7f7f6;color:#14231b;max-width:900px;margin:24px auto;padding:0 16px}
    section{background:white;padding:18px;margin:18px 0;border:1px solid #dde4df;border-radius:12px}
    img{width:min(280px,100%);display:block;margin:12px 0;border-radius:9px}
    table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:9px;text-align:left;border-bottom:1px solid #ccc;word-break:break-word}
    .warning{font-weight:bold;color:#a11}small{color:#455}code{word-break:break-all}
    </style></head><body><h1>Video Studio · revisione pilota</h1>
    <p class="warning">Bozza privata. Nessun contenuto è approvato per pubblicazione.</p>
    <p><strong>Articolo:</strong> ${encodeHtml(draft.article.title)} · <strong>Versione:</strong> ${encodeHtml(draft.article.version)}</p>
    <p><strong>Fingerprint:</strong> <code>${encodeHtml(draft.source_fingerprint)}</code></p>
    <section><h2>Messaggio candidato</h2><p>${encodeHtml(draft.selected_excerpt)}</p>
      <p><strong>Motivazione automatica:</strong> ${encodeHtml(draft.selection_reason)}</p>
      <p><small>La corrispondenza fra affermazione e fonti va verificata dall'editor.</small></p></section>
    ${scenes}
    <section><h2>Catalogo musicale</h2><p>Per ascoltare gli estratti usa il pacchetto audio privato generato dalla v0.4.0. Qui non si approvano licenze.</p>
      <table><thead><tr><th>Traccia</th><th>ID</th><th>Licenza</th><th>Stato</th><th>Segmenti approvati</th></tr></thead><tbody>${tracks}</tbody></table></section>
    <section><h2>Passaggio alla produzione</h2><p>Compilare <code>review-request.json</code> soltanto dopo verifica delle fonti, delle immagini, dei box protetti e delle licenze. Il comando finalize genera un job, non pubblica né approva l'MP4.</p></section>
    </body></html>`;
}
export async function preparePilot({ articleFile, photosFile, musicRoot, outputDir, platform = 'instagram_reel', mood = 'informativo' }) {
  demand(articleFile && photosFile && musicRoot, 'articolo, inventario foto e libreria obbligatori');
  const out = await privatePath(outputDir);
  await privatePath(musicRoot);
  const article = await loadJson(resolve(articleFile));
  const photos = await loadJson(resolve(photosFile));
  const draft = proposeStoryboard(article, { platform, mood });
  const plan = await proposeVisualPlan(draft, photos, { texts: photos.texts || {} });
  const catalog = await readCatalog(musicRoot);
  await materializeVisualPlan(plan, out);
  const planData = await readFile(join(out, 'visual-plan.json'));
  const draftData = JSON.stringify(draft, null, 2) + '\n';
  const musicSummary = { library_version: catalog.library_version, platform, mood, tracks: summaryTracks(catalog, platform, mood) };
  const basis = { source_fingerprint: draft.source_fingerprint,
    draft_sha256: sha(draftData), visual_plan_sha256: sha(planData),
    music_catalog_sha256: sha(await readFile(join(musicRoot, 'catalog.json')).catch(() => Buffer.from(''))),
  };
  const review = {
    pilot_review_schema_version: 1, basis,
    reviewer: '', approved_message: '', claim_source_ids: [],
    scenes: Object.fromEntries(plan.scenes.map(s => [s.id, { text_approved: false, image_approved: false,
      subject_regions_approved: false, image_rights_approved: false, notes: '' }])),
    music: { track_id: '', segment_id: '', license_evidence_verified: false },
  };
  await saveNew(join(out, 'storyboard.json'), draft);
  await saveNew(join(out, 'review-request.json'), review);
  await saveNew(join(out, 'music-status.json'), musicSummary);
  await writeFile(join(out, 'review.html'), renderPage(draft, await loadJson(join(out, 'visual-plan.json')), musicSummary), { flag: 'wx', mode: 0o600 });
  return { review_folder: out, version: VIDEO_STUDIO_VERSION, status: plan.status,
    preview_count: plan.scenes.filter(s => s.status !== 'blocked').length,
    music_approved: musicSummary.tracks.some(t => t.track_status === 'approved' && t.license_status === 'approved' && t.mood_supported && t.allowed_for_platform && t.segments.some(s => s.status === 'approved')),
    publication: 'disabled' };
}
export async function finalizePilot({ workDir, musicRoot }) {
  const base = await privatePath(workDir);
  await privatePath(musicRoot);
  const draftPath = join(base, 'storyboard.json');
  const planPath = join(base, 'visual-plan.json');
  const reviewPath = join(base, 'review-request.json');
  const [draftBytes, planBytes, review, currentCatalogBytes] = await Promise.all([
    readFile(draftPath), readFile(planPath), loadJson(reviewPath), readFile(join(musicRoot, 'catalog.json')),
  ]);
  const draft = JSON.parse(draftBytes);
  const plan = JSON.parse(planBytes);
  demand(review.pilot_review_schema_version === 1, 'schema di revisione non riconosciuto');
  demand(review.basis?.source_fingerprint === draft.source_fingerprint &&
    review.basis.draft_sha256 === sha(draftBytes) &&
    review.basis.visual_plan_sha256 === sha(planBytes), 'storyboard o piano visivo alterati dopo preparazione');
  // Changes to the catalog may reflect legitimate staff approvals; do not treat
  // a historical catalog snapshot as proof that a license is STILL valid.
  const { fingerprint } = freezeArticle(draft.article);
  demand(fingerprint === draft.source_fingerprint, 'articolo cambiato rispetto allo snapshot');
  demand(plan.status === 'needs_human_review' && plan.source_fingerprint === fingerprint, 'scena bloccata o sorgente incoerente');
  demand(typeof review.reviewer === 'string' && review.reviewer.trim() && review.reviewer.length <= 200, 'revisore obbligatorio');
  demand(typeof review.approved_message === 'string' && review.approved_message.trim() && review.approved_message.length <= 320, 'messaggio approvato mancante');
  demand(Array.isArray(review.claim_source_ids) && review.claim_source_ids.length, 'fonti esplicite mancanti');
  demand(review.scenes && Object.keys(review.scenes).length === plan.scenes.length, 'approvazioni scena incomplete');
  for (const s of plan.scenes) {
    const signed = review.scenes[s.id];
    demand(signed && ['text_approved', 'image_approved', 'subject_regions_approved', 'image_rights_approved'].every(k => signed[k] === true), `${s.id}: revisione fotografica/testi/diritti insufficiente`);
  }
  demand(review.music?.license_evidence_verified === true, 'verifica documentale licenza non confermata');
  const music = await resolveApprovedSegment(musicRoot, { platform: draft.platform, mood: draft.mood,
    trackId: review.music.track_id, segmentId: review.music.segment_id });
  const job = prepareReviewedVisualJob(draft, plan, {
    reviewedBy: review.reviewer.trim(), approvedMessage: review.approved_message,
    claimSourceIds: review.claim_source_ids, music, approveTexts: true, approveImages: true,
  });
  const output = join(base, 'render-job.json');
  try { await access(output); demand(false, 'render-job.json già presente: non sovrascrivo'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  await saveNew(output, job);
  return { output, version: VIDEO_STUDIO_VERSION, status: 'ready_for_render_only',
    catalog_sha256_at_finalization: sha(currentCatalogBytes), publication: 'disabled' };
}
function parseArgs() {
  const [action, ...args] = process.argv.slice(2);
  demand(['prepare', 'finalize'].includes(action) && args.length % 2 === 0, 'uso: pilot.mjs prepare|finalize --opzione valore ...');
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    demand(/^--[a-z-]+$/.test(args[i]) && !Object.hasOwn(opts, args[i]), 'opzione CLI errata');
    opts[args[i]] = args[i + 1];
  }
  const allowed = action === 'prepare' ? ['--article', '--photos', '--music-root', '--out', '--platform', '--mood'] : ['--work', '--music-root'];
  demand(Object.keys(opts).every(k => allowed.includes(k)), 'opzione non supportata');
  if (action === 'prepare') {
    demand(['--article', '--photos', '--music-root', '--out'].every(k => opts[k]), 'opzioni prepare incomplete');
    return preparePilot({ articleFile: opts['--article'], photosFile: opts['--photos'], musicRoot: opts['--music-root'],
      outputDir: opts['--out'], platform: opts['--platform'] || 'instagram_reel', mood: opts['--mood'] || 'informativo' });
  }
  demand(opts['--work'] && opts['--music-root'], 'opzioni finalize incomplete');
  return finalizePilot({ workDir: opts['--work'], musicRoot: opts['--music-root'] });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  parseArgs().then(value => console.log(JSON.stringify(value, null, 2)))
    .catch(err => { console.error(err.stack || err.message); process.exitCode = 1; });
}
