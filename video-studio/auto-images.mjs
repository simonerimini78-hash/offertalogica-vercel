// Video Studio-owned image provider; does not invoke or change editorial automations.
import {createHash} from 'node:crypto';
const SHA = v=>createHash('sha256').update(v).digest('hex');

function cleanRevisionNotes(value) {
  const notes = String(value || '').trim();
  if (!notes) return '';
  if (notes.length > 700) throw new Error('VIDEO_STUDIO_IMAGE: note revisione troppo lunghe');
  return notes.replace(/\s+/g, ' ');
}

export function photoPrompt({article,scene,index,story=null,revisionNotes='',referenceImages=[]}) {
  if(!article?.title||!scene?.editorial_goal||!Number.isInteger(index)||index<0||index>3)
    throw new Error('VIDEO_STUDIO_IMAGE: brief incompleto');
  const side=['left','right','center'].includes(scene.subject_side)?scene.subject_side:'right';
  const opposite=side==='left'?'right':side==='right'?'left':'upper';
  const visual=String(scene.visual_brief||'').slice(0,500);
  const person=String(scene.subject_description||'').slice(0,350);
  const emotion=String(scene.emotion||'').slice(0,160);
  const notes = cleanRevisionNotes(revisionNotes);
  const strongGuide=story?.input_type==='guide_image' && story?.guide_fidelity==='strong';
  const referenceGuide = strongGuide ? `STRONG VISUAL ANCHOR: Input image 1 is the editor-supplied ORIGINAL guide for this Reel. Treat it as the primary photographic reference for every derived scene. Preserve its natural color temperature, light softness and direction, tonal palette, texture, material realism, lens character and overall atmosphere. ${referenceImages.length>1?'Input image 2 is the immediately previous scene for continuity of a recurring person or setting.':'Generate a distinct story beat while retaining the reference style.'} Invent a NEW framing, gesture and event, not a near-duplicate. No readable text or fabricated brand UI.` : referenceImages.length>0 ? `VISUAL INSPIRATION: use the supplied authentic photo reference(s) for plausible continuity, without copying the same composition, setting, pose, facial expression or action. Allow scene-specific lighting and styling. This is a NEW story moment.` : 'Opening shot: establish the protagonist and appearance that subsequent scenes will preserve.';
  const lighting = strongGuide ? 'Match the reference image lighting character and realistic warm/cool balance; do not change to a generic golden-hour or cooler studio look unless the story truly requires it.' : scene.role === 'cta'
    ? 'For the concluding/CTA beat, prefer a subtle warmer late-afternoon or golden-hour quality ONLY if consistent with the story location and elapsed time; keep skin tones natural, never oversaturate or invent a sunset.'
    : index === 0
      ? 'Start with credible natural daylight or gently neutral window light appropriate to the problem; avoid artificial orange tint or exaggerated drama.'
      : 'Use believable natural or ambient light with moderate variation; keep continuity with the previous scene and let the story become gradually more reassuring when appropriate.';
  const protagonist = String(story?.protagonist_profile || scene.protagonist_profile || '').slice(0,360);
  const episodeAngle = String(story?.episode_angle || '').slice(0,220);
  const logline = String(story?.story_logline || '').slice(0,380);
  const outcome = String(story?.story_outcome || '').slice(0,350);
  const sequence = Array.isArray(story?.scenes) && story.scenes.length===4
    ? story.scenes.map((beat,i)=>`${i+1}: ${String(beat.narrative_action||beat.editorial_goal||'').slice(0,220)}; ${String(beat.shot_type||'').slice(0,120)}`).join(' | ')
    : '';
  return `Generate ONE original photorealistic vertical 9:16 editorial photograph for an Italian Reel.
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
  Visual scene: ${visual}.
  Main subject: ${person||'a natural realistic situation relevant to the message'}.
  Stable recurring-protagonist description (if present): ${protagonist || 'No recurring human protagonist is required'}.
  ${referenceGuide}
  Keep the same protagonist recognizable when relevant, but DO NOT repeat a pose, action, location-and-shot combination or a near-identical composition across scenes.
  This photograph must represent ONLY scene ${index+1} of the mini-story, not four isolated ads or panels.
  Intended emotion: ${emotion||'credible and subtle'}.
  People and clearly visible human faces are welcome when emotionally useful. No exaggerated or stereotyped reactions.
  Place the principal subject on the ${side} side, with head, eyes, hands and important objects fully unobstructed.
  Reserve generous NATURAL NEGATIVE SPACE toward the ${opposite} side and/or above for separate, large legible typography and authentic branding.
  Preserve the scene intent faithfully. When a recurring protagonist is specified, aim for believable visual consistency; exact identity cannot be guaranteed without a reference image.
  Cinematic lighting direction for this specific beat: ${lighting}
  ${strongGuide ? 'Match the guide image photographic character first, including natural light, tonal range and tactile material details; do not force an unrelated stock-photo aesthetic.' : 'Premium editorial realism with tactile natural details, diffused window light in domestic scenes, lifelike skin texture and one meaningful focal action.'} Select a subject and camera position that make the story understandable even on a small mobile screen; avoid stock-like desk arrangements, artificial orange filters or cinematic spectacle.
  Cinematic yet believable photography: expressive natural lighting, visual depth and a clear subject, with varied camera shots. Every important prop and action must directly support the specific topic; never prioritize cinematic spectacle over factual relevance. No imitation of existing advertising photographs.
  Generate a NEW original scene from the story, using only authenticated frames from THIS Reel for continuity when supplied. NEVER reuse, copy, trace or imitate images from the editorial article, social post, or a prior Reel.
  Visual similarity to previously generated images is NOT verified by this prompt: this candidate still needs an independent image/history similarity gate and human review.
  CRITICAL PRODUCT AUTHENTICITY: Never depict a front-facing phone, tablet or computer screen with any visible contents, symbols, dashboards, offers, graphs or imaginary brand UI.
  If the scene involves someone using a device, show the BACK of the display, an oblique angle that does not reveal the screen, or the device outside the frame.
  If a real OffertaLogica interface is needed, the editor will place an editor-supplied, genuine screenshot as a SEPARATE layer in the video compositor; do not approximate it or create plausible substitute pixels.
  IMPORTANT: Output ONE standalone clean photo only. NO collage, storyboard, grid, multiple panels, timestamps, UI, speech bubbles, titles, captions, letters, printed legible text, numbers, logos, watermarks, fake receipts, bills with readable values, charts or fictitious screens.
  Do not render the slogan, logo or any text inside the picture. All typography and branding will be added by the compositor later.
  ${notes ? `Human revision guidance: ${notes}. Respect these requested corrections while keeping the scene editorially coherent.` : 'No additional human revision guidance for this attempt.'}
  Proposed unreviewed visual asset only.`;
}
// Only server-verified, thumbnail-sized references from the same signed storyboard are accepted.
export async function generatePhoto({article,scene,index,story=null,revisionNotes='',referenceImages=[],apiKey=process.env.OPENAI_API_KEY,model=process.env.VIDEO_STUDIO_IMAGE_MODEL||'gpt-image-2',fetchImpl=fetch,sharpFactory=null}) {
  if(!apiKey)throw new Error('VIDEO_STUDIO_IMAGE: OPENAI_API_KEY mancante');
  if((index>0 || (index===0 && story?.input_type==='guide_image' && (story?.guide_usage==='reference_only'||story?.guide_fidelity==='strong'))) && (!Array.isArray(referenceImages)||referenceImages.length<1||referenceImages.length>2 ||
    referenceImages.some((ref,i)=>!Buffer.isBuffer(ref)||ref.length>(story?.input_type==='guide_image'&&story?.guide_fidelity==='strong'&&i===0?85000:35000)||ref.length<1000)))
    throw new Error('VIDEO_STUDIO_IMAGE: riferimenti fotografici assenti o non validi');
  const prompt = photoPrompt({article,scene,index,story,revisionNotes,referenceImages});
  let response;
  if(index===0 && referenceImages.length===0) {
    response=await fetchImpl('https://api.openai.com/v1/images/generations',{
      method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({model,prompt,size:'1024x1536',quality:'high',output_format:'png',n:1}),
      signal:AbortSignal.timeout(180000)
    });
  } else {
    // Native Node FormData/Blob. Never send previous full-sized originals over the browser API.
    const form = new FormData();
    form.append('model',model);
    form.append('prompt',prompt);
    form.append('size','1024x1536');
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
