#!/usr/bin/env node
// Read-only analysis of a *selected* audio segment. Salient transients are suggestions,
// not automatically approved beats, licences, or musical direction.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const DURATION_MS = 15000;
const SR = 8000, HOP = 80, N = SR * HOP / 1000;
function requireValue(ok, why) { if (!ok) throw new Error(`VIDEO_STUDIO_AUDIO_DIRECTION: ${why}`); }
function round100(ms) { return Math.round(ms / 100) * 100; }
export async function analyzeSegment({ file, startMs, durationMs = DURATION_MS }) {
  requireValue(typeof file === 'string' && file.length > 0 && Number.isInteger(startMs) && startMs >= 0, 'sorgente audio o inizio non validi');
  requireValue(durationMs === DURATION_MS, 'solo segmento autorizzato da 15 s');
  const { stdout } = await exec('ffmpeg', ['-hide_banner','-nostdin','-v','error','-ss',String(startMs/1000),'-t','15','-i',file,'-map','0:a:0','-ac','1','-ar',String(SR),'-f','s16le','-'], { encoding: 'buffer', maxBuffer: 2*1024*1024, timeout: 30000 });
  requireValue(stdout.length >= SR * 14.9 * 2, 'audio decodificato troppo corto');
  const audio = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length/2));
  const energies=[];
  for (let p=0;p+N<=audio.length;p+=N) {
    let squares=0;
    for(let k=p;k<p+N;k++){const v=audio[k]/32768;squares+=v*v;}
    energies.push(Math.sqrt(squares/N));
  }
  const novelty=energies.map((e,i)=> i===0?0: Math.max(0,e-energies[i-1]) + 0.30*Math.max(0,e-(energies[i-2]??e)));
  const top=[];
  for(let i=2;i<novelty.length-2;i++){
    if(novelty[i]<novelty[i-1] || novelty[i]<novelty[i+1])continue;
    top.push({ms:round100(i*HOP),strength:Number(novelty[i].toFixed(5))});
  }
  top.sort((a,b)=>b.strength-a.strength);
  const cues=[];
  for(const item of top){ if(cues.every(c=>Math.abs(c.ms-item.ms)>=480))cues.push(item); if(cues.length>=22)break; }
  cues.sort((a,b)=>a.ms-b.ms);
  const at=(from,to)=>{
    const arr=energies.slice(Math.floor(from/HOP),Math.ceil(to/HOP));
    return arr.length?Math.sqrt(arr.reduce((s,e)=>s+e*e,0)/arr.length):0;
  };
  return {
    method:'rms_novelty_v1',sample_rate:SR,hop_ms:HOP,segment_start_ms:startMs,duration_ms:durationMs,
    candidates:cues, rms:{opening:at(0,2000),middle:at(5000,10000),cta:at(11500,13800),tail:at(13800,15000)},
    limitations:'RMS novelty identifies changes of intensity, not reliable BPM/beat grid or musical phrasing. Listening and approving cues remains mandatory.'
  };
}
export function proposeMusicTimeline(analysis, sceneCount = 4) {
  requireValue(analysis?.method === 'rms_novelty_v1', 'analisi musicale richiesta');
  requireValue(Number.isInteger(sceneCount) && sceneCount>=4 && sceneCount<=5, 'servono quattro o cinque scene');
  // Safe defaults preserve a readable final CTA (>=3 seconds); cue suggestions
  // are not accepted without listening and explicit editorial approval.
  const targets=sceneCount===4?[3000,7000,11000]:[2500,5500,8500,11500];
  let last=0;const cuts=[];
  for(let i=0;i<targets.length;i++){
    const target=targets[i],remaining=targets.length-i;
    const valid=(analysis.candidates||[]).filter(c=>c.ms>=last+2000 && c.ms<=DURATION_MS-(remaining===1?3000:2000*remaining) && Math.abs(c.ms-target)<=900);
    const selected=valid.sort((a,b)=> (Math.abs(a.ms-target)-Math.abs(b.ms-target)) + (b.strength-a.strength)*500)[0];
    const result=selected?round100(selected.ms):target;
    cuts.push(result);last=result;
  }
  const durations=[...cuts,DURATION_MS].map((end,i)=>end-(i?cuts[i-1]:0));
  return {scene_duration_ms:durations,change_cues_ms:cuts, cue_source:'rms_novelty_v1',approved:false,
    note:'Proposta tecnica: controllare che ogni cambio corrisponda a un evento musicale adeguato ascoltando il segmento.'};
}
export function assessCutAlignment(analysis, sceneDurations, { toleranceMs = 220 } = {}) {
  requireValue(analysis?.method === 'rms_novelty_v1' && Array.isArray(analysis.candidates), 'analisi cue mancante');
  requireValue(Array.isArray(sceneDurations) && sceneDurations.every(n=>Number.isInteger(n)&&n>=2000)&&sceneDurations.reduce((a,b)=>a+b,0)===DURATION_MS,'durate scene non valide');
  let at=0;
  const cuts=[];
  for(const d of sceneDurations.slice(0,-1)){
    at+=d;
    const nearest=analysis.candidates.reduce((best,c)=>!best||Math.abs(c.ms-at)<Math.abs(best.ms-at)?c:best,null);
    const deltaMs=nearest?Math.abs(nearest.ms-at):null;
    cuts.push({cut_ms:at,nearest_cue_ms:nearest?.ms??null,delta_ms:deltaMs,close_to_transient:deltaMs!==null&&deltaMs<=toleranceMs});
  }
  return {cuts,aligned_cuts:cuts.filter(c=>c.close_to_transient).length,total_cuts:cuts.length,review_required:true,
    note:'Close to transient is technical proximity, not proof of a musically appropriate transition.'};
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async()=>{
    const a=process.argv.slice(2);
    requireValue([4,6].includes(a.length) && a[0]==='--music' && a[2]==='--start-ms' && (a.length===4 || a[4]==='--scenes'),'uso: node audio-direction.mjs --music file.mp3 --start-ms 12000 [--scenes 4]');
    const n=Number(a[3]); requireValue(Number.isInteger(n),'start-ms non valido');
    const analysis=await analyzeSegment({file:resolve(a[1]),startMs:n});
    console.log(JSON.stringify({analysis,proposal:proposeMusicTimeline(analysis,a.length===6?Number(a[5]):4)},null,2));
  })().catch(e=>{console.error(e.message);process.exitCode=1;});
}
