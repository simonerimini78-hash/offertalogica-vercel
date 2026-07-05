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

function missingKeys(keys) {
  return keys.filter((key) => !process.env[key]);
}

export function otpProviderStatus() {
  const twilioVerifyMissing = missingKeys(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_VERIFY_SERVICE_SID"]);
  const arubaMissing = missingKeys(["ARUBA_SMS_USER_KEY", "ARUBA_SMS_SENDER", "ARUBA_SMS_MESSAGE_TYPE"]);
  const arubaHasToken = Boolean(process.env.ARUBA_SMS_ACCESS_TOKEN || process.env.ARUBA_SMS_SESSION_KEY);
  if (!arubaHasToken) arubaMissing.push("ARUBA_SMS_ACCESS_TOKEN oppure ARUBA_SMS_SESSION_KEY");
  const twilioSmsMissing = missingKeys(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]);
  const demoEnabled = process.env.DEMO_OTP_ENABLED === "true";

  return {
    selected: twilioVerifyMissing.length === 0
      ? "twilio-verify"
      : arubaMissing.length === 0
      ? "aruba-sms"
      : twilioSmsMissing.length === 0
      ? "twilio-sms"
      : demoEnabled
      ? "demo"
      : "none",
    twilioVerify: {
      configured: twilioVerifyMissing.length === 0,
      missing: twilioVerifyMissing,
    },
    arubaSms: {
      configured: arubaMissing.length === 0,
      missing: arubaMissing,
    },
    twilioSms: {
      configured: twilioSmsMissing.length === 0,
      missing: twilioSmsMissing,
    },
    demoEnabled,
  };
}

function twilioAuthHeader(accountSid, authToken) {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

async function sendTwilioVerify(phone) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID } = process.env;
  const hasAnyVerifyConfig = Boolean(TWILIO_ACCOUNT_SID || TWILIO_AUTH_TOKEN || TWILIO_VERIFY_SERVICE_SID);
  if (!hasAnyVerifyConfig) return null;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SERVICE_SID) {
    throw new Error("Configurazione Twilio Verify incompleta");
  }

  const body = new URLSearchParams({
    To: phone,
    Channel: "sms",
  });

  const response = await fetch(
    `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/Verifications`,
    {
      method: "POST",
      headers: {
        Authorization: twilioAuthHeader(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
  );

  const payloadText = await response.text();
  if (!response.ok) {
    throw new Error(`Twilio Verify error ${response.status}: ${payloadText.slice(0, 300)}`);
  }

  let payload = {};
  try {
    payload = JSON.parse(payloadText);
  } catch {
    payload = {};
  }

  return { sent: true, provider: "twilio-verify", sid: payload.sid || "", status: payload.status || "" };
}

export async function checkTwilioVerify(phone, code) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SERVICE_SID) {
    throw new Error("Configurazione Twilio Verify incompleta");
  }

  const body = new URLSearchParams({
    To: phone,
    Code: String(code || ""),
  });

  const response = await fetch(
    `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`,
    {
      method: "POST",
      headers: {
        Authorization: twilioAuthHeader(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
  );

  const payloadText = await response.text();
  let payload = {};
  try {
    payload = JSON.parse(payloadText);
  } catch {
    payload = {};
  }

  if (!response.ok) {
    if (response.status === 400 || response.status === 404) {
      return { approved: false, status: payload.status || "rejected" };
    }
    throw new Error(`Twilio Verify check error ${response.status}: ${payloadText.slice(0, 300)}`);
  }

  return {
    approved: payload.status === "approved" || payload.valid === true,
    status: payload.status || "",
  };
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
  const sent = (await sendTwilioVerify(phone)) || (await sendArubaSms(phone, code)) || (await sendTwilioSms(phone, code));
  if (sent) return sent;

  if (process.env.DEMO_OTP_ENABLED === "true") {
    return { sent: false, provider: "demo", demoCode: code };
  }

  throw new Error("Provider SMS non configurato");
}
