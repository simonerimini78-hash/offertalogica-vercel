import crypto from "node:crypto";

const OTP_TTL_SECONDS = 300;

export function createOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

export function hashOtp(phone, code) {
  const secret = process.env.OTP_SECRET || "dev-only-secret";
  return crypto
    .createHmac("sha256", secret)
    .update(`${phone}:${code}`)
    .digest("hex");
}

export function otpExpiresAt() {
  return Date.now() + OTP_TTL_SECONDS * 1000;
}

export function otpTtlSeconds() {
  return OTP_TTL_SECONDS;
}

export async function sendOtpSms(phone, code) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    return { sent: false, provider: "demo", demoCode: code };
  }

  const body = new URLSearchParams({
    To: phone,
    From: TWILIO_FROM_NUMBER,
    Body: `Il tuo codice OffertaLogica e ${code}. Scade tra 5 minuti.`,
  });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`SMS provider error: ${message}`);
  }

  return { sent: true, provider: "twilio" };
}
