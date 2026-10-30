/* Video Studio v1.2.2 — visual layers, authentic logo and resumable local/portable browser drafts. */
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
  const guideWrap = qs('[data-vs-guide-wrap]');
  const guideInput = qs('#vs-editorial-guide');
  const guideMode = qs('#vs-editorial-guide-mode');
  const guideFidelity = qs('#vs-editorial-guide-fidelity');
  const guideContext = qs('#vs-editorial-guide-context');
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
  let sceneViews = [];
  let guideFile = null;
  let progressView = null;
  let previewView = null;
  let activeRequests = 0;
  let batchRunning = false;
  let previewPlaying = false;
  let previewIndex = 0;
  let previewFrameId = null;
  let previewStartedAt = 0;
  let soundtrackUrl = null;
  let soundtrackStart = 0;
  let soundtrackFile = null;
  let soundtrackLoadToken = 0;
  let localTracks = []; // Optional private browser fallback; never uploaded to our servers.
  const remoteTracks = new Map(); // At most three downloaded tracks in memory, never public URLs.
  let musicSelectionEpoch = 0;
  let musicLoading = false;
  const MUSIC_STORAGE_BUCKET = 'video-studio-music';
  const MAX_REMOTE_BYTES = 10 * 1024 * 1024;
  let musicLibraryEpoch = 0;
  let musicPersistedOnDevice = false;
  let verifiedProductScreen = null;
  let productScreenUrl = null;
  const MUSIC_DB_NAME = 'offertalogica.video-studio.music.v1';
  const MUSIC_STORE = 'editor-libraries';
  const MAX_SCREEN_BYTES = 8 * 1024 * 1024;
  let previousAutomaticTrack = -1;
  let automaticCounter = 0;
  let exporting = false;
  let exportDownloadUrl = null;
  let preparing = false;
  let projectToolbar = null;
  let projectStatus = null;
  let projectSaveButton = null;
  let projectExportButton = null;
  let projectResumeButton = null;
  let projectImportInput = null;
  let localProjectActive = false;
  let autoSaveTimer = null;
  const PROJECT_DB_NAME = 'offertalogica.video-studio.projects.v1';
  const PROJECT_STORE = 'working-projects';
  const MAX_PROJECT_BYTES = 32 * 1024 * 1024;
  const PROJECT_SCHEMA = 'offertalogica.video-studio.draft.v1';
  const MAX_LOCAL_TRACKS = 12;
  // Filename/hash-prefix identification for the 11 private MP3s. Never means licensed/approved.
  // Cues are unreviewed 15-second candidates, not beat-synchronized markers.
  const MUSIC_INDEX = Object.freeze([
    {title:'The King',stem:'the-king-857',hash:'d8a4b4280081e92e48',sha256:'d8a4b4280081e92e48a6a3e0034a1e7acd4abb19b41aefb772e92d058cb7f724',size:4373527,cue:16,moods:['positivo']},
    {title:'Close Up',stem:'close-up-1167',hash:'a7f05a29d07a84d380',sha256:'a7f05a29d07a84d38072ccd2b35204bca812db86e75b2a837e71cc144d3e739b',size:3045294,cue:78,moods:['informativo']},
    {title:'Curiosity',stem:'curiosity-480',hash:'181e91737f341ca61a',sha256:'181e91737f341ca61a1641b2955cc794fa6276ca0854d06266d55841d655a24b',size:3613867,cue:13.75,moods:['informativo']},
    {title:"I'm Fine",stem:'im-fine-1002',hash:'cee0e8584bc8e7de7f',sha256:'cee0e8584bc8e7de7f31f0aaef45d109693ea1905db7ff845171751cd8e75880',size:3330592,cue:84.5,moods:['rassicurante']},
    {title:"It's Love",stem:'its-love-834',hash:'c69dc74479239f6344',sha256:'c69dc74479239f63442a369891a57c7f9a05236a7090e4b694057c13f3843cf9',size:3092180,cue:2,moods:['rassicurante']},
    {title:'Raising Me Higher',stem:'raising-me-higher-34',hash:'619b82cea299230cca',sha256:'619b82cea299230cca5beac36d049291a1cb2be8ce0afdafda3e06fb30d06525',size:3126333,cue:78.75,moods:['positivo']},
    {title:'What About Action?',stem:'what-about-action-474',hash:'4bcd99a13f3d71c6d3',sha256:'4bcd99a13f3d71c6d356c2459f6f585f0d3f91ca8912aeef81ac626b8c8e3133',size:3747466,cue:14.75,moods:['positivo','informativo']},
    {title:"Dirty Thinkin'",stem:'dirty-thinkin-989',hash:'e36220dbbaf56e0380',sha256:'e36220dbbaf56e0380bb106e32779b1832fa8f4bd8d40edcaf15b07a17bb9a8f',size:2854705,cue:72.75,moods:['positivo','informativo']},
    {title:'Driving Ambition',stem:'driving-ambition-32',hash:'e3c88488e65b8c87a6',sha256:'e3c88488e65b8c87a6f06120983ce2cb12ea3aeba99f8cadb7ee5d6d284ef2c6',size:3270947,cue:73.25,moods:['rassicurante','positivo']},
    {title:'Tech House vibes',stem:'tech-house-vibes-130',hash:'95972c602ff0686e29',sha256:'95972c602ff0686e298792f45b384f0e15477f3cf983f05dd98fd5e5d965eed6',size:3276082,cue:82.25,moods:['informativo']},
    {title:'Expressive Courage',stem:'expressive-courage-468',hash:'403cd5b74ae9c47799',sha256:'403cd5b74ae9c47799ed0042dfea9e3da6d8822433cbaf09c051d7a534e6383c',size:3087090,cue:76.5,moods:['positivo','informativo']},
  ]);
  function musicMeta(file) {
    const name = String(file?.name || '').toLowerCase();
    return MUSIC_INDEX.find(track => name.includes(track.stem) || name.includes(track.hash)) || null;
  }
  const briefFields = [...form.querySelectorAll('input,select,textarea')];

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
  function textElement(tag, value) {
    const el = document.createElement(tag);
    el.textContent = value;
    return el;
  }
  function stopPreview() {
    previewPlaying = false;
    if (previewFrameId !== null) {
      cancelAnimationFrame(previewFrameId);
      previewFrameId = null;
    }
    if (previewView?.musicAudio) {
      previewView.musicAudio.pause();
      previewView.musicAudio.volume = 1;
    }
    if (previewView?.playButton) previewView.playButton.textContent = 'Riproduci montaggio';
    syncVisualEditor();
  }
  function releaseSoundtrack() {
    ++soundtrackLoadToken;
    stopPreview();
    if (soundtrackUrl) URL.revokeObjectURL(soundtrackUrl);
    soundtrackUrl = null;
    soundtrackStart = 0;
    soundtrackFile = null;
    if (previewView?.musicAudio) {
      previewView.musicAudio.removeAttribute('src');
      previewView.musicAudio.load();
    }
  }
  function resetGeneratedOutput() {
    if (exportDownloadUrl) URL.revokeObjectURL(exportDownloadUrl);
    exportDownloadUrl = null;
    releaseSoundtrack();
    clearProductScreen();
    generation = null;
    sceneViews = [];
    progressView = null;
    previewView = null;
    realSection.hidden = true;
    realSummary.replaceChildren();
    sceneHolder.replaceChildren();
  }
  function clearBrief() {
    if (busy() || preparing) return;
    brief = null;
    generateButton.disabled = true;
    resetGeneratedOutput();
    downloadButton.disabled = true;
    output.hidden = true;
    summary.replaceChildren();
    message('');
  }
  function selectedSource() { return qs('[name="vs-source"]:checked')?.value || 'article'; }
  function changeSource() {
    const mode=selectedSource();
    articleWrap.hidden = mode!=='article';
    themeWrap.hidden = mode!=='theme';
    guideWrap.hidden = mode!=='image';
    themeInput.required = mode==='theme';
    articleSelect.required = mode==='article';
    guideInput.required = mode==='image';
    clearBrief();
  }
  function busy() {
    return preparing || batchRunning || activeRequests > 0 || exporting;
  }
  function syncControls() {
    const isBusy = busy();
    generateButton.disabled = !brief || isBusy;
    submitButton.disabled = isBusy;
    refreshButton.disabled = isBusy;
    downloadButton.disabled = !brief || isBusy;
    briefFields.forEach(field => { field.disabled = isBusy; });
    sceneViews.forEach(view => {
      if(view.uploadInput) view.uploadInput.disabled = isBusy || view.running;
      view.actionButton.disabled = !generation || isBusy || view.running ||
        (view.index>0 && sceneViews.slice(0,view.index).some(prev=>!prev.result?.continuity_reference));
      view.notesInput.disabled = isBusy && !view.running;
    });
    if (projectSaveButton) projectSaveButton.disabled = !generation || isBusy;
    if (projectExportButton) projectExportButton.disabled = !generation || isBusy;
    if (projectResumeButton) projectResumeButton.disabled = isBusy;
    if (projectImportInput) projectImportInput.disabled = isBusy;
    if (previewView?.playButton) previewView.playButton.disabled = availablePreviewIndices().length !== 4 || isBusy || musicLoading;
    if (previewView?.exportButton) previewView.exportButton.disabled = availablePreviewIndices().length !== 4 || isBusy || musicLoading;
    if (previewView?.musicInput) previewView.musicInput.disabled = isBusy;
    if (previewView?.musicChoice) previewView.musicChoice.disabled = isBusy || musicLoading;
    if (previewView?.musicClear) previewView.musicClear.disabled = isBusy || !localTracks.length;
    if (previewView?.productInput) previewView.productInput.disabled = isBusy;
    if (previewView?.productChoice) previewView.productChoice.disabled = isBusy;
    if (previewView?.productConfirmed) previewView.productConfirmed.disabled = isBusy || !verifiedProductScreen;
    if (previewView?.editorMode) {
      const disabled = isBusy || previewPlaying;
      previewView.editorMode.disabled = disabled;
      previewView.editorScene.disabled = disabled;
      previewView.editorLayer.disabled = disabled;
      for(const section of [previewView.editorFields,previewView.editorLogoFields,previewView.editorExtraFields])
        section?.querySelectorAll('input,select,textarea,button').forEach(field => {
          field.disabled = disabled || !sceneIsManuallyEditable(currentTextView());
        });
      for(const button of [previewView.addTextButton,previewView.duplicateTextButton,previewView.removeTextButton])
        if(button)button.disabled=disabled || !sceneIsManuallyEditable(currentTextView());
      updateTextHandles();
    }
    if (previewView?.exportButton && previewView.musicChoice) {
      const selectedSilent = previewView.musicChoice.value === 'none';
      previewView.exportButton.disabled ||= !soundtrackFile && !selectedSilent;
    }
  }
  function beginRequest() {
    activeRequests += 1;
    syncControls();
  }
  function endRequest() {
    activeRequests = Math.max(0, activeRequests - 1);
    syncControls();
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
      if (!response.ok) throw Error(response.status === 401 || response.status === 403
        ? 'Sessione non valida o accesso non autorizzato.'
        : `Servizio editoriale non disponibile (${response.status}).`);
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
    if (!member?.active || !['admin', 'editor'].includes(member.role)) throw Error('Sezione riservata a editor e amministratori.');
    return session.access_token;
  }
  async function loadArticles(token) {
    refreshButton.disabled = true;
    try {
      const rows = await request('/rest/v1/editorial_articles?select=id,title,slug,status,updated_at,published_at,category&status=eq.published&order=published_at.desc.nullslast&limit=100', token);
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
        displayStatus('Accesso verificato · Storyboard AI e fotografie originali disponibili per revisione manuale.');
      } catch (e) { displayStatus(e.message, true); }
    })();
    try { await checking; } finally { checking = null; }
  }
  function parseSources(raw) {
    const lines = String(raw || '').split(/\r?\n/).filter(Boolean);
    const seen = new Set();
    const found = [];
    for (const line of lines) {
      const links = line.match(/https:\/\/[^\s<>\]\)"']+/g) || [];
      for (const item of links) {
        const cleaned = item.replace(/[.,;]+$/, '');
        try {
          const parsed = new URL(cleaned);
          if (parsed.protocol !== 'https:' || !parsed.hostname || cleaned.length > 1000 || seen.has(parsed.href)) continue;
          seen.add(parsed.href);
          found.push({id: `fonte_${found.length + 1}`, url: parsed.href});
        } catch { /* Nota che non contiene un URL */ }
      }
    }
    return found;
  }
  async function makeArticleInput(token) {
    const id = articleSelect.value;
    if (!articles.some(article => article.id === id)) throw Error('Seleziona un articolo pubblicato.');
    const rows = await request(`/rest/v1/editorial_articles?select=id,title,slug,status,updated_at,published_at,category,content,sources&id=eq.${encodeURIComponent(id)}&status=eq.published&limit=1`, token);
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
        id: row.id,
        version: String(row.updated_at),
        status: 'published',
        title: row.title,
        url: `https://offertalogica.it/articoli/${encodeURIComponent(slug)}.html`,
        category: row.category || 'energia',
        content: row.content,
        sources,
      },
    };
  }
  function setSummary(b) {
    summary.replaceChildren();
    function line(label, value) {
      const p = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = `${label}: `;
      p.append(strong, document.createTextNode(value));
      summary.append(p);
    }
    line('Origine', b.mode === 'article' ? 'Articolo Editoriale pubblicato' : b.mode==='image'?'Immagine guida':'Tema libero');
    line('Titolo', b.mode === 'article' ? b.input.article.title : b.mode==='image'?b.input.guide_file_name:b.input.theme);
    line('Suggerimenti', b.input.suggestions || 'Nessuno');
    line('Destinazione', b.input.platform);
    line('Passaggio successivo', 'Storyboard AI con 4 foto automatiche da revisionare');
    output.hidden = false;
  }
  // Files are preview-only; normalise in memory, strip EXIF, never store/upload to editorial articles.
  async function fileToJpeg(file,{width,height,maxBytes,cover=false,preserveAspect=false}={}) {
    if(!file || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 8*1024*1024 || file.size < 1000)
      throw Error('Carica una fotografia JPG, PNG o WebP valida (massimo 8 MB).');
    const src=URL.createObjectURL(file);
    let image;
    try {
      image=new Image();
      await new Promise((resolve,reject)=>{
        image.onload=resolve;
        image.onerror=()=>reject(Error('Il file non contiene una fotografia leggibile.'));
        image.src=src;
      });
      if(image.naturalWidth<400 || image.naturalHeight<400 || image.naturalWidth*image.naturalHeight>24000000)
        throw Error('Risoluzione immagine non ammessa (minimo 400×400, massimo 24 megapixel).');
      const canvas=document.createElement('canvas');
      const scale=cover?Math.max(width/image.naturalWidth,height/image.naturalHeight):
        Math.min(width/image.naturalWidth,height/image.naturalHeight);
      const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
      canvas.width=preserveAspect?Math.round(w):width;
      canvas.height=preserveAspect?Math.round(h):height;
      const ctx=canvas.getContext('2d',{alpha:false});
      if(!ctx)throw Error('Impossibile elaborare la fotografia nel browser.');
      ctx.fillStyle='#eeeeea';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(image,(canvas.width-w)/2,(canvas.height-h)/2,w,h);
      for(const quality of [0.84,0.76,0.66,0.54,0.40,0.30]) {
        const base64=canvas.toDataURL('image/jpeg',quality).split(',')[1];
        if(Math.floor(base64.length*3/4)<=maxBytes)return base64;
      }
      throw Error('La foto è troppo complessa per il limite di caricamento; prova un file più leggero.');
    } finally {URL.revokeObjectURL(src);}
  }
  async function uploadScenePhoto(view,file,{fromGuide=false}={}) {
    // Refresh old signed proposals before attempting any manual replacement.
    if(generation?.receipt?.expiresAt<=Date.now()+15000)await renewStoryboardReceiptIfNeeded(await requireEditor());
    if(!generation || (busy() && !fromGuide) || view.running) return false;
    const source=file||guideFile;
    if(!source)return false;
    let jpg;
    try {jpg=await fileToJpeg(source,{width:1080,height:1920,maxBytes:1550000,cover:true});}
    catch(error){message(error.message,true);return false;}
    stopPreview();view.running=true;view.error='';
    setSceneState(view,'Importazione della fotografia, senza generazione AI…','pending');
    beginRequest();
    try {
      const token=await requireEditor();
      const result=await labRequest('video-studio-photo',{
        input:generation.input,plan:generation.plan,receipt:generation.receipt,
        scene_index:view.index,manual_image_base64:jpg
      },token,60000);
      assignSceneResult(view,result,{manual:true});
      setSceneState(view,fromGuide?'Foto guida utilizzata come prima scena.':'Foto personale caricata; nessun costo di generazione AI.','success');
      return true;
    } catch(error) {
      view.error=error.message;
      setSceneState(view,`Importazione non riuscita: ${error.message}`,'error');
      message(error.message,true);
      return false;
    } finally {view.running=false;endRequest();updateProgress();}
  }
  function assignSceneResult(view,result,{manual=false}={}) {
    // Any replaced upstream scene invalidates following AI references and derived images.
    if(view.result && !manual) {
      for(const later of sceneViews.slice(view.index+1)) {
        later.result=null;later.image.removeAttribute('src');later.image.hidden=true;
        later.prompt.hidden=true;later._compositionKey=null;later._salienceImage=null;
        later._faceBoxes=null;later.error='';
        setSceneState(later,'Scena precedente cambiata: rigenera o carica questa fotografia.','pending');
        updateSceneActionLabel(later);
      }
      message('Scena sostituita: le successive vanno aggiornate per garantire la continuità.');
    }
    if(view.result && manual && sceneViews.slice(view.index+1).some(later=>later.result))
      message('Foto sostituita: le altre scene sono conservate. Verifica la continuità visiva prima di esportare.');
    view.result=result;view._compositionKey=null;view._salienceImage=null;view._faceBoxes=null;
    view.image.src=`data:${result.preview_mime};base64,${result.preview_base64}`;
    view.image.addEventListener('load',()=>{
      view._compositionKey=null;
      if(!previewPlaying&&previewView)showPreview(view.index);
      detectSceneFaces(view,view.image.src);
    },{once:true});
    view.image.hidden=false;
    scheduleProjectAutosave();
    view.promptBody.textContent=result.prompt||'';view.prompt.hidden=manual?true:false;
    updateSceneActionLabel(view);
    showPreview(view.index);
  }
  async function prepare(event) {
    event.preventDefault();
    clearBrief();
    preparing = true;
    syncControls();
    try {
      const token = await requireEditor();
      const mode = selectedSource();
      let base;
      if (mode === 'article') base = await makeArticleInput(token);
      else if(mode==='image') {
        if(!guideInput.files?.[0])throw Error('Seleziona una foto guida per costruire il Reel.');
        guideFile=guideInput.files[0];
        const context=guideContext.value.trim();
        if(context.length>180)throw Error('Contesto della foto troppo lungo.');
        base={theme:null,article:null,guide_context:context,guide_usage:guideMode.value,guide_fidelity:guideFidelity.value,guide_file_name:guideFile.name};
      } else {
        const theme = themeInput.value.trim();
        if (!theme || theme.length > 180) throw Error('Inserisci un tema di massimo 180 caratteri.');
        base = {theme, article: null};
      }
      const suggestions = suggestionsInput.value.trim();
      if (suggestions.length > 1800) throw Error('Suggerimenti troppo lunghi.');
      brief = {
        schema_version: 1,
        status: 'prepared_not_generated',
        mode,
        input: {...base, suggestions, platform: platformSelect.value},
        next_step: 'creative_director_requires_protected_server_execution',
        publication_authorized: false,
      };
      setSummary(brief);
      downloadButton.disabled = false;
      generateButton.disabled = false;
      message('Brief pronto. Premi «Genera storyboard + 4 foto AI» per avviare il flusso automatico.');
    } catch (e) { message(e.message, true); } finally { preparing = false; syncControls(); }
  }
  async function labRequest(action, body, token, timeMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeMs);
    try {
      const response = await fetch(`/api/staff-analytics?action=${encodeURIComponent(action)}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
        body: JSON.stringify(body),
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        const error = Error(payload?.error
          || (response.status === 401
            ? 'La generazione AI richiede un account amministratore.'
            : `Servizio Video Studio non disponibile (${response.status}).`));
        error.httpStatus = response.status;
        throw error;
      }
      return payload.result;
    } catch (e) {
      if (e.name === 'AbortError') throw Error('Tempo massimo della generazione superato. Riprova solo dopo avere controllato lo stato del servizio.');
      throw e;
    } finally { clearTimeout(timer); }
  }
  function availablePreviewIndices() {
    return sceneViews.flatMap((view, index) => view.result ? [index] : []);
  }
  function updateProgress() {
    if (!progressView) return;
    const ready = sceneViews.filter(view => view.result).length;
    const errors = sceneViews.filter(view => !view.result && view.error).length;
    const pending = sceneViews.length - ready - errors;
    const fragments = [`Foto pronte: ${ready}/${sceneViews.length || 4}`];
    if (pending > 0) fragments.push(`In attesa: ${pending}`);
    if (errors > 0) fragments.push(`Da rigenerare: ${errors}`);
    progressView.count.textContent = fragments.join(' · ');
    progressView.note.textContent = 'Ogni rigenerazione consuma 1 azione AI del limite server (10 azioni/ora per utente admin).';
    syncControls();
  }
  const MONTAGE_WIDTH = 1080;
  const MONTAGE_HEIGHT = 1920;
  const MONTAGE_DURATION = 15;
  // The browser draft and the editor use the same 1080×1920 coordinate space.
  // Keep text above the fixed brand footer and away from social UI chrome.
  const TEXT_SAFE = Object.freeze({left:.068, top:.135, right:.932, bottom:.755});
  const LOGO_SAFE = Object.freeze({left:.068,top:.13,right:.932,bottom:.875});
  const MAX_EXTRA_TEXTS = 4;
  const DEFAULT_LOGO = Object.freeze({x:76/MONTAGE_WIDTH,y:1510/MONTAGE_HEIGHT,width:232/MONTAGE_WIDTH});
  const TEXT_FONTS = Object.freeze({
    'system-ui':'system-ui, sans-serif',
    'Arial':'Arial, Helvetica, sans-serif',
    'Georgia':'Georgia, serif',
    'Trebuchet MS':'"Trebuchet MS", Arial, sans-serif',
    'Verdana':'Verdana, sans-serif',
  });
  const clampNumber = (value,min,max) => Math.max(min,Math.min(max,value));
  function defaultTextStyle(kind) {
    return {font:'system-ui',size:kind==='title'?100:kind==='cta'?43:48,weight:kind==='subtitle'?500:800,
      color:'#ffffff',align:'left',background:false,bgColor:'#152c38',opacity:.6,
      padding:14,radius:16,shadow:true};
  }
  function constrainTextBox(box,kind) {
    const minW=kind.startsWith('extra:')?.17:.23,minH=kind==='title'?.085:kind.startsWith('extra:')?.052:.065;
    const width=clampNumber(Number(box.width)||.5,minW,TEXT_SAFE.right-TEXT_SAFE.left);
    const height=clampNumber(Number(box.height)||.12,minH,TEXT_SAFE.bottom-TEXT_SAFE.top);
    return {
      x:clampNumber(Number(box.x)||TEXT_SAFE.left,TEXT_SAFE.left,TEXT_SAFE.right-width),
      y:clampNumber(Number(box.y)||TEXT_SAFE.top,TEXT_SAFE.top,TEXT_SAFE.bottom-height),
      width,height,
    };
  }
  function logoAspect() {
    const image=transparentBrandLogo() || previewView?.logo;
    return image?.naturalWidth || image?.width
      ? (image.naturalHeight || image.height)/(image.naturalWidth || image.width) : 353/640;
  }
  function constrainLogoBox(box) {
    const width=clampNumber(Number(box?.width)||DEFAULT_LOGO.width,.09,.50);
    const height=width*(MONTAGE_WIDTH/MONTAGE_HEIGHT)*logoAspect();
    return {x:clampNumber(Number.isFinite(Number(box?.x))?Number(box.x):DEFAULT_LOGO.x,LOGO_SAFE.left,LOGO_SAFE.right-width),
      y:clampNumber(Number.isFinite(Number(box?.y))?Number(box.y):DEFAULT_LOGO.y,LOGO_SAFE.top,LOGO_SAFE.bottom-height),width,height};
  }
  function newLogoLayer() {
    return {box:constrainLogoBox(DEFAULT_LOGO),visible:true,opacity:1};
  }
  function layerFor(view,kind) {
    const design=initializeManualCopy(view);
    if(kind.startsWith('extra:'))return design.extras.find(layer=>layer.id===kind)||null;
    return design[kind]||null;
  }
  function layerText(view,kind) {
    if(kind==='title')return String(view.scene.headline||'').trim();
    if(kind==='subtitle')return String(view.scene.secondary_text||'').trim();
    if(kind==='cta')return 'ENTRA IN';
    return String(layerFor(view,kind)?.text||'').trim();
  }
  function manualKinds(view) {
    const design=initializeManualCopy(view);
    return ['title','subtitle',...(view.scene.role==='cta'?['cta']:[]),
      ...design.extras.map(layer=>layer.id),'logo'];
  }
  function initializeManualCopy(view) {
    if(view.textDesign) {
      if(!Array.isArray(view.textDesign.extras))view.textDesign.extras=[];
      if(!view.textDesign.logo)view.textDesign.logo=newLogoLayer();
      return view.textDesign;
    }
    const ctx=previewView?.canvas?.getContext('2d');
    const auto=ctx?compositionForScene(ctx,view):null;
    const choice=auto?.choice||{x:76,width:900};
    const titleY=auto?.y||320;
    const titleH=auto?.copy?.titleHeight||210;
    const secondaryY=titleY+titleH+33;
    return (view.textDesign={
      title:{box:constrainTextBox({x:choice.x/MONTAGE_WIDTH,y:titleY/MONTAGE_HEIGHT,
        width:choice.width/MONTAGE_WIDTH,height:Math.max(150,titleH+22)/MONTAGE_HEIGHT},'title'),
        style:defaultTextStyle('title')},
      subtitle:{box:constrainTextBox({x:choice.x/MONTAGE_WIDTH,y:secondaryY/MONTAGE_HEIGHT,
        width:Math.min(0.8,choice.width/MONTAGE_WIDTH),height:.095},'subtitle'),
        style:defaultTextStyle('subtitle')},
      ...(view.scene.role==='cta'?{cta:{box:constrainTextBox({x:.36,y:.66,width:.48,height:.08},'cta'),
        style:defaultTextStyle('cta')}}:{}),
      extras:[],logo:newLogoLayer(),
    });
  }
  function currentTextView() { return sceneViews[previewIndex] || null; }
  function sceneIsManuallyEditable(view) {
    return !!(view && view.layoutPreference==='manual' && !productScreenActive(view.index) &&
      !exporting && !previewPlaying && !busy());
  }

  function sceneAt(second) {
    let start = 0;
    for (let i = 0; i < sceneViews.length; i++) {
      const duration = Number(sceneViews[i].scene.duration_ms) / 1000;
      if (second < start + duration || i === sceneViews.length - 1) {
        return {index: i, start, duration, local: Math.max(0, second - start)};
      }
      start += duration;
    }
    return {index: 0, start: 0, duration: 3, local: 0};
  }
  function wrapCanvasText(ctx, value, maxWidth, maxLines) {
    const words = String(value || '').trim().split(/\s+/).filter(Boolean);
    const result = [];
    let line = '';
    for (const word of words) {
      const trial = line ? `${line} ${word}` : word;
      if (ctx.measureText(trial).width > maxWidth && line) {
        result.push(line);
        line = word;
      } else line = trial;
    }
    if (line) result.push(line);
    if (result.length > maxLines) {
      result.length = maxLines;
      let last = result[maxLines - 1];
      while (last.length && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
      result[maxLines - 1] = `${last}…`;
    }
    return result;
  }
  // Text must be set into the image, never on a fixed opaque white card.
  // Pixel salience and the editorial subject-side hint help choose a quiet region;
  // they do NOT constitute certified face/object detection. The editor can override.
  function scenePlacement(view) {
    const requested = view?.layoutPreference || 'auto';
    if (requested !== 'auto') return requested;
    if (view?.scene?.subject_side === 'left') return 'right';
    if (view?.scene?.subject_side === 'right') return 'left';
    return 'auto';
  }
  function photoSalience(view) {
    const image = view?.image;
    if (!image?.complete || !image.naturalWidth) return null;
    if (view._salienceImage === image.src) return view._salience || null;
    view._salienceImage = image.src;
    view._salience = null;
    try {
      const tiny = document.createElement('canvas');
      tiny.width = 108; tiny.height = 192;
      const c = tiny.getContext('2d', {willReadFrequently:true});
      if (!c) return null;
      const zoom = Math.max(tiny.width / image.naturalWidth, tiny.height / image.naturalHeight);
      const w = image.naturalWidth * zoom, h = image.naturalHeight * zoom;
      c.drawImage(image, (tiny.width-w)/2, (tiny.height-h)/2, w, h);
      const {data} = c.getImageData(0, 0, 108, 192);
      const mass = new Float32Array(108*192);
      const lum = new Float32Array(108*192);
      for (let y=0; y<192; y++) for (let x=0; x<108; x++) {
        const i=y*108+x, j=i*4;
        const r=data[j], g=data[j+1], b=data[j+2];
        const gray=(0.2126*r+0.7152*g+0.0722*b)/255;
        lum[i]=gray;
        const skin=r>75 && g>44 && b>22 && r>g+10 && r>b+15 && g>b*0.72 && g<b*2.1;
        mass[i] = (skin ? 0.65 : 0) + (Math.max(r,g,b)-Math.min(r,g,b))/255*0.12;
      }
      for (let y=1; y<191; y++) for (let x=1; x<107; x++) {
        const i=y*108+x;
        mass[i] += Math.min(1.2, (Math.abs(lum[i+1]-lum[i-1])+
          Math.abs(lum[i+108]-lum[i-108]))*1.7);
      }
      view._salience = {mass,lum};
      return view._salience;
    } catch { return null; }
  }
  function quietness(view, rect) {
    const photo = photoSalience(view);
    if (!photo) return 0;
    const x0=Math.max(0, Math.floor(rect.x/10)), x1=Math.min(107, Math.ceil((rect.x+rect.width)/10));
    const y0=Math.max(0, Math.floor(rect.y/10)), y1=Math.min(191, Math.ceil((rect.y+rect.height)/10));
    let sum=0, samples=0;
    for (let y=y0; y<y1; y+=2) for (let x=x0; x<x1; x+=2) {
      sum+=photo.mass[y*108+x]; samples++;
    }
    return samples ? sum/samples : 0;
  }
  function intersects(a,b,pad=0) {
    return a.x < b.x+b.width+pad && a.x+a.width+pad > b.x &&
      a.y < b.y+b.height+pad && a.y+a.height+pad > b.y;
  }
  async function detectSceneFaces(view, source) {
    if (typeof window.FaceDetector !== 'function') return;
    try {
      const detector=new window.FaceDetector({fastMode:true,maxDetectedFaces:6});
      const detected=await detector.detect(view.image);
      if (view.image.src!==source) return;
      const image=view.image;
      const cover=Math.max(1080/image.naturalWidth,1920/image.naturalHeight);
      const offsetX=(1080-image.naturalWidth*cover)/2;
      const offsetY=(1920-image.naturalHeight*cover)/2;
      view._faceBoxes=detected.map(face=>({
        x:offsetX+face.boundingBox.x*cover,
        y:offsetY+face.boundingBox.y*cover,
        width:face.boundingBox.width*cover,
        height:face.boundingBox.height*cover,
      }));
      view._compositionKey=null;
      if (!previewPlaying && previewView) showPreview(view.index);
    } catch { /* Automatic placement falls back to low-detail regions and manual review. */ }
  }
  // A headline is a mobile-first message, not a paragraph: two lines at most.
  // Long editorial text remains in the storyboard; only the on-screen copy is shortened.
  function fitSceneCopy(ctx,scene,width) {
    const headline=String(scene.headline||'').trim();
    const isCta=scene.role==='cta';
    let size=isCta?112:(scene.role==='hook'?108:100);
    let lines=[];
    for (;size>=76;size-=4) {
      ctx.font=`800 ${size}px system-ui, sans-serif`;
      lines=wrapOverlayLines(ctx,headline,width);
      if (lines.length<=2 && lines.every(line=>ctx.measureText(line).width<=width)) break;
    }
    if (size<76) size=76;
    ctx.font=`800 ${size}px system-ui, sans-serif`;
    const complete=wrapOverlayLines(ctx,headline,width);
    const titleTruncated=complete.length>2 || complete.some(line=>ctx.measureText(line).width>width);
    lines=titleTruncated?wrapCanvasText(ctx,headline,width,2):complete;
    const secondary=String(scene.secondary_text||'').trim();
    let detailSize=isCta?46:48,detail=[];
    if (secondary) {
      for(;detailSize>=37;detailSize-=2) {
        ctx.font=`500 ${detailSize}px system-ui, sans-serif`;
        detail=wrapOverlayLines(ctx,secondary,width);
        if(detail.length<=2 && detail.every(line=>ctx.measureText(line).width<=width)) break;
      }
      if(detailSize<37) detailSize=37;
      ctx.font=`500 ${detailSize}px system-ui, sans-serif`;
      detail=wrapCanvasText(ctx,secondary,width,2);
    }
    ctx.font=`800 ${size}px system-ui, sans-serif`;
    const titleWidth=Math.max(0,...lines.map(line=>ctx.measureText(line).width));
    ctx.font=`500 ${detailSize}px system-ui, sans-serif`;
    const detailWidth=Math.max(0,...detail.map(line=>ctx.measureText(line).width));
    const titleStep=Math.round(size*1.14);
    const detailStep=Math.round(detailSize*1.23);
    const titleHeight=lines.length?size+(lines.length-1)*titleStep:0;
    const detailHeight=detail.length?detailSize+(detail.length-1)*detailStep:0;
    const textHeight=titleHeight+(detail.length?26+detailHeight:0);
    return {lines,size,titleStep,detail,detailSize,detailStep,
      titleHeight,textHeight,titleTruncated,titleWidth,detailWidth};
  }
  function compositionForScene(ctx,view) {
    const key=`${view.image?.src||''}|${view.layoutPreference}|${view.scene.headline}|${view.scene.secondary_text}|${view._faceBoxes?.length||0}`;
    if (view._compositionKey===key && view._composition) return view._composition;
    const mode=scenePlacement(view);
    const choices=[
      {side:'top',x:76,y:260,width:918},
      {side:'bottom',x:76,y:990,width:918},
      {side:'left',x:76,y:265,width:555},
      {side:'right',x:465,y:265,width:540},
      {side:'left',x:76,y:990,width:555},
      {side:'right',x:465,y:990,width:540},
    ];
    let ranked=[];
    const image=previewView?.logo;
    const isCta=view.scene.role==='cta';
    // Logo and headline form one unit; on CTA the action label leads into the logo.
    const logoW=isCta?290:230;
    const logoH=image?.naturalWidth ? Math.round(logoW*image.naturalHeight/image.naturalWidth) : Math.round(logoW*.552);
    const actionSize=isCta?43:0;
    for(const choice of choices) {
      if(view.layoutPreference!=='auto' && choice.side!==view.layoutPreference) continue;
      const copy=fitSceneCopy(ctx,view.scene,choice.width);
      const actionWidth=isCta?Math.round(actionSize*3.65):0;
      const footerHeight=Math.max(logoH,actionSize)+20;
      const groupHeight=copy.textHeight+24+footerHeight;
      const y=Math.min(choice.y,1535-groupHeight);
      if(y<200) continue;
      const inkWidth=Math.min(choice.width,Math.max(copy.titleWidth,copy.detailWidth,
        logoW+(isCta?actionWidth+16:0)));
      const textBounds={x:choice.x-8,y:y-14,width:inkWidth+16,height:copy.textHeight+28};
      const footerY=y+copy.textHeight+24;
      const logo={x:choice.x+(isCta?actionWidth+16:0),y:footerY,width:logoW,height:logoH};
      if(logo.x+logo.width>1010) continue;
      const bounds={x:choice.x-14,y:y-16,width:Math.max(inkWidth+28,logo.x+logo.width-choice.x+28),height:groupHeight+22};
      const faces=view._faceBoxes||[];
      const facePenalty=faces.some(face=>intersects(face,bounds,70))?80:0;
      const busyArea=quietness(view,bounds);
      // Large readable headlines outrank arbitrary left/right placement.
      const sizePenalty=(112-copy.size)*.018+(copy.titleTruncated?2.7:0);
      const preference=(mode!=='auto' && choice.side===mode)?-.34:0;
      const footerOverlap=faces.some(face=>intersects(face,logo,62))?35:0;
      const score=busyArea*2.4+facePenalty+footerOverlap+sizePenalty+preference+
        (choice.side==='bottom'?.13:0);
      ranked.push({choice,copy,y,bounds,textBounds,logo,actionSize,footerY,score});
    }
    ranked.sort((a,b)=>a.score-b.score);
    // This fallback is only for an unsupported manual location, not for normal scenes.
    const selected=ranked[0]||(()=>{
      const choice=choices[0],copy=fitSceneCopy(ctx,view.scene,choice.width);
      const footerY=260+copy.textHeight+24;
      return {choice,copy,y:260,bounds:{x:65,y:245,width:945,height:copy.textHeight+logoH+70},
        logo:{x:choice.x,y:footerY,width:logoW,height:logoH},footerY,actionSize,score:0};
    })();
    view._compositionKey=key;
    view._composition=selected;
    return selected;
  }
  function drawProductScreenFrame(ctx, view) {
    const image=verifiedProductScreen?.image;
    if(!image) return;
    ctx.fillStyle='#11283b';
    ctx.fillRect(0,0,MONTAGE_WIDTH,MONTAGE_HEIGHT);
    // Verified product screenshot, never an AI-invented interface.
    const box={x:62,y:650,width:956,height:785};
    const scale=Math.min(box.width/image.naturalWidth,box.height/image.naturalHeight);
    const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
    const x=(MONTAGE_WIDTH-w)/2,y=box.y+(box.height-h)/2;
    ctx.fillStyle='#f9fafb';
    ctx.beginPath();ctx.roundRect(x-18,y-18,w+36,h+36,24);ctx.fill();
    ctx.drawImage(image,x,y,w,h);
    const headline=String(view.scene.headline||'').trim();
    ctx.textAlign='left';ctx.textBaseline='alphabetic';
    let size=102,lines=[];
    for(;size>=76;size-=4) {
      ctx.font=`800 ${size}px system-ui, sans-serif`;
      lines=wrapOverlayLines(ctx,headline,936);
      if(lines.length<=2) break;
    }
    if(lines.length>2) lines=wrapCanvasText(ctx,headline,936,2);
    const titleHeight=size+(lines.length-1)*Math.round(size*1.14);
    ctx.fillStyle='#ffffff';
    lines.forEach((line,i)=>ctx.fillText(line,72,140+size+i*Math.round(size*1.14)));
    const subtitle=String(view.scene.secondary_text||'').trim();
    const subY=158+titleHeight;
    if(subtitle) {
      ctx.font='500 42px system-ui, sans-serif';
      const sublines=wrapCanvasText(ctx,subtitle,930,2);
      sublines.forEach((line,i)=>ctx.fillText(line,72,subY+50+i*52));
    }
    // The brand closes the header message, rather than floating at the bottom.
    const logo=transparentBrandLogo()||previewView?.logo;
    if(logo?.width||logo?.naturalWidth) {
      const logoW=242,logoH=logoW*(logo.naturalHeight||logo.height)/(logo.naturalWidth||logo.width);
      const logoY=Math.min(640-logoH,subY+(subtitle?132:28));
      ctx.shadowColor='rgba(255,255,255,.60)';ctx.shadowBlur=8;
      ctx.drawImage(logo,72,logoY,logoW,logoH);ctx.shadowBlur=0;
    }
    ctx.font='500 32px system-ui, sans-serif';
    ctx.fillStyle='#cde5f1';
    ctx.fillText('Schermata verificata dalla Redazione',72,1515);
  }
  function productScreenActive(index) {
    return Boolean(verifiedProductScreen && previewView?.productConfirmed?.checked &&
      Number(previewView?.productChoice?.value) === index);
  }
  function clearProductScreen() {
    if (productScreenUrl) URL.revokeObjectURL(productScreenUrl);
    productScreenUrl = null;
    verifiedProductScreen = null;
  }
  async function loadProductScreen(file) {
    if (!previewView || busy()) return;
    clearProductScreen();
    previewView.productConfirmed.checked = false;
    if (!file) { showPreview(previewIndex); return; }
    if (file.size > MAX_SCREEN_BYTES || file.size < 1024 ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      previewView.productHelp.textContent = 'Usa uno screenshot PNG/JPEG/WebP autentico, massimo 8 MB.';
      return;
    }
    productScreenUrl = URL.createObjectURL(file);
    const expectedUrl = productScreenUrl;
    const image = new Image();
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(Error('immagine non leggibile'));
        image.src = expectedUrl;
      });
      if (productScreenUrl !== expectedUrl) return;
      if (image.naturalWidth < 450 || image.naturalHeight < 300)
        throw Error('screenshot troppo piccolo');
      verifiedProductScreen = {image, file};
      scheduleProjectAutosave();
      previewView.productHelp.textContent = 'Seleziona la scena e conferma che lo screenshot è autentico e attuale.';
    } catch (error) {
      if (productScreenUrl === expectedUrl) clearProductScreen();
      previewView.productHelp.textContent = `Schermata non accettata: ${error.message}`;
    }
    syncControls();
    showPreview(previewIndex);
  }
  function drawScenePhoto(ctx, index, zoomProgress, opacity) {
    const image = sceneViews[index]?.image;
    if (!image || !image.complete || !image.naturalWidth || !image.naturalHeight) return;
    ctx.save();
    ctx.globalAlpha = opacity;
    // A restrained Ken Burns move; full-bleed cover, no blind panning onto faces.
    const finalScene = index === sceneViews.length - 1;
    const travel = finalScene ? (1 - zoomProgress) : zoomProgress;
    const scale = Math.max(MONTAGE_WIDTH / image.naturalWidth, MONTAGE_HEIGHT / image.naturalHeight) *
      (1.010 + travel * (finalScene ? 0.024 : 0.036));
    const w = image.naturalWidth * scale;
    const h = image.naturalHeight * scale;
    ctx.drawImage(image, (MONTAGE_WIDTH - w) / 2, (MONTAGE_HEIGHT - h) / 2, w, h);
    ctx.restore();
  }
  function wrapOverlayLines(ctx, text, maxWidth) {
    const lines = [];
    let line = '';
    for (const word of String(text || '').trim().split(/\s+/u).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    if (line) lines.push(line);
    return lines;
  }
  function transparentBrandLogo() {
    const picture=previewView?.logo;
    if (!picture?.complete || !picture.naturalWidth) return null;
    if (previewView._logoTransparent) return previewView._logoTransparent;
    try {
      const canvas=document.createElement('canvas');
      canvas.width=picture.naturalWidth;
      canvas.height=picture.naturalHeight;
      const c=canvas.getContext('2d', {willReadFrequently:true});
      c.drawImage(picture,0,0);
      const pixels=c.getImageData(0,0,canvas.width,canvas.height);
      for(let i=0;i<pixels.data.length;i+=4) {
        const r=pixels.data[i],g=pixels.data[i+1],b=pixels.data[i+2];
        const min=Math.min(r,g,b),spread=Math.max(r,g,b)-min;
        if(min>224 && spread<26)
          pixels.data[i+3]=Math.round(pixels.data[i+3]*Math.min(1,(255-min)/31));
      }
      c.putImageData(pixels,0,0);
      previewView._logoTransparent=canvas;
      return canvas;
    } catch { return picture; }
  }
  function fitManualLines(ctx,text,style,boxWidth,boxHeight) {
    const family=TEXT_FONTS[style.font] || TEXT_FONTS['system-ui'];
    const weight=Number(style.weight)||500;
    const pad=clampNumber(Number(style.padding)||0,0,60);
    const maxWidth=Math.max(48,boxWidth-2*pad);
    const maxHeight=Math.max(40,boxHeight-2*pad);
    let lines=[],size=Number(style.size)||60;
    const floor=size>70?46:32;
    for(;size>=floor;size-=2) {
      ctx.font=`${weight} ${size}px ${family}`;
      lines=wrapOverlayLines(ctx,text,maxWidth);
      if(lines.length*size*1.15 <= maxHeight && lines.every(line=>ctx.measureText(line).width <= maxWidth))
        return {lines,size,family,weight,pad,overflow:false};
    }
    size=Math.max(floor,size+2);
    ctx.font=`${weight} ${size}px ${family}`;
    const limit=Math.max(1,Math.floor(maxHeight/(size*1.15)));
    return {lines:wrapCanvasText(ctx,text,maxWidth,limit),size,family,weight,pad,overflow:true};
  }
  function drawManualTextLayer(ctx,view,kind) {
    const text=layerText(view,kind);
    if(!text)return;
    const layer=layerFor(view,kind);
    if(!layer?.style)return;
    const b=constrainTextBox(layer.box,kind),style=layer.style;
    const x=b.x*MONTAGE_WIDTH,y=b.y*MONTAGE_HEIGHT,w=b.width*MONTAGE_WIDTH,h=b.height*MONTAGE_HEIGHT;
    ctx.save();
    if(style.background) {
      ctx.globalAlpha=clampNumber(Number(style.opacity),0,1);
      ctx.fillStyle=style.bgColor;
      ctx.beginPath();ctx.roundRect(x,y,w,h,clampNumber(Number(style.radius),0,64));ctx.fill();
      ctx.globalAlpha=1;
    }
    const fit=fitManualLines(ctx,text,style,w,h);
    const ink=style.color || '#ffffff';
    const align=['left','center','right'].includes(style.align)?style.align:'left';
    ctx.textAlign=align;ctx.textBaseline='top';ctx.lineJoin='round';
    const textX=align==='center'?x+w/2:align==='right'?x+w-fit.pad:x+fit.pad;
    const step=fit.size*1.15;
    let textY=y+fit.pad;
    for(const line of fit.lines) {
      ctx.font=`${fit.weight} ${fit.size}px ${fit.family}`;
      if(style.shadow) {
        ctx.lineWidth=fit.size>65?4:2.5;
        ctx.strokeStyle='rgba(8,18,25,.55)';ctx.strokeText(line,textX,textY);
        ctx.shadowColor='rgba(0,0,0,.55)';ctx.shadowBlur=7;
      }
      ctx.fillStyle=ink;ctx.fillText(line,textX,textY);
      ctx.shadowBlur=0;
      textY+=step;
    }
    ctx.restore();
  }
  function drawManualOverlay(ctx,view) {
    drawManualTextLayer(ctx,view,'title');
    drawManualTextLayer(ctx,view,'subtitle');
    if(view.scene.role==='cta')drawManualTextLayer(ctx,view,'cta');
    const design=initializeManualCopy(view);
    for(const extra of design.extras)drawManualTextLayer(ctx,view,extra.id);
    // Authentic brand pixels are composited independently, never recreated with AI.
    const brand=transparentBrandLogo()||previewView?.logo;
    if(design.logo.visible && brand && (brand.width||brand.naturalWidth)) {
      const b=constrainLogoBox(design.logo.box);
      ctx.save();ctx.globalAlpha=clampNumber(Number(design.logo.opacity),0,1);
      ctx.shadowColor='rgba(255,255,255,.65)';ctx.shadowBlur=8;
      ctx.drawImage(brand,b.x*MONTAGE_WIDTH,b.y*MONTAGE_HEIGHT,
        b.width*MONTAGE_WIDTH,b.height*MONTAGE_HEIGHT);ctx.restore();
    }
  }
  function drawCinematicOverlay(ctx,view) {
    const {scene}=view;
    const {choice,copy,y,bounds,logo,footerY,actionSize}=compositionForScene(ctx,view);
    const photo=photoSalience(view);
    let brightness=.52;
    if(photo) {
      let sum=0,count=0;
      for(let iy=Math.max(0,Math.floor(bounds.y/10));iy<Math.min(191,Math.floor((bounds.y+bounds.height)/10));iy+=4)
        for(let ix=Math.max(0,Math.floor(bounds.x/10));ix<Math.min(107,Math.floor((bounds.x+bounds.width)/10));ix+=4) {
          sum+=photo.lum[iy*108+ix];count++;
        }
      if(count) brightness=sum/count;
    }
    const lightText=brightness<.52;
    const ink=lightText?'#ffffff':'#102b3b';
    const outline=lightText?'rgba(8,17,26,.72)':'rgba(255,255,255,.78)';
    const centreX=bounds.x+bounds.width/2,centreY=bounds.y+bounds.height/2;
    const fade=ctx.createRadialGradient(centreX,centreY,25,centreX,centreY,Math.max(bounds.width,bounds.height)*.85);
    fade.addColorStop(0,lightText?'rgba(4,15,24,.50)':'rgba(255,255,255,.48)');
    fade.addColorStop(.58,lightText?'rgba(4,15,24,.24)':'rgba(255,255,255,.22)');
    fade.addColorStop(1,'rgba(0,0,0,0)');
    ctx.save();ctx.fillStyle=fade;
    ctx.fillRect(0,0,MONTAGE_WIDTH,MONTAGE_HEIGHT);
    ctx.textAlign='left';ctx.textBaseline='alphabetic';
    ctx.lineJoin='round';ctx.miterLimit=2;
    const drawLine=(text,x,yy,font,isDetail=false)=>{
      ctx.font=font;
      ctx.lineWidth=isDetail?3.5:5;
      ctx.strokeStyle=outline;ctx.strokeText(text,x,yy);
      ctx.shadowColor=lightText?'rgba(0,0,0,.60)':'rgba(255,255,255,.54)';
      ctx.shadowBlur=8;ctx.fillStyle=ink;ctx.fillText(text,x,yy);ctx.shadowBlur=0;
    };
    const baseline=y+copy.size;
    copy.lines.forEach((line,i)=>drawLine(line,choice.x,baseline+i*copy.titleStep,
      `800 ${copy.size}px system-ui, sans-serif`));
    if(copy.detail.length) {
      const first=y+copy.titleHeight+26+copy.detailSize;
      copy.detail.forEach((line,i)=>drawLine(line,choice.x,first+i*copy.detailStep,
        `500 ${copy.detailSize}px system-ui, sans-serif`,true));
    }
    // The CTA is an action immediately completed by the authentic brand mark.
    if(scene.role==='cta') {
      drawLine('ENTRA IN',choice.x,footerY+actionSize+22,
        `800 ${actionSize}px system-ui, sans-serif`,true);
    }
    const brand=transparentBrandLogo()||previewView?.logo;
    if(brand && (brand.width||brand.naturalWidth)) {
      ctx.shadowColor='rgba(255,255,255,.75)';ctx.shadowBlur=11;
      ctx.drawImage(brand,logo.x,logo.y,logo.width,logo.height);
    }
    ctx.restore();
  }
  function renderMontageFrame(second) {
    if (!previewView || !sceneViews.length) return;
    const ctx = previewView.canvas.getContext('2d');
    if (!ctx) return;
    const t = Math.max(0, Math.min(MONTAGE_DURATION, second));
    const segment = sceneAt(Math.min(MONTAGE_DURATION - 0.001, t));
    previewIndex = segment.index;
    ctx.clearRect(0, 0, MONTAGE_WIDTH, MONTAGE_HEIGHT);
    ctx.fillStyle = '#101f29';
    ctx.fillRect(0, 0, MONTAGE_WIDTH, MONTAGE_HEIGHT);
    if (productScreenActive(segment.index)) {
      drawProductScreenFrame(ctx, sceneViews[segment.index]);
    } else {
      drawScenePhoto(ctx, segment.index, Math.min(1, segment.local / segment.duration), 1);
      if (segment.index > 0 && segment.local < 0.28 && !productScreenActive(segment.index - 1)) {
        drawScenePhoto(ctx, segment.index - 1, 1, 1 - segment.local / 0.28);
      }
      if (sceneViews[segment.index]?.scene?.role === 'cta') {
        // A subtle golden-hour finishing light on the CTA, not a replacement photo.
        const glow=ctx.createLinearGradient(0,0,0,MONTAGE_HEIGHT);
        glow.addColorStop(0,'rgba(245,186,115,0)');
        glow.addColorStop(1,'rgba(245,171,83,0.12)');
        ctx.fillStyle=glow;
        ctx.fillRect(0,0,MONTAGE_WIDTH,MONTAGE_HEIGHT);
      }
      if (sceneViews[segment.index]?.layoutPreference === 'manual')
        drawManualOverlay(ctx,sceneViews[segment.index]);
      else drawCinematicOverlay(ctx, sceneViews[segment.index]);
    }
    // Thin timeline belongs to the editing PREVIEW only, not the exported video.
    if (!exporting) {
      ctx.fillStyle = '#38b66e';
      ctx.fillRect(0, MONTAGE_HEIGHT - 8, MONTAGE_WIDTH * (t / MONTAGE_DURATION), 8);
    }
    previewView.meta.textContent = `Scena ${segment.index + 1}/${sceneViews.length} · ${t.toFixed(1)} / 15.0 s · ${soundtrackUrl ? 'musica' : 'senza musica'} · Bozza 1080×1920`;
    if(previewView._editorSceneIndex !== previewIndex && !previewPlaying) {
      previewView._editorSceneIndex=previewIndex;
      syncVisualEditor();
    }
    updateTextHandles();
  }
  function showPreview(index) {
    if (!previewView) return;
    const available = availablePreviewIndices();
    previewView.playButton.disabled = available.length !== 4 || busy();
    const scene = available.length ? (available.includes(index) ? index : available[0]) : 0;
    const t = sceneViews.slice(0, scene).reduce((sum, item) => sum + (Number(item.scene.duration_ms) || 0), 0) / 1000;
    if (!previewPlaying) renderMontageFrame(Math.min(MONTAGE_DURATION-.002,t+.34));
    syncVisualEditor();
    previewView.musicHelp.textContent = soundtrackUrl
      ? 'Traccia della libreria pronta per la bozza. È audio di revisione, non approvazione alla pubblicazione.'
      : 'Attendo una traccia dalla libreria privata. La bozza non viene esportata muta per errore.';
    syncControls();
  }
  function montageTick() {
    if (!previewPlaying || !previewView) return;
    const audio = previewView.musicAudio;
    const elapsed = soundtrackUrl && !audio.paused ? Math.max(0, audio.currentTime - soundtrackStart) : (performance.now() - previewStartedAt) / 1000;
    renderMontageFrame(elapsed);
    if (soundtrackUrl) audio.volume = Math.max(0, Math.min(1, (15 - elapsed) / 1.2));
    if (elapsed >= MONTAGE_DURATION) {
      stopPreview();
      renderMontageFrame(MONTAGE_DURATION);
      return;
    }
    previewFrameId = requestAnimationFrame(montageTick);
  }
  async function togglePreviewPlayback() {
    if (!previewView) return;
    if (previewPlaying) {
      stopPreview();
      return;
    }
    if (availablePreviewIndices().length !== 4 || busy()) return;
    stopPreview();
    previewStartedAt = performance.now();
    if (soundtrackUrl) {
      try {
        previewView.musicAudio.currentTime = soundtrackStart;
        previewView.musicAudio.volume = 1;
        await previewView.musicAudio.play();
      } catch (e) {
        previewView.musicHelp.textContent = `Riproduzione audio non disponibile nel browser: ${e.message}`;
        return;
      }
    }
    previewPlaying = true;
    previewView.playButton.textContent = 'Interrompi montaggio';
    montageTick();
  }
  function reviewStartFor(file) { return musicMeta(file)?.cue ?? 0; }
  function validLocalAudio(file) {
    return file && file.size > 0 && file.size <= 25 * 1024 * 1024 &&
      (file.type.startsWith('audio/') || /\.(mp3|m4a|wav|aac|ogg|flac)$/i.test(file.name));
  }
  function musicOwnerId() { return getSession()?.user?.id || null; }
  function openMusicDb() {
    if (!window.indexedDB) return Promise.reject(Error('memoria locale non disponibile'));
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(MUSIC_DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(MUSIC_STORE))
          req.result.createObjectStore(MUSIC_STORE, {keyPath:'userId'});
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || Error('impossibile accedere alla memoria locale'));
      req.onblocked = () => reject(Error('archivio occupato da un’altra scheda'));
    });
  }
  async function musicDbOperation(mode, work) {
    const db = await openMusicDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(MUSIC_STORE, mode);
        const req = work(tx.objectStore(MUSIC_STORE));
        let result;
        req.onsuccess = () => {result = req.result;};
        req.onerror = () => reject(req.error || Error('operazione memoria fallita'));
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || Error('errore nel salvataggio'));
        tx.onabort = () => reject(tx.error || Error('memoria locale piena o non disponibile'));
      });
    } finally { db.close(); }
  }
  async function restoreMusicLibrary() {
    const epoch = ++musicLibraryEpoch;
    const userId = musicOwnerId();
    if (!userId) return;
    try {
      const record = await musicDbOperation('readonly', store => store.get(userId));
      if (epoch !== musicLibraryEpoch || !previewView || localTracks.length) return;
      const files = Array.isArray(record?.files) ? record.files : [];
      localTracks = files.slice(0, MAX_LOCAL_TRACKS).filter(validLocalAudio);
      musicPersistedOnDevice = Boolean(localTracks.length);
      refreshMusicChoices();
      // Restored files are fallback only; server catalogue is authoritative for automatic selection.
    } catch (error) {
      if (epoch === musicLibraryEpoch && previewView)
        previewView.musicCount.textContent = `Memoria locale facoltativa non accessibile: ${error.message}.`;
    }
  }
  async function persistMusicLibrary(files) {
    const userId = musicOwnerId();
    if (!userId) throw Error('sessione editoriale assente');
    await musicDbOperation('readwrite', store => store.put({userId, files}));
  }
  function refreshMusicChoices() {
    if (!previewView) return;
    const choice = previewView.musicChoice;
    const previous = choice.value;
    choice.replaceChildren(new Option('Automatica (tono della storia)', 'auto'));
    MUSIC_INDEX.forEach((track, i) => choice.add(new Option(track.title, `track:${i}`)));
    localTracks.forEach((file, i) => choice.add(new Option(`File locale: ${musicMeta(file)?.title || file.name}`, `local:${i}`)));
    choice.add(new Option('Nessuna musica', 'none'));
    choice.value = [...choice.options].some(opt => opt.value === previous) ? previous : 'auto';
    if (previewView.musicCount) previewView.musicCount.textContent =
      `Catalogo privato: ${MUSIC_INDEX.length} titoli; verifica file al primo utilizzo. ` +
      (localTracks.length ? `${localTracks.length} file locali facoltativi.` : 'Nessun caricamento manuale richiesto.');
    syncControls();
  }
  // Download only the chosen MP3. The existing Storage RLS decides whether this
  // authenticated editor may read it; no signed/public URL or new /api endpoint.
  async function privateMusicFile(track) {
    if (remoteTracks.has(track.sha256)) return remoteTracks.get(track.sha256);
    if (!url || !publicKey) throw Error('Configurazione Supabase della Redazione assente');
    const token = await requireEditor();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    let response;
    try {
      response = await fetch(
        `${url}/storage/v1/object/authenticated/${MUSIC_STORAGE_BUCKET}/audio/${track.sha256}.mp3`,
        {headers: {apikey: publicKey, Authorization: `Bearer ${token}`},
          cache: 'no-store', signal: controller.signal});
      if (!response.ok) {
        if (response.status === 401 || response.status === 403)
          throw Error('lettura musicale non autorizzata: verificare RLS e sessione editoriale');
        if (response.status === 404)
          throw Error('archivio musicale privato non ancora installato o file mancante');
        throw Error(`Storage musicale non disponibile (HTTP ${response.status})`);
      }
      const reportedSize = Number(response.headers.get('content-length') || 0);
      if (reportedSize > MAX_REMOTE_BYTES) throw Error('file musicale supera il limite previsto');
      const bytes = await response.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > MAX_REMOTE_BYTES || bytes.byteLength !== track.size)
        throw Error('dimensione MP3 diversa dal catalogo verificato');
      if (!crypto?.subtle) throw Error('verifica integrità MP3 non supportata dal browser');
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const actualSha = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      if (actualSha !== track.sha256) throw Error('hash SHA-256 non corrispondente al brano originale');
      const file = new File([bytes], `mixkit-${track.stem}.mp3`, {type:'audio/mpeg'});
      if (remoteTracks.size >= 3) remoteTracks.delete(remoteTracks.keys().next().value);
      remoteTracks.set(track.sha256, file);
      return file;
    } catch (e) {
      if (e?.name === 'AbortError') throw Error('tempo di caricamento della musica esaurito');
      throw e;
    } finally { clearTimeout(timeout); }
  }
  function storyMusicMood() {
    const narrative = `${generation?.plan?.concept || ''} ${generation?.plan?.story_logline || ''} ${generation?.plan?.story_outcome || ''}`.toLowerCase();
    if (/fiducia|rassicur|seren|tranquil|sicurez|solliev|famigl|difficolt|preoccup|problema|bollett/.test(narrative))
      return 'rassicurante';
    if (/spieg|tutorial|informaz|confront|verific|analiz|capir|passagg|consigli/.test(narrative))
      return 'informativo';
    return 'positivo';
  }
  function autoTrackIndex() {
    const topic = `${brief?.input?.theme || brief?.input?.article?.title || ''}|${generation?.plan?.concept || ''}`;
    let hash = 0;
    for (const char of topic) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
    const mood = storyMusicMood();
    const matching = MUSIC_INDEX.map((track, i) => ({track, i})).filter(({track}) => track.moods.includes(mood));
    const choices = (matching.length ? matching : MUSIC_INDEX.map((track, i) => ({track, i}))).map(item => item.i);
    let next = choices[(hash + automaticCounter++) % choices.length];
    if (choices.length > 1 && next === previousAutomaticTrack)
      next = choices[(choices.indexOf(next) + 1) % choices.length];
    previousAutomaticTrack = next;
    return next;
  }
  async function applyMusicChoice() {
    if (!previewView) return;
    const targetView = previewView;
    const epoch = ++musicSelectionEpoch;
    const choice = targetView.musicChoice.value;
    releaseSoundtrack(); // Never leave the previously selected track attached during a switch.
    if (choice === 'none') { showPreview(previewIndex); syncControls(); return; }
    musicLoading = true;
    targetView.musicHelp.textContent = 'Selezione e verifica della musica in corso…';
    syncControls();
    try {
      let file, cue = 0, source = 'libreria privata';
      if (choice.startsWith('local:')) {
        file = localTracks[Number(choice.slice(6))];
        if (!file) throw Error('MP3 locale non più disponibile');
        cue = reviewStartFor(file);
        source = 'file locale';
      } else {
        const index = choice === 'auto' ? autoTrackIndex() : Number(choice.slice(6));
        const track = MUSIC_INDEX[index];
        if (!track) throw Error('selezione musicale non valida');
        cue = track.cue;
        try {
          file = await privateMusicFile(track);
        } catch (remoteError) {
          const fallback = localTracks.find(candidate => musicMeta(candidate)?.sha256 === track.sha256);
          if (!fallback) throw remoteError;
          file = fallback;
          source = 'copia locale di sicurezza';
        }
      }
      if (epoch !== musicSelectionEpoch || targetView !== previewView) return;
      await selectSoundtrack(file, cue);
      if (!soundtrackFile) throw Error('brano non decodificabile o non riproducibile');
      if (epoch === musicSelectionEpoch && targetView === previewView)
        targetView.musicHelp.textContent = `${musicMeta(file)?.title || file.name} · ${source} · estratto da ${soundtrackStart.toFixed(2)} s. Puoi cambiare traccia.`;
    } catch (error) {
      if (epoch === musicSelectionEpoch && targetView === previewView)
        targetView.musicHelp.textContent = `Musica automatica non disponibile: ${error.message}. Esportazione bloccata finché manca l’audio.`;
    } finally {
      if (epoch === musicSelectionEpoch && targetView === previewView) {
        musicLoading = false;
        syncControls();
      }
    }
  }
  async function importLocalTracks(files) {
    if (busy()) return;
    const selected = [...files];
    if (!selected.length) return;
    if (selected.length > MAX_LOCAL_TRACKS || selected.some(file => !validLocalAudio(file))) {
      previewView.musicHelp.textContent = 'Importa da 1 a 12 file audio validi, massimo 25 MB ciascuno.';
      previewView.musicInput.value = '';
      return;
    }
    ++musicLibraryEpoch; // Never overwrite a fresh import with a pending IndexedDB restore.
    localTracks = [...new Map(selected.map(file => [`${file.name}|${file.size}|${file.lastModified}`, file])).values()];
    try {
      await persistMusicLibrary(localTracks);
      musicPersistedOnDevice = true;
    } catch (error) {
      musicPersistedOnDevice = false;
      previewView.musicHelp.textContent = `Salvataggio locale non riuscito (${error.message}). I brani saranno persi chiudendo il browser.`;
    }
    previousAutomaticTrack = -1;
    automaticCounter = 0;
    refreshMusicChoices();
    previewView.musicChoice.value = 'auto';
    await applyMusicChoice();
  }
  async function selectSoundtrack(file, requestedStart = 0) {
    releaseSoundtrack();
    if (!previewView || !file) return;
    if (!validLocalAudio(file)) {
      previewView.musicHelp.textContent = 'File audio non valido oppure superiore a 25 MB.';
      return;
    }
    const candidateUrl = URL.createObjectURL(file);
    const token = soundtrackLoadToken;
    const targetView = previewView;
    try {
      const audio = targetView.musicAudio;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(Error('lettura audio scaduta')); }, 10000);
        const onLoaded = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(Error('formato audio non supportato')); };
        function cleanup() {
          clearTimeout(timer);
          audio.removeEventListener('loadedmetadata', onLoaded);
          audio.removeEventListener('error', onError);
        }
        audio.addEventListener('loadedmetadata', onLoaded, {once:true});
        audio.addEventListener('error', onError, {once:true});
        audio.src = candidateUrl;
        audio.load();
      });
      if (token !== soundtrackLoadToken || targetView !== previewView) {
        URL.revokeObjectURL(candidateUrl);
        return;
      }
      if (!(audio.duration >= 15)) throw Error('il brano deve durare almeno 15 secondi');
      soundtrackStart = Number.isFinite(requestedStart) && audio.duration >= requestedStart + 15.05 ? requestedStart : 0;
      soundtrackFile = file;
      soundtrackUrl = candidateUrl;
      showPreview(previewIndex);
      previewView.musicHelp.textContent = `${file.name} · estratto da ${soundtrackStart.toFixed(2)} s. Scelta per BOZZA, non licenza approvata. Puoi cambiare traccia.`;
    } catch (error) {
      URL.revokeObjectURL(candidateUrl);
      if (token !== soundtrackLoadToken || targetView !== previewView) return;
      previewView.musicAudio.removeAttribute('src');
      previewView.musicAudio.load();
      previewView.musicHelp.textContent = `Traccia non utilizzabile: ${error.message}`;
    }
  }
  async function clearLocalTracks() {
    ++musicLibraryEpoch;
    const userId = musicOwnerId();
    if (userId) {
      try { await musicDbOperation('readwrite', store => store.delete(userId)); }
      catch (error) {
        if (previewView) previewView.musicHelp.textContent = `Impossibile cancellare la libreria persistente: ${error.message}`;
        return;
      }
    }
    localTracks = [];
    musicPersistedOnDevice = false;
    releaseSoundtrack();
    if (previewView) {
      previewView.musicInput.value = '';
      refreshMusicChoices();
      showPreview(previewIndex);
    }
  }
  function formatForRecorder() {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return null;
    return [
      ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'],
      ['video/webm;codecs=vp9,opus', 'webm'],
      ['video/webm;codecs=vp8,opus', 'webm'],
      ['video/webm', 'webm'],
    ].find(([mime]) => MediaRecorder.isTypeSupported(mime)) || null;
  }
  async function exportMontage() {
    if (!previewView || busy() || musicLoading || availablePreviewIndices().length !== 4) return;
    const format = formatForRecorder();
    if (!format) {
      previewView.exportStatus.textContent = 'Esportazione non disponibile in questo browser. Usa una versione aggiornata di Chrome, Edge o Firefox.';
      return;
    }
    if (!soundtrackFile && previewView.musicChoice.value !== 'none') {
      previewView.exportStatus.textContent = 'Brano automatico non disponibile: controllare che lo storage privato sia attivo e accessibile alla Redazione.';
      return;
    }
    stopPreview();
    exporting = true;
    syncControls();
    const [mime, extension] = format;
    let ctxAudio, audioSource, gainNode, capture;
    let animationId = null;
    let recorder;
    try {
      if (document.hidden) throw Error('mantieni aperta e visibile la scheda durante i 15 secondi di esportazione');
      previewView.exportStatus.textContent = 'Esportazione bozza 1080×1920 in corso: mantieni questa scheda aperta e visibile.';
      capture = previewView.canvas.captureStream(25);
      if (!capture.getVideoTracks().length) throw Error('cattura video non disponibile');
      if (soundtrackFile) {
        const AudioClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioClass) throw Error('Web Audio non supportato: impossibile includere la musica');
        ctxAudio = new AudioClass();
        const resume = ctxAudio.resume(); // initiate on the user's button click
        const decoded = await ctxAudio.decodeAudioData(await soundtrackFile.arrayBuffer());
        await resume;
        if (decoded.duration < soundtrackStart + 15) throw Error('l’estratto musicale selezionato è troppo corto');
        const destination = ctxAudio.createMediaStreamDestination();
        gainNode = ctxAudio.createGain();
        audioSource = ctxAudio.createBufferSource();
        audioSource.buffer = decoded;
        audioSource.connect(gainNode);
        gainNode.connect(destination);
        for (const track of destination.stream.getAudioTracks()) capture.addTrack(track);
        if (!capture.getAudioTracks().length) throw Error('audio non acquisito');
      }
      // Start the recorder before the audio buffer so the first sample is not lost.
      const chunks = [];
      let recordingError = null;
      recorder = new MediaRecorder(capture, {mimeType:mime, videoBitsPerSecond:6000000});
      const completed = new Promise((resolve,reject) => {
        recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
        recorder.onerror = event => { recordingError = event.error || Error('registrazione interrotta'); };
        recorder.onstop = () => resolve(new Blob(chunks, {type:recorder.mimeType || mime}));
      });
      renderMontageFrame(0);
      recorder.start(500);
      const start = ctxAudio ? ctxAudio.currentTime + 0.15 : performance.now()/1000 + 0.15;
      if (audioSource) {
        gainNode.gain.setValueAtTime(0.7, start);
        gainNode.gain.setValueAtTime(0.7, start + 13.8);
        gainNode.gain.linearRampToValueAtTime(0.001, start + 15);
        audioSource.start(start, soundtrackStart, 15);
      }
      await new Promise((resolve,reject) => {
        const onVisibility = () => { if (document.hidden) reject(Error('scheda nascosta durante la registrazione')); };
        document.addEventListener('visibilitychange', onVisibility);
        const tick = () => {
          const elapsed = Math.max(0, (ctxAudio ? ctxAudio.currentTime : performance.now()/1000) - start);
          renderMontageFrame(Math.min(15,elapsed));
          if (elapsed >= 15) {
            document.removeEventListener('visibilitychange', onVisibility);
            resolve();
          } else animationId = requestAnimationFrame(tick);
        };
        animationId = requestAnimationFrame(tick);
      });
      if (recorder.state === 'inactive') throw recordingError || Error('registrazione terminata in anticipo');
      recorder.stop();
      const videoBlob = await completed;
      if (recordingError) throw recordingError;
      if (videoBlob.size < 10000) throw Error('registrazione incompleta (file troppo piccolo)');
      if (exportDownloadUrl) URL.revokeObjectURL(exportDownloadUrl);
      exportDownloadUrl = URL.createObjectURL(videoBlob);
      const anchor = previewView.exportLink;
      anchor.href = exportDownloadUrl;
      anchor.download = `OffertaLogica-Reel-Bozza-15s.${extension}`;
      anchor.hidden = false;
      anchor.textContent = `Scarica bozza ${extension.toUpperCase()} (${(videoBlob.size/1048576).toFixed(1)} MB)`;
      previewView.exportStatus.textContent = `${extension.toUpperCase()} generato con ${soundtrackFile ? 'musica incorporata' : 'audio assente'}. È una BOZZA browser, non il master H.264/AAC approvato.`;
      anchor.click();
    } catch (error) {
      previewView.exportStatus.textContent = `Esportazione non riuscita: ${error.message}`;
    } finally {
      if (animationId !== null) cancelAnimationFrame(animationId);
      try { if (recorder?.state !== 'inactive') recorder.stop(); } catch {}
      try { audioSource?.stop(); } catch {}
      capture?.getTracks().forEach(track => track.stop());
      if (ctxAudio) await ctxAudio.close().catch(() => {});
      exporting = false;
      syncControls();
    }
  }
  function setSceneState(view, text, tone = 'neutral') {
    view.state.textContent = text;
    view.state.dataset.tone = tone;
  }
  function updateSceneActionLabel(view) {
    if (view.result) view.actionButton.textContent = 'Rigenera questa foto';
    else if (view.attempts > 0) view.actionButton.textContent = 'Riprova questa scena';
    else view.actionButton.textContent = 'Genera ora questa foto';
  }
  function textBoxRect(layer) {
    return {x:layer.box.x*MONTAGE_WIDTH,y:layer.box.y*MONTAGE_HEIGHT,
      width:layer.box.width*MONTAGE_WIDTH,height:layer.box.height*MONTAGE_HEIGHT};
  }
  function editorWarning(view) {
    if (!view || view.layoutPreference!=='manual') return '';
    if (productScreenActive(view.index))
      return 'Schermata verificata: il layout dedicato rimane fisso per non coprire la UI autentica.';
    const t=initializeManualCopy(view),warnings=[];
    const kinds=manualKinds(view).filter(kind=>kind!=='logo'&&layerText(view,kind));
    const boxes=kinds.map(kind=>({kind,box:textBoxRect(layerFor(view,kind))}));
    for(let i=0;i<boxes.length;i++) {
      for(let j=i+1;j<boxes.length;j++) {
        if(intersects(boxes[i].box,boxes[j].box,8)){
          warnings.push('Riquadri testo sovrapposti');break;
        }
      }
    }
    if((view._faceBoxes||[]).some(face=>boxes.some(({box})=>intersects(face,box,15))))
      warnings.push('Testo vicino a un volto (verifica manualmente)');
    const ctx=previewView?.canvas?.getContext('2d');
    if(ctx)for(const {kind,box} of boxes) {
      const result=fitManualLines(ctx,layerText(view,kind),layerFor(view,kind).style,box.width,box.height);
      if(result.overflow)warnings.push(`${kind.startsWith('extra:')?'Testo aggiuntivo':kind}: riquadro piccolo, testo abbreviato`);
    }
    if(t.logo.visible) {
      const logo=textBoxRect({box:constrainLogoBox(t.logo.box)});
      if((view._faceBoxes||[]).some(face=>intersects(face,logo,15)))
        warnings.push('Logo vicino a un volto (verifica manualmente)');
    }
    return warnings.length?`Verifica prima di esportare: ${[...new Set(warnings)].join('; ')}.`:
      'Trascina o ridimensiona ogni testo e il logo. Le impostazioni restano nella bozza browser.';
  }
  function editorBoxLabel(kind,view) {
    if(kind==='title')return 'Titolo';
    if(kind==='subtitle')return 'Sottotitolo';
    if(kind==='cta')return 'CTA';
    if(kind==='logo')return 'Logo OffertaLogica';
    const position=initializeManualCopy(view).extras.findIndex(layer=>layer.id===kind)+1;
    return `Testo ${position}`;
  }
  function addEditorHandle(kind,view) {
    if(previewView.editorBoxes[kind])return previewView.editorBoxes[kind];
    const box=document.createElement('div');
    box.className=`ol-vs-edit-box ol-vs-edit-box-${kind==='logo'?'logo':kind.startsWith('extra:')?'extra':kind}`;
    box.tabIndex=0;box.setAttribute('role','group');
    box.setAttribute('aria-label',`Posizione ${editorBoxLabel(kind,view)}`);
    const tag=document.createElement('span');tag.className='ol-vs-edit-box-label';
    tag.textContent=editorBoxLabel(kind,view);
    const handle=document.createElement('span');handle.className='ol-vs-edit-resize';
    handle.setAttribute('aria-hidden','true');
    box.append(tag,handle);installTextDrag(box,kind);
    previewView.editorBoxes[kind]=box;previewView.editorOverlay.append(box);
    return box;
  }
  function updateTextHandles() {
    if(!previewView?.editorOverlay)return;
    const view=currentTextView();
    const enabled=sceneIsManuallyEditable(view);
    previewView.editorOverlay.hidden=!enabled;
    for(const box of Object.values(previewView.editorBoxes))box.hidden=true;
    if(!enabled) {
      if(previewView.editorHelp)previewView.editorHelp.textContent=editorWarning(view);
      return;
    }
    const design=initializeManualCopy(view);
    for(const kind of manualKinds(view)) {
      const layer=layerFor(view,kind);
      if(!layer)continue;
      const el=addEditorHandle(kind,view);
      const b=kind==='logo'?constrainLogoBox(layer.box):constrainTextBox(layer.box,kind);
      const hidden=kind==='logo'?!design.logo.visible:!layerText(view,kind);
      el.hidden=hidden;
      el.querySelector('.ol-vs-edit-box-label').textContent=editorBoxLabel(kind,view);
      Object.assign(el.style,{left:`${b.x*100}%`,top:`${b.y*100}%`,
        width:`${b.width*100}%`,height:`${b.height*100}%`});
      el.classList.toggle('is-selected',previewView.editorLayer?.value===kind);
    }
    if(previewView.editorHelp)previewView.editorHelp.textContent=editorWarning(view);
  }
  function syncVisualEditor() {
    if(!previewView?.editorScene)return;
    const view=currentTextView();
    previewView.editorScene.value=String(view?.index??0);
    previewView.editorMode.value=view?.layoutPreference||'auto';
    const layerSelect=previewView.editorLayer;
    const selected=layerSelect.value;
    const types=view?manualKinds(view):['title','subtitle','logo'];
    layerSelect.replaceChildren();
    for(const kind of types)layerSelect.add(new Option(editorBoxLabel(kind,view),kind));
    layerSelect.value=types.includes(selected)?selected:'title';
    const manual=!!view && sceneIsManuallyEditable(view);
    const kind=layerSelect.value;
    previewView.editorFields.hidden=!manual||kind==='logo';
    previewView.editorLogoFields.hidden=!manual||kind!=='logo';
    previewView.editorExtraFields.hidden=!manual||!kind.startsWith('extra:');
    const extraLayer=manual&&kind.startsWith('extra:')?layerFor(view,kind):null;
    if(extraLayer&&previewView.editorExtraText.value!==extraLayer.text)
      previewView.editorExtraText.value=extraLayer.text;
    if(manual&&kind==='logo') {
      const logo=initializeManualCopy(view).logo;
      previewView.logoVisible.checked=logo.visible;
      previewView.logoWidth.value=String(Math.round(logo.box.width*100));
      previewView.logoOpacity.value=String(logo.opacity);
      previewView.logoSizeOutput.textContent=`${Math.round(logo.box.width*100)}%`;
      previewView.logoOpacityOutput.textContent=`${Math.round(logo.opacity*100)}%`;
    }
    if(manual&&kind!=='logo') {
      const style=layerFor(view,kind)?.style;
      if(style) {
        const form=previewView.editorFields;
        form.querySelectorAll('[data-style-prop]').forEach(input=>{
          const prop=input.dataset.styleProp;
          if(input.type==='checkbox')input.checked=Boolean(style[prop]);
          else input.value=String(style[prop]);
        });
        form.querySelectorAll('[data-style-output]').forEach(node=>{
          node.textContent=String(style[node.dataset.styleOutput]);
        });
      }
    }
    previewView.addTextButton.disabled=!manual||initializeManualCopy(view).extras.length>=MAX_EXTRA_TEXTS;
    previewView.removeTextButton.disabled=!manual||!kind.startsWith('extra:');
    previewView.duplicateTextButton.disabled=!manual||!kind.startsWith('extra:')||
      initializeManualCopy(view).extras.length>=MAX_EXTRA_TEXTS;
    for(const form of [previewView.editorFields,previewView.editorLogoFields,previewView.editorExtraFields])
      form.querySelectorAll('input,select,textarea,button').forEach(field=>{field.disabled=!manual;});
    updateTextHandles();
  }
  function updateManualDesign() {
    scheduleProjectAutosave();
    if(!previewPlaying && !exporting)showPreview(previewIndex);
    else updateTextHandles();
  }
  function installTextDrag(el,kind) {
    let drag=null;
    el.addEventListener('pointerdown',event=>{
      const view=currentTextView();
      if(!sceneIsManuallyEditable(view)||!layerFor(view,kind))return;
      event.preventDefault();
      previewView.editorLayer.value=kind;
      syncVisualEditor();
      const box=layerFor(view,kind).box;
      drag={pointerId:event.pointerId,index:view.index,startX:event.clientX,startY:event.clientY,
        original:{...box},resize:event.target.classList.contains('ol-vs-edit-resize')};
      el.setPointerCapture(event.pointerId);
    });
    el.addEventListener('pointermove',event=>{
      if(!drag||event.pointerId!==drag.pointerId)return;
      const view=sceneViews[drag.index];
      if(!sceneIsManuallyEditable(view))return;
      const rect=previewView.canvas.getBoundingClientRect();
      if(!rect.width||!rect.height)return;
      const dx=(event.clientX-drag.startX)/rect.width;
      const dy=(event.clientY-drag.startY)/rect.height;
      const next={...drag.original};
      if(kind==='logo') {
        if(drag.resize)next.width=clampNumber(next.width+dx,.09,.50);
        else{next.x+=dx;next.y+=dy;}
        layerFor(view,kind).box=constrainLogoBox(next);
      } else {
        if(drag.resize) {
          next.width=clampNumber(next.width+dx,kind.startsWith('extra:')?.17:.23,TEXT_SAFE.right-next.x);
          next.height=clampNumber(next.height+dy,
            kind==='title'?.085:kind.startsWith('extra:')?.052:.065,TEXT_SAFE.bottom-next.y);
        } else{next.x+=dx;next.y+=dy;}
        layerFor(view,kind).box=constrainTextBox(next,kind);
      }
      if(!previewPlaying)renderMontageFrame(sceneViews.slice(0,view.index).reduce(
        (n,v)=>n+Number(v.scene.duration_ms||0),0)/1000+.34);
      updateTextHandles();
    });
    const end=event=>{
      if(!drag||event.pointerId!==drag.pointerId)return;
      drag=null;
      if(el.hasPointerCapture(event.pointerId))el.releasePointerCapture(event.pointerId);
      updateManualDesign();
    };
    el.addEventListener('pointerup',end);
    el.addEventListener('pointercancel',end);
    el.addEventListener('keydown',event=>{
      const view=currentTextView();
      if(!sceneIsManuallyEditable(view)||!layerFor(view,kind))return;
      const movement={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
      if(!movement)return;
      event.preventDefault();previewView.editorLayer.value=kind;
      const b={...layerFor(view,kind).box},amount=event.altKey?.002:.01;
      if(kind==='logo') {
        if(event.shiftKey)b.width+=movement[0]*amount;
        else{b.x+=movement[0]*amount;b.y+=movement[1]*amount;}
        layerFor(view,kind).box=constrainLogoBox(b);
      } else {
        if(event.shiftKey){b.width+=movement[0]*amount;b.height+=movement[1]*amount;}
        else{b.x+=movement[0]*amount;b.y+=movement[1]*amount;}
        layerFor(view,kind).box=constrainTextBox(b,kind);
      }
      updateManualDesign();
    });
  }
  function createVisualTextEditor() {
    const panel=document.createElement('div');panel.className='ol-vs-text-editor';
    panel.append(textElement('h5','Regia testi e logo · bozza browser'));
    const row=document.createElement('div');row.className='ol-vs-editor-row';
    function selectControl(label,options,callback) {
      const wrap=document.createElement('label');wrap.className='ol-vs-editor-field';
      wrap.append(document.createTextNode(label));
      const select=document.createElement('select');
      for(const [value,text] of options)select.add(new Option(text,value));
      select.addEventListener('change',callback);wrap.append(select);return {wrap,select};
    }
    const scene=selectControl('Scena',Array.from({length:4},(_,i)=>[String(i),`Scena ${i+1}`]),()=>{
      if(busy()||previewPlaying)return;showPreview(Number(scene.select.value));
    });previewView.editorScene=scene.select;
    const mode=selectControl('Posizione',[
      ['auto','Automatica'],['manual','Manuale · trascina'],
      ['top','In alto'],['left','A sinistra'],['right','A destra'],['bottom','In basso'],
    ],()=>{
      const view=currentTextView();if(!view||busy()||previewPlaying)return;
      if(mode.select.value==='manual')initializeManualCopy(view);
      view.layoutPreference=mode.select.value;
      if(view.layoutSelect)view.layoutSelect.value=view.layoutPreference;
      view._compositionKey=null;updateManualDesign();
    });previewView.editorMode=mode.select;
    const layer=selectControl('Elemento', [['title','Titolo'],['subtitle','Sottotitolo'],['logo','Logo OffertaLogica']],
      ()=>syncVisualEditor());
    previewView.editorLayer=layer.select;
    row.append(scene.wrap,mode.wrap,layer.wrap);panel.append(row);
    const actions=document.createElement('div');actions.className='ol-vs-editor-actions';
    const add=document.createElement('button');add.type='button';add.className='ol-button ol-button-secondary ol-button-small';
    add.textContent='+ Aggiungi testo';previewView.addTextButton=add;
    add.addEventListener('click',()=>{
      const view=currentTextView();if(!sceneIsManuallyEditable(view))return;
      const d=initializeManualCopy(view);
      if(d.extras.length>=MAX_EXTRA_TEXTS)return;
      view._extraTextSerial=(view._extraTextSerial||0)+1;
      const id=`extra:${view.index}-${view._extraTextSerial}`;
      const offset=d.extras.length*.078;
      d.extras.push({id,text:'Nuovo testo',style:defaultTextStyle('extra'),
        box:constrainTextBox({x:.12,y:.50+offset,width:.68,height:.085},id)});
      previewView.editorLayer.value=id;
      updateManualDesign();previewView.editorLayer.value=id;syncVisualEditor();
      previewView.editorExtraText.focus();previewView.editorExtraText.select();
    });
    const dup=document.createElement('button');dup.type='button';dup.className='ol-button ol-button-secondary ol-button-small';
    dup.textContent='Duplica testo';previewView.duplicateTextButton=dup;
    dup.addEventListener('click',()=>{
      const view=currentTextView(),kind=previewView.editorLayer.value;
      if(!sceneIsManuallyEditable(view)||!kind.startsWith('extra:'))return;
      const d=initializeManualCopy(view),original=layerFor(view,kind);
      if(!original||d.extras.length>=MAX_EXTRA_TEXTS)return;
      view._extraTextSerial=(view._extraTextSerial||0)+1;
      const id=`extra:${view.index}-${view._extraTextSerial}`;
      const box=constrainTextBox({...original.box,x:original.box.x+.04,y:original.box.y+.04},id);
      d.extras.push({id,text:original.text,style:{...original.style},box});
      updateManualDesign();previewView.editorLayer.value=id;syncVisualEditor();
    });
    const remove=document.createElement('button');remove.type='button';remove.className='ol-button ol-button-secondary ol-button-small';
    remove.textContent='Elimina testo';previewView.removeTextButton=remove;
    remove.addEventListener('click',()=>{
      const view=currentTextView(),kind=previewView.editorLayer.value;
      if(!sceneIsManuallyEditable(view)||!kind.startsWith('extra:'))return;
      const d=initializeManualCopy(view);d.extras=d.extras.filter(item=>item.id!==kind);
      previewView.editorLayer.value='title';updateManualDesign();
    });
    actions.append(add,dup,remove);panel.append(actions);
    const extraFields=document.createElement('div');extraFields.className='ol-vs-editor-extra';
    const extraLabel=document.createElement('label');extraLabel.className='ol-vs-editor-field';
    extraLabel.append(document.createTextNode('Testo libero (max 140 caratteri)'));
    const extraText=document.createElement('textarea');extraText.maxLength=140;extraText.rows=2;
    previewView.editorExtraText=extraText;
    extraText.addEventListener('input',()=>{
      const view=currentTextView();if(!sceneIsManuallyEditable(view))return;
      const kind=previewView.editorLayer.value,model=layerFor(view,kind);
      if(!kind.startsWith('extra:')||!model)return;
      model.text=extraText.value;updateManualDesign();
    });extraLabel.append(extraText);extraFields.append(extraLabel);
    previewView.editorExtraFields=extraFields;panel.append(extraFields);
    const logoFields=document.createElement('div');logoFields.className='ol-vs-editor-logo';
    previewView.editorLogoFields=logoFields;
    const logoVisible=document.createElement('input');logoVisible.type='checkbox';previewView.logoVisible=logoVisible;
    const visibleLabel=document.createElement('label');visibleLabel.className='ol-vs-editor-check';
    visibleLabel.append(logoVisible,document.createTextNode('Logo visibile'));
    logoVisible.addEventListener('change',()=>{
      const view=currentTextView();if(!sceneIsManuallyEditable(view))return;
      initializeManualCopy(view).logo.visible=logoVisible.checked;updateManualDesign();
    });
    const logoWidth=document.createElement('input');logoWidth.type='range';logoWidth.min='9';logoWidth.max='50';logoWidth.step='1';
    previewView.logoWidth=logoWidth;const logoSizeOutput=document.createElement('output');previewView.logoSizeOutput=logoSizeOutput;
    const widthLabel=document.createElement('label');widthLabel.className='ol-vs-editor-field';
    widthLabel.append(document.createTextNode('Larghezza logo'),logoWidth,logoSizeOutput);
    logoWidth.addEventListener('input',()=>{
      const view=currentTextView();if(!sceneIsManuallyEditable(view))return;
      const logo=initializeManualCopy(view).logo;
      logo.box=constrainLogoBox({...logo.box,width:Number(logoWidth.value)/100});
      updateManualDesign();
    });
    const logoOpacity=document.createElement('input');logoOpacity.type='range';logoOpacity.min='0.15';logoOpacity.max='1';logoOpacity.step='.05';
    previewView.logoOpacity=logoOpacity;const opacityOutput=document.createElement('output');previewView.logoOpacityOutput=opacityOutput;
    const opacityLabel=document.createElement('label');opacityLabel.className='ol-vs-editor-field';
    opacityLabel.append(document.createTextNode('Opacità logo'),logoOpacity,opacityOutput);
    logoOpacity.addEventListener('input',()=>{
      const view=currentTextView();if(!sceneIsManuallyEditable(view))return;
      initializeManualCopy(view).logo.opacity=Number(logoOpacity.value);
      updateManualDesign();
    });
    const logoReset=document.createElement('button');logoReset.type='button';
    logoReset.className='ol-button ol-button-secondary ol-button-small';logoReset.textContent='Ripristina logo';
    logoReset.addEventListener('click',()=>{
      const view=currentTextView();if(!sceneIsManuallyEditable(view))return;
      initializeManualCopy(view).logo=newLogoLayer();updateManualDesign();
    });
    logoFields.append(visibleLabel,widthLabel,opacityLabel,logoReset);panel.append(logoFields);
    const fields=document.createElement('div');fields.className='ol-vs-editor-fields';
    previewView.editorFields=fields;
    function inputControl(label,prop,type,opts={}) {
      const wrap=document.createElement('label');wrap.className='ol-vs-editor-field';
      wrap.append(document.createTextNode(label));
      let input;
      if(opts.options) {input=document.createElement('select');for(const [v,t] of opts.options)input.add(new Option(t,v));}
      else {input=document.createElement('input');input.type=type;
        if(opts.min!==undefined)input.min=opts.min;
        if(opts.max!==undefined)input.max=opts.max;
        if(opts.step!==undefined)input.step=opts.step;}
      input.dataset.styleProp=prop;
      if(input.type==='checkbox')wrap.classList.add('ol-vs-editor-check');
      input.addEventListener('input',()=>{
        const view=currentTextView();if(!sceneIsManuallyEditable(view))return;
        const layer=layerFor(view,previewView.editorLayer.value);
        if(!layer?.style)return;
        const val=input.type==='checkbox'?input.checked:input.type==='range'?Number(input.value):input.value;
        layer.style[prop]=val;
        if(prop==='size'||prop==='opacity'){
          const output=wrap.querySelector('output');if(output)output.textContent=String(val);
        }
        updateManualDesign();
      });
      if(type==='range') {const output=document.createElement('output');output.dataset.styleOutput=prop;wrap.append(output);}
      wrap.append(input);fields.append(wrap);return input;
    }
    inputControl('Carattere','font','select',{options:Object.keys(TEXT_FONTS).map(name=>[name,name])});
    inputControl('Peso','weight','select',{options:[[400,'Normale'],[500,'Medio'],[600,'Semibold'],[700,'Grassetto'],[800,'Extra bold']]});
    inputControl('Dimensione','size','range',{min:34,max:124,step:2});
    inputControl('Colore','color','color');
    inputControl('Allineamento','align','select',{options:[['left','Sinistra'],['center','Centro'],['right','Destra']]});
    inputControl('Sfondo testo','background','checkbox');
    inputControl('Colore riquadro','bgColor','color');
    inputControl('Opacità riquadro','opacity','range',{min:0,max:1,step:.05});
    inputControl('Spazio interno','padding','number',{min:0,max:60,step:2});
    inputControl('Angoli arrotondati','radius','number',{min:0,max:64,step:2});
    inputControl('Ombra leggibilità','shadow','checkbox');
    const reset=document.createElement('button');reset.type='button';
    reset.className='ol-button ol-button-secondary ol-button-small';reset.textContent='Ripristina elemento';
    reset.addEventListener('click',()=>{
      const view=currentTextView();if(!sceneIsManuallyEditable(view))return;
      const kind=previewView.editorLayer.value;
      const d=initializeManualCopy(view);
      if(kind.startsWith('extra:')) {
        const layer=layerFor(view,kind);if(!layer)return;
        layer.style=defaultTextStyle('extra');
      } else {
        view.textDesign=null;
        const replacement=initializeManualCopy(view)[kind];
        view.textDesign=d;
        d[kind]={box:{...replacement.box},style:{...replacement.style}};
      }
      updateManualDesign();
    });fields.append(reset);
    const help=document.createElement('p');help.className='ol-vs-editor-help';
    help.setAttribute('role','status');previewView.editorHelp=help;
    panel.append(fields,help);
    panel.append(textElement('p','Frecce: sposta. Maiusc + frecce: ridimensiona. Alt: movimento preciso. Logo originale, proporzioni sempre conservate. Nessuna azione AI.'));
    return panel;
  }
  function createProgressAndPreview() {
    progressView = {
      box: document.createElement('section'),
      count: document.createElement('p'),
      note: document.createElement('p'),
    };
    progressView.box.className = 'ol-vs-progress-box';
    progressView.count.className = 'ol-vs-progress-count';
    progressView.note.className = 'ol-muted ol-small';
    progressView.box.append(textElement('h4', 'Elaborazione fotografica'), progressView.count, progressView.note);
    realSummary.append(progressView.box);

    previewView = {
      box: document.createElement('section'),
      playButton: document.createElement('button'),
      canvas: document.createElement('canvas'),
      meta: document.createElement('p'),
      musicInput: document.createElement('input'),
      musicChoice: document.createElement('select'),
      musicClear: document.createElement('button'),
      musicCount: document.createElement('small'),
      exportButton: document.createElement('button'),
      exportLink: document.createElement('a'),
      exportStatus: document.createElement('small'),
      musicHelp: document.createElement('small'),
      musicAudio: document.createElement('audio'),
      productInput: document.createElement('input'),
      productChoice: document.createElement('select'),
      productConfirmed: document.createElement('input'),
      productHelp: document.createElement('small'),
      logo: new Image(),
    };
    previewView.box.className = 'ol-vs-preview-box';
    const previewHeader = document.createElement('div');
    previewHeader.className = 'ol-vs-preview-head';
    const previewIntro = document.createElement('div');
    previewIntro.append(
      textElement('h4', 'Montaggio audiovisivo di prova · 15 secondi'),
      textElement('p', 'Scegli una scena: modifica testi e logo originali con trascinamento, dimensioni e colori. Puoi aggiungere fino a quattro testi liberi per scena; tutti compaiono nella bozza esportata.'),
    );
    previewView.playButton.type = 'button';
    previewView.playButton.className = 'ol-button ol-button-primary ol-button-small';
    previewView.playButton.textContent = 'Riproduci montaggio';
    previewView.playButton.disabled = true;
    previewView.playButton.addEventListener('click', () => { togglePreviewPlayback(); });
    previewView.exportButton.type = 'button';
    previewView.exportButton.className = 'ol-button ol-button-secondary ol-button-small';
    previewView.exportButton.textContent = 'Scarica montaggio video';
    previewView.exportButton.disabled = true;
    previewView.exportButton.addEventListener('click', () => { exportMontage(); });
    previewHeader.append(previewIntro, previewView.playButton, previewView.exportButton);

    const stage = document.createElement('div');
    stage.className = 'ol-vs-preview-stage';
    previewView.canvas.width = MONTAGE_WIDTH;
    previewView.canvas.height = MONTAGE_HEIGHT;
    previewView.canvas.className = 'ol-vs-preview-canvas';
    previewView.canvas.setAttribute('aria-label', 'Montaggio Reel in formato verticale 9:16');
    const frame=document.createElement('div');
    frame.className='ol-vs-edit-frame';
    frame.append(previewView.canvas);
    previewView.editorOverlay=document.createElement('div');
    previewView.editorOverlay.className='ol-vs-edit-overlay';
    previewView.editorOverlay.setAttribute('aria-label','Area modifica testi e logo sulla scena');
    const safe=document.createElement('div');safe.className='ol-vs-edit-safe';
    Object.assign(safe.style,{left:`${TEXT_SAFE.left*100}%`,top:`${TEXT_SAFE.top*100}%`,
      width:`${(TEXT_SAFE.right-TEXT_SAFE.left)*100}%`,height:`${(TEXT_SAFE.bottom-TEXT_SAFE.top)*100}%`});
    previewView.editorOverlay.append(safe);
    previewView.editorBoxes={};
    for(const kind of ['title','subtitle','cta','logo'])addEditorHandle(kind,sceneViews[0]);
    frame.append(previewView.editorOverlay);
    stage.append(frame);

    const musicRow = document.createElement('div');
    musicRow.className = 'ol-vs-music-row';
    const musicLabel = document.createElement('label');
    musicLabel.textContent = 'MP3 locali alternativi (facoltativo; catalogo automatico sul server)';
    previewView.musicInput.type = 'file';
    previewView.musicInput.multiple = true;
    previewView.musicInput.accept = 'audio/*,.mp3,.m4a,.wav,.aac,.ogg,.flac';
    previewView.musicInput.addEventListener('change', () => { importLocalTracks(previewView.musicInput.files || []); });
    musicLabel.append(previewView.musicInput);
    const choiceLabel = document.createElement('label');
    choiceLabel.textContent = 'Musica inserita nel Reel (automatica o modificabile)';
    previewView.musicChoice.addEventListener('change', () => {applyMusicChoice();scheduleProjectAutosave();});
    choiceLabel.append(previewView.musicChoice);
    previewView.musicClear.type = 'button';
    previewView.musicClear.className = 'ol-button ol-button-secondary ol-button-small';
    previewView.musicClear.textContent = 'Cancella MP3 locali';
    previewView.musicClear.addEventListener('click', clearLocalTracks);
    previewView.musicCount.className = 'ol-muted ol-small';
    previewView.musicHelp.className = 'ol-muted ol-small';
    previewView.exportStatus.className = 'ol-muted ol-small';
    previewView.exportStatus.setAttribute('role', 'status');
    previewView.exportLink.className = 'ol-button ol-button-secondary ol-button-small';
    previewView.exportLink.hidden = true;
    previewView.exportLink.textContent = 'Scarica file pronto';
    previewView.musicAudio.preload = 'metadata';
    musicRow.append(musicLabel, choiceLabel, previewView.musicClear, previewView.musicCount,
      previewView.musicHelp, previewView.exportStatus, previewView.exportLink);
    previewView.meta.className = 'ol-vs-preview-meta';
    // Verified, editor-supplied screenshot is a separate composited scene, never AI-generated UI.
    const productRow = document.createElement('div');
    productRow.className = 'ol-vs-music-row';
    const screenLabel = document.createElement('label');
    screenLabel.textContent = 'Schermata reale OffertaLogica (facoltativa, per una scena dimostrativa)';
    previewView.productInput.type = 'file';
    previewView.productInput.accept = 'image/png,image/jpeg,image/webp';
    previewView.productInput.addEventListener('change', () => loadProductScreen(previewView.productInput.files?.[0]));
    screenLabel.append(previewView.productInput);
    const screenSceneLabel = document.createElement('label');
    screenSceneLabel.textContent = 'Scena da sostituire con la schermata reale';
    for (let i = 0; i < 4; i++) previewView.productChoice.add(new Option(`Scena ${i + 1}`, String(i)));
    previewView.productChoice.value = '2';
    previewView.productChoice.addEventListener('change', () => {showPreview(Number(previewView.productChoice.value));scheduleProjectAutosave();});
    screenSceneLabel.append(previewView.productChoice);
    const confirmLabel = document.createElement('label');
    previewView.productConfirmed.type = 'checkbox';
    previewView.productConfirmed.disabled = true;
    previewView.productConfirmed.addEventListener('change', () => {showPreview(Number(previewView.productChoice.value));scheduleProjectAutosave();});
    confirmLabel.append(previewView.productConfirmed,
      document.createTextNode(' Confermo che questa è una schermata autentica e attuale del servizio'));
    previewView.productHelp.className = 'ol-muted ol-small';
    previewView.productHelp.textContent = 'Carica solo schermate effettive del servizio, senza dati personali. Le immagini AI non attestano l’autenticità dell’interfaccia.';
    productRow.append(screenLabel, screenSceneLabel, confirmLabel, previewView.productHelp);
    const textEditor=createVisualTextEditor();
    previewView.box.append(previewHeader, stage, textEditor, musicRow, productRow, previewView.meta);
    realSummary.append(previewView.box);
    refreshMusicChoices();
    // The server music library is loaded automatically even on a new device.
    // Restore local MP3s only as an optional fallback; no import is required.
    const currentView = previewView;
    restoreMusicLibrary().finally(() => {
      if (currentView === previewView) applyMusicChoice();
    });
    previewView.logo.addEventListener('load', () => { if (!previewPlaying) showPreview(previewIndex); });
    previewView.logo.src = '/assets/logo-offertalogica-header.png';
    showPreview(0);
  }
  function createSceneCard(scene, index) {
    const card = document.createElement('article');
    card.className = 'ol-vs-scene-card';
    const heading = textElement('h4', `Scena ${index + 1} · ${scene.duration_ms / 1000}s · ${scene.role}`);
    const lead = textElement('p', `${scene.headline}${scene.secondary_text ? ' — ' + scene.secondary_text : ''}`);
    const visual = textElement('p', `Immagine: ${scene.visual_brief}`);
    const subject = textElement('p', `Soggetto: ${scene.subject_description} · Emozione: ${scene.emotion}`);
    const side = textElement('p', `Posizione soggetto: ${scene.subject_side}`);

    const state = textElement('p', 'In attesa della generazione automatica…');
    state.className = 'ol-vs-scene-state ol-small';

    const image = document.createElement('img');
    image.hidden = true;
    image.alt = `Fotografia proposta per scena ${index + 1}, da revisionare`;
    image.className = 'ol-vs-scene-photo';
    image.addEventListener('load', () => {
      if (!previewPlaying && previewView) showPreview(previewIndex);
    });

    const actions = document.createElement('div');
    actions.className = 'ol-toolbar-group';
    const actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.className = 'ol-button ol-button-secondary ol-button-small';
    actionButton.disabled = true;

    const notesWrap = document.createElement('div');
    notesWrap.className = 'ol-field ol-vs-scene-notes';
    const notesLabel = document.createElement('label');
    notesLabel.setAttribute('for', `vs-scene-note-${index}`);
    notesLabel.textContent = 'Cosa non va / cosa vuoi cambiare';
    const notesInput = document.createElement('textarea');
    notesInput.id = `vs-scene-note-${index}`;
    notesInput.rows = 3;
    notesInput.maxLength = 700;
    notesInput.placeholder = 'Es. Mantieni il volto libero per il testo, mostra meglio la bolletta e rendi l’espressione più preoccupata.';
    notesInput.addEventListener('input',scheduleProjectAutosave);
    const notesHint = textElement('small', 'Lascia vuoto per usare il brief originale. Compila le note solo quando vuoi rigenerare questa scena.');
    notesWrap.append(notesLabel, notesInput, notesHint);

    const prompt = document.createElement('details');
    prompt.hidden = true;
    prompt.className = 'ol-vs-scene-prompt';
    prompt.append(textElement('summary', 'Mostra prompt fotografico'));
    const promptBody = textElement('pre', '');
    prompt.append(promptBody);

    const layoutWrap = document.createElement('div');
    layoutWrap.className = 'ol-field ol-vs-layout-placement';
    const layoutLabel = document.createElement('label');
    layoutLabel.setAttribute('for', `vs-scene-layout-${index}`);
    layoutLabel.textContent = 'Posizione testo e logo sulla fotografia';
    const layoutSelect = document.createElement('select');
    layoutSelect.id = `vs-scene-layout-${index}`;
    for (const [value, label] of [['auto','Automatica (lato libero della scena)'],['manual','Manuale · trascina sul frame'],['top','In alto'],
      ['left','A sinistra'],['right','A destra'],['bottom','In basso']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      layoutSelect.append(option);
    }
    layoutWrap.append(layoutLabel, layoutSelect);
    const view = {
      scene,
      index,
      card,
      state,
      image,
      actionButton,
      notesInput,
      layoutPreference: 'auto',
      layoutSelect,
      prompt,
      promptBody,
      attempts: 0,
      result: null,
      error: '',
      running: false,
    };
    layoutSelect.addEventListener('change', () => {
      if (exporting) return;
      if(layoutSelect.value==='manual')initializeManualCopy(view);
      view.layoutPreference = layoutSelect.value;
      view._compositionKey = null;
      scheduleProjectAutosave();
      if (!previewPlaying && previewView) showPreview(index);
    });
    actionButton.addEventListener('click', async () => {
      if (busy() || !generation) return;
      actionButton.disabled = true;
      try {
        const token = await requireEditor();
        await requestPhoto(view, token, notesInput.value.trim());
        if (view.result) showPreview(view.index);
      } catch (e) {
        message(`Rigenerazione non riuscita: ${e.message}`, true);
      } finally {
        syncControls();
      }
    });
    const uploadLabel=document.createElement('label');
    uploadLabel.className='ol-button ol-button-secondary ol-button-small';
    uploadLabel.textContent='Carica una tua immagine';
    const uploadInput=document.createElement('input');
    uploadInput.type='file';uploadInput.accept='image/jpeg,image/png,image/webp';
    uploadInput.style.position='absolute';uploadInput.style.width='1px';uploadInput.style.height='1px';
    uploadInput.style.opacity='0';uploadInput.style.overflow='hidden';
    uploadInput.setAttribute('aria-label',`Carica foto personale per scena ${index+1}`);
    uploadLabel.append(uploadInput);
    view.uploadInput=uploadInput;
    uploadInput.addEventListener('change',async()=>{
      const selected=uploadInput.files?.[0];
      if(selected)await uploadScenePhoto(view,selected);
      uploadInput.value='';
    });
    updateSceneActionLabel(view);
    actions.append(actionButton,uploadLabel);
    card.append(heading, lead, visual, subject, side, state, image, layoutWrap, notesWrap, actions, prompt);
    sceneHolder.append(card);
    return view;
  }
  async function requestPhoto(view, token, revisionNotes = '') {
    await renewStoryboardReceiptIfNeeded(token);
    // Scene 1 defines identity; every later scene needs an authentic frame from THIS storyboard.
    const previous=sceneViews.slice(0,view.index);
    if(previous.some(frame=>!frame.result?.continuity_reference))
      throw Error('Genera prima le scene precedenti per garantire la continuità visiva.');
    const guide=generation.guide_reference;
    const strong=generation.input.input_type==='guide_image'&&generation.input.guide_fidelity==='strong';
    const references=strong
      ? view.index===0?[guide]:view.index===1&&generation.input.guide_usage==='first_scene'?[guide]:
        [guide,previous[previous.length-1].result.continuity_reference]
      : view.index===0?(generation.input.input_type==='guide_image'&&generation.input.guide_usage==='reference_only'?[guide]:[]):
        view.index===1?[previous[0].result.continuity_reference]:
        [previous[0].result.continuity_reference,previous[previous.length-1].result.continuity_reference];
    if(references.some(ref=>!ref))throw Error('Riferimento guida mancante: rigenera lo storyboard prima di avviare altre foto.');
    stopPreview();
    view.running = true;
    view.error = '';
    let failure = null;
    view.attempts += 1;
    updateSceneActionLabel(view);
    setSceneState(view, revisionNotes ? 'Rigenerazione fotografica reale richiesta…' : 'Generazione fotografica reale richiesta…', 'pending');
    beginRequest();
    try {
      const result = await labRequest('video-studio-photo', {
        input: generation.input,
        plan: generation.plan,
        receipt: generation.receipt,
        scene_index: view.index,
        revision_notes: revisionNotes || undefined,
        references,
      }, token, 230000);
      assignSceneResult(view,result);
      const tone=result.guide_style_check?.status==='review_light_and_palette'
        ? ' · Guida: luminosità/palette da verificare manualmente'
        : result.guide_style_check ? ' · Guida: tono cromatico preliminarmente coerente' : '';
      setSceneState(view, `Generata · ${result.provider}${tone} · Anteprima browser non persistente, da revisionare.`, 'success');
      updateSceneActionLabel(view);
      showPreview(previewIndex || view.index);
    } catch (e) {
      view.error = e.message;
      if (!view.result) view.image.hidden = true;
      failure = e;
      setSceneState(view, `BLOCCATO: ${e.message}${view.result ? ' · La foto precedente è stata conservata.' : ''}`, 'error');
      updateSceneActionLabel(view);
    } finally {
      view.running = false;
      endRequest();
      updateProgress();
    }
    return failure;
  }
  async function autoGeneratePhotos(token) {
    batchRunning = true;
    syncControls();
    updateProgress();
    try {
      for (const view of sceneViews) {
        if(view.result)continue;
        const error = await requestPhoto(view, token, '');
        // Avoid repeated charged attempts when the service or credentials fail.
        if (error) {
          sceneViews.filter(candidate => candidate.attempts === 0).forEach(candidate => {
            setSceneState(candidate, 'Non generata: procedura interrotta dopo un errore. Puoi riprovare da qui.', 'pending');
          });
          break;
        }
      }
    } finally {
      batchRunning = false;
      syncControls();
      updateProgress();
    }
    const ready = sceneViews.filter(view => view.result).length;
    const blocked = sceneViews.filter(view => !view.result).length;
    if (blocked === 0) {
      message('Storyboard AI e 4 fotografie generate automaticamente. Rivedi ogni scena e rigenera solo quelle che non ti convincono.');
    } else {
      message(`Storyboard AI generato. Foto pronte: ${ready}/4. Generazione automatica interrotta per evitare richieste inutili: correggi l’errore e riprova sulle scene mancanti.`, true);
    }
  }
  async function generateCreative() {
    if (!brief || busy()) return;
    resetGeneratedOutput();
    message('Richiesta inviata al motore creativo reale. Avvio storyboard AI e foto automatiche.');
    beginRequest();
    try {
      const token = await requireEditor();
      const data = {platform: brief.input.platform, suggestions: brief.input.suggestions};
      if(brief.mode==='article')data.article_id=brief.input.article.id;
      else if(brief.mode==='image') {
        data.guide_image_base64=await fileToJpeg(guideFile,{width:768,height:768,maxBytes:110000,preserveAspect:true});
        data.guide_usage=brief.input.guide_usage;
        data.guide_fidelity=brief.input.guide_fidelity;
        data.guide_context=brief.input.guide_context;
      } else data.theme=brief.input.theme;
      generation = await labRequest('video-studio-storyboard', data, token, 110000);
      if (generation?.plan?.scenes?.length !== 4) throw Error('Storyboard generato non valido.');
      realSummary.append(
        textElement('p', `Concept: ${generation.plan.concept}`),
        textElement('p', `Pubblico: ${generation.plan.audience}`),
        ...(generation.input.input_type==='guide_image'?[textElement('p', `Guida fotografica: ${generation.input.guide_fidelity==='strong'?'Aderenza forte':'Ispirazione libera'}`)]:[]),
        textElement('p', `Avvertenza editoriale: ${generation.plan.editorial_caution}`),
      );
      createProgressAndPreview();
      sceneViews = generation.plan.scenes.map((scene, index) => createSceneCard(scene, index));
      realSection.hidden = false;
      updateProgress();
      message('Storyboard AI generato. Preparazione fotografie, una scena alla volta…');
      if(brief.mode==='image' && brief.input.guide_usage==='first_scene') {
        const ok=await uploadScenePhoto(sceneViews[0],guideFile,{fromGuide:true});
        if(!ok)throw Error('La prima foto guida non è stata acquisita: correggi il file prima di continuare.');
      }
      await autoGeneratePhotos(token);
    } catch (e) {
      if (!generation) resetGeneratedOutput(); // preserve already-generated photos if possible
      message(`Generazione non riuscita: ${e.message}`, true);
    } finally {
      endRequest();
    }
  }
  function download() {
    if (!brief) return;
    const bytes = JSON.stringify(brief, null, 2) + '\n';
    const blob = new Blob([bytes], {type: 'application/json'});
    const localUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = localUrl;
    anchor.download = 'video-studio-input.json';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(localUrl), 1000);
  }

  // A project file stores the four complete JPEG previews and independent Canvas layers.
  // Signed references are bound to the authenticated owner. Neither credentials nor MP3
  // bytes are included. This is a browser draft, not a server publication or master.
  function projectOwner() {return getSession()?.user?.id || null;}
  function isBase64Image(value,maxChars=9_000_000) {
    return typeof value==='string' && value.length>1000 && value.length<=maxChars &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(value);
  }
  function isValidProject(data) {
    if(!data || data.schema!==PROJECT_SCHEMA || data.owner_id!==projectOwner() ||
      !data.generation?.plan?.scenes || data.generation.plan.scenes.length!==4 ||
      !data.generation?.input || !data.generation?.receipt?.signature ||
      !data.brief?.input || !Array.isArray(data.scenes) || data.scenes.length!==4 ||
      typeof data.generation.receipt.expiresAt!=='number') return false;
    return data.scenes.every((scene,i)=>scene?.index===i && (!scene.result ||
      (scene.result.preview_mime==='image/jpeg' && isBase64Image(scene.result.preview_base64) &&
        scene.result.continuity_reference?.scene_index===i)));
  }
  function snapshotProject() {
    if(!generation || sceneViews.length!==4 || !projectOwner())
      throw Error('Genera prima uno storyboard per salvare un progetto completo.');
    const projects = sceneViews.map(view=>({index:view.index,
      result:view.result ? {preview_mime:view.result.preview_mime,preview_base64:view.result.preview_base64,
        continuity_reference:view.result.continuity_reference,provider:view.result.provider,
        prompt:String(view.result.prompt||'').slice(0,7000),guide_style_check:view.result.guide_style_check||null} : null,
      textDesign:view.textDesign||null,
      layoutPreference:view.layoutPreference,
      notes:String(view.notesInput.value||'').slice(0,700),attempts:view.attempts}));
    return {schema:PROJECT_SCHEMA, saved_at:new Date().toISOString(), owner_id:projectOwner(),
      brief, generation:{input:generation.input,plan:generation.plan,receipt:generation.receipt,
        guide_reference:generation.guide_reference||null}, scenes:projects,
      active_scene:previewIndex,
      music_choice:previewView?.musicChoice?.value||'auto',
      product_scene:previewView?.productChoice?.value||'2',
      // A verified screenshot must be re-confirmed by the editor on reopen.
      product_file_name:verifiedProductScreen?.file?.name||''};
  }
  function projectDbOperation(mode,execute) {
    if(!window.indexedDB)return Promise.reject(Error('archiviazione browser non disponibile'));
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(PROJECT_DB_NAME,1);
      req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(PROJECT_STORE))
        req.result.createObjectStore(PROJECT_STORE,{keyPath:'owner_id'});};
      req.onerror=()=>reject(req.error||Error('memoria locale non disponibile'));
      req.onblocked=()=>reject(Error('Archivio bloccato da un’altra scheda.'));
      req.onsuccess=()=>{
        const db=req.result;
        let result;
        try {
          const tx=db.transaction(PROJECT_STORE,mode);
          const op=execute(tx.objectStore(PROJECT_STORE));
          op.onsuccess=()=>{result=op.result;};
          tx.oncomplete=()=>{db.close();resolve(result);};
          tx.onerror=()=>{db.close();reject(tx.error||Error('Impossibile salvare il progetto.'));};
          tx.onabort=()=>{db.close();reject(tx.error||Error('Spazio locale insufficiente.'));};
        }catch(e){db.close();reject(e);}
      };
    });
  }
  function projectMessage(value,error=false){
    if(projectStatus){projectStatus.textContent=value;projectStatus.dataset.tone=error?'error':'success';}
  }
  async function saveProjectLocally({silent=false}={}) {
    const project=snapshotProject();
    const text=JSON.stringify(project);
    if(text.length>MAX_PROJECT_BYTES)throw Error('Il progetto supera il limite di 32 MB. Esporta una copia o riduci le immagini.');
    await projectDbOperation('readwrite',store=>store.put(project));
    localProjectActive=true;
    if(!silent)projectMessage('Progetto salvato su questo dispositivo. Puoi chiudere e riaprire la Redazione.');
  }
  function scheduleProjectAutosave(){
    if(!localProjectActive || !generation || !sceneViews.length)return;
    clearTimeout(autoSaveTimer);
    autoSaveTimer=setTimeout(()=>{
      if(busy()) {scheduleProjectAutosave();return;}
      saveProjectLocally({silent:true}).catch(error=>projectMessage(`Salvataggio automatico non riuscito: ${error.message}`,true));
    },1100);
  }
  function downloadProject() {
    const project=snapshotProject();
    const contents=JSON.stringify(project);
    if(contents.length>MAX_PROJECT_BYTES)throw Error('Progetto troppo grande per il file JSON (32 MB).');
    const data=new Blob([contents],{type:'application/json'});
    const link=document.createElement('a'),temp=URL.createObjectURL(data);
    link.href=temp;link.download=`OffertaLogica-Reel-Progetto-${new Date().toISOString().slice(0,10)}.json`;
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(temp),30000);
    projectMessage('Copia completa scaricata: conserva il file JSON per riprendere anche su un altro dispositivo.');
  }
  async function renewStoryboardReceiptIfNeeded(token){
    if(!generation || generation.receipt?.expiresAt>Date.now()+30000)return;
    // Renewal checks the old server signature and editor identity; it performs no AI call.
    const response=await labRequest('video-studio-resume',{
      input:generation.input,plan:generation.plan,receipt:generation.receipt,
      guide_reference:generation.guide_reference||null,
      scene_references:sceneViews.map(view=>view.result?.continuity_reference||null),
    },token,35000);
    generation.receipt=response.receipt;
    generation.guide_reference=response.guide_reference||null;
    sceneViews.forEach((view,i)=>{
      if(view.result && response.scene_references?.[i])
        view.result.continuity_reference=response.scene_references[i];
    });
    scheduleProjectAutosave();
  }
  async function restoreProject(project) {
    if(busy())throw Error('Termina prima le operazioni in corso.');
    if(!isValidProject(project))throw Error('Progetto incompatibile, alterato o appartenente a un altro account.');
    // Pre-validate the images before discarding the currently open draft.
    const testSources=project.scenes.filter(scene=>scene.result).map(scene=>
      `data:${scene.result.preview_mime};base64,${scene.result.preview_base64}`);
    await Promise.all(testSources.map(src=>new Promise((resolve,reject)=>{
      const img=new Image();img.onload=()=>img.naturalWidth>0?resolve():reject(Error('Fotografia non valida'));
      img.onerror=()=>reject(Error('Fotografia non leggibile'));img.src=src;
    })));
    stopPreview();resetGeneratedOutput();
    brief=project.brief;
    generation=project.generation;
    if(brief.mode==='image') {
      // The original uploaded file may no longer exist. A signed guide thumbnail is
      // already persisted in generation.guide_reference for future derived scenes.
      guideFile=null;
    }
    setSummary(brief);
    downloadButton.disabled=false;generateButton.disabled=false;
    realSummary.append(textElement('p',`Concept: ${generation.plan.concept}`),
      textElement('p',`Pubblico: ${generation.plan.audience}`),
      textElement('p',`Avvertenza editoriale: ${generation.plan.editorial_caution}`));
    createProgressAndPreview();
    sceneViews=generation.plan.scenes.map((scene,i)=>createSceneCard(scene,i));
    realSection.hidden=false;
    for(const saved of project.scenes) {
      const view=sceneViews[saved.index];
      view.attempts=Math.max(0,Math.min(50,Number(saved.attempts)||0));
      view.layoutPreference=['auto','manual','top','left','right','bottom'].includes(saved.layoutPreference)?saved.layoutPreference:'auto';
      view.layoutSelect.value=view.layoutPreference;
      view.notesInput.value=String(saved.notes||'').slice(0,700);
      if(saved.textDesign && typeof saved.textDesign==='object')view.textDesign=saved.textDesign;
      if(saved.result){
        assignSceneResult(view,saved.result);
        setSceneState(view,'Fotografia recuperata dal progetto salvato.','success');
      }
      updateSceneActionLabel(view);
    }
    previewIndex=Math.max(0,Math.min(3,Number(project.active_scene)||0));
    updateProgress();showPreview(previewIndex);
    // Music is linked by a catalogue selection, not embedded in the portable draft.
    // Local audio on another device must be provided again by its owner.
    await restoreMusicLibrary();
    if(previewView){
      const stored=String(project.music_choice||'none');
      previewView.musicChoice.value=[...previewView.musicChoice.options].some(opt=>opt.value===stored)?stored:'none';
      await applyMusicChoice();
      previewView.productChoice.value=['0','1','2','3'].includes(String(project.product_scene))?String(project.product_scene):'2';
    }
    localProjectActive=true;
    projectMessage('Progetto ripreso: scene, fotografie, testi e logo recuperati. Per nuovi render AI può essere necessario rinnovare la ricevuta.');
    message('Bozza recuperata. La musica personale e l’eventuale screenshot OffertaLogica vanno riassociati e riconfermati.');
    scheduleProjectAutosave();
  }
  function createProjectToolbar(){
    if(projectToolbar)return;
    projectToolbar=document.createElement('section');projectToolbar.className='ol-vs-project-toolbar';
    projectToolbar.append(textElement('h4','Salva e riprendi il progetto'));
    const controls=document.createElement('div');controls.className='ol-toolbar-group';
    function button(title,click){
      const b=document.createElement('button');b.type='button';b.className='ol-button ol-button-secondary ol-button-small';
      b.textContent=title;b.addEventListener('click',async()=>{
        try{await click();}catch(error){projectMessage(error.message,true);}
      });controls.append(b);return b;
    }
    projectSaveButton=button('Salva sul dispositivo',()=>saveProjectLocally());
    projectExportButton=button('Scarica progetto (.json)',downloadProject);
    projectResumeButton=button('Riprendi ultima bozza',async()=>{
      const project=await projectDbOperation('readonly',store=>store.get(projectOwner()));
      if(!project)throw Error('Nessun progetto salvato per questo account sul dispositivo.');
      if(generation && !confirm('Aprire il progetto salvato e sostituire il lavoro corrente?'))return;
      await restoreProject(project);
    });
    const fileLabel=document.createElement('label');fileLabel.className='ol-button ol-button-secondary ol-button-small';
    fileLabel.textContent='Apri progetto da file';
    projectImportInput=document.createElement('input');projectImportInput.type='file';
    projectImportInput.accept='.json,application/json';
    projectImportInput.setAttribute('aria-label','Apri file progetto Video Studio');
    projectImportInput.style.position='absolute';projectImportInput.style.opacity='0';
    projectImportInput.style.width='1px';projectImportInput.style.height='1px';
    projectImportInput.addEventListener('change',async()=>{
      try{
        const file=projectImportInput.files?.[0];if(!file)return;
        if(file.size>MAX_PROJECT_BYTES)throw Error('Progetto troppo grande (massimo 32 MB).');
        const data=JSON.parse(await file.text());
        if(generation && !confirm('Aprire il file e sostituire il lavoro corrente?'))return;
        await restoreProject(data);
      }catch(e){projectMessage(e.message,true);}finally{projectImportInput.value='';}
    });
    fileLabel.append(projectImportInput);controls.append(fileLabel);
    projectStatus=document.createElement('p');projectStatus.className='ol-muted ol-small';
    projectStatus.setAttribute('role','status');
    projectStatus.textContent='Salva una bozza completa sul dispositivo oppure scarica un file JSON. Nessuna pubblicazione.';
    projectToolbar.append(controls,projectStatus);
    form.insertAdjacentElement('afterend',projectToolbar);
    syncControls();
  }

  form.addEventListener('submit', prepare);
  root.querySelectorAll('[name="vs-source"]').forEach(radio => radio.addEventListener('change', changeSource));
  form.querySelectorAll('input,select,textarea').forEach(field => field.addEventListener('input', clearBrief));
  refreshButton.addEventListener('click', async () => {
    clearBrief();
    try { await loadArticles(await requireEditor()); } catch (e) { message(e.message, true); }
  });
  downloadButton.addEventListener('click', download);
  generateButton.addEventListener('click', generateCreative);
  root.addEventListener('toggle', () => { if (root.open) initialize(); else stopPreview(); });
  document.querySelector('[href="#editorial-video-studio"]')?.addEventListener('click', () => {
    root.open = true;
    initialize();
  });
  changeSource();
  createProjectToolbar();
})();
