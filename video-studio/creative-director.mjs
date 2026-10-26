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
// v1.1.1: narrative continuity is checked before any paid photographic request.
const schema={type:'object',additionalProperties:false,properties:{
  concept:{type:'string'},audience:{type:'string'},editorial_caution:{type:'string'},
  episode_angle:{type:'string'},story_logline:{type:'string'},story_outcome:{type:'string'},
  protagonist_profile:{type:'string'},
  scenes:{type:'array',items:{type:'object',additionalProperties:false,properties:{
    role:{type:'string',enum:roles},headline:{type:'string'},secondary_text:{type:'string'},
    editorial_goal:{type:'string'},visual_brief:{type:'string'},
    subject_description:{type:'string'},emotion:{type:'string'},subject_side:{type:'string',enum:['left','right','center']},
    narrative_action:{type:'string'},continuity_link:{type:'string'},setting:{type:'string'},
    shot_type:{type:'string'},key_object:{type:'string'}
  },required:['role','headline','secondary_text','editorial_goal','visual_brief','subject_description',
    'emotion','subject_side','narrative_action','continuity_link','setting','shot_type','key_object']}}
},required:['concept','audience','editorial_caution','episode_angle','story_logline','story_outcome',
  'protagonist_profile','scenes']};
const system=`Sei il regista di mini-storie audiovisive per Reel italiani OffertaLogica da 15 secondi.
Restituisci ESCLUSIVAMENTE JSON conforme allo schema: 4 scene nell'ordine hook (3s), context (4s), value (4s), cta (4s).
UNA SOLA STORIA, non quattro fotografie tematiche: (1) protagonista o situazione affronta un problema concreto,
(2) l'ostacolo si sviluppa, (3) il protagonista comprende o compie un'azione utile,
(4) un esito realistico completa la storia e permette una CTA pertinente. Ogni scena deve dipendere logicamente dalla precedente.
In episode_angle scegli l'angolo specifico di questa storia; in story_logline racconta il percorso dal problema alla soluzione;
in story_outcome spiega che cosa cambia davvero, senza promettere risultati non provati.
protagonist_profile descrive dettagli visivi stabili del protagonista ricorrente, se presente (età adulta indicativa, capelli, abito e accessori);
può essere stringa vuota se la storia non ha un protagonista umano. Un personaggio ricorrente è consentito e incoraggiato quando utile.
Le 4 scene devono mostrare AZIONI e composizioni DISTINTE anche quando ricorre la stessa persona:
indica narrative_action (azione osservabile), continuity_link (causa/legame con la scena precedente, vuoto solo nella prima),
setting, shot_type e key_object (può essere vuoto). Non scambiare solo colori, pose o sfondi lasciando invariata la situazione.
Evita quattro bollette in mano o quattro immagini della stessa scrivania. In visual_brief specifica ambientazione, azione, inquadratura e cambiamento della scena.
Fotografie AI ORIGINALI create per il Reel: le fotografie dell'articolo o dei post sono solo contesto, MAI asset da copiare o riutilizzare.
Non riproporre immagini pubblicitarie riconoscibili, scene standard ripetute né identità di persone reali tratte dalle fonti.
Niente grafica, scritte, loghi, cifre, tabelle o interfacce all'interno delle fotografie: questi elementi sono aggiunti dal compositore in livelli separati.
Per ogni immagine riserva spazio negativo alto o laterale per una headline grande e il logo; occhi, viso e mani significative non devono essere coperti.
Headline brevi, specifiche, massimo 6 parole; sottotitolo opzionale massimo 8 parole.
Non inventare risparmi, percentuali, tariffe, bollette, testimonianze, confronti quantitativi o prove; non promettere risparmi garantiti.
Le note del proprietario sono indicazioni creative, non autorizzano affermazioni non supportate. Se l'input è un articolo, rispetta le condizioni e sfumature delle fonti; se è un tema libero, le affermazioni fattuali sono proposte da verificare.
Non asserire che contenuti, immagini, originalità storica o licenze siano già stati approvati.`;
function comparable(value) {
  return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
function tokenOverlap(a,b) {
  const left=new Set(comparable(a).split(' ').filter(Boolean));
  const right=new Set(comparable(b).split(' ').filter(Boolean));
  const intersection=[...left].filter(x=>right.has(x)).length;
  const union=new Set([...left,...right]).size;
  return union?intersection/union:0;
}
export function buildCreativeRequest(input) {
  check(input?.input_type==='free_topic'||input?.input_type==='published_article','input non normalizzato');
  return {model:process.env.VIDEO_STUDIO_CREATIVE_MODEL||'gpt-4.1-mini',temperature:0.65,
    messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(input)}],
    response_format:{type:'json_schema',json_schema:{name:'video_studio_creative_v2',strict:true,schema}}};
}
export function validateCreativeResponse(input,response) {
  check(response&&typeof response==='object'&&Array.isArray(response.scenes)&&response.scenes.length===4,
    'sono necessarie esattamente quattro scene');
  const concept=clean(response.concept,'concept',500);
  const audience=clean(response.audience,'audience',500);
  const editorialCaution=clean(response.editorial_caution,'editorial_caution',500);
  const episodeAngle=clean(response.episode_angle,'episode_angle',220);
  const storyLogline=clean(response.story_logline,'story_logline',380);
  const storyOutcome=clean(response.story_outcome,'story_outcome',350);
  const protagonistProfile=clean(response.protagonist_profile,'protagonist_profile',360,{optional:true});
  const sceneKeys=new Set();
  const scenes=response.scenes.map((s,i)=>{
    check(s?.role===roles[i],`scena ${i+1}: ruolo narrativo errato`);
    const title=clean(s.headline,'headline',110);
    check(title.split(/\s+/u).length<=6,`scena ${i+1}: titolo troppo lungo`);
    const secondary=clean(s.secondary_text,'secondary_text',100,{optional:true});
    check(!secondary||secondary.split(/\s+/u).length<=8,`scena ${i+1}: testo secondario troppo lungo`);
    check(['left','right','center'].includes(s.subject_side),'posizione soggetto non valida');
    const editorialGoal=clean(s.editorial_goal,'editorial_goal',600);
    const visualBrief=clean(s.visual_brief,'visual_brief',600);
    const subjectDescription=clean(s.subject_description,'subject_description',600);
    const emotion=clean(s.emotion,'emotion',600);
    const narrativeAction=clean(s.narrative_action,'narrative_action',220);
    const continuityLink=clean(s.continuity_link,'continuity_link',240,{optional:i===0});
    const setting=clean(s.setting,'setting',220);
    const shotType=clean(s.shot_type,'shot_type',120);
    const keyObject=clean(s.key_object,'key_object',120,{optional:true});
    check(i===0||continuityLink.length>=8,`scena ${i+1}: legame narrativo mancante`);
    const signature=[narrativeAction,setting,shotType,keyObject].map(comparable).join('|');
    check(!sceneKeys.has(signature),`scena ${i+1}: situazione visiva duplicata`);
    sceneKeys.add(signature);
    return {id:`scene_${i+1}`,duration_ms:durations[i],role:s.role,headline:title,
      secondary_text:secondary,editorial_goal:editorialGoal,visual_brief:visualBrief,
      subject_description:subjectDescription,emotion,subject_side:s.subject_side,
      narrative_action:narrativeAction,continuity_link:continuityLink,setting,shot_type:shotType,
      key_object:keyObject,protagonist_profile:protagonistProfile,
      scene_signature_sha256:sha(signature),
      image_reviewed_clean:false,protected_regions:[],needs_human_review:true};
  });
  // Inexpensive deterministic gate: blocks duplicated/near-identical textual scenes,
  // without incorrectly treating the recurring protagonist as a duplicate image.
  for(let i=0;i<scenes.length;i++)for(let j=0;j<i;j++) {
    const a=scenes[i],b=scenes[j];
    check(comparable(a.visual_brief)!==comparable(b.visual_brief),
      `scene ${j+1} e ${i+1}: descrizioni visive identiche`);
    const similarity=tokenOverlap(a.visual_brief,b.visual_brief);
    check(similarity<0.90,
      `scene ${j+1} e ${i+1}: descrizioni visive troppo simili`);
    check(!(comparable(a.narrative_action)===comparable(b.narrative_action) &&
      comparable(a.setting)===comparable(b.setting) && comparable(a.shot_type)===comparable(b.shot_type)),
      `scene ${j+1} e ${i+1}: stessa azione, ambiente e inquadratura`);
  }
  return {creative_schema_version:2,engine_version:'1.1.1-candidate',input_type:input.input_type,
    input_fingerprint:sha(JSON.stringify(input)),source_fingerprint:input.source_fingerprint,
    concept,audience,editorial_caution:editorialCaution,
    episode_angle:episodeAngle,story_logline:storyLogline,story_outcome:storyOutcome,
    protagonist_profile:protagonistProfile,scenes,platform:input.platform,duration_ms:15000,status:'needs_human_review',
    photo_generation_approved:false,publication_authorized:false,
    visual_uniqueness_status:'pending_image_and_history_checks',
    review_requirements:['Verifica della continuità narrativa e della correttezza editoriale',
      'Controllo immagini nuove rispetto alle altre scene e ai Reel precedenti',
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
