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

  // Staff v2.8C1.1 — stabilita visiva al bootstrap/rientro dal Laboratorio.
  // staff.js rende visibile il Control Center appena valida la sessione; la policy
  // V2.8 arriva poco dopo dal backend. Manteniamo il contenuto non visibile fino
  // al primo allineamento autorevole, evitando menu/moduli che appaiono e spariscono.
  const V28B_STABILITY_CLASS = "v28b-policy-stabilizing";
  let v28bInitialUiStable = false;
  let v28bStabilityRequest = null;
  let v28bStabilityFallbackTimer = null;

  function v28bInstallStabilityGate() {
    if (!byId("staffV28BStabilityStyles")) {
      const style = document.createElement("style");
      style.id = "staffV28BStabilityStyles";
      style.textContent = `
        html.${V28B_STABILITY_CLASS} #staffApp:not([hidden]),
        html.${V28B_STABILITY_CLASS} #staffTopActions:not([hidden]){visibility:hidden!important}
      `;
      document.head.append(style);
    }
    document.documentElement.classList.add(V28B_STABILITY_CLASS);
  }

  function v28bReleaseStabilityGate() {
    if (v28bInitialUiStable) return;
    v28bInitialUiStable = true;
    if (v28bStabilityFallbackTimer) {
      clearTimeout(v28bStabilityFallbackTimer);
      v28bStabilityFallbackTimer = null;
    }
    document.documentElement.classList.remove(V28B_STABILITY_CLASS);
  }

  // Installato durante il parsing, prima che staff.js possa rendere visibile #staffApp.
  v28bInstallStabilityGate();

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
          refreshPermissionControls({ silent: true }).catch(() => {});
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
          .then(() => {
            syncOwnerDashboardVisibility();
            syncOwnerLabVisibility();
          })
          .catch(() => {
            syncOwnerDashboardVisibility();
            syncOwnerLabVisibility();
          });
      }).observe(staffApp, { attributes: true, attributeFilter: ["hidden"] });
    }

    const identity = byId("staffIdentity");
    if (identity) {
      new MutationObserver(() => {
        refreshCurrentGovernance({ silent: true })
          .then(() => {
            syncOwnerDashboardVisibility();
            syncOwnerLabVisibility();
          })
          .catch(() => {
            syncOwnerDashboardVisibility();
            syncOwnerLabVisibility();
          });
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


  // Staff v2.7B — accesso al Laboratorio Owner dal Control Center.
  // Il Laboratorio resta una pagina isolata e read-only verso Supabase.
  function ensureOwnerLabNav() {
    if (byId("staffOwnerLabTab")) return;

    const nav = document.querySelector("#staffApp .nav");
    if (!nav) return;

    const button = document.createElement("button");
    button.id = "staffOwnerLabTab";
    button.type = "button";
    button.hidden = true;
    button.textContent = "Laboratorio Owner";
    button.setAttribute("aria-label", "Apri il Laboratorio Owner");

    const dashboardButton = byId("staffOwnerDashboardTab");
    const collaboratorsTab = byId("staffCollaboratorsTab");
    const anchor = dashboardButton?.parentElement === nav
      ? dashboardButton
      : collaboratorsTab?.parentElement === nav
        ? collaboratorsTab
        : null;

    if (anchor) anchor.insertAdjacentElement("afterend", button);
    else nav.append(button);

    button.addEventListener("click", () => {
      if (currentRole !== "owner") {
        syncOwnerLabVisibility();
        return;
      }
      window.location.href = "/staff-owner-lab.html";
    });
  }

  function syncOwnerLabVisibility() {
    const button = byId("staffOwnerLabTab");
    if (!button) return;
    button.hidden = !(currentRole === "owner" && !byId("staffApp")?.hidden);
  }

  function initOwnerDashboard() {
    ensureOwnerDashboardUi();
    ensureOwnerLabNav();
    syncOwnerDashboardVisibility();
    syncOwnerLabVisibility();

    const refreshAndSync = () => {
      refreshCurrentGovernance({ silent: true })
        .then(() => {
          syncOwnerDashboardVisibility();
          syncOwnerLabVisibility();
          if (ownerDashboardActive && currentRole === "owner") loadOwnerDashboard({ silent: true });
        })
        .catch(() => {
          syncOwnerDashboardVisibility();
          syncOwnerLabVisibility();
        });
    };

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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  // Staff v2.8B — matrice permessi nel Control Center.
  // Questa fase usa esclusivamente le RPC autorevoli V2.8A per decidere cosa
  // mostrare nel browser. L'enforcement server-side delle singole azioni
  // operative viene completato in V2.8C.
  const V28B_TAB_PERMISSION = Object.freeze({
    overview: "view_control",
    cases: "view_cases",
    customers: "view_customers",
    checks: "view_checks",
    leads: "view_leads",
    analytics: "view_analytics",
    collaborators: "manage_collaborators",
    pdf: "view_pdf_diagnostics",
    costs: "view_ai_costs",
  });
  const V28B_SPECIAL_BUTTON_PERMISSION = Object.freeze({
    staffSitePreview: "view_site_preview",
  });

  let v28bRole = "";
  let v28bPolicyReady = false;
  let v28bPolicyRequest = null;
  let v28bEffectivePermissions = new Map();
  let v28bMatrixRequest = null;
  let v28bMatrixByUser = new Map();
  let v28bRenderScheduled = false;
  let v28bNavigationGuard = false;
  let v28bPermissionDialogState = null;

  // Staff v2.8B1 — stato reale inviti + apertura automatica permessi Admin.
  let v28b1ActivationRequest = null;
  let v28b1ActivationByUser = new Map();
  let v28b1PendingInvite = null;
  let v28b1InviteMessageObserver = null;
  let v28b1InviteActionInFlight = false;

  function v28bAllowed(permissionKey) {
    const key = String(permissionKey || "").trim();
    const role = String(v28bRole || currentRole || "").trim().toLowerCase();
    if (!key) return false;
    if (role === "owner") return true;
    if (!v28bPolicyReady) return false;
    return v28bEffectivePermissions.get(key) === true;
  }

  function v28bRoleLabel(role) {
    return {
      owner: "Proprietario",
      admin: "Amministratore",
      technician: "Tecnico",
      reviewer: "Revisore legacy",
      support: "Supporto legacy",
    }[String(role || "").trim().toLowerCase()] || "Staff";
  }

  function v28bInjectStyles() {
    if (byId("staffPermissionsV28BStyles")) return;
    const style = document.createElement("style");
    style.id = "staffPermissionsV28BStyles";
    style.textContent = `
      .v28b-no-access{border:1px solid #d8e3de;border-radius:16px;padding:22px;background:#fff;box-shadow:var(--shadow)}
      .v28b-no-access h2{margin:0 0 7px;font-size:22px}.v28b-no-access p{margin:0;color:var(--muted);font-size:13px;line-height:1.5}
      .v28b-access-dialog .complimentary-card{width:min(760px,100%)}
      .v28b-access-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 0;padding:11px 12px;border:1px solid #dfe9e5;border-radius:11px;background:#f7fbf9}
      .v28b-access-summary strong{font-size:13px}.v28b-access-summary span{color:var(--muted);font-size:11px}
      .v28b-permission-list{display:grid;gap:12px;max-height:46vh;overflow:auto;padding-right:3px}
      .v28b-permission-group{border:1px solid #e2ebe7;border-radius:12px;overflow:hidden;background:#fff}
      .v28b-permission-group h3{margin:0;padding:10px 12px;border-bottom:1px solid #e7eeeb;background:#f8fbf9;font-size:12px}
      .v28b-permission-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 12px;border-top:1px solid #eef3f1}
      .v28b-permission-row:first-of-type{border-top:0}
      .v28b-permission-copy{min-width:0}.v28b-permission-copy strong{display:block;font-size:12px}.v28b-permission-copy small{display:block;margin-top:3px;color:var(--muted);font-size:10px;line-height:1.35}
      .v28b-switch{display:flex;align-items:center;gap:7px;flex:0 0 auto;color:#42534c;font-size:11px;font-weight:800}
      .v28b-switch input{width:18px;min-height:18px;height:18px;margin:0}
      .v28b-readonly-note{margin:12px 0 0;border:1px solid #dfe9e5;border-radius:10px;padding:10px 11px;color:#52635c;background:#fbfdfc;font-size:11px;line-height:1.45}
      @media(max-width:680px){.v28b-permission-row{align-items:flex-start;flex-direction:column}.v28b-switch{width:100%;justify-content:space-between}}
    `;
    document.head.append(style);
  }

  function v28bEnsureNoAccessView() {
    let view = byId("staffV28BNoAccess");
    if (view) return view;
    const main = document.querySelector("#staffApp .main");
    if (!main) return null;
    view = document.createElement("section");
    view.id = "staffV28BNoAccess";
    view.className = "v28b-no-access";
    view.hidden = true;
    view.innerHTML = `
      <h2 id="staffV28BNoAccessTitle">Nessun modulo assegnato</h2>
      <p id="staffV28BNoAccessText">Il tuo account Staff è attivo, ma il Proprietario non ha ancora assegnato moduli operativi. Quando i permessi verranno aggiornati, questa pagina si adeguerà automaticamente.</p>
    `;
    main.prepend(view);
    return view;
  }

  function v28bSetNoAccessMessage(policyUnavailable = false) {
    const title = byId("staffV28BNoAccessTitle");
    const text = byId("staffV28BNoAccessText");
    if (title) title.textContent = policyUnavailable ? "Permessi Staff non disponibili" : "Nessun modulo assegnato";
    if (text) {
      text.textContent = policyUnavailable
        ? "Per sicurezza nessun modulo viene aperto finché la matrice dei permessi non è disponibile. Riprova con Aggiorna o accedi nuovamente."
        : "Il tuo account Staff è attivo, ma il Proprietario non ha ancora assegnato moduli operativi. Quando i permessi verranno aggiornati, questa pagina si adeguerà automaticamente.";
    }
  }

  function v28bFailClosedUi() {
    document.querySelectorAll("[data-staff-tab]").forEach(button => {
      const permission = V28B_TAB_PERMISSION[String(button.dataset.staffTab || "")];
      if (permission) button.hidden = true;
    });
    document.querySelectorAll("[data-staff-view]").forEach(view => {
      const permission = V28B_TAB_PERMISSION[String(view.dataset.staffView || "")];
      if (permission) view.hidden = true;
    });
    Object.keys(V28B_SPECIAL_BUTTON_PERMISSION).forEach(id => {
      const button = byId(id);
      if (button) button.hidden = true;
    });
    v28bSyncGroupLabels();
  }

  function v28bVisibleStandardTabs() {
    return [...document.querySelectorAll("[data-staff-tab]")]
      .filter(button => {
        const permission = V28B_TAB_PERMISSION[button.dataset.staffTab];
        return permission && !button.hidden && v28bAllowed(permission);
      });
  }

  function v28bSyncGroupLabels() {
    const nav = document.querySelector("#staffApp .nav");
    if (!nav) return;
    const children = [...nav.children];
    children.forEach((child, index) => {
      if (!child.classList?.contains("nav-group-label")) return;
      let hasVisibleButton = false;
      for (let cursor = index + 1; cursor < children.length; cursor += 1) {
        const sibling = children[cursor];
        if (sibling.classList?.contains("nav-group-label")) break;
        if (sibling instanceof HTMLButtonElement && !sibling.hidden) {
          hasVisibleButton = true;
          break;
        }
      }
      child.hidden = !hasVisibleButton;
    });
  }

  function v28bApplyModuleVisibility() {
    if (byId("staffApp")?.hidden) return;

    const role = String(v28bRole || currentRole || "").trim().toLowerCase();
    if (!role) return;

    document.querySelectorAll("[data-staff-tab]").forEach(button => {
      const tab = String(button.dataset.staffTab || "");
      const permission = V28B_TAB_PERMISSION[tab];
      if (!permission) return;
      button.hidden = !v28bAllowed(permission);
      button.dataset.v28bPermission = permission;
    });

    document.querySelectorAll("[data-staff-view]").forEach(view => {
      const tab = String(view.dataset.staffView || "");
      const permission = V28B_TAB_PERMISSION[tab];
      if (!permission) return;
      const allowed = v28bAllowed(permission);
      view.hidden = !allowed;
      view.dataset.v28bPermission = permission;
    });

    Object.entries(V28B_SPECIAL_BUTTON_PERMISSION).forEach(([id, permission]) => {
      const button = byId(id);
      if (!button) return;
      button.hidden = !v28bAllowed(permission);
      button.dataset.v28bPermission = permission;
    });

    v28bSyncGroupLabels();
    v28bEnforceCurrentModule();
  }

  function v28bEnforceCurrentModule() {
    if (v28bNavigationGuard || byId("staffApp")?.hidden) return;
    const role = String(v28bRole || currentRole || "").trim().toLowerCase();
    if (!role) return;

    const requested = String(location.hash || "").replace(/^#/, "") || "overview";
    const requestedPermission = V28B_TAB_PERMISSION[requested];
    if (!requestedPermission || v28bAllowed(requestedPermission)) {
      const noAccess = byId("staffV28BNoAccess");
      if (noAccess) noAccess.hidden = true;
      return;
    }

    const allowedTabs = v28bVisibleStandardTabs();
    const noAccess = v28bEnsureNoAccessView();

    if (!allowedTabs.length) {
      document.querySelectorAll("[data-staff-view]").forEach(view => view.classList.remove("active"));
      document.querySelectorAll("[data-staff-tab]").forEach(button => button.classList.remove("active"));
      if (noAccess) {
        v28bSetNoAccessMessage(!v28bPolicyReady);
        noAccess.hidden = false;
      }
      if (location.hash) history.replaceState(null, "", location.pathname + location.search);
      return;
    }

    if (noAccess) noAccess.hidden = true;
    const target = allowedTabs[0];
    v28bNavigationGuard = true;
    try {
      target.click();
    } finally {
      queueMicrotask(() => { v28bNavigationGuard = false; });
    }
  }

  async function v28bRefreshEffectivePermissions({ silent = true } = {}) {
    if (!storedAccessToken()) {
      v28bRole = "";
      v28bPolicyReady = false;
      v28bEffectivePermissions = new Map();
      return;
    }
    if (v28bPolicyRequest) return v28bPolicyRequest;

    v28bPolicyRequest = (async () => {
      try {
        const payload = await rpc("premium_staff_effective_permissions");
        const snapshot = Array.isArray(payload) ? payload[0] : payload;
        const role = String(snapshot?.role || currentRole || "").trim().toLowerCase();
        const permissions = snapshot?.permissions && typeof snapshot.permissions === "object"
          ? snapshot.permissions
          : {};

        v28bRole = role;
        v28bEffectivePermissions = new Map(
          Object.entries(permissions).map(([key, value]) => [String(key), value === true]),
        );
        v28bPolicyReady = Boolean(role);
        v28bApplyModuleVisibility();

        if (role === "owner") {
          v28bRefreshMatrix({ silent: true }).catch(() => {});
        } else {
          v28bMatrixByUser = new Map();
          v28bRemoveAccessControls();
        }
      } catch (error) {
        v28bRole = String(currentRole || "").trim().toLowerCase();
        v28bPolicyReady = v28bRole === "owner";
        v28bEffectivePermissions = new Map();
        v28bApplyModuleVisibility();
        if (!silent && v28bRole !== "owner") {
          setPageMessage("error", "Permessi Staff non disponibili. Nessun modulo è stato aperto.");
        } else if (v28bRole !== "owner") {
          console.warn("Staff v2.8B permessi effettivi non disponibili", error);
        }
      }
    })().finally(() => {
      v28bPolicyRequest = null;
    });

    return v28bPolicyRequest;
  }

  async function v28bStabilizeInitialUi() {
    if (v28bInitialUiStable || byId("staffApp")?.hidden) return;
    if (v28bStabilityRequest) return v28bStabilityRequest;

    v28bStabilityRequest = (async () => {
      // I due snapshot servono entrambi prima del primo paint stabile:
      // currentRole governa Dashboard/Laboratorio, V2.8 governa i moduli.
      await Promise.allSettled([
        refreshCurrentGovernance({ silent: true }),
        v28bRefreshEffectivePermissions({ silent: true }),
      ]);

      const role = String(v28bRole || currentRole || "").trim().toLowerCase();
      if (!role) {
        v28bFailClosedUi();
        const noAccess = v28bEnsureNoAccessView();
        if (noAccess) {
          v28bSetNoAccessMessage(true);
          noAccess.hidden = false;
        }
      } else {
        syncOwnerDashboardVisibility();
        syncOwnerLabVisibility();
        v28bApplyModuleVisibility();
        v28bEnforceCurrentModule();
      }

      if (role === "owner") {
        // Non blocca il paint: riguarda solo le righe della pagina Collaboratori.
        v28b1RefreshActivationStatuses({ silent: true });
      }

      v28bReleaseStabilityGate();
    })().finally(() => {
      v28bStabilityRequest = null;
    });

    return v28bStabilityRequest;
  }

  function v28bArmStabilityFallback() {
    if (v28bInitialUiStable || v28bStabilityFallbackTimer) return;
    v28bStabilityFallbackTimer = window.setTimeout(() => {
      v28bStabilityFallbackTimer = null;
      if (v28bInitialUiStable || byId("staffApp")?.hidden) return;

      const role = String(v28bRole || currentRole || "").trim().toLowerCase();
      if (role === "owner") {
        // Owner resta sempre full anche se una lettura accessoria tarda.
        v28bApplyModuleVisibility();
        syncOwnerDashboardVisibility();
        syncOwnerLabVisibility();
      } else if (!v28bPolicyReady) {
        // Per tutti gli altri ruoli il fallback resta fail-closed.
        v28bFailClosedUi();
        const noAccess = v28bEnsureNoAccessView();
        if (noAccess) {
          v28bSetNoAccessMessage(true);
          noAccess.hidden = false;
        }
      }
      v28bReleaseStabilityGate();
    }, 4000);
  }

  function v28bRemoveAccessControls() {
    document.querySelectorAll('[data-v28b-access-control="true"]').forEach(element => element.remove());
  }

  function v28bGroupMatrixRows(rows) {
    const grouped = new Map();
    (Array.isArray(rows) ? rows : []).forEach(item => {
      const userId = String(item.staff_user_id || "");
      if (!userId) return;
      if (!grouped.has(userId)) grouped.set(userId, []);
      grouped.get(userId).push(item);
    });
    return grouped;
  }

  function v28bConfigurableRows(userId) {
    return (v28bMatrixByUser.get(String(userId || "")) || [])
      .filter(item => item.configurable === true);
  }

  function v28bEnsureMatrixNote() {
    const content = byId("collaboratorContent");
    if (!content || content.querySelector('[data-v28b-matrix-note="true"]')) return;
    const note = document.createElement("div");
    note.className = "side-note";
    note.style.margin = "0 12px 12px";
    note.dataset.v28bMatrixNote = "true";
    note.textContent = "Accessi Control Center: il Proprietario vede sempre tutto; ogni Amministratore parte senza moduli e riceve soltanto i permessi che assegni qui; Tecnici e Revisori legacy hanno un profilo tecnico fisso limitato a Bollette e verifiche e Diagnostica PDF.";
    const metrics = content.querySelector(".metrics");
    if (metrics) content.insertBefore(note, metrics);
    else content.append(note);
  }

  function v28bRenderAccessControls() {
    if (String(v28bRole || currentRole || "").trim().toLowerCase() !== "owner") {
      v28bRemoveAccessControls();
      return;
    }

    v28bEnsureMatrixNote();
    const body = byId("collaboratorRows");
    if (!body) return;

    body.querySelectorAll("tr").forEach(row => {
      row.querySelectorAll('[data-v28b-access-control="true"]').forEach(element => element.remove());
      const userId = collaboratorUserId(row);
      if (!userId) return;

      const matrixRows = v28bMatrixByUser.get(userId) || [];
      if (!matrixRows.length) return;
      const sample = matrixRows[0];
      const role = String(sample.staff_role || "").trim().toLowerCase();
      const active = Boolean(sample.staff_active);

      const actionCell = row.querySelector("td:last-child");
      const actions = actionCell?.querySelector(".row-actions") || actionCell;
      if (!actions) return;

      const badgeElement = permissionBadge("", "");
      badgeElement.dataset.v28bAccessControl = "true";
      badgeElement.removeAttribute("data-v25b-permission");

      if (role === "owner") {
        badgeElement.textContent = "Accesso: completo";
        badgeElement.className = "badge ok";
        actions.append(badgeElement);
        return;
      }

      if (role === "admin") {
        if (!active) {
          badgeElement.textContent = "Accessi: sospesi";
          badgeElement.className = "badge warn";
          actions.append(badgeElement);
          return;
        }
        const configurable = matrixRows.filter(item => item.configurable === true);
        const allowedCount = configurable.filter(item => item.effective_allowed === true).length;
        badgeElement.textContent = `Permessi: ${allowedCount}/${configurable.length}`;
        badgeElement.className = `badge ${allowedCount ? "info" : "warn"}`;
        actions.append(badgeElement);

        const manage = permissionButton("Gestisci accessi", "secondary", event => {
          event.preventDefault();
          event.stopPropagation();
          v28bOpenAccessDialog(userId);
        });
        manage.dataset.v28bAccessControl = "true";
        manage.removeAttribute("data-v25b-permission");
        actions.append(manage);
        return;
      }

      if (["technician", "reviewer"].includes(role)) {
        badgeElement.textContent = "Accesso: tecnico fisso";
        badgeElement.className = "badge info";
        actions.append(badgeElement);
        return;
      }

      badgeElement.textContent = "Accesso: nessun modulo";
      badgeElement.className = "badge";
      actions.append(badgeElement);
    });
  }

  async function v28bRefreshMatrix({ silent = true } = {}) {
    if (String(v28bRole || currentRole || "").trim().toLowerCase() !== "owner") return;
    if (v28bMatrixRequest) return v28bMatrixRequest;

    v28bMatrixRequest = (async () => {
      try {
        const rows = await rpc("premium_owner_list_staff_permission_matrix");
        v28bMatrixByUser = v28bGroupMatrixRows(rows);
        v28bRenderAccessControls();
        v28b1RenderActivationStatuses();
      } catch (error) {
        v28bMatrixByUser = new Map();
        v28bRemoveAccessControls();
        if (!silent) setPageMessage("error", friendlyGovernanceError(error));
        else console.warn("Staff v2.8B matrice Owner non disponibile", error);
      }
    })().finally(() => {
      v28bMatrixRequest = null;
    });

    return v28bMatrixRequest;
  }

  function v28bScheduleMatrixRender() {
    if (v28bRenderScheduled || String(v28bRole || currentRole || "").trim().toLowerCase() !== "owner") return;
    v28bRenderScheduled = true;
    queueMicrotask(() => {
      v28bRenderScheduled = false;
      v28bRefreshMatrix({ silent: true });
    });
  }

  function v28bPermissionDescription(permissionKey) {
    return {
      view_control: "Vista riepilogativa del Control Center.",
      view_cases: "Accesso alle pratiche operative e alle richieste cliente.",
      view_customers: "Accesso ai profili Premium, utenze e contratti.",
      view_checks: "Visualizzazione della coda bollette e verifiche.",
      view_leads: "Accesso a lead, contatti e attivazioni.",
      view_analytics: "Accesso alle statistiche e al funnel.",
      view_site_preview: "Apertura della modalità Staff di verifica del sito.",
      view_pdf_diagnostics: "Accesso all’archivio diagnostico PDF.",
      view_ai_costs: "Accesso ai costi IA e alla configurazione tecnica.",
      manage_checks: "Operazioni sulle verifiche bollette. Saranno protette lato backend in V2.8C.",
      manage_customers: "Operazioni di gestione dei clienti. Saranno protette lato backend in V2.8C.",
      manage_billing: "Operazioni pagamenti e Stripe. Saranno protette lato backend in V2.8C.",
      manage_ai_configuration: "Modifica della configurazione IA. Sarà protetta lato backend in V2.8C.",
      delete_records: "Eliminazioni critiche. Saranno protette lato backend in V2.8C.",
    }[String(permissionKey || "")] || "Permesso operativo del Control Center.";
  }

  function v28bEnsureAccessDialog() {
    let layer = byId("staffAccessPermissionLayer");
    if (layer) return layer;

    v28bInjectStyles();
    layer = document.createElement("div");
    layer.id = "staffAccessPermissionLayer";
    layer.className = "complimentary-layer v28b-access-dialog";
    layer.hidden = true;
    layer.setAttribute("role", "dialog");
    layer.setAttribute("aria-modal", "true");
    layer.setAttribute("aria-labelledby", "staffAccessPermissionTitle");

    const card = document.createElement("div");
    card.className = "complimentary-card";
    card.innerHTML = `
      <h2 id="staffAccessPermissionTitle">Permessi Amministratore</h2>
      <p id="staffAccessPermissionTarget" class="complimentary-target"></p>
      <div class="v28b-access-summary">
        <div><strong>Accessi delegati dal Proprietario</strong><span id="staffAccessPermissionCount"></span></div>
        <span class="badge ok">Owner sempre completo</span>
      </div>
      <div id="staffAccessPermissionList" class="v28b-permission-list"></div>
      <div id="staffAccessComplimentaryNote" class="v28b-readonly-note"></div>
      <form id="staffAccessPermissionForm" class="complimentary-form" novalidate>
        <label>Motivazione obbligatoria per le modifiche
          <textarea id="staffAccessPermissionReason" name="reason" maxlength="500" required placeholder="Esempio: accessi necessari per gestione amministrativa"></textarea>
        </label>
      </form>
      <div id="staffAccessPermissionStatus" class="complimentary-status" hidden role="status"></div>
      <div class="complimentary-actions">
        <button id="staffAccessPermissionCancel" class="button" type="button">ANNULLA</button>
        <button id="staffAccessPermissionApply" class="button primary" type="button">SALVA PERMESSI</button>
      </div>
    `;
    layer.append(card);
    document.body.append(layer);

    byId("staffAccessPermissionCancel")?.addEventListener("click", v28bCloseAccessDialog);
    byId("staffAccessPermissionApply")?.addEventListener("click", v28bSaveAccessDialog);
    layer.addEventListener("click", event => {
      if (event.target === layer) v28bCloseAccessDialog();
    });

    return layer;
  }

  function v28bSetAccessDialogStatus(kind, message) {
    const target = byId("staffAccessPermissionStatus");
    if (!target) return;
    target.className = `complimentary-status${kind ? ` ${kind}` : ""}`;
    target.textContent = message || "";
    target.hidden = !message;
  }

  function v28bSetAccessDialogBusy(value) {
    const busyState = Boolean(value);
    byId("staffAccessPermissionCancel") && (byId("staffAccessPermissionCancel").disabled = busyState);
    byId("staffAccessPermissionApply") && (byId("staffAccessPermissionApply").disabled = busyState);
    byId("staffAccessPermissionReason") && (byId("staffAccessPermissionReason").disabled = busyState);
    byId("staffAccessPermissionList")?.querySelectorAll("input[type='checkbox']").forEach(input => {
      input.disabled = busyState;
    });
  }

  function v28bOpenAccessDialog(userId) {
    if (String(v28bRole || currentRole || "").trim().toLowerCase() !== "owner") return;
    const rows = v28bMatrixByUser.get(String(userId || "")) || [];
    const sample = rows[0];
    if (!sample || String(sample.staff_role || "").trim().toLowerCase() !== "admin" || !sample.staff_active) return;

    const configurableRows = rows.filter(item => item.configurable === true);
    v28bPermissionDialogState = {
      staffUserId: String(sample.staff_user_id || ""),
      email: String(sample.staff_email || sample.staff_user_id || "Amministratore"),
      original: new Map(
        configurableRows.map(item => [String(item.permission_key), item.effective_allowed === true]),
      ),
    };

    v28bEnsureAccessDialog();
    byId("staffAccessPermissionTarget").textContent =
      `${v28bPermissionDialogState.email} · ${v28bRoleLabel(sample.staff_role)}`;

    const list = byId("staffAccessPermissionList");
    list.replaceChildren();

    const categories = new Map();
    configurableRows.forEach(item => {
      const category = String(item.permission_category || "Altro");
      if (!categories.has(category)) categories.set(category, []);
      categories.get(category).push(item);
    });

    categories.forEach((items, category) => {
      const group = document.createElement("section");
      group.className = "v28b-permission-group";
      const heading = document.createElement("h3");
      heading.textContent = category;
      group.append(heading);

      items.forEach(item => {
        const row = document.createElement("label");
        row.className = "v28b-permission-row";

        const copy = document.createElement("span");
        copy.className = "v28b-permission-copy";
        const strong = document.createElement("strong");
        strong.textContent = String(item.permission_label || item.permission_key || "Permesso");
        const small = document.createElement("small");
        small.textContent = v28bPermissionDescription(item.permission_key);
        copy.append(strong, small);

        const control = document.createElement("span");
        control.className = "v28b-switch";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = item.effective_allowed === true;
        input.dataset.permissionKey = String(item.permission_key || "");
        const labelText = document.createElement("span");
        labelText.textContent = input.checked ? "Consentito" : "Negato";
        input.addEventListener("change", () => {
          labelText.textContent = input.checked ? "Consentito" : "Negato";
          v28bUpdateAccessDialogCount();
        });
        control.append(input, labelText);
        row.append(copy, control);
        group.append(row);
      });
      list.append(group);
    });

    const complimentary = rows.find(item => item.permission_key === "manage_complimentary");
    const complimentaryNote = byId("staffAccessComplimentaryNote");
    complimentaryNote.textContent = complimentary?.effective_allowed
      ? "Premium omaggio: autorizzato tramite la governance dedicata V2.5A. Per modificarlo usa “Revoca omaggi” nella riga del collaboratore."
      : "Premium omaggio: non autorizzato. Questo permesso resta separato dalla matrice e si gestisce con “Autorizza omaggi” nella riga del collaboratore.";

    const reason = byId("staffAccessPermissionReason");
    if (reason) reason.value = "";
    v28bSetAccessDialogStatus("", "");
    v28bSetAccessDialogBusy(false);
    v28bUpdateAccessDialogCount();
    byId("staffAccessPermissionLayer").hidden = false;
  }

  function v28bUpdateAccessDialogCount() {
    const inputs = [...(byId("staffAccessPermissionList")?.querySelectorAll("input[type='checkbox']") || [])];
    const allowed = inputs.filter(input => input.checked).length;
    const changed = v28bPermissionDialogState
      ? inputs.filter(input =>
          v28bPermissionDialogState.original.get(String(input.dataset.permissionKey || "")) !== input.checked
        ).length
      : 0;
    const target = byId("staffAccessPermissionCount");
    if (target) target.textContent = `Consentiti ${allowed}/${inputs.length} · modifiche ${changed}`;
  }

  function v28bCloseAccessDialog() {
    const layer = byId("staffAccessPermissionLayer");
    if (layer) layer.hidden = true;
    v28bPermissionDialogState = null;
    v28bSetAccessDialogStatus("", "");
    v28bSetAccessDialogBusy(false);
  }

  async function v28bSaveAccessDialog() {
    if (String(v28bRole || currentRole || "").trim().toLowerCase() !== "owner" || !v28bPermissionDialogState) return;

    const inputs = [...(byId("staffAccessPermissionList")?.querySelectorAll("input[type='checkbox']") || [])];
    const changes = inputs
      .map(input => ({
        permissionKey: String(input.dataset.permissionKey || ""),
        allowed: input.checked === true,
        previous: v28bPermissionDialogState.original.get(String(input.dataset.permissionKey || "")) === true,
      }))
      .filter(item => item.permissionKey && item.allowed !== item.previous);

    if (!changes.length) {
      v28bCloseAccessDialog();
      setPageMessage("info", "Nessuna modifica ai permessi.");
      return;
    }

    const reason = String(byId("staffAccessPermissionReason")?.value || "").trim();
    if (!reason) {
      v28bSetAccessDialogStatus("error", "Inserisci una motivazione prima di salvare.");
      byId("staffAccessPermissionReason")?.focus();
      return;
    }

    v28bSetAccessDialogBusy(true);
    v28bSetAccessDialogStatus("info", `Salvataggio di ${changes.length} modifica/e…`);

    const completed = [];
    try {
      for (const change of changes) {
        await rpc("premium_owner_set_staff_permission", {
          p_user_id: v28bPermissionDialogState.staffUserId,
          p_permission_key: change.permissionKey,
          p_allowed: change.allowed,
          p_reason: reason,
        });
        completed.push(change.permissionKey);
      }

      const label = v28bPermissionDialogState.email;
      v28bCloseAccessDialog();
      await v28bRefreshMatrix({ silent: true });
      setPageMessage("success", `Permessi aggiornati per ${label}. Modifiche applicate: ${completed.length}.`);
      window.dispatchEvent(new Event("offertalogica:staff-save-complete"));
    } catch (error) {
      v28bSetAccessDialogStatus(
        "error",
        completed.length
          ? `Aggiornamento parziale: ${completed.length} modifica/e salvata/e. ${friendlyGovernanceError(error)} Aggiorna la matrice prima di riprovare.`
          : friendlyGovernanceError(error),
      );
      await v28bRefreshMatrix({ silent: true }).catch(() => {});
      v28bSetAccessDialogBusy(false);
    }
  }

  function v28b1ActivationRow(userId) {
    return v28b1ActivationByUser.get(String(userId || "")) || null;
  }

  function v28b1Small(textValue) {
    const element = document.createElement("small");
    element.textContent = String(textValue || "");
    return element;
  }

  function v28b1DefaultStatusCell(statusCell, active) {
    if (!statusCell) return;
    statusCell.replaceChildren(permissionBadge(active ? "Attivo" : "Disattivato", active ? "ok" : "danger"));
  }

  function v28b1RenderActivationStatuses() {
    if (String(v28bRole || currentRole || "").trim().toLowerCase() !== "owner") return;

    const body = byId("collaboratorRows");
    if (!body) return;

    body.querySelectorAll("tr").forEach(row => {
      const userId = collaboratorUserId(row);
      if (!userId) return;
      const activation = v28b1ActivationRow(userId);
      if (!activation) return;

      const statusCell = row.children?.[2];
      if (!statusCell) return;

      const active = activation.staff_active === true;
      v28b1DefaultStatusCell(statusCell, active);
      if (!active) return;

      const activationStatus = String(activation.activation_status || "");
      if (activationStatus === "invited_pending") {
        statusCell.replaceChildren(
          permissionBadge("Invito inviato", "warn"),
          v28b1Small("In attesa di attivazione"),
        );
        return;
      }

      if (activationStatus === "email_unconfirmed") {
        statusCell.replaceChildren(
          permissionBadge("Email non confermata", "warn"),
          v28b1Small("Account Auth non ancora confermato"),
        );
        return;
      }

      if (activationStatus === "auth_missing") {
        statusCell.replaceChildren(
          permissionBadge("Auth non trovato", "danger"),
          v28b1Small("Verifica l’account Supabase Auth"),
        );
      }
    });
  }

  async function v28b1RefreshActivationStatuses({ silent = true } = {}) {
    if (String(v28bRole || currentRole || "").trim().toLowerCase() !== "owner") {
      v28b1ActivationByUser = new Map();
      return;
    }
    if (v28b1ActivationRequest) return v28b1ActivationRequest;

    v28b1ActivationRequest = (async () => {
      try {
        const rows = await rpc("premium_owner_list_staff_activation_status");
        const next = new Map();
        (Array.isArray(rows) ? rows : []).forEach(item => {
          const userId = String(item.staff_user_id || "");
          if (userId) next.set(userId, item);
        });
        v28b1ActivationByUser = next;
        v28b1RenderActivationStatuses();
      } catch (error) {
        v28b1ActivationByUser = new Map();
        if (!silent) setPageMessage("error", friendlyGovernanceError(error));
        else console.warn("Staff v2.8B1 stato inviti non disponibile", error);
      }
    })().finally(() => {
      v28b1ActivationRequest = null;
    });

    return v28b1ActivationRequest;
  }

  function v28b1CaptureInviteRequest(event) {
    const button = event.target instanceof Element ? event.target.closest("#collaboratorInvite") : null;
    if (!(button instanceof HTMLButtonElement)) return;

    const form = byId("collaboratorAddForm");
    const email = String(form?.elements?.email?.value || "").trim().toLowerCase();
    const role = String(form?.elements?.role?.value || "technician").trim().toLowerCase();
    if (!email || !["admin", "technician"].includes(role)) {
      v28b1PendingInvite = null;
      return;
    }

    v28b1PendingInvite = {
      email,
      role,
      capturedAt: Date.now(),
    };
  }

  function v28b1FindActivationByEmail(email) {
    const expected = String(email || "").trim().toLowerCase();
    if (!expected) return null;
    return [...v28b1ActivationByUser.values()].find(item =>
      String(item.staff_email || "").trim().toLowerCase() === expected
    ) || null;
  }

  async function v28b1HandleInviteSuccess() {
    if (v28b1InviteActionInFlight || !v28b1PendingInvite) return;

    const pending = v28b1PendingInvite;
    const messageTarget = byId("staffPageMessage");
    const message = String(messageTarget?.textContent || "").trim();
    const isSuccess = messageTarget?.classList?.contains("success") === true;
    const expectedPrefix = `Invito inviato a ${pending.email}.`;

    // Scade rapidamente: un vecchio click/cancel non deve agganciarsi a un invito futuro.
    if (Date.now() - Number(pending.capturedAt || 0) > 120000) {
      v28b1PendingInvite = null;
      return;
    }

    if (!isSuccess || !message.startsWith(expectedPrefix)) return;

    v28b1InviteActionInFlight = true;
    v28b1PendingInvite = null;

    try {
      await Promise.all([
        v28b1RefreshActivationStatuses({ silent: false }),
        v28bRefreshMatrix({ silent: false }),
      ]);

      const activation = v28b1FindActivationByEmail(pending.email);
      const userId = String(activation?.staff_user_id || "");

      if (pending.role === "admin") {
        if (!UUID_RE.test(userId)) {
          throw new Error("Nuovo Amministratore creato, ma il suo identificativo Staff non è ancora disponibile. Premi Aggiorna e usa Gestisci accessi.");
        }
        await v28bOpenAccessDialog(userId);
        setPageMessage(
          "success",
          `Invito inviato a ${pending.email}. Imposta ora i permessi dell’Amministratore; l’account resta in attesa finché non accetta l’invito.`,
        );
      } else {
        setPageMessage(
          "success",
          `Invito inviato a ${pending.email}. Il Tecnico userà automaticamente il profilo tecnico fisso.`,
        );
      }
    } catch (error) {
      setPageMessage(
        "error",
        `Invito inviato, ma non è stato possibile aprire automaticamente i permessi. ${friendlyGovernanceError(error)}`,
      );
    } finally {
      v28b1InviteActionInFlight = false;
      v28b1RenderActivationStatuses();
    }
  }

  function v28b1BindInviteFlow() {
    document.addEventListener("click", v28b1CaptureInviteRequest, true);

    const pageMessage = byId("staffPageMessage");
    if (pageMessage && !v28b1InviteMessageObserver) {
      v28b1InviteMessageObserver = new MutationObserver(() => {
        queueMicrotask(() => v28b1HandleInviteSuccess());
      });
      v28b1InviteMessageObserver.observe(pageMessage, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class", "hidden"],
      });
    }
  }

  function v28bBindGuards() {
    document.addEventListener("click", event => {
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      if (!(button instanceof HTMLButtonElement)) return;

      const tab = String(button.dataset.staffTab || "");
      const tabPermission = V28B_TAB_PERMISSION[tab];
      const specialPermission = V28B_SPECIAL_BUTTON_PERMISSION[button.id];
      const permission = tabPermission || specialPermission;
      if (!permission || v28bAllowed(permission)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setPageMessage("error", "Questo modulo non è assegnato al tuo account Staff.");
      v28bEnforceCurrentModule();
    }, true);

    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      const layer = byId("staffAccessPermissionLayer");
      if (layer && !layer.hidden) v28bCloseAccessDialog();
    });
  }

  function v28bBindObservers() {
    const collaboratorRows = byId("collaboratorRows");
    if (collaboratorRows) {
      new MutationObserver(() => {
        v28bScheduleMatrixRender();
        if (String(v28bRole || currentRole || "").trim().toLowerCase() === "owner") {
          v28b1RefreshActivationStatuses({ silent: true });
        }
      }).observe(collaboratorRows, { childList: true });
    }

    const nav = document.querySelector("#staffApp .nav");
    if (nav) {
      new MutationObserver(() => {
        v28bApplyModuleVisibility();
        if (String(v28bRole || currentRole || "").trim().toLowerCase() === "owner") {
          v28bRenderAccessControls();
        }
      }).observe(nav, { childList: true, subtree: false });
    }

    const views = document.querySelector("#staffApp .main");
    if (views) {
      new MutationObserver(() => {
        if (v28bPolicyReady || String(v28bRole || currentRole || "").trim().toLowerCase() === "owner") {
          v28bApplyModuleVisibility();
        }
      }).observe(views, { childList: true, subtree: false });
    }

    const identity = byId("staffIdentity");
    if (identity) {
      new MutationObserver(() => {
        v28bRefreshEffectivePermissions({ silent: true });
      }).observe(identity, { childList: true, characterData: true, subtree: true });
    }

    const staffApp = byId("staffApp");
    if (staffApp) {
      new MutationObserver(() => {
        if (staffApp.hidden) {
          v28bInitialUiStable = false;
          v28bInstallStabilityGate();
          v28bRole = "";
          v28bPolicyReady = false;
          v28bEffectivePermissions = new Map();
          v28bMatrixByUser = new Map();
          v28b1ActivationByUser = new Map();
          v28b1PendingInvite = null;
          v28bRemoveAccessControls();
          return;
        }
        v28bRole = "";
        v28bPolicyReady = false;
        v28bEffectivePermissions = new Map();
        v28bFailClosedUi();
        v28bArmStabilityFallback();
        v28bStabilizeInitialUi();
      }).observe(staffApp, { attributes: true, attributeFilter: ["hidden"] });
    }

    window.addEventListener("hashchange", () => {
      queueMicrotask(() => {
        v28bApplyModuleVisibility();
        v28bEnforceCurrentModule();
      });
    });
  }

  function v28bInit() {
    v28bInjectStyles();
    v28bEnsureNoAccessView();
    v28bBindGuards();
    v28bBindObservers();
    v28b1BindInviteFlow();

    const refresh = () => {
      if (!byId("staffApp")?.hidden) {
        v28bRefreshEffectivePermissions({ silent: true });
        if (String(v28bRole || currentRole || "").trim().toLowerCase() === "owner") {
          v28b1RefreshActivationStatuses({ silent: true });
        }
      }
    };

    if (!byId("staffApp")?.hidden) {
      v28bArmStabilityFallback();
      v28bStabilizeInitialUi();
    }
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refresh();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", v28bInit, { once: true });
  } else {
    v28bInit();
  }

})();
