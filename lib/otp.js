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

function looksLikeUsername(value) {
  return String(value || "").includes("@");
}

export function otpProviderStatus() {
  const twilioVerifyMissing = missingKeys(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_VERIFY_SERVICE_SID"]);
  const arubaBaseMissing = missingKeys(["ARUBA_SMS_SENDER", "ARUBA_SMS_MESSAGE_TYPE"]);
  const arubaUsername =
    process.env.ARUBA_SMS_USERNAME ||
    process.env.ARUBA_SMS_LOGIN_USERNAME ||
    (looksLikeUsername(process.env.ARUBA_SMS_USER_KEY) ? process.env.ARUBA_SMS_USER_KEY : "");
  const arubaApiPassword =
    process.env.ARUBA_SMS_API_PASSWORD ||
    process.env.ARUBA_SMS_PASSWORD ||
    process.env.ARUBA_API_PASSWORD ||
    "";
  const arubaDirectUserKey = looksLikeUsername(process.env.ARUBA_SMS_USER_KEY) ? "" : process.env.ARUBA_SMS_USER_KEY;
  const arubaHasDirectAuth = Boolean(
    arubaDirectUserKey &&
    (process.env.ARUBA_SMS_ACCESS_TOKEN || process.env.ARUBA_SMS_SESSION_KEY),
  );
  const arubaHasLoginAuth = Boolean(arubaUsername && arubaApiPassword);
  const arubaMissing = [...arubaBaseMissing];
  if (!arubaHasDirectAuth && !arubaHasLoginAuth) {
    arubaMissing.push("ARUBA_SMS_USERNAME + ARUBA_SMS_API_PASSWORD oppure ARUBA_SMS_USER_KEY + token/sessione");
  }
  const twilioSmsMissing = missingKeys(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]);
  const demoEnabled = process.env.DEMO_OTP_ENABLED === "true";

  return {
    selected: arubaMissing.length === 0
      ? "aruba-sms"
      : twilioVerifyMissing.length === 0
      ? "twilio-verify"
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
      authMode: arubaHasLoginAuth ? "login" : arubaHasDirectAuth ? "direct" : "missing",
      userKeyLooksLikeUsername: looksLikeUsername(process.env.ARUBA_SMS_USER_KEY),
    },
    twilioSms: {
      configured: twilioSmsMissing.length === 0,
      missing: twilioSmsMissing,
    },
    demoEnabled,
  };
}

function parseArubaLoginPayload(payloadText) {
  const trimmed = String(payloadText || "").trim();
  if (!trimmed) return {};

  try {
    const payload = JSON.parse(trimmed);
    return {
      userKey: payload.user_key || payload.userKey || payload.userkey || payload.user || "",
      sessionKey: payload.session_key || payload.sessionKey || payload.Session_key || payload.session || "",
    };
  } catch {
    // Aruba/Skebby-style REST login commonly returns: user_key;session_key
  }

  const xmlUserKey = trimmed.match(/<user[_-]?key>([^<]+)<\/user[_-]?key>/i);
  const xmlSessionKey = trimmed.match(/<session[_-]?key>([^<]+)<\/session[_-]?key>/i);
  if (xmlUserKey?.[1] && xmlSessionKey?.[1]) {
    return {
      userKey: xmlUserKey[1].trim(),
      sessionKey: xmlSessionKey[1].trim(),
    };
  }

  const parts = trimmed
    .split(/[;\n,\t ]+/)
    .map((part) => part.trim())
    .filter((part) => part && !/^ok$/i.test(part));
  return {
    userKey: parts[0] || "",
    sessionKey: parts[1] || "",
  };
}

