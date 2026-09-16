(() => {
  "use strict";

  const VERSION = "0.12.26";
  const SESSION_KEY = "offertalogica.editorial.session.v1";
  const WINDOWS = [7, 28, 90];
  let statusLoaded = false;
  let lastAnalysisPayload = null;
  let opportunityRows = [];
  let opportunityTopicKeys = new Set();

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
      </div>

      <div class="ol-field" style="margin-top:18px">
        <label>Opportunità salvate</label>
        <p class="ol-muted">Un segnale entra qui solo quando lo salvi manualmente. Dopo la selezione puoi classificarlo come nuovo articolo, aggiornamento, solo social o monitoraggio. Solo “Nuovo articolo” abilita la creazione manuale di una bozza vuota; nessuna azione pubblica contenuti.</p>
        <p class="ol-autopilot-save-state" data-opportunity-message>Caricamento opportunità…</p>
        <div class="ol-autopilot-archive-list" data-opportunity-list>
          <p class="ol-muted">Caricamento…</p>
        </div>
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
    section.addEventListener("click", handleOpportunityAction);
    statusLoaded = false;
    loadStatus(section);
    loadOpportunities(section);
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

  function opportunityStatusLabel(status) {
    return ({
      pending: "In attesa",
      selected: "Selezionata",
      deferred: "Rimandata",
      rejected: "Rifiutata",
      completed: "Completata",
    })[status] || status || "—";
  }

  function opportunityTypeLabel(type) {
    return ({
      new_article: "Nuovo articolo",
      update_article: "Aggiornamento articolo/pagina",
      social_only: "Solo social",
      monitor: "Monitoraggio",
    })[type] || type || "Monitoraggio";
  }

  function contextPagesMarkup(pages) {
    const safePages = (Array.isArray(pages) ? pages : []).filter(Boolean).slice(0, 3);
    if (!safePages.length) return "";
    return `<small>Pagine già intercettate da Search Console:</small>${safePages
      .map((url) => `<small>• ${esc(url)}</small>`)
      .join("")}`;
  }

  function opportunityActions(row) {
    const id = esc(row.id || "");
    const status = String(row.status || "");
    if (status === "completed" || row.target_article_id) return "";
    const buttons = [];
    if (status !== "selected") buttons.push(`<button class="ol-button ol-button-secondary ol-button-small" type="button" data-opportunity-id="${id}" data-opportunity-status="selected">Seleziona</button>`);
    if (status !== "deferred") buttons.push(`<button class="ol-button ol-button-secondary ol-button-small" type="button" data-opportunity-id="${id}" data-opportunity-status="deferred">Rimanda</button>`);
    if (status !== "rejected") buttons.push(`<button class="ol-button ol-button-secondary ol-button-small" type="button" data-opportunity-id="${id}" data-opportunity-status="rejected">Rifiuta</button>`);
    if (status !== "pending") buttons.push(`<button class="ol-button ol-button-secondary ol-button-small" type="button" data-opportunity-id="${id}" data-opportunity-status="pending">Rimetti in attesa</button>`);
    return buttons.join("");
  }

  function selectedOpportunityWorkflow(row) {
    const id = esc(row.id || "");
    const type = String(row.opportunity_type || "monitor");
    const targetArticleId = String(row.target_article_id || "");
    if (targetArticleId) {
      return `<div class="ol-toolbar-group" style="margin-top:8px">
        <a class="ol-button ol-button-secondary ol-button-small" href="/redazione?scope=mine&amp;status=all&amp;id=${encodeURIComponent(targetArticleId)}">Apri articolo collegato</a>
      </div>`;
    }
    if (row.status !== "selected") return "";

    const option = (value, label) => `<option value="${value}" ${type === value ? "selected" : ""}>${label}</option>`;
    let followup = '<small>Scegli la destinazione editoriale e salvala prima di procedere.</small>';
    if (type === "new_article") {
      followup = `<small>La bozza sarà creata vuota nella coda Redazione: titolo e slug iniziali, nessun testo generato e nessuna pubblicazione.</small>
        <div class="ol-toolbar-group" style="margin-top:8px">
          <button class="ol-button ol-button-secondary ol-button-small" type="button" data-opportunity-prepare="${id}">Prepara bozza</button>
        </div>`;
    } else if (type === "update_article") {
      followup = "<small>Nessuna nuova bozza viene creata: questa destinazione evita duplicati e sarà gestita nel flusso di aggiornamento.</small>";
    } else if (type === "social_only") {
      followup = "<small>Classificata per uso social: in questa fase non viene creato alcun contenuto.</small>";
    } else if (type === "monitor") {
      followup = "<small>Resta in monitoraggio: nessuna bozza viene creata.</small>";
    }

    return `<div class="ol-field" style="margin-top:10px">
      <label>Destinazione editoriale</label>
      <select data-opportunity-type-select="${id}">
        ${option("monitor", "Monitoraggio")}
        ${option("new_article", "Nuovo articolo")}
        ${option("update_article", "Aggiornamento articolo/pagina")}
        ${option("social_only", "Solo social")}
      </select>
      <div class="ol-toolbar-group" style="margin-top:8px">
        <button class="ol-button ol-button-secondary ol-button-small" type="button" data-opportunity-classify="${id}">Salva destinazione</button>
      </div>
      ${followup}
    </div>`;
  }

  function renderOpportunities(section, rows) {
    const list = section.querySelector("[data-opportunity-list]");
    const message = section.querySelector("[data-opportunity-message]");
    if (!list || !message) return;

    opportunityRows = Array.isArray(rows) ? rows : [];
    opportunityTopicKeys = new Set(
      opportunityRows.map((row) => String(row?.evidence?.topic_key || "")).filter(Boolean),
    );

    if (!opportunityRows.length) {
      list.innerHTML = '<p class="ol-muted">Nessuna opportunità salvata.</p>';
      message.textContent = "Salva manualmente un segnale dall’analisi quando vuoi conservarlo.";
    } else {
      list.innerHTML = opportunityRows.map((row) => {
        const decided = row.decided_at ? ` · decisione ${dateIt(row.decided_at)}` : "";
        return `<div class="ol-autopilot-archive-item">
          <strong>${esc(row.topic || "Senza titolo")} · ${Number(row.score || 0)}/100 · ${esc(opportunityStatusLabel(row.status))}</strong>
          <small>Tipo: ${esc(opportunityTypeLabel(row.opportunity_type))} · salvata ${esc(dateIt(row.created_at))}${esc(decided)}</small>
          <small>${esc(row.rationale || "Segnale da valutare manualmente.")}</small>
          ${contextPagesMarkup(row.context_pages)}
          <div class="ol-toolbar-group" style="margin-top:8px">${opportunityActions(row)}</div>
          ${selectedOpportunityWorkflow(row)}
        </div>`;
      }).join("");
      message.textContent = `${numberIt(opportunityRows.length)} opportunità persistenti. Classificazione, bozza e decisioni restano manuali.`;
    }

    if (lastAnalysisPayload) renderAnalysis(section, lastAnalysisPayload);
  }

  async function loadOpportunities(section, quiet = false) {
    const message = section?.querySelector("[data-opportunity-message]");
    if (!section?.isConnected) return;
    if (!quiet && message) message.textContent = "Caricamento opportunità…";
    try {
      const payload = await endpoint("editorial-opportunities");
      if (section.isConnected) renderOpportunities(section, payload?.opportunities || []);
    } catch (error) {
      if (message) message.textContent = `Opportunità non disponibili: ${error.message}`;
    }
  }

  async function handleOpportunityAction(event) {
    const section = event.currentTarget;
    const saveButton = event.target.closest("[data-save-opportunity]");
    const statusButton = event.target.closest("[data-opportunity-id][data-opportunity-status]");
    const classifyButton = event.target.closest("[data-opportunity-classify]");
    const prepareButton = event.target.closest("[data-opportunity-prepare]");
    const message = section.querySelector("[data-opportunity-message]");

    if (saveButton) {
      const topicKey = saveButton.dataset.saveOpportunity || "";
      if (!topicKey || saveButton.disabled) return;
      saveButton.disabled = true;
      if (message) message.textContent = "Salvataggio opportunità…";
      try {
        const payload = await endpoint("save-editorial-opportunity", {
          method: "POST",
          body: { topic_key: topicKey },
        });
        const created = Boolean(payload?.result?.created);
        if (message) message.textContent = created
          ? "Opportunità salvata in attesa di decisione manuale."
          : "Questa opportunità era già stata salvata per lo snapshot corrente.";
        await loadOpportunities(section, true);
      } catch (error) {
        saveButton.disabled = false;
        if (message) message.textContent = `Salvataggio non completato: ${error.message}`;
      }
      return;
    }

    if (statusButton) {
      const id = statusButton.dataset.opportunityId || "";
      const status = statusButton.dataset.opportunityStatus || "";
      if (!id || !status || statusButton.disabled) return;
      statusButton.disabled = true;
      if (message) message.textContent = "Aggiornamento decisione…";
      try {
        await endpoint("update-editorial-opportunity", {
          method: "POST",
          body: { id, status },
        });
        if (message) message.textContent = `Decisione aggiornata: ${opportunityStatusLabel(status)}.`;
        await loadOpportunities(section, true);
      } catch (error) {
        statusButton.disabled = false;
        if (message) message.textContent = `Aggiornamento non completato: ${error.message}`;
      }
      return;
    }

    if (classifyButton) {
      const id = classifyButton.dataset.opportunityClassify || "";
      const select = section.querySelector(`[data-opportunity-type-select="${id}"]`);
      const opportunityType = select?.value || "";
      if (!id || !opportunityType || classifyButton.disabled) return;
      classifyButton.disabled = true;
      if (message) message.textContent = "Salvataggio destinazione editoriale…";
      try {
        await endpoint("classify-editorial-opportunity", {
          method: "POST",
          body: { id, opportunity_type: opportunityType },
        });
        if (message) message.textContent = `Destinazione salvata: ${opportunityTypeLabel(opportunityType)}.`;
        await loadOpportunities(section, true);
      } catch (error) {
        classifyButton.disabled = false;
        if (message) message.textContent = `Destinazione non salvata: ${error.message}`;
      }
      return;
    }

    if (prepareButton) {
      const id = prepareButton.dataset.opportunityPrepare || "";
      if (!id || prepareButton.disabled) return;
      prepareButton.disabled = true;
      if (message) message.textContent = "Preparazione bozza vuota…";
      try {
        const payload = await endpoint("prepare-editorial-draft", {
          method: "POST",
          body: { id },
        });
        const created = Boolean(payload?.result?.created);
        if (message) message.textContent = created
          ? "Bozza creata e collegata. Nessun contenuto è stato generato o pubblicato."
          : "La bozza era già collegata a questa opportunità.";
        await loadOpportunities(section, true);
      } catch (error) {
        prepareButton.disabled = false;
        if (message) message.textContent = `Bozza non preparata: ${error.message}`;
      }
    }
  }

  function renderAnalysis(section, payload) {
    lastAnalysisPayload = payload || null;
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
      const alreadySaved = opportunityTopicKeys.has(String(signal.topic_key || ""));
      return `<div class="ol-autopilot-archive-item">
        <strong>${esc(signal.topic)} · punteggio ${Number(signal.score || 0)}/100</strong>
        <small>${esc(metricSummary(signal, 7))} · ${esc(metricSummary(signal, 28))} · ${esc(metricSummary(signal, 90))}</small>
        <small>${Number(signal.query_count || 0)} query collegate · ${Number(signal.page_count || 0)} pagine · ${esc(momentum)}</small>
        ${contextPagesMarkup(signal.page_urls)}
        <div class="ol-toolbar-group" style="margin-top:8px">
          <button class="ol-button ol-button-secondary ol-button-small" type="button" data-save-opportunity="${esc(signal.topic_key || "")}" ${alreadySaved ? "disabled" : ""}>${alreadySaved ? "Già salvata" : "Salva opportunità"}</button>
        </div>
      </div>`;
    }).join("");

    message.textContent = payload.truncated
      ? "Analisi completata su un campione massimo di 20.000 righe per snapshot."
      : "Analisi completata. Puoi salvare manualmente i segnali che vuoi conservare; nessun contenuto viene creato o pubblicato.";
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
