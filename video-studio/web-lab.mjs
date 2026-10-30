// V1.1.7: signed sequential visual references; all photos remain manually reviewable.
// All paid operations are behind the existing authenticated Admin API and a server flag.
import crypto from 'node:crypto';
import {normalizeInput, generateCreativePlan, validateCreativeResponse} from './creative-director.mjs';
import {generatePhoto, photoPrompt} from './auto-images.mjs';

export const VIDEO_STUDIO_LAB_VERSION = '1.2.2';
const ROLES = ['hook','context','value','cta'];
const MAX_FUTURE_MS = 30 * 60 * 1000;
const MAX_RESUME_AGE_MS = 180 * 24 * 60 * 60 * 1000;
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
export function verifyProposal(userId,input,plan,receipt,{env=process.env,now=Date.now(),allowExpired=false}={}) {
  if(!validUUID(userId)||!receipt||!Number.isSafeInteger(receipt.expiresAt)||receipt.expiresAt<=(allowExpired?now-MAX_RESUME_AGE_MS:now)||receipt.expiresAt>now+MAX_FUTURE_MS||!/^[a-f\d]{64}$/.test(receipt.signature||''))err('ricevuta storyboard assente, alterata o scaduta');
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
export async function createStoryboard({userId, theme, articleId, guideImageBase64='',guideUsage='',guideContext='',guideFidelity='strong', suggestions='',platform='instagram_reel'},
  {readArticle,generate=generateCreativePlan,env=process.env,now=Date.now(),sharpFactory=null}={}) {
  if(!labEnabled(env))err('laboratorio server non configurato');
  if(Number(Boolean(theme))+Number(Boolean(articleId))+Number(Boolean(guideImageBase64))!==1)
    err('scegli un tema, un articolo oppure una foto guida');
  const article=articleId ? fromEditorialRow(await readArticle(articleId)) : null;
  const guideBytes=guideImageBase64 ? decodeUploadedJpeg(guideImageBase64,115000) : null;
  let guideSharp=null;
  if(guideBytes) {
    guideSharp=sharpFactory || (await import('sharp')).default;
    const info=await guideSharp(guideBytes).metadata();
    if(!info.width||!info.height||info.width<320||info.height<320||info.width*info.height>24000000)
      err('dimensioni immagine guida non valide');
  }
  const input=normalizeInput({theme:article?null:theme,article,suggestions,platform,
    guideImageSha256:guideBytes?sha(guideBytes):'',guideUsage,guideContext,guideFidelity});
  const plan=await generate(input,{guideImageBytes:guideBytes});
  if(plan.status!=='needs_human_review'||plan.scenes.length!==4)err('regia non revisionabile');
  const receipt=signProposal(userId,input,plan,{env,now});
  let guide_reference=null;
  if(guideBytes) {
    // Preserve the approved source (without cropping) as a signed, bounded reference.
    guide_reference=signReference(userId,receipt,-1,await guideThumbnail(guideBytes,guideSharp),env);
  }
  return {input,plan,receipt,guide_reference,
    trace:{creative:'provider_returned',images:0,render:'not_started',publication_authorized:false}};
}
const MAX_REFERENCE_BYTES=35000;
const MAX_GUIDE_BYTES=85000;
// Signed reference order is validated server-side: a client cannot choose arbitrary images.
export function expectedReferenceIndices(sceneIndex,input) {
  if(!Number.isInteger(sceneIndex)||sceneIndex<0||sceneIndex>3)err('indice scena non valido');
  const isGuide=input?.input_type==='guide_image';
  const strong=isGuide&&input?.guide_fidelity==='strong';
  if(strong) {
    if(sceneIndex===0)return [-1];
    if(sceneIndex===1&&input.guide_usage==='first_scene')return [-1];
    return [-1,sceneIndex-1];
  }
  if(sceneIndex===0)return isGuide&&input.guide_usage==='reference_only'?[-1]:[];
  return sceneIndex===1?[0]:[0,sceneIndex-1];
}
function decodeUploadedJpeg(value,maxBytes) {
  if(typeof value!=='string'||value.length<1300||value.length>Math.ceil(maxBytes*4/3)+4||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value))err('file immagine mancante o troppo grande');
  const bytes=Buffer.from(value,'base64');
  if(bytes.length<1000||bytes.length>maxBytes||bytes[0]!==0xff||bytes[1]!==0xd8)
    err('immagine non JPEG o non valida');
  return bytes;
}
function signReference(userId,receipt,sceneIndex,bytes,env) {
  const sha256=sha(bytes);
  return {scene_index:sceneIndex,jpeg_base64:bytes.toString('base64'),sha256,
    signature:hmac(`${userId}:${receipt.signature}:${sceneIndex}:${sha256}`,secret(env))};
}
function verifyReferences(refs,sceneIndex,userId,receipt,env,input) {
  const expected=expectedReferenceIndices(sceneIndex,input);
  if(!Array.isArray(refs)||refs.length!==expected.length)err('riferimenti guida e scene precedenti incompleti');
  return refs.map((ref,i)=>{
    if(ref?.scene_index!==expected[i]||typeof ref.jpeg_base64!=='string'||
      ref.jpeg_base64.length>Math.ceil((expected[i]===-1?MAX_GUIDE_BYTES:MAX_REFERENCE_BYTES)*4/3)+4||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(ref.jpeg_base64)||
      !/^[a-f\d]{64}$/.test(ref.sha256||'')||!/^[a-f\d]{64}$/.test(ref.signature||''))
      err('riferimento scena non valido');
    const bytes=Buffer.from(ref.jpeg_base64,'base64');
    if(bytes.length<1000||bytes.length>(expected[i]===-1?MAX_GUIDE_BYTES:MAX_REFERENCE_BYTES)||sha(bytes)!==ref.sha256 ||
      bytes[0]!==0xff||bytes[1]!==0xd8)err('immagine di riferimento alterata');
    const expectedSignature=hmac(`${userId}:${receipt.signature}:${expected[i]}:${ref.sha256}`,secret(env));
    if(!crypto.timingSafeEqual(Buffer.from(ref.signature,'hex'),Buffer.from(expectedSignature,'hex')))
      err('riferimento scena non autorizzato: rigenerare lo storyboard');
    return bytes;
  });
}
// Resume a saved local draft without a paid generation. Only valid signed receipts
// belonging to the current admin may be renewed. All signed image references are
// verified again and bound to the new receipt; never trust imported files blindly.
export function renewStoryboard({userId,input,plan,receipt,guideReference=null,sceneReferences=[]},
  {env=process.env,now=Date.now()}={}) {
  verifyProposal(userId,input,plan,receipt,{env,now,allowExpired:true});
  if(!Array.isArray(sceneReferences)||sceneReferences.length!==4)
    err('riferimenti del progetto incompleti');
  function renewOne(ref,idx){
    if(ref==null)return null;
    if(idx===-1 && input.input_type!=='guide_image')err('guida non prevista per questo storyboard');
    const limit=idx===-1?MAX_GUIDE_BYTES:MAX_REFERENCE_BYTES;
    if(ref?.scene_index!==idx||typeof ref.jpeg_base64!=='string'||
      ref.jpeg_base64.length>Math.ceil(limit*4/3)+4||
      !/^[a-f\d]{64}$/.test(ref.sha256||'')||!/^[a-f\d]{64}$/.test(ref.signature||''))
      err('riferimento scaduto o non valido');
    const bytes=decodeUploadedJpeg(ref.jpeg_base64,limit);
    const digest=sha(bytes);
    const signature=hmac(`${userId}:${receipt.signature}:${idx}:${digest}`,secret(env));
    if(digest!==ref.sha256||!crypto.timingSafeEqual(Buffer.from(ref.signature,'hex'),Buffer.from(signature,'hex')))
      err('riferimento alterato o appartenente a un’altra bozza');
    return bytes;
  }
  const guide=renewOne(guideReference,-1);
  if(input.input_type==='guide_image'&&!guide)err('guida fotografica salvata mancante');
  const sceneBytes=sceneReferences.map((ref,i)=>renewOne(ref,i));
  const renewedReceipt=signProposal(userId,input,plan,{env,now});
  return {receipt:renewedReceipt,
    guide_reference:guide?signReference(userId,renewedReceipt,-1,guide,env):null,
    scene_references:sceneBytes.map((bytes,i)=>bytes?signReference(userId,renewedReceipt,i,bytes,env):null)};
}

