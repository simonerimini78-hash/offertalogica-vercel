/* Video Studio v1.1.9 — isolated guide-image storyboard and manual per-scene image imports. */
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
    if (previewView?.playButton) previewView.playButton.disabled = availablePreviewIndices().length !== 4 || isBusy || musicLoading;
    if (previewView?.exportButton) previewView.exportButton.disabled = availablePreviewIndices().length !== 4 || isBusy || musicLoading;
    if (previewView?.musicInput) previewView.musicInput.disabled = isBusy;
    if (previewView?.musicChoice) previewView.musicChoice.disabled = isBusy || musicLoading;
    if (previewView?.musicClear) previewView.musicClear.disabled = isBusy || !localTracks.length;
    if (previewView?.productInput) previewView.productInput.disabled = isBusy;
    if (previewView?.productChoice) previewView.productChoice.disabled = isBusy;
    if (previewView?.productConfirmed) previewView.productConfirmed.disabled = isBusy || !verifiedProductScreen;
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
  async function fileToJpeg(file,{width,height,maxBytes,cover=false}={}) {
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
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d',{alpha:false});
      if(!ctx)throw Error('Impossibile elaborare la fotografia nel browser.');
      ctx.fillStyle='#eeeeea';ctx.fillRect(0,0,width,height);
      const scale=cover?Math.max(width/image.naturalWidth,height/image.naturalHeight):
        Math.min(width/image.naturalWidth,height/image.naturalHeight);
      const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
      ctx.drawImage(image,(width-w)/2,(height-h)/2,w,h);
      for(const quality of [0.84,0.76,0.66,0.54,0.40,0.30]) {
        const base64=canvas.toDataURL('image/jpeg',quality).split(',')[1];
        if(Math.floor(base64.length*3/4)<=maxBytes)return base64;
      }
      throw Error('La foto è troppo complessa per il limite di caricamento; prova un file più leggero.');
    } finally {URL.revokeObjectURL(src);}
  }
  async function uploadScenePhoto(view,file,{fromGuide=false}={}) {
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
        base={theme:null,article:null,guide_context:context,guide_usage:guideMode.value,guide_file_name:guideFile.name};
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
      drawCinematicOverlay(ctx, sceneViews[segment.index]);
    }
    // Thin timeline belongs to the editing PREVIEW only, not the exported video.
    if (!exporting) {
      ctx.fillStyle = '#38b66e';
      ctx.fillRect(0, MONTAGE_HEIGHT - 8, MONTAGE_WIDTH * (t / MONTAGE_DURATION), 8);
    }
    previewView.meta.textContent = `Scena ${segment.index + 1}/${sceneViews.length} · ${t.toFixed(1)} / 15.0 s · ${soundtrackUrl ? 'musica' : 'senza musica'} · Bozza 1080×1920`;
  }
  function showPreview(index) {
    if (!previewView) return;
    const available = availablePreviewIndices();
    previewView.playButton.disabled = available.length !== 4 || busy();
    const scene = available.length ? (available.includes(index) ? index : available[0]) : 0;
    const t = sceneViews.slice(0, scene).reduce((sum, item) => sum + (Number(item.scene.duration_ms) || 0), 0) / 1000;
    if (!previewPlaying) renderMontageFrame(t);
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
      textElement('p', 'Fotografie a tutto schermo, testi liberi e sfumature morbide (senza riquadri). Verifica che testi e logo non coprano il soggetto; puoi correggere il lato scena per scena.'),
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
    stage.append(previewView.canvas);

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
    previewView.musicChoice.addEventListener('change', () => { applyMusicChoice(); });
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
    previewView.productChoice.addEventListener('change', () => showPreview(Number(previewView.productChoice.value)));
    screenSceneLabel.append(previewView.productChoice);
    const confirmLabel = document.createElement('label');
    previewView.productConfirmed.type = 'checkbox';
    previewView.productConfirmed.disabled = true;
    previewView.productConfirmed.addEventListener('change', () => showPreview(Number(previewView.productChoice.value)));
    confirmLabel.append(previewView.productConfirmed,
      document.createTextNode(' Confermo che questa è una schermata autentica e attuale del servizio'));
    previewView.productHelp.className = 'ol-muted ol-small';
    previewView.productHelp.textContent = 'Carica solo schermate effettive del servizio, senza dati personali. Le immagini AI non attestano l’autenticità dell’interfaccia.';
    productRow.append(screenLabel, screenSceneLabel, confirmLabel, previewView.productHelp);
    previewView.box.append(previewHeader, stage, musicRow, productRow, previewView.meta);
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
    for (const [value, label] of [['auto','Automatica (lato libero della scena)'],['top','In alto'],
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
      prompt,
      promptBody,
      attempts: 0,
      result: null,
      error: '',
      running: false,
    };
    layoutSelect.addEventListener('change', () => {
      if (exporting) return;
      view.layoutPreference = layoutSelect.value;
      view._compositionKey = null;
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
    // Scene 1 defines identity; every later scene needs an authentic frame from THIS storyboard.
    const previous=sceneViews.slice(0,view.index);
    if(previous.some(frame=>!frame.result?.continuity_reference))
      throw Error('Genera prima le scene precedenti per garantire la continuità visiva.');
    const references=view.index===0?(generation.guide_reference?[generation.guide_reference]:[]):view.index===1?
      [previous[0].result.continuity_reference]:
      [previous[0].result.continuity_reference,previous[previous.length-1].result.continuity_reference];
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
      setSceneState(view, `Generata · ${result.provider} · Anteprima browser non persistente, da revisionare.`, 'success');
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
        data.guide_image_base64=await fileToJpeg(guideFile,{width:512,height:512,maxBytes:110000});
        data.guide_usage=brief.input.guide_usage;
        data.guide_context=brief.input.guide_context;
      } else data.theme=brief.input.theme;
      generation = await labRequest('video-studio-storyboard', data, token, 110000);
      if (generation?.plan?.scenes?.length !== 4) throw Error('Storyboard generato non valido.');
      realSummary.append(
        textElement('p', `Concept: ${generation.plan.concept}`),
        textElement('p', `Pubblico: ${generation.plan.audience}`),
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
})();
