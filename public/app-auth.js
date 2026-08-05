(() => {
  "use strict";

  const SUPABASE_URL = "https://kzxdamhfmzaxonpkytcf.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_poz1xBKiXceLCFV3u_tPIg_5_-ycHcl";
  const STORAGE_KEY = "offertalogica-premium-auth";
  const PENDING_EMAIL_KEY = "offertalogica-premium-pending-email";
  const TERMS_VERSION = "premium-terms-v0.36.7-2026-08-04";
  const PRIVACY_VERSION = "premium-privacy-v0.36.6-2026-08-04";
  const CLOUD_VERSION = "premium-cloud-ai-v0.36.6-2026-08-04";
  const BILLING_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/premium-billing`;

  let client = null;
  let initialized = false;
  let authSubscription = null;
  let recoveryMode = false;
  let currentSession = null;
  let accountLoadSequence = 0;
  let passwordUpdateInProgress = false;
  let billingAvailability = { enabled: false, provider: "stripe", missing: [] };
  let billingConfirmAction = null;
  let billingReturnHandled = false;

  const byId = id => document.getElementById(id);

  const state = {
    loginForm: null,
    signupForm: null,
    recoveryForm: null,
    changePasswordForm: null,
    authSignedOut: null,
    authSignedIn: null,
    authCard: null,
    profileSummary: null,
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
    subscriptionPanel: null,
    subscriptionBadge: null,
    subscriptionStatus: null,
    subscriptionPeriod: null,
    subscriptionCurrentPrice: null,
    subscriptionNextPrice: null,
    subscriptionRenewal: null,
    subscriptionActionCopy: null,
    subscriptionPurchaseButton: null,
    subscriptionManageButton: null,
    subscriptionCancelButton: null,
    subscriptionResumeButton: null,
    billingMessage: null,
    billingConfirm: null,
    billingConfirmTitle: null,
    billingConfirmCopy: null,
    billingConfirmBack: null,
    billingConfirmApply: null,
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

  function setBillingMessage(kind, message) {
    if (!state.billingMessage) return;
    state.billingMessage.className = `billing-inline-message${kind === "error" ? " error" : ""}`;
    state.billingMessage.textContent = message || "";
    state.billingMessage.hidden = !message;
  }

  function billingErrorMessage(error) {
    const message = String(error?.message || error || "").toLowerCase();
    if (message.includes("premium_billing_not_enabled")) return "Il pagamento è ancora in configurazione.";
    if (message.includes("premium_legal_acceptance_required")) return "Accetta prima le condizioni commerciali correnti.";
    if (message.includes("premium_subscription_already_active")) return "L’abbonamento risulta già attivo.";
    if (message.includes("premium_billing_customer_missing")) return "Il profilo di pagamento non è ancora disponibile.";
    if (message.includes("authentication")) return "La sessione è scaduta. Accedi nuovamente.";
    if (message.includes("stripe:")) return "Stripe non ha completato l’operazione. Riprova tra poco.";
    return "Operazione di pagamento non completata. Riprova.";
  }

  async function billingRequest(action, payload = {}) {
    if (!client) throw new Error("authentication_required");
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session?.access_token) throw new Error("authentication_required");
    const response = await fetch(BILLING_FUNCTION_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${data.session.access_token}`
      },
      body: JSON.stringify({ action, ...payload })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok === false) throw new Error(result?.error || `billing_http_${response.status}`);
    return result;
  }

  async function loadBillingAvailability() {
    try {
      const result = await billingRequest("status");
      billingAvailability = {
        enabled: Boolean(result.enabled),
        provider: result.provider || "stripe",
        missing: Array.isArray(result.missing) ? result.missing : []
      };
    } catch {
      billingAvailability = { enabled: false, provider: "stripe", missing: ["EDGE_FUNCTION"] };
    }
    return billingAvailability;
  }

  function hideBillingConfirmation() {
    billingConfirmAction = null;
    if (state.billingConfirm) state.billingConfirm.hidden = true;
  }

  function showBillingConfirmation(action) {
    billingConfirmAction = action;
    if (!state.billingConfirm) return;
    const cancel = action === "cancel";
    setText(state.billingConfirmTitle, cancel ? "Disattiva rinnovo automatico" : "Riattiva rinnovo automatico");
    setText(state.billingConfirmCopy, cancel
      ? "Premium resterà attivo fino alla scadenza del periodo già pagato. Non verrà effettuato il prossimo addebito annuale."
      : "Il rinnovo annuale verrà riattivato al prezzo previsto per la prossima scadenza.");
    setText(state.billingConfirmApply, cancel ? "DISATTIVA RINNOVO" : "RIATTIVA RINNOVO");
    state.billingConfirmApply?.classList.toggle("danger", cancel);
    state.billingConfirm.hidden = false;
    state.billingConfirmApply?.focus();
  }

  function renderBillingActions(subscription) {
    const configured = Boolean(billingAvailability?.enabled);
    const status = subscription?.status || "";
    const paidProvider = subscription?.provider === "stripe" && Boolean(subscription?.provider_customer_id);
    const paidHistory = Boolean(subscription?.first_paid_at || subscription?.provider_subscription_id);
    const canPurchase = ["trialing", "expired", "canceled", "pending"].includes(status);
    const introUsed = Boolean(subscription?.first_paid_at || subscription?.intro_price_redeemed_at);

    if (state.subscriptionPurchaseButton) {
      state.subscriptionPurchaseButton.hidden = !canPurchase;
      state.subscriptionPurchaseButton.disabled = !configured;
      state.subscriptionPurchaseButton.textContent = introUsed
        ? "RIATTIVA PREMIUM PER 59,88 €"
        : "ACQUISTA PREMIUM PER 49,90 €";
      state.subscriptionPurchaseButton.title = configured ? "" : "Pagamento Stripe non ancora attivato";
    }
    if (state.subscriptionManageButton) {
      state.subscriptionManageButton.hidden = !(paidProvider && paidHistory && ["active", "past_due", "paused", "canceled"].includes(status));
      state.subscriptionManageButton.disabled = !configured;
    }
    if (state.subscriptionCancelButton) {
      state.subscriptionCancelButton.hidden = !(status === "active" && paidProvider && !subscription.cancel_at_period_end);
      state.subscriptionCancelButton.disabled = !configured;
    }
    if (state.subscriptionResumeButton) {
      state.subscriptionResumeButton.hidden = !(status === "active" && paidProvider && subscription.cancel_at_period_end);
      state.subscriptionResumeButton.disabled = !configured;
    }
    hideBillingConfirmation();
  }

  function showAccountPanels({ signedIn = false } = {}) {
    if (state.profileSummary) state.profileSummary.hidden = !signedIn;
    if (state.authCard) state.authCard.hidden = signedIn;
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

  function formatMoneyCents(value, currency = "eur") {
    const cents = Number(value);
    if (!Number.isFinite(cents)) return "";
    try {
      return new Intl.NumberFormat("it-IT", { style: "currency", currency: String(currency || "eur").toUpperCase() }).format(cents / 100);
    } catch {
      return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
    }
  }

  function trialDaysRemaining(subscription) {
    if (subscription?.status !== "trialing" || subscription?.plan_code !== "premium-beta" || !subscription.current_period_end) return null;
    const end = new Date(subscription.current_period_end);
    if (Number.isNaN(end.getTime())) return null;
    return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86_400_000));
  }

  function archiveDaysRemaining(subscription) {
    if (!subscription?.archive_access_until || subscription?.data_purged_at) return null;
    const end = new Date(subscription.archive_access_until);
    if (Number.isNaN(end.getTime())) return null;
    return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86_400_000));
  }

  function subscriptionPeriodIsActive(subscription) {
    if (!subscription || !["trialing", "active"].includes(subscription.status)) return false;
    if (!subscription.current_period_end) return true;
    const end = new Date(subscription.current_period_end);
    return !Number.isNaN(end.getTime()) && end > new Date();
  }

  function archiveIsAvailable(profile, subscription) {
    if (!profile || !["active", "deletion_requested"].includes(profile.account_status)) return false;
    if (!subscription || subscription.data_purged_at || !subscription.archive_access_until) return false;
    const end = new Date(subscription.archive_access_until);
    return !Number.isNaN(end.getTime()) && end > new Date();
  }

  async function refreshTrialLifecycle() {
    const { error } = await client.rpc("premium_refresh_trial_lifecycle");
    if (!error) return true;
    const message = String(error.message || error || "").toLowerCase();
    if (message.includes("premium_refresh_trial_lifecycle") || message.includes("schema cache") || message.includes("function")) return false;
    throw error;
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
    showAccountPanels({ signedIn: false });
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
    showAccountPanels({ signedIn: false });
    currentSession = null;
    if (state.authSignedOut) state.authSignedOut.hidden = false;
    if (state.authSignedIn) state.authSignedIn.hidden = true;
    if (state.legalPanel) state.legalPanel.hidden = true;
    if (state.subscriptionPanel) state.subscriptionPanel.hidden = true;
    if (state.passwordPanel) state.passwordPanel.hidden = true;
    if (state.deletionPanel) state.deletionPanel.hidden = true;
    setBillingMessage("", "");
    hideBillingConfirmation();

    setText(state.profileKicker, "Area Premium");
    setText(state.profileTitle, "Account non collegato");
    setText(state.profileBadge, "ACCESSO");
    setText(state.profileDescription, "Accedi o crea un account.");
    setText(state.profileEmail, "Non collegato");
    setText(state.profileArchive, "Cloud non disponibile");
    setText(state.profileControls, "Non attivi");

    setText(state.homePlanName, "Premium");
    setText(state.homePlanStatus, "Account da collegare");
    setText(state.homePremiumBadge, "ACCESSO RICHIESTO");
    setText(state.homePremiumTitle, "Collega il tuo account");
    setText(state.homePremiumCopy, "Accedi dal Profilo per usare il servizio Premium.");
  }

  function renderLoading(session) {
    currentSession = session || null;
    showAccountPanels({ signedIn: true });
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
    if (subscription.plan_code === "premium-complimentary") {
      return subscription.status === "active" ? "Premium omaggio" : "Premium omaggio scaduto";
    }
    const labels = {
      pending: "In attesa",
      trialing: "Prova gratuita di 30 giorni",
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
      ? "Condizioni e informativa accettate."
      : "Accetta le condizioni correnti per continuare. I dati già salvati restano disponibili.");
    if (state.legalAcceptButton) {
      state.legalAcceptButton.hidden = complete || profile?.account_status !== "active";
      state.legalAcceptButton.disabled = profile?.account_status !== "active";
    }
    state.legalPanel.classList.toggle("complete", complete);
  }

  function renderSubscriptionPanel(profile, subscription) {
    if (!state.subscriptionPanel) return;
    state.subscriptionPanel.hidden = !profile;
    if (!profile) return;
    renderBillingActions(subscription);

    const start = formatDate(subscription?.current_period_start);
    const end = formatDate(subscription?.current_period_end);
    const annualFirst = "49,90 € IVA inclusa per 12 mesi";
    const annualRenewal = "59,88 € IVA inclusa all’anno";

    if (!subscription) {
      setText(state.subscriptionBadge, "NON ATTIVO");
      setText(state.subscriptionStatus, "Non risulta un piano Premium associato all’account.");
      setText(state.subscriptionPeriod, "—");
      setText(state.subscriptionCurrentPrice, "Nessun addebito");
      setText(state.subscriptionNextPrice, annualFirst);
      setText(state.subscriptionRenewal, "Non attivo");
      setText(state.subscriptionActionCopy, "Nessun pagamento o rinnovo è stato attivato.");
      return;
    }

    const period = subscription.current_period_start && subscription.current_period_end
      ? `${start} – ${end}`
      : (subscription.current_period_end
        ? `Fino al ${end}`
        : (subscription.plan_code === "premium-complimentary" && subscription.current_period_start ? `Dal ${start} · senza scadenza` : "—"));
    setText(state.subscriptionPeriod, period);

    if (subscription.status === "trialing" && subscription.plan_code === "premium-beta") {
      const days = trialDaysRemaining(subscription);
      setText(state.subscriptionBadge, "PROVA");
      setText(state.subscriptionStatus, `Prova gratuita attiva${days == null ? "" : `: ${days} ${days === 1 ? "giorno rimanente" : "giorni rimanenti"}`}.`);
      setText(state.subscriptionCurrentPrice, "0 € · nessuna carta richiesta");
      setText(state.subscriptionNextPrice, annualFirst);
      setText(state.subscriptionRenewal, "Nessuna conversione automatica");
      setText(state.subscriptionActionCopy, `Alla scadenza non verrà effettuato alcun addebito. L’eventuale acquisto sarà una scelta separata; dal rinnovo successivo il prezzo sarà ${annualRenewal}.`);
      return;
    }

    if (subscription.status === "active" && subscription.plan_code === "premium-complimentary") {
      const unlimited = !subscription.current_period_end;
      setText(state.subscriptionBadge, "OMAGGIO");
      setText(state.subscriptionStatus, unlimited
        ? "Premium offerto da OffertaLogica senza scadenza."
        : `Premium offerto da OffertaLogica fino al ${end}.`);
      setText(state.subscriptionCurrentPrice, "0 € · offerto da OffertaLogica");
      setText(state.subscriptionNextPrice, "Nessun pagamento previsto");
      setText(state.subscriptionRenewal, "Nessun rinnovo automatico");
      setText(state.subscriptionActionCopy, unlimited
        ? "Il piano resta attivo finché OffertaLogica non lo revoca."
        : "Alla scadenza non verrà effettuato alcun addebito. L’eventuale acquisto sarà sempre una scelta separata.");
      return;
    }

    if (subscription.status === "active") {
      const renewalOff = Boolean(subscription.cancel_at_period_end);
      setText(state.subscriptionBadge, renewalOff ? "RINNOVO DISATTIVATO" : "ATTIVO");
      setText(state.subscriptionStatus, renewalOff
        ? `Premium resta attivo fino al ${end}; alla scadenza non verrà effettuato un nuovo addebito.`
        : "Abbonamento Premium annuale attivo.");
      setText(state.subscriptionCurrentPrice, formatMoneyCents(subscription.latest_amount_paid_cents, subscription.latest_currency) || "Piano annuale Premium");
      setText(state.subscriptionNextPrice, annualRenewal);
      setText(state.subscriptionRenewal, renewalOff ? `Disattivato · servizio fino al ${end}` : `Automatico annuale · prossima scadenza ${end}`);
      setText(state.subscriptionActionCopy, "Puoi gestire il metodo di pagamento e disattivare o riattivare il rinnovo annuale direttamente da questa sezione.");
      return;
    }

    if (subscription.status === "expired") {
      const complimentary = subscription.plan_code === "premium-complimentary";
      setText(state.subscriptionBadge, complimentary ? "OMAGGIO TERMINATO" : "PROVA TERMINATA");
      setText(state.subscriptionStatus, complimentary
        ? "Il periodo Premium offerto da OffertaLogica è terminato."
        : "La prova gratuita è terminata e non è stato effettuato alcun addebito.");
      setText(state.subscriptionCurrentPrice, "0 €");
      setText(state.subscriptionNextPrice, annualFirst);
      setText(state.subscriptionRenewal, "Non attivo");
      setText(state.subscriptionActionCopy, complimentary
        ? "L’archivio resta disponibile secondo il periodo di conservazione indicato. L’eventuale acquisto sarà una scelta separata."
        : `L’archivio resta disponibile secondo il periodo di conservazione indicato. Dal secondo anno il prezzo previsto è ${annualRenewal}.`);
      return;
    }

    if (subscription.status === "canceled") {
      setText(state.subscriptionBadge, "ANNULLATO");
      setText(state.subscriptionStatus, "L’abbonamento non si rinnoverà.");
      setText(state.subscriptionCurrentPrice, "Periodo già pagato");
      setText(state.subscriptionNextPrice, "Nessun nuovo addebito");
      setText(state.subscriptionRenewal, "Disattivato");
      setText(state.subscriptionActionCopy, subscription.current_period_end ? `Il servizio resta disponibile fino al ${end}.` : "Il servizio non è attivo.");
      return;
    }

    if (subscription.status === "past_due") {
      setText(state.subscriptionBadge, "PAGAMENTO");
      setText(state.subscriptionStatus, "Il pagamento richiede una verifica.");
      setText(state.subscriptionCurrentPrice, "Da regolarizzare");
      setText(state.subscriptionNextPrice, annualRenewal);
      setText(state.subscriptionRenewal, "Sospeso fino alla regolarizzazione");
      setText(state.subscriptionActionCopy, "Apri la gestione del pagamento per aggiornare il metodo utilizzato e regolarizzare l’abbonamento.");
      return;
    }

    setText(state.subscriptionBadge, "NON ATTIVO");
    setText(state.subscriptionStatus, subscriptionLabel(subscription));
    setText(state.subscriptionCurrentPrice, "Nessun nuovo addebito");
    setText(state.subscriptionNextPrice, annualFirst);
    setText(state.subscriptionRenewal, "Non attivo");
    setText(state.subscriptionActionCopy, "La prova gratuita non si trasforma automaticamente in abbonamento.");
  }

  function renderDeletionPanel(profile) {
    if (!state.deletionPanel) return;
    state.deletionPanel.hidden = !profile;
    const requested = profile?.account_status === "deletion_requested";
    setText(state.deletionStatus, requested
      ? `Richiesta registrata${profile.deletion_requested_at ? ` il ${formatDate(profile.deletion_requested_at)}` : ""}. Un amministratore dovrà completare la cancellazione dell’account e dei dati.`
      : "Puoi richiedere la cancellazione dell’account e annullarla finché non viene completata.");
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
        .select("status, plan_code, provider, provider_customer_id, provider_subscription_id, current_period_start, current_period_end, archive_access_until, data_purged_at, included_utilities, included_bills_per_year, cancel_at_period_end, first_paid_at, intro_price_redeemed_at, latest_amount_paid_cents, latest_currency, latest_payment_at, complimentary_granted_at, complimentary_reason, complimentary_revoked_at, created_at")
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

  async function ensureCurrentUserPremiumProfile(profile) {
    if (profile) return false;
    const { error } = await client.rpc("premium_ensure_current_user_profile");
    if (error) {
      const message = String(error.message || error || "").toLowerCase();
      if (!message.includes("premium_ensure_current_user_profile") && !message.includes("function") && !message.includes("schema cache")) {
        setMessage("error", friendlyError(error));
      }
      return false;
    }
    return true;
  }

  async function activateBetaTrialIfEligible(profile, subscription, acceptanceStatus) {
    if (!profile || profile.account_status !== "active" || subscription || !acceptancesComplete(acceptanceStatus)) return false;
    const { error } = await client.rpc("premium_activate_beta_trial");
    if (error) {
      const message = String(error.message || error || "").toLowerCase();
      if (!message.includes("premium_activate_beta_trial") && !message.includes("function") && !message.includes("schema cache")) {
        setMessage("error", friendlyError(error));
      }
      return false;
    }
    return true;
  }

  async function loadAccount(session, { retry = true } = {}) {
    const sequence = ++accountLoadSequence;
    if (!client || !session?.user) {
      renderSignedOut();
      return false;
    }

    renderLoading(session);

    const userId = session.user.id;
    try {
      await refreshTrialLifecycle();
    } catch (error) {
      setMessage("info", "Lo stato della prova non è stato aggiornato. Ricarica la pagina se la scadenza non risulta corretta.");
    }
    if (sequence !== accountLoadSequence) return false;
    await loadBillingAvailability();
    if (sequence !== accountLoadSequence) return false;
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
      setText(state.profileDescription, "Impossibile aggiornare l’account. Ricarica la pagina.");
      setText(state.profileControls, "In attesa di aggiornamento");
      setMessage("error", "Non è stato possibile aggiornare i dati dell’account. Riprova.");
      return false;
    }

    let { profileResult, subscriptionResult, consentsResult } = results;
    let profile = profileResult.data;
    let subscription = subscriptionResult.data;
    let acceptanceStatus = acceptanceMap(consentsResult.data);

    if (await ensureCurrentUserPremiumProfile(profile)) {
      results = await fetchAccountData(userId);
      if (sequence !== accountLoadSequence) return false;
      if (results.profileResult.error || results.subscriptionResult.error || results.consentsResult.error) {
        setMessage("error", "Profilo Premium associato, ma i dati dell’account non sono ancora disponibili. Ricarica la pagina.");
        return false;
      }
      ({ profileResult, subscriptionResult, consentsResult } = results);
      profile = profileResult.data;
      subscription = subscriptionResult.data;
      acceptanceStatus = acceptanceMap(consentsResult.data);
      window.dispatchEvent(new CustomEvent("offertalogica:premium-access-changed"));
    }

    if (await activateBetaTrialIfEligible(profile, subscription, acceptanceStatus)) {
      results = await fetchAccountData(userId);
      if (sequence !== accountLoadSequence) return false;
      if (results.profileResult.error || results.subscriptionResult.error || results.consentsResult.error) {
        setMessage("error", "Accesso beta attivato, ma i dati dell’account non sono ancora disponibili. Ricarica la pagina.");
        return false;
      }
      ({ profileResult, subscriptionResult, consentsResult } = results);
      profile = profileResult.data;
      subscription = subscriptionResult.data;
      acceptanceStatus = acceptanceMap(consentsResult.data);
      window.dispatchEvent(new CustomEvent("offertalogica:premium-access-changed"));
    }

    const legalReady = acceptancesComplete(acceptanceStatus);
    const periodActive = subscriptionPeriodIsActive(subscription);
    const serviceActive = Boolean(profile?.account_status === "active" && legalReady && periodActive);
    const archiveAvailable = archiveIsAvailable(profile, subscription) && !periodActive;
    const archiveDays = archiveDaysRemaining(subscription);

    if (state.authSignedOut) state.authSignedOut.hidden = true;
    if (state.authSignedIn) state.authSignedIn.hidden = false;
    if (state.passwordPanel) state.passwordPanel.hidden = false;

    const displayName = String(profile?.full_name || session.user.user_metadata?.full_name || "").trim();
    setText(state.accountEmail, session.user.email || "—");
    setText(state.accountName, displayName || "Nome non indicato");
    setText(state.accountPlan, subscriptionLabel(subscription));
    setText(state.accountExpiry, archiveAvailable ? formatDate(subscription.archive_access_until) : (subscription?.current_period_end ? formatDate(subscription.current_period_end) : "—"));
    setText(state.accountStatus, accountStatusLabel(profile?.account_status));

    renderLegalPanel(profile, acceptanceStatus);
    renderSubscriptionPanel(profile, subscription);
    renderDeletionPanel(profile);
    handleBillingReturn();

    if (!profile) {
      setText(state.profileKicker, "Account collegato");
      setText(state.profileTitle, "Profilo Premium non abilitato");
      setText(state.profileBadge, "DA VERIFICARE");
      setText(state.profileDescription, "Questo account non è abilitato al servizio Premium.");
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
      setText(state.profileDescription, "Cancellazione richiesta. Puoi ancora consultare o eliminare i dati salvati.");
      setText(state.profileControls, "Nuove operazioni bloccate");
      setText(state.homePlanName, "Premium");
      setText(state.homePlanStatus, "Cancellazione richiesta");
      setText(state.homePremiumBadge, "IN ATTESA");
      setText(state.homePremiumTitle, "Richiesta di cancellazione registrata");
      setText(state.homePremiumCopy, "Nuove operazioni bloccate. I dati salvati restano disponibili.");
    } else if (periodActive && !legalReady) {
      setText(state.profileKicker, "Profilo Premium");
      setText(state.profileTitle, displayName || "Account Premium");
      setText(state.profileBadge, "ACCETTAZIONE");
      setText(state.profileDescription, "Accetta le condizioni correnti per continuare.");
      setText(state.profileControls, "Accettazione richiesta");
      setText(state.homePlanName, "Premium");
      setText(state.homePlanStatus, "Condizioni da accettare");
      setText(state.homePremiumBadge, "AZIONE RICHIESTA");
      setText(state.homePremiumTitle, "Completa le condizioni Premium");
      setText(state.homePremiumCopy, "Accetta le condizioni dal Profilo prima di caricare nuove bollette.");
    } else if (serviceActive) {
      const trialDays = trialDaysRemaining(subscription);
      const isBetaTrial = subscription.status === "trialing" && subscription.plan_code === "premium-beta";
      const isComplimentary = subscription.status === "active" && subscription.plan_code === "premium-complimentary";
      const complimentaryEnd = subscription.current_period_end ? formatDate(subscription.current_period_end) : "";
      setText(state.profileKicker, "Profilo Premium");
      setText(state.profileTitle, displayName || "Account Premium");
      setText(state.profileBadge, isBetaTrial ? "PROVA" : (isComplimentary ? "OMAGGIO" : "ATTIVO"));
      setText(state.profileDescription, isBetaTrial
        ? `Prova gratuita attiva${trialDays == null ? "" : `. ${trialDays} ${trialDays === 1 ? "giorno rimanente" : "giorni rimanenti"}.`}`
        : (isComplimentary
          ? (complimentaryEnd ? `Premium offerto da OffertaLogica fino al ${complimentaryEnd}.` : "Premium offerto da OffertaLogica senza scadenza.")
          : "Servizio Premium attivo."));
      setText(state.profileControls, isBetaTrial ? "4 bollette · 1 controllo staff" : (isComplimentary ? "Premium completo · nessun pagamento" : "Abbonamento attivo"));
      setText(state.homePlanName, isBetaTrial ? "Prova Premium" : (isComplimentary ? "Premium omaggio" : "Premium"));
      setText(state.homePlanStatus, isBetaTrial && trialDays != null
        ? `${trialDays} ${trialDays === 1 ? "giorno rimanente" : "giorni rimanenti"}`
        : (isComplimentary ? (complimentaryEnd ? `Attivo fino al ${complimentaryEnd}` : "Senza scadenza") : "Abbonamento attivo"));
      setText(state.homePremiumBadge, isBetaTrial ? "PROVA ATTIVA" : (isComplimentary ? "OMAGGIO" : "ATTIVO"));
      setText(state.homePremiumTitle, isBetaTrial ? "Prova Premium attiva" : (isComplimentary ? "Premium offerto da OffertaLogica" : "Account Premium collegato"));
      setText(state.homePremiumCopy, isBetaTrial
        ? "Fino a 4 bollette complessivamente caricate e una verifica staff per un’anomalia rossa. Eliminare una bolletta non libera un nuovo caricamento. Nessuna carta e nessun addebito automatico."
        : (isComplimentary
          ? "Tutte le funzioni Premium sono attive senza pagamento e senza rinnovo automatico."
          : "Servizio attivo. La verifica dello staff è disponibile solo per anomalie rosse."));
    } else if (archiveAvailable) {
      const archiveDate = formatDate(subscription.archive_access_until);
      const remainingCopy = archiveDays == null
        ? ""
        : ` Mancano ${archiveDays} ${archiveDays === 1 ? "giorno" : "giorni"} al termine della conservazione.`;
      setText(state.profileKicker, "Archivio Premium");
      setText(state.profileTitle, displayName || "Account Premium");
      setText(state.profileBadge, archiveDays != null && archiveDays <= 7 ? "SCADENZA" : "SOLA LETTURA");
      setText(state.profileDescription, `Prova terminata. I dati restano disponibili fino al ${archiveDate}.${remainingCopy}`);
      setText(state.profileControls, "Apertura, download e cancellazione");
      setText(state.homePlanName, "Archivio Premium");
      setText(state.homePlanStatus, archiveDays == null ? `Disponibile fino al ${archiveDate}` : `${archiveDays} ${archiveDays === 1 ? "giorno" : "giorni"} disponibili`);
      setText(state.homePremiumBadge, archiveDays != null && archiveDays <= 7 ? "IN SCADENZA" : "SOLA LETTURA");
      setText(state.homePremiumTitle, "Prova Premium terminata");
      setText(state.homePremiumCopy, `Puoi aprire, scaricare o eliminare i documenti fino al ${archiveDate}. Nuovi caricamenti e analisi sono bloccati.`);
    } else {
      const purged = Boolean(subscription?.data_purged_at);
      const retentionEnded = Boolean(subscription?.archive_access_until && new Date(subscription.archive_access_until) <= new Date());
      setText(state.profileKicker, "Profilo Premium");
      setText(state.profileTitle, displayName || "Account Premium");
      setText(state.profileBadge, purged ? "DATI ELIMINATI" : "NON ATTIVO");
      setText(state.profileDescription, purged
        ? "I documenti e i dati operativi Premium sono stati eliminati. L’account resta disponibile."
        : (retentionEnded ? "Il periodo di accesso all’archivio è terminato." : "Abbonamento non attivo."));
      setText(state.profileControls, purged ? "Nessun dato Premium archiviato" : "Nuove operazioni bloccate");
      setText(state.homePlanName, "Premium");
      setText(state.homePlanStatus, purged ? "Dati eliminati" : "Non attivo");
      setText(state.homePremiumBadge, "NON ATTIVO");
      setText(state.homePremiumTitle, purged ? "Archivio Premium eliminato" : "Account creato");
      setText(state.homePremiumCopy, purged
        ? "Non risultano documenti Premium conservati."
        : (retentionEnded ? "Il periodo di conservazione dell’archivio è terminato." : "Il servizio Premium non è attivo."));
    }

    setText(state.profileEmail, session.user.email || "—");
    setText(state.profileArchive, serviceActive
      ? "Cloud Premium attivo"
      : (archiveAvailable ? `Sola lettura fino al ${formatDate(subscription.archive_access_until)}` : (profile ? "Cloud non disponibile" : "Cloud non attivo")));
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
    const confirmed = await globalThis.OffertaLogicaPremiumDialog?.confirm({
      title: "Accetta le condizioni Premium",
      message: "Confermi di aver letto e accettato i Termini Premium, l’Informativa Premium e il trattamento cloud/IA necessario all’erogazione del servizio?",
      confirmLabel: "ACCETTA",
    });
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
    const deletionForm = await globalThis.OffertaLogicaPremiumDialog?.form({
      title: "Richiedi la cancellazione dell’account",
      message: "La richiesta bloccherà nuove operazioni Premium. I dati seguiranno i tempi di conservazione indicati nell’informativa.",
      keyword: "CANCELLA",
      keywordLabel: "Scrivi CANCELLA per confermare",
      inputLabel: "Motivo facoltativo",
      inputPlaceholder: "Massimo 500 caratteri",
      inputMaxLength: 500,
      confirmLabel: "REGISTRA RICHIESTA",
      danger: true,
    });
    if (!deletionForm?.confirmed) return;
    const reason = deletionForm.value || "";
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
    const confirmed = await globalThis.OffertaLogicaPremiumDialog?.confirm({
      title: "Annulla la richiesta",
      message: "Annullare la richiesta di cancellazione dell’account?",
      confirmLabel: "ANNULLA RICHIESTA",
    });
    if (!confirmed) return;
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

  async function handlePurchasePremium() {
    if (!state.subscriptionPurchaseButton || state.subscriptionPurchaseButton.disabled) return;
    state.subscriptionPurchaseButton.disabled = true;
    setBillingMessage("", "Preparazione del pagamento sicuro…");
    try {
      const result = await billingRequest("create_checkout");
      if (!result?.url) throw new Error("checkout_url_missing");
      window.location.assign(result.url);
    } catch (error) {
      setBillingMessage("error", billingErrorMessage(error));
      state.subscriptionPurchaseButton.disabled = !billingAvailability.enabled;
    }
  }

  async function handleManageBilling() {
    if (!state.subscriptionManageButton || state.subscriptionManageButton.disabled) return;
    state.subscriptionManageButton.disabled = true;
    setBillingMessage("", "Apertura della gestione pagamenti…");
    try {
      const result = await billingRequest("create_portal");
      if (!result?.url) throw new Error("portal_url_missing");
      window.location.assign(result.url);
    } catch (error) {
      setBillingMessage("error", billingErrorMessage(error));
      state.subscriptionManageButton.disabled = !billingAvailability.enabled;
    }
  }

  async function applyBillingConfirmation() {
    if (!billingConfirmAction || !state.billingConfirmApply) return;
    const cancel = billingConfirmAction === "cancel";
    state.billingConfirmApply.disabled = true;
    state.billingConfirmBack.disabled = true;
    setBillingMessage("", cancel ? "Disattivazione del rinnovo…" : "Riattivazione del rinnovo…");
    try {
      await billingRequest("set_cancel_at_period_end", { value: cancel });
      hideBillingConfirmation();
      setBillingMessage("", cancel
        ? "Rinnovo disattivato. Premium resterà attivo fino alla scadenza del periodo pagato."
        : "Rinnovo annuale riattivato.");
      if (currentSession) await loadAccount(currentSession, { retry: false });
      window.dispatchEvent(new CustomEvent("offertalogica:premium-access-changed"));
    } catch (error) {
      setBillingMessage("error", billingErrorMessage(error));
    } finally {
      state.billingConfirmApply.disabled = false;
      state.billingConfirmBack.disabled = false;
    }
  }

  function handleBillingReturn() {
    if (billingReturnHandled) return;
    const url = new URL(window.location.href);
    const result = url.searchParams.get("billing");
    if (!result) return;
    billingReturnHandled = true;
    url.searchParams.delete("billing");
    url.searchParams.delete("session_id");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash || "#profile"}`);
    if (result === "success") {
      setBillingMessage("", "Pagamento completato. Lo stato dell’abbonamento viene aggiornato tramite Stripe.");
      let attempts = 0;
      const refresh = window.setInterval(() => {
        attempts += 1;
        if (currentSession) loadAccount(currentSession, { retry: false });
        if (attempts >= 3) window.clearInterval(refresh);
      }, 1800);
    } else if (result === "cancel") {
      setBillingMessage("", "Pagamento annullato. Non è stato effettuato alcun addebito.");
    }
  }

  function collectElements() {
    state.loginForm = byId("premiumLoginForm");
    state.signupForm = byId("premiumSignupForm");
    state.recoveryForm = byId("premiumRecoveryForm");
    state.changePasswordForm = byId("premiumChangePasswordForm");
    state.authSignedOut = byId("premiumAuthSignedOut");
    state.authSignedIn = byId("premiumAuthSignedIn");
    state.authCard = byId("premiumAuthCard");
    state.profileSummary = byId("premiumProfileSummary");
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
    state.subscriptionPanel = byId("premiumSubscriptionPanel");
    state.subscriptionBadge = byId("premiumSubscriptionBadge");
    state.subscriptionStatus = byId("premiumSubscriptionStatus");
    state.subscriptionPeriod = byId("premiumSubscriptionPeriod");
    state.subscriptionCurrentPrice = byId("premiumSubscriptionCurrentPrice");
    state.subscriptionNextPrice = byId("premiumSubscriptionNextPrice");
    state.subscriptionRenewal = byId("premiumSubscriptionRenewal");
    state.subscriptionActionCopy = byId("premiumSubscriptionActionCopy");
    state.subscriptionPurchaseButton = byId("premiumSubscriptionPurchase");
    state.subscriptionManageButton = byId("premiumSubscriptionManage");
    state.subscriptionCancelButton = byId("premiumSubscriptionCancel");
    state.subscriptionResumeButton = byId("premiumSubscriptionResume");
    state.billingMessage = byId("premiumBillingMessage");
    state.billingConfirm = byId("premiumBillingConfirm");
    state.billingConfirmTitle = byId("premiumBillingConfirmTitle");
    state.billingConfirmCopy = byId("premiumBillingConfirmCopy");
    state.billingConfirmBack = byId("premiumBillingConfirmBack");
    state.billingConfirmApply = byId("premiumBillingConfirmApply");
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
    state.subscriptionPurchaseButton?.addEventListener("click", handlePurchasePremium);
    state.subscriptionManageButton?.addEventListener("click", handleManageBilling);
    state.subscriptionCancelButton?.addEventListener("click", () => showBillingConfirmation("cancel"));
    state.subscriptionResumeButton?.addEventListener("click", () => showBillingConfirmation("resume"));
    state.billingConfirmBack?.addEventListener("click", hideBillingConfirmation);
    state.billingConfirmApply?.addEventListener("click", applyBillingConfirmation);
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
