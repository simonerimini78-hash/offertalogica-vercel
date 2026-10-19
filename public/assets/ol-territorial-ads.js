(() => {
  'use strict';
  const form=document.getElementById('search'), input=document.getElementById('cap'), host=document.getElementById('partner-ad-space'), area=document.getElementById('partner-ad-content');
  if(!form||!input||!host||!area)return;
  let serial=0;
  form.addEventListener('submit',async()=>{
    const cap=input.value.trim(); const call=++serial;host.hidden=true;area.replaceChildren();
    if(!/^\d{5}$/.test(cap))return;
    try {
      const response=await fetch('/api/health?partner_ads_cap='+encodeURIComponent(cap),{cache:'no-store'});
      if(!response.ok) return; const data=await response.json();if(call!==serial||input.value.trim()!==cap)return;
      const rows=Array.isArray(data.ads)?data.ads:[];
      // One slot: exclusive or balanced shared choice, limited to three by database constraints.
      const candidates=rows.filter(c=>c.space_code==='territorio_a'&&(c.format==='responsive'||(window.matchMedia('(max-width:739px)').matches?c.format==='mobile':c.format==='desktop')));
      const exclusive=candidates.find(c=>c.delivery_mode==='exclusive');const shared=candidates.filter(c=>c.delivery_mode==='shared').slice(0,3);
      const group=exclusive?[exclusive]:shared;if(!group.length)return;
      const chosen=group[Math.floor(Math.random()*group.length)];
      if(!/^https:\/\//.test(chosen.creative_url||'')||!/^https:\/\//.test(chosen.target_url||''))return;
      const a=document.createElement('a');a.href=chosen.target_url;a.target='_blank';a.rel='sponsored noopener noreferrer';a.setAttribute('aria-label','Pubblicità: '+chosen.provider_name);
      const img=document.createElement('img');img.src=chosen.creative_url;img.alt='Pubblicità '+chosen.provider_name;img.loading='lazy';img.style.cssText='max-width:100%;height:auto;display:block;border-radius:8px';
      a.append(img);area.append(a);host.hidden=false;
    }catch {host.hidden=true;}
  });
})();
