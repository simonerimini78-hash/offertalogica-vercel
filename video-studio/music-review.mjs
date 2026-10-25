#!/usr/bin/env node
// Private, review-only audio auditions. No track/segment/license is approved by this tool.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCatalog } from './music-library.mjs';
import { FRAME, VIDEO_STUDIO_VERSION } from './core.mjs';

const exec = promisify(execFile);
const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HASH = /^[0-9a-f]{64}$/;
const TRACK = /^track_[0-9a-f]{20}$/;
const SEG = /^seg_\d+_15000$/;
function requireOk(condition, reason) { if (!condition) throw new Error(`VIDEO_STUDIO_AUDITION: ${reason}`); }
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function html(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function privateRoot(value) {
  requireOk(isAbsolute(value || ''), 'percorso privato assoluto obbligatorio');
  const path = resolve(value);
  const rel = relative(PROJECT, path);
  requireOk(rel === '..' || rel.startsWith(`..${sep}`), 'vietato esportare nel repository o in /public');
  requireOk(path !== '/' && path !== '/tmp' && path !== '/mnt/data', 'scegliere una cartella dedicata');
  return path;
}
async function verifyOutputParent(destination) {
  // Resolve the deepest existing parent BEFORE mkdir, so a symlink cannot route
  // even an empty output directory into the repository.
  let current = dirname(destination);
  for (;;) {
    try {
      const physical = await realpath(current);
      const rel = relative(PROJECT, physical);
      requireOk(rel === '..' || rel.startsWith(`..${sep}`), 'output nel repository tramite symlink');
      return;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      const upper = dirname(current);
      requireOk(upper !== current, 'genitore output non valido');
      current = upper;
    }
  }
}
function contained(base, file) {
  const normalized = resolve(base, file);
  const rel = relative(base, normalized);
  requireOk(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), 'percorso asset audio non valido');
  return normalized;
}
async function probe(path) {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path],
    { maxBuffer: 2 * 1024 * 1024, timeout: 20000 });
  return JSON.parse(stdout);
}
async function auditionClip(source, target, segment) {
  const ss = (segment.start_ms / 1000).toFixed(3);
  const { stderr } = await exec('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-ss', ss, '-i', source,
    '-map', '0:a:0', '-vn', '-af', `aresample=48000,atrim=duration=${FRAME.durationMs / 1000},asetpts=PTS-STARTPTS`,
    '-c:a', 'libmp3lame', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-y', target],
  { maxBuffer: 1024 * 1024, timeout: 60000 });
  requireOk(!stderr.trim(), 'FFmpeg ha segnalato un problema nell’estratto');
  const info = await probe(target);
  const audio = info.streams.filter(s => s.codec_type === 'audio');
  const duration = Number(info.format.duration);
  requireOk(audio.length === 1 && audio[0].codec_name === 'mp3' && audio[0].channels === 2,
    'anteprima audio non MP3 stereo');
  requireOk(duration >= 14.95 && duration <= 15.05, `estratto troncato (${duration}s)`);
  // These measurements are advisory: loudness, musical phrasing and quality remain human judgments.
  const { stderr: levels } = await exec('ffmpeg', ['-hide_banner', '-nostdin', '-i', target,
    '-af', 'volumedetect', '-f', 'null', '-'], { maxBuffer: 512000, timeout: 20000 });
  const mean = Number(levels.match(/mean_volume: ([-0-9.]+) dB/)?.[1]);
  const peak = Number(levels.match(/max_volume: ([-0-9.]+) dB/)?.[1]);
  requireOk(Number.isFinite(mean) && Number.isFinite(peak), 'livelli audio non misurabili');
  const { stderr: silence } = await exec('ffmpeg', ['-hide_banner', '-nostdin', '-i', target,
    '-af', 'silencedetect=noise=-50dB:d=0.7', '-f', 'null', '-'], { maxBuffer: 512000, timeout: 20000 });
  return {
    duration_seconds: Number(duration.toFixed(3)),
    mean_dbfs: mean, peak_dbfs: peak,
    unexpected_silence: silence.includes('silence_start:'),
    attention: mean < -35 || peak >= -0.2 || silence.includes('silence_start:'),
    sha256: hash(await readFile(target)),
  };
}
function page(rows, created) {
  const blocks = rows.map(track => `<section>
<h2>${html(track.title)}</h2>
<p>${html(track.author || 'Autore non indicato')} · Licenza: <strong>${html(track.license_status)}</strong> · Brano: <strong>${html(track.track_status)}</strong></p>
${track.auditions.map(s => `<article>
<div class="head"><strong>${html(s.id)}</strong><span>${(s.start_ms / 1000).toFixed(2)}–${(s.end_ms / 1000).toFixed(2)} s · ${html(s.status)}</span></div>
<audio controls controlsList="nodownload" preload="none" src="${html(s.preview)}" aria-label="Ascolta ${html(track.title)} ${html(s.id)}"></audio>
<p>Volume medio ${html(s.analysis.mean_dbfs)} dBFS · Picco ${html(s.analysis.peak_dbfs)} dBFS${s.analysis.attention ? ' · <strong>Verifica tecnica consigliata</strong>' : ''}</p>
<p class="small">Proposta automatica, non approvata in questa interfaccia. Verificare inizio, finale, frase musicale e abbinamento al tema.</p>
</article>`).join('\n')}
</section>`).join('\n');
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; media-src 'self' file:; img-src 'self'; base-uri 'none'; form-action 'none'">
<title>Video Studio — Ascolto musicale privato</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:980px;margin:auto;padding:24px;background:#f7f7f7;color:#232323}h1{line-height:1.15}section{background:#fff;border:1px solid #ddd;border-radius:8px;margin:24px 0;padding:18px}article{border-top:1px solid #e2e2e2;padding:14px 0}.head{display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px}.head span,.small{color:#565656}audio{width:100%;margin:12px 0}p{margin:6px 0}.intro{background:#eee;padding:12px}</style></head>
<body><h1>OffertaLogica — ascolto segmenti musicali</h1><p class="intro">Solo per revisione privata. Questa pagina <strong>non approva</strong> musica, segmenti o licenze, non pubblica e non è destinata al repository. Data: ${html(created)}. Ogni decisione dovrà essere registrata separatamente nel catalogo.</p>
${blocks}<p>Conservare il pacchetto esclusivamente nello spazio privato di revisione. Non distribuire gli estratti come libreria autonoma.</p></body></html>`;
}

// Generates a private directory containing HTML and 15s audition copies, not source MP3s.
// Never changes catalog statuses; refuses to overwrite a preexisting export.
export async function createAuditionPack({ root, outputDir, trackIds = null } = {}) {
  const base = await realpath(privateRoot(root));
  privateRoot(base); // also check the resolved target if the root is a symlink
  const destination = privateRoot(outputDir);
  requireOk(destination !== base, 'output e archivio devono essere distinti');
  try { await access(destination); requireOk(false, 'destinazione già presente: nessuna sovrascrittura'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  requireOk(trackIds === null || (Array.isArray(trackIds) && trackIds.length && trackIds.every(x => TRACK.test(x)) && new Set(trackIds).size === trackIds.length), 'filtro tracce non valido');
  const catalog = await readCatalog(base);
  const tracks = catalog.tracks.filter(t => !trackIds || trackIds.includes(t.id));
  requireOk(tracks.length > 0 && (!trackIds || tracks.length === trackIds.length), 'tracce assenti dal catalogo');
  const rows = [];
  const created = new Date().toISOString();
  await verifyOutputParent(destination);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await verifyOutputParent(destination); // verify again after creating parent
  const temp = await mkdtemp(join(dirname(destination), '.vs-audition-'));
  try {
    await mkdir(join(temp, 'clips'), { mode: 0o700 });
    for (const track of tracks) {
      requireOk(TRACK.test(track.id) && HASH.test(track.sha256) && typeof track.audio_file === 'string', 'metadati traccia invalidi');
      const file = contained(base, track.audio_file);
      requireOk((await lstat(file)).isFile(), `${track.id}: MP3 deve essere un file normale e non un symlink`);
      const realFile = await realpath(file);
      contained(base, relative(base, realFile));
      requireOk((await stat(file)).isFile() && hash(await readFile(file)) === track.sha256, `${track.id}: origine MP3 alterata`);
      const audition = { id: track.id, title: track.title, author: track.author,
        track_status: track.status, license_status: track.license?.status ?? 'unknown', auditions: [] };
      const segments = track.segments.filter(s => ['pending_review', 'approved', 'rejected'].includes(s.status));
      requireOk(segments.length > 0, `${track.id}: nessun segmento candidato da ascoltare`);
      for (const segment of segments) {
        requireOk(SEG.test(segment.id) && Number.isInteger(segment.start_ms) && Number.isInteger(segment.end_ms) &&
          segment.id === `seg_${segment.start_ms}_${FRAME.durationMs}` && segment.end_ms === segment.start_ms + FRAME.durationMs &&
          segment.start_ms >= 0 && segment.end_ms <= track.duration_ms, `${track.id}: intervallo non valido`);
        const name = `${track.id}_${segment.id}.mp3`;
        const path = join(temp, 'clips', name);
        const analysis = await auditionClip(file, path, segment);
        audition.auditions.push({ id: segment.id, start_ms: segment.start_ms, end_ms: segment.end_ms,
          status: segment.status, preview: `clips/${name}`, analysis });
      }
      rows.push(audition);
    }
    requireOk(rows.some(r => r.auditions.length), 'nessuna anteprima generata');
    const manifest = { schema_version: 1, engine_version: VIDEO_STUDIO_VERSION, created_at: created,
      status: 'review_only', tracks: rows };
    await writeFile(join(temp, 'index.html'), page(rows, created), { flag: 'wx', mode: 0o600 });
    await writeFile(join(temp, 'audition-index.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
    try { await access(destination); requireOk(false, 'destinazione creata durante analisi'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    await rename(temp, destination);
    return { version: VIDEO_STUDIO_VERSION, output: destination, status: 'review_only',
      tracks: rows.length, segments: rows.reduce((n, t) => n + t.auditions.length, 0) };
  } catch (e) { await rm(temp, { recursive: true, force: true }); throw e; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    const args = process.argv.slice(2);
    requireOk(args.length === 4 && args[0] === '--root' && args[2] === '--out',
      'uso: node video-studio/music-review.mjs --root /private/library --out /private/nuova-cartella');
    return createAuditionPack({ root: args[1], outputDir: args[3] });
  })().then(x => console.log(JSON.stringify(x)))
    .catch(e => { console.error(e.stack || e); process.exitCode = 1; });
}
