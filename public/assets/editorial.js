(() => {
  "use strict";

  const VERSION = "0.8.0";
  const SESSION_KEY = "offertalogica.editorial.session.v1";
  const STATUSES = new Set(["draft", "in_review", "changes_requested", "approved", "published", "archived"]);
  const STATUS_LABELS = {draft:"Bozza",in_review:"In revisione",changes_requested:"Modifiche richieste",approved:"Approvato",published:"Pubblicato",archived:"Archiviato"};
  const PUBLIC_SELECT = "slug,title,excerpt,content,category,featured_image_url,featured_image_alt,sources,seo_title,seo_description,published_at,updated_at,author_slug,author_display_name,author_bio,author_avatar_url,author_website_url,author_linkedin_url,category_name";

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
  function renderArchive(container,articles,staticSlugs){
    container.replaceChildren(); container.setAttribute("aria-busy","false");
    if(!articles.length){ const empty=document.createElement("div"); empty.className="ol-empty"; const h=document.createElement("h3"); h.textContent="Nessun articolo pubblicato"; const p=document.createElement("p"); p.textContent="I contenuti approvati compariranno qui."; empty.append(h,p); container.append(empty); return; }
    articles.forEach(article=>{
      const item=document.createElement("article"); item.className="ol-article-item";
      const meta=document.createElement("div"); meta.className="ol-article-meta";
      if(article.category){const span=document.createElement("span");span.textContent=article.category_name||categoryLabel(article.category);meta.append(span);}
      if(article.author_display_name){ const a=document.createElement(article.author_slug?"a":"span"); if(article.author_slug)a.href=`/autori/${encodeURIComponent(article.author_slug)}.html`; a.textContent=article.author_display_name; meta.append(a); }
      if(article.published_at)meta.append(makeTime(article.published_at));
      const h=document.createElement("h3"); const a=document.createElement("a"); a.href=publicArticleHref(article,staticSlugs); a.textContent=article.title; h.append(a);
      const p=document.createElement("p"); p.textContent=article.excerpt||""; item.append(meta,h,p); container.append(item);
    });
  }

  async function initPublicArchive(){
    const container=document.querySelector("[data-article-list]"); const errorBox=document.querySelector("[data-public-error]"); if(!container)return;
    if(!configured()){ container.setAttribute("aria-busy","false"); show(errorBox,"Archivio editoriale temporaneamente non disponibile."); return; }
    try{ const [articles,staticSlugs]=await Promise.all([fetchPublicArticles("&order=published_at.desc&limit=100"),fetchStaticSlugs()]); renderArchive(container,articles||[],staticSlugs); }
    catch(error){ container.setAttribute("aria-busy","false"); show(errorBox,`Impossibile caricare gli articoli: ${error.message}`); }
  }

  function renderPlainContent(body,content){
    body.replaceChildren(); const blocks=String(content||"").split(/\n\s*\n/).map(v=>v.trim()).filter(Boolean);
    blocks.forEach(block=>{ let node; if(/^###\s+/.test(block)){node=document.createElement("h3");node.textContent=block.replace(/^###\s+/,"");} else if(/^##\s+/.test(block)){node=document.createElement("h2");node.textContent=block.replace(/^##\s+/,"");} else {node=document.createElement("p");node.textContent=block;} body.append(node); });
  }
  function renderSources(article){
    const section=document.querySelector("[data-article-sources]"); const list=document.querySelector("[data-source-list]"); if(!section||!list)return; list.replaceChildren();
    const lines=String(article.sources||"").split(/\r?\n/).map(v=>v.trim()).filter(Boolean); if(!lines.length){section.hidden=true;return;}
    lines.forEach(line=>{ const li=document.createElement("li"); const match=line.match(/^(.*?)(https?:\/\/\S+)$/i); if(match){ const label=match[1].replace(/[|–—:-]+\s*$/,"").trim(); const a=document.createElement("a"); a.href=match[2]; a.textContent=label||match[2]; a.rel="noopener noreferrer"; li.append(a); } else li.textContent=line; list.append(li); }); section.hidden=false;
  }
  async function renderRelated(article){ const section=document.querySelector("[data-related-section]"); const list=document.querySelector("[data-related-list]"); if(!section||!list||!article.category)return; try{ const [rows,staticSlugs]=await Promise.all([fetchPublicArticles(`&category=eq.${encodeURIComponent(article.category)}&slug=neq.${encodeURIComponent(article.slug)}&order=published_at.desc&limit=3`),fetchStaticSlugs()]); list.replaceChildren(); (rows||[]).forEach(row=>{const a=document.createElement("a");a.href=publicArticleHref(row,staticSlugs);a.textContent=row.title;list.append(a);}); section.hidden=!rows?.length; }catch{section.hidden=true;} }

  async function initArticlePage(){
    const errorBox=document.querySelector("[data-public-error]"); const slug=normalizeSlug(new URLSearchParams(location.search).get("slug")||""); const articleView=document.querySelector("[data-article-view]");
    if(!slug){ if(articleView)articleView.setAttribute("aria-busy","false"); show(errorBox,"Articolo non specificato."); return; }
    if(!configured()){ if(articleView)articleView.setAttribute("aria-busy","false"); show(errorBox,"Articolo temporaneamente non disponibile."); return; }
    try{
      const rows=await fetchPublicArticles(`&slug=eq.${encodeURIComponent(slug)}&limit=1`); const article=rows?.[0]; if(!article)throw new Error("Articolo non trovato o non pubblicato");
      document.querySelector("[data-article-title]").textContent=article.title; document.querySelector("[data-article-excerpt]").textContent=article.excerpt||""; document.querySelector("[data-article-category]").textContent=article.category_name||categoryLabel(article.category);
      const authorEl=document.querySelector("[data-article-author]"); authorEl.replaceChildren(); if(article.author_slug){const a=document.createElement("a");a.href=`/autori/${encodeURIComponent(article.author_slug)}.html`;a.textContent=article.author_display_name||"Redazione OffertaLogica";authorEl.append(a);}else authorEl.textContent=article.author_display_name||"Redazione OffertaLogica";
      const date=document.querySelector("[data-article-date]"); date.textContent=formatDate(article.published_at); if(article.published_at)date.dateTime=article.published_at;
      renderPlainContent(document.querySelector("[data-article-content]"),article.content);
      const image=document.querySelector("[data-article-image]"); if(image&&/^https:\/\//i.test(article.featured_image_url||"")){image.src=article.featured_image_url;image.alt=article.featured_image_alt||article.title;image.hidden=false;}
      renderSources(article); renderRelated(article); document.title=article.seo_title||`${article.title} | OffertaLogica`; const description=document.querySelector('meta[name="description"]'); if(description)description.content=article.seo_description||article.excerpt||"Approfondimento OffertaLogica."; if(articleView)articleView.setAttribute("aria-busy","false");
    }catch(error){ if(articleView)articleView.setAttribute("aria-busy","false"); show(errorBox,error.message); }
  }

  function workspaceFields(form){ return Object.fromEntries([...form.elements].filter(el=>el.name).map(el=>[el.name,el])); }
  async function initWorkspace(){
    const authPanel=document.querySelector("[data-auth-panel]"); const workspace=document.querySelector("[data-editorial-workspace]"); const configError=document.querySelector("[data-config-error]"); const loginForm=document.querySelector("[data-login-form]"); const loginError=document.querySelector("[data-login-error]");
    if(!configured()){ show(configError,"Configurazione Supabase editoriale mancante. Inserire esclusivamente URL progetto e publishable key in /public/assets/editorial-config.js. Non usare mai la service-role nel browser."); if(loginForm)loginForm.querySelector("button").disabled=true; return; }
    let session=sessionRead(); let context=null; let dirty=false; const form=document.querySelector("[data-editorial-form]"); const fields=workspaceFields(form); const statusBadge=document.querySelector("[data-current-status]"); const saveMessage=document.querySelector("[data-save-message]"); const validation=document.querySelector("[data-validation-message]");
    function currentEditable(){ const s=fields.status.value; return context?.member?.role!=="contributor" || s==="draft" || s==="changes_requested"; }
    function setEditable(){ const enabled=currentEditable(); form.querySelectorAll("input:not([type=hidden]),textarea,select").forEach(el=>el.disabled=!enabled); form.querySelector("[data-save-draft]").disabled=!enabled; form.querySelector("[data-send-review]").disabled=!enabled; }
    function resetForm(){ form.reset(); fields.id.value=""; fields.status.value="draft"; setStatusBadge(statusBadge,"draft"); document.querySelector("[data-form-title]").textContent="Nuovo articolo"; history.replaceState(null,"","/collaboratori"); const feedback=document.querySelector("[data-author-feedback]"); if(feedback){feedback.replaceChildren();const p=document.createElement("p");p.className="ol-muted";p.textContent="Se la redazione richiede modifiche, il feedback apparirà qui.";feedback.append(p);} dirty=false; setEditable(); initCounters(form); }
    function payloadFromForm(){ return {title:text(fields.title.value,140),slug:normalizeSlug(fields.slug.value),excerpt:text(fields.excerpt.value,320),content:text(fields.content.value,40000),featured_image_url:text(fields.featured_image_url.value,1000)||null,featured_image_alt:text(fields.featured_image_alt?.value,180)||null,category:text(fields.category.value,80)||null,sources:text(fields.sources.value,4000)||null}; }
    function validateForReview(){ const p=payloadFromForm(); const missing=[]; if(!p.title)missing.push("Titolo"); if(!p.slug)missing.push("Slug"); if(!p.excerpt)missing.push("Sommario"); if(!p.content)missing.push("Contenuto"); if(p.featured_image_url&&!p.featured_image_alt)missing.push("Testo alternativo immagine"); return missing; }
    async function addNote(articleId){ const note=text(fields.editorial_note.value,2000); if(!note)return; await db("editorial_article_notes",{method:"POST",token:session.access_token,prefer:"return=minimal",body:{article_id:articleId,body:note,visibility:"author",created_by:session.user.id}}); fields.editorial_note.value=""; }
    async function saveDraft({silent=false}={}){ show(validation,""); show(saveMessage,""); const payload=payloadFromForm(); if(!payload.title||!payload.slug){show(validation,"Titolo e slug sono obbligatori per salvare la bozza.");return null;} let article; try{ if(fields.id.value){const rows=await db(`editorial_articles?id=eq.${encodeURIComponent(fields.id.value)}&select=*`,{method:"PATCH",token:session.access_token,prefer:"return=representation",body:payload});article=rows?.[0];}else{const rows=await db("editorial_articles?select=*",{method:"POST",token:session.access_token,prefer:"return=representation",body:{...payload,status:"draft",author_id:context.author.id,created_by:session.user.id,updated_by:session.user.id}});article=rows?.[0];} if(!article)throw new Error("Salvataggio non confermato"); fields.id.value=article.id;fields.status.value=article.status;setStatusBadge(statusBadge,article.status);await addNote(article.id);dirty=false;history.replaceState(null,"",`/collaboratori?id=${encodeURIComponent(article.id)}`);if(!silent)show(saveMessage,"Bozza salvata.");await loadList();return article;}catch(error){show(validation,`Salvataggio non riuscito: ${error.message}`);return null;} }
    async function sendReview(){ const missing=validateForReview(); if(missing.length){show(validation,`Completa prima: ${missing.join(", ")}.`);return;} const article=await saveDraft({silent:true});if(!article)return;try{const rows=await db(`editorial_articles?id=eq.${encodeURIComponent(article.id)}&select=*`,{method:"PATCH",token:session.access_token,prefer:"return=representation",body:{status:"in_review"}});const updated=rows?.[0];fields.status.value=updated?.status||"in_review";setStatusBadge(statusBadge,fields.status.value);dirty=false;setEditable();show(saveMessage,"Articolo inviato alla redazione per la revisione.");await loadList();}catch(error){show(validation,`Invio in revisione non riuscito: ${error.message}`);} }
    async function loadAuthorFeedback(articleId){
      const box=document.querySelector("[data-author-feedback]"); if(!box)return; box.replaceChildren();
      try{
        const rows=await db(`editorial_article_notes?select=id,body,created_by,created_at&article_id=eq.${encodeURIComponent(articleId)}&visibility=eq.author&order=created_at.desc`,{token:session.access_token});
        if(!rows?.length){const p=document.createElement("p");p.className="ol-muted";p.textContent="Nessun feedback della redazione.";box.append(p);return;}
        rows.forEach(note=>{const item=document.createElement("article");item.className="ol-note";const meta=document.createElement("small");meta.textContent=`${note.created_by===session.user.id?"Tu":"Redazione"} · ${formatDate(note.created_at)}`;const body=document.createElement("p");body.textContent=note.body;item.append(meta,body);box.append(item);});
      }catch(error){const p=document.createElement("p");p.className="ol-muted";p.textContent=`Feedback non disponibile: ${error.message}`;box.append(p);}
    }
    async function loadList(){ const box=document.querySelector("[data-my-articles]"); const rows=await db(`editorial_articles?select=id,title,status,updated_at&created_by=eq.${encodeURIComponent(session.user.id)}&order=updated_at.desc&limit=100`,{token:session.access_token});box.replaceChildren();if(!rows.length){const p=document.createElement("p");p.className="ol-muted";p.textContent="Nessun articolo ancora.";box.append(p);return;}rows.forEach(row=>{const a=document.createElement("a");a.className="ol-my-article";a.href=`/collaboratori?id=${encodeURIComponent(row.id)}`;if(row.id===fields.id.value)a.setAttribute("aria-current","true");const strong=document.createElement("strong");strong.textContent=row.title||"Senza titolo";const span=document.createElement("span");span.textContent=`${STATUS_LABELS[row.status]||row.status} · ${formatDate(row.updated_at)}`;a.append(strong,span);box.append(a);}); }
    async function loadArticle(id){ const safe=String(id||"").replace(/[^a-f0-9-]/gi,"");if(!safe)return resetForm();const rows=await db(`editorial_articles?select=*&id=eq.${encodeURIComponent(safe)}&created_by=eq.${encodeURIComponent(session.user.id)}&limit=1`,{token:session.access_token});const article=rows?.[0];if(!article)return resetForm();Object.entries({id:article.id,status:article.status,title:article.title,slug:article.slug,category:article.category||"",featured_image_url:article.featured_image_url||"",featured_image_alt:article.featured_image_alt||"",excerpt:article.excerpt||"",content:article.content||"",sources:article.sources||""}).forEach(([k,v])=>{if(fields[k])fields[k].value=v??"";});fields.editorial_note.value="";document.querySelector("[data-form-title]").textContent=article.title||"Articolo";setStatusBadge(statusBadge,article.status);await loadAuthorFeedback(article.id);dirty=false;setEditable();initCounters(form); }
    async function loadContext(){ const members=await db(`editorial_members?select=user_id,role,active&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`,{token:session.access_token});const member=members?.[0];if(!member?.active)throw new Error("Account non abilitato dalla redazione");const authors=await db(`editorial_authors?select=id,user_id,slug,display_name,active&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`,{token:session.access_token});const author=authors?.[0];if(!author?.active)throw new Error("Profilo autore non abilitato");context={member,author};document.querySelector("[data-member-name]").textContent=author.display_name||"Collaboratore";document.querySelector("[data-member-role]").textContent=member.role;document.querySelector("[data-member-email]").textContent=session.user.email||"";authPanel.hidden=true;workspace.hidden=false;await loadList();const id=new URLSearchParams(location.search).get("id");if(id)await loadArticle(id);else resetForm(); }
    async function activate(){if(!session?.access_token||!session?.user?.id)return;try{await loadContext();}catch(error){sessionWrite(null);session=null;context=null;authPanel.hidden=false;workspace.hidden=true;show(loginError,error.message);}}
    loginForm.addEventListener("submit",async event=>{event.preventDefault();show(loginError,"");const button=loginForm.querySelector("[data-login-button]");button.disabled=true;try{const data=await login(text(loginForm.email.value,320),String(loginForm.password.value||""));session={access_token:data.access_token,user:data.user,expires_at:data.expires_at};sessionWrite(session);await activate();}catch(error){show(loginError,`Accesso non riuscito: ${error.message}`);}finally{button.disabled=false;}});
    document.querySelector("[data-logout]").addEventListener("click",()=>{sessionWrite(null);location.replace("/collaboratori");});document.querySelector("[data-new-article]").addEventListener("click",resetForm);form.querySelector("[data-save-draft]").addEventListener("click",()=>saveDraft());form.querySelector("[data-send-review]").addEventListener("click",sendReview);
    let slugTouched=false;fields.slug.addEventListener("input",()=>{slugTouched=true;fields.slug.value=normalizeSlug(fields.slug.value);dirty=true;});fields.title.addEventListener("input",()=>{if(!slugTouched)fields.slug.value=normalizeSlug(fields.title.value);dirty=true;});form.querySelectorAll("input,textarea,select").forEach(el=>el.addEventListener("change",()=>dirty=true));form.addEventListener("submit",event=>event.preventDefault());window.addEventListener("beforeunload",event=>{if(dirty){event.preventDefault();event.returnValue="";}});if(session)await activate();
  }



  async function initReview(){
    const authPanel=document.querySelector("[data-review-auth-panel]");
    const workspace=document.querySelector("[data-review-workspace]");
    const configError=document.querySelector("[data-review-config-error]");
    const loginForm=document.querySelector("[data-review-login-form]");
    const loginError=document.querySelector("[data-review-login-error]");
    if(!configured()){show(configError,"Configurazione Supabase editoriale mancante.");if(loginForm)loginForm.querySelector("button").disabled=true;return;}

    let session=sessionRead();let member=null;let ownAuthor=null;let currentArticle=null;let dirty=false;let slugTouched=false;
    const form=document.querySelector("[data-review-form]");const empty=document.querySelector("[data-review-empty]");const fields=workspaceFields(form);const statusBadge=document.querySelector("[data-review-current-status]");const saveMessage=document.querySelector("[data-review-save-message]");const validation=document.querySelector("[data-review-validation]");const filter=document.querySelector("[data-review-status-filter]");const scope=document.querySelector("[data-review-scope-filter]");const list=document.querySelector("[data-review-list]");const count=document.querySelector("[data-review-count]");const newButton=document.querySelector("[data-review-new]");const authorWarning=document.querySelector("[data-review-author-warning]");
    const categorySelect=form.querySelector("[data-category-select]");
    const adminTeam=document.querySelector("[data-admin-team]");const adminError=document.querySelector("[data-admin-error]");const adminSuccess=document.querySelector("[data-admin-success]");const adminInviteForm=document.querySelector("[data-admin-invite-form]");const adminPeople=document.querySelector("[data-admin-people]");const adminInvitations=document.querySelector("[data-admin-invitations]");const adminInviteResult=document.querySelector("[data-admin-invite-result]");const adminInviteLink=document.querySelector("[data-admin-invite-link]");const adminEmailInvite=document.querySelector("[data-admin-email-invite]");const invitePermissions=document.querySelector("[data-invite-permissions]");const adminCategoryForm=document.querySelector("[data-admin-category-form]");const adminCategories=document.querySelector("[data-admin-categories]");
    let inviteSlugTouched=false;let categorySlugTouched=false;

    function safeId(value){return String(value||"").replace(/[^a-f0-9-]/gi,"");}
    function perms(){return effectivePermissions(member);}
    function isOwnArticle(){return Boolean(currentArticle?.created_by&&currentArticle.created_by===session?.user?.id);}
    function canEditOtherArticle(){return member?.role==="admin"||can(member,"review_articles");}
    function queueUrl(id=""){const params=new URLSearchParams();params.set("scope",scope.value);params.set("status",filter.value);if(id)params.set("id",id);return `/redazione?${params.toString()}`;}
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
      currentArticle=article;slugTouched=true;
      Object.entries({id:article.id,status:article.status,title:article.title||"",slug:article.slug||"",category:article.category||"",featured_image_url:article.featured_image_url||"",featured_image_alt:article.featured_image_alt||"",excerpt:article.excerpt||"",content:article.content||"",sources:article.sources||"",seo_title:article.seo_title||"",seo_description:article.seo_description||""}).forEach(([key,value])=>{if(fields[key])fields[key].value=value;});
      document.querySelector("[data-review-mode]").textContent=isOwnArticle()?"Il mio articolo":"Revisione editoriale";document.querySelector("[data-review-form-title]").textContent=article.title||"Bozza senza titolo";document.querySelector("[data-review-author]").textContent=author?.display_name||"Autore non disponibile";document.querySelector("[data-review-submitted]").textContent=formatDate(article.submitted_at)||"—";document.querySelector("[data-review-updated]").textContent=formatDate(article.updated_at)||"—";setStatusBadge(statusBadge,article.status);form.hidden=false;empty.hidden=true;dirty=false;initCounters(form);applyReviewFieldState();
    }
    async function startNewArticle(){
      if(!ownAuthor){show(authorWarning,"Per scrivere un articolo serve un profilo autore attivo associato a questo account.");return;}if(!can(member,"create_articles")){show(authorWarning,"L’amministratore non ti ha assegnato il permesso di creare articoli.");return;}if(dirty&&!window.confirm("Hai modifiche non salvate. Creare comunque un nuovo articolo?"))return;
      clearMessages();currentArticle=null;slugTouched=false;form.reset();fields.id.value="";fields.status.value="draft";scope.value="mine";filter.value="draft";document.querySelector("[data-review-mode]").textContent="Nuovo articolo personale";document.querySelector("[data-review-form-title]").textContent="Nuovo articolo";document.querySelector("[data-review-author]").textContent=ownAuthor.display_name||"Autore";document.querySelector("[data-review-submitted]").textContent="—";document.querySelector("[data-review-updated]").textContent="—";fields.review_note.value="";fields.review_note_visibility.value="internal";setStatusBadge(statusBadge,"draft");renderEmptyNotes("Le note saranno disponibili dopo il primo salvataggio.");form.hidden=false;empty.hidden=true;dirty=false;applyReviewFieldState();initCounters(form);history.replaceState(null,"",queueUrl());await loadQueue();const target=form.querySelector('[data-requires-permission="edit_content"] textarea')||form.querySelector('input:not([type="hidden"]),textarea');target?.focus();
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
      if(target==="published"&&can(member,"edit_seo")){if(!fields.seo_title.value.trim())fields.seo_title.value=text(fields.title.value,70);if(!fields.seo_description.value.trim())fields.seo_description.value=text(fields.excerpt.value,180);}
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
    function renderAdminInvitations(rows){
      adminInvitations.replaceChildren();if(!rows?.length){const p=document.createElement("p");p.className="ol-muted";p.textContent="Nessun invito creato.";adminInvitations.append(p);return;}
      rows.forEach(row=>{const item=document.createElement("article");item.className="ol-team-item";const head=document.createElement("div");head.className="ol-team-item-head";const info=document.createElement("div");const strong=document.createElement("strong");strong.textContent=row.display_name||row.email;const small=document.createElement("small");small.textContent=`${row.email} · ${roleLabel(row.role)} · ${permissionCount(row.permissions,row.role)} permessi · scadenza ${formatDate(row.expires_at)}`;info.append(strong,small);const [state,label]=inviteState(row);head.append(info,statusPill(state,label));item.append(head);if(state==="pending"){const actions=document.createElement("div");actions.className="ol-team-actions";const revoke=document.createElement("button");revoke.type="button";revoke.className="ol-button ol-button-danger ol-button-small";revoke.dataset.revokeInvitation=row.id;revoke.textContent="Revoca";actions.append(revoke);item.append(actions);}adminInvitations.append(item);});
    }
    function renderAdminCategories(rows){
      if(!adminCategories)return;adminCategories.replaceChildren();if(!rows?.length){const p=document.createElement("p");p.className="ol-muted";p.textContent="Nessuna categoria.";adminCategories.append(p);return;}
      rows.forEach(row=>{const item=document.createElement("article");item.className="ol-team-item ol-category-row";const info=document.createElement("div");const strong=document.createElement("strong");strong.textContent=row.name;const small=document.createElement("small");small.textContent=`${row.slug} · ${row.active?"attiva":"non attiva"}`;info.append(strong,small);const actions=document.createElement("div");actions.className="ol-team-actions";const edit=document.createElement("button");edit.type="button";edit.className="ol-button ol-button-secondary ol-button-small";edit.dataset.editCategory=row.id;edit.dataset.categoryName=row.name;edit.dataset.categorySlug=row.slug;edit.dataset.categoryCurrentActive=String(Boolean(row.active));edit.textContent="Modifica";const toggle=document.createElement("button");toggle.type="button";toggle.className="ol-button ol-button-secondary ol-button-small";toggle.dataset.toggleCategory=row.id;toggle.dataset.categoryName=row.name;toggle.dataset.categorySlug=row.slug;toggle.dataset.categoryActive=String(!row.active);toggle.textContent=row.active?"Disattiva":"Riattiva";actions.append(edit,toggle);item.append(info,actions);adminCategories.append(item);});
    }
    async function loadAdminPanel(){
      if(member?.role!=="admin"||!adminTeam)return;adminMessage();try{const [people,invitations,categories]=await Promise.all([db("rpc/editorial_admin_list_people",{method:"POST",token:session.access_token,body:{}}),db("rpc/editorial_admin_list_invitations",{method:"POST",token:session.access_token,body:{}}),db("rpc/editorial_admin_list_categories",{method:"POST",token:session.access_token,body:{}})]);renderAdminPeople(people||[]);renderAdminInvitations(invitations||[]);renderAdminCategories(categories||[]);await loadCategoryOptions(categorySelect,session.access_token);}catch(error){adminMessage(`Gestione amministrativa non disponibile: ${error.message}`);}
    }
    async function createAdminInvitation(event){
      event.preventDefault();adminMessage();const fd=new FormData(adminInviteForm);const email=text(fd.get("email"),320).toLowerCase();const displayName=text(fd.get("display_name"),120);const role=text(fd.get("role"),20);const authorSlug=normalizeSlug(fd.get("author_slug"));const permissions=permissionValuesFromContainer(invitePermissions,role);if(!email||!displayName||!authorSlug){adminMessage("Completa email, nome pubblico e slug autore.");return;}const button=adminInviteForm.querySelector('button[type="submit"]');button.disabled=true;
      try{const result=await db("rpc/editorial_admin_create_invitation",{method:"POST",token:session.access_token,body:{p_email:email,p_display_name:displayName,p_role:role,p_author_slug:authorSlug,p_permissions:permissions}});if(!result?.token)throw new Error("Invito non confermato");const link=`${location.origin}/registrazione-editoriale?invite=${encodeURIComponent(result.token)}`;adminInviteLink.value=link;adminInviteResult.hidden=false;const subject="Invito a OffertaLogica Informa";const body=`Ciao ${displayName},

ti ho invitato nella redazione OffertaLogica Informa con ruolo ${roleLabel(role)}.

Apri questo link personale per creare il tuo account e scegliere la password:
${link}

Il link è monouso e scade dopo 7 giorni.
`;adminEmailInvite.href=`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;adminInviteForm.reset();inviteSlugTouched=false;renderPermissionGrid(invitePermissions,"contributor",permissionDefaults("contributor"));adminMessage("","Invito creato. Ora puoi copiare il link oppure aprire l’email già compilata.");await loadAdminPanel();}
      catch(error){adminMessage(`Invito non creato: ${error.message}`);}finally{button.disabled=false;}
    }
    async function saveAdminMember(button){
      const id=safeId(button.dataset.saveMember);if(!id)return;const card=button.closest(".ol-team-item");const role=card.querySelector(`[data-member-role-select="${CSS.escape(id)}"]`)?.value;const active=Boolean(card.querySelector(`[data-member-active-input="${CSS.escape(id)}"]`)?.checked);const grid=card.querySelector(`[data-member-permission-grid="${CSS.escape(id)}"]`);const permissions=permissionValuesFromContainer(grid,role);if(!window.confirm(`Salvare ruolo ${roleLabel(role)}, stato ${active?"attivo":"disattivato"} e permessi?`))return;adminMessage();button.disabled=true;try{await db("rpc/editorial_admin_update_member",{method:"POST",token:session.access_token,body:{p_user_id:id,p_role:role,p_active:active,p_permissions:permissions}});adminMessage("","Utente aggiornato.");await loadAdminPanel();}catch(error){adminMessage(`Aggiornamento non riuscito: ${error.message}`);}finally{button.disabled=false;}
    }
    async function revokeAdminInvitation(button){const id=safeId(button.dataset.revokeInvitation);if(!id||!window.confirm("Revocare questo invito? Il link non funzionerà più."))return;adminMessage();button.disabled=true;try{await db("rpc/editorial_admin_revoke_invitation",{method:"POST",token:session.access_token,body:{p_invitation_id:id}});adminMessage("","Invito revocato.");await loadAdminPanel();}catch(error){adminMessage(`Revoca non riuscita: ${error.message}`);}finally{button.disabled=false;}}
    async function saveCategory({id=null,name,slug,active=true}){await db("rpc/editorial_admin_save_category",{method:"POST",token:session.access_token,body:{p_category_id:id,p_name:name,p_slug:slug,p_active:active}});}
    async function loadContext(){
      const rows=await db(`editorial_members?select=user_id,role,active,permissions&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`,{token:session.access_token});member=rows?.[0];if(!member?.active||!["editor","admin"].includes(member.role))throw new Error("Account non abilitato alla redazione");const authors=await db(`editorial_authors?select=id,user_id,slug,display_name,active&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`,{token:session.access_token});ownAuthor=authors?.[0]?.active?authors[0]:null;document.querySelector("[data-review-name]").textContent=ownAuthor?.display_name||"Redazione OffertaLogica Informa";document.querySelector("[data-review-role]").textContent=roleLabel(member.role);document.querySelector("[data-review-email]").textContent=session.user.email||"";authPanel.hidden=true;workspace.hidden=false;
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
      renderPermissionGrid(invitePermissions,"contributor",permissionDefaults("contributor"));adminInviteForm.addEventListener("submit",createAdminInvitation);const nameField=adminInviteForm.elements.display_name;const slugField=adminInviteForm.elements.author_slug;const roleField=adminInviteForm.elements.role;nameField.addEventListener("input",()=>{if(!inviteSlugTouched)slugField.value=normalizeSlug(nameField.value);});slugField.addEventListener("input",()=>{inviteSlugTouched=true;slugField.value=normalizeSlug(slugField.value);});roleField.addEventListener("change",()=>renderPermissionGrid(invitePermissions,roleField.value,permissionDefaults(roleField.value)));
      document.querySelector("[data-admin-refresh]").addEventListener("click",loadAdminPanel);document.querySelector("[data-admin-copy-invite]").addEventListener("click",async()=>{if(!adminInviteLink.value)return;try{await navigator.clipboard.writeText(adminInviteLink.value);adminMessage("","Link copiato.");}catch{adminInviteLink.focus();adminInviteLink.select();document.execCommand("copy");adminMessage("","Link copiato.");}});
      adminPeople.addEventListener("click",event=>{const button=event.target.closest("button[data-save-member]");if(button)saveAdminMember(button);});adminInvitations.addEventListener("click",event=>{const button=event.target.closest("button[data-revoke-invitation]");if(button)revokeAdminInvitation(button);});
      if(adminCategoryForm){const idField=adminCategoryForm.elements.id;const activeField=adminCategoryForm.elements.active;const name=adminCategoryForm.elements.name;const slug=adminCategoryForm.elements.slug;const saveButton=adminCategoryForm.querySelector("[data-category-save]");const cancelButton=adminCategoryForm.querySelector("[data-category-cancel]");const resetCategoryForm=()=>{adminCategoryForm.reset();idField.value="";activeField.value="true";categorySlugTouched=false;saveButton.textContent="Aggiungi categoria";cancelButton.hidden=true;};name.addEventListener("input",()=>{if(!categorySlugTouched&&!idField.value)slug.value=normalizeSlug(name.value);});slug.addEventListener("input",()=>{categorySlugTouched=true;slug.value=normalizeSlug(slug.value);});cancelButton.addEventListener("click",resetCategoryForm);adminCategoryForm.addEventListener("submit",async event=>{event.preventDefault();adminMessage();const categoryName=text(name.value,80);const categorySlug=normalizeSlug(slug.value);const categoryId=safeId(idField.value)||null;const categoryActive=activeField.value!=="false";if(!categoryName||!categorySlug){adminMessage("Inserisci nome e slug della categoria.");return;}saveButton.disabled=true;try{await saveCategory({id:categoryId,name:categoryName,slug:categorySlug,active:categoryActive});resetCategoryForm();adminMessage("",categoryId?"Categoria modificata.":"Categoria aggiunta.");await loadAdminPanel();}catch(error){adminMessage(`Categoria non salvata: ${error.message}`);}finally{saveButton.disabled=false;}});}
      adminCategories?.addEventListener("click",async event=>{const edit=event.target.closest("button[data-edit-category]");if(edit&&adminCategoryForm){adminCategoryForm.elements.id.value=safeId(edit.dataset.editCategory);adminCategoryForm.elements.name.value=edit.dataset.categoryName||"";adminCategoryForm.elements.slug.value=edit.dataset.categorySlug||"";adminCategoryForm.elements.active.value=edit.dataset.categoryCurrentActive||"true";categorySlugTouched=true;adminCategoryForm.querySelector("[data-category-save]").textContent="Salva modifiche";adminCategoryForm.querySelector("[data-category-cancel]").hidden=false;adminCategoryForm.elements.name.focus();return;}const button=event.target.closest("button[data-toggle-category]");if(!button)return;button.disabled=true;try{await saveCategory({id:safeId(button.dataset.toggleCategory),name:button.dataset.categoryName,slug:button.dataset.categorySlug,active:button.dataset.categoryActive==="true"});adminMessage("","Categoria aggiornata.");await loadAdminPanel();}catch(error){adminMessage(`Categoria non aggiornata: ${error.message}`);}finally{button.disabled=false;}});
    }
    newButton.addEventListener("click",startNewArticle);document.querySelector("[data-review-refresh]").addEventListener("click",loadQueue);filter.addEventListener("change",changeQueueFilter);scope.addEventListener("change",changeQueueFilter);form.querySelector("[data-review-save]").addEventListener("click",()=>saveArticle());form.querySelector("[data-review-submit]").addEventListener("click",()=>transition("in_review"));form.querySelector("[data-review-changes]").addEventListener("click",()=>transition("changes_requested"));form.querySelector("[data-review-approve]").addEventListener("click",()=>transition("approved"));form.querySelector("[data-review-publish]").addEventListener("click",()=>transition("published"));form.querySelector("[data-review-archive]").addEventListener("click",()=>transition("archived"));fields.slug?.addEventListener("input",()=>{slugTouched=true;fields.slug.value=normalizeSlug(fields.slug.value);dirty=true;setActionState();});fields.title?.addEventListener("input",()=>{if(!fields.id.value&&!slugTouched&&can(member,"edit_slug"))fields.slug.value=normalizeSlug(fields.title.value);dirty=true;});form.querySelectorAll("input,textarea,select").forEach(el=>el.addEventListener("change",()=>dirty=true));form.addEventListener("submit",event=>event.preventDefault());window.addEventListener("beforeunload",event=>{if(dirty){event.preventDefault();event.returnValue="";}});if(session)await activate();
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
    let slugTouched=false;
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
      form.elements.display_name.addEventListener("input",()=>{if(!slugTouched)form.elements.author_slug.value=normalizeSlug(form.elements.display_name.value);});
      form.elements.author_slug.addEventListener("input",()=>{slugTouched=true;form.elements.author_slug.value=normalizeSlug(form.elements.author_slug.value);});
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
        const displayName=text(form.elements.display_name.value,120);const authorSlug=normalizeSlug(form.elements.author_slug.value);
        if(!displayName||!authorSlug){regError("Completa nome pubblico e slug autore.");return;}
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
        const bootstrapData=mode==="bootstrap"?{email,display_name:text(form.elements.display_name.value,120),author_slug:normalizeSlug(form.elements.author_slug.value)}:null;
        if(mode==="bootstrap"&&(!bootstrapData.display_name||!bootstrapData.author_slug)){regError("Completa prima nome pubblico e slug autore nel modulo superiore.");return;}
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
