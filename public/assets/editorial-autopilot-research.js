(() => {
  "use strict";

  const VERSION = "0.12.23";
  const SESSION_KEY = "offertalogica.editorial.session.v1";
  let statusLoaded = false;

  function sessionRead() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); }
    catch { return null; }
  }

  function esc(value = "") {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[char]));
  }

  function dateIt(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("it-IT", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(date);
  }

  async function endpoint(action, { method = "GET", body } = {}) {
    const session = sessionRead();
    if (!session?.access_token) throw new Error("Sessione Redazione non disponibile.");
    const response = await fetch(`/api/staff-analytics?action=${encodeURIComponent(action)}`, {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || `Errore ${response.status}`);
    return payload;
  }

  function cardMarkup() {
    return `
      <h3>Acquisizione Search Console</h3>
      <p>Importa nello storico editoriale dati aggregati di query, pagina, clic, impressioni, CTR e posizione. Nessun articolo viene generato o pubblicato.</p>
      <div class="ol-autopilot-fields">
        <div class="ol-field">
          <label for="autopilot-search-console-period">Periodo stabile</label>
          <select id="autopilot-search-console-period" data-search-console-days>
            <option value="7">Ultimi 7 giorni</option>
            <option value="28" selected>Ultimi 28 giorni</option>
            <option value="90">Ultimi 90 giorni</option>
          </select>
          <small>Il periodo termina 3 giorni fa per usare dati Search Console consolidati.</small>
        </div>
        <div class="ol-field">
          <label>Stato collegamento</label>
          <div class="ol-autopilot-archive-item" data-search-console-status>
            <strong>Verifica configurazione…</strong>
            <small>Controllo credenziali server e ultimo snapshot.</small>
          </div>
        </div>
      </div>
      <div class="ol-autopilot-toolbar">
        <p class="ol-autopilot-save-state" data-search-console-message>Fase 2 · acquisizione manuale controllata.</p>
        <button class="ol-button ol-button-secondary" type="button" data-search-console-collect disabled>Acquisisci Search Console</button>
      </div>`;
  }

  function ensureCard() {
    const grid = document.querySelector('[data-editorial-autopilot="1"] .ol-autopilot-grid');
    if (!grid || grid.querySelector('[data-search-console-card]')) return;

    const section = document.createElement("section");
    section.className = "ol-card ol-autopilot-card";
    section.dataset.searchConsoleCard = VERSION;
    section.innerHTML = cardMarkup();
    grid.append(section);
    section.querySelector('[data-search-console-collect]')?.addEventListener("click", collect);
    statusLoaded = false;
    loadStatus(section);
  }

  function setStatus(section, payload) {
    const box = section.querySelector('[data-search-console-status]');
    const button = section.querySelector('[data-search-console-collect]');
    if (!box || !button) return;

    if (!payload?.configured) {
      box.innerHTML = "<strong>Non configurata</strong><small>Mancano le credenziali Search Console lato server.</small>";
      button.disabled = true;
      return;
    }

    const latest = payload.latest;
    box.innerHTML = latest
      ? `<strong>${esc(payload.site || "Search Console collegata")}</strong><small>Ultima acquisizione: ${esc(dateIt(latest.captured_at))} · ${Number(latest.row_count || 0)} righe · ${esc(latest.period_start || "?")} → ${esc(latest.period_end || "?")}</small>`
      : `<strong>${esc(payload.site || "Search Console collegata")}</strong><small>Collegamento configurato. Nessuna acquisizione archiviata ancora.</small>`;
    button.disabled = false;
  }

  async function loadStatus(section) {
    if (statusLoaded || !section?.isConnected) return;
    statusLoaded = true;
    try {
      const payload = await endpoint("editorial-research-status");
      if (section.isConnected) setStatus(section, payload);
    } catch (error) {
      const box = section.querySelector('[data-search-console-status]');
      if (box) box.innerHTML = `<strong>Verifica non riuscita</strong><small>${esc(error.message)}</small>`;
      const button = section.querySelector('[data-search-console-collect]');
      if (button) button.disabled = true;
    }
  }

  function prependSnapshot(result) {
    const cards = [...document.querySelectorAll('[data-editorial-autopilot="1"] .ol-autopilot-card')];
    const archive = cards.find((card) => card.querySelector("h3")?.textContent?.trim() === "Archivio ricerca");
    const list = archive?.querySelector(".ol-autopilot-archive-list");
    if (!list) return;
    if (list.children.length === 1 && list.querySelector(".ol-muted")) list.innerHTML = "";
    const item = document.createElement("div");
    item.className = "ol-autopilot-archive-item";
    item.innerHTML = `<strong>search_console · ${esc(result.period_start)} → ${esc(result.period_end)}</strong><small>${Number(result.row_count || 0)} righe aggregate · acquisito ${esc(dateIt(result.captured_at))} · acquisizione manuale ${Number(result.days || 0)} giorni</small>`;
    list.prepend(item);
  }

  async function collect(event) {
    const button = event.currentTarget;
    const section = button.closest('[data-search-console-card]');
    const select = section?.querySelector('[data-search-console-days]');
    const message = section?.querySelector('[data-search-console-message]');
    if (!section || !select || !message) return;

    button.disabled = true;
    message.textContent = "Acquisizione Search Console in corso…";
    try {
      const payload = await endpoint("collect-search-console", {
        method: "POST",
        body: { days: Number(select.value || 28) },
      });
      const result = payload?.result;
      if (!result) throw new Error("Risposta acquisizione non valida");
      message.textContent = `Acquisizione completata: ${Number(result.row_count || 0)} righe archiviate.`;
      prependSnapshot(result);
      statusLoaded = false;
      await loadStatus(section);
    } catch (error) {
      message.textContent = `Acquisizione non completata: ${error.message}`;
    } finally {
      if (section.isConnected && !button.disabled) return;
      const statusBox = section.querySelector('[data-search-console-status] strong')?.textContent || "";
      button.disabled = statusBox === "Non configurata" || statusBox === "Verifica non riuscita";
    }
  }

  function boot() {
    const observer = new MutationObserver(() => ensureCard());
    observer.observe(document.documentElement, { childList: true, subtree: true });
    ensureCard();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
