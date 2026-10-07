(() => {
  const root = document.querySelector("[data-protection-account]");
  if (!root) return;

  const guest = root.querySelector("[data-protection-guest]");
  const authenticated = root.querySelector("[data-protection-authenticated]");
  const signupForm = root.querySelector("[data-protection-signup]");
  const loginForm = root.querySelector("[data-protection-login]");
  const signupStatus = root.querySelector("[data-protection-signup-status]");
  const loginStatus = root.querySelector("[data-protection-login-status]");
  const accountStatus = root.querySelector("[data-protection-account-status]");
  const emailLabel = root.querySelector("[data-protection-email]");
  const phoneStep = root.querySelector("[data-protection-phone-step]");
  const otpStep = root.querySelector("[data-protection-otp-step]");
  const activateStep = root.querySelector("[data-protection-activate-step]");
  const activeStep = root.querySelector("[data-protection-active-step]");
  const activePhone = root.querySelector("[data-protection-active-phone]");
  const newsletterStatus = root.querySelector("[data-protection-newsletter-status]");
  const newsletterToggle = root.querySelector("[data-protection-newsletter-toggle]");
  const contactCount = root.querySelector("[data-protection-contact-count]");
  const contactEmpty = root.querySelector("[data-protection-contact-empty]");
  const contactList = root.querySelector("[data-protection-contact-list]");
  const phoneInput = root.querySelector("[data-protection-phone]");
  const otpInput = root.querySelector("[data-protection-otp]");
  const activationConsent = root.querySelector("[data-protection-activation-consent]");
  const activateConsent = root.querySelector("[data-protection-activate-consent]");

  let currentState = null;

  function setHidden(element, hidden) {
    if (!element) return;
    element.hidden = Boolean(hidden);
  }

  function setStatus(element, message, level = "neutral") {
    if (!element) return;
    element.textContent = message || "";
    element.dataset.level = level;
    element.hidden = !message;
  }

  async function post(url, payload) {
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (!response.ok || data?.ok === false) {
      const error = new Error(data?.error || "Operazione non riuscita. Riprova.");
      error.status = response.status;
      error.retryAfter = Number(data?.retryAfter || response.headers.get("Retry-After") || 0) || 0;
      throw error;
    }
    return data;
  }

  function setBusy(button, busy, busyLabel = "Attendi…") {
    if (!button) return;
    if (busy) {
      button.dataset.originalLabel = button.textContent;
      button.textContent = busyLabel;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalLabel || button.textContent;
      button.disabled = false;
    }
  }

  function formatDateTime(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function contactActorLabel(item) {
    const partner = String(item?.partner_name || "").trim();
    if (item?.contact_actor === "offertalogica_or_partner" && partner) {
      return `Canale diretto Offerta Logica: la richiesta può essere gestita da Offerta Logica o da ${partner} / un suo incaricato dedicato.`;
    }
    if (item?.contact_actor === "partner" && partner) {
      return `Hai richiesto tramite Offerta Logica di proseguire con ${partner}. Questa voce riguarda solo la richiesta effettuata qui.`;
    }
    if (partner) return `Richiesta registrata tramite Offerta Logica per ${partner}.`;
    return "Hai richiesto questo contatto tramite Offerta Logica.";
  }

  function renderContactRequests(protection = {}) {
    if (!contactCount || !contactList || !contactEmpty) return;
    const requests = Array.isArray(protection.contactRequests) ? protection.contactRequests : [];
    const active = requests.filter((item) => item?.status === "active");
    const activeCount = Number(protection.activeContactRequests ?? active.length) || 0;
    contactCount.textContent = `${activeCount} ${activeCount === 1 ? "richiesta attiva" : "richieste attive"}`;
    contactEmpty.hidden = activeCount > 0;
    contactList.replaceChildren();
    if (!requests.length) {
      contactList.hidden = true;
      return;
    }

    requests.slice(0, 8).forEach((item) => {
      const article = document.createElement("article");
      article.className = "protection-contact-item";
      article.dataset.status = String(item?.status || "");

      const head = document.createElement("div");
      head.className = "protection-contact-item-head";
      const title = document.createElement("strong");
      title.textContent = item?.service_name || "Richiesta Offerta Logica";
      const status = document.createElement("span");
      const statusLabel = item?.status === "active" ? "Attiva" : item?.status === "revoked" ? "Revocata" : "Conclusa";
      status.textContent = statusLabel;
      status.dataset.status = String(item?.status || "");
      head.append(title, status);

      const detail = document.createElement("p");
      detail.textContent = contactActorLabel(item);
      const meta = document.createElement("small");
      const requestedAt = formatDateTime(item?.requested_at);
      meta.textContent = requestedAt ? `Richiesta il ${requestedAt}` : "Richiesta registrata";

      article.append(head, detail, meta);
      if (item?.status === "active" && item?.id) {
        const revoke = document.createElement("button");
        revoke.type = "button";
        revoke.className = "protection-contact-revoke";
        revoke.dataset.protectionRevokeContact = String(item.id);
        revoke.textContent = "Revoca richiesta";
        article.append(revoke);
      }
      contactList.append(article);
    });
    contactList.hidden = false;
  }

  function openAuth(kind) {
    setHidden(signupForm, kind !== "signup");
    setHidden(loginForm, kind !== "login");
    const form = kind === "signup" ? signupForm : loginForm;
    const first = form?.querySelector("input");
    first?.focus({ preventScroll: true });
    form?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function render(payload) {
    currentState = payload;
    const isAuthenticated = Boolean(payload?.authenticated);
    setHidden(guest, isAuthenticated);
    setHidden(authenticated, !isAuthenticated);
    root.dataset.protectionState = isAuthenticated ? "authenticated" : "guest";
    if (!isAuthenticated) return;

    if (emailLabel) emailLabel.textContent = payload.email || "Account verificato";
    const protection = payload.protection || {};
    const active = Boolean(protection.active);
    const phoneVerified = Boolean(protection.phoneVerified);

    setHidden(phoneStep, active || phoneVerified);
    setHidden(otpStep, true);
    setHidden(activateStep, active || !phoneVerified);
    setHidden(activeStep, !active);

    if (active) {
      root.dataset.protectionState = "active";
      setStatus(accountStatus, "Protezione OL attiva", "success");
      if (activePhone) activePhone.textContent = protection.phoneMasked || "Numero verificato";
      const newsletterEnabled = Boolean(protection.newsletterEnabled);
      if (newsletterStatus) {
        newsletterStatus.textContent = newsletterEnabled ? "Attive" : "Non attive";
        newsletterStatus.dataset.active = newsletterEnabled ? "true" : "false";
      }
      if (newsletterToggle) {
        newsletterToggle.textContent = newsletterEnabled ? "Disattiva aggiornamenti" : "Attiva aggiornamenti";
        newsletterToggle.dataset.enabled = newsletterEnabled ? "true" : "false";
      }
      renderContactRequests(protection);
    } else if (phoneVerified) {
      setStatus(accountStatus, "Numero verificato. Completa l’attivazione.", "warning");
    } else {
      setStatus(accountStatus, "Account confermato. Verifica il tuo numero una sola volta.", "neutral");
    }
  }

  async function refreshStatus({ silent = false } = {}) {
    try {
      const data = await post("/api/lead", { mode: "protection", action: "status" });
      render(data);
      return data;
    } catch (error) {
      render({ authenticated: false });
      if (!silent) setStatus(loginStatus, error.message, "error");
      return null;
    }
  }

  root.querySelector("[data-protection-open-signup]")?.addEventListener("click", () => openAuth("signup"));
  root.querySelector("[data-protection-open-login]")?.addEventListener("click", () => openAuth("login"));
  root.querySelectorAll("[data-protection-switch]").forEach((button) => {
    button.addEventListener("click", () => openAuth(button.dataset.protectionSwitch));
  });

  signupForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = signupForm.querySelector('button[type="submit"]');
    const email = signupForm.querySelector('[name="email"]')?.value || "";
    const password = signupForm.querySelector('[name="password"]')?.value || "";
    const passwordConfirm = signupForm.querySelector('[name="password_confirm"]')?.value || "";
    const accepted = Boolean(signupForm.querySelector('[name="accepted"]')?.checked);
    setStatus(signupStatus, "");
    if (password !== passwordConfirm) {
      setStatus(signupStatus, "Le due password non coincidono.", "error");
      return;
    }
    try {
      setBusy(button, true, "Creazione account…");
      const data = await post("/api/lead", {
        mode: "protection",
        action: "signup",
        email,
        password,
        accepted,
      });
      if (data.authenticated) {
        await refreshStatus({ silent: true });
        setStatus(
          accountStatus,
          data.existingAccount
            ? "Account Offerta Logica riconosciuto. Ora verifica il tuo numero per aggiungere Protezione OL."
            : "Account creato. Ora verifica il tuo numero.",
          "success",
        );
      } else if (data.useLogin) {
        openAuth("login");
        const loginEmail = loginForm?.querySelector('[name="email"]');
        if (loginEmail) loginEmail.value = email;
        setStatus(loginStatus, data.message || "Accedi con il tuo account Offerta Logica per continuare.", "info");
      } else {
        setStatus(signupStatus, data.message || "Controlla la tua email e conferma la registrazione.", "success");
        signupForm.querySelectorAll("input").forEach((input) => {
          if (input.type === "password") input.value = "";
        });
      }
    } catch (error) {
      setStatus(signupStatus, error.message, "error");
    } finally {
      setBusy(button, false);
    }
  });

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = loginForm.querySelector('button[type="submit"]');
    const email = loginForm.querySelector('[name="email"]')?.value || "";
    const password = loginForm.querySelector('[name="password"]')?.value || "";
    setStatus(loginStatus, "");
    try {
      setBusy(button, true, "Accesso…");
      const data = await post("/api/lead", { mode: "protection", action: "login", email, password });
      render(data);
      loginForm.querySelector('[name="password"]').value = "";
    } catch (error) {
      setStatus(loginStatus, error.message, "error");
    } finally {
      setBusy(button, false);
    }
  });

  root.querySelector("[data-protection-send-otp]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const phone = phoneInput?.value || "";
    setStatus(accountStatus, "");
    try {
      setBusy(button, true, "Invio codice…");
      await post("/api/send-otp", { mode: "protection", phone });
      setHidden(otpStep, false);
      setStatus(accountStatus, "Codice inviato via SMS. Inseriscilo per attivare Protezione OL.", "success");
      otpInput?.focus();
    } catch (error) {
      const suffix = error.retryAfter ? ` Riprova tra ${error.retryAfter} secondi.` : "";
      setStatus(accountStatus, `${error.message}${suffix}`, "error");
    } finally {
      setBusy(button, false);
    }
  });

  root.querySelector("[data-protection-verify-otp]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const code = otpInput?.value || "";
    const accepted = Boolean(activationConsent?.checked);
    setStatus(accountStatus, "");
    if (!accepted) {
      setStatus(accountStatus, "Conferma di voler attivare Protezione OL.", "error");
      activationConsent?.focus();
      return;
    }
    try {
      setBusy(button, true, "Verifica…");
      await post("/api/verify-otp", { mode: "protection", code, accepted: true });
      const data = await refreshStatus({ silent: true });
      if (data?.authenticated) setStatus(accountStatus, "Numero verificato. Protezione OL è attiva.", "success");
    } catch (error) {
      setStatus(accountStatus, error.message, "error");
    } finally {
      setBusy(button, false);
    }
  });

  root.querySelector("[data-protection-activate]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (!activateConsent?.checked) {
      setStatus(accountStatus, "Conferma di voler attivare Protezione OL.", "error");
      activateConsent?.focus();
      return;
    }
    try {
      setBusy(button, true, "Attivazione…");
      const data = await post("/api/lead", { mode: "protection", action: "activate", accepted: true });
      render(data);
    } catch (error) {
      setStatus(accountStatus, error.message, "error");
    } finally {
      setBusy(button, false);
    }
  });

  newsletterToggle?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const enabled = button.dataset.enabled === "true";
    setStatus(accountStatus, "");
    try {
      setBusy(button, true, enabled ? "Disattivazione…" : "Attivazione…");
      const data = await post("/api/lead", { mode: "protection", action: "newsletter", enabled: !enabled });
      render(data);
      setStatus(
        accountStatus,
        !enabled ? "Novità energia e risparmio attivate." : "Novità energia e risparmio disattivate.",
        "success",
      );
    } catch (error) {
      setStatus(accountStatus, error.message, "error");
    } finally {
      setBusy(button, false);
    }
  });

  contactList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-protection-revoke-contact]");
    if (!button) return;
    const requestId = button.dataset.protectionRevokeContact || "";
    if (!requestId) return;
    setStatus(accountStatus, "");
    try {
      setBusy(button, true, "Revoca…");
      const data = await post("/api/lead", { mode: "protection", action: "revoke-contact", requestId });
      render(data);
      setStatus(accountStatus, "Richiesta di contatto revocata.", "success");
    } catch (error) {
      setStatus(accountStatus, error.message, "error");
      setBusy(button, false);
    }
  });

  root.querySelector("[data-protection-logout]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      setBusy(button, true, "Uscita…");
      await post("/api/lead", { mode: "protection", action: "logout" });
      render({ authenticated: false });
      openAuth("login");
    } catch (error) {
      setStatus(accountStatus, error.message, "error");
    } finally {
      setBusy(button, false);
    }
  });

  const params = new URLSearchParams(window.location.search);
  if (params.get("protection") === "confirmed") {
    setStatus(accountStatus, "Email confermata. Completa la verifica del numero.", "success");
  }

  refreshStatus({ silent: true });
})();
