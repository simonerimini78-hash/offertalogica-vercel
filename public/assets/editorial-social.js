(() => {
  "use strict";

  const VERSION = "0.12.4";
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

  function sessionRead() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    } catch {
      return null;
    }
  }

  async function socialFunction(action, body = {}) {
    const session = sessionRead();
    if (!session?.access_token) throw new Error("Sessione editoriale non disponibile.");
    const response = await fetch(`${supabaseUrl}/functions/v1/editorial-social-instagram`, {
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
      const message = payload?.error || payload?.message || `Errore ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
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
      <p class="ol-muted ol-small ol-social-intro">Quando l'articolo viene pubblicato, OffertaLogica prepara una coda separata per i social selezionati. Il post parte solo dopo che il relativo canale è stato collegato e la pagina pubblica è online.</p>
      <div class="ol-social-platform-grid" data-social-platforms></div>
      <div class="ol-social-feedback ol-small" data-social-feedback aria-live="polite"></div>
      <div class="ol-social-status" data-social-status hidden>
        <strong>Stato diffusione</strong>
        <div class="ol-social-status-list" data-social-status-list></div>
      </div>
      <div class="ol-toolbar ol-toolbar-compact" data-social-instagram-test-box>
        <button class="ol-button ol-button-secondary ol-button-small" type="button" data-social-instagram-test disabled>Pubblica test Instagram</button>
        <a class="ol-button ol-button-secondary ol-button-small" data-social-instagram-test-link target="_blank" rel="noopener noreferrer" hidden>Apri post di test</a>
      </div>
      <p class="ol-muted ol-small">Il test pubblica davvero un singolo post Instagram usando l'articolo selezionato. È disponibile solo per articoli già pubblicati e richiede il permesso di pubblicazione della Redazione.</p>`;

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

  async function loadArticle(root, articleId) {
    if (!articleId) {
      root.querySelectorAll("input[data-social-platform]").forEach((input) => { input.checked = true; });
      renderPublications(root, [], selectedPlatforms(root));
      setFeedback(root, "Le preferenze social saranno salvate dopo il primo salvataggio dell'articolo.");
      return;
    }
    setFeedback(root, "Caricamento diffusione social…");
    try {
      const payload = await rpc("editorial_social_article_get", { p_article_id: articleId });
      const platforms = Array.isArray(payload?.platforms) ? payload.platforms : [];
      root.querySelectorAll("input[data-social-platform]").forEach((input) => {
        input.checked = platforms.includes(input.value);
      });
      renderChannels(root, payload?.channels || []);
      renderPublications(root, payload?.publications || [], platforms);
      setFeedback(root, "Preferenze social sincronizzate.", "ok");
    } catch (error) {
      const migrationMissing = error.status === 404 || /editorial_social_article_get|schema cache|function/i.test(error.message || "");
      setFeedback(root, migrationMissing ? "Diffusione social non ancora attivata: esegui prima la migrazione SQL v0.12.0." : `Diffusione social non disponibile: ${error.message}`, "error");
    }
  }

  function setInstagramTestLink(link, permalink = "") {
    if (!link) return false;
    const safePermalink = /^https:\/\/(?:www\.)?instagram\.com\//i.test(String(permalink || "").trim());
    if (!safePermalink) {
      link.removeAttribute("href");
      link.hidden = true;
      return false;
    }
    link.href = String(permalink).trim();
    link.hidden = false;
    return true;
  }

  function updateInstagramTestButton(root, articleId, status) {
    const button = root.querySelector("[data-social-instagram-test]");
    if (!button) return;
    const instagramSelected = Boolean(root.querySelector('input[data-social-platform="instagram"]:checked'));
    button.disabled = !articleId || status !== "published" || !instagramSelected || button.dataset.busy === "true";
  }

  async function publishInstagramTest(root, articleId, status) {
    const button = root.querySelector("[data-social-instagram-test]");
    const link = root.querySelector("[data-social-instagram-test-link]");
    if (!button) return;
    if (!articleId || status !== "published") {
      setFeedback(root, "Il test Instagram richiede un articolo già pubblicato.", "error");
      return;
    }
    if (!window.confirm("Pubblicare ORA un post Instagram reale usando l'articolo selezionato?")) return;

    button.dataset.busy = "true";
    button.disabled = true;
    setInstagramTestLink(link);
    setFeedback(root, "Preparazione del post Instagram di test…");

    try {
      // Passa prima da una RPC editoriale: se il JWT è vicino alla scadenza,
      // editorial-config.js lo rinnova prima della chiamata alla Edge Function.
      await rpc("editorial_social_article_get", { p_article_id: articleId });

      const prepared = await socialFunction("prepare_article_test", { article_id: articleId });
      const creationId = String(prepared?.creation_id || "");
      if (!creationId) throw new Error("Instagram non ha restituito il contenitore del post.");

      setFeedback(root, "Instagram sta elaborando l'immagine…");
      let container = null;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        if (attempt > 0) await wait(1600);
        const statusPayload = await socialFunction("container_status", { creation_id: creationId });
        container = statusPayload?.container || null;
        if (container?.status_code === "FINISHED") break;
        if (["ERROR", "EXPIRED"].includes(container?.status_code)) {
          throw new Error(container?.status || "Instagram non ha elaborato il contenitore.");
        }
      }
      if (container?.status_code !== "FINISHED") {
        throw new Error("Instagram sta ancora elaborando l'immagine. Riprova tra poco.");
      }

      setFeedback(root, "Pubblicazione del post Instagram di test…");
      const published = await socialFunction("publish_container_test", {
        creation_id: creationId,
        article_id: articleId,
        confirm: "PUBLISH_INSTAGRAM_TEST"
      });
      const permalink = String(published?.media?.permalink || "");
      const hasPermalink = setInstagramTestLink(link, permalink);
      setFeedback(
        root,
        hasPermalink
          ? "Post Instagram di test pubblicato correttamente."
          : "Post Instagram pubblicato, ma Meta non ha restituito un permalink apribile.",
        "ok"
      );
    } catch (error) {
      setFeedback(root, `Test Instagram non pubblicato: ${error.message}`, "error");
    } finally {
      button.dataset.busy = "false";
      updateInstagramTestButton(root, articleId, status);
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

    root.addEventListener("change", (event) => {
      if (!event.target.matches("input[data-social-platform]")) return;
      clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => saveArticle(root, idField.value), 220);
      updateInstagramTestButton(root, idField.value, statusField.value);
    });

    root.querySelector("[data-social-instagram-test]")?.addEventListener("click", () => {
      publishInstagramTest(root, idField.value, statusField.value);
    });

    const sync = () => {
      const nextId = String(idField.value || "");
      const nextStatus = String(statusField.value || "");
      if (nextId !== currentId) {
        currentId = nextId;
        currentStatus = nextStatus;
        loadArticle(root, currentId);
        updateInstagramTestButton(root, currentId, currentStatus);
        return;
      }
      if (nextStatus !== currentStatus) {
        currentStatus = nextStatus;
        if (currentId) loadArticle(root, currentId);
      }
      updateInstagramTestButton(root, currentId, currentStatus);
    };

    sync();
    window.setInterval(sync, 700);
    window.setInterval(() => {
      if (currentId && currentStatus === "published" && !document.hidden) loadArticle(root, currentId);
    }, 15000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
