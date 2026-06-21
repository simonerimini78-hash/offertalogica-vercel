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

async function sendArubaSms(phone, code) {
  const {
    ARUBA_SMS_USER_KEY,
    ARUBA_SMS_ACCESS_TOKEN,
    ARUBA_SMS_SESSION_KEY,
    ARUBA_SMS_SENDER,
    ARUBA_SMS_MESSAGE_TYPE,
  } = process.env;

  const hasAnyArubaConfig = Boolean(
    ARUBA_SMS_USER_KEY ||
    ARUBA_SMS_ACCESS_TOKEN ||
    ARUBA_SMS_SESSION_KEY ||
    ARUBA_SMS_SENDER ||
    ARUBA_SMS_MESSAGE_TYPE,
  );

  if (!hasAnyArubaConfig) return null;

  if (!ARUBA_SMS_USER_KEY || (!ARUBA_SMS_ACCESS_TOKEN && !ARUBA_SMS_SESSION_KEY) || !ARUBA_SMS_SENDER || !ARUBA_SMS_MESSAGE_TYPE) {
    throw new Error("Configurazione Aruba SMS incompleta");
  }

  const authHeader = ARUBA_SMS_ACCESS_TOKEN
    ? { Access_token: ARUBA_SMS_ACCESS_TOKEN }
    : { Session_key: ARUBA_SMS_SESSION_KEY };

  const response = await fetch("https://smspanel.aruba.it/API/v1.0/REST/sms", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      user_key: ARUBA_SMS_USER_KEY,
      ...authHeader,
    },
    body: JSON.stringify({
      message_type: ARUBA_SMS_MESSAGE_TYPE,
      message: `Il tuo codice OffertaLogica e ${code}. Scade tra 5 minuti.`,
      recipient: [phone],
      sender: ARUBA_SMS_SENDER,
      returnCredits: true,
    }),
  });

  const payloadText = await response.text();
  if (!response.ok) {
    throw new Error(`Aruba SMS error ${response.status}: ${payloadText.slice(0, 300)}`);
  }

  return { sent: true, provider: "aruba-sms" };
}

async function sendTwilioSms(phone, code) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
  if (!TWILIO_ACCOUNT_SID && !TWILIO_AUTH_TOKEN && !TWILIO_FROM_NUMBER) return null;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    throw new Error("Configurazione Twilio incompleta");
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

export async function sendOtpSms(phone, code) {
  return (
    (await sendArubaSms(phone, code)) ||
    (await sendTwilioSms(phone, code)) ||
    { sent: false, provider: "demo", demoCode: code }
  );
}
