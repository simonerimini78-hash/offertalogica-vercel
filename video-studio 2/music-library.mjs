import { createHash } from 'node:crypto';
import { copyFile, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRAME, VIDEO_STUDIO_VERSION } from './core.mjs';

const exec = promisify(execFile);
const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLATFORMS = new Set(['instagram_reel', 'facebook_reel']);
const MOODS = new Set(['informativo', 'rassicurante', 'positivo', 'allerta', 'spiegazione_pratica']);
const HASH = /^[a-f0-9]{64}$/;
const CATALOG_FILE = 'catalog.json';
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const WINDOW_MS = FRAME.durationMs;

function demand(test, why) { if (!test) throw new Error(`VIDEO_STUDIO_MUSIC: ${why}`); }
function txt(v, what, max = 500) { demand(typeof v === 'string' && v.trim() && v.length <= max, `${what} non valido`); return v.trim(); }
function pathRoot(root) {
  demand(isAbsolute(root || ''), 'la directory privata deve essere assoluta');
  const normalized = resolve(root);
  const sub = relative(PROJECT, normalized);
  demand(sub === '..' || sub.startsWith(`..${sep}`), 'archivio musicale vietato all’interno del repository');
  demand(normalized !== '/', 'non usare la root di sistema');
  return normalized;
}
function fresh() { return { schema_version: 1, library_version: VIDEO_STUDIO_VERSION, tracks: [], history: [] }; }
function validDate(v) { return typeof v === 'string' && !Number.isNaN(Date.parse(v)); }
function sha(data) { return createHash('sha256').update(data).digest('hex'); }
async function probe(file) {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { timeout: 20000, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout);
}
function requireCatalog(data) {
  demand(data?.schema_version === 1 && Array.isArray(data.tracks) && Array.isArray(data.history), 'catalogo corrotto o incompatibile');
  return data;
}
export async function readCatalog(root) {
  const base = pathRoot(root);
  try { return requireCatalog(JSON.parse(await readFile(join(base, CATALOG_FILE), 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return fresh(); throw error; }
}
async function mutate(root, callback) {
  const base = pathRoot(root);
  await mkdir(base, { recursive: true, mode: 0o700 });
  await mkdir(join(base, 'audio'), { recursive: true, mode: 0o700 });
  let lock;
  try { lock = await open(join(base, '.write.lock'), 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('VIDEO_STUDIO_MUSIC: catalogo occupato, riprovare senza eliminare il lock manualmente'); throw error; }
  let temp;
  try {
    const catalog = await readCatalog(base);
    const result = await callback(catalog, base);
    catalog.library_version = VIDEO_STUDIO_VERSION;
    temp = join(base, `catalog.${process.pid}.${createHash('sha256').update(`${Date.now()}:${Math.random()}`).digest('hex').slice(0, 12)}.tmp`);
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(catalog, null, 2)); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temp, join(base, CATALOG_FILE));
    return result;
  } finally {
    if (temp) await rm(temp, { force: true }).catch(() => {});
    await lock.close();
    await rm(join(base, '.write.lock'), { force: true });
  }
}

export async function importTrack(root, { file, title, author = null, originUrl = null, moodSuggestions = [] }) {
  demand(isAbsolute(file || ''), 'per importare serve il percorso assoluto del file MP3');
  title = txt(title, 'titolo', 200);
  if (author != null) author = txt(author, 'autore', 200);
  if (originUrl != null) demand(/^https:\/\//.test(originUrl), 'origine deve essere HTTPS');
  demand(Array.isArray(moodSuggestions) && moodSuggestions.every(v => MOODS.has(v)), 'mood non supportati');
  const fileStat = await stat(file);
  demand(fileStat.isFile() && fileStat.size >= 2048 && fileStat.size <= MAX_FILE_BYTES, 'MP3 non valido o troppo grande');
  const info = await probe(file);
  const streams = info.streams.filter(s => s.codec_type === 'audio');
  demand(streams.length === 1 && streams[0].codec_name === 'mp3', 'è richiesto un MP3 con un unico stream audio');
  const durationMs = Math.round(Number(info.format.duration) * 1000);
  demand(Number.isInteger(durationMs) && durationMs >= WINDOW_MS + 500 && durationMs <= 30 * 60 * 1000, 'durata brano non ammessa');
  const raw = await readFile(file);
  const checksum = sha(raw);
  const id = `track_${checksum.slice(0, 20)}`;
  return mutate(root, async (catalog, base) => {
    const previous = catalog.tracks.find(t => t.sha256 === checksum);
    if (previous) return { duplicate: true, track: structuredClone(previous) };
    const dest = `audio/${checksum}.mp3`;
    const target = join(base, dest);
    await copyFile(file, target, fsConstants.COPYFILE_EXCL);
    await (await open(target, 'r')).close();
    const track = {
      id, title, author, origin_url: originUrl, acquired_at: new Date().toISOString(),
      original_filename: basename(file), audio_file: dest, sha256: checksum,
      duration_ms: durationMs, codec: 'mp3', channels: Number(streams[0].channels),
      sample_rate_hz: Number(streams[0].sample_rate), size_bytes: fileStat.size,
      status: 'pending_license', mood_suggestions: [...new Set(moodSuggestions)], approved_moods: [],
      license: { status: 'pending_license', source_url: originUrl, license_url: null,
        reviewed_by: null, reviewed_at: null, allowed_platforms: [], expires_at: null, evidence: null },
      segments: [], events: [{ action: 'import', at: new Date().toISOString(), sha256: checksum }],
    };
    catalog.tracks.push(track);
    return { duplicate: false, track: structuredClone(track) };
  });
}

// Finds diverse candidate windows using measured energy and transition boundaries.
// This is a heuristic, NOT a musical quality approval, BPM estimator or a beat-grid certification.
export async function proposeSegments(root, trackId, count = 3) {
  demand(Number.isInteger(count) && count >= 1 && count <= 4, '1–4 proposte per brano');
  const catalog = await readCatalog(root);
  const track = catalog.tracks.find(t => t.id === trackId);
  demand(track && track.status !== 'disabled', 'brano non trovato o disabilitato');
  const existingPending = track.segments.filter(s => s.status === 'pending_review');
  if (existingPending.length) return structuredClone(existingPending.slice(0, count));
  const absolute = join(pathRoot(root), track.audio_file);
  demand(sha(await readFile(absolute)) === track.sha256, 'hash audio diverso dal catalogo');
  const { stdout } = await exec('ffmpeg', ['-v', 'error', '-nostdin', '-i', absolute, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], {
    encoding: 'buffer', maxBuffer: 35 * 1024 * 1024, timeout: 90000,
  });
  const audio = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  const blockSize = 2000; // 250ms @ 8kHz, 16bit mono
  const rms = [];
  for (let p = 0; p + blockSize * 2 <= audio.length; p += blockSize * 2) {
    let sum = 0;
    for (let i = p; i < p + blockSize * 2; i += 2) {
      const n = audio.readInt16LE(i) / 32768;
      sum += n * n;
    }
    rms.push(Math.sqrt(sum / blockSize));
  }
  const blocks = Math.round(WINDOW_MS / 250);
  const maxStart = Math.min(rms.length - blocks - 2, Math.floor((track.duration_ms - WINDOW_MS - 300) / 250));
  demand(maxStart >= 0, 'audio non abbastanza lungo per un segmento');
  const all = [];
  for (let start = 0; start <= maxStart; start++) {
    let avg = 0;
    for (let i = start; i < start + blocks; i++) avg += rms[i];
    avg /= blocks;
    if (avg < 0.007) continue; // avoid near-silent windows
    const edgeA = (rms[start] + (rms[start + 1] || 0)) / 2;
    const edgeB = (rms[start + blocks - 2] + rms[start + blocks - 1]) / 2;
    const prev = rms[Math.max(0, start - 2)];
    const transition = Math.abs(edgeA - prev) / (avg + 0.01);
    const loudEdges = (edgeA + edgeB) / (2 * avg + 0.01);
    const score = Math.max(-3, 1.8 - loudEdges) + Math.min(transition, 1.4) * 0.25 + Math.min(avg * 2, 0.25);
    all.push({ start, score, relative_start_energy: Number((edgeA / avg).toFixed(3)), relative_end_energy: Number((edgeB / avg).toFixed(3)) });
  }
  all.sort((a, b) => b.score - a.score || a.start - b.start);
  const proposals = [];
  for (const c of all) {
    const startMs = c.start * 250;
    if (track.segments.some(s => s.id === `seg_${startMs}_${WINDOW_MS}`)) continue;
    if (proposals.some(p => Math.abs(p.start_ms - startMs) < 12000)) continue;
    proposals.push({ id: `seg_${startMs}_${WINDOW_MS}`, start_ms: startMs, end_ms: startMs + WINDOW_MS,
      status: 'pending_review', quality_notes: '', reviewed_by: null, reviewed_at: null,
      analysis: { method: 'rms_boundary_v1', score: Number(c.score.toFixed(3)),
        relative_start_energy: c.relative_start_energy, relative_end_energy: c.relative_end_energy } });
    if (proposals.length >= count) break;
  }
  demand(proposals.length > 0, 'nessuna finestra musicalmente utilizzabile candidata');
  return mutate(root, async (current) => {
    const entry = current.tracks.find(t => t.id === trackId);
    demand(entry && entry.sha256 === track.sha256, 'brano modificato durante l’analisi');
    for (const p of proposals) {
      if (!entry.segments.some(s => s.id === p.id)) entry.segments.push(p);
    }
    entry.events.push({ action: 'propose_segments', count: proposals.length, at: new Date().toISOString() });
    return structuredClone(proposals);
  });
}

export async function reviewLicense(root, trackId, { status, sourceUrl, licenseUrl, reviewer, evidence, allowedPlatforms = [], expiresAt = null }) {
  demand(['approved', 'pending_license', 'rejected'].includes(status), 'stato licenza non supportato');
  reviewer = txt(reviewer, 'revisore', 150);
  if (status === 'approved') {
    demand(/^https:\/\//.test(sourceUrl || '') && /^https:\/\//.test(licenseUrl || ''), 'origine e licenza HTTPS obbligatorie');
    txt(evidence, 'prova documentale licenza', 1500);
    demand(Array.isArray(allowedPlatforms) && allowedPlatforms.length && allowedPlatforms.every(p => PLATFORMS.has(p)), 'piattaforme non autorizzate');
  }
  if (expiresAt != null) demand(validDate(expiresAt) && Date.parse(expiresAt) > Date.now(), 'scadenza licenza non valida');
  return mutate(root, async (catalog) => {
    const t = catalog.tracks.find(t => t.id === trackId);
    demand(t, 'brano sconosciuto');
    const at = new Date().toISOString();
    t.license = { status, source_url: sourceUrl || t.origin_url, license_url: licenseUrl || null,
      reviewed_by: reviewer, reviewed_at: at, allowed_platforms: [...new Set(allowedPlatforms)],
      expires_at: expiresAt, evidence: evidence || null };
    if (t.status === 'approved' && status !== 'approved') t.status = 'pending_license';
    else if (status === 'approved' && t.status === 'pending_license') t.status = 'pending_review';
    t.events.push({ action: 'review_license', decision: status, reviewer, at });
    return structuredClone(t);
  });
}
export async function reviewSegment(root, trackId, segmentId, { status, reviewer, notes }) {
  demand(['approved', 'rejected'].includes(status), 'decisione segmento non valida');
  reviewer = txt(reviewer, 'revisore', 150);
  notes = txt(notes, 'motivazione ascolto', 1000);
  return mutate(root, async catalog => {
    const track = catalog.tracks.find(t => t.id === trackId);
    demand(track && track.status !== 'disabled', 'brano assente o disabilitato');
    const segment = track.segments.find(s => s.id === segmentId);
    demand(segment, 'segmento assente');
    Object.assign(segment, { status, reviewed_by: reviewer, reviewed_at: new Date().toISOString(), quality_notes: notes });
    track.events.push({ action: 'review_segment', segment_id: segmentId, decision: status, reviewer, at: segment.reviewed_at });
    if (track.status === 'approved' && !track.segments.some(s => s.status === 'approved')) track.status = 'pending_review';
    return structuredClone(segment);
  });
}
export async function reviewTrack(root, trackId, { status, reviewer, approvedMoods = [], notes }) {
  demand(['approved', 'disabled', 'pending_review'].includes(status), 'stato traccia non valido');
  reviewer = txt(reviewer, 'revisore', 150);
  notes = txt(notes, 'motivazione', 1000);
  demand(Array.isArray(approvedMoods) && approvedMoods.every(m => MOODS.has(m)), 'mood non valido');
  return mutate(root, async catalog => {
    const track = catalog.tracks.find(t => t.id === trackId);
    demand(track, 'brano non trovato');
    if (status === 'approved') {
      demand(track.license.status === 'approved', 'licenza non approvata');
      demand(track.segments.some(s => s.status === 'approved'), 'nessun segmento approvato');
      demand(approvedMoods.length > 0, 'approvare almeno un mood');
    }
    track.status = status;
    track.approved_moods = [...new Set(approvedMoods)];
    track.events.push({ action: 'review_track', decision: status, reviewer, notes, at: new Date().toISOString() });
    return structuredClone(track);
  });
}
function isLicensed(track, platform) {
  const license = track.license;
  return track.status === 'approved' && license?.status === 'approved' &&
    license.allowed_platforms?.includes(platform) && validDate(license.reviewed_at) &&
    (!license.expires_at || (validDate(license.expires_at) && Date.parse(license.expires_at) > Date.now()));
}
export async function selectMusic(root, { platform, mood, excludeTrackIds = [] }) {
  demand(PLATFORMS.has(platform) && MOODS.has(mood), 'piattaforma o mood non supportati');
  demand(Array.isArray(excludeTrackIds), 'excludeTrackIds deve essere una lista');
  const catalog = await readCatalog(root);
  const options = [];
  for (const t of catalog.tracks) {
    if (!isLicensed(t, platform) || excludeTrackIds.includes(t.id)) continue;
    if (!t.approved_moods.includes(mood)) continue;
    const use = catalog.history.slice(-30).filter(h => h.track_id === t.id && h.platform === platform);
    for (const s of t.segments.filter(s => s.status === 'approved' && s.end_ms - s.start_ms === WINDOW_MS)) {
      const segmentUse = use.filter(h => h.segment_id === s.id);
      const score = -(use.length * 2 + segmentUse.length * 3);
      options.push({ t, s, score, totalUses: use.length, segmentUses: segmentUse.length });
    }
  }
  options.sort((a, b) => b.score - a.score || a.t.id.localeCompare(b.t.id) || a.s.start_ms - b.s.start_ms);
  demand(options.length, 'nessun brano/segmento approvato e autorizzato compatibile; produzione bloccata');
  const { t, s, totalUses, segmentUses } = options[0];
  const audioPath = join(pathRoot(root), t.audio_file);
  demand(sha(await readFile(audioPath)) === t.sha256, 'asset audio alterato');
  return {
    track_id: t.id, title: t.title, file: audioPath, sha256: t.sha256,
    track_status: 'approved', segment: { ...structuredClone(s), status: 'approved' },
    license: { ...structuredClone(t.license) },
    selection_reason: `mood ${mood}; piattaforma ${platform}; utilizzi ultimi 30 lavori: traccia ${totalUses}, segmento ${segmentUses}; licenza approvata`,
  };
}
export async function recordUse(root, { trackId, segmentId, platform, jobId, outputSha256 }) {
  demand(PLATFORMS.has(platform), 'piattaforma non valida');
  txt(jobId, 'jobId', 200);
  demand(HASH.test(outputSha256 || ''), 'hash MP4 non valido');
  return mutate(root, async catalog => {
    const track = catalog.tracks.find(t => t.id === trackId);
    demand(track && isLicensed(track, platform) && track.segments.some(s => s.id === segmentId && s.status === 'approved'), 'musica non più autorizzata');
    const existing = catalog.history.find(h => h.job_id === jobId && h.platform === platform);
    if (existing) {
      demand(existing.track_id === trackId && existing.segment_id === segmentId && existing.output_sha256 === outputSha256, 'conflitto di idempotenza');
      return structuredClone(existing);
    }
    const record = { job_id: jobId, track_id: trackId, segment_id: segmentId, platform,
      output_sha256: outputSha256, at: new Date().toISOString() };
    catalog.history.push(record);
    return structuredClone(record);
  });
}

// Local administrative entrypoint; intentionally no commands that approve licenses or publish.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    const [action, ...argv] = process.argv.slice(2);
    demand(['import', 'propose', 'list'].includes(action), 'uso: music-library.mjs import|propose|list --root /absolute/private/path');
    demand(argv.length % 2 === 0, 'le opzioni richiedono un valore');
    const options = {};
    for (let i = 0; i < argv.length; i += 2) {
      demand(/^--[a-z-]+$/.test(argv[i]) && !Object.hasOwn(options, argv[i]), 'opzione non valida o ripetuta');
      options[argv[i]] = argv[i + 1];
    }
    const root = txt(options['--root'], 'root');
    const allowed = action === 'import' ? ['--root', '--file', '--title', '--author', '--origin-url'] :
      action === 'propose' ? ['--root', '--track', '--count'] : ['--root'];
    demand(Object.keys(options).every(k => allowed.includes(k)), 'opzione sconosciuta');
    if (action === 'import') return importTrack(root, { file: options['--file'], title: options['--title'],
      author: options['--author'], originUrl: options['--origin-url'] });
    if (action === 'propose') return proposeSegments(root, txt(options['--track'], 'track'), options['--count'] ? Number(options['--count']) : 3);
    return readCatalog(root).then(c => ({ library_version: c.library_version, tracks: c.tracks.map(t => ({
      id: t.id, title: t.title, status: t.status, license_status: t.license.status,
      duration_ms: t.duration_ms, segments_pending: t.segments.filter(s => s.status === 'pending_review').length,
      segments_approved: t.segments.filter(s => s.status === 'approved').length,
    })) }));
  })().then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
