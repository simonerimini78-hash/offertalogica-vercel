(() => {
  "use strict";

  const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["trialing", "active"]);
  const VALID_SUPPLY_TYPES = new Set(["electricity", "gas", "dual"]);
  const UTILITY_COLUMNS = "id, user_id, label, supply_type, provider_name, pod, pdr, address, expected_bills_per_year, status, created_at, updated_at";

  let client = null;
  let initialized = false;
  let authSubscription = null;
  let syncSequence = 0;
  let currentUser = null;
  let currentSubscription = null;
  let maintenanceMode = false;
  let operationBlockReason = "";
  let utilities = [];
  let editingId = "";

  const byId = id => document.getElementById(id);

  const state = {
    card: null,
    statusBadge: null,
    quota: null,
    locked: null,
    lockedTitle: null,
    lockedCopy: null,
    enabled: null,
    addButton: null,
    form: null,
    formTitle: null,
    submitButton: null,
    cancelButton: null,
    supplySelect: null,
    podField: null,
    pdrField: null,
    message: null,
    empty: null,
    list: null
  };

  function setText(element, value) {
    if (element) element.textContent = value;
  }

  function setMessage(kind, message) {
    if (!state.message) return;
    state.message.className = `utility-message${kind ? ` ${kind}` : ""}`;
    state.message.textContent = message || "";
    state.message.hidden = !message;
  }

  function setFormBusy(busy) {
    if (!state.form) return;
    state.form.querySelectorAll("button, input, select").forEach(element => {
      element.disabled = Boolean(busy);
    });
    state.form.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function normalizeCode(value) {
    return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  }

  function supplyLabel(value) {
    return {
      electricity: "Luce",
      gas: "Gas",
      dual: "Luce e gas"
    }[value] || "Utenza";
  }

  function friendlyError(error) {
    const raw = String(error?.message || "");
    const message = raw.toLowerCase();
    if (!message) return "Operazione non riuscita. Riprova.";
    if (message.includes("premium utility limit reached") || message.includes("premium_utility_limit_reached")) {
      return "Hai raggiunto il numero di utenze incluso nel piano.";
    }
    if (message.includes("premium_bills_utility_owner_fk") || message.includes("violates foreign key constraint")) {
      return "Questa utenza contiene ancora bollette. Elimina prima le bollette associate oppure conserva l’utenza nello storico.";
    }
    if (message.includes("premium_legal_acceptance_required")) {
      return "Accetta le condizioni Premium correnti dalla sezione Profilo prima di continuare.";
    }
    if (message.includes("row-level security") || message.includes("permission denied")) {
      return "Operazione non autorizzata. Verifica che l’abbonamento sia attivo.";
    }
    if (message.includes("failed to fetch") || message.includes("network")) {
      return "Connessione non disponibile. Controlla la rete e riprova.";
    }
    return raw || "Operazione non riuscita. Riprova.";
  }

  function subscriptionIsActive(profile, subscription) {
    if (profile?.account_status !== "active" || !subscription) return false;
    if (!ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) return false;
    if (!subscription.current_period_end) return true;
    const end = new Date(subscription.current_period_end);
    return !Number.isNaN(end.getTime()) && end > new Date();
  }

  function renderLocked(title, copy, badge = "BLOCCATO", quota = "Non attivo") {
    currentSubscription = null;
    maintenanceMode = false;
    operationBlockReason = "";
    utilities = [];
    closeForm();
    if (state.locked) state.locked.hidden = false;
    if (state.enabled) state.enabled.hidden = true;
    setText(state.lockedTitle, title);
    setText(state.lockedCopy, copy);
    setText(state.statusBadge, badge);
    setText(state.quota, quota);
    setMessage("", "");
  }

  function renderLoading() {
    if (state.locked) state.locked.hidden = false;
    if (state.enabled) state.enabled.hidden = true;
    setText(state.lockedTitle, "Verifica delle utenze…");
    setText(state.lockedCopy, "Controllo account, abbonamento e permessi di accesso.");
    setText(state.statusBadge, "ATTENDI");
    setText(state.quota, "—");
    setMessage("", "");
  }

  function renderEnabled() {
    if (state.locked) state.locked.hidden = true;
    if (state.enabled) state.enabled.hidden = false;
    const legalBlocked = maintenanceMode && operationBlockReason === "legal";
    setText(state.statusBadge, legalBlocked ? "CONDIZIONI" : (maintenanceMode ? "ARCHIVIO" : (currentSubscription?.status === "trialing" ? "PROVA" : "ATTIVO")));

    const limit = Math.max(1, Number(currentSubscription?.included_utilities || 1));
    const activeCount = utilities.filter(item => item.status !== "archived").length;
    const canAdd = !maintenanceMode && activeCount < limit;
    setText(state.quota, legalBlocked ? "Accettazione richiesta" : (maintenanceMode ? "Sola gestione" : `${activeCount} / ${limit}`));
    if (state.addButton) {
      state.addButton.disabled = !canAdd;
      state.addButton.hidden = maintenanceMode;
      state.addButton.textContent = canAdd ? "AGGIUNGI UTENZA" : "LIMITE UTENZE RAGGIUNTO";
    }

    renderList();
  }

  function buildDetail(label, value) {
    const row = document.createElement("div");
    row.className = "utility-item-detail";
    const key = document.createElement("span");
    const text = document.createElement("strong");
    key.textContent = label;
    text.textContent = value;
    row.append(key, text);
    return row;
  }

  function renderList() {
    if (!state.list || !state.empty) return;
    state.list.replaceChildren();

    if (!utilities.length) {
      state.empty.hidden = false;
      state.list.hidden = true;
      return;
    }

    state.empty.hidden = true;
    state.list.hidden = false;

    utilities.forEach(utility => {
      const article = document.createElement("article");
      article.className = "utility-item";
      article.dataset.utilityId = utility.id;

      const head = document.createElement("div");
      head.className = "utility-item-head";
      const titleWrap = document.createElement("div");
      titleWrap.className = "utility-item-title";
      const title = document.createElement("strong");
      title.textContent = utility.label || "Utenza";
      const provider = document.createElement("small");
      provider.textContent = utility.provider_name || "Fornitore non indicato";
      titleWrap.append(title, provider);
      const badge = document.createElement("span");
      badge.className = "utility-type";
      badge.textContent = supplyLabel(utility.supply_type);
      head.append(titleWrap, badge);

      const details = document.createElement("div");
      details.className = "utility-item-details";
      const address = String(utility.address?.formatted || "").trim();
      if (address) details.append(buildDetail("Indirizzo", address));
      if (utility.pod) details.append(buildDetail("POD", utility.pod));
      if (utility.pdr) details.append(buildDetail("PDR", utility.pdr));

      const actions = document.createElement("div");
      actions.className = "utility-item-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "utility-mini-btn";
      edit.dataset.utilityEdit = utility.id;
      edit.textContent = "MODIFICA";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "utility-mini-btn danger";
      remove.dataset.utilityDelete = utility.id;
      remove.textContent = "ELIMINA";
      if (!maintenanceMode) actions.append(edit);
      actions.append(remove);

      article.append(head, details, actions);
      state.list.append(article);
    });
  }

  function updateSupplyFields() {
    const type = state.supplySelect?.value || "electricity";
    if (state.podField) state.podField.hidden = type === "gas";
    if (state.pdrField) state.pdrField.hidden = type === "electricity";
  }

  function closeForm() {
    editingId = "";
    if (state.form) {
      state.form.reset();
      state.form.hidden = true;
    }
    setText(state.formTitle, "Aggiungi utenza");
    if (state.submitButton) state.submitButton.textContent = "SALVA UTENZA";
    updateSupplyFields();
  }

  function openForm(utility = null) {
    if (maintenanceMode) {
      setMessage("error", operationBlockReason === "legal"
        ? "Accetta le condizioni Premium correnti dalla sezione Profilo prima di modificare le utenze."
        : "La modifica delle utenze richiede un abbonamento attivo.");
      return;
    }
    if (!state.form || !currentUser || !currentSubscription) return;
    const limit = Math.max(1, Number(currentSubscription.included_utilities || 1));
    if (!utility && utilities.length >= limit) {
      setMessage("error", "Hai raggiunto il numero di utenze incluso nel piano.");
      return;
    }

    editingId = utility?.id || "";
    state.form.hidden = false;
    setText(state.formTitle, editingId ? "Modifica utenza" : "Aggiungi utenza");
    if (state.submitButton) state.submitButton.textContent = editingId ? "SALVA MODIFICHE" : "SALVA UTENZA";

    state.form.elements.label.value = utility?.label || "";
    state.form.elements.supply_type.value = utility?.supply_type || "electricity";
    state.form.elements.provider_name.value = utility?.provider_name || "";
    state.form.elements.address.value = utility?.address?.formatted || "";
    state.form.elements.pod.value = utility?.pod || "";
    state.form.elements.pdr.value = utility?.pdr || "";
    updateSupplyFields();
    setMessage("", "");
    state.form.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function collectPayload() {
    const form = state.form;
    const label = String(form.elements.label?.value || "").trim();
    const supplyType = String(form.elements.supply_type?.value || "");
    const providerName = String(form.elements.provider_name?.value || "").trim();
    const address = String(form.elements.address?.value || "").trim();
    const pod = supplyType === "gas" ? "" : normalizeCode(form.elements.pod?.value);
    const pdr = supplyType === "electricity" ? "" : normalizeCode(form.elements.pdr?.value);

    if (label.length < 2) throw new Error("Inserisci un nome riconoscibile per l’utenza.");
    if (!VALID_SUPPLY_TYPES.has(supplyType)) throw new Error("Seleziona una tipologia valida.");

    return {
      user_id: currentUser.id,
      label,
      supply_type: supplyType,
      provider_name: providerName,
      pod,
      pdr,
      address: address ? { formatted: address } : {},
      expected_bills_per_year: 12,
      status: "active"
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (maintenanceMode) {
      setMessage("error", operationBlockReason === "legal"
        ? "Accetta le condizioni Premium correnti dalla sezione Profilo prima di modificare le utenze."
        : "La modifica delle utenze richiede un abbonamento attivo.");
      return;
    }
    if (!client || !currentUser || !currentSubscription) {
      setMessage("error", "L’area utenze non è disponibile.");
      return;
    }

    let payload;
    try {
      payload = collectPayload();
    } catch (error) {
      setMessage("error", error.message);
      return;
    }

    setFormBusy(true);
    setMessage("info", editingId ? "Salvataggio modifiche…" : "Creazione utenza…");

    const wasEditing = Boolean(editingId);
    let result;
    if (editingId) {
      result = await client
        .from("premium_utilities")
        .update(payload)
        .eq("id", editingId)
        .eq("user_id", currentUser.id)
        .select(UTILITY_COLUMNS)
        .single();
    } else {
      result = await client
        .from("premium_utilities")
        .insert(payload)
        .select(UTILITY_COLUMNS)
        .single();
    }

    setFormBusy(false);
    if (result.error) {
      setMessage("error", friendlyError(result.error));
      return;
    }

    if (editingId) {
      utilities = utilities.map(item => item.id === editingId ? result.data : item);
    } else {
      utilities = [...utilities, result.data];
    }
    closeForm();
    renderEnabled();
    setMessage("success", wasEditing ? "Utenza aggiornata." : "Utenza aggiunta.");
    window.dispatchEvent(new CustomEvent("offertalogica:utilities-changed"));
  }

  async function handleDelete(id) {
    const utility = utilities.find(item => item.id === id);
    if (!utility || !client || !currentUser) return;

    setMessage("info", "Verifica delle bollette associate…");
    const linked = await client
      .from("premium_bills")
      .select("id", { count: "exact", head: true })
      .eq("utility_id", id)
      .eq("user_id", currentUser.id)
      .is("deleted_at", null);

    if (linked.error) {
      setMessage("error", friendlyError(linked.error));
      return;
    }

    const linkedCount = Number(linked.count || 0);
    if (linkedCount > 0) {
      setMessage(
        "error",
        `Questa utenza contiene ${linkedCount} ${linkedCount === 1 ? "bolletta" : "bollette"}. Elimina prima le bollette associate; lo storico non viene cancellato automaticamente.`
      );
      return;
    }

    const confirmed = window.confirm(`Eliminare l’utenza “${utility.label}”? L’operazione non può essere annullata.`);
    if (!confirmed) {
      setMessage("", "");
      return;
    }

    setMessage("info", "Eliminazione utenza…");
    const { error } = await client
      .from("premium_utilities")
      .delete()
      .eq("id", id)
      .eq("user_id", currentUser.id);

    if (error) {
      setMessage("error", friendlyError(error));
      return;
    }

    utilities = utilities.filter(item => item.id !== id);
    if (editingId === id) closeForm();
    renderEnabled();
    setMessage("success", "Utenza eliminata.");
    window.dispatchEvent(new CustomEvent("offertalogica:utilities-changed"));
  }

  async function loadUtilities(user, subscription, { blockReason = "" } = {}) {
    const result = await client
      .from("premium_utilities")
      .select(UTILITY_COLUMNS)
      .eq("user_id", user.id)
      .neq("status", "archived")
      .order("created_at", { ascending: true });

    if (result.error) throw result.error;
    currentUser = user;
    currentSubscription = subscription;
    maintenanceMode = !subscription;
    operationBlockReason = maintenanceMode ? blockReason : "";
    utilities = Array.isArray(result.data) ? result.data : [];
    renderEnabled();
  }

  async function syncSession(session) {
    const sequence = ++syncSequence;
    currentUser = session?.user || null;
    currentSubscription = null;
    maintenanceMode = false;
    operationBlockReason = "";
    utilities = [];

    if (!session?.user) {
      renderLocked("Accedi per gestire le utenze", "La gestione delle utenze è collegata all’account Premium.", "ACCESSO", "Non collegato");
      return;
    }

    renderLoading();
    const userId = session.user.id;
    const [profileResult, subscriptionResult, acceptanceResult] = await Promise.all([
      client
        .from("premium_profiles")
        .select("account_status")
        .eq("id", userId)
        .maybeSingle(),
      client
        .from("premium_subscriptions")
        .select("status, current_period_end, included_utilities, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      client.rpc("premium_has_current_acceptances")
    ]);

    if (sequence !== syncSequence) return;
    if (profileResult.error) {
      renderLocked("Profilo non disponibile", "Non è stato possibile verificare il profilo Premium.", "ERRORE", "—");
      setMessage("error", friendlyError(profileResult.error));
      return;
    }
    if (subscriptionResult.error) {
      renderLocked("Abbonamento non verificabile", "Non è stato possibile controllare lo stato del servizio.", "ERRORE", "—");
      setMessage("error", friendlyError(subscriptionResult.error));
      return;
    }
    if (acceptanceResult.error) {
      renderLocked("Condizioni non verificabili", "Non è stato possibile verificare le accettazioni Premium correnti.", "ERRORE", "—");
      setMessage("error", friendlyError(acceptanceResult.error));
      return;
    }

    const profile = profileResult.data;
    const subscription = subscriptionResult.data;
    if (!profile) {
      renderLocked("Profilo Premium non abilitato", "L’account email è valido, ma non risulta associato al servizio Premium.", "DA VERIFICARE", "Non disponibile");
      return;
    }
    const activeSubscription = subscriptionIsActive(profile, subscription) ? subscription : null;
    const legalReady = acceptanceResult.data === true;
    const operationalSubscription = activeSubscription && legalReady ? activeSubscription : null;

    try {
      await loadUtilities(session.user, operationalSubscription, {
        blockReason: activeSubscription && !legalReady ? "legal" : (!activeSubscription ? "subscription" : ""),
      });
      if (activeSubscription && !legalReady) {
        setMessage("info", "Accetta le condizioni Premium correnti dalla sezione Profilo. Le utenze già presenti restano consultabili ed eliminabili.");
      } else if (!activeSubscription) {
        setMessage("info", "Abbonamento non attivo: puoi eliminare le utenze dopo aver rimosso le bollette collegate.");
      }
    } catch (error) {
      if (sequence !== syncSequence) return;
      renderLocked("Utenze non disponibili", "Il profilo è attivo, ma non è stato possibile caricare le utenze.", "ERRORE", "—");
      setMessage("error", friendlyError(error));
    }
  }

  function collectElements() {
    state.card = byId("premiumUtilitiesCard");
    state.statusBadge = byId("premiumUtilitiesStatus");
    state.quota = byId("premiumUtilitiesQuota");
    state.locked = byId("premiumUtilitiesLocked");
    state.lockedTitle = byId("premiumUtilitiesLockedTitle");
    state.lockedCopy = byId("premiumUtilitiesLockedCopy");
    state.enabled = byId("premiumUtilitiesEnabled");
    state.addButton = byId("premiumUtilityAdd");
    state.form = byId("premiumUtilityForm");
    state.formTitle = byId("premiumUtilityFormTitle");
    state.submitButton = byId("premiumUtilitySubmit");
    state.cancelButton = byId("premiumUtilityCancel");
    state.supplySelect = byId("premiumUtilityType");
    state.podField = byId("premiumUtilityPodField");
    state.pdrField = byId("premiumUtilityPdrField");
    state.message = byId("premiumUtilityMessage");
    state.empty = byId("premiumUtilityEmpty");
    state.list = byId("premiumUtilityList");
  }

  function init() {
    if (initialized) return;
    initialized = true;
    collectElements();
    if (!state.card) return;

    client = globalThis.OffertaLogicaPremiumAuth?.getClient?.() || null;
    if (!client) {
      renderLocked("Collegamento non disponibile", "Ricarica la pagina con una connessione attiva.", "ERRORE", "—");
      return;
    }

    state.addButton?.addEventListener("click", () => openForm());
    state.cancelButton?.addEventListener("click", closeForm);
    state.supplySelect?.addEventListener("change", updateSupplyFields);
    state.form?.addEventListener("submit", handleSubmit);
    state.list?.addEventListener("click", event => {
      const editButton = event.target.closest("[data-utility-edit]");
      if (editButton) {
        const utility = utilities.find(item => item.id === editButton.dataset.utilityEdit);
        if (utility) openForm(utility);
        return;
      }
      const deleteButton = event.target.closest("[data-utility-delete]");
      if (deleteButton) handleDelete(deleteButton.dataset.utilityDelete);
    });

    authSubscription = client.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => syncSession(session), 0);
    });

    client.auth.getSession().then(({ data, error }) => {
      if (error) {
        renderLocked("Sessione non disponibile", "Non è stato possibile verificare l’account.", "ERRORE", "—");
        setMessage("error", friendlyError(error));
        return;
      }
      syncSession(data.session);
    });

    window.addEventListener("pagehide", () => {
      authSubscription?.data?.subscription?.unsubscribe?.();
    }, { once: true });

    updateSupplyFields();
  }

  globalThis.OffertaLogicaPremiumUtilities = Object.freeze({ init });
})();
