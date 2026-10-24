// Opt-in editorial raster compositor. Fails closed when text + full original logo
// cannot fit inside the conservative Reel safe area beside reviewed subjects.
import { createRequire } from 'node:module';
import { FRAME, OFFICIAL_LOGO_SHA256, sha256, intersects } from './core.mjs';
const require = createRequire(import.meta.url);
const sharp = require('sharp');

export const EDITORIAL_SAFE = Object.freeze({ x: 75, y: 270, width: 930, height: 980 });
const FONT = 'DejaVu Sans';
const INK = '#102b3d';
function check(value, why) { if (!value) throw new Error(`VIDEO_STUDIO_PREMIUM: ${why}`); }
function rect(b) { return b && ['x','y','width','height'].every(k => Number.isInteger(b[k])) && b.width > 0 && b.height > 0 && b.x >= 0 && b.y >= 0 && b.x + b.width <= FRAME.width && b.y + b.height <= FRAME.height; }
function within(b, area) { return rect(b) && b.x >= area.x && b.y >= area.y && b.x+b.width <= area.x+area.width && b.y+b.height <= area.y+area.height; }
function esc(s) { return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])); }
function rectDistance(a,b) { const dx = Math.max(a.x - b.x-b.width, b.x-a.x-a.width, 0); const dy = Math.max(a.y-b.y-b.height,b.y-a.y-a.height,0); return Math.hypot(dx,dy); }
async function measure(s,px,bold) {
  const m = await sharp({text:{text:s,font:`${FONT}${bold?' Bold':''} ${px}`,dpi:72}}).metadata();
  return m.width;
}
async function lines(text,px,width,bold,maxLines) {
  check(typeof text === 'string' && text.trim().length > 0, 'testo mancante');
  const out=[];let current='';
  for (const word of text.trim().split(/\s+/u)) {
    check(await measure(word,px,bold) <= width, `parola troppo larga: ${word}`);
    const candidate = current ? `${current} ${word}` : word;
    if (await measure(candidate,px,bold) <= width) current=candidate;
    else { out.push(current); current=word; }
  }
  if(current) out.push(current);
  return out.length <= maxLines ? out : null;
}
function svgText(list, x, top, size, gap, weight) {
  return list.map((s,i)=>`<text x="${x}" y="${top+size*0.95+i*gap}" fill="${INK}" font-family="${FONT}" font-weight="${weight}" font-size="${size}">${esc(s)}</text>`).join('');
}
export async function planPremiumLayout(scene) {
  const p=scene?.presentation;
  check(p?.mode === 'editorial_v1', 'modalità editoriale non dichiarata');
  check(['hook','context','value','action','cta'].includes(p.role), 'ruolo narrativo assente');
  check(p.subject_regions_reviewed === true, 'revisione manuale delle aree soggetto mancante');
  check(typeof p.headline === 'string' && p.headline.trim() && p.headline.length <= 110 && p.headline.trim().split(/\s+/u).length <= 9, 'headline troppo lunga');
  check(p.secondary_text === undefined || (typeof p.secondary_text === 'string' && p.secondary_text.trim() && p.secondary_text.length <= 90 && p.secondary_text.trim().split(/\s+/u).length <= 10), 'testo secondario troppo lungo');
  check(['auto','left','right'].includes(p.placement || 'auto'), 'posizione richiesta non valida');
  check(Array.isArray(scene.protected_regions) && scene.protected_regions.every(rect), 'aree protette non valide');
  // No font shrinking: rewrite copy, change crop, or choose another photograph.
  const titlePx = p.role === 'hook' ? 104 : 94;
  const secondPx = 56;
  const logoW = p.role === 'cta' ? 360 : (p.role === 'hook' ? 315 : 260);
  const logoH = Math.ceil(logoW * 353 / 640);
  const candidates=[];
  for (const x of [85, 185, 315, 405]) {
    for (const width of [490,520,570,670,780,900]) {
      if (x+width > EDITORIAL_SAFE.x+EDITORIAL_SAFE.width) continue;
      const side = x < 260 ? 'left' : 'right';
      if (p.placement !== 'auto' && p.placement !== side) continue;
      const t=await lines(p.headline,titlePx,width-36,true,3).catch(()=>null);
      if(!t) continue;
      const s=p.secondary_text ? await lines(p.secondary_text,secondPx,width-36,false,2).catch(()=>null) : [];
      if (!s) continue;
      const headHeight=t.length*titlePx*1.11;
      const secondaryHeight=s.length ? 28+s.length*secondPx*1.19 : 0;
      const groupHeight=Math.ceil(headHeight+secondaryHeight+30);
      for (const y of [278,315,390,480,575,675,770]) {
        const titleRect={x:x+18,y,width:width-36,height:Math.ceil(headHeight)};
        const subRect=s.length ? {x:x+18,y:y+Math.ceil(headHeight)+28,width:width-36,height:Math.ceil(secondaryHeight-28)} : null;
        const bounds={x,y,width,height:groupHeight};
        if(!within(bounds,EDITORIAL_SAFE)) continue;
        if(scene.protected_regions.some(r=>intersects(bounds,r))) continue;
        // Full original wordmark belongs to the text composition, but does not have
        // to sit directly underneath it when a person/important object is there.
        const options=[
          {x:x+18,y:y+groupHeight+18,width:logoW,height:logoH},
          {x:x+width-logoW-18,y:y+groupHeight+18,width:logoW,height:logoH},
          {x:EDITORIAL_SAFE.x+EDITORIAL_SAFE.width-logoW,y:y+groupHeight+18,width:logoW,height:logoH},
          {x:x+width+22,y:y+Math.floor(groupHeight/2)-Math.floor(logoH/2),width:logoW,height:logoH},
          {x:x-logoW-22,y:y+Math.floor(groupHeight/2)-Math.floor(logoH/2),width:logoW,height:logoH},
          {x:x+18,y:y-logoH-18,width:logoW,height:logoH},
          {x:x+width-logoW-18,y:y-logoH-18,width:logoW,height:logoH},
        ];
        for(const logoRect of options) {
          if(!within(logoRect,EDITORIAL_SAFE) || intersects(logoRect,bounds)) continue;
          if(scene.protected_regions.some(r=>intersects(logoRect,r) || rectDistance(logoRect,r)<36)) continue;
          const gap=rectDistance(bounds,logoRect);
          if(gap>155) continue;
          const dist = scene.protected_regions.length ? Math.min(...scene.protected_regions.map(r=>rectDistance(bounds,r))) : 160;
          const preferredDist=Math.abs(dist-55);
          const score=preferredDist*2 + gap*0.5 + Math.abs(x-145)*0.08 + Math.abs(y-390)*0.12 + (900-width)*0.04;
          candidates.push({x,y,width,height:groupHeight,titleRect,subRect,logoRect,titleLines:t,secondaryLines:s,titlePx,secondPx,logoW,logoH,score,subject_gap_px:Math.round(dist)});
        }
      }
    }
  }
  candidates.sort((a,b)=>a.score-b.score);
  check(candidates.length,`nessun layout compatibile: serve cambiare foto/crop o riscrivere la frase della scena ${scene.id}`);
  const selected=candidates[0];
  return {...selected, safe_region:EDITORIAL_SAFE, role:p.role};
}

