import { createHash } from 'node:crypto';

// Independent Video Studio release; does not change editorial/application versions.
export const VIDEO_STUDIO_VERSION = '0.1.0';
export const FRAME = Object.freeze({ width: 1080, height: 1920, fps: 30, durationMs: 15000 });
export const OFFICIAL_LOGO_SHA256 = '5e14de4bf43d8d4fc42b0454e5cf94df4edb2c21ff2e1638bc73882a55b05830';
export const LOGO_PANEL = Object.freeze({ x: 274, y: 1188, width: 534, height: 318 });
export const TEXT_SAFE = Object.freeze({ x: 108, y: 190, width: 864, height: 1390 });
const CHANNELS = new Set(['instagram_reel', 'facebook_reel']);

function fail(message) { throw new Error(`VIDEO_STUDIO_VALIDATION: ${message}`); }
function assert(ok, message) { if (!ok) fail(message); }
function string(value, label, max = 5000) {
  assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${label}: stringa obbligatoria`);
  return value;
}
function sha(value) { return createHash('sha256').update(value).digest('hex'); }
export function sha256(bytes) { return sha(bytes); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export function freezeArticle(article) {
  assert(article && typeof article === 'object' && !Array.isArray(article), 'articolo mancante');
  for (const k of ['id', 'version', 'status', 'title', 'url', 'category', 'content']) string(article[k], `article.${k}`, k === 'content' ? 200000 : 600);
  assert(['approved', 'published'].includes(article.status), 'articolo non approvato o pubblicato');
  assert(article.content.trim().length >= 60, 'articolo privo di contenuto sufficiente');
  assert(/^https:\/\//i.test(article.url), 'URL articolo non HTTPS');
  assert(Array.isArray(article.sources) && article.sources.length > 0, 'fonti articolo assenti');
  const sourceIds = new Set();
  for (const source of article.sources) {
    string(source?.id, 'source.id', 100);
    string(source?.url, 'source.url', 1000);
    assert(/^https:\/\//i.test(source.url), 'URL fonte non HTTPS');
    assert(!sourceIds.has(source.id), 'ID fonte duplicato');
    sourceIds.add(source.id);
  }
  const snapshot = structuredClone(article);
  return { snapshot, fingerprint: sha(JSON.stringify(canonical(snapshot))) };
}
function validRect(rect, label) {
  assert(rect && typeof rect === 'object', `${label}: area mancante`);
  for (const k of ['x', 'y', 'width', 'height']) assert(Number.isInteger(rect[k]), `${label}.${k}: intero in pixel obbligatorio`);
  assert(rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0 && rect.x + rect.width <= FRAME.width && rect.y + rect.height <= FRAME.height, `${label}: fuori frame`);
}
export function intersects(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
function within(inner, outer) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}
export function validateJob(job) {
  assert(job && typeof job === 'object', 'job mancante');
  assert(job.schema_version === 1, 'schema_version non supportata');
  assert(CHANNELS.has(job.platform), 'profilo piattaforma non supportato');
  const frozen = freezeArticle(job.article);
  string(job.editorial?.message, 'editorial.message', 320);
  string(job.editorial?.selection_reason, 'editorial.selection_reason', 1200);
  const claims = job.editorial?.claims;
  assert(Array.isArray(claims) && claims.length > 0, 'claims assenti');
  const claimIds = new Set();
  const sourceIds = new Set(frozen.snapshot.sources.map(s => s.id));
  for (const claim of claims) {
    string(claim?.id, 'claim.id', 100);
    string(claim?.source_excerpt, 'claim.source_excerpt', 1000);
    assert(frozen.snapshot.content.includes(claim.source_excerpt), `claim ${claim.id}: estratto non presente nell'articolo`);
    assert(Array.isArray(claim.source_ids) && claim.source_ids.length > 0 && claim.source_ids.every(x => sourceIds.has(x)), `claim ${claim.id}: riferimenti fonti invalidi`);
    assert(!claimIds.has(claim.id), `claim duplicato: ${claim.id}`);
    claimIds.add(claim.id);
  }
  assert(Array.isArray(job.scenes) && job.scenes.length >= 4 && job.scenes.length <= 5, 'servono 4 o 5 scene');
  assert(job.scenes.reduce((s, x) => s + x.duration_ms, 0) === FRAME.durationMs, 'le scene devono sommare 15000 ms');
  const sceneIds = new Set();
  let hasClaimScene = false;
  for (const [index, scene] of job.scenes.entries()) {
    string(scene?.id, `scenes[${index}].id`, 100);
    string(scene?.editorial_goal, `scenes[${index}].editorial_goal`, 400);
    string(scene?.image, `scenes[${index}].image`, 1000);
    assert(!sceneIds.has(scene.id), `scene duplicata: ${scene.id}`);
    sceneIds.add(scene.id);
    assert(Number.isInteger(scene.duration_ms) && scene.duration_ms >= 2000 && scene.duration_ms % 1000 === 0, `scene ${scene.id}: durata non valida (secondi interi, >=2)`);
    assert(scene.image_reviewed_clean === true, `scene ${scene.id}: confermare foto senza testi/documenti fittizi`);
    assert(Array.isArray(scene.text_lines) && scene.text_lines.length >= 1 && scene.text_lines.length <= 3, `scene ${scene.id}: testo da 1 a 3 righe`);
    scene.text_lines.forEach((line, i) => string(line, `scene ${scene.id} text_lines[${i}]`, 100));
    validRect(scene.text_region, `scene ${scene.id} text_region`);
    assert(within(scene.text_region, TEXT_SAFE), `scene ${scene.id}: testo fuori safe area UI`);
    assert(scene.text_region.height >= 90 + 78 * scene.text_lines.length, `scene ${scene.id}: altezza insufficiente per il testo`);
    assert(Array.isArray(scene.protected_regions), `scene ${scene.id}: protected_regions obbligatorio (può essere [])`);
    scene.protected_regions.forEach((box, i) => {
      validRect(box, `scene ${scene.id} protected_regions[${i}]`);
      assert(!intersects(scene.text_region, box), `scene ${scene.id}: testo sovrapposto a soggetto protetto`);
    });
    assert(Array.isArray(scene.claim_ids), `scene ${scene.id}: claim_ids obbligatorio`);
    assert(scene.claim_ids.every(id => claimIds.has(id)), `scene ${scene.id}: claim non presente nell'articolo`);
    if (scene.claim_ids.length) hasClaimScene = true;
    if (index === job.scenes.length - 1) {
      assert(!intersects(scene.text_region, LOGO_PANEL), 'scena finale: testo sovrapposto al logo');
      assert(scene.protected_regions.every(box => !intersects(box, LOGO_PANEL)), 'scena finale: logo sovrapposto al soggetto');
    }
  }
  assert(hasClaimScene, 'nessuna scena richiama un claim verificabile');
  const music = job.music;
  string(music?.file, 'music.file', 1000);
  assert(/^[a-f0-9]{64}$/i.test(music.sha256 || ''), 'music.sha256 mancante o non valido');
  assert(music?.track_status === 'approved' && music?.segment?.status === 'approved', 'traccia e segmento devono essere approvati');
  assert(Number.isInteger(music.segment.start_ms) && music.segment.start_ms >= 0 && music.segment.end_ms === music.segment.start_ms + FRAME.durationMs, 'segmento musicale deve durare esattamente 15 s');
  assert(music?.license?.status === 'approved', 'licenza non approvata');
  string(music.license.source_url, 'license.source_url', 1000);
  string(music.license.license_url, 'license.license_url', 1000);
  string(music.license.reviewed_by, 'license.reviewed_by', 200);
  string(music.license.reviewed_at, 'license.reviewed_at', 100);
  assert(!Number.isNaN(Date.parse(music.license.reviewed_at)), 'data revisione licenza non valida');
  if (music.license.expires_at != null) {
    assert(!Number.isNaN(Date.parse(music.license.expires_at)), 'scadenza licenza non valida');
    assert(Date.parse(music.license.expires_at) > Date.now(), 'licenza scaduta');
  }
  assert(Array.isArray(music.license.allowed_platforms) && music.license.allowed_platforms.includes(job.platform), 'licenza non autorizza la piattaforma scelta');
  assert(/^https:\/\//i.test(music.license.source_url) && /^https:\/\//i.test(music.license.license_url), 'URL licenza non HTTPS');
  return frozen;
}
