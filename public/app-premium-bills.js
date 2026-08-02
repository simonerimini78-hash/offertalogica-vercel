(() => {
  "use strict";

  const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["trialing", "active"]);
  const BUCKET = "premium-bills";
  const MAX_FILE_SIZE = 20_000_000;
  const BILL_COLUMNS = "id, user_id, utility_id, commodity, original_file_name, file_size, file_sha256, storage_bucket, storage_path, processing_status, customer_status, created_at";
  const UTILITY_COLUMNS = "id, label, supply_type, expected_bills_per_year, status";

  let client = null;
  let initialized = false;
  let authSubscription = null;
  let syncSequence = 0;
  let currentUser = null;
  let currentSubscription = null;
  let utilities = [];
  let bills = [];
  let yearlyBillCount = 0;
  let busy = false;

  const byId = id => document.getElementById(id);

  const state = {
    card: null,
    statusBadge: null,
    quota: null,
    locked: null,
    lockedTitle: null,
    lockedCopy: null,
    enabled: null,
    noUtilities: null,
    utilitySelect: null,
    fileInput: null,
    uploadButton: null,
    uploadButtonLabel: null,
    message: null,
    empty: null,
    list: null,
    homeCount: null
  };

  function setText(element, value) {
    if (element) element.textContent = value;
  }

  function setMessage(kind, message) {
    if (!state.message) return;
    state.message.className = `cloud-bill-message${kind ? ` ${kind}` : ""}`;
    state.message.textContent = message || "";
    state.message.hidden = !message;
  }

  function setBusy(value) {
    busy = Boolean(value);
    if (state.utilitySelect) state.utilitySelect.disabled = busy || !utilities.length;
    if (state.uploadButton) state.uploadButton.disabled = busy || !canUpload();
    if (state.fileInput) state.fileInput.disabled = busy || !utilities.length;
    if (state.uploadButtonLabel) state.uploadButtonLabel.textContent = busy ? "CARICAMENTO…" : "SCEGLI PDF";
    state.card?.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("it-IT", {
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

  function supplyLabel(value) {
    return {
      electricity: "Luce",
      gas: "Gas",
      dual: "Luce e gas"
    }[value] || "Utenza";
  }

  function statusLabel(bill) {
    if (bill.processing_status === "uploaded") return "In attesa";
    if (["queued", "analyzing", "ready_for_review"].includes(bill.processing_status)) return "In controllo";
    if (bill.customer_status === "correct") return "Corretta";
    if (bill.customer_status === "anomaly_found") return "Anomalia";
    if (bill.customer_status === "saving_opportunity") return "Risparmio";
    if (bill.customer_status === "more_info_required") return "Integrazione";
    if (bill.processing_status === "failed" || bill.customer_status === "failed") return "Errore";
    return "Archiviata";
  }

  function friendlyError(error) {
    const raw = String(error?.message || "").trim();
    const message = raw.toLowerCase();
    if (!message) return "Operazione non riuscita. Riprova.";
    if (message.includes("premium bill limit reached") || message.includes("premium_bill_limit_reached") || message.includes("row-level security")) {
      return "Il caricamento non è autorizzato oppure hai raggiunto il limite annuale del piano.";
    }
    if (message.includes("duplicate key") || message.includes("premium_bills_user_sha_active_uidx")) {
      return "Questa bolletta risulta già presente nell’archivio cloud.";
    }
    if (message.includes("payload too large") || message.includes("maximum allowed size")) {
      return "Il PDF supera il limite massimo di 20 MB.";
    }
    if (message.includes("mime") || message.includes("content type")) {
      return "Il file selezionato non è un PDF valido.";
    }
    if (message.includes("object not found") || message.includes("not found")) {
      return "Il PDF non è più disponibile nell’archivio cloud.";
    }
    if (message.includes("permission denied")) {
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

  function planLimit() {
    return Math.max(1, Number(currentSubscription?.included_bills_per_year || 12));
  }

  function canUpload() {
    return Boolean(currentUser && currentSubscription && utilities.length && yearlyBillCount < planLimit() && !busy);
  }

  function renderLocked(title, copy, badge = "BLOCCATO", quota = "Non attivo") {
    currentSubscription = null;
    utilities = [];
    bills = [];
    yearlyBillCount = 0;
    if (state.locked) state.locked.hidden = false;
    if (state.enabled) state.enabled.hidden = true;
    setText(state.lockedTitle, title);
    setText(state.lockedCopy, copy);
    setText(state.statusBadge, badge);
    setText(state.quota, quota);
    setText(state.homeCount, "—");
    setMessage("", "");
  }

  function renderLoading() {
    if (state.locked) state.locked.hidden = false;
    if (state.enabled) state.enabled.hidden = true;
    setText(state.lockedTitle, "Verifica dell’archivio cloud…");
    setText(state.lockedCopy, "Controllo account, abbonamento, utenze e bollette.");
    setText(state.statusBadge, "ATTENDI");
    setText(state.quota, "—");
    setText(state.homeCount, "—");
    setMessage("", "");
  }

  function renderUtilityOptions() {
    if (!state.utilitySelect) return;
    const previous = state.utilitySelect.value;
    state.utilitySelect.replaceChildren();

    utilities.forEach(utility => {
      const option = document.createElement("option");
      option.value = utility.id;
      option.textContent = `${utility.label} · ${supplyLabel(utility.supply_type)}`;
      state.utilitySelect.append(option);
    });

    if (previous && utilities.some(utility => utility.id === previous)) {
      state.utilitySelect.value = previous;
    }
  }

  function renderEnabled() {
    if (state.locked) state.locked.hidden = true;
    if (state.enabled) state.enabled.hidden = false;
    setText(state.statusBadge, currentSubscription?.status === "trialing" ? "PROVA" : "ATTIVO");
    setText(state.quota, `${yearlyBillCount} / ${planLimit()}`);
    setText(state.homeCount, String(bills.length));

    renderUtilityOptions();
    if (state.noUtilities) state.noUtilities.hidden = utilities.length > 0;
    if (state.utilitySelect) state.utilitySelect.hidden = utilities.length === 0;
    if (state.uploadButton) state.uploadButton.hidden = utilities.length === 0;
    setBusy(false);
    renderList();
  }

  function renderList() {
    if (!state.list || !state.empty) return;
    state.list.replaceChildren();

    if (!bills.length) {
      state.empty.hidden = false;
      state.list.hidden = true;
      return;
    }

    state.empty.hidden = true;
    state.list.hidden = false;

    const utilityMap = new Map(utilities.map(utility => [utility.id, utility]));
    bills.forEach(bill => {
      const utility = utilityMap.get(bill.utility_id);
      const article = document.createElement("article");
      article.className = "cloud-bill-item";
      article.dataset.cloudBillId = bill.id;

      const icon = document.createElement("div");
      icon.className = "cloud-bill-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "PDF";

      const copy = document.createElement("div");
      copy.className = "cloud-bill-copy";
      const title = document.createElement("strong");
      title.textContent = bill.original_file_name || "Bolletta.pdf";
      const utilityName = document.createElement("span");
      utilityName.textContent = utility?.label || "Utenza";
      const meta = document.createElement("small");
      meta.textContent = `${formatDate(bill.created_at)} · ${formatSize(bill.file_size)}`;
      copy.append(title, utilityName, meta);

      const badge = document.createElement("span");
      badge.className = "cloud-bill-status";
      badge.textContent = statusLabel(bill);

      const actions = document.createElement("div");
      actions.className = "cloud-bill-actions";
      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "cloud-bill-btn";
      openButton.dataset.cloudBillOpen = bill.id;
      openButton.textContent = "APRI";
      actions.append(openButton);

      if (bill.processing_status === "uploaded") {
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "cloud-bill-btn danger";
        deleteButton.dataset.cloudBillDelete = bill.id;
        deleteButton.textContent = "ELIMINA";
        actions.append(deleteButton);
      }

      article.append(icon, copy, badge, actions);
      state.list.append(article);
    });
  }

  function validateFile(file) {
    if (!(file instanceof File)) throw new Error("Seleziona un PDF.");
    const name = String(file.name || "").trim();
    const extensionIsPdf = name.toLowerCase().endsWith(".pdf");
    const mimeIsAllowed = !file.type || file.type === "application/pdf";
    if (!extensionIsPdf || !mimeIsAllowed) throw new Error("Seleziona un file PDF valido.");
    if (!file.size) throw new Error("Il PDF selezionato è vuoto.");
    if (file.size > MAX_FILE_SIZE) throw new Error("Il PDF supera il limite massimo di 20 MB.");
  }

  function safeFileName(value) {
    const normalized = String(value || "bolletta.pdf")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 110);
    const base = normalized || "bolletta.pdf";
    return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
  }

  function createUuid() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  async function sha256(file) {
    if (!crypto.subtle) throw new Error("Questo dispositivo non supporta il controllo sicuro dei duplicati.");
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  }

  async function uploadFile(file) {
    if (!client || !currentUser || !currentSubscription || !canUpload()) {
      setMessage("error", "Il caricamento cloud non è disponibile.");
      return;
    }

    try {
      validateFile(file);
    } catch (error) {
      setMessage("error", error.message);
      return;
    }

    const utility = utilities.find(item => item.id === state.utilitySelect?.value);
    if (!utility) {
      setMessage("error", "Seleziona l’utenza da associare alla bolletta.");
      return;
    }

    setBusy(true);
    setMessage("info", "Controllo del PDF e caricamento protetto nel cloud…");

    let storagePath = "";
    try {
      const fingerprint = await sha256(file);
      if (bills.some(bill => bill.file_sha256 && bill.file_sha256 === fingerprint)) {
        throw new Error("Questa bolletta risulta già presente nell’archivio cloud.");
      }

      const billId = createUuid();
      storagePath = `${currentUser.id}/${billId}/${Date.now()}-${safeFileName(file.name)}`;
      const insertResult = await client
        .from("premium_bills")
        .insert({
          id: billId,
          user_id: currentUser.id,
          utility_id: utility.id,
          commodity: utility.supply_type,
          original_file_name: file.name,
          file_size: file.size,
          file_sha256: fingerprint,
          storage_bucket: BUCKET,
          storage_path: storagePath,
          processing_status: "uploaded",
          customer_status: "awaiting_review",
          metadata: {
            source: "premium_app",
            app_version: "0.25"
          }
        })
        .select(BILL_COLUMNS)
        .single();
      if (insertResult.error) throw insertResult.error;

      const uploadResult = await client.storage
        .from(BUCKET)
        .upload(storagePath, file, {
          cacheControl: "3600",
          contentType: "application/pdf",
          upsert: false
        });

      if (uploadResult.error) {
        await client.storage.from(BUCKET).remove([storagePath]);
        await client
          .from("premium_bills")
          .delete()
          .eq("id", billId)
          .eq("user_id", currentUser.id);
        throw uploadResult.error;
      }

      bills = [insertResult.data, ...bills];
      yearlyBillCount += 1;
      renderEnabled();
      setMessage("success", "Bolletta salvata nel cloud e associata all’utenza.");
      window.dispatchEvent(new CustomEvent("offertalogica:cloud-bills-changed"));
    } catch (error) {
      setBusy(false);
      setMessage("error", friendlyError(error));
    } finally {
      if (state.fileInput) state.fileInput.value = "";
    }
  }

  async function openBill(id) {
    const bill = bills.find(item => item.id === id);
    if (!bill || !client || busy) return;

    setBusy(true);
    setMessage("info", "Apertura del PDF cloud…");
    const result = await client.storage.from(BUCKET).download(bill.storage_path);
    setBusy(false);

    if (result.error) {
      setMessage("error", friendlyError(result.error));
      return;
    }

    setMessage("", "");
    try {
      globalThis.OffertaLogicaAppBrowser?.openPdf(result.data, bill.original_file_name, {
        subtitle: "Documento cloud Premium"
      });
    } catch (error) {
      setMessage("error", friendlyError(error));
    }
  }

  async function deleteBill(id) {
    const bill = bills.find(item => item.id === id);
    if (!bill || !client || !currentUser || busy) return;
    if (bill.processing_status !== "uploaded") {
      setMessage("error", "Una bolletta già presa in carico non può essere eliminata dall’app.");
      return;
    }

    const confirmed = window.confirm(`Eliminare definitivamente “${bill.original_file_name}” dall’archivio cloud?`);
    if (!confirmed) return;

    setBusy(true);
    setMessage("info", "Eliminazione della bolletta cloud…");

    const storageResult = await client.storage.from(BUCKET).remove([bill.storage_path]);
    if (storageResult.error) {
      setBusy(false);
      setMessage("error", friendlyError(storageResult.error));
      return;
    }

    const databaseResult = await client
      .from("premium_bills")
      .delete()
      .eq("id", bill.id)
      .eq("user_id", currentUser.id);

    setBusy(false);
    if (databaseResult.error) {
      setMessage("error", "Il PDF è stato rimosso, ma il registro non si è aggiornato. Ricarica la pagina prima di altre operazioni.");
      return;
    }

    bills = bills.filter(item => item.id !== bill.id);
    const createdAt = new Date(bill.created_at).getTime();
    if (Number.isFinite(createdAt) && createdAt >= Date.now() - 365 * 24 * 60 * 60 * 1000) {
      yearlyBillCount = Math.max(0, yearlyBillCount - 1);
    }
    renderEnabled();
    setMessage("success", "Bolletta eliminata dall’archivio cloud.");
    window.dispatchEvent(new CustomEvent("offertalogica:cloud-bills-changed"));
  }

  async function loadData(user, subscription) {
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const [utilitiesResult, billsResult, countResult] = await Promise.all([
      client
        .from("premium_utilities")
        .select(UTILITY_COLUMNS)
        .eq("user_id", user.id)
        .neq("status", "archived")
        .order("created_at", { ascending: true }),
      client
        .from("premium_bills")
        .select(BILL_COLUMNS)
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100),
      client
        .from("premium_bills")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .gte("created_at", oneYearAgo)
    ]);

    if (utilitiesResult.error) throw utilitiesResult.error;
    if (billsResult.error) throw billsResult.error;
    if (countResult.error) throw countResult.error;

    currentUser = user;
    currentSubscription = subscription;
    utilities = Array.isArray(utilitiesResult.data) ? utilitiesResult.data : [];
    bills = Array.isArray(billsResult.data) ? billsResult.data : [];
    yearlyBillCount = Number(countResult.count || 0);
    renderEnabled();
  }

  async function syncSession(session) {
    const sequence = ++syncSequence;
    currentUser = session?.user || null;
    currentSubscription = null;
    utilities = [];
    bills = [];
    yearlyBillCount = 0;

    if (!session?.user) {
      renderLocked("Accedi per usare l’archivio cloud", "Le bollette cloud sono disponibili soltanto con account e abbonamento Premium.", "ACCESSO", "Non collegato");
      return;
    }

    renderLoading();
    const userId = session.user.id;
    const [profileResult, subscriptionResult] = await Promise.all([
      client
        .from("premium_profiles")
        .select("account_status")
        .eq("id", userId)
        .maybeSingle(),
      client
        .from("premium_subscriptions")
        .select("status, current_period_end, included_bills_per_year, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
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

    const profile = profileResult.data;
    const subscription = subscriptionResult.data;
    if (!profile) {
      renderLocked("Profilo Premium non abilitato", "L’account email è valido, ma non risulta associato al servizio Premium.", "DA VERIFICARE", "Non disponibile");
      return;
    }
    if (!subscriptionIsActive(profile, subscription)) {
      renderLocked("Abbonamento necessario", "Archivio cloud e associazione alle utenze richiedono una prova o un abbonamento attivo.", "NON ATTIVO", "Non attivo");
      return;
    }

    try {
      await loadData(session.user, subscription);
    } catch (error) {
      if (sequence !== syncSequence) return;
      renderLocked("Archivio cloud non disponibile", "Il profilo è attivo, ma non è stato possibile caricare le bollette.", "ERRORE", "—");
      setMessage("error", friendlyError(error));
    }
  }

  function collectElements() {
    state.card = byId("premiumCloudBillsCard");
    state.statusBadge = byId("premiumCloudBillsStatus");
    state.quota = byId("premiumCloudBillsQuota");
    state.locked = byId("premiumCloudBillsLocked");
    state.lockedTitle = byId("premiumCloudBillsLockedTitle");
    state.lockedCopy = byId("premiumCloudBillsLockedCopy");
    state.enabled = byId("premiumCloudBillsEnabled");
    state.noUtilities = byId("premiumCloudBillsNoUtilities");
    state.utilitySelect = byId("premiumCloudBillUtility");
    state.fileInput = byId("premiumCloudBillFile");
    state.uploadButton = byId("premiumCloudBillUpload");
    state.uploadButtonLabel = byId("premiumCloudBillUploadLabel");
    state.message = byId("premiumCloudBillMessage");
    state.empty = byId("premiumCloudBillEmpty");
    state.list = byId("premiumCloudBillList");
    state.homeCount = byId("homeCloudBillCount");
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

    state.uploadButton?.addEventListener("click", () => {
      if (!utilities.length) {
        setMessage("error", "Aggiungi prima un’utenza dalla sezione Profilo.");
        return;
      }
      if (yearlyBillCount >= planLimit()) {
        setMessage("error", "Hai raggiunto il numero di bollette incluso negli ultimi 12 mesi.");
        return;
      }
      state.fileInput?.click();
    });

    state.fileInput?.addEventListener("change", () => {
      const file = state.fileInput.files?.[0];
      if (file) uploadFile(file);
    });

    state.list?.addEventListener("click", event => {
      const openButton = event.target.closest("[data-cloud-bill-open]");
      if (openButton) {
        openBill(openButton.dataset.cloudBillOpen);
        return;
      }
      const deleteButton = event.target.closest("[data-cloud-bill-delete]");
      if (deleteButton) deleteBill(deleteButton.dataset.cloudBillDelete);
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

    window.addEventListener("offertalogica:utilities-changed", () => {
      client.auth.getSession().then(({ data }) => syncSession(data.session));
    });

    window.addEventListener("pagehide", () => {
      authSubscription?.data?.subscription?.unsubscribe?.();
    }, { once: true });
  }

  globalThis.OffertaLogicaPremiumBills = Object.freeze({ init });
})();
