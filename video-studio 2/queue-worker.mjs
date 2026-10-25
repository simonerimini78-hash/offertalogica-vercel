#!/usr/bin/env node
// Video-only worker. This is NOT an editorial scheduler or a new Vercel /api route.
// Start manually/under dedicated process control; disabled by default.
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createVideoStore} from './supabase-store.mjs';
import {generatePhoto} from './auto-images.mjs';
import {makeProductionDraft,approveRenderInput} from './production-plan.mjs';
import {selectMusic,resolveApprovedSegment,recordUse} from './music-library.mjs';
import {analyzeSegment} from './audio-direction.mjs';
import {freezeArticle,sha256} from './core.mjs';
import {produce} from './render.mjs';
const exec=promisify(execFile);
function check(ok,msg){if(!ok)throw new Error(`VIDEO_STUDIO_WORKER: ${msg}`);}
function assetPath(projectId,kind,index=0){
  return kind==='scene'?`${projectId}/scenes/scene_${index}.png`:
    kind==='audio'?`${projectId}/music/preview.m4a`:
    kind==='video'?`${projectId}/master/reel.mp4`:`${projectId}/master/mobile-review.jpg`;
}
export async function prepareProject(project,{store,musicRoot,generate=generatePhoto}={}) {
  check(process.env.VIDEO_STUDIO_IMAGE_GENERATION_ENABLED==='1','generazione AI non abilitata dall’admin');
  const {snapshot,fingerprint}=freezeArticle(project.snapshot);
  check(fingerprint===project.source_fingerprint,'snapshot alterato');
  // Fail before paid image calls if no licensed/approved music is available.
  const music=await selectMusic(musicRoot,{platform:project.platform,mood:project.mood});
  const analysis=await analyzeSegment({file:music.file,startMs:music.segment.start_ms});
  const draft=makeProductionDraft(snapshot,{platform:project.platform,mood:project.mood,analysis});
  const temp=await mkdtemp(join(tmpdir(),'video-studio-prepare-'));
  try {
    const audioFile=join(temp,'preview.m4a');
    await exec('ffmpeg',['-hide_banner','-nostdin','-v','error','-y','-ss',String(music.segment.start_ms/1000),'-t','15',
      '-i',music.file,'-vn','-c:a','aac','-b:a','160k','-ac','2',audioFile],{timeout:40000});
    await store.upload(assetPath(project.id,'audio'),await readFile(audioFile),'audio/mp4');
    const scenes=[];
    for(let i=0;i<4;i++) {
      const scene=draft.scenes[i];
      const path=assetPath(project.id,'scene',i+1);
      // Interrupted workers may have uploaded earlier scenes. Reuse verified
      // immutable assets rather than charging the AI provider twice.
      let img;
      try {
        const previous=await store.download(path);
        img={bytes:previous,sha256:sha256(previous),provider:'previous_attempt',prompt_fingerprint:null};
      } catch(e) {
        if(!/HTTP 404/.test(String(e)))throw e;
        img=await generate({article:snapshot,scene,index:i});
      }
      check(Buffer.isBuffer(img.bytes)&&img.bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))&&sha256(img.bytes)===img.sha256,'immagine PNG non valida');
      await store.upload(path,img.bytes,'image/png');
      scenes.push({...scene,image_path:path,image_sha256:img.sha256,image_provider:img.provider,
        prompt_fingerprint:img.prompt_fingerprint,reviewed:false});
    }
    return {
      state:'needs_review',storyboard:draft.storyboard,
      assets:{scenes,music_reviewed:false,audition_reviewer:null,claim_reviewed:false,claim_reviewer:null},
      music_plan:{track_id:music.track_id,segment_id:music.segment.id,track_title:music.title,
        licensed_platform:project.platform,preview_path:assetPath(project.id,'audio'),
        selection_reason:music.selection_reason,timeline:draft.music_timeline,analysis_method:analysis.method},
      last_error:null
    };
  } finally{await rm(temp,{recursive:true,force:true});}
}
export function assembleReviewedJob(project,{scenePaths,music}={}) {
  const scenes=approveRenderInput(project);
  check(scenePaths?.length===4&&music,'asset render mancanti');
  const durations=project.music_plan?.timeline?.scene_duration_ms;
  check(Array.isArray(durations)&&durations.length===4&&durations.every(d=>Number.isInteger(d)&&d>=2000)&&durations.reduce((a,b)=>a+b,0)===15000,
    'timeline non valida');
  let at=0;const cuts=[];
  const renderScenes=scenes.map((scene,index)=>{
    const d=durations[index];if(index<3){at+=d;cuts.push(at);}
    return {id:scene.id,editorial_goal:scene.editorial_goal||scene.role,image:scenePaths[index],image_sha256:scene.image_sha256,
      image_reviewed_clean:true,duration_ms:d,
      protected_regions:scene.protected_regions,claim_ids:index===1||index===2?['claim_main']:[],
      presentation:{mode:'editorial_v2',role:scene.role,headline:scene.headline, ...(scene.secondary_text?{secondary_text:scene.secondary_text}:{}),
        subject_regions_reviewed:true,motion:'auto',placement:'auto'}};
  });
  const sources=project.snapshot.sources.map(s=>s.id);
  const direction={hook_cue_ms:0,change_cues_ms:cuts,fade_start_ms:13800,fade_duration_ms:1200,
    opening_fade_ms:250,audition_reviewed:true,audition_reviewer:project.assets.audition_reviewer};
  return {schema_version:1,platform:project.platform,article:project.snapshot,production_mode:'technical_preview',
    editorial:{message:project.storyboard.selected_excerpt.slice(0,320),selection_reason:project.storyboard.selection_reason,
      claims:[{id:'claim_main',source_excerpt:project.storyboard.selected_excerpt,source_ids:sources}],reviewed_by:project.assets.claim_reviewer},
    scenes:renderScenes,music:{...music,direction}};
}
export async function renderProject(project,{store,musicRoot,render=produce}={}) {
  const reviewed=approveRenderInput(project);
  const root=await mkdtemp(join(tmpdir(),'video-studio-render-'));
  try {
    const paths=[];
    for(let i=0;i<reviewed.length;i++) {
      const scene=reviewed[i];
      const bytes=await store.download(scene.image_path);
      check(sha256(bytes)===scene.image_sha256,`foto ${i+1} cambiata dopo approvazione`);
      const path=join(root,`scene_${i+1}.png`);await writeFile(path,bytes,{flag:'wx',mode:0o600});paths.push(path);
    }
    const music=await resolveApprovedSegment(musicRoot,{platform:project.platform,mood:project.mood,
      trackId:project.music_plan.track_id,segmentId:project.music_plan.segment_id});
    const job=assembleReviewedJob(project,{scenePaths:paths,music});
    const jobPath=join(root,'job.json');await writeFile(jobPath,JSON.stringify(job),{flag:'wx',mode:0o600});
    const masterPath=join(root,'reel.mp4');const qa=await render({jobPath,output:masterPath});
    check(qa.technical_status==='passed'&&qa.publication_authorized===false,'QA tecnico non valido');
    await store.upload(assetPath(project.id,'video'),await readFile(masterPath),'video/mp4');
    const previewFile=`${masterPath}.mobile-review.jpg`;
    if(qa.mobile_review)await store.upload(assetPath(project.id,'mobile'),await readFile(previewFile),'image/jpeg');
    // Store the history only AFTER durable DB transition in runOnce. Otherwise
    // a DB failure could leave an irreversible phantom use record.
    return {state:'ready_for_review',qa,render_job:{input_job_sha256:qa.input_job_sha256},
      video_path:assetPath(project.id,'video'),mobile_review_path:qa.mobile_review?assetPath(project.id,'mobile'):null,last_error:null,
      __music_record:{trackId:music.track_id,segmentId:music.segment.id,platform:project.platform,jobId:project.id,outputSha256:qa.output_sha256}};
  } finally{await rm(root,{recursive:true,force:true});}
}
export async function runOnce({store,musicRoot,prepare=prepareProject,render=renderProject}={}) {
  check(store&&typeof musicRoot==='string'&&musicRoot.startsWith('/'),'storage e music root privata necessari');
  if(typeof store.reapStale==='function')await store.reapStale();
  const queued=await store.pending();
  for(const item of queued||[]) {
    const token=randomUUID();const target=item.state==='queued'?'preparing':'rendering';
    const project=await store.claim(item.id,item.state,target,token);
    if(!project)continue;
    // Independent heartbeat prevents a long-but-alive image generation from
    // being mistaken for a crashed worker during another worker's recovery.
    let heartbeatProblem=null;
    const interval=typeof store.heartbeat==='function'?setInterval(()=>{
      store.heartbeat(item.id,token).catch(e=>{heartbeatProblem=e;});
    },60000):null;
    try {
      const result=target==='preparing'?await prepare(project,{store,musicRoot}):await render(project,{store,musicRoot});
      if(heartbeatProblem)throw heartbeatProblem;
      const {__music_record:musicRecord,...next}=result;
      await store.finish(item.id,token,next);
      if(musicRecord) {
        try {await recordUse(musicRoot,musicRecord);}
        catch(e){await store.event(item.id,'music_history_warning',{error:String(e.message).slice(0,300)}).catch(()=>{});}
      }
      await store.event(item.id,'worker_completed',{state:next.state});
      return {id:item.id,status:next.state};
    } catch(e) {
      const message=String(e?.message||e).slice(0,700);
      await store.finish(item.id,token,{state:'failed',last_error:message,attempts:Math.min(5,(project.attempts||0)+1)});
      await store.event(item.id,'worker_failed',{error:message});
      return {id:item.id,status:'failed',error:message};
    } finally {if(interval)clearInterval(interval);}
  }
  return {status:'idle'};
}
if(process.argv[1]&&process.argv[1].endsWith('/queue-worker.mjs')) {
  (async()=>{
    check(process.env.VIDEO_STUDIO_WORKER_ENABLED==='1','worker disabilitato: abilitazione esplicita richiesta');
    const store=createVideoStore({url:process.env.SUPABASE_URL,serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY});
    const musicRoot=process.env.VIDEO_STUDIO_MUSIC_ROOT;
    check(musicRoot?.startsWith('/'),'VIDEO_STUDIO_MUSIC_ROOT non configurata');
    const mode=process.argv[2];check(['once','loop'].includes(mode),'uso: node video-studio/queue-worker.mjs once|loop');
    do {
      const result=await runOnce({store,musicRoot});
      process.stdout.write(`${JSON.stringify({at:new Date().toISOString(),...result})}\n`);
      if(mode==='loop')await new Promise(resolve=>setTimeout(resolve,30000));
    } while(mode==='loop');
  })().catch(e=>{process.stderr.write(`${e.stack||e}\n`);process.exitCode=1;});
}
