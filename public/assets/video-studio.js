/* Video Studio 0.9.0 — independent RLS-backed review UI; no service-role secrets. */
(async()=>{
  'use strict';
  const VERSION='0.9.0', sessionKey='offertalogica.editorial.session.v1', bucket='video-studio';
  const $=id=>document.getElementById(id), config=window.OFFERTALOGICA_EDITORIAL_CONFIG||{};
  const root=String(config.supabaseUrl||'').replace(/\/+$/,''),anonKey=String(config.supabaseAnonKey||'');
  let session=null,projects=[],articles=[],selectedId='';
  const notify=(text,error=false)=>{$('vs-message').textContent=text;$('vs-message').className=error?'vs-error':'vs-success';};
  const message=e=>{notify(e?.message||String(e),true);};
  const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined&&text!==null)e.textContent=String(text);if(cls)e.className=cls;return e;};
  const parent=(p,...nodes)=>{for(const n of nodes)if(n)p.append(n);return p;};
  const input=(label,value,type='text')=>{const box=element('label',label);const field=element('input');field.type=type;field.value=value||'';box.append(field);return {box,field};};
  async function request(path,{method='GET',data}={}) {
    if(!session?.access_token)throw new Error('Sessione scaduta: accedi alla Redazione.');
    const headers={apikey:anonKey,Authorization:`Bearer ${session.access_token}`};
    if(data!==undefined)headers['Content-Type']='application/json';
    if(method!=='GET')headers.Prefer='return=representation';
    const response=await fetch(`${root}${path}`,{method,headers,cache:'no-store',body:data===undefined?undefined:JSON.stringify(data)});
    const raw=await response.text(),body=raw?JSON.parse(raw):null;
    if(!response.ok)throw new Error(body?.message||body?.error||`HTTP ${response.status}`);return body;
  }
  const rest=(name,params='')=>request(`/rest/v1/${name}${params}`);
  async function patch(id,body){const rows=await request(`/rest/v1/video_studio_projects?id=eq.${id}&select=*`,{method:'PATCH',data:body});if(!rows?.length)throw new Error('Aggiornamento non eseguito');return rows[0];}
  async function signed(path){
    if(!/^[a-f0-9-]{36}\/(scenes\/scene_[1-4]\.png|music\/preview\.m4a|master\/reel\.mp4|master\/mobile-review\.jpg)$/.test(path||''))throw new Error('Asset non valido');
    const response=await request(`/storage/v1/object/sign/${bucket}/${path}`,{method:'POST',data:{expiresIn:600}});
    const key=response?.signedURL||response?.signedUrl;
    if(!key)throw new Error('URL privato non disponibile');
    return key.startsWith('http')?key:key.startsWith('/object/')?`${root}/storage/v1${key}`:`${root}${key.startsWith('/')?'':'/'}${key}`;
  }
  async function shaCanonical(obj) {
    function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
    const buf=new TextEncoder().encode(JSON.stringify(canonical(obj)));
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buf))).map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  function sources(raw){
    let a=raw;if(typeof a==='string'){try{a=JSON.parse(a);}catch{a=[];}}
    if(!Array.isArray(a))a=[];
    return a.map((s,i)=>({id:`source_${i+1}`,url:typeof s==='string'?s:s?.url||s?.source_url||''})).filter(s=>/^https:\/\//.test(s.url));
  }
  async function load() {
    const [members,arts,rows]=await Promise.all([
      rest('editorial_members','?select=role,active&user_id=eq.'+session.user.id+'&limit=1'),
      rest('editorial_articles','?select=id,title,slug,status,updated_at,published_at,content,category,sources&status=in.(approved,published)&order=updated_at.desc&limit=40'),
      rest('video_studio_projects','?select=*&order=created_at.desc&limit=100')]);
    if(!members?.[0]?.active||!['editor','admin'].includes(members[0].role))throw new Error('Account senza permessi Redazione');
    articles=arts||[];projects=rows||[];
    const options=$('vs-articles');options.replaceChildren(element('option','Seleziona articolo...'));
    for(const a of articles){const option=element('option',a.title);option.value=a.id;options.append(option);}
    $('vs-list').replaceChildren();
    if(!projects.length)$('vs-list').append(element('p','Nessun progetto creato.','vs-muted'));
    for(const p of projects){const box=element('div',null,'vs-project');const left=element('div');
      left.append(element('strong',p.snapshot?.title||p.article_id),element('span',p.state,'vs-tag'));
      left.append(element('div',new Date(p.created_at).toLocaleString('it-IT')+(p.scheduled_at?` · Calendario: ${new Date(p.scheduled_at).toLocaleString('it-IT')}`:''),'vs-muted'));
      const btn=element('button','Apri','vs-secondary');btn.type='button';btn.onclick=()=>openProject(p.id).catch(message);
      box.append(left,btn);$('vs-list').append(box);
    }
  }
  async function create(e){e.preventDefault();try {
    const a=articles.find(x=>x.id===$('vs-articles').value);if(!a)throw new Error('Seleziona articolo');
    const src=sources(a.sources);if(!src.length)throw new Error('Articolo senza fonti HTTPS: impossibile congelare uno snapshot verificabile');
    const snapshot={id:a.id,version:a.updated_at||a.published_at||'',status:a.status,title:a.title,
      url:`https://offertalogica.it/articoli/${a.slug}-${a.id}.html`,category:a.category||'editoriale',content:a.content||'',sources:src};
    if(snapshot.content.length<60)throw new Error('Testo articolo insufficiente');
    const fingerprint=await shaCanonical(snapshot);
    await request('/rest/v1/video_studio_projects',{method:'POST',data:{article_id:a.id,created_by:session.user.id,
      snapshot,source_fingerprint:fingerprint,platform:$('vs-platform').value,mood:$('vs-mood').value}});
    notify('Progetto creato. Il worker indipendente preparerà scene e proposta musicale.');await load();
  }catch(err){message(err);}}
  function checkLine(text,checked){const label=element('label',null,'vs-check'),box=element('input');box.type='checkbox';box.checked=Boolean(checked);label.append(box,element('span',text));return {label,box};}
  async function openProject(id){
    const p=projects.find(x=>x.id===id);if(!p)return;
    selectedId=id;const container=$('vs-detail-content');container.replaceChildren();$('vs-detail').hidden=false;
    container.append(element('p',`${p.snapshot?.title||''} · ${p.state}`,'vs-muted'));
    if(p.last_error)container.append(element('p',p.last_error,'vs-error'));
    if(p.state==='failed'){
      const b=element('button','Riprova');b.onclick=async()=>{try{await patch(id,{state:'queued',lease_key:null,lease_until:null});await load();notify('Ritentativo messo in coda.');}catch(e){message(e);}};container.append(b);
    }
    if(p.state==='needs_review'){
      const scenesBox=element('div',null,'vs-scenes');const sceneFields=[];
      for(const s of (p.assets?.scenes||[])){
        const block=element('div',null,'vs-scene');block.append(element('h3',`${s.role} · ${s.id}`));
        const img=element('img');img.alt=`Fotografia proposta ${s.id}; verificare soggetti, testi impressi e diritti`;
        if(s.image_path)signed(s.image_path).then(u=>{img.src=u;}).catch(message);block.append(img);
        const title=input('Titolo',s.headline),secondary=input('Sottotitolo',s.secondary_text);
        const region=input('Aree soggetto protette (JSON, coordinate 1080×1920)',JSON.stringify(s.protected_regions||[]));
        const reviewed=checkLine('Ho verificato fotografia, diritti, soggetti e leggibilità',s.reviewed);
        block.append(title.box,secondary.box,region.box,reviewed.label);scenesBox.append(block);
        sceneFields.push({s,title,secondary,region,reviewed});
      }
      container.append(scenesBox);
      const music=element('div');music.append(element('h3','Musica proposta: '+(p.music_plan?.track_title||'non disponibile')));
      if(p.music_plan?.preview_path){const audio=element('audio');audio.controls=true;signed(p.music_plan.preview_path).then(u=>{audio.src=u;}).catch(message);music.append(audio);}
      const claim=element('p',p.storyboard?.selected_excerpt||'Afferm. non disponibile','vs-muted');music.append(element('h3','Affermazione editoriale'),claim);
      const audition=checkLine('Ho ascoltato i 15 secondi, verificato licenza e cue musicali',p.assets?.music_reviewed);
      const factual=checkLine('Ho verificato l’affermazione rispetto ad articolo e fonti',p.assets?.claim_reviewed);
      music.append(audition.label,factual.label);container.append(music);
      const btn=element('button','Approva materiali e prepara MP4');
      btn.onclick=async()=>{try{
        const scenes=sceneFields.map(({s,title,secondary,region,reviewed})=>{
          let protectedRegions;try{protectedRegions=JSON.parse(region.field.value);}catch{throw new Error('JSON aree protette non valido');}
          if(!Array.isArray(protectedRegions))throw new Error('Le aree protette devono essere un array');
          if(!reviewed.box.checked)throw new Error('Tutte le scene richiedono revisione');
          const headline=title.field.value.trim();if(!headline||headline.split(/\s+/u).length>9)throw new Error('Titolo obbligatorio, massimo 9 parole');
          return {...s,headline,secondary_text:secondary.field.value.trim(),protected_regions:protectedRegions,reviewed:true};
        });
        if(!audition.box.checked||!factual.box.checked)throw new Error('Mancano approvazioni editoriali o musicali');
        await patch(id,{state:'render_queued',assets:{...p.assets,scenes,music_reviewed:true,audition_reviewer:session.user.id,
          claim_reviewed:true,claim_reviewer:session.user.id}});
        notify('Render richiesto. Il risultato richiederà una seconda revisione sul master.');await load();await openProject(id);
      }catch(e){message(e);}};
      container.append(btn);
    }
    if(['ready_for_review','approved','scheduled'].includes(p.state)) {
      if(p.video_path){const vid=element('video',null,'vs-preview');vid.controls=true;vid.playsInline=true;
        signed(p.video_path).then(u=>{vid.src=u;}).catch(message);container.append(vid);}
      if(p.mobile_review_path){const img=element('img',null,'vs-mobile');img.alt='Anteprima mobile e aree UI indicative';
        signed(p.mobile_review_path).then(u=>{img.src=u;}).catch(message);container.append(img);}
      container.append(element('p',`QA: ${p.qa?.technical_status||'mancante'} · Output: ${p.qa?.format?.duration_seconds||'?'} s`,'vs-muted'));
      if(p.state==='ready_for_review'){
        const agree=checkLine('Ho visto il MP4 su smartphone, verificato testi, logo, claim e musica. Approvo per la sola pianificazione.',false);
        container.append(agree.label);
        const btn=element('button','Approva master');btn.onclick=async()=>{try{if(!agree.box.checked)throw new Error('Revisione finale obbligatoria');
          await patch(id,{state:'approved',review:{approved:true,reviewed_by:session.user.id,reviewed_at:new Date().toISOString(),publication_authorized:false}});
          notify('Master approvato; nessuna pubblicazione attivata.');await load();await openProject(id);
        }catch(e){message(e);}};container.append(btn);
      }
      if(p.state==='approved'){
        const schedule=input('Data e ora del calendario (non pubblica automaticamente)', '','datetime-local');
        schedule.box.classList.add('vs-schedule');container.append(schedule.box);
        const btn=element('button','Inserisci in calendario');btn.onclick=async()=>{try{const date=new Date(schedule.field.value);
          if(!schedule.field.value||!Number.isFinite(date.getTime())||date.getTime()<Date.now())throw new Error('Scegli una data futura valida');
          await patch(id,{state:'scheduled',scheduled_at:date.toISOString()});await load();await openProject(id);notify('Calendario registrato. Pubblicazione automatica DISABILITATA.');
        }catch(e){message(e);}};container.append(btn);
      }
      if(p.state==='scheduled'){const btn=element('button','Rimuovi dal calendario','vs-secondary');btn.onclick=async()=>{try{await patch(id,{state:'approved',scheduled_at:null});await load();await openProject(id);}catch(e){message(e);}};container.append(btn);}
    }
    container.scrollIntoView({behavior:'smooth',block:'start'});
  }
  try{
    if(!/^https:\/\//.test(root)||anonKey.length<20)throw new Error('Configurazione Supabase assente');
    session=JSON.parse(sessionStorage.getItem(sessionKey)||'null');
    if(!session?.access_token||!session?.user?.id){$('vs-login').hidden=false;return;}
    $('vs-app').hidden=false;
    $('vs-new').addEventListener('submit',create);
    $('vs-refresh').onclick=()=>load().then(()=>notify('Archivio aggiornato.')).catch(message);
    await load();
  }catch(e){$('vs-app').hidden=true;$('vs-login').hidden=false;message(e);}
})();