async function guideThumbnail(bytes,sharp) {
  // Never crop the source: its colors, lighting and overall arrangement are the art-direction anchor.
  for(const width of [640,512,384])for(const quality of [83,72,58]) {
    const result=await sharp(bytes).rotate().resize(width,960,{fit:'inside',withoutEnlargement:true}).jpeg({quality}).toBuffer();
    if(result.length<=MAX_GUIDE_BYTES)return result;
  }
  err('immagine guida troppo grande per il riferimento sicuro');
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
async function basicLightProfile(bytes,sharp) {
  const {data,info}=await sharp(bytes).rotate().resize(32,32,{fit:'cover'}).removeAlpha().raw().toBuffer({resolveWithObject:true});
  let r=0,g=0,b=0;
  for(let i=0;i<data.length;i+=info.channels){r+=data[i];g+=data[i+1];b+=data[i+2];}
  const count=data.length/info.channels;
  return {brightness:Math.round((.2126*r+.7152*g+.0722*b)/count/255*100),
    warmth:Math.round((r-b)/count/255*100)};
}
export async function basicGuideStyleCheck(guideBytes,candidateBytes,sharp) {
  const a=await basicLightProfile(guideBytes,sharp), b=await basicLightProfile(candidateBytes,sharp);
  const brightnessDelta=Math.abs(a.brightness-b.brightness);
  const warmthDelta=Math.abs(a.warmth-b.warmth);
  return {status:brightnessDelta>30||warmthDelta>22?'review_light_and_palette':'basic_tone_compatible',
    brightness_delta:brightnessDelta,warmth_delta:warmthDelta,
    method:'global_light_palette_only',human_review_required:true};
}
export async function createPhoto({userId,input,plan,receipt,sceneIndex,revisionNotes='',references=[],manualImageBase64=''},
  {generate=generatePhoto,env=process.env,now=Date.now(),sharpFactory}={}) {
  if(!labEnabled(env))err('laboratorio server non configurato');
  verifyProposal(userId,input,plan,receipt,{env,now});
  if(!Number.isInteger(sceneIndex)||sceneIndex<0||sceneIndex>3)err('indice scena non valido');
  const scene=plan.scenes[sceneIndex];
  if(typeof revisionNotes!=='string'||revisionNotes.length>700)err('note revisione non valide');
  const notes=revisionNotes.trim();
  const isManual=Boolean(manualImageBase64);
  const referenceImages=isManual?[]:verifyReferences(references,sceneIndex,userId,receipt,env,input);
  const sharp=sharpFactory || (await import('sharp')).default;
  let result;
  if(isManual) {
    const uploaded=decodeUploadedJpeg(manualImageBase64,1700000);
    const info=await sharp(uploaded).metadata();
    if(!info.width||!info.height||info.width<400||info.height<400||info.width*info.height>24000000)
      err('risoluzione immagine caricata non ammessa');
    const bytes=await sharp(uploaded).rotate().resize(1080,1920,{fit:'cover',position:'attention'}).png().toBuffer();
    result={bytes,sha256:sha(bytes),provider:'editor_upload'};
  } else {
    result=await generate({article:{title:input.topic},scene,index:sceneIndex,story:plan,
      revisionNotes:notes,referenceImages});
  }
  if(!Buffer.isBuffer(result.bytes)||sha(result.bytes)!==result.sha256)err('immagine generata non integra');
  // Actual candidate-image similarity gate: do not propagate almost identical frames.
  if(!isManual && referenceImages.length) {
    const candidate=await perceptualDHash(result.bytes,sharp);
    for(const reference of referenceImages) {
      if(bitDistance(candidate,await perceptualDHash(reference,sharp))<=3 &&
        await meanPixelDifference(result.bytes,reference,sharp)<0.035)
        err('immagine quasi identica alla precedente: rigenerare con una nuova inquadratura');
    }
  }
  // Free local preliminary QA: tonal deviation only, not a claim of stylistic equivalence.
  const guide_style_check=!isManual&&input?.input_type==='guide_image'&&input.guide_fidelity==='strong'
    ? await basicGuideStyleCheck(referenceImages[0],result.bytes,sharp) : null;
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
  const prompt=isManual?'Immagine fornita e verificata dall’editor; nessuna generazione AI.':photoPrompt({article:{title:input.topic},scene,index:sceneIndex,story:plan,revisionNotes:notes});
  return {scene_id:scene.id,preview_base64:preview.toString('base64'),preview_mime:'image/jpeg',preview_sha256:sha(preview),continuity_reference,
    original_sha256:result.sha256,provider:result.provider,prompt,needs_human_review:true,stored:false,
    publication_authorized:false,revision_notes:notes,guide_style_check};
}
