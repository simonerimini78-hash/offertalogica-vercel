// Isolated creative director for Video Studio: human-review drafts only.
// Supports an approved/published Editoriale snapshot OR a free topic plus optional notes.
// No automatic publishing, no inferred source claims, no approvals.
import {createHash} from 'node:crypto';
import {freezeArticle} from './core.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');
const roles=['hook','context','value','cta'];
const durations=[3000,4000,4000,4000];
function check(ok,msg){if(!ok)throw new Error(`VIDEO_STUDIO_CREATIVE: ${msg}`);}
function clean(v,label,max,{optional=false}={}) {
  check((optional&& (v==null||v===''))||(typeof v==='string'&&v.trim()&&v.length<=max),`${label} non valido (massimo ${max} caratteri)`);
  return String(v||'').trim();
}
export function normalizeInput({theme,article,suggestions='',platform='instagram_reel'}={}) {
  check(['instagram_reel','facebook_reel'].includes(platform),'piattaforma non supportata');
  check(Boolean(theme)!==Boolean(article),'scegli un tema oppure un articolo, non entrambi');
  const notes=clean(suggestions,'suggerimenti',1800,{optional:true});
  if(article){
    const {snapshot,fingerprint}=freezeArticle(article);
    return {input_type:'published_article',topic:snapshot.title,suggestions:notes,platform,
      article:{id:snapshot.id,version:snapshot.version,status:snapshot.status,title:snapshot.title,
        content:snapshot.content.slice(0,18000),sources:snapshot.sources},source_fingerprint:fingerprint,
      review_required:true};
  }
  const topic=clean(theme,'tema',180);
  return {input_type:'free_topic',topic,suggestions:notes,platform,article:null,
    source_fingerprint:sha(`topic-v1:${topic.toLowerCase()}`),review_required:true};
}
const schema={type:'object',additionalProperties:false,properties:{
  concept:{type:'string'},audience:{type:'string'},editorial_caution:{type:'string'},
  scenes:{type:'array',items:{type:'object',additionalProperties:false,properties:{
    role:{type:'string',enum:roles},headline:{type:'string'},secondary_text:{type:'string'},
    editorial_goal:{type:'string'},visual_brief:{type:'string'},
    subject_description:{type:'string'},emotion:{type:'string'},subject_side:{type:'string',enum:['left','right','center']}
  },required:['role','headline','secondary_text','editorial_goal','visual_brief','subject_description','emotion','subject_side']}}
},required:['concept','audience','editorial_caution','scenes']};
const system=`Sei un regista audiovisivo di Reel italiani di 15 secondi per OffertaLogica.
Restituisci ESCLUSIVAMENTE JSON conforme allo schema. Scegli autonomamente ambientazione, soggetti e quattro scene originali (hook, context, value, cta).
Fotografie reali, ambientazioni non ripetitive, volti e persone consentiti e utili per trasmettere emozioni; mai replicare persone o scene da un Reel di riferimento.
Niente grafica, scritte, loghi, cifre, tabelle o interfacce all'interno delle fotografie: questi elementi sono aggiunti dal compositore in livelli separati.
Per ogni immagine riserva spazio negativo alto o laterale per una headline grande e il logo; occhi, faccia e mani significative non devono essere coperti.
Il rapporto immagine-testo deve essere semantico ed emotivo: l'immagine mostra ciò che il testo comunica.
Headline brevi, specifiche, comprensibili in 1 secondo, massimo 6 parole; sottotitolo opzionale massimo 8 parole.
Costruisci un crescendo: situazione riconoscibile, tensione, soluzione concreta e CTA.
Non inventare risparmi, percentuali, tariffe, bollette, testimonianze, confronti quantitativi o prove; non promettere risparmi garantiti.
Le note del proprietario sono indicazioni creative, non autorizzano affermazioni non supportate. Se l'input è un articolo, rispetta le condizioni e sfumature delle fonti; se è un tema libero, le affermazioni fattuali sono solo proposte da verificare.
Non asserire che contenuti, immagini o licenze siano già stati approvati.`;
export function buildCreativeRequest(input) {
  check(input?.input_type==='free_topic'||input?.input_type==='published_article','input non normalizzato');
  return {model:process.env.VIDEO_STUDIO_CREATIVE_MODEL||'gpt-4.1-mini',temperature:0.65,
    messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(input)}],
    response_format:{type:'json_schema',json_schema:{name:'video_studio_creative_v1',strict:true,schema}}};
}
export function validateCreativeResponse(input,response) {
  check(response&&typeof response==='object'&&Array.isArray(response.scenes)&&response.scenes.length===4,'sono necessarie esattamente quattro scene');
  for(const k of ['concept','audience','editorial_caution'])clean(response[k],k,500);
  const sceneNames=new Set();
  const scenes=response.scenes.map((s,i)=>{
    check(s?.role===roles[i],`scena ${i+1}: ruolo narrativo errato`);
    const title=clean(s.headline,'headline',110);
    check(title.split(/\s+/u).length<=6,`scena ${i+1}: titolo troppo lungo`);
    const secondary=clean(s.secondary_text,'secondary_text',100,{optional:true});
    check(!secondary||secondary.split(/\s+/u).length<=8,`scena ${i+1}: testo secondario troppo lungo`);
    check(['left','right','center'].includes(s.subject_side),'posizione soggetto non valida');
    for(const k of ['editorial_goal','visual_brief','subject_description','emotion'])clean(s[k],k,600);
    const normalized={id:`scene_${i+1}`,duration_ms:durations[i],role:s.role,headline:title,
      secondary_text:secondary,editorial_goal:s.editorial_goal.trim(),visual_brief:s.visual_brief.trim(),
      subject_description:s.subject_description.trim(),emotion:s.emotion.trim(),subject_side:s.subject_side,
      image_reviewed_clean:false,protected_regions:[],needs_human_review:true};
    sceneNames.add(normalized.id);return normalized;
  });
  check(sceneNames.size===4,'scene duplicate');
  return {creative_schema_version:1,engine_version:'1.0.0-candidate',input_type:input.input_type,
    input_fingerprint:sha(JSON.stringify(input)),source_fingerprint:input.source_fingerprint,
    concept:response.concept,audience:response.audience,editorial_caution:response.editorial_caution,
    scenes,platform:input.platform,duration_ms:15000,status:'needs_human_review',
    photo_generation_approved:false,publication_authorized:false,
    review_requirements:['Verifica della correttezza editoriale e delle fonti',
      'Controllo visivo di volti e aree protette prima del rendering',
      'Licenze fotografiche e musicali da confermare',
      'Conferma umana del master prima di pubblicare']};
}
export async function generateCreativePlan(normalized,{apiKey=process.env.OPENAI_API_KEY,fetchImpl=fetch}={}) {
  check(apiKey,'OPENAI_API_KEY mancante; impossibile generare una regia AI autentica');
  const response=await fetchImpl('https://api.openai.com/v1/chat/completions',{
    method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify(buildCreativeRequest(normalized)),signal:AbortSignal.timeout(90000)});
  const json=await response.json().catch(()=>null);
  check(response.ok,`provider regia: HTTP ${response.status}`);
  const content=json?.choices?.[0]?.message?.content;
  check(typeof content==='string'&&content.length<20000,'risposta creativa assente o troppo grande');
  let parsed;try{parsed=JSON.parse(content);}catch{throw new Error('VIDEO_STUDIO_CREATIVE: JSON risposta non valido');}
  return validateCreativeResponse(normalized,parsed);
}
export function candidateArticles(articles,{processedIds=[]}={}) {
  check(Array.isArray(articles)&&Array.isArray(processedIds),'liste articoli non valide');
  const done=new Set(processedIds);
  return articles.filter(article=>{
    try{const {snapshot}=freezeArticle(article);return snapshot.status==='published'&&!done.has(`${snapshot.id}:${snapshot.version}`);}
    catch{return false;}
  }).map(article=>({id:article.id,version:article.version,title:article.title,
    key:`${article.id}:${article.version}`,status:'candidate_for_review'}));
}
