(() => {
  "use strict";

  const SUPABASE_URL = "https://kzxdamhfmzaxonpkytcf.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_poz1xBKiXceLCFV3u_tPIg_5_-ycHcl";
  const STORAGE_KEY = "offertalogica-premium-auth";
  const PENDING_EMAIL_KEY = "offertalogica-premium-pending-email";

  let client = null;
  let initialized = false;
  let authSubscription = null;

  const byId = id => document.getElementById(id);

  const state = {
    loginForm: null,
    signupForm: null,
    authSignedOut: null,
    authSignedIn: null,
    authMessage: null,
    resendWrap: null,
    accountEmail: null,
    accountName: null,
    accountPlan: null,
    accountExpiry: null,
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
    homePremiumCopy: null
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
    if (element) element.textContent = value;
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

  function authReturnUrl() {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "profile";
    return url.toString();
  }

  function friendlyError(error) {
    const message = String(error?.message || "").toLowerCase();
    if (!message) return "Operazione non riuscita. Riprova.";
    if (message.includes("invalid login credentials")) return "Email o password non corrette.";
    if (message.includes("email not confirmed")) return "Conferma prima l’indirizzo email dal messaggio ricevuto.";
    if (message.includes("password should be")) return "La password deve contenere almeno 8 caratteri.";
    if (message.includes("user already registered")) return "Esiste già un account con questo indirizzo email.";
    if (message.includes("rate limit") || message.includes("too many requests")) return "Troppe richieste. Attendi qualche minuto e riprova.";
    if (message.includes("failed to fetch") || message.includes("network")) return "Connessione non disponibile. Controlla la rete e riprova.";
    return String(error?.message || "Operazione non riuscita. Riprova.");
  }

  function showMode(mode) {
    const login = mode === "login";
    if (state.loginForm) state.loginForm.hidden = !login;
    if (state.signupForm) state.signupForm.hidden = login;
    document.querySelectorAll("[data-auth-mode]").forEach(button => {
      const active = button.dataset.authMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    setMessage("", "");
  }

  function renderSignedOut() {
    if (state.authSignedOut) state.authSignedOut.hidden = false;
    if (state.authSignedIn) state.authSignedIn.hidden = true;

    setText(state.profileKicker, "Area Premium");
    setText(state.profileTitle, "Account non collegato");
    setText(state.profileBadge, "ACCESSO");
    setText(state.profileDescription, "Accedi o crea un account per collegare il profilo Premium. Le funzioni cloud restano bloccate finché non esiste un abbonamento attivo.");
    setText(state.profileEmail, "Non collegato");
    setText(state.profileArchive, "Archivio locale");
    setText(state.profileControls, "Non attivi");

    setText(state.homePlanName, "Premium");
    setText(state.homePlanStatus, "Account da collegare");
    setText(state.homePremiumBadge, "ACCESSO RICHIESTO");
    setText(state.homePremiumTitle, "Collega il tuo account");
    setText(state.homePremiumCopy, "Accedi dalla sezione Profilo. Archivio cloud e controlli professionali saranno disponibili soltanto con un abbonamento attivo.");
  }

  function renderLoading(session) {
    if (state.authSignedOut) state.authSignedOut.hidden = true;
    if (state.authSignedIn) state.authSignedIn.hidden = false;
    setText(state.accountEmail, session?.user?.email || "Account collegato");
    setText(state.accountName, "Caricamento profilo…");
    setText(state.accountPlan, "Verifica in corso");
    setText(state.accountExpiry, "—");
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

  async function loadAccount(session) {
    if (!client || !session?.user) {
      renderSignedOut();
      return;
    }

    renderLoading(session);

    const userId = session.user.id;
    const [profileResult, subscriptionResult] = await Promise.all([
      client
        .from("premium_profiles")
        .select("full_name, account_status")
        .eq("id", userId)
        .maybeSingle(),
      client
        .from("premium_subscriptions")
        .select("status, plan_code, current_period_end, included_utilities, included_bills_per_year, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    ]);

    if (profileResult.error) {
      setMessage("error", "Account autenticato, ma il profilo Premium non è accessibile.");
    }

    const profile = profileResult.data;
    const subscription = subscriptionResult.error ? null : subscriptionResult.data;
    const serviceActive = Boolean(
      profile?.account_status === "active" &&
      subscription &&
      ["trialing", "active"].includes(subscription.status) &&
      (!subscription.current_period_end || new Date(subscription.current_period_end) > new Date())
    );

    if (state.authSignedOut) state.authSignedOut.hidden = true;
    if (state.authSignedIn) state.authSignedIn.hidden = false;

    const displayName = String(profile?.full_name || session.user.user_metadata?.full_name || "").trim();
    setText(state.accountEmail, session.user.email || "—");
    setText(state.accountName, displayName || "Nome non indicato");
    setText(state.accountPlan, subscriptionLabel(subscription));
    setText(state.accountExpiry, subscription?.current_period_end ? formatDate(subscription.current_period_end) : "—");

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
    } else if (serviceActive) {
      setText(state.profileKicker, "Profilo Premium");
      setText(state.profileTitle, displayName || "Account Premium");
      setText(state.profileBadge, subscription.status === "trialing" ? "PROVA" : "ATTIVO");
      setText(state.profileDescription, "Account collegato e abbonamento valido. Le funzioni cloud saranno abilitate nei prossimi passaggi tecnici.");
      setText(state.profileControls, "Abbonamento attivo");
      setText(state.homePlanName, subscription.status === "trialing" ? "Prova Premium" : "Premium");
      setText(state.homePlanStatus, "Abbonamento attivo");
      setText(state.homePremiumBadge, subscription.status === "trialing" ? "PROVA ATTIVA" : "ATTIVO");
      setText(state.homePremiumTitle, "Account Premium collegato");
      setText(state.homePremiumCopy, "Il profilo è pronto. Archivio cloud e controlli saranno collegati nei prossimi passaggi.");
    } else {
      setText(state.profileKicker, "Profilo Premium");
      setText(state.profileTitle, displayName || "Account Premium");
      setText(state.profileBadge, "NON ATTIVO");
      setText(state.profileDescription, "L’account è collegato. Nessun abbonamento attivo risulta associato al profilo.");
      setText(state.profileControls, "Abbonamento richiesto");
      setText(state.homePlanName, "Premium");
      setText(state.homePlanStatus, "Abbonamento non attivo");
      setText(state.homePremiumBadge, "NON ATTIVO");
      setText(state.homePremiumTitle, "Account creato");
      setText(state.homePremiumCopy, "Il profilo è collegato, ma archivio cloud e controlli restano bloccati finché non viene attivato un abbonamento.");
    }

    setText(state.profileEmail, session.user.email || "—");
    setText(state.profileArchive, serviceActive ? "Cloud in preparazione" : "Solo locale");
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

    setBusy(form, true);
    setMessage("info", "Creazione account in corso…");
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: authReturnUrl(),
        data: {
          offertalogica_product: "premium",
          full_name: fullName
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
      options: { emailRedirectTo: authReturnUrl() }
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
    state.authSignedOut = byId("premiumAuthSignedOut");
    state.authSignedIn = byId("premiumAuthSignedIn");
    state.authMessage = byId("premiumAuthMessage");
    state.resendWrap = byId("premiumResendWrap");
    state.accountEmail = byId("premiumAccountEmail");
    state.accountName = byId("premiumAccountName");
    state.accountPlan = byId("premiumAccountPlan");
    state.accountExpiry = byId("premiumAccountExpiry");
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
    byId("premiumResendConfirmation")?.addEventListener("click", handleResend);
    byId("premiumSignOut")?.addEventListener("click", handleSignOut);

    authSubscription = client.auth.onAuthStateChange((event, session) => {
      window.setTimeout(() => {
        if (event === "SIGNED_OUT") renderSignedOut();
        else if (["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"].includes(event)) loadAccount(session);
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
    getClient: () => client
  });
})();
