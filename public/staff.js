(() => {
  "use strict";

  const SUPABASE_URL = "https://kzxdamhfmzaxonpkytcf.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_poz1xBKiXceLCFV3u_tPIg_5_-ycHcl";
  const STORAGE_KEY = "offertalogica-premium-staff-auth";
  const ALLOWED_ROLES = new Set(["reviewer", "technician", "admin", "owner"]);
  const VALID_TABS = new Set(["overview", "cases", "leads", "checks", "customers", "analytics", "collaborators", "pdf", "costs"]);
  const PREMIUM_APP_URL = "https://premium.offertalogica.it/app.html";
  const PREMIUM_STAFF_BILLING_URL = `${SUPABASE_URL}/functions/v1/premium-staff-billing`;
  const PREMIUM_STAFF_INVITE_URL = `${SUPABASE_URL}/functions/v1/premium-staff-invite`;
  const HUMAN_COST_EUR_PER_HOUR = 30;
  const VERIFIED_COST_PRICING_VERSIONS = new Set(["premium-eur-v0.36.42", "premium-ecb-eur-v0.36.43"]);
  const COST_METRICS_PAGE_SIZE = 1000;

  let client = null;
  let currentSession = null;
  let currentStaff = null;
  let activeTab = "overview";
  let busy = false;
  let authSubscription = null;
  let staffVerificationRequest = null;
  let staffContextKey = "";
  let mfaRedirectInProgress = false;
  let complimentaryCustomer = null;
  let includeRemovedCollaborators = false;
  let collaboratorsLoaded = false;
  let auditLoaded = false;

  const cache = {
    leads: [],
    leadSummary: {},
    analytics: [],
    analyticsSummary: {},
    landingPath: null,
    customers: [],
    checks: [],
    communications: [],
    cases: [],
    runs: [],
    costEvents: [],
    costSummary: {},
    systemConfig: null,
    collaborators: [],
    audit: [],
  };

  const byId = id => document.getElementById(id);

  function confirmAction({ title = "Conferma operazione", message = "", keyword = "", confirmLabel = "CONFERMA" } = {}) {
    const layer = byId("staffConfirmLayer");
    if (!layer) return Promise.resolve(false);
    const normalizedKeyword = String(keyword || "").trim().toUpperCase();
    const input = byId("staffConfirmKeyword");
    const keywordWrap = byId("staffConfirmKeywordWrap");
    const error = byId("staffConfirmError");
    text(byId("staffConfirmTitle"), title);
    text(byId("staffConfirmMessage"), message);
    text(byId("staffConfirmKeywordLabel"), normalizedKeyword);
    text(byId("staffConfirmAccept"), confirmLabel);
    keywordWrap.hidden = !normalizedKeyword;
    input.value = "";
    error.textContent = "";
    layer.hidden = false;

    return new Promise(resolve => {
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        layer.hidden = true;
        document.removeEventListener("keydown", onKeydown);
        resolve(Boolean(result));
      };
      const validate = () => {
        if (normalizedKeyword && input.value.trim().toUpperCase() !== normalizedKeyword) {
          error.textContent = `Scrivi ${normalizedKeyword} per continuare.`;
          input.focus();
          return;
        }
        finish(true);
      };
      const onKeydown = event => {
        if (event.key === "Escape") finish(false);
        if (event.key === "Enter" && (!normalizedKeyword || document.activeElement === input)) validate();
      };
      byId("staffConfirmCancel").onclick = () => finish(false);
      byId("staffConfirmAccept").onclick = validate;
      layer.onclick = event => { if (event.target === layer) finish(false); };
      document.addEventListener("keydown", onKeydown);
      window.setTimeout(() => (normalizedKeyword ? input : byId("staffConfirmAccept"))?.focus(), 0);
    });
  }

  window.OffertaLogicaStaffConfirm = confirmAction;

  function text(element, value) {
    if (!element) return;
    const next = value == null ? "" : String(value);
    if (element.textContent !== next) element.textContent = next;
  }

  function clear(element) {
    if (element) element.replaceChildren();
  }

  function node(tag, options = {}, children = []) {
    const element = document.createElement(tag);
    if (options.className) element.className = options.className;
    if (options.text != null) element.textContent = String(options.text);
    if (options.type) element.type = options.type;
    if (options.value != null) element.value = String(options.value);
    if (options.dataset) Object.entries(options.dataset).forEach(([key, value]) => { element.dataset[key] = String(value); });
    if (options.attrs) Object.entries(options.attrs).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== false) element.setAttribute(key, String(value));
    });
    (Array.isArray(children) ? children : [children]).filter(Boolean).forEach(child => element.append(child));
    return element;
  }

  function badge(label, kind = "") {
    return node("span", { className: `badge${kind ? ` ${kind}` : ""}`, text: label });
  }

  function formatDate(value, includeTime = true) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("it-IT", includeTime ? {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
    } : { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  }

  function formatMoney(value, fallback = "—") {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return fallback;
    return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(amount);
  }

  function formatNumber(value, digits = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "0";
    return new Intl.NumberFormat("it-IT", { maximumFractionDigits: digits }).format(number);
  }

  function roleLabel(role) {
    return {
      owner: "Proprietario",
      admin: "Amministratore",
      technician: "Tecnico",
      reviewer: "Revisore",
    }[String(role || "").trim().toLowerCase()] || "Staff";
  }

  function friendlyError(error) {
    const raw = String(error?.message || error || "").trim();
    const message = raw.toLowerCase();
    if (!message) return "Operazione non riuscita.";
    if (message.includes("invalid login credentials")) return "Email o password non corrette.";
    if (message.includes("email not confirmed")) return "L’indirizzo email non è stato confermato.";
    if (message.includes("account staff non autorizzato") || message.includes("ruolo staff non autorizzato")) return "L’account non è autorizzato a questo modulo.";
    if (message.includes("sessione staff")) return "La sessione staff non è più valida. Accedi nuovamente.";
    if (message.includes("failed to fetch") || message.includes("network")) return "Connessione non disponibile. Controlla la rete e riprova.";
    if (message.includes("premium_staff_account_delete_blocked")) return "Un blocco selezionato appartiene a un account staff attivo e non può essere eliminato da questa funzione.";
    if (message.includes("premium_delete_limit_exceeded")) return "La selezione supera 500 elementi. Riduci il filtro e riprova.";
    if (message.includes("premium_account_deletion_not_requested")) return "L’account non ha una richiesta di cancellazione attiva.";
    if (message.includes("premium_account_storage_not_empty")) return "I PDF dell’account non sono stati rimossi dal bucket. Riprova dopo la cancellazione dei file.";
    if (message.includes("premium_account_delete_confirmation_required")) return "Conferma di cancellazione account non valida.";
    if (message.includes("premium_admin_required")) return "Questa funzione è riservata agli amministratori.";
    if (message.includes("stripe_subscription_not_linked") || message.includes("premium_subscription_missing")) return "Questo cliente non ha un abbonamento Stripe collegato da sincronizzare.";
    if (message.includes("stripe_subscription_mismatch") || message.includes("stripe_customer_mismatch") || message.includes("stripe_user_mismatch")) return "I riferimenti Stripe non corrispondono al cliente. Nessun aggiornamento è stato eseguito.";
    if (message.includes("stripe_read_failed")) return "Stripe non ha restituito lo stato dell’abbonamento. Riprova tra poco.";
    if (message.includes("stripe_secret_key_missing")) return "La chiave Stripe del backend non è configurata.";
    if (message.includes("premium_complimentary_profile_not_active")) return "Il profilo cliente non è attivo.";
    if (message.includes("premium_complimentary_duration_invalid")) return "Durata dell’omaggio non valida.";
    if (message.includes("premium_complimentary_paid_subscription_conflict")) return "Il cliente ha già un abbonamento Stripe attivo o da regolarizzare. L’omaggio non può sostituirlo.";
    if (message.includes("premium_complimentary_active_subscription_not_found")) return "Non risulta un Premium omaggio attivo da revocare.";
    if (message.includes("premium_account_not_found")) return "Account Auth non trovato per questo cliente.";
    if (message.includes("premium_staff_required")) return "Questa verifica è riservata allo staff autorizzato.";
    if (message.includes("premium_owner_required")) return "Questa funzione è riservata al Proprietario.";
    if (message.includes("premium_owner_protected")) return "Il Proprietario è protetto e non può essere modificato.";
    if (message.includes("staff_reporting_source_type_invalid") || message.includes("staff_reporting_source_id_invalid")) return "Riferimento del dato sorgente non valido.";
    if (message.includes("staff_reporting_exclusion_reason_required")) return "Serve una motivazione per escludere il dato dai calcoli.";
    if (message.includes("staff_management_month_invalid")) return "Mese gestionale non valido.";
    if (message.includes("premium_staff_auth_user_not_found")) return "Nessun account Auth trovato con questa email.";
    if (message.includes("premium_staff_email_invalid")) return "Inserisci un indirizzo email valido.";
    if (message.includes("premium_staff_role_invalid")) return "Ruolo collaboratore non valido.";
    if (message.includes("premium_staff_member_not_found")) return "Collaboratore non trovato.";
    if (message.includes("premium_staff_remove_reason_required")) return "Impossibile rimuovere il collaboratore senza una motivazione.";
    if (message.includes("premium_staff_already_removed")) return "Il collaboratore risulta già rimosso.";
    if (message.includes("premium_staff_not_removed")) return "Il collaboratore non risulta rimosso.";
    if (message.includes("premium_staff_purge_confirmation_required")) return "Conferma di eliminazione definitiva non valida.";
    if (message.includes("premium_staff_purge_requires_removed")) return "Prima di eliminarlo definitivamente, il collaboratore deve risultare già rimosso.";
    if (message.includes("premium_staff_history_present")) return "Eliminazione definitiva bloccata: il collaboratore ha attività storica reale. Può restare rimosso, ma il suo storico non può essere cancellato.";
    if (message.includes("premium_staff_update_failed")) return "Aggiornamento collaboratore non riuscito.";
    if (message.includes("premium_staff_auth_user_exists")) return "Esiste già un account Auth con questa email. Usa “Aggiungi esistente”.";
    if (message.includes("premium_staff_invite_redirect_invalid")) return "Origine Staff non valida per il link di invito.";
    if (message.includes("premium_staff_invite_failed")) return "Supabase non ha inviato l’invito. Controlla configurazione email e Redirect URLs.";
    if (message.includes("premium_staff_membership_create_failed")) return "Invito annullato: non è stato possibile creare il ruolo Staff.";
    if (message.includes("supabase_admin_configuration_missing")) return "La funzione inviti Staff non ha le credenziali backend Supabase.";
    if (message.includes("rate limit") || message.includes("too many requests")) return "Troppe email richieste in poco tempo. Attendi qualche minuto e riprova.";
    if (message.includes("row-level security") || message.includes("permission denied")) return "Operazione non autorizzata dalle regole di sicurezza.";
    return raw;
  }

  function setMessage(kind, message) {
    const element = byId("staffPageMessage");
    if (!element) return;
    element.className = `message${kind ? ` ${kind}` : ""}`;
    element.textContent = message || "";
    element.hidden = !message;
  }

  function setAuthMessage(kind, message) {
    const element = byId("staffAuthMessage");
    if (!element) return;
    element.className = `message${kind ? ` ${kind}` : ""}`;
    element.textContent = message || "";
    element.hidden = !message;
  }

  function setBusy(value) {
    busy = Boolean(value);
    document.body.setAttribute("aria-busy", busy ? "true" : "false");
    document.querySelectorAll("button, input, select, textarea").forEach(element => {
      if (element.closest("#staffLoginForm") && !currentStaff) element.disabled = busy;
      else if (element.closest("#staffApp") || element.closest("#staffTopActions")) element.disabled = busy;
    });
  }

  function setHidden(element, hidden) {
    if (element && element.hidden !== Boolean(hidden)) element.hidden = Boolean(hidden);
  }

  function setView(mode) {
    setHidden(byId("staffAuthView"), mode !== "auth");
    setHidden(byId("staffDeniedView"), mode !== "denied");
    setHidden(byId("staffApp"), mode !== "app");
    setHidden(byId("staffTopActions"), mode !== "app");
  }

  async function accessToken() {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const token = data?.session?.access_token;
    if (!token) throw new Error("Sessione staff richiesta");
    return token;
  }

  async function staffFetch(path, options = {}) {
    const token = await accessToken();
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(path, { ...options, headers });
    const contentType = response.headers.get("content-type") || "";
    if (options.expectBlob) {
      if (!response.ok) {
        const payload = contentType.includes("application/json") ? await response.json().catch(() => ({})) : {};
        throw new Error(payload.error || `Errore HTTP ${response.status}`);
      }
      return response.blob();
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || payload.status || `Errore HTTP ${response.status}`);
    return payload;
  }

  function isAdmin() {
    return ["admin", "owner"].includes(String(currentStaff?.role || "").trim().toLowerCase());
  }

  function isOwner() {
    return String(currentStaff?.role || "").trim().toLowerCase() === "owner";
  }

  function uniqueValues(values = []) {
    return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
  }

  function requireTypedConfirmation(message, keyword = "ELIMINA") {
    return confirmAction({ title: "Conferma eliminazione", message, keyword, confirmLabel: "ELIMINA" });
  }

  async function deletePremiumRecords(resource, ids) {
    if (!isAdmin()) throw new Error("Operazione riservata agli amministratori.");
    const cleanIds = uniqueValues(ids);
    if (!cleanIds.length) throw new Error("Nessun elemento da eliminare.");
    const { data, error } = await client.rpc("premium_staff_delete_records", {
      p_resource: resource,
      p_ids: cleanIds,
    });
    if (error) throw error;
    return data || { deleted_count: cleanIds.length };
  }

  async function listManagementSourceData(month) {
    if (!isOwner()) throw new Error("premium_owner_required");
    const normalizedMonth = String(month || "").trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(normalizedMonth)) throw new Error("staff_management_month_invalid");
    const { data, error } = await client.rpc("premium_owner_management_source_data", { p_month: normalizedMonth });
    if (error) throw error;
    return data || { ok: true, month: normalizedMonth, rows: [] };
  }

  async function setReportingExclusion(sourceType, sourceId, excluded, label = "dato") {
    if (!isOwner() || busy) return false;
    const type = String(sourceType || "").trim();
    const id = String(sourceId || "").trim();
    if (!type || !id) return false;
    const isExclusion = Boolean(excluded);
    const confirmed = await confirmAction(isExclusion ? {
      title: "Escludi dai calcoli e dalle statistiche",
      message: `Escludere “${label || id}” dal Gestionale? Il record resterà nel database e nell’audit, ma non contribuirà più ai KPI ufficiali.`,
      keyword: "ESCLUDI",
      confirmLabel: "ESCLUDI",
    } : {
      title: "Riattiva nei calcoli",
      message: `Riammettere “${label || id}” nei calcoli e nelle statistiche ufficiali?`,
      confirmLabel: "RIATTIVA",
    });
    if (!confirmed) return false;
    setBusy(true);
    try {
      const { error } = await client.rpc("premium_owner_set_reporting_exclusion", {
        p_source_type: type,
        p_source_id: id,
        p_excluded: isExclusion,
        p_reason: isExclusion ? "Dato escluso dai calcoli/statistiche dal Proprietario nel Control Center" : "",
      });
      if (error) throw error;
      setMessage("success", isExclusion ? "Dato escluso dai calcoli e dalle statistiche. Il record originale resta conservato." : "Dato riammesso nei calcoli e nelle statistiche.");
      window.dispatchEvent(new Event("offertalogica:staff-save-complete"));
      window.dispatchEvent(new CustomEvent("offertalogica:management-source-changed", { detail: { sourceType: type, sourceId: id, excluded: isExclusion } }));
      return true;
    } catch (error) {
      setMessage("error", friendlyError(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function reportingExclusionButton(sourceType, sourceId, label = "dato") {
    if (!isOwner() || !sourceId) return null;
    const button = node("button", { className: "button secondary compact", type: "button", text: "Escludi dai calcoli" });
    button.title = "Conserva il record ma lo esclude dai KPI e dalle statistiche ufficiali";
    button.addEventListener("click", () => void setReportingExclusion(sourceType, sourceId, true, label));
    return button;
  }

  window.OffertaLogicaStaffDataControl = Object.freeze({
    list: listManagementSourceData,
    exclude: (sourceType, sourceId, label) => setReportingExclusion(sourceType, sourceId, true, label),
    restore: (sourceType, sourceId, label) => setReportingExclusion(sourceType, sourceId, false, label),
  });

  async function removePremiumStorage(paths = []) {
    const uniquePaths = uniqueValues(paths.map(value => String(value || "").trim()).filter(Boolean));
    if (!uniquePaths.length) return { removed: 0 };
    const { error } = await client.storage.from("premium-bills").remove(uniquePaths);
    if (error) throw error;
    return { removed: uniquePaths.length };
  }

  async function runDestructiveAction(action, successMessage) {
    if (!isAdmin() || busy) return;
    setBusy(true);
    setMessage("info", "Eliminazione in corso…");
    try {
      await action();
      setMessage("success", successMessage);
    } catch (error) {
      setMessage("error", friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  function setTab(name, { updateHash = true, refresh = true } = {}) {
    const requested = VALID_TABS.has(name) ? name : "overview";
    const target = requested === "collaborators" && !isOwner() ? "overview" : requested;
    activeTab = target;
    document.querySelectorAll("[data-staff-tab]").forEach(button => button.classList.toggle("active", button.dataset.staffTab === target));
    document.querySelectorAll("[data-staff-view]").forEach(view => view.classList.toggle("active", view.dataset.staffView === target));
    if (updateHash) history.replaceState(null, "", `#${target}`);
    setMessage("", "");
    if (target === "checks") ensureFrame("checksFrame");
    if (target === "pdf") ensureFrame("pdfFrame");
    if (refresh) refreshTab(target, { silent: true }).catch(error => setMessage("error", friendlyError(error)));
  }

  function ensureFrame(id) {
    const frame = byId(id);
    if (frame && !frame.getAttribute("src")) frame.src = frame.dataset.src;
  }

  function leadSearchText(lead) {
    return [lead.name, lead.email, lead.phone, lead.source, lead.dataOrigin, lead.selectedOffer?.provider, lead.selectedOffer?.name]
      .filter(Boolean).join(" ").toLowerCase();
  }

  function monetizationText(monetization = {}) {
    const status = String(monetization.status || "").toLowerCase();
    if (["commission_approved", "commission_confirmed", "paid", "pagato"].includes(status)) return { label: "Entrata confermata", kind: "ok" };
    if (status === "ready_to_redirect") return { label: "Click fornitore", kind: "warn" };
    if (status === "partner_request_recorded") return { label: "Richiesta registrata", kind: "warn" };
    return { label: "Nessuna entrata confermata", kind: "" };
  }

  function renderLeadMetrics() {
    const summary = cache.leadSummary || {};
    text(byId("leadMetricTotal"), summary.recentRows || 0);
    text(byId("leadMetricVerified"), summary.verifiedRows || 0);
    text(byId("leadMetricOffers"), summary.withSelectedOffer || 0);
    text(byId("leadMetricRevenue"), formatMoney(summary.confirmedRevenue || 0, "€ 0,00"));
    text(byId("navLeadCount"), summary.recentRows || 0);
  }

  function filteredLeadRows() {
    const query = String(byId("leadSearch")?.value || "").trim().toLowerCase();
    return cache.leads.filter(lead => !query || leadSearchText(lead).includes(query));
  }

  function renderLeads() {
    const body = byId("leadRows");
    clear(body);
    const rows = filteredLeadRows();
    if (!rows.length) {
      body.append(node("tr", {}, [node("td", { text: cache.leads.length ? "Nessun lead corrisponde alla ricerca." : "Nessun lead disponibile.", attrs: { colspan: "8" } })]));
      return;
    }
    rows.forEach(lead => {
      const offer = lead.selectedOffer || {};
      const consents = lead.consents || {};
      const money = monetizationText(lead.monetization);
      const detailsButton = node("button", { className: "button secondary compact", type: "button", text: "Copia dati" });
      detailsButton.addEventListener("click", () => copyLeadData(lead));
      const deleteButton = node("button", { className: "button danger compact", type: "button", text: "Elimina" });
      deleteButton.addEventListener("click", () => deleteLead(lead));
      const supply = lead.currentSupply || {};
      const originCell = node("td", {}, [
        node("strong", { text: lead.dataOrigin || lead.source || "—" }),
        node("small", { text: `PDF ${lead.pdfDocumentCount || 0} · ${supply.provider || "fornitore non indicato"}` }),
        node("small", { text: [supply.luceConsumoKwh ? `${supply.luceConsumoKwh} kWh` : "", supply.gasConsumoSmc ? `${supply.gasConsumoSmc} Smc` : ""].filter(Boolean).join(" · ") || "Consumi non disponibili" })
      ]);
      body.append(node("tr", {}, [
        node("td", {}, [node("strong", { text: formatDate(lead.createdAt) }), node("small", { text: lead.id || "" })]),
        node("td", {}, [node("strong", { text: lead.name || "Cliente" }), badge(lead.status || "—", lead.status === "verified" ? "ok" : "info"), node("small", { text: lead.customerType || "—" })]),
        node("td", {}, [node("strong", { text: lead.phone || "—" }), node("small", { text: lead.email || "—" })]),
        originCell,
        node("td", {}, [node("strong", { text: offer.provider || "—" }), node("small", { text: offer.name || "Nessuna offerta scelta" }), node("small", { text: offer.destinationStatus || "" })]),
        node("td", {}, [badge(`servizio ${consents.service ? "sì" : "no"}`, consents.service ? "ok" : "warn"), document.createTextNode(" "), badge(`partner ${consents.partners ? "sì" : "no"}`, consents.partners ? "ok" : "warn")]),
        node("td", {}, [badge(money.label, money.kind), node("small", { text: lead.monetization?.expectedCommission == null ? "" : `Potenziale ${formatMoney(lead.monetization.expectedCommission)}` })]),
        node("td", {}, [node("div", { className: "row-actions" }, [detailsButton, deleteButton])])
      ]));
    });
  }

  async function loadLeads({ silent = false } = {}) {
    const restricted = !isAdmin();
    byId("leadRestricted").hidden = !restricted;
    byId("leadContent").hidden = restricted;
    if (restricted) {
      cache.leads = [];
      cache.leadSummary = {};
      renderLeadMetrics();
      return;
    }
    if (!silent) setMessage("info", "Aggiornamento lead…");
    const limit = byId("leadLimit")?.value || "50";
    const payload = await staffFetch(`/api/staff-leads?limit=${encodeURIComponent(limit)}`);
    cache.leads = Array.isArray(payload.leads) ? payload.leads : [];
    cache.leadSummary = payload.summary || {};
    renderLeadMetrics();
    renderLeads();
    if (!silent) setMessage("success", "Lead aggiornati.");
  }

  async function copyLeadData(lead) {
    const payload = JSON.stringify({
      id: lead.id,
      customer: { name: lead.name, email: lead.email, phone: lead.phone },
      currentSupply: lead.currentSupply || {},
      comparisonProfile: lead.comparisonProfile || {},
      selectedOffer: lead.selectedOffer || null,
      pdfData: lead.pdfData || {},
      pdfDocuments: lead.pdfDocuments || [],
    }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      setMessage("success", "Dati tecnici del lead copiati.");
    } catch {
      setMessage("error", "Copia non disponibile su questo browser.");
    }
  }

  async function deleteLead(lead) {
    if (!isAdmin() || busy) return;
    if (!(await confirmAction({ title: "Elimina contatto", message: `Eliminare definitivamente “${lead.name || lead.id}”?`, confirmLabel: "ELIMINA" }))) return;
    setBusy(true);
    try {
      await staffFetch(`/api/staff-leads?id=${encodeURIComponent(lead.id)}`, {
        method: "DELETE",
        headers: { "X-Staff-Confirmation": "ELIMINA_LEAD" },
      });
      await Promise.allSettled([loadLeads({ silent: true }), loadAnalytics({ silent: true })]);
      setMessage("success", "Lead eliminato.");
    } catch (error) {
      setMessage("error", friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteVisibleLeads() {
    if (!isAdmin() || busy) return;
    const rows = filteredLeadRows();
    if (!rows.length) {
      setMessage("error", "Nessun lead visibile da eliminare.");
      return;
    }
    if (!(await requireTypedConfirmation(`Eliminare definitivamente ${rows.length} lead visibili e gli eventi collegati?`, "ELIMINA"))) return;
    await runDestructiveAction(async () => {
      const payload = await staffFetch("/api/staff-leads", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "X-Staff-Confirmation": "ELIMINA_LEAD_VISIBILI" },
        body: JSON.stringify({ ids: rows.map(lead => lead.id) }),
      });
      await loadLeads({ silent: true });
      await loadAnalytics({ silent: true });
      return payload;
    }, `${rows.length} lead visibili eliminati.`);
  }

  async function resetLeads() {
    if (!isAdmin() || busy) return;
    if (!(await confirmAction({ title: "Azzera archivio lead", message: "Eliminare tutti i contatti e gli eventi collegati?", keyword: "AZZERA", confirmLabel: "AZZERA" }))) return;
    setBusy(true);
    try {
      const payload = await staffFetch("/api/staff-leads?scope=all", {
        method: "DELETE",
        headers: { "X-Staff-Confirmation": "AZZERA_LEAD" },
      });
      await Promise.allSettled([loadLeads({ silent: true }), loadAnalytics({ silent: true })]);
      setMessage("success", `Archivio lead azzerato: ${payload.deletedCount || 0} contatti rimossi.`);
    } catch (error) {
      setMessage("error", friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  async function downloadLeadCsv() {
    if (!isAdmin()) return;
    try {
      const limit = byId("leadLimit")?.value || "200";
      await recordExportAudit("leads", { targetId: limit, metadata: { limit: Number(limit) || 0 } });
      const blob = await staffFetch(`/api/staff-leads?limit=${encodeURIComponent(limit)}&format=csv`, { expectBlob: true });
      const url = URL.createObjectURL(blob);
      const link = node("a", { attrs: { href: url, download: `offertalogica-leads-${new Date().toISOString().slice(0, 10)}.csv` } });
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage("success", "CSV generato.");
    } catch (error) {
      setMessage("error", friendlyError(error));
    }
  }

  const activityFunnelDefinitions = [
    ["pdfStarted", "PDF avviati"], ["pdfCompleted", "PDF letti"], ["comparisons", "Confronti reali"],
    ["landingPreviews", "Anteprime automatiche landing"], ["leadModalOpened", "Popup aperti"], ["otpSent", "OTP inviati"], ["otpVerified", "OTP verificati"],
    ["offersUnlocked", "Offerte sbloccate"], ["offerConsentOpened", "Offerte cliccate"],
    ["partnerConsentConfirmed", "Consensi partner"], ["redirects", "Redirect"],
    ["consultantRequests", "Richieste assistite"], ["failedRequests", "Errori richiesta"]
  ];
  const sessionFunnelDefinitions = [
    ["entries", "Ingressi attribuiti"], ["comparisons", "Almeno 1 confronto reale"],
    ["leadModalOpened", "Popup lead"], ["otpSent", "OTP inviato"],
    ["otpVerified", "OTP verificato"], ["offersUnlocked", "Offerta sbloccata"]
  ];

  function renderActivityFunnel(target, funnel = {}) {
    clear(target);
    activityFunnelDefinitions.forEach(([key, label]) => target.append(node("div", { className: "funnel-step" }, [
      node("strong", { text: funnel[key] || 0 }), node("span", { text: label })
    ])));
  }

  function renderSessionFunnel(target, funnel = {}) {
    clear(target);
    const entries = Number(funnel.entries || 0);
    sessionFunnelDefinitions.forEach(([key, label]) => {
      const count = Number(funnel[key] || 0);
      const share = entries && key !== "entries" ? `${formatNumber((count / entries) * 100, 1)}% degli ingressi` : "Sessioni uniche";
      target.append(node("div", { className: "funnel-step" }, [
        node("strong", { text: count }), node("span", { text: label }), node("small", { text: share })
      ]));
    });
  }

  function renderRankList(target, rows = [], emptyLabel = "Nessun dato") {
    clear(target);
    if (!rows.length) {
      target.append(node("div", { className: "empty", text: emptyLabel }));
      return;
    }
    rows.forEach(item => target.append(node("div", { className: "rank-row" }, [node("strong", { text: item.key }), node("span", { text: item.count })])));
  }

  function ensureLandingTrafficMetrics() {
    let target = byId("landingTrafficMetrics");
    if (target) return target;

    const anchor = byId("landingPathSelections")?.closest(".landing-path-metrics");
    if (!anchor) return null;

    const selectionCard = byId("landingPathSelections")?.closest(".metric");
    if (selectionCard) {
      text(selectionCard.querySelector("span"), "Scelte probabili persone");
      text(selectionCard.querySelector("small"), "Click sui due percorsi classificati come probabile persona");
    }

    target = node("div", {
      className: "metrics landing-path-traffic-metrics",
      attrs: { id: "landingTrafficMetrics", "aria-label": "Classificazione impressioni landing" },
    }, [
      node("article", { className: "metric priority" }, [
        node("span", { text: "Probabili persone" }),
        node("strong", { text: "—", attrs: { id: "landingTrafficProbable" } }),
        node("small", { text: "Browser standard con interazione esplicita" }),
      ]),
      node("article", { className: "metric technical" }, [
        node("span", { text: "Automazioni / bot" }),
        node("strong", { text: "—", attrs: { id: "landingTrafficSuspicious" } }),
        node("small", { text: "—", attrs: { id: "landingTrafficSuspiciousDetail" } }),
      ]),
      node("article", { className: "metric technical" }, [
        node("span", { text: "Non determinabili" }),
        node("strong", { text: "—", attrs: { id: "landingTrafficUndetermined" } }),
        node("small", { text: "Firma o comportamento non sufficienti" }),
      ]),
      node("article", { className: "metric" }, [
        node("span", { text: "Quota probabili persone" }),
        node("strong", { text: "—", attrs: { id: "landingTrafficProbableShare" } }),
        node("small", { text: "Sul totale delle impressioni landing" }),
      ]),
    ]);
    anchor.insertAdjacentElement("afterend", target);
    return target;
  }

  function renderLandingTraffic() {
    if (!ensureLandingTrafficMetrics()) return;
    const landing = cache.landingPath;
    const traffic = landing?.traffic || {};
    const available = Boolean(landing?.ok && landing?.configured !== false);
    const probable = Number(traffic.probablePersonViews);
    const knownBot = Number(traffic.knownBotViews);
    const automation = Number(traffic.automationViews);
    const suspicious = Number(traffic.suspiciousViews);
    const undetermined = Number(traffic.undeterminedViews);
    const probableShare = traffic.probablePersonShare == null ? null : Number(traffic.probablePersonShare);

    text(byId("landingTrafficProbable"), available && Number.isFinite(probable) ? formatNumber(probable) : "—");
    text(byId("landingTrafficSuspicious"), available && Number.isFinite(suspicious) ? formatNumber(suspicious) : "—");
    text(byId("landingTrafficUndetermined"), available && Number.isFinite(undetermined) ? formatNumber(undetermined) : "—");
    text(byId("landingTrafficProbableShare"), available && Number.isFinite(probableShare) ? `${formatNumber(probableShare, 1)}%` : "—");
    text(byId("landingTrafficSuspiciousDetail"), available
      ? `Bot ${formatNumber(knownBot)} · automazioni ${formatNumber(automation)}`
      : "Classificazione non disponibile");
  }

  const LEAD_OTP_EVENT_TYPES = new Set([
    "lead_modal_opened", "lead_modal_closed", "lead_form_invalid", "otp_request_started",
    "lead_created_client", "otp_sent", "otp_failed", "otp_verified"
  ]);

  function analyticsOrigin(event = {}) {
    return String(event.dataOrigin || "").trim();
  }

  function populateAnalyticsFilters() {
    const eventSelect = byId("analyticsEventFilter");
    const originSelect = byId("analyticsOriginFilter");
    if (!eventSelect || !originSelect) return;

    const selectedEvent = eventSelect.value;
    const selectedOrigin = originSelect.value;
    const eventTypes = [...new Set(cache.analytics.map(event => String(event.eventType || "").trim()).filter(Boolean))].sort();
    const origins = [...new Set(cache.analytics.map(analyticsOrigin).filter(Boolean))].sort();

    eventSelect.replaceChildren(
      node("option", { value: "", text: "Tutti gli eventi" }),
      node("option", { value: "__lead_otp__", text: "Solo funnel lead / OTP" }),
      ...eventTypes.map(value => node("option", { value, text: value }))
    );
    originSelect.replaceChildren(
      node("option", { value: "", text: "Tutte le origini" }),
      ...origins.map(value => node("option", { value, text: value }))
    );
    eventSelect.value = eventTypes.includes(selectedEvent) || selectedEvent === "__lead_otp__" ? selectedEvent : "";
    originSelect.value = origins.includes(selectedOrigin) ? selectedOrigin : "";
  }

  function filteredAnalyticsEvents() {
    const eventFilter = String(byId("analyticsEventFilter")?.value || "");
    const originFilter = String(byId("analyticsOriginFilter")?.value || "");
    return cache.analytics.filter(event => {
      const eventType = String(event.eventType || "");
      const eventMatches = !eventFilter
        || (eventFilter === "__lead_otp__" ? LEAD_OTP_EVENT_TYPES.has(eventType) : eventType === eventFilter);
      const originMatches = !originFilter || analyticsOrigin(event) === originFilter;
      return eventMatches && originMatches;
    });
  }

  function renderAnalytics() {
    const summary = cache.analyticsSummary || {};
    const activityFunnel = summary.funnel || {};
    const sessionFunnel = summary.sessionFunnel || {};
    text(byId("analyticsEvents"), summary.recentEvents || 0);
    text(byId("analyticsSessions"), summary.attributedSessions || sessionFunnel.entries || 0);
    text(byId("analyticsLinkedLeads"), summary.linkedLeads || 0);
    text(byId("analyticsOtpRate"), sessionFunnel.otpSent ? `${Math.round((Number(sessionFunnel.otpVerified || 0) / Number(sessionFunnel.otpSent)) * 100)}%` : "—");
    renderSessionFunnel(byId("analyticsFunnel"), sessionFunnel);
    renderActivityFunnel(byId("analyticsActivity"), activityFunnel);
    renderRankList(byId("analyticsProviders"), summary.topProviders || [], "Nessun provider cliccato");
    renderRankList(byId("analyticsOffers"), summary.topOffers || [], "Nessuna offerta cliccata");
    renderRankList(byId("analyticsTrafficSources"), (summary.trafficSources || []).map((item) => ({ key: item.label || item.key, count: item.count })), "Nessuna sessione dal punto zero");
    const baseline = cache.analyticsBaseline || {};
    text(byId("analyticsBaseline"), baseline.label ? `Punto zero campagna: ${baseline.label}` : "Punto zero campagna");
    renderLandingTraffic();

    populateAnalyticsFilters();
    const filteredEvents = filteredAnalyticsEvents();
    const body = byId("analyticsRows");
    clear(body);
    text(byId("analyticsFilterInfo"), `${formatNumber(filteredEvents.length)} visibili su ${formatNumber(cache.analytics.length)} eventi caricati`);
    if (!filteredEvents.length) {
      body.append(node("tr", {}, [node("td", { text: "Nessun evento corrisponde ai filtri selezionati.", attrs: { colspan: "7" } })]));
      return;
    }
    filteredEvents.slice(0, 200).forEach(event => {
      const values = [
        event.bestSaving != null ? `risparmio ${formatMoney(event.bestSaving)}` : "",
        event.annualCost != null ? `costo ${formatMoney(event.annualCost)}` : "",
        event.visibleOffersCount != null ? `${event.visibleOffersCount} offerte` : "",
        event.fileCount != null ? `${event.fileCount} file` : "",
      ].filter(Boolean).join(" · ") || "—";
      const deleteButton = node("button", { className: "button danger compact", type: "button", text: "Elimina" });
      deleteButton.hidden = !isAdmin();
      deleteButton.addEventListener("click", () => deleteAnalyticsEvent(event));
      body.append(node("tr", {}, [
        node("td", {}, [node("strong", { text: formatDate(event.createdAt) }), node("small", { text: `#${event.id}` })]),
        node("td", {}, [badge(event.eventType || "—", "info"), node("small", { text: event.reason || "" })]),
        node("td", {}, [node("strong", { text: event.trafficSource || event.dataOrigin || event.source || "—" }), node("small", { text: [event.trafficCampaign, event.dataOrigin, event.page].filter(Boolean).join(" · ") })]),
        node("td", {}, [node("strong", { text: [event.provider, event.offerName].filter(Boolean).join(" · ") || "—" }), node("small", { text: event.destinationStatus || "" })]),
        node("td", { text: values }),
        node("td", {}, [badge(event.leadId ? "collegato" : "anonimo", event.leadId ? "ok" : "warn"), node("small", { text: event.leadId || "" })]),
        node("td", {}, [deleteButton])
      ]));
    });
  }

  async function deleteAnalyticsEvent(event) {
    if (!isAdmin() || busy) return;
    if (!(await confirmAction({ title: "Elimina evento", message: `Eliminare l’evento analytics #${event.id}?`, confirmLabel: "ELIMINA" }))) return;
    await runDestructiveAction(async () => {
      await staffFetch(`/api/staff-analytics?id=${encodeURIComponent(event.id)}`, {
        method: "DELETE",
        headers: { "X-Staff-Confirmation": "ELIMINA_EVENTO" },
      });
      await loadAnalytics({ silent: true });
    }, "Evento analytics eliminato.");
  }





  async function loadAnalytics({ silent = false } = {}) {
    if (!silent) setMessage("info", "Aggiornamento analytics…");
    const landingRange = String(byId("landingPathRange")?.value || "30d");
    const payload = await staffFetch(`/api/staff-analytics?limit=2000&landingRange=${encodeURIComponent(landingRange)}`);
    cache.analytics = Array.isArray(payload.events) ? payload.events : [];
    cache.analyticsSummary = payload.summary || {};
    cache.landingPath = payload.landingPath || null;
    cache.analyticsBaseline = payload.baseline || null;
    renderAnalytics();
    renderSessionFunnel(byId("overviewFunnel"), cache.analyticsSummary.sessionFunnel || {});
    if (!silent) setMessage("success", "Analytics aggiornati.");
  }

  function addressLabel(address) {
    if (!address || typeof address !== "object") return "—";
    return address.formatted || [address.street, address.city, address.province].filter(Boolean).join(", ") || "—";
  }

  function customerSearchText(customer) {
    return [customer.profile.full_name, customer.profile.email, customer.profile.phone,
      ...customer.utilities.flatMap(item => [item.label, item.provider_name, item.pod, item.pdr]),
      ...customer.contracts.flatMap(item => [item.provider_name, item.offer_name]),
      ...customer.bills.flatMap(item => [item.original_file_name, item.commodity])]
      .filter(Boolean).join(" ").toLowerCase();
  }

  function filteredCustomers() {
    const query = String(byId("customerSearch")?.value || "").trim().toLowerCase();
    const status = String(byId("customerStatus")?.value || "");
    return cache.customers.filter(customer => {
      if (query && !customerSearchText(customer).includes(query)) return false;
      if (status && customer.profile.account_status !== status) return false;
      return true;
    });
  }

  function complimentaryIsActive(subscription) {
    if (!subscription || subscription.plan_code !== "premium-complimentary" || subscription.status !== "active") return false;
    if (!subscription.current_period_end) return true;
    const end = new Date(subscription.current_period_end);
    return !Number.isNaN(end.getTime()) && end > new Date();
  }

  function paidSubscriptionConflicts(subscription) {
    return Boolean(subscription?.provider === "stripe"
      && subscription?.provider_subscription_id
      && ["trialing", "active", "past_due", "paused"].includes(subscription.status));
  }

  function subscriptionSummary(subscription) {
    if (!subscription) return isAdmin() ? "Non presente" : "Visibile agli admin";
    if (subscription.plan_code === "premium-complimentary") {
      if (complimentaryIsActive(subscription)) {
        return subscription.current_period_end
          ? `Premium omaggio · fino al ${formatDate(subscription.current_period_end, false)}`
          : "Premium omaggio · senza scadenza";
      }
      return subscription.complimentary_revoked_at
        ? `Premium omaggio revocato · sola lettura${subscription.archive_access_until ? ` fino al ${formatDate(subscription.archive_access_until, false)}` : ""}`
        : `Premium omaggio scaduto · sola lettura${subscription.archive_access_until ? ` fino al ${formatDate(subscription.archive_access_until, false)}` : ""}`;
    }
    if (subscription.plan_code === "premium-beta") {
      if (subscription.status === "trialing") {
        return `${subscription.complimentary_revoked_at ? "Prova gratuita ripristinata" : "Prova gratuita"}${subscription.current_period_end ? ` · fino al ${formatDate(subscription.current_period_end, false)}` : ""}`;
      }
      if (subscription.status === "expired") {
        return `Prova terminata · sola lettura${subscription.archive_access_until ? ` fino al ${formatDate(subscription.archive_access_until, false)}` : ""}`;
      }
    }
    if (subscription.plan_code === "premium-casa-annual") {
      if (subscription.status === "active") return "Premium annuale attivo";
      if (subscription.status === "past_due") return "Premium annuale · pagamento da verificare";
      if (subscription.status === "canceled") return "Premium annuale · rinnovo disattivato";
    }
    return `${subscription.status} · ${subscription.plan_code}`;
  }

  function subscriptionBadgeDescriptor(subscription) {
    if (!subscription) return null;
    if (subscription.plan_code === "premium-complimentary") {
      if (complimentaryIsActive(subscription)) return { label: "Premium omaggio", kind: "ok" };
      return {
        label: subscription.complimentary_revoked_at
          ? "Omaggio revocato · sola lettura"
          : "Omaggio scaduto · sola lettura",
        kind: "warn",
      };
    }
    if (subscription.plan_code === "premium-beta") {
      if (subscription.status === "trialing") {
        return {
          label: subscription.complimentary_revoked_at ? "Prova ripristinata" : "Prova gratuita",
          kind: "ok",
        };
      }
      if (subscription.status === "expired") return { label: "Prova terminata · sola lettura", kind: "warn" };
    }
    if (subscription.plan_code === "premium-casa-annual") {
      if (subscription.status === "active") return { label: "Premium attivo", kind: "ok" };
      if (subscription.status === "past_due") return { label: "Pagamento da verificare", kind: "danger" };
      if (subscription.status === "canceled") return { label: "Rinnovo disattivato", kind: "warn" };
    }
    return null;
  }

  function setComplimentaryStatus(kind, message) {
    const element = byId("staffComplimentaryStatus");
    if (!element) return;
    element.className = `complimentary-status${kind ? ` ${kind}` : ""}`;
    element.textContent = message || "";
    element.hidden = !message;
  }

  function setComplimentaryBusy(value) {
    ["staffComplimentaryCancel", "staffComplimentaryRevoke", "staffComplimentaryApply"].forEach(id => {
      const element = byId(id);
      if (element) element.disabled = Boolean(value);
    });
    const form = byId("staffComplimentaryForm");
    form?.querySelectorAll("select, textarea").forEach(element => { element.disabled = Boolean(value); });
  }

  function closeComplimentary() {
    if (busy) return;
    const layer = byId("staffComplimentaryLayer");
    if (layer) layer.hidden = true;
    complimentaryCustomer = null;
    setComplimentaryStatus("", "");
    window.dispatchEvent(new Event("offertalogica:staff-save-complete"));
  }

  function openComplimentary(customer) {
    if (!isAdmin() || !customer) return;
    complimentaryCustomer = customer;
    const subscription = customer.subscription;
    const active = complimentaryIsActive(subscription);
    const label = customer.profile.full_name || customer.profile.email || customer.profile.id;
    text(byId("staffComplimentaryTarget"), `${label} · ${customer.profile.email || "email non indicata"}`);
    text(byId("staffComplimentaryCurrent"), active
      ? (subscription.current_period_end
        ? `Premium omaggio attivo fino al ${formatDate(subscription.current_period_end, false)}. Nessun rinnovo automatico.`
        : "Premium omaggio attivo senza scadenza. Nessun rinnovo automatico.")
      : (paidSubscriptionConflicts(subscription)
        ? "Il cliente ha un abbonamento Stripe attivo o da regolarizzare. Non può essere sostituito da un omaggio."
        : "Nessun piano Premium omaggio attivo."));
    const form = byId("staffComplimentaryForm");
    if (form) {
      form.elements.duration.value = "12_months";
      form.elements.reason.value = subscription?.complimentary_reason || "";
    }
    const apply = byId("staffComplimentaryApply");
    const revoke = byId("staffComplimentaryRevoke");
    if (apply) {
      apply.textContent = active ? "PROROGA O MODIFICA" : "CONCEDI PREMIUM";
      apply.disabled = paidSubscriptionConflicts(subscription);
    }
    if (revoke) revoke.hidden = !active;
    setComplimentaryStatus("", "");
    const layer = byId("staffComplimentaryLayer");
    if (layer) layer.hidden = false;
    form?.elements.duration?.focus();
  }

  async function applyComplimentary() {
    if (!isAdmin() || !complimentaryCustomer || busy) return;
    const form = byId("staffComplimentaryForm");
    const duration = String(form?.elements.duration?.value || "");
    const reason = String(form?.elements.reason?.value || "").trim();
    setComplimentaryBusy(true);
    setComplimentaryStatus("info", "Salvataggio del Premium omaggio…");
    try {
      const { error } = await client.rpc("premium_admin_set_complimentary", {
        p_user_id: complimentaryCustomer.profile.id,
        p_duration_code: duration,
        p_reason: reason,
      });
      if (error) throw error;
      const label = complimentaryCustomer.profile.full_name || complimentaryCustomer.profile.email || "Cliente";
      await loadCustomers({ silent: true });
      closeComplimentary();
      setMessage("success", `Premium omaggio attivato per ${label}.`);
      window.dispatchEvent(new Event("offertalogica:staff-save-complete"));
    } catch (error) {
      setComplimentaryStatus("error", friendlyError(error));
    } finally {
      setComplimentaryBusy(false);
    }
  }

  async function revokeComplimentary() {
    if (!isAdmin() || !complimentaryCustomer || busy) return;
    const label = complimentaryCustomer.profile.full_name || complimentaryCustomer.profile.email || "cliente";
    const confirmed = await confirmAction({
      title: "Revoca Premium omaggio",
      message: `Revocare il Premium omaggio di ${label}? Se prima dell’omaggio era disponibile una prova ancora valida, verranno ripristinati i giorni residui. Altrimenti l’archivio passerà in sola lettura per 90 giorni.`,
      confirmLabel: "REVOCA"
    });
    if (!confirmed) return;
    const reason = String(byId("staffComplimentaryForm")?.elements.reason?.value || "").trim();
    setComplimentaryBusy(true);
    setComplimentaryStatus("info", "Revoca in corso…");
    try {
      const { data, error } = await client.rpc("premium_admin_revoke_complimentary", {
        p_user_id: complimentaryCustomer.profile.id,
        p_reason: reason,
      });
      if (error) throw error;
      await loadCustomers({ silent: true });
      closeComplimentary();
      setMessage("success", data?.restored_trial
        ? `Premium omaggio revocato per ${label}. La prova gratuita residua è stata ripristinata.`
        : `Premium omaggio revocato per ${label}. L’archivio è ora in sola lettura.`);
      window.dispatchEvent(new Event("offertalogica:staff-save-complete"));
    } catch (error) {
      setComplimentaryStatus("error", friendlyError(error));
    } finally {
      setComplimentaryBusy(false);
    }
  }

  function resourceDeleteButton(label, handler) {
    const button = node("button", { className: "button danger compact", type: "button", text: label });
    button.hidden = !isAdmin();
    button.addEventListener("click", handler);
    return button;
  }

  function renderCustomerBill(customer, bill) {
    const label = bill.original_file_name || `Bolletta ${bill.commodity || ""}`.trim();
    const actions = node("div", { className: "row-actions" }, [
      reportingExclusionButton("premium_bill", bill.id, label),
      resourceDeleteButton("Elimina bolletta", () => deleteCustomerBill(customer, bill)),
    ]);
    return node("div", { className: "resource-row" }, [
      node("div", { className: "resource-row-copy" }, [
        node("strong", { text: label }),
        node("small", { text: `${bill.commodity || "—"} · ${formatDate(bill.created_at, false)} · ${bill.processing_status || "—"} · ${bill.customer_status || "—"}` })
      ]),
      actions
    ]);
  }

  function renderCustomerContract(customer, contract) {
    return node("div", { className: "resource-row" }, [
      node("div", { className: "resource-row-copy" }, [
        node("strong", { text: `${contract.provider_name || "Fornitore"} · ${contract.offer_name || "Offerta provvisoria"}` }),
        node("small", { text: `${contract.pricing_type || "—"} · ${contract.verification_status || "—"} · ${contract.customer_confirmation_status || "—"}` })
      ]),
      resourceDeleteButton("Elimina contratto", () => deleteCustomerContract(customer, contract))
    ]);
  }

  function renderCustomerUtility(customer, utility) {
    const bills = customer.bills.filter(item => item.utility_id === utility.id);
    const contracts = customer.contracts.filter(item => item.utility_id === utility.id);
    const details = node("div", { className: "resource-list" });
    if (!bills.length && !contracts.length) {
      details.append(node("div", { className: "resource-row-copy" }, [node("small", { text: "Nessuna bolletta o contratto collegato." })]));
    } else {
      contracts.forEach(contract => details.append(renderCustomerContract(customer, contract)));
      bills.forEach(bill => details.append(renderCustomerBill(customer, bill)));
    }
    return node("article", { className: "resource-card" }, [
      node("div", { className: "resource-head" }, [
        node("div", {}, [
          node("strong", { text: `${utility.label || "Utenza"} · ${utility.provider_name || "fornitore non indicato"}` }),
          node("small", { text: `${utility.supply_type || "—"} · ${addressLabel(utility.address)}` })
        ]),
        resourceDeleteButton("Elimina blocco utenza", () => deleteCustomerUtility(customer, utility))
      ]),
      details
    ]);
  }

  function premiumPaymentStatusLabel(status) {
    if (status === "active") return "attivo";
    if (status === "past_due") return "pagamento da regolarizzare";
    if (status === "paused") return "in pausa";
    if (status === "canceled") return "cancellato";
    if (status === "pending") return "in attesa";
    return status || "non disponibile";
  }

  async function syncCustomerStripeSubscription(customer) {
    if (!isAdmin() || busy) return;
    const subscription = customer?.subscription;
    if (subscription?.provider !== "stripe" || !subscription?.provider_subscription_id) {
      setMessage("error", "Questo cliente non ha un abbonamento Stripe collegato da sincronizzare.");
      return;
    }
    setBusy(true);
    setMessage("info", "Lettura dello stato direttamente da Stripe…");
    try {
      const result = await staffFetch(PREMIUM_STAFF_BILLING_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_subscription", user_id: customer.profile.id }),
      });
      await loadCases({ silent: true });
      const before = premiumPaymentStatusLabel(result?.before?.status);
      const after = premiumPaymentStatusLabel(result?.after?.status);
      if (["past_due", "paused"].includes(result?.after?.status)) {
        setMessage("info", `Stripe conferma: ${after}. Il cliente deve regolarizzare il pagamento dal Portale Premium. Nessuno sblocco manuale eseguito.`);
      } else if (result?.changed) {
        setMessage("success", `Stato Stripe riallineato: ${before} → ${after}.`);
      } else {
        setMessage("success", `Stato già allineato a Stripe: ${after}.`);
      }
    } catch (error) {
      setMessage("error", friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  function renderCustomers() {
    const target = byId("customerList");
    clear(target);
    const filtered = filteredCustomers();
    text(byId("navCustomerCount"), cache.customers.length);
    if (!filtered.length) {
      target.append(node("div", { className: "empty", text: cache.customers.length ? "Nessun cliente corrisponde ai filtri." : "Nessun profilo Premium disponibile." }));
      return;
    }
    filtered.forEach(customer => {
      const profile = customer.profile;
      const subscription = customer.subscription;
      const activeContracts = customer.contracts.filter(item => item.is_current);
      const title = profile.full_name || profile.email || "Cliente Premium";
      const statusKind = profile.account_status === "active" ? "ok" : profile.account_status === "deletion_requested" ? "warn" : "danger";
      const actions = node("div", { className: "customer-actions" }, [badge(profile.account_status || "—", statusKind)]);
      const planBadge = subscriptionBadgeDescriptor(subscription);
      if (planBadge) actions.append(badge(planBadge.label, planBadge.kind));
      if (isAdmin() && subscription?.provider === "stripe" && subscription?.provider_subscription_id) {
        const stripeSyncButton = node("button", { className: "button secondary compact", type: "button", text: "AGGIORNA DA STRIPE" });
        stripeSyncButton.title = "Rilegge lo stato da Stripe e aggiorna solo i dati locali. Non effettua addebiti e non modifica l’abbonamento su Stripe.";
        stripeSyncButton.addEventListener("click", () => syncCustomerStripeSubscription(customer));
        actions.append(stripeSyncButton);
      }
      if (isAdmin()) {
        const complimentaryButton = node("button", {
          className: "button secondary compact",
          type: "button",
          text: complimentaryIsActive(subscription) ? "GESTISCI OMAGGIO" : "REGALA PREMIUM"
        });
        complimentaryButton.disabled = paidSubscriptionConflicts(subscription);
        complimentaryButton.title = complimentaryButton.disabled ? "Abbonamento Stripe attivo o da regolarizzare" : "";
        complimentaryButton.addEventListener("click", () => openComplimentary(customer));
        actions.append(complimentaryButton);
        if (profile.account_status === "deletion_requested") actions.append(resourceDeleteButton("Elimina account completo", () => completeAccountDeletion(customer)));
        actions.append(resourceDeleteButton("Elimina blocco cliente", () => deleteCustomerBlock(customer)));
      }

      const resources = node("div", { className: "customer-resources" });
      customer.utilities.forEach(utility => resources.append(renderCustomerUtility(customer, utility)));
      const utilityIds = new Set(customer.utilities.map(item => item.id));
      const orphanContracts = customer.contracts.filter(item => !utilityIds.has(item.utility_id));
      const orphanBills = customer.bills.filter(item => !utilityIds.has(item.utility_id));
      if (orphanContracts.length || orphanBills.length) {
        const orphanList = node("div", { className: "resource-list" });
        orphanContracts.forEach(contract => orphanList.append(renderCustomerContract(customer, contract)));
        orphanBills.forEach(bill => orphanList.append(renderCustomerBill(customer, bill)));
        resources.append(node("article", { className: "resource-card" }, [
          node("div", { className: "resource-head" }, [node("div", {}, [node("strong", { text: "Elementi senza utenza corrente" }), node("small", { text: "Record storici o collegamento utenza rimosso." })])]),
          orphanList
        ]));
      }
      if (!customer.utilities.length && !orphanContracts.length && !orphanBills.length) {
        resources.append(node("div", { className: "bulk-note", text: "Nessuna utenza, bolletta o contratto collegato." }));
      }

      target.append(node("article", { className: "customer-card" }, [
        node("div", { className: "customer-head" }, [
          node("div", {}, [node("h3", { text: title }), node("p", { text: `${profile.email || "email non indicata"} · ${profile.phone || "telefono non indicato"}` })]),
          actions
        ]),
        ...(profile.account_status === "deletion_requested" ? [node("div", { className: "request-note", text: `Cancellazione richiesta${profile.deletion_requested_at ? ` il ${formatDate(profile.deletion_requested_at)}` : ""}${profile.deletion_request_reason ? ` · Motivo: ${profile.deletion_request_reason}` : ""}` })] : []),
        node("div", { className: "customer-meta" }, [
          node("div", { className: "mini" }, [node("span", { text: "Abbonamento" }), node("strong", { text: subscriptionSummary(subscription) })]),
          node("div", { className: "mini" }, [node("span", { text: "Utenze" }), node("strong", { text: customer.utilities.length })]),
          node("div", { className: "mini" }, [node("span", { text: "Bollette" }), node("strong", { text: customer.bills.length })]),
          node("div", { className: "mini" }, [node("span", { text: "Contratti correnti" }), node("strong", { text: activeContracts.length })]),
          node("div", { className: "mini" }, [node("span", { text: "Registrazione" }), node("strong", { text: formatDate(profile.created_at, false) }), node("small", { text: profile.id })])
        ]),
        resources
      ]));
    });
  }

  async function refreshCustomerDependencies() {
    await Promise.allSettled([
      loadCustomers({ silent: true }),
      loadChecks({ silent: true }),
      loadCosts({ silent: true }),
    ]);
  }

  async function deleteCustomerBill(customer, bill) {
    if (!isAdmin() || busy) return;
    if (!(await confirmAction({ title: "Elimina bolletta", message: `Eliminare “${bill.original_file_name || bill.id}” e tutti i dati collegati?`, confirmLabel: "ELIMINA" }))) return;
    await runDestructiveAction(async () => {
      await removePremiumStorage([bill.storage_path]);
      await deletePremiumRecords("bills", [bill.id]);
      await refreshCustomerDependencies();
    }, "Bolletta e dati collegati eliminati.");
  }

  async function deleteCustomerContract(customer, contract) {
    if (!isAdmin() || busy) return;
    if (!(await confirmAction({ title: "Elimina contratto", message: `Eliminare “${contract.offer_name || contract.id}”? Le bollette resteranno presenti.`, confirmLabel: "ELIMINA" }))) return;
    await runDestructiveAction(async () => {
      await deletePremiumRecords("contracts", [contract.id]);
      await loadCustomers({ silent: true });
    }, "Contratto eliminato.");
  }

  async function deleteCustomerUtility(customer, utility) {
    if (!isAdmin() || busy) return;
    const bills = customer.bills.filter(item => item.utility_id === utility.id);
    const contracts = customer.contracts.filter(item => item.utility_id === utility.id);
    if (!(await requireTypedConfirmation(`Eliminare il blocco utenza “${utility.label || utility.id}”? Saranno rimossi ${bills.length} bollette, ${contracts.length} contratti e tutti i controlli collegati.`, "ELIMINA"))) return;
    await runDestructiveAction(async () => {
      await removePremiumStorage(bills.map(item => item.storage_path));
      await deletePremiumRecords("utilities", [utility.id]);
      await refreshCustomerDependencies();
    }, "Blocco utenza eliminato.");
  }

  async function deleteCustomerBlock(customer) {
    if (!isAdmin() || busy) return;
    const label = customer.profile.full_name || customer.profile.email || customer.profile.id;
    if (!(await requireTypedConfirmation(`Eliminare tutto il blocco Premium di “${label}”? Saranno rimossi profilo Premium, abbonamenti, utenze, bollette, contratti, controlli, analisi e costi collegati. L’account Auth non viene cancellato.`, "ELIMINA"))) return;
    await runDestructiveAction(async () => {
      await removePremiumStorage(customer.bills.map(item => item.storage_path));
      await deletePremiumRecords("customers", [customer.profile.id]);
      await refreshCustomerDependencies();
    }, "Blocco cliente Premium eliminato.");
  }

  async function completeAccountDeletion(customer) {
    if (!isAdmin() || busy) return;
    const profile = customer.profile;
    const label = profile.full_name || profile.email || profile.id;
    if (profile.account_status !== "deletion_requested") {
      setMessage("error", "L’account non ha una richiesta di cancellazione attiva.");
      return;
    }
    if (!(await requireTypedConfirmation(`Eliminare definitivamente account Auth, credenziali e tutti i dati Premium di “${label}”?`, "CANCELLA ACCOUNT"))) return;
    await runDestructiveAction(async () => {
      await removePremiumStorage(customer.bills.map(item => item.storage_path));
      const { error } = await client.rpc("premium_staff_complete_account_deletion", {
        p_user_id: profile.id,
        p_confirmation: "CANCELLA_ACCOUNT",
      });
      if (error) throw error;
      await refreshCustomerDependencies();
    }, "Account e dati Premium eliminati definitivamente.");
  }

  async function deleteVisibleCustomers() {
    if (!isAdmin() || busy) return;
    const customers = filteredCustomers();
    if (!customers.length) {
      setMessage("error", "Nessun cliente visibile da eliminare.");
      return;
    }
    if (!(await requireTypedConfirmation(`Eliminare definitivamente ${customers.length} blocchi cliente visibili con tutte le risorse Premium collegate? Gli account Auth non vengono cancellati.`, "ELIMINA"))) return;
    await runDestructiveAction(async () => {
      await removePremiumStorage(customers.flatMap(customer => customer.bills.map(item => item.storage_path)));
      await deletePremiumRecords("customers", customers.map(customer => customer.profile.id));
      await refreshCustomerDependencies();
    }, `${customers.length} blocchi cliente eliminati.`);
  }

  async function loadCustomers({ silent = false } = {}) {
    if (!silent) setMessage("info", "Aggiornamento clienti e utenze…");
    const limit = Math.max(1, Math.min(500, Number(byId("customerLimit")?.value || 250)));
    const profilesResult = await client.from("premium_profiles")
      .select("id,full_name,email,phone,account_status,deletion_requested_at,deletion_request_reason,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (profilesResult.error) throw profilesResult.error;
    const profiles = profilesResult.data || [];
    const ids = profiles.map(item => item.id);
    let utilities = [], contracts = [], bills = [], subscriptions = [];
    if (ids.length) {
      const queries = [
        client.from("premium_utilities").select("id,user_id,label,supply_type,provider_name,pod,pdr,address,status,created_at").in("user_id", ids).order("created_at", { ascending: false }),
        client.from("premium_contracts").select("id,user_id,utility_id,provider_name,offer_name,pricing_type,verification_status,automatic_match_status,automatic_match_confidence,customer_confirmation_status,is_current,updated_at").in("user_id", ids).order("updated_at", { ascending: false }),
        client.from("premium_bills").select("id,user_id,utility_id,contract_id,commodity,original_file_name,storage_path,file_size,total_amount_eur,processing_status,customer_status,created_at,deleted_at").in("user_id", ids).is("deleted_at", null).order("created_at", { ascending: false }),
      ];
      if (isAdmin()) {
        queries.push(client.from("premium_subscriptions").select("id,user_id,status,plan_code,provider,provider_subscription_id,included_utilities,included_bills_per_year,current_period_start,current_period_end,archive_access_until,cancel_at_period_end,complimentary_granted_at,complimentary_reason,complimentary_revoked_at,created_at").in("user_id", ids).order("created_at", { ascending: false }));
      }
      const results = await Promise.all(queries);
      if (results[0].error) throw results[0].error;
      if (results[1].error) throw results[1].error;
      if (results[2].error) throw results[2].error;
      utilities = results[0].data || [];
      contracts = results[1].data || [];
      bills = results[2].data || [];
      if (results[3]) {
        if (results[3].error) throw results[3].error;
        subscriptions = results[3].data || [];
      }
    }
    cache.customers = profiles.map(profile => ({
      profile,
      utilities: utilities.filter(item => item.user_id === profile.id && item.status !== "archived"),
      contracts: contracts.filter(item => item.user_id === profile.id),
      bills: bills.filter(item => item.user_id === profile.id),
      subscription: subscriptions.find(item => item.user_id === profile.id) || null,
    }));
    renderCustomers();
    text(byId("navCustomerCount"), cache.customers.length);
    if (!silent) setMessage("success", "Clienti e utenze aggiornati.");
  }

  async function loadChecks({ silent = false } = {}) {
    const result = await client.from("premium_checks")
      .select("id,user_id,bill_id,status,outcome,human_seconds,created_at,completed_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (result.error) throw result.error;
    cache.checks = result.data || [];
    const open = cache.checks.filter(item => !["completed", "canceled"].includes(item.status)).length;
    text(byId("navCheckCount"), open);
    if (!silent && activeTab === "checks") {
      const frame = byId("checksFrame");
      if (frame?.contentWindow) frame.contentWindow.location.reload();
    }
  }

  async function loadSupportRequests({ silent = false } = {}) {
    const result = await client.from("premium_communications")
      .select("id,user_id,direction,channel,subject,body,read_at,resolved_at,created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (result.error) throw result.error;
    cache.communications = result.data || [];
    if (!silent && activeTab === "cases") renderCases();
  }


  function casePriorityDescriptor(priority) {
    if (priority === "high") return { label: "ALTA", kind: "danger" };
    if (priority === "medium") return { label: "MEDIA", kind: "warn" };
    return { label: "BASSA", kind: "info" };
  }

  function caseTypeLabel(type) {
    return ({
      bill_check: "Verifica bolletta",
      account_deletion: "Cancellazione account",
      payment: "Pagamento",
      ai_failure: "Analisi IA",
      support_request: "Assistenza rossa",
    })[type] || "Altra pratica";
  }

  function customerByUserId(userId) {
    return cache.customers.find(customer => customer.profile?.id === userId) || null;
  }

  function customerCaseLabel(userId) {
    const customer = customerByUserId(userId);
    const profile = customer?.profile || {};
    return {
      name: profile.full_name || profile.email || "Cliente Premium",
      email: profile.email || "",
    };
  }

  function supportSubject(subject = "") {
    const raw = String(subject || "").trim();
    const labels = {
      account: "Account e accesso",
      payment: "Abbonamento e pagamento",
      utilities: "Utenze",
      bills: "Bollette e analisi",
      installation: "Installazione e aggiornamento app",
      other: "Altro",
    };
    const red = raw.match(/^\[support:red:([a-z_]+):([a-z0-9-]+)\]\s*(.*)$/i);
    if (red) {
      const category = red[1].toLowerCase();
      return {
        raw,
        severity: "red",
        category,
        caseId: red[2],
        label: labels[category] || red[3].trim() || "Assistenza",
      };
    }
    const legacy = raw.match(/^\[support:([a-z_]+)\]\s*(.*)$/i);
    const category = legacy?.[1]?.toLowerCase() || "other";
    const fallback = legacy?.[2]?.trim() || raw || "Richiesta assistenza";
    return { raw, severity: "legacy", category, caseId: "legacy", label: labels[category] || fallback || "Altro" };
  }

  function supportPriority(subject) {
    if (subject?.severity === "red") return "high";
    if (["account", "payment"].includes(subject?.category)) return "high";
    if (["utilities", "bills", "other"].includes(subject?.category)) return "medium";
    return "low";
  }

  function supportDetail(body = "") {
    const raw = String(body || "").trim();
    const match = raw.match(/Descrizione cliente:\s*([\s\S]*)$/i);
    return (match?.[1] || raw || "Nessun dettaglio").trim();
  }

  function injectSupportDialogStyles() {
    if (byId("staffSupportDialogStyles")) return;
    const style = document.createElement("style");
    style.id = "staffSupportDialogStyles";
    style.textContent = `
      .support-dialog-layer{position:fixed;inset:0;z-index:1450;display:grid;place-items:center;padding:18px;background:rgba(10,31,27,.66);backdrop-filter:blur(5px)}
      .confirm-layer{z-index:1650!important}
      .support-dialog-layer[hidden]{display:none}.support-dialog{width:min(720px,100%);max-height:min(90vh,820px);overflow:auto;border:1px solid var(--line);border-radius:20px;padding:18px;background:#fff;box-shadow:0 30px 80px rgba(10,31,27,.30)}
      .support-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.support-dialog-head h3{margin:0;font-size:20px}.support-dialog-head p{margin:4px 0 0;color:var(--muted);font-size:11px}.support-dialog-close{border:0;border-radius:10px;width:38px;height:38px;background:#eef2f0;color:#344840;font-size:20px}
      .support-dialog-meta{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.support-thread{display:grid;gap:8px;margin-top:14px;padding:12px;border:1px solid #e0e9e5;border-radius:14px;background:#f8fbf9;max-height:360px;overflow:auto}
      .support-thread-message{max-width:88%;padding:10px 11px;border-radius:13px;font-size:12px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}.support-thread-message.user{justify-self:start;background:#fff0f0;color:#612b2b;border-bottom-left-radius:4px}.support-thread-message.staff{justify-self:end;background:#eaf4ff;color:#15345d;border-bottom-right-radius:4px}.support-thread-message small{display:block;margin-top:4px;opacity:.68;font-size:9px}
      .support-dialog-form{display:grid;gap:8px;margin-top:13px}.support-dialog-form textarea{min-height:92px;resize:vertical}.support-dialog-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px}.support-dialog-actions .button{flex:1 1 150px}.support-dialog-note{margin-top:9px;color:var(--muted);font-size:10px;line-height:1.4}
      .support-account-tools{margin-top:14px;padding:13px;border:1px solid #dce9e3;border-radius:14px;background:#f8fbf9}.support-account-tools[hidden]{display:none}.support-account-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.support-account-head strong{font-size:13px}.support-account-head small{display:block;margin-top:3px;color:var(--muted);font-size:10px;line-height:1.35}.support-account-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:10px}.support-account-mini{padding:8px 9px;border:1px solid #e1ebe6;border-radius:10px;background:#fff}.support-account-mini span{display:block;color:var(--muted);font-size:9px;font-weight:800;text-transform:uppercase}.support-account-mini strong{display:block;margin-top:3px;font-size:11px;overflow-wrap:anywhere}.support-account-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.support-account-actions .button{flex:1 1 155px}.support-account-status{margin-top:9px;padding:9px 10px;border-radius:10px;background:#eef4f8;color:#31576e;font-size:10.5px;line-height:1.4}.support-account-status.warn{background:#fff8e5;color:#7a5712}.support-account-status.ok{background:#e9f8ed;color:#087c39}.support-account-status.error{background:#fff0f0;color:#9a2525}.support-account-status[hidden]{display:none}
      @media(max-width:620px){.support-dialog-layer{align-items:end;padding:8px}.support-dialog{border-radius:18px 18px 10px 10px}.support-dialog-actions,.support-account-grid{display:grid}.support-dialog-actions .button,.support-account-actions .button{width:100%}}
    `;
    document.head.append(style);
  }

  let activeSupportCase = null;
  let activeSupportAccountSnapshot = null;
  let supportReplyInFlight = false;

  function setSupportReplyInFlight(value) {
    supportReplyInFlight = Boolean(value);
    const replyForm = byId("staffSupportReplyForm");
    replyForm?.querySelectorAll("button,textarea").forEach(element => { element.disabled = supportReplyInFlight; });
    const closeButton = byId("staffSupportCloseCase");
    if (closeButton) closeButton.disabled = supportReplyInFlight || Boolean(activeSupportCase?.closed);
    const deleteButton = byId("staffSupportDeleteCase");
    if (deleteButton) deleteButton.disabled = supportReplyInFlight;
    const dialogClose = byId("staffSupportDialogClose");
    if (dialogClose) dialogClose.disabled = supportReplyInFlight;
  }

  function ensureSupportDialog() {
    let layer = byId("staffSupportDialogLayer");
    if (layer) return layer;
    injectSupportDialogStyles();
    layer = node("div", { className: "support-dialog-layer", attrs: { id: "staffSupportDialogLayer", role: "dialog", "aria-modal": "true", "aria-labelledby": "staffSupportDialogTitle", hidden: "" } });
    const dialog = node("section", { className: "support-dialog" });
    const head = node("div", { className: "support-dialog-head" }, [
      node("div", {}, [node("h3", { text: "Pratica assistenza", attrs: { id: "staffSupportDialogTitle" } }), node("p", { text: "Conversazione cliente ↔ staff" , attrs: { id: "staffSupportDialogCustomer" } })]),
      node("button", { className: "support-dialog-close", type: "button", text: "×", attrs: { id: "staffSupportDialogClose", "aria-label": "Chiudi" } }),
    ]);
    const meta = node("div", { className: "support-dialog-meta", attrs: { id: "staffSupportDialogMeta" } });
    const accountTools = node("section", { className: "support-account-tools", attrs: { id: "staffSupportAccountTools", hidden: "" } }, [
      node("div", { className: "support-account-head" }, [
        node("div", {}, [
          node("strong", { text: "Strumenti account" }),
          node("small", { text: "Verifica lo stato Auth e invia le email necessarie senza conoscere la password del cliente." }),
        ]),
        node("button", { className: "button secondary compact", type: "button", text: "AGGIORNA", attrs: { id: "staffSupportAccountRefresh" } }),
      ]),
      node("div", { className: "support-account-grid" }, [
        node("div", { className: "support-account-mini" }, [node("span", { text: "Email Auth" }), node("strong", { text: "—", attrs: { id: "staffSupportAuthEmail" } })]),
        node("div", { className: "support-account-mini" }, [node("span", { text: "Email confermata" }), node("strong", { text: "—", attrs: { id: "staffSupportEmailConfirmed" } })]),
        node("div", { className: "support-account-mini" }, [node("span", { text: "Profilo Premium" }), node("strong", { text: "—", attrs: { id: "staffSupportProfileStatus" } })]),
        node("div", { className: "support-account-mini" }, [node("span", { text: "Abbonamento" }), node("strong", { text: "—", attrs: { id: "staffSupportSubscriptionStatus" } })]),
        node("div", { className: "support-account-mini" }, [node("span", { text: "Ultimo accesso" }), node("strong", { text: "—", attrs: { id: "staffSupportLastSignIn" } })]),
        node("div", { className: "support-account-mini" }, [node("span", { text: "Account creato" }), node("strong", { text: "—", attrs: { id: "staffSupportAuthCreated" } })]),
      ]),
      node("div", { className: "support-account-actions" }, [
        node("button", { className: "button secondary", type: "button", text: "INVIA CONFERMA ACCOUNT", attrs: { id: "staffSupportResendConfirmation" } }),
        node("button", { className: "button primary", type: "button", text: "INVIA RECUPERO PASSWORD", attrs: { id: "staffSupportSendRecovery" } }),
      ]),
      node("div", { className: "support-account-status", attrs: { id: "staffSupportAccountStatus", hidden: "" } }),
    ]);
    const thread = node("div", { className: "support-thread", attrs: { id: "staffSupportThread" } });
    const form = node("form", { className: "support-dialog-form", attrs: { id: "staffSupportReplyForm" } }, [
      node("textarea", { attrs: { id: "staffSupportReply", maxlength: "1500", placeholder: "Scrivi la risposta al cliente…", required: "" } }),
      node("button", { className: "button primary", type: "submit", text: "INVIA RISPOSTA" }),
    ]);
    const actions = node("div", { className: "support-dialog-actions" }, [
      node("button", { className: "button secondary", type: "button", text: "VEDI CLIENTE", attrs: { id: "staffSupportViewCustomer" } }),
      node("button", { className: "button secondary", type: "button", text: "CHIUDI PRATICA", attrs: { id: "staffSupportCloseCase" } }),
      node("button", { className: "button danger", type: "button", text: "ELIMINA PRATICA", attrs: { id: "staffSupportDeleteCase" } }),
    ]);
    const note = node("div", { className: "support-dialog-note", text: "CHIUDI conserva la conversazione. ELIMINA cancella definitivamente tutti i messaggi della pratica." });
    dialog.append(head, meta, accountTools, thread, form, actions, note);
    layer.append(dialog);
    document.body.append(layer);
    byId("staffSupportDialogClose").addEventListener("click", closeSupportDialog);
    layer.addEventListener("click", event => { if (event.target === layer) closeSupportDialog(); });
    byId("staffSupportReplyForm").addEventListener("submit", sendSupportReply);
    byId("staffSupportViewCustomer").addEventListener("click", viewSupportCustomer);
    byId("staffSupportCloseCase").addEventListener("click", closeSupportCase);
    byId("staffSupportDeleteCase").addEventListener("click", deleteSupportCase);
    byId("staffSupportAccountRefresh").addEventListener("click", () => loadSupportAccountSnapshot().catch(error => setSupportAccountStatus("error", friendlyError(error))));
    byId("staffSupportResendConfirmation").addEventListener("click", sendSupportConfirmationEmail);
    byId("staffSupportSendRecovery").addEventListener("click", sendSupportPasswordRecoveryEmail);
    return layer;
  }

  function closeSupportDialog() {
    if (supportReplyInFlight) {
      setMessage("info", "Attendi la conferma dell’invio della risposta prima di chiudere la pratica.");
      return;
    }
    const layer = byId("staffSupportDialogLayer");
    if (layer) layer.hidden = true;
    activeSupportCase = null;
    activeSupportAccountSnapshot = null;
    if (byId("staffSupportAccountTools")) byId("staffSupportAccountTools").hidden = true;
    setSupportAccountStatus("", "");
    window.dispatchEvent(new Event("offertalogica:staff-save-complete"));
  }

  function setSupportAccountStatus(kind, message) {
    const target = byId("staffSupportAccountStatus");
    if (!target) return;
    target.className = `support-account-status${kind ? ` ${kind}` : ""}`;
    target.textContent = message || "";
    target.hidden = !message;
  }

  function setSupportAccountField(id, value) {
    text(byId(id), value == null || value === "" ? "—" : value);
  }

  function supportAccountEmail() {
    return String(activeSupportAccountSnapshot?.email || activeSupportCase?.customer?.email || "").trim().toLowerCase();
  }

  async function loadSupportAccountSnapshot({ silent = false } = {}) {
    const panel = byId("staffSupportAccountTools");
    if (!panel) return null;
    const accountCase = activeSupportCase?.supportCategory === "account";
    panel.hidden = !accountCase;
    activeSupportAccountSnapshot = null;
    if (!accountCase) return null;

    if (!silent) setSupportAccountStatus("", "Verifica dello stato account…");
    const { data, error } = await client.rpc("premium_staff_account_support_snapshot", {
      p_user_id: activeSupportCase.userId,
    });
    if (error) throw error;
    const snapshot = data || {};
    activeSupportAccountSnapshot = snapshot;

    setSupportAccountField("staffSupportAuthEmail", snapshot.email);
    setSupportAccountField("staffSupportEmailConfirmed", snapshot.email_confirmed ? "Sì" : "No");
    setSupportAccountField("staffSupportProfileStatus", snapshot.profile_status || "Profilo non trovato");
    setSupportAccountField("staffSupportSubscriptionStatus", snapshot.subscription_status
      ? `${snapshot.subscription_status}${snapshot.subscription_plan ? ` · ${snapshot.subscription_plan}` : ""}`
      : "Nessun piano");
    setSupportAccountField("staffSupportLastSignIn", snapshot.last_sign_in_at ? formatDate(snapshot.last_sign_in_at) : "Mai");
    setSupportAccountField("staffSupportAuthCreated", snapshot.auth_created_at ? formatDate(snapshot.auth_created_at) : "—");

    const confirmButton = byId("staffSupportResendConfirmation");
    const recoveryButton = byId("staffSupportSendRecovery");
    if (confirmButton) {
      confirmButton.hidden = Boolean(snapshot.email_confirmed);
      confirmButton.disabled = !snapshot.email || Boolean(snapshot.email_confirmed);
    }
    if (recoveryButton) recoveryButton.disabled = !snapshot.email;

    if (!snapshot.email_confirmed) {
      setSupportAccountStatus("warn", "L’email non risulta confermata. Invia una nuova conferma account e ricorda al cliente di controllare anche Spam/Posta indesiderata.");
    } else if (snapshot.profile_status && snapshot.profile_status !== "active") {
      setSupportAccountStatus("warn", `Email confermata, ma il profilo Premium risulta “${snapshot.profile_status}”. Verifica la scheda cliente prima di chiudere la pratica.`);
    } else {
      setSupportAccountStatus("ok", "Email confermata e profilo attivo. Se il cliente non riesce ad accedere, invia un nuovo link di recupero password.");
    }
    return snapshot;
  }

  async function appendSupportActionMessage(body) {
    if (!activeSupportCase || !body) return;
    const { error } = await client.from("premium_communications").insert({
      user_id: activeSupportCase.userId,
      direction: "staff_to_user",
      channel: "in_app",
      subject: activeSupportCase.supportSubjectRaw,
      body: String(body).slice(0, 1500),
      created_by_staff_id: currentSession.user.id,
    });
    if (error) throw error;
    renderSupportThread(await loadSupportThread(activeSupportCase));
  }

  async function sendSupportConfirmationEmail() {
    if (!activeSupportCase || activeSupportCase.supportCategory !== "account") return;
    try {
      const snapshot = activeSupportAccountSnapshot || await loadSupportAccountSnapshot({ silent: true });
      const email = String(snapshot?.email || "").trim().toLowerCase();
      if (!email) throw new Error("Email account non disponibile.");
      if (snapshot?.email_confirmed) {
        setSupportAccountStatus("ok", "L’email risulta già confermata. Non serve inviare un’altra conferma account.");
        return;
      }
      const confirmed = await confirmAction({
        title: "Inviare una nuova conferma account?",
        message: `Inviare una nuova email di conferma a ${email}?`,
        confirmLabel: "INVIA EMAIL",
      });
      if (!confirmed) return;
      setSupportAccountStatus("", "Invio email di conferma…");
      const { error } = await client.auth.resend({
        type: "signup",
        email,
        options: {
          emailRedirectTo: `${PREMIUM_APP_URL}?auth=confirm#profile`,
        },
      });
      if (error) throw error;
      await appendSupportActionMessage("Ho inviato una nuova email di conferma account. Controlla la Posta in arrivo e anche Spam/Posta indesiderata.");
      setSupportAccountStatus("ok", "Email di conferma inviata. Attendi che il cliente confermi l’indirizzo, poi aggiorna lo stato account.");
    } catch (error) {
      setSupportAccountStatus("error", friendlyError(error));
    }
  }

  async function sendSupportPasswordRecoveryEmail() {
    if (!activeSupportCase || activeSupportCase.supportCategory !== "account") return;
    try {
      const snapshot = activeSupportAccountSnapshot || await loadSupportAccountSnapshot({ silent: true });
      const email = String(snapshot?.email || "").trim().toLowerCase();
      if (!email) throw new Error("Email account non disponibile.");
      const confirmed = await confirmAction({
        title: "Inviare recupero password?",
        message: `Inviare un nuovo link di recupero password a ${email}? Lo staff non vedrà e non imposterà la password del cliente.`,
        confirmLabel: "INVIA LINK",
      });
      if (!confirmed) return;
      setSupportAccountStatus("", "Invio link di recupero password…");
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: `${PREMIUM_APP_URL}?auth=recovery#profile`,
      });
      if (error) throw error;
      await appendSupportActionMessage("Ho inviato un nuovo link per reimpostare la password. Controlla la Posta in arrivo e anche Spam/Posta indesiderata.");
      setSupportAccountStatus("ok", "Link di recupero password inviato. Attendi la prova del cliente; se riesce ad accedere puoi chiudere la pratica.");
    } catch (error) {
      setSupportAccountStatus("error", friendlyError(error));
    }
  }

  function renderSupportThread(messages = []) {
    const thread = byId("staffSupportThread");
    if (!thread) return;
    clear(thread);
    if (!messages.length) {
      thread.append(node("div", { className: "empty", text: "Nessun messaggio disponibile." }));
      return;
    }
    messages.forEach(message => {
      const isStaff = message.direction === "staff_to_user";
      const item = node("div", { className: `support-thread-message ${isStaff ? "staff" : "user"}` }, [
        node("div", { text: message.body || "—" }),
        node("small", { text: `${isStaff ? "Staff" : "Cliente"} · ${formatDate(message.created_at)}` }),
      ]);
      thread.append(item);
    });
    thread.scrollTop = thread.scrollHeight;
  }

  async function loadSupportThread(item) {
    const parsed = supportSubject(item.supportSubjectRaw || "");
    const result = await client.from("premium_communications")
      .select("id,user_id,direction,subject,body,read_at,resolved_at,created_at")
      .eq("user_id", item.userId)
      .order("created_at", { ascending: true })
      .limit(250);
    if (result.error) throw result.error;
    return (result.data || []).filter(message => {
      const subject = supportSubject(message.subject);
      if (parsed.severity === "red") return subject.severity === "red" && subject.caseId === parsed.caseId && subject.category === parsed.category;
      return message.subject === item.supportSubjectRaw;
    });
  }

  async function openSupportCase(item) {
    if (!item?.userId) return;
    const layer = ensureSupportDialog();
    activeSupportCase = item;
    text(byId("staffSupportDialogCustomer"), `${item.customer?.name || "Cliente Premium"}${item.customer?.email ? ` · ${item.customer.email}` : ""}`);
    const meta = byId("staffSupportDialogMeta");
    clear(meta);
    meta.append(badge(item.closed ? "CHIUSA" : "ROSSO", item.closed ? "ok" : "danger"), badge(item.supportLabel || "Assistenza", "info"), badge(formatDate(item.createdAt), ""));
    const closeButton = byId("staffSupportCloseCase");
    if (closeButton) {
      closeButton.disabled = Boolean(item.closed);
      closeButton.textContent = item.closed ? "PRATICA CHIUSA" : "CHIUDI PRATICA";
    }
    clear(byId("staffSupportThread"));
    byId("staffSupportThread").append(node("div", { className: "empty", text: "Caricamento conversazione…" }));
    byId("staffSupportReply").value = "";
    activeSupportAccountSnapshot = null;
    if (byId("staffSupportAccountTools")) byId("staffSupportAccountTools").hidden = item.supportCategory !== "account";
    setSupportAccountStatus("", "");
    layer.hidden = false;
    try {
      const messages = await loadSupportThread(item);
      renderSupportThread(messages);
      if (item.supportCategory === "account") {
        loadSupportAccountSnapshot().catch(error => setSupportAccountStatus("error", friendlyError(error)));
      }
      window.setTimeout(() => byId("staffSupportReply")?.focus(), 0);
    } catch (error) {
      renderSupportThread([]);
      setMessage("error", friendlyError(error));
    }
  }

  async function sendSupportReply(event) {
    event.preventDefault();
    const target = activeSupportCase;
    if (!target || busy || supportReplyInFlight) return;
    const textarea = byId("staffSupportReply");
    const body = String(textarea?.value || "").trim();
    if (body.length < 2) {
      setMessage("error", "Scrivi la risposta al cliente.");
      textarea?.focus();
      return;
    }
    setSupportReplyInFlight(true);
    try {
      const liveMessages = await loadSupportThread(target);
      if (!liveMessages.length) {
        setSupportReplyInFlight(false);
        closeSupportDialog();
        await loadSupportRequests({ silent: true });
        renderCases();
        setMessage("error", "La pratica non esiste più: potrebbe essere stata eliminata dal cliente.");
        return;
      }
      const { data: insertedMessage, error } = await client.from("premium_communications").insert({
        user_id: target.userId,
        direction: "staff_to_user",
        channel: "in_app",
        subject: target.supportSubjectRaw,
        body: body.slice(0, 1500),
        created_by_staff_id: currentSession.user.id,
      }).select("id").single();
      if (error) throw error;
      const verifiedMessages = await loadSupportThread(target);
      if (!insertedMessage?.id || !verifiedMessages.some(message => message.id === insertedMessage.id)) {
        throw new Error("La risposta non è stata confermata dal database. Riprova prima di chiudere la pratica.");
      }
      textarea.value = "";
      window.dispatchEvent(new Event("offertalogica:staff-save-complete"));
      renderSupportThread(verifiedMessages);
      await loadSupportRequests({ silent: true });
      renderCases();
      setMessage("success", target.closed
        ? "Messaggio inviato al cliente. La pratica resta chiusa e disponibile nello storico."
        : "Risposta inviata e confermata. Ora puoi chiudere la pratica.");
    } catch (error) {
      setMessage("error", friendlyError(error));
    } finally {
      setSupportReplyInFlight(false);
    }
  }

  function viewSupportCustomer() {
    if (!activeSupportCase) return;
    const email = activeSupportCase.customer?.email || "";
    closeSupportDialog();
    if (email && byId("customerSearch")) byId("customerSearch").value = email;
    setTab("customers");
  }

  async function closeSupportCase() {
    if (!activeSupportCase || busy) return;
    if (supportReplyInFlight) {
      setMessage("info", "Attendi la conferma dell’invio della risposta prima di chiudere la pratica.");
      return;
    }
    if (activeSupportCase.closed) {
      setMessage("info", "La pratica è già chiusa. Puoi continuare a inviare messaggi oppure eliminarla definitivamente.");
      return;
    }
    try {
      const beforeConfirmMessages = await loadSupportThread(activeSupportCase);
      const beforeConfirmLatest = beforeConfirmMessages[beforeConfirmMessages.length - 1];
      if (!beforeConfirmLatest) {
        throw new Error("La pratica non contiene più messaggi. Aggiorna l’elenco e riprova.");
      }
      if (beforeConfirmLatest.direction !== "staff_to_user") {
        setMessage("error", "Non puoi chiudere la pratica: l’ultimo messaggio è del cliente. Invia prima una risposta Staff.");
        return;
      }

      const confirmed = await confirmAction({
        title: "Chiudere la pratica?",
        message: "La pratica uscirà dai conteggi delle attività aperte, ma resterà nell’elenco e la conversazione continuerà a essere disponibile.",
        confirmLabel: "CHIUDI PRATICA",
      });
      if (!confirmed) return;
      if (supportReplyInFlight) {
        setMessage("error", "Pratica non chiusa: è ancora in corso l’invio di una risposta Staff.");
        return;
      }

      // Ricontrolla dopo la conferma: il cliente potrebbe avere risposto mentre il dialog era aperto.
      const liveMessages = await loadSupportThread(activeSupportCase);
      const latest = liveMessages[liveMessages.length - 1];
      if (!latest) {
        throw new Error("La pratica non contiene più messaggi. Aggiorna l’elenco e riprova.");
      }
      if (latest.direction !== "staff_to_user") {
        setMessage("error", "Pratica non chiusa: nel frattempo è arrivato un nuovo messaggio del cliente. Rispondi prima di chiudere.");
        return;
      }

      const openUserMessageIds = liveMessages
        .filter(message => message.direction === "user_to_staff" && !message.resolved_at)
        .map(message => message.id)
        .filter(Boolean);
      if (!openUserMessageIds.length) {
        throw new Error("La pratica non risulta più aperta. Aggiorna l’elenco e riprova.");
      }

      const { data: closedRows, error } = await client.from("premium_communications")
        .update({ resolved_at: new Date().toISOString() })
        .eq("user_id", activeSupportCase.userId)
        .eq("direction", "user_to_staff")
        .in("id", openUserMessageIds)
        .is("resolved_at", null)
        .select("id");
      if (error) throw error;
      if (!closedRows?.length) throw new Error("La pratica non risulta più aperta. Aggiorna l’elenco e riprova.");
      closeSupportDialog();
      await loadSupportRequests({ silent: true });
      renderCases();
      setMessage("success", "Pratica chiusa. Resta nell’elenco e puoi continuare a inviare messaggi.");
    } catch (error) {
      setMessage("error", friendlyError(error));
    }
  }

  async function deleteSupportCase() {
    if (!activeSupportCase || busy) return;
    if (supportReplyInFlight) {
      setMessage("info", "Attendi la conferma dell’invio della risposta prima di eliminare la pratica.");
      return;
    }
    const confirmed = await confirmAction({
      title: "Eliminare definitivamente la pratica?",
      message: "Verranno cancellati tutti i messaggi di questa richiesta, sia del cliente sia dello staff. L’operazione non è reversibile.",
      confirmLabel: "ELIMINA PRATICA",
    });
    if (!confirmed) return;
    try {
      const target = activeSupportCase;
      const { data: deletedRows, error } = await client.from("premium_communications")
        .delete()
        .eq("user_id", target.userId)
        .eq("subject", target.supportSubjectRaw)
        .select("id");
      if (error) throw error;
      if (!deletedRows?.length) throw new Error("La pratica non esiste più o è già stata eliminata.");
      closeSupportDialog();
      await loadSupportRequests({ silent: true });
      renderCases();
      setMessage("success", "Pratica eliminata definitivamente.");
    } catch (error) {
      setMessage("error", friendlyError(error));
    }
  }

  function buildOperationalCases() {
    const cases = [];

    cache.checks.forEach(check => {
      if (["completed", "canceled"].includes(check.status)) return;
      const customer = customerCaseLabel(check.user_id);
      const priority = check.status === "more_info_required" ? "medium" : (check.status === "pending" ? "medium" : "low");
      cases.push({
        id: `check:${check.id}`,
        type: "bill_check",
        priority,
        userId: check.user_id || "",
        customer,
        status: check.status || "pending",
        createdAt: check.created_at,
        detail: check.status === "more_info_required" ? "In attesa di integrazione cliente" : "Verifica bolletta non conclusa",
        targetTab: "checks",
      });
    });

    cache.customers.forEach(customer => {
      const profile = customer.profile || {};
      if (profile.account_status === "deletion_requested") {
        cases.push({
          id: `deletion:${profile.id}`,
          type: "account_deletion",
          priority: "high",
          userId: profile.id,
          customer: { name: profile.full_name || profile.email || "Cliente Premium", email: profile.email || "" },
          status: "deletion_requested",
          createdAt: profile.deletion_requested_at || profile.updated_at || profile.created_at,
          detail: profile.deletion_request_reason || "Richiesta di cancellazione account e dati",
          targetTab: "customers",
        });
      }
      const subscription = customer.subscription;
      if (subscription && ["past_due", "paused"].includes(subscription.status)) {
        cases.push({
          id: `payment:${subscription.id}`,
          type: "payment",
          priority: "high",
          userId: profile.id,
          customer: { name: profile.full_name || profile.email || "Cliente Premium", email: profile.email || "" },
          status: subscription.status,
          createdAt: subscription.current_period_end || subscription.created_at,
          detail: subscription.status === "past_due" ? "Pagamento Premium da verificare" : "Abbonamento Premium sospeso",
          targetTab: "customers",
        });
      }
    });

    cache.runs.forEach(run => {
      if (run.status !== "failed") return;
      const customer = customerCaseLabel(run.user_id);
      cases.push({
        id: `analysis:${run.id}`,
        type: "ai_failure",
        priority: "medium",
        userId: run.user_id || "",
        customer,
        status: "failed",
        createdAt: run.created_at,
        detail: run.error_code ? `Errore IA: ${run.error_code}` : "Analisi IA non completata",
        targetTab: "costs",
      });
    });

    const supportGroups = new Map();
    cache.communications.forEach(communication => {
      const subject = supportSubject(communication.subject);
      const caseKey = subject.severity === "red"
        ? `${communication.user_id}:red:${subject.category}:${subject.caseId}`
        : `${communication.user_id}:legacy:${subject.raw}`;
      if (!supportGroups.has(caseKey)) supportGroups.set(caseKey, { subject, messages: [] });
      supportGroups.get(caseKey).messages.push(communication);
    });

    supportGroups.forEach(({ subject, messages }) => {
      const ordered = messages.slice().sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
      const userMessages = ordered.filter(message => message.direction === "user_to_staff");
      if (!userMessages.length) return;
      const latestUser = userMessages[userMessages.length - 1];
      const latestMessage = ordered[ordered.length - 1] || latestUser;
      const closed = !userMessages.some(message => !message.resolved_at);
      const customer = customerCaseLabel(latestUser.user_id);
      const detail = supportDetail(latestUser.body);
      cases.push({
        id: `support:${latestUser.id}`,
        type: "support_request",
        priority: closed ? "low" : supportPriority(subject),
        userId: latestUser.user_id || "",
        customer,
        status: closed ? "chiusa" : "aperta",
        closed,
        createdAt: latestMessage.created_at || latestUser.created_at,
        detail: `${subject.label}: ${detail || "Nessun dettaglio"}`,
        communicationId: latestUser.id,
        supportCategory: subject.category,
        supportCaseId: subject.caseId,
        supportSeverity: subject.severity,
        supportLabel: subject.label,
        supportSubjectRaw: subject.raw,
      });
    });

    cache.cases = cases.sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 };
      const priorityDiff = (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9);
      if (priorityDiff) return priorityDiff;
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
    return cache.cases;
  }

  function filteredCases() {
    const query = String(byId("caseSearch")?.value || "").trim().toLowerCase();
    const type = String(byId("caseType")?.value || "");
    const priority = String(byId("casePriority")?.value || "");
    return cache.cases.filter(item => {
      if (type && item.type !== type) return false;
      if (priority && item.priority !== priority) return false;
      if (!query) return true;
      const haystack = [item.customer?.name, item.customer?.email, caseTypeLabel(item.type), item.status, item.detail]
        .filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }

  function openOperationalCase(item) {
    if (!item) return;
    if (item.type === "support_request") {
      openSupportCase(item).catch(error => setMessage("error", friendlyError(error)));
      return;
    }
    if (item.targetTab === "customers" && item.customer?.email) {
      const search = byId("customerSearch");
      if (search) search.value = item.customer.email;
    }
    setTab(item.targetTab || "overview");
  }

  function renderCases() {
    buildOperationalCases();
    const rows = filteredCases();
    const activeCases = cache.cases.filter(item => !item.closed);
    text(byId("navCaseCount"), activeCases.length);
    text(byId("caseMetricTotal"), activeCases.length);
    text(byId("caseMetricHigh"), activeCases.filter(item => item.priority === "high").length);
    text(byId("caseMetricCustomers"), new Set(activeCases.map(item => item.userId).filter(Boolean)).size);
    text(byId("caseMetricTypes"), new Set(activeCases.map(item => item.type)).size);
    const body = byId("caseRows");
    if (!body) return;
    clear(body);
    if (!rows.length) {
      body.append(node("tr", {}, [node("td", { text: cache.cases.length ? "Nessuna pratica corrisponde ai filtri." : "Nessuna pratica disponibile.", attrs: { colspan: "7" } })]));
      return;
    }
    rows.forEach(item => {
      const descriptor = casePriorityDescriptor(item.priority);
      const action = node("button", { className: "button secondary compact", type: "button", text: item.type === "support_request" ? "GESTISCI" : "APRI" });
      action.addEventListener("click", () => openOperationalCase(item));
      const actions = node("div", { className: "row-actions" }, [action]);
      if (item.type === "bill_check" && item.id?.startsWith("check:")) {
        const checkId = item.id.slice("check:".length);
        const exclude = reportingExclusionButton("premium_check", checkId, `Verifica ${checkId}`);
        if (exclude) actions.append(exclude);
      }
      const statusKind = item.closed ? "ok" : item.priority === "high" ? "danger" : item.priority === "medium" ? "warn" : "info";
      body.append(node("tr", {}, [
        node("td", {}, [badge(descriptor.label, descriptor.kind)]),
        node("td", {}, [node("strong", { text: caseTypeLabel(item.type) })]),
        node("td", {}, [node("strong", { text: item.customer?.name || "Cliente Premium" }), node("small", { text: item.customer?.email || item.userId || "—" })]),
        node("td", {}, [badge(item.status || "—", statusKind)]),
        node("td", { text: formatDate(item.createdAt) }),
        node("td", { text: item.detail || "—" }),
        node("td", {}, [actions]),
      ]));
    });
  }

  async function loadCases({ silent = false } = {}) {
    if (!silent) setMessage("info", "Aggiornamento pratiche…");
    const results = await Promise.allSettled([
      loadChecks({ silent: true }),
      loadCustomers({ silent: true }),
      loadCosts({ silent: true }),
      loadSupportRequests({ silent: true }),
    ]);
    renderCases();
    const failures = results.filter(result => result.status === "rejected");
    if (!silent) setMessage(failures.length ? "info" : "success", failures.length
      ? `Pratiche aggiornate parzialmente: ${failures.length} sorgente/i non disponibili.`
      : "Pratiche aggiornate.");
  }

  function runHasVerifiedEurPricing(run) {
    const usage = run?.usage_details && typeof run.usage_details === "object" ? run.usage_details : {};
    return usage.pricing_verified_eur === true && VERIFIED_COST_PRICING_VERSIONS.has(usage.pricing_version);
  }

  function verifiedRunCost(run) {
    if (!runHasVerifiedEurPricing(run)) return null;
    const amount = Number(run?.estimated_cost_eur);
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
  }

  function humanCostEur(seconds) {
    const value = Number(seconds || 0);
    return Number.isFinite(value) && value > 0 ? (value / 3600) * HUMAN_COST_EUR_PER_HOUR : 0;
  }

  function renderCostRuns() {
    const body = byId("costRunRows");
    clear(body);
    if (!cache.runs.length) {
      body.append(node("tr", {}, [node("td", { text: "Nessuna analisi IA registrata.", attrs: { colspan: "7" } })]));
      return;
    }
    cache.runs.slice(0, 100).forEach(run => {
      const tokens = Number(run.input_tokens || 0) + Number(run.output_tokens || 0);
      const remove = resourceDeleteButton("Elimina", () => deleteCostRun(run));
      const exclude = reportingExclusionButton("premium_analysis_run", run.id, `Analisi ${run.id}`);
      const actions = node("div", { className: "row-actions" }, [exclude, remove]);
      body.append(node("tr", {}, [
        node("td", { text: formatDate(run.created_at) }),
        node("td", { text: run.origin || "—" }),
        node("td", {}, [badge(run.status || "—", run.status === "failed" ? "danger" : run.status === "completed" ? "ok" : "warn")]),
        node("td", { text: run.model || "—" }),
        node("td", { text: formatNumber(tokens) }),
        node("td", { text: verifiedRunCost(run) != null
          ? formatMoney(verifiedRunCost(run))
          : run.estimated_cost_eur == null ? "Tariffa EUR non configurata" : "Storico non verificato" }),
        node("td", {}, [actions])
      ]));
    });
  }

  function renderCostEvents() {
    const body = byId("costEventRows");
    clear(body);
    if (!isAdmin()) {
      body.append(node("tr", {}, [node("td", { text: "Il registro economico completo è riservato agli amministratori.", attrs: { colspan: "6" } })]));
      return;
    }
    if (!cache.costEvents.length) {
      body.append(node("tr", {}, [node("td", { text: "Nessun evento di costo registrato.", attrs: { colspan: "6" } })]));
      return;
    }
    const verifiedRunIds = new Set(cache.runs.filter(runHasVerifiedEurPricing).map(run => run.id));
    cache.costEvents.slice(0, 250).forEach(event => {
      const remove = resourceDeleteButton("Elimina", () => deleteCostEvent(event));
      const exclude = reportingExclusionButton("cost_event", event.id, `Costo ${event.event_type || event.id}`);
      const actions = node("div", { className: "row-actions" }, [exclude, remove]);
      const aiVerified = event.event_type !== "ai_analysis" || verifiedRunIds.has(event.analysis_run_id);
      body.append(node("tr", {}, [
        node("td", { text: formatDate(event.occurred_at) }),
        node("td", { text: event.event_type || "—" }),
        node("td", { text: event.provider || "—" }),
        node("td", { text: `${formatNumber(event.quantity, 3)} ${event.unit || "event"}` }),
        node("td", { text: aiVerified ? formatMoney(event.cost_eur) : "Storico non verificato" }),
        node("td", {}, [actions])
      ]));
    });
  }

  async function deleteCostRun(run) {
    if (!isAdmin() || busy) return;
    if (!(await confirmAction({ title: "Elimina analisi", message: `Eliminare l’analisi ${run.id} e il costo collegato?`, confirmLabel: "ELIMINA" }))) return;
    await runDestructiveAction(async () => {
      await deletePremiumRecords("analysis_runs", [run.id]);
      await Promise.allSettled([loadCosts({ silent: true }), loadCustomers({ silent: true }), loadChecks({ silent: true })]);
    }, "Analisi IA eliminata.");
  }



  async function deleteCostEvent(event) {
    if (!isAdmin() || busy) return;
    if (!(await confirmAction({ title: "Elimina costo", message: `Eliminare l’evento “${event.event_type || event.id}”?`, confirmLabel: "ELIMINA" }))) return;
    await runDestructiveAction(async () => {
      await deletePremiumRecords("cost_events", [event.id]);
      await loadCosts({ silent: true });
    }, "Evento di costo eliminato.");
  }



  function configCard(label, value, note = "") {
    return node("div", { className: "config-card" }, [
      node("span", { text: label }),
      node("strong", { text: value }),
      note ? node("small", { text: note }) : null,
    ]);
  }

  function renderSystemConfig() {
    const target = byId("systemConfigGrid");
    clear(target);
    if (!isAdmin()) {
      byId("systemConfigPanel").hidden = true;
      return;
    }
    byId("systemConfigPanel").hidden = false;
    const config = cache.systemConfig;
    if (!config) {
      target.append(node("div", { className: "empty", text: "Configurazione non disponibile." }));
      text(byId("systemConfigOverall"), "NON DISPONIBILE");
      return;
    }
    const rate = config.rateLimits || {};
    const pricing = config.pricing || {};
    const pricingValue = (value, field, unit = "€/1M") => {
      if (value === null || value === undefined || value === "") return "Mancante";
      const amount = Number(value);
      return Number.isFinite(amount) ? `${formatNumber(amount, 4)} ${unit}` : "Mancante";
    };
    const pricingSource = field => {
      const source = pricing.sources?.[field];
      if (source === "openai_usd_x_ecb") return "Listino OpenAI USD × cambio BCE";
      if (source === "environment") return "Tariffa EUR legacy da Vercel";
      if (source === "model_default") return "Fallback legacy escluso dai nuovi costi";
      return "Fonte non disponibile";
    };
    const fx = pricing.fx || {};
    const fxDate = fx.referenceDate ? formatDate(`${fx.referenceDate}T12:00:00Z`, false) : "—";
    const fxRate = Number(fx.usdToEur);
    const fxLabel = Number.isFinite(fxRate) ? `1 USD = ${formatNumber(fxRate, 6)} €` : "Non disponibile";
    const fxNote = fx.referenceDate
      ? `BCE · ${fxDate}${fx.stale ? " · ultimo cambio valido in cache" : " · aggiornamento automatico"}`
      : "Cambio BCE non disponibile";
    const pricingNote = pricing.complete
      ? `Listino OpenAI in USD convertito automaticamente con il cambio BCE (${fxLabel}).`
      : `Costo automatico non disponibile: ${(pricing.missing || []).join(", ") || "listino o cambio mancanti"}.`;
    const complete = Boolean(
      config.supabaseConfigured
      && config.databaseOperational
      && config.storageBucketOperational
      && config.openAiConfigured
      && config.offerHistoryOperational
      && config.persistentRateLimitConfigured
      && config.persistentRateLimitOperational
      && pricing.complete
    );
    const overall = byId("systemConfigOverall");
    text(overall, complete ? "PRONTA PER BETA" : "DA COMPLETARE");
    overall.className = `badge ${complete ? "ok" : "warn"}`;
    target.append(
      configCard("Supabase backend", config.supabaseConfigured ? "Configurato" : "Mancante"),
      configCard("Schema e database", config.databaseOperational ? "Operativi" : "Non verificati", "Profili, bollette e controlli"),
      configCard("Bucket bollette", config.storageBucketOperational ? "Operativo" : "Non disponibile", config.storageBucket || "premium-bills"),
      configCard("OpenAI API", config.openAiConfigured ? "Configurata" : "Mancante", config.model || "—"),
      configCard("Storico offerte ARERA", config.offerHistoryOperational ? "Disponibile" : "Non disponibile", config.offerHistoryOperational ? `${formatNumber(config.offerHistoryOffers || 0)} offerte${config.offerHistoryVersion ? ` · ${config.offerHistoryVersion}` : ""}` : "Riconoscimento offerta provvisorio"),
      configCard("Rate limit persistente", config.persistentRateLimitConfigured && config.persistentRateLimitOperational ? "Operativo" : (config.persistentRateLimitConfigured ? "Errore collegamento" : "Solo memoria"), "Per la beta serve Redis/KV persistente"),
      configCard("Tariffe IA", pricing.complete ? "Automatiche" : "Non disponibili", pricingNote),
      configCard("Cambio USD → EUR", fxLabel, fxNote),
      configCard("Tariffa input IA", pricingValue(pricing.inputPerMillion, "inputPerMillion"), pricingSource("inputPerMillion")),
      configCard("Tariffa cache IA", pricingValue(pricing.cachedInputPerMillion, "cachedInputPerMillion"), pricingSource("cachedInputPerMillion")),
      configCard("Tariffa output IA", pricingValue(pricing.outputPerMillion, "outputPerMillion"), pricingSource("outputPerMillion")),
      configCard("Tariffa ricerca web IA", pricingValue(pricing.webSearchPerThousand, "webSearchPerThousand", "€/1.000 ricerche"), pricingSource("webSearchPerThousand")),
      configCard("Limite PDF", `${formatNumber(Number(config.maxPdfBytes || 0) / 1_000_000, 1)} MB`),
      configCard("Deadline IA", `${formatNumber(Number(config.deadlineMs || 0) / 1000, 1)} s`),
      configCard("Analisi cliente", `${rate.customerAnalysis?.limit || 0} / ${Math.round(Number(rate.customerAnalysis?.windowSeconds || 0) / 60)} min`),
      configCard("Analisi staff", `${rate.staffAnalysis?.limit || 0} / ${Math.round(Number(rate.staffAnalysis?.windowSeconds || 0) / 60)} min`),
      configCard("Conferme offerta", `${rate.offerConfirmation?.limit || 0} / ${Math.round(Number(rate.offerConfirmation?.windowSeconds || 0) / 60)} min`)
    );
  }

  function collaboratorRoleDescriptor(role) {
    const normalized = String(role || "").trim().toLowerCase();
    if (normalized === "owner") return { label: "Proprietario", kind: "ok" };
    if (normalized === "admin") return { label: "Amministratore", kind: "info" };
    if (normalized === "technician") return { label: "Tecnico", kind: "warn" };
    if (normalized === "reviewer") return { label: "Revisore legacy", kind: "warn" };
    if (normalized === "support") return { label: "Supporto legacy", kind: "" };
    return { label: role || "Staff", kind: "" };
  }

  function collaboratorEditableRole(role) {
    const normalized = String(role || "").trim().toLowerCase();
    return ["admin", "technician"].includes(normalized) ? normalized : "technician";
  }

  async function addCollaborator(event) {
    event?.preventDefault?.();
    if (!isOwner() || busy) return;
    const form = byId("collaboratorAddForm");
    const email = String(form?.elements?.email?.value || "").trim().toLowerCase();
    const role = String(form?.elements?.role?.value || "technician").trim().toLowerCase();
    if (!email) {
      setMessage("error", "Inserisci l’email dell’account Auth da aggiungere.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await client.rpc("premium_owner_add_staff", { p_email: email, p_role: role });
      if (error) throw error;
      form?.reset();
      if (form?.elements?.role) form.elements.role.value = "technician";
      window.dispatchEvent(new Event("offertalogica:staff-save-complete"));
      await loadCollaborators({ silent: true });
      setMessage("success", `${email} aggiunto come ${roleLabel(role)}.`);
    } catch (error) {
      setMessage("error", friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  async function inviteCollaborator() {
    if (!isOwner() || busy) return;
    const form = byId("collaboratorAddForm");
    const email = String(form?.elements?.email?.value || "").trim().toLowerCase();
    const role = String(form?.elements?.role?.value || "technician").trim().toLowerCase();
    if (!email) {
      setMessage("error", "Inserisci l’email del nuovo collaboratore.");
      return;
    }
    if (!(await confirmAction({
      title: "Invita nuovo collaboratore",
      message: `Inviare a ${email} un invito Staff come ${roleLabel(role)}?`,
      confirmLabel: "INVIA INVITO",
    }))) return;
    setBusy(true);
    try {
      const token = await accessToken();
      const response = await fetch(PREMIUM_STAFF_INVITE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "invite",
          email,
          role,
          redirect_origin: window.location.origin,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `Errore HTTP ${response.status}`);
      form?.reset();
      if (form?.elements?.role) form.elements.role.value = "technician";
      window.dispatchEvent(new Event("offertalogica:staff-save-complete"));
      await loadCollaborators({ silent: true });
      setMessage("success", `Invito inviato a ${email}. Il collaboratore deve aprire l’email e impostare la password.`);
    } catch (error) {
      setMessage("error", friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveCollaboratorRole(item, role) {
    if (!isOwner() || busy || item?.role === "owner") return;
    const nextRole = collaboratorEditableRole(role);
    if (!(await confirmAction({
      title: "Modifica ruolo collaboratore",
      message: `Impostare ${item.email || item.user_id} come ${roleLabel(nextRole)}?`,
      confirmLabel: "SALVA RUOLO",
    }))) return;
    setBusy(true);
    try {
      const { error } = await client.rpc("premium_owner_update_staff", {
        p_user_id: item.user_id,
        p_role: nextRole,
        p_active: Boolean(item.active),
      });
      if (error) throw error;
      await loadCollaborators({ silent: true });
      setMessage("success", "Ruolo collaboratore aggiornato.");
    } catch (error) {
      setMessage("error", friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  async function toggleCollaboratorActive(item) {
    if (!isOwner() || busy || item?.role === "owner") return;
    const nextActive = !Boolean(item.active);
    const nextRole = collaboratorEditableRole(item.role);
    if (!(await confirmAction({
      title: nextActive ? "Riattiva collaboratore" : "Disattiva collaboratore",
      message: nextActive
        ? `Riattivare l’accesso Staff per ${item.email || item.user_id}?`
        : `Disattivare l’accesso Staff per ${item.email || item.user_id}?`,
      confirmLabel: nextActive ? "RIATTIVA" : "DISATTIVA",
    }))) return;
    setBusy(true);
    try {
      const { error } = await client.rpc("premium_owner_update_staff", {
        p_user_id: item.user_id,
        p_role: nextRole,
        p_active: nextActive,
      });
      if (error) throw error;
      await loadCollaborators({ silent: true });
      setMessage("success", nextActive ? "Collaboratore riattivato." : "Collaboratore disattivato.");
    } catch (error) {
      setMessage("error", friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  async function removeCollaborator(item) {
    if (!isOwner() || busy || item?.role === "owner" || item?.removed_at) return false;
    const pendingInvite = String(item.activation_status || "") === "invited_pending";
    const label = item.email || item.user_id || "collaboratore";
    const confirmed = await confirmAction({
      title: pendingInvite ? "Annulla invito" : "Rimuovi collaboratore",
      message: pendingInvite
        ? `Annullare l’invito Staff inviato a ${label}? L’account non avrà accesso al Control Center.`
        : `Rimuovere ${label} dal Control Center? Lo storico delle operazioni resterà conservato.`,
      keyword: pendingInvite ? "ANNULLA" : "RIMUOVI",
      confirmLabel: pendingInvite ? "ANNULLA INVITO" : "RIMUOVI",
    });
    if (!confirmed) return false;
    setBusy(true);
    try {
      const { error } = await client.rpc("premium_owner_remove_staff", {
        p_user_id: item.user_id,
        p_reason: pendingInvite
          ? "Invito annullato dal Proprietario prima dell’attivazione"
          : "Accesso Staff rimosso dal Proprietario nel Control Center",
      });
      if (error) throw error;
      await loadCollaborators({ silent: true });
      setMessage("success", pendingInvite ? "Invito annullato." : "Collaboratore rimosso. Lo storico resta conservato.");
      window.dispatchEvent(new Event("offertalogica:staff-save-complete"));
      return true;
    } catch (error) {
      setMessage("error", friendlyError(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function purgeCollaborator(item) {
    if (!isOwner() || busy || item?.role === "owner" || !item?.removed_at) return false;
    const label = item.email || item.user_id || "collaboratore";
    const confirmed = await confirmAction({
      title: "Elimina definitivamente collaboratore",
      message: `Eliminare definitivamente ${label} dall’elenco Staff? Questa azione è ammessa solo per collaboratori già rimossi e senza attività storica reale. L’account Auth resta conservato ma non avrà alcun accesso Staff.`,
      keyword: "ELIMINA DEFINITIVAMENTE",
      confirmLabel: "ELIMINA DEFINITIVAMENTE",
    });
    if (!confirmed) return false;
    setBusy(true);
    try {
      const { error } = await client.rpc("premium_owner_purge_removed_staff", {
        p_user_id: item.user_id,
        p_confirmation: "ELIMINA DEFINITIVAMENTE",
        p_reason: "Profilo Staff di prova eliminato definitivamente dal Proprietario",
      });
      if (error) throw error;
      await loadCollaborators({ silent: true });
      setMessage("success", `${label} eliminato definitivamente dallo Staff. Account Auth conservato, accesso Staff assente.`);
      window.dispatchEvent(new Event("offertalogica:staff-save-complete"));
      return true;
    } catch (error) {
      setMessage("error", friendlyError(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function restoreCollaborator(item) {
    if (!isOwner() || busy || item?.role === "owner" || !item?.removed_at) return false;
    const role = collaboratorEditableRole(item.role);
    const label = item.email || item.user_id || "collaboratore";
    const confirmed = await confirmAction({
      title: "Ripristina collaboratore",
      message: `Ripristinare ${label} come ${roleLabel(role)}? Per un Amministratore i permessi specifici dovranno essere assegnati nuovamente.`,
      confirmLabel: "RIPRISTINA",
    });
    if (!confirmed) return false;
    setBusy(true);
    try {
      const { error } = await client.rpc("premium_owner_restore_staff", {
        p_user_id: item.user_id,
        p_role: role,
        p_reason: "Collaboratore ripristinato dal Proprietario nel Control Center",
      });
      if (error) throw error;
      await loadCollaborators({ silent: true });
      setMessage("success", "Collaboratore ripristinato.");
      window.dispatchEvent(new Event("offertalogica:staff-save-complete"));
      return true;
    } catch (error) {
      setMessage("error", friendlyError(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function collaboratorStatusNode(item) {
    if (item?.removed_at) return badge("Rimosso", "danger");
    if (!item?.active) return badge("Disattivato", "danger");
    const activationStatus = String(item?.activation_status || "");
    if (activationStatus === "invited_pending") return badge("Invito inviato", "warn");
    if (activationStatus === "email_unconfirmed") return badge("Email non confermata", "warn");
    if (activationStatus === "auth_missing") return badge("Account non disponibile", "danger");
    return badge("Attivo", "ok");
  }

  function renderCollaborators() {
    const restricted = !isOwner();
    const restrictedBox = byId("collaboratorRestricted");
    const content = byId("collaboratorContent");
    if (restrictedBox) restrictedBox.hidden = !restricted;
    if (content) content.hidden = restricted;
    if (restricted) return;

    const rows = Array.isArray(cache.collaborators) ? cache.collaborators : [];
    const currentRows = rows.filter(item => !item.removed_at);
    text(byId("navCollaboratorCount"), currentRows.length);
    text(byId("collaboratorMetricTotal"), currentRows.length);
    text(byId("collaboratorMetricActive"), currentRows.filter(item => item.active).length);
    text(byId("collaboratorMetricAdmins"), currentRows.filter(item => item.role === "admin").length);
    text(byId("collaboratorMetricTechnicians"), currentRows.filter(item => item.role === "technician").length);
    text(byId("collaboratorShowRemoved"), includeRemovedCollaborators ? "Nascondi rimossi" : "Mostra rimossi");

    const body = byId("collaboratorRows");
    clear(body);
    if (!rows.length) {
      body.append(node("tr", {}, [node("td", { text: "Nessun collaboratore Staff disponibile.", attrs: { colspan: "6" } })]));
      return;
    }
    rows.forEach(item => {
      const descriptor = collaboratorRoleDescriptor(item.role);
      let actions;
      if (item.role === "owner") {
        actions = node("div", { className: "row-actions" }, [badge("Protetto", "ok")]);
      } else if (item.removed_at) {
        const restore = node("button", { className: "button primary compact", type: "button", text: "Ripristina" });
        restore.addEventListener("click", () => restoreCollaborator(item));
        const purge = node("button", {
          className: "button danger compact",
          type: "button",
          text: "Elimina definitivamente",
          attrs: { title: "Disponibile solo se non esiste attività storica reale" },
        });
        purge.addEventListener("click", () => purgeCollaborator(item));
        actions = node("div", { className: "row-actions" }, [restore, purge]);
      } else {
        const roleSelect = node("select", { attrs: { "aria-label": `Ruolo ${item.email || item.user_id}` } }, [
          node("option", { value: "technician", text: "Tecnico" }),
          node("option", { value: "admin", text: "Amministratore" }),
        ]);
        roleSelect.value = collaboratorEditableRole(item.role);
        const saveRole = node("button", { className: "button secondary compact", type: "button", text: "Salva ruolo" });
        saveRole.addEventListener("click", () => saveCollaboratorRole(item, roleSelect.value));
        const toggleActive = node("button", {
          className: `button ${item.active ? "danger" : "primary"} compact`,
          type: "button",
          text: item.active ? "Disattiva" : "Riattiva",
        });
        toggleActive.addEventListener("click", () => toggleCollaboratorActive(item));
        const pendingInvite = String(item.activation_status || "") === "invited_pending";
        const remove = node("button", {
          className: "button danger compact",
          type: "button",
          text: pendingInvite ? "Annulla invito" : "Rimuovi",
        });
        remove.addEventListener("click", () => removeCollaborator(item));
        actions = node("div", { className: "row-actions" }, [roleSelect, saveRole, toggleActive, remove]);
      }
      const row = node("tr", {}, [
        node("td", {}, [node("strong", { text: item.email || item.user_id || "Account Staff" }), node("small", { text: item.user_id || "" })]),
        node("td", {}, [badge(descriptor.label, descriptor.kind)]),
        node("td", {}, [collaboratorStatusNode(item)]),
        node("td", { text: formatDate(item.created_at) }),
        node("td", { text: item.removed_at ? formatDate(item.removed_at) : formatDate(item.updated_at) }),
        node("td", {}, [actions]),
      ]);
      row.dataset.staffRemoved = item.removed_at ? "true" : "false";
      body.append(row);
    });
  }

  async function loadCollaborators({ silent = false } = {}) {
    if (!isOwner()) {
      collaboratorsLoaded = false;
      auditLoaded = false;
      cache.collaborators = [];
      cache.audit = [];
      renderCollaborators();
      return;
    }
    if (!silent) setMessage("info", "Aggiornamento collaboratori…");
    const { data, error } = await client.rpc("premium_owner_list_staff_v2", {
      p_include_removed: includeRemovedCollaborators,
    });
    if (error) throw error;
    cache.collaborators = Array.isArray(data) ? data : [];
    collaboratorsLoaded = true;
    renderCollaborators();
    window.dispatchEvent(new CustomEvent("offertalogica:collaborators-refreshed", {
      detail: { includeRemoved: includeRemovedCollaborators },
    }));
    if (activeTab === "collaborators") {
      try {
        await loadOwnerAudit({ silent: true });
      } catch (error) {
        setAuditStatus(`Audit non disponibile: ${friendlyError(error)}`);
      }
    }
    if (!silent) setMessage("success", "Collaboratori aggiornati.");
  }

  async function collaboratorActionTarget(userId, { includeRemoved = false } = {}) {
    if (!isOwner()) throw new Error("premium_owner_required");
    const id = String(userId || "").trim();
    if (!id) throw new Error("premium_staff_member_not_found");

    if (includeRemoved && !includeRemovedCollaborators) {
      includeRemovedCollaborators = true;
      await loadCollaborators({ silent: true });
    } else if (!collaboratorsLoaded) {
      await loadCollaborators({ silent: true });
    }

    let item = cache.collaborators.find(row => String(row?.user_id || "") === id) || null;
    if (!item && !includeRemovedCollaborators) {
      includeRemovedCollaborators = true;
      await loadCollaborators({ silent: true });
      item = cache.collaborators.find(row => String(row?.user_id || "") === id) || null;
    }
    if (!item) throw new Error("premium_staff_member_not_found");
    return item;
  }

  function focusCollaboratorFromManagement({ userId = "", email = "" } = {}) {
    if (!isOwner()) return false;
    setTab("collaborators");
    const query = String(email || userId || "").trim();
    window.setTimeout(() => {
      const search = byId("p7CollaboratorSearch");
      if (!search || !query) return;
      search.value = query;
      search.dispatchEvent(new Event("input", { bubbles: true }));
    }, 0);
    return true;
  }

  async function removeCollaboratorFromManagement(userId) {
    try {
      const item = await collaboratorActionTarget(userId, { includeRemoved: false });
      return await removeCollaborator(item);
    } catch (error) {
      setMessage("error", friendlyError(error));
      return false;
    }
  }

  async function restoreCollaboratorFromManagement(userId) {
    try {
      const item = await collaboratorActionTarget(userId, { includeRemoved: true });
      return await restoreCollaborator(item);
    } catch (error) {
      setMessage("error", friendlyError(error));
      return false;
    }
  }

  async function purgeCollaboratorFromManagement(userId) {
    try {
      const item = await collaboratorActionTarget(userId, { includeRemoved: true });
      return await purgeCollaborator(item);
    } catch (error) {
      setMessage("error", friendlyError(error));
      return false;
    }
  }

  window.OffertaLogicaStaffCollaboratorActions = Object.freeze({
    focus: focusCollaboratorFromManagement,
    remove: removeCollaboratorFromManagement,
    restore: restoreCollaboratorFromManagement,
    purge: purgeCollaboratorFromManagement,
  });

  function auditCategory(action) {
    const value = String(action || "").trim().toLowerCase();
    if (value.includes("export")) return "EXPORT";
    if (/delete|deleted|purge|purged|remove|removed|revoke|revoked|cancel|exclude|excluded|rectif|annull/.test(value)) return "DELETE-RECTIFY";
    if (/permission|role|assign|assigned|access_deactivated|access_reactivated/.test(value)) return "ASSIGN";
    if (/create|created|add|added|invite|invited|grant|granted/.test(value)) return "CREATE";
    if (/update|updated|modify|modified|change|changed|edit|edited|restore|restored|extend|extended|reopen|correct/.test(value)) return "MODIFY";
    return "VIEW";
  }

  function auditCategoryKind(category) {
    if (category === "DELETE-RECTIFY") return "danger";
    if (category === "ASSIGN" || category === "MODIFY") return "warn";
    if (category === "CREATE" || category === "EXPORT") return "ok";
    return "";
  }

  function auditCategoryLabel(category) {
    return ({
      VIEW: "Visualizzazione",
      CREATE: "Creazione",
      MODIFY: "Modifica",
      "DELETE-RECTIFY": "Eliminazione / Rettifica",
      EXPORT: "Esportazione",
      ASSIGN: "Assegnazione",
    })[String(category || "").trim().toUpperCase()] || String(category || "—");
  }

  function auditResultLabel(result) {
    const value = String(result || "").trim().toLowerCase();
    return ({ success: "Riuscito", error: "Errore", failed: "Fallito", denied: "Negato", blocked: "Bloccato" })[value] || (result || "—");
  }

  function setAuditStatus(message) {
    const target = byId("collaboratorAuditStatus");
    if (!target) return;
    target.textContent = String(message || "");
    target.hidden = !message;
  }

  function auditFilteredRows() {
    const selected = String(byId("collaboratorAuditCategory")?.value || "ALL").trim().toUpperCase();
    const rows = Array.isArray(cache.audit) ? cache.audit : [];
    if (selected === "ALL") return rows;
    return rows.filter(row => auditCategory(row?.action) === selected);
  }

  function renderAudit() {
    const body = byId("collaboratorAuditRows");
    if (!body) return;
    clear(body);
    const rows = auditFilteredRows();
    if (!rows.length) {
      body.append(node("tr", {}, [node("td", { text: auditLoaded ? "Nessun evento Audit per il filtro selezionato." : "Audit non ancora caricato.", attrs: { colspan: "7" } })]));
      return;
    }
    rows.forEach(item => {
      const category = auditCategory(item?.action);
      const target = [item?.target_type, item?.target_id].filter(Boolean).join(" · ") || "—";
      body.append(node("tr", {}, [
        node("td", { text: formatDate(item?.event_created_at) }),
        node("td", {}, [badge(auditCategoryLabel(category), auditCategoryKind(category))]),
        node("td", { text: item?.action || "—" }),
        node("td", {}, [node("strong", { text: item?.staff_email || item?.staff_user_id || "Staff" }), node("small", { text: roleLabel(item?.staff_role) })]),
        node("td", { text: target }),
        node("td", {}, [badge(auditResultLabel(item?.result), String(item?.result || "").toLowerCase() === "success" ? "ok" : "warn")]),
        node("td", { text: item?.reason || "—" }),
      ]));
    });
  }

  async function loadOwnerAudit({ silent = false } = {}) {
    if (!isOwner()) {
      cache.audit = [];
      auditLoaded = false;
      renderAudit();
      return;
    }
    if (!silent) setAuditStatus("Aggiornamento Audit…");
    const { data, error } = await client.rpc("premium_owner_list_audit", { p_limit: 500, p_offset: 0 });
    if (error) throw error;
    cache.audit = Array.isArray(data) ? data : [];
    auditLoaded = true;
    renderAudit();
    setAuditStatus(`Ultimi ${cache.audit.length} eventi Audit caricati.`);
  }

  async function recordExportAudit(scope, { targetId = null, metadata = {} } = {}) {
    if (!client) throw new Error("premium_staff_audit_unavailable");
    const { data, error } = await client.rpc("premium_staff_record_export", {
      p_scope: String(scope || "").trim().toLowerCase(),
      p_target_id: targetId == null ? null : String(targetId),
      p_metadata: metadata && typeof metadata === "object" ? metadata : {},
    });
    if (error) throw error;
    return data;
  }

  async function exportAuditCsv() {
    if (!isOwner() || busy) return;
    const rows = auditFilteredRows();
    if (!rows.length) {
      setMessage("info", "Nessun evento Audit da esportare con il filtro selezionato.");
      return;
    }
    const category = String(byId("collaboratorAuditCategory")?.value || "ALL");
    setBusy(true);
    try {
      await recordExportAudit("audit", { targetId: category, metadata: { category, rows: rows.length } });
      const csvRows = [["Data", "Categoria", "Azione", "Email Staff", "Ruolo", "Risorsa", "ID risorsa", "Esito", "Motivo", "Origine"], ...rows.map(item => [
        item?.event_created_at || "", auditCategoryLabel(auditCategory(item?.action)), item?.action || "", item?.staff_email || "", item?.staff_role || "", item?.target_type || "", item?.target_id || "", auditResultLabel(item?.result), item?.reason || "", item?.source || "",
      ])];
      const cell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
      const content = "\ufeff" + csvRows.map(row => row.map(cell).join(";")).join("\r\n") + "\r\n";
      const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = node("a", { attrs: { href: url, download: `offertalogica-audit-${new Date().toISOString().slice(0, 10)}.csv` } });
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      await loadOwnerAudit({ silent: true });
      setMessage("success", "Registro Audit esportato e operazione registrata.");
    } catch (error) {
      setMessage("error", `Esportazione bloccata: ${friendlyError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  window.OffertaLogicaStaffAudit = Object.freeze({
    recordExport: recordExportAudit,
    refresh: () => loadOwnerAudit({ silent: true }),
  });

  async function loadSystemConfig() {
    if (!isAdmin()) {
      cache.systemConfig = null;
      renderSystemConfig();
      return;
    }
    const payload = await staffFetch("/api/premium-ai-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "config_status" }),
    });
    cache.systemConfig = payload.configuration || null;
    renderSystemConfig();
  }

  async function loadAllCostMetricRows(table, selectColumns) {
    const rows = [];
    let from = 0;
    while (true) {
      const { data, error } = await client
        .from(table)
        .select(selectColumns)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + COST_METRICS_PAGE_SIZE - 1);
      if (error) throw error;
      const page = Array.isArray(data) ? data : [];
      rows.push(...page);
      if (page.length < COST_METRICS_PAGE_SIZE) break;
      from += COST_METRICS_PAGE_SIZE;
    }
    return rows;
  }

  async function loadCosts({ silent = false } = {}) {
    if (!silent) setMessage("info", "Aggiornamento costi e tempi…");
    const [runs, checks] = await Promise.all([
      loadAllCostMetricRows("premium_analysis_runs", "id,user_id,bill_id,status,model,origin,error_code,input_tokens,output_tokens,estimated_cost_eur,duration_ms,usage_details,created_at"),
      loadAllCostMetricRows("premium_checks", "id,user_id,bill_id,status,outcome,human_seconds,completed_at,created_at"),
    ]);
    cache.runs = runs;
    cache.checks = checks;
    cache.costEvents = [];
    if (isAdmin()) {
      const eventsResult = await client.from("premium_cost_events").select("id,analysis_run_id,bill_id,event_type,provider,quantity,unit,cost_eur,currency,metadata,occurred_at").order("occurred_at", { ascending: false }).limit(1000);
      if (eventsResult.error) throw eventsResult.error;
      cache.costEvents = eventsResult.data || [];
      await loadSystemConfig().catch(() => { cache.systemConfig = null; renderSystemConfig(); });
    } else {
      cache.systemConfig = null;
      renderSystemConfig();
    }
    const tokens = cache.runs.reduce((sum, run) => sum + Number(run.input_tokens || 0) + Number(run.output_tokens || 0), 0);
    const verifiedCostRuns = cache.runs.map(run => ({ run, cost: verifiedRunCost(run) })).filter(item => item.cost != null);
    const aiCost = verifiedCostRuns.reduce((sum, item) => sum + item.cost, 0);
    const pricedCustomers = new Set(verifiedCostRuns.map(item => String(item.run?.user_id || "").trim()).filter(Boolean));
    const averageAiCostPerAnalysis = verifiedCostRuns.length ? aiCost / verifiedCostRuns.length : 0;
    const averageAiCostPerCustomer = pricedCustomers.size ? aiCost / pricedCustomers.size : 0;
    const humanSeconds = cache.checks.reduce((sum, check) => sum + Number(check.human_seconds || 0), 0);
    const humanCost = humanCostEur(humanSeconds);
    cache.costSummary = {
      runs: cache.runs.length, tokens, aiCost, pricedRuns: verifiedCostRuns.length,
      pricedCustomers: pricedCustomers.size, averageAiCostPerAnalysis, averageAiCostPerCustomer,
      humanSeconds, humanCost,
    };
    text(byId("costRuns"), cache.runs.length);
    text(byId("costTokens"), formatNumber(tokens));
    text(byId("costAi"), verifiedCostRuns.length
      ? formatMoney(aiCost)
      : cache.runs.length ? "Storico non verificato" : formatMoney(0));
    text(byId("costAiCoverage"), cache.runs.length
      ? `${formatNumber(verifiedCostRuns.length)} / ${formatNumber(cache.runs.length)} analisi con costo verificato`
      : "Nessuna analisi registrata");
    text(byId("costAverageAnalysis"), verifiedCostRuns.length ? formatMoney(averageAiCostPerAnalysis) : formatMoney(0));
    text(byId("costAverageAnalysisMeta"), verifiedCostRuns.length
      ? `Su ${formatNumber(verifiedCostRuns.length)} analisi contabilizzate`
      : "Nessuna analisi contabilizzata");
    text(byId("costAverageCustomer"), pricedCustomers.size ? formatMoney(averageAiCostPerCustomer) : formatMoney(0));
    text(byId("costAverageCustomerMeta"), pricedCustomers.size
      ? `Su ${formatNumber(pricedCustomers.size)} clienti con costi IA`
      : "Nessun cliente contabilizzato");
    const humanDuration = humanSeconds >= 3600 ? `${formatNumber(humanSeconds / 3600, 1)} h` : `${Math.round(humanSeconds / 60)} min`;
    text(byId("costHuman"), `${humanDuration} · ${formatMoney(humanCost)}`);
    const humanMetric = byId("costHuman")?.closest(".metric");
    if (humanMetric) {
      text(humanMetric.querySelector("span"), "Tempo / costo operatore");
      text(humanMetric.querySelector("small"), `Tariffa standard: ${HUMAN_COST_EUR_PER_HOUR} €/h`);
    }
    renderCostRuns();
    renderCostEvents();
    if (!silent) setMessage("success", "Costi e tempi aggiornati.");
  }

  function renderOverview() {
    const leadSummary = cache.leadSummary || {};
    buildOperationalCases();
    const activeCases = cache.cases.filter(item => !item.closed);
    text(byId("overviewLeads"), isAdmin() ? leadSummary.recentRows || 0 : "Riservato");
    text(byId("overviewLeadsMeta"), isAdmin() ? `${leadSummary.verifiedRows || 0} verificati OTP` : "Solo amministratori");
    text(byId("overviewCases"), activeCases.length);
    text(byId("overviewCustomers"), cache.customers.length);
    text(byId("overviewAiCost"), cache.costSummary.pricedRuns
      ? formatMoney(cache.costSummary.aiCost)
      : cache.costSummary.runs ? "Storico non verificato" : formatMoney(0));
    text(byId("navCaseCount"), activeCases.length);

    const target = byId("overviewTasks");
    clear(target);
    const grouped = [
      ["support_request", "richieste assistenza", "cases"],
      ["account_deletion", "cancellazioni account", "customers"],
      ["payment", "pagamenti da verificare", "customers"],
      ["bill_check", "verifiche bollette aperte", "checks"],
      ["ai_failure", "analisi IA fallite", "costs"],
    ];
    const list = node("div", { className: "rank-list" });
    grouped.forEach(([type, label, tab]) => {
      const count = activeCases.filter(item => item.type === type).length;
      const button = node("button", { className: "rank-row", type: "button" }, [node("strong", { text: label }), node("span", { text: count })]);
      button.addEventListener("click", () => count ? setTab("cases") : setTab(tab));
      list.append(button);
    });
    if (isAdmin()) {
      const leadButton = node("button", { className: "rank-row", type: "button" }, [node("strong", { text: "lead con offerta scelta" }), node("span", { text: leadSummary.withSelectedOffer || 0 })]);
      leadButton.addEventListener("click", () => setTab("leads"));
      list.append(leadButton);
    }
    target.append(list);
    renderSessionFunnel(byId("overviewFunnel"), cache.analyticsSummary.sessionFunnel || {});
  }

  async function loadOverview({ silent = false } = {}) {
    if (!silent) setMessage("info", "Aggiornamento riepilogo…");
    const tasks = [loadChecks({ silent: true }), loadCustomers({ silent: true }), loadAnalytics({ silent: true }), loadCosts({ silent: true }), loadSupportRequests({ silent: true })];
    if (isAdmin()) tasks.push(loadLeads({ silent: true }));
    if (isOwner()) tasks.push(loadCollaborators({ silent: true }));
    const results = await Promise.allSettled(tasks);
    const failures = results.filter(result => result.status === "rejected");
    renderOverview();
    if (failures.length) {
      setMessage("info", `Riepilogo parziale: ${failures.length} modulo/i non disponibili. Gli altri dati restano operativi.`);
    } else if (!silent) {
      setMessage("success", "Riepilogo aggiornato.");
    }
  }

  async function refreshTab(tab, { silent = false } = {}) {
    if (!currentStaff || busy) return;
    if (tab === "overview") return loadOverview({ silent });
    if (tab === "cases") return loadCases({ silent });
    if (tab === "leads") return loadLeads({ silent });
    if (tab === "checks") return loadChecks({ silent });
    if (tab === "customers") return loadCustomers({ silent });
    if (tab === "analytics") return loadAnalytics({ silent });
    if (tab === "collaborators") {
      if (silent && collaboratorsLoaded) return;
      return loadCollaborators({ silent });
    }
    if (tab === "costs") return loadCosts({ silent });
    if (tab === "pdf") {
      ensureFrame("pdfFrame");
      if (!silent) byId("pdfFrame")?.contentWindow?.location.reload();
    }
  }

  function staffContextDescriptor(session, staff) {
    const userId = String(session?.user?.id || "");
    const email = String(session?.user?.email || "").trim().toLowerCase();
    const role = String(staff?.role || "").trim().toLowerCase();
    const active = staff?.active === true ? "1" : "0";
    return `${userId}|${email}|${role}|${active}`;
  }

  function dispatchStaffContextChanged(session, staff) {
    window.dispatchEvent(new CustomEvent("offertalogica:staff-context-changed", {
      detail: {
        userId: String(session?.user?.id || ""),
        email: String(session?.user?.email || ""),
        role: String(staff?.role || ""),
        active: staff?.active === true,
      },
    }));
  }

  async function requireStaffMfa() {
    if (mfaRedirectInProgress) return false;

    const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) throw error;
    if (data?.currentLevel === "aal2") return true;

    // La membership Staff è valida, ma la sessione non ha ancora completato
    // il secondo fattore. Non mostriamo il Control Center: instradiamo al
    // flusso TOTP che condivide la stessa sessione Supabase.
    mfaRedirectInProgress = true;
    currentStaff = null;
    staffContextKey = "";
    collaboratorsLoaded = false;
    auditLoaded = false;
    cache.audit = [];
    setView("auth");
    setAuthMessage("info", "Verifica di sicurezza richiesta…");
    window.location.replace("/staff-mfa.html");
    return false;
  }

  async function verifyStaff(session, { refreshOverview = true } = {}) {
    currentSession = session;

    if (!session?.user) {
      const hadContext = Boolean(currentStaff || staffContextKey);
      currentStaff = null;
      staffContextKey = "";
      collaboratorsLoaded = false;
      auditLoaded = false;
      cache.audit = [];
      setView("auth");
      setAuthMessage("", "");
      if (hadContext) dispatchStaffContextChanged(null, null);
      return;
    }

    if (staffVerificationRequest) return staffVerificationRequest;

    staffVerificationRequest = (async () => {
      const result = await client.from("premium_staff_members")
        .select("user_id,role,active")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (result.error || !result.data?.active || !ALLOWED_ROLES.has(result.data.role)) {
        const deniedKey = `denied|${session.user.id}`;
        const changed = staffContextKey !== deniedKey || currentStaff !== null;
        currentStaff = null;
        staffContextKey = deniedKey;
        setView("denied");
        if (changed) dispatchStaffContextChanged(session, null);
        return;
      }

      if (!(await requireStaffMfa())) return;

      const nextStaff = result.data;
      const nextKey = staffContextDescriptor(session, nextStaff);
      const contextChanged = staffContextKey !== nextKey;
      const appAlreadyVisible = byId("staffApp")?.hidden === false;

      if (contextChanged) {
        collaboratorsLoaded = false;
        auditLoaded = false;
        cache.audit = [];
      }
      currentStaff = nextStaff;
      currentSession = session;

      // TOKEN_REFRESHED / SIGNED_IN ripetuti e sessioni identiche non devono
      // riscrivere il DOM, cambiare tab o ricaricare i dati del Control Center.
      if (!contextChanged && appAlreadyVisible) return;

      staffContextKey = nextKey;
      text(byId("staffIdentity"), `${roleLabel(currentStaff.role)} · ${session.user.email || "account staff"}`);

      const ownerOnlyVisible = isOwner();
      setHidden(byId("staffManagementGroup"), !ownerOnlyVisible);
      setHidden(byId("staffCollaboratorsTab"), !ownerOnlyVisible);
      [
        "leadCsv", "leadDeleteVisible", "leadReset", "customerDeleteVisible"
      ].forEach(id => setHidden(byId(id), !isAdmin()));

      setView("app");
      const requestedTab = VALID_TABS.has(location.hash.slice(1)) ? location.hash.slice(1) : "overview";
      const nextTab = requestedTab === "collaborators" && !isOwner() ? "overview" : requestedTab;
      if (activeTab !== nextTab || contextChanged || !appAlreadyVisible) {
        activeTab = nextTab;
        setTab(activeTab, { updateHash: false, refresh: false });
      }

      if (refreshOverview && (contextChanged || !appAlreadyVisible)) {
        try {
          await loadOverview({ silent: true });
          renderOverview();
        } catch (error) {
          setMessage("error", friendlyError(error));
        }
      }

      if (contextChanged) dispatchStaffContextChanged(session, currentStaff);
    })().finally(() => {
      staffVerificationRequest = null;
    });

    return staffVerificationRequest;
  }

  function handleAuthStateChange(event, session) {
    currentSession = session;

    // Supabase può emettere SIGNED_IN/TOKEN_REFRESHED anche con lo stesso utente.
    // Verifichiamo comunque la membership, ma l'operazione è idempotente e
    // non ridisegna nulla se identità/ruolo/stato sono invariati.
    const refreshOverview = !["TOKEN_REFRESHED", "INITIAL_SESSION"].includes(String(event || ""));
    window.setTimeout(() => verifyStaff(session, { refreshOverview }).catch(error => {
      setView("auth");
      setAuthMessage("error", friendlyError(error));
    }), 0);
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
    setBusy(false);
    if (error) {
      setAuthMessage("error", friendlyError(error));
      return;
    }
    form.reset();
    setAuthMessage("", "");
  }

  async function logout() {
    if (!client || busy) return;
    setBusy(true);
    byId("checksFrame").removeAttribute("src");
    byId("pdfFrame").removeAttribute("src");
    await client.auth.signOut();
    setBusy(false);
  }

  function bindEvents() {
    byId("staffLoginForm").addEventListener("submit", handleLogin);
    byId("staffLogout").addEventListener("click", logout);
    byId("staffDeniedLogout").addEventListener("click", logout);
    byId("staffRefresh").addEventListener("click", () => refreshTab(activeTab).catch(error => setMessage("error", friendlyError(error))));
    document.querySelectorAll("[data-staff-tab]").forEach(button => button.addEventListener("click", () => setTab(button.dataset.staffTab)));
    byId("caseRefresh").addEventListener("click", () => loadCases().catch(error => setMessage("error", friendlyError(error))));
    byId("caseSearch").addEventListener("input", renderCases);
    byId("caseType").addEventListener("change", renderCases);
    byId("casePriority").addEventListener("change", renderCases);
    byId("caseApplyFilters").addEventListener("click", renderCases);
    byId("leadRefresh").addEventListener("click", () => loadLeads().catch(error => setMessage("error", friendlyError(error))));
    byId("leadSearch").addEventListener("input", renderLeads);
    byId("leadLimit").addEventListener("change", () => loadLeads().catch(error => setMessage("error", friendlyError(error))));
    byId("leadCsv").addEventListener("click", downloadLeadCsv);
    byId("leadDeleteVisible").addEventListener("click", deleteVisibleLeads);
    byId("leadReset").addEventListener("click", resetLeads);
    byId("customerDeleteVisible").addEventListener("click", deleteVisibleCustomers);
    byId("customerRefresh").addEventListener("click", () => loadCustomers().catch(error => setMessage("error", friendlyError(error))));
    byId("customerSearch").addEventListener("input", renderCustomers);
    byId("customerStatus").addEventListener("change", renderCustomers);
    byId("customerLimit").addEventListener("change", () => loadCustomers().catch(error => setMessage("error", friendlyError(error))));
    byId("staffComplimentaryCancel").addEventListener("click", closeComplimentary);
    byId("staffComplimentaryApply").addEventListener("click", applyComplimentary);
    byId("staffComplimentaryRevoke").addEventListener("click", revokeComplimentary);
    byId("staffComplimentaryLayer").addEventListener("click", event => { if (event.target === byId("staffComplimentaryLayer")) closeComplimentary(); });
    document.addEventListener("keydown", event => { if (event.key === "Escape" && !byId("staffComplimentaryLayer")?.hidden) closeComplimentary(); });
    byId("analyticsRefresh").addEventListener("click", () => loadAnalytics().catch(error => setMessage("error", friendlyError(error))));
    byId("landingPathRange")?.addEventListener("change", () => loadAnalytics({ silent: true }).catch(error => setMessage("error", friendlyError(error))));
    byId("analyticsEventFilter")?.addEventListener("change", renderAnalytics);
    byId("analyticsOriginFilter")?.addEventListener("change", renderAnalytics);
    byId("analyticsFilterReset")?.addEventListener("click", () => {
      if (byId("analyticsEventFilter")) byId("analyticsEventFilter").value = "";
      if (byId("analyticsOriginFilter")) byId("analyticsOriginFilter").value = "";
      renderAnalytics();
    });
    byId("collaboratorRefresh").addEventListener("click", () => loadCollaborators().catch(error => setMessage("error", friendlyError(error))));
    byId("collaboratorShowRemoved").addEventListener("click", () => {
      includeRemovedCollaborators = !includeRemovedCollaborators;
      loadCollaborators().catch(error => setMessage("error", friendlyError(error)));
    });
    byId("collaboratorAddForm").addEventListener("submit", addCollaborator);
    byId("collaboratorInvite").addEventListener("click", inviteCollaborator);
    byId("collaboratorAuditRefresh")?.addEventListener("click", () => loadOwnerAudit().catch(error => setAuditStatus(`Audit non disponibile: ${friendlyError(error)}`)));
    byId("collaboratorAuditCategory")?.addEventListener("change", renderAudit);
    byId("collaboratorAuditExport")?.addEventListener("click", () => { void exportAuditCsv(); });
    byId("costRefresh").addEventListener("click", () => loadCosts().catch(error => setMessage("error", friendlyError(error))));
    window.addEventListener("hashchange", () => setTab(location.hash.slice(1), { updateHash: false }));
  }

  async function init() {
    if (!window.supabase?.createClient) {
      setView("auth");
      setAuthMessage("error", "Il collegamento a Supabase non è disponibile.");
      return;
    }
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { storageKey: STORAGE_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    bindEvents();
    const { data, error } = await client.auth.getSession();
    if (error) {
      setView("auth");
      setAuthMessage("error", friendlyError(error));
      return;
    }
    await verifyStaff(data.session);
    authSubscription = client.auth.onAuthStateChange(handleAuthStateChange);
    window.addEventListener("pagehide", () => authSubscription?.data?.subscription?.unsubscribe?.(), { once: true });
  }

  document.addEventListener("DOMContentLoaded", () => init().catch(error => {
    setView("auth");
    setAuthMessage("error", friendlyError(error));
  }));
})();