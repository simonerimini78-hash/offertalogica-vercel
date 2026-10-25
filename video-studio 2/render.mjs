#!/usr/bin/env node
import { readFile, writeFile, mkdtemp, rename, rm, stat, access, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VIDEO_STUDIO_VERSION, FRAME, OFFICIAL_LOGO_SHA256,
  validateJob, sha256,
} from './core.mjs';

import { composeFrame } from './scene-graphics.mjs';
import { composePremiumFrame } from './premium-layout.mjs';
import { renderCinematicScene } from './cinematic.mjs';
import { createMobileReview } from './master-review.mjs';
import { analyzeSegment, assessCutAlignment } from './audio-direction.mjs';
import { evaluateQualityGates } from './quality-gates.mjs';
const exec = promisify(execFile);
const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOGO = join(PROJECT, 'public/assets/logo-offertalogica-header.png');

function assert(ok, message) { if (!ok) throw new Error(`VIDEO_STUDIO_QA: ${message}`); }
function decodeArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 2) {
    assert(['--job', '--out'].includes(args[i]) && !!args[i + 1], 'uso: node video-studio/render.mjs --job /path/job.json --out /path/reel.mp4');
    assert(!(args[i] in parsed), `opzione duplicata: ${args[i]}`);
    parsed[args[i]] = args[i + 1];
  }
  assert(parsed['--job'] && parsed['--out'] && args.length === 4, 'indicare --job e --out');
  assert(extname(parsed['--out']).toLowerCase() === '.mp4', 'output deve essere MP4');
  return { jobPath: resolve(parsed['--job']), output: resolve(parsed['--out']) };
}
function localPath(base, p) {
  assert(typeof p === 'string' && p && !/^(https?:|file:)/i.test(p), 'solo asset locali, non URL');
  return isAbsolute(p) ? p : resolve(base, p);
}
async function probe(file) {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { maxBuffer: 2 * 1024 * 1024, timeout: 20000 });
  return JSON.parse(stdout);
}
async function prepareScene(scene, isLast, base, temp, index, logoData) {
  const photoFile = localPath(base, scene.image);
  if (scene.image_sha256) assert(sha256(await readFile(photoFile)) === scene.image_sha256.toLowerCase(), `scene ${scene.id}: asset fotografico cambiato dopo approvazione`);
  const path = join(temp, `scene-${String(index).padStart(2, '0')}.png`);
  if (scene.presentation?.mode === 'editorial_v1') {
    return (await composePremiumFrame({ photoFile, scene, logoBytes: logoData, outputFile: path })).outputFile;
  }
  return composeFrame({ photoFile, scene, isLast, logoBytes: logoData, outputFile: path });
}
async function inspectAudio(job, base) {
  const path = localPath(base, job.music.file);
  const contents = await readFile(path);
  assert(sha256(contents).toLowerCase() === job.music.sha256.toLowerCase(), 'hash MP3 diverso dal catalogo approvato');
  const info = await probe(path);
  const audio = info.streams.find(s => s.codec_type === 'audio');
  assert(audio && ['mp3', 'aac', 'flac', 'pcm_s16le', 'pcm_s24le'].includes(audio.codec_name), 'audio con codec non supportato');
  const durationMs = Math.round(Number(info.format.duration) * 1000);
  assert(Number.isFinite(durationMs) && durationMs >= job.music.segment.end_ms + 100, 'segmento oltre la durata del brano');
  return { path, durationMs };
}
async function renderVideo(images, musicFile, startMs, durations, output, direction) {
  const args = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error'];
  images.forEach((file, i) => args.push('-loop', '1', '-framerate', `${FRAME.fps}`, '-t', `${durations[i] / 1000}`, '-i', file));
  args.push('-ss', `${startMs / 1000}`, '-t', '15', '-i', musicFile);
  const parts = images.map((_, i) => `[${i}:v]fps=${FRAME.fps},trim=duration=${durations[i] / 1000},setpts=PTS-STARTPTS,format=yuv420p[v${i}]`);
  parts.push(`${images.map((_, i) => `[v${i}]`).join('')}concat=n=${images.length}:v=1:a=0[outv]`);
  const fadeStart = direction ? direction.fade_start_ms / 1000 : 14.73;
  const fadeLength = direction ? direction.fade_duration_ms / 1000 : 0.27;
  parts.push(`[${images.length}:a]aresample=48000,atrim=duration=15,asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:st=0:d=0.12,afade=t=out:st=${fadeStart}:d=${fadeLength},apad,atrim=duration=15[outa]`);
  args.push('-filter_complex', parts.join(';'), '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '30', '-frames:v', '450', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', '-f', 'mp4', output);
  await exec('ffmpeg', args, { maxBuffer: 8 * 1024 * 1024, timeout: 240000 });
}

