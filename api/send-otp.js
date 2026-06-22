import { json, method, readJson, requireAllowedOrigin } from "../lib/http.js";
import { createOtp, hashOtp, otpExpiresAt, otpTtlSeconds, sendOtpSms } from "../lib/otp.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";
import { getJson, setJson } from "../lib/store.js";

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedOrigin(req, res)) return;
  if (!(await enforceRateLimit(req, res, { label: "send-otp-ip", ...rateLimitConfig("OTP_IP", 12) }))) return;

  try {
    const { leadId } = await readJson(req);
    const lead = await getJson(`lead:${leadId}`);
    if (!lead) return json(res, 404, { ok: false, error: "Lead non trovato" });
    if (!(await enforceRateLimit(req, res, {
      label: "send-otp-phone",
      identifier: lead.phone,
      ...rateLimitConfig("OTP_PHONE", 5),
    }))) return;

    const code = createOtp();
    const sent = await sendOtpSms(lead.phone, code);
    const otp = {
      leadId,
      provider: sent.provider,
      hash: sent.provider === "twilio-verify" ? "" : hashOtp(lead.phone, code),
      attempts: 0,
      expiresAt: otpExpiresAt(),
      createdAt: new Date().toISOString(),
      providerStatus: sent.status || "",
      providerSid: sent.sid || "",
    };
    await setJson(`otp:${leadId}`, otp, otpTtlSeconds());

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
