(() => {
  "use strict";

  const VERSION = "0.12.34";
  const SESSION_KEY = "offertalogica.editorial.session.v1";
  const WINDOWS = [7, 28, 90];
  let statusLoaded = false;
  let lastAnalysisPayload = null;
  let opportunityRows = [];
  let opportunityTopicKeys = new Set();
  let socialPlanItems = [];
  let socialChannels = [];
  let automationRuns = [];

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
      <h3>Idee editoriali e ricerca</h3>
      <p>Le idee inserite dalla Redazione entrano nella stessa coda delle opportunità di ricerca, ma mantengono una provenienza distinta. Nessuna azione di questo blocco genera o pubblica contenuti.</p>

      <div class="ol-field" data-manual-idea-editor>
        <label>Idea editoriale manuale</label>
        <div class="ol-autopilot-fields">
          <div class="ol-field">
            <label for="autopilot-manual-idea-topic">Argomento</label>
            <input id="autopilot-manual-idea-topic" data-manual-idea-topic type="text" maxlength="240" placeholder="Es. nuova norma urgente sul mercato energia">
          </div>
          <div class="ol-field">
            <label for="autopilot-manual-idea-type">Destinazione</label>
            <select id="autopilot-manual-idea-type" data-manual-idea-type>
              <option value="new_article">Nuovo articolo</option>
              <option value="update_article">Aggiornamento articolo/pagina</option>
            </select>
          </div>
          <div class="ol-field">
            <label for="autopilot-manual-idea-priority">Priorità</label>
            <select id="autopilot-manual-idea-priority" data-manual-idea-priority>
              <option value="normal">Normale · dopo i segnali Search Console sopra soglia</option>
              <option value="high">Alta · precede Search Console</option>
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
          <div class="ol-field">
            <label for="autopilot-manual-idea-target">Pagina da aggiornare <span class="ol-muted">(solo aggiornamento)</span></label>
            <input id="autopilot-manual-idea-target" data-manual-idea-target type="url" maxlength="500" placeholder="https://offertalogica.it/…">
            <small>Facoltativa al salvataggio; se indicata deve essere una pagina HTTPS di OffertaLogica.</small>
          </div>
          <div class="ol-field">
            <label for="autopilot-manual-idea-notes">Note editoriali</label>
            <textarea id="autopilot-manual-idea-notes" data-manual-idea-notes maxlength="2000" rows="3" placeholder="Perché è importante, taglio desiderato, fonti da verificare…"></textarea>
          </div>
        </div>
        <div class="ol-autopilot-toolbar" style="margin-top:10px">
          <p class="ol-autopilot-save-state" data-manual-idea-message>Le idee ad alta priorità o urgenti possono precedere i segnali automatici.</p>
          <div class="ol-toolbar-group">
            <button class="ol-button ol-button-secondary" type="button" data-manual-idea-cancel hidden>Annulla modifica</button>
            <button class="ol-button ol-button-primary" type="button" data-manual-idea-save>Salva idea</button>
          </div>
        </div>
      </div>

      <div class="ol-field" style="margin-top:18px">
        <label>Anteprima priorità Autopilota</label>
        <p class="ol-muted">Calcola quale tema verrebbe scelto oggi. È un dry-run: non cambia stati, non crea bozze e non pubblica.</p>
        <div class="ol-autopilot-toolbar">
          <p class="ol-autopilot-save-state" data-planner-message>Nessuna anteprima calcolata.</p>
          <button class="ol-button ol-button-secondary" type="button" data-planner-preview>Calcola scelta</button>
        </div>
        <div class="ol-autopilot-archive-list" data-planner-result></div>
      </div>

      <div class="ol-field" style="margin-top:18px">
        <label>Acquisizione Search Console</label>
        <p>Importa nello storico editoriale dati aggregati di query, pagina, clic, impressioni, CTR e posizione. Nessun articolo viene generato o pubblicato.</p>
      </div>
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
        <p class="ol-muted">Qui convivono idee inserite dalla Redazione e opportunità salvate dall’analisi Search Console, con origine sempre visibile. Per un nuovo articolo selezionato puoi ora generare una bozza completa con ricerca web, fonti e QA. La generazione non pubblica nulla.</p>
        <p class="ol-autopilot-save-state" data-opportunity-message>Caricamento opportunità…</p>
        <div class="ol-autopilot-archive-list" data-opportunity-list>
          <p class="ol-muted">Caricamento…</p>
        </div>
      </div>

      <div class="ol-field" style="margin-top:18px">
        <label>Piano post statici</label>
        <p class="ol-muted">I post collegati all’articolo restano bozze separate. Nessun canale è preselezionato: Facebook/Instagram vengono associati solo se li scegli esplicitamente. Reel, video, TikTok e LinkedIn non fanno parte di questo blocco.</p>
        <p class="ol-autopilot-save-state" data-social-plan-message>Caricamento piano post…</p>
        <div class="ol-autopilot-archive-list" data-social-plan-list><p class="ol-muted">Caricamento…</p></div>
      </div>

      <div class="ol-field" style="margin-top:18px">
        <label>Ultimi cicli Autopilota</label>
        <p class="ol-muted">Registro tecnico delle preparazioni. In questa versione il ciclo genera bozze e post, ma non esegue pubblicazioni automatiche.</p>
        <div class="ol-autopilot-archive-list" data-automation-run-list><p class="ol-muted">Caricamento…</p></div>
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
    editor.querySelector("[data-manual-idea-type]").value = ["new_article", "update_article"].includes(row.opportunity_type) ? row.opportunity_type : "new_article";
    editor.querySelector("[data-manual-idea-priority]").value = ["normal", "high", "urgent"].includes(manual.priority) ? manual.priority : "normal";
    editor.querySelector("[data-manual-idea-deadline]").value = manual.deadline || "";
    editor.querySelector("[data-manual-idea-category]").value = row.category || "";
    editor.querySelector("[data-manual-idea-target]").value = row?.evidence?.target_page_url || "";
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
      opportunity_type: editor.querySelector("[data-manual-idea-type]")?.value || "new_article",
      priority: editor.querySelector("[data-manual-idea-priority]")?.value || "normal",
      deadline: editor.querySelector("[data-manual-idea-deadline]")?.value || "",
      category: editor.querySelector("[data-manual-idea-category]")?.value || "",
      target_url: editor.querySelector("[data-manual-idea-target]")?.value || "",
      notes: editor.querySelector("[data-manual-idea-notes]")?.value || "",
    };
  }

  function renderPlannerPreview(section, payload) {
    const box = section?.querySelector("[data-planner-result]");
    const message = section?.querySelector("[data-planner-message]");
    if (!box || !message) return;
    const decision = payload?.decision;
    const engine = payload?.automation_enabled ? "motore configurato come attivo" : "motore ancora disattivato";
    if (!decision) {
      const reason = payload?.article_cycle_disabled
        ? "Il limite massimo articoli per ciclo è impostato a 0."
        : payload?.no_publish
          ? "La configurazione consente di chiudere il ciclo senza articolo."
          : "Nessun candidato disponibile con le regole attuali.";
      box.innerHTML = `<div class="ol-autopilot-archive-item"><strong>Nessun tema selezionato nel dry-run</strong><small>Soglia Search Console: ${Number(payload?.minimum_opportunity_score || 0)}/100 · ${esc(engine)}.</small><small>${esc(reason)}</small></div>`;
      message.textContent = "Dry-run completato senza candidato.";
      return;
    }
    const source = decision.source === "manual_idea"
      ? `Idea manuale · priorità ${manualIdeaPriorityLabel(decision.priority).toLowerCase()}`
      : decision.source === "search_console"
        ? `Search Console · ${Number(decision.score || 0)}/100`
        : "Opportunità già selezionata";
    const deadline = decision.deadline ? ` · scadenza ${manualIdeaDeadlineLabel(decision.deadline)}` : "";
    const destination = decision.source === "search_console"
      ? "Segnale da classificare"
      : opportunityTypeLabel(decision.opportunity_type);
    box.innerHTML = `<div class="ol-autopilot-archive-item">
      <strong>${esc(decision.topic || "Tema senza titolo")}</strong>
      <small>${esc(source)}${esc(deadline)} · ${esc(destination)}</small>
      <small>${esc(decision.reason || "Scelta deterministica secondo le priorità configurate.")}</small>
      <small>Dry-run: nessuno stato o contenuto è stato modificato.</small>
    </div>`;
    message.textContent = `Scelta calcolata · ${engine}.`;
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
    if (!manual) return "";
    const deadline = manual.deadline ? ` · scadenza ${manualIdeaDeadlineLabel(manual.deadline)}` : " · nessuna scadenza";
    const notes = manual.notes ? `<small>Note: ${esc(manual.notes)}</small>` : "";
    const editable = row.status !== "completed" && !row.target_article_id
      ? `<button class="ol-button ol-button-secondary ol-button-small" type="button" data-manual-idea-edit="${esc(row.id || "")}">Modifica idea</button>`
      : "";
    return `<small>Origine: inserimento manuale${esc(deadline)}</small>${notes}${editable ? `<div class="ol-toolbar-group" style="margin-top:8px">${editable}</div>` : ""}`;
  }


  function platformLabel(platform) {
    return ({ facebook: "Facebook", instagram: "Instagram", threads: "Threads", linkedin: "LinkedIn" })[platform] || platform;
  }

  function platformChoicesMarkup(id, selected = [], attribute = "data-package-platform") {
    const selectedSet = new Set(Array.isArray(selected) ? selected : []);
    const channels = (socialChannels.length ? socialChannels : [
      { platform: "facebook", display_name: "Facebook", enabled: false },
      { platform: "instagram", display_name: "Instagram", enabled: false },
    ]).filter((channel) => ["facebook", "instagram"].includes(String(channel.platform || "")));
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
    const candidateMarkup = candidate?.url
      ? `<div style="margin-top:10px"><strong>Anteprima da approvare</strong><div style="margin-top:6px"><img src="${esc(candidate.url)}" alt="${esc(candidate.alt_text || "Anteprima immagine articolo")}" loading="lazy" style="display:block;max-width:620px;width:100%;height:auto;border-radius:10px"></div><small>${candidate.source === "manual_upload" ? "Immagine caricata manualmente" : `Generata in HD · ${esc(candidate.model || "modello immagini")}`} · non ancora collegata all’articolo.</small></div>`
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
    const qa = generation?.qa || {};
    const sourceCount = Number(qa.sources_count || generation?.sources?.length || 0);
    const buttonLabel = generation ? "Rigenera bozza completa" : "Genera bozza completa con fonti";
    const currentPlatforms = Array.isArray(generation?.platforms) ? generation.platforms : [];
    const summary = generation
      ? `<small>Ultima generazione: ${esc(dateIt(generation.generated_at))} · ${esc(generation.model || "modello server")} · ${sourceCount} fonti · ${Number(qa.static_posts_count || 0)} post statici. Pubblicazione automatica: no.</small>`
      : '<small>La generazione usa ricerca web lato server, salva le fonti, applica controlli minimi e prepara due post statici in bozza. Nessun contenuto viene pubblicato.</small>';
    return `<div class="ol-field" style="margin-top:8px">
      <label>Canali per i post statici del pacchetto</label>
      <div class="ol-autopilot-sources">${platformChoicesMarkup(id, currentPlatforms)}</div>
      <small>Nessun canale è obbligatorio. I canali non collegati restano disabilitati.</small>
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

  function renderSocialPlan(section) {
    const list = section?.querySelector("[data-social-plan-list]");
    const message = section?.querySelector("[data-social-plan-message]");
    if (!list || !message) return;
    if (!socialPlanItems.length) {
      list.innerHTML = '<p class="ol-muted">Nessun post statico preparato.</p>';
      message.textContent = "Il piano verrà popolato insieme alle bozze articolo generate dall’Autopilota.";
      return;
    }
    list.innerHTML = socialPlanItems.map((row) => {
      const id = String(row.id || "");
      const editable = ["draft", "approved", "cancelled"].includes(String(row.status || ""));
      const destination = row.destination_target
        ? `${row.destination_target.label} · ${row.destination_target.url_path}`
        : row.post_type === "article_followup" ? "Articolo collegato" : "—";
      const statusOptions = [
        ["draft", "Bozza"], ["approved", "Approvato"], ["cancelled", "Annullato"],
      ].map(([value, label]) => `<option value="${value}" ${row.status === value ? "selected" : ""}>${label}</option>`).join("");
      return `<div class="ol-autopilot-archive-item" data-social-plan-item="${esc(id)}">
        <strong>${esc(row.theme || row.post_type || "Post statico")} · ${esc(socialPlanStatusLabel(row.status))}</strong>
        <small>${esc(row.post_type || "")} · destinazione: ${esc(destination)}</small>
        ${row?.source_article_image?.featured_image_url ? `<small>Immagine articolo approvata disponibile per il futuro riuso nel post statico.</small>` : `<small>Immagine articolo non ancora approvata.</small>`}
        <div class="ol-field" style="margin-top:8px"><label>Testo canonico</label><textarea data-social-plan-text="${esc(id)}" rows="4" maxlength="4000" ${editable ? "" : "disabled"}>${esc(row.canonical_text || "")}</textarea></div>
        <div class="ol-field" style="margin-top:8px"><label>Canali espliciti</label><div class="ol-autopilot-sources">${platformChoicesMarkup(id, row.platforms || [], "data-social-plan-platform")}</div></div>
        ${editable ? `<div class="ol-autopilot-fields" style="margin-top:8px"><div class="ol-field"><label>Stato editoriale</label><select data-social-plan-status="${esc(id)}">${statusOptions}</select></div></div><div class="ol-toolbar-group" style="margin-top:8px"><button class="ol-button ol-button-secondary ol-button-small" type="button" data-social-plan-save="${esc(id)}">Salva post</button></div>` : ""}
        <small>Nessuna pubblicazione automatica viene eseguita da questo pannello.</small>
      </div>`;
    }).join("");
    message.textContent = `${numberIt(socialPlanItems.length)} post nel piano. Canali e approvazione restano espliciti.`;
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

  function renderAutomationRuns(section) {
    const list = section?.querySelector("[data-automation-run-list]");
    if (!list) return;
    if (!automationRuns.length) {
      list.innerHTML = '<p class="ol-muted">Nessun ciclo registrato.</p>';
      return;
    }
    list.innerHTML = automationRuns.slice(0, 12).map((run) => `<div class="ol-autopilot-archive-item">
      <strong>${esc(run.run_type || "ciclo")} · ${esc(run.status || "—")}</strong>
      <small>Avvio ${esc(dateIt(run.started_at || run.created_at))}${run.finished_at ? ` · fine ${esc(dateIt(run.finished_at))}` : ""}</small>
      ${run.last_error ? `<small>Errore: ${esc(run.last_error)}</small>` : `<small>Pubblicazione automatica: ${run?.details?.publication_performed ? "sì" : "no"}</small>`}
    </div>`).join("");
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
    if (targetArticleId && (row.status !== "selected" || type !== "new_article")) {
      return `<div class="ol-toolbar-group" style="margin-top:8px">
        <a class="ol-button ol-button-secondary ol-button-small" href="/redazione?scope=mine&amp;status=all&amp;id=${encodeURIComponent(targetArticleId)}">Apri articolo collegato</a>
      </div>`;
    }
    if (row.status !== "selected") return "";

    const option = (value, label) => `<option value="${value}" ${type === value ? "selected" : ""}>${label}</option>`;
    let followup = '<small>Scegli la destinazione editoriale e salvala prima di procedere.</small>';
    if (type === "new_article") {
      followup = `${targetArticleId ? `<div class="ol-toolbar-group" style="margin-top:8px"><a class="ol-button ol-button-secondary ol-button-small" href="/redazione?scope=mine&amp;status=all&amp;id=${encodeURIComponent(targetArticleId)}">Apri articolo collegato</a></div>` : ""}${articleGenerationMarkup(row)}`;
    } else if (type === "update_article") {
      followup = `<small>Nessuna nuova bozza viene creata. Prepara una proposta separata dalla pagina pubblicata e approvala manualmente prima di qualsiasi fase applicativa.</small>${updateTargetWorkflow(row)}`;
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
          <strong>${opportunityHeading(row)}</strong>
          <small>Tipo: ${esc(opportunityTypeLabel(row.opportunity_type))} · salvata ${esc(dateIt(row.created_at))}${esc(decided)}</small>
          <small>${esc(row.rationale || "Segnale da valutare manualmente.")}</small>
          ${opportunitySourceDetails(row)}
          ${manualIdeaMeta(row) ? "" : contextPagesMarkup(row.context_pages)}
          <div class="ol-toolbar-group" style="margin-top:8px">${opportunityActions(row)}</div>
          ${row.status === "completed" ? updateCompletionMarkup(row) : selectedOpportunityWorkflow(row)}
        </div>`;
      }).join("");
      message.textContent = `${numberIt(opportunityRows.length)} opportunità persistenti. Il ciclo di aggiornamento può essere chiuso solo dopo verifica della pagina pubblicata.`;
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
    const manualSaveButton = event.target.closest("[data-manual-idea-save]");
    const manualCancelButton = event.target.closest("[data-manual-idea-cancel]");
    const manualEditButton = event.target.closest("[data-manual-idea-edit]");
    const plannerButton = event.target.closest("[data-planner-preview]");
    const generateArticleButton = event.target.closest("[data-article-generate]");
    const generateImageButton = event.target.closest("[data-article-image-generate]");
    const uploadImageButton = event.target.closest("[data-article-image-upload]");
    const approveImageButton = event.target.closest("[data-article-image-approve]");
    const discardImageButton = event.target.closest("[data-article-image-discard]");
    const socialPlanSaveButton = event.target.closest("[data-social-plan-save]");
    const saveButton = event.target.closest("[data-save-opportunity]");
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
        const payload = await endpoint("editorial-planner-preview");
        renderPlannerPreview(section, payload);
      } catch (error) {
        if (plannerMessage) plannerMessage.textContent = `Anteprima non disponibile: ${error.message}`;
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
      if (imageMessage) imageMessage.textContent = "Generazione immagine fotografica HD in corso…";
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
      if (row?.evidence?.article_generation && !window.confirm("Rigenerare la bozza completa? È consentito solo se la bozza non è stata modificata manualmente dopo l’ultima generazione.")) return;
      const platforms = [...section.querySelectorAll(`input[data-package-platform="${id}"]:checked`)].map((input) => input.value);
      generateArticleButton.disabled = true;
      if (message) message.textContent = "Ricerca fonti, generazione bozza e QA in corso…";
      try {
        const payload = await endpoint("generate-editorial-article-package", {
          method: "POST",
          body: { id, platforms },
        });
        const result = payload?.result;
        if (message) message.textContent = `Bozza completa preparata: ${Number(result?.qa?.sources_count || 0)} fonti usate dalla ricerca, ${Number(result?.qa?.static_posts_count || 0)} post statici in bozza. Nessuna pubblicazione eseguita.`;
        await Promise.all([loadOpportunities(section, true), loadSocialPlan(section), loadAutomationRuns(section)]);
      } catch (error) {
        generateArticleButton.disabled = false;
        if (message) message.textContent = `Generazione non completata: ${error.message}`;
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
