// Independent 15s visual direction opt-in: gently move verified photography,
// then animate separately rasterised title, secondary text and authentic wordmark.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { composeCinematicLayers } from './premium-layout.mjs';
const exec = promisify(execFile);
function check(ok,why){if(!ok)throw new Error(`VIDEO_STUDIO_CINEMATIC: ${why}`);}
export async function renderCinematicScene({scene,photoFile,logoBytes,outputPrefix}) {
  const layers=await composeCinematicLayers({scene,photoFile,logoBytes,outputPrefix});
  const outputFile=`${outputPrefix}-clip.mp4`;
  const frames=Math.round(scene.duration_ms*30/1000);
  check(Number.isInteger(frames)&&frames>=60,'durata non corrisponde a frame interi');
  const protectedNearEdge=(scene.protected_regions||[]).some(r=>r.x<34||r.y<34||r.x+r.width>1046||r.y+r.height>1886);
  const movement=scene.presentation.motion||'auto';
  check(['auto','static','gentle_zoom'].includes(movement),'tipo movimento non supportato');
  const animate=movement==='gentle_zoom'||(movement==='auto'&&!protectedNearEdge);
  // A 2.2% centred zoom: never tracks an unverified face or pans into a protected area.
  check(!(movement==='gentle_zoom'&&protectedNearEdge),'soggetto troppo vicino al bordo per zoom');
  const args=['-hide_banner','-nostdin','-y','-loglevel','error'];
  const files=[layers.photoFile,layers.title,layers.secondary,layers.logo].filter(Boolean);
  for (const file of files) args.push('-loop','1','-framerate','30','-t',String(scene.duration_ms/1000),'-i',file);
  const zoom=animate?`zoompan=z='min(zoom+${(0.022/frames).toFixed(7)},1.022)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=1080x1920:fps=30`: 'scale=1080:1920';
  const filters=[`[0:v]${zoom},fps=30,format=yuv420p,setpts=PTS-STARTPTS[bg]`];
  let previous='bg', next=1;
  const composite=(label,at,dur,sourceIndex)=>{
    filters.push(`[${sourceIndex}:v]format=rgba,fade=t=in:st=${at}:d=${dur}:alpha=1,setpts=PTS-STARTPTS[${label}in]`);
    const target=`p${sourceIndex}`;
    filters.push(`[${previous}][${label}in]overlay=x=0:y=0:shortest=1:format=auto[${target}]`);
    previous=target;
  };
  composite('headline',0.08,0.24,next++);
  if(layers.secondary) composite('secondary',Math.min(0.5,scene.duration_ms/1000-1.3),0.25,next++);
  composite('brand',Math.min(0.65,scene.duration_ms/1000-1.2),0.23,next++);
  args.push('-filter_complex',filters.join(';'),'-map',`[${previous}]`,'-an','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-r','30','-frames:v',String(frames),'-movflags','+faststart',outputFile);
  await exec('ffmpeg',args,{maxBuffer:2*1024*1024,timeout:180000});
  return {outputFile,layout:layers.layout,frames,movement:animate?'gentle_zoom':'static',animation:{headline_start_ms:80,secondary_start_ms:layers.secondary?500:null,brand_start_ms:650}};
}