export async function composePremiumFrame({photoFile,scene,logoBytes,outputFile}) {
  check(Buffer.isBuffer(logoBytes) && sha256(logoBytes) === OFFICIAL_LOGO_SHA256,'logo originale non verificato');
  const photo=await sharp(photoFile).metadata();
  check(['jpeg','png','webp'].includes(photo.format) && photo.width === FRAME.width && photo.height === FRAME.height && (!photo.orientation || photo.orientation===1),'foto non normalizzata a 1080x1920');
  const l=await planPremiumLayout(scene);
  const h0=l.titleLines.length*l.titlePx*1.11;
  const subtitleY=l.y+Math.ceil(h0)+28;
  const [px,py,pw,ph]=[l.x-24,l.y-18,l.width+48,l.height+36];
  // Continuous soft localized haze rather than an opaque sticker/panel.
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME.width}" height="${FRAME.height}"><defs>
    <linearGradient id="veil" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.96"/><stop offset="0.72" stop-color="#fff" stop-opacity="0.92"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="17"/></filter></defs>
    <rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="48" fill="url(#veil)" filter="url(#blur)"/>
    <rect x="${l.logoRect.x-18}" y="${l.logoRect.y-12}" width="${l.logoRect.width+36}" height="${l.logoRect.height+24}" rx="24" fill="#fff" fill-opacity="0.81" filter="url(#blur)"/>
    ${svgText(l.titleLines,l.x+18,l.y,l.titlePx,l.titlePx*1.11,'700')}
    ${svgText(l.secondaryLines,l.x+18,subtitleY,l.secondPx,l.secondPx*1.19,'500')}
    </svg>`;
  // Preserve the complete authentic wordmark: never substitute a retyped name.
  const logo=await sharp(logoBytes).resize({width:l.logoW}).png().toBuffer();
  await sharp(photoFile).composite([
    {input:Buffer.from(svg),left:0,top:0},
    {input:logo,left:l.logoRect.x,top:l.logoRect.y},
  ]).png().toFile(outputFile);
  return {outputFile,layout:l};
}
