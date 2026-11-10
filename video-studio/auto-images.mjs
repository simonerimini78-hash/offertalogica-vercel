// Video Studio v1.3.3.17 image composition; independent of editorial automations.
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
export function photoPrompt({article,scene,index,story=null,revisionNotes='',referenceImages=[],mode='photo'}) {
  if(!article?.title||!scene?.editorial_goal||!Number.isInteger(index)||index<0||index>4)
    throw new Error('VIDEO_STUDIO_IMAGE: brief incompleto');
  if(!['photo','poster'].includes(mode) || (mode==='poster' && (scene.role==='cta'||!String(scene.headline||'').trim())))
    throw new Error('VIDEO_STUDIO_IMAGE: modalita grafica non valida per questa scena');
  const poster=mode==='poster';
  const side=['left','right','center'].includes(scene.subject_side)?scene.subject_side:'right';
  const opposite=side==='left'?'right':side==='right'?'left':'right or left';
  const visual=String(scene.visual_brief||'').slice(0,500);
  const person=String(scene.subject_description||'').slice(0,350);
  const emotion=String(scene.emotion||'').slice(0,160);
  const notes = cleanRevisionNotes(revisionNotes);
  const strongGuide=['guide_image','guide_video'].includes(story?.input_type) && story?.guide_fidelity==='strong';
  const referenceGuide = strongGuide ? `STRONG VISUAL ANCHOR: Input image 1 is ${story?.input_type==='guide_video'?'an editor-supplied early frame sampled from the Reel guide':'the editor-supplied ORIGINAL guide photograph'}. Treat it as the photographic style anchor for this scene. Preserve its natural color temperature, light softness and direction, tonal palette, texture, material realism, lens character and overall atmosphere. ${referenceImages.length>1?'Input image 2 is the immediately previous scene for continuity of a recurring person or setting.':'Generate a distinct story beat while retaining the reference style.'} Invent a NEW framing, gesture and event, not a near-duplicate. Do not copy any existing text or fabricated brand UI.` : referenceImages.length>0 ? `VISUAL INSPIRATION: use the supplied authentic photo reference(s) for plausible continuity, without copying the same composition, setting, pose, facial expression or action. Allow scene-specific lighting and styling. This is a NEW story moment.` : 'Opening shot: establish the scene-specific subject or context. A human protagonist is NOT required unless the story explicitly calls for one.';
  const art=scene?.art_direction&&typeof scene.art_direction==='object'?scene.art_direction:null;
  const referenceCraft=story?.guide_quality_profile?.visual;
  const lighting = art?.photo_lighting ? `Follow the art director: ${String(art.photo_lighting).slice(0,220)}. Keep physics and skin tones plausible; never force a generic golden-hour look.` : strongGuide ? 'Match the reference image lighting character and realistic warm/cool balance; do not change to a generic golden-hour or cooler studio look unless the story truly requires it.' : scene.role === 'cta'
    ? 'For the concluding/CTA beat, prefer a subtle warmer late-afternoon or golden-hour quality ONLY if consistent with the story location and elapsed time; keep skin tones natural, never oversaturate or invent a sunset.'
    : index === 0
      ? 'Start with credible natural daylight or gently neutral window light appropriate to the problem; avoid artificial orange tint or exaggerated drama.'
      : 'Use believable natural or ambient light with moderate variation; keep continuity with the previous scene and let the story become gradually more reassuring when appropriate.';
  const protagonist = String(story?.protagonist_profile || scene.protagonist_profile || '').slice(0,360);
  const episodeAngle = String(story?.episode_angle || '').slice(0,220);
  const logline = String(story?.story_logline || '').slice(0,380);
  const outcome = String(story?.story_outcome || '').slice(0,350);
  const sequence = Array.isArray(story?.scenes) && story.scenes.length>=3 && story.scenes.length<=5
    ? story.scenes.map((beat,i)=>`${i+1}: ${String(beat.narrative_action||beat.editorial_goal||'').slice(0,220)}; ${String(beat.shot_type||'').slice(0,120)}`).join(' | ')
    : '';
  return `Generate ONE original photorealistic vertical 9:16 ${poster?'FINISHED ADVERTISING CREATIVE WITH TYPOGRAPHY EMBEDDED IN THE IMAGE':'editorial photograph'} for an Italian Reel.
  Topic: ${article.title.slice(0,180)}.
  Single-story narrative: ${logline || 'A concrete problem evolves into a credible, proportionate solution'}.
  Episode angle: ${episodeAngle || 'Follow the proposed episode angle'}.
  Realistic final outcome: ${outcome || 'An actionable insight, not a guaranteed result'}.
  Other scenes and their camera shots (for DISTINCT framing, not copying): ${sequence || 'Preserve a clear progression from problem to solution'}.
  Story scene ${index+1}, purpose: ${scene.editorial_goal.slice(0,220)}.
  Visible action THIS scene: ${String(scene.narrative_action||scene.editorial_goal).slice(0,220)}.
  Reason it follows the previous scene: ${String(scene.continuity_link||'Opening the story').slice(0,240)}.
  Setting: ${String(scene.setting||'suitable editorial environment').slice(0,220)}; camera shot: ${String(scene.shot_type||'varied documentary framing').slice(0,120)}.
  Key visual object: ${String(scene.key_object||'none required').slice(0,120)}.
  Art director's camera/visual intent: ${String(art?.camera_intent||'').slice(0,220)}.
  Intentional light and color for THIS scene: ${String(art?.photo_lighting||'').slice(0,220)}.
  Reference's TRANSFERABLE craft only (never the plot or people): ${String(referenceCraft?.lighting||'').slice(0,250)}; ${String(referenceCraft?.camera||'').slice(0,250)}; ${String(referenceCraft?.palette||'').slice(0,250)}.
  Visual scene: ${visual}.
  Main subject: ${person||'a natural realistic situation relevant to the message'}.
  Stable recurring-protagonist description (if present): ${protagonist || 'No recurring human protagonist is required'}.
  ${referenceGuide}
  Keep the same protagonist recognizable when relevant, but DO NOT repeat a pose, action, location-and-shot combination or a near-identical composition across scenes.
  This ${poster?'finished advertising frame':'photograph'} must represent ONLY scene ${index+1} of the mini-story, not a collage or multi-panel storyboard.
  Intended emotion: ${emotion||'credible and subtle'}.
  People and clearly visible human faces are welcome when emotionally useful. No exaggerated or stereotyped reactions.
  Place the principal subject on the ${side} side, with head, eyes, hands and important objects fully unobstructed.
  ${poster ? `CREATIVE LAYOUT: Compose the image and integrated lettering TOGETHER. The headline is the primary advertising subject: give it substantial area in a clean field on the ${opposite} side, generally inside x=9%-91% and y=19%-72% (safe for mobile social overlays). Show the relatable person or real-life action on the ${side}, but NEVER reduce headline size just to keep an oversized portrait. Do not cover faces, eyes, hands or key objects with any text. Choose asymmetrical editorial poster layout, not a small caption in an available corner.` : `Reserve a CONTIGUOUS low-detail, reasonably uniform NATURAL NEGATIVE-SPACE COLUMN on the ${opposite} side covering roughly 50-60% of the usable central frame (approximately y=22%-65% of image height), not a tiny empty triangle or an area interrupted by arms, props, hair or eyes. Large 100-140px separate poster typography must fit there without hiding the action. Keep the human gesture/real-life situation easy to recognize from a phone thumbnail: frame the person and one meaningful action, not a giant empty wall and a tiny subject. For visually stronger storytelling, vary shot size and action meaningfully between scenes instead of repeating the same thoughtful person at the same desk. Do not draw the typography.`}
  Preserve the scene intent faithfully. When a recurring protagonist is specified, aim for believable visual consistency; exact identity cannot be guaranteed without a reference image.
  Cinematic lighting direction for this specific beat: ${lighting}
  ${strongGuide ? 'Match the guide image photographic character first, including natural light, tonal range and tactile material details; do not force an unrelated stock-photo aesthetic.' : 'Premium visual authorship: deliberate motivated lighting, selective contrast, dimensional layering, authentic surface textures and clear focal hierarchy. Follow THIS scene art direction, not a default domestic-window-light recipe.'} Select a subject and camera position that make the story understandable even on a small mobile screen; avoid stock-like desk arrangements, artificial orange filters or empty cinematic spectacle.
  Cinematic yet believable photography: expressive natural lighting, visual depth and a clear subject, with varied camera shots. Every important prop and action must directly support the specific topic; never prioritize cinematic spectacle over factual relevance. No imitation of existing advertising photographs.
  Generate a NEW original scene from the story, using only authenticated frames from THIS Reel for continuity when supplied. NEVER reuse, copy, trace or imitate images from the editorial article, social post, or a prior Reel.
  Visual similarity to previously generated images is NOT verified by this prompt: this candidate still needs an independent image/history similarity gate and human review.
  CRITICAL PRODUCT AUTHENTICITY: Never depict a front-facing phone, tablet or computer screen with any visible contents, symbols, dashboards, offers, graphs or imaginary brand UI.
  If the scene involves someone using a device, show the BACK of the display, an oblique angle that does not reveal the screen, or the device outside the frame.
  If a real OffertaLogica interface is needed, the editor will place an editor-supplied, genuine screenshot as a SEPARATE layer in the video compositor; do not approximate it or create plausible substitute pixels.
  ${poster ? `MANDATORY TYPOGRAPHY INSIDE THE GENERATED IMAGE. Create ONE complete premium mobile-first advertising frame, not a plain photograph. Render the following Italian words with EXACT spelling, punctuation, capitalization and accents. Do not paraphrase, add or omit words:
  HEADLINE (LARGEST, extremely bold, high-contrast, generous lettering, preferably only 2-3 readable lines): ${JSON.stringify(String(scene.headline||'').trim())}
  ${String(scene.secondary_text||'').trim()?`SUPPORT (visible and secondary but never tiny or pale): ${JSON.stringify(String(scene.secondary_text).trim())}`:'NO supporting words: keep only the headline.'}
  Use decisive modern poster-scale typography, clear separation of headline and support, and excellent contrast against actual pixels. Follow the art director's mood ${String(art?.typography||scene?.text_design?.font_mood||'bold editorial').slice(0,80)} and subtle accent ${String(art?.accent_color||'#39704b').slice(0,7)} when suitable, but readability wins. No type hidden behind a person. Make the headline readable immediately when the image is reduced to a 390px-wide smartphone screen. Leave TOP and BOTTOM social interface safety margins; never place words in the outermost 9% of the vertical frame. Never copy text from previous-scene reference images; they are photographic continuity references ONLY. Do NOT generate OffertaLogica branding, logo, domain, CTA, additional writing, watermarks, speech bubbles, fake receipts, legible document contents, charts or invented interface elements. Output one fully designed ad image.` : `IMPORTANT: Output ONE standalone clean photo only. NO collage, storyboard, grid, multiple panels, timestamps, UI, speech bubbles, titles, captions, letters, printed legible text, numbers, logos, watermarks, fake receipts, bills with readable values, charts or fictitious screens. Do not render the slogan, logo or any text inside the picture. All typography and branding will be added by the compositor later.`}
  ${notes ? `Human revision guidance: ${notes}. Respect these requested corrections while keeping the scene editorially coherent.` : 'No additional human revision guidance for this attempt.'}
  Proposed unreviewed visual asset only.`;
}
// Only server-verified, thumbnail-sized references from the same signed storyboard are accepted.
export async function generatePhoto({article,scene,index,story=null,revisionNotes='',referenceImages=[],mode='photo',apiKey=process.env.OPENAI_API_KEY,model=imageModel(),fetchImpl=fetch,sharpFactory=null}) {
  if(!apiKey)throw new Error('VIDEO_STUDIO_IMAGE: OPENAI_API_KEY mancante');
  if((index>0 || (index===0 && ['guide_image','guide_video'].includes(story?.input_type) && story?.guide_fidelity==='strong')) && (!Array.isArray(referenceImages)||referenceImages.length<1||referenceImages.length>2 ||
    referenceImages.some((ref,i)=>!Buffer.isBuffer(ref)||ref.length>(['guide_image','guide_video'].includes(story?.input_type)&&story?.guide_fidelity==='strong'&&i===0?85000:35000)||ref.length<1000)))
    throw new Error('VIDEO_STUDIO_IMAGE: riferimenti fotografici assenti o non validi');
  const prompt = photoPrompt({article,scene,index,story,revisionNotes,referenceImages,mode});
  let response;
  if(index===0 && referenceImages.length===0) {
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
    for(const [i,bytes] of referenceImages.entries()) {
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
