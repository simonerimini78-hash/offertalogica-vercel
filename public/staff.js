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
  };

  const byId = id => document.getElementById(id);

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

  function renderLeads() {
    const body = byId("leadRows");
    clear(body);
    const query = String(byId("leadSearch")?.value || "").trim().toLowerCase();
    const rows = cache.leads.filter(lead => !query || leadSearchText(lead).includes(query));
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
    if (!window.confirm(`Eliminare definitivamente il contatto “${lead.name || lead.id}”?`)) return;
    setBusy(true);
    try {
      await staffFetch(`/api/staff-leads?id=${encodeURIComponent(lead.id)}`, {
        method: "DELETE",
        headers: { "X-Staff-Confirmation": "ELIMINA_LEAD" },
      });
      await loadLeads({ silent: true });
      setMessage("success", "Lead eliminato.");
    } catch (error) {
      setMessage("error", friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  async function resetLeads() {
    if (currentStaff?.role !== "admin" || busy) return;
    const confirmation = window.prompt("Elimina tutti i contatti e gli eventi collegati. Scrivi AZZERA per continuare.");
    if (confirmation !== "AZZERA") return;
    setBusy(true);
    try {
      const payload = await staffFetch("/api/staff-leads?scope=all", {
        method: "DELETE",
        headers: { "X-Staff-Confirmation": "AZZERA_LEAD" },
      });
      await loadLeads({ silent: true });
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
      body.append(node("tr", {}, [node("td", { text: "Nessun evento disponibile.", attrs: { colspan: "6" } })]));
      return;
    }
    cache.analytics.slice(0, 200).forEach(event => {
      const values = [
        event.bestSaving != null ? `risparmio ${formatMoney(event.bestSaving)}` : "",
        event.annualCost != null ? `costo ${formatMoney(event.annualCost)}` : "",
        event.visibleOffersCount != null ? `${event.visibleOffersCount} offerte` : "",
        event.fileCount != null ? `${event.fileCount} file` : "",
      ].filter(Boolean).join(" · ") || "—";
      body.append(node("tr", {}, [
        node("td", {}, [node("strong", { text: formatDate(event.createdAt) }), node("small", { text: `#${event.id}` })]),
        node("td", {}, [badge(event.eventType || "—", "info"), node("small", { text: event.reason || "" })]),
        node("td", {}, [node("strong", { text: event.dataOrigin || event.source || "—" }), node("small", { text: event.page || "" })]),
        node("td", {}, [node("strong", { text: [event.provider, event.offerName].filter(Boolean).join(" · ") || "—" }), node("small", { text: event.destinationStatus || "" })]),
        node("td", { text: values }),
        node("td", {}, [badge(event.leadId ? "collegato" : "anonimo", event.leadId ? "ok" : "warn"), node("small", { text: event.leadId || "" })])
      ]));
    });
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
      ...customer.contracts.flatMap(item => [item.provider_name, item.offer_name])]
      .filter(Boolean).join(" ").toLowerCase();
  }

  function renderCustomers() {
    const target = byId("customerList");
    clear(target);
    const query = String(byId("customerSearch")?.value || "").trim().toLowerCase();
    const status = String(byId("customerStatus")?.value || "");
    const filtered = cache.customers.filter(customer => {
      if (query && !customerSearchText(customer).includes(query)) return false;
      if (status && customer.profile.account_status !== status) return false;
      return true;
    });
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
      const utilityLines = customer.utilities.length
        ? customer.utilities.map(utility => `${utility.label || "Utenza"} · ${utility.provider_name || "fornitore non indicato"} · ${addressLabel(utility.address)}`).join("\n")
        : "Nessuna utenza";
      const contractLines = activeContracts.length
        ? activeContracts.map(contract => `${contract.provider_name || "Fornitore"} · ${contract.offer_name || "offerta provvisoria"} · ${contract.verification_status}`).join("\n")
        : "Nessun contratto corrente";
      target.append(node("article", { className: "customer-card" }, [
        node("div", { className: "customer-head" }, [
          node("div", {}, [node("h3", { text: title }), node("p", { text: `${profile.email || "email non indicata"} · ${profile.phone || "telefono non indicato"}` })]),
          badge(profile.account_status || "—", statusKind)
        ]),
        node("div", { className: "customer-meta" }, [
          node("div", { className: "mini" }, [node("span", { text: "Abbonamento" }), node("strong", { text: subscription ? `${subscription.status} · ${subscription.plan_code}` : currentStaff?.role === "admin" ? "Non presente" : "Visibile agli admin" })]),
          node("div", { className: "mini" }, [node("span", { text: "Utenze" }), node("strong", { text: customer.utilities.length }), node("small", { text: utilityLines })]),
          node("div", { className: "mini" }, [node("span", { text: "Contratti correnti" }), node("strong", { text: activeContracts.length }), node("small", { text: contractLines })]),
          node("div", { className: "mini" }, [node("span", { text: "Registrazione" }), node("strong", { text: formatDate(profile.created_at, false) }), node("small", { text: profile.id })])
        ])
      ]));
    });
  }

  async function loadCustomers({ silent = false } = {}) {
    if (!silent) setMessage("info", "Aggiornamento clienti e utenze…");
    const limit = Math.max(1, Math.min(500, Number(byId("customerLimit")?.value || 250)));
    const profilesResult = await client.from("premium_profiles")
      .select("id,full_name,email,phone,account_status,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (profilesResult.error) throw profilesResult.error;
    const profiles = profilesResult.data || [];
    const ids = profiles.map(item => item.id);
    let utilities = [], contracts = [], subscriptions = [];
    if (ids.length) {
      const queries = [
        client.from("premium_utilities").select("id,user_id,label,supply_type,provider_name,pod,pdr,address,status,created_at").in("user_id", ids).order("created_at", { ascending: false }),
        client.from("premium_contracts").select("id,user_id,utility_id,provider_name,offer_name,pricing_type,verification_status,automatic_match_status,automatic_match_confidence,customer_confirmation_status,is_current,updated_at").in("user_id", ids).order("updated_at", { ascending: false }),
      ];
      if (currentStaff?.role === "admin") {
        queries.push(client.from("premium_subscriptions").select("id,user_id,status,plan_code,included_utilities,included_bills_per_year,current_period_end,created_at").in("user_id", ids).order("created_at", { ascending: false }));
      }
      const results = await Promise.all(queries);
      if (results[0].error) throw results[0].error;
      if (results[1].error) throw results[1].error;
      utilities = results[0].data || [];
      contracts = results[1].data || [];
      if (results[2]) {
        if (results[2].error) throw results[2].error;
        subscriptions = results[2].data || [];
      }
    }
    cache.customers = profiles.map(profile => ({
      profile,
      utilities: utilities.filter(item => item.user_id === profile.id && item.status !== "archived"),
      contracts: contracts.filter(item => item.user_id === profile.id),
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
      body.append(node("tr", {}, [node("td", { text: "Nessuna analisi IA registrata.", attrs: { colspan: "6" } })]));
      return;
    }
    cache.runs.slice(0, 100).forEach(run => {
      const tokens = Number(run.input_tokens || 0) + Number(run.output_tokens || 0);
      body.append(node("tr", {}, [
        node("td", { text: formatDate(run.created_at) }),
        node("td", { text: run.origin || "—" }),
        node("td", {}, [badge(run.status || "—", run.status === "failed" ? "danger" : run.status === "completed" ? "ok" : "warn")]),
        node("td", { text: run.model || "—" }),
        node("td", { text: formatNumber(tokens) }),
        node("td", { text: run.estimated_cost_eur == null ? "Tariffa non configurata" : formatMoney(run.estimated_cost_eur) })
      ]));
    });
  }

  function renderCostEvents() {
    const target = byId("costEvents");
    clear(target);
    if (currentStaff?.role !== "admin") {
      target.append(node("div", { className: "restricted", text: "Il registro economico completo è riservato agli amministratori. I tempi e le analisi IA restano visibili ai revisori." }));
      return;
    }
    if (!cache.costEvents.length) {
      target.append(node("div", { className: "empty", text: "Nessun evento di costo registrato." }));
      return;
    }
    const grouped = new Map();
    cache.costEvents.forEach(event => {
      const current = grouped.get(event.event_type) || { count: 0, cost: 0 };
      current.count += 1;
      current.cost += Number(event.cost_eur || 0);
      grouped.set(event.event_type, current);
    });
    const list = node("div", { className: "rank-list" });
    [...grouped.entries()].sort((a, b) => b[1].cost - a[1].cost).forEach(([type, values]) => {
      list.append(node("div", { className: "rank-row" }, [node("strong", { text: `${type} · ${values.count} eventi` }), node("span", { text: formatMoney(values.cost) })]));
    });
    target.append(list);
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
    byId("leadCsv").hidden = currentStaff.role !== "admin";
    byId("leadReset").hidden = currentStaff.role !== "admin";
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
    byId("leadReset").addEventListener("click", resetLeads);
    byId("customerRefresh").addEventListener("click", () => loadCustomers().catch(error => setMessage("error", friendlyError(error))));
    byId("customerSearch").addEventListener("input", renderCustomers);
    byId("customerStatus").addEventListener("change", renderCustomers);
    byId("customerLimit").addEventListener("change", () => loadCustomers().catch(error => setMessage("error", friendlyError(error))));
    byId("analyticsRefresh").addEventListener("click", () => loadAnalytics().catch(error => setMessage("error", friendlyError(error))));
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
