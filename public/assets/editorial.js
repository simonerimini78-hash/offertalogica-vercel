(() => {
  "use strict";

  const VERSION = "0.5.0";
  const SESSION_KEY = "offertalogica.editorial.session.v1";
  const STATUSES = new Set(["draft", "in_review", "changes_requested", "approved", "published", "archived"]);
  const STATUS_LABELS = {draft:"Bozza",in_review:"In revisione",changes_requested:"Modifiche richieste",approved:"Approvato",published:"Pubblicato",archived:"Archiviato"};
  const PUBLIC_SELECT = "slug,title,excerpt,content,category,featured_image_url,featured_image_alt,sources,seo_title,seo_description,published_at,updated_at,author_slug,author_display_name,author_bio,author_avatar_url,author_website_url,author_linkedin_url";

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
    const response=await fetch(url,options); const payload=await response.json().catch(()=>null);
    if(!response.ok){ const message=payload?.message||payload?.msg||payload?.error_description||payload?.error||`Errore ${response.status}`; const error=new Error(message); error.status=response.status; throw error; }
    return payload;
  }
  async function db(path,{method="GET",token="",body=null,prefer=""}={}){ const headers=authHeaders(token); if(prefer)headers.Prefer=prefer; return request(`${config.url}/rest/v1/${path}`,{method,headers,body:body===null?undefined:JSON.stringify(body),cache:"no-store"}); }
  async function login(email,password){ return request(`${config.url}/auth/v1/token?grant_type=password`,{method:"POST",headers:authHeaders(),body:JSON.stringify({email,password}),cache:"no-store"}); }

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
      if(article.category){const span=document.createElement("span");span.textContent=text(article.category,80);meta.append(span);}
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
      document.querySelector("[data-article-title]").textContent=article.title; document.querySelector("[data-article-excerpt]").textContent=article.excerpt||""; document.querySelector("[data-article-category]").textContent=article.category||"Articolo OffertaLogica";
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
    if(!configured()){
      show(configError,"Configurazione Supabase editoriale mancante.");
      if(loginForm)loginForm.querySelector("button").disabled=true;
      return;
    }

    let session=sessionRead();
    let member=null;
    let ownAuthor=null;
    let currentArticle=null;
    let dirty=false;
    let slugTouched=false;
    const form=document.querySelector("[data-review-form]");
    const empty=document.querySelector("[data-review-empty]");
    const fields=workspaceFields(form);
    const statusBadge=document.querySelector("[data-review-current-status]");
    const saveMessage=document.querySelector("[data-review-save-message]");
    const validation=document.querySelector("[data-review-validation]");
    const filter=document.querySelector("[data-review-status-filter]");
    const scope=document.querySelector("[data-review-scope-filter]");
    const list=document.querySelector("[data-review-list]");
    const count=document.querySelector("[data-review-count]");
    const newButton=document.querySelector("[data-review-new]");
    const authorWarning=document.querySelector("[data-review-author-warning]");

    function safeId(value){return String(value||"").replace(/[^a-f0-9-]/gi,"");}
    function isOwnArticle(){return Boolean(currentArticle?.created_by&&currentArticle.created_by===session?.user?.id);}
    function queueUrl(id=""){
      const params=new URLSearchParams();
      params.set("scope",scope.value);
      params.set("status",filter.value);
      if(id)params.set("id",id);
      return `/redazione?${params.toString()}`;
    }
    function reviewPayload(){
      return {
        title:text(fields.title.value,140),
        slug:normalizeSlug(fields.slug.value),
        category:text(fields.category.value,80)||null,
        featured_image_url:text(fields.featured_image_url.value,1000)||null,
        featured_image_alt:text(fields.featured_image_alt.value,180)||null,
        excerpt:text(fields.excerpt.value,320),
        content:text(fields.content.value,40000),
        sources:text(fields.sources.value,4000)||null,
        seo_title:text(fields.seo_title.value,70)||null,
        seo_description:text(fields.seo_description.value,180)||null
      };
    }
    function validateArticle({forPublish=false,forReview=false}={}){
      const p=reviewPayload(); const missing=[]; const status=fields.status.value;
      if(!p.title)missing.push("Titolo");
      if(!p.slug)missing.push("Slug");
      if(forReview||forPublish||status!=="draft"){
        if(!p.excerpt)missing.push("Sommario");
        if(!p.content)missing.push("Contenuto");
        if(p.featured_image_url&&!p.featured_image_alt)missing.push("Testo alternativo immagine");
      }
      if(forPublish&&!p.seo_title)missing.push("Titolo SEO");
      if(forPublish&&!p.seo_description)missing.push("Descrizione SEO");
      return missing;
    }
    function clearMessages(){show(saveMessage,"");show(validation,"");}
    function renderEmptyNotes(message="Nessuna nota."){
      const box=document.querySelector("[data-review-notes]"); box.replaceChildren();
      const p=document.createElement("p");p.className="ol-muted";p.textContent=message;box.append(p);
    }
    function setActionState(){
      const status=fields.status.value;
      const own=isOwnArticle()||(!fields.id.value&&Boolean(ownAuthor));
      const editorSelfReview=member?.role==="editor"&&own;
      form.querySelector("[data-review-submit]").disabled=!(own&&["draft","changes_requested"].includes(status));
      form.querySelector("[data-review-changes]").disabled=editorSelfReview||!(["in_review","approved"].includes(status));
      form.querySelector("[data-review-approve]").disabled=editorSelfReview||status!=="in_review";
      form.querySelector("[data-review-publish]").disabled=status!=="approved";
      form.querySelector("[data-review-archive]").disabled=!(
        ["in_review","changes_requested","approved","published"].includes(status) ||
        (status==="draft"&&(member?.role==="admin"||own))
      );
      const approve=form.querySelector("[data-review-approve]");
      approve.title=editorSelfReview?"Un editor non può approvare un articolo scritto da sé.":"";
      const publicLink=form.querySelector("[data-review-public-link]");
      if(status==="published"&&fields.slug.value){publicLink.href=`/articolo.html?slug=${encodeURIComponent(fields.slug.value)}`;publicLink.hidden=false;}else publicLink.hidden=true;
    }
    function populateArticle(article,author){
      currentArticle=article;
      slugTouched=true;
      Object.entries({id:article.id,status:article.status,title:article.title||"",slug:article.slug||"",category:article.category||"",featured_image_url:article.featured_image_url||"",featured_image_alt:article.featured_image_alt||"",excerpt:article.excerpt||"",content:article.content||"",sources:article.sources||"",seo_title:article.seo_title||"",seo_description:article.seo_description||""}).forEach(([k,v])=>{if(fields[k])fields[k].value=v;});
      document.querySelector("[data-review-mode]").textContent=isOwnArticle()?"Il mio articolo":"Revisione editoriale";
      document.querySelector("[data-review-form-title]").textContent=article.title||"Articolo";
      document.querySelector("[data-review-author]").textContent=author?.display_name||"Autore non disponibile";
      document.querySelector("[data-review-submitted]").textContent=formatDate(article.submitted_at)||"—";
      document.querySelector("[data-review-updated]").textContent=formatDate(article.updated_at)||"—";
      setStatusBadge(statusBadge,article.status);
      form.hidden=false; empty.hidden=true; dirty=false; initCounters(form); setActionState();
    }
    function startNewArticle(){
      if(!ownAuthor){show(authorWarning,"Per scrivere un articolo serve un profilo autore attivo associato a questo account.");return;}
      if(dirty&&!window.confirm("Hai modifiche non salvate. Creare comunque un nuovo articolo?"))return;
      clearMessages(); currentArticle=null; slugTouched=false; form.reset(); fields.id.value=""; fields.status.value="draft";
      scope.value="mine"; filter.value="draft";
      document.querySelector("[data-review-mode]").textContent="Nuovo articolo personale";
      document.querySelector("[data-review-form-title]").textContent="Nuovo articolo";
      document.querySelector("[data-review-author]").textContent=ownAuthor.display_name||"Autore";
      document.querySelector("[data-review-submitted]").textContent="—";
      document.querySelector("[data-review-updated]").textContent="—";
      fields.review_note.value=""; fields.review_note_visibility.value="internal";
      setStatusBadge(statusBadge,"draft"); renderEmptyNotes("Le note saranno disponibili dopo il primo salvataggio.");
      form.hidden=false; empty.hidden=true; dirty=false; setActionState(); initCounters(form); history.replaceState(null,"",queueUrl()); loadQueue(); fields.title.focus();
    }
    async function loadNotes(article){
      const box=document.querySelector("[data-review-notes]"); box.replaceChildren();
      const rows=await db(`editorial_article_notes?select=id,body,visibility,created_by,created_at&article_id=eq.${encodeURIComponent(article.id)}&order=created_at.asc`,{token:session.access_token});
      if(!rows?.length){renderEmptyNotes();return;}
      rows.forEach(note=>{const item=document.createElement("article");item.className="ol-note";const meta=document.createElement("small");const who=note.created_by===session.user.id?"Tu":(note.created_by===article.created_by?"Autore":"Redazione");meta.textContent=`${who} · ${note.visibility==="internal"?"nota interna":"visibile all’autore"} · ${formatDate(note.created_at)}`;const body=document.createElement("p");body.textContent=note.body;item.append(meta,body);box.append(item);});
    }
    async function loadQueue(){
      list.replaceChildren(); const loading=document.createElement("p");loading.className="ol-muted";loading.textContent="Caricamento…";list.append(loading);
      const status=filter.value; const statusPart=status==="all"?"":`&status=eq.${encodeURIComponent(status)}`; const scopePart=scope.value==="mine"?`&created_by=eq.${encodeURIComponent(session.user.id)}`:"";
      try{
        const rows=await db(`editorial_articles?select=id,title,status,author_id,created_by,submitted_at,updated_at,published_at&order=updated_at.desc&limit=200${statusPart}${scopePart}`,{token:session.access_token});
        const authors=await fetchAuthors((rows||[]).map(r=>r.author_id),session.access_token);
        list.replaceChildren(); count.textContent=`${rows.length} ${rows.length===1?"articolo":"articoli"} · ${scope.value==="mine"?"i miei":"tutti"}`;
        if(!rows.length){const p=document.createElement("p");p.className="ol-muted";p.textContent="Nessun articolo con questi filtri.";list.append(p);return;}
        rows.forEach(row=>{const a=document.createElement("a");a.className="ol-my-article";a.href=queueUrl(row.id);if(row.id===fields.id.value)a.setAttribute("aria-current","true");const strong=document.createElement("strong");strong.textContent=row.title||"Senza titolo";const author=authors.get(row.author_id);const span=document.createElement("span");span.textContent=`${STATUS_LABELS[row.status]||row.status} · ${author?.display_name||"Autore"} · ${formatDate(row.updated_at)}`;a.append(strong,span);list.append(a);});
      }catch(error){list.replaceChildren();show(configError,`Coda editoriale non disponibile: ${error.message}`);}
    }
    async function loadArticle(id){
      const safe=safeId(id); if(!safe)return;
      clearMessages();
      const rows=await db(`editorial_articles?select=*&id=eq.${encodeURIComponent(safe)}&limit=1`,{token:session.access_token});
      const article=rows?.[0]; if(!article){show(configError,"Articolo non trovato.");return;}
      const authors=await fetchAuthors([article.author_id],session.access_token); populateArticle(article,authors.get(article.author_id)); fields.review_note.value=""; fields.review_note_visibility.value="author"; await loadNotes(article);
    }
    async function addStandaloneNote(articleId){
      const note=text(fields.review_note.value,2000); if(!note)return;
      await db("editorial_article_notes",{method:"POST",token:session.access_token,prefer:"return=minimal",body:{article_id:articleId,body:note,visibility:fields.review_note_visibility.value==="internal"?"internal":"author",created_by:session.user.id}});
      fields.review_note.value="";
    }
    async function saveArticle({silent=false,saveNote=true}={}){
      clearMessages(); const missing=validateArticle(); if(missing.length){show(validation,`Completa prima: ${missing.join(", ")}.`);return null;}
      try{
        let article;
        if(fields.id.value){
          const rows=await db(`editorial_articles?id=eq.${encodeURIComponent(fields.id.value)}&select=*`,{method:"PATCH",token:session.access_token,prefer:"return=representation",body:reviewPayload()}); article=rows?.[0];
        }else{
          if(!ownAuthor)throw new Error("Profilo autore non disponibile per questo account");
          const rows=await db("editorial_articles?select=*",{method:"POST",token:session.access_token,prefer:"return=representation",body:{...reviewPayload(),status:"draft",author_id:ownAuthor.id,created_by:session.user.id,updated_by:session.user.id}}); article=rows?.[0];
        }
        if(!article)throw new Error("Salvataggio non confermato");
        fields.id.value=article.id; fields.status.value=article.status; currentArticle=article;
        if(saveNote)await addStandaloneNote(article.id);
        dirty=false; slugTouched=true; history.replaceState(null,"",queueUrl(article.id));
        if(!silent)show(saveMessage,article.status==="published"?"Modifiche salvate. La versione HTML SEO sarà aggiornata al prossimo deploy.":"Articolo salvato.");
        const authors=await fetchAuthors([article.author_id],session.access_token); populateArticle(article,authors.get(article.author_id)); await loadQueue(); await loadNotes(article); return article;
      }catch(error){show(validation,`Salvataggio non riuscito: ${error.message}`);return null;}
    }
    async function transition(target){
      clearMessages();
      const own=isOwnArticle()||(!fields.id.value&&Boolean(ownAuthor));
      if(member?.role==="editor"&&own&&["changes_requested","approved"].includes(target)){show(validation,"Un editor non può revisionare o approvare un articolo scritto da sé. Deve farlo un altro editor o un admin.");return;}
      if(target==="changes_requested"&&!text(fields.review_note.value,2000)){show(validation,"Scrivi il feedback da inviare all’autore prima di richiedere modifiche.");fields.review_note.focus();return;}
      if(target==="published"){
        if(!fields.seo_title.value.trim())fields.seo_title.value=text(fields.title.value,70);
        if(!fields.seo_description.value.trim())fields.seo_description.value=text(fields.excerpt.value,180);
      }
      const missing=validateArticle({forPublish:target==="published",forReview:target==="in_review"}); if(missing.length){show(validation,`Completa prima: ${missing.join(", ")}.`);return;}
      if(target==="published"&&!window.confirm("Pubblicare questo articolo? Diventerà visibile nell’archivio pubblico."))return;
      if(target==="archived"&&!window.confirm("Archiviare questo articolo?"))return;
      const article=await saveArticle({silent:true,saveNote:false}); if(!article)return;
      const note=text(fields.review_note.value,2000)||null; const visibility=target==="changes_requested"?"author":(fields.review_note_visibility.value==="internal"?"internal":"author");
      try{
        await db("rpc/editorial_staff_transition_article",{method:"POST",token:session.access_token,body:{p_article_id:article.id,p_status:target,p_feedback:note,p_visibility:visibility}});
        fields.review_note.value=""; dirty=false;
        const messages={in_review:"Articolo inviato in revisione.",changes_requested:"Modifiche richieste all’autore.",approved:"Articolo approvato.",published:"Articolo pubblicato. La versione HTML SEO sarà rigenerata al prossimo deploy.",archived:"Articolo archiviato."};
        show(saveMessage,messages[target]||"Stato aggiornato."); await loadArticle(article.id); await loadQueue();
      }catch(error){show(validation,`Cambio stato non riuscito: ${error.message}`);}
    }
    async function loadContext(){
      const rows=await db(`editorial_members?select=user_id,role,active&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`,{token:session.access_token});
      member=rows?.[0]; if(!member?.active||!["editor","admin"].includes(member.role))throw new Error("Account non abilitato alla redazione");
      const authors=await db(`editorial_authors?select=id,user_id,slug,display_name,active&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`,{token:session.access_token});
      ownAuthor=authors?.[0]?.active?authors[0]:null;
      document.querySelector("[data-review-name]").textContent=ownAuthor?.display_name||"Redazione OffertaLogica";
      document.querySelector("[data-review-role]").textContent=member.role; document.querySelector("[data-review-email]").textContent=session.user.email||""; authPanel.hidden=true;workspace.hidden=false;
      newButton.disabled=!ownAuthor; show(authorWarning,ownAuthor?"":"Puoi revisionare gli articoli, ma per scriverne uno tuo devi avere anche un profilo autore attivo.");
      const params=new URLSearchParams(location.search); const requestedStatus=params.get("status"); const requestedScope=params.get("scope");
      if(["in_review","changes_requested","approved","published","draft","archived","all"].includes(requestedStatus))filter.value=requestedStatus;
      if(["all","mine"].includes(requestedScope))scope.value=requestedScope;
      await loadQueue(); const id=params.get("id"); if(id)await loadArticle(id);
    }
    async function activate(){if(!session?.access_token||!session?.user?.id)return;try{await loadContext();}catch(error){sessionWrite(null);session=null;member=null;ownAuthor=null;authPanel.hidden=false;workspace.hidden=true;show(loginError,error.message);}}
    function restoreFiltersFromUrl(){
      const params=new URLSearchParams(location.search); const savedStatus=params.get("status"); const savedScope=params.get("scope");
      filter.value=["in_review","changes_requested","approved","published","draft","archived","all"].includes(savedStatus)?savedStatus:"in_review";
      scope.value=["all","mine"].includes(savedScope)?savedScope:"all";
    }
    function changeQueueFilter(){
      if(dirty&&!window.confirm("Hai modifiche non salvate. Cambiare filtro comunque?")){restoreFiltersFromUrl();return;}
      history.replaceState(null,"",queueUrl()); form.hidden=true;empty.hidden=false;fields.id.value="";currentArticle=null;dirty=false;loadQueue();
    }

    loginForm.addEventListener("submit",async event=>{event.preventDefault();show(loginError,"");const button=loginForm.querySelector("[data-review-login-button]");button.disabled=true;try{const data=await login(text(loginForm.email.value,320),String(loginForm.password.value||""));session={access_token:data.access_token,user:data.user,expires_at:data.expires_at};sessionWrite(session);await activate();}catch(error){show(loginError,`Accesso non riuscito: ${error.message}`);}finally{button.disabled=false;}});
    document.querySelector("[data-review-logout]").addEventListener("click",()=>{sessionWrite(null);location.replace("/redazione");});
    newButton.addEventListener("click",startNewArticle);
    document.querySelector("[data-review-refresh]").addEventListener("click",loadQueue);
    filter.addEventListener("change",changeQueueFilter); scope.addEventListener("change",changeQueueFilter);
    form.querySelector("[data-review-save]").addEventListener("click",()=>saveArticle());
    form.querySelector("[data-review-submit]").addEventListener("click",()=>transition("in_review"));
    form.querySelector("[data-review-changes]").addEventListener("click",()=>transition("changes_requested"));
    form.querySelector("[data-review-approve]").addEventListener("click",()=>transition("approved"));
    form.querySelector("[data-review-publish]").addEventListener("click",()=>transition("published"));
    form.querySelector("[data-review-archive]").addEventListener("click",()=>transition("archived"));
    fields.slug.addEventListener("input",()=>{slugTouched=true;fields.slug.value=normalizeSlug(fields.slug.value);dirty=true;setActionState();});
    fields.title.addEventListener("input",()=>{if(!fields.id.value&&!slugTouched)fields.slug.value=normalizeSlug(fields.title.value);dirty=true;});
    form.querySelectorAll("input,textarea,select").forEach(el=>el.addEventListener("change",()=>dirty=true));
    form.addEventListener("submit",event=>event.preventDefault());
    window.addEventListener("beforeunload",event=>{if(dirty){event.preventDefault();event.returnValue="";}});
    if(session)await activate();
  }

  document.documentElement.dataset.editorialVersion=VERSION; initCounters(); const view=document.body?.dataset?.editorialView||""; if(view==="archive")initPublicArchive(); if(view==="article")initArticlePage(); if(view==="workspace")initWorkspace(); if(view==="review")initReview();
})();
