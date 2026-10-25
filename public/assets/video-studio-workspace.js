/* Video Studio v1.0.4 — AI scenes with audiovisual browser montage review (no MP4). */
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
  let preparing = false;
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
    stopPreview();
    if (soundtrackUrl) URL.revokeObjectURL(soundtrackUrl);
    soundtrackUrl = null;
    if (previewView?.musicAudio) {
      previewView.musicAudio.removeAttribute('src');
      previewView.musicAudio.load();
    }
  }
  function resetGeneratedOutput() {
    releaseSoundtrack();
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
    return preparing || batchRunning || activeRequests > 0;
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
    if (previewView?.playButton) previewView.playButton.disabled = availablePreviewIndices().length !== 4 || isBusy;
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
  const MONTAGE_WIDTH = 720;
  const MONTAGE_HEIGHT = 1280;
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
  function drawScenePhoto(ctx, index, zoomProgress, opacity) {
    const image = sceneViews[index]?.image;
    if (!image || !image.complete || !image.naturalWidth) return;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.rect(0, 0, MONTAGE_WIDTH, 918);
    ctx.clip();
    const scale = Math.min(710 / image.naturalWidth, 918 / image.naturalHeight) * (1.015 + zoomProgress * 0.02);
    const w = image.naturalWidth * scale;
    const h = image.naturalHeight * scale;
    ctx.drawImage(image, (MONTAGE_WIDTH - w) / 2, (918 - h) / 2, w, h);
    ctx.restore();
  }
  function renderMontageFrame(second) {
    if (!previewView || !sceneViews.length) return;
    const ctx = previewView.canvas.getContext('2d');
    if (!ctx) return;
    const t = Math.max(0, Math.min(MONTAGE_DURATION, second));
    const segment = sceneAt(Math.min(14.999, t));
    previewIndex = segment.index;
    ctx.clearRect(0, 0, MONTAGE_WIDTH, MONTAGE_HEIGHT);
    ctx.fillStyle = '#101f29';
    ctx.fillRect(0, 0, MONTAGE_WIDTH, MONTAGE_HEIGHT);
    drawScenePhoto(ctx, segment.index, Math.min(1, segment.local / segment.duration), 1);
    // Fade between original photos, without generating or substituting other images.
    if (segment.index > 0 && segment.local < 0.28) {
      drawScenePhoto(ctx, segment.index - 1, 1, 1 - segment.local / 0.28);
    }
    ctx.fillStyle = '#112b33';
    ctx.fillRect(0, 918, MONTAGE_WIDTH, 362);
    ctx.fillStyle = '#33ad65';
    ctx.fillRect(0, 918, MONTAGE_WIDTH, 5);
    const scene = sceneViews[segment.index].scene;
    ctx.fillStyle = '#a9e5be';
    ctx.font = '700 23px system-ui, sans-serif';
    ctx.fillText(`OFFERTALOGICA  ·  ${segment.index + 1}/4`, 45, 959);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 49px system-ui, sans-serif';
    const headingLines = wrapCanvasText(ctx, scene.headline, 630, 2);
    headingLines.forEach((line, n) => ctx.fillText(line, 45, 1016 + n * 56));
    ctx.font = '500 29px system-ui, sans-serif';
    ctx.fillStyle = '#d9eae3';
    const secondaryLines = wrapCanvasText(ctx, scene.secondary_text, 420, 2);
    const secondaryStart = 1033 + headingLines.length * 56;
    secondaryLines.forEach((line, n) => ctx.fillText(line, 45, secondaryStart + n * 38));
    // The official brand artwork is drawn separately, never hallucinated by the image model.
    if (previewView.logo.complete && previewView.logo.naturalWidth) {
      const logo = previewView.logo;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(477, 1144, 208, 116);
      const ratio = Math.min(190 / logo.naturalWidth, 106 / logo.naturalHeight);
      ctx.drawImage(logo, 486 + (190 - logo.naturalWidth * ratio) / 2, 1148 + (106 - logo.naturalHeight * ratio) / 2,
        logo.naturalWidth * ratio, logo.naturalHeight * ratio);
    }
    ctx.fillStyle = '#38b66e';
    ctx.fillRect(0, 1272, MONTAGE_WIDTH * (t / MONTAGE_DURATION), 8);
    previewView.meta.textContent = `Scena ${segment.index + 1}/4 · ${t.toFixed(1)} / 15.0 s · ${soundtrackUrl ? 'audio locale' : 'senza musica'} · Anteprima non esportabile`;
  }
  function showPreview(index) {
    if (!previewView) return;
    const available = availablePreviewIndices();
    previewView.playButton.disabled = available.length !== 4 || busy();
    const scene = available.length ? (available.includes(index) ? index : available[0]) : 0;
    const t = sceneViews.slice(0, scene).reduce((sum, item) => sum + (Number(item.scene.duration_ms) || 0), 0) / 1000;
    if (!previewPlaying) renderMontageFrame(t);
    previewView.musicHelp.textContent = soundtrackUrl
      ? 'Traccia locale caricata per l’ascolto di prova. Non viene inviata al server né approvata per la pubblicazione.'
      : 'La libreria di musiche approvate non è configurata. Scegli una traccia di cui disponi dei diritti per ascoltare il montaggio con musica.';
  }
  function montageTick() {
    if (!previewPlaying || !previewView) return;
    const audio = previewView.musicAudio;
    const elapsed = soundtrackUrl && !audio.paused ? audio.currentTime : (performance.now() - previewStartedAt) / 1000;
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
        previewView.musicAudio.currentTime = 0;
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
  async function selectSoundtrack(file) {
    releaseSoundtrack();
    if (!previewView) return;
    if (!file) {
      showPreview(previewIndex);
      return;
    }
    if (file.size > 25 * 1024 * 1024 || file.size === 0 ||
        !(file.type.startsWith('audio/') || /\.(mp3|m4a|wav|aac|ogg|flac)$/i.test(file.name))) {
      previewView.musicHelp.textContent = 'Seleziona un file audio supportato di massimo 25 MB.';
      previewView.musicInput.value = '';
      return;
    }
    const candidateUrl = URL.createObjectURL(file);
    try {
      const audio = previewView.musicAudio;
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
      if (!(audio.duration >= 15)) throw Error('il brano deve durare almeno 15 secondi');
      soundtrackUrl = candidateUrl;
      showPreview(previewIndex);
    } catch (e) {
      URL.revokeObjectURL(candidateUrl);
      previewView.musicAudio.removeAttribute('src');
      previewView.musicInput.value = '';
      previewView.musicHelp.textContent = `Traccia non utilizzabile: ${e.message}`;
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
      musicHelp: document.createElement('small'),
      musicAudio: document.createElement('audio'),
      logo: new Image(),
    };
    previewView.box.className = 'ol-vs-preview-box';
    const previewHeader = document.createElement('div');
    previewHeader.className = 'ol-vs-preview-head';
    const previewIntro = document.createElement('div');
    previewIntro.append(
      textElement('h4', 'Montaggio audiovisivo di prova · 15 secondi'),
      textElement('p', 'Le quattro foto originali, i titoli, il logo e le transizioni vengono composti nel browser. È una bozza, non un MP4.'),
    );
    previewView.playButton.type = 'button';
    previewView.playButton.className = 'ol-button ol-button-primary ol-button-small';
    previewView.playButton.textContent = 'Riproduci montaggio';
    previewView.playButton.disabled = true;
    previewView.playButton.addEventListener('click', () => { togglePreviewPlayback(); });
    previewHeader.append(previewIntro, previewView.playButton);

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
    musicLabel.textContent = 'Musica per questa anteprima (file locale con diritti di utilizzo)';
    previewView.musicInput.type = 'file';
    previewView.musicInput.accept = 'audio/*,.mp3,.m4a,.wav,.aac,.ogg,.flac';
    previewView.musicInput.addEventListener('change', () => {
      selectSoundtrack(previewView.musicInput.files?.[0]);
    });
    previewView.musicHelp.className = 'ol-muted ol-small';
    musicLabel.append(previewView.musicInput);
    musicRow.append(musicLabel, previewView.musicHelp);
    previewView.musicAudio.preload = 'metadata';
    previewView.meta.className = 'ol-vs-preview-meta';
    previewView.box.append(previewHeader, stage, musicRow, previewView.meta);
    realSummary.append(previewView.box);
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

    const view = {
      scene,
      index,
      card,
      state,
      image,
      actionButton,
      notesInput,
      prompt,
      promptBody,
      attempts: 0,
      result: null,
      error: '',
      running: false,
    };
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
    card.append(heading, lead, visual, subject, side, state, image, notesWrap, actions, prompt);
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
