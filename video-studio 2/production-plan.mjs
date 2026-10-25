// Structured drafts never assert that unreviewed photographs, copy, music or licence are approved.
import {proposeStoryboard} from './storyboard.mjs';
import {proposeMusicTimeline} from './audio-direction.mjs';
export const VIDEO_ROLES=['hook','context','value','cta'];
const trimWords=(text,max)=>String(text||'').trim().split(/\s+/u).slice(0,max).join(' ');
export function makeProductionDraft(article,{platform='instagram_reel',mood='informativo',analysis}={}) {
  const board=proposeStoryboard(article,{platform,mood});
  const music=analysis?proposeMusicTimeline(analysis,4):{scene_duration_ms:[3000,4000,4000,4000],change_cues_ms:[3000,7000,11000],approved:false};
  const scenes=VIDEO_ROLES.map((role,index)=>({
    id:`scene_${index+1}`,role,
    headline: index===0 ? trimWords(board.article.title,5) : index===1 ? 'Perché conta' : index===2 ? 'Cosa sapere' : 'Leggi la guida',
    secondary_text: index===0 ? '' : index===1 ? 'La situazione in breve' : index===2 ? '' : 'Su OffertaLogica.it',
    visual_brief: board.scenes[index].visual_brief,
    editorial_goal: board.scenes[index].editorial_goal,
    image_path:null, image_sha256:null,reviewed:false,protected_regions:[],
    duration_ms:music.scene_duration_ms[index]
  }));
  return {storyboard:board,scenes,music_timeline:music,needs_human_review:true};
}
export function approveRenderInput(project) {
  const scenes=project?.assets?.scenes;
  if(!Array.isArray(scenes)||scenes.length!==4)throw new Error('VIDEO_STUDIO_PLAN: quattro scene obbligatorie');
  if(!scenes.every(s=>s.reviewed===true&&Array.isArray(s.protected_regions)&&typeof s.headline==='string'&&s.headline.trim().split(/\s+/u).length<=9&&s.headline.trim()))
    throw new Error('VIDEO_STUDIO_PLAN: revisione fotografica e testi delle scene incompleta');
  if(project.assets.music_reviewed!==true||!project.assets.audition_reviewer)
    throw new Error('VIDEO_STUDIO_PLAN: ascolto e approvazione musica mancanti');
  if(!project.assets.claim_reviewed||!project.assets.claim_reviewer)
    throw new Error('VIDEO_STUDIO_PLAN: conferma editoriale dell’affermazione mancante');
  if(!project.storyboard?.selected_excerpt||!project.snapshot?.content?.includes(project.storyboard.selected_excerpt))
    throw new Error('VIDEO_STUDIO_PLAN: claim non ancorato all’articolo');
  return scenes;
}
