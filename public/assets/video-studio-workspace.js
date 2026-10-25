/* Video Studio v1.0.1 — manual, server-gated real creative AI previews; no publication or SQL. */
(() => {
  'use strict';
  const root = document.querySelector('[data-vs-workspace]');
  const workspace = document.querySelector('[data-review-workspace]');
  if (!root || !workspace) return;

  const SESSION_KEY = 'offertalogica.editorial.session.v1';
  const qs = selector => root.querySelector(selector);
  const articleWrap = qs('[data-vs-article-wrap]');
  const themeWrap = qs('[data-vs-theme-wrap]');
  const articleSelect = qs('[data-vs-article]');
  const themeInput = qs('#vs-editorial-theme');
  const suggestionsInput = qs('#vs-editorial-suggestions');
  const platformSelect = qs('#vs-editorial-platform');
  const form = qs('[data-vs-brief-form]');
  const status = qs('[data-vs-session-status]');
  const feedback = qs('[data-vs-feedback]');
  const output = qs('[data-vs-output]');
  const summary = qs('[data-vs-summary]');
  const downloadButton = qs('[data-vs-download]');
  const refreshButton = qs('[data-vs-refresh]');
  const submitButton = form.querySelector('[type="submit"]');
  const generateButton = qs('[data-vs-generate]');
  const realSection = qs('[data-vs-generated]');
  const realSummary = qs('[data-vs-generated-summary]');
  const sceneHolder = qs('[data-vs-scenes]');
  let articles = [];
  let brief = null;
  let checking = null;
  let generation = null;
  let working = false;

  const config = window.OFFERTALOGICA_EDITORIAL_CONFIG || {};
  const url = String(config.supabaseUrl || '').replace(/\/+$/, '');
  const publicKey = String(config.supabaseAnonKey || '');
  function displayStatus(message, error = false) {
    status.textContent = message;
    status.style.color = error ? '#9f2d2d' : '';
  }
  function message(text, error = false) {
    feedback.textContent = text;
    feedback.hidden = !text;
    feedback.classList.toggle('ol-alert-danger', error);
    feedback.classList.toggle('ol-alert-success', !error);
  }
  function clearBrief() {
    brief = null;
    generation = null;
    generateButton.disabled = true;
    realSection.hidden = true;
    realSummary.replaceChildren();
    sceneHolder.replaceChildren();
    downloadButton.disabled = true;
    output.hidden = true;
    summary.replaceChildren();
    message('');
  }
  function selectedSource() { return qs('[name="vs-source"]:checked')?.value || 'article'; }
  function changeSource() {
    const article = selectedSource() === 'article';
    articleWrap.hidden = !article;
    themeWrap.hidden = article;
    themeInput.required = !article;
    articleSelect.required = article;
    clearBrief();
  }
  async function request(path, token) {
    if (!url || !publicKey) throw Error('Configurazione Redazione non disponibile.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 14000);
    try {
      const response = await fetch(`${url}${path}`, {
        headers: {apikey: publicKey, Authorization: `Bearer ${token}`},
        cache: 'no-store', signal: controller.signal
      });
      if (!response.ok) throw Error(response.status === 401 || response.status === 403 ?
        'Sessione non valida o accesso non autorizzato.' : `Servizio editoriale non disponibile (${response.status}).`);
      return await response.json();
    } catch (e) {
      if (e.name === 'AbortError') throw Error('Tempo di risposta esaurito.');
      throw e;
    } finally { clearTimeout(timer); }
  }
  function getSession() {
    let session;
    try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
    return session?.access_token && session?.user?.id ? session : null;
  }
  async function requireEditor() {
    if (workspace.hidden) throw Error('Effettua prima l’accesso alla Redazione.');
    const session = getSession();
    if (!session) throw Error('Sessione editoriale assente o scaduta.');
    const user = await request('/auth/v1/user', session.access_token);
    if (user?.id !== session.user.id) throw Error('Sessione editoriale non valida.');
    const rows = await request(`/rest/v1/editorial_members?select=user_id,role,active&user_id=eq.${encodeURIComponent(user.id)}&limit=1`, session.access_token);
    const member = rows?.[0];
    if (!member?.active || !['admin','editor'].includes(member.role)) throw Error('Sezione riservata a editor e amministratori.');
    return session.access_token;
  }
  async function loadArticles(token) {
    refreshButton.disabled = true;
    try {
      const rows = await request('/rest/v1/editorial_articles?select=id,title,slug,status,updated_at,published_at,category&status=eq.published&order=published_at.desc.nullslast&limit=100',token);
      articles = Array.isArray(rows) ? rows : [];
      const current = articleSelect.value;
      articleSelect.replaceChildren();
      articleSelect.append(new Option('Seleziona un articolo pubblicato', ''));
      for (const item of articles) articleSelect.append(new Option(item.title || '(senza titolo)', item.id));
      if (articles.some(item => item.id === current)) articleSelect.value = current;
      if (!articles.length) message('Non risultano articoli pubblicati accessibili a questo account. Puoi utilizzare il tema libero.');
    } finally { refreshButton.disabled = false; }
  }
  async function initialize() {
    if (checking) return checking;
    checking = (async () => {
      form.hidden = true;
      displayStatus('Verifica della sessione editoriale…');
      try {
        const token = await requireEditor();
        await loadArticles(token);
        form.hidden = false;
        displayStatus('Accesso verificato · Laboratorio di preparazione attivo. Nessun collegamento AI o MP4.');
      } catch (e) { displayStatus(e.message, true); }
    })();
    try { await checking; } finally { checking = null; }
  }
  function parseSources(raw) {
    const lines = String(raw || '').split(/\r?\n/).filter(Boolean);
    const seen = new Set(), found = [];
    for (const line of lines) {
      const links = line.match(/https:\/\/[^\s<>\]\)"']+/g) || [];
      for (const item of links) {
        const cleaned = item.replace(/[.,;]+$/, '');
        try {
          const parsed = new URL(cleaned);
          if (parsed.protocol !== 'https:' || !parsed.hostname || cleaned.length > 1000 || seen.has(parsed.href)) continue;
          seen.add(parsed.href);
          found.push({id:`fonte_${found.length+1}`,url:parsed.href});
        } catch { /* Nota che non contiene un URL */ }
      }
    }
    return found;
  }
  async function makeArticleInput(token) {
    const id = articleSelect.value;
    if (!articles.some(article => article.id === id)) throw Error('Seleziona un articolo pubblicato.');
    // Always reload the source: do not reuse a stale snapshot or its publication status.
    const rows = await request(`/rest/v1/editorial_articles?select=id,title,slug,status,updated_at,published_at,category,content,sources&id=eq.${encodeURIComponent(id)}&status=eq.published&limit=1`,token);
    const row = rows?.[0];
    if (!row) throw Error('Articolo non più pubblicato o non accessibile.');
    const sources = parseSources(row.sources);
    if (!sources.length) throw Error('Questo articolo non contiene URL HTTPS verificabili nelle fonti. Aggiungili nella Redazione prima di procedere.');
    if (!String(row.content || '').trim() || String(row.content).trim().length < 60) throw Error('Il testo dell’articolo è insufficiente per Video Studio.');
    if (!row.slug || !row.updated_at) throw Error('Articolo privo di slug o versione verificabile.');
    const slug = String(row.slug).toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw Error('Slug articolo non valido.');
    return {
      theme: null,
      article: {
        id:row.id, version:String(row.updated_at), status:'published', title:row.title,
        url:`https://offertalogica.it/articoli/${encodeURIComponent(slug)}.html`,
        category:row.category || 'energia', content:row.content, sources
      }
    };
  }
  function setSummary(b) {
    summary.replaceChildren();
    function line(label, value) {
      const p = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = `${label}: `;
      p.append(strong,document.createTextNode(value));
      summary.append(p);
    }
    line('Origine', b.mode === 'article' ? 'Articolo Editoriale pubblicato' : 'Tema libero');
    line('Titolo', b.mode === 'article' ? b.input.article.title : b.input.theme);
    line('Suggerimenti', b.input.suggestions || 'Nessuno');
    line('Destinazione', b.input.platform);
    line('Passaggio successivo', 'Regia AI da collegare lato server; nessuna generazione eseguita');
    output.hidden = false;
  }
  async function prepare(event) {
    event.preventDefault();
    submitButton.disabled = true;
    clearBrief();
    try {
      const token = await requireEditor();
      const mode = selectedSource();
      let base;
      if (mode === 'article') base = await makeArticleInput(token);
      else {
        const theme = themeInput.value.trim();
        if (!theme || theme.length > 180) throw Error('Inserisci un tema di massimo 180 caratteri.');
        base = {theme, article:null};
      }
      const suggestions = suggestionsInput.value.trim();
      if (suggestions.length > 1800) throw Error('Suggerimenti troppo lunghi.');
      brief = {
        schema_version:1,
        status:'prepared_not_generated',
        mode,
        input:{...base,suggestions,platform:platformSelect.value},
        next_step:'creative_director_requires_protected_server_execution',
        publication_authorized:false
      };
      setSummary(brief);
      downloadButton.disabled = false;
      generateButton.disabled = false;
      message('Brief pronto. Premi «Genera storyboard AI» per eseguire la vera chiamata al motore.');
    } catch (e) { message(e.message,true); } finally { submitButton.disabled = false; }
  }
  async function labRequest(action, body, token, timeMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeMs);
    try {
      const response = await fetch(`/api/staff-analytics?action=${encodeURIComponent(action)}`, {
        method: 'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body:JSON.stringify(body), cache:'no-store', credentials:'same-origin', signal:controller.signal
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw Error(payload?.error ||
        (response.status===401 ? 'La generazione AI richiede un account amministratore.' :
          `Servizio Video Studio non disponibile (${response.status}).`));
      return payload.result;
    } catch(e) {
      if(e.name==='AbortError') throw Error('Tempo massimo della generazione superato. Riprova solo dopo avere controllato lo stato del servizio.');
      throw e;
    } finally {clearTimeout(timer);}
  }
  function textElement(tag,value) {const el=document.createElement(tag);el.textContent=value;return el;}
  async function generateCreative() {
    if(!brief || working) return;
    working=true;generateButton.disabled=true;generation=null;
    realSection.hidden=true;realSummary.replaceChildren();sceneHolder.replaceChildren();
    message('Richiesta inviata al motore creativo reale. Nessuna generazione simulata.');
    try {
      const token=await requireEditor();
      const data={platform:brief.input.platform,suggestions:brief.input.suggestions};
      if(brief.mode==='article')data.article_id=brief.input.article.id;
      else data.theme=brief.input.theme;
      generation=await labRequest('video-studio-storyboard',data,token,110000);
      if(generation?.plan?.scenes?.length!==4)throw Error('Storyboard generato non valido.');
      realSummary.append(textElement('p',`Concept: ${generation.plan.concept}`),
        textElement('p',`Pubblico: ${generation.plan.audience}`),
        textElement('p',`Avvertenza editoriale: ${generation.plan.editorial_caution}`));
      for(const [index,scene] of generation.plan.scenes.entries()) {
        const card=document.createElement('article');card.className='ol-vs-scene-card';
        card.append(textElement('h4',`Scena ${index+1} · ${scene.duration_ms/1000}s · ${scene.role}`),
          textElement('p',`${scene.headline}${scene.secondary_text ? ' — '+scene.secondary_text : ''}`),
          textElement('p',`Immagine: ${scene.visual_brief}`),
          textElement('p',`Soggetto: ${scene.subject_description} · Emozione: ${scene.emotion}`),
          textElement('p',`Posizione soggetto: ${scene.subject_side}`));
        const photoButton=textElement('button','Genera fotografia originale');
        photoButton.type='button';photoButton.className='ol-button ol-button-secondary ol-button-small';
        const state=textElement('p','Nessuna fotografia generata.');state.className='ol-muted ol-small';
        const image=document.createElement('img');image.hidden=true;image.alt=`Fotografia proposta per scena ${index+1}, da revisionare`;image.className='ol-vs-scene-photo';
        const prompt=document.createElement('details');prompt.append(textElement('summary','Mostra prompt fotografico'));
        const promptBody=textElement('pre','');prompt.append(promptBody);prompt.hidden=true;
        photoButton.addEventListener('click', async () => {
          if(working || !generation)return;
          working=true;photoButton.disabled=true;state.textContent='Generazione fotografica reale richiesta…';
          try {
            const token=await requireEditor();
            const result=await labRequest('video-studio-photo',{
              input:generation.input,plan:generation.plan,receipt:generation.receipt,scene_index:index
            },token,230000);
            image.src=`data:${result.preview_mime};base64,${result.preview_base64}`;
            image.hidden=false;promptBody.textContent=result.prompt;prompt.hidden=false;
            state.textContent=`Generata · ${result.provider} · Anteprima non persistente, da verificare. Nessun MP4 creato.`;
          } catch(e) {state.textContent=`BLOCCATO: ${e.message}`;photoButton.disabled=false;}
          finally {working=false;}
        });
        card.append(photoButton,state,image,prompt);sceneHolder.append(card);
      }
      realSection.hidden=false;
      message('Storyboard AI generato dal provider. Le fotografie vengono generate soltanto su richiesta, una per volta.');
    } catch(e) {
      message(`Generazione non riuscita: ${e.message}`,true);
    } finally {working=false;generateButton.disabled=!brief;}
  }
  function download() {
    if (!brief) return;
    const bytes = JSON.stringify(brief,null,2) + '\n';
    const blob = new Blob([bytes], {type:'application/json'});
    const localUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = localUrl; anchor.download = 'video-studio-input.json';
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(localUrl), 1000);
  }

  form.addEventListener('submit',prepare);
  root.querySelectorAll('[name="vs-source"]').forEach(radio => radio.addEventListener('change',changeSource));
  form.querySelectorAll('input,select,textarea').forEach(field => field.addEventListener('input',clearBrief));
  refreshButton.addEventListener('click',async () => {
    clearBrief();
    try { await loadArticles(await requireEditor()); } catch(e) {message(e.message,true);}
  });
  downloadButton.addEventListener('click',download);
  generateButton.addEventListener('click',generateCreative);
  root.addEventListener('toggle', () => { if (root.open) initialize(); });
  document.querySelector('[href="#editorial-video-studio"]')?.addEventListener('click', () => {
    root.open = true; initialize();
  });
  changeSource();
})();
