(() => {
  "use strict";

  const VERSION = "0.12.12";
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
      <p class="ol-muted ol-small ol-social-intro">Quando l'articolo viene pubblicato, OffertaLogica prepara una coda separata per i social selezionati. Instagram viene elaborato automaticamente solo dopo che la pagina pubblica risulta online: se il testo entra in un solo carosello viene mantenuto integralmente, altrimenti viene creata una sintesi autosufficiente dei punti chiave.</p>
      <div class="ol-social-platform-grid" data-social-platforms></div>
      <div class="ol-social-feedback ol-small" data-social-feedback aria-live="polite"></div>
      <div class="ol-social-status" data-social-status hidden>
        <strong>Stato diffusione</strong>
        <div class="ol-social-status-list" data-social-status-list></div>
      </div>
      <p class="ol-muted ol-small">Instagram usa un solo carosello per articolo: testo integrale quando è leggibile entro il limite, sintesi dei punti chiave quando l’articolo è più lungo. La copertina usa l’immagine dell’articolo con stile elegante e vetro/fluid glass, con indicatore di scorrimento più visibile anche da mobile; il link esatto all’articolo, l’autore e i relativi riferimenti restano nella didascalia. Threads e LinkedIn restano disattivati finché non vengono collegati.</p>`;

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

  function articleContentBlocks(article = {}) {
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
    return blocks.filter((block) => block.text);
  }

  function articleReferenceBlocks(article = {}, author = {}) {
    const blocks = [];
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

  function articleSlideBlocks(article = {}, author = {}) {
    return [...articleContentBlocks(article), ...articleReferenceBlocks(article, author)];
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

  function fitFullArticlePages(blocks) {
    let minimum = [];
    for (const size of [36, 34, 32, 30]) {
      const pages = paginateArticleBlocks(blocks, size);
      minimum = pages;
      if (pages.length + 1 <= SOCIAL_SLIDE_MAX) {
        return { fits: true, pages, bodySize: size, requiredSlides: pages.length + 1 };
      }
    }
    return { fits: false, pages: minimum, bodySize: 30, requiredSlides: minimum.length + 1 };
  }

  function sentenceParts(value = "") {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return [];
    try {
      if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
        const segmenter = new Intl.Segmenter("it", { granularity: "sentence" });
        return [...segmenter.segment(text)].map((part) => String(part.segment || "").trim()).filter(Boolean);
      }
    } catch {
      // Fallback deterministico sotto.
    }
    return (text.match(/[^.!?]+(?:[.!?]+|$)/g) || [text]).map((part) => part.trim()).filter(Boolean);
  }

  function keywordSet(value = "") {
    const stop = new Set(["della", "delle", "degli", "dello", "dalla", "dalle", "dagli", "dallo", "nella", "nelle", "negli", "nello", "alla", "alle", "agli", "allo", "anche", "come", "cosa", "sono", "essere", "questo", "questa", "quello", "quella", "dopo", "prima", "quando", "dove", "perché", "perche", "quindi", "oppure", "senza", "sulla", "sulle", "sugli", "sullo", "nelle", "agli", "offertalogica"]);
    return new Set(String(value || "").toLocaleLowerCase("it-IT").normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]{4,}/g)?.filter((word) => !stop.has(word)) || []);
  }

  function sentenceScore(sentence, index, keywords) {
    const normalized = String(sentence || "").toLocaleLowerCase("it-IT").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    let score = index === 0 ? 4 : Math.max(0, 2 - index * 0.15);
    if (/[0-9€%]/.test(sentence)) score += 2;
    if (/\b(non|deve|devono|puo|possono|attenzione|importante|obbligo|diritto|prezzo|costo|durata|scadenza|recesso|garanzia|verifica|controll|condizion)\w*/i.test(normalized)) score += 1.5;
    keywords.forEach((keyword) => {
      if (normalized.includes(keyword)) score += 0.7;
    });
    return score;
  }

  function shortenAtWord(value = "", maxChars = 500) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= maxChars) return text;
    const slice = text.slice(0, Math.max(1, maxChars - 1));
    const boundary = slice.lastIndexOf(" ");
    return `${(boundary > maxChars * 0.65 ? slice.slice(0, boundary) : slice).trimEnd()}…`;
  }

  function contentSections(article = {}) {
    const blocks = articleContentBlocks(article);
    const sections = [];
    let current = { heading: "", headingKind: "heading", blocks: [] };
    const flush = () => {
      if (current.heading || current.blocks.length) sections.push(current);
      current = { heading: "", headingKind: "heading", blocks: [] };
    };
    blocks.forEach((block) => {
      if (block.kind === "heading" || block.kind === "subheading") {
        flush();
        current.heading = block.text;
        current.headingKind = block.kind;
      } else {
        current.blocks.push(block);
      }
    });
    flush();
    return sections;
  }

  function digestBlocks(article = {}, detail = {}) {
    const sections = contentSections(article);
    const titleKeywords = keywordSet(article?.title || "");
    const out = [];
    sections.forEach((section, sectionIndex) => {
      const heading = section.heading || (sectionIndex === 0 ? "In breve" : "");
      if (heading) out.push({ kind: section.headingKind || "heading", text: shortenAtWord(heading, 120) });

      const bodySentences = [];
      section.blocks.filter((block) => block.kind === "body").forEach((block) => {
        sentenceParts(block.text).forEach((sentence) => bodySentences.push(sentence));
      });
      if (bodySentences.length) {
        const keywords = new Set([...titleKeywords, ...keywordSet(heading)]);
        const ranked = bodySentences.map((sentence, index) => ({ sentence, index, score: sentenceScore(sentence, index, keywords) }));
        ranked.sort((a, b) => b.score - a.score || a.index - b.index);
        const selected = ranked.slice(0, Math.max(1, detail.sentencesPerSection || 1)).sort((a, b) => a.index - b.index);
        const summary = shortenAtWord(selected.map((item) => item.sentence).join(" "), detail.bodyChars || 480);
        if (summary) out.push({ kind: "body", text: summary });
      }

      const lists = section.blocks.filter((block) => block.kind === "list");
      lists.slice(0, Math.max(0, detail.listItemsPerSection || 0)).forEach((block) => {
        out.push({ kind: "list", text: shortenAtWord(block.text, detail.listChars || 170) });
      });
    });
    return out.filter((block) => block.text);
  }

  function fitDigestPages(article = {}) {
    const strategies = [
      { sentencesPerSection: 2, listItemsPerSection: 3, bodyChars: 620, listChars: 190, sizes: [34, 32] },
      { sentencesPerSection: 2, listItemsPerSection: 2, bodyChars: 520, listChars: 170, sizes: [32, 30] },
      { sentencesPerSection: 1, listItemsPerSection: 2, bodyChars: 430, listChars: 155, sizes: [32, 30] },
      { sentencesPerSection: 1, listItemsPerSection: 1, bodyChars: 340, listChars: 140, sizes: [30] }
    ];
    for (const strategy of strategies) {
      const blocks = digestBlocks(article, strategy);
      for (const size of strategy.sizes) {
        const pages = paginateArticleBlocks(blocks, size);
        if (pages.length <= SOCIAL_SLIDE_MAX - 2) return { pages, bodySize: size };
      }
    }
    throw new Error("L'articolo è troppo articolato per produrre automaticamente una sintesi leggibile in un solo carosello. Nessun contenuto è stato pubblicato.");
  }

  function sourceLabel(value = "") {
    let text = String(value || "").trim().replace(/^[-*]\s+/, "");
    text = text.replace(/\[([^\]\n]+)\]\(([^)]+)\)/g, "$1");
    text = text.replace(/https?:\/\/[^\s)]+/gi, (raw) => {
      try {
        return new URL(raw).hostname.replace(/^www\./, "");
      } catch {
        return "fonte online";
      }
    });
    return shortenAtWord(readableInlineMarkdown(text), 150);
  }

  function compactReferenceBlocks(article = {}, author = {}, maxSources = 4) {
    const blocks = [{ kind: "heading", text: "Fonti e riferimenti" }];
    const sources = String(article?.sources || "").replace(/\r\n?/g, "\n").split("\n").map(sourceLabel).filter(Boolean);
    sources.slice(0, maxSources).forEach((source) => blocks.push({ kind: "list", text: `• ${source}` }));
    if (sources.length > maxSources) blocks.push({ kind: "body", text: `Altre ${sources.length - maxSources} fonti sono elencate nell'articolo originale.` });
    const authorName = String(author?.display_name || "Redazione OffertaLogica").trim() || "Redazione OffertaLogica";
    blocks.push({ kind: "body", text: `Autore: ${authorName}` });
    if (absoluteEditorialLink(author?.website_url)) blocks.push({ kind: "body", text: `Sito autore: ${absoluteEditorialLink(author.website_url)}` });
    if (absoluteEditorialLink(author?.linkedin_url)) blocks.push({ kind: "body", text: `LinkedIn: ${absoluteEditorialLink(author.linkedin_url)}` });
    const articleUrl = String(article?.article_url || "").trim();
    if (articleUrl) blocks.push({ kind: "body", text: `Articolo originale: ${articleUrl}` });
    blocks.push({ kind: "body", text: "OffertaLogica.it" });
    return blocks;
  }

  function fitReferencePage(article = {}, author = {}) {
    for (const maxSources of [4, 3, 2]) {
      const blocks = compactReferenceBlocks(article, author, maxSources);
      for (const size of [28, 26, 24]) {
        const pages = paginateArticleBlocks(blocks, size);
        if (pages.length === 1) return { page: pages[0], bodySize: size };
      }
    }
    throw new Error("I riferimenti dell'articolo non entrano in modo leggibile nella slide finale. Nessun contenuto è stato pubblicato.");
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

  function roundedRectPath(ctx, x, y, width, height, radius) {
    const safe = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
    ctx.beginPath();
    ctx.moveTo(x + safe, y);
    ctx.lineTo(x + width - safe, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + safe);
    ctx.lineTo(x + width, y + height - safe);
    ctx.quadraticCurveTo(x + width, y + height, x + width - safe, y + height);
    ctx.lineTo(x + safe, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - safe);
    ctx.lineTo(x, y + safe);
    ctx.quadraticCurveTo(x, y, x + safe, y);
    ctx.closePath();
  }

  function fillRoundedRect(ctx, x, y, width, height, radius, fillStyle) {
    ctx.save();
    roundedRectPath(ctx, x, y, width, height, radius);
    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.restore();
  }

  function strokeRoundedRect(ctx, x, y, width, height, radius, strokeStyle, lineWidth = 1) {
    ctx.save();
    roundedRectPath(ctx, x, y, width, height, radius);
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
    ctx.restore();
  }

  function fitCoverImage(image) {
    const scale = Math.max(SOCIAL_SLIDE_WIDTH / image.width, SOCIAL_SLIDE_HEIGHT / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    const x = (SOCIAL_SLIDE_WIDTH - width) / 2;
    const y = (SOCIAL_SLIDE_HEIGHT - height) / 2;
    return { x, y, width, height };
  }

  function loadImageAsset(src) {
    return new Promise((resolve, reject) => {
      if (!src) {
        reject(new Error("Asset immagine mancante"));
        return;
      }
      const image = new Image();
      image.decoding = "async";
      try {
        const target = new URL(src, window.location.origin);
        if (target.origin !== window.location.origin) image.crossOrigin = "anonymous";
        image.src = target.href;
      } catch {
        image.src = src;
      }
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Impossibile caricare l'immagine ${src}`));
    });
  }

  async function loadCoverAssets(article = {}) {
    const featuredSource = String(article?.featured_image_url || "").trim();
    const logoSource = "/assets/logo-offertalogica-header.png";
    const [featuredImage, logoImage] = await Promise.all([
      featuredSource ? loadImageAsset(featuredSource).catch(() => null) : Promise.resolve(null),
      loadImageAsset(logoSource).catch(() => null)
    ]);
    return { featuredImage, logoImage };
  }

  function coverFallbackBackground(ctx) {
    const gradient = ctx.createLinearGradient(0, 0, SOCIAL_SLIDE_WIDTH, SOCIAL_SLIDE_HEIGHT);
    gradient.addColorStop(0, "#0f172a");
    gradient.addColorStop(0.46, "#18304c");
    gradient.addColorStop(1, "#32556f");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, SOCIAL_SLIDE_WIDTH, SOCIAL_SLIDE_HEIGHT);
    fillRoundedRect(ctx, 720, 82, 252, 252, 58, "rgba(255,255,255,.08)");
    fillRoundedRect(ctx, 782, 176, 190, 190, 48, "rgba(255,255,255,.08)");
  }

  function drawCoverBackdrop(ctx, featuredImage) {
    if (featuredImage && featuredImage.width > 0 && featuredImage.height > 0) {
      const fit = fitCoverImage(featuredImage);
      ctx.drawImage(featuredImage, fit.x, fit.y, fit.width, fit.height);
    } else {
      coverFallbackBackground(ctx);
    }
    const overlay = ctx.createLinearGradient(0, 0, 0, SOCIAL_SLIDE_HEIGHT);
    overlay.addColorStop(0, "rgba(8,16,26,.20)");
    overlay.addColorStop(0.48, "rgba(8,16,26,.34)");
    overlay.addColorStop(1, "rgba(8,16,26,.78)");
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, SOCIAL_SLIDE_WIDTH, SOCIAL_SLIDE_HEIGHT);
    ctx.fillStyle = "rgba(255,255,255,.10)";
    ctx.beginPath();
    ctx.arc(956, 176, 198, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.06)";
    ctx.beginPath();
    ctx.arc(838, 272, 120, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawGlassPanel(ctx, x, y, width, height, radius = 34) {
    fillRoundedRect(ctx, x, y, width, height, radius, "rgba(255,255,255,.14)");
    fillRoundedRect(ctx, x + 2, y + 2, width - 4, height - 4, Math.max(radius - 2, 0), "rgba(255,255,255,.07)");
    strokeRoundedRect(ctx, x, y, width, height, radius, "rgba(255,255,255,.28)", 2);
  }

  function drawBrandBadge(ctx, logoImage) {
    drawGlassPanel(ctx, 72, 70, 498, 132, 34);
    if (logoImage && logoImage.width > 0 && logoImage.height > 0) {
      const maxWidth = 210;
      const maxHeight = 54;
      const ratio = Math.min(maxWidth / logoImage.width, maxHeight / logoImage.height);
      const width = logoImage.width * ratio;
      const height = logoImage.height * ratio;
      ctx.drawImage(logoImage, 104, 96, width, height);
    } else {
      ctx.font = canvasFont(30, 850);
      ctx.fillStyle = "#ffffff";
      ctx.fillText("OffertaLogica", 104, 132);
    }
    ctx.font = canvasFont(20, 750);
    ctx.fillStyle = "rgba(255,255,255,.84)";
    ctx.fillText("OffertaLogica Informa", 104, 166);
  }

  function drawMetaPill(ctx, total, presentationMode) {
    drawGlassPanel(ctx, SOCIAL_SLIDE_WIDTH - 294, 82, 206, 82, 28);
    ctx.font = canvasFont(24, 780);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(`1/${total}`, SOCIAL_SLIDE_WIDTH - 191, 116);
    ctx.font = canvasFont(16, 700);
    ctx.fillStyle = "rgba(255,255,255,.80)";
    ctx.fillText(presentationMode === "summary" ? "sintesi" : "articolo", SOCIAL_SLIDE_WIDTH - 191, 144);
    ctx.textAlign = "left";
  }


  function drawSwipeArrow(ctx, x, y, width, height) {
    const centerY = y + (height / 2);
    const startX = x + 28;
    const endX = x + width - 34;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 7;
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(startX, centerY);
    ctx.lineTo(endX - 24, centerY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(endX - 42, centerY - 18);
    ctx.lineTo(endX - 12, centerY);
    ctx.lineTo(endX - 42, centerY + 18);
    ctx.stroke();
    ctx.restore();
  }

  function drawSwipeCta(ctx, x, y) {
    const width = 308;
    const height = 88;
    drawGlassPanel(ctx, x, y, width, height, 24);
    ctx.font = canvasFont(18, 760);
    ctx.fillStyle = "rgba(255,255,255,.82)";
    ctx.fillText("SCORRI", x + 28, y + 30);
    ctx.font = canvasFont(26, 760);
    ctx.fillStyle = "#ffffff";
    ctx.fillText("Vai alle slide", x + 28, y + 61);
    drawSwipeArrow(ctx, x + width - 98, y + 19, 58, 50);
  }

  async function drawTitleSlide(ctx, article, total, presentationMode = "full") {
    const { featuredImage, logoImage } = await loadCoverAssets(article);
    drawCoverBackdrop(ctx, featuredImage);
    drawBrandBadge(ctx, logoImage);
    drawMetaPill(ctx, total, presentationMode);

    const cardX = 72;
    const cardY = 650;
    const cardWidth = SOCIAL_SLIDE_WIDTH - 144;
    const cardHeight = 596;
    drawGlassPanel(ctx, cardX, cardY, cardWidth, cardHeight, 40);

    const title = String(article?.title || "Approfondimento OffertaLogica").trim();
    const excerpt = String(article?.excerpt || "").trim();
    let titleSize = 58;
    let titleLines = [];
    while (titleSize >= 42) {
      ctx.font = canvasFont(titleSize, 850);
      titleLines = wrapCanvasText(ctx, title, cardWidth - 84);
      if (titleLines.length <= 4) break;
      titleSize -= 4;
    }

    let y = cardY + 90;
    ctx.font = canvasFont(18, 760);
    ctx.fillStyle = "rgba(255,255,255,.82)";
    ctx.fillText("OFFERTALOGICA INFORMA", cardX + 42, y);
    y += 50;

    ctx.font = canvasFont(titleSize, 850);
    ctx.fillStyle = "#ffffff";
    titleLines.forEach((line) => {
      ctx.fillText(line, cardX + 42, y);
      y += titleSize + 14;
    });

    if (excerpt) {
      y += 22;
      ctx.font = canvasFont(30, 560);
      ctx.fillStyle = "rgba(244,248,252,.95)";
      const excerptLines = wrapCanvasText(ctx, excerpt, cardWidth - 84).slice(0, 4);
      excerptLines.forEach((line) => {
        ctx.fillText(line, cardX + 42, y);
        y += 42;
      });
    }

    y = Math.min(y + 30, cardY + 448);
    fillRoundedRect(ctx, cardX + 42, y, 356, 56, 18, "rgba(255,255,255,.20)");
    ctx.font = canvasFont(22, 750);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(presentationMode === "summary" ? "Sintesi dei punti chiave" : "Articolo completo", cardX + 64, y + 36);

    drawSwipeCta(ctx, cardX + 42, cardY + cardHeight - 148);

    ctx.font = canvasFont(20, 640);
    ctx.fillStyle = "rgba(255,255,255,.88)";
    ctx.fillText("Scorri per leggere", cardX + 42, cardY + cardHeight - 20);
    ctx.textAlign = "right";
    ctx.fillText("offertalogica.it", cardX + cardWidth - 42, cardY + cardHeight - 20);
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
    if (!String(article?.content || "").trim()) throw new Error("Il contenuto dell'articolo non è disponibile.");

    const fullBlocks = articleSlideBlocks(article, author);
    const full = fitFullArticlePages(fullBlocks);
    let pages = full.pages;
    let presentationMode = "full";
    let referencePage = null;

    if (!full.fits) {
      presentationMode = "summary";
      const digest = fitDigestPages(article);
      const references = fitReferencePage(article, author);
      pages = digest.pages;
      referencePage = references.page;
    }

    const total = 1 + pages.length + (referencePage ? 1 : 0);
    if (total > SOCIAL_SLIDE_MAX) throw new Error(`Il carosello richiede ${total} slide dopo l'adattamento. Nessun contenuto è stato pubblicato.`);

    const canvas = document.createElement("canvas");
    canvas.width = SOCIAL_SLIDE_WIDTH;
    canvas.height = SOCIAL_SLIDE_HEIGHT;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas non disponibile nel browser.");

    const slides = [];
    await drawTitleSlide(ctx, article, total, presentationMode);
    slides.push({
      data_url: canvasJpegData(canvas),
      alt_text: `Copertina dell'articolo “${String(article.title || "").slice(0, 160)}” di OffertaLogica Informa.`
    });

    pages.forEach((page, pageIndex) => {
      drawBodySlide(ctx, page, pageIndex + 2, total);
      slides.push({
        data_url: canvasJpegData(canvas),
        alt_text: presentationMode === "summary"
          ? `Sintesi dell'articolo “${String(article.title || "").slice(0, 130)}”, slide ${pageIndex + 2} di ${total}.`
          : `Testo dell'articolo “${String(article.title || "").slice(0, 140)}”, slide ${pageIndex + 2} di ${total}.`
      });
    });

    if (referencePage) {
      drawBodySlide(ctx, referencePage, total, total);
      slides.push({
        data_url: canvasJpegData(canvas),
        alt_text: `Fonti, autore e riferimenti dell'articolo “${String(article.title || "").slice(0, 130)}”.`
      });
    }

    return {
      slides,
      presentation_mode: presentationMode,
      original_slide_estimate: full.requiredSlides
    };
  }

  function queueFeedback(root, result) {
    switch (String(result?.result || "")) {
      case "waiting_web":
        setFeedback(root, "Instagram: attendo che la pagina pubblica dell'articolo sia online.");
        break;
      case "carousel_required":
        setFeedback(root, "Instagram: preparo il carosello dell'articolo.");
        break;
      case "published":
        setFeedback(root, result?.presentation_mode === "summary" ? "Instagram pubblicato automaticamente come sintesi dei punti chiave. Facebook riceverà il post tramite il cross-posting Meta configurato." : "Instagram pubblicato automaticamente con l’articolo completo. Facebook riceverà il post tramite il cross-posting Meta configurato.", "ok");
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

      setFeedback(root, "Instagram: preparo un unico carosello leggibile…");
      const rendered = await renderArticleCarousel(prepared);
      const slides = rendered.slides;
      if (rendered.presentation_mode === "summary") {
        setFeedback(root, `Instagram: l'articolo richiederebbe circa ${rendered.original_slide_estimate} slide; preparo una sintesi autosufficiente in ${slides.length} slide.`);
      } else {
        setFeedback(root, `Instagram: articolo completo in ${slides.length} slide, avvio la pubblicazione…`);
      }
      const result = await socialFunction("process_article_queue", {
        article_id: articleId,
        slides,
        presentation_mode: rendered.presentation_mode
      });
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
