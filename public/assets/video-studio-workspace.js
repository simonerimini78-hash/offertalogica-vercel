/* Video Studio v1.3.3.20 — experimental AI poster images with embedded type; legacy compositor retained. */
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
  const videoGuideWrap = qs('[data-vs-video-wrap]');
  const videoGuideInput = qs('#vs-editorial-video-guide');
  const videoGuideFidelity = qs('#vs-editorial-video-fidelity');
  const videoGuideContext = qs('#vs-editorial-video-context');
  const sceneCountSelect = qs('#vs-editorial-scene-count');
  const integratedTextChoice = qs('#vs-editorial-integrated-text');
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
  let videoGuideFile = null;
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
  const POSTER_NOTE_PREFIX = '[OL_VIDEO_STUDIO_POSTER_V1]';
  const isIntegratedPoster = view => view?.scene?.role!=='cta' && view?.result?.image_mode==='poster';
  const validSceneCount = n => Number.isInteger(n) && n>=3 && n<=5;
  const plannedSceneCount = () => generation?.plan?.scenes?.length || 0;
  const photosReady = () => validSceneCount(plannedSceneCount()) &&
    availablePreviewIndices().length===plannedSceneCount();
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
    videoGuideWrap.hidden = mode!=='video';
    themeInput.required = mode==='theme';
    articleSelect.required = mode==='article';
    guideInput.required = mode==='image';
    videoGuideInput.required = mode==='video';
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
      if(view.posterInput)view.posterInput.disabled=isBusy;
      if(view.posterVerifyInput)view.posterVerifyInput.disabled=isBusy || !isIntegratedPoster(view);
      if(view.layoutSelect)view.layoutSelect.disabled=isBusy || isIntegratedPoster(view);
    });
    if (projectSaveButton) projectSaveButton.disabled = !generation || isBusy;
    if (projectExportButton) projectExportButton.disabled = !generation || isBusy;
    if (projectResumeButton) projectResumeButton.disabled = isBusy;
    if (projectImportInput) projectImportInput.disabled = isBusy;
    if (previewView?.playButton) previewView.playButton.disabled = !photosReady() || isBusy || musicLoading;
    if (previewView?.exportButton) previewView.exportButton.disabled = !photosReady() || isBusy || musicLoading;
    if (previewView?.musicInput) previewView.musicInput.disabled = isBusy;
    if (previewView?.musicChoice) previewView.musicChoice.disabled = isBusy || musicLoading;
    if (previewView?.musicClear) previewView.musicClear.disabled = isBusy || !localTracks.length;
    if (previewView?.productInput) previewView.productInput.disabled = isBusy;
    if (previewView?.productChoice) previewView.productChoice.disabled = isBusy;
    if (previewView?.productConfirmed) previewView.productConfirmed.disabled = isBusy || !verifiedProductScreen;
    if (previewView?.editorMode) {
      const disabled = isBusy || previewPlaying;
      previewView.editorMode.disabled = disabled || isIntegratedPoster(currentTextView());
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
    line('Origine', b.mode === 'article' ? 'Articolo Editoriale pubblicato' : b.mode==='image'?'Immagine guida':b.mode==='video'?'Reel MP4 guida':'Tema libero');
    line('Titolo', b.mode === 'article' ? b.input.article.title : b.mode==='image'?b.input.guide_file_name:b.mode==='video'?b.input.guide_video_file_name:b.input.theme);
    line('Suggerimenti', b.input.suggestions || 'Nessuno');
    line('Destinazione', b.input.platform);
    line('Scene', b.input.scene_count_preference==='auto'?'Automatico (3–5)':`${b.input.scene_count_preference} scene`);
    line('Creatività immagini', b.input.image_mode==='poster'?'Testo già integrato (sperimentale, esclusa CTA)':'Foto + testi Canvas');
    line('Passaggio successivo', 'Storyboard AI con fotografie automatiche da revisionare');
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
  // Sample the entire Reel timeline locally; only bounded stills go to the AI storyboard.
  // This is a VISUAL guide, not audio transcription or complete video-frame analysis.
  async function extractVideoGuideFrames(file) {
    if(!file || !(/\.mp4$/i.test(file.name)) || file.size<1000 || file.size>60*1024*1024)
      throw Error('Seleziona un MP4 valido fino a 60 MB.');
    const url=URL.createObjectURL(file),video=document.createElement('video');
    video.muted=true;video.playsInline=true;video.preload='auto';
    try {
      video.src=url;
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(Error('Impossibile leggere il Reel nel browser.')),20000);
        video.onloadedmetadata=()=>{clearTimeout(timeout);resolve();};
        video.onerror=()=>{clearTimeout(timeout);reject(Error('MP4 non compatibile con questo browser.'));};
        video.load();
      });
      const duration=video.duration;
      if(!Number.isFinite(duration)||duration<1||duration>180||!video.videoWidth||!video.videoHeight)
        throw Error('Il Reel guida deve durare da 1 a 180 secondi e contenere immagini video.');
      const n=Math.min(8,Math.max(5,Math.ceil(duration/3)));
      const canvas=document.createElement('canvas');
      const scale=Math.min(384/video.videoWidth,683/video.videoHeight,1);
      canvas.width=Math.max(1,Math.round(video.videoWidth*scale));
      canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
      const ctx=canvas.getContext('2d',{alpha:false});
      if(!ctx)throw Error('Il browser non consente di leggere i fotogrammi del video.');
      const frames=[],times=[];
      const perFrameBytes=Math.min(55000,Math.floor(380000/n));
      for(let i=0;i<n;i++){
        const time=duration*(i+0.5)/n;
        await new Promise((resolve,reject)=>{
          const timeout=setTimeout(()=>reject(Error(`Impossibile leggere il fotogramma ${i+1}.`)),16000);
          video.onseeked=()=>{clearTimeout(timeout);resolve();};
          video.onerror=()=>{clearTimeout(timeout);reject(Error('Errore durante la lettura del Reel.'));};
          video.currentTime=time;
        });
        ctx.drawImage(video,0,0,canvas.width,canvas.height);
        let jpg='';
        for(const quality of [0.72,0.60,0.48,0.36,0.26,0.18]){
          jpg=canvas.toDataURL('image/jpeg',quality).split(',')[1];
          if(jpg.length<=Math.ceil(perFrameBytes*4/3))break;
        }
        if(jpg.length>Math.ceil(perFrameBytes*4/3))throw Error('Fotogrammi guida troppo grandi; usa un MP4 meno complesso.');
        frames.push(jpg);
        times.push(Math.round(time*1000));
      }
      return {frames,durationMs:Math.round(duration*1000),times};
    }finally{
      video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);
    }
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
        later._faceBoxes=null;later.error='';later.posterVerified=false;
        if(later.posterVerifyInput)later.posterVerifyInput.checked=false;
        if(later.posterVerifyWrap)later.posterVerifyWrap.hidden=true;
        if(later.layoutSelect)later.layoutSelect.disabled=false;
        setSceneState(later,'Scena precedente cambiata: rigenera o carica questa fotografia.','pending');
        updateSceneActionLabel(later);
      }
      message('Scena sostituita: le successive vanno aggiornate per garantire la continuità.');
    }
    if(view.result && manual && sceneViews.slice(view.index+1).some(later=>later.result))
      message('Foto sostituita: le altre scene sono conservate. Verifica la continuità visiva prima di esportare.');
    view.result=result;view._imageEpoch=(view._imageEpoch||0)+1;
    view.posterVerified=false;
    if(view.posterVerifyInput)view.posterVerifyInput.checked=false;
    if(view.posterVerifyWrap)view.posterVerifyWrap.hidden=!isIntegratedPoster(view);
    if(isIntegratedPoster(view)){
      view.layoutPreference='auto';
      if(view.layoutSelect)view.layoutSelect.value='auto';
    }
    if(view.layoutSelect)view.layoutSelect.disabled=isIntegratedPoster(view)||busy();
    view._compositionKey=null;view._salienceImage=null;view._faceBoxes=null;
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
      } else if(mode==='video') {
        if(!videoGuideInput.files?.[0])throw Error('Seleziona il Reel MP4 guida.');
        videoGuideFile=videoGuideInput.files[0];
        if(!/\.mp4$/i.test(videoGuideFile.name)||videoGuideFile.size<1000||videoGuideFile.size>60*1024*1024)
          throw Error('Carica un MP4 valido fino a 60 MB.');
        const context=videoGuideContext.value.trim();
        if(context.length<8 && suggestionsInput.value.trim().length<8)
          throw Error('Specifica l’argomento del nuovo Reel: il MP4 è solo un riferimento di qualità.');
        base={theme:null,article:null,guide_video_file_name:videoGuideFile.name,
          guide_context:context,guide_fidelity:videoGuideFidelity.value};
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
        input: {...base, suggestions, platform: platformSelect.value,scene_count_preference:sceneCountSelect.value==='auto'?'auto':Number(sceneCountSelect.value),
          image_mode:integratedTextChoice?.checked?'poster':'photo'},
        next_step: 'creative_director_requires_protected_server_execution',
        publication_authorized: false,
      };
      setSummary(brief);
      downloadButton.disabled = false;
      generateButton.disabled = false;
      generateButton.textContent=sceneCountSelect.value==='auto'?'Genera storyboard + foto AI':
        `Genera storyboard + ${sceneCountSelect.value} foto AI`;
      message('Brief pronto. Premi «Genera storyboard + foto AI» per avviare il flusso automatico.');
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
    const fragments = [`Foto pronte: ${ready}/${sceneViews.length || 0}`];
    if (pending > 0) fragments.push(`In attesa: ${pending}`);
    if (errors > 0) fragments.push(`Da rigenerare: ${errors}`);
    progressView.count.textContent = fragments.join(' · ');
    progressView.note.textContent = 'Ogni rigenerazione consuma 1 azione AI del limite server (10 azioni/ora per utente admin).';
    syncControls();
  }
  const MONTAGE_WIDTH = 1080;
  const MONTAGE_HEIGHT = 1920;
  const MONTAGE_DURATION = 15;
  // Advisory only: the safe-text rectangle must NEVER constrain manual text/logo placement.
  // The editor may adjust its edges independently; exports always use the 9:16 master.
  const DEFAULT_TEXT_GUIDE = Object.freeze({left:130/MONTAGE_WIDTH, top:420/MONTAGE_HEIGHT,
    right:950/MONTAGE_WIDTH, bottom:1248/MONTAGE_HEIGHT});
  let textGuide = {...DEFAULT_TEXT_GUIDE};
  let textGuideVisible = true;
  const TEXT_GUIDE_MIN_W = 100/MONTAGE_WIDTH;
  const TEXT_GUIDE_MIN_H = 100/MONTAGE_HEIGHT;
  function validTextGuide(box) {
    return box && ['left','right','top','bottom'].every(k=>Number.isFinite(box[k])) &&
      box.left>=0 && box.right<=1 && box.top>=0 && box.bottom<=1 &&
      box.right-box.left>=TEXT_GUIDE_MIN_W && box.bottom-box.top>=TEXT_GUIDE_MIN_H;
  }
  function textGuidePixels() {
    return {x:textGuide.left*MONTAGE_WIDTH,y:textGuide.top*MONTAGE_HEIGHT,
      width:(textGuide.right-textGuide.left)*MONTAGE_WIDTH,
      height:(textGuide.bottom-textGuide.top)*MONTAGE_HEIGHT};
  }
  function drawTextGuide() {
    if(!previewView?.textGuideOverlay)return;
    const rectangle=previewView.textGuideOverlay;
    rectangle.hidden=!textGuideVisible || (previewView.cropChoice?.value||'master')!=='master';
    Object.assign(rectangle.style,{left:`${textGuide.left*100}%`,top:`${textGuide.top*100}%`,
      width:`${(textGuide.right-textGuide.left)*100}%`,
      height:`${(textGuide.bottom-textGuide.top)*100}%`});
  }
  // Each entry is an explicit geometrical simulation. Reels ads UI margins reflect
  // Meta's 14% top / 35% bottom / 6% sides advice; organic overlays may differ.
  const REELS_VISIBLE = Object.freeze({x:65,y:269,width:950,height:979});
  const PREVIEW_CROPS = Object.freeze({
    master:{label:'Originale 9:16 · griglia personalizzabile',x:0,y:0,width:1080,height:1920},
    instagram_reels:{label:'Instagram Reels / Stories · interfaccia',x:0,y:0,width:1080,height:1920,safe:REELS_VISIBLE},
    instagram_feed:{label:'Instagram Feed · ritaglio centrale 4:5',x:0,y:285,width:1080,height:1350},
    instagram_grid:{label:'Instagram Profilo · ritaglio centrale 3:4',x:0,y:240,width:1080,height:1440},
    facebook_reels:{label:'Facebook Reels / Stories · interfaccia',x:0,y:0,width:1080,height:1920,safe:REELS_VISIBLE},
    facebook_feed:{label:'Facebook Feed · ritaglio centrale 4:5',x:0,y:285,width:1080,height:1350},
    facebook_square:{label:'Facebook anteprima quadrata · prova 1:1',x:0,y:420,width:1080,height:1080},
  });
  const MAX_EXTRA_TEXTS = 4;
  const DEFAULT_LOGO = Object.freeze({x:76/MONTAGE_WIDTH,y:1510/MONTAGE_HEIGHT,width:232/MONTAGE_WIDTH});
  const TEXT_FONTS = Object.freeze({
    'system-ui':'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    'Arial':'Arial, Helvetica, sans-serif',
    'Georgia':'Georgia, serif',
    'Trebuchet MS':'"Trebuchet MS", Arial, sans-serif',
    'Verdana':'Verdana, sans-serif',
    'Offerta Sans':'Inter, "Aptos", "Segoe UI", Arial, sans-serif',
    'Offerta Display':'"Arial Black", "Trebuchet MS", "Segoe UI", Arial, sans-serif',
  });
  const DISPLAY_FONT_STACK = TEXT_FONTS['Offerta Display'];
  const BODY_FONT_STACK = TEXT_FONTS['Offerta Sans'];
  const CTA_FONT_STACK = TEXT_FONTS['Offerta Display'];
  const clampNumber = (value,min,max) => Math.max(min,Math.min(max,value));
  function defaultTextStyle(kind) {
    return {font:kind==='subtitle'?'Offerta Sans':'Offerta Display',
      size:kind==='title'?108:kind==='cta'?62:52,weight:kind==='subtitle'?600:800,
      color:'#ffffff',align:'left',background:kind==='cta',bgColor:kind==='cta'?'#207f51':'#152c38',opacity:kind==='cta'?.96:.6,
      padding:16,radius:18,shadow:true};
  }
  function constrainTextBox(box,kind) {
    const minW=kind.startsWith('extra:')?.17:.23,minH=kind==='title'?.085:kind.startsWith('extra:')?.052:.065;
    const width=clampNumber(Number(box?.width)||.5,minW,1);
    const height=clampNumber(Number(box?.height)||.12,minH,1);
    const x=Number(box?.x),y=Number(box?.y);
    // Bound only to the physical video frame, NOT to the advisory text guide.
    return {x:clampNumber(Number.isFinite(x)?x:DEFAULT_TEXT_GUIDE.left,0,1-width),
      y:clampNumber(Number.isFinite(y)?y:DEFAULT_TEXT_GUIDE.top,0,1-height),width,height};
  }
  function logoAspect() {
    const image=transparentBrandLogo() || previewView?.logo;
    return image?.naturalWidth || image?.width
      ? (image.naturalHeight || image.height)/(image.naturalWidth || image.width) : 353/640;
  }
  function constrainLogoBox(box) {
    const width=clampNumber(Number(box?.width)||DEFAULT_LOGO.width,.09,.50);
    const height=width*(MONTAGE_WIDTH/MONTAGE_HEIGHT)*logoAspect();
    return {x:clampNumber(Number.isFinite(Number(box?.x))?Number(box.x):DEFAULT_LOGO.x,0,1-width),
      y:clampNumber(Number.isFinite(Number(box?.y))?Number(box.y):DEFAULT_LOGO.y,0,1-height),width,height};
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
    if(kind==='cta')return 'VISITA IL SITO';
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
    const secondaryY=Number.isFinite(auto?.copy?.detailY)?auto.copy.detailY:titleY+titleH+33;
    const secondaryX=Number.isFinite(auto?.copy?.detailX)?auto.copy.detailX:choice.x;
    return (view.textDesign={
      title:{box:constrainTextBox({x:choice.x/MONTAGE_WIDTH,y:titleY/MONTAGE_HEIGHT,
        width:choice.width/MONTAGE_WIDTH,height:Math.max(150,titleH+22)/MONTAGE_HEIGHT},'title'),
        style:defaultTextStyle('title')},
      subtitle:{box:constrainTextBox({x:secondaryX/MONTAGE_WIDTH,y:secondaryY/MONTAGE_HEIGHT,
        width:Math.min(.8,Math.max(.30,(auto?.copy?.detailWidth||choice.width)/MONTAGE_WIDTH+.04)),
        height:Math.max(.075,(auto?.detailBox?.height||145)/MONTAGE_HEIGHT)},'subtitle'),
        style:defaultTextStyle('subtitle')},
      ...(view.scene.role==='cta'?{cta:{box:constrainTextBox({x:choice.x/MONTAGE_WIDTH,
        y:(auto?.footerY||950)/MONTAGE_HEIGHT,width:choice.width/MONTAGE_WIDTH,
        height:(auto?.actionHeight||142)/MONTAGE_HEIGHT},'cta'),
        style:defaultTextStyle('cta')}}:{}),
      extras:[],logo:view.scene.role==='cta'&&auto?{visible:true,opacity:1,
        box:constrainLogoBox({x:auto.logo.x/MONTAGE_WIDTH,y:auto.logo.y/MONTAGE_HEIGHT,
          width:auto.logo.width/MONTAGE_WIDTH})}:newLogoLayer(),
    });
  }
  function currentTextView() { return sceneViews[previewIndex] || null; }
  function sceneIsManuallyEditable(view) {
    return !!(view && !isIntegratedPoster(view) && view.layoutPreference==='manual' && (previewView?.cropChoice?.value||'master')==='master' && !productScreenActive(view.index) &&
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
    const guided=view?.scene?.art_direction?.placement;
    if(['top','bottom','left','right'].includes(guided)) return guided;
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
      const rgb = new Uint8Array(108*192*3);
      for (let y=0; y<192; y++) for (let x=0; x<108; x++) {
        const i=y*108+x, j=i*4;
        const r=data[j], g=data[j+1], b=data[j+2];
        rgb[i*3]=r;rgb[i*3+1]=g;rgb[i*3+2]=b;
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
      view._salience = {mass,lum,rgb};
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
  // FaceDetector is not available in every browser. When no confirmed face rectangles
  // exist, reserve a conservative PORTRAIT zone using the storyboard's subject-side
  // hint; this is an exclusion estimate, NOT a detected face. Keeping these separate
  // prevents a noisy pixel heuristic from being represented as a real detection.
  function protectedPortraits(view) {
    if (Array.isArray(view._faceBoxes) && view._faceBoxes.length) return view._faceBoxes.map(face=>({
      x:face.x-face.width*.20,y:face.y-face.height*.24,
      width:face.width*1.40,height:face.height*1.48,confirmed:true
    }));
    const description=[view.scene?.subject_description,view.scene?.visual_brief,
      view.scene?.shot_type].filter(Boolean).join(' ');
    if(!/\b(?:uomo|donna|persona|persone|viso|volto|ritratto|artigian\w*|imprenditor\w*|lavorator\w*|consulent\w*|cliente|professionist\w*|operai\w*|man|woman|person|people|portrait|face|worker|customer|owner)\b/iu.test(description))
      return [];
    const side=view.scene?.subject_side;
    if(side==='left')return [{x:38,y:270,width:535,height:700,estimated:true}];
    if(side==='right')return [{x:507,y:270,width:535,height:700,estimated:true}];
    return [{x:245,y:270,width:590,height:700,estimated:true}];
  }
  function facesOverlap(rect,faces,padding=0) {
    return faces.reduce((sum,face)=>sum+overlapArea(rect,{x:face.x-padding,y:face.y-padding,
      width:face.width+padding*2,height:face.height+padding*2}),0);
  }
  function insideRect(rect,zone) {
    return rect.x>=zone.x-1&&rect.y>=zone.y-1&&
      rect.x+rect.width<=zone.x+zone.width+1&&
      rect.y+rect.height<=zone.y+zone.height+1;
  }
  function unionRects(rects) {
    const minX=Math.min(...rects.map(r=>r.x)),minY=Math.min(...rects.map(r=>r.y));
    return {x:minX,y:minY,width:Math.max(...rects.map(r=>r.x+r.width))-minX,
      height:Math.max(...rects.map(r=>r.y+r.height))-minY};
  }
  // The guide's art direction selects a typographic language; the actual scene photo
  // decides legible colors. All families have local fallbacks (no external font request).
  function sceneTypeStyle(view) {
    const art=view.scene?.art_direction;
    let mode=view.scene?.text_design?.font_mood||art?.typography;
    if(!['clean','accent_rule','editorial_panel'].includes(mode)) {
      const photo=photoSalience(view);
      let warm=0,samples=0;
      if(photo?.rgb)for(let i=0;i<photo.rgb.length;i+=147) {
        warm+=photo.rgb[i]-photo.rgb[i+2];samples++;
      }
      mode=samples && warm/samples>24?'editorial_panel':'clean';
    }
    // Headlines act as the visual hook, not as small editorial captions. A consistent
    // heavy sans display voice keeps the words clear in a 360–393px mobile preview.
    // Editorial serif remains an intentional variant, never an italic default support.
    if(mode==='editorial_panel')return {mode,titleFamily:'Georgia, "Times New Roman", serif',
      titleWeight:900,detailFamily:BODY_FONT_STACK,detailWeight:800,
      detailItalic:false,detailIndent:0};
    if(mode==='accent_rule')return {mode,titleFamily:'"Arial Black", "Trebuchet MS", Arial, sans-serif',
      titleWeight:900,detailFamily:BODY_FONT_STACK,detailWeight:800,
      detailItalic:false,detailIndent:0};
    return {mode,titleFamily:'"Arial Black", "Trebuchet MS", "Segoe UI", Arial, sans-serif',
      titleWeight:900,detailFamily:BODY_FONT_STACK,detailWeight:800,
      detailItalic:false,detailIndent:0};
  }
  function headlineHorizontalScale(type) { return type.mode==='editorial_panel'?.94:.87; }
  function sceneFont(type,size,detail=false) {
    return detail?`${type.detailItalic?'italic ':''}${type.detailWeight} ${size}px ${type.detailFamily}`:
      `${type.titleWeight} ${size}px ${type.titleFamily}`;
  }
  function samplePhotoBrightness(view,rect) {
    const photo=photoSalience(view);
    if(!photo?.rgb)return null;
    const x0=Math.max(0,Math.floor(rect.x/10)),x1=Math.min(108,Math.ceil((rect.x+rect.width)/10));
    const y0=Math.max(0,Math.floor(rect.y/10)),y1=Math.min(192,Math.ceil((rect.y+rect.height)/10));
    let sum=0,count=0,bright=0;
    for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2) {
      const i=(y*108+x)*3;
      const lum=(.2126*photo.rgb[i]+.7152*photo.rgb[i+1]+.0722*photo.rgb[i+2])/255;
      sum+=lum;bright+=lum>=.55?1:0;count++;
    }
    return count?{mean:sum/count,brightShare:bright/count}:null;
  }
  function photoTextPalette(view,composition) {
    const {choice,copy,y}=composition;
    const titleArea=composition.titleBox||{x:choice.x,y,
      width:Math.min(choice.width,copy.titleWidth+12),height:copy.titleHeight};
    const detailArea=composition.detailBox||{x:choice.x+copy.detailIndent,
      y:y+copy.titleHeight+copy.gap,width:Math.min(choice.width-copy.detailIndent,copy.detailWidth+12),
      height:Math.max(copy.detailSize,copy.textHeight-copy.titleHeight-copy.gap)};
    const titleLight=samplePhotoBrightness(view,titleArea);
    const detailLight=copy.detail.length?samplePhotoBrightness(view,detailArea):titleLight;
    const dark=(tone)=>tone?.mean>=.54 || (tone?.mean>=.46&&tone?.brightShare>=.7);
    const titleDark=dark(titleLight);
    const detailDark=dark(detailLight);
    const green=String(view.scene.art_direction?.accent_color||'');
    const accent=/^#[0-9a-fA-F]{6}$/.test(green)?green:'#23845b';
    // Dark type on light photography; warm white on dark photography.
    // The support line is differentiated without forcing it to be tiny.
    return {title:titleDark?'#183039':'#fff9ef',
      detail:detailDark?'#205943':'#e3f0da',
      titleOutline:titleDark?'rgba(255,250,242,.70)':'rgba(4,15,24,.77)',
      detailOutline:detailDark?'rgba(255,250,242,.65)':'rgba(4,15,24,.72)',
      titleShadow:titleDark?'rgba(255,255,255,.18)':'rgba(0,0,0,.56)',
      detailShadow:detailDark?'rgba(255,255,255,.16)':'rgba(0,0,0,.50)',accent};
  }
  // Measure all words before placing them. The automatic compositor NEVER emits ellipses.
  // Balancing the lines (rather than greedy wrapping) avoids stranded single-word endings.
  function balancedCopyLines(ctx, value, width, maxLines) {
    const words=String(value||'').trim().split(/\s+/u).filter(Boolean);
    if(!words.length)return [];
    const widths=words.map(word=>ctx.measureText(word).width);
    if(widths.some(size=>size>width))return null;
    const memo=new Map(),measureMemo=new Map();
    const segment=(a,b)=>{
      const key=`${a}-${b}`;
      if(!measureMemo.has(key))measureMemo.set(key,ctx.measureText(words.slice(a,b).join(' ')).width);
      return measureMemo.get(key);
    };
    const solve=(index,remaining)=>{
      if(index===words.length)return {score:0,lines:[]};
      if(remaining===0)return null;
      const key=`${index}-${remaining}`;
      if(memo.has(key))return memo.get(key);
      let best=null;
      for(let last=index+1;last<=words.length;last++) {
        const size=segment(index,last);
        if(size>width)break;
        const rest=solve(last,remaining-1);
        if(!rest)continue;
        const line=words.slice(index,last).join(' ');
        const empty=(width-size)/width;
        const oneWordOrphan=(index>0&&last===words.length&&last===index+1)?0.38:0;
        const score=rest.score+empty*empty+0.28+oneWordOrphan;
        if(!best||score<best.score)best={score,lines:[line,...rest.lines]};
      }
      memo.set(key,best);
      return best;
    };
    return solve(0,maxLines)?.lines||null;
  }
  // Fit COMPLETE editorial copy with real breathing room; title and support are
  // two independently measured typographic levels, never a compressed paragraph.
  function fitSceneCopy(ctx,scene,width,maxHeight,type) {
    const headline=String(scene.headline||'').trim();
    const secondary=String(scene.secondary_text||'').trim();
    const isCta=scene.role==='cta';
    const maxTitleSize=isCta?132:scene.role==='hook'?152:144;
    const titleScale=headlineHorizontalScale(type);
    let best=null;
    for(let size=maxTitleSize;size>=52;size-=4) {
      ctx.font=sceneFont(type,size);
      // Modest horizontal condensation maintains tall, legible poster-size type
      // within a narrow negative-space column without moving onto the subject.
      const lines=balancedCopyLines(ctx,headline,width/titleScale,4);
      if(!lines)continue;
      const titleStep=Math.round(size*1.14);
      const titleHeight=size+(lines.length-1)*titleStep;
      const titleWidth=Math.max(0,...lines.map(line=>ctx.measureText(line).width))*titleScale;
      if(titleHeight>maxHeight)continue;
      const detailSizes=secondary?[76,72,68,64,60,56,52,48]:[0];
      for(const detailSize of detailSizes) {
        let detail=[],detailHeight=0,detailWidth=0;
        const detailStep=Math.round(detailSize*1.35);
        const detailIndent=secondary?type.detailIndent:0;
        if(secondary) {
          ctx.font=sceneFont(type,detailSize,true);
          const result=balancedCopyLines(ctx,secondary,width-detailIndent,4);
          if(!result)continue;
          detail=result;
          detailHeight=detailSize+(detail.length-1)*detailStep;
          detailWidth=Math.max(0,...detail.map(line=>ctx.measureText(line).width));
        }
        const gap=detail.length?Math.max(40,Math.round(size*.38)):0;
        const textHeight=titleHeight+gap+detailHeight;
        if(textHeight>maxHeight)continue;
        const score=size*1.7+detailSize*.42-Math.max(0,lines.length-3)*7-
          Math.max(0,detail.length-2)*13;
        if(!best||score>best.score)best={lines,size,titleStep,detail,detailSize,detailStep,
          detailIndent,gap,titleHeight,textHeight,titleWidth,detailWidth,titleScale,score,
          titleTruncated:false,detailTruncated:false,overflow:false};
      }
    }
    return best;
  }
  // A shared brand hierarchy, with photo-aware alignments rather than random word hashes.
  // The existing editable safe-text guide remains the owner's control surface.
  function ctaSafeArea() {
    const guide=textGuidePixels(),visible=REELS_VISIBLE;
    const left=Math.max(guide.x,visible.x),top=Math.max(guide.y,visible.y);
    const right=Math.min(guide.x+guide.width,visible.x+visible.width);
    const bottom=Math.min(guide.y+guide.height,visible.y+visible.height);
    return {x:left,y:top,width:Math.max(0,right-left),height:Math.max(0,bottom-top)};
  }
  function cleanCtaSupport(text) {
    const value=String(text||'').trim();
    // Suppress only a complete repetition of an already visible fixed action.
    // Pure brand reminders add a fifth tiny row but no new information.
    // Suppress only these exact generic repetitions, never a meaningful CTA promise.
    return /^(?:segui\s+offertalogica|visita\s+(?:il\s+)?sito|(?:www\.)?offertalogica\.it|approfondisci\s+con\s+offertalogica|scopri\s+di\s+pi[uù]\s+con\s+offertalogica)[.!]?$/iu.test(value)?'':value;
  }
  function fitSimpleLines(ctx,text,width,maxLines,fontFn,minSize,maxSize,step=2) {
    const value=String(text||'').trim();
    if(!value || width<=0)return null;
    for(let size=maxSize;size>=minSize;size-=step) {
      ctx.font=fontFn(size);
      const lines=balancedCopyLines(ctx,value,width,maxLines);
      if(lines)return {size,lines,width:Math.max(0,...lines.map(line=>ctx.measureText(line).width))};
    }
    return null;
  }
  function ctaTextBlock(ctx,kind,text,width,maxLines,fontFn,min,max,horizontalScale=1) {
    const fitted=fitSimpleLines(ctx,text,width/horizontalScale,maxLines,fontFn,min,max);
    if(!fitted)return null;
    const step=Math.round(fitted.size*(kind==='support'?1.25:1.12));
    return {kind,text,width,size:fitted.size,lines:fitted.lines,
      lineWidth:fitted.width*horizontalScale,horizontalScale,
      step,height:fitted.size+(fitted.lines.length-1)*step+Math.ceil(fitted.size*.14)};
  }
  // Exact line glyphs are tested against the protected portrait region, rather
  // than treating a varied-length headline as one oversized opaque rectangle.
  function ctaInkLines(ctx,item,type,design) {
    const boxes=[];
    const horizontal=item.horizontalScale||1;
    const alignWidth=(ink)=>item.align==='center'?item.x+(item.width-ink)/2:
      item.align==='right'?item.x+item.width-ink:item.x;
    const add=(text,font,x,y,size,scale=1)=>{
      ctx.font=font;
      const measured=ctx.measureText(text).width*scale;
      boxes.push({x:x==null?alignWidth(measured):x,y,width:measured,height:size+12});
    };
    if(item.kind==='logo')return [{x:item.x,y:item.y,width:item.width,height:item.height}];
    if(item.kind==='headline'||item.kind==='support') {
      const font=item.kind==='support'?`800 ${item.size}px ${BODY_FONT_STACK}`:
        `${type.titleWeight} ${item.size}px ${type.titleFamily}`;
      for(let i=0;i<item.lines.length;i++)
        add(item.lines[i],font,null,item.y+i*item.step,item.size,horizontal);
    } else if(item.kind==='action') {
      const ffont=design.cta_lettering==='italic'?`italic 800 ${item.followSize}px Georgia, serif`:
        `900 ${item.followSize}px ${CTA_FONT_STACK}`;
      add('SEGUI',ffont,null,item.y,item.followSize);
    } else if(item.kind==='domain')
      add('OFFERTALOGICA.IT',`850 ${item.size}px ${CTA_FONT_STACK}`,null,item.y,item.size);
    return boxes;
  }
  // Build a real typographic CTA, not a compulsory pair of buttons.
  // The AI selects the emphasis and priority; Canvas measures every word before export.
  function fitCtaComposition(ctx,view) {
    const safe=ctaSafeArea(),type=sceneTypeStyle(view);
    const design=view.scene?.text_design||{};
    const focus=['follow','site','balanced'].includes(design.cta_focus)?design.cta_focus:'follow';
    const headline=String(view.scene.headline||'').trim();
    const support=cleanCtaSupport(view.scene.secondary_text);
    const brand=transparentBrandLogo()||previewView?.logo;
    const logoRatio=brand?.naturalWidth?(brand.naturalHeight||brand.height)/(brand.naturalWidth||brand.width):353/640;
    const preference=scenePlacement(view),faces=protectedPortraits(view);
    const requested=String(design.cta_order||'').split(',').map(part=>part.trim());
    const validOrder=requested.length===5&&new Set(requested).size===5&&
      ['logo','headline','support','action','domain'].every(part=>requested.includes(part));
    const order=validOrder?requested:(focus==='site'?['logo','headline','action','domain','support']:
      focus==='balanced'?['headline','logo','action','support','domain']:
      ['logo','headline','support','action','domain']);
    let best=null;
    const available=Math.max(0,safe.width-28);
    for(const fraction of [1,.86,.73,.64,.57,.51])for(const align of ['left','right','center']) {
      if(['left','right'].includes(view.layoutPreference)&&align!==view.layoutPreference)continue;
      const contentWidth=Math.round(available*fraction);
      if(contentWidth<300)continue;
      if(align==='center'&&fraction<.72)continue;
      const x=align==='left'?safe.x+14:align==='right'?safe.x+safe.width-14-contentWidth:
        safe.x+(safe.width-contentWidth)/2;
      for(const scale of [1,.94,.88,.82,.76,.70,.64]) {
        const title=ctaTextBlock(ctx,'headline',headline,contentWidth,4,
          size=>`${type.titleWeight} ${size}px ${type.titleFamily}`,
          Math.round(54*scale),Math.round((focus==='site'?128:136)*scale),
          headlineHorizontalScale(type));
        const detail=support?ctaTextBlock(ctx,'support',support,contentWidth,3,
          size=>`800 ${size}px ${BODY_FONT_STACK}`,Math.round(40*scale),Math.round(60*scale)):null;
        const follow=ctaTextBlock(ctx,'follow','SEGUI',contentWidth,1,
          size=>`850 ${size}px ${CTA_FONT_STACK}`,Math.round(42*scale),Math.round(68*scale));
        const domain=ctaTextBlock(ctx,'domain','OFFERTALOGICA.IT',contentWidth,1,
          size=>`850 ${size}px ${CTA_FONT_STACK}`,Math.round(39*scale),
          Math.round((focus==='site'?75:70)*scale));
        if(!title||(support&&!detail)||!follow||!domain)continue;
        // The generic micro-label above the URL was unreadable on mobile;
        // the fully visible domain already communicates the destination.
        const wideWidth=available;
        const wideFollow=ctaTextBlock(ctx,'follow','SEGUI',wideWidth,1,
          size=>`850 ${size}px ${CTA_FONT_STACK}`,Math.round(42*scale),Math.round(77*scale));
        const wideDomain=ctaTextBlock(ctx,'domain','OFFERTALOGICA.IT',wideWidth,1,
          size=>`850 ${size}px ${CTA_FONT_STACK}`,Math.round(44*scale),Math.round(84*scale));
        for(const span of ['column','wide-footer']) {
          const footW=span==='wide-footer'?wideWidth:contentWidth;
          const footFollow=span==='wide-footer'?wideFollow:follow;
          const footDomain=span==='wide-footer'?wideDomain:domain;
          if(!footFollow||!footDomain)continue;
          // The authentic logo already names the brand: repeating its name below
          // 'SEGUI' shrank the headline and domain in every CTA.
          const actionH=footFollow.size+Math.round(14*scale);
          const domainH=footDomain.size+Math.round(12*scale);
          // A compact logo grants the actual CTA promise more visual space.
          const logoW=Math.min(contentWidth*.42,Math.round(192*scale));
          const logoH=Math.ceil(logoW*logoRatio);
          const gap=Math.round(12*scale);
          const blocks={
            logo:{kind:'logo',width:logoW,height:logoH,lineWidth:logoW},
            headline:{...title,kind:'headline',width:contentWidth},
            ...(detail?{support:{...detail,kind:'support',width:contentWidth}}:{}),
            action:{...footFollow,kind:'action',width:footW,height:actionH,
              lineWidth:footFollow.lineWidth,followSize:footFollow.size},
            domain:{...footDomain,kind:'domain',width:footW,height:domainH}
          };
          const ordered=order.map(key=>blocks[key]).filter(Boolean);
          const total=ordered.reduce((sum,item)=>sum+item.height,0)+gap*(ordered.length-1);
          if(total>safe.height-16)continue;
          for(const anchor of ['top','middle','bottom']) {
            if(view.layoutPreference==='top'&&anchor!=='top')continue;
            if(view.layoutPreference==='bottom'&&anchor!=='bottom')continue;
            let y=anchor==='top'?safe.y+10:anchor==='bottom'?safe.y+safe.height-total-10:
              safe.y+(safe.height-total)/2;
            const items=ordered.map(block=>{
              const column=(block.kind==='action'||block.kind==='domain')&&span==='wide-footer'
                ?{x:safe.x+14,width:wideWidth}: {x,width:contentWidth};
              const item={...block,x:column.x,y,align};
              y+=block.height+gap;
              return item;
            });
            const textBoxes=items.map(item=>{
              const inkWidth=Math.min(item.width,item.lineWidth||item.width);
              return {x:item.align==='left'?item.x:item.align==='right'?item.x+item.width-inkWidth:
                item.x+(item.width-inkWidth)/2,y:item.y,width:inkWidth,height:item.height};
            });
            const lineBoxes=items.flatMap(item=>ctaInkLines(ctx,item,type,design));
            if(lineBoxes.some(box=>!insideRect(box,safe)))continue;
            if(lineBoxes.some(box=>facesOverlap(box,faces,12)>30))continue;
            const photoNoise=lineBoxes.reduce((sum,box)=>sum+quietness(view,box),0)/
              Math.max(1,lineBoxes.length);
            const artAlign=['left','center','right'].includes(design.cta_align)?design.cta_align:null;
            const prefer=artAlign||(preference==='left'?'left':preference==='right'?'right':null);
            const score=title.size*2.9+footDomain.size*.80+
              (detail?detail.size*.30:0)+footFollow.size*.35+
              logoW*.035-photoNoise*55+(prefer===align?3:0)+
              (align==='center'?-1.5:0)-(anchor==='middle'?0:anchor==='top'?.8:1.4);
            if(!best||score>best.score)best={items,textBoxes,lineBoxes,
              variant:`editorial-${align}-${anchor}-${span}`,score,scale,focus,failed:false};
          }
        }
      }
    }
    if(!best) {
      // Unsafe layouts are never silently accepted or silently truncated.
      // Keep every semantic block and trigger the existing export overflow gate.
      const w=Math.max(1,safe.width-28),x=safe.x+14;
      const simple=(kind,text,y,size)=>({kind,text,x,y,width:w,height:size+18,size,step:size+8,
        align:'left',lines:[text],lineWidth:w});
      const logoW=Math.min(200,w);
      const items=[{kind:'logo',x,y:safe.y,width:logoW,height:logoW*logoRatio,align:'left'},
        simple('headline',headline,safe.y+140,54),
        ...(support?[simple('support',support,safe.y+218,34)]:[]),
        {...simple('action','SEGUI',safe.y+315,62),followSize:36},
        simple('domain','OFFERTALOGICA.IT',safe.y+460,48)];
      best={items,textBoxes:items,variant:'unfitted',score:-Infinity,scale:.6,focus,failed:true};
    }
    const {items}=best,logo=items.find(item=>item.kind==='logo');
    const title=items.find(item=>item.kind==='headline');
    const detail=items.find(item=>item.kind==='support');
    const action=items.find(item=>item.kind==='action');
    const textItems=items.filter(item=>item.kind!=='logo');
    const copy={lines:title.lines,size:title.size,titleStep:title.step,
      detail:detail?.lines||[],detailSize:detail?.size||0,detailStep:detail?.step||0,
      detailIndent:0,gap:detail?detail.y-title.y-title.height:0,titleHeight:title.height,
      textHeight:title.height,titleWidth:title.lineWidth,detailWidth:detail?.lineWidth||0,
      overflow:false};
    const titleBox=best.textBoxes[items.indexOf(title)];
    const detailBox=detail?best.textBoxes[items.indexOf(detail)]:null;
    const palette=photoTextPalette(view,{choice:{x:title.x,y:title.y,width:title.width},copy,
      titleBox,detailBox,y:title.y});
    const overflow=Boolean(best.failed)||items.some(item=>!insideRect(item,safe));
    copy.overflow=overflow;
    return {variant:best.variant,type,palette,safe,items,inkBoxes:best.textBoxes,
      logo,titleBox,detailBox,
      choice:{side:'cta',x:title.x,y:title.y,width:title.width},
      bounds:unionRects(items),textBounds:unionRects(textItems),
      copy,y:title.y,footerY:action.y,actionHeight:action.height,overflow};
  }
  function overlapArea(a,b) {
    const width=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
    const height=Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
    return width*height;
  }
  function compositionForScene(ctx,view) {
    const faceSignature=(view._faceBoxes||[]).map(f=>[f.x,f.y,f.width,f.height].map(Math.round).join(',')).join(';');
    const key=`1.3.3.20|${view._imageEpoch||0}|${view.result?.preview_sha256||''}|${view.layoutPreference}|${view.scene.headline}|${view.scene.secondary_text}|${view.scene.subject_side||''}|${view.scene.subject_description||''}|${view.scene.art_direction?.placement||''}|${view.scene.art_direction?.typography||''}|${view.scene.art_direction?.accent_color||''}|${JSON.stringify(view.scene.text_design||{})}|${faceSignature}|${textGuide.left}|${textGuide.top}|${textGuide.right}|${textGuide.bottom}`;
    if(view._compositionKey===key&&view._composition)return view._composition;
    if(view.scene.role==='cta') {
      const cta=fitCtaComposition(ctx,view);
      view._compositionKey=key;view._composition=cta;
      return cta;
    }
    const mode=scenePlacement(view),type=sceneTypeStyle(view);
    const guide=textGuidePixels();
    const x0=Math.max(guide.x,REELS_VISIBLE.x),y0=Math.max(guide.y,REELS_VISIBLE.y);
    const right=Math.min(guide.x+guide.width,REELS_VISIBLE.x+REELS_VISIBLE.width);
    const bottom=Math.min(guide.y+guide.height,REELS_VISIBLE.y+REELS_VISIBLE.height);
    const safe={x:x0,y:y0,width:Math.max(0,right-x0),height:Math.max(0,bottom-y0)};
    const faces=protectedPortraits(view),titleCache=new Map(),detailCache=new Map();
    const ranked=[],titleScene={...view.scene,secondary_text:''};
    const support=String(view.scene.secondary_text||'').trim();
    const usableWidth=Math.max(0,safe.width-20);
    for(const fraction of [1,.86,.72,.61,.52,.44]) {
      const width=Math.round(usableWidth*fraction);
      if(width<240)continue;
      const xs=[safe.x+10,safe.x+safe.width-width-10,
        safe.x+2,safe.x+safe.width-width-2,
        safe.x+(safe.width-width)/2,safe.x+(safe.width-width)*.32,
        safe.x+(safe.width-width)*.68];
      for(const x of [...new Set(xs.map(Math.round))]) {
        if(x<safe.x||x+width>right+1)continue;
        const leftish=x<safe.x+safe.width*.32;
        const rightish=x+width>right-safe.width*.32;
        // Explicit editor preferences constrain the side, not the available whitespace.
        if(view.layoutPreference==='left'&&!leftish)continue;
        if(view.layoutPreference==='right'&&!rightish)continue;
        const starts=[safe.y+12,safe.y+70,safe.y+145,safe.y+220,safe.y+295,
          safe.y+safe.height*.46,safe.y+safe.height*.57];
        for(const y of [...new Set(starts.map(Math.round))]) {
          if(y>bottom-155)continue;
          if(view.layoutPreference==='top'&&y>safe.y+145)continue;
          if(view.layoutPreference==='bottom'&&y<safe.y+safe.height*.43)continue;
          // The title must leave usable space for the secondary message. In
          // v1.3.3.13 a large title was fitted first and could consume the entire
          // quiet column, forcing the support down to an illegible size.
          const wordCount=support?support.split(/\s+/u).length:0;
          const supportReserve=!support?0:wordCount>4?310:wordCount>2?240:190;
          const maxHeight=bottom-y-10-supportReserve;
          if(maxHeight<120)continue;
          const fitKey=`${width}|${Math.round(maxHeight)}`;
          if(!titleCache.has(fitKey))titleCache.set(fitKey,
            fitSceneCopy(ctx,titleScene,width,maxHeight,type));
          const title=titleCache.get(fitKey);
          if(!title)continue;
          const titleBox={x,y,width:Math.min(width,title.titleWidth+10),
            height:title.titleHeight+Math.ceil(title.size*.16)+10};
          if(!insideRect(titleBox,safe)||facesOverlap(titleBox,faces,14)>32)continue;
          const titleBottom=y+title.titleHeight;
          const placements=support?[
            {x,width,y:titleBottom+28,style:'stack'},
            {x,width,y:titleBottom+58,style:'breathing-room'},
            {x:safe.x+10,width:usableWidth,y:titleBottom+35,style:'wide-left'},
            {x:safe.x+10,width:usableWidth,y:bottom-125,style:'footer-left',bottom:true},
            {x:safe.x+10,width:usableWidth,y:bottom-125,style:'footer-right',bottom:true,right:true},
            {x:x+title.titleWidth+35,width:right-(x+title.titleWidth+45),
              y:y+Math.min(60,title.titleHeight*.17),style:'side-by-side'},
            {x:safe.x+10,width:usableWidth*.52,y:titleBottom+36,style:'narrow-left'},
            {x:right-10-usableWidth*.52,width:usableWidth*.52,y:titleBottom+36,style:'narrow-right'}
          ]:[{x,y,style:'title-only'}];
          for(const place of placements) {
            const detailW=Math.floor(place.width);
            if(detailW<180)continue;
            if(!detailCache.has(detailW))detailCache.set(detailW,
              fitSimpleLines(ctx,support,detailW,4,size=>sceneFont(type,size,true),44,76,2));
            const detail=detailCache.get(detailW);
            if(support&&!detail)continue;
            const detailStep=detail?Math.round(detail.size*1.32):0;
            const detailHeight=detail?detail.size+(detail.lines.length-1)*detailStep:0;
            const detailX=place.right?right-10-detail.width:place.x;
            const detailY=place.bottom?bottom-detailHeight-10:place.y;
            const detailBox=detail?{x:Math.round(detailX),y:Math.round(detailY),
              width:Math.min(detailW,detail.width+9),
              height:detailHeight+Math.ceil(detail.size*.16)+8}:null;
            if(detailBox&&(!insideRect(detailBox,safe)||
              intersects(titleBox,detailBox,18)||facesOverlap(detailBox,faces,12)>24))continue;
            const ink=detailBox?[titleBox,detailBox]:[titleBox];
            const busy=quietness(view,titleBox)*1.5+(detailBox?quietness(view,detailBox)*.9:0);
            const preferred=(mode==='left'&&leftish)||(mode==='right'&&rightish)||
              (mode==='top'&&y<safe.y+120)||(mode==='bottom'&&y>safe.y+safe.height*.44);
            // Type size is a primary success metric: the previous version valued
            // quiet photograph regions enough to routinely pick tiny copy.
            const sizePenalty=(152-title.size)*.29+(detail?(76-detail.size)*.13:0);
            const offset=detailBox?Math.abs(detailBox.x-titleBox.x):0;
            // Independent copy zones are legitimate when photography benefits:
            // don't award the same left-aligned stacked paragraph every time.
            const cohesion=place.style==='side-by-side'?offset*.003:offset*.004;
            const gap=detailBox?Math.max(0,detailBox.y-titleBottom):0;
            const visualBalance=place.style==='stack'?.65:place.style==='breathing-room'?.45:0;
            const score=busy*15+sizePenalty+cohesion+visualBalance+
              Math.abs(gap-48)*.004+Math.max(0,title.lines.length-3)*2.3+
              Math.max(0,(detail?.lines.length||0)-2)*2.1+
              (preferred?-1.4:0)+
              Math.abs(y-(view.scene.role==='hook'?safe.y+95:safe.y+160))*.002;
            const copy={...title,detail:detail?.lines||[],detailSize:detail?.size||0,
              detailStep,detailIndent:0,detailWidth:detail?.width||0,
              detailX:detailBox?.x||x,detailY:detailBox?.y||0,
              gap, textHeight:Math.max(title.titleHeight,detailBox?detailBox.y-y+detailHeight:0)};
            ranked.push({choice:{side:x<safe.x+safe.width*.30?'left':rightish?'right':'center',
              x,width,y},copy,y,titleBox,detailBox,textBounds:unionRects(ink),
              bounds:unionRects(ink),score,variant:place.style,overflow:false});
          }
        }
      }
    }
    ranked.sort((a,b)=>a.score-b.score);
    const selected=ranked[0]||(()=>{
      // No safe composition: retain all text and disable export rather than cover a face.
      const width=Math.max(260,safe.width-20),x=safe.x+10,y=safe.y+10;
      const copy=fitSceneCopy(ctx,view.scene,width,Number.POSITIVE_INFINITY,type)||{
        lines:[String(view.scene.headline||'')],detail:[String(view.scene.secondary_text||'')],
        size:54,detailSize:36,titleStep:67,detailStep:48,titleHeight:54,textHeight:170,
        detailIndent:0,gap:65,titleWidth:width,detailWidth:width};
      copy.overflow=true;copy.detailX=x;copy.detailY=y+copy.titleHeight+copy.gap;
      const titleBox={x,y,width:copy.titleWidth,height:copy.titleHeight};
      const detailBox=copy.detail.length?{x,y:copy.detailY,width:copy.detailWidth,
        height:copy.detailSize+(copy.detail.length-1)*copy.detailStep}:null;
      return {choice:{side:'unfitted',x,y,width},copy,y,titleBox,detailBox,
        textBounds:unionRects(detailBox?[titleBox,detailBox]:[titleBox]),
        bounds:unionRects(detailBox?[titleBox,detailBox]:[titleBox]),score:Infinity,
        variant:'unfitted',overflow:true};
    })();
    selected.type=type;
    selected.palette=photoTextPalette(view,selected);
    view._compositionKey=key;view._composition=selected;
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
      ctx.font=`800 ${size}px ${DISPLAY_FONT_STACK}`;
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
      ctx.font=`600 46px ${BODY_FONT_STACK}`;
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
    ctx.font=`600 34px ${BODY_FONT_STACK}`;
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
    // Lettering is baked into poster pixels: zooming would cut glyphs or change their apparent crop.
    const staticPoster=isIntegratedPoster(sceneViews[index]);
    const scale = Math.max(MONTAGE_WIDTH / image.naturalWidth, MONTAGE_HEIGHT / image.naturalHeight) *
      (staticPoster?1:(1.010 + travel * (finalScene ? 0.024 : 0.036)));
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
    return {lines:wrapOverlayLines(ctx,text,maxWidth),size,family,weight,pad,overflow:true};
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
  function expressiveTextLine(ctx,{line,x,y,font,base,outline,shadow,phrase,effect,accent,thickness=3}) {
    ctx.save();ctx.font=font;ctx.textAlign='left';ctx.textBaseline='alphabetic';
    const value=String(line||''),query=String(phrase||'').trim();
    const location=query?value.toLocaleLowerCase('it').indexOf(query.toLocaleLowerCase('it')):-1;
    const matched=location>=0 && (location===0||!/[\p{L}\p{N}]/u.test(value[location-1]))&&
      (location+query.length===value.length||!/[\p{L}\p{N}]/u.test(value[location+query.length]));
    const x0=matched?x+ctx.measureText(value.slice(0,location)).width:x;
    const width=matched?ctx.measureText(value.slice(location,location+query.length)).width:0;
    const fontSize=Number(font.match(/(\d+)px/)?.[1])||55;
    const mark=(brush=false)=>{
      if(width<=0)return;
      ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
      ctx.strokeStyle=accent;
      ctx.lineWidth=Math.max(3,fontSize*(brush?.135:.058));
      ctx.globalAlpha*=brush?.68:.97;
      ctx.beginPath();ctx.moveTo(x0+2,y+fontSize*.085);
      ctx.quadraticCurveTo(x0+width*.52,y+fontSize*(brush?.14:.115),x0+width-2,y+fontSize*.072);
      ctx.stroke();ctx.restore();
    };
    // A selective high-contrast word block is a graphic layer, not AI-generated text.
    // It remains inside the title's measured ink footprint with only small padding.
    if(matched&&effect==='block'&&width>0) {
      ctx.save();
      ctx.fillStyle=accent;
      ctx.beginPath();ctx.roundRect(x0-3,y-fontSize*.83,width+6,fontSize*.98,Math.min(13,fontSize*.12));ctx.fill();
      ctx.restore();
    }
    if(matched&&effect==='brush')mark(true);
    const ink=(str,xx,fill)=>{
      ctx.save();ctx.font=font;ctx.lineJoin='round';ctx.lineWidth=thickness;
      ctx.strokeStyle=outline;ctx.strokeText(str,xx,y);
      ctx.shadowColor=shadow;ctx.shadowBlur=9;ctx.fillStyle=fill;ctx.fillText(str,xx,y);ctx.restore();
    };
    ink(value,x,base);
    if(matched&&effect==='color')ink(value.slice(location,location+query.length),x0,accent);
    if(matched&&effect==='block') {
      const raw=accent.replace('#','');
      const r=parseInt(raw.slice(0,2),16)||0,g=parseInt(raw.slice(2,4),16)||0,b=parseInt(raw.slice(4,6),16)||0;
      const blockInk=(.2126*r+.7152*g+.0722*b)/255>.61?'#102d33':'#ffffff';
      ink(value.slice(location,location+query.length),x0,blockInk);
    }
    if(matched&&effect==='underline')mark();
    ctx.restore();
  }
  function drawCtaOverlay(ctx,view,composition,localTime) {
    const {items,palette}=composition,design=view.scene?.text_design||{};
    const priority=['follow','site','balanced'].includes(design.cta_focus)?design.cta_focus:'follow';
    const accent=design.cta_accent||'underline';
    const progress=(start,duration)=>Math.max(0,Math.min(1,(localTime-start)/duration));
    const brand=transparentBrandLogo()||previewView?.logo;
    const headlineEffect=design.emphasis_effect||'none',phrase=design.emphasis_text||'';
    const brightPhoto=palette.title==='#183039';
    const draw=(line,x,y,font,color,stroke,shadow,effect='none',emphasis='')=>
      expressiveTextLine(ctx,{line,x,y,font,base:color,outline:stroke,shadow,
        phrase:emphasis,effect,accent:palette.accent,thickness:5.0});
    for(const item of items) {
      const blockTone=samplePhotoBrightness(view,item);
      const blockBright=blockTone?(blockTone.mean>=.54||
        (blockTone.mean>=.46&&blockTone.brightShare>=.70)):brightPhoto;
      const blockMain=blockBright?'#17313a':'#fffdf6';
      const blockOutline=blockBright?'rgba(255,251,241,.95)':'rgba(5,22,26,.92)';
      const blockShadow=blockBright?'rgba(255,255,255,.38)':'rgba(0,0,0,.70)';
      ctx.save();
      ctx.globalAlpha*=item.kind==='logo'?progress(.03,.30):
        item.kind==='headline'?progress(.15,.32):item.kind==='support'?progress(.28,.30):
        item.kind==='action'?progress(.37,.34):progress(.64,.30);
      if(item.kind==='logo') {
        if(brand&&(brand.width||brand.naturalWidth)) {
          ctx.shadowColor='rgba(255,255,255,.42)';ctx.shadowBlur=11;
          ctx.drawImage(brand,item.x,item.y,item.width,item.height);
        }
      } else if(item.kind==='headline'||item.kind==='support') {
        const support=item.kind==='support';
        const font=support?`800 ${item.size}px ${BODY_FONT_STACK}`:
          `${composition.type.titleWeight} ${item.size}px ${composition.type.titleFamily}`;
        ctx.font=font;
        for(let i=0;i<item.lines.length;i++) {
          const line=item.lines[i],horizontal=item.horizontalScale||1;
          const width=ctx.measureText(line).width*horizontal;
          const x=item.align==='center'?item.x+(item.width-width)/2:
            item.align==='right'?item.x+item.width-width:item.x;
          ctx.save();ctx.translate(x,0);ctx.scale(horizontal,1);
          draw(line,0,item.y+item.size+i*item.step,font,support?palette.detail:palette.title,
            support?palette.detailOutline:palette.titleOutline,
            support?palette.detailShadow:palette.titleShadow,
            support?'none':headlineEffect,support?'':phrase);
          ctx.restore();
        }
      } else if(item.kind==='action') {
        const followFont=design.cta_lettering==='italic'?`italic 800 ${item.followSize}px Georgia, serif`:`900 ${item.followSize}px ${CTA_FONT_STACK}`;
        ctx.font=followFont;
        const fWidth=ctx.measureText('SEGUI').width;
        const followX=item.align==='center'?item.x+(item.width-fWidth)/2:
          item.align==='right'?item.x+item.width-fWidth:item.x;
        draw('SEGUI',followX,item.y+item.followSize,followFont,blockMain,
          blockOutline,blockShadow);
        // The actual brand mark and the domain remain separate, legible layers.
        // Duplicating the brand name here crowded the CTA on mobile.
      } else if(item.kind==='domain') {
        const domainFont=`850 ${item.size}px ${CTA_FONT_STACK}`;
        const domainText='OFFERTALOGICA.IT';ctx.font=domainFont;
        const domainW=ctx.measureText(domainText).width;
        const domainX=item.align==='center'?item.x+(item.width-domainW)/2:
          item.align==='right'?item.x+item.width-domainW:item.x;
        draw(domainText,domainX,item.y+item.size,domainFont,
          blockMain,blockOutline,blockShadow,
          priority==='site'?(accent==='none'?'none':accent):'none',
          priority==='site'?'OFFERTALOGICA.IT':'');
      }
      ctx.restore();
    }
    // Optional gestures follow AI direction, not a fixed CTA template.
    const gesture=design.cta_gesture||'none';
    const action=items.find(item=>item.kind==='action');
    const domain=items.find(item=>item.kind==='domain');
    if(gesture!=='none'&&action&&progress(.55,.25)>0) {
      ctx.save();ctx.globalAlpha*=progress(.55,.25);
      ctx.strokeStyle=palette.accent;ctx.lineCap='round';ctx.lineJoin='round';
      if(gesture==='rays') {
        const nearY=action.y+action.followSize*.7;
        const middle=action.x+action.width*.5;
        const margin=Math.min(95,action.width*.14);
        for(const sign of [-1,1])for(const offset of [-15,8,30]) {
          const a=middle+sign*(action.width*.34);
          const dx=sign*margin*.42;
          ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(a,nearY+offset);
          ctx.lineTo(a+dx,nearY+offset-10+offset*.13);ctx.stroke();
        }
      } else if(gesture==='arrow'&&domain.y>action.y+action.height+30) {
        const right=composition.safe.x+composition.safe.width-22;
        const startY=action.y+action.height+7;
        const endY=Math.min(domain.y-7,composition.safe.y+composition.safe.height-18);
        if(endY-startY>24) {
          ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(right-30,startY);
          ctx.quadraticCurveTo(right+4,(startY+endY)/2,right-5,endY-13);ctx.stroke();
          ctx.beginPath();ctx.moveTo(right-21,endY-24);ctx.lineTo(right-5,endY-8);
          ctx.lineTo(right+3,endY-27);ctx.stroke();
        }
      }
      ctx.restore();
    }
  }
  function drawCinematicOverlay(ctx,view,localTime=1) {
    const {scene}=view;
    const composition=compositionForScene(ctx,view);
    if(scene.role==='cta') {
      drawCtaOverlay(ctx,view,composition,localTime);
      return;
    }
    const {choice,copy,y,type,palette}=composition;
    ctx.save();ctx.textAlign='left';ctx.textBaseline='alphabetic';
    ctx.lineJoin='round';ctx.miterLimit=2;
    const progress=(delay,duration)=>Math.max(0,Math.min(1,(localTime-delay)/duration));
    const titleProgress=.78+.22*progress(0,.32);
    const detailProgress=progress(scene.role==='hook'?.26:.18,.50);
    const drawLine=(text,x,yy,font,color,outline,shadow,detail=false,alpha=1,offset=0)=>{
      ctx.save();ctx.globalAlpha*=alpha;ctx.font=font;
      ctx.lineWidth=detail?4.2:5.2;
      ctx.strokeStyle=outline;ctx.strokeText(text,x,yy+offset);
      ctx.shadowColor=shadow;ctx.shadowBlur=detail?7:10;
      ctx.fillStyle=color;ctx.fillText(text,x,yy+offset);
      ctx.restore();
    };
    const baseline=y+copy.size;
    copy.lines.forEach((line,i)=>{
      const design=scene.text_design||{};
      ctx.save();ctx.globalAlpha*=titleProgress;
      // Scale around the actual ink origin so the measured collision box and
      // the visible glyphs always represent the same width.
      const horizontal=copy.titleScale||1;
      ctx.translate(choice.x,0);ctx.scale(horizontal,1);
      expressiveTextLine(ctx,{line,x:0,y:baseline+i*copy.titleStep+10*(1-titleProgress),
        font:sceneFont(type,copy.size),base:palette.title,outline:palette.titleOutline,
        shadow:palette.titleShadow,phrase:design.emphasis_text||'',
        effect:design.emphasis_effect||'none',accent:palette.accent,thickness:Math.max(5.5,copy.size*.066)});
      ctx.restore();
    });
    if(copy.detail.length) {
      const detailX=Number.isFinite(copy.detailX)?copy.detailX:choice.x+copy.detailIndent;
      const detailTop=Number.isFinite(copy.detailY)?copy.detailY:y+copy.titleHeight+copy.gap;
      if(type.mode==='accent_rule') {
        ctx.save();ctx.globalAlpha*=detailProgress;
        ctx.fillStyle=palette.accent;
        ctx.fillRect(detailX,detailTop-Math.round(copy.gap*.53),78,6);
        ctx.restore();
      }
      copy.detail.forEach((line,i)=>drawLine(line,detailX,detailTop+copy.detailSize+i*copy.detailStep,
        sceneFont(type,copy.detailSize,true),palette.detail,palette.detailOutline,
        palette.detailShadow,true,detailProgress,9*(1-detailProgress)));
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
      // Preserve the photographic color grade of the CTA: no universal warm filter.
      if (!isIntegratedPoster(sceneViews[segment.index])) {
        if (sceneViews[segment.index]?.layoutPreference === 'manual')
          drawManualOverlay(ctx,sceneViews[segment.index]);
        else drawCinematicOverlay(ctx, sceneViews[segment.index],segment.local);
      }
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
    previewView.playButton.disabled = !photosReady() || busy();
    const scene = available.length ? (available.includes(index) ? index : available[0]) : 0;
    const t = sceneViews.slice(0, scene).reduce((sum, item) => sum + (Number(item.scene.duration_ms) || 0), 0) / 1000;
    if (!previewPlaying) renderMontageFrame(Math.min(MONTAGE_DURATION-.002,t+.34));
    syncVisualEditor();
    updatePlacementAudit();
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
    if (!photosReady() || busy()) return;
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
    if (!previewView || busy() || musicLoading || !photosReady()) return;
    // Geometric overlap warnings are advisory; incomplete or oversized copy is not.
    updatePlacementAudit();
    const ctx=previewView.canvas.getContext('2d');
    const unchecked=sceneViews.filter(view=>isIntegratedPoster(view)&&!view.posterVerified);
    if(unchecked.length){
      previewView.exportStatus.textContent=`Prima di esportare, conferma parole, accenti, leggibilità e griglia social per le scene ${unchecked.map(v=>v.index+1).join(', ')}. Il testo nell’immagine non è verificabile automaticamente.`;
      return;
    }
    const overflowScenes=sceneViews.filter(view=>{
      if(isIntegratedPoster(view))return false;
      if(view.layoutPreference!=='manual')return compositionForScene(ctx,view).overflow;
      const design=initializeManualCopy(view);
      return manualKinds(view).some(kind=>kind!=='logo'&&layerText(view,kind)&&
        (()=>{const layer=layerFor(view,kind),b=constrainTextBox(layer.box,kind);
          return fitManualLines(ctx,layerText(view,kind),layer.style,
            b.width*MONTAGE_WIDTH,b.height*MONTAGE_HEIGHT).overflow;})());
    });
    if(overflowScenes.length) {
      previewView.exportStatus.textContent=`Testo da sistemare nelle scene ${overflowScenes.map(v=>v.index+1).join(', ')}: nessuna parola viene nascosta. Allarga il riquadro o accorcia il messaggio prima di esportare.`;
      return;
    }

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
  function creativeGuideNotes(plan) {
    const review=plan?.guide_review;
    if(!review||typeof review!=='object')return [];
    const notes=[];
    if(review.creative_departure)notes.push(textElement('p',`Differenza proposta rispetto alla guida: ${review.creative_departure}`));
    const profile=plan?.guide_quality_profile;
    if(profile)notes.push(textElement('p',`Principi analizzati ${plan.input_type==='guide_image'?'dalla foto guida':'dal Reel scelto'}: ${(profile.quality_principles||[]).join(' · ')}. ${plan.input_type==='guide_image'?'Analisi di una singola immagine: non sono deducibili storia temporale, movimento e transizioni.':'Analisi basata su fotogrammi campionati, senza audio.'}`));
    if(plan?.creative_review?.narrative_reason)notes.push(textElement('p',`Revisione narrativa prima delle foto: ${plan.creative_review.narrative_reason}. Direzione grafica: ${plan.creative_review.graphics_reason}. Valutazione AI, non certificazione estetica.`));
    if(plan?.creative_review?.advertising_reviewed)notes.push(textElement('p',`Controllo pubblicitario prima delle foto: ${plan.creative_review.advertising_reason||'superato'}. Non certifica il risultato visivo.`));
    if(Array.isArray(review.observed_headlines)&&review.observed_headlines.length)
      notes.push(textElement('p',`Testi riconosciuti nel riferimento: ${review.observed_headlines.join(' · ')}`));
    if(plan.guide_fidelity==='inspiration' && !review.observed_headlines?.length)
      notes.push(textElement('p','Nessun testo leggibile riconosciuto nella guida: il sistema non può dedurre posizioni tipografiche né verificare la diversità delle frasi originali.'));
    return notes;
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
      if(result.overflow)warnings.push(`${kind.startsWith('extra:')?'Testo aggiuntivo':kind}: riquadro piccolo, testo da sistemare`);
    }
    if(t.logo.visible) {
      const logo=textBoxRect({box:constrainLogoBox(t.logo.box)});
      if((view._faceBoxes||[]).some(face=>intersects(face,logo,15)))
        warnings.push('Logo vicino a un volto (verifica manualmente)');
    }
    return warnings.length?`Verifica prima di esportare: ${[...new Set(warnings)].join('; ')}.`:
      'Trascina o ridimensiona ogni testo e il logo. Le impostazioni restano nella bozza browser.';
  }
  function rectangleInside(item,zone) {
    const epsilon=3;
    return item.x>=zone.x-epsilon && item.y>=zone.y-epsilon &&
      item.x+item.width<=zone.x+zone.width+epsilon &&
      item.y+item.height<=zone.y+zone.height+epsilon;
  }
  function placementIssues(view,option) {
    if(!view || productScreenActive(view.index))return [];
    const ctx=previewView?.canvas?.getContext('2d');
    if(!ctx)return [];
    if(isIntegratedPoster(view))return ['Testo integrato nella foto: controlla visivamente la griglia social e la leggibilità'];
    // The customizable text guide is advisory; automatic composition uses social-safe bounds.
    const zone=option===PREVIEW_CROPS.master
      ?(view.layoutPreference==='manual'?textGuidePixels():REELS_VISIBLE)
      :(option.safe||option);
    const objects=[];
    if(view.layoutPreference==='manual') {
      const design=initializeManualCopy(view);
      for(const kind of manualKinds(view)) {
        if(kind==='logo'||!layerText(view,kind))continue;
        const layer=layerFor(view,kind),box=constrainTextBox(layer.box,kind);
        const rect=textBoxRect({box});
        objects.push({name:editorBoxLabel(kind,view),rect});
        if(fitManualLines(ctx,layerText(view,kind),layer.style,rect.width,rect.height).overflow)
          objects.push({name:`${editorBoxLabel(kind,view)} supera il riquadro`,truncated:true});
      }
      if(design.logo.visible)objects.push({name:'Logo',rect:textBoxRect({box:constrainLogoBox(design.logo.box)})});
    } else {
      const auto=compositionForScene(ctx,view);
      if(view.scene.role==='cta') {
        const labels={headline:'Titolo CTA',support:'Supporto CTA',action:'Invito a seguire',
          domain:'Richiamo al sito',logo:'Logo'};
        for(const [i,item] of (auto.items||[]).entries())objects.push({
          name:labels[item.kind]||'CTA',rect:auto.inkBoxes?.[i]||item});
      } else {
        objects.push({name:'Titolo',rect:auto.titleBox||auto.textBounds||auto.bounds});
        if(auto.detailBox)objects.push({name:'Sottotitolo',rect:auto.detailBox});
      }
      if(auto.overflow)objects.push({name:'Testo senza spazio sufficiente o posizione sicura',truncated:true});
    }
    return objects.filter(item=>item.truncated||(item.rect&&!rectangleInside(item.rect,zone)))
      .map(item=>item.name);
  }
  function auditAllPlacements() {
    const reports={};
    for(const [key,option] of Object.entries(PREVIEW_CROPS)) {
      reports[key]=sceneViews.flatMap(view=>{
        const issues=placementIssues(view,option);
        return issues.length?[{scene:view.index+1,issues}]:[];
      });
    }
    return reports;
  }
  function updatePlacementAudit() {
    if(!previewView?.cropChoice||!previewView.cropRisk)return;
    const selected=previewView.cropChoice.value;
    const choice=PREVIEW_CROPS[selected]||PREVIEW_CROPS.master;
    const reports=auditAllPlacements();
    const risk=reports[selected]||[];
    const details=risk.map(({scene,issues})=>`scena ${scene}: ${issues.join(', ')}`).join(' · ');
    previewView.cropRisk.textContent=risk.length
      ? `${choice.label} — DA CONTROLLARE: ${details}.`
      : `${choice.label} — nessun elemento fuori dai limiti geometrici simulati.`;
    previewView.cropRisk.dataset.tone=risk.length?'warning':'success';
    previewView.cropRisk.style.color=risk.length?'#9f1239':'#155e3a';
    previewView.cropRisk.style.fontWeight='650';
    const short=(key)=>reports[key].length?`${reports[key].length}/${sceneViews.length} scene da verificare`:'nessun conflitto geometrico';
    previewView.cropAllRisk.textContent=`Facebook: Reels ${short('facebook_reels')}; Feed 4:5 ${short('facebook_feed')}; quadrata 1:1 ${short('facebook_square')}. `+
      `Instagram: Reels ${short('instagram_reels')}; Feed 4:5 ${short('instagram_feed')}; profilo 3:4 ${short('instagram_grid')}.`;
  }
  function applyPreviewCrop() {
    if(!previewView?.cropFrame || !previewView.cropChoice)return;
    const option=PREVIEW_CROPS[previewView.cropChoice.value]||PREVIEW_CROPS.master;
    const {cropFrame:frame,canvas,cropGuide}=previewView;
    frame.style.aspectRatio=`${option.width} / ${option.height}`;
    frame.style.overflow='hidden';
    frame.style.borderRadius='18px';
    Object.assign(canvas.style,{
      position:'absolute',width:`${MONTAGE_WIDTH/option.width*100}%`,
      height:`${MONTAGE_HEIGHT/option.height*100}%`,
      left:`${-option.x/option.width*100}%`,top:`${-option.y/option.height*100}%`,
      borderRadius:'0',
    });
    const safe=option.safe;
    cropGuide.hidden=!safe;
    if(safe)Object.assign(cropGuide.style,{
      left:`${(safe.x-option.x)/option.width*100}%`,
      top:`${(safe.y-option.y)/option.height*100}%`,
      width:`${safe.width/option.width*100}%`,height:`${safe.height/option.height*100}%`,
    });
    drawTextGuide();
    updateTextHandles();
    updatePlacementAudit();
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
    previewView.editorMode.disabled=!!view && isIntegratedPoster(view);
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
          next.width=clampNumber(next.width+dx,kind.startsWith('extra:')?.17:.23,1-next.x);
          next.height=clampNumber(next.height+dy,
            kind==='title'?.085:kind.startsWith('extra:')?.052:.065,1-next.y);
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
    const scene=selectControl('Scena',Array.from({length:plannedSceneCount()},(_,i)=>[String(i),`Scena ${i+1}`]),()=>{
      if(busy()||previewPlaying)return;showPreview(Number(scene.select.value));
    });previewView.editorScene=scene.select;
    const mode=selectControl('Posizione',[
      ['auto','Automatica'],['manual','Manuale · trascina'],
      ['top','In alto'],['left','A sinistra'],['right','A destra'],['bottom','In basso'],
    ],()=>{
      const view=currentTextView();if(!view||busy()||previewPlaying||isIntegratedPoster(view))return;
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
    previewView.cropFrame=frame;
    frame.append(previewView.canvas);
    const cropGuide=document.createElement('div');
    cropGuide.setAttribute('aria-hidden','true');
    cropGuide.style.cssText='position:absolute;pointer-events:none;box-sizing:border-box;'+
      'border:2px dashed rgba(253,230,138,.95);'+
      'box-shadow:0 0 0 3000px rgba(15,23,42,.28);border-radius:4px;';
    cropGuide.hidden=true;
    previewView.cropGuide=cropGuide;
    previewView.editorOverlay=document.createElement('div');
    previewView.editorOverlay.className='ol-vs-edit-overlay';
    previewView.editorOverlay.setAttribute('aria-label','Area modifica testi e logo sulla scena');
    const safe=document.createElement('div');safe.className='ol-vs-edit-safe';
    safe.setAttribute('aria-hidden','true');
    safe.style.pointerEvents='none';
    previewView.textGuideOverlay=safe;
    previewView.editorBoxes={};
    for(const kind of ['title','subtitle','cta','logo'])addEditorHandle(kind,sceneViews[0]);
    frame.append(safe,previewView.editorOverlay,cropGuide);
    stage.append(frame);
    const cropControls=document.createElement('div');
    cropControls.className='ol-vs-text-editor';
    const cropLabel=document.createElement('label');
    cropLabel.className='ol-vs-editor-field';
    cropLabel.append(document.createTextNode('Controllo ritaglio — Facebook e Instagram'));
    const cropChoice=document.createElement('select');
    cropChoice.setAttribute('aria-label','Anteprima per piattaforma e formato');
    for(const [key,option] of Object.entries(PREVIEW_CROPS))
      cropChoice.add(new Option(option.label,key));
    cropChoice.value='master';
    previewView.cropChoice=cropChoice;
    cropChoice.addEventListener('change',()=>{applyPreviewCrop();syncVisualEditor();});
    cropLabel.append(cropChoice);
    const cropRisk=document.createElement('p');
    cropRisk.setAttribute('role','status');cropRisk.setAttribute('aria-live','polite');
    previewView.cropRisk=cropRisk;
    const cropAllRisk=document.createElement('p');
    cropAllRisk.className='ol-muted ol-small';previewView.cropAllRisk=cropAllRisk;
    const cropHelp=textElement('p',
      'Simulazioni locali: Feed 4:5, profilo Instagram 3:4, prova quadrata 1:1. '+
      'Le guide Reels riprendono i margini delle inserzioni Meta (14% alto, 35% basso, 6% lati); '+
      'non garantiscono gli overlay dei Reel organici. ' +
      'I volti sono rilevati solo se il browser supporta FaceDetector; altrimenti il layout ' +
      'protegge una zona prudenziale stimata dalla descrizione del soggetto, non certificata. ' +
      'Controlla anche le anteprime reali nelle app.');
    cropHelp.className='ol-muted ol-small';
    cropControls.append(cropLabel,cropRisk,cropAllRisk,cropHelp);
    const guidePanel=document.createElement('div');
    guidePanel.style.cssText='display:flex;flex-direction:column;gap:9px;padding:12px;'+
      'border:1px solid #d3dfd6;border-radius:9px;margin-top:10px;';
    const guideTitle=textElement('p','Griglia salva-testo indicativa · modificabile in pixel');
    const guideFields=document.createElement('div');guideFields.className='ol-vs-editor-row';
    previewView.guideInputs={};
    for(const [side,label,max] of [['left','Sinistra',1080],['right','Destra',1080],
      ['top','Alto',1920],['bottom','Basso',1920]]) {
      const wrap=document.createElement('label');wrap.className='ol-vs-editor-field';
      wrap.append(document.createTextNode(`${label} (px)`));
      const field=document.createElement('input');field.type='number';field.min='0';
      field.max=String(max);field.step='10';
      field.value=String(Math.round(textGuide[side]*(max)));
      field.setAttribute('aria-label',`Limite guida ${label.toLowerCase()} in pixel`);
      previewView.guideInputs[side]=field;
      field.addEventListener('change',()=>{
        const value=Number(field.value);
        const next={...textGuide,[side]:value/max};
        if(!Number.isInteger(value)||value<0||value>max||!validTextGuide(next)) {
          field.value=String(Math.round(textGuide[side]*max));return;
        }
        textGuide=next;drawTextGuide();updatePlacementAudit();scheduleProjectAutosave();
      });
      wrap.append(field);guideFields.append(wrap);
    }
    const visibleLabel=document.createElement('label');visibleLabel.className='ol-vs-editor-field';
    const visible=document.createElement('input');visible.type='checkbox';visible.checked=textGuideVisible;
    visible.setAttribute('aria-label','Mostra griglia salva-testo');
    visible.addEventListener('change',()=>{textGuideVisible=visible.checked;
      drawTextGuide();scheduleProjectAutosave();});
    previewView.guideVisibleInput=visible;
    visibleLabel.append(visible,document.createTextNode(' Mostra griglia'));
    const guideHint=textElement('p',
      'I quattro limiti sono solo guide: puoi trascinare testo e logo anche all’esterno. '+
      'Gli avvisi Facebook e Instagram non impediscono il montaggio.');
    guideHint.className='ol-muted ol-small';
    guidePanel.append(guideTitle,guideFields,visibleLabel,guideHint);
    cropControls.append(guidePanel);

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
    for (let i = 0; i < plannedSceneCount(); i++) previewView.productChoice.add(new Option(`Scena ${i + 1}`, String(i)));
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
    previewView.box.append(previewHeader, stage, cropControls, textEditor, musicRow, productRow, previewView.meta);
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
    applyPreviewCrop();
    showPreview(0);
  }
  function createSceneCard(scene, index) {
    const card = document.createElement('article');
    card.className = 'ol-vs-scene-card';
    const heading = textElement('h4', `Scena ${index + 1} · ${scene.duration_ms / 1000}s · ${scene.role}`);
    const beatLabel=scene.format_beat_label?textElement('p',`Funzione nel format: ${scene.format_beat_label}`):null;
    const lead = textElement('p', `${scene.headline}${scene.secondary_text ? ' — ' + scene.secondary_text : ''}`);
    const visual = textElement('p', `Immagine: ${scene.visual_brief}`);
    const subject = textElement('p', `Soggetto: ${scene.subject_description} · Emozione: ${scene.emotion}`);
    const side = textElement('p', `Posizione soggetto: ${scene.subject_side}`);

    const state = textElement('p', 'In attesa della generazione automatica…');
    state.className = 'ol-vs-scene-state ol-small';

    const image = document.createElement('img');
    image.hidden = true;
    image.alt = `Immagine proposta per scena ${index + 1}, da revisionare`;
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
    notesInput.placeholder = 'Es. Migliora profondità e contrasto, lascia spazio al titolo e rendi più chiara l’azione della scena.';
    notesInput.addEventListener('input',scheduleProjectAutosave);
    const notesHint = textElement('small', 'Lascia vuoto per usare il brief originale. Compila le note solo quando vuoi rigenerare questa scena.');
    notesWrap.append(notesLabel, notesInput, notesHint);

    const prompt = document.createElement('details');
    prompt.hidden = true;
    prompt.className = 'ol-vs-scene-prompt';
    prompt.append(textElement('summary', 'Mostra prompt di generazione'));
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
    const posterWrap=document.createElement('label');
    posterWrap.className='ol-vs-editor-check';
    posterWrap.hidden=scene.role==='cta';
    const posterInput=document.createElement('input');
    posterInput.type='checkbox';
    posterInput.checked=scene.role!=='cta' && brief?.input?.image_mode==='poster';
    posterWrap.append(posterInput,document.createTextNode(' Genera immagine con scritte integrate (prossimo tentativo)'));
    const posterVerifyWrap=document.createElement('label');
    posterVerifyWrap.className='ol-vs-editor-check';
    posterVerifyWrap.hidden=true;
    const posterVerifyInput=document.createElement('input');
    posterVerifyInput.type='checkbox';
    posterVerifyWrap.append(posterVerifyInput,document.createTextNode(' Confermo testo ESATTO, accenti, punteggiatura, contrasto e leggibilità mobile in questa scena'));
    const posterHint=textElement('small','Modalità sperimentale: testo non modificabile separatamente; verifica anche il ritaglio delle interfacce social. La CTA usa logo e indirizzo originali.');
    posterHint.hidden=scene.role==='cta';
    const view = {
      scene,
      index,
      card,
      state,
      image,
      actionButton,
      notesInput,
      posterInput,posterVerifyInput,posterVerifyWrap,posterVerified:false,
      layoutPreference: 'auto',
      layoutSelect,
      prompt,
      promptBody,
      attempts: 0,
      result: null,
      error: '',
      running: false,
    };
    posterInput.addEventListener('change',()=>{scheduleProjectAutosave();
      setSceneState(view,'Modalità scelta per la PROSSIMA rigenerazione. La scena già generata resta invariata.','pending');});
    posterVerifyInput.addEventListener('change',()=>{
      view.posterVerified=posterVerifyInput.checked;
      updatePlacementAudit();
      syncControls();
    });
    layoutSelect.addEventListener('change', () => {
      if (exporting || isIntegratedPoster(view)) return;
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
    card.append(heading, ...(beatLabel?[beatLabel]:[]), lead, visual, subject, side, state, image, posterWrap, posterHint, posterVerifyWrap, layoutWrap, notesWrap, actions, prompt);
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
    const isGuide=['guide_image','guide_video'].includes(generation.input.input_type);
    const strong=isGuide&&generation.input.guide_fidelity==='strong';
    const references=strong
      ? view.index===0?[guide]:view.index===1&&generation.input.guide_usage==='first_scene'?[guide]:
        [guide,previous[previous.length-1].result.continuity_reference]
      : view.index===0?[]:
        view.index===1?[previous[0].result.continuity_reference]:
        [previous[0].result.continuity_reference,previous[previous.length-1].result.continuity_reference];
    if(references.some(ref=>!ref))throw Error('Riferimento guida mancante: rigenera lo storyboard prima di avviare altre foto.');
    const integrated=view.scene.role!=='cta' && Boolean(view.posterInput?.checked);
    const encodedNotes=integrated?`${POSTER_NOTE_PREFIX}\n${revisionNotes}`:revisionNotes;
    if(encodedNotes.length>700)throw Error('Note troppo lunghe per la modalità con testo integrato (massimo 670 caratteri).');
    stopPreview();
    view.running = true;
    view.error = '';
    let failure = null;
    view.attempts += 1;
    updateSceneActionLabel(view);
    setSceneState(view, integrated?'Generazione creatività con scritte integrate richiesta…':(revisionNotes ? 'Rigenerazione fotografica reale richiesta…' : 'Generazione fotografica reale richiesta…'), 'pending');
    beginRequest();
    try {
      const result = await labRequest('video-studio-photo', {
        input: generation.input,
        plan: generation.plan,
        receipt: generation.receipt,
        scene_index: view.index,
        revision_notes: encodedNotes || undefined,
        references,
      }, token, 230000);
      assignSceneResult(view,result);
      const tone=result.guide_style_check?.status==='review_light_and_palette'
        ? ' · Guida: luminosità/palette da verificare manualmente'
        : result.guide_style_check ? ' · Guida: tono cromatico preliminarmente coerente' : '';
      setSceneState(view, `Generata · ${result.provider}${tone} · ${isIntegratedPoster(view)?'TESTI GENERATI NELL’IMMAGINE: controlla e conferma ogni parola prima del download.':'Fotografia con testi Canvas.'} · Anteprima browser da revisionare.`, 'success');
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
      message(`Storyboard AI e ${sceneViews.length} immagini generate automaticamente. Rivedi ogni scena, controlla il testo integrato e conferma prima del download.`);
    } else {
      message(`Storyboard AI generato. Foto pronte: ${ready}/${sceneViews.length}. Generazione automatica interrotta per evitare richieste inutili: correggi l’errore e riprova sulle scene mancanti.`, true);
    }
  }
  async function generateCreative() {
    if (!brief || busy()) return;
    resetGeneratedOutput();
    message('Richiesta inviata al motore creativo reale. Avvio storyboard AI e foto automatiche.');
    beginRequest();
    try {
      const token = await requireEditor();
      const data = {platform: brief.input.platform, suggestions: brief.input.suggestions,scene_count_preference:brief.input.scene_count_preference??'auto'};
      if(brief.mode==='article')data.article_id=brief.input.article.id;
      else if(brief.mode==='image') {
        data.guide_image_base64=await fileToJpeg(guideFile,{width:768,height:768,maxBytes:110000,preserveAspect:true});
        data.guide_usage=brief.input.guide_usage;
        data.guide_fidelity=brief.input.guide_fidelity;
        data.guide_context=brief.input.guide_context;
      } else if(brief.mode==='video') {
        if(!videoGuideFile)throw Error('Ricarica il Reel MP4 guida prima di avviare una nuova regia.');
        const guide=await extractVideoGuideFrames(videoGuideFile);
        data.guide_video_frames_base64=guide.frames;
        data.guide_video_duration_ms=guide.durationMs;
        data.guide_video_frame_times_ms=guide.times;
        data.guide_fidelity=brief.input.guide_fidelity;
        data.guide_context=brief.input.guide_context;
      } else data.theme=brief.input.theme;
      // The QA has multiple sequential calls; server orchestration is limited to 235 s.
      generation = await labRequest('video-studio-storyboard', data, token, 265000);
      if (!validSceneCount(generation?.plan?.scenes?.length) ||
        (brief.input.scene_count_preference!=='auto'&&generation.plan.scenes.length!==brief.input.scene_count_preference))
        throw Error('Storyboard generato non valido: numero di scene incoerente con la scelta.');
      realSummary.append(
        textElement('p', `Concept: ${generation.plan.concept}`),
        ...(generation.plan.format_id?[textElement('p', `Format pubblicitario: ${generation.plan.format_label||generation.plan.format_id} · ${generation.plan.format_reason||''}`)]:[]),
        textElement('p', `Pubblico: ${generation.plan.audience}`),
        ...(generation.input.input_type==='guide_image'?[textElement('p', `Guida fotografica: ${generation.input.guide_fidelity==='strong'?'Aderenza forte':'Ispirazione libera'}`)]:[]),
        ...(generation.input.input_type==='guide_video'?[textElement('p', `Reel MP4 guida: ${generation.input.guide_video_frame_times_ms.length} fotogrammi campionati · ${generation.input.guide_video_duration_ms/1000} s · ${generation.input.guide_fidelity==='strong'?'Aderenza forte':'Ispirazione libera'} · audio non analizzato`)]:[]),
        ...creativeGuideNotes(generation.plan),
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

  // A project file stores 3–5 JPEG previews and independent Canvas layers.
  // Signed references are bound to the authenticated owner. Neither credentials nor MP3
  // bytes are included. This is a browser draft, not a server publication or master.
  function projectOwner() {return getSession()?.user?.id || null;}
  function isBase64Image(value,maxChars=9_000_000) {
    return typeof value==='string' && value.length>1000 && value.length<=maxChars &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(value);
  }
  function isValidProject(data) {
    if(!data || data.schema!==PROJECT_SCHEMA || data.owner_id!==projectOwner() ||
      !validSceneCount(data.generation?.plan?.scenes?.length) ||
      !data.generation?.input || !data.generation?.receipt?.signature ||
      !data.brief?.input || !Array.isArray(data.scenes) || data.scenes.length!==data.generation.plan.scenes.length ||
      typeof data.generation.receipt.expiresAt!=='number') return false;
    return data.scenes.every((scene,i)=>scene?.index===i && (!scene.result ||
      (scene.result.preview_mime==='image/jpeg' && ['photo','poster',undefined].includes(scene.result.image_mode) &&
        (scene.result.image_mode!=='poster'||data.generation.plan.scenes[i].role!=='cta') &&
        isBase64Image(scene.result.preview_base64) &&
        scene.result.continuity_reference?.scene_index===i)));
  }
  function snapshotProject() {
    if(!generation || !validSceneCount(sceneViews.length) || sceneViews.length!==plannedSceneCount() || !projectOwner())
      throw Error('Genera prima uno storyboard per salvare un progetto completo.');
    const projects = sceneViews.map(view=>({index:view.index,
      result:view.result ? {preview_mime:view.result.preview_mime,preview_base64:view.result.preview_base64,
        image_mode:isIntegratedPoster(view)?'poster':'photo',
        continuity_reference:view.result.continuity_reference,provider:view.result.provider,
        prompt:String(view.result.prompt||'').slice(0,7000),guide_style_check:view.result.guide_style_check||null} : null,
      textDesign:view.textDesign||null,
      layoutPreference:view.layoutPreference,
      poster_requested:Boolean(view.posterInput?.checked),
      notes:String(view.notesInput.value||'').slice(0,700),attempts:view.attempts}));
    return {schema:PROJECT_SCHEMA, saved_at:new Date().toISOString(), owner_id:projectOwner(),
      brief, generation:{input:generation.input,plan:generation.plan,receipt:generation.receipt,
        guide_reference:generation.guide_reference||null}, scenes:projects,
      active_scene:previewIndex,
      text_guide:{...textGuide},text_guide_visible:textGuideVisible,
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
      if(!localProjectActive)return;
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
    // Do not let a previous autosave overwrite the intact draft during partial restoration.
    clearTimeout(autoSaveTimer);
    autoSaveTimer=null;
    localProjectActive=false;
    // Pre-validate the images before discarding the currently open draft.
    const testSources=project.scenes.filter(scene=>scene.result).map(scene=>
      `data:${scene.result.preview_mime};base64,${scene.result.preview_base64}`);
    await Promise.all(testSources.map(src=>new Promise((resolve,reject)=>{
      const img=new Image();img.onload=()=>img.naturalWidth>0?resolve():reject(Error('Fotografia non valida'));
      img.onerror=()=>reject(Error('Fotografia non leggibile'));img.src=src;
    })));
    stopPreview();resetGeneratedOutput();
    textGuide=validTextGuide(project.text_guide)?{...project.text_guide}:{...DEFAULT_TEXT_GUIDE};
    textGuideVisible=typeof project.text_guide_visible==='boolean'?project.text_guide_visible:true;
    brief=project.brief;
    generation=project.generation;
    if(['image','video'].includes(brief.mode)) {
      // The original uploaded file may no longer exist. A signed guide thumbnail is
      // already persisted in generation.guide_reference for future derived scenes.
      guideFile=null;videoGuideFile=null;
    }
    setSummary(brief);
    downloadButton.disabled=false;generateButton.disabled=false;
    realSummary.append(textElement('p',`Concept: ${generation.plan.concept}`),
      ...(generation.plan.format_id?[textElement('p',`Format pubblicitario: ${generation.plan.format_label||generation.plan.format_id} · ${generation.plan.format_reason||''}`)]:[]),
      textElement('p',`Pubblico: ${generation.plan.audience}`),
      ...creativeGuideNotes(generation.plan),
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
      if(view.posterInput)view.posterInput.checked=Boolean(saved.poster_requested);
      view.posterVerified=false;
      if(saved.textDesign && typeof saved.textDesign==='object')view.textDesign=saved.textDesign;
      if(saved.result){
        assignSceneResult(view,saved.result);
        setSceneState(view,isIntegratedPoster(view)?'Creatività con testo integrato recuperata: ricontrolla ogni parola e riconferma prima del download.':'Fotografia recuperata dal progetto salvato.','success');
      }
      updateSceneActionLabel(view);
    }
    previewIndex=Math.max(0,Math.min(plannedSceneCount()-1,Number(project.active_scene)||0));
    updateProgress();showPreview(previewIndex);
    // Music is linked by a catalogue selection, not embedded in the portable draft.
    // Local audio on another device must be provided again by its owner.
    await restoreMusicLibrary();
    if(previewView){
      const stored=String(project.music_choice||'none');
      previewView.musicChoice.value=[...previewView.musicChoice.options].some(opt=>opt.value===stored)?stored:'none';
      await applyMusicChoice();
      previewView.productChoice.value=Number.isInteger(Number(project.product_scene))&&Number(project.product_scene)>=0&&Number(project.product_scene)<plannedSceneCount()?String(project.product_scene):String(Math.min(2,plannedSceneCount()-1));
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
