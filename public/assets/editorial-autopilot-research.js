(() => {
  "use strict";

  const VERSION = "0.12.24";
  const SESSION_KEY = "offertalogica.editorial.session.v1";
  const WINDOWS = [7, 28, 90];
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

  function numberIt(value) {
    return new Intl.NumberFormat("it-IT").format(Number(value || 0));
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
            <small>Controllo credenziali server e storico disponibile.</small>
          </div>
        </div>
      </div>

      <div class="ol-field" style="margin-top:12px">
        <label>Storico acquisizioni</label>
        <div class="ol-autopilot-archive-list" data-search-console-history>
          <p class="ol-muted">Caricamento storico…</p>
        </div>
      </div>

      <div class="ol-autopilot-toolbar">
        <p class="ol-autopilot-save-state" data-search-console-message>Fase 2 · acquisizione manuale controllata.</p>
        <button class="ol-button ol-button-secondary" type="button" data-search-console-collect disabled>Acquisisci Search Console</button>
      </div>

      <div class="ol-field" style="margin-top:18px">
        <label>Analisi segnali editoriali</label>
        <p class="ol-muted">Raggruppamento lessicale e punteggio tecnico 0–100 basato su domanda, ritmo recente, posizione e clic. È solo una lettura dello storico: non crea e non pubblica contenuti.</p>
        <div class="ol-autopilot-toolbar">
          <p class="ol-autopilot-save-state" data-search-console-analysis-message>Servono gli snapshot 7, 28 e 90 giorni.</p>
          <button class="ol-button ol-button-secondary" type="button" data-search-console-analyze disabled>Analizza storico</button>
        </div>
        <div class="ol-autopilot-archive-list" data-search-console-analysis-results></div>
      </div>`;
  }

  function ensureCard() {
    const grid = document.querySelector('[data-editorial-autopilot="1"] .ol-autopilot-grid');
    if (!grid || grid.querySelector("[data-search-console-card]")) return;

    const section = document.createElement("section");
    section.className = "ol-card ol-autopilot-card";
    section.dataset.searchConsoleCard = VERSION;
    section.innerHTML = cardMarkup();
    grid.append(section);
    section.querySelector("[data-search-console-collect]")?.addEventListener("click", collect);
    section.querySelector("[data-search-console-analyze]")?.addEventListener("click", analyze);
    statusLoaded = false;
    loadStatus(section);
  }

  function renderHistory(section, snapshots) {
    const box = section.querySelector("[data-search-console-history]");
    if (!box) return;
    const byDays = new Map((snapshots || []).map((row) => [Number(row.days), row]));
    box.innerHTML = WINDOWS.map((days) => {
      const row = byDays.get(days);
      if (!row) {
        return `<div class="ol-autopilot-archive-item"><strong>${days} giorni</strong><small>Snapshot non ancora disponibile.</small></div>`;
      }
      return `<div class="ol-autopilot-archive-item"><strong>${days} giorni · ${numberIt(row.row_count)} righe</strong><small>${esc(row.period_start || "?")} → ${esc(row.period_end || "?")} · acquisito ${esc(dateIt(row.captured_at))}</small></div>`;
    }).join("");
  }

  function setStatus(section, payload) {
    const box = section.querySelector("[data-search-console-status]");
    const collectButton = section.querySelector("[data-search-console-collect]");
    const analyzeButton = section.querySelector("[data-search-console-analyze]");
    const analysisMessage = section.querySelector("[data-search-console-analysis-message]");
    if (!box || !collectButton || !analyzeButton || !analysisMessage) return;

    renderHistory(section, payload?.snapshots || []);

    if (!payload?.configured) {
      box.innerHTML = "<strong>Non configurata</strong><small>Mancano le credenziali Search Console lato server.</small>";
      collectButton.disabled = true;
      analyzeButton.disabled = true;
      analysisMessage.textContent = "Configura prima Search Console.";
      return;
    }

    const latest = payload.latest;
    box.innerHTML = latest
      ? `<strong>${esc(payload.site || "Search Console collegata")}</strong><small>Ultima acquisizione: ${esc(dateIt(latest.captured_at))} · ${numberIt(latest.row_count)} righe · ${esc(latest.period_start || "?")} → ${esc(latest.period_end || "?")}</small>`
      : `<strong>${esc(payload.site || "Search Console collegata")}</strong><small>Collegamento configurato. Nessuna acquisizione archiviata ancora.</small>`;

    collectButton.disabled = false;
    analyzeButton.disabled = !payload.analysis_ready;
    analysisMessage.textContent = payload.analysis_ready
      ? "Storico 7/28/90 disponibile. Analisi pronta."
      : "Servono gli snapshot 7, 28 e 90 giorni.";
  }

  async function loadStatus(section) {
    if (statusLoaded || !section?.isConnected) return;
    statusLoaded = true;
    try {
      const payload = await endpoint("editorial-research-status");
      if (section.isConnected) setStatus(section, payload);
    } catch (error) {
      const box = section.querySelector("[data-search-console-status]");
      if (box) box.innerHTML = `<strong>Verifica non riuscita</strong><small>${esc(error.message)}</small>`;
      const collectButton = section.querySelector("[data-search-console-collect]");
      const analyzeButton = section.querySelector("[data-search-console-analyze]");
      if (collectButton) collectButton.disabled = true;
      if (analyzeButton) analyzeButton.disabled = true;
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
    item.innerHTML = `<strong>search_console · ${esc(result.period_start)} → ${esc(result.period_end)}</strong><small>${numberIt(result.row_count)} righe aggregate · acquisito ${esc(dateIt(result.captured_at))} · acquisizione manuale ${Number(result.days || 0)} giorni</small>`;
    list.prepend(item);
  }

  async function collect(event) {
    const button = event.currentTarget;
    const section = button.closest("[data-search-console-card]");
    const select = section?.querySelector("[data-search-console-days]");
    const message = section?.querySelector("[data-search-console-message]");
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
      message.textContent = `Acquisizione completata: ${numberIt(result.row_count)} righe archiviate.`;
      prependSnapshot(result);
      statusLoaded = false;
      await loadStatus(section);
    } catch (error) {
      message.textContent = `Acquisizione non completata: ${error.message}`;
    } finally {
      if (section.isConnected) {
        statusLoaded = false;
        await loadStatus(section).catch(() => {});
      }
    }
  }

  function metricSummary(signal, days) {
    const metric = signal?.metrics?.[String(days)];
    if (!metric) return `${days}g: —`;
    const position = metric.avg_position === null ? "—" : Number(metric.avg_position).toFixed(1);
    return `${days}g: ${numberIt(metric.impressions)} imp · ${numberIt(metric.clicks)} clic · pos ${position}`;
  }

  function renderAnalysis(section, payload) {
    const list = section.querySelector("[data-search-console-analysis-results]");
    const message = section.querySelector("[data-search-console-analysis-message]");
    if (!list || !message) return;

    if (!payload?.ready) {
      const missing = (payload?.missing || []).join(", ");
      list.innerHTML = "";
      message.textContent = `Storico incompleto. Mancano: ${missing || "snapshot richiesti"}.`;
      return;
    }

    const signals = Array.isArray(payload.signals) ? payload.signals : [];
    if (!signals.length) {
      list.innerHTML = '<p class="ol-muted">Nessun segnale utile trovato nello storico disponibile.</p>';
      message.textContent = "Analisi completata senza segnali utili.";
      return;
    }

    list.innerHTML = signals.slice(0, 12).map((signal) => {
      const momentum = Number.isFinite(Number(signal.momentum_ratio))
        ? `${((Number(signal.momentum_ratio) - 1) * 100).toFixed(0)}% ritmo 7g vs media 28g`
        : "ritmo recente non calcolabile";
      return `<div class="ol-autopilot-archive-item">
        <strong>${esc(signal.topic)} · punteggio ${Number(signal.score || 0)}/100</strong>
        <small>${esc(metricSummary(signal, 7))} · ${esc(metricSummary(signal, 28))} · ${esc(metricSummary(signal, 90))}</small>
        <small>${Number(signal.query_count || 0)} query collegate · ${Number(signal.page_count || 0)} pagine · ${esc(momentum)}</small>
      </div>`;
    }).join("");

    message.textContent = payload.truncated
      ? "Analisi completata su un campione massimo di 20.000 righe per snapshot."
      : "Analisi completata. Nessuna opportunità è stata salvata o pubblicata.";
  }

  async function analyze(event) {
    const button = event.currentTarget;
    const section = button.closest("[data-search-console-card]");
    const message = section?.querySelector("[data-search-console-analysis-message]");
    if (!section || !message) return;

    button.disabled = true;
    message.textContent = "Analisi dello storico in corso…";
    try {
      const payload = await endpoint("editorial-research-analysis");
      renderAnalysis(section, payload);
    } catch (error) {
      message.textContent = `Analisi non completata: ${error.message}`;
    } finally {
      statusLoaded = false;
      await loadStatus(section).catch(() => {});
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
