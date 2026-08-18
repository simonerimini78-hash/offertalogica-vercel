import { json, method, readJson, requireAllowedBrowserOrigin } from "../lib/http.js";
import { createOtp, hashOtp, otpExpiresAt, otpTtlSeconds, sendOtpSms } from "../lib/otp.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";
import { del, getJson, setJson } from "../lib/store.js";

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

const ALLOWED_OTP_PROVIDERS = new Set(["aruba-sms", "twilio-verify", "twilio", "demo"]);

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedBrowserOrigin(req, res)) return;
  if (!(await enforceRateLimit(req, res, {
    label: "send-otp-ip",
    ...rateLimitConfig("SEND_OTP_IP", 12, 3600),
  }))) return;

  let otpKey = "";

  try {
    const { leadId } = await readJson(req);
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

    const phoneIdentifier = String(lead.phone || "").trim();
    if (!phoneIdentifier) return json(res, 400, { ok: false, error: "Telefono non disponibile" });
    if (!(await enforceRateLimit(req, res, {
      label: "send-otp-phone",
      identifier: phoneIdentifier,
      ...rateLimitConfig("SEND_OTP_PHONE", 5, 3600),
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
      hash: hashOtp(lead.phone, code),
      attempts: 0,
      expiresAt: otpExpiresAt(),
      createdAt: new Date().toISOString(),
    };

    // Registriamo prima la richiesta per rendere effettivo il cooldown anche
    // mentre il provider SMS sta elaborando l'invio.
    await setJson(otpKey, otp, otpTtlSeconds());

    let sent;
    try {
      sent = await sendOtpSms(lead.phone, code);

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
      ...(process.env.NODE_ENV !== "production" && sent.demoCode ? { demoCode: sent.demoCode } : {}),
    });
  } catch (error) {
    json(res, 400, { ok: false, error: error.message || "Errore invio OTP" });
  }
}
