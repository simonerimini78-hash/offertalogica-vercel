// Video Studio-owned image provider; does not invoke or change editorial automations.
import {createHash} from 'node:crypto';
const SHA = v=>createHash('sha256').update(v).digest('hex');
export function photoPrompt({article,scene,index}) {
  if(!article?.title||!scene?.editorial_goal||!Number.isInteger(index)||index<0||index>3)
    throw new Error('VIDEO_STUDIO_IMAGE: brief incompleto');
  return `Photorealistic editorial photography, vertical 9:16 composition for an Italian information Reel.
Topic: ${article.title.slice(0,180)}.
Narrative scene ${index+1}: ${scene.editorial_goal.slice(0,220)}.
Story context: ${String(scene.visual_brief||'').slice(0,320)}.
Authentic natural photography, balanced natural lighting, documentary detail, coherent real-world objects.
IMPORTANT: Do NOT draw any text, letters, typography, numbers, logos, watermarks, documents with legible content, brands, prices or fake screens.
No people or faces in this automatic first-pass composition. One strong central or lower-half object subject, clear continuous negative space above and to its side for 1080px editorial captions and original OffertaLogica branding.
Do not imitate existing photographs. No exaggerated reactions. No unsafe activities. No invented charts. Output is a proposed asset for human review, not automatically approved.`;
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