async function renderCinematicVideo(clips, musicFile, startMs, output, direction, temp) {
  const listing = join(temp, 'clips.txt');
  // All clip paths are under our mkdtemp workspace, never external user data.
  await writeFile(listing, clips.map(c=>`file '${c.outputFile.replaceAll("'", "'\\''")}'`).join('\n')+'\n');
  const fadeStart=direction.fade_start_ms/1000, fadeLength=direction.fade_duration_ms/1000;
  const fadeIn=(direction.opening_fade_ms ?? 120)/1000;
  const filter=`[1:a]aresample=48000,atrim=duration=15,asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${fadeStart}:d=${fadeLength},apad,atrim=duration=15[outa]`;
  await exec('ffmpeg',['-hide_banner','-nostdin','-y','-loglevel','error','-f','concat','-safe','0','-i',listing,
    '-ss',String(startMs/1000),'-t','15','-i',musicFile,'-filter_complex',filter,'-map','0:v:0','-map','[outa]',
    '-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-t','15','-movflags','+faststart',output],
    {maxBuffer:8*1024*1024,timeout:180000});
}
async function inspectOutput(output) {
  const info = await probe(output);
  const video = info.streams.find(s => s.codec_type === 'video');
  const audio = info.streams.find(s => s.codec_type === 'audio');
  assert(video && video.codec_name === 'h264' && video.width === FRAME.width && video.height === FRAME.height, 'video non H.264 1080x1920');
  assert(video.pix_fmt === 'yuv420p' && Number(video.nb_frames) === 450, 'pixel format o numero frame non valido');
  assert(audio && audio.codec_name === 'aac' && audio.channels === 2, 'audio non AAC stereo');
  const duration = Number(info.format.duration);
  assert(duration >= 14.99 && duration <= 15.0, `durata MP4 fuori limite: ${duration}`);
  const { stderr: decodeErrors } = await exec('ffmpeg', ['-nostdin', '-xerror', '-v', 'error', '-i', output, '-f', 'null', '-'], { maxBuffer: 512000, timeout: 180000 });
  assert(!decodeErrors.trim(), `decodifica MP4: ${decodeErrors.slice(0, 300)}`);
  const { stderr: audioLevels } = await exec('ffmpeg', ['-hide_banner', '-nostdin', '-i', output, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { maxBuffer: 512000, timeout: 180000 });
  const meanDb = Number(audioLevels.match(/mean_volume: ([-0-9.]+) dB/)?.[1]);
  const peakDb = Number(audioLevels.match(/max_volume: ([-0-9.]+) dB/)?.[1]);
  assert(Number.isFinite(meanDb) && meanDb > -48, 'audio assente o troppo debole');
  assert(Number.isFinite(peakDb) && peakDb <= -0.2, 'picco audio prossimo al clipping');
  const { stderr: silenceReport } = await exec('ffmpeg', ['-hide_banner', '-nostdin', '-i', output, '-vn', '-af', 'silencedetect=noise=-50dB:d=0.7', '-f', 'null', '-'], { maxBuffer: 512000, timeout: 180000 });
  assert(!silenceReport.includes('silence_start:'), 'silenzio imprevisto di almeno 0.7s');
  const { stderr: blackReport } = await exec('ffmpeg', ['-hide_banner', '-nostdin', '-i', output, '-an', '-vf', 'blackdetect=d=0.15:pix_th=0.10:pic_th=0.98', '-f', 'null', '-'], { maxBuffer: 512000, timeout: 180000 });
  assert(!blackReport.includes('black_start:'), 'fotogrammi neri di almeno 0.15s');
  return {
    duration_seconds: duration, size_bytes: (await stat(output)).size,
    video_codec: video.codec_name, audio_codec: audio.codec_name,
    frames: Number(video.nb_frames), width: video.width, height: video.height,
    audio_channels: audio.channels, audio_mean_dbfs: meanDb, audio_sample_peak_dbfs: peakDb,
    unexpected_silence: false, detected_black_frames: false,
  };
}
export async function produce({ jobPath, output }) {
  assert(output !== jobPath, 'output coincide con input');
  for (const file of [output, `${output}.qa.json`, `${output}.snapshot.json`, `${output}.mobile-review.jpg`]) {
    try { await access(file); throw new Error(`VIDEO_STUDIO_QA: esiste già ${file}; non sovrascrivo lavori precedenti`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const job = JSON.parse(await readFile(jobPath, 'utf8'));
  const { snapshot, fingerprint } = validateJob(job);
  const cinematic = job.scenes[0]?.presentation?.mode === 'editorial_v2';
  if(cinematic) {
    const outputParent=await realpath(dirname(output));
    const project=await realpath(PROJECT);
    const rel=relative(project,outputParent);
    assert(rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel),'output v2 deve restare fuori dal repository');
  }
  let gates = cinematic ? evaluateQualityGates(job) : null;
  const logoData = await readFile(LOGO);
  assert(sha256(logoData) === OFFICIAL_LOGO_SHA256, 'logo ufficiale modificato o non verificato');
  const audio = await inspectAudio(job, dirname(jobPath));
  const temp = await mkdtemp(join(tmpdir(), 'offertalogica-video-studio-'));
  const outputTemp = join(temp, 'render.mp4');
  try {
    let composition = null, musicalAlignment = null, review = null;
    if (cinematic) {
      const clips=[];
      for (const [i,scene] of job.scenes.entries()) {
        const photoFile=localPath(dirname(jobPath),scene.image);
        if(scene.image_sha256)assert(sha256(await readFile(photoFile))===scene.image_sha256.toLowerCase(),`scene ${scene.id}: immagine modificata`);
        clips.push(await renderCinematicScene({scene,photoFile,logoBytes:logoData,outputPrefix:join(temp,`cinematic-${i}`)}));
      }
      composition=clips.map((clip,i)=>({scene_id:job.scenes[i].id,layout:clip.layout,movement:clip.movement,animation:clip.animation}));
      // Geometry and font sizes are copied from the *actual* compositor plan, not
      // invented attestations. Human-review booleans remain false until reviewed.
      const gateInput=structuredClone(job);
      for(const [i,scene] of gateInput.scenes.entries()) {
        const l=clips[i].layout, prior=scene.quality||{};
        scene.quality={...prior,role:scene.presentation.role,headline:scene.presentation.headline,
          secondary_text:scene.presentation.secondary_text||undefined,headline_font_px:l.titlePx,
          secondary_font_px:l.secondPx,headline_region:l.titleRect,secondary_region:l.subRect,
          protected_regions:scene.protected_regions,logo_sha256:OFFICIAL_LOGO_SHA256,logo_region:l.logoRect,
          negative_space_reviewed:prior.negative_space_reviewed===true,
          mobile_preview_reviewed:prior.mobile_preview_reviewed===true,
          contrast_reviewed:prior.contrast_reviewed===true,
          logo_visibility_reviewed:prior.logo_visibility_reviewed===true};
      }
      gates=evaluateQualityGates(gateInput);
      if(job.production_mode==='master_review') assert(gates.quality_status!=='blocked',`gate di qualità: ${gates.issues.map(x=>x.code).slice(0,8).join(', ')}`);
      await renderCinematicVideo(clips,audio.path,job.music.segment.start_ms,outputTemp,job.music.direction,temp);
      musicalAlignment=assessCutAlignment(await analyzeSegment({file:audio.path,startMs:job.music.segment.start_ms}),job.scenes.map(s=>s.duration_ms));
    } else {
      const images=[];
      for (let i=0;i<job.scenes.length;i++)images.push(await prepareScene(job.scenes[i],i===job.scenes.length-1,dirname(jobPath),temp,i,logoData));
      await renderVideo(images,audio.path,job.music.segment.start_ms,job.scenes.map(s=>s.duration_ms),outputTemp,job.scenes[0]?.presentation?.mode==='editorial_v1'?job.music.direction:null);
    }
    const format = await inspectOutput(outputTemp);
    if(cinematic)review=await createMobileReview(outputTemp,job.scenes,temp);
    const videoSha256 = sha256(await readFile(outputTemp));
    const jobSha256 = sha256(await readFile(jobPath));
    const sceneSources = [];
    for (const scene of job.scenes) {
      const sourceFile = localPath(dirname(jobPath), scene.image);
      sceneSources.push({
        id: scene.id, source_sha256: sha256(await readFile(sourceFile)),
        duration_ms: scene.duration_ms, text_lines: scene.text_lines,
        text_region: scene.text_region || null, presentation: scene.presentation || null, protected_regions: scene.protected_regions,
        claim_ids: scene.claim_ids,
      });
    }
    const qa = {
      engine_version: VIDEO_STUDIO_VERSION, schema_version: 1, source_fingerprint: fingerprint,
      output_sha256: videoSha256, input_job_sha256: jobSha256,
      format, logo_sha256: OFFICIAL_LOGO_SHA256, scenes: sceneSources,
      music_sha256: job.music.sha256, music_segment: structuredClone(job.music.segment),
      music_license_assertion: structuredClone(job.music.license),
      music_direction: job.music.direction ? structuredClone(job.music.direction) : null,
      platform: job.platform, technical_status: 'passed', editorial_status: 'needs_human_review',
      publication_authorized: false, pre_render_quality_gates: gates, composition, musical_alignment: musicalAlignment,
      mobile_review: review ? {file: `${output}.mobile-review.jpg`, frames: review.frames, ui_overlay: review.ui_overlay, reviewed_by_human: false} : null,
      review_requirements: [
        'verificare correttezza semantica di ogni testo rispetto all’articolo',
        'verificare zone protette dichiarate e inquadratura effettiva',
        'verificare qualità fotografica, ritmo e ascolto del segmento musicale',
        'confermare licenza, diritti e destinazione social con evidenze esterne',
      ],
    };
    await rename(outputTemp, output);
    if(review)await rename(review.file, `${output}.mobile-review.jpg`);
    await writeFile(`${output}.snapshot.json`, JSON.stringify({ fingerprint, article: snapshot }, null, 2), { flag: 'wx', mode: 0o600 });
    await writeFile(`${output}.qa.json`, JSON.stringify(qa, null, 2), { flag: 'wx', mode: 0o600 });
    return qa;
  } finally { await rm(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  produce(decodeArgs(process.argv.slice(2)))
    .then(qa => process.stdout.write(JSON.stringify({ output: 'MP4', version: qa.engine_version, technical_status: qa.technical_status, editorial_status: qa.editorial_status, sha256: qa.output_sha256 }) + '\n'))
    .catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
}
