// V1.1.7: signed sequential visual references; all photos remain manually reviewable.
// All paid operations are behind the existing authenticated Admin API and a server flag.
import crypto from 'node:crypto';
import {normalizeInput, generateCreativePlan, validateCreativeResponse} from './creative-director.mjs';
import {generatePhoto, photoPrompt} from './auto-images.mjs';

export const VIDEO_STUDIO_LAB_VERSION = '1.1.7';
const ROLES = ['hook','context','value','cta'];
const MAX_FUTURE_MS = 30 * 60 * 1000;
const err = (text) => {throw new Error(`VIDEO_STUDIO_LAB: ${text}`);};
const validUUID = (v) => typeof v === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v);
const canonical = (payload) => JSON.stringify(payload);
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const hmac = (value, secret) => crypto.createHmac('sha256', secret).update(value).digest('hex');
export function labEnabled(env=process.env) {
  return env.VIDEO_STUDIO_LAB_ENABLED === '1' && typeof env.OPENAI_API_KEY === 'string' && env.OPENAI_API_KEY.trim().length > 0 &&
    typeof env.VIDEO_STUDIO_LAB_SIGNING_SECRET === 'string' && env.VIDEO_STUDIO_LAB_SIGNING_SECRET.length >= 32;
}
export function extractSources(value) {
  let raw;
  if (Array.isArray(value)) raw = value.map(v=>typeof v==='string'?v:JSON.stringify(v)).join('\n');
  else if (typeof value === 'string') raw = value;
  else raw = JSON.stringify(value??'');
  const matches = raw.match(/https:\/\/[^\s\[\]<>"'\\]+/g) || [];
  const urls = [...new Set(matches.map(s=>s.replace(/[.,;)}]+$/g,'')))].filter(s=>{try{const u=new URL(s);return u.protocol==='https:' && s.length<=1000;}catch{return false;}}).slice(0,30);
  return urls.map((url,i)=>({id:`fonte_${i+1}`,url}));
}
export function fromEditorialRow(row) {
  if (!row || row.status !== 'published' || !validUUID(row.id) || !row.slug || !row.updated_at) err('articolo pubblicato non valido');
  const sources=extractSources(row.sources);
  if (!sources.length) err('l’articolo non contiene fonti HTTPS verificabili');
  const slug=String(row.slug).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) err('slug articolo non valido');
  return {id:row.id,version:String(row.updated_at),status:'published',title:row.title,url:`https://offertalogica.it/articoli/${slug}.html`,
    category:row.category || 'energia',content:row.content,sources};
}
function secret(env) {const s=env.VIDEO_STUDIO_LAB_SIGNING_SECRET; if(typeof s!=='string'||s.length<32)err('firma server non configurata'); return s;}
function tokenData({userId, input, plan, expiresAt}) {return canonical({userId,input,plan,expiresAt});}
export function signProposal(userId,input,plan,{env=process.env,now=Date.now()}={}) {
  if(!validUUID(userId))err('utente non valido');
  const expiresAt=now+MAX_FUTURE_MS;
  return {expiresAt,signature:hmac(tokenData({userId,input,plan,expiresAt}),secret(env))};
}
export function verifyProposal(userId,input,plan,receipt,{env=process.env,now=Date.now()}={}) {
  if(!validUUID(userId)||!receipt||!Number.isSafeInteger(receipt.expiresAt)||receipt.expiresAt<=now||receipt.expiresAt>now+MAX_FUTURE_MS||!/^[a-f\d]{64}$/.test(receipt.signature||''))err('ricevuta storyboard assente, alterata o scaduta');
  const expected=hmac(tokenData({userId,input,plan,expiresAt:receipt.expiresAt}),secret(env));
  if(!crypto.timingSafeEqual(Buffer.from(receipt.signature,'hex'),Buffer.from(expected,'hex')))err('la proposta è stata modificata: rigenerare lo storyboard');
  if(plan?.status!=='needs_human_review'||plan?.publication_authorized!==false||!Array.isArray(plan.scenes)||plan.scenes.length!==4)
    err('storyboard non approvato o non valido');
  if(plan.creative_schema_version!==2||plan.visual_uniqueness_status!=='pending_image_and_history_checks'||
    typeof plan.story_logline!=='string'||!plan.story_logline.trim()||typeof plan.episode_angle!=='string'||!plan.episode_angle.trim())
    err('storyboard narrativo non valido: rigenerare');
  for(const [i,s] of plan.scenes.entries()) {
    if(s.role!==ROLES[i]||s.id!==`scene_${i+1}`||typeof s.editorial_goal!=='string'||s.editorial_goal.length>600||
      !String(s.narrative_action||'').trim()||!String(s.setting||'').trim()||!String(s.shot_type||'').trim())
      err('contenuto scena non valido');
  }
  return true;
}
export async function createStoryboard({userId, theme, articleId, suggestions='',platform='instagram_reel'},
  {readArticle,generate=generateCreativePlan,env=process.env,now=Date.now()}={}) {
  if(!labEnabled(env))err('laboratorio server non configurato');
  if(Boolean(theme)===Boolean(articleId))err('scegli un tema oppure un articolo');
  const article=articleId ? fromEditorialRow(await readArticle(articleId)) : null;
  const input=normalizeInput({theme:article?null:theme,article,suggestions,platform});
  const plan=await generate(input);
  if(plan.status!=='needs_human_review'||plan.scenes.length!==4)err('regia non revisionabile');
  return {input,plan,receipt:signProposal(userId,input,plan,{env,now}),trace:{creative:'provider_returned',images:0,render:'not_started',publication_authorized:false}};
}
const MAX_REFERENCE_BYTES=35000;
function signReference(userId,receipt,sceneIndex,bytes,env) {
  const sha256=sha(bytes);
  return {scene_index:sceneIndex,jpeg_base64:bytes.toString('base64'),sha256,
    signature:hmac(`${userId}:${receipt.signature}:${sceneIndex}:${sha256}`,secret(env))};
}
function verifyReferences(refs,sceneIndex,userId,receipt,env) {
  const expected=sceneIndex===0?[]:sceneIndex===1?[0]:[0,sceneIndex-1];
  if(!Array.isArray(refs)||refs.length!==expected.length)err('servono le fotografie precedenti per mantenere il personaggio');
  return refs.map((ref,i)=>{
    if(ref?.scene_index!==expected[i]||typeof ref.jpeg_base64!=='string'||
      ref.jpeg_base64.length>Math.ceil(MAX_REFERENCE_BYTES*4/3)+4||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(ref.jpeg_base64)||
      !/^[a-f\d]{64}$/.test(ref.sha256||'')||!/^[a-f\d]{64}$/.test(ref.signature||''))
      err('riferimento scena non valido');
    const bytes=Buffer.from(ref.jpeg_base64,'base64');
    if(bytes.length<1000||bytes.length>MAX_REFERENCE_BYTES||sha(bytes)!==ref.sha256 ||
      bytes[0]!==0xff||bytes[1]!==0xd8)err('immagine di riferimento alterata');
    const expectedSignature=hmac(`${userId}:${receipt.signature}:${expected[i]}:${ref.sha256}`,secret(env));
    if(!crypto.timingSafeEqual(Buffer.from(ref.signature,'hex'),Buffer.from(expectedSignature,'hex')))
      err('riferimento scena non autorizzato: rigenerare lo storyboard');
    return bytes;
  });
}
async function continuityThumbnail(bytes,sharp) {
  for(const quality of [66,54,42]) {
    const result=await sharp(bytes).rotate().resize(256,455,{fit:'cover'}).jpeg({quality}).toBuffer();
    if(result.length<=MAX_REFERENCE_BYTES)return result;
  }
  err('riferimento fotografico troppo grande');
}
async function perceptualDHash(bytes,sharp) {
  const {data}=await sharp(bytes).resize(9,8,{fit:'fill'}).grayscale().raw().toBuffer({resolveWithObject:true});
  let bits=0n;
  for(let y=0;y<8;y++)for(let x=0;x<8;x++) {
    bits=(bits<<1n)|BigInt(data[y*9+x]>data[y*9+x+1]?1:0);
  }
  return bits;
}
function bitDistance(a,b) {let v=a^b,n=0;while(v){v&=v-1n;n++;}return n;}
async function meanPixelDifference(a,b,sharp) {
  async function pixels(bytes) {
    return sharp(bytes).resize(24,24,{fit:'fill'}).removeAlpha().raw().toBuffer();
  }
  const x=await pixels(a),y=await pixels(b);
  if(x.length!==y.length)err('controllo visivo immagini non disponibile');
  let diff=0;
  for(let i=0;i<x.length;i++)diff+=Math.abs(x[i]-y[i]);
  return diff/(255*x.length);
}
export async function createPhoto({userId,input,plan,receipt,sceneIndex,revisionNotes='',references=[]},
  {generate=generatePhoto,env=process.env,now=Date.now(),sharpFactory}={}) {
  if(!labEnabled(env))err('laboratorio server non configurato');
  verifyProposal(userId,input,plan,receipt,{env,now});
  if(!Number.isInteger(sceneIndex)||sceneIndex<0||sceneIndex>3)err('indice scena non valido');
  const scene=plan.scenes[sceneIndex];
  if(typeof revisionNotes!=='string'||revisionNotes.length>700)err('note revisione non valide');
  const notes=revisionNotes.trim();
  const referenceImages=verifyReferences(references,sceneIndex,userId,receipt,env);
  const result=await generate({article:{title:input.topic},scene,index:sceneIndex,story:plan,
    revisionNotes:notes,referenceImages});
  if(!Buffer.isBuffer(result.bytes)||sha(result.bytes)!==result.sha256)err('immagine generata non integra');
  const sharp=sharpFactory || (await import('sharp')).default;
  // Actual candidate-image similarity gate: do not propagate almost identical frames.
  if(referenceImages.length) {
    const candidate=await perceptualDHash(result.bytes,sharp);
    for(const reference of referenceImages) {
      if(bitDistance(candidate,await perceptualDHash(reference,sharp))<=3 &&
        await meanPixelDifference(result.bytes,reference,sharp)<0.035)
        err('immagine quasi identica alla precedente: rigenerare con una nuova inquadratura');
    }
  }
  const anchor=await continuityThumbnail(result.bytes,sharp);
  const continuity_reference=signReference(userId,receipt,sceneIndex,anchor,env);
  // Keep the source 1080x1920 detail for the full-frame browser draft.
  // Bound the JSON payload as before; this is still a temporary, NON-persistent preview.
  let preview;
  for (const quality of [86, 80, 74]) {
    preview = await sharp(result.bytes).resize(1080,1920,{fit:'cover'}).jpeg({quality,mozjpeg:true}).toBuffer();
    if (preview.length <= 1700000) break;
  }
  if(preview.length > 1700000)err('anteprima troppo grande');
  const prompt=photoPrompt({article:{title:input.topic},scene,index:sceneIndex,story:plan,revisionNotes:notes});
  return {scene_id:scene.id,preview_base64:preview.toString('base64'),preview_mime:'image/jpeg',preview_sha256:sha(preview),continuity_reference,
    original_sha256:result.sha256,provider:result.provider,prompt,needs_human_review:true,stored:false,
    publication_authorized:false,revision_notes:notes};
}
