import { json, method, readJson, requireAllowedBrowserOrigin } from "../lib/http.js";
import { createOtp, hashOtp, otpExpiresAt, otpTtlSeconds, sendOtpEmail, sendOtpSms } from "../lib/otp.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";
import { protectionUserFromRequest } from "../lib/protectionAuth.js";
import { del, getJson, setJson } from "../lib/store.js";
import { normalizePhone } from "../lib/validation.js";

function positiveInteger(value, fallback, { min = 1, max = 86400 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function resendCooldownSeconds() {
  return positiveInteger(process.env.OTP_RESEND_COOLDOWN_SECONDS, 60, { min: 15, max: 900 });
}

function secondsSince(value) {
  const timestamp = new Date(value || 0).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
}

const ALLOWED_OTP_PROVIDERS = new Set(["aruba-sms", "twilio-verify", "twilio", "resend-email", "demo"]);

async function handleProtectionSendOtp(req, res, body) {
  if (!(await enforceRateLimit(req, res, {
    label: "send-protection-otp-ip",
    ...rateLimitConfig("PROTECTION_SEND_OTP_IP", 8, 3600),
  }))) return;

  const auth = await protectionUserFromRequest(req, res);
  if (!auth) return json(res, 401, { ok: false, error: "Accedi per verificare il numero" });

  const phone = normalizePhone(body.phone || "");
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) {
    return json(res, 400, { ok: false, error: "Numero di telefono non valido" });
  }

  if (!(await enforceRateLimit(req, res, {
    label: "send-protection-otp-user",
    identifier: auth.user.id,
    ...rateLimitConfig("PROTECTION_SEND_OTP_USER", 5, 3600),
  }))) return;
  if (!(await enforceRateLimit(req, res, {
    label: "send-protection-otp-phone",
    identifier: phone,
    ...rateLimitConfig("PROTECTION_SEND_OTP_PHONE", 5, 3600),
  }))) return;

  const otpKey = `protection:otp:${auth.user.id}`;
  const existingOtp = await getJson(otpKey);
  const cooldownSeconds = resendCooldownSeconds();
  const elapsedSeconds = secondsSince(existingOtp?.createdAt);
  if (elapsedSeconds < cooldownSeconds) {
    const retryAfter = Math.max(1, cooldownSeconds - elapsedSeconds);
    res.setHeader("Retry-After", String(retryAfter));
    return json(res, 429, {
      ok: false,
      error: "Codice gia inviato. Attendi prima di richiederne un altro.",
      retryAfter,
    });
  }

  const code = createOtp();
  const otp = {
    userId: auth.user.id,
    phone,
    hash: hashOtp(phone, code),
    attempts: 0,
    expiresAt: otpExpiresAt(),
    createdAt: new Date().toISOString(),
    channel: "sms",
  };
  await setJson(otpKey, otp, otpTtlSeconds());

  try {
    const sent = await sendOtpSms(phone, code);
    const provider = String(sent?.provider || "").trim();
    if (!ALLOWED_OTP_PROVIDERS.has(provider) || provider === "resend-email") {
      throw new Error("Provider OTP non riconosciuto");
    }
    if (provider === "demo" && process.env.NODE_ENV === "production") {
      throw new Error("Modalita OTP demo non consentita in produzione");
    }
    await setJson(otpKey, { ...otp, provider }, otpTtlSeconds());
    return json(res, 200, {
      ok: true,
      sent: Boolean(sent?.sent),
      provider,
      channel: "sms",
      ...(process.env.NODE_ENV !== "production" && sent?.demoCode ? { demoCode: sent.demoCode } : {}),
    });
  } catch (error) {
    try {
      await del(otpKey);
    } catch {
      // Manteniamo l'errore originale del provider.
    }
    throw error;
  }
}

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedBrowserOrigin(req, res)) return;

  let otpKey = "";

  try {
    const body = await readJson(req);
    if (String(body?.mode || "").trim().toLowerCase() === "protection") {
      return await handleProtectionSendOtp(req, res, body);
    }

    if (!(await enforceRateLimit(req, res, {
      label: "send-otp-ip",
      ...rateLimitConfig("SEND_OTP_IP", 12, 3600),
    }))) return;

    const { leadId } = body;
    const normalizedLeadId = String(leadId || "").trim().slice(0, 100);
    if (!normalizedLeadId || !/^[A-Za-z0-9_-]+$/.test(normalizedLeadId)) {
      return json(res, 400, { ok: false, error: "Richiesta OTP non valida" });
    }

    if (!(await enforceRateLimit(req, res, {
      label: "send-otp-lead",
      identifier: normalizedLeadId,
      ...rateLimitConfig("SEND_OTP_LEAD", 5, 3600),
    }))) return;

    const lead = await getJson(`lead:${normalizedLeadId}`);
    if (!lead) return json(res, 404, { ok: false, error: "Lead non trovato" });

    const leadSource = String(lead.consents?.proof?.source || "").trim().toLowerCase();
    const useEmailOtp = leadSource === "offer_selection";
    const verificationChannel = useEmailOtp ? "email" : "sms";
    const otpIdentifier = String(useEmailOtp ? lead.email : lead.phone || "").trim().toLowerCase();
    if (!otpIdentifier) {
      return json(res, 400, { ok: false, error: useEmailOtp ? "Email non disponibile" : "Telefono non disponibile" });
    }
    if (!(await enforceRateLimit(req, res, {
      label: useEmailOtp ? "send-otp-email" : "send-otp-phone",
      identifier: otpIdentifier,
      ...rateLimitConfig(useEmailOtp ? "SEND_OTP_EMAIL" : "SEND_OTP_PHONE", 5, 3600),
    }))) return;

    otpKey = `otp:${normalizedLeadId}`;
    const existingOtp = await getJson(otpKey);
    const cooldownSeconds = resendCooldownSeconds();
    const elapsedSeconds = secondsSince(existingOtp?.createdAt);
    if (elapsedSeconds < cooldownSeconds) {
      const retryAfter = Math.max(1, cooldownSeconds - elapsedSeconds);
      res.setHeader("Retry-After", String(retryAfter));
      return json(res, 429, {
        ok: false,
        error: "Codice gia inviato. Attendi prima di richiederne un altro.",
        retryAfter,
      });
    }

    const code = createOtp();
    const otp = {
      leadId: normalizedLeadId,
      hash: hashOtp(otpIdentifier, code),
      attempts: 0,
      expiresAt: otpExpiresAt(),
      createdAt: new Date().toISOString(),
      channel: verificationChannel,
    };

    // Registriamo prima la richiesta per rendere effettivo il cooldown anche
    // mentre il provider SMS sta elaborando l'invio.
    await setJson(otpKey, otp, otpTtlSeconds());

    let sent;
    try {
      sent = useEmailOtp ? await sendOtpEmail(lead.email, code) : await sendOtpSms(lead.phone, code);

      const provider = String(sent?.provider || "").trim();
      if (!ALLOWED_OTP_PROVIDERS.has(provider)) {
        throw new Error("Provider OTP non riconosciuto");
      }
      if (provider === "demo" && process.env.NODE_ENV === "production") {
        throw new Error("Modalita OTP demo non consentita in produzione");
      }

      // La verifica deve conoscere il provider realmente usato. In particolare
      // Twilio Verify genera il proprio codice e deve essere verificato via API,
      // non confrontando l'hash del codice locale.
      await setJson(
        otpKey,
        {
          ...otp,
          provider,
        },
        otpTtlSeconds(),
      );
    } catch (sendError) {
      // Non lasciare un OTP utilizzabile/cooldown orfano se l'invio non riesce.
      try {
        await del(otpKey);
      } catch {
        // Manteniamo l'errore originale del provider.
      }
      throw sendError;
    }

    json(res, 200, {
      ok: true,
      sent: sent.sent,
      provider: sent.provider,
      channel: verificationChannel,
      ...(process.env.NODE_ENV !== "production" && sent.demoCode ? { demoCode: sent.demoCode } : {}),
    });
  } catch (error) {
    console.error("send_otp_failed", {
      leadId: otpKey ? otpKey.replace(/^otp:/, "").slice(0, 100) : null,
      message: String(error?.message || "send_otp_error").slice(0, 240),
    });
    json(res, 400, { ok: false, error: "Impossibile inviare il codice. Riprova." });
  }
}
