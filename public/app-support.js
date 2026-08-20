(() => {
  "use strict";

  const CATEGORIES = Object.freeze({
    account: "Account e accesso",
    payment: "Abbonamento e pagamento",
    utilities: "Utenze",
    bills: "Bollette e analisi",
    installation: "Installazione e aggiornamento app",
    other: "Altro",
  });
  const MIN_ESCALATION_LENGTH = 20;
  const MIN_REPLY_LENGTH = 2;
  const SUBMIT_COOLDOWN_MS = 2500;

  let initialized = false;
  let currentCategory = "";
  let currentPath = [];
  let currentCase = null;
  let currentCaseMessages = [];
  let lastSubmitAt = 0;

  const byId = id => document.getElementById(id);

  function client() {
    return globalThis.OffertaLogicaPremiumAuth?.getClient?.() || null;
  }

  function escapeSelector(value) {
    if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value));
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function injectStyles() {
    if (byId("premiumSupportTrafficStyles")) return;
    const style = document.createElement("style");
    style.id = "premiumSupportTrafficStyles";
    style.textContent = `
      .support-assistant-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
      .support-assistant-head strong{font-size:16px}.support-assistant-head small{display:block;margin-top:3px;color:var(--muted);font-size:11px;line-height:1.35}
      .support-traffic{flex:0 0 auto;padding:6px 9px;border-radius:999px;font-size:10px;font-weight:950;letter-spacing:.03em;background:#eef4f8;color:#31576e}
      .support-traffic.green{background:#e9f8ed;color:#087c39}.support-traffic.yellow{background:#fff8e5;color:#7a5712}.support-traffic.red{background:#fff0f0;color:#9a2525}
      .support-chat{display:grid;gap:9px;margin-top:14px;max-height:420px;overflow:auto;padding:2px}
      .support-bubble{max-width:92%;padding:11px 12px;border-radius:15px;font-size:12px;line-height:1.47;white-space:pre-wrap;overflow-wrap:anywhere}
      .support-bubble.bot{justify-self:start;background:#eef7f1;color:#315a43;border-bottom-left-radius:5px}
      .support-bubble.user{justify-self:end;background:#173b2b;color:#fff;border-bottom-right-radius:5px}
      .support-bubble.staff{justify-self:start;background:#eef4f8;color:#173b2b;border:1px solid #d7e5ec;border-bottom-left-radius:5px}
      .support-bubble small{display:block;margin-top:5px;opacity:.72;font-size:9px}
      .support-options{display:grid;gap:8px;margin-top:12px}.support-option{min-height:44px;width:100%;padding:10px 12px;border:1px solid #c8ddd0;border-radius:13px;background:#f8fcf9;color:var(--green-dark);text-align:left;font-size:11px;font-weight:900}
      .support-option.secondary{background:#fff;color:#315a43}.support-option.danger{border-color:#efc1c1;background:#fff7f7;color:#9a2525}.support-option[disabled]{opacity:.55;cursor:not-allowed}
      .support-escalation{display:grid;gap:9px;margin-top:12px;padding:12px;border:1px solid #efc1c1;border-radius:14px;background:#fffafa}.support-escalation[hidden]{display:none}.support-escalation label{display:grid;gap:6px;color:#7b3333;font-size:10px;font-weight:900;text-transform:uppercase}.support-escalation textarea{width:100%;min-height:96px;padding:10px 11px;border:1px solid #e1bcbc;border-radius:12px;background:#fff;color:var(--navy);font:inherit;resize:vertical}
      .support-reply{display:grid;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid #e3ebe6}.support-reply[hidden]{display:none}.support-reply textarea{width:100%;min-height:76px;padding:10px 11px;border:1px solid #c8ddd0;border-radius:12px;background:#fff;color:var(--navy);font:inherit;resize:vertical}
      .support-status{margin-top:10px;padding:10px 11px;border-radius:12px;background:#eef4f8;color:#31576e;font-size:11px;line-height:1.45}.support-status[hidden]{display:none}.support-status.error{background:#fff0f0;color:#9a2525}.support-status.success{background:#e9f8ed;color:#087c39}
      .support-footer-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.support-footer-actions button{flex:1 1 130px;min-height:42px;border:1px solid #c8ddd0;border-radius:13px;background:#fff;color:#315a43;font-size:11px;font-weight:900}
    `;
    document.head.append(style);
  }

  function make(tag, className = "", text = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function buildPanel() {
    const panel = byId("premiumSupportPanel");
    if (!panel) return;
    panel.setAttribute("aria-label", "Assistente OffertaLogica");
    panel.replaceChildren();

    const head = make("div", "support-assistant-head");
    const copy = make("div");
    copy.append(make("strong", "", "Assistente OffertaLogica"), make("small", "", "Prima prova a risolvere automaticamente. Lo staff interviene solo per problemi importanti o non risolvibili."));
    const badge = make("span", "support-traffic", "AUTOMATICO");
    badge.id = "premiumSupportTraffic";
    head.append(copy, badge);

    const chat = make("div", "support-chat");
    chat.id = "premiumSupportChat";
    chat.setAttribute("aria-live", "polite");

    const options = make("div", "support-options");
    options.id = "premiumSupportOptions";

    const escalation = make("form", "support-escalation");
    escalation.id = "premiumSupportEscalationForm";
    escalation.hidden = true;
    const escalationLabel = make("label", "", "Descrivi solo il problema che resta irrisolto");
    const escalationText = document.createElement("textarea");
    escalationText.name = "message";
    escalationText.maxLength = 1500;
    escalationText.minLength = MIN_ESCALATION_LENGTH;
    escalationText.placeholder = "Indica cosa hai già provato e cosa continua a non funzionare.";
    escalationText.required = true;
    escalationLabel.append(escalationText);
    const escalationSubmit = make("button", "support-option danger", "INVIA ALLO STAFF");
    escalationSubmit.type = "submit";
    escalation.append(escalationLabel, escalationSubmit);

    const reply = make("form", "support-reply");
    reply.id = "premiumSupportReplyForm";
    reply.hidden = true;
    const replyText = document.createElement("textarea");
    replyText.name = "message";
    replyText.maxLength = 1500;
    replyText.minLength = MIN_REPLY_LENGTH;
    replyText.placeholder = "Rispondi allo staff…";
    replyText.required = true;
    const replySubmit = make("button", "support-option", "INVIA RISPOSTA");
    replySubmit.type = "submit";
    reply.append(replyText, replySubmit);

    const status = make("div", "support-status");
    status.id = "premiumSupportStatus";
    status.hidden = true;

    const footer = make("div", "support-footer-actions");
    const restart = make("button", "", "RICOMINCIA");
    restart.type = "button";
    restart.id = "premiumSupportRestart";
    const close = make("button", "", "CHIUDI");
    close.type = "button";
    close.id = "premiumSupportClose";
    footer.append(restart, close);

    panel.append(head, chat, options, escalation, reply, status, footer);
  }

  function setTraffic(level = "", label = "AUTOMATICO") {
    const badge = byId("premiumSupportTraffic");
    if (!badge) return;
    badge.className = `support-traffic${level ? ` ${level}` : ""}`;
    badge.textContent = label;
  }

  function setStatus(kind, message) {
    const target = byId("premiumSupportStatus");
    if (!target) return;
    target.className = `support-status${kind ? ` ${kind}` : ""}`;
    target.textContent = message || "";
    target.hidden = !message;
  }

  function clearOptions() {
    byId("premiumSupportOptions")?.replaceChildren();
  }

  function addBubble(kind, message, meta = "") {
    const chat = byId("premiumSupportChat");
    if (!chat) return;
    const bubble = make("div", `support-bubble ${kind}`, message);
    if (meta) bubble.append(make("small", "", meta));
    chat.append(bubble);
    chat.scrollTop = chat.scrollHeight;
  }

  function addOption(label, handler, { danger = false, secondary = false } = {}) {
    const options = byId("premiumSupportOptions");
    if (!options) return null;
    const button = make("button", `support-option${danger ? " danger" : secondary ? " secondary" : ""}`, label);
    button.type = "button";
    button.addEventListener("click", handler);
    options.append(button);
    return button;
  }

  function recordPath(value) {
    if (value) currentPath.push(value);
  }

  function formatTime(value) {
    const date = new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function parseSupportSubject(subject = "") {
    const raw = String(subject || "").trim();
    const red = raw.match(/^\[support:red:([a-z_]+):([a-z0-9-]+)\]\s*(.*)$/i);
    if (red) return { severity: "red", category: red[1].toLowerCase(), caseId: red[2], label: red[3].trim() || CATEGORIES[red[1]] || "Assistenza" };
    const legacy = raw.match(/^\[support:([a-z_]+)\]\s*(.*)$/i);
    if (legacy) return { severity: "legacy", category: legacy[1].toLowerCase(), caseId: "legacy", label: legacy[2].trim() || CATEGORIES[legacy[1]] || "Assistenza" };
    return null;
  }

  function supportSubject(category, caseId) {
    return `[support:red:${category}:${caseId}] ${CATEGORIES[category] || "Assistenza"}`;
  }

  async function sessionInfo() {
    const supabase = client();
    if (!supabase) throw new Error("authentication_required");
    const { data, error } = await supabase.auth.getSession();
    if (error || !data?.session?.user?.id) throw error || new Error("authentication_required");
    return { supabase, session: data.session };
  }

  async function loadSupportCommunications({ caseId = "", category = "" } = {}) {
    const { supabase, session } = await sessionInfo();
    const { data, error } = await supabase.from("premium_communications")
      .select("id,user_id,direction,subject,body,read_at,resolved_at,created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: true })
      .limit(250);
    if (error) throw error;
    const messages = (data || []).map(message => ({ ...message, parsed: parseSupportSubject(message.subject) })).filter(message => message.parsed);
    const redMessages = messages.filter(message => message.parsed.severity === "red");
    const preferredMessage = caseId
      ? redMessages.find(message => message.parsed.caseId === caseId && (!category || message.parsed.category === category))
      : null;
    const activeMessage = redMessages.find(message =>
      (message.direction === "user_to_staff" && !message.resolved_at)
      || (message.direction === "staff_to_user" && !message.read_at)
    );
    const anchor = preferredMessage || activeMessage;
    if (!anchor) return { supabase, session, openCase: null, messages: [] };
    const caseMessages = redMessages.filter(message => message.parsed.caseId === anchor.parsed.caseId && message.parsed.category === anchor.parsed.category);
    const firstUser = caseMessages.find(message => message.direction === "user_to_staff") || anchor;
    const unresolved = caseMessages.some(message => message.direction === "user_to_staff" && !message.resolved_at);
    const unreadStaff = caseMessages.some(message => message.direction === "staff_to_user" && !message.read_at);
    return {
      supabase,
      session,
      openCase: {
        id: firstUser.id,
        caseId: anchor.parsed.caseId,
        category: anchor.parsed.category,
        subject: firstUser.subject,
        createdAt: firstUser.created_at,
        resolved: !unresolved,
        waitingForRead: !unresolved && unreadStaff,
      },
      messages: caseMessages,
    };
  }

  async function markStaffMessagesRead(messages = []) {
    const unread = messages.filter(message => message.direction === "staff_to_user" && !message.read_at).map(message => message.id);
    if (!unread.length) return;
    try {
      const { supabase } = await sessionInfo();
      await supabase.from("premium_communications").update({ read_at: new Date().toISOString() }).in("id", unread).eq("direction", "staff_to_user");
    } catch (_) {
      // La lettura è un dettaglio UX: non bloccare la conversazione se fallisce.
    }
  }

  function renderOpenCase(openCase, messages) {
    currentCase = openCase;
    currentCaseMessages = messages;
    currentCategory = openCase.category;
    clearOptions();
    byId("premiumSupportEscalationForm").hidden = true;
    byId("premiumSupportReplyForm").hidden = true;
    byId("premiumSupportChat").replaceChildren();
    setTraffic("red", "ROSSO · STAFF");
    addBubble("bot", "Questa pratica è già stata inoltrata allo staff. Non verrà creata una seconda richiesta.");
    messages.forEach(message => {
      if (message.direction === "staff_to_user") addBubble("staff", message.body, `Staff · ${formatTime(message.created_at)}`);
      else if (message.direction === "user_to_staff") addBubble("user", message.body, formatTime(message.created_at));
    });
    const latest = messages[messages.length - 1];
    if (openCase.resolved && latest?.direction === "staff_to_user") {
      byId("premiumSupportReplyForm").hidden = false;
      setStatus("", "Lo staff ha chiuso la pratica. Questa risposta resta visibile finché non la leggi; se rispondi, la pratica si riapre.");
    } else if (latest?.direction === "staff_to_user") {
      byId("premiumSupportReplyForm").hidden = false;
      setStatus("", "Lo staff ha risposto. Puoi inviare una sola risposta alla volta; dopo l’invio attendi il prossimo messaggio.");
    } else {
      setStatus("", "Pratica in verifica. Attendi una risposta dello staff; non è possibile aprire richieste duplicate.");
    }
    addOption("CONTINUA CON ASSISTENZA AUTOMATICA", () => renderMain(), { secondary: true });
    addOption("ELIMINA RICHIESTA", deleteCurrentCase, { danger: true });
    markStaffMessagesRead(messages);
  }

  async function confirmDeleteRequest() {
    const dialog = globalThis.OffertaLogicaPremiumDialog;
    if (dialog?.confirm) {
      return dialog.confirm({
        title: "Eliminare la richiesta?",
        message: "La richiesta e tutta la conversazione con lo staff verranno eliminate definitivamente. Se è ancora aperta, verrà annullata.",
        confirmLabel: "ELIMINA",
        cancelLabel: "ANNULLA",
        danger: true,
      });
    }
    return globalThis.confirm?.("Eliminare definitivamente questa richiesta e tutta la conversazione?") ?? false;
  }

  async function deleteCurrentCase() {
    if (!currentCase) return;
    if (!(await confirmDeleteRequest())) return;
    const buttons = byId("premiumSupportOptions")?.querySelectorAll("button") || [];
    buttons.forEach(button => { button.disabled = true; });
    setStatus("", "Eliminazione richiesta…");
    try {
      const { supabase, session } = await sessionInfo();
      const { data: deletedRows, error } = await supabase.from("premium_communications")
        .delete()
        .eq("user_id", session.user.id)
        .eq("subject", currentCase.subject)
        .select("id");
      if (error) throw error;
      if (!deletedRows?.length) throw new Error("support_delete_no_rows");
      currentCase = null;
      currentCaseMessages = [];
      renderMain();
      setStatus("success", "Richiesta eliminata. Non è più presente nella coda dello staff.");
    } catch (error) {
      setStatus("error", friendlyError(error));
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  function renderMain() {
    currentCase = null;
    currentCaseMessages = [];
    currentCategory = "";
    currentPath = [];
    byId("premiumSupportChat")?.replaceChildren();
    byId("premiumSupportEscalationForm").hidden = true;
    byId("premiumSupportReplyForm").hidden = true;
    clearOptions();
    setStatus("", "");
    setTraffic("", "AUTOMATICO");
    addBubble("bot", "Dimmi dove hai bisogno di aiuto. Prima provo a risolvere qui; lo staff viene coinvolto solo se il problema diventa rosso.");
    Object.entries(CATEGORIES).forEach(([key, label]) => addOption(label, () => handleCategory(key)));
  }

  function jumpToTab(tab) {
    const button = document.querySelector(`[data-tab="${escapeSelector(tab)}"]`);
    if (button) button.click();
    else location.hash = tab;
  }

  function scrollToId(id, clickId = "") {
    const target = byId(id);
    if (!target) return false;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    if (clickId) window.setTimeout(() => byId(clickId)?.click(), 350);
    return true;
  }

  function solvedAutomatically(message) {
    setTraffic("green", "VERDE · AUTOMATICO");
    clearOptions();
    addBubble("bot", message);
    addOption("Ho risolto", () => {
      addBubble("user", "Ho risolto.");
      clearOptions();
      setStatus("success", "Nessuna pratica staff aperta.");
    });
    addOption("Ho un altro problema", renderMain, { secondary: true });
  }

  function yellowStep(message, retryHandler, redAllowed = true) {
    setStatus("", "");
    setTraffic("yellow", "GIALLO · TENTATIVO AUTOMATICO");
    clearOptions();
    addBubble("bot", message);
    if (retryHandler) addOption("APRI IL PERCORSO CONSIGLIATO", retryHandler);
    addOption("Ora funziona", () => solvedAutomatically("Perfetto. Il problema è stato risolto senza intervento dello staff."));
    if (redAllowed) {
      addOption("Il problema continua e blocca il servizio", () => prepareEscalation("Problema persistente dopo il tentativo automatico"), { danger: true });
    }
    addOption("Indietro", renderMain, { secondary: true });
  }

  function handleCategory(category) {
    setStatus("", "");
    currentCategory = category;
    currentPath = [CATEGORIES[category]];
    addBubble("user", CATEGORIES[category]);
    clearOptions();

    if (category === "account") {
      setTraffic("green", "VERDE · GUIDA");
      addBubble("bot", "Se stai usando l’app con il tuo profilo aperto, questa sessione è attiva. Posso portarti alla gestione della password oppure verificare un problema persistente di accesso.");
      addOption("Cambiare password", () => {
        recordPath("Cambio password");
        solvedAutomatically("Apri Sicurezza account e usa CAMBIA PASSWORD. Non serve lo staff.");
        window.setTimeout(() => scrollToId("premiumPasswordPanel", "premiumPasswordToggle"), 100);
      });
      addOption("Accesso o sessione continua a dare errore", () => {
        recordPath("Errore accesso/sessione");
        yellowStep("Se questa sessione funziona, prova prima a cambiare password da Sicurezza account. Dopo il salvataggio esci e prova un nuovo accesso. Se il nuovo accesso continua a fallire, posso aprire una pratica rossa.", () => scrollToId("premiumPasswordPanel", "premiumPasswordToggle"), true);
      });
      return;
    }

    if (category === "payment") {
      setTraffic("green", "VERDE · GUIDA");
      addBubble("bot", "La maggior parte delle operazioni di pagamento si gestisce automaticamente dal pannello Abbonamento e dal Portale Stripe.");
      addOption("Gestire pagamento, fatture o rinnovo", () => {
        recordPath("Gestione pagamento/rinnovo");
        solvedAutomatically("Apri Abbonamento e usa GESTISCI PAGAMENTO. Da lì puoi gestire metodo di pagamento, fatture e rinnovo.");
        window.setTimeout(() => scrollToId("premiumSubscriptionPanel"), 100);
      });
      addOption("Pagamento rifiutato o abbonamento sospeso", () => {
        recordPath("Pagamento rifiutato/sospeso");
        yellowStep("Apri GESTISCI PAGAMENTO e aggiorna il metodo di pagamento. Se Stripe continua a non consentire la regolarizzazione e il servizio resta bloccato, inoltrerò una pratica rossa.", () => {
          scrollToId("premiumSubscriptionPanel");
          window.setTimeout(() => byId("premiumSubscriptionManage")?.click(), 450);
        }, true);
      });
      addOption("Addebito che non riconosco", () => {
        recordPath("Addebito non riconosciuto");
        prepareEscalation("Possibile problema economico rilevante: addebito non riconosciuto");
      }, { danger: true });
      return;
    }

    if (category === "utilities") {
      setTraffic("green", "VERDE · GUIDA");
      addBubble("bot", "Per aggiungere o modificare una fornitura usa direttamente la sezione Utenze. Gli errori normali vengono gestiti senza staff.");
      addOption("Aggiungere o gestire un’utenza", () => {
        recordPath("Gestione utenza");
        solvedAutomatically("Ti porto alla sezione Utenze. Usa AGGIUNGI UTENZA oppure i comandi presenti sulla fornitura già registrata.");
        window.setTimeout(() => scrollToId("premiumUtilitiesCard"), 100);
      });
      addOption("Errore persistente che impedisce di usare le utenze", () => {
        recordPath("Errore utenze persistente");
        yellowStep("Riprova dopo un aggiornamento della pagina e verifica che i dati obbligatori siano completi. Se l’errore continua e impedisce di collegare le bollette, può diventare rosso.", () => location.reload(), true);
      });
      return;
    }

    if (category === "bills") {
      setTraffic("yellow", "GIALLO · CONTROLLO BOLLETTE");
      addBubble("bot", "Per le bollette manteniamo la stessa regola del semaforo già presente nell’app: verde e giallo restano automatici; lo staff entra solo quando la bolletta è classificata rossa.");
      addOption("Apri le mie bollette", () => jumpToTab("bill"));
      addOption("La bolletta è rossa", () => {
        recordPath("Bolletta rossa");
        addBubble("bot", "Usa il pulsante di verifica staff direttamente sulla bolletta rossa. Non apro una seconda pratica generica, così resta valida la logica e il limite già previsto dal servizio.");
        clearOptions();
        addOption("VAI ALLE BOLLETTE", () => jumpToTab("bill"));
        addOption("Indietro", renderMain, { secondary: true });
      });
      addOption("Analisi gialla, fallita o PDF poco leggibile", () => {
        recordPath("Analisi gialla/fallita/PDF");
        setTraffic("yellow", "GIALLO · RIPROVA");
        addBubble("bot", "Riprova l’analisi o carica un PDF più leggibile dalla sezione Bollette. Finché il sistema non produce un codice rosso, non viene aperta una pratica staff.");
        clearOptions();
        addOption("VAI ALLE BOLLETTE", () => jumpToTab("bill"));
        addOption("Indietro", renderMain, { secondary: true });
      });
      return;
    }

    if (category === "installation") {
      setTraffic("green", "VERDE · AUTOMATICO");
      addBubble("bot", "Installazione e aggiornamenti non richiedono intervento staff. Posso avviare il percorso di installazione oppure aggiornare la pagina.");
      addOption("Installare l’app", () => {
        recordPath("Installazione app");
        location.assign(`/app.html?install=1${location.hash || "#profile"}`);
      });
      addOption("Aggiornare l’app", () => {
        recordPath("Aggiornamento app");
        solvedAutomatically("L’app controlla già gli aggiornamenti automaticamente. Ricarico la pagina per forzare un nuovo controllo.");
        window.setTimeout(() => location.reload(), 500);
      });
      addOption("Indietro", renderMain, { secondary: true });
      return;
    }

    setTraffic("green", "VERDE · GUIDA");
    addBubble("bot", "Per evitare richieste inutili, scegli prima se si tratta di una semplice informazione oppure di un problema tecnico importante.");
    addOption("Informazioni su come funziona", () => {
      recordPath("Informazioni generali");
      solvedAutomatically("Apri la guida Come funziona. Nessuna pratica staff è necessaria.");
      window.setTimeout(() => location.assign("/come-funziona.html"), 450);
    });
    addOption("Problema tecnico che blocca completamente l’app", () => {
      recordPath("Blocco tecnico completo");
      yellowStep("Prima ricarica l’app e verifica la connessione. Se il blocco continua anche dopo il nuovo caricamento, lo considero un problema importante e posso inoltrarlo allo staff.", () => location.reload(), true);
    });
    addOption("Problema di sicurezza o dati che sembrano mancanti", () => {
      recordPath("Sicurezza/dati mancanti");
      prepareEscalation("Possibile problema importante di sicurezza o integrità dei dati");
    }, { danger: true });
  }

  function prepareEscalation(reason) {
    setTraffic("red", "ROSSO · VERIFICA STAFF");
    clearOptions();
    recordPath(reason);
    addBubble("bot", "Questo caso supera l’assistenza automatica. Prima di inviarlo verifico che non esista già una pratica aperta; poi lo staff riceverà il percorso già tentato.");
    byId("premiumSupportEscalationForm").hidden = false;
    byId("premiumSupportEscalationForm").elements.message.value = "";
    byId("premiumSupportEscalationForm").elements.message.focus();
  }

  function isSessionError(error) {
    const message = String(error?.message || error || "").toLowerCase();
    return message.includes("jwt") || message.includes("session") || message.includes("auth");
  }

  function friendlyError(error) {
    const message = String(error?.message || error || "").toLowerCase();
    if (message.includes("row-level security") || message.includes("policy")) return "L’assistenza è disponibile per una prova o un piano Premium attivo.";
    if (message.includes("jwt") || message.includes("session") || message.includes("auth")) return "La sessione è scaduta. Accedi nuovamente e riprova.";
    return "Operazione non riuscita. Riprova tra poco.";
  }

  async function submitEscalation(event) {
    event.preventDefault();
    const now = Date.now();
    if (now - lastSubmitAt < SUBMIT_COOLDOWN_MS) return;
    const form = event.currentTarget;
    const body = String(form.elements.message?.value || "").trim();
    if (body.length < MIN_ESCALATION_LENGTH) {
      setStatus("error", `Descrivi il problema con almeno ${MIN_ESCALATION_LENGTH} caratteri.`);
      form.elements.message?.focus();
      return;
    }
    if (!CATEGORIES[currentCategory] || currentCategory === "bills" || currentCategory === "installation") {
      setStatus("error", "Questo percorso non prevede l’apertura di una pratica staff generica.");
      return;
    }

    form.querySelectorAll("button,textarea").forEach(element => { element.disabled = true; });
    setStatus("", "Verifica delle pratiche aperte…");
    try {
      const existing = await loadSupportCommunications();
      if (existing.openCase) {
        byId("premiumSupportEscalationForm").hidden = true;
        renderOpenCase(existing.openCase, existing.messages);
        return;
      }
      const caseId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const subject = supportSubject(currentCategory, caseId);
      const payload = [
        "Classificazione automatica: ROSSO",
        `Categoria: ${CATEGORIES[currentCategory]}`,
        `Percorso automatico: ${currentPath.join(" > ") || "non disponibile"}`,
        `Descrizione cliente: ${body}`,
      ].join("\n");
      const { supabase, session } = existing;
      const { data, error } = await supabase.from("premium_communications").insert({
        user_id: session.user.id,
        direction: "user_to_staff",
        channel: "in_app",
        subject,
        body: payload.slice(0, 1500),
        created_by_user_id: session.user.id,
      }).select("id,user_id,direction,subject,body,read_at,resolved_at,created_at").single();
      if (error) throw error;
      lastSubmitAt = Date.now();
      byId("premiumSupportEscalationForm").hidden = true;
      const parsed = parseSupportSubject(data.subject);
      renderOpenCase({ id: data.id, caseId: parsed.caseId, category: parsed.category, subject: data.subject, createdAt: data.created_at }, [{ ...data, parsed }]);
      setStatus("success", "Pratica rossa aperta. Lo staff vede già il problema e i tentativi automatici effettuati.");
    } catch (error) {
      setStatus("error", friendlyError(error));
    } finally {
      form.querySelectorAll("button,textarea").forEach(element => { element.disabled = false; });
    }
  }

  async function submitReply(event) {
    event.preventDefault();
    if (!currentCase) return;
    const now = Date.now();
    if (now - lastSubmitAt < SUBMIT_COOLDOWN_MS) return;
    const form = event.currentTarget;
    const body = String(form.elements.message?.value || "").trim();
    if (body.length < MIN_REPLY_LENGTH) {
      setStatus("error", "Scrivi una risposta prima di inviare.");
      return;
    }
    const latest = currentCaseMessages[currentCaseMessages.length - 1];
    if (!latest || latest.direction !== "staff_to_user") {
      setStatus("error", "Attendi una risposta dello staff prima di inviare un altro messaggio.");
      return;
    }
    form.querySelectorAll("button,textarea").forEach(element => { element.disabled = true; });
    try {
      const live = await loadSupportCommunications({ caseId: currentCase.caseId, category: currentCase.category });
      if (!live.openCase || live.openCase.caseId !== currentCase.caseId) {
        renderMain();
        setStatus("error", "La pratica non esiste più: potrebbe essere stata eliminata dallo staff.");
        return;
      }
      const { supabase, session } = await sessionInfo();
      const { error } = await supabase.from("premium_communications").insert({
        user_id: session.user.id,
        direction: "user_to_staff",
        channel: "in_app",
        subject: currentCase.subject,
        body: body.slice(0, 1500),
        created_by_user_id: session.user.id,
      });
      if (error) throw error;
      lastSubmitAt = Date.now();
      form.reset();
      const refreshed = await loadSupportCommunications();
      if (refreshed.openCase) renderOpenCase(refreshed.openCase, refreshed.messages);
    } catch (error) {
      setStatus("error", friendlyError(error));
    } finally {
      form.querySelectorAll("button,textarea").forEach(element => { element.disabled = false; });
    }
  }

  async function openPanel() {
    const panel = byId("premiumSupportPanel");
    if (!panel) return;
    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "center" });
    setStatus("", "");
    try {
      const existing = await loadSupportCommunications();
      if (existing.openCase) renderOpenCase(existing.openCase, existing.messages);
      else renderMain();
    } catch (error) {
      renderMain();
      if (isSessionError(error)) {
        setStatus("", "Puoi usare la guida automatica. Per aprire o leggere una pratica dello staff sarà necessario accedere nuovamente.");
      } else {
        setStatus("error", friendlyError(error));
      }
    }
  }

  function closePanel() {
    const panel = byId("premiumSupportPanel");
    if (!panel) return;
    panel.hidden = true;
    setStatus("", "");
    byId("premiumSupportOpen")?.focus();
  }

  function updateLauncherCopy() {
    const button = byId("premiumSupportOpen");
    if (!button) return;
    const strong = button.querySelector(".list-copy strong");
    const small = button.querySelector(".list-copy small");
    if (strong) strong.textContent = "Assistente OffertaLogica";
    if (small) small.textContent = "Prova a risolvere automaticamente; lo staff interviene solo sui casi rossi.";
  }

  function init() {
    if (initialized) return;
    initialized = true;
    injectStyles();
    buildPanel();
    updateLauncherCopy();
    byId("premiumSupportOpen")?.addEventListener("click", openPanel);
    byId("premiumSupportClose")?.addEventListener("click", closePanel);
    byId("premiumSupportRestart")?.addEventListener("click", () => {
      renderMain();
    });
    byId("premiumSupportEscalationForm")?.addEventListener("submit", submitEscalation);
    byId("premiumSupportReplyForm")?.addEventListener("submit", submitReply);
  }

  globalThis.OffertaLogicaPremiumSupport = Object.freeze({ init });
})();