async function arubaLoginWithCredentials(username, apiPassword) {
  const loginUrl = `https://smspanel.aruba.it/API/v1.0/REST/login?username=${encodeURIComponent(username)}&password=${encodeURIComponent(apiPassword)}`;
  const response = await fetch(loginUrl, { method: "GET" });
  const payloadText = await response.text();

  if (!response.ok) {
    throw new Error(`Aruba login error ${response.status}: ${payloadText.slice(0, 300)}`);
  }

  const { userKey, sessionKey } = parseArubaLoginPayload(payloadText);
  if (!userKey || !sessionKey) {
    throw new Error(`Aruba login non valido: ${payloadText.slice(0, 120)}`);
  }

  return { userKey, sessionKey };
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
    ARUBA_SMS_USERNAME,
    ARUBA_SMS_LOGIN_USERNAME,
    ARUBA_SMS_API_PASSWORD,
    ARUBA_SMS_PASSWORD,
    ARUBA_API_PASSWORD,
    ARUBA_SMS_USER_KEY,
    ARUBA_SMS_ACCESS_TOKEN,
    ARUBA_SMS_SESSION_KEY,
    ARUBA_SMS_SENDER,
    ARUBA_SMS_MESSAGE_TYPE,
  } = process.env;

  const hasAnyArubaConfig = Boolean(
    ARUBA_SMS_USERNAME ||
    ARUBA_SMS_LOGIN_USERNAME ||
    ARUBA_SMS_API_PASSWORD ||
    ARUBA_SMS_PASSWORD ||
    ARUBA_API_PASSWORD ||
    ARUBA_SMS_USER_KEY ||
    ARUBA_SMS_ACCESS_TOKEN ||
    ARUBA_SMS_SESSION_KEY ||
    ARUBA_SMS_SENDER ||
    ARUBA_SMS_MESSAGE_TYPE,
  );

  if (!hasAnyArubaConfig) return null;

  const arubaUsername = ARUBA_SMS_USERNAME || ARUBA_SMS_LOGIN_USERNAME || (looksLikeUsername(ARUBA_SMS_USER_KEY) ? ARUBA_SMS_USER_KEY : "");
  const arubaApiPassword = ARUBA_SMS_API_PASSWORD || ARUBA_SMS_PASSWORD || ARUBA_API_PASSWORD || "";
  const arubaDirectUserKey = looksLikeUsername(ARUBA_SMS_USER_KEY) ? "" : ARUBA_SMS_USER_KEY;
  const hasLoginAuth = Boolean(arubaUsername && arubaApiPassword);
  const hasDirectAuth = Boolean(arubaDirectUserKey && (ARUBA_SMS_ACCESS_TOKEN || ARUBA_SMS_SESSION_KEY));
  if ((!hasLoginAuth && !hasDirectAuth) || !ARUBA_SMS_SENDER || !ARUBA_SMS_MESSAGE_TYPE) {
    throw new Error("Configurazione Aruba SMS incompleta");
  }

  let userKey = arubaDirectUserKey;
  let authHeader = ARUBA_SMS_ACCESS_TOKEN
    ? { Access_token: ARUBA_SMS_ACCESS_TOKEN }
    : { Session_key: ARUBA_SMS_SESSION_KEY };

  if (hasLoginAuth) {
    const login = await arubaLoginWithCredentials(arubaUsername, arubaApiPassword);
    userKey = login.userKey;
    authHeader = { Session_key: login.sessionKey };
  }

  const response = await fetch("https://smspanel.aruba.it/API/v1.0/REST/sms", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      user_key: userKey,
      ...authHeader,
    },
    body: JSON.stringify({
      message_type: ARUBA_SMS_MESSAGE_TYPE,
      message: `OffertaLogica: il tuo codice di verifica e' ${code}. Valido 5 minuti. Non condividerlo.`,
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
    Body: `OffertaLogica: il tuo codice di verifica e' ${code}. Valido 5 minuti. Non condividerlo.`,
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
  const sent = (await sendArubaSms(phone, code)) || (await sendTwilioVerify(phone)) || (await sendTwilioSms(phone, code));
  if (sent) return sent;

  if (process.env.DEMO_OTP_ENABLED === "true") {
    return { sent: false, provider: "demo", demoCode: code };
  }

  throw new Error("Provider SMS non configurato");
}
