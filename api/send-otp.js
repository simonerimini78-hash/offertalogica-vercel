import { json, method, readJson } from "../lib/http.js";
import { createOtp, hashOtp, otpExpiresAt, otpTtlSeconds, sendOtpSms } from "../lib/otp.js";
import { getJson, setJson } from "../lib/store.js";

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;

  try {
    const { leadId } = await readJson(req);
    const lead = await getJson(`lead:${leadId}`);
    if (!lead) return json(res, 404, { ok: false, error: "Lead non trovato" });

    const code = createOtp();
    const otp = {
      leadId,
      hash: hashOtp(lead.phone, code),
      attempts: 0,
      expiresAt: otpExpiresAt(),
      createdAt: new Date().toISOString(),
    };
    await setJson(`otp:${leadId}`, otp, otpTtlSeconds());
    const sent = await sendOtpSms(lead.phone, code);

    json(res, 200, {
      ok: true,
      sent: sent.sent,
      provider: sent.provider,
      demoCode: sent.demoCode,
    });
  } catch (error) {
    json(res, 400, { ok: false, error: error.message || "Errore invio OTP" });
  }
}
