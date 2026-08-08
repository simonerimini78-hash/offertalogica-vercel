(() => {
  "use strict";

  const CATEGORIES = Object.freeze({
    account: "Account e accesso",
    payment: "Abbonamento e pagamento",
    utilities: "Utenze",
    bills: "Bollette e analisi",
    installation: "Installazione e aggiornamento app",
    other: "Altro",
  });

  let initialized = false;

  const byId = id => document.getElementById(id);

  function setMessage(kind, message) {
    const target = byId("premiumSupportMessage");
    if (!target) return;
    target.className = `auth-message${kind ? ` ${kind}` : ""}`;
    target.textContent = message || "";
    target.hidden = !message;
  }

  function setBusy(busy) {
    const form = byId("premiumSupportForm");
    if (!form) return;
    form.setAttribute("aria-busy", busy ? "true" : "false");
    form.querySelectorAll("button, select, textarea").forEach(element => {
      element.disabled = Boolean(busy);
    });
  }

  function openPanel() {
    const panel = byId("premiumSupportPanel");
    if (!panel) return;
    panel.hidden = false;
    setMessage("", "");
    panel.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => byId("premiumSupportCategory")?.focus(), 250);
  }

  function closePanel() {
    const panel = byId("premiumSupportPanel");
    if (!panel) return;
    panel.hidden = true;
    setMessage("", "");
    byId("premiumSupportOpen")?.focus();
  }

  function friendlyError(error) {
    const message = String(error?.message || error || "").toLowerCase();
    if (message.includes("row-level security") || message.includes("policy")) {
      return "La richiesta può essere inviata da un account Premium o da una prova ancora attiva.";
    }
    if (message.includes("jwt") || message.includes("session") || message.includes("auth")) {
      return "La sessione è scaduta. Accedi nuovamente e riprova.";
    }
    return "Richiesta non inviata. Riprova tra poco.";
  }

  async function submitRequest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const category = String(form.elements.category?.value || "").trim();
    const body = String(form.elements.message?.value || "").trim();

    if (!CATEGORIES[category]) {
      setMessage("error", "Seleziona l’argomento della richiesta.");
      return;
    }
    if (body.length < 10) {
      setMessage("error", "Descrivi il problema con almeno 10 caratteri.");
      form.elements.message?.focus();
      return;
    }

    const client = globalThis.OffertaLogicaPremiumAuth?.getClient?.();
    if (!client) {
      setMessage("error", "Accedi prima al tuo account Premium.");
      return;
    }

    setBusy(true);
    setMessage("info", "Invio della richiesta allo staff…");
    try {
      const { data, error: sessionError } = await client.auth.getSession();
      const session = data?.session;
      if (sessionError || !session?.user?.id) throw new Error("authentication_required");

      const { error } = await client.from("premium_communications").insert({
        user_id: session.user.id,
        direction: "user_to_staff",
        channel: "in_app",
        subject: `[support:${category}] ${CATEGORIES[category]}`,
        body: body.slice(0, 1500),
        created_by_user_id: session.user.id,
      });
      if (error) throw error;

      form.reset();
      setMessage("success", "Richiesta inviata. Lo staff la troverà nell’area Pratiche.");
    } catch (error) {
      setMessage("error", friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;
    byId("premiumSupportOpen")?.addEventListener("click", openPanel);
    byId("premiumSupportCancel")?.addEventListener("click", closePanel);
    byId("premiumSupportForm")?.addEventListener("submit", submitRequest);
  }

  globalThis.OffertaLogicaPremiumSupport = Object.freeze({ init });
})();
