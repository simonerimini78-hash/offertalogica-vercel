(() => {
  "use strict";

  const SUPABASE_URL = "https://kzxdamhfmzaxonpkytcf.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_poz1xBKiXceLCFV3u_tPIg_5_-ycHcl";
  const STORAGE_KEY = "offertalogica-premium-staff-auth";
  const ALLOWED_ROLES = new Set(["reviewer", "admin"]);
  const VALID_TABS = new Set(["overview", "leads", "checks", "customers", "analytics", "pdf", "costs"]);

  let client = null;
  let currentSession = null;
  let currentStaff = null;
  let activeTab = "overview";
  let busy = false;
  let authSubscription = null;
  let complimentaryCustomer = null;

  const cache = {
    leads: [],
    leadSummary: {},
    analytics: [],
    analyticsSummary: {},
    customers: [],
    checks: [],
    runs: [],
    costEvents: [],
    costSummary: {},
    systemConfig: null,
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
    return role === "admin" ? "Amministratore" : "Revisore";
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
    if (message.includes("premium_complimentary_profile_not_active")) return "Il profilo cliente non è attivo.";
    if (message.includes("premium_complimentary_duration_invalid")) return "Durata dell’omaggio non valida.";
    if (message.includes("premium_complimentary_paid_subscription_conflict")) return "Il cliente ha già un abbonamento Stripe attivo o da regolarizzare. L’omaggio non può sostituirlo.";
    if (message.includes("premium_complimentary_active_subscription_not_found")) return "Non risulta un Premium omaggio attivo da revocare.";
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

  function setView(mode) {
    byId("staffAuthView").hidden = mode !== "auth";
    byId("staffDeniedView").hidden = mode !== "denied";
    byId("staffApp").hidden = mode !== "app";
    byId("staffTopActions").hidden = mode !== "app";
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
    return currentStaff?.role === "admin";
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
    const target = VALID_TABS.has(name) ? name : "overview";
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
    const restricted = currentStaff?.role !== "admin";
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
    if (currentStaff?.role !== "admin" || busy) return;
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
    if (currentStaff?.role !== "admin" || busy) return;
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
    if (currentStaff?.role !== "admin") return;
    try {
      const limit = byId("leadLimit")?.value || "200";
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

  const funnelDefinitions = [
    ["pdfStarted", "PDF avviati"], ["pdfCompleted", "PDF letti"], ["comparisons", "Confronti"],
    ["leadModalOpened", "Popup lead"], ["otpSent", "OTP inviati"], ["otpVerified", "OTP verificati"],
    ["offersUnlocked", "Offerte sbloccate"], ["offerConsentOpened", "Offerte cliccate"],
    ["partnerConsentConfirmed", "Consensi partner"], ["redirects", "Redirect"],
    ["consultantRequests", "Richieste assistite"], ["failedRequests", "Errori richiesta"]
  ];

  function renderFunnel(target, funnel = {}, compact = false) {
    clear(target);
    const definitions = compact ? funnelDefinitions.slice(1, 7) : funnelDefinitions;
    definitions.forEach(([key, label]) => target.append(node("div", { className: "funnel-step" }, [
      node("strong", { text: funnel[key] || 0 }), node("span", { text: label })
    ])));
  }

  function renderRankList(target, rows = [], emptyLabel = "Nessun dato") {
    clear(target);
    if (!rows.length) {
      target.append(node("div", { className: "empty", text: emptyLabel }));
      return;
    }
    rows.forEach(item => target.append(node("div", { className: "rank-row" }, [node("strong", { text: item.key }), node("span", { text: item.count })])));
  }

  function renderAnalytics() {
    const summary = cache.analyticsSummary || {};
    const funnel = summary.funnel || {};
    text(byId("analyticsEvents"), summary.recentEvents || 0);
    text(byId("analyticsSessions"), summary.uniqueSessions || 0);
    text(byId("analyticsLinkedLeads"), summary.linkedLeads || 0);
    text(byId("analyticsOtpRate"), funnel.otpSent ? `${Math.round((Number(funnel.otpVerified || 0) / Number(funnel.otpSent)) * 100)}%` : "—");
    renderFunnel(byId("analyticsFunnel"), funnel);
    renderRankList(byId("analyticsProviders"), summary.topProviders || [], "Nessun provider cliccato");
    renderRankList(byId("analyticsOffers"), summary.topOffers || [], "Nessuna offerta cliccata");

    const body = byId("analyticsRows");
    clear(body);
    if (!cache.analytics.length) {
      body.append(node("tr", {}, [node("td", { text: "Nessun evento disponibile.", attrs: { colspan: "7" } })]));
      return;
    }
    cache.analytics.slice(0, 200).forEach(event => {
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
        node("td", {}, [node("strong", { text: event.dataOrigin || event.source || "—" }), node("small", { text: event.page || "" })]),
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

  async function deleteVisibleAnalytics() {
    if (!isAdmin() || busy) return;
    const rows = cache.analytics.slice(0, 200);
    if (!rows.length) {
      setMessage("error", "Nessun evento analytics visibile da eliminare.");
      return;
    }
    if (!(await requireTypedConfirmation(`Eliminare definitivamente ${rows.length} eventi analytics visibili?`, "ELIMINA"))) return;
    await runDestructiveAction(async () => {
      await staffFetch("/api/staff-analytics", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "X-Staff-Confirmation": "ELIMINA_ANALYTICS_VISIBILI" },
        body: JSON.stringify({ ids: rows.map(event => event.id) }),
      });
      await loadAnalytics({ silent: true });
    }, `${rows.length} eventi analytics visibili eliminati.`);
  }

  async function resetAnalytics() {
    if (!isAdmin() || busy) return;
    if (!(await requireTypedConfirmation("Eliminare definitivamente tutto l’archivio analytics? I lead resteranno presenti.", "AZZERA"))) return;
    await runDestructiveAction(async () => {
      await staffFetch("/api/staff-analytics?scope=all", {
        method: "DELETE",
        headers: { "X-Staff-Confirmation": "AZZERA_ANALYTICS" },
      });
      await loadAnalytics({ silent: true });
    }, "Archivio analytics azzerato.");
  }

  async function loadAnalytics({ silent = false } = {}) {
    if (!silent) setMessage("info", "Aggiornamento analytics…");
    const payload = await staffFetch("/api/staff-analytics?limit=200");
    cache.analytics = Array.isArray(payload.events) ? payload.events : [];
    cache.analyticsSummary = payload.summary || {};
    renderAnalytics();
    renderFunnel(byId("overviewFunnel"), cache.analyticsSummary.funnel || {}, true);
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
      return "Premium omaggio · terminato";
    }
    return `${subscription.status} · ${subscription.plan_code}`;
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
    return node("div", { className: "resource-row" }, [
      node("div", { className: "resource-row-copy" }, [
        node("strong", { text: label }),
        node("small", { text: `${bill.commodity || "—"} · ${formatDate(bill.created_at, false)} · ${bill.processing_status || "—"} · ${bill.customer_status || "—"}` })
      ]),
      resourceDeleteButton("Elimina bolletta", () => deleteCustomerBill(customer, bill))
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
      if (subscription?.plan_code === "premium-complimentary") {
        actions.append(badge(complimentaryIsActive(subscription) ? "Premium omaggio" : "Omaggio terminato", complimentaryIsActive(subscription) ? "ok" : "warn"));
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
      .select("id,status,outcome,human_seconds,created_at,completed_at")
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
      body.append(node("tr", {}, [
        node("td", { text: formatDate(run.created_at) }),
        node("td", { text: run.origin || "—" }),
        node("td", {}, [badge(run.status || "—", run.status === "failed" ? "danger" : run.status === "completed" ? "ok" : "warn")]),
        node("td", { text: run.model || "—" }),
        node("td", { text: formatNumber(tokens) }),
        node("td", { text: run.estimated_cost_eur == null ? "Tariffa non configurata" : formatMoney(run.estimated_cost_eur) }),
        node("td", {}, [remove])
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
    cache.costEvents.slice(0, 250).forEach(event => {
      const remove = resourceDeleteButton("Elimina", () => deleteCostEvent(event));
      body.append(node("tr", {}, [
        node("td", { text: formatDate(event.occurred_at) }),
        node("td", { text: event.event_type || "—" }),
        node("td", { text: event.provider || "—" }),
        node("td", { text: `${formatNumber(event.quantity, 3)} ${event.unit || "event"}` }),
        node("td", { text: formatMoney(event.cost_eur) }),
        node("td", {}, [remove])
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

  async function deleteVisibleCostRuns() {
    if (!isAdmin() || busy) return;
    const rows = cache.runs.slice(0, 100);
    if (!rows.length) {
      setMessage("error", "Nessuna analisi IA visibile da eliminare.");
      return;
    }
    if (!(await requireTypedConfirmation(`Eliminare ${rows.length} analisi IA visibili e i costi collegati?`, "ELIMINA"))) return;
    await runDestructiveAction(async () => {
      await deletePremiumRecords("analysis_runs", rows.map(run => run.id));
      await Promise.allSettled([loadCosts({ silent: true }), loadCustomers({ silent: true }), loadChecks({ silent: true })]);
    }, `${rows.length} analisi IA eliminate.`);
  }

  async function deleteCostEvent(event) {
    if (!isAdmin() || busy) return;
    if (!(await confirmAction({ title: "Elimina costo", message: `Eliminare l’evento “${event.event_type || event.id}”?`, confirmLabel: "ELIMINA" }))) return;
    await runDestructiveAction(async () => {
      await deletePremiumRecords("cost_events", [event.id]);
      await loadCosts({ silent: true });
    }, "Evento di costo eliminato.");
  }

  async function deleteVisibleCostEvents() {
    if (!isAdmin() || busy) return;
    const rows = cache.costEvents.slice(0, 250);
    if (!rows.length) {
      setMessage("error", "Nessun evento di costo visibile da eliminare.");
      return;
    }
    if (!(await requireTypedConfirmation(`Eliminare ${rows.length} eventi di costo visibili?`, "ELIMINA"))) return;
    await runDestructiveAction(async () => {
      await deletePremiumRecords("cost_events", rows.map(event => event.id));
      await loadCosts({ silent: true });
    }, `${rows.length} eventi di costo eliminati.`);
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
    const pricingValue = value => {
      if (value === null || value === undefined || value === "") return "Mancante";
      const amount = Number(value);
      return Number.isFinite(amount) ? `${formatNumber(amount, 3)} €/1M` : "Mancante";
    };
    const pricingSource = field => {
      const source = pricing.sources?.[field];
      if (source === "environment") return "Variabile Vercel";
      if (source === "model_default") return `Fallback ${config.model || "modello configurato"}`;
      return "Variabile non ricevuta";
    };
    const pricingNote = pricing.complete
      ? (pricing.modelDefaultApplied
          ? "Tariffe operative; almeno un valore usa il fallback del modello."
          : "Tutte le tariffe provengono dalle variabili Vercel.")
      : `Mancano: ${(pricing.missing || []).join(", ") || "una o più tariffe"}`;
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
      configCard("Tariffe IA", pricing.complete ? "Complete" : "Incomplete", pricingNote),
      configCard("Tariffa input IA", pricingValue(pricing.inputPerMillion), pricingSource("inputPerMillion")),
      configCard("Tariffa cache IA", pricingValue(pricing.cachedInputPerMillion), pricingSource("cachedInputPerMillion")),
      configCard("Tariffa output IA", pricingValue(pricing.outputPerMillion), pricingSource("outputPerMillion")),
      configCard("Limite PDF", `${formatNumber(Number(config.maxPdfBytes || 0) / 1_000_000, 1)} MB`),
      configCard("Deadline IA", `${formatNumber(Number(config.deadlineMs || 0) / 1000, 1)} s`),
      configCard("Analisi cliente", `${rate.customerAnalysis?.limit || 0} / ${Math.round(Number(rate.customerAnalysis?.windowSeconds || 0) / 60)} min`),
      configCard("Analisi staff", `${rate.staffAnalysis?.limit || 0} / ${Math.round(Number(rate.staffAnalysis?.windowSeconds || 0) / 60)} min`),
      configCard("Conferme offerta", `${rate.offerConfirmation?.limit || 0} / ${Math.round(Number(rate.offerConfirmation?.windowSeconds || 0) / 60)} min`)
    );
  }

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

  async function loadCosts({ silent = false } = {}) {
    if (!silent) setMessage("info", "Aggiornamento costi e tempi…");
    const [runsResult, checksResult] = await Promise.all([
      client.from("premium_analysis_runs").select("id,status,model,origin,input_tokens,output_tokens,estimated_cost_eur,duration_ms,created_at").order("created_at", { ascending: false }).limit(500),
      client.from("premium_checks").select("id,status,human_seconds,completed_at,created_at").order("created_at", { ascending: false }).limit(500),
    ]);
    if (runsResult.error) throw runsResult.error;
    if (checksResult.error) throw checksResult.error;
    cache.runs = runsResult.data || [];
    cache.checks = checksResult.data || cache.checks;
    cache.costEvents = [];
    if (currentStaff?.role === "admin") {
      const eventsResult = await client.from("premium_cost_events").select("id,event_type,provider,quantity,unit,cost_eur,occurred_at").order("occurred_at", { ascending: false }).limit(1000);
      if (eventsResult.error) throw eventsResult.error;
      cache.costEvents = eventsResult.data || [];
      await loadSystemConfig().catch(() => { cache.systemConfig = null; renderSystemConfig(); });
    } else {
      cache.systemConfig = null;
      renderSystemConfig();
    }
    const tokens = cache.runs.reduce((sum, run) => sum + Number(run.input_tokens || 0) + Number(run.output_tokens || 0), 0);
    const aiCostValues = cache.runs.map(run => Number(run.estimated_cost_eur)).filter(Number.isFinite);
    const aiCost = aiCostValues.reduce((sum, value) => sum + value, 0);
    const humanSeconds = cache.checks.reduce((sum, check) => sum + Number(check.human_seconds || 0), 0);
    cache.costSummary = { runs: cache.runs.length, tokens, aiCost, pricedRuns: aiCostValues.length, humanSeconds };
    text(byId("costRuns"), cache.runs.length);
    text(byId("costTokens"), formatNumber(tokens));
    text(byId("costAi"), aiCostValues.length ? formatMoney(aiCost) : "Tariffe non configurate");
    text(byId("costHuman"), humanSeconds >= 3600 ? `${formatNumber(humanSeconds / 3600, 1)} h` : `${Math.round(humanSeconds / 60)} min`);
    renderCostRuns();
    renderCostEvents();
    if (!silent) setMessage("success", "Costi e tempi aggiornati.");
  }

  function renderOverview() {
    const leadSummary = cache.leadSummary || {};
    const openChecks = cache.checks.filter(item => !["completed", "canceled"].includes(item.status)).length;
    text(byId("overviewLeads"), currentStaff?.role === "admin" ? leadSummary.recentRows || 0 : "Riservato");
    text(byId("overviewLeadsMeta"), currentStaff?.role === "admin" ? `${leadSummary.verifiedRows || 0} verificati OTP` : "Solo amministratori");
    text(byId("overviewChecks"), openChecks);
    text(byId("overviewCustomers"), cache.customers.length);
    text(byId("overviewAiCost"), cache.costSummary.pricedRuns ? formatMoney(cache.costSummary.aiCost) : "Tariffe non configurate");

    const target = byId("overviewTasks");
    clear(target);
    const tasks = [
      [cache.checks.filter(item => item.status === "pending").length, "controlli da assegnare", "checks"],
      [cache.checks.filter(item => item.status === "more_info_required").length, "richieste in attesa di integrazione", "checks"],
      [cache.customers.filter(item => item.profile.account_status === "deletion_requested").length, "richieste di cancellazione account", "customers"],
    ];
    if (currentStaff?.role === "admin") tasks.push([leadSummary.withSelectedOffer || 0, "lead con offerta scelta", "leads"]);
    const list = node("div", { className: "rank-list" });
    tasks.forEach(([count, label, tab]) => {
      const button = node("button", { className: "rank-row", type: "button" }, [node("strong", { text: label }), node("span", { text: count })]);
      button.addEventListener("click", () => setTab(tab));
      list.append(button);
    });
    target.append(list);
    renderFunnel(byId("overviewFunnel"), cache.analyticsSummary.funnel || {}, true);
  }

  async function loadOverview({ silent = false } = {}) {
    if (!silent) setMessage("info", "Aggiornamento riepilogo…");
    const tasks = [loadChecks({ silent: true }), loadCustomers({ silent: true }), loadAnalytics({ silent: true }), loadCosts({ silent: true })];
    if (currentStaff?.role === "admin") tasks.push(loadLeads({ silent: true }));
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
    if (tab === "leads") return loadLeads({ silent });
    if (tab === "checks") return loadChecks({ silent });
    if (tab === "customers") return loadCustomers({ silent });
    if (tab === "analytics") return loadAnalytics({ silent });
    if (tab === "costs") return loadCosts({ silent });
    if (tab === "pdf") {
      ensureFrame("pdfFrame");
      if (!silent) byId("pdfFrame")?.contentWindow?.location.reload();
    }
  }

  async function verifyStaff(session) {
    currentSession = session;
    currentStaff = null;
    if (!session?.user) {
      setView("auth");
      setAuthMessage("", "");
      return;
    }
    const result = await client.from("premium_staff_members")
      .select("user_id,role,active")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (result.error || !result.data?.active || !ALLOWED_ROLES.has(result.data.role)) {
      setView("denied");
      return;
    }
    currentStaff = result.data;
    text(byId("staffIdentity"), `${roleLabel(currentStaff.role)} · ${session.user.email || "account staff"}`);
    [
      "leadCsv", "leadDeleteVisible", "leadReset", "customerDeleteVisible",
      "analyticsDeleteVisible", "analyticsReset", "costDeleteRuns", "costDeleteEvents"
    ].forEach(id => { if (byId(id)) byId(id).hidden = !isAdmin(); });
    setView("app");
    activeTab = VALID_TABS.has(location.hash.slice(1)) ? location.hash.slice(1) : "overview";
    setTab(activeTab, { updateHash: false, refresh: false });
    try {
      await loadOverview({ silent: true });
      renderOverview();
    } catch (error) {
      setMessage("error", friendlyError(error));
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
    byId("analyticsDeleteVisible").addEventListener("click", deleteVisibleAnalytics);
    byId("analyticsReset").addEventListener("click", resetAnalytics);
    byId("costRefresh").addEventListener("click", () => loadCosts().catch(error => setMessage("error", friendlyError(error))));
    byId("costDeleteRuns").addEventListener("click", deleteVisibleCostRuns);
    byId("costDeleteEvents").addEventListener("click", deleteVisibleCostEvents);
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
    authSubscription = client.auth.onAuthStateChange((_event, session) => {
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
    window.addEventListener("pagehide", () => authSubscription?.data?.subscription?.unsubscribe?.(), { once: true });
  }

  document.addEventListener("DOMContentLoaded", () => init().catch(error => {
    setView("auth");
    setAuthMessage("error", friendlyError(error));
  }));
})();
