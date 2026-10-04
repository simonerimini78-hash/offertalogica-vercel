(() => {
  "use strict";

  const VERSION = "0.12.89";
  const SESSION_KEY = "offertalogica.editorial.session.v1";
  const WINDOWS = [7, 28, 90];
  const ANALYSIS_PAGE_SIZE = 10;
  let statusLoaded = false;
  let lastAnalysisPayload = null;
  let analysisPage = 1;
  let analysisSearchTerm = "";
  let analysisScoreFilter = "all";
  let opportunityRows = [];
  let opportunityTopicKeys = new Set();
  let plannerDecision = null;
  const expandedOpportunityIds = new Set();
  let socialPlanItems = [];
  let socialChannels = [];
  let automationRuns = [];
  let automationRunsExpanded = false;

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
      <div class="ol-autopilot-card-heading">
        <div><h3>Stato del ciclo editoriale</h3><p>La vista principale mostra solo ciò che serve per capire dove si trova il ciclo. Ricerca e strumenti di dettaglio restano disponibili nelle sezioni chiuse sotto.</p></div>
      </div>

      <div class="ol-autopilot-workflow">
        <section class="ol-autopilot-stage ol-autopilot-stage-priority">
          <div class="ol-autopilot-stage-heading"><span class="ol-autopilot-stage-number">1</span><div><h4>Controllo del ciclo</h4><p>Stato sintetico, post preparati e ultimi eventi dello scheduler.</p></div></div>
          <div class="ol-cycle-overview" data-cycle-overview><strong>Caricamento stato ciclo…</strong></div>
          <div class="ol-autopilot-pair">
            <div class="ol-autopilot-pane">
              <h5>Articoli monitorati</h5>
              <p class="ol-autopilot-save-state" data-social-plan-message>Caricamento piano post…</p>
              <div class="ol-autopilot-archive-list ol-cycle-compact-list" data-social-plan-list><p class="ol-muted">Caricamento…</p></div>
            </div>
            <div class="ol-autopilot-pane">
              <h5>Ultimi cicli Autopilota</h5>
              <p class="ol-muted">Vista compatta. Apri una riga solo se vuoi leggere il dettaglio tecnico.</p>
              <div class="ol-autopilot-archive-list ol-cycle-compact-list" data-automation-run-list><p class="ol-muted">Caricamento…</p></div>
              <div class="ol-autopilot-toolbar ol-cycle-history-toolbar" data-automation-run-toolbar hidden>
                <button class="ol-button ol-button-secondary ol-button-small" type="button" data-automation-run-toggle>Mostra storico</button>
              </div>
            </div>
          </div>
        </section>

        <details class="ol-autopilot-stage ol-autopilot-stage-collapsible">
          <summary class="ol-autopilot-stage-heading"><span class="ol-autopilot-stage-number">2</span><div><h4>Idee e priorità</h4><p>Apri solo per inserire un tema manuale o verificare la scelta del planner.</p></div><span class="ol-autopilot-stage-action" aria-hidden="true">Apri</span></summary>
          <div class="ol-autopilot-stage-body">
            <div class="ol-autopilot-pair">
              <div class="ol-autopilot-pane" data-manual-idea-editor>
                <h5>Idea editoriale manuale</h5>
                <div class="ol-autopilot-fields">
                  <div class="ol-field">
                    <label for="autopilot-manual-idea-topic">Argomento</label>
                    <input id="autopilot-manual-idea-topic" data-manual-idea-topic type="text" maxlength="240" placeholder="Es. nuova norma urgente sul mercato energia">
                  </div>
                  <div class="ol-field">
                    <label>Destinazione</label>
                    <input id="autopilot-manual-idea-type" data-manual-idea-type type="hidden" value="new_article">
                    <div class="ol-autopilot-archive-item"><strong>Nuovo articolo</strong><small>L’Editoriale non modifica le pagine esistenti del sito.</small></div>
                  </div>
                  <div class="ol-field">
                    <label for="autopilot-manual-idea-priority">Priorità</label>
                    <select id="autopilot-manual-idea-priority" data-manual-idea-priority>
                      <option value="normal">Normale · dopo i segnali automatici sopra soglia</option>
                      <option value="high">Alta · precede i segnali automatici</option>
                      <option value="urgent">Urgente · precede tutto salvo una scelta già selezionata</option>
                    </select>
                  </div>
                  <div class="ol-field">
                    <label for="autopilot-manual-idea-deadline">Scadenza facoltativa</label>
                    <input id="autopilot-manual-idea-deadline" data-manual-idea-deadline type="date">
                  </div>
                  <div class="ol-field">
                    <label for="autopilot-manual-idea-category">Categoria facoltativa</label>
                    <input id="autopilot-manual-idea-category" data-manual-idea-category type="text" maxlength="80" placeholder="Es. Energia">
                  </div>
                  <div class="ol-field ol-autopilot-field-wide">
                    <label for="autopilot-manual-idea-notes">Note editoriali</label>
                    <textarea id="autopilot-manual-idea-notes" data-manual-idea-notes maxlength="2000" rows="3" placeholder="Perché è importante, taglio desiderato, fonti da verificare…"></textarea>
                  </div>
                </div>
                <div class="ol-autopilot-toolbar">
                  <p class="ol-autopilot-save-state" data-manual-idea-message>Le idee ad alta priorità o urgenti possono precedere i segnali automatici.</p>
                  <div class="ol-toolbar-group">
                    <button class="ol-button ol-button-secondary" type="button" data-manual-idea-cancel hidden>Annulla modifica</button>
                    <button class="ol-button ol-button-primary" type="button" data-manual-idea-save>Salva idea</button>
                  </div>
                </div>
              </div>

              <div class="ol-autopilot-pane">
                <h5>Anteprima priorità Autopilota</h5>
                <p class="ol-muted">Calcola quale tema verrebbe scelto oggi. È un dry-run: non cambia stati, non crea bozze e non pubblica.</p>
                <div class="ol-autopilot-toolbar">
                  <p class="ol-autopilot-save-state" data-planner-message>Nessuna anteprima calcolata.</p>
                  <button class="ol-button ol-button-secondary" type="button" data-planner-preview>Calcola scelta</button>
                </div>
                <div class="ol-autopilot-archive-list" data-planner-result></div>
              </div>
            </div>
          </div>
        </details>

        <details class="ol-autopilot-stage ol-autopilot-stage-collapsible">
          <summary class="ol-autopilot-stage-heading"><span class="ol-autopilot-stage-number">3</span><div><h4>Ricerca e segnali</h4><p>Search Console, radar web, attualità e controllo duplicati.</p></div><span class="ol-autopilot-stage-action" aria-hidden="true">Apri</span></summary>
          <div class="ol-autopilot-stage-body">
            <div class="ol-autopilot-pair">
              <div class="ol-autopilot-pane">
                <h5>Acquisizione</h5>
                <div class="ol-autopilot-fields ol-autopilot-fields-compact">
                  <div class="ol-field">
                    <label for="autopilot-search-console-period">Periodo stabile</label>
                    <select id="autopilot-search-console-period" data-search-console-days>
                      <option value="7">Ultimi 7 giorni</option>
                      <option value="28" selected>Ultimi 28 giorni</option>
                      <option value="90">Ultimi 90 giorni</option>
                    </select>
                    <small>Il periodo termina 3 giorni fa per usare dati consolidati.</small>
                  </div>
                  <div class="ol-field">
                    <label>Stato collegamento</label>
                    <div class="ol-autopilot-archive-item" data-search-console-status>
                      <strong>Verifica configurazione…</strong>
                      <small>Controllo credenziali server e storico disponibile.</small>
                    </div>
                  </div>
                </div>
                <div class="ol-field">
                  <label>Storico 7 / 28 / 90 giorni</label>
                  <div class="ol-autopilot-archive-list" data-search-console-history><p class="ol-muted">Caricamento storico…</p></div>
                </div>
                <div class="ol-autopilot-toolbar">
                  <p class="ol-autopilot-save-state" data-search-console-message>Acquisizione manuale controllata.</p>
                  <button class="ol-button ol-button-secondary" type="button" data-search-console-collect disabled>Acquisisci Search Console</button>
                </div>
              </div>

              <div class="ol-autopilot-pane">
                <h5>Analisi segnali</h5>
                <p class="ol-muted">Punteggio tecnico 0–100 basato su domanda, ritmo recente, posizione e clic. Non crea né pubblica contenuti.</p>
                <div class="ol-autopilot-toolbar">
                  <p class="ol-autopilot-save-state" data-search-console-analysis-message>Servono gli snapshot 7, 28 e 90 giorni.</p>
                  <button class="ol-button ol-button-secondary" type="button" data-search-console-analyze disabled>Analizza storico</button>
                </div>
                <div class="ol-autopilot-fields ol-autopilot-fields-compact" data-signal-controls hidden>
                  <div class="ol-field ol-field-compact">
                    <label for="autopilot-signal-search">Cerca nella graduatoria</label>
                    <input id="autopilot-signal-search" data-signal-search type="search" placeholder="Argomento, query o pagina">
                  </div>
                  <div class="ol-field ol-field-compact">
                    <label for="autopilot-signal-score-filter">Punteggio</label>
                    <select id="autopilot-signal-score-filter" data-signal-score-filter>
                      <option value="all">Tutti i segnali</option>
                      <option value="40plus">40–100</option>
                      <option value="30to39">30–39</option>
                      <option value="under30">Sotto 30</option>
                    </select>
                  </div>
                </div>
                <div class="ol-autopilot-toolbar" data-signal-pagination-top hidden>
                  <p class="ol-autopilot-save-state" data-signal-page-summary></p>
                  <div class="ol-toolbar-group">
                    <button class="ol-button ol-button-secondary ol-button-small" type="button" data-signal-page="prev">← Precedenti</button>
                    <button class="ol-button ol-button-secondary ol-button-small" type="button" data-signal-page="next">Successivi →</button>
                  </div>
                </div>
                <div class="ol-autopilot-archive-list" data-search-console-analysis-results></div>
                <div class="ol-autopilot-toolbar" data-signal-pagination-bottom hidden>
                  <button class="ol-button ol-button-secondary ol-button-small" type="button" data-signal-page="prev">← Precedenti</button>
                  <div class="ol-toolbar-group">
                    <button class="ol-button ol-button-secondary ol-button-small" type="button" data-jump-opportunities>Vai alle opportunità ↓</button>
                    <button class="ol-button ol-button-secondary ol-button-small" type="button" data-signal-page="next">Successivi →</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="ol-autopilot-pane">
              <h5>Radar web editoriale</h5>
              <p class="ol-muted">Scansione automatica sabato, domenica e lunedì dalle 08:00. Confronta web, Search Console, archivio articoli e strumenti OffertaLogica prima di proporre un nuovo contenuto.</p>
              <div class="ol-autopilot-pane" data-research-hint-editor>
                <h5>Questo potrebbe essere il tema del prossimo articolo</h5>
                <p class="ol-muted">Suggeriscilo al Radar: verrà verificato sul web e contro Search Console e archivio. Il suggerimento non aumenta il punteggio e non forza la pubblicazione.</p>
                <div class="ol-autopilot-fields ol-autopilot-fields-compact">
                  <div class="ol-field">
                    <label for="autopilot-research-hint-topic">Tema da validare</label>
                    <input id="autopilot-research-hint-topic" data-research-hint-topic type="text" maxlength="240" placeholder="Es. Spread a zero: conviene davvero?">
                  </div>
                  <div class="ol-field">
                    <label for="autopilot-research-hint-depth">Livello di ricerca</label>
                    <select id="autopilot-research-hint-depth" data-research-hint-depth>
                      <option value="normal">Normale</option>
                      <option value="deep">Approfondisci</option>
                    </select>
                    <small>“Approfondisci” chiede più verifiche, ma non dà punti extra.</small>
                  </div>
                </div>
                <div class="ol-autopilot-toolbar">
                  <p class="ol-autopilot-save-state" data-research-hint-message>Il tema entrerà nelle prossime scansioni Radar finché non lo rimuovi.</p>
                  <button class="ol-button ol-button-primary" type="button" data-research-hint-save>Inserisci nelle ricerche</button>
                </div>
                <div class="ol-autopilot-archive-list" data-research-hint-list></div>
              </div>
              <div class="ol-autopilot-toolbar">
                <p class="ol-autopilot-save-state" data-research-radar-message>Caricamento radar…</p>
                <button class="ol-button ol-button-secondary" type="button" data-research-radar-start>Avvia scansione ora</button>
              </div>
              <div class="ol-autopilot-archive-list" data-research-radar-results><p class="ol-muted">Caricamento…</p></div>
            </div>
          </div>
        </details>

        <details class="ol-autopilot-stage ol-autopilot-stage-collapsible" data-opportunity-stage>
          <summary class="ol-autopilot-stage-heading"><span class="ol-autopilot-stage-number">4</span><div><h4>Opportunità e preparazione contenuti</h4><p>Graduatoria delle opportunità e strumenti di generazione. Chiusa di default.</p></div><span class="ol-autopilot-stage-action" aria-hidden="true">Apri</span></summary>
          <div class="ol-autopilot-stage-body">
            <p class="ol-autopilot-save-state" data-opportunity-message>Caricamento opportunità…</p>
            <div class="ol-autopilot-archive-list" data-opportunity-list><p class="ol-muted">Caricamento…</p></div>
          </div>
        </details>
      </div>`;
  }

  function ensureCard() {
    const host = document.querySelector("[data-editorial-research-host]");
    const adminShell = document.querySelector('[data-editorial-autopilot="1"]');
    if (!host || !adminShell || host.querySelector("[data-search-console-card]")) return;

    host.innerHTML = "";
    const section = document.createElement("section");
    section.className = "ol-autopilot-research-panel";
    section.dataset.searchConsoleCard = VERSION;
    section.innerHTML = cardMarkup();
    host.append(section);
    section.querySelector("[data-search-console-collect]")?.addEventListener("click", collect);
    section.querySelector("[data-search-console-analyze]")?.addEventListener("click", analyze);
    section.querySelector("[data-research-radar-start]")?.addEventListener("click", startResearchRadar);
    section.querySelector("[data-signal-search]")?.addEventListener("input", (event) => {
      analysisSearchTerm = String(event.currentTarget?.value || "").trim().toLocaleLowerCase("it");
      analysisPage = 1;
      if (lastAnalysisPayload) renderAnalysis(section, lastAnalysisPayload);
    });
    section.querySelector("[data-signal-score-filter]")?.addEventListener("change", (event) => {
      analysisScoreFilter = String(event.currentTarget?.value || "all");
      analysisPage = 1;
      if (lastAnalysisPayload) renderAnalysis(section, lastAnalysisPayload);
    });
    section.addEventListener("click", handleAnalysisNavigation);
    section.addEventListener("click", handleOpportunityAction);
    statusLoaded = false;
    loadStatus(section);
    loadAnalysis(section, true);
    loadResearchRadar(section);
    loadOpportunities(section);
    loadPlannerPreview(section, true);
    loadSocialPlan(section);
    loadAutomationRuns(section);
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


  function researchRadarActionLabel(action) {
    return ({
      NEW_ARTICLE: "Nuovo articolo",
      NEW_ANGLE: "Nuovo punto di vista",
      UPDATE_EXISTING: "Aggiornamento consigliato",
      SKIP_DUPLICATE: "Duplicato da scartare",
    })[String(action || "")] || String(action || "Da valutare");
  }

  function researchHintVerdictLabel(verdict) {
    return ({
      NEW_ARTICLE: "Validato · nuovo articolo",
      NEW_ANGLE: "Validato · nuovo punto di vista",
      UPDATE_EXISTING: "Meglio aggiornare un articolo",
      SKIP_DUPLICATE: "Già coperto · da non duplicare",
      INSUFFICIENT_SIGNAL: "Segnale insufficiente",
    })[verdict] || "In attesa di validazione";
  }

  function renderResearchHints(section, hints = []) {
    const box = section?.querySelector("[data-research-hint-list]");
    if (!box) return;
    if (!hints.length) {
      box.innerHTML = '<div class="ol-autopilot-archive-item"><small>Nessun tema suggerito in attesa di validazione.</small></div>';
      return;
    }
    box.innerHTML = hints.map((hint) => {
      const review = hint?.latest_review || null;
      const sources = (review?.source_urls || []).slice(0, 3).map((url) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">fonte</a>`).join(" · ");
      const scans = Number(hint?.review_count || 0);
      const status = review
        ? `${researchHintVerdictLabel(review.verdict)} · ${Number(review.score || 0)}/100`
        : "In attesa della prossima scansione";
      return `<div class="ol-autopilot-archive-item">
        <strong>${esc(hint?.topic || "Tema senza titolo")}</strong>
        <small><b>${esc(status)}</b> · ricerca ${hint?.depth === "deep" ? "approfondita" : "normale"}${scans ? ` · valutato in ${scans} scansione${scans === 1 ? "" : "i"}` : ""}</small>
        ${review?.rationale ? `<small><b>Esito:</b> ${esc(review.rationale)}</small>` : ""}
        ${review?.suggested_angle ? `<small><b>Possibile angolo:</b> ${esc(review.suggested_angle)}</small>` : ""}
        ${sources ? `<small><b>Fonti:</b> ${sources}</small>` : ""}
        <div class="ol-toolbar-group"><button class="ol-button ol-button-secondary ol-button-small" type="button" data-research-hint-archive="${esc(hint.id || "")}">Rimuovi dalle ricerche</button></div>
      </div>`;
    }).join("");
  }

  function researchRadarActionTone(action) {
    return ({
      NEW_ARTICLE: "success",
      NEW_ANGLE: "success",
      UPDATE_EXISTING: "warning",
      SKIP_DUPLICATE: "muted",
    })[String(action || "")] || "muted";
  }

  function renderResearchRadar(section, payload) {
    const box = section?.querySelector("[data-research-radar-results]");
    const message = section?.querySelector("[data-research-radar-message]");
    const button = section?.querySelector("[data-research-radar-start]");
    if (!box || !message || !button) return;
    renderResearchHints(section, Array.isArray(payload?.research_hints) ? payload.research_hints : []);
    const running = payload?.running || null;
    button.disabled = Boolean(running);
    if (running) {
      message.textContent = `Scansione web in corso${running.local_date ? ` · ${running.local_date}` : ""}. L'Autopilota la riprenderà al prossimo tick.`;
    } else {
      const lastScan = Array.isArray(payload?.scans) ? payload.scans.find((row) => row.status === "success") : null;
      message.textContent = lastScan
        ? `Ultima scansione completata ${dateIt(lastScan.finished_at || lastScan.started_at)} · ${Number(lastScan.candidate_count || 0)} candidati.`
        : "Nessuna scansione web completata negli ultimi giorni.";
    }

    const candidates = Array.isArray(payload?.candidates) ? payload.candidates.slice(0, 10) : [];
    if (!candidates.length) {
      box.innerHTML = '<div class="ol-autopilot-archive-item"><strong>Nessun candidato radar disponibile</strong><small>Il radar web non sostituisce Search Console: aggiunge attualità, domanda emergente, controllo duplicati e collegamento con gli strumenti OffertaLogica.</small></div>';
      return;
    }
    box.innerHTML = candidates.map((candidate) => {
      const action = String(candidate?.editorial_action || "");
      const sources = (candidate?.source_urls || []).slice(0, 3).map((url) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">fonte</a>`).join(" · ");
      const tools = (candidate?.related_targets || []).slice(0, 4).map((row) => esc(row?.label || row?.url_path || "")).filter(Boolean).join(" · ");
      const existing = candidate?.existing_article?.title
        ? `<small><b>Articolo correlato:</b> ${esc(candidate.existing_article.title)}${candidate.difference_from_existing ? ` · ${esc(candidate.difference_from_existing)}` : ""}</small>`
        : "";
      const component = candidate?.component_scores || {};
      const hintBadge = candidate?.research_hint?.id ? " · tema suggerito dalla Redazione" : "";
      return `<div class="ol-autopilot-archive-item">
        <strong>${esc(candidate?.topic || "Tema senza titolo")} · ${Number(candidate?.score || 0)}/100${esc(hintBadge)}</strong>
        <small><b>${esc(researchRadarActionLabel(action))}</b> · domanda ${Number(component.demand || 0)} · trend ${Number(component.trend || 0)} · novità ${Number(component.freshness || 0)} · gap ${Number(component.content_gap || 0)}</small>
        <small><b>Intento:</b> ${esc(candidate?.search_intent || "—")}</small>
        <small><b>Angolo:</b> ${esc(candidate?.angle || "—")}</small>
        ${existing}
        ${tools ? `<small><b>Strumenti OffertaLogica pertinenti:</b> ${tools}</small>` : ""}
        ${candidate?.rationale ? `<small><b>Perché:</b> ${esc(candidate.rationale)}</small>` : ""}
        ${sources ? `<small><b>Fonti consultate:</b> ${sources}</small>` : ""}
      </div>`;
    }).join("");
  }

  async function loadResearchRadar(section) {
    if (!section?.isConnected) return;
    const message = section.querySelector("[data-research-radar-message]");
    try {
      const payload = await endpoint("editorial-research-radar");
      if (section.isConnected) renderResearchRadar(section, payload);
    } catch (error) {
      if (message) message.textContent = `Radar non disponibile: ${error.message}`;
      const button = section.querySelector("[data-research-radar-start]");
      if (button) button.disabled = false;
    }
  }

  async function startResearchRadar(event) {
    const button = event.currentTarget;
    const section = button.closest("[data-search-console-card]");
    const message = section?.querySelector("[data-research-radar-message]");
    if (!section || !message) return;
    button.disabled = true;
    message.textContent = "Avvio ricerca web editoriale…";
    try {
      const payload = await endpoint("start-editorial-web-radar", { method: "POST", body: {} });
      const result = payload?.result || {};
      message.textContent = result.action === "research_radar_already_running"
        ? "Una scansione è già in corso. L'Autopilota la riprenderà al prossimo tick."
        : "Scansione avviata. La ricerca web gira in background e verrà chiusa dai prossimi tick dell'Autopilota.";
      await loadResearchRadar(section);
    } catch (error) {
      message.textContent = `Scansione non avviata: ${error.message}`;
      button.disabled = false;
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
      update_article: "Nuovo articolo (legacy)",
      social_only: "Solo social",
      monitor: "Monitoraggio",
    })[type] || type || "Monitoraggio";
  }

  function manualIdeaMeta(row) {
    const evidence = row?.evidence;
    const manual = evidence && typeof evidence === "object" ? evidence.manual_idea : null;
    return evidence?.source === "manual_idea" && manual && typeof manual === "object" ? manual : null;
  }

  function manualIdeaPriorityLabel(priority) {
    return ({ urgent: "Urgente", high: "Alta", normal: "Normale" })[priority] || "Normale";
  }

  function manualIdeaDeadlineLabel(value) {
    if (!value) return "nessuna scadenza";
    const date = new Date(`${value}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(date);
  }

  function resetManualIdeaEditor(section, finalMessage = "") {
    const editor = section?.querySelector("[data-manual-idea-editor]");
    if (!editor) return;
    editor.dataset.editingId = "";
    const topic = editor.querySelector("[data-manual-idea-topic]");
    const type = editor.querySelector("[data-manual-idea-type]");
    const priority = editor.querySelector("[data-manual-idea-priority]");
    const deadline = editor.querySelector("[data-manual-idea-deadline]");
    const category = editor.querySelector("[data-manual-idea-category]");
    const target = editor.querySelector("[data-manual-idea-target]");
    const notes = editor.querySelector("[data-manual-idea-notes]");
    if (topic) topic.value = "";
    if (type) type.value = "new_article";
    if (priority) priority.value = "normal";
    if (deadline) deadline.value = "";
    if (category) category.value = "";
    if (target) target.value = "";
    if (notes) notes.value = "";
    const cancel = editor.querySelector("[data-manual-idea-cancel]");
    const save = editor.querySelector("[data-manual-idea-save]");
    const message = editor.querySelector("[data-manual-idea-message]");
    if (cancel) cancel.hidden = true;
    if (save) save.textContent = "Salva idea";
    if (message) message.textContent = finalMessage || "Le idee ad alta priorità o urgenti possono precedere i segnali automatici.";
  }

  function editManualIdea(section, row) {
    const editor = section?.querySelector("[data-manual-idea-editor]");
    const manual = manualIdeaMeta(row);
    if (!editor || !manual) return;
    editor.dataset.editingId = String(row.id || "");
    editor.querySelector("[data-manual-idea-topic]").value = row.topic || "";
    editor.querySelector("[data-manual-idea-type]").value = "new_article";
    editor.querySelector("[data-manual-idea-priority]").value = ["normal", "high", "urgent"].includes(manual.priority) ? manual.priority : "normal";
    editor.querySelector("[data-manual-idea-deadline]").value = manual.deadline || "";
    editor.querySelector("[data-manual-idea-category]").value = row.category || "";
    editor.querySelector("[data-manual-idea-target]")?.setAttribute("value", "");
    editor.querySelector("[data-manual-idea-notes]").value = manual.notes || "";
    editor.querySelector("[data-manual-idea-cancel]").hidden = false;
    editor.querySelector("[data-manual-idea-save]").textContent = "Salva modifiche";
    editor.querySelector("[data-manual-idea-message]").textContent = "Modifica dell’idea selezionata. Lo stato della coda non viene cambiato.";
    editor.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function manualIdeaPayload(section) {
    const editor = section?.querySelector("[data-manual-idea-editor]");
    if (!editor) return null;
    return {
      id: editor.dataset.editingId || "",
      topic: editor.querySelector("[data-manual-idea-topic]")?.value || "",
      opportunity_type: "new_article",
      priority: editor.querySelector("[data-manual-idea-priority]")?.value || "normal",
      deadline: editor.querySelector("[data-manual-idea-deadline]")?.value || "",
      category: editor.querySelector("[data-manual-idea-category]")?.value || "",
      target_url: "",
      notes: editor.querySelector("[data-manual-idea-notes]")?.value || "",
    };
  }

  function renderPlannerPreview(section, payload, quiet = false) {
    const box = section?.querySelector("[data-planner-result]");
    const message = section?.querySelector("[data-planner-message]");
    if (!box || !message) return;
    const decision = payload?.decision || null;
    plannerDecision = decision;
    const engine = payload?.automation_enabled ? "motore configurato come attivo" : "motore ancora disattivato";
    if (!decision) {
      const reason = payload?.article_cycle_disabled
        ? "Il limite massimo articoli per ciclo è impostato a 0."
        : payload?.duplicate_protection_no_publish
          ? "I segnali disponibili risultano già coperti dall'archivio: il sistema evita un articolo duplicato e attende un nuovo angolo o una novità verificabile."
          : payload?.no_publish
            ? "La configurazione consente di chiudere il ciclo senza articolo."
            : "Nessun candidato disponibile con le regole attuali.";
      box.innerHTML = `<div class="ol-autopilot-archive-item"><strong>Nessun tema selezionato nel dry-run</strong><small>Soglia automatica: ${Number(payload?.minimum_opportunity_score || 0)}/100 · ${esc(engine)}.</small><small>${esc(reason)}</small></div>`;
      if (!quiet) message.textContent = "Dry-run completato senza candidato.";
      if (opportunityRows.length) renderOpportunities(section, opportunityRows);
      return;
    }
    const source = decision.source === "manual_idea"
      ? `Idea manuale · priorità ${manualIdeaPriorityLabel(decision.priority).toLowerCase()}`
      : decision.source === "search_console"
        ? `Search Console · ${Number(decision.score || 0)}/100`
        : decision.source === "research_radar"
          ? `Radar web · ${Number(decision.score || 0)}/100 · ${researchRadarActionLabel(decision?.radar_candidate?.editorial_action)}`
          : "Opportunità già selezionata";
    const deadline = decision.deadline ? ` · scadenza ${manualIdeaDeadlineLabel(decision.deadline)}` : "";
    const destination = ["search_console", "research_radar"].includes(decision.source)
      ? "Segnale da classificare"
      : opportunityTypeLabel(decision.opportunity_type);
    box.innerHTML = `<div class="ol-autopilot-archive-item">
      <strong>${esc(decision.topic || "Tema senza titolo")}</strong>
      <small>${esc(source)}${esc(deadline)} · ${esc(destination)}</small>
      <small>${esc(decision.reason || "Scelta deterministica secondo le priorità configurate.")}</small>
      <small>Dry-run: nessuno stato o contenuto è stato modificato.</small>
    </div>`;
    if (!quiet) message.textContent = `Scelta calcolata · ${engine}.`;
    else message.textContent = `Scelta automatica attuale · ${engine}.`;
    if (opportunityRows.length) renderOpportunities(section, opportunityRows);
  }

  async function loadPlannerPreview(section, quiet = false) {
    if (!section?.isConnected) return;
    const message = section.querySelector("[data-planner-message]");
    try {
      const payload = await endpoint("editorial-planner-preview");
      if (section.isConnected) renderPlannerPreview(section, payload, quiet);
    } catch (error) {
      plannerDecision = null;
      if (!quiet && message) message.textContent = `Anteprima non disponibile: ${error.message}`;
    }
  }

  function contextPagesMarkup(pages) {
    const safePages = (Array.isArray(pages) ? pages : []).filter(Boolean).slice(0, 3);
    if (!safePages.length) return "";
    return `<small>Pagine già intercettate da Search Console:</small>${safePages
      .map((url) => `<small>• ${esc(url)}</small>`)
      .join("")}`;
  }


  function updateProposalStatusLabel(status) {
    return ({ pending_review: "Da approvare", approved: "Approvata", rejected: "Rifiutata" })[status] || status || "—";
  }

  function updateTextDraftStatusLabel(status) {
    return ({ pending_review: "Da revisionare", approved: "Approvata", rejected: "Rifiutata" })[status] || status || "—";
  }

  function updateApplyPreviewStatusLabel(status) {
    return ({ pending_confirmation: "Da confermare", confirmed: "Confermata", cancelled: "Annullata" })[status] || status || "—";
  }

  function metricValueMarkup(metric) {
    if (!metric) return "—";
    const position = metric.avg_position === null || metric.avg_position === undefined ? "—" : Number(metric.avg_position).toFixed(1);
    return `${numberIt(metric.impressions)} imp · ${numberIt(metric.clicks)} clic · pos ${position}`;
  }

  function deltaValueMarkup(delta) {
    if (!delta) return "finestra non ancora interamente post-modifica";
    const signed = (value, digits = 0) => {
      if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
      const n = Number(value);
      return `${n > 0 ? "+" : ""}${digits ? n.toFixed(digits) : numberIt(n)}`;
    };
    return `Δ imp ${signed(delta.impressions)} · Δ clic ${signed(delta.clicks)} · Δ posizione ${signed(delta.avg_position, 2)}`;
  }

  function updateCompletionMarkup(row) {
    const application = row?.evidence?.update_application;
    if (!application || typeof application !== "object") return "";
    const monitor = row?.evidence?.update_monitor;
    const readiness = monitor?.readiness || {};
    const monitorRows = [7, 28].map((days) => {
      const key = String(days);
      const baseline = monitor?.baseline_metrics?.[key] || application?.baseline?.metrics?.[key];
      const current = monitor?.current_metrics?.[key];
      return `<small><b>${days}g:</b> baseline ${esc(metricValueMarkup(baseline))}${monitor ? ` · attuale ${esc(metricValueMarkup(current))} · ${esc(deltaValueMarkup(monitor?.deltas?.[key]))}` : ""}${readiness[key] ? " · finestra post-modifica completa" : ""}</small>`;
    }).join("");
    return `<div class="ol-field" style="margin-top:10px">
      <label>Aggiornamento applicato · verificato</label>
      <small>Chiuso ${esc(dateIt(application.applied_at))} · commit ${esc(application.commit_ref || "—")}.</small>
      <small>Pagina: <a href="${esc(application.target_url || "#")}" target="_blank" rel="noopener noreferrer">${esc(application.target_url || "—")}</a></small>
      ${monitorRows}
      ${monitor?.note ? `<small><b>Monitoraggio:</b> ${esc(monitor.note)}</small>` : "<small>Acquisisci nuovi snapshot Search Console e usa il controllo impatto quando vuoi aggiornare il confronto.</small>"}
      <div class="ol-toolbar-group" style="margin-top:8px">
        <button class="ol-button ol-button-secondary ol-button-small" type="button" data-update-impact-check="${esc(row.id || "")}">Verifica impatto Search Console</button>
      </div>
    </div>`;
  }

  function updateFinalizeMarkup(row) {
    const preview = row?.evidence?.update_apply_preview;
    if (row.status === "completed") return updateCompletionMarkup(row);
    if (preview?.status !== "confirmed") return "";
    return `<div class="ol-field" style="margin-top:10px">
      <label>Chiusura applicazione reale</label>
      <small>Dopo avere pubblicato manualmente il file approvato, inserisci il commit. Il server rilegge la pagina pubblica e chiude l’opportunità soltanto se la sua impronta coincide esattamente con l’anteprima confermata.</small>
      <input type="text" data-update-completion-commit="${esc(row.id || "")}" placeholder="SHA commit Git (es. 386db541…)" autocomplete="off" spellcheck="false">
      <div class="ol-toolbar-group" style="margin-top:8px">
        <button class="ol-button ol-button-secondary ol-button-small" type="button" data-update-complete="${esc(row.id || "")}">Verifica pagina e completa</button>
      </div>
    </div>`;
  }

  function updateApplyPreviewMarkup(row) {
    const preview = row?.evidence?.update_apply_preview;
    if (!preview || typeof preview !== "object") return "";
    const page = preview.page_preview || {};
    const target = preview.target || {};
    const validation = preview.validation || {};
    const unchanged = validation.title_unchanged && validation.h1_unchanged && validation.meta_description_unchanged;
    return `<div class="ol-field" style="margin-top:10px">
      <label>Anteprima applicata · ${esc(updateApplyPreviewStatusLabel(preview.status))}</label>
      <small>Calcolata ${esc(dateIt(preview.prepared_at))} su una copia in memoria della pagina. Il file HTML pubblicato resta invariato.</small>
      <div class="ol-autopilot-archive-item" style="margin-top:6px">
        <strong>Come apparirebbe la sezione</strong>
        <small><b>${esc(target.heading_level || "Sezione")}:</b> ${esc(target.heading_text || "—")}</small>
        <small><b>Prima:</b> ${esc(page.before_paragraph || "—")}</small>
        <small><b>Anteprima:</b> ${esc(page.after_paragraph || "—")}</small>
        <small><b>Controlli:</b> ${unchanged ? "title, H1 e meta description invariati" : "verifica elementi pagina non completata"} · ${Number(preview.change_count || 0)} modifica applicata in memoria.</small>
      </div>
      <div class="ol-toolbar-group" style="margin-top:8px">
        <button class="ol-button ol-button-secondary ol-button-small" type="button" data-update-preview-review="confirmed" data-update-preview-opportunity="${esc(row.id || "")}" ${preview.status === "confirmed" ? "disabled" : ""}>Conferma anteprima</button>
        <button class="ol-button ol-button-secondary ol-button-small" type="button" data-update-preview-review="cancelled" data-update-preview-opportunity="${esc(row.id || "")}" ${preview.status === "cancelled" ? "disabled" : ""}>Annulla anteprima</button>
      </div>
      <small>La conferma registra solo l’autorizzazione a procedere al livello successivo: non modifica e non pubblica la pagina.</small>
      ${updateFinalizeMarkup(row)}
    </div>`;
  }

  function updateTextDraftMarkup(row) {
    const draft = row?.evidence?.update_text_draft;
    if (!draft || typeof draft !== "object") return "";
    const changes = Array.isArray(draft.changes) ? draft.changes : [];
    const changesMarkup = changes.slice(0, 4).map((change) => `<div class="ol-autopilot-archive-item" style="margin-top:6px">
      <strong>${esc(change.label || "Modifica testuale")}</strong>
      <small><b>Prima:</b> ${esc(change.before || "—")}</small>
      <small><b>Dopo:</b> ${esc(change.after || "—")}</small>
      <small><b>Perché:</b> ${esc(change.reason || "—")}</small>
    </div>`).join("");
    return `<div class="ol-field" style="margin-top:10px">
      <label>Bozza testo / diff · ${esc(updateTextDraftStatusLabel(draft.status))}</label>
      <small>Preparata ${esc(dateIt(draft.prepared_at))} esclusivamente dal testo già presente nella pagina.</small>
      ${draft?.target?.heading_text ? `<small>Sezione: ${esc(draft.target.heading_text)}</small>` : ""}
      ${changesMarkup}
      <div class="ol-toolbar-group" style="margin-top:8px">
        <button class="ol-button ol-button-secondary ol-button-small" type="button" data-update-text-review="approved" data-update-text-opportunity="${esc(row.id || "")}" ${draft.status === "approved" ? "disabled" : ""}>Approva testo</button>
        <button class="ol-button ol-button-secondary ol-button-small" type="button" data-update-text-review="rejected" data-update-text-opportunity="${esc(row.id || "")}" ${draft.status === "rejected" ? "disabled" : ""}>Rifiuta testo</button>
      </div>
      <small>Anche l’approvazione del testo non applica modifiche e non pubblica la pagina.</small>
      ${draft.status === "approved" ? `<div class="ol-toolbar-group" style="margin-top:8px"><button class="ol-button ol-button-secondary ol-button-small" type="button" data-update-preview-prepare="${esc(row.id || "")}">${row?.evidence?.update_apply_preview ? "Rigenera anteprima applicata" : "Prepara anteprima applicata"}</button></div><small>L’anteprima applica il diff soltanto a una copia in memoria e richiede una conferma separata.</small>${updateApplyPreviewMarkup(row)}` : ""}
    </div>`;
  }

  function updateProposalMarkup(row) {
    const proposal = row?.evidence?.update_proposal;
    if (!proposal || typeof proposal !== "object") return "";
    const page = proposal.page || {};
    const matched = page.matched_heading?.text || "Nessuna sezione H2/H3 specifica individuata";
    const plan = Array.isArray(proposal.plan) ? proposal.plan : [];
    const targetUrl = String(proposal.target_url || row?.evidence?.target_page_url || "");
    const planMarkup = plan.slice(0, 5).map((item) => `<div class="ol-autopilot-archive-item" style="margin-top:6px">
      <strong>${esc(item.label || "Intervento")}</strong>
      <small><b>Cosa cambierebbe:</b> ${esc(item.change || "—")}</small>
      <small><b>Perché:</b> ${esc(item.reason || "—")}</small>
      ${item.target ? `<small><b>Dove:</b> ${esc(item.target)}</small>` : ""}
    </div>`).join("");
    return `<div class="ol-field" style="margin-top:10px">
      <label>Proposta di aggiornamento · ${esc(updateProposalStatusLabel(proposal.status))}</label>
      <small>Preparata ${esc(dateIt(proposal.prepared_at))}. La pagina pubblicata non è stata modificata.</small>
      ${targetUrl ? `<small>Pagina: <a href="${esc(targetUrl)}" target="_blank" rel="noopener noreferrer">${esc(targetUrl)}</a></small>` : ""}
      <small>Title attuale: ${esc(page.title || "—")}</small>
      <small>H1 attuale: ${esc(page.h1 || "—")}</small>
      <small>Sezione più pertinente: ${esc(matched)}</small>
      ${planMarkup}
      <div class="ol-toolbar-group" style="margin-top:8px">
        <button class="ol-button ol-button-secondary ol-button-small" type="button" data-update-review="approved" data-update-opportunity="${esc(row.id || "")}" ${proposal.status === "approved" ? "disabled" : ""}>Approva proposta</button>
        <button class="ol-button ol-button-secondary ol-button-small" type="button" data-update-review="rejected" data-update-opportunity="${esc(row.id || "")}" ${proposal.status === "rejected" ? "disabled" : ""}>Rifiuta proposta</button>
      </div>
      <small>Anche l’approvazione registra solo la decisione: non applica modifiche alla pagina.</small>
      ${proposal.status === "approved" ? `<div class="ol-toolbar-group" style="margin-top:8px"><button class="ol-button ol-button-secondary ol-button-small" type="button" data-update-text-prepare="${esc(row.id || "")}">${row?.evidence?.update_text_draft ? "Rigenera bozza testo" : "Prepara bozza testo"}</button></div><small>La bozza usa solo testo già presente nella pagina e viene mostrata come diff prima/dopo.</small>` : ""}
      ${proposal.status === "approved" ? updateTextDraftMarkup(row) : ""}
    </div>`;
  }

  function updateTargetWorkflow(row) {
    const id = esc(row.id || "");
    const pages = [...new Set((Array.isArray(row.context_pages) ? row.context_pages : []).filter(Boolean))].slice(0, 5);
    const savedTarget = String(row?.evidence?.target_page_url || "");
    if (savedTarget && !pages.includes(savedTarget)) pages.unshift(savedTarget);
    if (!pages.length) return '<small>Nessuna pagina associata disponibile: non preparo una proposta per evitare collegamenti arbitrari.</small>';
    const options = pages.map((url) => `<option value="${esc(url)}" ${savedTarget === url ? "selected" : ""}>${esc(url)}</option>`).join("");
    const proposal = row?.evidence?.update_proposal;
    return `<div class="ol-field" style="margin-top:8px">
      <label>Pagina da aggiornare</label>
      <select data-update-target="${id}">${options}</select>
      <div class="ol-toolbar-group" style="margin-top:8px">
        <button class="ol-button ol-button-secondary ol-button-small" type="button" data-update-prepare="${id}">${proposal ? "Rigenera proposta" : "Prepara proposta aggiornamento"}</button>
      </div>
      <small>La proposta legge la pagina esistente e salva soltanto un piano di revisione nell’opportunità.</small>
      ${updateProposalMarkup(row)}
    </div>`;
  }

  function opportunityHeading(row) {
    const manual = manualIdeaMeta(row);
    if (manual) {
      return `${esc(row.topic || "Senza titolo")} · Idea manuale · priorità ${esc(manualIdeaPriorityLabel(manual.priority))} · ${esc(opportunityStatusLabel(row.status))}`;
    }
    return `${esc(row.topic || "Senza titolo")} · ${Number(row.score || 0)}/100 · ${esc(opportunityStatusLabel(row.status))}`;
  }

  function opportunitySourceDetails(row) {
    const manual = manualIdeaMeta(row);
    if (manual) {
      const deadline = manual.deadline ? ` · scadenza ${manualIdeaDeadlineLabel(manual.deadline)}` : " · nessuna scadenza";
      const notes = manual.notes ? `<small>Note: ${esc(manual.notes)}</small>` : "";
      const editable = row.status !== "completed" && !row.target_article_id
        ? `<button class="ol-button ol-button-secondary ol-button-small" type="button" data-manual-idea-edit="${esc(row.id || "")}">Modifica idea</button>`
        : "";
      return `<small>Origine: inserimento manuale${esc(deadline)}</small>${notes}${editable ? `<div class="ol-toolbar-group" style="margin-top:8px">${editable}</div>` : ""}`;
    }
    const radar = row?.evidence?.source === "research_radar" ? row.evidence.research_radar : null;
    if (radar) {
      const tools = (radar.related_targets || []).slice(0, 4).map((target) => esc(target?.label || target?.url_path || "")).filter(Boolean).join(" · ");
      const existing = radar.existing_article?.title ? `<small>Articolo correlato: ${esc(radar.existing_article.title)}</small>` : "";
      return `<small>Origine: Radar web · ${esc(researchRadarActionLabel(radar.editorial_action))}</small>${existing}${radar.difference_from_existing ? `<small>Differenza: ${esc(radar.difference_from_existing)}</small>` : ""}${tools ? `<small>Strumenti pertinenti: ${tools}</small>` : ""}`;
    }
    return "";
  }


  function platformLabel(platform) {
    return ({ facebook: "Facebook", instagram: "Instagram", threads: "Threads", linkedin: "LinkedIn" })[platform] || platform;
  }

  function platformChoicesMarkup(id, selected = [], attribute = "data-package-platform") {
    const selectedSet = new Set(Array.isArray(selected) ? selected : []);
    const planOnly = attribute === "data-social-plan-platform";
    const allowed = planOnly ? new Set(["facebook", "instagram"]) : new Set(["facebook", "instagram", "linkedin"]);
    const channels = (socialChannels.length ? socialChannels : [
      { platform: "facebook", display_name: "Facebook", enabled: false },
      { platform: "instagram", display_name: "Instagram", enabled: false },
      { platform: "linkedin", display_name: "LinkedIn", enabled: false },
    ]).filter((channel) => allowed.has(String(channel.platform || "")));
    return channels.map((channel) => {
      const platform = String(channel.platform || "");
      const enabled = Boolean(channel.enabled);
      const checked = enabled && selectedSet.has(platform);
      return `<label class="ol-autopilot-source"><input type="checkbox" ${attribute}="${esc(id)}" value="${esc(platform)}" ${checked ? "checked" : ""} ${enabled ? "" : "disabled"}>${esc(channel.display_name || platformLabel(platform))}${enabled ? "" : " · non collegato"}</label>`;
    }).join("");
  }

  function articleImageWorkflowMarkup(row) {
    const id = String(row?.id || "");
    const articleId = String(row?.target_article_id || "");
    const generation = row?.evidence?.article_generation;
    if (!articleId || !generation) return "";
    const imageState = row?.evidence?.article_image && typeof row.evidence.article_image === "object"
      ? row.evidence.article_image
      : {};
    const candidate = imageState?.candidate && typeof imageState.candidate === "object" ? imageState.candidate : null;
    const current = imageState?.current && typeof imageState.current === "object" ? imageState.current : null;
    const candidateAlt = String(candidate?.alt_text || current?.alt_text || `Immagine editoriale dedicata a ${row.topic || "articolo OffertaLogica"}`).slice(0, 180);
    const currentMarkup = current?.url
      ? `<div style="margin-top:8px"><small>Immagine approvata e collegata all’articolo.</small><div style="margin-top:6px"><img src="${esc(current.url)}" alt="${esc(current.alt_text || "Immagine articolo approvata")}" loading="lazy" style="display:block;max-width:520px;width:100%;height:auto;border-radius:10px"></div></div>`
      : '<small>Nessuna immagine approvata ancora.</small>';
    const qa = candidate?.qa && typeof candidate.qa === "object" ? candidate.qa : null;
    const qaStatus = String(qa?.status || "");
    const qaMarkup = qaStatus === "passed"
      ? `<div style="margin-top:6px"><small><strong>QA visiva automatica superata.</strong> Pertinenza, chiarezza e qualità editoriale verificate.</small></div>`
      : qaStatus === "failed"
        ? `<div style="margin-top:6px"><small><strong>QA visiva non superata.</strong> ${esc(qa?.reason || "L’immagine verrà rigenerata automaticamente.")}</small></div>`
        : qaStatus === "human_review_required"
          ? `<div style="margin-top:6px"><small><strong>Controllo umano richiesto.</strong> La QA visiva non è stata superata dopo due rigenerazioni. ${esc(qa?.reason || "Verifica l’anteprima prima di approvarla o rigenerala manualmente.")}</small></div>`
          : "";
    const candidateMarkup = candidate?.url
      ? `<div style="margin-top:10px"><strong>Anteprima da approvare</strong><div style="margin-top:6px"><img src="${esc(candidate.url)}" alt="${esc(candidate.alt_text || "Anteprima immagine articolo")}" loading="lazy" style="display:block;max-width:620px;width:100%;height:auto;border-radius:10px"></div><small>${candidate.source === "manual_upload" ? "Immagine caricata manualmente" : `Generata in HD · ${esc(candidate.model || "modello immagini")}`} · non ancora collegata all’articolo.</small>${qaMarkup}</div>`
      : "";
    return `<div class="ol-field" style="margin-top:12px" data-article-image-workflow="${esc(id)}">
      <label>Immagine dedicata articolo · HD fotografica</label>
      <small>La master è orizzontale e senza testo sovrapposto, pensata anche per futuri crop del post statico. L’immagine attuale non cambia finché non approvi la nuova anteprima.</small>
      ${currentMarkup}
      ${candidateMarkup}
      <div class="ol-field" style="margin-top:8px"><label>Indicazioni per generare o rigenerare <span class="ol-muted">(facoltative)</span></label><textarea data-article-image-guidance="${esc(id)}" maxlength="600" rows="2" placeholder="Es. più realistica, niente persone, inquadratura più pulita, focus su contatore e abitazione…"></textarea></div>
      <div class="ol-field" style="margin-top:8px"><label>Testo alternativo</label><input data-article-image-alt="${esc(id)}" type="text" maxlength="180" value="${esc(candidateAlt)}"></div>
      <div class="ol-field" style="margin-top:8px"><label>Sostituzione manuale</label><input data-article-image-file="${esc(id)}" type="file" accept="image/jpeg,image/png,image/webp,image/avif"><small>JPG, PNG, WebP o AVIF, massimo 5 MB. Il file diventa prima una nuova anteprima e richiede comunque approvazione.</small></div>
      <div class="ol-toolbar-group" style="margin-top:8px">
        <button class="ol-button ol-button-primary ol-button-small" type="button" data-article-image-generate="${esc(id)}">${candidate || current ? "Rigenera immagine fotografica HD" : "Genera immagine fotografica HD"}</button>
        <button class="ol-button ol-button-secondary ol-button-small" type="button" data-article-image-upload="${esc(id)}">Carica / sostituisci manualmente</button>
        ${candidate ? `<button class="ol-button ol-button-primary ol-button-small" type="button" data-article-image-approve="${esc(id)}">Approva e usa nell’articolo</button><button class="ol-button ol-button-secondary ol-button-small" type="button" data-article-image-discard="${esc(id)}">Scarta anteprima</button>` : ""}
      </div>
      <small data-article-image-message="${esc(id)}">${candidate ? "Puoi approvare questa anteprima, rigenerarla oppure sostituirla con un tuo file." : current ? "Puoi lasciare l’immagine approvata oppure preparare un’alternativa senza sostituirla subito." : "Genera la prima immagine dedicata oppure caricane una tua."}</small>
    </div>`;
  }

  async function uploadArticleImageFile(file, id) {
    if (!file) throw new Error("Seleziona un’immagine da caricare.");
    const allowed = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"], ["image/avif", "avif"]]);
    if (!allowed.has(file.type)) throw new Error("Formato non supportato. Usa JPG, PNG, WebP o AVIF.");
    if (file.size <= 0 || file.size > 5 * 1024 * 1024) throw new Error("L’immagine deve pesare al massimo 5 MB.");
    const session = sessionRead();
    if (!session?.access_token || !session?.user?.id) throw new Error("Sessione Redazione non disponibile.");
    const config = window.OFFERTALOGICA_EDITORIAL_CONFIG || {};
    const baseUrl = String(config.supabaseUrl || "").replace(/\/+$/, "");
    const anonKey = String(config.supabaseAnonKey || "").trim();
    if (!/^https:\/\//i.test(baseUrl) || anonKey.length < 20) throw new Error("Storage editoriale non configurato.");
    const ext = allowed.get(file.type);
    const safeId = String(id || "immagine").replace(/[^a-z0-9-]/gi, "").slice(0, 60) || "immagine";
    const objectPath = `${session.user.id}/${Date.now()}-autopilota-${safeId}.${ext}`;
    const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(`${baseUrl}/storage/v1/object/editorial-images/${encodedPath}`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": file.type,
        "x-upsert": "false",
      },
      body: file,
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.message || payload?.error || `Upload ${response.status}`);
    return `${baseUrl}/storage/v1/object/public/editorial-images/${encodedPath}`;
  }

  function articleGenerationMarkup(row) {
    const id = String(row?.id || "");
    const generation = row?.evidence?.article_generation;
    const job = row?.evidence?.article_generation_job;
    const jobRunning = Boolean(job?.response_id && ["queued", "in_progress"].includes(String(job.status || "")));
    const qa = generation?.qa || {};
    const sourceCount = Number(qa.sources_count || generation?.sources?.length || 0);
    const buttonLabel = jobRunning ? "Riprendi controllo generazione" : generation ? "Rigenera bozza completa" : "Genera bozza completa con fonti";
    const currentPlatforms = Array.isArray(job?.platforms) ? job.platforms : Array.isArray(generation?.platforms) ? generation.platforms : [];
    const summary = jobRunning
      ? `<small>Generazione asincrona ${esc(job.status === "queued" ? "in coda" : "in corso")} dal ${esc(dateIt(job.started_at))}. Puoi lasciare lavorare il motore e riprendere il controllo senza perdere il job.</small>`
      : generation
        ? `<small>Ultima generazione: ${esc(dateIt(generation.generated_at))} · ${esc(generation.model || "modello server")} · ${sourceCount} fonti · ${Number(qa.static_posts_count || 0)} post statici. Pacchetto editoriale pronto per il calendario.</small>`
        : '<small>La generazione usa ricerca web lato server in background, salva le fonti, applica controlli minimi e prepara due post statici. La pubblicazione resta governata dalla modalità Autopilota e dal calendario.</small>';
    return `<div class="ol-field" style="margin-top:8px">
      <label>Canali del ciclo editoriale</label>
      <div class="ol-autopilot-sources">${platformChoicesMarkup(id, currentPlatforms)}</div>
      <small>Facebook e Instagram vengono usati per lancio articolo + due post statici. LinkedIn, se collegato, pubblica solo il lancio dell’articolo.</small>
      <div class="ol-toolbar-group" style="margin-top:8px">
        <button class="ol-button ol-button-primary ol-button-small" type="button" data-article-generate="${esc(id)}">${buttonLabel}</button>
      </div>
      ${summary}
      ${articleImageWorkflowMarkup(row)}
    </div>`;
  }

  function socialPlanStatusLabel(status) {
    return ({ draft: "Bozza", approved: "Approvato", cancelled: "Annullato", scheduled: "Programmato", publishing: "Pubblicazione", published: "Pubblicato", failed: "Errore" })[status] || status || "—";
  }

  function automationRunOpportunityId(run) {
    const details = run?.details || {};
    return String(run?.opportunity_id || details.selected_opportunity_id || details.opportunity_id || "").trim();
  }

  function automationRunArticleId(run) {
    return String(run?.article_id || run?.details?.article_id || "").trim();
  }

  function currentEditorialCycle() {
    // Se esiste già un articolo realmente in lavorazione, quello è il ciclo corrente.
    // La sola "ricerca più recente" può restare indietro di alcuni giorni rispetto
    // alla bozza effettivamente avviata (es. ricerca venerdì, bozza martedì).
    const activeRecord = articleHistoryRecords().find((record) => articleCompletionState(record).tone !== "success") || null;
    if (activeRecord?.opportunityId && activeRecord?.articleId) {
      const anchor = automationRuns.find((run) => {
        return String(run?.run_type || "") === "research"
          && automationRunOpportunityId(run) === activeRecord.opportunityId;
      }) || activeRecord.runs?.[activeRecord.runs.length - 1] || null;
      return {
        opportunityId: activeRecord.opportunityId,
        articleId: activeRecord.articleId,
        article: activeRecord.article || null,
        record: activeRecord,
        anchor,
      };
    }

    // Fallback: prima che esista una bozza/articolo, il ciclo nasce dalla ricerca
    // più recente che ha selezionato un'opportunità.
    const anchor = automationRuns.find((run) => {
      return String(run?.run_type || "") === "research" && Boolean(automationRunOpportunityId(run));
    }) || null;
    if (!anchor) return null;
    const opportunityId = automationRunOpportunityId(anchor);
    const articleRun = automationRuns.find((run) => automationRunOpportunityId(run) === opportunityId && automationRunArticleId(run)) || null;
    return {
      opportunityId,
      articleId: automationRunArticleId(articleRun),
      article: null,
      record: null,
      anchor,
    };
  }

  function cycleRunState(runType, cycle) {
    if (!cycle?.opportunityId) return { label: "da eseguire", tone: "pending", at: "" };
    if (runType === "article_publish" && String(cycle?.record?.article?.status || "") === "published") {
      return { label: "completato", tone: "success", at: cycle.record.article.published_at || cycle.record.article.updated_at || "" };
    }
    const run = automationRuns.find((row) => {
      if (String(row?.run_type || "") !== runType) return false;
      if (automationRunOpportunityId(row) !== cycle.opportunityId) return false;
      if (cycle.articleId && runType !== "research") {
        const rowArticleId = automationRunArticleId(row);
        if (rowArticleId && rowArticleId !== cycle.articleId) return false;
      }
      return true;
    }) || null;
    if (!run) {
      if (runType === "research" && cycle.opportunityId) {
        const at = cycle.anchor?.finished_at || cycle.anchor?.started_at || cycle.anchor?.created_at || "";
        return { label: "completato", tone: "success", at };
      }
      if (cycle.record) {
        const fallback = articleStepState(cycle.record, runType);
        if (fallback?.tone && fallback.tone !== "pending") return { ...fallback, at: "" };
        if (runType === "article_prepare" && cycle.articleId) return { label: "completato", tone: "success", at: "" };
      }
      return { label: "da eseguire", tone: "pending", at: "" };
    }
    const at = run.finished_at || run.started_at || run.created_at || "";
    const status = String(run.status || "");
    if (status === "success") {
      const stage = String(run?.details?.stage || "");
      if (["skipped", "blocked", "waiting_human_review", "waiting_human_approval", "skipped_draft_mode"].includes(stage)) return { label: "in attesa", tone: "pending", at };
      return { label: "completato", tone: "success", at };
    }
    if (status === "failed") return { label: "errore", tone: "failed", at };
    if (status === "running") return { label: "in corso", tone: "running", at };
    return { label: status || "da eseguire", tone: "pending", at };
  }

  function compactAutomationRuns(runs) {
    const rows = Array.isArray(runs) ? runs : [];
    const shouldHide = new Set();
    const timeOf = (run) => {
      const value = run?.started_at || run?.created_at || "";
      const ms = Date.parse(value);
      return Number.isFinite(ms) ? ms : null;
    };

    for (const run of rows) {
      if (String(run?.run_type || "") !== "article_prepare") continue;
      if (String(run?.details?.stage || "") !== "background_started") continue;
      const opportunityId = automationRunOpportunityId(run);
      const articleId = automationRunArticleId(run);
      if (!opportunityId || !articleId) continue;
      const startedAt = timeOf(run);
      const continuation = rows.find((candidate) => {
        if (candidate === run) return false;
        if (String(candidate?.run_type || "") !== "article_prepare") return false;
        if (String(candidate?.details?.stage || "") === "background_started") return false;
        if (automationRunOpportunityId(candidate) !== opportunityId) return false;
        if (automationRunArticleId(candidate) !== articleId) return false;
        const candidateAt = timeOf(candidate);
        if (startedAt === null || candidateAt === null) return true;
        return candidateAt >= startedAt && candidateAt - startedAt <= 30 * 60 * 1000;
      });
      if (continuation) shouldHide.add(String(run.id || ""));
    }

    return rows.filter((run) => !shouldHide.has(String(run?.id || "")));
  }

  function articlePublicUrl(article) {
    const slug = String(article?.slug || "").trim();
    return slug ? `/articoli/${encodeURIComponent(slug)}.html` : "";
  }

  function articleHistoryRecords() {
    const map = new Map();
    const ensure = (key, patch = {}) => {
      if (!key) return null;
      if (!map.has(key)) {
        map.set(key, {
          key,
          articleId: "",
          opportunityId: "",
          article: null,
          planItems: [],
          runs: [],
        });
      }
      const current = map.get(key);
      const next = { ...current, ...patch };
      if (patch.article) next.article = { ...(current.article || {}), ...patch.article };
      map.set(key, next);
      return next;
    };

    for (const row of socialPlanItems) {
      const article = row?.source_article && typeof row.source_article === "object" ? row.source_article : null;
      const articleId = String(row?.source_article_id || article?.id || "").trim();
      const opportunityId = String(row?.opportunity_id || "").trim();
      const key = articleId || (opportunityId ? `opportunity:${opportunityId}` : "");
      const record = ensure(key, { articleId, opportunityId, article });
      if (record) record.planItems.push(row);
    }

    for (const run of automationRuns) {
      const articleId = automationRunArticleId(run);
      const opportunityId = automationRunOpportunityId(run);
      const key = articleId || (opportunityId ? `opportunity:${opportunityId}` : "");
      const record = ensure(key, { articleId, opportunityId });
      if (record) record.runs.push(run);
    }

    return [...map.values()].filter((record) => Boolean(record.articleId)).map((record) => {
      const latestAt = [
        ...(record.runs || []).map((run) => run?.started_at || run?.created_at || ""),
        ...(record.planItems || []).map((row) => row?.updated_at || row?.created_at || ""),
        record.article?.published_at || "",
      ].filter(Boolean).sort().reverse()[0] || "";
      return { ...record, latestAt };
    }).sort((a, b) => String(b.latestAt || "").localeCompare(String(a.latestAt || "")));
  }

  function articleRelatedPlanItem(record, postType) {
    return (record?.planItems || []).find((row) => String(row?.post_type || "") === postType) || null;
  }

  function runStateLabelFromRun(run) {
    if (!run) return null;
    const status = String(run.status || "");
    const stage = String(run?.details?.stage || "");
    if (status === "success") {
      if (["skipped", "blocked", "waiting_human_review", "waiting_human_approval", "waiting_social_retry", "skipped_draft_mode"].includes(stage)) return { label: "in attesa", tone: "pending" };
      return { label: "completato", tone: "success" };
    }
    if (status === "failed") return { label: "errore", tone: "failed" };
    if (status === "running") return { label: "in corso", tone: "running" };
    return { label: status || "da eseguire", tone: "pending" };
  }

  function articlePlanState(item) {
    if (!item) return { label: "da eseguire", tone: "pending" };
    const status = String(item.status || "draft");
    if (status === "published") return { label: "completato", tone: "success" };
    if (status === "failed") return { label: "errore", tone: "failed" };
    if (["publishing", "scheduled"].includes(status)) return { label: "in corso", tone: "running" };
    if (status === "cancelled") return { label: "annullato", tone: "pending" };
    return { label: "da eseguire", tone: "pending" };
  }

  function articleStepState(record, runType) {
    const run = (record?.runs || []).find((row) => String(row?.run_type || "") === runType) || null;
    if (run) return runStateLabelFromRun(run);
    if (runType === "article_publish" && String(record?.article?.status || "") === "published") return { label: "completato", tone: "success" };
    if (runType === "article_prepare" && record?.articleId) return { label: "completato", tone: "success" };
    if (runType === "social_followup") return articlePlanState(articleRelatedPlanItem(record, "article_followup"));
    if (runType === "social_related") return articlePlanState(articleRelatedPlanItem(record, "related"));
    return { label: "da eseguire", tone: "pending" };
  }

  function articleCompletionState(record) {
    const steps = ["article_prepare", "article_publish", "social_followup", "social_related"].map((type) => articleStepState(record, type));
    if (steps.some((step) => step.tone === "failed")) return { label: "Attenzione", tone: "failed" };
    if (steps.every((step) => step.tone === "success")) return { label: "Completo", tone: "success" };
    return { label: "In corso", tone: "pending" };
  }

  function articleOpportunity(record) {
    const id = String(record?.opportunityId || "");
    return opportunityRows.find((row) => String(row?.id || "") === id) || null;
  }

  function articleResearchMarkup(record) {
    const opportunity = articleOpportunity(record);
    if (!opportunity) return '<div class="ol-article-history-section"><strong>Ricerca selezionata</strong><small>Dati della selezione non disponibili nello storico caricato.</small></div>';
    const queries = opportunityQueryExamples(opportunity);
    const brief = opportunity?.editorial_brief && typeof opportunity.editorial_brief === "object" ? opportunity.editorial_brief : null;
    return `<div class="ol-article-history-section">
      <strong>Ricerca selezionata per questo articolo</strong>
      <div class="ol-article-selected-topic"><b>${esc(opportunity.topic || "Tema non disponibile")}</b>${manualIdeaMeta(opportunity) ? '<span>Idea manuale</span>' : `<span>${Number(opportunity.score || 0)}/100</span>`}</div>
      ${opportunity.rationale ? `<small><b>Perché è stata selezionata:</b> ${esc(opportunity.rationale)}</small>` : ""}
      ${queries.length ? `<small><b>Query collegate:</b> ${esc(queries.join(" · "))}</small>` : ""}
      ${brief?.search_intent ? `<small><b>Intento:</b> ${esc(brief.search_intent)}</small>` : ""}
      ${brief?.article_angle ? `<small><b>Brief editoriale:</b> ${esc(brief.article_angle)}</small>` : ""}
    </div>`;
  }

  function articleDraftMarkup(record) {
    const article = record?.article || {};
    if (!record?.articleId) return "";
    const content = String(article.content || "").trim();
    const sources = String(article.sources || "").trim();
    return `<div class="ol-article-history-section">
      <strong>Bozza / articolo</strong>
      ${article.title ? `<small><b>Titolo:</b> ${esc(article.title)}</small>` : ""}
      ${article.excerpt ? `<small><b>Sommario:</b> ${esc(article.excerpt)}</small>` : ""}
      ${content ? `<details class="ol-article-text-details"><summary>Apri testo completo</summary><pre>${esc(content)}</pre></details>` : '<small>Testo della bozza non disponibile.</small>'}
      ${sources ? `<details class="ol-article-text-details"><summary>Apri fonti</summary><pre>${esc(sources)}</pre></details>` : ""}
    </div>`;
  }

  function articleTimelineMarkup(record) {
    const steps = [
      ["article_prepare", "Bozza articolo"],
      ["article_publish", "Articolo pubblicato"],
      ["social_followup", "Post di venerdì"],
      ["social_related", "Post OffertaLogica"],
    ].map(([type, title]) => ({ title, ...articleStepState(record, type) }));
    return `<div class="ol-cycle-steps ol-cycle-steps-article">${steps.map((step) => `<span class="ol-cycle-step ol-cycle-step-${esc(step.tone)}"><b>${esc(step.title)}</b><small>${esc(step.label)}</small></span>`).join("")}</div>`;
  }

  function planItemEditorMarkup(row) {
    const id = String(row.id || "");
    const editable = ["draft", "approved", "cancelled"].includes(String(row.status || ""));
    const destination = row.destination_target
      ? `${row.destination_target.label} · ${row.destination_target.url_path}`
      : row.post_type === "article_followup" ? "Articolo collegato" : "—";
    const statusOptions = [
      ["draft", "Bozza"], ["approved", "Approvato"], ["cancelled", "Annullato"],
    ].map(([value, label]) => `<option value="${value}" ${row.status === value ? "selected" : ""}>${label}</option>`).join("");

    const socialAsset = row.social_asset && typeof row.social_asset === "object" ? row.social_asset : null;
    const articleTakeaway = String(socialAsset?.brief?.article_takeaway || "").trim();
    const destinationSolution = String(socialAsset?.brief?.destination_solution || "").trim();
    const copyQaReason = String(socialAsset?.brief?.copy_qa?.reason || "").trim();
    const socialImageUrl = /^https:\/\//i.test(String(socialAsset?.image?.url || "")) ? String(socialAsset.image.url) : "";
    const socialCardUrl = /^https:\/\//i.test(String(socialAsset?.card?.url || "")) ? String(socialAsset.card.url) : "";
    const articleImageUrl = /^https:\/\//i.test(String(row.source_article?.featured_image_url || "")) ? String(row.source_article.featured_image_url) : "";
    const imageQa = socialAsset?.image?.qa && typeof socialAsset.image.qa === "object" ? socialAsset.image.qa : null;
    const imageQaStatus = String(imageQa?.status || "");
    const imageState = imageQaStatus === "passed"
      ? "Approvata"
      : imageQaStatus === "failed"
        ? "QA fallita"
        : imageQaStatus === "human_review_required"
          ? "Revisione richiesta"
          : socialImageUrl ? "Da verificare" : "Non ancora generata";
    const imageReason = String(imageQa?.reason || "").trim();
    const imageSource = String(socialAsset?.image?.source || "");
    const imageAttempt = Number(socialAsset?.image?.attempt || 0);
    const canReview = !["publishing", "published"].includes(String(row.status || ""));
    const canUseArticleImage = Boolean(articleImageUrl && articleImageUrl !== socialImageUrl && canReview);
    const imageMarkup = (socialImageUrl || articleImageUrl) ? `
      <div class="ol-autopilot-archive-item" style="margin-top:10px">
        <strong>Immagine del post ${esc(row.post_type === "related" ? "OffertaLogica" : "follow-up")}</strong>
        <small>Stato: ${esc(imageState)}${imageAttempt ? ` · tentativo ${imageAttempt}` : ""}${imageSource ? ` · sorgente ${esc(imageSource)}` : ""}</small>
        ${imageReason ? `<small>${esc(imageReason)}</small>` : ""}
        ${socialImageUrl ? `<div style="margin-top:8px"><img src="${esc(socialImageUrl)}" alt="${esc(socialAsset?.image?.alt_text || "Anteprima immagine social")}" loading="lazy" style="display:block;max-width:320px;width:100%;height:auto;border-radius:10px"></div>` : '<small>Nessuna immagine social corrente: puoi usare direttamente quella dell’articolo.</small>'}
        ${canReview ? `<div class="ol-toolbar-group" style="margin-top:8px">
          ${socialImageUrl && imageQaStatus !== "passed" ? `<button class="ol-button ol-button-primary ol-button-small" type="button" data-social-image-review="${esc(id)}" data-social-image-decision="approve">Approva questa immagine</button>` : ""}
          ${canUseArticleImage ? `<button class="ol-button ol-button-secondary ol-button-small" type="button" data-social-image-review="${esc(id)}" data-social-image-decision="use_article_image">Usa immagine articolo</button>` : ""}
        </div>` : ""}
        ${articleImageUrl && articleImageUrl !== socialImageUrl ? `<details style="margin-top:8px"><summary>Confronta con immagine articolo</summary><img src="${esc(articleImageUrl)}" alt="${esc(row.source_article?.featured_image_alt || "Immagine articolo")}" loading="lazy" style="display:block;max-width:320px;width:100%;height:auto;border-radius:10px;margin-top:8px"></details>` : ""}
        ${socialCardUrl ? `<details style="margin-top:8px"><summary>Apri card OL Informa composta</summary><img src="${esc(socialCardUrl)}" alt="Anteprima card OL Informa" loading="lazy" style="display:block;max-width:320px;width:100%;height:auto;border-radius:10px;margin-top:8px"></details>` : ""}
      </div>` : "";

    return `<details class="ol-cycle-row ol-cycle-row-nested" data-social-plan-item="${esc(id)}">
      <summary class="ol-cycle-row-summary">
        <span><strong>${esc(row.post_type === "related" ? "Post OffertaLogica" : "Follow-up")}</strong><small>${esc(destination)}</small></span>
        <span class="ol-cycle-status-badge ol-cycle-status-${esc(String(row.status || "draft"))}">${esc(socialPlanStatusLabel(row.status))}</span>
      </summary>
      <div class="ol-cycle-row-body">
        <small>${esc(row.theme || "")}</small>
        ${articleTakeaway ? `<div class="ol-autopilot-archive-item" style="margin-top:10px"><strong>Sintesi editoriale usata dal post</strong><small>${esc(articleTakeaway)}</small>${copyQaReason ? `<small><b>QA copy:</b> ${esc(copyQaReason)}</small>` : ""}</div>` : ""}
        ${destinationSolution ? `<div class="ol-autopilot-archive-item" style="margin-top:10px"><strong>Funzione OffertaLogica usata nel post</strong><small>${esc(destinationSolution)}</small></div>` : ""}
        ${imageMarkup}
        <div class="ol-field" style="margin-top:8px"><label>Testo canonico</label><textarea data-social-plan-text="${esc(id)}" rows="4" maxlength="4000" ${editable ? "" : "disabled"}>${esc(row.canonical_text || "")}</textarea></div>
        <div class="ol-field" style="margin-top:8px"><label>Canali espliciti</label><div class="ol-autopilot-sources">${platformChoicesMarkup(id, row.platforms || [], "data-social-plan-platform")}</div></div>
        ${editable ? `<div class="ol-autopilot-fields" style="margin-top:8px"><div class="ol-field"><label>Stato editoriale</label><select data-social-plan-status="${esc(id)}">${statusOptions}</select></div></div><div class="ol-toolbar-group" style="margin-top:8px"><button class="ol-button ol-button-secondary ol-button-small" type="button" data-social-plan-save="${esc(id)}">Salva post</button></div>` : ""}
        ${["article_followup", "related"].includes(String(row.post_type || "")) && ["approved", "published", "failed"].includes(String(row.status || "")) ? `<div class="ol-social-regenerate-box"><small>Usa questa funzione solo dopo aver eliminato manualmente le vecchie pubblicazioni social, per evitare duplicati.</small><button class="ol-button ol-button-warning ol-button-small" type="button" data-social-plan-regenerate="${esc(id)}">Rigenera card OL Informa e ripubblica</button></div>` : ""}
      </div>
    </details>`;
  }

  function pendingCarryoverRecord() {
    const cycle = currentEditorialCycle();
    return articleHistoryRecords().find((record) => {
      if (!record?.articleId) return false;
      if (cycle?.opportunityId && record.opportunityId === cycle.opportunityId) return false;
      const relatedState = articleStepState(record, "social_related");
      const publishState = articleStepState(record, "article_publish");
      return publishState.tone === "success" && relatedState.tone !== "success";
    }) || null;
  }

  function renderArticleHistory(section) {
    const list = section?.querySelector("[data-social-plan-list]");
    const message = section?.querySelector("[data-social-plan-message]");
    if (!list || !message) return;
    const records = articleHistoryRecords();
    if (!records.length) {
      list.innerHTML = '<p class="ol-muted">Nessun articolo ancora monitorato.</p>';
      message.textContent = "Lo storico si popolerà quando il primo articolo avrà una bozza o un post collegato.";
      renderCycleOverview(section);
      return;
    }
    list.innerHTML = records.map((record) => {
      const article = record.article || {};
      const summary = articleCompletionState(record);
      const publicUrl = articlePublicUrl(article);
      const detailLines = [];
      const articlePublishRun = (record.runs || []).find((run) => String(run?.run_type || "") === "article_publish") || null;
      if (articlePublishRun?.started_at) detailLines.push(`Pubblicazione ${dateIt(articlePublishRun.started_at)}`);
      else if (article?.published_at) detailLines.push(`Pubblicazione ${dateIt(article.published_at)}`);
      const followup = articleRelatedPlanItem(record, "article_followup");
      const related = articleRelatedPlanItem(record, "related");
      const carryover = articleStepState(record, "social_related").tone !== "success" && articleStepState(record, "article_publish").tone === "success";
      return `<details class="ol-cycle-row ol-article-history-row" data-article-history="${esc(record.key)}">
        <summary class="ol-cycle-row-summary">
          <span><strong>${esc(article.title || followup?.theme || related?.theme || "Articolo del ciclo")}</strong><small>${esc(detailLines.join(" · ") || (record.opportunityId ? `Opportunità ${record.opportunityId}` : "Cronologia articolo"))}</small></span>
          <span class="ol-cycle-status-badge ol-cycle-status-${esc(summary.tone)}">${esc(summary.label)}</span>
        </summary>
        <div class="ol-cycle-row-body">
          ${articleTimelineMarkup(record)}
          ${carryover ? `<div class="ol-cycle-carryover-note"><strong>Da chiudere:</strong> il Post OffertaLogica di questo articolo non risulta ancora completato.</div>` : ""}
          ${articleResearchMarkup(record)}
          ${articleDraftMarkup(record)}
          ${publicUrl ? `<div class="ol-toolbar-group"><a class="ol-button ol-button-secondary ol-button-small" href="${esc(publicUrl)}" target="_blank" rel="noopener">Apri articolo pubblico</a></div>` : ""}
          ${(record.planItems || []).length ? `<div class="ol-article-plan-group"><small class="ol-article-plan-title">Post collegati</small>${record.planItems.map((row) => planItemEditorMarkup(row)).join("")}</div>` : ""}
          ${compactAutomationRuns(record.runs || []).length ? `<div class="ol-article-run-log"><small class="ol-article-plan-title">Registro del ciclo</small>${compactAutomationRuns(record.runs || []).slice(0, 8).map((run) => { const state = runStateLabelFromRun(run); return `<div class="ol-article-run-log-item"><strong>${esc(automationRunTypeLabel(run.run_type))}</strong><span>${esc(dateIt(run.started_at || run.created_at))}</span><em class="ol-cycle-status-inline ol-cycle-status-inline-${esc(state.tone)}">${esc(state.label)}</em></div>`; }).join("")}</div>` : ""}
        </div>
      </details>`;
    }).join("");
    message.textContent = `${numberIt(records.length)} articoli monitorati. Clicca una riga per vedere lo stato completo del ciclo di quell’articolo.`;
    renderCycleOverview(section);
  }

  function schedulerActionLabel(action) {
    return ({
      idle: "nessuna azione eseguibile in questo tick",
      disabled: "scheduler disattivato",
      research_collect_7: "raccolta Search Console 7 giorni",
      research_collect_28: "raccolta Search Console 28 giorni",
      research_collect_90: "raccolta Search Console 90 giorni",
      research_plan: "ricerca e scelta opportunità completate",
      article_generation_started: "generazione bozza avviata",
      article_generation_check: "controllo generazione bozza",
      image_candidate_generated: "immagine articolo generata",
      image_qa_passed: "QA immagine articolo superata",
      article_intro_social_copy_generated: "testo social dell’articolo preparato",
      article_intro_social_card_generated: "card social dell’articolo generata",
      article_intro_social_ready: "asset social dell’articolo pronto",
      social_asset_brief_generated: "brief del post social preparato",
      social_asset_cover_text_generated: "testo della card preparato",
      social_asset_image_generated: "immagine social generata",
      social_asset_image_qa_passed: "QA immagine social superata",
      social_asset_article_image_fallback_ready: "fallback sull’immagine articolo e card pronta",
      social_asset_card_generated: "card OL Informa generata",
      social_asset_ready: "asset social pronto",
      article_publish_waiting_social_retry: "social iniziale in attesa tecnica: riprova automatica",
      social_followup_waiting_social_retry: "follow-up in attesa tecnica: riprova automatica",
      social_related_waiting_social_retry: "post OffertaLogica in attesa tecnica: riprova automatica",
      social_regeneration_waiting: "rigenerazione social in attesa tecnica: riprova automatica",
      article_published: "articolo pubblicato",
      article_published_social_check_required: "articolo pubblicato, social da verificare",
      social_regeneration_published: "rigenerazione social pubblicata",
      waiting_social_assets: "in attesa degli asset social",
      background_social_error: "errore social in background",
      failed: "tick terminato con errore",
    })[String(action || "")] || String(action || "nessuna azione registrata").replaceAll("_", " ");
  }

  function schedulerHeartbeatMarkup(cycle, steps) {
    const opportunity = opportunityRows.find((row) => String(row?.id || "") === String(cycle?.opportunityId || "")) || null;
    const heartbeat = opportunity?.evidence?.scheduler_heartbeat && typeof opportunity.evidence.scheduler_heartbeat === "object"
      ? opportunity.evidence.scheduler_heartbeat
      : null;
    const currentStep = steps.find((step) => step.tone !== "success") || null;
    const phase = currentStep ? currentStep.title : "Ciclo completo";
    if (!heartbeat?.at) {
      return `<div class="ol-autopilot-archive-item"><strong>Tick Autopilota</strong><small>Fase corrente: ${esc(phase)}. Il prossimo heartbeat registrerà qui l’orario effettivo e l’azione eseguita.</small></div>`;
    }

    const lastMs = Date.parse(heartbeat.at);
    const nextMs = Number.isFinite(lastMs) ? lastMs + (15 * 60 * 1000) : NaN;
    const now = Date.now();
    const delayed = Number.isFinite(nextMs) && now > nextMs + (5 * 60 * 1000);
    const state = heartbeat.ok === false ? "errore" : delayed ? "ritardo da verificare" : "attivo";
    const nextText = Number.isFinite(nextMs) ? dateIt(new Date(nextMs).toISOString()) : "—";
    const action = schedulerActionLabel(heartbeat.action);
    const slot = heartbeat.slot_label ? ` · slot ${heartbeat.slot_label}` : "";
    const errorText = heartbeat.error ? ` · errore: ${heartbeat.error}` : "";
    return `<div class="ol-autopilot-archive-item"><strong>Tick Autopilota · ${esc(state)}</strong><small>Ultimo tick effettivo: ${esc(dateIt(heartbeat.at))} · prossimo previsto: ${esc(nextText)}</small><small>Fase corrente: ${esc(phase)} · ultimo esito: ${esc(action)}${esc(slot)}${esc(errorText)}</small></div>`;
  }

  function renderCycleOverview(section) {
    const box = section?.querySelector("[data-cycle-overview]");
    if (!box) return;
    const cycle = currentEditorialCycle();
    if (!cycle) {
      box.innerHTML = '<strong>Ciclo articolo attuale</strong><p class="ol-muted">Nessun ciclo con opportunità selezionata è ancora registrato.</p>';
      return;
    }
    const steps = [
      ["research", "Ricerca"],
      ["article_prepare", "Bozza articolo"],
      ["article_publish", "Pubblicazione"],
      ["social_followup", "Follow-up"],
      ["social_related", "Post OffertaLogica"],
    ].map(([type, title]) => ({ title, ...cycleRunState(type, cycle) }));
    const startedAt = cycle.anchor?.started_at || cycle.anchor?.created_at || "";
    const currentTitle = String(cycle.article?.title || "").trim();
    const cycleNote = currentTitle
      ? `Articolo corrente: ${currentTitle}${startedAt ? ` · ricerca del ${dateIt(startedAt)}` : ""}.`
      : startedAt ? `Ricerca del ${dateIt(startedAt)}. La barra mostra esclusivamente l’avanzamento del nuovo articolo selezionato da questa ricerca.` : "";
    const carryover = pendingCarryoverRecord();
    const carryoverTitle = carryover?.article?.title || articleRelatedPlanItem(carryover, "related")?.theme || "Articolo del ciclo precedente";
    const carryoverState = carryover ? articleStepState(carryover, "social_related") : null;
    box.innerHTML = `<strong>Ciclo articolo attuale</strong>${cycleNote ? `<small class="ol-cycle-overview-note">${esc(cycleNote)}</small>` : ""}${schedulerHeartbeatMarkup(cycle, steps)}<div class="ol-cycle-steps">${steps.map((step) => `<span class="ol-cycle-step ol-cycle-step-${esc(step.tone)}"><b>${esc(step.title)}</b><small>${esc(step.label)}${step.at ? ` · ${esc(dateIt(step.at))}` : ""}</small></span>`).join("")}</div>${carryover ? `<div class="ol-cycle-carryover"><strong>Da chiudere dal ciclo precedente</strong><small>${esc(carryoverTitle)} · Post OffertaLogica ${esc(carryoverState?.label || "in attesa")}</small></div>` : ""}`;
  }

  function renderSocialPlan(section) {
    renderArticleHistory(section);
  }

  async function loadSocialPlan(section) {
    const message = section?.querySelector("[data-social-plan-message]");
    try {
      const payload = await endpoint("editorial-social-plan");
      socialPlanItems = Array.isArray(payload?.items) ? payload.items : [];
      socialChannels = Array.isArray(payload?.channels) ? payload.channels : [];
      renderSocialPlan(section);
      if (opportunityRows.length) renderOpportunities(section, opportunityRows);
    } catch (error) {
      if (message) message.textContent = `Piano post non disponibile: ${error.message}`;
    }
  }

  function automationRunTypeLabel(type) {
    return ({ research: "Ricerca", article_prepare: "Bozza articolo", article_publish: "Pubblicazione articolo", social_followup: "Follow-up", social_related: "Post OffertaLogica" })[type] || type || "Ciclo";
  }

  function automationRunStatusLabel(status) {
    return ({ success: "Completato", failed: "Errore", running: "In corso" })[status] || status || "—";
  }

  function renderAutomationRuns(section) {
    const list = section?.querySelector("[data-automation-run-list]");
    const toolbar = section?.querySelector("[data-automation-run-toolbar]");
    const toggle = section?.querySelector("[data-automation-run-toggle]");
    if (!list) return;
    if (!automationRuns.length) {
      list.innerHTML = '<p class="ol-muted">Nessun ciclo registrato.</p>';
      if (toolbar) toolbar.hidden = true;
      renderCycleOverview(section);
      return;
    }
    const displayRuns = compactAutomationRuns(automationRuns);
    const visibleRuns = automationRunsExpanded ? displayRuns : displayRuns.slice(0, 5);
    list.innerHTML = visibleRuns.map((run) => {
      const details = run?.details || {};
      const diagnostic = [];
      if (details.stage) diagnostic.push(`fase ${details.stage}`);
      if (details.reason) diagnostic.push(`motivo ${details.reason}`);
      if (details.selection_source) diagnostic.push(`scelta ${details.selection_source}`);
      if (details.selection_score !== null && details.selection_score !== undefined) diagnostic.push(`punteggio ${Number(details.selection_score)}/100`);
      if (details.selection_fallback_below_threshold) diagnostic.push("fallback sotto soglia");
      if (run.opportunity_id) diagnostic.push(`opportunità ${run.opportunity_id}`);
      if (run.article_id) diagnostic.push(`articolo ${run.article_id}`);
      const status = String(run.status || "unknown");
      return `<details class="ol-cycle-row">
        <summary class="ol-cycle-row-summary">
          <span><strong>${esc(automationRunTypeLabel(run.run_type))}</strong><small>${esc(dateIt(run.started_at || run.created_at))}</small></span>
          <span class="ol-cycle-status-badge ol-cycle-status-${esc(status)}">${esc(automationRunStatusLabel(status))}</span>
        </summary>
        <div class="ol-cycle-row-body">
          ${run.finished_at ? `<small>Fine ${esc(dateIt(run.finished_at))}</small>` : ""}
          ${diagnostic.length ? `<small>${esc(diagnostic.join(" · "))}</small>` : ""}
          ${details.selection_reason ? `<small>${esc(details.selection_reason)}</small>` : ""}
          ${run.last_error ? `<small class="ol-cycle-error">Errore: ${esc(run.last_error)}</small>` : `<small>Pubblicazione automatica: ${details.publication_performed ? "sì" : "no"}</small>`}
        </div>
      </details>`;
    }).join("");
    if (toolbar) toolbar.hidden = displayRuns.length <= 5;
    if (toggle) toggle.textContent = automationRunsExpanded ? "Mostra solo gli ultimi 5" : `Mostra storico (${displayRuns.length})`;
    renderCycleOverview(section);
  }

  async function loadAutomationRuns(section) {
    try {
      const payload = await endpoint("editorial-automation-runs");
      automationRuns = Array.isArray(payload?.runs) ? payload.runs : [];
      renderAutomationRuns(section);
    } catch {
      automationRuns = [];
      renderAutomationRuns(section);
    }
  }

  function plannerMatchesOpportunity(row) {
    if (!plannerDecision || !row) return false;
    if (plannerDecision.id && String(plannerDecision.id) === String(row.id || "")) return true;
    if (!["pending", "selected"].includes(String(row.status || ""))) return false;
    const decisionKey = String(plannerDecision.topic_key || "");
    const rowKey = String(row?.evidence?.topic_key || "");
    return Boolean(decisionKey && rowKey && decisionKey === rowKey);
  }

  function opportunityBriefText(row) {
    const brief = row?.editorial_brief && typeof row.editorial_brief === "object" ? row.editorial_brief : null;
    const manual = manualIdeaMeta(row);
    if (brief?.article_angle) return String(brief.article_angle);
    if (manual?.notes) return `Seguire il taglio indicato dalla Redazione: ${manual.notes}`;
    return `Sviluppare un articolo informativo su «${row?.topic || "questo tema"}», chiarendo contesto, aspetti pratici, verifiche utili e alternative pertinenti con fonti aggiornate.`;
  }

  function opportunityQueryExamples(row) {
    const fromRow = Array.isArray(row?.query_examples) ? row.query_examples : [];
    const fromBrief = Array.isArray(row?.editorial_brief?.query_examples) ? row.editorial_brief.query_examples : [];
    const fromEvidence = Array.isArray(row?.evidence?.query_examples) ? row.evidence.query_examples : [];
    return [...new Set([...fromRow, ...fromBrief, ...fromEvidence].map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 5);
  }

  function opportunityMetricsMarkup(row) {
    if (manualIdeaMeta(row)) return "";
    const metric = row?.evidence?.metrics?.["28"] || null;
    const parts = [`Punteggio ${Number(row?.score || 0)}/100`];
    if (metric) {
      parts.push(`${numberIt(metric.impressions)} impressioni / 28g`);
      if (metric.avg_position !== null && metric.avg_position !== undefined) parts.push(`pos. media ${Number(metric.avg_position).toFixed(1)}`);
    }
    const queryCount = Number(row?.evidence?.query_count || opportunityQueryExamples(row).length || 0);
    if (queryCount) parts.push(`${numberIt(queryCount)} query collegate`);
    return `<small class="ol-opportunity-signal">${esc(parts.join(" · "))}</small>`;
  }

  function opportunityPrimaryAction(row) {
    const id = esc(row.id || "");
    const status = String(row.status || "");
    if (status === "completed" || row.target_article_id) {
      return '<span class="ol-opportunity-lock">Articolo già avviato · scelta bloccata</span>';
    }
    if (status === "selected") {
      return `<button class="ol-button ol-button-primary ol-button-small" type="button" disabled>Scelta attiva</button>`;
    }
    return `<button class="ol-button ol-button-primary ol-button-small" type="button" data-opportunity-id="${id}" data-opportunity-status="selected">Scegli questa opportunità</button>`;
  }

  function opportunityManagementActions(row) {
    const id = esc(row.id || "");
    const status = String(row.status || "");
    if (status === "completed" || row.target_article_id) return "";
    const buttons = [];
    if (status !== "deferred") buttons.push(`<button class="ol-button ol-button-secondary ol-button-small" type="button" data-opportunity-id="${id}" data-opportunity-status="deferred">Rimanda</button>`);
    if (status !== "rejected") buttons.push(`<button class="ol-button ol-button-secondary ol-button-small" type="button" data-opportunity-id="${id}" data-opportunity-status="rejected">Rifiuta</button>`);
    if (status !== "pending") buttons.push(`<button class="ol-button ol-button-secondary ol-button-small" type="button" data-opportunity-id="${id}" data-opportunity-status="pending">Rimetti in attesa</button>`);
    return buttons.join("");
  }

  function opportunityBadgesMarkup(row) {
    const badges = [];
    const manual = manualIdeaMeta(row);
    if (row.status === "selected" && !row.target_article_id) {
      badges.push('<span class="ol-opportunity-badge is-selected">Scelta attiva</span>');
    } else if (plannerMatchesOpportunity(row)) {
      badges.push('<span class="ol-opportunity-badge is-auto">Scelta automatica</span>');
    }
    if (row.target_article_id) badges.push('<span class="ol-opportunity-badge is-locked">Articolo avviato</span>');
    badges.push(`<span class="ol-opportunity-badge">${esc(opportunityStatusLabel(row.status))}</span>`);
    badges.push(`<span class="ol-opportunity-badge">${manual ? `Idea manuale · ${esc(manualIdeaPriorityLabel(manual.priority))}` : `Search Console · ${Number(row.score || 0)}/100`}</span>`);
    return badges.join("");
  }

  function opportunityDetailsMarkup(row) {
    const management = opportunityManagementActions(row);
    const queries = opportunityQueryExamples(row);
    const source = manualIdeaMeta(row);
    const workflow = row.status === "completed" ? updateCompletionMarkup(row) : selectedOpportunityWorkflow(row);
    return `<div class="ol-opportunity-details-inner">
      <small><strong>Perché è in lista</strong></small>
      <small>${esc(row.rationale || "Segnale editoriale da valutare.")}</small>
      ${source ? opportunitySourceDetails(row) : '<small>Origine: Search Console.</small>'}
      ${queries.length ? `<small><strong>Ricerche collegate</strong></small><small>${esc(queries.join(" · "))}</small>` : ""}
      ${source ? "" : contextPagesMarkup(row.context_pages)}
      <small>Tipo corrente: ${esc(opportunityTypeLabel(row.opportunity_type))} · salvata ${esc(dateIt(row.created_at))}${row.decided_at ? ` · decisione ${esc(dateIt(row.decided_at))}` : ""}</small>
      ${management ? `<div class="ol-toolbar-group" style="margin-top:8px">${management}</div>` : ""}
      ${workflow || (row.status !== "selected" && !row.target_article_id ? '<small>Se la scegli, l’Autopilota la userà per il prossimo articolo e continuerà automaticamente secondo calendario e modalità configurati.</small>' : "")}
    </div>`;
  }

  function selectedOpportunityWorkflow(row) {
    const id = esc(row.id || "");
    const rawType = String(row.opportunity_type || "monitor");
    const type = rawType === "update_article" ? "new_article" : rawType;
    const targetArticleId = String(row.target_article_id || "");
    if (targetArticleId && (row.status !== "selected" || type !== "new_article")) {
      return `<div class="ol-toolbar-group" style="margin-top:8px">
        <a class="ol-button ol-button-secondary ol-button-small" href="/redazione.html?scope=mine&amp;status=all&amp;id=${encodeURIComponent(targetArticleId)}">Apri articolo collegato</a>
      </div>`;
    }
    if (row.status !== "selected") return "";

    const option = (value, label) => `<option value="${value}" ${type === value ? "selected" : ""}>${label}</option>`;
    let followup = '<small>Scegli la destinazione editoriale e salvala prima di procedere.</small>';
    if (type === "new_article") {
      followup = `${targetArticleId ? `<div class="ol-toolbar-group" style="margin-top:8px"><a class="ol-button ol-button-secondary ol-button-small" href="/redazione.html?scope=mine&amp;status=all&amp;id=${encodeURIComponent(targetArticleId)}">Apri articolo collegato</a></div>` : ""}${articleGenerationMarkup(row)}`;
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
      const statusRank = { selected: 0, pending: 1, deferred: 2, rejected: 3, completed: 4 };
      const visibleRows = [...opportunityRows].sort((left, right) => {
        const leftRank = statusRank[left?.status] ?? 9;
        const rightRank = statusRank[right?.status] ?? 9;
        if (leftRank !== rightRank) return leftRank - rightRank;
        if (leftRank <= 1 && Number(left?.score || 0) !== Number(right?.score || 0)) {
          return Number(right?.score || 0) - Number(left?.score || 0);
        }
        return String(right?.updated_at || right?.created_at || "").localeCompare(String(left?.updated_at || left?.created_at || ""));
      });

      list.innerHTML = visibleRows.map((row, index) => {
        const id = String(row.id || "");
        const expanded = expandedOpportunityIds.has(id);
        const queries = opportunityQueryExamples(row).slice(0, 3);
        const searchIntent = String(row?.editorial_brief?.search_intent || "").trim();
        return `<article class="ol-opportunity-card ${row.status === "selected" && !row.target_article_id ? "is-selected" : ""}" data-opportunity-card="${esc(id)}">
          <div class="ol-opportunity-head">
            <span class="ol-opportunity-number">#${index + 1}</span>
            <div class="ol-opportunity-title">
              <strong>${esc(row.topic || "Senza titolo")}</strong>
              <div class="ol-opportunity-badges">${opportunityBadgesMarkup(row)}</div>
            </div>
          </div>
          <div class="ol-opportunity-angle">
            <small><strong>Di cosa parlerà l’articolo</strong></small>
            <p>${esc(opportunityBriefText(row))}</p>
          </div>
          ${searchIntent ? `<small class="ol-opportunity-intent">${esc(searchIntent)}</small>` : ""}
          ${opportunityMetricsMarkup(row)}
          ${queries.length ? `<small class="ol-opportunity-queries"><strong>Query:</strong> ${esc(queries.join(" · "))}</small>` : ""}
          <div class="ol-opportunity-actions">
            ${opportunityPrimaryAction(row)}
            <button class="ol-button ol-button-secondary ol-button-small" type="button" data-opportunity-toggle="${esc(id)}" aria-expanded="${expanded ? "true" : "false"}">${expanded ? "Chiudi dettagli" : "Apri dettagli"}</button>
          </div>
          <div class="ol-opportunity-details" data-opportunity-details="${esc(id)}" ${expanded ? "" : "hidden"}>
            ${opportunityDetailsMarkup(row)}
          </div>
        </article>`;
      }).join("");
      message.textContent = `${numberIt(opportunityRows.length)} opportunità visibili. Se non scegli nulla, l’Autopilota mantiene la propria priorità; puoi scegliere un’altra opportunità finché l’articolo non è stato avviato.`;
    }

    if (lastAnalysisPayload) renderAnalysis(section, lastAnalysisPayload);
    if (socialPlanItems.length) renderSocialPlan(section);
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
    const manualSaveButton = event.target.closest("[data-manual-idea-save]");
    const researchHintSaveButton = event.target.closest("[data-research-hint-save]");
    const researchHintArchiveButton = event.target.closest("[data-research-hint-archive]");
    const manualCancelButton = event.target.closest("[data-manual-idea-cancel]");
    const manualEditButton = event.target.closest("[data-manual-idea-edit]");
    const plannerButton = event.target.closest("[data-planner-preview]");
    const generateArticleButton = event.target.closest("[data-article-generate]");
    const generateImageButton = event.target.closest("[data-article-image-generate]");
    const uploadImageButton = event.target.closest("[data-article-image-upload]");
    const approveImageButton = event.target.closest("[data-article-image-approve]");
    const discardImageButton = event.target.closest("[data-article-image-discard]");
    const socialPlanSaveButton = event.target.closest("[data-social-plan-save]");
    const socialImageReviewButton = event.target.closest("[data-social-image-review]");
    const socialPlanRegenerateButton = event.target.closest("[data-social-plan-regenerate]");
    const saveButton = event.target.closest("[data-save-opportunity]");
    const toggleButton = event.target.closest("[data-opportunity-toggle]");
    const statusButton = event.target.closest("[data-opportunity-id][data-opportunity-status]");
    const classifyButton = event.target.closest("[data-opportunity-classify]");
    const prepareButton = event.target.closest("[data-opportunity-prepare]");
    const updatePrepareButton = event.target.closest("[data-update-prepare]");
    const updateReviewButton = event.target.closest("[data-update-review][data-update-opportunity]");
    const updateTextPrepareButton = event.target.closest("[data-update-text-prepare]");
    const updateTextReviewButton = event.target.closest("[data-update-text-review][data-update-text-opportunity]");
    const updatePreviewPrepareButton = event.target.closest("[data-update-preview-prepare]");
    const updatePreviewReviewButton = event.target.closest("[data-update-preview-review][data-update-preview-opportunity]");
    const updateCompleteButton = event.target.closest("[data-update-complete]");
    const updateImpactButton = event.target.closest("[data-update-impact-check]");
    const message = section.querySelector("[data-opportunity-message]");

    if (toggleButton) {
      const id = toggleButton.dataset.opportunityToggle || "";
      if (!id) return;
      if (expandedOpportunityIds.has(id)) expandedOpportunityIds.delete(id);
      else expandedOpportunityIds.add(id);
      renderOpportunities(section, opportunityRows);
      return;
    }

    if (researchHintSaveButton) {
      const hintMessage = section.querySelector("[data-research-hint-message]");
      const topicInput = section.querySelector("[data-research-hint-topic]");
      const depthInput = section.querySelector("[data-research-hint-depth]");
      const topic = String(topicInput?.value || "").trim();
      const depth = String(depthInput?.value || "normal");
      if (topic.length < 3) {
        if (hintMessage) hintMessage.textContent = "Inserisci un tema di almeno 3 caratteri.";
        return;
      }
      researchHintSaveButton.disabled = true;
      if (hintMessage) hintMessage.textContent = "Inserimento del tema nelle ricerche…";
      try {
        const payload = await endpoint("create-editorial-research-hint", { method: "POST", body: { topic, depth } });
        if (topicInput) topicInput.value = "";
        if (depthInput) depthInput.value = "normal";
        if (hintMessage) hintMessage.textContent = payload?.result?.created === false
          ? "Questo tema è già presente nelle ricerche."
          : "Tema inserito. Verrà validato nella prossima scansione Radar; puoi avviare una scansione manuale se vuoi valutarlo subito.";
        await loadResearchRadar(section);
      } catch (error) {
        if (hintMessage) hintMessage.textContent = `Tema non inserito: ${error.message}`;
      } finally {
        researchHintSaveButton.disabled = false;
      }
      return;
    }

    if (researchHintArchiveButton) {
      const id = researchHintArchiveButton.dataset.researchHintArchive || "";
      const hintMessage = section.querySelector("[data-research-hint-message]");
      if (!id || researchHintArchiveButton.disabled) return;
      researchHintArchiveButton.disabled = true;
      try {
        await endpoint("archive-editorial-research-hint", { method: "POST", body: { id } });
        if (hintMessage) hintMessage.textContent = "Tema rimosso dalle prossime ricerche Radar.";
        await loadResearchRadar(section);
      } catch (error) {
        if (hintMessage) hintMessage.textContent = `Tema non rimosso: ${error.message}`;
        researchHintArchiveButton.disabled = false;
      }
      return;
    }

    if (manualCancelButton) {
      resetManualIdeaEditor(section);
      return;
    }

    if (manualEditButton) {
      const id = manualEditButton.dataset.manualIdeaEdit || "";
      const row = opportunityRows.find((item) => item.id === id);
      if (row) editManualIdea(section, row);
      return;
    }

    if (manualSaveButton) {
      const ideaMessage = section.querySelector("[data-manual-idea-message]");
      const body = manualIdeaPayload(section);
      if (!body || manualSaveButton.disabled) return;
      if (String(body.topic || "").trim().length < 3) {
        if (ideaMessage) ideaMessage.textContent = "Inserisci un argomento di almeno 3 caratteri.";
        return;
      }
      manualSaveButton.disabled = true;
      if (ideaMessage) ideaMessage.textContent = body.id ? "Aggiornamento idea…" : "Salvataggio idea…";
      try {
        const action = body.id ? "update-manual-editorial-idea" : "create-manual-editorial-idea";
        const payload = await endpoint(action, { method: "POST", body });
        const finalMessage = body.id
          ? "Idea aggiornata senza cambiare il suo stato nella coda."
          : payload?.result?.created === false
            ? "Esiste già un’idea manuale attiva con lo stesso argomento."
            : "Idea salvata nella coda editoriale.";
        resetManualIdeaEditor(section, finalMessage);
        await loadOpportunities(section, true);
        await loadPlannerPreview(section, true);
      } catch (error) {
        if (ideaMessage) ideaMessage.textContent = `Idea non salvata: ${error.message}`;
      } finally {
        manualSaveButton.disabled = false;
      }
      return;
    }

    if (plannerButton) {
      const plannerMessage = section.querySelector("[data-planner-message]");
      if (plannerButton.disabled) return;
      plannerButton.disabled = true;
      if (plannerMessage) plannerMessage.textContent = "Calcolo priorità in corso…";
      try {
        await loadPlannerPreview(section, false);
      } finally {
        plannerButton.disabled = false;
      }
      return;
    }


    if (generateImageButton) {
      const id = generateImageButton.dataset.articleImageGenerate || "";
      const imageMessage = section.querySelector(`[data-article-image-message="${id}"]`);
      const guidance = section.querySelector(`[data-article-image-guidance="${id}"]`)?.value || "";
      const row = opportunityRows.find((item) => String(item.id || "") === id);
      const candidate = row?.evidence?.article_image?.candidate;
      if (!id || generateImageButton.disabled) return;
      if (candidate && !window.confirm("Sostituire questa anteprima con una nuova immagine generata? L’immagine già approvata, se presente, resterà invariata finché non approvi la nuova.")) return;
      generateImageButton.disabled = true;
      if (imageMessage) imageMessage.textContent = "Generazione immagine fotografica HD in corso… può richiedere alcuni minuti.";
      try {
        await endpoint("generate-editorial-article-image", { method: "POST", body: { id, guidance } });
        if (imageMessage) imageMessage.textContent = "Nuova anteprima pronta. Verificala, modifica se serve il testo alternativo e approvala solo se ti convince.";
        await Promise.all([loadOpportunities(section, true), loadSocialPlan(section)]);
      } catch (error) {
        generateImageButton.disabled = false;
        if (imageMessage) imageMessage.textContent = `Immagine non generata: ${error.message}`;
      }
      return;
    }

    if (uploadImageButton) {
      const id = uploadImageButton.dataset.articleImageUpload || "";
      const imageMessage = section.querySelector(`[data-article-image-message="${id}"]`);
      const fileInput = section.querySelector(`[data-article-image-file="${id}"]`);
      const altInput = section.querySelector(`[data-article-image-alt="${id}"]`);
      if (!id || !fileInput?.files?.[0] || uploadImageButton.disabled) {
        if (imageMessage && !fileInput?.files?.[0]) imageMessage.textContent = "Seleziona prima un file immagine.";
        return;
      }
      uploadImageButton.disabled = true;
      if (imageMessage) imageMessage.textContent = "Caricamento nuova immagine…";
      try {
        const imageUrl = await uploadArticleImageFile(fileInput.files[0], id);
        await endpoint("set-editorial-article-image-candidate", {
          method: "POST",
          body: { id, image_url: imageUrl, alt_text: altInput?.value || "" },
        });
        if (imageMessage) imageMessage.textContent = "Immagine caricata come nuova anteprima. Non sostituisce quella approvata finché non premi Approva.";
        await Promise.all([loadOpportunities(section, true), loadSocialPlan(section)]);
      } catch (error) {
        uploadImageButton.disabled = false;
        if (imageMessage) imageMessage.textContent = `Immagine non caricata: ${error.message}`;
      }
      return;
    }

    if (approveImageButton) {
      const id = approveImageButton.dataset.articleImageApprove || "";
      const imageMessage = section.querySelector(`[data-article-image-message="${id}"]`);
      const altText = section.querySelector(`[data-article-image-alt="${id}"]`)?.value || "";
      const row = opportunityRows.find((item) => String(item.id || "") === id);
      const hasCurrent = Boolean(row?.evidence?.article_image?.current?.url);
      if (!id || approveImageButton.disabled) return;
      if (!window.confirm(hasCurrent
        ? "Approvare questa nuova immagine e sostituire quella attualmente collegata all’articolo?"
        : "Approvare questa immagine e collegarla all’articolo?")) return;
      approveImageButton.disabled = true;
      if (imageMessage) imageMessage.textContent = "Approvazione e collegamento all’articolo…";
      try {
        await endpoint("approve-editorial-article-image", { method: "POST", body: { id, alt_text: altText } });
        if (imageMessage) imageMessage.textContent = "Immagine approvata e collegata all’articolo. Rimane sostituibile in qualsiasi momento preparando una nuova anteprima.";
        await Promise.all([loadOpportunities(section, true), loadSocialPlan(section)]);
      } catch (error) {
        approveImageButton.disabled = false;
        if (imageMessage) imageMessage.textContent = `Immagine non approvata: ${error.message}`;
      }
      return;
    }

    if (discardImageButton) {
      const id = discardImageButton.dataset.articleImageDiscard || "";
      const imageMessage = section.querySelector(`[data-article-image-message="${id}"]`);
      if (!id || discardImageButton.disabled) return;
      if (!window.confirm("Scartare questa anteprima? L’immagine già approvata, se presente, non verrà modificata.")) return;
      discardImageButton.disabled = true;
      try {
        await endpoint("discard-editorial-article-image-candidate", { method: "POST", body: { id } });
        if (imageMessage) imageMessage.textContent = "Anteprima scartata. Puoi generarne o caricarne un’altra.";
        await loadOpportunities(section, true);
      } catch (error) {
        discardImageButton.disabled = false;
        if (imageMessage) imageMessage.textContent = `Anteprima non scartata: ${error.message}`;
      }
      return;
    }

    if (generateArticleButton) {
      const id = generateArticleButton.dataset.articleGenerate || "";
      if (!id || generateArticleButton.disabled) return;
      const row = opportunityRows.find((item) => String(item.id || "") === id);
      const existingJob = row?.evidence?.article_generation_job;
      const jobRunning = Boolean(existingJob?.response_id && ["queued", "in_progress"].includes(String(existingJob.status || "")));
      if (!jobRunning && row?.evidence?.article_generation && !window.confirm("Rigenerare la bozza completa? È consentito solo se la bozza non è stata modificata manualmente dopo l’ultima generazione.")) return;
      const platforms = [...section.querySelectorAll(`input[data-package-platform="${id}"]:checked`)].map((input) => input.value);
      generateArticleButton.disabled = true;
      if (message) message.textContent = jobRunning ? "Riprendo il controllo della generazione in background…" : "Avvio ricerca fonti e generazione editoriale in background…";
      try {
        let result;
        if (jobRunning) {
          const check = await endpoint("check-editorial-article-package", { method: "POST", body: { id } });
          result = check?.result;
        } else {
          const payload = await endpoint("generate-editorial-article-package", { method: "POST", body: { id, platforms } });
          result = payload?.result;
        }
        while (result?.pending) {
          if (message) message.textContent = result.status === "queued"
            ? "Generazione avviata e in coda. La pagina controlla automaticamente lo stato…"
            : "Ricerca web e generazione editoriale in corso in background…";
          await new Promise((resolve) => window.setTimeout(resolve, 3000));
          const check = await endpoint("check-editorial-article-package", { method: "POST", body: { id } });
          result = check?.result;
        }
        if (message) message.textContent = `Bozza completa preparata: ${Number(result?.qa?.sources_count || 0)} fonti usate dalla ricerca, ${Number(result?.qa?.static_posts_count || 0)} post statici. La pubblicazione segue modalità e calendario Autopilota.`;
        await Promise.all([loadOpportunities(section, true), loadSocialPlan(section), loadAutomationRuns(section)]);
      } catch (error) {
        generateArticleButton.disabled = false;
        const errorText = `Generazione non completata: ${error.message}`;
        if (message) message.textContent = errorText;
        await loadAutomationRuns(section).catch(() => {});
      }
      return;
    }

    if (socialImageReviewButton) {
      const id = socialImageReviewButton.dataset.socialImageReview || "";
      const decision = socialImageReviewButton.dataset.socialImageDecision || "";
      if (!id || !["approve", "use_article_image"].includes(decision) || socialImageReviewButton.disabled) return;
      const confirmText = decision === "approve"
        ? "Approvare manualmente questa immagine social? La card OL Informa verrà composta subito usando questa immagine."
        : "Usare l’immagine già approvata dell’articolo per questo post? La card OL Informa verrà composta subito su quella base.";
      if (!window.confirm(confirmText)) return;
      socialImageReviewButton.disabled = true;
      const socialMessage = section.querySelector("[data-social-plan-message]");
      if (socialMessage) socialMessage.textContent = decision === "approve"
        ? "Approvazione manuale dell’immagine social e composizione card…"
        : "Imposto l’immagine dell’articolo come fallback e compongo la card…";
      try {
        await endpoint("review-editorial-social-image", { method: "POST", body: { id, decision } });
        await Promise.all([loadSocialPlan(section), loadAutomationRuns(section)]);
        if (socialMessage) socialMessage.textContent = "Immagine social validata e card OL Informa pronta.";
      } catch (error) {
        if (socialMessage) socialMessage.textContent = `Immagine social non aggiornata: ${error.message}`;
        socialImageReviewButton.disabled = false;
      }
      return;
    }

    if (socialPlanRegenerateButton) {
      const id = socialPlanRegenerateButton.dataset.socialPlanRegenerate || "";
      if (!id || socialPlanRegenerateButton.disabled) return;
      const warning = "Procedi solo se hai già eliminato manualmente le vecchie pubblicazioni di questo post da Facebook e Instagram. Il testo social esistente verrà mantenuto: la rigenerazione verrà accodata e l’Autopilota completerà foto, QA, card e ripubblicazione senza una richiesta lunga nel browser. Continuare?";
      if (!window.confirm(warning)) return;
      socialPlanRegenerateButton.disabled = true;
      const socialMessage = section.querySelector("[data-social-plan-message]");
      if (socialMessage) socialMessage.textContent = "Rigenerazione accodata: l’Autopilota completerà automaticamente foto, QA, card e ripubblicazione nei prossimi heartbeat…";
      try {
        await endpoint("regenerate-editorial-social-plan-item", { method: "POST", body: { id } });
        await Promise.all([loadSocialPlan(section), loadAutomationRuns(section)]);
        if (socialMessage) socialMessage.textContent = "Rigenerazione presa in carico. Non serve lasciare aperta la pagina: lo stato verrà aggiornato dagli heartbeat dell’Autopilota.";
      } catch (error) {
        if (socialMessage) socialMessage.textContent = `Rigenerazione non avviata: ${error.message}`;
        socialPlanRegenerateButton.disabled = false;
      }
      return;
    }

    if (socialPlanSaveButton) {
      const id = socialPlanSaveButton.dataset.socialPlanSave || "";
      const textArea = section.querySelector(`[data-social-plan-text="${id}"]`);
      const statusSelect = section.querySelector(`[data-social-plan-status="${id}"]`);
      const platforms = [...section.querySelectorAll(`input[data-social-plan-platform="${id}"]:checked`)].map((input) => input.value);
      if (!id || !textArea || socialPlanSaveButton.disabled) return;
      socialPlanSaveButton.disabled = true;
      const planMessage = section.querySelector("[data-social-plan-message]");
      if (planMessage) planMessage.textContent = "Salvataggio post statico…";
      try {
        await endpoint("update-editorial-social-plan-item", {
          method: "POST",
          body: { id, canonical_text: textArea.value, status: statusSelect?.value || "draft", platforms },
        });
        if (planMessage) planMessage.textContent = "Post salvato. Nessuna pubblicazione è stata eseguita.";
        await loadSocialPlan(section);
      } catch (error) {
        socialPlanSaveButton.disabled = false;
        if (planMessage) planMessage.textContent = `Post non salvato: ${error.message}`;
      }
      return;
    }

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
        await loadPlannerPreview(section, true);
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

      if (status === "selected") {
        const chosen = opportunityRows.find((item) => String(item.id || "") === id);
        const previous = opportunityRows.find((item) =>
          String(item.id || "") !== id
          && String(item.status || "") === "selected"
          && !item.target_article_id
        );
        if (previous && !window.confirm(`Sostituire la scelta attiva “${previous.topic || "opportunità precedente"}” con “${chosen?.topic || "questa opportunità"}”?`)) {
          return;
        }
      }

      statusButton.disabled = true;
      if (message) {
        message.textContent = status === "selected"
          ? "Salvataggio della scelta manuale…"
          : "Aggiornamento decisione…";
      }
      try {
        await endpoint("update-editorial-opportunity", {
          method: "POST",
          body: { id, status },
        });
        if (message) {
          message.textContent = status === "selected"
            ? "Scelta manuale salvata. Questa opportunità precede la scelta automatica finché l’articolo non viene avviato."
            : `Decisione aggiornata: ${opportunityStatusLabel(status)}.`;
        }
        await loadOpportunities(section, true);
        await loadPlannerPreview(section, true);
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
  
      return;
    }

    if (updatePrepareButton) {
      const id = updatePrepareButton.dataset.updatePrepare || "";
      const select = section.querySelector(`[data-update-target="${id}"]`);
      const targetUrl = select?.value || "";
      const existing = opportunityRows.find((row) => String(row.id || "") === id)?.evidence?.update_proposal;
      if (!id || !targetUrl || updatePrepareButton.disabled) return;
      if (existing && !window.confirm("Rigenerare la proposta? L’eventuale approvazione precedente verrà sostituita da una nuova proposta da revisionare.")) return;
      updatePrepareButton.disabled = true;
      if (message) message.textContent = "Lettura pagina e preparazione proposta…";
      try {
        await endpoint("prepare-editorial-update", {
          method: "POST",
          body: { id, target_url: targetUrl },
        });
        if (message) message.textContent = "Proposta preparata e salvata. La pagina pubblicata non è stata modificata.";
        await loadOpportunities(section, true);
      } catch (error) {
        updatePrepareButton.disabled = false;
        if (message) message.textContent = `Proposta non preparata: ${error.message}`;
      }
      return;
    }

    if (updateReviewButton) {
      const id = updateReviewButton.dataset.updateOpportunity || "";
      const decision = updateReviewButton.dataset.updateReview || "";
      if (!id || !decision || updateReviewButton.disabled) return;
      updateReviewButton.disabled = true;
      if (message) message.textContent = decision === "approved" ? "Approvazione proposta…" : "Rifiuto proposta…";
      try {
        await endpoint("review-editorial-update", {
          method: "POST",
          body: { id, decision },
        });
        if (message) message.textContent = decision === "approved"
          ? "Proposta approvata. Nessuna modifica è stata applicata alla pagina."
          : "Proposta rifiutata. Nessuna modifica è stata applicata alla pagina.";
        await loadOpportunities(section, true);
      } catch (error) {
        updateReviewButton.disabled = false;
        if (message) message.textContent = `Decisione non salvata: ${error.message}`;
      }
          return;
    }

    if (updateTextPrepareButton) {
      const id = updateTextPrepareButton.dataset.updateTextPrepare || "";
      const existingDraft = opportunityRows.find((row) => String(row.id || "") === id)?.evidence?.update_text_draft;
      if (!id || updateTextPrepareButton.disabled) return;
      if (existingDraft && !window.confirm("Rigenerare la bozza testuale? L’eventuale decisione precedente sul testo verrà sostituita.")) return;
      updateTextPrepareButton.disabled = true;
      if (message) message.textContent = "Preparazione diff testuale controllato…";
      try {
        await endpoint("prepare-editorial-update-text", {
          method: "POST",
          body: { id },
        });
        if (message) message.textContent = "Bozza testuale preparata. La pagina pubblicata non è stata modificata.";
        await loadOpportunities(section, true);
      } catch (error) {
        updateTextPrepareButton.disabled = false;
        if (message) message.textContent = `Bozza testuale non preparata: ${error.message}`;
      }
      return;
    }

    if (updateTextReviewButton) {
      const id = updateTextReviewButton.dataset.updateTextOpportunity || "";
      const decision = updateTextReviewButton.dataset.updateTextReview || "";
      if (!id || !decision || updateTextReviewButton.disabled) return;
      updateTextReviewButton.disabled = true;
      if (message) message.textContent = decision === "approved" ? "Approvazione testo…" : "Rifiuto testo…";
      try {
        await endpoint("review-editorial-update-text", {
          method: "POST",
          body: { id, decision },
        });
        if (message) message.textContent = decision === "approved"
          ? "Testo approvato. Non è stato applicato né pubblicato."
          : "Testo rifiutato. La pagina resta invariata.";
        await loadOpportunities(section, true);
      } catch (error) {
        updateTextReviewButton.disabled = false;
        if (message) message.textContent = `Decisione sul testo non salvata: ${error.message}`;
      }
      return;
    }

    if (updatePreviewPrepareButton) {
      const id = updatePreviewPrepareButton.dataset.updatePreviewPrepare || "";
      const existingPreview = opportunityRows.find((row) => String(row.id || "") === id)?.evidence?.update_apply_preview;
      if (!id || updatePreviewPrepareButton.disabled) return;
      if (existingPreview && !window.confirm("Rigenerare l’anteprima applicata? L’eventuale conferma precedente verrà sostituita.")) return;
      updatePreviewPrepareButton.disabled = true;
      if (message) message.textContent = "Preparazione anteprima applicata su copia in memoria…";
      try {
        await endpoint("prepare-editorial-update-preview", {
          method: "POST",
          body: { id },
        });
        if (message) message.textContent = "Anteprima applicata preparata. Il file HTML pubblicato non è stato modificato.";
        await loadOpportunities(section, true);
      } catch (error) {
        updatePreviewPrepareButton.disabled = false;
        if (message) message.textContent = `Anteprima non preparata: ${error.message}`;
      }
      return;
    }

    if (updatePreviewReviewButton) {
      const id = updatePreviewReviewButton.dataset.updatePreviewOpportunity || "";
      const decision = updatePreviewReviewButton.dataset.updatePreviewReview || "";
      if (!id || !decision || updatePreviewReviewButton.disabled) return;
      if (decision === "confirmed" && !window.confirm("Confermare questa anteprima? La conferma NON modifica ancora il file HTML e non pubblica la pagina.")) return;
      updatePreviewReviewButton.disabled = true;
      if (message) message.textContent = decision === "confirmed" ? "Conferma anteprima…" : "Annullamento anteprima…";
      try {
        await endpoint("review-editorial-update-preview", {
          method: "POST",
          body: { id, decision },
        });
        if (message) message.textContent = decision === "confirmed"
          ? "Anteprima confermata. Nessun file HTML è stato modificato o pubblicato."
          : "Anteprima annullata. La pagina resta invariata.";
        await loadOpportunities(section, true);
      } catch (error) {
        updatePreviewReviewButton.disabled = false;
        if (message) message.textContent = `Decisione anteprima non salvata: ${error.message}`;
      }
      return;
    }

    if (updateCompleteButton) {
      const id = updateCompleteButton.dataset.updateComplete || "";
      const input = section.querySelector(`[data-update-completion-commit="${id}"]`);
      const commitRef = String(input?.value || "").trim();
      if (!id || !commitRef || updateCompleteButton.disabled) return;
      if (!window.confirm("Verificare la pagina pubblicata e chiudere definitivamente questa opportunità se coincide con l’anteprima confermata?")) return;
      updateCompleteButton.disabled = true;
      if (message) message.textContent = "Verifica della pagina pubblicata e chiusura opportunità…";
      try {
        await endpoint("complete-editorial-update", {
          method: "POST",
          body: { id, commit_ref: commitRef },
        });
        if (message) message.textContent = "Aggiornamento verificato sulla pagina pubblica. Opportunità completata.";
        await loadOpportunities(section, true);
      } catch (error) {
        updateCompleteButton.disabled = false;
        if (message) message.textContent = `Chiusura non completata: ${error.message}`;
      }
      return;
    }

    if (updateImpactButton) {
      const id = updateImpactButton.dataset.updateImpactCheck || "";
      if (!id || updateImpactButton.disabled) return;
      updateImpactButton.disabled = true;
      if (message) message.textContent = "Controllo dati Search Console post-modifica…";
      try {
        await endpoint("check-editorial-update-impact", {
          method: "POST",
          body: { id },
        });
        if (message) message.textContent = "Monitoraggio aggiornato. Le differenze sono mostrate solo per finestre interamente successive alla modifica.";
        await loadOpportunities(section, true);
      } catch (error) {
        updateImpactButton.disabled = false;
        if (message) message.textContent = `Monitoraggio non aggiornato: ${error.message}`;
      }
      return;
    }
  }

  function analysisSignalMatches(signal) {
    const score = Number(signal?.score || 0);
    if (analysisScoreFilter === "40plus" && score < 40) return false;
    if (analysisScoreFilter === "30to39" && (score < 30 || score >= 40)) return false;
    if (analysisScoreFilter === "under30" && score >= 30) return false;
    if (!analysisSearchTerm) return true;

    const haystack = [
      signal?.topic,
      signal?.editorial_brief?.article_angle,
      ...(Array.isArray(signal?.query_examples) ? signal.query_examples : []),
      ...(Array.isArray(signal?.page_urls) ? signal.page_urls : []),
    ].filter(Boolean).join(" ").toLocaleLowerCase("it");
    return haystack.includes(analysisSearchTerm);
  }

  function updateAnalysisPagination(section, filteredCount, totalCount) {
    const pageCount = Math.max(1, Math.ceil(filteredCount / ANALYSIS_PAGE_SIZE));
    analysisPage = Math.min(Math.max(1, analysisPage), pageCount);

    const summary = section.querySelector("[data-signal-page-summary]");
    if (summary) {
      const filterNote = filteredCount === totalCount
        ? `${numberIt(totalCount)} segnali`
        : `${numberIt(filteredCount)} di ${numberIt(totalCount)} segnali`;
      summary.textContent = `${filterNote} · ${ANALYSIS_PAGE_SIZE} per pagina · pagina ${analysisPage} di ${pageCount}`;
    }

    section.querySelectorAll('[data-signal-page="prev"]').forEach((button) => {
      button.disabled = analysisPage <= 1 || filteredCount === 0;
    });
    section.querySelectorAll('[data-signal-page="next"]').forEach((button) => {
      button.disabled = analysisPage >= pageCount || filteredCount === 0;
    });

    const hasSignals = totalCount > 0;
    const controls = section.querySelector("[data-signal-controls]");
    const top = section.querySelector("[data-signal-pagination-top]");
    const bottom = section.querySelector("[data-signal-pagination-bottom]");
    if (controls) controls.hidden = !hasSignals;
    if (top) top.hidden = !hasSignals;
    if (bottom) bottom.hidden = !hasSignals;

    return pageCount;
  }

  function handleAnalysisNavigation(event) {
    const section = event.currentTarget;
    const pageButton = event.target.closest("[data-signal-page]");
    const jumpButton = event.target.closest("[data-jump-opportunities]");
    const historyToggle = event.target.closest("[data-automation-run-toggle]");

    if (historyToggle) {
      automationRunsExpanded = !automationRunsExpanded;
      renderAutomationRuns(section);
      return;
    }
    if (jumpButton) {
      const target = section.querySelector("[data-opportunity-stage]");
      if (target?.tagName === "DETAILS") target.open = true;
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (!pageButton || pageButton.disabled || !lastAnalysisPayload) return;

    const direction = pageButton.dataset.signalPage;
    if (direction === "prev") analysisPage -= 1;
    if (direction === "next") analysisPage += 1;
    renderAnalysis(section, lastAnalysisPayload);
    section.querySelector("[data-signal-pagination-top]")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderAnalysis(section, payload) {
    lastAnalysisPayload = payload || null;
    const list = section.querySelector("[data-search-console-analysis-results]");
    const message = section.querySelector("[data-search-console-analysis-message]");
    if (!list || !message) return;

    if (!payload?.ready) {
      const missing = (payload?.missing || []).join(", ");
      list.innerHTML = "";
      updateAnalysisPagination(section, 0, 0);
      message.textContent = `Storico incompleto. Mancano: ${missing || "snapshot richiesti"}.`;
      return;
    }

    const signals = Array.isArray(payload.signals) ? payload.signals : [];
    if (!signals.length) {
      list.innerHTML = '<p class="ol-muted">Nessun segnale utile trovato nello storico disponibile.</p>';
      updateAnalysisPagination(section, 0, 0);
      message.textContent = "Analisi completata senza segnali utili.";
      return;
    }

    const filteredSignals = signals.filter(analysisSignalMatches);
    const pageCount = updateAnalysisPagination(section, filteredSignals.length, signals.length);
    analysisPage = Math.min(Math.max(1, analysisPage), pageCount);

    if (!filteredSignals.length) {
      list.innerHTML = '<p class="ol-muted">Nessun segnale corrisponde ai filtri attuali.</p>';
    } else {
      const startIndex = (analysisPage - 1) * ANALYSIS_PAGE_SIZE;
      const visibleSignals = filteredSignals.slice(startIndex, startIndex + ANALYSIS_PAGE_SIZE);
      list.innerHTML = visibleSignals.map((signal, index) => {
        const momentum = Number.isFinite(Number(signal.momentum_ratio))
          ? `${((Number(signal.momentum_ratio) - 1) * 100).toFixed(0)}% ritmo 7g vs media 28g`
          : "ritmo recente non calcolabile";
        const alreadySaved = opportunityTopicKeys.has(String(signal.topic_key || ""));
        const brief = signal?.editorial_brief?.article_angle || "";
        const queries = Array.isArray(signal?.query_examples) ? signal.query_examples.slice(0, 5) : [];
        const fallbackRank = signals.indexOf(signal) + 1;
        const rank = Number(signal.rank || fallbackRank || (startIndex + index + 1));
        return `<div class="ol-autopilot-archive-item">
          <strong>#${rank} · ${esc(signal.topic)} · punteggio ${Number(signal.score || 0)}/100</strong>
          ${brief ? `<small><b>Possibile articolo:</b> ${esc(brief)}</small>` : ""}
          <details style="margin-top:6px">
            <summary>Mostra dettagli Search Console</summary>
            <small>${esc(metricSummary(signal, 7))} · ${esc(metricSummary(signal, 28))} · ${esc(metricSummary(signal, 90))}</small>
            <small>${Number(signal.query_count || 0)} query collegate · ${Number(signal.page_count || 0)} pagine · ${esc(momentum)}</small>
            ${queries.length ? `<small><b>Query principali:</b> ${esc(queries.join(" · "))}</small>` : ""}
            ${contextPagesMarkup(signal.page_urls)}
          </details>
          <div class="ol-toolbar-group" style="margin-top:8px">
            <button class="ol-button ol-button-secondary ol-button-small" type="button" data-save-opportunity="${esc(signal.topic_key || "")}" ${alreadySaved ? "disabled" : ""}>${alreadySaved ? "Già salvata" : "Scegli questo tema"}</button>
          </div>
        </div>`;
      }).join("");
    }

    const total = Number(payload.signals_total || signals.length);
    const available = signals.length;
    const backendNote = payload.signals_truncated
      ? ` Il backend ha restituito i primi ${numberIt(available)} di ${numberIt(total)} cluster trovati.`
      : ` ${numberIt(available)} segnali disponibili nella graduatoria.`;
    const filterNote = filteredSignals.length !== signals.length
      ? ` Il filtro corrente ne mostra ${numberIt(filteredSignals.length)}.`
      : "";
    message.textContent = payload.truncated
      ? `Analisi completata su un campione massimo di 20.000 righe per snapshot.${backendNote}${filterNote}`
      : `Graduatoria Search Console aggiornata.${backendNote}${filterNote}`;
  }

  async function loadAnalysis(section, quiet = false) {
    const message = section?.querySelector("[data-search-console-analysis-message]");
    if (!section?.isConnected) return;
    if (!quiet && message) message.textContent = "Caricamento graduatoria Search Console…";
    try {
      const payload = await endpoint("editorial-research-analysis");
      if (section.isConnected) renderAnalysis(section, payload);
    } catch (error) {
      if (message && !quiet) message.textContent = `Graduatoria non disponibile: ${error.message}`;
    }
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

  function enforceArticleOnlySettings() {
    const root = document.querySelector('[data-editorial-autopilot="1"]');
    if (!root) return;
    const input = root.querySelector('input[name="allow_article_updates"]');
    if (input) {
      input.checked = false;
      const row = input.closest("label");
      if (row) row.hidden = true;
    }
    const statusCopy = root.querySelector("[data-autopilot-status-copy]");
    if (statusCopy && /aggiornament/i.test(statusCopy.textContent || "")) {
      statusCopy.textContent = "Il ciclo editoriale genera nuovi articoli e contenuti social; le pagine esistenti del sito non vengono modificate.";
    }
    root.querySelectorAll("small").forEach((node) => {
      if (/aggiornamenti di pagine esistenti/i.test(node.textContent || "")) {
        node.textContent = "Il ciclo editoriale riguarda esclusivamente nuovi articoli e contenuti social.";
      }
    });
  }

  function boot() {
    const observer = new MutationObserver(() => { ensureCard(); enforceArticleOnlySettings(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("offertalogica:editorial-article-updated", () => {
      const section = document.querySelector("[data-search-console-card]");
      if (!section) return;
      Promise.all([
        loadSocialPlan(section),
        loadAutomationRuns(section),
        loadOpportunities(section, true),
      ]).catch(() => {});
    });
    ensureCard();
    enforceArticleOnlySettings();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
