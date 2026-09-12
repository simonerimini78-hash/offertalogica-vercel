(() => {
  "use strict";

  const VERSION = "0.10.8";
  const SESSION_KEY = "offertalogica.editorial.session.v1";
  const STATUSES = new Set(["draft", "in_review", "changes_requested", "approved", "published", "archived"]);
  const STATUS_LABELS = {draft:"Bozza",in_review:"In revisione",changes_requested:"Modifiche richieste",approved:"Approvato",published:"Pubblicato",archived:"Archiviato"};
  const PUBLIC_SELECT = "slug,title,excerpt,content,category,featured_image_url,featured_image_alt,sources,seo_title,seo_description,published_at,updated_at,author_slug,author_display_name,author_bio,author_avatar_url,author_website_url,author_linkedin_url,category_name";
  const IMAGE_BUCKET = "editorial-images";
  const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
  const IMAGE_MIME = new Map([["image/jpeg","jpg"],["image/png","png"],["image/webp","webp"],["image/avif","avif"]]);

  const PERMISSION_DEFS = [
    {key:"create_articles",label:"Creare articoli",help:"Può aprire nuove bozze proprie.",group:"Scrittura"},
    {key:"edit_title",label:"Titolo",help:"Può scrivere o modificare il titolo dell’articolo.",group:"Scrittura"},
    {key:"edit_excerpt",label:"Sommario",help:"Può scrivere la breve introduzione dell’articolo.",group:"Scrittura"},
    {key:"edit_content",label:"Contenuto",help:"Può scrivere e modificare il corpo dell’articolo.",group:"Scrittura"},
    {key:"edit_category",label:"Categoria",help:"Può scegliere l’argomento principale.",group:"Scrittura"},
    {key:"edit_images",label:"Immagini",help:"Può gestire immagine principale e testo alternativo.",group:"Scrittura"},
    {key:"edit_sources",label:"Fonti",help:"Può aggiungere fonti e link di verifica.",group:"Scrittura"},
    {key:"edit_slug",label:"Slug / URL",help:"Può modificare l’indirizzo tecnico dell’articolo.",group:"Tecnico"},
    {key:"edit_seo",label:"SEO",help:"Può modificare titolo e descrizione SEO.",group:"Tecnico"},
    {key:"review_articles",label:"Revisione",help:"Può correggere articoli altrui e richiedere modifiche.",group:"Redazione",editorOnly:true},
    {key:"approve_articles",label:"Approvazione",help:"Può approvare articoli altrui.",group:"Redazione",editorOnly:true},
    {key:"publish_articles",label:"Pubblicazione",help:"Può pubblicare articoli già pronti.",group:"Redazione",editorOnly:true},
    {key:"archive_articles",label:"Archiviazione",help:"Può archiviare articoli della redazione.",group:"Redazione",editorOnly:true}
  ];
  const PERMISSION_KEYS = PERMISSION_DEFS.map(item=>item.key);
  function roleLabel(role){return role==="admin"?"Admin":role==="editor"?"Editor":"Collaboratore";}
  function permissionDefaults(role){
    const all=Object.fromEntries(PERMISSION_KEYS.map(key=>[key,false]));
    if(role==="admin")return Object.fromEntries(PERMISSION_KEYS.map(key=>[key,true]));
    if(role==="editor")return Object.fromEntries(PERMISSION_KEYS.map(key=>[key,true]));
    return {...all,create_articles:true,edit_title:true,edit_content:true,edit_sources:true};
  }
  function effectivePermissions(member){
    if(member?.role==="admin")return permissionDefaults("admin");
    const base=permissionDefaults(member?.role||"contributor");
    const stored=member?.permissions&&typeof member.permissions==="object"?member.permissions:{};
    const merged={...base};
    PERMISSION_DEFS.forEach(def=>{
      if(typeof stored[def.key]==="boolean")merged[def.key]=stored[def.key];
      if(member?.role==="contributor"&&def.editorOnly)merged[def.key]=false;
    });
    return merged;
  }
  function can(member,key){return Boolean(effectivePermissions(member)[key]);}
  function permissionValuesFromContainer(container,role){
    const values=permissionDefaults(role);
    if(!container)return values;
    container.querySelectorAll("input[data-permission-key]").forEach(input=>{values[input.dataset.permissionKey]=Boolean(input.checked)&&!(role==="contributor"&&input.dataset.editorOnly==="true");});
    return values;
  }
  function renderPermissionGrid(container,role,values=permissionDefaults(role)){
    if(!container)return;
    container.replaceChildren();
    PERMISSION_DEFS.forEach(def=>{
      const label=document.createElement("label");label.className="ol-permission-option";
      const locked=role==="contributor"&&def.editorOnly; label.dataset.locked=String(locked);
      const input=document.createElement("input");input.type="checkbox";input.dataset.permissionKey=def.key;input.dataset.editorOnly=String(Boolean(def.editorOnly));input.checked=locked?false:Boolean(values?.[def.key]);input.disabled=locked||role==="admin";
      const copy=document.createElement("span");const strong=document.createElement("strong");strong.textContent=def.label;const small=document.createElement("small");small.textContent=locked?`${def.help} Disponibile solo per editor.`:def.help;copy.append(strong,small);label.append(input,copy);container.append(label);
    });
  }
  function applyPermissionVisibility(root,permissions){
    if(!root)return;
    root.querySelectorAll("[data-requires-permission]").forEach(node=>{node.hidden=!permissions[node.dataset.requiresPermission];});
    root.querySelectorAll("[data-guide-permission]").forEach(node=>{node.hidden=!permissions[node.dataset.guidePermission];});
  }
  function renderPermissionSummary(container,member){
    if(!container)return;container.replaceChildren();const perms=effectivePermissions(member);
    const enabled=PERMISSION_DEFS.filter(def=>perms[def.key]&&!(member?.role==="contributor"&&def.editorOnly));
    if(!enabled.length){const p=document.createElement("p");p.className="ol-muted";p.textContent="Nessun permesso operativo assegnato.";container.append(p);return;}
    enabled.forEach(def=>{const span=document.createElement("span");span.textContent=`✓ ${def.label}`;container.append(span);});
  }
  function categoryLabel(value){const raw=String(value||"").trim();if(!raw)return "Articolo OffertaLogica";const known={"bollette":"Bollette","offerte-luce-gas":"Offerte luce e gas","mercato-energia":"Mercato energia","risparmio":"Risparmio","casa-smart":"Casa smart","assicurazioni":"Assicurazioni","casa":"Casa","fotovoltaico":"Fotovoltaico","mobilita":"Mobilità","tecnologia":"Tecnologia"};return known[raw]||raw.split("-").filter(Boolean).map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join(" ");}
  async function loadCategoryOptions(selects,token=""){
    const list=[...new Set((Array.isArray(selects)?selects:[selects]).filter(Boolean))];if(!list.length)return;
    const previous=new Map(list.map(select=>[select,select.value]));
    const rows=await db("editorial_categories?select=slug,name,active&order=sort_order.asc,name.asc",{token}).catch(()=>[]);
    list.forEach(select=>{
      const current=previous.get(select)||"";select.replaceChildren();const empty=document.createElement("option");empty.value="";empty.textContent="Seleziona";select.append(empty);
      (rows||[]).forEach(row=>{const option=document.createElement("option");option.value=row.slug;option.textContent=row.name;select.append(option);});
      if(current&&!(rows||[]).some(row=>row.slug===current)){const option=document.createElement("option");option.value=current;option.textContent=`${categoryLabel(current)} (non attiva)`;select.append(option);}
      select.value=current;
    });
  }

  const config = (() => {
    const raw = window.OFFERTALOGICA_EDITORIAL_CONFIG || {};
    return {url:String(raw.supabaseUrl||"").replace(/\/+$/, ""),key:String(raw.supabaseAnonKey||"").trim()};
  })();

  function configured(){ return /^https:\/\//i.test(config.url) && config.key.length > 20; }
  function text(value,max=5000){ return String(value ?? "").trim().slice(0,max); }
  function normalizeSlug(value){ return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,120); }
  function truncateWords(value,max=65){ const clean=String(value||"").replace(/\s+/g," ").trim(); if(clean.length<=max)return clean; const cut=clean.slice(0,max+1); const space=cut.lastIndexOf(" "); return (space>Math.floor(max*.6)?cut.slice(0,space):clean.slice(0,max)).replace(/[\s:;,.!?-]+$/g,"").trim(); }
  function suggestSeoTitle(title,category=""){ const base=String(title||"").replace(/\s+/g," ").trim(); if(!base)return ""; const cat=categoryLabel(category); const catUseful=category&&cat&&cat!=="Articolo OffertaLogica"&&!base.toLocaleLowerCase("it").includes(cat.toLocaleLowerCase("it")); const candidate=catUseful&&`${cat}: ${base}`.length<=65?`${cat}: ${base}`:base; return truncateWords(candidate,65); }
  function imagePublicUrl(path){ return `${config.url}/storage/v1/object/public/${IMAGE_BUCKET}/${String(path||"").split("/").map(encodeURIComponent).join("/")}`; }
  async function uploadEditorialImage(file,token,userId,slugHint="immagine"){
    if(!file)throw new Error("Seleziona un’immagine.");
    if(!IMAGE_MIME.has(file.type))throw new Error("Formato non supportato. Usa JPG, PNG, WebP o AVIF.");
    if(file.size<=0||file.size>IMAGE_MAX_BYTES)throw new Error("L’immagine deve pesare al massimo 5 MB.");
    const ext=IMAGE_MIME.get(file.type);const base=normalizeSlug(slugHint)||"immagine";const objectPath=`${userId}/${Date.now()}-${base.slice(0,70)}.${ext}`;
    const headers={apikey:config.key,Authorization:`Bearer ${token}`,"Content-Type":file.type,"x-upsert":"false"};
    await request(`${config.url}/storage/v1/object/${IMAGE_BUCKET}/${objectPath}`,{method:"POST",headers,body:file,cache:"no-store"});
    return imagePublicUrl(objectPath);
  }
  function renderImagePreview(root,url){ if(!root)return;const box=root.querySelector("[data-image-preview-box]");const img=root.querySelector("[data-image-preview]");const remove=root.querySelector("[data-image-remove]");const safe=/^https:\/\//i.test(String(url||""))?String(url):"";if(img){if(safe)img.src=safe;else img.removeAttribute("src");img.alt="Anteprima immagine principale";}if(box)box.hidden=!safe;if(remove)remove.hidden=!safe; }
  function normalizeHttpsUrl(value,{linkedin=false,max=500}={}){
    const raw=text(value,max);if(!raw)return "";let url;try{url=new URL(raw);}catch{throw new Error("Inserisci un indirizzo web completo, ad esempio https://...");}
    if(url.protocol!=="https:")throw new Error("Per sicurezza sono accettati solo indirizzi https://");
    if(linkedin){const host=url.hostname.toLowerCase();if(host!=="linkedin.com"&&!host.endsWith(".linkedin.com"))throw new Error("Inserisci un indirizzo LinkedIn valido.");}
    return url.href;
  }
  function renderAuthorAvatarPreview(root,url,name="autore"){
    if(!root)return;const box=root.querySelector("[data-author-avatar-preview-box]");const img=root.querySelector("[data-author-avatar-preview]");const remove=root.querySelector("[data-author-avatar-remove]");const safe=/^https:\/\//i.test(String(url||""))?String(url):"";
    if(img){if(safe)img.src=safe;else img.removeAttribute("src");img.alt=safe?`Anteprima foto di ${name||"autore"}`:"";}if(box)box.hidden=!safe;if(remove)remove.hidden=!safe;
  }
  function setupOwnAuthorProfile(root,{getSession,getAuthor,onSaved=()=>{}}={}){
    if(!root)return {load:()=>{},setVisible:()=>{}};const form=root.querySelector("[data-author-profile-form]");if(!form)return {load:()=>{},setVisible:()=>{}};const fields=workspaceFields(form);const success=root.querySelector("[data-author-profile-success]");const error=root.querySelector("[data-author-profile-error]");const save=root.querySelector("[data-author-profile-save]");const publicLink=root.querySelector("[data-author-public-link]");const upload=root.querySelector("[data-author-avatar-upload]");const uploadStatus=root.querySelector("[data-author-avatar-status]");const remove=root.querySelector("[data-author-avatar-remove]");let current=null;
    function load(author){current=author||null;root.hidden=!current;if(!current)return;fields.display_name.value=current.display_name||"";fields.slug.value=current.slug?`/autori/${current.slug}.html`:"";fields.bio.value=current.bio||"";fields.avatar_url.value=current.avatar_url||"";fields.linkedin_url.value=current.linkedin_url||"";fields.website_url.value=current.website_url||"";renderAuthorAvatarPreview(root,current.avatar_url,current.display_name);if(publicLink){publicLink.hidden=!current.slug;publicLink.href=current.slug?`/autori/${encodeURIComponent(current.slug)}.html`:"#";}show(success,"");show(error,"");initCounters(form);}
    async function saveProfile(event){event.preventDefault();show(success,"");show(error,"");const session=getSession?.();const author=getAuthor?.()||current;if(!session?.access_token||!author?.id){show(error,"Profilo autore non disponibile. Accedi di nuovo.");return;}const displayName=text(fields.display_name.value,120);if(!displayName){show(error,"Inserisci il nome pubblico dell’autore.");fields.display_name.focus();return;}let linkedin="",website="",avatar="";try{linkedin=normalizeHttpsUrl(fields.linkedin_url.value,{linkedin:true});website=normalizeHttpsUrl(fields.website_url.value);avatar=normalizeHttpsUrl(fields.avatar_url.value,{max:1000});}catch(e){show(error,e.message);return;}save.disabled=true;try{await db("rpc/editorial_update_own_author_profile",{method:"POST",token:session.access_token,body:{p_display_name:displayName,p_bio:text(fields.bio.value,700)||null,p_avatar_url:avatar||null,p_website_url:website||null,p_linkedin_url:linkedin||null}});const updated={...author,display_name:displayName,bio:text(fields.bio.value,700),avatar_url:avatar,website_url:website,linkedin_url:linkedin};current=updated;load(updated);show(success,"Profilo autore salvato. I nuovi dati saranno usati automaticamente negli articoli e nella pagina autore.");onSaved(updated);}catch(e){show(error,`Profilo non salvato: ${e.message}`);}finally{save.disabled=false;}}
    form.addEventListener("submit",saveProfile);
    upload?.addEventListener("change",async()=>{const file=upload.files?.[0];if(!file)return;const session=getSession?.();if(!session?.access_token||!session?.user?.id){show(uploadStatus,"Sessione non disponibile.");upload.value="";return;}upload.disabled=true;show(uploadStatus,"Caricamento foto…");try{const url=await uploadEditorialImage(file,session.access_token,session.user.id,`autore-${fields.display_name.value||"profilo"}`);fields.avatar_url.value=url;renderAuthorAvatarPreview(root,url,fields.display_name.value);show(uploadStatus,"Foto caricata. Salva il profilo per confermare.");}catch(e){show(uploadStatus,`Caricamento non riuscito: ${e.message}`);}finally{upload.disabled=false;upload.value="";}});
    remove?.addEventListener("click",()=>{fields.avatar_url.value="";renderAuthorAvatarPreview(root,"",fields.display_name.value);show(uploadStatus,"Foto rimossa dal profilo. Salva per confermare.");});
    return {load,setVisible(value){root.hidden=!value;}};
  }
  function wireImageUploader(root,fields,getSession,getTitle,onDirty=()=>{}){ if(!root)return;const input=root.querySelector("[data-image-upload]");const status=root.querySelector("[data-image-status]");const remove=root.querySelector("[data-image-remove]");if(!input||!fields?.featured_image_url)return;input.addEventListener("change",async()=>{const file=input.files?.[0];if(!file)return;const session=getSession();if(!session?.access_token||!session?.user?.id){show(status,"Sessione non disponibile. Accedi di nuovo.");input.value="";return;}show(status,"Caricamento immagine…");input.disabled=true;try{const url=await uploadEditorialImage(file,session.access_token,session.user.id,getTitle());fields.featured_image_url.value=url;renderImagePreview(root,url);show(status,"Immagine caricata.");onDirty();}catch(error){show(status,`Caricamento non riuscito: ${error.message}`);}finally{input.disabled=false;input.value="";}});remove?.addEventListener("click",()=>{fields.featured_image_url.value="";renderImagePreview(root,"");show(status,"Immagine rimossa dall’articolo. Il file caricato resta nell’archivio immagini.");onDirty();}); }
  function formatDate(value){ if(!value)return ""; const d=new Date(value); return Number.isNaN(d.getTime())?"":new Intl.DateTimeFormat("it-IT",{day:"2-digit",month:"long",year:"numeric"}).format(d); }
  function show(el,message){ if(!el)return; el.textContent=message; el.hidden=!message; }
  function setStatusBadge(el,status){ if(!el)return; const safe=STATUSES.has(status)?status:"draft"; el.dataset.status=safe; el.textContent=STATUS_LABELS[safe]; }
  function sessionRead(){ try{return JSON.parse(sessionStorage.getItem(SESSION_KEY)||"null");}catch{return null;} }
  function sessionWrite(value){ if(value)sessionStorage.setItem(SESSION_KEY,JSON.stringify(value)); else sessionStorage.removeItem(SESSION_KEY); }
  function authHeaders(token=""){ const h={apikey:config.key,"Content-Type":"application/json"}; if(token)h.Authorization=`Bearer ${token}`; return h; }

  async function request(url,options={}){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(url,{...options,signal:controller.signal}); const payload=await response.json().catch(()=>null);
      if(!response.ok){ const message=payload?.message||payload?.msg||payload?.error_description||payload?.error||`Errore ${response.status}`; const error=new Error(message); error.status=response.status; throw error; }
      return payload;
    }catch(error){
      if(error?.name==="AbortError")throw new Error("Servizio temporaneamente non raggiungibile. Riprova tra poco.");
      throw error;
    }finally{clearTimeout(timeout);}
  }
  async function db(path,{method="GET",token="",body=null,prefer=""}={}){ const headers=authHeaders(token); if(prefer)headers.Prefer=prefer; return request(`${config.url}/rest/v1/${path}`,{method,headers,body:body===null?undefined:JSON.stringify(body),cache:"no-store"}); }
  async function login(email,password){ return request(`${config.url}/auth/v1/token?grant_type=password`,{method:"POST",headers:authHeaders(),body:JSON.stringify({email,password}),cache:"no-store"}); }
  async function signup(email,password,redirectTo){ const target=redirectTo?`?redirect_to=${encodeURIComponent(redirectTo)}`:""; return request(`${config.url}/auth/v1/signup${target}`,{method:"POST",headers:authHeaders(),body:JSON.stringify({email,password}),cache:"no-store"}); }
  async function requestPasswordRecovery(email,redirectTo){ const target=redirectTo?`?redirect_to=${encodeURIComponent(redirectTo)}`:""; return request(`${config.url}/auth/v1/recover${target}`,{method:"POST",headers:authHeaders(),body:JSON.stringify({email}),cache:"no-store"}); }
  async function authUser(token){ return request(`${config.url}/auth/v1/user`,{method:"GET",headers:authHeaders(token),cache:"no-store"}); }
  async function updatePassword(token,password){ return request(`${config.url}/auth/v1/user`,{method:"PUT",headers:authHeaders(token),body:JSON.stringify({password}),cache:"no-store"}); }

  function initCounters(root=document){ root.querySelectorAll("[data-count-for]").forEach(counter=>{ const field=document.getElementById(counter.getAttribute("data-count-for")); if(!field)return; const max=Number(field.getAttribute("maxlength")||0); const update=()=>counter.textContent=max?`${field.value.length}/${max}`:String(field.value.length); if(!counter.dataset.counterReady){counter.dataset.counterReady="1";field.addEventListener("input",update);} update(); }); }

  async function fetchAuthors(ids,token=""){
    const unique=[...new Set(ids.filter(Boolean))]; if(!unique.length)return new Map();
    const values=unique.map(id=>id.replace(/[^a-f0-9-]/gi,"")).join(",");
    const rows=await db(`editorial_authors?select=id,slug,display_name,bio,avatar_url,website_url,linkedin_url&id=in.(${values})`,{token});
    return new Map((rows||[]).map(row=>[row.id,row]));
  }

  async function fetchPublicArticles(extra=""){
    try { return await db(`editorial_public_articles?select=${PUBLIC_SELECT}${extra}`); }
    catch (error) {
      if(error.status!==404 && error.status!==400) throw error;
      const legacy=await db(`editorial_articles?select=id,author_id,slug,title,excerpt,content,category,featured_image_url,sources,seo_title,seo_description,published_at,updated_at&status=eq.published${extra}`);
      const authors=await fetchAuthors((legacy||[]).map(a=>a.author_id));
      return (legacy||[]).map(article=>{ const author=authors.get(article.author_id)||{}; return {...article,featured_image_alt:article.title,author_slug:author.slug||"",author_display_name:author.display_name||"Redazione OffertaLogica",author_bio:author.bio||"",author_avatar_url:author.avatar_url||"",author_website_url:author.website_url||"",author_linkedin_url:author.linkedin_url||""}; });
    }
  }
  async function fetchStaticSlugs(){
    try{const response=await fetch("/data/editorial-static.json",{cache:"no-store"});if(!response.ok)return new Set();const payload=await response.json();return new Set((Array.isArray(payload?.slugs)?payload.slugs:[]).map(normalizeSlug).filter(Boolean));}catch{return new Set();}
  }
  function publicArticleHref(article,staticSlugs){const slug=normalizeSlug(article?.slug||"");return staticSlugs?.has(slug)?`/articoli/${encodeURIComponent(slug)}.html`:`/articolo.html?slug=${encodeURIComponent(slug)}`;}

  function makeTime(value){ const t=document.createElement("time"); if(value)t.dateTime=value; t.textContent=formatDate(value); return t; }
  function articleIsNew(article,now=Date.now()){
    const published=Date.parse(article?.published_at||"");
    if(!Number.isFinite(published))return false;
    const age=now-published;
    return age>=0&&age<=7*24*60*60*1000;
  }

  function renderArchive(container,articles,staticSlugs){
    const status=document.querySelector("[data-archive-status]");
    container.replaceChildren(); container.setAttribute("aria-busy","false");
    if(!articles.length){ const empty=document.createElement("div"); empty.className="ol-empty"; const h=document.createElement("h3"); h.textContent="Nessun articolo pubblicato"; const p=document.createElement("p"); p.textContent="I contenuti approvati compariranno qui."; empty.append(h,p); container.append(empty); if(status)status.textContent="Nessun articolo pubblicato."; return; }
    const newestIsNew=articleIsNew(articles[0]);
    articles.forEach((article,index)=>{
      const item=document.createElement("article");
      const featured=index===0&&newestIsNew;
      item.className=`ol-article-item${featured?" ol-article-item-featured":""}`;
      if(featured){const badge=document.createElement("span");badge.className="ol-new-badge";badge.textContent="Nuovo";item.append(badge);}
      const meta=document.createElement("div"); meta.className="ol-article-meta";
      if(article.category){const span=document.createElement("span");span.textContent=article.category_name||categoryLabel(article.category);meta.append(span);}
      if(article.author_display_name){ const a=document.createElement(article.author_slug?"a":"span"); if(article.author_slug)a.href=`/autori/${encodeURIComponent(article.author_slug)}.html`; a.textContent=article.author_display_name; meta.append(a); }
      if(article.published_at){const t=makeTime(article.published_at);t.textContent=`Pubblicato il ${formatDate(article.published_at)}`;meta.append(t);}
      const h=document.createElement("h3"); const a=document.createElement("a"); a.href=publicArticleHref(article,staticSlugs); a.textContent=article.title; h.append(a);
      const excerpt=document.createElement("p"); excerpt.textContent=article.excerpt||""; item.append(meta,h,excerpt); container.append(item);
    });
    if(status)status.textContent=`Caricati ${articles.length} ${articles.length===1?"articolo":"articoli"}.`;
  }

  async function initPublicArchive(){
    const container=document.querySelector("[data-article-list]"); const errorBox=document.querySelector("[data-public-error]"); if(!container)return;
    if(!configured()){ container.setAttribute("aria-busy","false"); show(errorBox,"Archivio editoriale temporaneamente non disponibile."); return; }
    try{ const [articles,staticSlugs]=await Promise.all([fetchPublicArticles("&order=published_at.desc&limit=100"),fetchStaticSlugs()]); renderArchive(container,articles||[],staticSlugs); }
    catch(error){ container.setAttribute("aria-busy","false"); show(errorBox,`Impossibile caricare gli articoli: ${error.message}`); }
  }

  function renderPlainContent(body,content){
    body.replaceChildren(); const blocks=String(content||"").split(/\n\s*\n/).map(v=>v.trim()).filter(Boolean);
    blocks.forEach(block=>{
      let node;
      if(/^###\s+/.test(block)){node=document.createElement("h3");node.textContent=block.replace(/^###\s+/,"");}
      else if(/^##\s+/.test(block)){node=document.createElement("h2");node.textContent=block.replace(/^##\s+/,"");}
      else {
        const lines=block.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
        const unordered=lines.length>1&&lines.every(v=>/^[-*]\s+/.test(v));
        const ordered=lines.length>1&&lines.every(v=>/^\d+[.)]\s+/.test(v));
        if(unordered||ordered){node=document.createElement(ordered?"ol":"ul");lines.forEach(line=>{const li=document.createElement("li");li.textContent=line.replace(ordered?/^\d+[.)]\s+/:/^[-*]\s+/,"");node.append(li);});}
        else {node=document.createElement("p");lines.forEach((line,index)=>{if(index)node.append(document.createElement("br"));node.append(document.createTextNode(line));});}
      }
      body.append(node);
    });
  }
  function renderSources(article){
    const section=document.querySelector("[data-article-sources]"); const list=document.querySelector("[data-source-list]"); if(!section||!list)return; list.replaceChildren();
    const lines=String(article.sources||"").split(/\r?\n/).map(v=>v.trim()).filter(Boolean); if(!lines.length){section.hidden=true;return;}
    lines.forEach(line=>{ const li=document.createElement("li"); const match=line.match(/^(.*?)(https?:\/\/\S+)$/i); if(match){ const label=match[1].replace(/[|–—:-]+\s*$/,"").trim(); const a=document.createElement("a"); a.href=match[2]; a.textContent=label||match[2]; a.rel="noopener noreferrer"; li.append(a); } else li.textContent=line; list.append(li); }); section.hidden=false;
  }
  async function renderRelated(article){ const section=document.querySelector("[data-related-section]"); const list=document.querySelector("[data-related-list]"); if(!section||!list||!article.category)return; try{ const [rows,staticSlugs]=await Promise.all([fetchPublicArticles(`&category=eq.${encodeURIComponent(article.category)}&slug=neq.${encodeURIComponent(article.slug)}&order=published_at.desc&limit=3`),fetchStaticSlugs()]); list.replaceChildren(); (rows||[]).forEach(row=>{const a=document.createElement("a");a.href=publicArticleHref(row,staticSlugs);a.textContent=row.title;list.append(a);}); section.hidden=!rows?.length; }catch{section.hidden=true;} }

  function renderAuthorCard(article){
    const card=document.querySelector("[data-article-author-card]"); if(!card)return;
    const name=article.author_display_name||"Redazione OffertaLogica";
    const profileHref=article.author_slug?`/autori/${encodeURIComponent(article.author_slug)}.html`:"";
    const nameEl=card.querySelector("[data-author-name]"); nameEl.replaceChildren();
    if(profileHref){const a=document.createElement("a");a.href=profileHref;a.textContent=name;nameEl.append(a);}else nameEl.textContent=name;
    const avatar=card.querySelector("[data-author-avatar]");
    if(avatar&&/^https:\/\//i.test(article.author_avatar_url||"")){avatar.src=article.author_avatar_url;avatar.alt="";avatar.loading="lazy";avatar.decoding="async";avatar.hidden=false;}else if(avatar){avatar.removeAttribute("src");avatar.hidden=true;}
    const bio=card.querySelector("[data-author-bio]"); if(bio){bio.textContent=article.author_bio||"";bio.hidden=!article.author_bio;}
    const links=card.querySelector("[data-author-links]"); links.replaceChildren();
    const addLink=(href,label)=>{if(!/^https:\/\//i.test(href||"")&&!href?.startsWith("/"))return;const a=document.createElement("a");a.href=href;a.textContent=label;if(/^https:\/\//i.test(href)){a.rel="me noopener noreferrer";a.target="_blank";a.setAttribute("aria-label",`${label}, si apre in una nuova scheda`);}links.append(a);};
    if(profileHref)addLink(profileHref,"Profilo autore");
    addLink(article.author_linkedin_url,"LinkedIn");
    addLink(article.author_website_url,"Sito personale");
    card.hidden=false;
  }

  async function initArticlePage(){
    const errorBox=document.querySelector("[data-public-error]"); const slug=normalizeSlug(new URLSearchParams(location.search).get("slug")||""); const articleView=document.querySelector("[data-article-view]");
    if(!slug){ if(articleView)articleView.setAttribute("aria-busy","false"); show(errorBox,"Articolo non specificato."); return; }
    if(!configured()){ if(articleView)articleView.setAttribute("aria-busy","false"); show(errorBox,"Articolo temporaneamente non disponibile."); return; }
    try{
      const rows=await fetchPublicArticles(`&slug=eq.${encodeURIComponent(slug)}&limit=1`); const article=rows?.[0]; if(!article)throw new Error("Articolo non trovato o non pubblicato");
      document.querySelector("[data-article-title]").textContent=article.title; document.querySelector("[data-article-excerpt]").textContent=article.excerpt||""; document.querySelector("[data-article-category]").textContent=article.category_name||categoryLabel(article.category);
      const authorEl=document.querySelector("[data-article-author]"); authorEl.replaceChildren(); if(article.author_slug){const a=document.createElement("a");a.href=`/autori/${encodeURIComponent(article.author_slug)}.html`;a.textContent=article.author_display_name||"Redazione OffertaLogica";authorEl.append(a);}else authorEl.textContent=article.author_display_name||"Redazione OffertaLogica";
      const date=document.querySelector("[data-article-date]"); date.textContent=article.published_at?`Pubblicato il ${formatDate(article.published_at)}`:""; if(article.published_at)date.dateTime=article.published_at;
      const updated=document.querySelector("[data-article-updated]"); const publishedTime=Date.parse(article.published_at||""); const updatedTime=Date.parse(article.updated_at||""); const showUpdated=updated&&Number.isFinite(updatedTime)&&(!Number.isFinite(publishedTime)||updatedTime-publishedTime>60*60*1000); if(updated){updated.hidden=!showUpdated;if(showUpdated){updated.dateTime=article.updated_at;updated.textContent=`Aggiornato il ${formatDate(article.updated_at)}`;}}
      renderPlainContent(document.querySelector("[data-article-content]"),article.content);
      const image=document.querySelector("[data-article-image]"); if(image&&/^https:\/\//i.test(article.featured_image_url||"")){image.src=article.featured_image_url;image.alt=article.featured_image_alt||article.title;image.decoding="async";image.hidden=false;}
      renderAuthorCard(article); renderSources(article); renderRelated(article); document.title=article.seo_title||`${article.title} | OffertaLogica`; const description=document.querySelector('meta[name="description"]'); if(description)description.content=article.seo_description||article.excerpt||"Approfondimento OffertaLogica."; if(articleView)articleView.setAttribute("aria-busy","false"); const status=document.querySelector("[data-article-status]"); if(status)status.textContent=`Articolo caricato: ${article.title}.`;
    }catch(error){ if(articleView)articleView.setAttribute("aria-busy","false"); show(errorBox,error.message); const status=document.querySelector("[data-article-status]"); if(status)status.textContent="Impossibile caricare l’articolo."; }
  }

  function workspaceFields(form){ return Object.fromEntries([...form.elements].filter(el=>el.name).map(el=>[el.name,el])); }
  async function initWorkspace(){
    const authPanel=document.querySelector("[data-auth-panel]"); const workspace=document.querySelector("[data-editorial-workspace]"); const configError=document.querySelector("[data-config-error]"); const loginForm=document.querySelector("[data-login-form]"); const loginError=document.querySelector("[data-login-error]");
    if(!configured()){ show(configError,"Configurazione Supabase editoriale mancante. Inserire esclusivamente URL progetto e publishable key in /public/assets/editorial-config.js. Non usare mai la service-role nel browser."); if(loginForm)loginForm.querySelector("button").disabled=true; return; }
    let session=sessionRead(); let context=null; let dirty=false; let slugTouched=false; let seoTitleTouched=false;
    const form=document.querySelector("[data-editorial-form]"); const fields=workspaceFields(form); const statusBadge=document.querySelector("[data-current-status]"); const saveMessage=document.querySelector("[data-save-message]"); const validation=document.querySelector("[data-validation-message]"); const categorySelect=form.querySelector("[data-category-select]"); const permissionSummary=document.querySelector("[data-member-permissions]");
    const ownProfile=setupOwnAuthorProfile(document.querySelector("[data-own-author-profile]"),{getSession:()=>session,getAuthor:()=>context?.author,onSaved:author=>{if(context)context.author=author;const name=document.querySelector("[data-member-name]");if(name)name.textContent=author.display_name||"Collaboratore";}});
    function perms(){return effectivePermissions(context?.member);}
    function currentEditable(){ const s=fields.status.value; return context?.member?.role!=="contributor" || s==="draft" || s==="changes_requested"; }
    function refreshSeoSuggestion(force=false){if(!fields.seo_title||!context||!can(context.member,"edit_seo"))return;if(force||!seoTitleTouched){fields.seo_title.value=suggestSeoTitle(fields.title?.value,fields.category?.value);initCounters(form);}}
    function setEditable(){ const enabled=currentEditable();const p=perms();applyPermissionVisibility(form,p);form.querySelectorAll("[data-requires-permission]").forEach(wrapper=>{const allowed=enabled&&Boolean(p[wrapper.dataset.requiresPermission]);wrapper.querySelectorAll("input,textarea,select,button").forEach(el=>{el.disabled=!allowed;});}); form.querySelector("[data-save-draft]").disabled=!enabled; form.querySelector("[data-send-review]").disabled=!enabled; document.querySelector("[data-new-article]").disabled=!can(context?.member,"create_articles"); }
    function resetForm(){ form.reset(); fields.id.value=""; fields.status.value="draft"; if(fields.slug)fields.slug.value="";if(fields.featured_image_url)fields.featured_image_url.value=""; slugTouched=false;seoTitleTouched=false;renderImagePreview(form,"");setStatusBadge(statusBadge,"draft"); document.querySelector("[data-form-title]").textContent="Nuovo articolo"; history.replaceState(null,"","/collaboratori"); const feedback=document.querySelector("[data-author-feedback]"); if(feedback){feedback.replaceChildren();const p=document.createElement("p");p.className="ol-muted";p.textContent="Se la redazione richiede modifiche, il feedback apparirà qui.";feedback.append(p);} dirty=false; setEditable(); initCounters(form); }
    function payloadFromForm(){ const p=perms();const out={};if(p.edit_title)out.title=text(fields.title.value,140);if(p.edit_slug)out.slug=normalizeSlug(fields.slug.value);if(p.edit_excerpt)out.excerpt=text(fields.excerpt.value,320);if(p.edit_content)out.content=text(fields.content.value,40000);if(p.edit_images){out.featured_image_url=text(fields.featured_image_url.value,1000)||null;out.featured_image_alt=text(fields.featured_image_alt?.value,180)||null;}if(p.edit_category)out.category=text(fields.category.value,80)||null;if(p.edit_sources)out.sources=text(fields.sources.value,4000)||null;if(p.edit_seo){out.seo_title=text(fields.seo_title.value,70)||null;out.seo_description=text(fields.seo_description.value,180)||null;}return out; }
    function validateForReview(){ const missing=[];if(!text(fields.content?.value,40000))missing.push("Contenuto");if(text(fields.featured_image_url?.value,1000)&&!text(fields.featured_image_alt?.value,180))missing.push("Testo alternativo immagine");return missing; }
    async function addNote(articleId){ const note=text(fields.editorial_note.value,2000); if(!note)return; await db("editorial_article_notes",{method:"POST",token:session.access_token,prefer:"return=minimal",body:{article_id:articleId,body:note,visibility:"author",created_by:session.user.id}}); fields.editorial_note.value=""; }
    async function saveDraft({silent=false}={}){ show(validation,""); show(saveMessage,""); if(!fields.id.value&&!can(context?.member,"create_articles")){show(validation,"Non hai il permesso di creare nuovi articoli.");return null;} const payload=payloadFromForm(); let article; try{ if(fields.id.value){const rows=await db(`editorial_articles?id=eq.${encodeURIComponent(fields.id.value)}&select=*`,{method:"PATCH",token:session.access_token,prefer:"return=representation",body:payload});article=rows?.[0];}else{const rows=await db("editorial_articles?select=*",{method:"POST",token:session.access_token,prefer:"return=representation",body:{...payload,status:"draft",author_id:context.author.id,created_by:session.user.id,updated_by:session.user.id}});article=rows?.[0];} if(!article)throw new Error("Salvataggio non confermato"); Object.entries({id:article.id,status:article.status,title:article.title||"",slug:article.slug||"",category:article.category||"",featured_image_url:article.featured_image_url||"",featured_image_alt:article.featured_image_alt||"",excerpt:article.excerpt||"",content:article.content||"",sources:article.sources||"",seo_title:article.seo_title||"",seo_description:article.seo_description||""}).forEach(([k,v])=>{if(fields[k])fields[k].value=v;});fields.id.value=article.id;fields.status.value=article.status;setStatusBadge(statusBadge,article.status);renderImagePreview(form,article.featured_image_url);await addNote(article.id);dirty=false;history.replaceState(null,"",`/collaboratori?id=${encodeURIComponent(article.id)}`);if(!silent)show(saveMessage,"Bozza salvata.");await loadList();return article;}catch(error){show(validation,`Salvataggio non riuscito: ${error.message}`);return null;} }
    async function sendReview(){ const missing=validateForReview(); if(missing.length){show(validation,`Completa prima: ${missing.join(", ")}.`);return;} const article=await saveDraft({silent:true});if(!article)return;try{const rows=await db(`editorial_articles?id=eq.${encodeURIComponent(article.id)}&select=*`,{method:"PATCH",token:session.access_token,prefer:"return=representation",body:{status:"in_review"}});const updated=rows?.[0];fields.status.value=updated?.status||"in_review";setStatusBadge(statusBadge,fields.status.value);dirty=false;setEditable();show(saveMessage,"Articolo inviato alla redazione per la revisione.");await loadList();}catch(error){show(validation,`Invio in revisione non riuscito: ${error.message}`);} }
    async function loadAuthorFeedback(articleId){const box=document.querySelector("[data-author-feedback]"); if(!box)return; box.replaceChildren();try{const rows=await db(`editorial_article_notes?select=id,body,created_by,created_at&article_id=eq.${encodeURIComponent(articleId)}&visibility=eq.author&order=created_at.desc`,{token:session.access_token});if(!rows?.length){const p=document.createElement("p");p.className="ol-muted";p.textContent="Nessun feedback della redazione.";box.append(p);return;}rows.forEach(note=>{const item=document.createElement("article");item.className="ol-note";const meta=document.createElement("small");meta.textContent=`${note.created_by===session.user.id?"Tu":"Redazione"} · ${formatDate(note.created_at)}`;const body=document.createElement("p");body.textContent=note.body;item.append(meta,body);box.append(item);});}catch(error){const p=document.createElement("p");p.className="ol-muted";p.textContent=`Feedback non disponibile: ${error.message}`;box.append(p);}}
    async function loadList(){ const box=document.querySelector("[data-my-articles]"); const rows=await db(`editorial_articles?select=id,title,status,updated_at&created_by=eq.${encodeURIComponent(session.user.id)}&order=updated_at.desc&limit=100`,{token:session.access_token});box.replaceChildren();if(!rows.length){const p=document.createElement("p");p.className="ol-muted";p.textContent="Nessun articolo ancora.";box.append(p);return;}rows.forEach(row=>{const a=document.createElement("a");a.className="ol-my-article";a.href=`/collaboratori?id=${encodeURIComponent(row.id)}`;if(row.id===fields.id.value)a.setAttribute("aria-current","true");const strong=document.createElement("strong");strong.textContent=row.title||"Senza titolo";const span=document.createElement("span");span.textContent=`${STATUS_LABELS[row.status]||row.status} · ${formatDate(row.updated_at)}`;a.append(strong,span);box.append(a);}); }
    async function loadArticle(id){ const safe=String(id||"").replace(/[^a-f0-9-]/gi,"");if(!safe)return resetForm();const rows=await db(`editorial_articles?select=*&id=eq.${encodeURIComponent(safe)}&created_by=eq.${encodeURIComponent(session.user.id)}&limit=1`,{token:session.access_token});const article=rows?.[0];if(!article)return resetForm();Object.entries({id:article.id,status:article.status,title:article.title,slug:article.slug,category:article.category||"",featured_image_url:article.featured_image_url||"",featured_image_alt:article.featured_image_alt||"",excerpt:article.excerpt||"",content:article.content||"",sources:article.sources||"",seo_title:article.seo_title||"",seo_description:article.seo_description||""}).forEach(([k,v])=>{if(fields[k])fields[k].value=v??"";});fields.editorial_note.value="";slugTouched=true;seoTitleTouched=Boolean(article.seo_title);renderImagePreview(form,article.featured_image_url);document.querySelector("[data-form-title]").textContent=article.title||"Articolo";setStatusBadge(statusBadge,article.status);await loadAuthorFeedback(article.id);dirty=false;setEditable();initCounters(form); }
    async function loadContext(){ const members=await db(`editorial_members?select=user_id,role,active,permissions&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`,{token:session.access_token});const member=members?.[0];if(!member?.active)throw new Error("Account non abilitato dalla redazione");const authors=await db(`editorial_authors?select=id,user_id,slug,display_name,bio,avatar_url,website_url,linkedin_url,active&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`,{token:session.access_token});const author=authors?.[0];if(!author?.active)throw new Error("Profilo autore non abilitato");context={member,author};document.querySelector("[data-member-name]").textContent=author.display_name||"Collaboratore";document.querySelector("[data-member-role]").textContent=roleLabel(member.role);document.querySelector("[data-member-email]").textContent=session.user.email||"";renderPermissionSummary(permissionSummary,member);authPanel.hidden=true;workspace.hidden=false;ownProfile.load(author);await loadCategoryOptions(categorySelect,session.access_token);await loadList();const id=new URLSearchParams(location.search).get("id");if(id)await loadArticle(id);else resetForm(); }
    async function activate(){if(!session?.access_token||!session?.user?.id)return;try{await loadContext();}catch(error){sessionWrite(null);session=null;context=null;authPanel.hidden=false;workspace.hidden=true;show(loginError,error.message);}}
    wireImageUploader(form,fields,()=>session,()=>fields.title?.value||"immagine",()=>{dirty=true;});
    loginForm.addEventListener("submit",async event=>{event.preventDefault();show(loginError,"");const button=loginForm.querySelector("[data-login-button]");button.disabled=true;try{const data=await login(text(loginForm.email.value,320),String(loginForm.password.value||""));session={access_token:data.access_token,user:data.user,expires_at:data.expires_at};sessionWrite(session);await activate();}catch(error){show(loginError,`Accesso non riuscito: ${error.message}`);}finally{button.disabled=false;}});
    document.querySelector("[data-logout]").addEventListener("click",()=>{sessionWrite(null);location.replace("/collaboratori");});document.querySelector("[data-new-article]").addEventListener("click",resetForm);form.querySelector("[data-save-draft]").addEventListener("click",()=>saveDraft());form.querySelector("[data-send-review]").addEventListener("click",sendReview);
    fields.slug?.addEventListener("input",()=>{slugTouched=true;fields.slug.value=normalizeSlug(fields.slug.value);dirty=true;});fields.title?.addEventListener("input",()=>{if(!slugTouched)fields.slug.value=normalizeSlug(fields.title.value);refreshSeoSuggestion();dirty=true;});fields.category?.addEventListener("change",()=>{refreshSeoSuggestion();dirty=true;});fields.seo_title?.addEventListener("input",()=>{seoTitleTouched=true;dirty=true;});form.querySelector("[data-suggest-seo-title]")?.addEventListener("click",()=>{seoTitleTouched=false;refreshSeoSuggestion(true);seoTitleTouched=true;dirty=true;});form.querySelectorAll("input,textarea,select").forEach(el=>el.addEventListener("change",()=>dirty=true));form.addEventListener("submit",event=>event.preventDefault());window.addEventListener("beforeunload",event=>{if(dirty){event.preventDefault();event.returnValue="";}});if(session)await activate();
  }


  async function initReview(){
    const authPanel=document.querySelector("[data-review-auth-panel]");
    const workspace=document.querySelector("[data-review-workspace]");
    const configError=document.querySelector("[data-review-config-error]");
    const loginForm=document.querySelector("[data-review-login-form]");
    const loginError=document.querySelector("[data-review-login-error]");
    if(!configured()){show(configError,"Configurazione Supabase editoriale mancante.");if(loginForm)loginForm.querySelector("button").disabled=true;return;}

    let session=sessionRead();let member=null;let ownAuthor=null;let currentArticle=null;let dirty=false;let slugTouched=false;let seoTitleTouched=false;
    const form=document.querySelector("[data-review-form]");const empty=document.querySelector("[data-review-empty]");const fields=workspaceFields(form);const statusBadge=document.querySelector("[data-review-current-status]");const saveMessage=document.querySelector("[data-review-save-message]");const validation=document.querySelector("[data-review-validation]");const filter=document.querySelector("[data-review-status-filter]");const scope=document.querySelector("[data-review-scope-filter]");const list=document.querySelector("[data-review-list]");const count=document.querySelector("[data-review-count]");const newButton=document.querySelector("[data-review-new]");const authorWarning=document.querySelector("[data-review-author-warning]");
    const categorySelect=form.querySelector("[data-category-select]");
    const adminTeam=document.querySelector("[data-admin-team]");const adminError=document.querySelector("[data-admin-error]");const adminSuccess=document.querySelector("[data-admin-success]");const adminInviteForm=document.querySelector("[data-admin-invite-form]");const adminPeople=document.querySelector("[data-admin-people]");const adminAuthorProfiles=document.querySelector("[data-admin-author-profiles]");const adminInvitations=document.querySelector("[data-admin-invitations]");const adminInviteResult=document.querySelector("[data-admin-invite-result]");const adminInviteLink=document.querySelector("[data-admin-invite-link]");const adminEmailInvite=document.querySelector("[data-admin-email-invite]");const invitePermissions=document.querySelector("[data-invite-permissions]");const adminCategoryForm=document.querySelector("[data-admin-category-form]");const adminCategories=document.querySelector("[data-admin-categories]");
    const ownProfile=setupOwnAuthorProfile(document.querySelector("[data-own-author-profile]"),{getSession:()=>session,getAuthor:()=>ownAuthor,onSaved:author=>{ownAuthor=author;const name=document.querySelector("[data-review-name]");if(name)name.textContent=author.display_name||"Redazione OffertaLogica Informa";}});
    let categorySlugTouched=false;

    function safeId(value){return String(value||"").replace(/[^a-f0-9-]/gi,"");}
    function perms(){return effectivePermissions(member);}
    function isOwnArticle(){return Boolean(currentArticle?.created_by&&currentArticle.created_by===session?.user?.id);}
    function canEditOtherArticle(){return member?.role==="admin"||can(member,"review_articles");}
    function queueUrl(id=""){const params=new URLSearchParams();params.set("scope",scope.value);params.set("status",filter.value);if(id)params.set("id",id);return `/redazione?${params.toString()}`;}
    function refreshSeoSuggestion(force=false){if(!fields.seo_title||!member||!can(member,"edit_seo"))return;if(force||!seoTitleTouched){fields.seo_title.value=suggestSeoTitle(fields.title?.value,fields.category?.value);initCounters(form);}}
    function reviewPayload(){
      const p=perms();const out={};
      if(p.edit_title)out.title=text(fields.title.value,140);
      if(p.edit_slug)out.slug=normalizeSlug(fields.slug.value);
      if(p.edit_category)out.category=text(fields.category.value,80)||null;
      if(p.edit_images){out.featured_image_url=text(fields.featured_image_url.value,1000)||null;out.featured_image_alt=text(fields.featured_image_alt.value,180)||null;}
      if(p.edit_excerpt)out.excerpt=text(fields.excerpt.value,320);
      if(p.edit_content)out.content=text(fields.content.value,40000);
      if(p.edit_sources)out.sources=text(fields.sources.value,4000)||null;
      if(p.edit_seo){out.seo_title=text(fields.seo_title.value,70)||null;out.seo_description=text(fields.seo_description.value,180)||null;}
      return out;
    }
    function validateArticle({forPublish=false,forApproval=false,forReview=false}={}){
      const missing=[];
      if(forReview&&!text(fields.content.value,40000))missing.push("Contenuto");
      if(forApproval||forPublish){if(!text(fields.title.value,140))missing.push("Titolo");if(!normalizeSlug(fields.slug.value))missing.push("Slug");if(!text(fields.excerpt.value,320))missing.push("Sommario");if(!text(fields.content.value,40000))missing.push("Contenuto");if(!text(fields.category.value,80))missing.push("Categoria");if(text(fields.featured_image_url.value,1000)&&!text(fields.featured_image_alt.value,180))missing.push("Testo alternativo immagine");}
      if(forPublish){if(!text(fields.seo_title.value,70))missing.push("Titolo SEO");if(!text(fields.seo_description.value,180))missing.push("Descrizione SEO");}
      return [...new Set(missing)];
    }
    function clearMessages(){show(saveMessage,"");show(validation,"");}
    function renderEmptyNotes(message="Nessuna nota."){const box=document.querySelector("[data-review-notes]");box.replaceChildren();const p=document.createElement("p");p.className="ol-muted";p.textContent=message;box.append(p);}
    function applyReviewFieldState(){
      const p=perms();applyPermissionVisibility(form,p);const articleEditable=!currentArticle||isOwnArticle()||canEditOtherArticle();
      form.querySelectorAll("[data-requires-permission]").forEach(wrapper=>{const allowed=Boolean(p[wrapper.dataset.requiresPermission])&&articleEditable;wrapper.querySelectorAll("input,textarea,select").forEach(el=>{el.disabled=!allowed;});});
      setActionState();
    }
    function setActionState(){
      const status=fields.status.value;const own=isOwnArticle()||(!fields.id.value&&Boolean(ownAuthor));const editorSelfReview=member?.role==="editor"&&own;
      form.querySelector("[data-review-save]").disabled=Boolean(currentArticle&&!own&&!canEditOtherArticle());
      form.querySelector("[data-review-submit]").disabled=!(own&&["draft","changes_requested"].includes(status));
      form.querySelector("[data-review-changes]").disabled=!can(member,"review_articles")||editorSelfReview||!(["in_review","approved"].includes(status));
      form.querySelector("[data-review-approve]").disabled=!can(member,"approve_articles")||editorSelfReview||status!=="in_review";
      form.querySelector("[data-review-publish]").disabled=!can(member,"publish_articles")||status!=="approved";
      form.querySelector("[data-review-archive]").disabled=!can(member,"archive_articles")||!(["in_review","changes_requested","approved","published"].includes(status)||(status==="draft"&&(member?.role==="admin"||own)));
      const approve=form.querySelector("[data-review-approve]");approve.title=editorSelfReview?"Un editor non può approvare un articolo scritto da sé.":"";
      const publicLink=form.querySelector("[data-review-public-link]");if(status==="published"&&fields.slug.value){publicLink.href=`/articolo.html?slug=${encodeURIComponent(fields.slug.value)}`;publicLink.hidden=false;}else publicLink.hidden=true;
    }
    function populateArticle(article,author){
      currentArticle=article;slugTouched=true;seoTitleTouched=Boolean(article.seo_title);
      Object.entries({id:article.id,status:article.status,title:article.title||"",slug:article.slug||"",category:article.category||"",featured_image_url:article.featured_image_url||"",featured_image_alt:article.featured_image_alt||"",excerpt:article.excerpt||"",content:article.content||"",sources:article.sources||"",seo_title:article.seo_title||"",seo_description:article.seo_description||""}).forEach(([key,value])=>{if(fields[key])fields[key].value=value;});renderImagePreview(form,article.featured_image_url);
      document.querySelector("[data-review-mode]").textContent=isOwnArticle()?"Il mio articolo":"Revisione editoriale";document.querySelector("[data-review-form-title]").textContent=article.title||"Bozza senza titolo";document.querySelector("[data-review-author]").textContent=author?.display_name||"Autore non disponibile";document.querySelector("[data-review-submitted]").textContent=formatDate(article.submitted_at)||"—";document.querySelector("[data-review-updated]").textContent=formatDate(article.updated_at)||"—";setStatusBadge(statusBadge,article.status);form.hidden=false;empty.hidden=true;dirty=false;initCounters(form);applyReviewFieldState();
    }
    async function startNewArticle(){
      if(!ownAuthor){show(authorWarning,"Per scrivere un articolo serve un profilo autore attivo associato a questo account.");return;}if(!can(member,"create_articles")){show(authorWarning,"L’amministratore non ti ha assegnato il permesso di creare articoli.");return;}if(dirty&&!window.confirm("Hai modifiche non salvate. Creare comunque un nuovo articolo?"))return;
      clearMessages();currentArticle=null;slugTouched=false;seoTitleTouched=false;form.reset();fields.id.value="";fields.status.value="draft";if(fields.featured_image_url)fields.featured_image_url.value="";renderImagePreview(form,"");scope.value="mine";filter.value="draft";document.querySelector("[data-review-mode]").textContent="Nuovo articolo personale";document.querySelector("[data-review-form-title]").textContent="Nuovo articolo";document.querySelector("[data-review-author]").textContent=ownAuthor.display_name||"Autore";document.querySelector("[data-review-submitted]").textContent="—";document.querySelector("[data-review-updated]").textContent="—";fields.review_note.value="";fields.review_note_visibility.value="internal";setStatusBadge(statusBadge,"draft");renderEmptyNotes("Le note saranno disponibili dopo il primo salvataggio.");form.hidden=false;empty.hidden=true;dirty=false;applyReviewFieldState();initCounters(form);history.replaceState(null,"",queueUrl());await loadQueue();const target=form.querySelector('[data-requires-permission="edit_content"] textarea')||form.querySelector('input:not([type="hidden"]),textarea');target?.focus();
    }
    async function loadNotes(article){
      const box=document.querySelector("[data-review-notes]");box.replaceChildren();try{const rows=await db(`editorial_article_notes?select=id,body,visibility,created_by,created_at&article_id=eq.${encodeURIComponent(article.id)}&order=created_at.asc`,{token:session.access_token});if(!rows?.length){renderEmptyNotes();return;}rows.forEach(note=>{const item=document.createElement("article");item.className="ol-note";const meta=document.createElement("small");const who=note.created_by===session.user.id?"Tu":(note.created_by===article.created_by?"Autore":"Redazione");meta.textContent=`${who} · ${note.visibility==="internal"?"nota interna":"visibile all’autore"} · ${formatDate(note.created_at)}`;const body=document.createElement("p");body.textContent=note.body;item.append(meta,body);box.append(item);});}catch(error){renderEmptyNotes(`Note non disponibili: ${error.message}`);}
    }
    async function loadQueue(){
      list.replaceChildren();const loading=document.createElement("p");loading.className="ol-muted";loading.textContent="Caricamento…";list.append(loading);const status=filter.value;const statusPart=status==="all"?"":`&status=eq.${encodeURIComponent(status)}`;const scopePart=scope.value==="mine"?`&created_by=eq.${encodeURIComponent(session.user.id)}`:"";
      try{const rows=await db(`editorial_articles?select=id,title,status,author_id,created_by,submitted_at,updated_at,published_at&order=updated_at.desc&limit=200${statusPart}${scopePart}`,{token:session.access_token});const authors=await fetchAuthors((rows||[]).map(row=>row.author_id),session.access_token);list.replaceChildren();count.textContent=`${rows.length} ${rows.length===1?"articolo":"articoli"} · ${scope.value==="mine"?"i miei":"tutti"}`;if(!rows.length){const p=document.createElement("p");p.className="ol-muted";p.textContent="Nessun articolo con questi filtri.";list.append(p);return;}rows.forEach(row=>{const a=document.createElement("a");a.className="ol-my-article";a.href=queueUrl(row.id);if(row.id===fields.id.value)a.setAttribute("aria-current","true");const strong=document.createElement("strong");strong.textContent=row.title||"Bozza senza titolo";const author=authors.get(row.author_id);const span=document.createElement("span");span.textContent=`${STATUS_LABELS[row.status]||row.status} · ${author?.display_name||"Autore"} · ${formatDate(row.updated_at)}`;a.append(strong,span);list.append(a);});}
      catch(error){list.replaceChildren();show(configError,`Coda editoriale non disponibile: ${error.message}`);}
    }
    async function loadArticle(id){
      const safe=safeId(id);if(!safe)return;clearMessages();const rows=await db(`editorial_articles?select=*&id=eq.${encodeURIComponent(safe)}&limit=1`,{token:session.access_token});const article=rows?.[0];if(!article){show(configError,"Articolo non trovato o non accessibile con i tuoi permessi.");return;}await loadCategoryOptions(categorySelect,session.access_token);const authors=await fetchAuthors([article.author_id],session.access_token);populateArticle(article,authors.get(article.author_id));fields.review_note.value="";fields.review_note_visibility.value="author";await loadNotes(article);
    }
    async function addStandaloneNote(articleId){const note=text(fields.review_note.value,2000);if(!note)return;await db("editorial_article_notes",{method:"POST",token:session.access_token,prefer:"return=minimal",body:{article_id:articleId,body:note,visibility:fields.review_note_visibility.value==="internal"?"internal":"author",created_by:session.user.id}});fields.review_note.value="";}
    async function saveArticle({silent=false,saveNote=true}={}){
      clearMessages();if(!fields.id.value&&!can(member,"create_articles")){show(validation,"Non hai il permesso di creare articoli.");return null;}
      try{let article;const payload=reviewPayload();if(fields.id.value){const rows=await db(`editorial_articles?id=eq.${encodeURIComponent(fields.id.value)}&select=*`,{method:"PATCH",token:session.access_token,prefer:"return=representation",body:payload});article=rows?.[0];}else{if(!ownAuthor)throw new Error("Profilo autore non disponibile per questo account");const rows=await db("editorial_articles?select=*",{method:"POST",token:session.access_token,prefer:"return=representation",body:{...payload,status:"draft",author_id:ownAuthor.id,created_by:session.user.id,updated_by:session.user.id}});article=rows?.[0];}if(!article)throw new Error("Salvataggio non confermato");fields.id.value=article.id;fields.status.value=article.status;currentArticle=article;if(saveNote&&text(fields.review_note.value,2000))await addStandaloneNote(article.id);dirty=false;slugTouched=true;history.replaceState(null,"",queueUrl(article.id));if(!silent)show(saveMessage,article.status==="published"?"Modifiche salvate. La versione HTML SEO sarà aggiornata al prossimo deploy.":"Articolo salvato.");const authors=await fetchAuthors([article.author_id],session.access_token);populateArticle(article,authors.get(article.author_id));await loadQueue();await loadNotes(article);return article;}
      catch(error){show(validation,`Salvataggio non riuscito: ${error.message}`);return null;}
    }
    async function transition(target){
      clearMessages();const own=isOwnArticle()||(!fields.id.value&&Boolean(ownAuthor));if(member?.role==="editor"&&own&&["changes_requested","approved"].includes(target)){show(validation,"Un editor non può revisionare o approvare un articolo scritto da sé. Deve farlo un altro editor o un admin.");return;}if(target==="changes_requested"&&!text(fields.review_note.value,2000)){show(validation,"Scrivi il feedback da inviare all’autore prima di richiedere modifiche.");fields.review_note.focus();return;}
      if(target==="published"&&can(member,"edit_seo")){if(!fields.seo_title.value.trim())fields.seo_title.value=suggestSeoTitle(fields.title.value,fields.category.value);if(!fields.seo_description.value.trim())fields.seo_description.value=text(fields.excerpt.value,180);}
      const missing=validateArticle({forPublish:target==="published",forApproval:target==="approved",forReview:target==="in_review"});if(missing.length){show(validation,`Completa prima: ${missing.join(", ")}.`);return;}if(target==="published"&&!window.confirm("Pubblicare questo articolo? Diventerà visibile nell’archivio pubblico."))return;if(target==="archived"&&!window.confirm("Archiviare questo articolo?"))return;
      const article=await saveArticle({silent:true,saveNote:false});if(!article)return;const note=text(fields.review_note.value,2000)||null;const visibility=target==="changes_requested"?"author":(fields.review_note_visibility.value==="internal"?"internal":"author");
      try{await db("rpc/editorial_staff_transition_article",{method:"POST",token:session.access_token,body:{p_article_id:article.id,p_status:target,p_feedback:note,p_visibility:visibility}});fields.review_note.value="";dirty=false;const messages={in_review:"Articolo inviato in revisione.",changes_requested:"Modifiche richieste all’autore.",approved:"Articolo approvato.",published:"Articolo pubblicato. La versione HTML SEO sarà rigenerata al prossimo deploy.",archived:"Articolo archiviato."};show(saveMessage,messages[target]||"Stato aggiornato.");await loadArticle(article.id);await loadQueue();}
      catch(error){show(validation,`Cambio stato non riuscito: ${error.message}`);}
    }
    function adminMessage(error="",success=""){show(adminError,error);show(adminSuccess,success);}
    function statusPill(state,label){const span=document.createElement("span");span.className="ol-status-pill";span.dataset.state=state;span.textContent=label;return span;}
    function inviteState(row){if(row.used_at)return ["used","Utilizzato"];if(row.revoked_at)return ["revoked","Revocato"];if(new Date(row.expires_at).getTime()<=Date.now())return ["expired","Scaduto"];return ["pending","In attesa"];}
    function permissionCount(values,role){const normalized=effectivePermissions({role,permissions:values});return PERMISSION_DEFS.filter(def=>normalized[def.key]&&!(role==="contributor"&&def.editorOnly)).length;}
    function memberEditor(row){
      const details=document.createElement("details");details.className="ol-member-settings";const summary=document.createElement("summary");summary.textContent="Ruolo e permessi";details.append(summary);const inner=document.createElement("div");inner.className="ol-form ol-permission-editor";
      const roleField=document.createElement("div");roleField.className="ol-field";const roleLabelEl=document.createElement("label");roleLabelEl.textContent="Ruolo";const roleSelect=document.createElement("select");roleSelect.dataset.memberRoleSelect=row.user_id;[["contributor","Collaboratore"],["editor","Editor"]].forEach(([value,label])=>{const option=document.createElement("option");option.value=value;option.textContent=label;roleSelect.append(option);});roleSelect.value=row.role;roleField.append(roleLabelEl,roleSelect);
      const activeLabel=document.createElement("label");activeLabel.className="ol-permission-option";const active=document.createElement("input");active.type="checkbox";active.checked=Boolean(row.active);active.dataset.memberActiveInput=row.user_id;const activeCopy=document.createElement("span");const activeStrong=document.createElement("strong");activeStrong.textContent="Accesso attivo";const activeSmall=document.createElement("small");activeSmall.textContent="Se disattivato, l’utente non può usare l’area editoriale.";activeCopy.append(activeStrong,activeSmall);activeLabel.append(active,activeCopy);
      const permBox=document.createElement("fieldset");permBox.className="ol-permission-box";const legend=document.createElement("legend");legend.textContent="Permessi";const grid=document.createElement("div");grid.className="ol-permission-grid";grid.dataset.memberPermissionGrid=row.user_id;permBox.append(legend,grid);renderPermissionGrid(grid,row.role,effectivePermissions(row));
      const save=document.createElement("button");save.type="button";save.className="ol-button ol-button-primary ol-button-small";save.dataset.saveMember=row.user_id;save.textContent="Salva ruolo e permessi";
      roleSelect.addEventListener("change",()=>{const current=permissionValuesFromContainer(grid,row.role);const next=permissionDefaults(roleSelect.value);PERMISSION_DEFS.forEach(def=>{if(typeof current[def.key]==="boolean"&&!def.editorOnly)next[def.key]=current[def.key];});renderPermissionGrid(grid,roleSelect.value,next);});
      inner.append(roleField,activeLabel,permBox,save);details.append(inner);return details;
    }
    function renderAdminPeople(rows){
      adminPeople.replaceChildren();if(!rows?.length){const p=document.createElement("p");p.className="ol-muted";p.textContent="Nessuna persona abilitata.";adminPeople.append(p);return;}
      rows.forEach(row=>{const item=document.createElement("article");item.className="ol-team-item";const head=document.createElement("div");head.className="ol-team-item-head";const info=document.createElement("div");const strong=document.createElement("strong");strong.textContent=row.display_name||row.email||"Utente";const small=document.createElement("small");small.textContent=`${row.email||""} · ${row.author_slug?`/autori/${row.author_slug}.html · `:""}${roleLabel(row.role)} · ${permissionCount(row.permissions,row.role)} permessi`;info.append(strong,small);head.append(info,statusPill(row.active?"active":"inactive",row.active?"Attivo":"Disattivato"));item.append(head);if(row.role==="admin"){const p=document.createElement("p");p.className="ol-muted ol-small";p.textContent="Gli amministratori hanno tutti i permessi.";item.append(p);}else item.append(memberEditor(row));adminPeople.append(item);});
    }
    function renderAdminAuthorProfiles(rows){
      if(!adminAuthorProfiles)return;adminAuthorProfiles.replaceChildren();if(!rows?.length){const p=document.createElement("p");p.className="ol-muted";p.textContent="Nessun profilo autore.";adminAuthorProfiles.append(p);return;}
      rows.forEach(row=>{const item=document.createElement("article");item.className="ol-team-item ol-admin-author-profile";item.dataset.authorProfileId=row.id;const head=document.createElement("div");head.className="ol-team-item-head";const info=document.createElement("div");const strong=document.createElement("strong");strong.textContent=row.display_name||"Autore";const small=document.createElement("small");small.textContent=`/autori/${row.slug}.html · ${Number(row.article_count||0)} articoli`;info.append(strong,small);head.append(info,statusPill(row.active?"active":"inactive",row.active?"Attivo":"Disattivato"));item.append(head);
        const grid=document.createElement("div");grid.className="ol-admin-author-fields";const makeField=(label,name,value,type="text",max=500)=>{const wrap=document.createElement("label");wrap.className="ol-field";const span=document.createElement("span");span.textContent=label;let input;if(type==="textarea"){input=document.createElement("textarea");}else{input=document.createElement("input");input.type=type;}input.name=name;input.value=value||"";input.maxLength=max;wrap.append(span,input);return wrap;};grid.append(makeField("Nome pubblico","display_name",row.display_name,"text",120),makeField("Biografia","bio",row.bio,"textarea",700),makeField("URL foto","avatar_url",row.avatar_url,"url",1000),makeField("LinkedIn","linkedin_url",row.linkedin_url,"url",500),makeField("Sito personale","website_url",row.website_url,"url",500));item.append(grid);
        const activeLabel=document.createElement("label");activeLabel.className="ol-permission-option";const active=document.createElement("input");active.type="checkbox";active.name="active";active.checked=Boolean(row.active);activeLabel.append(active,document.createTextNode(" Profilo attivo"));item.append(activeLabel);const actions=document.createElement("div");actions.className="ol-team-actions";const save=document.createElement("button");save.type="button";save.className="ol-button ol-button-secondary ol-button-small";save.dataset.saveAuthorProfile=row.id;save.textContent="Salva profilo";const del=document.createElement("button");del.type="button";del.className="ol-button ol-button-danger ol-button-small";del.dataset.deleteAuthorProfile=row.id;del.disabled=Number(row.article_count||0)>0;del.title=del.disabled?"Prima riassegna gli articoli di questo autore.":"Elimina definitivamente il profilo autore";del.textContent="Elimina profilo";actions.append(save,del);item.append(actions);adminAuthorProfiles.append(item);});
    }
    function renderAdminInvitations(rows){
      adminInvitations.replaceChildren();if(!rows?.length){const p=document.createElement("p");p.className="ol-muted";p.textContent="Nessun invito creato.";adminInvitations.append(p);return;}
      rows.forEach(row=>{const item=document.createElement("article");item.className="ol-team-item";const head=document.createElement("div");head.className="ol-team-item-head";const info=document.createElement("div");const strong=document.createElement("strong");strong.textContent=row.display_name||row.email;const small=document.createElement("small");small.textContent=`${row.email} · ${roleLabel(row.role)} · ${permissionCount(row.permissions,row.role)} permessi · scadenza ${formatDate(row.expires_at)}`;info.append(strong,small);const [state,label]=inviteState(row);head.append(info,statusPill(state,label));item.append(head);if(state==="pending"){const actions=document.createElement("div");actions.className="ol-team-actions";const revoke=document.createElement("button");revoke.type="button";revoke.className="ol-button ol-button-danger ol-button-small";revoke.dataset.revokeInvitation=row.id;revoke.textContent="Revoca";actions.append(revoke);item.append(actions);}adminInvitations.append(item);});
    }
    function renderAdminCategories(rows){
      if(!adminCategories)return;adminCategories.replaceChildren();if(!rows?.length){const p=document.createElement("p");p.className="ol-muted";p.textContent="Nessuna categoria.";adminCategories.append(p);return;}
      rows.forEach(row=>{const item=document.createElement("article");item.className="ol-team-item ol-category-row";const info=document.createElement("div");const strong=document.createElement("strong");strong.textContent=row.name;const small=document.createElement("small");small.textContent=`${row.slug} · ${row.active?"attiva":"non attiva"}`;info.append(strong,small);const actions=document.createElement("div");actions.className="ol-team-actions";const edit=document.createElement("button");edit.type="button";edit.className="ol-button ol-button-secondary ol-button-small";edit.dataset.editCategory=row.id;edit.dataset.categoryName=row.name;edit.dataset.categorySlug=row.slug;edit.dataset.categoryCurrentActive=String(Boolean(row.active));edit.textContent="Modifica";const toggle=document.createElement("button");toggle.type="button";toggle.className="ol-button ol-button-secondary ol-button-small";toggle.dataset.toggleCategory=row.id;toggle.dataset.categoryName=row.name;toggle.dataset.categorySlug=row.slug;toggle.dataset.categoryActive=String(!row.active);toggle.textContent=row.active?"Disattiva":"Riattiva";actions.append(edit,toggle);item.append(info,actions);adminCategories.append(item);});
    }
    async function loadAdminPanel(){
      if(member?.role!=="admin"||!adminTeam)return;adminMessage();
      try{
        const [people,invitations,categories]=await Promise.all([
          db("rpc/editorial_admin_list_people",{method:"POST",token:session.access_token,body:{}}),
          db("rpc/editorial_admin_list_invitations",{method:"POST",token:session.access_token,body:{}}),
          db("rpc/editorial_admin_list_categories",{method:"POST",token:session.access_token,body:{}})
        ]);
        renderAdminPeople(people||[]);renderAdminInvitations(invitations||[]);renderAdminCategories(categories||[]);await loadCategoryOptions(categorySelect,session.access_token);
      }catch(error){adminMessage(`Gestione amministrativa non disponibile: ${error.message}`);return;}
      if(adminAuthorProfiles){
        try{const authorProfiles=await db("rpc/editorial_admin_list_author_profiles",{method:"POST",token:session.access_token,body:{}});renderAdminAuthorProfiles(authorProfiles||[]);}
        catch(error){adminAuthorProfiles.replaceChildren();const p=document.createElement("p");p.className="ol-alert ol-alert-warning ol-small";p.textContent=`Profili autori non disponibili: ${error.message}`;adminAuthorProfiles.append(p);}
      }
    }
    async function createAdminInvitation(event){
      event.preventDefault();adminMessage();const fd=new FormData(adminInviteForm);const email=text(fd.get("email"),320).toLowerCase();const displayName=text(fd.get("display_name"),120);const role=text(fd.get("role"),20);const authorSlug=normalizeSlug(displayName);const permissions=permissionValuesFromContainer(invitePermissions,role);if(!email||!displayName){adminMessage("Completa email e nome pubblico.");return;}const button=adminInviteForm.querySelector('button[type="submit"]');button.disabled=true;
      try{const result=await db("rpc/editorial_admin_create_invitation",{method:"POST",token:session.access_token,body:{p_email:email,p_display_name:displayName,p_role:role,p_author_slug:authorSlug,p_permissions:permissions}});if(!result?.token)throw new Error("Invito non confermato");const link=`${location.origin}/registrazione-editoriale?invite=${encodeURIComponent(result.token)}`;adminInviteLink.value=link;adminInviteResult.hidden=false;const subject="Invito a OffertaLogica Informa";const body=`Ciao ${displayName},

ti ho invitato nella redazione OffertaLogica Informa con ruolo ${roleLabel(role)}.

Apri questo link personale per creare il tuo account e scegliere la password:
${link}

Il link è monouso e scade dopo 7 giorni.
`;adminEmailInvite.href=`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;adminInviteForm.reset();const slugPreview=document.querySelector("[data-author-slug-preview]");if(slugPreview)slugPreview.textContent="L’indirizzo pubblico dell’autore verrà creato automaticamente dal nome.";renderPermissionGrid(invitePermissions,"contributor",permissionDefaults("contributor"));adminMessage("","Invito creato. Ora puoi copiare il link oppure aprire l’email già compilata.");await loadAdminPanel();}
      catch(error){adminMessage(`Invito non creato: ${error.message}`);}finally{button.disabled=false;}
    }
    async function saveAdminMember(button){
      const id=safeId(button.dataset.saveMember);if(!id)return;const card=button.closest(".ol-team-item");const role=card.querySelector(`[data-member-role-select="${CSS.escape(id)}"]`)?.value;const active=Boolean(card.querySelector(`[data-member-active-input="${CSS.escape(id)}"]`)?.checked);const grid=card.querySelector(`[data-member-permission-grid="${CSS.escape(id)}"]`);const permissions=permissionValuesFromContainer(grid,role);if(!window.confirm(`Salvare ruolo ${roleLabel(role)}, stato ${active?"attivo":"disattivato"} e permessi?`))return;adminMessage();button.disabled=true;try{await db("rpc/editorial_admin_update_member",{method:"POST",token:session.access_token,body:{p_user_id:id,p_role:role,p_active:active,p_permissions:permissions}});adminMessage("","Utente aggiornato.");await loadAdminPanel();}catch(error){adminMessage(`Aggiornamento non riuscito: ${error.message}`);}finally{button.disabled=false;}
    }
    async function saveAdminAuthorProfile(button){
      const id=safeId(button.dataset.saveAuthorProfile);if(!id)return;const card=button.closest("[data-author-profile-id]");if(!card)return;const value=name=>card.querySelector(`[name="${name}"]`)?.value||"";const displayName=text(value("display_name"),120);if(!displayName){adminMessage("Il nome pubblico autore è obbligatorio.");return;}let linkedin="",website="";try{linkedin=normalizeHttpsUrl(value("linkedin_url"),{linkedin:true});website=normalizeHttpsUrl(value("website_url"));}catch(e){adminMessage(e.message);return;}let avatar="";try{avatar=normalizeHttpsUrl(value("avatar_url"),{max:1000});}catch(e){adminMessage(`URL foto: ${e.message}`);return;}button.disabled=true;adminMessage();try{await db("rpc/editorial_admin_update_author_profile",{method:"POST",token:session.access_token,body:{p_author_id:id,p_display_name:displayName,p_bio:text(value("bio"),700)||null,p_avatar_url:avatar||null,p_website_url:website||null,p_linkedin_url:linkedin||null,p_active:Boolean(card.querySelector('[name="active"]')?.checked)}});adminMessage("","Profilo autore aggiornato.");await loadAdminPanel();}catch(e){adminMessage(`Profilo non aggiornato: ${e.message}`);}finally{button.disabled=false;}
    }
    async function deleteAdminAuthorProfile(button){const id=safeId(button.dataset.deleteAuthorProfile);if(!id)return;const card=button.closest("[data-author-profile-id]");const name=card?.querySelector('[name="display_name"]')?.value||"questo autore";if(!window.confirm(`Eliminare definitivamente il profilo di ${name}? Questa operazione è consentita solo se non ha articoli associati.`))return;button.disabled=true;adminMessage();try{await db("rpc/editorial_admin_delete_author_profile",{method:"POST",token:session.access_token,body:{p_author_id:id}});adminMessage("","Profilo autore eliminato. L’account editoriale, se presente, non è stato cancellato.");await loadAdminPanel();}catch(e){adminMessage(`Profilo non eliminato: ${e.message}`);}finally{button.disabled=false;}}
    async function revokeAdminInvitation(button){const id=safeId(button.dataset.revokeInvitation);if(!id||!window.confirm("Revocare questo invito? Il link non funzionerà più."))return;adminMessage();button.disabled=true;try{await db("rpc/editorial_admin_revoke_invitation",{method:"POST",token:session.access_token,body:{p_invitation_id:id}});adminMessage("","Invito revocato.");await loadAdminPanel();}catch(error){adminMessage(`Revoca non riuscita: ${error.message}`);}finally{button.disabled=false;}}
    async function saveCategory({id=null,name,slug,active=true}){await db("rpc/editorial_admin_save_category",{method:"POST",token:session.access_token,body:{p_category_id:id,p_name:name,p_slug:slug,p_active:active}});}
    async function loadContext(){
      const rows=await db(`editorial_members?select=user_id,role,active,permissions&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`,{token:session.access_token});member=rows?.[0];if(!member?.active||!["editor","admin"].includes(member.role))throw new Error("Account non abilitato alla redazione");const authors=await db(`editorial_authors?select=id,user_id,slug,display_name,bio,avatar_url,website_url,linkedin_url,active&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`,{token:session.access_token});ownAuthor=authors?.[0]?.active?authors[0]:null;document.querySelector("[data-review-name]").textContent=ownAuthor?.display_name||"Redazione OffertaLogica Informa";document.querySelector("[data-review-role]").textContent=roleLabel(member.role);document.querySelector("[data-review-email]").textContent=session.user.email||"";authPanel.hidden=true;workspace.hidden=false;ownProfile.load(ownAuthor);
      newButton.disabled=!ownAuthor||!can(member,"create_articles");show(authorWarning,!ownAuthor?"Puoi lavorare in redazione, ma per scrivere un articolo tuo serve anche un profilo autore attivo.":(!can(member,"create_articles")?"Il tuo account non ha il permesso di creare nuovi articoli.":""));if(adminTeam)adminTeam.hidden=member.role!=="admin";
      const allOption=scope.querySelector('option[value="all"]');const queueAllowed=member.role==="admin"||["review_articles","approve_articles","publish_articles","archive_articles"].some(key=>can(member,key));if(allOption)allOption.disabled=!queueAllowed;if(!queueAllowed)scope.value="mine";
      const params=new URLSearchParams(location.search);const requestedStatus=params.get("status");const requestedScope=params.get("scope");if(["in_review","changes_requested","approved","published","draft","archived","all"].includes(requestedStatus))filter.value=requestedStatus;if(["all","mine"].includes(requestedScope)&&!(requestedScope==="all"&&!queueAllowed))scope.value=requestedScope;
      await loadCategoryOptions(categorySelect,session.access_token);applyReviewFieldState();if(member.role==="admin")await loadAdminPanel();await loadQueue();const id=params.get("id");if(id)await loadArticle(id);
    }
    async function activate(){if(!session?.access_token||!session?.user?.id)return;try{await loadContext();}catch(error){sessionWrite(null);session=null;member=null;ownAuthor=null;authPanel.hidden=false;workspace.hidden=true;show(loginError,error.message);}}
    function restoreFiltersFromUrl(){const params=new URLSearchParams(location.search);const savedStatus=params.get("status");const savedScope=params.get("scope");filter.value=["in_review","changes_requested","approved","published","draft","archived","all"].includes(savedStatus)?savedStatus:"in_review";scope.value=["all","mine"].includes(savedScope)?savedScope:"all";}
    function changeQueueFilter(){if(dirty&&!window.confirm("Hai modifiche non salvate. Cambiare filtro comunque?")){restoreFiltersFromUrl();return;}history.replaceState(null,"",queueUrl());form.hidden=true;empty.hidden=false;fields.id.value="";currentArticle=null;dirty=false;loadQueue();}

    loginForm.addEventListener("submit",async event=>{event.preventDefault();show(loginError,"");const button=loginForm.querySelector("[data-review-login-button]");button.disabled=true;try{const data=await login(text(loginForm.email.value,320),String(loginForm.password.value||""));session={access_token:data.access_token,user:data.user,expires_at:data.expires_at};sessionWrite(session);await activate();}catch(error){show(loginError,`Accesso non riuscito: ${error.message}`);}finally{button.disabled=false;}});
    document.querySelector("[data-review-logout]").addEventListener("click",()=>{sessionWrite(null);location.replace("/redazione");});
    if(adminInviteForm){
      renderPermissionGrid(invitePermissions,"contributor",permissionDefaults("contributor"));adminInviteForm.addEventListener("submit",createAdminInvitation);const nameField=adminInviteForm.elements.display_name;const slugField=adminInviteForm.elements.author_slug;const roleField=adminInviteForm.elements.role;const slugPreview=document.querySelector("[data-author-slug-preview]");nameField.addEventListener("input",()=>{slugField.value=normalizeSlug(nameField.value);if(slugPreview)slugPreview.textContent=slugField.value?`Indirizzo autore: /autori/${slugField.value}.html (verrà reso univoco automaticamente se necessario).`:"L’indirizzo pubblico dell’autore verrà creato automaticamente dal nome.";});roleField.addEventListener("change",()=>renderPermissionGrid(invitePermissions,roleField.value,permissionDefaults(roleField.value)));
      document.querySelector("[data-admin-refresh]").addEventListener("click",loadAdminPanel);document.querySelector("[data-admin-copy-invite]").addEventListener("click",async()=>{if(!adminInviteLink.value)return;try{await navigator.clipboard.writeText(adminInviteLink.value);adminMessage("","Link copiato.");}catch{adminInviteLink.focus();adminInviteLink.select();document.execCommand("copy");adminMessage("","Link copiato.");}});
      adminPeople.addEventListener("click",event=>{const button=event.target.closest("button[data-save-member]");if(button)saveAdminMember(button);});adminAuthorProfiles?.addEventListener("click",event=>{const save=event.target.closest("button[data-save-author-profile]");if(save){saveAdminAuthorProfile(save);return;}const del=event.target.closest("button[data-delete-author-profile]");if(del)deleteAdminAuthorProfile(del);});adminInvitations.addEventListener("click",event=>{const button=event.target.closest("button[data-revoke-invitation]");if(button)revokeAdminInvitation(button);});
      if(adminCategoryForm){const idField=adminCategoryForm.elements.id;const activeField=adminCategoryForm.elements.active;const name=adminCategoryForm.elements.name;const slug=adminCategoryForm.elements.slug;const saveButton=adminCategoryForm.querySelector("[data-category-save]");const cancelButton=adminCategoryForm.querySelector("[data-category-cancel]");const resetCategoryForm=()=>{adminCategoryForm.reset();idField.value="";activeField.value="true";categorySlugTouched=false;saveButton.textContent="Aggiungi categoria";cancelButton.hidden=true;};name.addEventListener("input",()=>{if(!categorySlugTouched&&!idField.value)slug.value=normalizeSlug(name.value);});slug.addEventListener("input",()=>{categorySlugTouched=true;slug.value=normalizeSlug(slug.value);});cancelButton.addEventListener("click",resetCategoryForm);adminCategoryForm.addEventListener("submit",async event=>{event.preventDefault();adminMessage();const categoryName=text(name.value,80);const categorySlug=normalizeSlug(slug.value);const categoryId=safeId(idField.value)||null;const categoryActive=activeField.value!=="false";if(!categoryName||!categorySlug){adminMessage("Inserisci nome e slug della categoria.");return;}saveButton.disabled=true;try{await saveCategory({id:categoryId,name:categoryName,slug:categorySlug,active:categoryActive});resetCategoryForm();adminMessage("",categoryId?"Categoria modificata.":"Categoria aggiunta.");await loadAdminPanel();}catch(error){adminMessage(`Categoria non salvata: ${error.message}`);}finally{saveButton.disabled=false;}});}
      adminCategories?.addEventListener("click",async event=>{const edit=event.target.closest("button[data-edit-category]");if(edit&&adminCategoryForm){adminCategoryForm.elements.id.value=safeId(edit.dataset.editCategory);adminCategoryForm.elements.name.value=edit.dataset.categoryName||"";adminCategoryForm.elements.slug.value=edit.dataset.categorySlug||"";adminCategoryForm.elements.active.value=edit.dataset.categoryCurrentActive||"true";categorySlugTouched=true;adminCategoryForm.querySelector("[data-category-save]").textContent="Salva modifiche";adminCategoryForm.querySelector("[data-category-cancel]").hidden=false;adminCategoryForm.elements.name.focus();return;}const button=event.target.closest("button[data-toggle-category]");if(!button)return;button.disabled=true;try{await saveCategory({id:safeId(button.dataset.toggleCategory),name:button.dataset.categoryName,slug:button.dataset.categorySlug,active:button.dataset.categoryActive==="true"});adminMessage("","Categoria aggiornata.");await loadAdminPanel();}catch(error){adminMessage(`Categoria non aggiornata: ${error.message}`);}finally{button.disabled=false;}});
    }
    wireImageUploader(form,fields,()=>session,()=>fields.title?.value||"immagine",()=>{dirty=true;});newButton.addEventListener("click",startNewArticle);document.querySelector("[data-review-refresh]").addEventListener("click",loadQueue);filter.addEventListener("change",changeQueueFilter);scope.addEventListener("change",changeQueueFilter);form.querySelector("[data-review-save]").addEventListener("click",()=>saveArticle());form.querySelector("[data-review-submit]").addEventListener("click",()=>transition("in_review"));form.querySelector("[data-review-changes]").addEventListener("click",()=>transition("changes_requested"));form.querySelector("[data-review-approve]").addEventListener("click",()=>transition("approved"));form.querySelector("[data-review-publish]").addEventListener("click",()=>transition("published"));form.querySelector("[data-review-archive]").addEventListener("click",()=>transition("archived"));fields.slug?.addEventListener("input",()=>{slugTouched=true;fields.slug.value=normalizeSlug(fields.slug.value);dirty=true;setActionState();});fields.title?.addEventListener("input",()=>{if(!slugTouched&&can(member,"edit_slug"))fields.slug.value=normalizeSlug(fields.title.value);refreshSeoSuggestion();dirty=true;});fields.category?.addEventListener("change",()=>{refreshSeoSuggestion();dirty=true;});fields.seo_title?.addEventListener("input",()=>{seoTitleTouched=true;dirty=true;});form.querySelector("[data-suggest-seo-title]")?.addEventListener("click",()=>{seoTitleTouched=false;refreshSeoSuggestion(true);seoTitleTouched=true;dirty=true;});form.querySelectorAll("input,textarea,select").forEach(el=>el.addEventListener("change",()=>dirty=true));form.addEventListener("submit",event=>event.preventDefault());window.addEventListener("beforeunload",event=>{if(dirty){event.preventDefault();event.returnValue="";}});if(session)await activate();
  }


  async function initRegistration(){
    const loading=document.querySelector("[data-registration-loading]");
    const panel=document.querySelector("[data-registration-panel]");
    const errorBox=document.querySelector("[data-registration-error]");
    const successBox=document.querySelector("[data-registration-success]");
    const form=document.querySelector("[data-registration-form]");
    const loginForm=document.querySelector("[data-registration-login-form]");
    const inviteSummary=document.querySelector("[data-invite-summary]");
    const bootstrapFields=document.querySelector("[data-bootstrap-fields]");
    const loginEmailField=document.querySelector("[data-registration-login-email-field]");
    const params=new URLSearchParams(location.search);
    const inviteToken=text(params.get("invite"),200);
    const bootstrapToken=text(params.get("bootstrap"),200);
    const mode=inviteToken?"invite":bootstrapToken?"bootstrap":"";
    const token=inviteToken||bootstrapToken;
    const hash=new URLSearchParams(location.hash.replace(/^#/,""));
    const hashError=hash.get("error_description")||hash.get("error");
    let preview=null;
    const pendingKey="offertalogica.editorial.bootstrap.pending.v1";

    function regError(message){show(errorBox,message);}
    function regSuccess(message){show(successBox,message);}
    function redirectUrl(){return `${location.origin}/registrazione-editoriale?${mode}=${encodeURIComponent(token)}`;}
    function pendingBootstrap(){try{return JSON.parse(sessionStorage.getItem(pendingKey)||"null");}catch{return null;}}
    function savePendingBootstrap(value){if(value)sessionStorage.setItem(pendingKey,JSON.stringify(value));else sessionStorage.removeItem(pendingKey);}
    async function acceptAuthenticated(accessToken,user,bootstrapData=null){
      let result;
      if(mode==="invite"){
        result=await db("rpc/editorial_accept_invitation",{method:"POST",token:accessToken,body:{p_token:token}});
      }else{
        const data=bootstrapData||pendingBootstrap();
        if(!data?.display_name||!data?.author_slug)throw new Error("Dati del primo amministratore non disponibili. Riapri il link bootstrap e completa il modulo.");
        result=await db("rpc/editorial_accept_admin_bootstrap",{method:"POST",token:accessToken,body:{p_token:token,p_display_name:data.display_name,p_author_slug:data.author_slug}});
        savePendingBootstrap(null);
      }
      sessionWrite({access_token:accessToken,user,expires_at:Number(hash.get("expires_at")||0)||null});
      regSuccess("Account attivato. Apertura dell’area editoriale…");
      const role=result?.role||preview?.role;
      location.replace(role==="contributor"?"/collaboratori":"/redazione");
    }
    async function completeHashSession(){
      const accessToken=hash.get("access_token");
      if(!accessToken)return false;
      try{
        const user=await authUser(accessToken);
        await acceptAuthenticated(accessToken,user);
        return true;
      }catch(error){regError(`Attivazione non completata: ${error.message}`);return true;}
    }
    async function loadPreview(){
      if(!configured())throw new Error("Servizio editoriale non configurato.");
      if(!mode||!token)throw new Error("Link di attivazione mancante o incompleto.");
      const rpc=mode==="invite"?"editorial_invitation_preview":"editorial_bootstrap_preview";
      const result=await db(`rpc/${rpc}`,{method:"POST",body:{p_token:token}});
      if(!result?.valid)throw new Error(mode==="invite"?"Invito non valido, scaduto o già utilizzato.":"Link amministratore non valido, scaduto o già utilizzato.");
      preview=result;
      if(mode==="invite"){
        inviteSummary.hidden=false;bootstrapFields.hidden=true;loginEmailField.hidden=true;
        document.querySelector("[data-registration-name]").textContent=result.display_name||"—";
        document.querySelector("[data-registration-email]").textContent=result.email||"—";
        document.querySelector("[data-registration-role]").textContent=result.role==="editor"?"Editor":"Collaboratore";
      }else{
        inviteSummary.hidden=true;bootstrapFields.hidden=false;loginEmailField.hidden=false;
        const pending=pendingBootstrap();
        if(pending){form.elements.display_name.value=pending.display_name||"";form.elements.author_slug.value=pending.author_slug||"";form.elements.email.value=pending.email||"";loginForm.elements.email.value=pending.email||"";}
      }
      loading.hidden=true;panel.hidden=false;
    }

    if(hashError){regError(hashError);loading.hidden=true;return;}
    try{
      if(mode==="bootstrap"){
        if(!token||token.length<40)throw new Error("Link amministratore mancante o incompleto.");
        preview={valid:true,role:"admin"};
        inviteSummary.hidden=true;bootstrapFields.hidden=false;loginEmailField.hidden=false;
        const pending=pendingBootstrap();
        if(pending){form.elements.display_name.value=pending.display_name||"";form.elements.author_slug.value=pending.author_slug||"";form.elements.email.value=pending.email||"";loginForm.elements.email.value=pending.email||"";}
        loading.hidden=true;panel.hidden=false;
      }else{
        await loadPreview();
      }
      if(await completeHashSession())return;
    }catch(error){loading.hidden=true;regError(error.message);return;}

    if(mode==="bootstrap"){
      const bootstrapSlugPreview=document.querySelector("[data-bootstrap-slug-preview]");form.elements.display_name.addEventListener("input",()=>{form.elements.author_slug.value=normalizeSlug(form.elements.display_name.value);if(bootstrapSlugPreview)bootstrapSlugPreview.textContent=form.elements.author_slug.value?`Indirizzo autore: /autori/${form.elements.author_slug.value}.html (verrà reso univoco automaticamente se necessario).`:"L’indirizzo pubblico autore verrà creato automaticamente dal nome.";});
      form.elements.email.addEventListener("input",()=>{loginForm.elements.email.value=form.elements.email.value;});
    }

    form.addEventListener("submit",async event=>{
      event.preventDefault();regError("");regSuccess("");
      const password=String(form.elements.password.value||"");const confirm=String(form.elements.password_confirm.value||"");
      if(password.length<8){regError("La password deve contenere almeno 8 caratteri.");return;}
      if(password!==confirm){regError("Le due password non coincidono.");return;}
      const email=mode==="invite"?preview.email:text(form.elements.email.value,320).toLowerCase();
      if(!email){regError("Inserisci un indirizzo email valido.");return;}
      let bootstrapData=null;
      if(mode==="bootstrap"){
        const displayName=text(form.elements.display_name.value,120);const authorSlug=normalizeSlug(displayName);
        if(!displayName){regError("Completa il nome pubblico autore.");return;}
        bootstrapData={email,display_name:displayName,author_slug:authorSlug};savePendingBootstrap(bootstrapData);
      }
      const button=form.querySelector("[data-registration-create]");button.disabled=true;
      try{
        const data=await signup(email,password,redirectUrl());
        if(data?.access_token&&data?.user){await acceptAuthenticated(data.access_token,data.user,bootstrapData);return;}
        regSuccess("Account creato. Controlla la tua email e conferma l’indirizzo: dopo la conferma tornerai qui per completare automaticamente l’attivazione.");
      }catch(error){regError(`Creazione account non riuscita: ${error.message}`);}finally{button.disabled=false;}
    });

    loginForm.addEventListener("submit",async event=>{
      event.preventDefault();regError("");regSuccess("");
      const email=mode==="invite"?preview.email:text(loginForm.elements.email.value,320).toLowerCase();const password=String(loginForm.elements.password.value||"");
      if(!email||!password){regError("Inserisci email e password dell’account esistente.");return;}
      try{
        const data=await login(email,password);
        const bootstrapName=mode==="bootstrap"?text(form.elements.display_name.value,120):"";const bootstrapData=mode==="bootstrap"?{email,display_name:bootstrapName,author_slug:normalizeSlug(bootstrapName)}:null;
        if(mode==="bootstrap"&&!bootstrapData.display_name){regError("Completa prima il nome pubblico autore nel modulo superiore.");return;}
        await acceptAuthenticated(data.access_token,data.user,bootstrapData);
      }catch(error){regError(`Accesso non riuscito: ${error.message}`);}
    });
  }


  async function initPasswordRecovery(){
    const errorBox=document.querySelector("[data-password-error]");
    const successBox=document.querySelector("[data-password-success]");
    const requestPanel=document.querySelector("[data-password-request-panel]");
    const updatePanel=document.querySelector("[data-password-update-panel]");
    const requestForm=document.querySelector("[data-password-request-form]");
    const updateForm=document.querySelector("[data-password-update-form]");
    if(!requestPanel||!updatePanel||!requestForm||!updateForm)return;
    if(!configured()){show(errorBox,"Servizio editoriale non configurato.");requestForm.querySelector("button").disabled=true;return;}

    const hash=new URLSearchParams(location.hash.replace(/^#/,""));
    const accessToken=hash.get("access_token")||"";
    const recoveryType=hash.get("type")||"";
    const hashError=hash.get("error_description")||hash.get("error");
    let recoveryUser=null;

    function recoveryError(message){show(errorBox,message);}
    function recoverySuccess(message){show(successBox,message);}
    function redirectUrl(){return `${location.origin}/recupera-password`;}

    if(hashError){recoveryError(hashError);}
    if(accessToken&&recoveryType==="recovery"){
      try{
        recoveryUser=await authUser(accessToken);
        requestPanel.hidden=true;
        updatePanel.hidden=false;
      }catch(error){recoveryError(`Link di recupero non valido o scaduto: ${error.message}`);}
    }

    requestForm.addEventListener("submit",async event=>{
      event.preventDefault();recoveryError("");recoverySuccess("");
      const email=text(requestForm.elements.email.value,320).toLowerCase();
      if(!email||!email.includes("@")){recoveryError("Inserisci un indirizzo email valido.");return;}
      const button=requestForm.querySelector("[data-password-request-button]");button.disabled=true;
      try{
        await requestPasswordRecovery(email,redirectUrl());
        recoverySuccess("Se esiste un account editoriale associato a questa email, riceverai un link per impostare una nuova password.");
        requestForm.reset();
      }catch(error){recoveryError(`Richiesta non riuscita: ${error.message}`);}finally{button.disabled=false;}
    });

    updateForm.addEventListener("submit",async event=>{
      event.preventDefault();recoveryError("");recoverySuccess("");
      if(!accessToken||!recoveryUser){recoveryError("Il link di recupero non è valido o è scaduto. Richiedine uno nuovo.");return;}
      const password=String(updateForm.elements.password.value||"");
      const confirm=String(updateForm.elements.password_confirm.value||"");
      if(password.length<8){recoveryError("La password deve contenere almeno 8 caratteri.");return;}
      if(password!==confirm){recoveryError("Le due password non coincidono.");return;}
      const button=updateForm.querySelector("[data-password-update-button]");button.disabled=true;
      try{
        await updatePassword(accessToken,password);
        const members=await db(`editorial_members?select=role,active&user_id=eq.${encodeURIComponent(recoveryUser.id)}&limit=1`,{token:accessToken});
        const member=members?.[0];
        sessionWrite({access_token:accessToken,user:recoveryUser,expires_at:Number(hash.get("expires_at")||0)||null});
        recoverySuccess("Password aggiornata. Reindirizzamento all’area editoriale…");
        history.replaceState(null,"",location.pathname);
        window.setTimeout(()=>location.replace(member?.role==="contributor"?"/collaboratori":"/redazione"),700);
      }catch(error){recoveryError(`Aggiornamento password non riuscito: ${error.message}`);}finally{button.disabled=false;}
    });
  }

  document.documentElement.dataset.editorialVersion=VERSION; initCounters(); const view=document.body?.dataset?.editorialView||""; if(view==="archive")initPublicArchive(); if(view==="article")initArticlePage(); if(view==="workspace")initWorkspace(); if(view==="review")initReview(); if(view==="registration")initRegistration(); if(view==="password-recovery")initPasswordRecovery();
})();
