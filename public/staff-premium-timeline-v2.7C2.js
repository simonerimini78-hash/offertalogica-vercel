(() => {
  "use strict";

  const SUPABASE_URL = "https://kzxdamhfmzaxonpkytcf.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_poz1xBKiXceLCFV3u_tPIg_5_-ycHcl";
  const STORAGE_KEY = "offertalogica-premium-staff-auth";
  const TIMELINE_RPC = "premium_staff_list_check_timeline";
  const TIMELINE_LIMIT = 250;

  let client = null;
  let observer = null;
  let scheduled = false;
  let requestSequence = 0;

  const EVENT_LABELS = Object.freeze({
    check_created: "Pratica creata",
    check_claimed: "Pratica presa in carico",
    check_unassigned: "Assegnazione rimossa",
    check_reassigned: "Pratica riassegnata",
    check_assigned: "Pratica assegnata",
    check_in_review: "Controllo avviato",
    check_more_info_required: "Richiesta integrazione",
    check_completed: "Controllo completato",
    check_canceled: "Pratica annullata",
    check_status_changed: "Stato pratica aggiornato",
    customer_message_updated: "Messaggio al cliente aggiornato",
    note_added: "Nota interna aggiunta",
    anomaly_added: "Anomalia registrata",
    anomaly_removed: "Anomalia rimossa",
    analysis_validated: "Validazione IA completata",
    analysis_revalidated: "Validazione IA aggiornata",
    communication_sent: "Comunicazione inviata al cliente",
    communication_received: "Comunicazione ricevuta dal cliente",
    system_message_sent: "Comunicazione automatica inviata"
  });

  const ROLE_LABELS = Object.freeze({
    owner: "Proprietario",
    admin: "Amministratore",
    technician: "Tecnico",
    reviewer: "Revisore",
    support: "Supporto",
    customer: "Cliente",
    system: "Sistema"
  });

  const STATUS_LABELS = Object.freeze({
    pending: "Da verificare",
    assigned: "Assegnato",
    in_review: "In controllo",
    more_info_required: "Integrazione",
    completed: "Completato",
    canceled: "Annullato"
  });

  const OUTCOME_LABELS = Object.freeze({
    pending: "Non definito",
    correct: "Bolletta corretta",
    anomaly: "Anomalia",
    possible_saving: "Possibile risparmio",
    inconclusive: "Esito non conclusivo"
  });

  const CATEGORY_LABELS = Object.freeze({
    price: "Prezzo",
    fixed_fee: "Quota fissa",
    discount: "Sconto",
    consumption: "Consumi",
    tax: "Imposte",
    adjustment: "Conguaglio",
    contract: "Contratto",
    duplicate: "Duplicazione",
    other: "Altro"
  });

  const SEVERITY_LABELS = Object.freeze({
    low: "Bassa",
    medium: "Media",
    high: "Alta",
    critical: "Critica"
  });

  const FIELD_LABELS = Object.freeze({
    commodity: "Tipologia utenza",
    fornitore_luce: "Fornitore luce",
    consumo_luce_kwh: "Consumo luce",
    prezzo_luce_eur_kwh: "Prezzo luce",
    quota_fissa_vendita_luce_eur_anno: "Quota fissa luce",
    tipo_prezzo_luce: "Tipo prezzo luce",
    indice_riferimento_luce: "Indice luce",
    formula_prezzo_luce: "Formula luce",
    fornitore_gas: "Fornitore gas",
    consumo_gas_smc: "Consumo gas",
    prezzo_gas_eur_smc: "Prezzo gas",
    quota_fissa_vendita_gas_eur_anno: "Quota fissa gas",
    tipo_prezzo_gas: "Tipo prezzo gas",
    indice_riferimento_gas: "Indice gas",
    formula_prezzo_gas: "Formula gas"
  });

  function element(tag, className = "", text = null) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text != null) item.textContent = String(text);
    return item;
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(date);
  }

  function formatMoney(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "";
    return new Intl.NumberFormat("it-IT", {
      style: "currency",
      currency: "EUR"
    }).format(amount);
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds || 0)));
    if (!total) return "";
    if (total < 60) return `${total} s`;
    const minutes = Math.floor(total / 60);
    const remainder = total % 60;
    if (minutes < 60) return remainder ? `${minutes} min ${remainder} s` : `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const minuteRemainder = minutes % 60;
    return minuteRemainder ? `${hours} h ${minuteRemainder} min` : `${hours} h`;
  }

  function activeCheckId() {
    return document.querySelector("#staffQueue .queue-item.active")?.dataset?.checkId || "";
  }

  function currentDetailBody() {
    return document.querySelector("#staffDetail .detail-body");
  }

  function actorText(event) {
    const role = String(event.actor_role || "system").trim().toLowerCase();
    const roleLabel = ROLE_LABELS[role] || "Staff";
    const label = String(event.actor_label || "").trim();
    const email = String(event.actor_email || "").trim();

    if (role === "system") return "Sistema automatico";
    if (role === "customer") return "Cliente";

    const identity = label || email || "Operatore Staff";
    return `${identity} · ${roleLabel}`;
  }

  function eventTitle(event) {
    const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
    let title = EVENT_LABELS[event.event_type] || "Evento pratica";

    if (event.event_type === "check_completed" && metadata.outcome) {
      title += ` · ${OUTCOME_LABELS[metadata.outcome] || metadata.outcome}`;
    }
    if (event.event_type === "anomaly_added" && metadata.title) {
      title += ` · ${metadata.title}`;
    }
    if (
      ["analysis_validated", "analysis_revalidated"].includes(event.event_type)
      && Number(metadata.corrected_fields || 0) > 0
    ) {
      const count = Number(metadata.corrected_fields);
      title += ` · ${count} ${count === 1 ? "correzione" : "correzioni"}`;
    }
    return title;
  }

  function eventDetail(event) {
    const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
    const parts = [];

    switch (event.event_type) {
      case "check_created":
        if (metadata.status) parts.push(`Stato iniziale: ${STATUS_LABELS[metadata.status] || metadata.status}`);
        if (metadata.screening_status) {
          parts.push(`Screening IA: ${String(metadata.screening_status).replaceAll("_", " ")}`);
        }
        if (Number(metadata.screening_reason_count || 0) > 0) {
          const count = Number(metadata.screening_reason_count);
          parts.push(`${count} ${count === 1 ? "motivo automatico" : "motivi automatici"}`);
        }
        break;

      case "check_claimed":
      case "check_reassigned":
      case "check_unassigned":
      case "check_assigned":
        if (metadata.previous_assigned_staff_id && metadata.assigned_staff_id) {
          parts.push("Assegnazione aggiornata");
        }
        break;

      case "check_in_review":
      case "check_more_info_required":
      case "check_canceled":
      case "check_status_changed":
        if (metadata.from_status || metadata.to_status) {
          const from = STATUS_LABELS[metadata.from_status] || metadata.from_status || "—";
          const to = STATUS_LABELS[metadata.to_status] || metadata.to_status || "—";
          parts.push(`${from} → ${to}`);
        }
        if (metadata.has_customer_message === true) parts.push("Messaggio cliente presente");
        break;

      case "check_completed": {
        const duration = formatDuration(metadata.human_seconds);
        if (duration) parts.push(`Tempo umano registrato: ${duration}`);
        break;
      }

      case "customer_message_updated":
        if (metadata.status) parts.push(`Stato: ${STATUS_LABELS[metadata.status] || metadata.status}`);
        break;

      case "note_added":
        parts.push("Contenuto riservato alle note interne");
        if (Number(metadata.note_length || 0) > 0) parts.push(`${metadata.note_length} caratteri`);
        break;

      case "anomaly_added":
      case "anomaly_removed":
        if (metadata.category) parts.push(`Categoria: ${CATEGORY_LABELS[metadata.category] || metadata.category}`);
        if (metadata.severity) parts.push(`Gravità: ${SEVERITY_LABELS[metadata.severity] || metadata.severity}`);
        if (metadata.estimated_impact_eur != null) {
          const impact = formatMoney(metadata.estimated_impact_eur);
          if (impact) parts.push(`Impatto stimato: ${impact}`);
        }
        break;

      case "analysis_validated":
      case "analysis_revalidated": {
        const approved = Number(metadata.approved_fields || 0);
        const corrected = Number(metadata.corrected_fields || 0);
        const missing = Number(metadata.missing_fields || 0);
        parts.push(`Confermati ${approved} · Corretti ${corrected} · Mancanti ${missing}`);

        const correctedKeys = Array.isArray(metadata.corrected_field_keys)
          ? metadata.corrected_field_keys.map(key => FIELD_LABELS[key] || key).filter(Boolean)
          : [];
        if (correctedKeys.length) parts.push(`Campi corretti: ${correctedKeys.join(", ")}`);

        const validationDuration = formatDuration(metadata.validation_seconds);
        if (validationDuration) parts.push(`Validazione: ${validationDuration}`);
        break;
      }

      case "communication_sent":
      case "communication_received":
      case "system_message_sent":
        if (metadata.channel) parts.push(`Canale: ${metadata.channel}`);
        break;

      default:
        if (metadata.from_status || metadata.to_status) {
          const from = STATUS_LABELS[metadata.from_status] || metadata.from_status || "—";
          const to = STATUS_LABELS[metadata.to_status] || metadata.to_status || "—";
          parts.push(`${from} → ${to}`);
        }
    }

    return parts.join(" · ");
  }

  function eventTone(eventType) {
    if (["check_completed", "analysis_validated"].includes(eventType)) return "success";
    if (["anomaly_added", "check_canceled"].includes(eventType)) return "danger";
    if (["check_more_info_required", "communication_received"].includes(eventType)) return "warning";
    if (["check_claimed", "check_in_review", "analysis_revalidated", "check_reassigned"].includes(eventType)) return "active";
    return "neutral";
  }

  function makeTimelineSection(checkId) {
    const section = element("section", "section real-timeline-section");
    section.dataset.checkTimelineFor = checkId;

    const heading = element("div", "real-timeline-heading");
    const headingText = element("div");
    headingText.append(
      element("h3", "", "Cronologia pratica"),
      element("p", "real-timeline-copy", "Eventi registrati automaticamente dal sistema e dalle operazioni Staff.")
    );
    const badge = element("span", "real-timeline-count", "Caricamento…");
    heading.append(headingText, badge);
    section.append(heading);

    const list = element("div", "real-timeline-list");
    list.setAttribute("aria-live", "polite");
    list.append(element("div", "real-timeline-empty", "Caricamento cronologia…"));
    section.append(list);

    return section;
  }

  function insertSection(section, body) {
    const firstInfoGrid = body.querySelector(":scope > .info-grid");
    if (firstInfoGrid) firstInfoGrid.insertAdjacentElement("afterend", section);
    else {
      const title = body.querySelector(":scope > .detail-title");
      if (title) title.insertAdjacentElement("afterend", section);
      else body.prepend(section);
    }
  }

  function renderEvents(section, events) {
    const list = section.querySelector(".real-timeline-list");
    const badge = section.querySelector(".real-timeline-count");
    if (!list || !badge) return;

    list.replaceChildren();
    const safeEvents = Array.isArray(events) ? events : [];
    badge.textContent = `${safeEvents.length} ${safeEvents.length === 1 ? "evento" : "eventi"}`;

    if (!safeEvents.length) {
      list.append(element(
        "div",
        "real-timeline-empty",
        "Nessun evento storico disponibile. Per le pratiche già esistenti la cronologia parte dalle operazioni successive all’attivazione di V2.7C1."
      ));
      return;
    }

    safeEvents.forEach((event, index) => {
      const item = element("article", `real-timeline-event tone-${eventTone(event.event_type)}`);
      const dateColumn = element("div", "real-timeline-date", formatDateTime(event.event_created_at));
      const rail = element("div", "real-timeline-rail");
      rail.append(element("span", "real-timeline-dot"));
      if (index < safeEvents.length - 1) rail.append(element("span", "real-timeline-line"));

      const content = element("div", "real-timeline-content");
      content.append(element("strong", "real-timeline-title", eventTitle(event)));

      const detail = eventDetail(event);
      if (detail) content.append(element("p", "real-timeline-detail", detail));

      content.append(element("small", "real-timeline-actor", actorText(event)));
      item.append(dateColumn, rail, content);
      list.append(item);
    });
  }

  function renderError(section, error) {
    const list = section.querySelector(".real-timeline-list");
    const badge = section.querySelector(".real-timeline-count");
    if (badge) badge.textContent = "Non disponibile";
    if (!list) return;

    list.replaceChildren();
    const raw = String(error?.message || error || "").toLowerCase();
    const message = raw.includes("premium_staff_access_required") || raw.includes("permission")
      ? "Cronologia non disponibile per questo ruolo."
      : "Impossibile caricare la cronologia della pratica.";
    list.append(element("div", "real-timeline-empty error", message));
  }

  async function loadTimeline(checkId, section, sequence) {
    try {
      const { data: sessionResult, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionResult?.session?.user) return;

      const { data, error } = await client.rpc(TIMELINE_RPC, {
        p_check_id: checkId,
        p_limit: TIMELINE_LIMIT
      });
      if (error) throw error;

      if (sequence !== requestSequence) return;
      if (activeCheckId() !== checkId) return;
      if (!section.isConnected) return;

      renderEvents(section, data || []);
    } catch (error) {
      if (sequence !== requestSequence || !section.isConnected) return;
      renderError(section, error);
    }
  }

  function ensureTimeline() {
    scheduled = false;
    const checkId = activeCheckId();
    const body = currentDetailBody();

    if (!checkId || !body) return;

    const escapedCheckId = window.CSS?.escape ? CSS.escape(checkId) : checkId.replace(/["\\]/g, "\\$&");
    const existing = body.querySelector(
      `:scope > .real-timeline-section[data-check-timeline-for="${escapedCheckId}"]`
    );
    if (existing) return;

    body.querySelectorAll(":scope > .real-timeline-section").forEach(item => item.remove());

    const section = makeTimelineSection(checkId);
    insertSection(section, body);

    const sequence = ++requestSequence;
    loadTimeline(checkId, section, sequence);
  }

  function scheduleTimeline() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(ensureTimeline);
  }

  function injectStyles() {
    if (document.getElementById("staffTimelineV27C2Styles")) return;

    const style = document.createElement("style");
    style.id = "staffTimelineV27C2Styles";
    style.textContent = `
      .real-timeline-section{border-top-color:#b7dcd1}
      .real-timeline-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:12px}
      .real-timeline-heading h3{margin:0 0 4px}
      .real-timeline-copy{margin:0;color:var(--muted);font-size:12px;line-height:1.45}
      .real-timeline-count{flex:0 0 auto;display:inline-flex;align-items:center;border:1px solid #cfe1db;border-radius:999px;padding:5px 9px;color:var(--green-dark);background:#f3fbf8;font-size:11px;font-weight:850}
      .real-timeline-list{display:grid}
      .real-timeline-event{display:grid;grid-template-columns:118px 22px minmax(0,1fr);gap:8px;min-height:64px}
      .real-timeline-date{padding-top:2px;color:var(--muted);font-size:11px;line-height:1.35;text-align:right}
      .real-timeline-rail{position:relative;display:flex;justify-content:center}
      .real-timeline-dot{position:relative;z-index:2;width:11px;height:11px;margin-top:3px;border:3px solid #d5e6e0;border-radius:50%;background:#fff}
      .real-timeline-line{position:absolute;top:14px;bottom:-3px;width:2px;background:#dfe9e5}
      .real-timeline-content{margin:0 0 12px;border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:#fbfdfc;min-width:0}
      .real-timeline-title{display:block;font-size:13px;overflow-wrap:anywhere}
      .real-timeline-detail{margin:5px 0 0;color:#52625c;font-size:12px;line-height:1.45;overflow-wrap:anywhere}
      .real-timeline-actor{display:block;margin-top:6px;color:var(--muted);font-size:11px;overflow-wrap:anywhere}
      .real-timeline-event.tone-active .real-timeline-dot{border-color:#b2d4ef;background:#eff8ff}
      .real-timeline-event.tone-success .real-timeline-dot{border-color:#9fd6b8;background:#ecfdf3}
      .real-timeline-event.tone-warning .real-timeline-dot{border-color:#fedf89;background:#fffaeb}
      .real-timeline-event.tone-danger .real-timeline-dot{border-color:#fecdca;background:#fef3f2}
      .real-timeline-empty{border:1px dashed #cad8d3;border-radius:12px;padding:12px;color:var(--muted);background:#fbfdfc;font-size:12px;line-height:1.45}
      .real-timeline-empty.error{color:var(--danger);border-color:#fecdca;background:#fef3f2}
      @media(max-width:680px){
        .real-timeline-heading{flex-direction:column}
        .real-timeline-event{grid-template-columns:18px minmax(0,1fr);gap:7px}
        .real-timeline-date{grid-column:2;text-align:left;padding:0 0 4px}
        .real-timeline-rail{grid-column:1;grid-row:1/3}
        .real-timeline-content{grid-column:2;margin-bottom:12px}
      }
    `;
    document.head.append(style);
  }

  function init() {
    if (!window.supabase?.createClient) return;

    injectStyles();
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        storageKey: STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });

    const detail = document.getElementById("staffDetail");
    const queue = document.getElementById("staffQueue");
    if (!detail || !queue) return;

    observer = new MutationObserver(scheduleTimeline);
    observer.observe(detail, { childList: true, subtree: true });
    observer.observe(queue, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "aria-pressed"]
    });

    document.getElementById("staffRefresh")?.addEventListener("click", () => {
      ++requestSequence;
      window.setTimeout(scheduleTimeline, 0);
    });

    scheduleTimeline();

    window.addEventListener("pagehide", () => {
      observer?.disconnect();
      observer = null;
      ++requestSequence;
    }, { once: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
