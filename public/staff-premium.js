(() => {
  "use strict";

  const SUPABASE_URL = "https://kzxdamhfmzaxonpkytcf.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_poz1xBKiXceLCFV3u_tPIg_5_-ycHcl";
  const STORAGE_KEY = "offertalogica-premium-staff-auth";
  const BUCKET = "premium-bills";
  const MANAGER_ROLES = new Set(["reviewer", "admin"]);

  let client = null;
  let currentSession = null;
  let currentStaff = null;
  let rows = [];
  let selectedId = null;
  let selectedNotes = [];
  let selectedAnomalies = [];
  let selectedAnalyses = [];
  let busy = false;
  let loadSequence = 0;

  const byId = id => document.getElementById(id);
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
    return value === "admin" ? "Amministratore" : value === "reviewer" ? "Revisore" : "Staff";
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
    if (message.includes("premium_check_must_be_claimed")) return "Prendi prima in carico il controllo.";
    if (message.includes("premium_check_not_found")) return "Il controllo non è più disponibile.";
    if (message.includes("premium_ai_already_running") || message.includes("premium_analysis_already_running")) return "È già in corso una pre-analisi IA per questa bolletta.";
    if (message.includes("premium_ai_not_configured")) return "La pre-analisi IA non è configurata sul server.";
    if (message.includes("premium_ai_timeout")) return "La pre-analisi IA ha richiesto troppo tempo. La revisione manuale resta disponibile.";
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

  function renderAiAssistance(container, row) {
    const section = node("section", { className: "section ai-section" });
    const heading = node("div", { className: "ai-heading" }, [
      node("div", {}, [
        node("h3", { text: "Pre-analisi IA assistita" }),
        node("p", { className: "ai-note", text: "Bozza tecnica riservata allo staff. Non modifica l’esito e non è visibile al cliente." })
      ])
    ]);
    section.append(heading);

    const latest = selectedAnalyses[0] || null;
    const analysisRunning = latest && ["queued", "running"].includes(latest.status);
    if (!["completed", "canceled"].includes(row.check.status)) {
      const button = node("button", {
        className: "button primary compact",
        type: "button",
        text: analysisRunning ? "ANALISI IA IN CORSO" : latest ? "RIPETI PRE-ANALISI IA" : "AVVIA PRE-ANALISI IA"
      });
      button.disabled = busy || analysisRunning;
      button.addEventListener("click", handleRunAiAnalysis);
      heading.append(node("div", { className: "ai-actions" }, [button]));
    }

    if (!latest) {
      section.append(node("div", { className: "timeline-item", text: "Nessuna pre-analisi IA eseguita. Il controllo può comunque essere svolto interamente a mano." }));
      container.append(section);
      return;
    }

    const usage = latest.usage_details || {};
    const meta = node("div", { className: "info-grid ai-meta" }, [
      infoCard("Stato IA", analysisStatusLabel(latest.status)),
      infoCard("Esecuzione", `n. ${latest.run_number || 1} · ${formatDate(latest.completed_at || latest.started_at, true)}`),
      infoCard("Modello", latest.model || "—"),
      infoCard("Durata", latest.duration_ms == null ? "—" : `${(Number(latest.duration_ms) / 1000).toFixed(1).replace(".", ",")} s`),
      infoCard("Token", usage.total_tokens != null ? formatTechnicalNumber(usage.total_tokens, 0) : "—"),
      infoCard("Costo stimato", latest.estimated_cost_eur == null ? "Tariffe non configurate" : formatMoney(latest.estimated_cost_eur))
    ]);
    section.append(meta);

    if (latest.status === "failed") {
      section.append(node("div", { className: "ai-warning", text: "La pre-analisi non è riuscita. La revisione manuale resta pienamente disponibile." }));
      container.append(section);
      return;
    }

    const data = latest.extracted_data || {};
    const supplies = analysisSupplyRows(data);
    if (!supplies.length) {
      section.append(node("div", { className: "ai-warning", text: "La bozza non contiene dati economici sufficienti. Verifica direttamente il PDF." }));
    } else {
      const grid = node("div", { className: "ai-supply-grid" });
      supplies.forEach(supply => {
        const card = node("article", { className: "ai-card" }, [
          node("div", { className: "ai-card-title" }, [node("strong", { text: supply.label }), makeBadge(latest.status, analysisStatusLabel(latest.status))]),
          node("p", { className: "ai-provider", text: supply.provider }),
          node("div", { className: "ai-values" }, [
            infoCard("Consumo annuo", supply.consumption == null ? "—" : `${formatTechnicalNumber(supply.consumption, 3)} ${supply.consumptionUnit}`),
            infoCard("Prezzo materia", supply.price == null ? "—" : `${formatTechnicalNumber(supply.price, 6)} ${supply.priceUnit}`),
            infoCard("Quota fissa vendita", supply.fixedFee == null ? "—" : `${formatMoney(supply.fixedFee)}/anno`),
            infoCard("Tipo prezzo", supply.priceType || "—"),
            infoCard("Indice", supply.index || "—"),
            infoCard("Formula", supply.formula || "—")
          ])
        ]);
        if (supply.evidence.length) {
          card.append(node("details", { className: "ai-evidence" }, [
            node("summary", { text: "Mostra evidenze individuate" }),
            ...supply.evidence.map(text => node("p", { text }))
          ]));
        }
        grid.append(card);
      });
      section.append(grid);
    }

    const warnings = Array.isArray(latest.warnings) ? latest.warnings : [];
    if (warnings.length) {
      section.append(node("div", { className: "ai-warning" }, [
        node("strong", { text: "Verifiche richieste" }),
        ...warnings.slice(0, 8).map(item => node("p", { text: String(item).replaceAll("_", " ") }))
      ]));
    }
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
    const actions = node("div", { className: "detail-actions" }, [openPdf, makeBadge(row.check.status)]);
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
      infoCard("Documento", `${formatSize(row.bill?.file_size)} · ${formatDate(row.bill?.created_at)}`)
    ]));

    renderAiAssistance(body, row);
    renderWorkflow(body, row);
    renderNotes(body);
    renderAnomalies(body, row);
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
        .select("id, bill_id, run_number, parser_version, model, status, started_at, completed_at, duration_ms, input_tokens, output_tokens, estimated_cost_eur, extracted_data, warnings, error_code, usage_details, response_ids, created_at")
        .eq("bill_id", row.bill.id)
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
      "id, user_id, utility_id, commodity, original_file_name, file_size, storage_bucket, storage_path, processing_status, customer_status, created_at",
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

  async function handleRunAiAnalysis() {
    const row = selectedRow();
    if (!row || busy) return;
    const latest = selectedAnalyses[0] || null;
    const prompt = latest
      ? "Ripetere la pre-analisi IA? Verrà conservato lo storico delle esecuzioni e la nuova bozza dovrà essere verificata."
      : "Avviare la pre-analisi IA della bolletta? La bozza resterà riservata allo staff e non produrrà automaticamente alcun esito per il cliente.";
    if (!window.confirm(prompt)) return;

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
    if (!window.confirm("Rimuovere questa anomalia dal controllo?")) return;
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
    if (!window.confirm("Confermi la chiusura del controllo? L’esito sarà visibile al cliente.")) return;
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

  async function verifyStaff(session) {
    currentSession = session;
    currentStaff = null;
    rows = [];
    selectedId = null;
    selectedAnalyses = [];
    clear(state.queue);
    renderEmptyDetail();

    if (!session?.user) {
      setView("auth");
      setAuthMessage("", "");
      return;
    }

    const { data, error } = await client.from("premium_staff_members")
      .select("user_id, role, active")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (error || !data?.active || !MANAGER_ROLES.has(data.role)) {
      setView("denied");
      return;
    }

    currentStaff = data;
    setText(state.staffIdentity, `${roleLabel(data.role)} · ${session.user.email || "account staff"}`);
    setView("dashboard");
    try {
      await loadQueue({ keepSelection: false });
    } catch (loadError) {
      setPageMessage("error", friendlyError(loadError));
      clear(state.queue);
      state.queue.append(node("div", { className: "queue-empty", text: "Impossibile caricare la coda controlli." }));
    }
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
