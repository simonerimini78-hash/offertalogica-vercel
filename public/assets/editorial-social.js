(() => {
  "use strict";

  const VERSION = "0.12.8";
  const SESSION_KEY = "offertalogica.editorial.session.v1";
  const PLATFORMS = [
    { key: "facebook", label: "Facebook" },
    { key: "instagram", label: "Instagram" },
    { key: "threads", label: "Threads" },
    { key: "linkedin", label: "LinkedIn" }
  ];
  const STATUS_LABELS = {
    waiting_connection: "Canale da collegare",
    waiting_web: "Attende pagina online",
    ready: "Pronto",
    publishing: "Pubblicazione…",
    published: "Pubblicato",
    failed: "Errore",
    skipped: "Escluso"
  };

  const config = window.OFFERTALOGICA_EDITORIAL_CONFIG || {};
  const supabaseUrl = String(config.supabaseUrl || "").replace(/\/+$/, "");
  const supabaseKey = String(config.supabaseAnonKey || "").trim();
  const socialFunctionUrl = "/editorial-social-instagram";

  function sessionRead() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    } catch {
      return null;
    }
  }

  function socialErrorMessage(payload, status) {
    const base = payload?.error || payload?.message || `Errore HTTP ${status}`;
    const meta = payload?.meta || {};
    const details = [];
    if (meta?.message && meta.message !== base) details.push(`Meta: ${meta.message}`);
    if (meta?.code !== null && meta?.code !== undefined) details.push(`codice ${meta.code}`);
    if (meta?.subcode !== null && meta?.subcode !== undefined) details.push(`sottocodice ${meta.subcode}`);
    return details.length ? `${base} — ${details.join(", ")}` : base;
  }

  async function socialFunction(action, body = {}) {
    const session = sessionRead();
    if (!session?.access_token) throw new Error("Sessione editoriale non disponibile.");
    const response = await fetch(socialFunctionUrl, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action, ...body }),
      cache: "no-store"
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      const error = new Error(socialErrorMessage(payload, response.status));
      error.status = response.status;
      error.payload = payload;
      error.action = action;
      throw error;
    }
    return payload;
  }

  async function rpc(name, body = {}) {
    const session = sessionRead();
    if (!session?.access_token) throw new Error("Sessione editoriale non disponibile.");
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      cache: "no-store"
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.message || payload?.error_description || payload?.error || `Errore ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function createUi(form) {
    if (form.querySelector("[data-social-distribution]")) return form.querySelector("[data-social-distribution]");

    const fieldset = document.createElement("fieldset");
    fieldset.className = "ol-fieldset ol-social-fieldset";
    fieldset.dataset.socialDistribution = VERSION;
    fieldset.innerHTML = `
      <legend>Diffusione social</legend>
      <p class="ol-muted ol-small ol-social-intro">Quando l'articolo viene pubblicato, OffertaLogica prepara una coda separata per i social selezionati. Instagram viene elaborato automaticamente solo dopo che la pagina pubblica risulta online e pubblica l’articolo completo in un carosello leggibile.</p>
      <div class="ol-social-platform-grid" data-social-platforms></div>
      <div class="ol-social-feedback ol-small" data-social-feedback aria-live="polite"></div>
      <div class="ol-social-status" data-social-status hidden>
        <strong>Stato diffusione</strong>
        <div class="ol-social-status-list" data-social-status-list></div>
      </div>
      <p class="ol-muted ol-small">Instagram pubblica automaticamente l’articolo completo come carosello. Il link esatto all’articolo resta nella didascalia: su Instagram può non essere cliccabile, mentre il cross-post Facebook può renderlo utilizzabile. Threads e LinkedIn restano disattivati finché non vengono collegati.</p>`;

    const platformBox = fieldset.querySelector("[data-social-platforms]");
    PLATFORMS.forEach((platform) => {
      const label = document.createElement("label");
      label.className = "ol-social-platform";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = platform.key;
      input.dataset.socialPlatform = platform.key;
      input.checked = true;
      const copy = document.createElement("span");
      const strong = document.createElement("strong");
      strong.textContent = platform.label;
      const small = document.createElement("small");
      small.textContent = "Pubblica automaticamente";
      copy.append(strong, small);
      label.append(input, copy);
      platformBox.append(label);
    });

    const seoFieldset = form.querySelector("#review-seo-title")?.closest("fieldset");
    const noteFieldset = form.querySelector("#review-note")?.closest("fieldset");
    if (seoFieldset) seoFieldset.insertAdjacentElement("afterend", fieldset);
    else if (noteFieldset) noteFieldset.insertAdjacentElement("beforebegin", fieldset);
    else form.querySelector(".ol-review-actions")?.insertAdjacentElement("beforebegin", fieldset);
    return fieldset;
  }

  function selectedPlatforms(root) {
    return [...root.querySelectorAll("input[data-social-platform]:checked")].map((input) => input.value);
  }

  function setFeedback(root, message, state = "") {
    const node = root.querySelector("[data-social-feedback]");
    if (!node) return;
    node.textContent = message || "";
    node.dataset.state = state;
  }

  function renderChannels(root, channels = []) {
    const channelMap = new Map((channels || []).map((row) => [row.platform, row]));
    root.querySelectorAll("[data-social-platform]").forEach((input) => {
      const channel = channelMap.get(input.value);
      const wrapper = input.closest(".ol-social-platform");
      if (!wrapper) return;
      const small = wrapper.querySelector("small");
      if (small) small.textContent = channel?.enabled ? "Canale collegato" : "Canale da collegare";
      wrapper.dataset.connected = String(Boolean(channel?.enabled));
    });
  }

  function renderPublications(root, publications = [], platforms = []) {
    const box = root.querySelector("[data-social-status]");
    const list = root.querySelector("[data-social-status-list]");
    if (!box || !list) return;
    list.replaceChildren();
    const byPlatform = new Map((publications || []).map((row) => [row.platform, row]));
    PLATFORMS.forEach((platform) => {
      if (!platforms.includes(platform.key) && !byPlatform.has(platform.key)) return;
      const row = byPlatform.get(platform.key);
      const item = document.createElement("div");
      item.className = "ol-social-status-row";
      const label = document.createElement("span");
      label.textContent = platform.label;
      const state = document.createElement(row?.external_post_url ? "a" : "span");
      state.className = "ol-social-state";
      state.dataset.state = row?.status || "selected";
      state.textContent = row ? (STATUS_LABELS[row.status] || row.status) : "Selezionato";
      if (row?.external_post_url) {
        state.href = row.external_post_url;
        state.target = "_blank";
        state.rel = "noopener noreferrer";
      }
      item.append(label, state);
      if (row?.last_error) {
        const error = document.createElement("small");
        error.className = "ol-social-error";
        error.textContent = row.last_error;
        item.append(error);
      }
      list.append(item);
    });
    box.hidden = list.childElementCount === 0;
  }

  async function loadArticle(root, articleId, quiet = false) {
    if (!articleId) {
      root.querySelectorAll("input[data-social-platform]").forEach((input) => { input.checked = true; });
      renderPublications(root, [], selectedPlatforms(root));
      if (!quiet) setFeedback(root, "Le preferenze social saranno salvate dopo il primo salvataggio dell'articolo.");
      return null;
    }
    if (!quiet) setFeedback(root, "Caricamento diffusione social…");
    try {
      const payload = await rpc("editorial_social_article_get", { p_article_id: articleId });
      const platforms = Array.isArray(payload?.platforms) ? payload.platforms : [];
      root.querySelectorAll("input[data-social-platform]").forEach((input) => {
        input.checked = platforms.includes(input.value);
      });
      renderChannels(root, payload?.channels || []);
      renderPublications(root, payload?.publications || [], platforms);
      if (!quiet) setFeedback(root, "Preferenze social sincronizzate.", "ok");
      return payload;
    } catch (error) {
      const migrationMissing = error.status === 404 || /editorial_social_article_get|schema cache|function/i.test(error.message || "");
      if (!quiet) {
        setFeedback(root, migrationMissing ? "Diffusione social non ancora attivata: esegui prima la migrazione SQL v0.12.0." : `Diffusione social non disponibile: ${error.message}`, "error");
      }
      return null;
    }
  }

  function instagramSelectedAndConnected(root) {
    const input = root.querySelector('input[data-social-platform="instagram"]');
    const wrapper = input?.closest(".ol-social-platform");
    return Boolean(input?.checked && wrapper?.dataset.connected === "true");
  }

  const SOCIAL_SLIDE_WIDTH = 1080;
  const SOCIAL_SLIDE_HEIGHT = 1350;
  const SOCIAL_SLIDE_MAX = 10;
  const SOCIAL_SITE = "https://offertalogica.it";

  function absoluteEditorialLink(value = "") {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^https:\/\//i.test(raw)) {
      try {
        const url = new URL(raw);
        return url.protocol === "https:" ? url.href : "";
      } catch {
        return "";
      }
    }
    if (/^\/(?!\/)/.test(raw)) return `${SOCIAL_SITE}${raw}`;
    return "";
  }

  function readableInlineMarkdown(value = "") {
    return String(value || "")
      .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_match, label, href) => {
        const safe = absoluteEditorialLink(href);
        return safe ? `${label} (${safe})` : String(label || "");
      })
      .replace(/[*_`]+/g, "")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  function articleSlideBlocks(article = {}, author = {}) {
    const blocks = [];
    const content = String(article?.content || "").replace(/\r\n?/g, "\n").trim();
    const paragraphs = content.split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean);
    paragraphs.forEach((paragraph) => {
      if (/^###\s+/.test(paragraph)) {
        blocks.push({ kind: "subheading", text: readableInlineMarkdown(paragraph.replace(/^###\s+/, "")) });
        return;
      }
      if (/^##\s+/.test(paragraph)) {
        blocks.push({ kind: "heading", text: readableInlineMarkdown(paragraph.replace(/^##\s+/, "")) });
        return;
      }
      const lines = paragraph.split("\n").map((value) => value.trim()).filter(Boolean);
      const unordered = lines.length > 0 && lines.every((value) => /^[-*]\s+/.test(value));
      const ordered = lines.length > 0 && lines.every((value) => /^\d+[.)]\s+/.test(value));
      if (unordered || ordered) {
        lines.forEach((line) => {
          const marker = ordered ? line.match(/^\d+[.)]/)?.[0] || "•" : "•";
          const clean = line.replace(ordered ? /^\d+[.)]\s+/ : /^[-*]\s+/, "");
          blocks.push({ kind: "list", text: `${marker} ${readableInlineMarkdown(clean)}` });
        });
        return;
      }
      blocks.push({ kind: "body", text: readableInlineMarkdown(lines.join(" ")) });
    });

    const sources = String(article?.sources || "").replace(/\r\n?/g, "\n").split("\n").map((value) => value.trim()).filter(Boolean);
    if (sources.length) {
      blocks.push({ kind: "heading", text: "Fonti" });
      sources.forEach((source) => blocks.push({ kind: "list", text: `• ${readableInlineMarkdown(source)}` }));
    }

    const articleUrl = String(article?.article_url || "").trim();
    blocks.push({ kind: "heading", text: "Autore e riferimenti" });
    blocks.push({ kind: "body", text: `Autore: ${String(author?.display_name || "Redazione OffertaLogica").trim() || "Redazione OffertaLogica"}` });
    if (absoluteEditorialLink(author?.website_url)) blocks.push({ kind: "body", text: `Sito autore: ${absoluteEditorialLink(author.website_url)}` });
    if (absoluteEditorialLink(author?.linkedin_url)) blocks.push({ kind: "body", text: `LinkedIn: ${absoluteEditorialLink(author.linkedin_url)}` });
    if (articleUrl) blocks.push({ kind: "body", text: `Articolo originale: ${articleUrl}` });
    blocks.push({ kind: "body", text: "OffertaLogica.it" });
    return blocks.filter((block) => block.text);
  }

  function socialFont(kind, bodySize) {
    if (kind === "heading") return { size: bodySize + 13, weight: 800, lineHeight: bodySize + 25, marginTop: 26, marginBottom: 10 };
    if (kind === "subheading") return { size: bodySize + 7, weight: 750, lineHeight: bodySize + 19, marginTop: 22, marginBottom: 8 };
    if (kind === "list") return { size: bodySize, weight: 500, lineHeight: bodySize + 15, marginTop: 8, marginBottom: 5 };
    return { size: bodySize, weight: 500, lineHeight: bodySize + 15, marginTop: 11, marginBottom: 7 };
  }

  function canvasFont(size, weight = 500) {
    return `${weight} ${size}px Inter, "Segoe UI", Arial, sans-serif`;
  }

  function breakLongToken(ctx, token, maxWidth) {
    if (ctx.measureText(token).width <= maxWidth) return [token];
    const pieces = [];
    let piece = "";
    for (const char of token) {
      const next = piece + char;
      if (piece && ctx.measureText(next).width > maxWidth) {
        pieces.push(piece);
        piece = char;
      } else {
        piece = next;
      }
    }
    if (piece) pieces.push(piece);
    return pieces;
  }

  function wrapCanvasText(ctx, text, maxWidth) {
    const rawWords = String(text || "").split(/\s+/).filter(Boolean);
    const words = rawWords.flatMap((word) => breakLongToken(ctx, word, maxWidth));
    const lines = [];
    let line = "";
    words.forEach((word) => {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  function paginateArticleBlocks(blocks, bodySize) {
    const measure = document.createElement("canvas").getContext("2d");
    if (!measure) throw new Error("Canvas non disponibile nel browser.");
    const maxWidth = SOCIAL_SLIDE_WIDTH - 176;
    const top = 166;
    const bottom = SOCIAL_SLIDE_HEIGHT - 142;
    const pages = [];
    let page = [];
    let y = top;

    const flush = () => {
      if (page.length) pages.push(page);
      page = [];
      y = top;
    };

    blocks.forEach((block) => {
      const spec = socialFont(block.kind, bodySize);
      measure.font = canvasFont(spec.size, spec.weight);
      const lines = wrapCanvasText(measure, block.text, maxWidth - (block.kind === "list" ? 20 : 0));
      let index = 0;
      while (index < lines.length) {
        const leading = page.length ? spec.marginTop : 0;
        const available = bottom - y - leading - spec.marginBottom;
        const fit = Math.floor(available / spec.lineHeight);
        if (fit <= 0) {
          flush();
          continue;
        }
        const take = Math.min(fit, lines.length - index);
        page.push({ kind: block.kind, lines: lines.slice(index, index + take), spec, continued: index > 0 });
        y += leading + take * spec.lineHeight + spec.marginBottom;
        index += take;
        if (index < lines.length) flush();
      }
    });
    flush();
    return pages;
  }

  function fitArticlePages(blocks) {
    for (const size of [36, 34, 32, 30]) {
      const pages = paginateArticleBlocks(blocks, size);
      if (pages.length + 1 <= SOCIAL_SLIDE_MAX) return { pages, bodySize: size };
    }
    const minimum = paginateArticleBlocks(blocks, 30);
    throw new Error(`L'articolo richiede ${minimum.length + 1} slide: Instagram consente al massimo ${SOCIAL_SLIDE_MAX} elementi per questo carosello. Nessun contenuto è stato pubblicato o tagliato.`);
  }

  function drawSlideChrome(ctx, index, total) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, SOCIAL_SLIDE_WIDTH, SOCIAL_SLIDE_HEIGHT);
    ctx.fillStyle = "#0f7d33";
    ctx.fillRect(0, 0, SOCIAL_SLIDE_WIDTH, 24);
    ctx.font = canvasFont(30, 800);
    ctx.fillStyle = "#0f5132";
    ctx.fillText("OffertaLogica Informa", 88, 102);
    ctx.font = canvasFont(25, 650);
    ctx.fillStyle = "#64748b";
    ctx.textAlign = "right";
    ctx.fillText(`${index}/${total}`, SOCIAL_SLIDE_WIDTH - 88, 102);
    ctx.textAlign = "left";
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(88, SOCIAL_SLIDE_HEIGHT - 104, SOCIAL_SLIDE_WIDTH - 176, 2);
    ctx.font = canvasFont(25, 650);
    ctx.fillStyle = "#475569";
    ctx.fillText("offertalogica.it", 88, SOCIAL_SLIDE_HEIGHT - 58);
  }

  function drawTitleSlide(ctx, article, total) {
    const gradient = ctx.createLinearGradient(0, 0, SOCIAL_SLIDE_WIDTH, SOCIAL_SLIDE_HEIGHT);
    gradient.addColorStop(0, "#0f5132");
    gradient.addColorStop(0.58, "#0f7d33");
    gradient.addColorStop(1, "#23a83f");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, SOCIAL_SLIDE_WIDTH, SOCIAL_SLIDE_HEIGHT);
    ctx.fillStyle = "rgba(255,255,255,.16)";
    ctx.beginPath();
    ctx.arc(930, 170, 250, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = canvasFont(32, 800);
    ctx.fillStyle = "#ffffff";
    ctx.fillText("OffertaLogica Informa", 88, 126);

    const title = String(article?.title || "Approfondimento OffertaLogica").trim();
    const excerpt = String(article?.excerpt || "").trim();
    let titleSize = 66;
    let titleLines = [];
    while (titleSize >= 50) {
      ctx.font = canvasFont(titleSize, 850);
      titleLines = wrapCanvasText(ctx, title, SOCIAL_SLIDE_WIDTH - 176);
      if (titleLines.length <= 5) break;
      titleSize -= 4;
    }
    let y = 300;
    ctx.font = canvasFont(titleSize, 850);
    ctx.fillStyle = "#ffffff";
    titleLines.forEach((line) => {
      ctx.fillText(line, 88, y);
      y += titleSize + 14;
    });

    if (excerpt) {
      y += 34;
      ctx.font = canvasFont(34, 550);
      ctx.fillStyle = "#eaf8ef";
      const excerptLines = wrapCanvasText(ctx, excerpt, SOCIAL_SLIDE_WIDTH - 176).slice(0, 7);
      excerptLines.forEach((line) => {
        ctx.fillText(line, 88, y);
        y += 49;
      });
    }

    ctx.font = canvasFont(29, 750);
    ctx.fillStyle = "#ffffff";
    ctx.fillText("Articolo completo · scorri per leggere", 88, SOCIAL_SLIDE_HEIGHT - 122);
    ctx.textAlign = "right";
    ctx.fillText(`1/${total}`, SOCIAL_SLIDE_WIDTH - 88, SOCIAL_SLIDE_HEIGHT - 122);
    ctx.textAlign = "left";
  }

  function drawBodySlide(ctx, page, index, total) {
    drawSlideChrome(ctx, index, total);
    let y = 166;
    page.forEach((entry) => {
      const spec = entry.spec;
      if (y > 166) y += spec.marginTop;
      ctx.font = canvasFont(spec.size, spec.weight);
      ctx.fillStyle = entry.kind === "heading" || entry.kind === "subheading" ? "#0f5132" : "#1f2937";
      entry.lines.forEach((line) => {
        ctx.fillText(line, 88 + (entry.kind === "list" ? 12 : 0), y);
        y += spec.lineHeight;
      });
      y += spec.marginBottom;
    });
  }

  function canvasJpegData(canvas) {
    const value = canvas.toDataURL("image/jpeg", 0.86);
    if (!/^data:image\/jpeg;base64,/i.test(value)) throw new Error("Impossibile generare le immagini JPEG del carosello.");
    return value;
  }

  async function renderArticleCarousel(render = {}) {
    const article = render?.article || {};
    const author = render?.author || {};
    article.article_url = render?.article_url || article?.article_url || "";
    if (!String(article?.content || "").trim()) throw new Error("Il contenuto completo dell'articolo non è disponibile.");

    const blocks = articleSlideBlocks(article, author);
    const fitted = fitArticlePages(blocks);
    const total = fitted.pages.length + 1;
    const canvas = document.createElement("canvas");
    canvas.width = SOCIAL_SLIDE_WIDTH;
    canvas.height = SOCIAL_SLIDE_HEIGHT;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas non disponibile nel browser.");

    const slides = [];
    drawTitleSlide(ctx, article, total);
    slides.push({
      data_url: canvasJpegData(canvas),
      alt_text: `Copertina dell'articolo “${String(article.title || "").slice(0, 160)}” di OffertaLogica Informa.`
    });

    fitted.pages.forEach((page, pageIndex) => {
      drawBodySlide(ctx, page, pageIndex + 2, total);
      slides.push({
        data_url: canvasJpegData(canvas),
        alt_text: `Testo dell'articolo “${String(article.title || "").slice(0, 140)}”, slide ${pageIndex + 2} di ${total}.`
      });
    });
    return slides;
  }

  function queueFeedback(root, result) {
    switch (String(result?.result || "")) {
      case "waiting_web":
        setFeedback(root, "Instagram: attendo che la pagina pubblica dell'articolo sia online.");
        break;
      case "carousel_required":
        setFeedback(root, "Instagram: preparo il carosello con l'articolo completo.");
        break;
      case "published":
        setFeedback(root, "Instagram pubblicato automaticamente. Facebook riceverà il post tramite il cross-posting Meta configurato.", "ok");
        break;
      case "failed":
        setFeedback(root, `Instagram: tentativo non riuscito. ${result?.error || "Il sistema riproverà in modo controllato."}`, "error");
        break;
      case "retry_exhausted":
        setFeedback(root, "Instagram: tentativi automatici esauriti. È necessaria una verifica manuale.", "error");
        break;
      case "ambiguous_publish":
        setFeedback(root, "Instagram: esito della pubblicazione non verificabile. Il sistema NON riproverà automaticamente per evitare doppioni.", "error");
        break;
      case "legacy_queue":
      case "skipped":
      case "already_published":
      case "in_progress":
      case "not_queued":
      case "channel_disabled":
      default:
        break;
    }
  }

  async function processInstagramQueue(root, articleId, status) {
    if (!articleId || status !== "published" || document.hidden) return;
    if (root.dataset.instagramQueueBusy === "true") return;
    if (!instagramSelectedAndConnected(root)) return;

    root.dataset.instagramQueueBusy = "true";
    try {
      // Questa RPC fa anche scattare il refresh automatico della sessione se necessario.
      await rpc("editorial_social_article_get", { p_article_id: articleId });
      const prepared = await socialFunction("prepare_article_queue", { article_id: articleId });
      if (prepared?.result !== "needs_carousel") {
        queueFeedback(root, prepared);
        await loadArticle(root, articleId, true);
        return;
      }

      setFeedback(root, "Instagram: impagino l'articolo completo nel carosello…");
      const slides = await renderArticleCarousel(prepared);
      setFeedback(root, `Instagram: ${slides.length} slide pronte, avvio la pubblicazione…`);
      const result = await socialFunction("process_article_queue", { article_id: articleId, slides });
      queueFeedback(root, result);
      await loadArticle(root, articleId, true);
    } catch (error) {
      setFeedback(root, `Automazione Instagram non disponibile: ${error.message}`, "error");
    } finally {
      root.dataset.instagramQueueBusy = "false";
    }
  }

  async function saveArticle(root, articleId) {
    if (!articleId) {
      setFeedback(root, "Salva prima l'articolo: le preferenze social verranno associate automaticamente.");
      return;
    }
    const platforms = selectedPlatforms(root);
    setFeedback(root, "Salvataggio preferenze social…");
    try {
      const payload = await rpc("editorial_social_article_save", {
        p_article_id: articleId,
        p_platforms: platforms,
        p_custom_text: {}
      });
      renderChannels(root, payload?.channels || []);
      renderPublications(root, payload?.publications || [], payload?.platforms || platforms);
      setFeedback(root, "Preferenze social salvate.", "ok");
    } catch (error) {
      setFeedback(root, `Preferenze social non salvate: ${error.message}`, "error");
    }
  }

  function init() {
    if (document.body?.dataset?.editorialView !== "review") return;
    if (!/^https:\/\//i.test(supabaseUrl) || supabaseKey.length < 20) return;
    const form = document.querySelector("[data-review-form]");
    if (!form) return;
    const root = createUi(form);
    const idField = form.querySelector('input[name="id"]');
    const statusField = form.querySelector('input[name="status"]');
    if (!idField || !statusField) return;

    let currentId = "";
    let currentStatus = "";
    let saveTimer = null;
    let publishTimer = null;

    root.addEventListener("change", (event) => {
      if (!event.target.matches("input[data-social-platform]")) return;
      clearTimeout(saveTimer);
      saveTimer = window.setTimeout(async () => {
        await saveArticle(root, idField.value);
        if (statusField.value === "published") processInstagramQueue(root, idField.value, statusField.value);
      }, 220);
    });

    const scheduleProcess = (delay = 1200) => {
      clearTimeout(publishTimer);
      publishTimer = window.setTimeout(() => {
        processInstagramQueue(root, currentId, currentStatus);
      }, delay);
    };

    const sync = () => {
      const nextId = String(idField.value || "");
      const nextStatus = String(statusField.value || "");
      if (nextId !== currentId) {
        currentId = nextId;
        currentStatus = nextStatus;
        root.dataset.instagramQueueBusy = "false";
        loadArticle(root, currentId).then(() => {
          if (currentStatus === "published") scheduleProcess(800);
        });
        return;
      }
      if (nextStatus !== currentStatus) {
        currentStatus = nextStatus;
        if (currentId) {
          loadArticle(root, currentId).then(() => {
            if (currentStatus === "published") scheduleProcess(1200);
          });
        }
      }
    };

    sync();
    window.setInterval(sync, 700);
    window.setInterval(async () => {
      if (!currentId || currentStatus !== "published" || document.hidden) return;
      await loadArticle(root, currentId, true);
      processInstagramQueue(root, currentId, currentStatus);
    }, 15000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
