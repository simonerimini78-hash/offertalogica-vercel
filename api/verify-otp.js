import { createLeadSessionToken, json, method, readJson, requireAllowedBrowserOrigin, setLeadSessionCookie } from "../lib/http.js";
import { persistLeadSnapshot } from "../lib/customerDb.js";
import { notifyLeadVerified } from "../lib/notify.js";
import { checkTwilioVerify, otpHashMatches } from "../lib/otp.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";
import { del, getJson, setJson } from "../lib/store.js";

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedBrowserOrigin(req, res)) return;
  if (!(await enforceRateLimit(req, res, { label: "verify-otp", ...rateLimitConfig("VERIFY_OTP", 60) }))) return;

  try {
    const { leadId, code } = await readJson(req);
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
    let valid = lead.status === "verified" && Boolean(lead.verifiedAt);
    if (!valid && otp.provider === "twilio-verify") {
      const twilioResult = await checkTwilioVerify(lead.phone, normalizedCode);
      valid = twilioResult.approved;
    } else if (!valid) {
      valid = otpHashMatches(lead.phone, normalizedCode, otp.hash);
    }
    if (!valid) {
      await setJson(`otp:${normalizedLeadId}`, { ...otp, attempts: otp.attempts + 1 }, 300);
      return json(res, 400, { ok: false, error: "Codice non corretto" });
    }

    const updatedLead = {
      ...lead,
      status: "verified",
      verifiedAt: lead.verifiedAt || new Date().toISOString(),
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
        error: "Numero verificato, ma l'invio della richiesta non e' riuscito. Premi di nuovo Verifica tra poco.",
      });
    }

    await del(`otp:${normalizedLeadId}`);
    setLeadSessionCookie(res, normalizedLeadId);
    json(res, 200, { ok: true, status: "verified" });
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
