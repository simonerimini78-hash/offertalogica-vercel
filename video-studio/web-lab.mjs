// V1.0.1: manual-only, stateless Video Studio creative lab. No SQL, worker or publishing.
// All paid operations are behind the existing authenticated Admin API and a server flag.
import crypto from 'node:crypto';
import {normalizeInput, generateCreativePlan, validateCreativeResponse} from './creative-director.mjs';
import {generatePhoto, photoPrompt} from './auto-images.mjs';

export const VIDEO_STUDIO_LAB_VERSION = '1.0.1';
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
  if(plan?.status!=='needs_human_review'||plan?.publication_authorized!==false||!Array.isArray(plan.scenes)||plan.scenes.length!==4)err('storyboard non approvato o non valido');
  for(const [i,s] of plan.scenes.entries()) if(s.role!==ROLES[i]||s.id!==`scene_${i+1}`||typeof s.editorial_goal!=='string'||s.editorial_goal.length>600)err('contenuto scena non valido');
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
export async function createPhoto({userId,input,plan,receipt,sceneIndex},
  {generate=generatePhoto,env=process.env,now=Date.now(),sharpFactory}={}) {
  if(!labEnabled(env))err('laboratorio server non configurato');
  verifyProposal(userId,input,plan,receipt,{env,now});
  if(!Number.isInteger(sceneIndex)||sceneIndex<0||sceneIndex>3)err('indice scena non valido');
  const scene=plan.scenes[sceneIndex];
  const result=await generate({article:{title:input.topic},scene,index:sceneIndex});
  if(!Buffer.isBuffer(result.bytes)||sha(result.bytes)!==result.sha256)err('immagine generata non integra');
  const sharp=sharpFactory || (await import('sharp')).default;
  // Response is a limited temporary browser preview, NOT a persistent master asset.
  const preview=await sharp(result.bytes).resize(720,1280,{fit:'cover'}).jpeg({quality:78}).toBuffer();
  if(preview.length > 1700000)err('anteprima troppo grande');
  const prompt=photoPrompt({article:{title:input.topic},scene,index:sceneIndex});
  return {scene_id:scene.id,preview_base64:preview.toString('base64'),preview_mime:'image/jpeg',preview_sha256:sha(preview),
    original_sha256:result.sha256,provider:result.provider,prompt,needs_human_review:true,stored:false,
    publication_authorized:false};
}
