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

    let valid = false;
    if (otp.provider === "twilio-verify") {
      const twilioResult = await checkTwilioVerify(lead.phone, normalizedCode);
      valid = twilioResult.approved;
    } else {
      valid = otpHashMatches(lead.phone, normalizedCode, otp.hash);
    }
    if (!valid) {
      await setJson(`otp:${normalizedLeadId}`, { ...otp, attempts: otp.attempts + 1 }, 300);
      return json(res, 400, { ok: false, error: "Codice non corretto" });
    }

    const updatedLead = { ...lead, status: "verified", verifiedAt: new Date().toISOString() };
    if (updatedLead.calculation?.customerType === "business") {
      try {
        const notification = await notifyLeadVerified(updatedLead, "business_consulting_request");
        updatedLead.notification = {
          webhookSent: !notification.skipped,
          sentAt: notification.skipped ? null : new Date().toISOString(),
          event: "business_consulting_request",
        };
      } catch (notificationError) {
        updatedLead.notification = {
          webhookSent: false,
          error: notificationError.message || "Errore invio webhook",
          failedAt: new Date().toISOString(),
          event: "business_consulting_request",
        };
      }
    }
    await setJson(`lead:${normalizedLeadId}`, updatedLead, Number(process.env.LEAD_RETENTION_DAYS || 30) * 24 * 3600);
    await del(`otp:${normalizedLeadId}`);
    const customerDb = await persistLeadSnapshot(updatedLead, "lead_verified");
    if (!customerDb.ok && !customerDb.skipped) {
      console.warn("customer_db_lead_verified_failed", customerDb.error);
    }
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
