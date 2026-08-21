(() => {
  "use strict";

  const SUPABASE_URL = "https://kzxdamhfmzaxonpkytcf.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_poz1xBKiXceLCFV3u_tPIg_5_-ycHcl";
  const STORAGE_KEY = "offertalogica-premium-staff-auth";
  const BUCKET = "premium-bills";
  const RED_VERIFIER_VERSION = "premium-red-verifier-v0.36.33";
  const MANAGER_ROLES = new Set(["reviewer", "technician", "admin", "owner"]);

  let client = null;
  let currentSession = null;
  let currentStaff = null;
  let rows = [];
  let selectedId = null;
  let selectedNotes = [];
  let selectedAnomalies = [];
  let selectedAnalyses = [];
  let selectedFieldReviews = [];
  const validationStartedAtByRun = new Map();
  const VALIDATION_DRAFT_PREFIX = "offertalogica-premium-validation-draft-v1:";
  const VALIDATION_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
  const AI_VALIDATION = window.OffertaLogicaPremiumAiValidation || null;
  let validationTimerId = null;
  let busy = false;
  let loadSequence = 0;
  let staffVerificationRequest = null;
  let staffContextKey = "";
  let queueLoaded = false;

  const byId = id => document.getElementById(id);

  function confirmStaffAction(options = {}) {
    const handler = window.top?.OffertaLogicaStaffConfirm;
    return typeof handler === "function" ? handler(options) : Promise.resolve(false);
  }
  const state = {};

  function setText(element, value) {
    if (element) element.textContent = value == null ? "" : String(value);
  }

  function clear(element) {
    if (element) element.replaceChildren();
  }

  function node(tag, options = {}, children = []) {
    const element = document.createElement(tag);
    if (options.className) element.className = options.className;
    if (options.text != null) element.textContent = String(options.text);
    if (options.type) element.type = options.type;
    if (options.name) element.name = options.name;
    if (options.value != null) element.value = String(options.value);
    if (options.placeholder) element.placeholder = options.placeholder;
    if (options.dataset) {
      Object.entries(options.dataset).forEach(([key, value]) => {
        element.dataset[key] = String(value);
      });
    }
    if (options.attrs) {
      Object.entries(options.attrs).forEach(([key, value]) => {
        if (value !== false && value != null) element.setAttribute(key, String(value));
      });
    }
    const list = Array.isArray(children) ? children : [children];
    list.filter(Boolean).forEach(child => element.append(child));
    return element;
  }

  function option(value, label, selected = false) {
    const item = node("option", { value, text: label });
    item.selected = selected;
    return item;
  }

  function formatDate(value, includeTime = false) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("it-IT", includeTime ? {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    } : {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(date);
  }

  function formatSize(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return "0 KB";
    if (value < 1_000_000) return `${Math.max(1, Math.round(value / 1000))} KB`;
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(".", ",")} MB`;
  }

  function formatMoney(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "—";
    return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(amount);
  }

  function statusLabel(value) {
    return {
      pending: "Da verificare",
      assigned: "Assegnato",
      in_review: "In controllo",
      more_info_required: "Integrazione",
      completed: "Completato",
      canceled: "Annullato"
    }[value] || value || "—";
  }

  function outcomeLabel(value) {
    return {
      pending: "Non definito",
      correct: "Bolletta corretta",
      anomaly: "Anomalia",
      possible_saving: "Possibile risparmio",
      inconclusive: "Esito non conclusivo"
    }[value] || value || "—";
  }

  function supplyLabel(value) {
    return {
      electricity: "Luce",
      gas: "Gas",
      dual: "Luce e gas",
      unknown: "Non definita"
    }[value] || value || "—";
  }

  function roleLabel(value) {
    return {
      owner: "Proprietario",
      admin: "Amministratore",
      technician: "Tecnico",
      reviewer: "Revisore",
    }[String(value || "").trim().toLowerCase()] || "Staff";
  }

  function categoryLabel(value) {
    return {
      price: "Prezzo",
      fixed_fee: "Quota fissa",
      discount: "Sconto",
      consumption: "Consumi",
      tax: "Imposte",
      adjustment: "Conguaglio",
      contract: "Contratto",
      duplicate: "Duplicazione",
      other: "Altro"
    }[value] || value || "Altro";
  }

  function severityLabel(value) {
    return {
      low: "Bassa",
      medium: "Media",
      high: "Alta",
      critical: "Critica"
    }[value] || value || "—";
  }

  function automaticScreeningLabel(value) {
    return {
      clear: "Verde · Regolare",
      review_recommended: "Rosso · Anomalia importante",
      inconclusive: "Giallo · Avviso",
      failed: "Giallo · Documento da ricaricare",
      running: "Analisi in corso",
      pending: "Analisi in attesa",
      not_run: "Analisi non eseguita"
    }[value] || "Non disponibile";
  }

  function renderAutomaticScreening(container, row) {
    const status = row.bill?.automatic_screening_status;
    if (!status || status === "not_run") return;
    const section = node("section", { className: "section" });
    section.append(node("div", { className: "section-head" }, [
      node("div", {}, [
        node("h3", { text: "Screening automatico cliente" }),
        node("p", { text: status === "review_recommended" ? "Anomalia rossa inviata dal cliente allo staff." : "Avviso automatico senza intervento dello staff." })
      ]),
      makeBadge(status === "clear" ? "completed" : "pending", automaticScreeningLabel(status))
    ]));
    const summary = String(row.bill?.automatic_screening_summary || "").trim();
    if (summary) section.append(node("p", { className: "section-copy", text: summary }));
    const reasons = Array.isArray(row.bill?.automatic_screening_reasons) ? row.bill.automatic_screening_reasons : [];
    if (reasons.length) {
      const list = node("div", { className: "timeline" });
      reasons.forEach(reason => {
        list.append(node("article", { className: "timeline-item" }, [
          node("strong", { text: reason.title || "Elemento da approfondire" }),
          node("p", { text: reason.description || "Verifica richiesta." }),
          node("small", { text: `${reason.source || "automatico"} · ${reason.severity || "medium"}` })
        ]));
      });
      section.append(list);
    }
    container.append(section);
  }

  function friendlyError(error) {
    const raw = String(error?.message || error || "").trim();
    const message = raw.toLowerCase();
    if (!message) return "Operazione non riuscita.";
    if (message.includes("invalid login credentials")) return "Email o password non corrette.";
    if (message.includes("email not confirmed")) return "L’indirizzo email non è stato confermato.";
    if (message.includes("premium_staff_access_required")) return "L’account non è autorizzato alla revisione Premium.";
    if (message.includes("premium_check_assigned_to_other_staff")) return "Il controllo è già assegnato a un altro operatore.";
    if (message.includes("premium_invalid_check_transition")) return "Il cambio di stato non è consentito.";
    if (message.includes("premium_customer_message_required")) return "Inserisci il messaggio destinato al cliente.";
    if (message.includes("premium_anomaly_required")) return "Aggiungi almeno un’anomalia prima di completare con questo esito.";
    if (message.includes("premium_check_must_be_claimed")) return "Prendi prima in carico il controllo per continuare.";
    if (message.includes("premium_check_not_found")) return "Il controllo non è più disponibile.";
    if (message.includes("premium_ai_already_running") || message.includes("premium_analysis_already_running")) return "È già in corso una pre-analisi IA per questa bolletta.";
    if (message.includes("premium_ai_not_configured")) return "La pre-analisi IA non è configurata sul server.";
    if (message.includes("premium_ai_timeout")) return "La pre-analisi IA ha richiesto troppo tempo. La revisione manuale resta disponibile.";
    if (message.includes("premium_red_verification_not_requestable")) return "La seconda verifica IA è disponibile solo per una bolletta classificata rossa.";
    if (message.includes("premium_red_snapshot")) return "Non è stato possibile recuperare i dati della seconda verifica IA.";
    if (message.includes("premium_analysis_not_reviewable")) return "Questa esecuzione IA non è ancora validabile.";
    if (message.includes("premium_cannot_approve_missing_value")) return "Un campo senza valore IA non può essere approvato: correggilo, segnalo come mancante o non applicabile.";
    if (message.includes("premium_corrected_value_required")) return "Inserisci il valore corretto per tutti i campi marcati come corretti.";
    if (message.includes("premium_analysis_fields_required")) return "Non ci sono campi da validare.";
    if (message.includes("premium_admin_delete_required")) return "Solo un amministratore può eliminare definitivamente una bolletta.";
    if (message.includes("row-level security") || message.includes("permission denied")) return "Operazione non autorizzata dalle regole di sicurezza.";
    if (message.includes("failed to fetch") || message.includes("network")) return "Connessione non disponibile. Controlla la rete e riprova.";
    return raw;
  }

  function setAuthMessage(kind, message) {
    if (!state.authMessage) return;
    state.authMessage.className = `auth-message${kind ? ` ${kind}` : ""}`;
    state.authMessage.textContent = message || "";
    state.authMessage.hidden = !message;
  }

  function setPageMessage(kind, message) {
    if (!state.pageMessage) return;
    state.pageMessage.className = `page-message${kind ? ` ${kind}` : ""}`;
    state.pageMessage.textContent = message || "";
    state.pageMessage.hidden = !message;
  }

  function setView(view) {
    state.authView.hidden = view !== "auth";
    state.deniedView.hidden = view !== "denied";
    state.dashboard.hidden = view !== "dashboard";
    state.topActions.hidden = view !== "dashboard";
  }

  function setBusy(value) {
    busy = Boolean(value);
    document.querySelectorAll("button, input, select, textarea").forEach(element => {
      if (element.closest("#staffLoginForm") && !currentStaff) {
        element.disabled = busy;
      } else if (element.closest("#staffDashboard") || element.closest("#staffTopActions")) {
        element.disabled = busy;
      }
    });
    document.body.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function isAdmin() {
    return ["admin", "owner"].includes(String(currentStaff?.role || "").trim().toLowerCase());
  }

  async function deletePremiumRecords(resource, ids) {
    const cleanIds = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))];
    if (!isAdmin() || !cleanIds.length) throw new Error("premium_admin_delete_required");
    const { data, error } = await client.rpc("premium_staff_delete_records", {
      p_resource: resource,
      p_ids: cleanIds,
    });
    if (error) throw error;
    return data;
  }

  function renderMetrics() {
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
    const completedToday = rows.filter(row => {
      if (row.check.status !== "completed" || !row.check.completed_at) return false;
      const date = new Date(row.check.completed_at);
      return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` === todayKey;
    }).length;
    setText(state.metricPending, rows.filter(row => row.check.status === "pending").length);
    setText(state.metricWorking, rows.filter(row => ["assigned", "in_review"].includes(row.check.status)).length);
    setText(state.metricInfo, rows.filter(row => row.check.status === "more_info_required").length);
    setText(state.metricCompletedToday, completedToday);
  }

  function searchableText(row) {
    return [
      row.profile?.full_name,
      row.profile?.email,
      row.utility?.label,
      row.utility?.provider_name,
      row.bill?.original_file_name,
      row.bill?.commodity
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function filteredRows() {
    const query = String(state.search?.value || "").trim().toLowerCase();
    const status = String(state.statusFilter?.value || "");
    const assignment = String(state.assignmentFilter?.value || "");
    return rows.filter(row => {
      if (query && !searchableText(row).includes(query)) return false;
      if (status && row.check.status !== status) return false;
      if (assignment === "unassigned" && row.check.assigned_staff_id) return false;
      if (assignment === "mine" && row.check.assigned_staff_id !== currentSession?.user?.id) return false;
      if (assignment === "other" && (!row.check.assigned_staff_id || row.check.assigned_staff_id === currentSession?.user?.id)) return false;
      return true;
    });
  }

  function makeBadge(value, label = statusLabel(value)) {
    return node("span", { className: `badge ${value || ""}`, text: label });
  }

  function renderQueue() {
    const filtered = filteredRows();
    clear(state.queue);
    setText(state.queueCount, `${filtered.length} ${filtered.length === 1 ? "richiesta" : "richieste"}`);

    if (!filtered.length) {
      state.queue.append(node("div", { className: "queue-empty", text: rows.length ? "Nessuna richiesta corrisponde ai filtri." : "Non ci sono controlli richiesti." }));
      if (selectedId && !rows.some(row => row.check.id === selectedId)) {
        selectedId = null;
        renderEmptyDetail();
      }
      return;
    }

    filtered.forEach(row => {
      const assignedLabel = !row.check.assigned_staff_id
        ? "Non assegnato"
        : row.check.assigned_staff_id === currentSession?.user?.id
          ? "Assegnato a te"
          : "Altro operatore";
      const customerName = row.profile?.full_name || row.profile?.email || "Cliente Premium";
      const title = node("div", { className: "queue-title" }, [
        node("strong", { text: row.bill?.original_file_name || "Bolletta" }),
        node("span", { text: `${customerName} · ${row.utility?.label || "Utenza"}` })
      ]);
      const top = node("div", { className: "queue-top" }, [title, makeBadge(row.check.status)]);
      const meta = node("div", { className: "queue-meta", text: `${supplyLabel(row.bill?.commodity)} · Richiesta ${formatDate(row.check.created_at, true)}` });
      const badges = node("div", { className: "badges" }, [
        makeBadge(row.check.outcome === "pending" ? "" : row.check.outcome, assignedLabel)
      ]);
      const button = node("button", {
        className: `queue-item${row.check.id === selectedId ? " active" : ""}`,
        type: "button",
        dataset: { checkId: row.check.id },
        attrs: { "aria-pressed": row.check.id === selectedId ? "true" : "false" }
      }, [top, meta, badges]);
      button.addEventListener("click", () => selectCheck(row.check.id));
      state.queue.append(button);
    });
  }

  function renderEmptyDetail(message = "Seleziona una richiesta dalla coda.") {
    stopValidationTimer();
    clear(state.detail);
    state.detail.append(node("div", { className: "detail-empty", text: message }));
  }

  function infoCard(label, value) {
    return node("div", { className: "info" }, [
      node("span", { text: label }),
      node("strong", { text: value || "—" })
    ]);
  }

  function appendField(container, label, control, full = false) {
    const wrap = node("div", { className: full ? "field full" : "field" }, [
      node("label", { text: label }),
      control
    ]);
    container.append(wrap);
    return control;
  }

  function renderNotes(container) {
    const section = node("section", { className: "section" });
    section.append(node("h3", { text: "Note interne" }));
    const list = node("div", { className: "timeline" });
    if (!selectedNotes.length) {
      list.append(node("div", { className: "timeline-item", text: "Nessuna nota interna." }));
    } else {
      selectedNotes.forEach(note => {
        list.append(node("article", { className: "timeline-item" }, [
          node("strong", { text: note.staff_user_id === currentSession?.user?.id ? "Nota tua" : "Nota staff" }),
          node("p", { text: note.note }),
          node("small", { text: formatDate(note.created_at, true) })
        ]));
      });
    }
    section.append(list);

    const row = selectedRow();
    if (row && ["assigned", "in_review", "more_info_required"].includes(row.check.status)) {
      const form = node("form", { attrs: { novalidate: "" } });
      const grid = node("div", { className: "form-grid" });
      const noteInput = node("textarea", { name: "note", placeholder: "Annotazione visibile soltanto allo staff" });
      appendField(grid, "Nuova nota interna", noteInput, true);
      form.append(grid, node("div", { className: "form-actions" }, [node("button", { className: "button secondary", type: "submit", text: "AGGIUNGI NOTA" })]));
      form.addEventListener("submit", event => handleAddNote(event, noteInput));
      section.append(form);
    }
    container.append(section);
  }

  function renderAnomalies(container, row) {
    const section = node("section", { className: "section" });
    section.append(node("h3", { text: "Anomalie e opportunità" }));
    const list = node("div", { className: "timeline" });
    if (!selectedAnomalies.length) {
      list.append(node("div", { className: "timeline-item", text: "Nessuna anomalia registrata." }));
    } else {
      selectedAnomalies.forEach(anomaly => {
        const parts = [`${categoryLabel(anomaly.category)} · Gravità ${severityLabel(anomaly.severity)}`];
        if (anomaly.estimated_impact_eur != null) parts.push(`Impatto ${formatMoney(anomaly.estimated_impact_eur)}`);
        const item = node("article", { className: "timeline-item anomaly-item" }, [
          node("strong", { text: anomaly.title }),
          node("p", { text: anomaly.description || "Nessuna descrizione." }),
          node("small", { text: parts.join(" · ") })
        ]);
        if (["assigned", "in_review", "more_info_required"].includes(row.check.status)) {
          const action = node("div", { className: "anomaly-actions" }, [
            node("button", { className: "button danger compact", type: "button", text: "Rimuovi", dataset: { anomalyId: anomaly.id } })
          ]);
          action.querySelector("button").addEventListener("click", () => handleDeleteAnomaly(anomaly.id));
          item.append(action);
        }
        list.append(item);
      });
    }
    section.append(list);

    if (["assigned", "in_review", "more_info_required"].includes(row.check.status)) {
      const form = node("form", { attrs: { novalidate: "" } });
      const grid = node("div", { className: "form-grid" });
      const category = node("select", { name: "category" }, [
        option("price", "Prezzo"), option("fixed_fee", "Quota fissa"), option("discount", "Sconto"),
        option("consumption", "Consumi"), option("tax", "Imposte"), option("adjustment", "Conguaglio"),
        option("contract", "Contratto"), option("duplicate", "Duplicazione"), option("other", "Altro")
      ]);
      const severity = node("select", { name: "severity" }, [
        option("low", "Bassa"), option("medium", "Media", true), option("high", "Alta"), option("critical", "Critica")
      ]);
      const title = node("input", { name: "title", placeholder: "Titolo sintetico" });
      const impact = node("input", { name: "impact", type: "number", placeholder: "0,00", attrs: { step: "0.01" } });
      const description = node("textarea", { name: "description", placeholder: "Descrizione destinata al fascicolo del controllo" });
      appendField(grid, "Categoria", category);
      appendField(grid, "Gravità", severity);
      appendField(grid, "Titolo", title);
      appendField(grid, "Impatto stimato €", impact);
      appendField(grid, "Descrizione", description, true);
      form.append(grid, node("div", { className: "form-actions" }, [node("button", { className: "button secondary", type: "submit", text: "REGISTRA ANOMALIA" })]));
      form.addEventListener("submit", event => handleAddAnomaly(event, { category, severity, title, impact, description }));
      section.append(form);
    }
    container.append(section);
  }

  function analysisStatusLabel(value) {
    return {
      queued: "In coda",
      running: "In esecuzione",
      completed: "Bozza completa",
      partial: "Bozza parziale",
      failed: "Non riuscita"
    }[value] || value || "—";
  }

  function formatTechnicalNumber(value, maximumFractionDigits = 6) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return new Intl.NumberFormat("it-IT", { maximumFractionDigits }).format(number);
  }

  function analysisSupplyRows(data = {}) {
    const rows = [];
    const adaptive = Array.isArray(data?.adaptive_form?.supplies) ? data.adaptive_form.supplies : [];
    const findSupply = commodity => adaptive.find(item => item?.commodity === commodity) || {};
    const add = (commodity, label, consumption, consumptionUnit, price, priceUnit, fixedFee, priceType, index, formula) => {
      const supply = findSupply(commodity);
      if (![consumption, price, fixedFee, supply?.provider, data?.[`fornitore_${commodity}`]].some(value => value !== null && value !== undefined && value !== "")) return;
      rows.push({
        commodity,
        label,
        provider: supply?.provider || data?.[`fornitore_${commodity}`] || data?.fornitore || "—",
        consumption,
        consumptionUnit,
        price,
        priceUnit,
        fixedFee,
        priceType,
        index,
        formula,
        evidence: [supply?.annual_consumption?.evidence, supply?.primary_price?.evidence, supply?.fixed_fee?.evidence].filter(Boolean)
      });
    };
    add("luce", "Luce", data.consumo_luce_kwh, "kWh/anno", data.prezzo_luce_eur_kwh, "€/kWh", data.quota_fissa_vendita_luce_eur_anno, data.tipo_prezzo_luce, data.indice_riferimento_luce, data.formula_prezzo_luce);
    add("gas", "Gas", data.consumo_gas_smc, "Smc/anno", data.prezzo_gas_eur_smc, "€/Smc", data.quota_fissa_vendita_gas_eur_anno, data.tipo_prezzo_gas, data.indice_riferimento_gas, data.formula_prezzo_gas);
    return rows;
  }

  function validationStatusLabel(value) {
    return value === "validated" ? "Validata dallo staff" : "Da validare";
  }

  function formatDurationSeconds(value) {
    const total = Math.max(0, Math.round(Number(value || 0)));
    if (total < 60) return `${total} s`;
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours) return `${hours} h ${minutes} min ${seconds} s`;
    return `${minutes} min ${seconds} s`;
  }

  function validationDraftKey(runId) {
    const staffId = currentSession?.user?.id || "staff";
    return `${VALIDATION_DRAFT_PREFIX}${staffId}:${runId}`;
  }

  function clearValidationDraft(runId) {
    if (!runId) return;
    try {
      localStorage.removeItem(validationDraftKey(runId));
    } catch (_) {
      // Il salvataggio locale è un supporto di continuità, non deve bloccare la validazione.
    }
  }

  function loadValidationDraft(runId, validatedAt = "") {
    if (!runId) return null;
    try {
      const raw = localStorage.getItem(validationDraftKey(runId));
      if (!raw) return null;
      const draft = JSON.parse(raw);
      const updatedAt = Date.parse(draft?.updated_at || "");
      const validatedAtMs = Date.parse(validatedAt || "");
      const isExpired = !Number.isFinite(updatedAt) || Date.now() - updatedAt > VALIDATION_DRAFT_TTL_MS;
      const isOlderThanServer = Number.isFinite(validatedAtMs) && updatedAt <= validatedAtMs;
      if (draft?.run_id !== runId || isExpired || isOlderThanServer) {
        clearValidationDraft(runId);
        return null;
      }
      return draft;
    } catch (_) {
      clearValidationDraft(runId);
      return null;
    }
  }

  function stopValidationTimer() {
    if (validationTimerId !== null) {
      window.clearInterval(validationTimerId);
      validationTimerId = null;
    }
  }

  function updateValidationTimer(element, startedAt) {
    if (!element || !startedAt) return;
    const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    setText(element, `Tempo di validazione in corso: ${formatDurationSeconds(seconds)}`);
  }

  function startValidationTimer(runId, startedAt, element) {
    stopValidationTimer();
    if (!runId || !startedAt || !element) return;
    validationStartedAtByRun.set(runId, startedAt);
    updateValidationTimer(element, startedAt);
    validationTimerId = window.setInterval(() => updateValidationTimer(element, startedAt), 1000);
  }

  function ensureValidationStarted(runId, timerElement) {
    let startedAt = validationStartedAtByRun.get(runId);
    if (!startedAt) {
      startedAt = Date.now();
      startValidationTimer(runId, startedAt, timerElement);
    }
    return startedAt;
  }

  function saveValidationDraft(latest, controls, overallNote, timerElement, draftStatus) {
    const startedAt = ensureValidationStarted(latest.id, timerElement);
    const fields = Object.fromEntries(controls.map(control => [control.definition.key, {
      decision: String(control.decision.value || ""),
      reviewed_value: String(control.corrected.value || ""),
      note: String(control.note.value || "")
    }]));
    const draft = {
      version: 1,
      run_id: latest.id,
      staff_user_id: currentSession?.user?.id || null,
      started_at: startedAt,
      updated_at: new Date().toISOString(),
      fields,
      validation_note: String(overallNote.value || "")
    };
    try {
      localStorage.setItem(validationDraftKey(latest.id), JSON.stringify(draft));
      setText(draftStatus, "Bozza locale salvata automaticamente su questo dispositivo.");
    } catch (_) {
      setText(draftStatus, "Salvataggio automatico locale non disponibile: usa Salva validazione prima di uscire.");
    }
  }

  function reviewValue(review) {
    if (!review || review.reviewed_value === undefined) return null;
    return review.reviewed_value;
  }

  function createCorrectedControl(definition, value) {
    if (definition.type === "commodity") {
      const control = node("select", { name: `corrected_${definition.key}` }, [
        option("", "Seleziona"),
        option("luce", "Luce"),
        option("gas", "Gas"),
        option("dual", "Luce e gas"),
        option("unknown", "Non definita")
      ]);
      if (value !== null && value !== undefined) control.value = String(value);
      return control;
    }
    const control = node("input", {
      name: `corrected_${definition.key}`,
      type: definition.type === "number" ? "text" : "text",
      placeholder: definition.type === "number" ? "Valore verificato" : "Dato verificato",
      attrs: definition.type === "number" ? { inputmode: "decimal" } : {}
    });
    if (value !== null && value !== undefined) control.value = String(value).replace(".", ",");
    return control;
  }

  function validationMetricsCards(metrics = {}) {
    const applicable = Number(metrics.applicable_fields || 0);
    const agreement = Number(metrics.accuracy_pct || 0);
    const correctionRate = Number(metrics.correction_rate_pct || 0);
    return node("div", { className: "info-grid validation-metrics" }, [
      infoCard("Campi applicabili", applicable || "—"),
      infoCard("Confermati", metrics.approved_fields ?? "—"),
      infoCard("Corretti", metrics.corrected_fields ?? "—"),
      infoCard("Mancanti", metrics.missing_fields ?? "—"),
      infoCard("Accordo IA/staff", applicable ? `${formatTechnicalNumber(agreement, 2)}%` : "—"),
      infoCard("Tasso correzione", applicable ? `${formatTechnicalNumber(correctionRate, 2)}%` : "—")
    ]);
  }

  function renderAiValidation(section, row, latest, data) {
    if (!AI_VALIDATION || !["completed", "partial"].includes(latest.status)) return;

    const definitions = AI_VALIDATION.fieldsForAnalysis(data, row.bill?.commodity);
    if (!definitions.length) return;

    const draft = loadValidationDraft(latest.id, latest.validated_at);
    const draftFields = draft?.fields && typeof draft.fields === "object" ? draft.fields : {};
    if (Number.isFinite(Number(draft?.started_at))) {
      validationStartedAtByRun.set(latest.id, Number(draft.started_at));
    } else {
      validationStartedAtByRun.delete(latest.id);
    }

    const reviewMap = new Map(selectedFieldReviews.map(review => [review.field_key, review]));
    const wrapper = node("div", { className: "validation-block" });
    wrapper.append(node("div", { className: "validation-heading" }, [
      node("div", {}, [
        node("h4", { text: "Validazione umana della bozza" }),
        node("p", { text: "Confronta ogni dato con il PDF. La metrica misura l’accordo sui campi verificati, non una precisione generale del modello." })
      ]),
      makeBadge(latest.review_status === "validated" ? "completed" : "pending", validationStatusLabel(latest.review_status))
    ]));

    if (latest.review_status === "validated") {
      wrapper.append(validationMetricsCards(latest.validation_metrics || {}));
      const validatedAt = latest.validated_at ? formatDate(latest.validated_at, true) : "—";
      wrapper.append(node("p", { className: "validation-audit", text: `Ultima validazione: ${validatedAt} · Tempo registrato ${formatDurationSeconds(latest.validation_seconds)}` }));
    }

    const form = node("form", { className: "validation-form", attrs: { novalidate: "" } });
    const controls = [];
    const list = node("div", { className: "validation-list" });

    definitions.forEach(definition => {
      const aiValue = AI_VALIDATION.aiValueForField(data, definition.key);
      const existing = reviewMap.get(definition.key) || null;
      const draftField = draftFields[definition.key] || null;
      const decision = node("select", { name: `decision_${definition.key}` }, [
        option("approved", "Confermato"),
        option("corrected", "Corretto"),
        option("missing", "Dato mancante"),
        option("not_applicable", "Non applicabile")
      ]);
      decision.value = draftField?.decision || existing?.decision || AI_VALIDATION.defaultDecision(aiValue);
      const correctedValue = draftField?.decision === "corrected"
        ? draftField.reviewed_value
        : existing?.decision === "corrected"
          ? reviewValue(existing)
          : null;
      const corrected = createCorrectedControl(definition, correctedValue);
      const note = node("input", { name: `note_${definition.key}`, type: "text", placeholder: "Nota facoltativa" });
      note.value = draftField?.note ?? existing?.note ?? "";
      const sync = () => {
        const isCorrected = decision.value === "corrected";
        corrected.disabled = !isCorrected;
        corrected.required = isCorrected;
        corrected.hidden = !isCorrected;
      };
      decision.addEventListener("change", sync);
      sync();

      list.append(node("article", { className: "validation-row" }, [
        node("div", { className: "validation-field" }, [
          node("strong", { text: definition.label }),
          node("small", { text: definition.key })
        ]),
        node("div", { className: "validation-ai-value" }, [
          node("span", { text: "Valore IA" }),
          node("strong", { text: AI_VALIDATION.formatValue(aiValue, definition) })
        ]),
        node("div", { className: "validation-control" }, [decision, corrected, note])
      ]));
      controls.push({ definition, aiValue, decision, corrected, note });
    });

    const overallNote = node("textarea", { name: "validation_note", placeholder: "Nota generale sulla qualità della pre-analisi" });
    overallNote.value = draft?.validation_note ?? latest.validation_note ?? "";
    const canValidate = row.check.status !== "pending" && Boolean(row.check.assigned_staff_id);
    const save = node("button", {
      className: "button primary",
      type: "submit",
      text: latest.review_status === "validated" ? "AGGIORNA VALIDAZIONE" : "SALVA VALIDAZIONE"
    });
    save.disabled = !canValidate;

    const timer = node("p", {
      className: "validation-timer",
      text: draft?.started_at
        ? "Ripristino del tempo della bozza…"
        : "Il tempo di validazione parte alla prima modifica."
    });
    const draftStatus = node("p", {
      className: "validation-draft-status",
      text: draft
        ? "Bozza locale ripristinata. Le modifiche non salvate sono state recuperate."
        : "Le modifiche vengono salvate automaticamente come bozza su questo dispositivo."
    });

    const persistDraft = () => saveValidationDraft(latest, controls, overallNote, timer, draftStatus);
    controls.forEach(control => {
      control.decision.addEventListener("change", persistDraft);
      control.corrected.addEventListener("input", persistDraft);
      control.note.addEventListener("input", persistDraft);
    });
    overallNote.addEventListener("input", persistDraft);

    form.append(
      list,
      node("div", { className: "field validation-note" }, [node("label", { text: "Nota generale" }), overallNote]),
      timer,
      draftStatus
    );
    if (!canValidate) {
      form.append(node("p", { className: "danger-note", text: "Prendi in carico il controllo prima di validare la bozza IA." }));
    }
    form.append(node("div", { className: "form-actions" }, [save]));
    form.addEventListener("submit", event => handleValidateAiAnalysis(event, latest, controls, overallNote));
    wrapper.append(form);
    section.append(wrapper);

    if (draft?.started_at) startValidationTimer(latest.id, Number(draft.started_at), timer);
  }

  function redVerificationLabel(value) {
    return {
      not_run: "Non eseguita",
      running: "In corso",
      resolved_ai: "Risolta dall’IA",
      quick_verify: "Verifica rapida",
      staff_required: "Staff necessario",
      inconclusive: "Non conclusiva",
      failed: "Non riuscita"
    }[value] || value || "Non eseguita";
  }

  function redVerificationBadgeState(value) {
    if (value === "resolved_ai") return "completed";
    if (["quick_verify", "running"].includes(value)) return "assigned";
    if (["staff_required", "inconclusive", "failed"].includes(value)) return "anomaly";
    return "pending";
  }

  function renderRedVerification(container, row) {
    if (row.bill?.automatic_screening_status !== "review_recommended") return;
    const stateValue = String(row.bill?.red_verification_state || "not_run");
    const result = row.bill?.red_verification_result && typeof row.bill.red_verification_result === "object"
      ? row.bill.red_verification_result
      : {};
    const resultVersion = String(result.version || "");
    const staleVerification = Boolean(resultVersion && resultVersion !== RED_VERIFIER_VERSION);
    const section = node("section", { className: "section ai-section" });
    const heading = node("div", { className: "ai-heading" }, [
      node("div", {}, [
        node("h3", { text: "Seconda verifica IA" }),
        node("p", { className: "ai-note", text: "Controllo indipendente del rosso sul PDF già archiviato. Non crea una nuova pratica e non sostituisce la decisione Staff su un controllo già aperto." })
      ]),
      makeBadge(redVerificationBadgeState(stateValue), redVerificationLabel(stateValue))
    ]);
    section.append(heading);

    if (!["completed", "canceled"].includes(row.check.status) && (["not_run", "failed"].includes(stateValue) || staleVerification)) {
      const button = node("button", {
        className: "button primary compact",
        type: "button",
        text: staleVerification ? "RICALCOLA SECONDA VERIFICA IA" : stateValue === "failed" ? "RIPROVA SECONDA VERIFICA IA" : "AVVIA SECONDA VERIFICA IA"
      });
      button.disabled = busy;
      button.addEventListener("click", handleRunRedVerification);
      heading.append(node("div", { className: "ai-actions" }, [button]));
    }

    if (staleVerification) {
      section.append(node("div", { className: "ai-warning" }, [
        node("strong", { text: "Verifica IA da aggiornare" }),
        node("p", { text: "Questo risultato è stato prodotto con una versione precedente del router. Ricalcolalo prima di concludere la pratica." })
      ]));
    }
    if (stateValue === "not_run") {
      section.append(node("div", { className: "timeline-item", text: "Questa pratica è precedente alla seconda verifica IA. Puoi eseguirla ora sulla stessa bolletta." }));
      container.append(section);
      return;
    }
    if (stateValue === "running") {
      section.append(node("div", { className: "timeline-item", text: "Seconda verifica IA in corso. Attendi il completamento prima di concludere la pratica." }));
      container.append(section);
      return;
    }

    section.append(node("div", { className: "info-grid ai-meta" }, [
      infoCard("Instradamento", result.route || "—"),
      infoCard("Decisione IA", result.decision || "—"),
      infoCard("Esito verifica", result.verification_result || "—"),
      infoCard("Confidenza dichiarata", result.confidence || "—")
    ]));

    const issue = String(result.issue || "").trim();
    if (issue) section.append(node("div", { className: "timeline-item" }, [node("strong", { text: "Problema verificato" }), node("p", { text: issue })]));
    const evidence = Array.isArray(result.evidence) ? result.evidence : [];
    if (evidence.length) {
      const list = node("div", { className: "timeline" });
      evidence.forEach(item => list.append(node("article", { className: "timeline-item" }, [
        node("strong", { text: item.page ? `Evidenza · pagina ${item.page}` : "Evidenza" }),
        node("p", { text: item.fact || "—" })
      ])));
      section.append(list);
    }
    const missing = Array.isArray(result.missing_data) ? result.missing_data.filter(Boolean) : [];
    if (missing.length) section.append(node("div", { className: "ai-warning" }, [
      node("strong", { text: "Dati mancanti" }),
      ...missing.map(item => node("p", { text: item }))
    ]));
    if (result.escalation_reason) section.append(node("div", { className: "ai-warning" }, [
      node("strong", { text: "Motivo dell’escalation" }),
      node("p", { text: result.escalation_reason })
    ]));
    if (result.customer_reply) section.append(node("div", { className: "timeline-item" }, [
      node("strong", { text: "Risposta proposta al cliente" }),
      node("p", { text: result.customer_reply })
    ]));
    if (stateValue === "resolved_ai") {
      section.append(node("p", { className: "ai-note", text: "L’IA ritiene il caso risolvibile autonomamente. Poiché questa pratica era già aperta, resta comunque allo Staff la chiusura finale del controllo." }));
    }
    container.append(section);
  }

  function renderAiAssistance(container, row) {
    const section = node("section", { className: "section ai-section" });
    const heading = node("div", { className: "ai-heading" }, [
      node("div", {}, [
        node("h3", { text: "Dati letti dalla bolletta" }),
        node("p", { className: "ai-note", text: "Riepilogo operativo dei dati utili estratti dal PDF. I dettagli tecnici restano separati." })
      ])
    ]);
    section.append(heading);

    const latest = selectedAnalyses[0] || null;
    const analysisRunning = latest && ["queued", "running"].includes(latest.status);
    if (!["completed", "canceled"].includes(row.check.status)) {
      const button = node("button", {
        className: "button primary compact",
        type: "button",
        text: analysisRunning ? "ANALISI IA IN CORSO" : latest ? "RIPETI LETTURA" : "AVVIA LETTURA"
      });
      button.disabled = busy || analysisRunning;
      button.addEventListener("click", handleRunAiAnalysis);
      heading.append(node("div", { className: "ai-actions" }, [button]));
    }

    if (!latest) {
      section.append(node("div", { className: "timeline-item", text: "Nessuna lettura disponibile. Puoi aprire il PDF oppure avviare la lettura automatica." }));
      container.append(section);
      return;
    }

    if (latest.status === "failed") {
      section.append(node("div", { className: "ai-warning", text: "La lettura automatica non è riuscita. Apri il PDF e svolgi la verifica manualmente oppure riprova." }));
      container.append(section);
      return;
    }

    const data = latest.review_status === "validated" && latest.validated_data && Object.keys(latest.validated_data).length
      ? latest.validated_data
      : latest.extracted_data || {};
    const supplies = analysisSupplyRows(data);
    if (!supplies.length) {
      section.append(node("div", { className: "ai-warning", text: "La lettura non contiene dati economici sufficienti. Verifica direttamente il PDF." }));
    } else {
      const grid = node("div", { className: "ai-supply-grid" });
      supplies.forEach(supply => {
        const card = node("article", { className: "ai-card" }, [
          node("div", { className: "ai-card-title" }, [node("strong", { text: supply.label }), makeBadge(latest.status, analysisStatusLabel(latest.status))]),
          node("p", { className: "ai-provider", text: supply.provider }),
          node("div", { className: "ai-values" }, [
            infoCard("Consumo annuo", supply.consumption == null ? "—" : `${formatTechnicalNumber(supply.consumption, 3)} ${supply.consumptionUnit}`),
            infoCard("Prezzo materia", supply.price == null ? "—" : `${formatTechnicalNumber(supply.price, 6)} ${supply.priceUnit}`),
            infoCard("Quota fissa", supply.fixedFee == null ? "—" : `${formatMoney(supply.fixedFee)}/anno`),
            infoCard("Tipo prezzo", supply.priceType || "—"),
            infoCard("Indice", supply.index || "—"),
            infoCard("Formula", supply.formula || "—")
          ])
        ]);
        grid.append(card);
      });
      section.append(grid);
    }

    const technical = node("details", { className: "ai-technical" });
    const technicalSummary = node("summary", {}, [
      node("span", { text: "Dettagli tecnici IA e validazione" }),
      makeBadge(latest.review_status === "validated" ? "completed" : "pending", validationStatusLabel(latest.review_status))
    ]);
    technical.append(technicalSummary);

    const usage = latest.usage_details || {};
    technical.append(node("div", { className: "info-grid ai-meta" }, [
      infoCard("Stato IA", analysisStatusLabel(latest.status)),
      infoCard("Esecuzione", `n. ${latest.run_number || 1} · ${formatDate(latest.completed_at || latest.started_at, true)}`),
      infoCard("Modello", latest.model || "—"),
      infoCard("Durata", latest.duration_ms == null ? "—" : `${(Number(latest.duration_ms) / 1000).toFixed(1).replace(".", ",")} s`),
      infoCard("Token", usage.total_tokens != null ? formatTechnicalNumber(usage.total_tokens, 0) : "—"),
      infoCard("Costo stimato", latest.estimated_cost_eur == null ? "Tariffe non configurate" : formatMoney(latest.estimated_cost_eur))
    ]));

    const warnings = Array.isArray(latest.warnings) ? latest.warnings : [];
    if (warnings.length) {
      technical.append(node("div", { className: "ai-warning" }, [
        node("strong", { text: "Verifiche richieste" }),
        ...warnings.slice(0, 8).map(item => node("p", { text: String(item).replaceAll("_", " ") }))
      ]));
    }
    renderAiValidation(technical, row, latest, data);
    section.append(technical);
    container.append(section);
  }

  function renderWorkflow(container, row) {
    const section = node("section", { className: "section" });
    section.append(node("h3", { text: "Lavorazione" }));

    if (row.check.status === "pending") {
      const claim = node("button", { className: "button primary", type: "button", text: "PRENDI IN CARICO" });
      claim.addEventListener("click", handleClaim);
      section.append(node("div", { className: "form-actions" }, [claim]));
    }

    if (!["completed", "canceled"].includes(row.check.status)) {
      const statusForm = node("form", { attrs: { novalidate: "" } });
      const statusGrid = node("div", { className: "form-grid" });
      const target = node("select", { name: "status" }, [
        option("assigned", "Assegnato", row.check.status === "assigned"),
        option("in_review", "In controllo", row.check.status === "in_review"),
        option("more_info_required", "Richiesta integrazione", row.check.status === "more_info_required"),
        option("canceled", "Annullato", row.check.status === "canceled")
      ]);
      const customerMessage = node("textarea", { name: "customer_message", placeholder: "Messaggio visibile al cliente" });
      customerMessage.value = row.check.customer_message || "";
      appendField(statusGrid, "Nuovo stato", target);
      appendField(statusGrid, "Messaggio al cliente", customerMessage, true);
      statusForm.append(statusGrid, node("div", { className: "form-actions" }, [node("button", { className: "button secondary", type: "submit", text: "AGGIORNA STATO" })]));
      statusForm.addEventListener("submit", event => handleStatusUpdate(event, target, customerMessage));
      section.append(statusForm);

      if (row.check.status !== "pending") {
      const completeForm = node("form", { attrs: { novalidate: "" } });
      const completeGrid = node("div", { className: "form-grid" });
      const outcome = node("select", { name: "outcome" }, [
        option("correct", "Bolletta corretta"),
        option("anomaly", "Anomalia"),
        option("possible_saving", "Possibile risparmio"),
        option("inconclusive", "Esito non conclusivo")
      ]);
      const minutes = node("input", { name: "minutes", type: "number", value: "0", attrs: { min: "0", max: "1440", step: "1" } });
      const summary = node("textarea", { name: "summary", placeholder: "Sintesi tecnica del controllo" });
      const finalMessage = node("textarea", { name: "customer_message", placeholder: "Esito chiaro e completo visibile all’abbonato" });
      appendField(completeGrid, "Esito", outcome);
      appendField(completeGrid, "Minuti di revisione", minutes);
      appendField(completeGrid, "Sintesi tecnica", summary, true);
      appendField(completeGrid, "Messaggio conclusivo al cliente", finalMessage, true);
      completeForm.append(completeGrid, node("p", { className: "danger-note", text: "Per Anomalia o Possibile risparmio deve essere registrato almeno un elemento nella sezione Anomalie." }), node("div", { className: "form-actions" }, [node("button", { className: "button primary", type: "submit", text: "COMPLETA CONTROLLO" })]));
      completeForm.addEventListener("submit", event => handleComplete(event, { outcome, minutes, summary, finalMessage }));
      section.append(completeForm);
      }
    } else {
      section.append(node("div", { className: "timeline-item" }, [
        node("strong", { text: outcomeLabel(row.check.outcome) }),
        node("p", { text: row.check.customer_message || row.check.summary || "Controllo chiuso." }),
        node("small", { text: `Concluso ${formatDate(row.check.completed_at, true)} · Revisione ${Math.round(Number(row.check.human_seconds || 0) / 60)} min` })
      ]));
    }
    container.append(section);
  }

  function renderDetail(row) {
    stopValidationTimer();
    clear(state.detail);
    const body = node("div", { className: "detail-body" });
    const customerName = row.profile?.full_name || "Cliente Premium";
    const customerEmail = row.profile?.email || "Email non disponibile";
    const titleBlock = node("div", {}, [
      node("h2", { text: row.bill?.original_file_name || "Bolletta" }),
      node("p", { text: `${customerName} · ${customerEmail}` })
    ]);
    const openPdf = node("button", { className: "button secondary compact", type: "button", text: "APRI PDF" });
    openPdf.addEventListener("click", handleOpenPdf);
    const detailActions = [openPdf];
    if (isAdmin()) {
      const removeCheck = node("button", { className: "button danger compact", type: "button", text: "ELIMINA SOLO CONTROLLO" });
      removeCheck.addEventListener("click", handleAdminDeleteCheck);
      const removeBill = node("button", { className: "button danger compact", type: "button", text: "ELIMINA BOLLETTA E BLOCCO" });
      removeBill.addEventListener("click", handleAdminDeleteBill);
      detailActions.push(removeCheck, removeBill);
    }
    detailActions.push(makeBadge(row.check.status));
    const actions = node("div", { className: "detail-actions" }, detailActions);
    body.append(node("div", { className: "detail-title" }, [titleBlock, actions]));

    const assigned = !row.check.assigned_staff_id
      ? "Non assegnato"
      : row.check.assigned_staff_id === currentSession?.user?.id
        ? "Assegnato a te"
        : "Altro operatore";
    const address = row.utility?.address && typeof row.utility.address === "object"
      ? [row.utility.address.street, row.utility.address.city, row.utility.address.province].filter(Boolean).join(", ")
      : "";
    body.append(node("div", { className: "info-grid" }, [
      infoCard("Stato", statusLabel(row.check.status)),
      infoCard("Esito", outcomeLabel(row.check.outcome)),
      infoCard("Assegnazione", assigned),
      infoCard("Richiesta", formatDate(row.check.created_at, true)),
      infoCard("Utenza", `${row.utility?.label || "—"} · ${supplyLabel(row.bill?.commodity)}`),
      infoCard("Fornitore", row.utility?.provider_name || "—"),
      infoCard("Indirizzo", address || "—"),
      infoCard("Documento", `${formatSize(row.bill?.file_size)} · ${formatDate(row.bill?.created_at)}`),
      infoCard("Importo", Number.isFinite(Number(row.bill?.total_amount_eur)) ? formatMoney(row.bill.total_amount_eur) : "—"),
      infoCard("Screening IA", automaticScreeningLabel(row.bill?.automatic_screening_status))
    ]));

    renderAutomaticScreening(body, row);
    renderRedVerification(body, row);
    if (row.check.status === "pending") renderWorkflow(body, row);
    renderAiAssistance(body, row);
    renderAnomalies(body, row);
    if (row.check.status !== "pending") renderWorkflow(body, row);
    renderNotes(body);
    const status = node("div", { className: "status-line", attrs: { role: "status" } });
    status.id = "staffDetailStatus";
    body.append(status);
    state.detail.append(body);
  }

  async function loadSelectedDetails(row) {
    const sequence = ++loadSequence;
    const [notesResult, anomaliesResult, analysesResult] = await Promise.all([
      client.from("premium_check_notes")
        .select("id, check_id, staff_user_id, note, created_at")
        .eq("check_id", row.check.id)
        .order("created_at", { ascending: false }),
      client.from("premium_anomalies")
        .select("id, bill_id, check_id, user_id, category, severity, status, title, description, estimated_impact_eur, created_at")
        .eq("check_id", row.check.id)
        .order("created_at", { ascending: false }),
      client.from("premium_analysis_runs")
        .select("id, bill_id, run_number, parser_version, model, status, started_at, completed_at, duration_ms, input_tokens, output_tokens, estimated_cost_eur, extracted_data, warnings, error_code, usage_details, response_ids, origin, requested_by_user_id, automatic_classification, automatic_summary, automatic_reasons, review_status, validated_by_staff_id, validated_at, validation_seconds, validation_note, validation_metrics, validated_data, created_at")
        .eq("bill_id", row.bill.id)
        .neq("origin", "red_verification")
        .order("run_number", { ascending: false })
        .limit(5)
    ]);
    if (sequence !== loadSequence || selectedId !== row.check.id) return;
    if (notesResult.error) throw notesResult.error;
    if (anomaliesResult.error) throw anomaliesResult.error;
    if (analysesResult.error) throw analysesResult.error;
    selectedNotes = notesResult.data || [];
    selectedAnomalies = anomaliesResult.data || [];
    selectedAnalyses = analysesResult.data || [];
    selectedFieldReviews = [];
    const latestRun = selectedAnalyses[0] || null;
    if (latestRun) {
      const { data: reviews, error: reviewsError } = await client.from("premium_analysis_field_reviews")
        .select("id, analysis_run_id, field_key, commodity, ai_value, reviewed_value, decision, note, staff_user_id, created_at, updated_at")
        .eq("analysis_run_id", latestRun.id)
        .order("field_key", { ascending: true });
      if (sequence !== loadSequence || selectedId !== row.check.id) return;
      if (reviewsError) throw reviewsError;
      selectedFieldReviews = reviews || [];
    }
    renderDetail(row);
  }

  async function selectCheck(checkId) {
    selectedId = checkId;
    renderQueue();
    const row = rows.find(item => item.check.id === checkId);
    if (!row) {
      renderEmptyDetail("La richiesta selezionata non è più disponibile.");
      return;
    }
    renderEmptyDetail("Caricamento dettaglio…");
    try {
      await loadSelectedDetails(row);
    } catch (error) {
      renderEmptyDetail(friendlyError(error));
    }
  }

  async function fetchMap(table, columns, ids, key = "id") {
    if (!ids.length) return new Map();
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const { data, error } = await client.from(table).select(columns).in(key, unique);
    if (error) throw error;
    return new Map((data || []).map(item => [item[key], item]));
  }

  async function loadQueue({ keepSelection = true } = {}) {
    const sequence = ++loadSequence;
    setPageMessage("info", "Aggiornamento della coda…");
    const { data: checks, error } = await client.from("premium_checks")
      .select("id, bill_id, user_id, assigned_staff_id, status, outcome, summary, customer_message, started_at, completed_at, human_seconds, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(250);
    if (error) throw error;
    if (sequence !== loadSequence) return;

    const checkRows = checks || [];
    const billMap = await fetchMap(
      "premium_bills",
      "id, user_id, utility_id, commodity, billing_period_start, billing_period_end, issue_date, due_date, total_amount_eur, original_file_name, file_size, storage_bucket, storage_path, processing_status, customer_status, automatic_screening_status, automatic_screening_summary, automatic_screening_reasons, automatic_screened_at, automatic_analysis_run_id, red_verification_state, red_verification_result, red_verification_run_id, red_verified_at, created_at",
      checkRows.map(item => item.bill_id)
    );
    const bills = [...billMap.values()];
    const [utilityMap, profileMap] = await Promise.all([
      fetchMap("premium_utilities", "id, user_id, label, supply_type, provider_name, pod, pdr, address", bills.map(item => item.utility_id)),
      fetchMap("premium_profiles", "id, full_name, email, phone, account_status", checkRows.map(item => item.user_id))
    ]);
    if (sequence !== loadSequence) return;

    rows = checkRows.map(check => {
      const bill = billMap.get(check.bill_id) || null;
      return {
        check,
        bill,
        utility: bill ? utilityMap.get(bill.utility_id) || null : null,
        profile: profileMap.get(check.user_id) || null
      };
    }).filter(row => row.bill);

    if (!keepSelection || !rows.some(row => row.check.id === selectedId)) {
      selectedId = rows[0]?.check.id || null;
    }
    renderMetrics();
    renderQueue();
    setPageMessage("", "");
    if (selectedId) await selectCheck(selectedId);
    else renderEmptyDetail();
    queueLoaded = true;
  }

  async function refreshAfterAction(message) {
    await loadQueue({ keepSelection: true });
    setPageMessage("success", message);
  }

  function selectedRow() {
    return rows.find(row => row.check.id === selectedId) || null;
  }

  async function runAction(action, successMessage) {
    if (busy) return;
    setBusy(true);
    setPageMessage("info", "Operazione in corso…");
    try {
      await action();
      await refreshAfterAction(successMessage);
    } catch (error) {
      setPageMessage("error", friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleAdminDeleteCheck() {
    const row = selectedRow();
    if (!row?.check || !isAdmin() || busy) return;
    if (!(await confirmStaffAction({ title: "Elimina controllo", message: `Eliminare il controllo “${row.check.id}”? La bolletta resta archiviata.`, confirmLabel: "ELIMINA" }))) return;

    await runAction(async () => {
      await deletePremiumRecords("checks", [row.check.id]);
      selectedId = null;
      selectedNotes = [];
      selectedAnomalies = [];
      selectedAnalyses = [];
      selectedFieldReviews = [];
    }, "Controllo eliminato. La bolletta resta disponibile nell’archivio cliente.");
  }

  async function handleAdminDeleteVisibleChecks() {
    if (!isAdmin() || busy) return;
    const visible = filteredRows();
    if (!visible.length) {
      setPageMessage("error", "Nessun controllo visibile da eliminare.");
      return;
    }
    if (!(await confirmStaffAction({ title: "Elimina controlli", message: `Eliminare ${visible.length} controlli visibili? Le bollette resteranno archiviate.`, keyword: "ELIMINA", confirmLabel: "ELIMINA" }))) return;
    await runAction(async () => {
      await deletePremiumRecords("checks", visible.map(row => row.check.id));
      selectedId = null;
      selectedNotes = [];
      selectedAnomalies = [];
      selectedAnalyses = [];
      selectedFieldReviews = [];
    }, `${visible.length} controlli eliminati.`);
  }

  async function handleAdminDeleteBill() {
    const row = selectedRow();
    if (!row?.bill || !isAdmin() || busy) return;
    if (row.bill.processing_status === "analyzing") {
      setPageMessage("error", "Attendi la conclusione dell’analisi IA prima di eliminare la bolletta.");
      return;
    }

    const customer = row.profile?.full_name || row.profile?.email || "cliente";
    if (!(await confirmStaffAction({
      title: "Elimina bolletta",
      message: `Eliminare definitivamente “${row.bill.original_file_name}” di ${customer} e tutti i dati collegati?`,
      keyword: "ELIMINA",
      confirmLabel: "ELIMINA"
    }))) return;

    await runAction(async () => {
      const storageResult = await client.storage.from(BUCKET).remove([row.bill.storage_path]);
      if (storageResult.error) throw storageResult.error;

      await deletePremiumRecords("bills", [row.bill.id]);

      selectedId = null;
      selectedNotes = [];
      selectedAnomalies = [];
      selectedAnalyses = [];
      selectedFieldReviews = [];
    }, "Bolletta eliminata definitivamente dall’archivio Premium.");
  }

  async function handleRunRedVerification() {
    const row = selectedRow();
    if (!row || busy) return;
    if (row.bill?.automatic_screening_status !== "review_recommended") {
      setPageMessage("error", "La seconda verifica IA è disponibile soltanto sulle anomalie rosse.");
      return;
    }
    const currentState = String(row.bill?.red_verification_state || "not_run");
    const currentResult = row.bill?.red_verification_result && typeof row.bill.red_verification_result === "object"
      ? row.bill.red_verification_result
      : {};
    const staleVerification = Boolean(currentResult.version && currentResult.version !== RED_VERIFIER_VERSION);
    if (!["not_run", "failed"].includes(currentState) && !staleVerification) {
      setPageMessage("info", "La seconda verifica IA è già stata eseguita per questa versione dell’analisi.");
      return;
    }
    if (!(await confirmStaffAction({
      title: staleVerification ? "Ricalcola seconda verifica IA" : "Avvia seconda verifica IA",
      message: staleVerification
        ? "Il risultato precedente usa una versione superata del router. L’IA rileggerà il PDF con le regole aggiornate senza duplicare o chiudere la pratica."
        : "L’IA rileggerà il PDF per verificare in modo indipendente i motivi del codice rosso. La pratica esistente non verrà duplicata né chiusa automaticamente.",
      confirmLabel: "AVVIA VERIFICA"
    }))) return;

    await runAction(async () => {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error("premium_auth_required");
      const response = await fetch("/api/premium-ai-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ action: "verify_red", checkId: row.check.id })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.ok) {
        const error = new Error(body?.error || "Seconda verifica IA non riuscita");
        error.code = body?.code || "PREMIUM_RED_VERIFICATION_ERROR";
        throw error;
      }
    }, "Seconda verifica IA completata. Controlla il risultato nella pratica prima di concludere la lavorazione.");
  }

  async function handleRunAiAnalysis() {
    const row = selectedRow();
    if (!row || busy) return;
    const latest = selectedAnalyses[0] || null;
    const prompt = latest
      ? "Ripetere la pre-analisi IA? Verrà conservato lo storico delle esecuzioni e la nuova bozza dovrà essere verificata."
      : "Avviare la pre-analisi IA della bolletta? La bozza resterà riservata allo staff e non produrrà automaticamente alcun esito per il cliente.";
    if (!(await confirmStaffAction({ title: "Avvia analisi", message: prompt, confirmLabel: "CONTINUA" }))) return;

    await runAction(async () => {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error("premium_auth_required");
      const response = await fetch("/api/premium-ai-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ checkId: row.check.id })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.ok) {
        const error = new Error(body?.error || "Pre-analisi IA non riuscita");
        error.code = body?.code || "PREMIUM_AI_ERROR";
        throw error;
      }
    }, "Pre-analisi IA completata. Verifica sempre la bozza sul PDF prima di concludere il controllo.");
  }

  async function handleValidateAiAnalysis(event, latest, controls, overallNote) {
    event.preventDefault();
    if (!AI_VALIDATION || !latest || busy) return;
    const fields = [];
    try {
      controls.forEach(control => {
        const decision = String(control.decision.value || "");
        const reviewedValue = decision === "corrected"
          ? AI_VALIDATION.parseReviewedValue(control.corrected.value, control.definition)
          : null;
        fields.push({
          field_key: control.definition.key,
          decision,
          reviewed_value: reviewedValue,
          note: String(control.note.value || "").trim()
        });
      });
    } catch (error) {
      setPageMessage("error", friendlyError(error));
      return;
    }

    const preview = AI_VALIDATION.calculateMetrics(fields);
    const confirmation = `Salvare la validazione? Campi confermati: ${preview.approved_fields}; corretti: ${preview.corrected_fields}; mancanti: ${preview.missing_fields}.`;
    if (!(await confirmStaffAction({ title: "Salva validazione", message: confirmation, confirmLabel: "SALVA" }))) return;
    const startedAt = validationStartedAtByRun.get(latest.id) || Date.now();
    const reviewSeconds = Math.max(1, Math.min(86400, Math.round((Date.now() - startedAt) / 1000)));

    await runAction(async () => {
      const { error } = await client.rpc("premium_staff_validate_analysis", {
        p_analysis_run_id: latest.id,
        p_fields: fields,
        p_review_seconds: reviewSeconds,
        p_validation_note: String(overallNote.value || "").trim()
      });
      if (error) throw error;
      clearValidationDraft(latest.id);
      validationStartedAtByRun.delete(latest.id);
      stopValidationTimer();
    }, "Validazione IA salvata. I dati restano riservati allo staff e non modificano l’esito del cliente.");
  }

  async function handleClaim() {
    const row = selectedRow();
    if (!row) return;
    await runAction(async () => {
      const { error } = await client.rpc("premium_staff_claim_check", { p_check_id: row.check.id });
      if (error) throw error;
    }, "Controllo assegnato al tuo account.");
  }

  async function handleStatusUpdate(event, target, message) {
    event.preventDefault();
    const row = selectedRow();
    if (!row) return;
    const status = String(target.value || "");
    const customerMessage = String(message.value || "").trim();
    await runAction(async () => {
      const { error } = await client.rpc("premium_staff_set_check_status", {
        p_check_id: row.check.id,
        p_status: status,
        p_customer_message: customerMessage
      });
      if (error) throw error;
    }, "Stato del controllo aggiornato.");
  }

  async function handleAddNote(event, input) {
    event.preventDefault();
    const row = selectedRow();
    const noteText = String(input.value || "").trim();
    if (!row || !noteText) {
      setPageMessage("error", "Inserisci il testo della nota interna.");
      return;
    }
    await runAction(async () => {
      const { error } = await client.rpc("premium_staff_add_check_note", { p_check_id: row.check.id, p_note: noteText });
      if (error) throw error;
    }, "Nota interna registrata.");
  }

  async function handleAddAnomaly(event, controls) {
    event.preventDefault();
    const row = selectedRow();
    if (!row) return;
    const title = String(controls.title.value || "").trim();
    if (!title) {
      setPageMessage("error", "Inserisci il titolo dell’anomalia.");
      return;
    }
    const impactRaw = String(controls.impact.value || "").trim().replace(",", ".");
    const impact = impactRaw === "" ? null : Number(impactRaw);
    if (impactRaw !== "" && !Number.isFinite(impact)) {
      setPageMessage("error", "L’impatto economico non è valido.");
      return;
    }
    await runAction(async () => {
      const { error } = await client.rpc("premium_staff_add_anomaly", {
        p_check_id: row.check.id,
        p_category: controls.category.value,
        p_severity: controls.severity.value,
        p_title: title,
        p_description: String(controls.description.value || "").trim(),
        p_estimated_impact_eur: impact
      });
      if (error) throw error;
    }, "Anomalia registrata.");
  }

  async function handleDeleteAnomaly(anomalyId) {
    if (!(await confirmStaffAction({ title: "Rimuovi anomalia", message: "Rimuovere questa anomalia dal controllo?", confirmLabel: "RIMUOVI" }))) return;
    await runAction(async () => {
      const { error } = await client.rpc("premium_staff_delete_anomaly", { p_anomaly_id: anomalyId });
      if (error) throw error;
    }, "Anomalia rimossa.");
  }

  async function handleComplete(event, controls) {
    event.preventDefault();
    const row = selectedRow();
    if (!row) return;
    const summary = String(controls.summary.value || "").trim();
    const customerMessage = String(controls.finalMessage.value || "").trim();
    const minutes = Math.max(0, Math.round(Number(controls.minutes.value || 0)));
    if (!summary || !customerMessage) {
      setPageMessage("error", "Inserisci la sintesi tecnica e il messaggio conclusivo per il cliente.");
      return;
    }
    if (!(await confirmStaffAction({ title: "Chiudi controllo", message: "L’esito sarà visibile al cliente.", confirmLabel: "CHIUDI" }))) return;
    await runAction(async () => {
      const { error } = await client.rpc("premium_staff_complete_check", {
        p_check_id: row.check.id,
        p_outcome: controls.outcome.value,
        p_summary: summary,
        p_customer_message: customerMessage,
        p_human_seconds: Math.min(86400, minutes * 60)
      });
      if (error) throw error;
    }, "Controllo completato e pubblicato al cliente.");
  }

  async function handleOpenPdf() {
    const row = selectedRow();
    if (!row?.bill?.storage_path || busy) return;
    setBusy(true);
    setPageMessage("info", "Apertura del PDF…");
    try {
      const { data, error } = await client.storage.from(BUCKET).download(row.bill.storage_path);
      if (error) throw error;
      const url = URL.createObjectURL(data);
      const popup = window.open(url, "_blank", "noopener,noreferrer");
      if (!popup) {
        URL.revokeObjectURL(url);
        throw new Error("Il browser ha bloccato l’apertura del PDF. Consenti i popup per questa pagina.");
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setPageMessage("", "");
    } catch (error) {
      setPageMessage("error", friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  function staffContextDescriptor(session, staff) {
    const userId = String(session?.user?.id || "");
    const email = String(session?.user?.email || "").trim().toLowerCase();
    const role = String(staff?.role || "").trim().toLowerCase();
    const active = staff?.active === true ? "1" : "0";
    return `${userId}|${email}|${role}|${active}`;
  }

  function resetOperationalState() {
    rows = [];
    selectedId = null;
    selectedNotes = [];
    selectedAnomalies = [];
    selectedAnalyses = [];
    selectedFieldReviews = [];
    queueLoaded = false;
    stopValidationTimer();
    clear(state.queue);
    renderEmptyDetail();
  }

  async function verifyStaff(session) {
    currentSession = session;

    if (!session?.user) {
      const hadContext = Boolean(currentStaff || staffContextKey);
      currentStaff = null;
      staffContextKey = "";
      if (hadContext) resetOperationalState();
      setView("auth");
      setAuthMessage("", "");
      return;
    }

    if (staffVerificationRequest) return staffVerificationRequest;

    staffVerificationRequest = (async () => {
      const { data, error } = await client.from("premium_staff_members")
        .select("user_id, role, active")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (error || !data?.active || !MANAGER_ROLES.has(data.role)) {
        const deniedKey = `denied|${session.user.id}`;
        const changed = staffContextKey !== deniedKey || currentStaff !== null;
        currentStaff = null;
        staffContextKey = deniedKey;
        if (changed) resetOperationalState();
        setView("denied");
        return;
      }

      const nextKey = staffContextDescriptor(session, data);
      const contextChanged = staffContextKey !== nextKey;
      const dashboardVisible = state.dashboard?.hidden === false;

      currentStaff = data;
      currentSession = session;

      // TOKEN_REFRESHED / SIGNED_IN ripetuti con lo stesso account non devono
      // svuotare e ricostruire coda e dettaglio.
      if (!contextChanged && dashboardVisible && queueLoaded) return;

      if (contextChanged) {
        staffContextKey = nextKey;
        resetOperationalState();
      } else if (!staffContextKey) {
        staffContextKey = nextKey;
      }

      setText(state.staffIdentity, `${roleLabel(data.role)} · ${session.user.email || "account staff"}`);
      if (state.deleteVisibleChecks) state.deleteVisibleChecks.hidden = !isAdmin();

      // Al primo ingresso carichiamo il modulo mentre e' ancora nascosto e lo
      // mostriamo solo quando la coda ha una struttura stabile.
      if (!queueLoaded) {
        try {
          await loadQueue({ keepSelection: false });
        } catch (loadError) {
          setPageMessage("error", friendlyError(loadError));
          clear(state.queue);
          state.queue.append(node("div", { className: "queue-empty", text: "Impossibile caricare la coda controlli." }));
        }
      }

      setView("dashboard");
    })().finally(() => {
      staffVerificationRequest = null;
    });

    return staffVerificationRequest;
  }

  async function handleLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(form.elements.email?.value || "").trim().toLowerCase();
    const password = String(form.elements.password?.value || "");
    if (!email || !password) {
      setAuthMessage("error", "Inserisci email e password.");
      return;
    }
    setBusy(true);
    setAuthMessage("info", "Accesso in corso…");
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthMessage("error", friendlyError(error));
      setBusy(false);
      return;
    }
    form.reset();
    setAuthMessage("", "");
    setBusy(false);
  }

  async function logout() {
    if (!client) return;
    setBusy(true);
    await client.auth.signOut();
    setBusy(false);
  }

  function bindState() {
    state.topActions = byId("staffTopActions");
    state.staffIdentity = byId("staffIdentity");
    state.refresh = byId("staffRefresh");
    state.logout = byId("staffLogout");
    state.authView = byId("staffAuthView");
    state.deniedView = byId("staffDeniedView");
    state.deniedLogout = byId("staffDeniedLogout");
    state.loginForm = byId("staffLoginForm");
    state.authMessage = byId("staffAuthMessage");
    state.dashboard = byId("staffDashboard");
    state.pageMessage = byId("staffPageMessage");
    state.metricPending = byId("metricPending");
    state.metricWorking = byId("metricWorking");
    state.metricInfo = byId("metricInfo");
    state.metricCompletedToday = byId("metricCompletedToday");
    state.queueCount = byId("queueCount");
    state.search = byId("queueSearch");
    state.statusFilter = byId("queueStatus");
    state.assignmentFilter = byId("queueAssignment");
    state.queue = byId("staffQueue");
    state.detail = byId("staffDetail");
    state.deleteVisibleChecks = byId("staffDeleteVisibleChecks");
  }

  async function init() {
    bindState();
    if (!window.supabase?.createClient) {
      setView("auth");
      setAuthMessage("error", "Il collegamento al servizio di autenticazione non è disponibile.");
      return;
    }

    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        storageKey: STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });

    state.loginForm.addEventListener("submit", handleLogin);
    state.logout.addEventListener("click", logout);
    state.deniedLogout.addEventListener("click", logout);
    state.refresh.addEventListener("click", () => loadQueue({ keepSelection: true }).catch(error => setPageMessage("error", friendlyError(error))));
    state.deleteVisibleChecks?.addEventListener("click", handleAdminDeleteVisibleChecks);
    [state.search, state.statusFilter, state.assignmentFilter].forEach(control => control.addEventListener("input", renderQueue));

    client.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => verifyStaff(session).catch(error => {
        setView("auth");
        setAuthMessage("error", friendlyError(error));
      }), 0);
    });

    const { data, error } = await client.auth.getSession();
    if (error) {
      setView("auth");
      setAuthMessage("error", friendlyError(error));
      return;
    }
    await verifyStaff(data.session);
  }

  document.addEventListener("DOMContentLoaded", () => {
    init().catch(error => {
      setView("auth");
      setAuthMessage("error", friendlyError(error));
    });
  });
})();
