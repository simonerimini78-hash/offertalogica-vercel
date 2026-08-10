(() => {
  "use strict";

  // Staff v2.5B — allineamento UI alla governance Premium omaggio v2.5A.
  // Questo file non sostituisce staff.js: aggiunge soltanto il livello visuale
  // e i controlli Owner/Admin che interrogano le RPC backend già autorevoli.

  const SUPABASE_URL = "https://kzxdamhfmzaxonpkytcf.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_poz1xBKiXceLCFV3u_tPIg_5_-ycHcl";
  const STORAGE_KEY = "offertalogica-premium-staff-auth";
  const COMPLIMENTARY_BUTTON_LABELS = new Set(["REGALA PREMIUM", "GESTISCI OMAGGIO"]);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  let currentRole = "";
  let canManageComplimentary = false;
  let governanceReady = false;
  let capabilityRequest = null;
  let permissionsRequest = null;
  let permissionsByUser = new Map();
  let permissionDialogState = null;
  let refreshTimer = null;
  let permissionRenderScheduled = false;

  const byId = id => document.getElementById(id);

  function storedAccessToken() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return "";
      const parsed = JSON.parse(raw);
      return String(
        parsed?.access_token
        || parsed?.session?.access_token
        || parsed?.currentSession?.access_token
        || ""
      ).trim();
    } catch {
      return "";
    }
  }

  async function rpc(name, params = {}) {
    const token = storedAccessToken();
    if (!token) throw new Error("staff_governance_session_required");

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
      cache: "no-store",
    });

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => "");

    if (!response.ok) {
      const detail = typeof payload === "object" && payload
        ? payload.message || payload.error || payload.details || payload.code
        : payload;
      throw new Error(String(detail || `staff_governance_http_${response.status}`));
    }

    return payload;
  }

  function setPageMessage(kind, message) {
    const target = byId("staffPageMessage");
    if (!target) return;
    target.className = `message${kind ? ` ${kind}` : ""}`;
    target.textContent = message || "";
    target.hidden = !message;
  }

  function setComplimentaryStatus(kind, message) {
    const target = byId("staffComplimentaryStatus");
    if (!target) return;
    target.className = `complimentary-status${kind ? ` ${kind}` : ""}`;
    target.textContent = message || "";
    target.hidden = !message;
  }

  function friendlyGovernanceError(error) {
    const raw = String(error?.message || error || "").trim();
    const message = raw.toLowerCase();
    if (message.includes("premium_owner_required")) return "Questa funzione è riservata al Proprietario.";
    if (message.includes("premium_complimentary_permission_admin_only")) return "Il permesso Premium omaggio può essere assegnato soltanto a un Amministratore attivo.";
    if (message.includes("premium_complimentary_permission_reason_required")) return "Inserisci una motivazione per modificare il permesso.";
    if (message.includes("premium_complimentary_permission_required")) return "Il tuo account Staff non è autorizzato a gestire Premium omaggio.";
    if (message.includes("premium_complimentary_reason_required")) return "Inserisci una motivazione per questa operazione.";
    if (message.includes("premium_complimentary_unlimited_owner_only")) return "Solo il Proprietario può concedere un Premium omaggio senza scadenza.";
    if (message.includes("premium_staff_member_not_found")) return "Collaboratore non trovato o non attivo.";
    if (message.includes("staff_governance_session_required")) return "Sessione Staff non disponibile. Accedi nuovamente.";
    if (message.includes("failed to fetch") || message.includes("network")) return "Connessione non disponibile. Controlla la rete e riprova.";
    return raw || "Operazione non riuscita.";
  }

  function isComplimentaryCustomerButton(button) {
    if (!(button instanceof HTMLButtonElement)) return false;
    return COMPLIMENTARY_BUTTON_LABELS.has(String(button.textContent || "").trim().toUpperCase());
  }

  function applyCustomerButtonPolicy() {
    document.querySelectorAll("#customerList .customer-actions button").forEach(button => {
      if (!isComplimentaryCustomerButton(button)) return;
      button.dataset.v25bComplimentary = "true";
      button.hidden = !(governanceReady && canManageComplimentary);
    });
  }

  function applyDurationPolicy({ clearReason = false } = {}) {
    const form = byId("staffComplimentaryForm");
    if (!form) return;
    const duration = form.elements?.duration;
    const reason = form.elements?.reason;
    const unlimited = duration?.querySelector?.('option[value="unlimited"]');

    if (reason) {
      reason.required = true;
      reason.placeholder = "Motivazione obbligatoria per questa operazione";
      if (clearReason) reason.value = "";
    }

    if (!unlimited) return;
    const owner = currentRole === "owner";
    unlimited.hidden = !owner;
    unlimited.disabled = !owner;
    if (!owner && duration.value === "unlimited") duration.value = "12_months";
  }

  async function refreshCurrentGovernance({ silent = true } = {}) {
    if (capabilityRequest) return capabilityRequest;
    capabilityRequest = (async () => {
      if (!storedAccessToken()) {
        currentRole = "";
        canManageComplimentary = false;
        governanceReady = false;
        applyCustomerButtonPolicy();
        return;
      }

      try {
        const [role, allowed] = await Promise.all([
          rpc("premium_staff_raw_role"),
          rpc("premium_staff_can_manage_complimentary"),
        ]);
        currentRole = String(role || "").trim().toLowerCase();
        canManageComplimentary = allowed === true;
        governanceReady = Boolean(currentRole);
        applyCustomerButtonPolicy();
        applyDurationPolicy();

        if (currentRole === "owner") {
          ensureGovernanceNote();
          await refreshPermissionControls({ silent: true });
        } else {
          permissionsByUser = new Map();
          removePermissionControls();
        }
      } catch (error) {
        currentRole = "";
        canManageComplimentary = false;
        governanceReady = false;
        applyCustomerButtonPolicy();
        if (!silent) setPageMessage("error", friendlyGovernanceError(error));
        else console.warn("Staff v2.5B governance non disponibile", error);
      }
    })().finally(() => {
      capabilityRequest = null;
    });
    return capabilityRequest;
  }

  function permissionBadge(label, kind = "") {
    const element = document.createElement("span");
    element.className = `badge${kind ? ` ${kind}` : ""}`;
    element.textContent = label;
    element.dataset.v25bPermission = "true";
    return element;
  }

  function permissionButton(label, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button ${className} compact`;
    button.textContent = label;
    button.dataset.v25bPermission = "true";
    button.addEventListener("click", handler);
    return button;
  }

  function removePermissionControls() {
    document.querySelectorAll('[data-v25b-permission="true"]').forEach(element => element.remove());
  }

  function collaboratorUserId(row) {
    const value = String(row?.querySelector("td:first-child small")?.textContent || "").trim();
    return UUID_RE.test(value) ? value : "";
  }

  function renderPermissionControls() {
    if (currentRole !== "owner") {
      removePermissionControls();
      return;
    }

    const body = byId("collaboratorRows");
    if (!body) return;

    body.querySelectorAll("tr").forEach(row => {
      row.querySelectorAll('[data-v25b-permission="true"]').forEach(element => element.remove());
      const userId = collaboratorUserId(row);
      if (!userId) return;

      const permission = permissionsByUser.get(userId);
      if (!permission) return;

      const actionCell = row.querySelector("td:last-child");
      const actions = actionCell?.querySelector(".row-actions") || actionCell;
      if (!actions) return;

      const role = String(permission.role || "").toLowerCase();
      const active = Boolean(permission.active);
      const allowed = Boolean(permission.complimentary_allowed);

      if (role === "owner") {
        actions.append(permissionBadge("Omaggio: sempre", "ok"));
        return;
      }

      if (role !== "admin") {
        actions.append(permissionBadge("Omaggio: non previsto", ""));
        return;
      }

      if (!active) {
        actions.append(permissionBadge("Omaggio: sospeso", "warn"));
        return;
      }

      actions.append(permissionBadge(
        allowed ? "Omaggio: autorizzato" : "Omaggio: negato",
        allowed ? "ok" : "warn",
      ));

      actions.append(permissionButton(
        allowed ? "Revoca omaggi" : "Autorizza omaggi",
        allowed ? "danger" : "secondary",
        event => {
          event.preventDefault();
          event.stopPropagation();
          openPermissionDialog(permission, !allowed);
        },
      ));
    });
  }

  async function refreshPermissionControls({ silent = true } = {}) {
    if (currentRole !== "owner") return;
    if (permissionsRequest) return permissionsRequest;

    permissionsRequest = (async () => {
      try {
        const rows = await rpc("premium_owner_list_complimentary_permissions");
        permissionsByUser = new Map(
          (Array.isArray(rows) ? rows : []).map(item => [String(item.staff_user_id || ""), item]),
        );
        renderPermissionControls();
      } catch (error) {
        permissionsByUser = new Map();
        removePermissionControls();
        if (!silent) setPageMessage("error", friendlyGovernanceError(error));
        else console.warn("Permessi Premium omaggio non disponibili", error);
      }
    })().finally(() => {
      permissionsRequest = null;
    });

    return permissionsRequest;
  }

  function schedulePermissionRefresh() {
    if (permissionRenderScheduled || currentRole !== "owner") return;
    permissionRenderScheduled = true;
    queueMicrotask(() => {
      permissionRenderScheduled = false;
      refreshPermissionControls({ silent: true });
    });
  }

  function ensureGovernanceNote() {
    const content = byId("collaboratorContent");
    if (!content || content.querySelector('[data-v25b-governance-note="true"]')) return;
    const note = document.createElement("div");
    note.className = "side-note";
    note.style.margin = "0 12px 12px";
    note.dataset.v25bGovernanceNote = "true";
    note.textContent = "Premium omaggio: il Proprietario è sempre autorizzato; un Amministratore può operare solo dopo autorizzazione esplicita; Tecnici e altri ruoli non possono concedere omaggi. La durata senza scadenza resta esclusiva del Proprietario.";
    const metrics = content.querySelector(".metrics");
    if (metrics) content.insertBefore(note, metrics);
    else content.append(note);
  }

  function ensurePermissionDialog() {
    let layer = byId("staffComplimentaryPermissionLayer");
    if (layer) return layer;

    layer = document.createElement("div");
    layer.id = "staffComplimentaryPermissionLayer";
    layer.className = "complimentary-layer";
    layer.hidden = true;
    layer.setAttribute("role", "dialog");
    layer.setAttribute("aria-modal", "true");
    layer.setAttribute("aria-labelledby", "staffComplimentaryPermissionTitle");

    const card = document.createElement("div");
    card.className = "complimentary-card";

    const title = document.createElement("h2");
    title.id = "staffComplimentaryPermissionTitle";
    title.textContent = "Permesso Premium omaggio";

    const target = document.createElement("p");
    target.id = "staffComplimentaryPermissionTarget";
    target.className = "complimentary-target";

    const current = document.createElement("div");
    current.id = "staffComplimentaryPermissionCurrent";
    current.className = "complimentary-current";

    const form = document.createElement("form");
    form.id = "staffComplimentaryPermissionForm";
    form.className = "complimentary-form";
    form.noValidate = true;

    const label = document.createElement("label");
    label.textContent = "Motivazione obbligatoria";
    const textarea = document.createElement("textarea");
    textarea.id = "staffComplimentaryPermissionReason";
    textarea.name = "reason";
    textarea.maxLength = 500;
    textarea.required = true;
    textarea.placeholder = "Esempio: amministratore autorizzato alla gestione commerciale";
    label.append(textarea);
    form.append(label);

    const status = document.createElement("div");
    status.id = "staffComplimentaryPermissionStatus";
    status.className = "complimentary-status";
    status.hidden = true;
    status.setAttribute("role", "status");

    const actions = document.createElement("div");
    actions.className = "complimentary-actions";

    const cancel = document.createElement("button");
    cancel.id = "staffComplimentaryPermissionCancel";
    cancel.type = "button";
    cancel.className = "button";
    cancel.textContent = "ANNULLA";

    const apply = document.createElement("button");
    apply.id = "staffComplimentaryPermissionApply";
    apply.type = "button";
    apply.className = "button primary";
    apply.textContent = "SALVA PERMESSO";

    actions.append(cancel, apply);
    card.append(title, target, current, form, status, actions);
    layer.append(card);
    document.body.append(layer);

    cancel.addEventListener("click", closePermissionDialog);
    apply.addEventListener("click", savePermissionDialog);
    layer.addEventListener("click", event => {
      if (event.target === layer) closePermissionDialog();
    });

    return layer;
  }

  function setPermissionStatus(kind, message) {
    const target = byId("staffComplimentaryPermissionStatus");
    if (!target) return;
    target.className = `complimentary-status${kind ? ` ${kind}` : ""}`;
    target.textContent = message || "";
    target.hidden = !message;
  }

  function setPermissionBusy(value) {
    ["staffComplimentaryPermissionCancel", "staffComplimentaryPermissionApply", "staffComplimentaryPermissionReason"]
      .forEach(id => {
        const element = byId(id);
        if (element) element.disabled = Boolean(value);
      });
  }

  function openPermissionDialog(permission, nextAllowed) {
    const targetRole = String(permission?.role || "").trim().toLowerCase();
    if (currentRole !== "owner" || !permission || targetRole !== "admin" || !permission.active) return;
    permissionDialogState = {
      staffUserId: String(permission.staff_user_id || ""),
      email: String(permission.email || permission.staff_user_id || "Amministratore"),
      nextAllowed: Boolean(nextAllowed),
      previousReason: String(permission.permission_reason || ""),
    };

    const layer = ensurePermissionDialog();
    byId("staffComplimentaryPermissionTitle").textContent = nextAllowed
      ? "Autorizza Premium omaggio"
      : "Revoca permesso Premium omaggio";
    byId("staffComplimentaryPermissionTarget").textContent = permissionDialogState.email;
    byId("staffComplimentaryPermissionCurrent").textContent = nextAllowed
      ? "L’Amministratore potrà concedere, prorogare e revocare omaggi a durata limitata. Non potrà usare “Senza scadenza”."
      : "L’Amministratore non potrà più concedere, prorogare o revocare Premium omaggio.";
    const reason = byId("staffComplimentaryPermissionReason");
    if (reason) reason.value = "";
    setPermissionStatus("", "");
    setPermissionBusy(false);
    const apply = byId("staffComplimentaryPermissionApply");
    if (apply) {
      apply.textContent = nextAllowed ? "AUTORIZZA" : "REVOCA PERMESSO";
      apply.className = `button ${nextAllowed ? "primary" : "danger"}`;
    }
    layer.hidden = false;
    window.setTimeout(() => reason?.focus(), 0);
  }

  function closePermissionDialog() {
    const layer = byId("staffComplimentaryPermissionLayer");
    if (layer) layer.hidden = true;
    permissionDialogState = null;
    setPermissionStatus("", "");
    setPermissionBusy(false);
  }

  async function savePermissionDialog() {
    if (currentRole !== "owner" || !permissionDialogState) return;
    const reason = String(byId("staffComplimentaryPermissionReason")?.value || "").trim();
    if (!reason) {
      setPermissionStatus("error", "Inserisci una motivazione prima di continuare.");
      byId("staffComplimentaryPermissionReason")?.focus();
      return;
    }

    setPermissionBusy(true);
    setPermissionStatus("info", "Aggiornamento permesso…");
    try {
      await rpc("premium_owner_set_complimentary_permission", {
        p_user_id: permissionDialogState.staffUserId,
        p_allowed: permissionDialogState.nextAllowed,
        p_reason: reason,
      });
      const label = permissionDialogState.email;
      const allowed = permissionDialogState.nextAllowed;
      closePermissionDialog();
      await refreshPermissionControls({ silent: true });
      setPageMessage(
        "success",
        allowed
          ? `Permesso Premium omaggio autorizzato per ${label}.`
          : `Permesso Premium omaggio revocato per ${label}.`,
      );
      window.dispatchEvent(new Event("offertalogica:staff-save-complete"));
    } catch (error) {
      setPermissionStatus("error", friendlyGovernanceError(error));
      setPermissionBusy(false);
    }
  }

  function blockComplimentaryAction(event, message) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    setComplimentaryStatus("error", message);
  }

  function bindGuardEvents() {
    document.addEventListener("click", event => {
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      if (!(button instanceof HTMLButtonElement)) return;

      if (isComplimentaryCustomerButton(button)) {
        if (!(governanceReady && canManageComplimentary)) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          if (governanceReady) {
            setPageMessage("error", "Il tuo account Staff non è autorizzato a gestire Premium omaggio.");
          }
          refreshCurrentGovernance({ silent: false });
          return;
        }
        window.setTimeout(() => applyDurationPolicy({ clearReason: true }), 0);
        return;
      }

      if (!["staffComplimentaryApply", "staffComplimentaryRevoke"].includes(button.id)) return;

      if (!(governanceReady && canManageComplimentary)) {
        blockComplimentaryAction(event, "Il tuo account Staff non è autorizzato a gestire Premium omaggio.");
        return;
      }

      const form = byId("staffComplimentaryForm");
      const reason = String(form?.elements?.reason?.value || "").trim();
      if (!reason) {
        blockComplimentaryAction(event, "Inserisci una motivazione per questa operazione.");
        form?.elements?.reason?.focus();
        return;
      }

      if (button.id === "staffComplimentaryApply") {
        const duration = String(form?.elements?.duration?.value || "");
        if (duration === "unlimited" && currentRole !== "owner") {
          blockComplimentaryAction(event, "Solo il Proprietario può concedere un Premium omaggio senza scadenza.");
        }
      }
    }, true);

    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      const layer = byId("staffComplimentaryPermissionLayer");
      if (layer && !layer.hidden) closePermissionDialog();
    });
  }

  function bindObservers() {
    const customerList = byId("customerList");
    if (customerList) {
      new MutationObserver(() => applyCustomerButtonPolicy())
        .observe(customerList, { childList: true, subtree: true });
    }

    const collaboratorRows = byId("collaboratorRows");
    if (collaboratorRows) {
      new MutationObserver(() => schedulePermissionRefresh())
        .observe(collaboratorRows, { childList: true });
    }

    const complimentaryLayer = byId("staffComplimentaryLayer");
    if (complimentaryLayer) {
      new MutationObserver(() => {
        if (!complimentaryLayer.hidden) applyDurationPolicy({ clearReason: true });
      }).observe(complimentaryLayer, { attributes: true, attributeFilter: ["hidden"] });
    }

    const staffApp = byId("staffApp");
    if (staffApp) {
      new MutationObserver(() => {
        if (staffApp.hidden) {
          currentRole = "";
          canManageComplimentary = false;
          governanceReady = false;
          permissionsByUser = new Map();
          removePermissionControls();
          applyCustomerButtonPolicy();
          return;
        }
        refreshCurrentGovernance({ silent: true });
      }).observe(staffApp, { attributes: true, attributeFilter: ["hidden"] });
    }

    const identity = byId("staffIdentity");
    if (identity) {
      new MutationObserver(() => refreshCurrentGovernance({ silent: true }))
        .observe(identity, { childList: true, characterData: true, subtree: true });
    }
  }

  function startPeriodicRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !byId("staffApp")?.hidden) {
        refreshCurrentGovernance({ silent: true });
      }
    }, 30000);

    window.addEventListener("focus", () => {
      if (!byId("staffApp")?.hidden) refreshCurrentGovernance({ silent: true });
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !byId("staffApp")?.hidden) {
        refreshCurrentGovernance({ silent: true });
      }
    });

    window.addEventListener("pagehide", () => {
      if (refreshTimer) clearInterval(refreshTimer);
    }, { once: true });
  }


  // Staff v2.6B — Dashboard Owner.
  // UI read-only costruita sopra la RPC aggregata v2.6A. Nessuna nuova API,
  // nessuna query diretta alle tabelle operative e nessuna metrica ricostruita nel browser.
  let ownerDashboardRequest = null;
  let ownerDashboardActive = false;

  function injectOwnerDashboardStyles() {
    if (byId("staffOwnerDashboardStyles")) return;
    const style = document.createElement("style");
    style.id = "staffOwnerDashboardStyles";
    style.textContent = `
      .owner-dashboard-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:15px}
      .owner-dashboard-head h2{margin:0;font-size:26px;letter-spacing:-.025em}.owner-dashboard-head p{margin:5px 0 0;color:var(--muted);font-size:13px;line-height:1.45}
      .owner-dashboard-status{display:inline-flex;align-items:center;min-height:32px;border:1px solid #d8e3de;border-radius:999px;padding:6px 10px;color:var(--muted);background:#fff;font-size:10px;font-weight:800;white-space:nowrap}
      .owner-dashboard-status.error{border-color:#fecdca;color:var(--danger);background:var(--danger-soft)}
      .owner-dashboard-status.success{border-color:#abefc6;color:var(--ok);background:var(--ok-soft)}
      .owner-dashboard-sections{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
      .owner-dashboard-list{display:grid;gap:7px}.owner-dashboard-row{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #e2ebe7;border-radius:10px;padding:9px 10px;background:#fbfdfc}
      .owner-dashboard-row span{color:#42534c;font-size:11px}.owner-dashboard-row strong{color:var(--green-dark);font-size:13px;text-align:right}
      .owner-dashboard-note{margin-top:14px;border:1px solid #dce9e3;border-radius:12px;padding:11px 12px;color:var(--muted);background:#f8fbf9;font-size:10px;line-height:1.5}
      .owner-dashboard-note strong{color:#344840}
      @media(max-width:900px){.owner-dashboard-sections{grid-template-columns:1fr}}
      @media(max-width:680px){.owner-dashboard-head{flex-direction:column}.owner-dashboard-status{white-space:normal}}
    `;
    document.head.append(style);
  }

  function ownerFormatNumber(value, digits = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "0";
    return new Intl.NumberFormat("it-IT", { maximumFractionDigits: digits }).format(number);
  }

  function ownerFormatMoney(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "€ 0,00";
    return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(number);
  }

  function ownerFormatDuration(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    if (value >= 3600) return `${ownerFormatNumber(value / 3600, 1)} h`;
    return `${ownerFormatNumber(Math.round(value / 60))} min`;
  }

  function ownerFormatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function ensureOwnerDashboardUi() {
    if (byId("staffOwnerDashboardView")) return;

    injectOwnerDashboardStyles();

    const nav = document.querySelector("#staffApp .nav");
    const main = document.querySelector("#staffApp .main");
    if (!nav || !main) return;

    const button = document.createElement("button");
    button.id = "staffOwnerDashboardTab";
    button.type = "button";
    button.hidden = true;
    button.textContent = "Dashboard Owner";
    button.setAttribute("aria-controls", "staffOwnerDashboardView");

    const collaboratorsTab = byId("staffCollaboratorsTab");
    if (collaboratorsTab?.parentElement === nav) collaboratorsTab.insertAdjacentElement("afterend", button);
    else nav.append(button);

    const view = document.createElement("section");
    view.id = "staffOwnerDashboardView";
    view.className = "view";
    view.setAttribute("aria-labelledby", "staffOwnerDashboardTitle");
    view.innerHTML = `
      <div class="owner-dashboard-head">
        <div>
          <span class="control-kicker">Solo Proprietario</span>
          <h2 id="staffOwnerDashboardTitle">Dashboard Owner</h2>
          <p>Numeri globali Premium e Staff calcolati lato database. Nessun dato personale e nessuna stima di entrate non supportata.</p>
        </div>
        <span class="owner-dashboard-status" id="staffOwnerDashboardStatus">Da aggiornare</span>
      </div>

      <div class="metrics">
        <article class="metric priority"><span>Clienti Premium attivi</span><strong id="ownerCustomersActive">—</strong><small id="ownerCustomersTotal">Totale profili —</small></article>
        <article class="metric priority"><span>Premium paganti attivi</span><strong id="ownerPaidActive">—</strong><small id="ownerPaidAttention">Da verificare —</small></article>
        <article class="metric"><span>Prove gratuite attive</span><strong id="ownerTrialActive">—</strong><small id="ownerCustomersNew7">Nuovi clienti 7 gg —</small></article>
        <article class="metric"><span>Premium omaggio attivi</span><strong id="ownerComplimentaryActive">—</strong><small id="ownerComplimentaryUnlimited">Senza scadenza —</small></article>
      </div>

      <div class="metrics">
        <article class="metric"><span>Nuovi clienti · 30 giorni</span><strong id="ownerCustomersNew30">—</strong><small>Crescita profili Premium</small></article>
        <article class="metric"><span>Bollette caricate · 30 giorni</span><strong id="ownerBillsNew30">—</strong><small id="ownerBillsTotal">Archivio attuale —</small></article>
        <article class="metric priority"><span>Verifiche aperte</span><strong id="ownerChecksOpen">—</strong><small id="ownerChecksCompleted30">Concluse 30 gg —</small></article>
        <article class="metric priority"><span>Anomalie aperte</span><strong id="ownerAnomaliesOpen">—</strong><small id="ownerAnomaliesCritical">Alte/critiche —</small></article>
      </div>

      <div class="owner-dashboard-sections">
        <section class="panel">
          <div class="panel-head"><div><h3>Abbonamenti</h3><small>Stato dell’ultimo piano registrato per cliente</small></div></div>
          <div class="panel-body"><div class="owner-dashboard-list">
            <div class="owner-dashboard-row"><span>Pagamenti da verificare</span><strong id="ownerSubPaidAttention">—</strong></div>
            <div class="owner-dashboard-row"><span>Rinnovo disattivato a fine periodo</span><strong id="ownerSubCancelAtEnd">—</strong></div>
            <div class="owner-dashboard-row"><span>Archivio in sola lettura</span><strong id="ownerSubReadOnly">—</strong></div>
            <div class="owner-dashboard-row"><span>Omaggi senza scadenza</span><strong id="ownerSubUnlimited">—</strong></div>
          </div></div>
        </section>

        <section class="panel">
          <div class="panel-head"><div><h3>Operatività</h3><small>Carico corrente e risultati degli ultimi 30 giorni</small></div></div>
          <div class="panel-body"><div class="owner-dashboard-list">
            <div class="owner-dashboard-row"><span>Verifiche concluse · 30 gg</span><strong id="ownerOpsChecksCompleted">—</strong></div>
            <div class="owner-dashboard-row"><span>Esito anomalia · 30 gg</span><strong id="ownerOpsChecksAnomaly">—</strong></div>
            <div class="owner-dashboard-row"><span>Possibile risparmio · 30 gg</span><strong id="ownerOpsSaving">—</strong></div>
            <div class="owner-dashboard-row"><span>Messaggi assistenza non letti</span><strong id="ownerOpsSupportUnread">—</strong></div>
            <div class="owner-dashboard-row"><span>Bollette con elaborazione fallita</span><strong id="ownerOpsBillsFailed">—</strong></div>
          </div></div>
        </section>

        <section class="panel">
          <div class="panel-head"><div><h3>Costi e carico · 30 giorni</h3><small>Solo valori già registrati o stimati dal sistema</small></div></div>
          <div class="panel-body"><div class="owner-dashboard-list">
            <div class="owner-dashboard-row"><span>Analisi IA</span><strong id="ownerCostRuns">—</strong></div>
            <div class="owner-dashboard-row"><span>Analisi IA fallite</span><strong id="ownerCostFailed">—</strong></div>
            <div class="owner-dashboard-row"><span>Token IA</span><strong id="ownerCostTokens">—</strong></div>
            <div class="owner-dashboard-row"><span>Costo IA stimato registrato</span><strong id="ownerCostAi">—</strong></div>
            <div class="owner-dashboard-row"><span>Costi registrati complessivi</span><strong id="ownerCostRecorded">—</strong></div>
            <div class="owner-dashboard-row"><span>Tempo umano registrato</span><strong id="ownerCostHuman">—</strong></div>
          </div></div>
        </section>

        <section class="panel">
          <div class="panel-head"><div><h3>Governance Staff</h3><small>Ruoli, omaggi e Audit</small></div></div>
          <div class="panel-body"><div class="owner-dashboard-list">
            <div class="owner-dashboard-row"><span>Collaboratori Staff attivi</span><strong id="ownerGovStaffActive">—</strong></div>
            <div class="owner-dashboard-row"><span>Amministratori attivi</span><strong id="ownerGovAdmins">—</strong></div>
            <div class="owner-dashboard-row"><span>Tecnici attivi</span><strong id="ownerGovTechnicians">—</strong></div>
            <div class="owner-dashboard-row"><span>Admin autorizzati agli omaggi</span><strong id="ownerGovGiftAdmins">—</strong></div>
            <div class="owner-dashboard-row"><span>Eventi Audit · 30 gg</span><strong id="ownerGovAuditEvents">—</strong></div>
            <div class="owner-dashboard-row"><span>Errori Audit · 30 gg</span><strong id="ownerGovAuditErrors">—</strong></div>
            <div class="owner-dashboard-row"><span>Operazioni negate · 30 gg</span><strong id="ownerGovAuditDenied">—</strong></div>
          </div></div>
        </section>
      </div>

      <div class="owner-dashboard-note">
        <strong>Perimetro economico:</strong> questa dashboard non ricostruisce fatturato, MRR o valore degli omaggi. Mostra solo costi e conteggi supportati dai dati già registrati. Le metriche “paganti” richiedono un collegamento Stripe reale nell’ultimo abbonamento del cliente.
      </div>
      <div class="version">Control Center · Dashboard Owner v2.6B</div>
    `;
    main.append(view);

    button.addEventListener("click", openOwnerDashboard);
    document.querySelectorAll("[data-staff-tab]").forEach(tab => {
      tab.addEventListener("click", () => closeOwnerDashboard());
    });
    byId("staffRefresh")?.addEventListener("click", () => {
      if (ownerDashboardActive) loadOwnerDashboard({ silent: true });
    });
    window.addEventListener("hashchange", () => closeOwnerDashboard());

    const staffApp = byId("staffApp");
    if (staffApp) {
      new MutationObserver(() => {
        if (staffApp.hidden) closeOwnerDashboard();
        refreshCurrentGovernance({ silent: true })
          .then(syncOwnerDashboardVisibility)
          .catch(() => syncOwnerDashboardVisibility());
      }).observe(staffApp, { attributes: true, attributeFilter: ["hidden"] });
    }

    const identity = byId("staffIdentity");
    if (identity) {
      new MutationObserver(() => {
        refreshCurrentGovernance({ silent: true })
          .then(syncOwnerDashboardVisibility)
          .catch(() => syncOwnerDashboardVisibility());
      }).observe(identity, { childList: true, characterData: true, subtree: true });
    }
  }

  function syncOwnerDashboardVisibility() {
    const button = byId("staffOwnerDashboardTab");
    const view = byId("staffOwnerDashboardView");
    if (!button || !view) return;
    const visible = currentRole === "owner" && !byId("staffApp")?.hidden;
    button.hidden = !visible;
    if (!visible) closeOwnerDashboard();
  }

  function openOwnerDashboard() {
    if (currentRole !== "owner") {
      syncOwnerDashboardVisibility();
      return;
    }
    const button = byId("staffOwnerDashboardTab");
    const view = byId("staffOwnerDashboardView");
    if (!button || !view) return;

    ownerDashboardActive = true;
    document.querySelectorAll("[data-staff-tab]").forEach(tab => tab.classList.remove("active"));
    document.querySelectorAll("[data-staff-view]").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    view.classList.add("active");
    setPageMessage("", "");
    loadOwnerDashboard({ silent: false });
  }

  function closeOwnerDashboard() {
    ownerDashboardActive = false;
    byId("staffOwnerDashboardTab")?.classList.remove("active");
    byId("staffOwnerDashboardView")?.classList.remove("active");
  }

  function setOwnerDashboardStatus(kind, message) {
    const target = byId("staffOwnerDashboardStatus");
    if (!target) return;
    target.className = `owner-dashboard-status${kind ? ` ${kind}` : ""}`;
    target.textContent = message || "";
  }

  function setOwnerDashboardValue(id, value) {
    const target = byId(id);
    if (target) target.textContent = value;
  }

  function renderOwnerDashboard(metrics) {
    const customers = metrics?.customers || {};
    const subscriptions = metrics?.subscriptions || {};
    const operations = metrics?.operations || {};
    const costs = metrics?.costs || {};
    const staff = metrics?.staff || {};
    const governance = metrics?.governance || {};

    setOwnerDashboardValue("ownerCustomersActive", ownerFormatNumber(customers.active));
    setOwnerDashboardValue("ownerCustomersTotal", `Totale profili ${ownerFormatNumber(customers.total)}`);
    setOwnerDashboardValue("ownerPaidActive", ownerFormatNumber(subscriptions.paid_active));
    setOwnerDashboardValue("ownerPaidAttention", `Da verificare ${ownerFormatNumber(subscriptions.paid_attention)}`);
    setOwnerDashboardValue("ownerTrialActive", ownerFormatNumber(subscriptions.trial_active));
    setOwnerDashboardValue("ownerCustomersNew7", `Nuovi clienti 7 gg ${ownerFormatNumber(customers.new_7d)}`);
    setOwnerDashboardValue("ownerComplimentaryActive", ownerFormatNumber(subscriptions.complimentary_active));
    setOwnerDashboardValue("ownerComplimentaryUnlimited", `Senza scadenza ${ownerFormatNumber(subscriptions.complimentary_unlimited)}`);

    setOwnerDashboardValue("ownerCustomersNew30", ownerFormatNumber(customers.new_30d));
    setOwnerDashboardValue("ownerBillsNew30", ownerFormatNumber(operations.bills_new_30d));
    setOwnerDashboardValue("ownerBillsTotal", `Archivio attuale ${ownerFormatNumber(operations.bills_total)}`);
    setOwnerDashboardValue("ownerChecksOpen", ownerFormatNumber(operations.checks_open));
    setOwnerDashboardValue("ownerChecksCompleted30", `Concluse 30 gg ${ownerFormatNumber(operations.checks_completed_30d)}`);
    setOwnerDashboardValue("ownerAnomaliesOpen", ownerFormatNumber(operations.anomalies_open));
    setOwnerDashboardValue("ownerAnomaliesCritical", `Alte/critiche ${ownerFormatNumber(operations.anomalies_high_critical_open)}`);

    setOwnerDashboardValue("ownerSubPaidAttention", ownerFormatNumber(subscriptions.paid_attention));
    setOwnerDashboardValue("ownerSubCancelAtEnd", ownerFormatNumber(subscriptions.cancel_at_period_end));
    setOwnerDashboardValue("ownerSubReadOnly", ownerFormatNumber(subscriptions.read_only_archive));
    setOwnerDashboardValue("ownerSubUnlimited", ownerFormatNumber(subscriptions.complimentary_unlimited));

    setOwnerDashboardValue("ownerOpsChecksCompleted", ownerFormatNumber(operations.checks_completed_30d));
    setOwnerDashboardValue("ownerOpsChecksAnomaly", ownerFormatNumber(operations.checks_anomaly_30d));
    setOwnerDashboardValue("ownerOpsSaving", ownerFormatNumber(operations.checks_possible_saving_30d));
    setOwnerDashboardValue("ownerOpsSupportUnread", ownerFormatNumber(operations.support_unread_messages));
    setOwnerDashboardValue("ownerOpsBillsFailed", ownerFormatNumber(operations.bills_failed_current));

    setOwnerDashboardValue("ownerCostRuns", ownerFormatNumber(costs.ai_runs_30d));
    setOwnerDashboardValue("ownerCostFailed", ownerFormatNumber(costs.ai_failed_30d));
    setOwnerDashboardValue("ownerCostTokens", ownerFormatNumber(costs.ai_tokens_30d));
    setOwnerDashboardValue("ownerCostAi", ownerFormatMoney(costs.ai_estimated_cost_eur_30d));
    setOwnerDashboardValue("ownerCostRecorded", ownerFormatMoney(costs.recorded_cost_eur_30d));
    setOwnerDashboardValue("ownerCostHuman", ownerFormatDuration(costs.human_seconds_30d));

    setOwnerDashboardValue("ownerGovStaffActive", ownerFormatNumber(staff.active_total));
    setOwnerDashboardValue("ownerGovAdmins", ownerFormatNumber(staff.admins_active));
    setOwnerDashboardValue("ownerGovTechnicians", ownerFormatNumber(staff.technicians_active));
    setOwnerDashboardValue("ownerGovGiftAdmins", ownerFormatNumber(staff.admins_complimentary_authorized));
    setOwnerDashboardValue("ownerGovAuditEvents", ownerFormatNumber(governance.audit_events_30d));
    setOwnerDashboardValue("ownerGovAuditErrors", ownerFormatNumber(governance.audit_errors_30d));
    setOwnerDashboardValue("ownerGovAuditDenied", ownerFormatNumber(governance.audit_denied_30d));

    setOwnerDashboardStatus(
      "success",
      `Aggiornata ${ownerFormatDate(metrics?.generated_at)} · finestra ${ownerFormatNumber(metrics?.window_days || 30)} giorni`,
    );
  }

  async function loadOwnerDashboard({ silent = false } = {}) {
    if (currentRole !== "owner") return;
    if (ownerDashboardRequest) return ownerDashboardRequest;

    if (!silent) setOwnerDashboardStatus("", "Aggiornamento…");

    ownerDashboardRequest = (async () => {
      try {
        const payload = await rpc("premium_owner_dashboard_metrics");
        const metrics = Array.isArray(payload) ? payload[0] : payload;
        if (!metrics || typeof metrics !== "object") throw new Error("premium_owner_dashboard_payload_invalid");
        renderOwnerDashboard(metrics);
      } catch (error) {
        const raw = String(error?.message || error || "");
        const message = raw.toLowerCase().includes("premium_owner_required")
          ? "Dashboard riservata al Proprietario."
          : (raw || "Dashboard Owner non disponibile.");
        setOwnerDashboardStatus("error", message);
      }
    })().finally(() => {
      ownerDashboardRequest = null;
    });

    return ownerDashboardRequest;
  }

  function initOwnerDashboard() {
    ensureOwnerDashboardUi();
    syncOwnerDashboardVisibility();

    const refreshAndSync = () => {
      refreshCurrentGovernance({ silent: true })
        .then(() => {
          syncOwnerDashboardVisibility();
          if (ownerDashboardActive && currentRole === "owner") loadOwnerDashboard({ silent: true });
        })
        .catch(() => syncOwnerDashboardVisibility());
    };

    window.setTimeout(refreshAndSync, 50);
    window.setTimeout(refreshAndSync, 650);
    window.addEventListener("focus", refreshAndSync);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refreshAndSync();
    });
  }


  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initOwnerDashboard, { once: true });
  } else {
    initOwnerDashboard();
  }

  function init() {
    bindGuardEvents();
    bindObservers();
    startPeriodicRefresh();
    applyCustomerButtonPolicy();
    applyDurationPolicy();
    window.setTimeout(() => refreshCurrentGovernance({ silent: true }), 0);
    window.setTimeout(() => refreshCurrentGovernance({ silent: true }), 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
