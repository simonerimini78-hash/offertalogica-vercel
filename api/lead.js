import { createId } from "@paralleldrive/cuid2";
import { clientIp, json, method, readJson, requireAllowedBrowserOrigin } from "../lib/http.js";
import {
  clearProtectionSessionCookie,
  maskPhone,
  protectionActivate,
  protectionLookupUserId,
  protectionLookupCallerContext,
  protectionSignIn,
  protectionSignUp,
  protectionState,
  protectionSetNewsletter,
  protectionRevokeContactRequest,
  protectionUserFromAccessToken,
  protectionUserFromRequest,
  setProtectionSessionCookie,
} from "../lib/protectionAuth.js";
import { persistLeadSnapshot } from "../lib/customerDb.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";
import { setJson } from "../lib/store.js";
import { sanitizeLead, sanitizeLeadCalculation, validEmail } from "../lib/validation.js";

function protectionRegistrationEnabled() {
  return String(process.env.PROTECTION_REGISTRATION_ENABLED || "true").trim().toLowerCase() !== "false";
}

function normalizeProtectionEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 160);
}

function normalizeProtectionPassword(value) {
  return String(value || "");
}

function protectionAuthErrorStatus(error) {
  const status = Number(error?.status || 0);
  return status >= 400 && status < 500 ? status : 400;
}

async function protectionStatusPayload(auth) {
  const state = await protectionState(auth.user.id);
  return {
    ok: true,
    authenticated: true,
    email: String(auth.user.email || "").slice(0, 160),
    protection: {
      active: state.active,
      activatedAt: state.activatedAt,
      phoneVerified: state.phoneVerified,
      phoneMasked: maskPhone(state.phone),
      phoneVerifiedAt: state.phoneVerifiedAt,
      newsletterEnabled: state.newsletterEnabled,
      newsletterUpdatedAt: state.newsletterUpdatedAt,
      activeContactRequests: state.activeContactRequests,
      contactRequests: state.contactRequests,
    },
  };
}

async function protectionStatusResponse(req, res) {
  const auth = await protectionUserFromRequest(req, res);
  if (!auth) return json(res, 200, { ok: true, authenticated: false });
  return json(res, 200, await protectionStatusPayload(auth));
}

