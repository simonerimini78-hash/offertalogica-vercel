/* Video Studio v1.1.5 — server-side private soundtrack selection, with local fallback. */
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
  let sceneViews = [];
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
    const article = selectedSource() === 'article';
    articleWrap.hidden = !article;
    themeWrap.hidden = article;
    themeInput.required = !article;
    articleSelect.required = article;
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
      view.actionButton.disabled = !generation || isBusy || view.running;
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
    line('Origine', b.mode === 'article' ? 'Articolo Editoriale pubblicato' : 'Tema libero');
    line('Titolo', b.mode === 'article' ? b.input.article.title : b.input.theme);
    line('Suggerimenti', b.input.suggestions || 'Nessuno');
    line('Destinazione', b.input.platform);
    line('Passaggio successivo', 'Storyboard AI con 4 foto automatiche da revisionare');
    output.hidden = false;
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
      else {
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
  // Cinematic composition in the SAME 9:16 image, not in a second panel.
  // Subject side is a composition hint, not a verified face/object bounding box.
  // Reviewers can override it per scene without regenerating a paid photograph.
  function scenePlacement(view) {
    const requested = view?.layoutPreference || 'auto';
    if (requested !== 'auto') return requested;
    if (view?.scene?.subject_side === 'left') return 'right';
    if (view?.scene?.subject_side === 'right') return 'left';
    return 'top';
  }
  function cinematicLayout(view) {
    const side = scenePlacement(view);
    return side === 'left' ? {x: 80, y: 285, width: 680, logoX: 99} :
      side === 'right' ? {x: 420, y: 285, width: 585, logoX: 670} :
        {x: 84, y: 240, width: 912, logoX: 635};
  }
  function drawProductScreenFrame(ctx, view) {
    const image = verifiedProductScreen?.image;
    if (!image) return;
    ctx.fillStyle = '#11283b';
    ctx.fillRect(0, 0, MONTAGE_WIDTH, MONTAGE_HEIGHT);
    // Real, editor-supplied product pixels only. Preserve aspect ratio; never fabricate UI.
    const box = {x:62, y:565, width:956, height:870};
    const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
    const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
    const x = (MONTAGE_WIDTH - w) / 2, y = box.y + (box.height - h) / 2;
    ctx.fillStyle = '#f9fafb';
    ctx.beginPath();
    ctx.roundRect(x - 18, y - 18, w + 36, h + 36, 24);
    ctx.fill();
    ctx.drawImage(image, x, y, w, h);
    const scene = view.scene;
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 91px system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const lines = wrapCanvasText(ctx, scene.headline, 950, 3);
    lines.forEach((line, i) => ctx.fillText(line, 65, 180 + i * 108));
    const subtitle = String(scene.secondary_text || '').trim();
    if (subtitle) {
      ctx.font = '500 47px system-ui, sans-serif';
      const sublines = wrapCanvasText(ctx, subtitle, 930, 2);
      sublines.forEach((line, i) => ctx.fillText(line, 65, 445 + i * 55));
    }
    // Explicitly a user-provided screenshot; no claim that an AI-generated device is genuine.
    ctx.font = '500 35px system-ui, sans-serif';
    ctx.fillStyle = '#cde5f1';
    ctx.fillText('Schermata fornita dalla Redazione', 66, 1530);
    const logo = previewView?.logo;
    if (logo?.complete && logo.naturalWidth && logo.naturalHeight) {
      const logoW = 420, logoH = logoW * logo.naturalHeight / logo.naturalWidth;
      ctx.fillStyle = 'rgba(255,255,255,0.96)';
      ctx.beginPath();
      ctx.roundRect(65, 1616, logoW + 42, logoH + 36, 20);
      ctx.fill();
      ctx.drawImage(logo, 86, 1634, logoW, logoH);
    }
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
    // Full-bleed cover, never letterbox. Small centred movement only (no blind pan).
    const scale = Math.max(MONTAGE_WIDTH / image.naturalWidth, MONTAGE_HEIGHT / image.naturalHeight) *
      (1.008 + zoomProgress * 0.014);
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
  function drawCinematicOverlay(ctx, view) {
    const {scene} = view;
    const placement = cinematicLayout(view);
    const x = placement.x;
    const maxWidth = placement.width;
    let titleSize = scene.role === 'hook' ? 100 : 90;
    let titleLines = [];
    do {
      ctx.font = `800 ${titleSize}px system-ui, sans-serif`;
      titleLines = wrapOverlayLines(ctx, scene.headline, maxWidth - 38);
      if (titleLines.length <= 3 && titleLines.every(l => ctx.measureText(l).width <= maxWidth - 38)) break;
      titleSize -= 6;
    } while (titleSize >= 58);
    const titleLineHeight = Math.round(titleSize * 1.12);
    const titleHeight = titleLines.length * titleLineHeight;
    let secondarySize = 54;
    let secondaryLines = [];
    const subtitle = String(scene.secondary_text || '').trim();
    if (subtitle) {
      do {
        ctx.font = `500 ${secondarySize}px system-ui, sans-serif`;
        secondaryLines = wrapOverlayLines(ctx, subtitle, maxWidth - 40);
        if (secondaryLines.length <= 2 && secondaryLines.every(l => ctx.measureText(l).width <= maxWidth - 40)) break;
        secondarySize -= 4;
      } while (secondarySize >= 34);
    }
    const secondaryLineHeight = Math.round(secondarySize * 1.22);
    const secondaryHeight = secondaryLines.length ? 30 + secondaryLines.length * secondaryLineHeight : 0;
    const groupHeight = titleHeight + secondaryHeight + 38;
    const y = Math.min(810, placement.y + Math.max(0, 385 - groupHeight) * 0.12);
    // White blurred veil, as in the v0.8 cinematic rendering, instead of a footer strip.
    const veilX = Math.max(46, x - 34);
    const veilY = y - 42;
    const veilW = Math.min(MONTAGE_WIDTH - veilX - 40, maxWidth + 75);
    const veilH = groupHeight + 52;
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,0.80)';
    ctx.shadowBlur = 35;
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.beginPath();
    ctx.roundRect(veilX, veilY, veilW, veilH, 40);
    ctx.fill();
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#102b3d';
    ctx.font = `800 ${titleSize}px system-ui, sans-serif`;
    const base = y + titleSize;
    titleLines.forEach((line, n) => ctx.fillText(line, x, base + n * titleLineHeight));
    if (secondaryLines.length) {
      ctx.fillStyle = '#173347';
      ctx.font = `500 ${secondarySize}px system-ui, sans-serif`;
      const first = y + titleHeight + 40 + secondarySize;
      secondaryLines.forEach((line, n) => ctx.fillText(line, x, first + n * secondaryLineHeight));
    }
    // Authentic image-based wordmark: never ask the image model to draw it.
    if (previewView.logo.complete && previewView.logo.naturalWidth && previewView.logo.naturalHeight) {
      const logo = previewView.logo;
      const logoW = scene.role === 'cta' ? 380 : 340;
      const logoH = logoW * logo.naturalHeight / logo.naturalWidth;
      const logoX = Math.min(MONTAGE_WIDTH - logoW - 68, placement.logoX);
      const logoY = Math.min(1210 - logoH, y + groupHeight + 44);
      ctx.save();
      ctx.shadowColor = 'rgba(255,255,255,0.82)';
      ctx.shadowBlur = 29;
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.beginPath();
      ctx.roundRect(logoX - 18, logoY - 12, logoW + 36, logoH + 24, 22);
      ctx.fill();
      ctx.restore();
      ctx.drawImage(logo, logoX, logoY, logoW, logoH);
    }
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
      textElement('p', 'Fotografie a tutto schermo con testo e logo sovrapposti. Puoi spostare il layout di ogni scena; bozza con musica incorporata, non master pubblicabile.'),
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
      ['left','A sinistra'],['right','A destra']]) {
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
    updateSceneActionLabel(view);
    actions.append(actionButton);
    card.append(heading, lead, visual, subject, side, state, image, layoutWrap, notesWrap, actions, prompt);
    sceneHolder.append(card);
    return view;
  }
  async function requestPhoto(view, token, revisionNotes = '') {
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
      }, token, 230000);
      view.result = result;
      view.image.src = `data:${result.preview_mime};base64,${result.preview_base64}`;
      view.image.hidden = false;
      view.promptBody.textContent = result.prompt;
      view.prompt.hidden = false;
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
      if (brief.mode === 'article') data.article_id = brief.input.article.id;
      else data.theme = brief.input.theme;
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
      message('Storyboard AI generato. Avvio automatico delle fotografie originali, una richiesta alla volta…');
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
