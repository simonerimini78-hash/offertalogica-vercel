// Video Studio v1.3.3.33 image composition; independent of editorial automations.
import {createHash} from 'node:crypto';
const SHA = v=>createHash('sha256').update(v).digest('hex');
// Keep existing deployment overrides except retired/older image-model defaults.
function imageModel() {
  const requested=String(process.env.VIDEO_STUDIO_IMAGE_MODEL||'').trim();
  return !requested || /^(?:gpt-image-2|gpt-image-1(?:-mini)?)$/i.test(requested)
    ? 'gpt-image-2.6-sunburst' : requested;
}

function cleanRevisionNotes(value) {
  const notes = String(value || '').trim();
  if (!notes) return '';
  if (notes.length > 700) throw new Error('VIDEO_STUDIO_IMAGE: note revisione troppo lunghe');
  return notes.replace(/\s+/g, ' ');
}

// The existing authenticated /api route exposes revision_notes already. This private
// prefix is consumed server-side and stripped before the prompt, without adding an API.
export const POSTER_NOTE_PREFIX = '[OL_VIDEO_STUDIO_POSTER_V1]';
export function parseImageRevisionNotes(value) {
  if(typeof value!=='string' && value!=null)throw new Error('VIDEO_STUDIO_IMAGE: note revisione non valide');
  const raw=String(value||'');
  if(raw.length>700)throw new Error('VIDEO_STUDIO_IMAGE: note revisione troppo lunghe');
  if(!raw.startsWith(POSTER_NOTE_PREFIX))return {mode:'photo',notes:cleanRevisionNotes(raw)};
  const remainder=raw.slice(POSTER_NOTE_PREFIX.length);
  if(remainder && !remainder.startsWith('\n'))throw new Error('VIDEO_STUDIO_IMAGE: modalita grafica non valida');
  return {mode:'poster',notes:cleanRevisionNotes(remainder)};
}
// Signed scene references stay verified in web-lab. If the story has a recurring
// protagonist, crop the previous scene to an identity-only portrait before image
// editing. A full-frame reference caused the room and camera to repeat. Scenes
// without a recurring person remain independent text-to-image generations.
// The visible camera subject wins over character continuity. Supplying a prior
// portrait as an edit reference for an overhead/hands-only shot led the image
// model to redraw the portrait instead of respecting the storyboard camera.
export function sceneCameraKind(scene) {
  const shot=String(scene?.shot_type||'').toLowerCase();
  const subject=String(scene?.subject_description||'').toLowerCase();
  if(/zenital|dall[’'`]alto|overhead|top[- ]down|flat[- ]lay/.test(shot))return 'overhead';
  const handOrObject=/(?:mani|mano|avambracc|hands?|forearms?|oggett|objects?|document|bollett|carta|paper)/.test(subject+' '+shot);
  const explicitFace=/(?:volto|viso|faccia|ritratto|profilo|capell|testa|spalle|occhi|face|portrait|hair|head|shoulder|eyes)/.test(subject);
  if(handOrObject&&!explicitFace&&/(?:dettaglio|macro|close[- ]?up|ravvicinat)/.test(shot))return 'detail';
  return 'general';
}
export function modelImageReferences(story,referenceImages=[],scene=null,index=null) {
  const guide=['guide_image','guide_video'].includes(story?.input_type);
  if(guide && story?.guide_fidelity==='strong')return referenceImages;
  // A reference crop with a face biases an object-only shot toward a portrait.
  // For other scenes retain the existing continuity behavior unchanged.
  if(scene && sceneCameraKind(scene)!=='general')return [];
  return String(story?.protagonist_profile||'').trim() && referenceImages.length
    ? [referenceImages[referenceImages.length-1]] : [];
}
export async function identityOnlyReference(bytes,previousSide,sharp) {
  const info=await sharp(bytes).metadata();
  if(!info.width||!info.height)throw new Error('VIDEO_STUDIO_IMAGE: riferimento identita non leggibile');
  const width=Math.max(1,Math.min(info.width,Math.round(info.width*.69)));
  const height=Math.max(1,Math.min(info.height,Math.round(info.height*.64)));
  const left=previousSide==='left'?0:previousSide==='right'?info.width-width:Math.round((info.width-width)/2);
  const top=Math.min(info.height-height,Math.round(info.height*.10));
  return sharp(bytes).extract({left,top,width,height}).resize(220,280,{fit:'cover'}).jpeg({quality:76}).toBuffer();
}
// Translate signed storyboard descriptions into photographic facts, not into
// renderer instructions. Splitting into clauses protects the scene geometry
// while excluding requests for headline positions, logos, overlays and UI.
const RENDER_ONLY = /(?:\b(?:headline|headlines|titolo|titoli|sottotitolo|sottotitoli|supporto|copy|caption|cta|logo|loghi|dominio|domain|font|tipografia|tipografico|lettering|scritte|scritta|testi|testo|overlay|renderer|canvas|pannello grafico|interfaccia)\b|\bx\s*\d{2,4}\s*[-–]\s*\d|\by\s*\d{2,4}\s*[-–]\s*\d)/i;
function photographicFacts(value,limit) {
  const clauses=String(value||'').replace(/\s+/g,' ').trim().split(/(?<=[.!?])\s+|;\s+/);
  const filtered=clauses.map(part=>part
    // Keep the physical action in mixed clauses (e.g. "... , leaving space for title").
    .replace(/(?:,\s*|\s+e\s+)(?:lasciando|riservando|riservare|proteggendo|evitando|senza coprire|con spazio per)[^.!?]*\b(?:headline|titolo|titoli|testi|testo|logo|cta|interfaccia)\b[^.!?]*/i,'')
    .replace(/[.!?]+$/,'').trim()).filter(part=>part&&!RENDER_ONLY.test(part));
  return filtered.join('. ').slice(0,limit);
}
function recurringPropRule(story,scene,index) {
  if(index<1||!Array.isArray(story?.scenes)||!story.scenes[0]?.key_object)return '';
  const first=story.scenes[0];
  const keyWords=String(first.key_object).toLocaleLowerCase('it').match(/[a-zà-ÿ]{4,}/g)||[];
  const skip=new Set(['questa','questo','quella','quello','della','delle','degli','color','colore','grande','piccola','piccolo','stesso','stessa','sulla','sullo','nelle','negli','dalla','dalle','primo','prima','scena','circa','anche','visivo','oggetto','oggetti','fatto','fatti','due']);
  const key=keyWords.find(word=>!skip.has(word));
  const current=String([scene?.visual_brief,scene?.key_object,scene?.continuity_link].filter(Boolean).join(' ')).toLocaleLowerCase('it');
  if(!key||!new RegExp(`(?:^|[^a-zà-ÿ])${key}(?:$|[^a-zà-ÿ])`,'i').test(current))return '';
  const firstFacts=photographicFacts(first.visual_brief,780);
  const firstClause=firstFacts.split('. ').find(part=>part.toLocaleLowerCase('it').includes(key))||'';
  const start=firstClause.toLocaleLowerCase('it').indexOf(key);
  // Keep only the object's physical description, never its first-scene position.
  const physical=(start>=0?firstClause.slice(start):'').split(/[:;]|\s(?:siede|occupa|viene|sta|giace|compare|domina|tiene|sposta|guarda|tocca|si trova|è posizionata)\b/i)[0].trim();
  const keyObject=String(first.key_object).trim().replace(/[.!?]+$/,'').slice(0,150);
  return `RECURRING PROP — physical identity only: ${keyObject}${physical?`; initial physical specification: ${physical.slice(0,170)}`:''}. Preserve its material, color, silhouette and REAL-WORLD SIZE/PROPORTIONS whenever it is visible. This scene's placement, action and camera OVERRIDE the first scene's staging. Only textual continuity is supplied; no separate prop photo is attached.`;
}
// Never forward visual_brief/camera_intent verbatim: their Canvas directions
// conflict with clean-photo mode. Preserve the actual geometry and prop scale.
export function photoPrompt({article,scene,index,story=null,revisionNotes='',referenceImages=[],mode='photo'}) {
  if(!article?.title||!scene?.editorial_goal||!Number.isInteger(index)||index<0||index>4)
    throw new Error('VIDEO_STUDIO_IMAGE: brief incompleto');
  if(!['photo','poster'].includes(mode) || (mode==='poster' && (scene.role==='cta'||!String(scene.headline||'').trim())))
    throw new Error('VIDEO_STUDIO_IMAGE: modalita grafica non valida per questa scena');

  const poster=mode==='poster';
  const cap=(value,max)=>String(value||'').trim().slice(0,max);
  const notes=cleanRevisionNotes(revisionNotes);
  const art=scene.art_direction&&typeof scene.art_direction==='object'?scene.art_direction:{};
  const hasProtagonist=Boolean(cap(story?.protagonist_profile||scene.protagonist_profile,360));
  const protagonist=cap(story?.protagonist_profile||scene.protagonist_profile,360);
  const side=['left','right','center'].includes(scene.subject_side)?scene.subject_side:'right';
  const opposite=side==='left'?'right':side==='right'?'left':'an open area beside the subject';
  const strongGuide=['guide_image','guide_video'].includes(story?.input_type)&&story.guide_fidelity==='strong';
  const cameraKind=sceneCameraKind(scene);
  const visibleReferences=modelImageReferences(story,referenceImages,scene,index);
  const previous=Array.isArray(story?.scenes)?story.scenes[index-1]:null;
  const next=Array.isArray(story?.scenes)?story.scenes[index+1]:null;
  const references=strongGuide
    ? `Reference image 1 supplies VISUAL STYLE ONLY: lighting, tonal range, lens feel, textures and palette; invent new people, framing, action and words. ${visibleReferences.length>1?'Reference image 2 supplies recurring-character continuity.':''}`
    : visibleReferences.length
      ? 'The attached crop supplies ONLY the recurring adult’s visual identity, not its pose, setting, lighting or composition.'
      : 'No image reference is attached. Invent an original scene without imitating a previous advertisement.';
  const light=cap(art.photo_lighting,220)||'Bright, believable, motivated light with natural skin tones, rich but clear midtones and readable facial expressions.';
  // A video guide is analyzed for photography in creative-director, but its frames
  // are intentionally not passed as image edits in inspiration mode. Transfer the
  // observed photographic craft as TEXT without copying subjects or layouts.
  const observed=story?.guide_quality_profile?.visual;
  const guideLook=observed&&typeof observed==='object'
    ? [cap(observed.lighting,230),cap(observed.palette,180),...(cameraKind==='general'?[cap(observed.camera,220)]:[])]
      .filter(Boolean).join(' | ') : '';
  const common=[
    'CREATE EXACTLY ONE ORIGINAL VERTICAL 9:16 FRAME FOR AN ITALIAN MOBILE AD.',
    `OUTPUT TYPE: ${poster?'FINISHED ADVERTISING POSTER WITH THE SPECIFIED TEXT DRAWN INSIDE THE IMAGE':'CLEAN PHOTOGRAPH ONLY; ALL TEXT IS ADDED LATER BY THE COMPOSITOR'}.`,
    'Not a storyboard, collage, contact sheet, split-screen or sequence. Depict one continuous instant only.',
    `TOPIC: ${cap(article.title,180)}.`,
    `STORY DIRECTION: ${cap(story?.story_logline,280)||'Show a credible, concrete situation and meaningful development.'}`,
    `SCENE ${index+1} (${cap(scene.role,24)}): ${cap(scene.editorial_goal,200)}.`,
    `VISIBLE ACTION: ${cap(scene.narrative_action||scene.editorial_goal,220)}.`,
    `SUBJECT: ${cap(scene.subject_description,270)||'An authentic subject directly relevant to this scene'}.`,
    `EMOTION: ${cap(scene.emotion,120)||'Natural and legible, never exaggerated'}.`,
    `PLACE: ${cap(scene.setting,180)||'A credible real-world setting'}; CAMERA: ${cap(scene.shot_type,120)||'An intentional, readable shot'}.`,
    `IMPORTANT OBJECT: ${cap(scene.key_object,160)||'None required'}.`,
    ...(photographicFacts(scene.visual_brief,850)?[`SCENOGRAPHY — physical objects, scale, geometry and relations (NOT text layout): ${photographicFacts(scene.visual_brief,850)}`]:[]),
    ...(photographicFacts(art.camera_intent,260)?[`VISUAL CAMERA PURPOSE (NOT text layout): ${photographicFacts(art.camera_intent,260)}`]:[]),
    ...(recurringPropRule(story,scene,index)?[recurringPropRule(story,scene,index)]:[]),
    hasProtagonist?(cameraKind==='general'?`RECURRING PERSON: ${protagonist}. Keep their distinguishing features consistent across scenes.`:'BODY DETAIL ONLY: preserve the clothing and hands from SUBJECT; no face, head or torso is required in this shot.'):'A human face is optional; do not invent a person just to fill the frame.',
    previous?`PREVIOUS BEAT (do not recreate): ${cap(previous.narrative_action||previous.editorial_goal,140)}.`:'Opening beat of this story.',
    next?`NEXT BEAT (prepare without depicting it): ${cap(next.narrative_action||next.editorial_goal,120)}.`:'Final beat of this story.',
    `REFERENCE: ${references}`,
    `LIGHT AND COLOR: ${light}`,
    ...(guideLook?[`OBSERVED GUIDE PHOTOGRAPHIC CRAFT (descriptive notes, NOT an attached reference image): ${guideLook}. Transfer the lighting, tonal clarity and lens depth; invent a new scene, people and framing.`]:[]),
    cameraKind==='general'?'ADVERTISING FRAME: stage a single decisive moment, not a documentary snapshot of a routine. The headline and visual action must work together: an immediate emotional reaction, an unmistakable visual comparison or a meaningful gesture with consequence. Give the subject a striking but credible point of view, clean hierarchy, and intentional camera distance. If people appear, their expression must communicate the beat without fake posing; if objects dominate, the contrast must be visible without labels. Not every scene needs a portrait.':'ADVERTISING FRAME: the hands, objects and their visual relationship are the hero of this shot. Their shape, gesture or contrast must communicate the dramatic beat without a person posing to camera.',
    'PHOTO DIRECTION: refined bright commercial photography when appropriate to the story, lively but believable skin tones, clean midtones, tactile textures and layered depth. Avoid gloomy underexposure, stock poses, fake smiles, sterile showrooms, overprocessed saturation and artificial orange grading. Preserve a plausible setting and motivated light rather than forcing generic sunshine.',
    'TRUTHFULNESS AND PIXEL TEXT: never fabricate readable device screens, bills, receipts, charts, tariffs, brand interfaces or quantified outcomes. If the described prop refers to printed words or numbers, show the object without readable markings and express its meaning through the action and separate headline. Do not borrow frames, logos, people or distinctive compositions from other ads.'
  ];
  const textContract=poster ? [
    'TEXT CONTRACT — POSTER MODE: the following words MUST be visibly rendered INSIDE THIS FRAME. No separate overlay will supply them.',
    `HEADLINE (exact Italian spelling, punctuation and accents; the largest element): ${JSON.stringify(cap(scene.headline,180))}.`,
    cap(scene.secondary_text,180)?`SUPPORT (exact and subordinate but still legible): ${JSON.stringify(cap(scene.secondary_text,180))}.`:'No supporting line: only the headline.',
    cameraKind==='overhead'?'CAMERA PRIORITY — OVERHEAD: 90-degree top-down view of objects and hands only, with no visible face or torso.' : cameraKind==='detail'?'CAMERA PRIORITY — DETAIL: tight angled view of objects and hands only, no face or torso.' : `CAMERA PRIORITY — SUBJECT: obey ${cap(scene.shot_type,120)} with the visible person/object to the ${side}.`,
    `DESIGN: Integrate decisive display lettering and the photography as ONE mobile-first composition. Keep the subject/action around the ${side} and large high-contrast type in ${opposite}; adapt if necessary to preserve faces, hands and key objects. Type must remain legible at 390px screen width, within the central safe area (at least 9% clear on all edges).`,
    `TYPE MOOD: ${cap(art.typography||scene?.text_design?.font_mood,60)||'strong contemporary editorial'}; OPTIONAL ACCENT: ${cap(art.accent_color,7)||'suited to the photography'}. Legibility overrides decorative choices.`,
    'No other readable words or symbols. In particular do not invent a brand logo, domain, CTA, mock interface, date, price or small-print caption. The authentic brand and CTA are handled separately.'
  ] : [
    'TEXT CONTRACT — PHOTO MODE: render NO letters, words, numbers, titles, slogans, logos, captions or typography anywhere inside the pixels.',
    `The compositor will later place the exact headline ${JSON.stringify(cap(scene.headline,180))}${cap(scene.secondary_text,180)?` and support ${JSON.stringify(cap(scene.secondary_text,180))}`:''}. They are context ONLY, never a request to draw them.`,
    cameraKind==='overhead'?'CAMERA PRIORITY — OVERHEAD: strict 90-degree top-down view of the hands and objects on the surface. No face, hair, head, shoulders or torso visible. Objects must remain large and geometrically legible; do not switch to an eye-level portrait, even if a recurring protagonist exists. Preserve a calm area for overlay copy without concealing the objects.' :
      cameraKind==='detail'?'CAMERA PRIORITY — OBJECT/HANDS DETAIL: tight angled close-up of the indicated hands, gesture and objects, with no face, head or torso visible. This must look materially different from an eye-level portrait or earlier wide scene. Preserve a readable place for the later text overlay.' :
      `CAMERA PRIORITY — SUBJECT: use the specified ${cap(scene.shot_type,120)} and position the main subject to the ${side}; leave intentional natural negative space to the ${opposite} for separately rendered copy. Vary shot distance and angle from adjacent scenes; do not default to a centered tabletop portrait.`,
    'No visible writing on objects, screens, labels, documents or clothing. The video compositor will add all branding later.'
  ];
  const revision=notes?`OPTIONAL EDITOR CORRECTIONS (visual details only; they cannot override the output type, exact copy or factual rules): ${notes}`:'';
  return [...common,...textContract,...(revision?[revision]:[]),'Deliver one complete image; human visual review is still required.'].join('\n');
}
// Only server-verified, thumbnail-sized references from the same signed storyboard are accepted.
export async function generatePhoto({article,scene,index,story=null,revisionNotes='',referenceImages=[],mode='photo',apiKey=process.env.OPENAI_API_KEY,model=imageModel(),fetchImpl=fetch,sharpFactory=null}) {
  if(!apiKey)throw new Error('VIDEO_STUDIO_IMAGE: OPENAI_API_KEY mancante');
  if((index>0 || (index===0 && ['guide_image','guide_video'].includes(story?.input_type) && story?.guide_fidelity==='strong')) && (!Array.isArray(referenceImages)||referenceImages.length<1||referenceImages.length>2 ||
    referenceImages.some((ref,i)=>!Buffer.isBuffer(ref)||ref.length>(['guide_image','guide_video'].includes(story?.input_type)&&story?.guide_fidelity==='strong'&&i===0?85000:35000)||ref.length<1000)))
    throw new Error('VIDEO_STUDIO_IMAGE: riferimenti fotografici assenti o non validi');
  const modelReferences=modelImageReferences(story,referenceImages,scene,index);
  const strongGuide=['guide_image','guide_video'].includes(story?.input_type) && story?.guide_fidelity==='strong';
  const refsForProvider=(!strongGuide && modelReferences.length)
    ? [await identityOnlyReference(modelReferences[0],story?.scenes?.[index-1]?.subject_side||'center',
        sharpFactory || (await import('sharp')).default)] : modelReferences;
  const prompt = photoPrompt({article,scene,index,story,revisionNotes,referenceImages:modelReferences,mode});
  let response;
  if(refsForProvider.length===0) {
    response=await fetchImpl('https://api.openai.com/v1/images/generations',{
      method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({model,prompt,size:'1088x1920',quality:'high',output_format:'png',n:1}),
      signal:AbortSignal.timeout(180000)
    });
  } else {
    // Native Node FormData/Blob. Never send previous full-sized originals over the browser API.
    const form = new FormData();
    form.append('model',model);
    form.append('prompt',prompt);
    form.append('size','1088x1920');
    form.append('quality','high');
    form.append('output_format','png');
    form.append('n','1');
    for(const [i,bytes] of refsForProvider.entries()) {
      form.append('image[]',new Blob([bytes],{type:'image/jpeg'}),`scene-reference-${i+1}.jpg`);
    }
    response=await fetchImpl('https://api.openai.com/v1/images/edits',{
      method:'POST',headers:{Authorization:`Bearer ${apiKey}`},body:form,
      signal:AbortSignal.timeout(180000)
    });
  }
  const json=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(`VIDEO_STUDIO_IMAGE: HTTP ${response.status}: ${String(json?.error?.message||'').slice(0,300)}`);
  if(!json?.data?.[0]?.b64_json)throw new Error('VIDEO_STUDIO_IMAGE: risposta senza immagine');
  const original=Buffer.from(json.data[0].b64_json,'base64');
  if(original.length>40*1024*1024||original.length<1000)throw new Error('VIDEO_STUDIO_IMAGE: payload non valido');
  const sharp=sharpFactory || (await import('sharp')).default;
  const normalized=await sharp(original).rotate().resize(1080,1920,{fit:'cover',position:'centre'}).png().toBuffer();
  return {bytes:normalized,sha256:SHA(normalized),provider:model,prompt_fingerprint:SHA(prompt)};
}
