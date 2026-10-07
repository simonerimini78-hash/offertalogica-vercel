import { createLeadSessionToken, json, method, readJson, requireAllowedBrowserOrigin, setLeadSessionCookie } from "../lib/http.js";
import { persistLeadSnapshot } from "../lib/customerDb.js";
import { notifyLeadVerified } from "../lib/notify.js";
import { maskPhone, protectionActivate, protectionRecordVerifiedPhone, protectionUserFromRequest } from "../lib/protectionAuth.js";
import { checkTwilioVerify, otpHashMatches } from "../lib/otp.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";
import { del, getJson, setJson } from "../lib/store.js";

async function handleProtectionVerifyOtp(req, res, body) {
  if (!(await enforceRateLimit(req, res, {
    label: "verify-protection-otp",
    ...rateLimitConfig("PROTECTION_VERIFY_OTP", 30, 3600),
  }))) return;

  const auth = await protectionUserFromRequest(req, res);
  if (!auth) return json(res, 401, { ok: false, error: "Accedi per verificare il numero" });
  if (body.accepted !== true) {
    return json(res, 400, { ok: false, error: "Conferma l'attivazione di Protezione OL" });
  }

  const normalizedCode = String(body.code || "").trim();
  if (!/^\d{4,10}$/.test(normalizedCode)) {
    return json(res, 400, { ok: false, error: "Codice non corretto" });
  }

  const otpKey = `protection:otp:${auth.user.id}`;
  const otp = await getJson(otpKey);
  if (!otp || otp.userId !== auth.user.id) return json(res, 404, { ok: false, error: "Codice scaduto" });
  if (otp.expiresAt < Date.now()) return json(res, 400, { ok: false, error: "Codice scaduto" });
  if (otp.attempts >= 5) return json(res, 429, { ok: false, error: "Troppi tentativi" });

  let valid = Boolean(otp.phoneRecordedAt);
  if (!valid && otp.provider === "twilio-verify") {
    const twilioResult = await checkTwilioVerify(otp.phone, normalizedCode);
    valid = twilioResult.approved;
  } else if (!valid) {
    valid = otpHashMatches(otp.phone, normalizedCode, otp.hash);
  }

  if (!valid) {
    await setJson(otpKey, { ...otp, attempts: Number(otp.attempts || 0) + 1 }, 300);
    return json(res, 400, { ok: false, error: "Codice non corretto" });
  }

  let currentOtp = otp;
  if (!otp.phoneRecordedAt) {
    await protectionRecordVerifiedPhone({ userId: auth.user.id, phone: otp.phone, method: "otp" });
    currentOtp = { ...otp, phoneRecordedAt: new Date().toISOString() };
    await setJson(otpKey, currentOtp, 300);
  }

  await protectionActivate(auth.accessToken);
  await del(otpKey);
  return json(res, 200, {
    ok: true,
    status: "active",
    protectionActive: true,
    phoneVerified: true,
    phoneMasked: maskPhone(currentOtp.phone),
  });
}

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedBrowserOrigin(req, res)) return;

  try {
    const body = await readJson(req);
    if (String(body?.mode || "").trim().toLowerCase() === "protection") {
      return await handleProtectionVerifyOtp(req, res, body);
    }

    if (!(await enforceRateLimit(req, res, { label: "verify-otp", ...rateLimitConfig("VERIFY_OTP", 60) }))) return;
    const { leadId, code } = body;
    const normalizedLeadId = String(leadId || "").trim().slice(0, 100);
    const normalizedCode = String(code || "").trim();
    if (!normalizedLeadId || !/^[A-Za-z0-9_-]+$/.test(normalizedLeadId) || !/^\d{4,10}$/.test(normalizedCode)) {
      return json(res, 400, { ok: false, error: "Codice non corretto" });
    }

    createLeadSessionToken(normalizedLeadId);

    const lead = await getJson(`lead:${normalizedLeadId}`);
    const otp = await getJson(`otp:${normalizedLeadId}`);
    if (!lead || !otp) return json(res, 404, { ok: false, error: "Codice scaduto o lead non trovato" });
    if (otp.expiresAt < Date.now()) return json(res, 400, { ok: false, error: "Codice scaduto" });
    if (otp.attempts >= 5) return json(res, 429, { ok: false, error: "Troppi tentativi" });

    // Se il numero era già stato verificato ma la consegna della lead era fallita,
    // non chiediamo al provider OTP di approvare nuovamente lo stesso codice.
    // Questo è importante soprattutto con Twilio Verify, dove una verifica già
    // approvata può non essere riutilizzabile in un secondo VerificationCheck.
    const verificationChannel = otp.channel === "email" || otp.provider === "resend-email" ? "email" : "sms";
    const otpIdentifier = verificationChannel === "email"
      ? String(lead.email || "").trim().toLowerCase()
      : String(lead.phone || "").trim();
    let valid = lead.status === "verified" && Boolean(lead.verifiedAt);
    if (!valid && otp.provider === "twilio-verify") {
      const twilioResult = await checkTwilioVerify(lead.phone, normalizedCode);
      valid = twilioResult.approved;
    } else if (!valid) {
      valid = otpHashMatches(otpIdentifier, normalizedCode, otp.hash);
    }
    if (!valid) {
      await setJson(`otp:${normalizedLeadId}`, { ...otp, attempts: otp.attempts + 1 }, 300);
      return json(res, 400, { ok: false, error: "Codice non corretto" });
    }

    const updatedLead = {
      ...lead,
      status: "verified",
      verifiedAt: lead.verifiedAt || new Date().toISOString(),
      verificationChannel,
    };
    const notificationEvent = updatedLead.calculation?.requestType === "photovoltaic_consulting"
      ? "photovoltaic_consulting_request"
      : updatedLead.calculation?.customerType === "business"
        ? "business_consulting_request"
        : "";
    let notificationFailed = false;
    if (notificationEvent) {
      try {
        const notification = await notifyLeadVerified(updatedLead, notificationEvent);
        updatedLead.notification = {
          emailSent: Boolean(notification.emailSent),
          webhookSent: Boolean(notification.webhookSent),
          sentAt: notification.skipped ? null : new Date().toISOString(),
          event: notificationEvent,
          warnings: Array.isArray(notification.warnings) ? notification.warnings.slice(0, 5) : [],
        };
      } catch (notificationError) {
        notificationFailed = true;
        updatedLead.notification = {
          emailSent: false,
          webhookSent: false,
          error: notificationError.message || "Errore invio notifica lead",
          failedAt: new Date().toISOString(),
          event: notificationEvent,
        };
      }
    }
    await setJson(`lead:${normalizedLeadId}`, updatedLead, Number(process.env.LEAD_RETENTION_DAYS || 30) * 24 * 3600);
    const customerDb = await persistLeadSnapshot(updatedLead, "lead_verified");
    if (!customerDb.ok && !customerDb.skipped) {
      console.warn("customer_db_lead_verified_failed", customerDb.error);
    }

    if (notificationEvent === "photovoltaic_consulting_request" && notificationFailed) {
      return json(res, 503, {
        ok: false,
        error: "Recapito verificato, ma l'invio della richiesta non e' riuscito. Premi di nuovo Verifica tra poco.",
      });
    }

    await del(`otp:${normalizedLeadId}`);
    setLeadSessionCookie(res, normalizedLeadId);
    json(res, 200, { ok: true, status: "verified", channel: verificationChannel });
  } catch (error) {
    const message = String(error?.message || "verify_otp_error");
    console.error("verify_otp_failed", {
      message: message.slice(0, 240),
    });
    if (message === "lead_session_secret_not_configured") {
      return json(res, 503, { ok: false, error: "Servizio di verifica temporaneamente non disponibile. Riprova." });
    }
    return json(res, 400, { ok: false, error: "Impossibile verificare il codice. Riprova." });
  }
}
