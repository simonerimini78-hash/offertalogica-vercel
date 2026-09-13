(() => {
  "use strict";

  const VERSION = "0.12.7";
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
      <p class="ol-muted ol-small ol-social-intro">Quando l'articolo viene pubblicato, OffertaLogica prepara una coda separata per i social selezionati. Instagram viene elaborato automaticamente solo dopo che la pagina pubblica risulta online.</p>
      <div class="ol-social-platform-grid" data-social-platforms></div>
      <div class="ol-social-feedback ol-small" data-social-feedback aria-live="polite"></div>
      <div class="ol-social-status" data-social-status hidden>
        <strong>Stato diffusione</strong>
        <div class="ol-social-status-list" data-social-status-list></div>
      </div>
      <p class="ol-muted ol-small">Instagram è collegato alla coda automatica. Facebook continua per ora tramite il cross-posting Meta dell'account Instagram; Threads e LinkedIn restano disattivati finché non vengono collegati.</p>`;

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

  function queueFeedback(root, result) {
    switch (String(result?.result || "")) {
      case "waiting_web":
        setFeedback(root, "Instagram: attendo che la pagina pubblica dell'articolo sia online.");
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
      const result = await socialFunction("process_article_queue", { article_id: articleId });
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
