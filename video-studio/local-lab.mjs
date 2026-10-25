#!/usr/bin/env node
// Private loopback lab. Never mutates Supabase, Editoriale, or publishing flows.
// Creating an MP4 remains a separate explicitly human-reviewed step.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {resolve,join,relative,isAbsolute,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeInput,generateCreativePlan,candidateArticles} from './creative-director.mjs';
import {generatePhoto,photoPrompt} from './auto-images.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=v=>createHash('sha256').update(v).digest('hex');
function check(ok,msg){if(!ok)throw new Error(`VIDEO_STUDIO_LAB: ${msg}`);}
function escape(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function ensurePrivate(path){
  check(typeof path==='string'&&isAbsolute(path),'directory output assoluta richiesta');
  const p=resolve(path),r=relative(ROOT,p);
  check(p!=='/'&&(r==='..'||r.startsWith(`..${sep}`)||isAbsolute(r)),'non scrivere dentro il repository');
  return p;
}
export function reviewDocument(input,plan,images=[]) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Video Studio · proposta creativa</title><style>
  body{font:16px/1.5 system-ui,sans-serif;max-width:900px;margin:30px auto;padding:0 16px;color:#153245;background:#f5f6f8}
  article{background:#fff;padding:20px;border:1px solid #ddd;border-radius:12px;margin:16px 0}img{display:block;width:220px;max-width:100%;margin-top:12px}small{color:#576b76}b{color:#194960}</style></head><body><h1>Video Studio · Proposta non approvata</h1>
  <p><b>Origine:</b> ${escape(input.input_type)} · <b>Tema:</b> ${escape(input.topic)}</p>
  <p><b>Concept:</b> ${escape(plan.concept)}</p><p><b>Note:</b> ${escape(input.suggestions||'nessuna')}</p>
  <p><b>Controllo editoriale:</b> ${escape(plan.editorial_caution)}</p>
  ${plan.scenes.map((s,i)=>`<article><h2>${i+1}. ${escape(s.headline)}</h2><p>${escape(s.secondary_text)}</p><p><b>Obiettivo:</b> ${escape(s.editorial_goal)}</p><p><b>Scena:</b> ${escape(s.visual_brief)}</p><p><b>Emozione:</b> ${escape(s.emotion)}</p><p><b>Soggetto:</b> ${escape(s.subject_description)}</p><p><b>Zona soggetto:</b> ${escape(s.subject_side)}</p>${images[i]?`<img alt="Scena ${i+1}, da revisionare" src="photos/scene_${i+1}.png">`:''}</article>`).join('')}
  <p><small>Prompt completi in prompts.json. Foto non approvate: le aree dei volti, il contrasto, le fonti e le licenze richiedono revisione. Nessun MP4 o pubblicazione generati automaticamente.</small></p></body></html>`;
}
export async function runLocalLab({input,outputDir,images=false,creativeGenerate=generateCreativePlan,imageGenerate=generatePhoto}){
  const out=ensurePrivate(outputDir);
  try{await stat(out);throw new Error('VIDEO_STUDIO_LAB: la cartella esiste già; non sovrascrivo');}catch(e){if(e.code!=='ENOENT')throw e;}
  await mkdir(out,{recursive:true,mode:0o700});
  const trace={schema_version:1,mode:input.input_type,project_status:'started',actions:[],source_fingerprint:input.source_fingerprint,
    publication_authorized:false,used_manual_assets:false};
  const save=async(file,data)=>writeFile(join(out,file),typeof data==='string'?data:JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
  await save('input.json',input);
  try {
    const plan=await creativeGenerate(input);
    check(plan?.status==='needs_human_review'&&plan.scenes?.length===4,'storyboard non valido');
    trace.actions.push({stage:'creative_director',result:'generated_by_provider',scene_count:4});
    await save('storyboard.json',plan);
    const article={title:input.topic};
    const prompts=plan.scenes.map((scene,index)=>({scene_id:scene.id,sha256:sha(photoPrompt({article,scene,index})),prompt:photoPrompt({article,scene,index})}));
    await save('prompts.json',{prompts,approved:false});
    const photos=[];
    if(images){
      check(process.env.VIDEO_STUDIO_IMAGE_GENERATION_ENABLED==='1','generazione fotografica non abilitata esplicitamente; nessun costo sostenuto');
      await mkdir(join(out,'photos'),{mode:0o700});
      const hashes=new Set();
      for(let i=0;i<plan.scenes.length;i++){
        const image=await imageGenerate({article,scene:plan.scenes[i],index:i});
        check(Buffer.isBuffer(image?.bytes)&&image.bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')),'risposta immagine non PNG');
        const actual=sha(image.bytes);check(actual===image.sha256&&!hashes.has(actual),'asset fotografico errato o duplicato');
        hashes.add(actual);await writeFile(join(out,'photos',`scene_${i+1}.png`),image.bytes,{flag:'wx',mode:0o600});
        photos.push({scene:plan.scenes[i].id,sha256:actual,provider:image.provider,needs_human_review:true});
      }
      trace.actions.push({stage:'image_provider',result:'generated_new_assets',count:photos.length});
    }else trace.actions.push({stage:'image_provider',result:'not_requested',count:0});
    await save('review.html',reviewDocument(input,plan,photos));
    await save('image-status.json',{images:photos,approval:false});
    trace.project_status='needs_human_review';
    trace.actions.push({stage:'renderer',result:'not_started_requires_reviewed_assets_music_and_sources'});
    await save('trace.json',trace);
    return {output:out,trace,plan,photos};
  }catch(e){
    trace.project_status='blocked';trace.actions.push({stage:'error',result:String(e.message).slice(0,350)});
    await save('trace.json',trace).catch(()=>{});
    throw e;
  }
}
const page=`<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OffertaLogica · Video Studio Lab</title><style>
body{font:16px/1.5 system-ui,sans-serif;max-width:880px;margin:24px auto;padding:0 16px;color:#16354b;background:#f4f6f7}section{background:#fff;border:1px solid #dce2e8;padding:20px;border-radius:14px;margin:15px 0}input,textarea,select,button{font:inherit;box-sizing:border-box;width:100%;padding:11px;border:1px solid #aebdc5;border-radius:8px}label{display:block;margin:12px 0 5px;font-weight:600}button{margin-top:15px;background:#176e4e;color:#fff;cursor:pointer}small{color:#5e6b74}pre{white-space:pre-wrap;overflow-wrap:anywhere}#output article{border-top:1px solid #ddd;padding:10px 0}img{width:180px;max-width:100%}</style></head><body>
<h1>OffertaLogica · Video Studio Lab</h1><p>Prova locale del vero generatore creativo. Non è collegato alla Redazione in produzione.</p>
<section><form id="lab"><label>Origine</label><select id="source"><option value="theme">Tema libero</option><option value="article">Articolo Editoriale (JSON approvato)</option></select>
<div id="themeWrap"><label>Tema</label><input id="topic" required value="Bolletta troppo alta?" maxlength="180"></div>
<div id="articleWrap" hidden><label>Snapshot articolo JSON</label><textarea id="article" rows="8" placeholder='{"id":"...","version":"...","status":"published",...}'></textarea></div>
<label>Suggerimenti creativi (facoltativi)</label><textarea id="notes" rows="4" maxlength="1800" placeholder="Ad esempio: volto preoccupato in un negozio, senza coprire gli occhi con titoli"></textarea>
<label><input style="width:auto" id="photos" type="checkbox"> Genera anche 4 nuove fotografie (consuma crediti API se abilitato dall'admin)</label><button>Genera proposta reale</button></form><small>Richiede OPENAI_API_KEY sul computer che esegue il laboratorio. Non mostra né richiede chiavi nell'interfaccia.</small></section>
<section id="output" aria-live="polite">Nessuna generazione avviata.</section>
<script>
const source=document.getElementById('source'),topic=document.getElementById('topic'),article=document.getElementById('article');
source.onchange=()=>{document.getElementById('themeWrap').hidden=source.value!=='theme';document.getElementById('articleWrap').hidden=source.value!=='article';topic.required=source.value==='theme';};
const esc=s=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
document.getElementById('lab').onsubmit=async e=>{e.preventDefault();const output=document.getElementById('output');output.textContent='Generazione richiesta. Nessun risultato verrà simulato.';
try{const data={suggestions:document.getElementById('notes').value,photos:document.getElementById('photos').checked};
if(source.value==='theme')data.theme=topic.value;else data.article=JSON.parse(article.value);
const r=await fetch('/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await r.json();if(!r.ok)throw Error(result.error||'Errore');
output.innerHTML='<h2>Proposta da revisionare</h2><p><b>Concept:</b> '+esc(result.concept)+'</p><p><b>Stato:</b> '+esc(result.status)+'</p>'+
result.scenes.map((s,i)=>'<article><b>Scena '+(i+1)+' · '+esc(s.headline)+'</b><p>'+esc(s.visual_brief)+'</p><small>Emozione: '+esc(s.emotion)+'</small>'+(result.photos[i]?'<img src="/artifacts/'+encodeURIComponent(result.id)+'/photos/scene_'+(i+1)+'.png">':'')+'</article>').join('')+
'<p>File tracciati nella cartella di collaudo privata. Nessun MP4 pubblicato.</p>';
}catch(err){output.textContent='BLOCCATO: '+err.message;}};
</script></body></html>`;
function send(res,status,data,type='application/json'){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(type==='application/json'?JSON.stringify(data):data);}
async function serve({outputDir,port=4188}){
  const base=ensurePrivate(outputDir);await mkdir(base,{recursive:true});
  let active=false;
  const server=createServer(async(req,res)=>{
    try {
      const host=req.headers.host||'';
      if(!/^127\.0\.0\.1:[0-9]{2,5}$/.test(host))return send(res,403,{error:'accesso solo da localhost'});
      if(req.headers.origin && req.headers.origin!==`http://${host}`)return send(res,403,{error:'origine non autorizzata'});
      if(req.method==='GET'&&req.url==='/')return send(res,200,page,'text/html; charset=utf-8');
      if(req.method==='GET'&&/^\/artifacts\/[0-9a-f-]{36}\/photos\/scene_[1-4]\.png$/.test(req.url||'')){
        const [, , id,, filename]=req.url.split('/');
        const data=await readFile(join(base,id,'photos',filename));return send(res,200,data,'image/png');
      }
      if(req.method!=='POST'||req.url!=='/run')return send(res,404,{error:'not_found'});
      if(!(req.headers['content-type']||'').startsWith('application/json'))return send(res,415,{error:'JSON richiesto'});
      if(active)return send(res,429,{error:'Un lavoro è già in esecuzione'});
      let body='';for await (const chunk of req){body+=chunk;check(body.length<=100000,'input troppo grande');}
      let payload;try{payload=JSON.parse(body);}catch{return send(res,400,{error:'JSON invalido'});}
      const input=normalizeInput(payload);
      const id=randomUUID();active=true;
      try{
        const {plan,photos}=await runLocalLab({input,outputDir:join(base,id),images:payload.photos===true});
        return send(res,200,{id,status:plan.status,concept:plan.concept,scenes:plan.scenes,photos});
      }finally{active=false;}
    }catch(err){return send(res,400,{error:String(err.message).slice(0,350)});}
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return server;
}
function arg(name){const i=process.argv.indexOf(name);return i===-1?undefined:process.argv[i+1];}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  (async()=>{
    const out=ensurePrivate(arg('--out'));
    if(process.argv.includes('--serve')){
      const server=await serve({outputDir:out,port:Number(arg('--port')||4188)});
      console.log('Laboratorio locale disponibile su http://127.0.0.1:'+server.address().port);
      return;
    }
    if(process.argv.includes('--candidates')){
      const candidates=candidateArticles(JSON.parse(await readFile(resolve(arg('--candidates')),'utf8')));
      await writeFile(out,JSON.stringify(candidates,null,2),{flag:'wx'});
      console.log(JSON.stringify({candidate_count:candidates.length}));return;
    }
    const articleFile=arg('--article');const article=articleFile?JSON.parse(await readFile(resolve(articleFile),'utf8')):undefined;
    const input=normalizeInput({article,theme:arg('--theme'),suggestions:arg('--suggestions')||''});
    const run=await runLocalLab({input,outputDir:out,images:process.argv.includes('--photos')});
    console.log(JSON.stringify({output:run.output,status:run.trace.project_status,scenes:run.plan.scenes.length,photos:run.photos.length}));
  })().catch(err=>{console.error(String(err.message));process.exitCode=1;});
}