async function handleProtection(req, res, body) {
  const action = String(body?.action || "").trim().toLowerCase();

  if (action === "lookup-number") {
    if (!(await enforceRateLimit(req, res, {
      label: "protection-number-lookup",
      ...rateLimitConfig("PROTECTION_NUMBER_LOOKUP", 120, 3600),
    }))) return;
    const phone = String(body?.phone || "").trim();
    if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) {
      return json(res, 400, { ok: false, error: "Numero non valido" });
    }
    try {
      const auth = await protectionUserFromRequest(req, res);
      const lookup = await protectionLookupCallerContext({
        phone,
        userId: auth?.user?.id || null,
      });
      return json(res, 200, {
        ok: true,
        authenticated: Boolean(auth?.user?.id),
        recognized: lookup.recognized,
        matches: lookup.matches,
        requestMatch: lookup.requestMatch,
      });
    } catch (error) {
      console.warn("protection_number_lookup_failed", {
        message: String(error?.message || "lookup_failed").slice(0, 180),
      });
      return json(res, 503, { ok: false, error: "Archivio numeri temporaneamente non disponibile" });
    }
  }

  if (!protectionRegistrationEnabled()) {
    return json(res, 503, { ok: false, error: "Registrazione Protezione temporaneamente non disponibile" });
  }

  if (!(await enforceRateLimit(req, res, {
    label: `protection-${action || "unknown"}`,
    ...rateLimitConfig("PROTECTION_AUTH", 60, 3600),
  }))) return;

  if (action === "status") return protectionStatusResponse(req, res);

  if (action === "logout") {
    clearProtectionSessionCookie(res);
    return json(res, 200, { ok: true, authenticated: false });
  }

  if (action === "signup") {
    const email = normalizeProtectionEmail(body.email);
    const password = normalizeProtectionPassword(body.password);
    if (!validEmail(email)) return json(res, 400, { ok: false, error: "Inserisci un indirizzo email valido" });
    if (password.length < 8 || password.length > 128) {
      return json(res, 400, { ok: false, error: "La password deve contenere almeno 8 caratteri" });
    }
    if (body.accepted !== true) {
      return json(res, 400, { ok: false, error: "Conferma la richiesta di registrazione" });
    }
    if (!(await enforceRateLimit(req, res, {
      label: "protection-signup-email",
      identifier: email,
      ...rateLimitConfig("PROTECTION_SIGNUP", 6, 3600),
    }))) return;

    try {
      const existingUserId = await protectionLookupUserId(email);
      if (existingUserId) {
        try {
          const session = await protectionSignIn({ email, password });
          if (session?.access_token && session?.refresh_token) {
            const user = session.user?.id ? session.user : await protectionUserFromAccessToken(session.access_token);
            setProtectionSessionCookie(res, session);
            return json(res, 200, {
              ...(await protectionStatusPayload({ user, accessToken: session.access_token })),
              existingAccount: true,
              message: "Account Offerta Logica riconosciuto. Protezione OL verra aggiunta allo stesso account.",
            });
          }
        } catch {}
        return json(res, 200, {
          ok: true,
          authenticated: false,
          existingAccount: true,
          useLogin: true,
          message: "Questa email e gia collegata a Offerta Logica. Accedi con lo stesso account per aggiungere Protezione OL.",
        });
      }

      const signup = await protectionSignUp({ email, password });
      if (signup?.existingAccount) {
        try {
          const session = await protectionSignIn({ email, password });
          if (session?.access_token && session?.refresh_token) {
            const user = session.user?.id ? session.user : await protectionUserFromAccessToken(session.access_token);
            setProtectionSessionCookie(res, session);
            return json(res, 200, {
              ...(await protectionStatusPayload({ user, accessToken: session.access_token })),
              existingAccount: true,
              message: "Account Offerta Logica riconosciuto. Protezione OL verra aggiunta allo stesso account.",
            });
          }
        } catch {}
        return json(res, 200, {
          ok: true,
          authenticated: false,
          existingAccount: true,
          useLogin: true,
          message: "Questa email e gia collegata a Offerta Logica. Accedi con lo stesso account per aggiungere Protezione OL.",
        });
      }
      if (signup?.access_token && signup?.refresh_token) {
        setProtectionSessionCookie(res, signup);
        return json(res, 200, { ok: true, authenticated: true, emailConfirmationRequired: false });
      }
      return json(res, 200, {
        ok: true,
        authenticated: false,
        emailConfirmationRequired: true,
        message: "Controlla la tua email e conferma la registrazione.",
      });
    } catch (error) {
      const errorMessage = String(error?.message || "").toLowerCase();
      const errorCode = String(error?.code || "").toLowerCase();
      const existingAccount = errorCode === "email_exists"
        || errorCode === "user_already_exists"
        || errorMessage.includes("user already registered")
        || errorMessage.includes("email already")
        || errorMessage.includes("already registered");
      if (existingAccount) {
        try {
          const session = await protectionSignIn({ email, password });
          if (session?.access_token && session?.refresh_token) {
            const user = session.user?.id ? session.user : await protectionUserFromAccessToken(session.access_token);
            setProtectionSessionCookie(res, session);
            return json(res, 200, {
              ...(await protectionStatusPayload({ user, accessToken: session.access_token })),
              existingAccount: true,
              message: "Account Offerta Logica riconosciuto. Protezione OL verra aggiunta allo stesso account.",
            });
          }
        } catch {}
        return json(res, 200, {
          ok: true,
          authenticated: false,
          existingAccount: true,
          useLogin: true,
          message: "Questa email e gia collegata a Offerta Logica. Accedi con lo stesso account per aggiungere Protezione OL.",
        });
      }
      console.warn("protection_signup_failed", {
        status: Number(error?.status || 0) || null,
        message: String(error?.message || "signup_error").slice(0, 180),
      });
      return json(res, protectionAuthErrorStatus(error), {
        ok: false,
        error: "Registrazione non riuscita. Riprova tra poco.",
      });
    }
  }

  if (action === "login") {
    const email = normalizeProtectionEmail(body.email);
    const password = normalizeProtectionPassword(body.password);
    if (!validEmail(email) || !password) return json(res, 400, { ok: false, error: "Email o password non corretti" });
    if (!(await enforceRateLimit(req, res, {
      label: "protection-login-email",
      identifier: email,
      ...rateLimitConfig("PROTECTION_LOGIN", 12, 3600),
    }))) return;

    try {
      const session = await protectionSignIn({ email, password });
      if (!session?.access_token || !session?.refresh_token) throw new Error("protection_login_session_missing");
      const user = session.user?.id ? session.user : await protectionUserFromAccessToken(session.access_token);
      setProtectionSessionCookie(res, session);
      return json(res, 200, await protectionStatusPayload({ user, accessToken: session.access_token }));
    } catch (error) {
      console.warn("protection_login_failed", {
        status: Number(error?.status || 0) || null,
        message: String(error?.message || "login_error").slice(0, 180),
      });
      return json(res, 400, { ok: false, error: "Email o password non corretti, oppure email non ancora confermata" });
    }
  }

  if (action === "session") {
    const accessToken = String(body.accessToken || "").trim();
    const refreshToken = String(body.refreshToken || "").trim();
    if (!accessToken || !refreshToken) return json(res, 400, { ok: false, error: "Sessione di conferma non valida" });
    try {
      const user = await protectionUserFromAccessToken(accessToken);
      setProtectionSessionCookie(res, {
        accessToken,
        refreshToken,
        expiresIn: body.expiresIn,
        expiresAt: body.expiresAt,
      });
      return json(res, 200, { ok: true, authenticated: true, email: String(user.email || "").slice(0, 160) });
    } catch (error) {
      console.warn("protection_confirmation_session_failed", {
        message: String(error?.message || "confirmation_session_error").slice(0, 180),
      });
      clearProtectionSessionCookie(res);
      return json(res, 400, { ok: false, error: "Conferma email non valida o scaduta" });
    }
  }

  if (action === "revoke-contact") {
    const auth = await protectionUserFromRequest(req, res);
    if (!auth) return json(res, 401, { ok: false, error: "Accedi per gestire le richieste" });
    const requestId = String(body?.requestId || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
      return json(res, 400, { ok: false, error: "Richiesta non valida" });
    }
    try {
      await protectionRevokeContactRequest(auth.accessToken, requestId);
      return json(res, 200, await protectionStatusPayload(auth));
    } catch (error) {
      console.warn("protection_contact_revoke_failed", {
        message: String(error?.message || "revoke_failed").slice(0, 240),
      });
      return json(res, 400, { ok: false, error: "Impossibile revocare la richiesta. Riprova." });
    }
  }

  if (action === "newsletter") {
    const auth = await protectionUserFromRequest(req, res);
    if (!auth) return json(res, 401, { ok: false, error: "Accedi per continuare" });
    const state = await protectionState(auth.user.id);
    if (!state.active) return json(res, 400, { ok: false, error: "Attiva prima Protezione OL" });
    await protectionSetNewsletter({ userId: auth.user.id, enabled: body.enabled === true });
    return json(res, 200, await protectionStatusPayload(auth));
  }

  if (action === "activate") {
    if (body.accepted !== true) return json(res, 400, { ok: false, error: "Conferma l'attivazione di Protezione OL" });
    const auth = await protectionUserFromRequest(req, res);
    if (!auth) return json(res, 401, { ok: false, error: "Accedi per continuare" });
    const state = await protectionState(auth.user.id);
    if (!state.phoneVerified) return json(res, 400, { ok: false, error: "Verifica prima il tuo numero di telefono" });
    await protectionActivate(auth.accessToken);
    return json(res, 200, await protectionStatusPayload(auth));
  }

  return json(res, 400, { ok: false, error: "Operazione Protezione non valida" });
}

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedBrowserOrigin(req, res)) return;

  try {
    const body = await readJson(req);
    if (String(body?.mode || "").trim().toLowerCase() === "protection") {
      return await handleProtection(req, res, body);
    }

    if (!(await enforceRateLimit(req, res, { label: "lead", ...rateLimitConfig("LEAD", 30) }))) return;
    const lead = sanitizeLead(body);
    const calculation = sanitizeLeadCalculation(body.calculation);
    if (calculation?.requestType === "photovoltaic_consulting") {
      if (!lead.consentPartners) throw new Error("Comunicazione al consulente tecnico esterno non autorizzata");
      if (!calculation.photovoltaicProfile?.timeframe) throw new Error("Tempistica progetto obbligatoria");
      if (!calculation.photovoltaicProfile?.ownership || calculation.photovoltaicProfile.ownership === "unknown") {
        throw new Error("Disponibilita immobile obbligatoria");
      }
    }
    const id = createId();
    const retentionDays = Number(process.env.LEAD_RETENTION_DAYS || 30);
    const createdAt = new Date().toISOString();
    const privacyVersion = String(body.privacyVersion || "privacy-lead-v1").slice(0, 80);
    const clientProof = body.consentProof && typeof body.consentProof === "object" ? body.consentProof : {};
    const record = {
      id,
      ...lead,
      status: "pending_otp",
      calculation,
      consents: {
        service: lead.consentService,
        marketing: lead.consentMarketing,
        partners: lead.consentPartners,
        profiling: lead.consentProfiling,
        privacyVersion,
        proof: {
          version: privacyVersion,
          clientAcceptedAt: String(clientProof.acceptedAt || "").slice(0, 40),
          source: String(clientProof.source || "unknown").slice(0, 40),
          dataOrigin: String(clientProof.dataOrigin || calculation?.dataOrigin || "unknown").slice(0, 60),
          pdfDocumentCount: Number(clientProof.pdfDocumentCount || calculation?.comparisonProfile?.pdfDocumentCount || 0),
          internalImprovement: Boolean(clientProof.internalImprovement),
          page: String(clientProof.page || "").slice(0, 180),
          serverReceivedAt: createdAt,
        },
      },
      meta: {
        ip: clientIp(req),
        userAgent: req.headers["user-agent"] || "",
        createdAt,
      },
    };

    await setJson(`lead:${id}`, record, retentionDays * 24 * 3600);
    const customerDb = await persistLeadSnapshot(record, "lead_created");
    if (!customerDb.ok && !customerDb.skipped) {
      console.warn("customer_db_lead_created_failed", customerDb.error);
    }
    json(res, 200, { ok: true, leadId: id, status: record.status });
  } catch (error) {
    console.error("lead_create_failed", {
      message: String(error?.message || "lead_create_error").slice(0, 240),
    });
    json(res, 400, { ok: false, error: "Impossibile creare la richiesta. Riprova." });
  }
}
