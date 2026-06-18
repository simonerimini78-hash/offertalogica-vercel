import { json, method, readJson } from "../lib/http.js";
import { notifyLeadVerified } from "../lib/notify.js";
import { hashOtp } from "../lib/otp.js";
import { del, getJson, setJson } from "../lib/store.js";

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;

  try {
    const { leadId, code } = await readJson(req);
    const lead = await getJson(`lead:${leadId}`);
    const otp = await getJson(`otp:${leadId}`);
    if (!lead || !otp) return json(res, 404, { ok: false, error: "Codice scaduto o lead non trovato" });
    if (otp.expiresAt < Date.now()) return json(res, 400, { ok: false, error: "Codice scaduto" });
    if (otp.attempts >= 5) return json(res, 429, { ok: false, error: "Troppi tentativi" });

    const valid = hashOtp(lead.phone, String(code || "")) === otp.hash;
    if (!valid) {
      await setJson(`otp:${leadId}`, { ...otp, attempts: otp.attempts + 1 }, 300);
      return json(res, 400, { ok: false, error: "Codice non corretto" });
    }

    const updatedLead = { ...lead, status: "verified", verifiedAt: new Date().toISOString() };
    try {
      const notification = await notifyLeadVerified(updatedLead);
      updatedLead.notification = {
        webhookSent: !notification.skipped,
        sentAt: notification.skipped ? null : new Date().toISOString(),
      };
    } catch (notificationError) {
      updatedLead.notification = {
        webhookSent: false,
        error: notificationError.message || "Errore invio webhook",
        failedAt: new Date().toISOString(),
      };
    }

    await setJson(`lead:${leadId}`, updatedLead, Number(process.env.LEAD_RETENTION_DAYS || 30) * 24 * 3600);
    await del(`otp:${leadId}`);
    json(res, 200, { ok: true, status: "verified" });
  } catch (error) {
    json(res, 400, { ok: false, error: error.message || "Errore verifica OTP" });
  }
}
