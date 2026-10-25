// Review aid built from the encoded master, never from unrendered source scenes.
// UI shading is an approximate Reels-ad obstruction model, NOT platform approval.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
const exec=promisify(execFile);const require=createRequire(import.meta.url);const sharp=require('sharp');
export async function createMobileReview(masterFile,scenes,temp) {
  let offset=0;const width=270,height=480;
  const panels=[];
  for(let i=0;i<scenes.length;i++){
    const scene=scenes[i],seek=(offset+scene.duration_ms/2)/1000;
    offset+=scene.duration_ms;
    const file=join(temp,`mobile-${i}.png`);
    await exec('ffmpeg',['-nostdin','-y','-loglevel','error','-ss',seek.toFixed(3),'-i',masterFile,'-frames:v','1','-vf',`scale=${width}:${height}`,'-update','1',file],{maxBuffer:300000,timeout:35000});
    panels.push({id:scene.id,file,at_ms:Math.round(seek*1000)});
  }
  const n=panels.length;const svgLabel=i=>Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="75" height="24" x="6" y="7" rx="5" fill="#0b293a" opacity="0.85"/><text x="14" y="23" font-size="15" font-family="sans-serif" font-weight="bold" fill="#fff">SCENA ${i+1}</text></svg>`);
  const overview=sharp({create:{width:n*width,height:height*2,channels:4,background:'#ffffff'}});
  const overlays=[];
  for(let i=0;i<n;i++){
    const photo=await sharp(panels[i].file).ensureAlpha().png().toBuffer();
    overlays.push({input:photo,left:width*i,top:0},{input:svgLabel(i),left:width*i,top:0});
    overlays.push({input:photo,left:width*i,top:height});
    // Approximation of Reels ad UI: top 14%, bottom 35%, both sides 6%.
    const shade=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g fill="#dc3b3b" fill-opacity="0.28"><rect x="0" y="0" width="${width}" height="67"/><rect x="0" y="312" width="${width}" height="168"/><rect x="0" y="0" width="16" height="${height}"/><rect x="254" y="0" width="16" height="${height}"/></g><rect x="16" y="67" width="238" height="245" stroke="#ffffff" stroke-width="2" fill="none"/></svg>`);
    overlays.push({input:shade,left:width*i,top:height});
  }
  const output=join(temp,'mobile-review.jpg');
  await overview.composite(overlays).flatten({background:'#fff'}).jpeg({quality:86}).toFile(output);
  await writeFile(join(temp,'review-notes.json'),JSON.stringify({preview:'actual encoded master',top_row:'unobstructed',bottom_row:'approximate reels ad UI shading',panels},null,2));
  return {file:output,frames:panels.map(({id,at_ms})=>({id,at_ms})),ui_overlay:'ad_zone_approximation_not_verified_on_organic'};
}
