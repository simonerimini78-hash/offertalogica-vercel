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
