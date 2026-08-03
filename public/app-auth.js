(() => {
  "use strict";

  const SUPABASE_URL = "https://kzxdamhfmzaxonpkytcf.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_poz1xBKiXceLCFV3u_tPIg_5_-ycHcl";
  const STORAGE_KEY = "offertalogica-premium-auth";
  const PENDING_EMAIL_KEY = "offertalogica-premium-pending-email";
  const TERMS_VERSION = "premium-terms-v0.35-2026-08-03";
  const PRIVACY_VERSION = "premium-privacy-v0.35-2026-08-03";
  const CLOUD_VERSION = "premium-cloud-ai-v0.35-2026-08-03";

  let client = null;
  let initialized = false;
  let authSubscription = null;
  let recoveryMode = false;
  let currentSession = null;
  let accountLoadSequence = 0;
  let passwordUpdateInProgress = false;

  const byId = id => document.getElementById(id);

  const state = {
    loginForm: null,
    signupForm: null,
    recoveryForm: null,
    changePasswordForm: null,
    authSignedOut: null,
    authSignedIn: null,
    authMessage: null,
    resendWrap: null,
    accountEmail: null,
    accountName: null,
    accountPlan: null,
    accountExpiry: null,
    accountStatus: null,
    profileKicker: null,
    profileTitle: null,
    profileBadge: null,
    profileDescription: null,
    profileEmail: null,
    profileArchive: null,
    profileControls: null,
    homePlanName: null,
    homePlanStatus: null,
    homePremiumBadge: null,
    homePremiumTitle: null,
    homePremiumCopy: null,
    legalPanel: null,
    legalStatus: null,
    legalAcceptButton: null,
    deletionPanel: null,
    deletionStatus: null,
    deletionRequestButton: null,
    deletionCancelButton: null,
    passwordPanel: null,
    passwordToggle: null,
  };

  function setMessage(kind, message) {
    if (!state.authMessage) return;
    state.authMessage.className = `auth-message${kind ? ` ${kind}` : ""}`;
    state.authMessage.textContent = message || "";
    state.authMessage.hidden = !message;
  }

  function setBusy(form, busy) {
    if (!form) return;
    form.querySelectorAll("button, input").forEach(element => {
      element.disabled = Boolean(busy);
    });
    form.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function setText(element, value) {
    if (element) element.textContent = value == null ? "" : String(value);
  }

  function wait(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(date);
  }

  function authReturnUrl(kind = "confirm") {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("auth", kind);
    url.hash = "profile";
    return url.toString();
  }

  function friendlyError(error) {
    const raw = String(error?.message || error || "").trim();
    const message = raw.toLowerCase();
    if (!message) return "Operazione non riuscita. Riprova.";
    if (message.includes("invalid login credentials")) return "Email o password non corrette.";
    if (message.includes("email not confirmed")) return "Conferma prima l’indirizzo email dal messaggio ricevuto.";
    if (message.includes("password should be")) return "La password deve contenere almeno 8 caratteri.";
    if (message.includes("same password")) return "La nuova password deve essere diversa da quella attuale.";
    if (message.includes("user already registered")) return "Esiste già un account con questo indirizzo email.";
    if (message.includes("rate limit") || message.includes("too many requests")) return "Troppe richieste. Attendi qualche minuto e riprova.";
    if (message.includes("premium_active_profile_required")) return "L’account non è attivo e non può registrare nuove accettazioni.";
    if (message.includes("premium_staff_account_delete_blocked")) return "Un account staff attivo non può richiedere la cancellazione da questa schermata.";
    if (message.includes("premium_deletion_request_not_found")) return "Non risulta una richiesta di cancellazione da annullare.";
    if (message.includes("failed to fetch") || message.includes("network")) return "Connessione non disponibile. Controlla la rete e riprova.";
    return raw || "Operazione non riuscita. Riprova.";
  }

  function acceptanceMap(rows = []) {
    const granted = new Set((Array.isArray(rows) ? rows : [])
      .filter(item => item?.granted === true && !item?.revoked_at)
      .map(item => `${item.consent_type}:${item.version}`));
    return {
      terms: granted.has(`terms:${TERMS_VERSION}`),
      privacy: granted.has(`privacy:${PRIVACY_VERSION}`),
      cloud: granted.has(`cloud_storage:${CLOUD_VERSION}`),
    };
  }

  function acceptancesComplete(status) {
    return Boolean(status?.terms && status?.privacy && status?.cloud);
  }

  function accountStatusLabel(value) {
    return {
      active: "Attivo",
      suspended: "Sospeso",
      deletion_requested: "Cancellazione richiesta",
      deleted: "Eliminato",
    }[value] || value || "Non disponibile";
  }

  function showMode(mode) {
    if (recoveryMode) return;
    const login = mode === "login";
    if (state.loginForm) state.loginForm.hidden = !login;
    if (state.signupForm) state.signupForm.hidden = login;
    if (state.recoveryForm) state.recoveryForm.hidden = true;
    document.querySelectorAll("[data-auth-mode]").forEach(button => {
      const active = button.dataset.authMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    setMessage("", "");
  }

  function showRecoveryMode() {
    recoveryMode = true;
    if (state.authSignedOut) state.authSignedOut.hidden = false;
    if (state.authSignedIn) state.authSignedIn.hidden = true;
    document.querySelector(".auth-tabs")?.setAttribute("hidden", "");
    if (state.loginForm) state.loginForm.hidden = true;
    if (state.signupForm) state.signupForm.hidden = true;
    if (state.recoveryForm) state.recoveryForm.hidden = false;
    if (state.resendWrap) state.resendWrap.hidden = true;
    setMessage("info", "Inserisci una nuova password per completare il recupero dell’account.");
  }

  function leaveRecoveryMode() {
    recoveryMode = false;
    document.querySelector(".auth-tabs")?.removeAttribute("hidden");
    if (state.recoveryForm) state.recoveryForm.hidden = true;
    showMode("login");
  }

  function renderSignedOut() {
    accountLoadSequence += 1;
    currentSession = null;
    if (state.authSignedOut) state.authSignedOut.hidden = false;
    if (state.authSignedIn) state.authSignedIn.hidden = true;
    if (state.legalPanel) state.legalPanel.hidden = true;
    if (state.passwordPanel) state.passwordPanel.hidden = true;
    if (state.deletionPanel) state.deletionPanel.hidden = true;

    setText(state.profileKicker, "Area Premium");
    setText(state.profileTitle, "Account non collegato");
    setText(state.profileBadge, "ACCESSO");
    setText(state.profileDescription, "Accedi o crea un account per collegare il profilo Premium. Le funzioni cloud restano bloccate finché non esiste un abbonamento attivo.");
    setText(state.profileEmail, "Non collegato");
    setText(state.profileArchive, "Cloud non disponibile");
    setText(state.profileControls, "Non attivi");

    setText(state.homePlanName, "Premium");
    setText(state.homePlanStatus, "Account da collegare");
    setText(state.homePremiumBadge, "ACCESSO RICHIESTO");
    setText(state.homePremiumTitle, "Collega il tuo account");
    setText(state.homePremiumCopy, "Accedi dalla sezione Profilo. Archivio cloud e controlli professionali saranno disponibili soltanto con un abbonamento attivo.");
  }

  function renderLoading(session) {
    currentSession = session || null;
    if (state.authSignedOut) state.authSignedOut.hidden = true;
    if (state.authSignedIn) state.authSignedIn.hidden = false;
    setText(state.accountEmail, session?.user?.email || "Account collegato");
    setText(state.accountName, "Caricamento profilo…");
    setText(state.accountPlan, "Verifica in corso");
    setText(state.accountExpiry, "—");
    setText(state.accountStatus, "Aggiornamento in corso");
    setText(state.profileKicker, "Profilo Premium");
    setText(state.profileTitle, "Verifica account…");
    setText(state.profileBadge, "ATTENDI");
  }

  function subscriptionLabel(subscription) {
    if (!subscription) return "Nessun abbonamento";
    const labels = {
      pending: "In attesa",
      trialing: "Periodo di prova",
      active: "Attivo",
      past_due: "Pagamento da regolarizzare",
      paused: "In pausa",
      canceled: "Annullato",
      expired: "Scaduto"
    };
    return labels[subscription.status] || subscription.status || "Non attivo";
  }

  function renderLegalPanel(profile, acceptanceStatus) {
    if (!state.legalPanel) return;
    const complete = acceptancesComplete(acceptanceStatus);
    state.legalPanel.hidden = !profile;
    setText(state.legalStatus, complete
      ? "Termini, informativa e trattamento cloud/IA risultano accettati nella versione corrente."
      : "Per usare le funzioni operative Premium devi accettare le condizioni correnti. I dati già presenti restano consultabili e cancellabili.");
    if (state.legalAcceptButton) {
      state.legalAcceptButton.hidden = complete || profile?.account_status !== "active";
      state.legalAcceptButton.disabled = profile?.account_status !== "active";
    }
    state.legalPanel.classList.toggle("complete", complete);
  }

  function renderDeletionPanel(profile) {
    if (!state.deletionPanel) return;
    state.deletionPanel.hidden = !profile;
    const requested = profile?.account_status === "deletion_requested";
    setText(state.deletionStatus, requested
      ? `Richiesta registrata${profile.deletion_requested_at ? ` il ${formatDate(profile.deletion_requested_at)}` : ""}. Un amministratore dovrà completare la cancellazione dell’account e dei dati.`
      : "Puoi richiedere la cancellazione completa dell’account. La richiesta non elimina immediatamente i dati e può essere annullata finché non viene completata dallo staff.");
    if (state.deletionRequestButton) state.deletionRequestButton.hidden = requested;
    if (state.deletionCancelButton) state.deletionCancelButton.hidden = !requested;
  }

  async function fetchAccountData(userId) {
    const [profileResult, subscriptionResult, consentsResult] = await Promise.all([
      client
        .from("premium_profiles")
        .select("full_name, account_status, deletion_requested_at, deletion_request_reason")
        .eq("id", userId)
        .maybeSingle(),
      client
        .from("premium_subscriptions")
        .select("status, plan_code, current_period_end, included_utilities, included_bills_per_year, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      client
        .from("premium_consents")
        .select("consent_type, version, granted, revoked_at, recorded_at")
        .eq("user_id", userId)
        .in("consent_type", ["terms", "privacy", "cloud_storage"])
        .order("recorded_at", { ascending: false })
        .limit(50)
    ]);
    return { profileResult, subscriptionResult, consentsResult };
  }

  async function loadAccount(session, { retry = true } = {}) {
    const sequence = ++accountLoadSequence;
    if (!client || !session?.user) {
      renderSignedOut();
      return false;
    }

    renderLoading(session);

    const userId = session.user.id;
    let results = await fetchAccountData(userId);
    let hasError = Boolean(
      results.profileResult.error ||
      results.subscriptionResult.error ||
      results.consentsResult.error
    );

    if (hasError && retry) {
      setMessage("info", "Aggiornamento account in corso…");
      await wait(500);
      if (sequence !== accountLoadSequence) return false;
      results = await fetchAccountData(userId);
      hasError = Boolean(
        results.profileResult.error ||
        results.subscriptionResult.error ||
        results.consentsResult.error
      );
    }

    if (sequence !== accountLoadSequence) return false;
    if (hasError) {
      setText(state.accountStatus, "Aggiornamento non riuscito");
      setText(state.profileKicker, "Profilo Premium");
      setText(state.profileTitle, "Dati temporaneamente non disponibili");
      setText(state.profileBadge, "RIPROVA");
      setText(state.profileDescription, "Non è stato possibile aggiornare i dati dell’account. Ricarica la pagina o riprova tra poco.");
      setText(state.profileControls, "In attesa di aggiornamento");
      setMessage("error", "Non è stato possibile aggiornare i dati dell’account. Riprova.");
      return false;
    }

    const { profileResult, subscriptionResult, consentsResult } = results;
    const profile = profileResult.data;
    const subscription = subscriptionResult.data;
    const acceptanceStatus = acceptanceMap(consentsResult.data);
    const legalReady = acceptancesComplete(acceptanceStatus);
    const serviceActive = Boolean(
      profile?.account_status === "active" &&
      legalReady &&
      subscription &&
      ["trialing", "active"].includes(subscription.status) &&
      (!subscription.current_period_end || new Date(subscription.current_period_end) > new Date())
    );

    if (state.authSignedOut) state.authSignedOut.hidden = true;
    if (state.authSignedIn) state.authSignedIn.hidden = false;
    if (state.passwordPanel) state.passwordPanel.hidden = false;

    const displayName = String(profile?.full_name || session.user.user_metadata?.full_name || "").trim();
    setText(state.accountEmail, session.user.email || "—");
    setText(state.accountName, displayName || "Nome non indicato");
    setText(state.accountPlan, subscriptionLabel(subscription));
    setText(state.accountExpiry, subscription?.current_period_end ? formatDate(subscription.current_period_end) : "—");
    setText(state.accountStatus, accountStatusLabel(profile?.account_status));

    renderLegalPanel(profile, acceptanceStatus);
    renderDeletionPanel(profile);

    if (!profile) {
      setText(state.profileKicker, "Account collegato");
      setText(state.profileTitle, "Profilo Premium non abilitato");
      setText(state.profileBadge, "DA VERIFICARE");
      setText(state.profileDescription, "L’accesso email è valido, ma questo account non risulta registrato come profilo Premium.");
      setText(state.profileControls, "Non disponibili");
      setText(state.homePlanName, "Premium");
      setText(state.homePlanStatus, "Profilo da abilitare");
      setText(state.homePremiumBadge, "DA VERIFICARE");
      setText(state.homePremiumTitle, "Profilo non abilitato");
      setText(state.homePremiumCopy, "L’account è collegato, ma non è ancora associato all’area Premium.");
    } else if (profile.account_status === "deletion_requested") {
      setText(state.profileKicker, "Profilo Premium");
      setText(state.profileTitle, displayName || "Account Premium");
      setText(state.profileBadge, "CANCELLAZIONE");
      setText(state.profileDescription, "La cancellazione completa dell’account è stata richiesta. Puoi ancora consultare o rimuovere i dati archiviati finché lo staff non completa l’operazione.");
      setText(state.profileControls, "Nuove operazioni bloccate");
      setText(state.homePlanName, "Premium");
      setText(state.homePlanStatus, "Cancellazione richiesta");
      setText(state.homePremiumBadge, "IN ATTESA");
      setText(state.homePremiumTitle, "Richiesta di cancellazione registrata");
      setText(state.homePremiumCopy, "Le nuove operazioni sono bloccate. I dati già archiviati restano consultabili e cancellabili fino al completamento della richiesta.");
    } else if (!legalReady) {
      setText(state.profileKicker, "Profilo Premium");
      setText(state.profileTitle, displayName || "Account Premium");
      setText(state.profileBadge, "ACCETTAZIONE");
      setText(state.profileDescription, "L’account è collegato. Completa l’accettazione delle condizioni Premium correnti per attivare le funzioni operative.");
      setText(state.profileControls, "Accettazione richiesta");
      setText(state.homePlanName, "Premium");
      setText(state.homePlanStatus, "Condizioni da accettare");
      setText(state.homePremiumBadge, "AZIONE RICHIESTA");
      setText(state.homePremiumTitle, "Completa le condizioni Premium");
      setText(state.homePremiumCopy, "Apri il profilo e registra l’accettazione delle condizioni correnti prima di caricare nuove bollette.");
    } else if (serviceActive) {
      setText(state.profileKicker, "Profilo Premium");
      setText(state.profileTitle, displayName || "Account Premium");
      setText(state.profileBadge, subscription.status === "trialing" ? "PROVA" : "ATTIVO");
      setText(state.profileDescription, "Account collegato, condizioni correnti accettate e abbonamento valido. Archivio cloud, analisi automatica e controlli professionali sono attivi.");
      setText(state.profileControls, "Abbonamento attivo");
      setText(state.homePlanName, subscription.status === "trialing" ? "Prova Premium" : "Premium");
      setText(state.homePlanStatus, "Abbonamento attivo");
      setText(state.homePremiumBadge, subscription.status === "trialing" ? "PROVA ATTIVA" : "ATTIVO");
      setText(state.homePremiumTitle, "Account Premium collegato");
      setText(state.homePremiumCopy, "Archivio cloud e analisi automatica sono attivi. Il controllo umano viene proposto soltanto per anomalie o casi non conclusivi.");
    } else {
      setText(state.profileKicker, "Profilo Premium");
      setText(state.profileTitle, displayName || "Account Premium");
      setText(state.profileBadge, "NON ATTIVO");
      setText(state.profileDescription, "L’account è collegato. Le funzioni operative richiedono un abbonamento attivo; i dati già archiviati restano consultabili e cancellabili.");
      setText(state.profileControls, "Sola gestione dati");
      setText(state.homePlanName, "Premium");
      setText(state.homePlanStatus, "Abbonamento non attivo");
      setText(state.homePremiumBadge, "NON ATTIVO");
      setText(state.homePremiumTitle, "Account creato");
      setText(state.homePremiumCopy, "Il profilo è collegato. Senza abbonamento puoi gestire o eliminare i dati già archiviati, ma non caricare nuove bollette o richiedere controlli.");
    }

    setText(state.profileEmail, session.user.email || "—");
    setText(state.profileArchive, serviceActive ? "Cloud Premium attivo" : (profile ? "Archivio in sola gestione" : "Cloud non attivo"));
    return true;
  }

  async function handleLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(form.elements.email?.value || "").trim().toLowerCase();
    const password = String(form.elements.password?.value || "");

    if (!email || !password) {
      setMessage("error", "Inserisci email e password.");
      return;
    }

    setBusy(form, true);
    setMessage("info", "Accesso in corso…");
    const { error } = await client.auth.signInWithPassword({ email, password });
    setBusy(form, false);

    if (error) {
      setMessage("error", friendlyError(error));
      return;
    }

    form.reset();
    setMessage("success", "Accesso effettuato.");
  }

  async function handleSignup(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fullName = String(form.elements.full_name?.value || "").trim();
    const email = String(form.elements.email?.value || "").trim().toLowerCase();
    const password = String(form.elements.password?.value || "");
    const confirmPassword = String(form.elements.confirm_password?.value || "");
    const termsAccepted = Boolean(form.elements.accept_terms?.checked);
    const privacyAccepted = Boolean(form.elements.accept_privacy?.checked);
    const cloudAccepted = Boolean(form.elements.accept_cloud?.checked);

    if (fullName.length < 2) {
      setMessage("error", "Inserisci nome e cognome.");
      return;
    }
    if (!email) {
      setMessage("error", "Inserisci un indirizzo email valido.");
      return;
    }
    if (password.length < 8) {
      setMessage("error", "La password deve contenere almeno 8 caratteri.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("error", "Le due password non coincidono.");
      return;
    }
    if (!termsAccepted || !privacyAccepted || !cloudAccepted) {
      setMessage("error", "Per creare l’account Premium devi accettare tutte le condizioni obbligatorie indicate.");
      return;
    }

    setBusy(form, true);
    setMessage("info", "Creazione account in corso…");
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: authReturnUrl("confirm"),
        data: {
          offertalogica_product: "premium",
          full_name: fullName,
          premium_legal_acceptance: "accepted",
          premium_terms_version: TERMS_VERSION,
          premium_privacy_version: PRIVACY_VERSION,
          premium_cloud_version: CLOUD_VERSION,
        }
      }
    });
    setBusy(form, false);

    if (error) {
      setMessage("error", friendlyError(error));
      return;
    }

    try {
      localStorage.setItem(PENDING_EMAIL_KEY, email);
    } catch (_) {}

    if (data.session) {
      form.reset();
      setMessage("success", "Account creato e accesso effettuato.");
      return;
    }

    if (state.resendWrap) state.resendWrap.hidden = false;
    setMessage("success", "Account creato. Apri l’email ricevuta e conferma l’indirizzo prima di accedere.");
  }

  async function handleForgotPassword() {
    const email = String(state.loginForm?.elements.email?.value || "").trim().toLowerCase();
    if (!email) {
      setMessage("error", "Inserisci l’email dell’account nel modulo di accesso.");
      return;
    }
    const button = byId("premiumForgotPassword");
    if (button) button.disabled = true;
    setMessage("info", "Invio del link di recupero…");
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: authReturnUrl("recovery")
    });
    if (button) button.disabled = false;
    setMessage(error ? "error" : "success", error ? friendlyError(error) : "Link di recupero inviato. Controlla la casella email.");
  }

  async function handleRecoveryPassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const password = String(form.elements.password?.value || "");
    const confirmPassword = String(form.elements.confirm_password?.value || "");
    if (password.length < 8) {
      setMessage("error", "La password deve contenere almeno 8 caratteri.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("error", "Le due password non coincidono.");
      return;
    }
    setBusy(form, true);
    setMessage("info", "Aggiornamento password…");
    const { error } = await client.auth.updateUser({ password });
    if (!error) await client.auth.signOut();
    setBusy(form, false);
    if (error) {
      setMessage("error", friendlyError(error));
      return;
    }
    form.reset();
    leaveRecoveryMode();
    setMessage("success", "Password aggiornata. Accedi con la nuova password.");
  }

  async function handleChangePassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const password = String(form.elements.password?.value || "");
    const confirmPassword = String(form.elements.confirm_password?.value || "");
    if (password.length < 8) {
      setMessage("error", "La password deve contenere almeno 8 caratteri.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("error", "Le due password non coincidono.");
      return;
    }
    setBusy(form, true);
    passwordUpdateInProgress = true;
    setMessage("info", "Aggiornamento password…");
    const { error } = await client.auth.updateUser({ password });
    if (error) {
      passwordUpdateInProgress = false;
      setBusy(form, false);
      setMessage("error", friendlyError(error));
      return;
    }

    setMessage("info", "Aggiornamento account in corso…");
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    const refreshed = !sessionError && sessionData?.session
      ? await loadAccount(sessionData.session, { retry: true })
      : false;
    passwordUpdateInProgress = false;
    setBusy(form, false);

    if (!refreshed) {
      if (sessionError) setMessage("error", friendlyError(sessionError));
      return;
    }

    form.reset();
    form.hidden = true;
    setMessage("success", "Password aggiornata correttamente.");
  }

  async function handleLegalAcceptance() {
    if (!client || !currentSession?.user) return;
    const confirmed = window.confirm("Confermi di aver letto e accettato i Termini Premium, l’Informativa Premium e il trattamento cloud/IA necessario all’erogazione del servizio?");
    if (!confirmed) return;
    if (state.legalAcceptButton) state.legalAcceptButton.disabled = true;
    setMessage("info", "Registrazione delle accettazioni…");
    const { error } = await client.rpc("premium_accept_current_terms", {
      p_proof: {
        page: window.location.pathname,
        user_agent: navigator.userAgent.slice(0, 500),
        terms_version: TERMS_VERSION,
        privacy_version: PRIVACY_VERSION,
        cloud_version: CLOUD_VERSION,
      }
    });
    if (state.legalAcceptButton) state.legalAcceptButton.disabled = false;
    if (error) {
      setMessage("error", friendlyError(error));
      return;
    }
    setMessage("success", "Condizioni Premium registrate.");
    window.setTimeout(() => window.location.reload(), 500);
  }

  async function handleDeletionRequest() {
    if (!client || !currentSession?.user) return;
    const confirmation = window.prompt("La richiesta bloccherà nuove operazioni Premium. Scrivi CANCELLA per registrarla.");
    if (confirmation !== "CANCELLA") return;
    const reason = window.prompt("Motivo facoltativo della richiesta (massimo 500 caratteri):") || "";
    if (state.deletionRequestButton) state.deletionRequestButton.disabled = true;
    setMessage("info", "Registrazione richiesta di cancellazione…");
    const { error } = await client.rpc("premium_request_account_deletion", { p_reason: reason.slice(0, 500) });
    if (state.deletionRequestButton) state.deletionRequestButton.disabled = false;
    if (error) {
      setMessage("error", friendlyError(error));
      return;
    }
    setMessage("success", "Richiesta di cancellazione registrata.");
    window.setTimeout(() => window.location.reload(), 500);
  }

  async function handleDeletionCancel() {
    if (!client || !currentSession?.user) return;
    if (!window.confirm("Annullare la richiesta di cancellazione dell’account?")) return;
    if (state.deletionCancelButton) state.deletionCancelButton.disabled = true;
    setMessage("info", "Annullamento richiesta…");
    const { error } = await client.rpc("premium_cancel_account_deletion_request");
    if (state.deletionCancelButton) state.deletionCancelButton.disabled = false;
    if (error) {
      setMessage("error", friendlyError(error));
      return;
    }
    setMessage("success", "Richiesta di cancellazione annullata.");
    window.setTimeout(() => window.location.reload(), 500);
  }

  async function handleResend() {
    let email = "";
    try {
      email = localStorage.getItem(PENDING_EMAIL_KEY) || "";
    } catch (_) {}
    if (!email) {
      email = String(state.signupForm?.elements.email?.value || "").trim().toLowerCase();
    }
    if (!email) {
      setMessage("error", "Inserisci prima l’indirizzo email nel modulo di registrazione.");
      return;
    }

    const button = byId("premiumResendConfirmation");
    if (button) button.disabled = true;
    setMessage("info", "Invio nuova email di conferma…");
    const { error } = await client.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: authReturnUrl("confirm") }
    });
    if (button) button.disabled = false;

    setMessage(error ? "error" : "success", error ? friendlyError(error) : "Email di conferma inviata nuovamente.");
  }

  async function handleSignOut() {
    const button = byId("premiumSignOut");
    if (button) button.disabled = true;
    setMessage("info", "Disconnessione…");
    const { error } = await client.auth.signOut();
    if (button) button.disabled = false;
    if (error) {
      setMessage("error", friendlyError(error));
      return;
    }
    setMessage("success", "Account disconnesso.");
  }

  function collectElements() {
    state.loginForm = byId("premiumLoginForm");
    state.signupForm = byId("premiumSignupForm");
    state.recoveryForm = byId("premiumRecoveryForm");
    state.changePasswordForm = byId("premiumChangePasswordForm");
    state.authSignedOut = byId("premiumAuthSignedOut");
    state.authSignedIn = byId("premiumAuthSignedIn");
    state.authMessage = byId("premiumAuthMessage");
    state.resendWrap = byId("premiumResendWrap");
    state.accountEmail = byId("premiumAccountEmail");
    state.accountName = byId("premiumAccountName");
    state.accountPlan = byId("premiumAccountPlan");
    state.accountExpiry = byId("premiumAccountExpiry");
    state.accountStatus = byId("premiumAccountStatus");
    state.profileKicker = byId("profileAccountKicker");
    state.profileTitle = byId("profileAccountTitle");
    state.profileBadge = byId("profileAccountBadge");
    state.profileDescription = byId("profileAccountDescription");
    state.profileEmail = byId("profileAccountEmail");
    state.profileArchive = byId("profileAccountArchive");
    state.profileControls = byId("profileAccountControls");
    state.homePlanName = byId("homePlanName");
    state.homePlanStatus = byId("homePlanStatus");
    state.homePremiumBadge = byId("homePremiumBadge");
    state.homePremiumTitle = byId("homePremiumTitle");
    state.homePremiumCopy = byId("homePremiumCopy");
    state.legalPanel = byId("premiumLegalPanel");
    state.legalStatus = byId("premiumLegalStatus");
    state.legalAcceptButton = byId("premiumLegalAccept");
    state.deletionPanel = byId("premiumDeletionPanel");
    state.deletionStatus = byId("premiumDeletionStatus");
    state.deletionRequestButton = byId("premiumDeletionRequest");
    state.deletionCancelButton = byId("premiumDeletionCancel");
    state.passwordPanel = byId("premiumPasswordPanel");
    state.passwordToggle = byId("premiumPasswordToggle");
  }

  function init() {
    if (initialized) return;
    initialized = true;
    collectElements();

    if (!globalThis.supabase?.createClient) {
      renderSignedOut();
      setMessage("error", "Il collegamento sicuro a Supabase non è disponibile. Ricarica la pagina con una connessione attiva.");
      return;
    }

    client = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        storageKey: STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce"
      }
    });

    document.querySelectorAll("[data-auth-mode]").forEach(button => {
      button.addEventListener("click", () => showMode(button.dataset.authMode));
    });
    state.loginForm?.addEventListener("submit", handleLogin);
    state.signupForm?.addEventListener("submit", handleSignup);
    state.recoveryForm?.addEventListener("submit", handleRecoveryPassword);
    state.changePasswordForm?.addEventListener("submit", handleChangePassword);
    byId("premiumForgotPassword")?.addEventListener("click", handleForgotPassword);
    byId("premiumResendConfirmation")?.addEventListener("click", handleResend);
    byId("premiumSignOut")?.addEventListener("click", handleSignOut);
    state.legalAcceptButton?.addEventListener("click", handleLegalAcceptance);
    state.deletionRequestButton?.addEventListener("click", handleDeletionRequest);
    state.deletionCancelButton?.addEventListener("click", handleDeletionCancel);
    state.passwordToggle?.addEventListener("click", () => {
      if (!state.changePasswordForm) return;
      state.changePasswordForm.hidden = !state.changePasswordForm.hidden;
      if (!state.changePasswordForm.hidden) state.changePasswordForm.elements.password?.focus();
    });

    authSubscription = client.auth.onAuthStateChange((event, session) => {
      window.setTimeout(() => {
        if (event === "PASSWORD_RECOVERY") {
          currentSession = session || null;
          showRecoveryMode();
          return;
        }
        if (event === "SIGNED_OUT") renderSignedOut();
        else if (passwordUpdateInProgress && ["TOKEN_REFRESHED", "USER_UPDATED"].includes(event)) {
          currentSession = session || currentSession;
        } else if (["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"].includes(event)) loadAccount(session);
      }, 0);
    });

    window.addEventListener("pagehide", () => {
      authSubscription?.data?.subscription?.unsubscribe?.();
    }, { once: true });

    showMode("login");
    renderSignedOut();
  }

  globalThis.OffertaLogicaPremiumAuth = Object.freeze({
    init,
    getClient: () => client,
    versions: Object.freeze({ terms: TERMS_VERSION, privacy: PRIVACY_VERSION, cloud: CLOUD_VERSION })
  });
})();
