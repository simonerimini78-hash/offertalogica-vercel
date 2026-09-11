(() => {
  "use strict";

  const VERSION = "0.2.0";
  const SESSION_KEY = "offertalogica.editorial.session.v1";
  const STATUSES = new Set(["draft", "in_review", "changes_requested", "approved", "published", "archived"]);
  const STATUS_LABELS = {draft:"Bozza",in_review:"In revisione",changes_requested:"Modifiche richieste",approved:"Approvato",published:"Pubblicato",archived:"Archiviato"};

  const config = (() => {
    const raw = window.OFFERTALOGICA_EDITORIAL_CONFIG || {};
    return {
      url: String(raw.supabaseUrl || "").replace(/\/+$/, ""),
      key: String(raw.supabaseAnonKey || "").trim(),
    };
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
    const response=await fetch(url,options);
    const payload=await response.json().catch(()=>null);
    if(!response.ok){
      const message=payload?.message||payload?.msg||payload?.error_description||payload?.error||`Errore ${response.status}`;
      const error=new Error(message); error.status=response.status; throw error;
    }
    return payload;
  }
  async function db(path,{method="GET",token="",body=null,prefer=""}={}){
    const headers=authHeaders(token); if(prefer)headers.Prefer=prefer;
    return request(`${config.url}/rest/v1/${path}`,{method,headers,body:body===null?undefined:JSON.stringify(body),cache:"no-store"});
  }
  async function login(email,password){
    return request(`${config.url}/auth/v1/token?grant_type=password`,{method:"POST",headers:authHeaders(),body:JSON.stringify({email,password}),cache:"no-store"});
  }

  function initCounters(root=document){ root.querySelectorAll("[data-count-for]").forEach(counter=>{ const field=document.getElementById(counter.getAttribute("data-count-for")); if(!field)return; const max=Number(field.getAttribute("maxlength")||0); const update=()=>counter.textContent=max?`${field.value.length}/${max}`:String(field.value.length); field.addEventListener("input",update); update(); }); }

  async function fetchAuthors(ids,token=""){
    const unique=[...new Set(ids.filter(Boolean))]; if(!unique.length)return new Map();
    const values=unique.map(id=>id.replace(/[^a-f0-9-]/gi,"")).join(",");
    const rows=await db(`editorial_authors?select=id,slug,display_name,avatar_url&id=in.(${values})`,{token});
    return new Map((rows||[]).map(row=>[row.id,row]));
  }

  function renderArchive(container,articles,authors){
    container.replaceChildren();
    if(!articles.length){ const empty=document.createElement("div"); empty.className="ol-empty"; const h=document.createElement("h2"); h.textContent="Nessun articolo pubblicato"; const p=document.createElement("p"); p.textContent="I contenuti approvati compariranno qui."; empty.append(h,p); container.append(empty); return; }
    articles.forEach(article=>{
      const author=authors.get(article.author_id);
      const item=document.createElement("article"); item.className="ol-article-item";
      const meta=document.createElement("div"); meta.className="ol-article-meta";
      [text(article.category,80),author?.display_name||"Redazione OffertaLogica",formatDate(article.published_at)].filter(Boolean).forEach(value=>{ const span=document.createElement("span"); span.textContent=value; meta.append(span); });
      const h=document.createElement("h2"); const a=document.createElement("a"); a.href=`/articolo.html?slug=${encodeURIComponent(article.slug)}`; a.textContent=article.title; h.append(a);
      const p=document.createElement("p"); p.textContent=article.excerpt||"";
      item.append(meta,h,p); container.append(item);
    });
  }

  async function initPublicArchive(){
    const container=document.querySelector("[data-article-list]"); const errorBox=document.querySelector("[data-public-error]"); if(!container)return;
    if(!configured()){ show(errorBox,"Archivio editoriale non ancora collegato al progetto Supabase."); return; }
    try{
      const articles=await db("editorial_articles?select=id,author_id,slug,title,excerpt,category,published_at,featured_image_url&status=eq.published&order=published_at.desc&limit=50");
      const authors=await fetchAuthors((articles||[]).map(a=>a.author_id)); renderArchive(container,articles||[],authors);
    }catch(error){ show(errorBox,`Impossibile caricare gli articoli: ${error.message}`); }
  }

  async function initArticlePage(){
    const errorBox=document.querySelector("[data-public-error]"); const params=new URLSearchParams(location.search); const slug=normalizeSlug(params.get("slug")||"");
    if(!slug){ show(errorBox,"Articolo non specificato."); return; }
    if(!configured()){ show(errorBox,"Archivio editoriale non ancora collegato al progetto Supabase."); return; }
    try{
      const rows=await db(`editorial_articles?select=id,author_id,slug,title,excerpt,content,category,published_at,featured_image_url,seo_title,seo_description&slug=eq.${encodeURIComponent(slug)}&status=eq.published&limit=1`);
      const article=rows?.[0]; if(!article)throw new Error("Articolo non trovato o non pubblicato");
      const authors=await fetchAuthors([article.author_id]); const author=authors.get(article.author_id);
      document.querySelector("[data-article-title]").textContent=article.title;
      document.querySelector("[data-article-excerpt]").textContent=article.excerpt||"";
      document.querySelector("[data-article-category]").textContent=article.category||"Articolo OffertaLogica";
      document.querySelector("[data-article-author]").textContent=author?.display_name||"Redazione OffertaLogica";
      document.querySelector("[data-article-date]").textContent=formatDate(article.published_at);
      const body=document.querySelector("[data-article-content]"); body.replaceChildren();
      String(article.content||"").split(/\n\s*\n/).map(v=>v.trim()).filter(Boolean).forEach(block=>{ const p=document.createElement("p"); p.textContent=block; body.append(p); });
      const image=document.querySelector("[data-article-image]"); if(image&&/^https:\/\//i.test(article.featured_image_url||"")){ image.src=article.featured_image_url; image.alt=article.title; image.hidden=false; }
      document.title=article.seo_title||`${article.title} | OffertaLogica`;
      const description=document.querySelector('meta[name="description"]'); if(description)description.content=article.seo_description||article.excerpt||"Approfondimento OffertaLogica.";
    }catch(error){ show(errorBox,error.message); }
  }

  function workspaceFields(form){ return Object.fromEntries([...form.elements].filter(el=>el.name).map(el=>[el.name,el])); }

  async function initWorkspace(){
    const authPanel=document.querySelector("[data-auth-panel]"); const workspace=document.querySelector("[data-editorial-workspace]"); const configError=document.querySelector("[data-config-error]"); const loginForm=document.querySelector("[data-login-form]"); const loginError=document.querySelector("[data-login-error]");
    if(!configured()){ show(configError,"Configurazione Supabase editoriale mancante. Inserire esclusivamente URL progetto e anon key in /public/assets/editorial-config.js. Non usare mai la service-role nel browser."); if(loginForm)loginForm.querySelector("button").disabled=true; return; }
    let session=sessionRead(); let context=null; let dirty=false;
    const form=document.querySelector("[data-editorial-form]"); const fields=workspaceFields(form); const statusBadge=document.querySelector("[data-current-status]"); const saveMessage=document.querySelector("[data-save-message]"); const validation=document.querySelector("[data-validation-message]");

    function currentEditable(){ const s=fields.status.value; return context?.member?.role!=="contributor" || s==="draft" || s==="changes_requested"; }
    function setEditable(){ const enabled=currentEditable(); form.querySelectorAll("input:not([type=hidden]),textarea,select").forEach(el=>el.disabled=!enabled); form.querySelector("[data-save-draft]").disabled=!enabled; form.querySelector("[data-send-review]").disabled=!enabled; }
    function resetForm(){ form.reset(); fields.id.value=""; fields.status.value="draft"; setStatusBadge(statusBadge,"draft"); document.querySelector("[data-form-title]").textContent="Nuovo articolo"; history.replaceState(null,"","/collaboratori.html"); dirty=false; setEditable(); }
    function payloadFromForm(){ return {title:text(fields.title.value,140),slug:normalizeSlug(fields.slug.value),excerpt:text(fields.excerpt.value,320),content:text(fields.content.value,40000),featured_image_url:text(fields.featured_image_url.value,1000)||null,category:text(fields.category.value,80)||null,sources:text(fields.sources.value,4000)||null}; }
    function validateForReview(){ const p=payloadFromForm(); const missing=[]; if(!p.title)missing.push("Titolo"); if(!p.slug)missing.push("Slug"); if(!p.excerpt)missing.push("Sommario"); if(!p.content)missing.push("Contenuto"); return missing; }
    async function addNote(articleId){ const note=text(fields.editorial_note.value,2000); if(!note)return; await db("editorial_article_notes",{method:"POST",token:session.access_token,prefer:"return=minimal",body:{article_id:articleId,body:note,visibility:"author",created_by:session.user.id}}); fields.editorial_note.value=""; }
    async function saveDraft({silent=false}={}){
      show(validation,""); show(saveMessage,""); const payload=payloadFromForm(); if(!payload.title||!payload.slug){ show(validation,"Titolo e slug sono obbligatori per salvare la bozza."); return null; }
      let article;
      try{
        if(fields.id.value){ const rows=await db(`editorial_articles?id=eq.${encodeURIComponent(fields.id.value)}&select=*`,{method:"PATCH",token:session.access_token,prefer:"return=representation",body:payload}); article=rows?.[0]; }
        else { const rows=await db("editorial_articles?select=*",{method:"POST",token:session.access_token,prefer:"return=representation",body:{...payload,status:"draft",author_id:context.author.id,created_by:session.user.id,updated_by:session.user.id}}); article=rows?.[0]; }
        if(!article)throw new Error("Salvataggio non confermato"); fields.id.value=article.id; fields.status.value=article.status; setStatusBadge(statusBadge,article.status); await addNote(article.id); dirty=false; history.replaceState(null,"",`/collaboratori.html?id=${encodeURIComponent(article.id)}`); if(!silent)show(saveMessage,"Bozza salvata."); await loadList(); return article;
      }catch(error){ show(validation,`Salvataggio non riuscito: ${error.message}`); return null; }
    }
    async function sendReview(){ const missing=validateForReview(); if(missing.length){ show(validation,`Completa prima: ${missing.join(", ")}.`); return; } const article=await saveDraft({silent:true}); if(!article)return; try{ const rows=await db(`editorial_articles?id=eq.${encodeURIComponent(article.id)}&select=*`,{method:"PATCH",token:session.access_token,prefer:"return=representation",body:{status:"in_review"}}); const updated=rows?.[0]; fields.status.value=updated?.status||"in_review"; setStatusBadge(statusBadge,fields.status.value); dirty=false; setEditable(); show(saveMessage,"Articolo inviato alla redazione per la revisione."); await loadList(); }catch(error){ show(validation,`Invio in revisione non riuscito: ${error.message}`); } }
    async function loadList(){ const box=document.querySelector("[data-my-articles]"); const rows=await db(`editorial_articles?select=id,title,status,updated_at&created_by=eq.${encodeURIComponent(session.user.id)}&order=updated_at.desc&limit=100`,{token:session.access_token}); box.replaceChildren(); if(!rows.length){ const p=document.createElement("p"); p.className="ol-muted"; p.textContent="Nessun articolo ancora."; box.append(p); return; } rows.forEach(row=>{ const a=document.createElement("a"); a.className="ol-my-article"; a.href=`/collaboratori.html?id=${encodeURIComponent(row.id)}`; if(row.id===fields.id.value)a.setAttribute("aria-current","true"); const strong=document.createElement("strong"); strong.textContent=row.title||"Senza titolo"; const span=document.createElement("span"); span.textContent=`${STATUS_LABELS[row.status]||row.status} · ${formatDate(row.updated_at)}`; a.append(strong,span); box.append(a); }); }
    async function loadArticle(id){ const safe=String(id||"").replace(/[^a-f0-9-]/gi,""); if(!safe)return resetForm(); const rows=await db(`editorial_articles?select=*&id=eq.${encodeURIComponent(safe)}&created_by=eq.${encodeURIComponent(session.user.id)}&limit=1`,{token:session.access_token}); const article=rows?.[0]; if(!article)return resetForm(); Object.entries({id:article.id,status:article.status,title:article.title,slug:article.slug,category:article.category||"",featured_image_url:article.featured_image_url||"",excerpt:article.excerpt||"",content:article.content||"",sources:article.sources||""}).forEach(([k,v])=>{ if(fields[k])fields[k].value=v??""; }); fields.editorial_note.value=""; document.querySelector("[data-form-title]").textContent=article.title||"Articolo"; setStatusBadge(statusBadge,article.status); dirty=false; setEditable(); initCounters(form); }
    async function loadContext(){
      const members=await db(`editorial_members?select=user_id,role,active&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`,{token:session.access_token}); const member=members?.[0]; if(!member?.active)throw new Error("Account non abilitato dalla redazione");
      const authors=await db(`editorial_authors?select=id,user_id,slug,display_name,active&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`,{token:session.access_token}); const author=authors?.[0]; if(!author?.active)throw new Error("Profilo autore non abilitato"); context={member,author};
      document.querySelector("[data-member-name]").textContent=author.display_name||"Collaboratore"; document.querySelector("[data-member-role]").textContent=member.role; document.querySelector("[data-member-email]").textContent=session.user.email||""; authPanel.hidden=true; workspace.hidden=false; await loadList(); const id=new URLSearchParams(location.search).get("id"); if(id)await loadArticle(id); else resetForm();
    }
    async function activate(){ if(!session?.access_token||!session?.user?.id)return; try{ await loadContext(); }catch(error){ sessionWrite(null); session=null; context=null; authPanel.hidden=false; workspace.hidden=true; show(loginError,error.message); } }

    loginForm.addEventListener("submit",async event=>{ event.preventDefault(); show(loginError,""); const button=loginForm.querySelector("[data-login-button]"); button.disabled=true; try{ const data=await login(text(loginForm.email.value,320),String(loginForm.password.value||"")); session={access_token:data.access_token,user:data.user,expires_at:data.expires_at}; sessionWrite(session); await activate(); }catch(error){ show(loginError,`Accesso non riuscito: ${error.message}`); }finally{button.disabled=false;} });
    document.querySelector("[data-logout]").addEventListener("click",()=>{ sessionWrite(null); location.replace("/collaboratori.html"); });
    document.querySelector("[data-new-article]").addEventListener("click",resetForm);
    form.querySelector("[data-save-draft]").addEventListener("click",()=>saveDraft());
    form.querySelector("[data-send-review]").addEventListener("click",sendReview);
    fields.slug.addEventListener("input",()=>{ fields.slug.value=normalizeSlug(fields.slug.value); dirty=true; }); let slugTouched=false; fields.slug.addEventListener("input",()=>{slugTouched=true;}); fields.title.addEventListener("input",()=>{ if(!slugTouched)fields.slug.value=normalizeSlug(fields.title.value); dirty=true; }); form.querySelectorAll("input,textarea,select").forEach(el=>{el.addEventListener("change",()=>dirty=true);});
    form.addEventListener("submit",event=>event.preventDefault()); window.addEventListener("beforeunload",event=>{if(dirty){event.preventDefault();event.returnValue="";}});
    if(session)await activate();
  }

  document.documentElement.dataset.editorialVersion=VERSION; initCounters(); const view=document.body?.dataset?.editorialView||""; if(view==="archive")initPublicArchive(); if(view==="article")initArticlePage(); if(view==="workspace")initWorkspace();
})();
