(() => {
  "use strict";

  const VERSION = "0.12.16";
  const SESSION_KEY = "offertalogica.editorial.session.v1";
  const FUNCTION_URL = "/editorial-social-facebook";
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
  let busy = false;
  let intervalId = null;
  let watcherId = null;
  let lastArticleState = "";
  let feedbackObserver = null;

  function sessionRead() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    } catch {
      return null;
    }
  }

  function errorMessage(payload, status) {
    const base = payload?.error || payload?.message || `Errore HTTP ${status}`;
    const meta = payload?.meta || {};
    const details = [];
    if (meta?.message && meta.message !== base) details.push(`Meta: ${meta.message}`);
    if (meta?.code !== null && meta?.code !== undefined) details.push(`codice ${meta.code}`);
    if (meta?.subcode !== null && meta?.subcode !== undefined) details.push(`sottocodice ${meta.subcode}`);
    return details.length ? `${base} — ${details.join(", ")}` : base;
  }

  async function facebookFunction(action, body = {}) {
    const session = sessionRead();
    if (!session?.access_token) throw new Error("Sessione editoriale non disponibile.");
    const response = await fetch(FUNCTION_URL, {
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
      const error = new Error(errorMessage(payload, response.status));
      error.status = response.status;
      error.payload = payload;
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
      throw new Error(payload?.message || payload?.error_description || payload?.error || `Errore ${response.status}`);
    }
    return payload;
  }

  function socialRoot() {
    return document.querySelector("[data-social-distribution]");
  }

  function articleState() {
    const articleId = String(document.querySelector("#review-article-id")?.value || "").trim();
    const status = String(document.querySelector("#review-article-status")?.value || "").trim();
    return { articleId, status };
  }

  function facebookInput(root) {
    return root?.querySelector('input[data-social-platform="facebook"]') || null;
  }

  function facebookSelected(root) {
    return Boolean(facebookInput(root)?.checked);
  }

  function facebookConnected(root) {
    const input = facebookInput(root);
    return input?.closest(".ol-social-platform")?.dataset.connected === "true";
  }

  function setFeedback(root, message, state = "") {
    const node = root?.querySelector("[data-social-feedback]");
    if (!node) return;
    node.textContent = message || "";
    node.dataset.state = state;
  }

  function sanitizeLegacyCrossPostFeedback(root) {
    const node = root?.querySelector("[data-social-feedback]");
    if (!node) return;
    const text = String(node.textContent || "");
    if (!/Facebook riceverà il post tramite il cross-posting Meta configurato\.?/i.test(text)) return;
    node.textContent = text
      .replace(/\s*Facebook riceverà il post tramite il cross-posting Meta configurato\.?/gi, "")
      .trim();
  }

  function publicationForFacebook(payload) {
    return (Array.isArray(payload?.publications) ? payload.publications : [])
      .find((row) => row?.platform === "facebook") || null;
  }

  function syncFacebookStatus(root, payload) {
    const row = publicationForFacebook(payload);
    const selected = Array.isArray(payload?.platforms) && payload.platforms.includes("facebook");
    const box = root?.querySelector("[data-social-status]");
    const list = root?.querySelector("[data-social-status-list]");
    if (!box || !list || (!selected && !row)) return;

    let item = [...list.querySelectorAll(".ol-social-status-row")]
      .find((candidate) => candidate.querySelector("span")?.textContent === "Facebook");

    if (!item) {
      item = document.createElement("div");
      item.className = "ol-social-status-row";
      const label = document.createElement("span");
      label.textContent = "Facebook";
      const state = document.createElement("span");
      state.className = "ol-social-state";
      item.append(label, state);
      list.prepend(item);
    }

    const oldState = item.querySelector(".ol-social-state");
    const nextState = document.createElement(row?.external_post_url ? "a" : "span");
    nextState.className = "ol-social-state";
    nextState.dataset.state = row?.status || "selected";
    nextState.textContent = row ? (STATUS_LABELS[row.status] || row.status) : "Selezionato";
    if (row?.external_post_url) {
      nextState.href = row.external_post_url;
      nextState.target = "_blank";
      nextState.rel = "noopener noreferrer";
    }
    oldState?.replaceWith(nextState);

    item.querySelector(".ol-social-error")?.remove();
    if (row?.last_error) {
      const error = document.createElement("small");
      error.className = "ol-social-error";
      error.textContent = row.last_error;
      item.append(error);
    }
    box.hidden = false;
  }

  async function currentSocialPayload(articleId) {
    return rpc("editorial_social_article_get", { p_article_id: articleId });
  }

  async function processFacebookQueue() {
    const root = socialRoot();
    if (!root || busy || document.visibilityState !== "visible") return;

    const { articleId, status } = articleState();
    if (!articleId || status !== "published" || !facebookSelected(root)) return;

    busy = true;
    try {
      const before = await currentSocialPayload(articleId);
      syncFacebookStatus(root, before);
      const channel = (Array.isArray(before?.channels) ? before.channels : [])
        .find((row) => row?.platform === "facebook");
      if (!channel?.enabled || !facebookConnected(root)) return;

      const publication = publicationForFacebook(before);
      if (publication?.status === "published" || publication?.status === "skipped") return;
      if (publication?.status === "publishing" && /^ESITO INCERTO:/i.test(publication?.last_error || "")) return;

      const result = await facebookFunction("process_article_queue", { article_id: articleId });
      const after = await currentSocialPayload(articleId).catch(() => null);
      if (after) syncFacebookStatus(root, after);

      if (result?.status === "published") {
        setFeedback(root, "Facebook pubblicato direttamente sulla Pagina OffertaLogica con link cliccabile all’articolo.", "ok");
      } else if (result?.status === "waiting_web") {
        setFeedback(root, "Facebook attende che la pagina pubblica dell’articolo sia online.");
      } else if (result?.status === "ambiguous_publish") {
        setFeedback(root, "Facebook: esito della pubblicazione incerto. Il sistema non ritenterà automaticamente per evitare duplicati.", "error");
      } else if (result?.status === "failed" || result?.status === "retry_exhausted") {
        setFeedback(root, `Facebook non pubblicato: ${result?.error || result?.last_error || "errore non specificato"}.`, "error");
      }
    } catch (error) {
      setFeedback(root, `Facebook non disponibile: ${error.message}`, "error");
    } finally {
      busy = false;
    }
  }

  function attachFeedbackGuard(root) {
    if (feedbackObserver) return;
    const node = root.querySelector("[data-social-feedback]");
    if (!node) return;
    feedbackObserver = new MutationObserver(() => sanitizeLegacyCrossPostFeedback(root));
    feedbackObserver.observe(node, { childList: true, characterData: true, subtree: true });
    sanitizeLegacyCrossPostFeedback(root);
  }

  function scheduleProcess(delay = 500) {
    window.setTimeout(() => {
      processFacebookQueue().catch(() => {});
    }, delay);
  }

  function bindRoot(root) {
    if (root.dataset.facebookPublisherBound === VERSION) return;
    root.dataset.facebookPublisherBound = VERSION;
    attachFeedbackGuard(root);
    root.addEventListener("change", (event) => {
      if (event.target?.matches?.('input[data-social-platform="facebook"]')) scheduleProcess(900);
    });
    scheduleProcess(700);
  }

  function tick() {
    const root = socialRoot();
    if (root) bindRoot(root);
    const { articleId, status } = articleState();
    const stateKey = `${articleId}:${status}`;
    if (stateKey !== lastArticleState) {
      lastArticleState = stateKey;
      scheduleProcess(650);
    }
  }

  function init() {
    if (!supabaseUrl || !supabaseKey) return;
    tick();
    watcherId = window.setInterval(tick, 1000);
    intervalId = window.setInterval(() => {
      processFacebookQueue().catch(() => {});
    }, 15000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") scheduleProcess(300);
    });
    window.addEventListener("pagehide", () => {
      if (watcherId) window.clearInterval(watcherId);
      if (intervalId) window.clearInterval(intervalId);
      feedbackObserver?.disconnect();
    }, { once: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
