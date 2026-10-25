// Video Studio-owned image provider; does not invoke or change editorial automations.
import {createHash} from 'node:crypto';
const SHA = v=>createHash('sha256').update(v).digest('hex');
export function photoPrompt({article,scene,index}) {
  if(!article?.title||!scene?.editorial_goal||!Number.isInteger(index)||index<0||index>3)
    throw new Error('VIDEO_STUDIO_IMAGE: brief incompleto');
  const side=['left','right','center'].includes(scene.subject_side)?scene.subject_side:'right';
  const opposite=side==='left'?'right':side==='right'?'left':'upper';
  const visual=String(scene.visual_brief||'').slice(0,500);
  const person=String(scene.subject_description||'').slice(0,350);
  const emotion=String(scene.emotion||'').slice(0,160);
  return `Generate ONE original photorealistic vertical 9:16 editorial photograph for an Italian Reel.
  Topic: ${article.title.slice(0,180)}.
  Story scene ${index+1}, purpose: ${scene.editorial_goal.slice(0,220)}.
  Visual scene: ${visual}.
  Main subject: ${person||'a natural realistic situation relevant to the message'}.
  Intended emotion: ${emotion||'credible and subtle'}.
  People and clearly visible human faces are welcome when emotionally useful. No exaggerated or stereotyped reactions.
  Place the principal subject on the ${side} side, with head, eyes, hands and important objects fully unobstructed.
  Reserve generous NATURAL NEGATIVE SPACE toward the ${opposite} side and/or above for separate, large legible typography and authentic branding.
  Consistent documentary lighting, convincing photographic details, creative and varied settings, no imitation of existing advertising photographs.
  IMPORTANT: Output ONE standalone clean photo only. NO collage, storyboard, grid, multiple panels, timestamps, UI, speech bubbles, titles, captions, letters, printed legible text, numbers, logos, watermarks, fake receipts, bills with readable values, charts or fictitious screens.
  Do not render the slogan, logo or any text inside the picture. All typography and branding will be added by the compositor later.
  Proposed unreviewed visual asset only.`;
}
export async function generatePhoto({article,scene,index,apiKey=process.env.OPENAI_API_KEY,model=process.env.VIDEO_STUDIO_IMAGE_MODEL||'gpt-image-2',fetchImpl=fetch}) {
  if(!apiKey)throw new Error('VIDEO_STUDIO_IMAGE: OPENAI_API_KEY mancante');
  const response=await fetchImpl('https://api.openai.com/v1/images/generations',{
    method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({model,prompt:photoPrompt({article,scene,index}),size:'1024x1536',quality:'high',output_format:'png',n:1}),
    signal:AbortSignal.timeout(180000)
  });
  const json=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(`VIDEO_STUDIO_IMAGE: HTTP ${response.status}: ${String(json?.error?.message||'').slice(0,300)}`);
  if(!json?.data?.[0]?.b64_json)throw new Error('VIDEO_STUDIO_IMAGE: risposta senza immagine');
  const original=Buffer.from(json.data[0].b64_json,'base64');
  if(original.length>40*1024*1024||original.length<1000)throw new Error('VIDEO_STUDIO_IMAGE: payload non valido');
  // Sharp is an existing project dependency; used only by the dedicated worker.
  const {default:sharp}=await import('sharp');
  const normalized=await sharp(original).rotate().resize(1080,1920,{fit:'cover',position:'centre'}).png().toBuffer();
  return {bytes:normalized,sha256:SHA(normalized),provider:model,prompt_fingerprint:SHA(photoPrompt({article,scene,index}))};
}
