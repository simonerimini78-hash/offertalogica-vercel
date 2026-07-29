const requiredForProduction = [
  "OTP_SECRET",
  "OPENAI_API_KEY",
];

const hasStorage = Boolean(
  (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
  (process.env.UPSTASH_REDIS_KV_REST_API_URL && process.env.UPSTASH_REDIS_KV_REST_API_TOKEN) ||
  (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
);

const arubaUsername =
  process.env.ARUBA_SMS_USERNAME ||
  process.env.ARUBA_SMS_LOGIN_USERNAME ||
  (String(process.env.ARUBA_SMS_USER_KEY || "").includes("@") ? process.env.ARUBA_SMS_USER_KEY : "");
const arubaPassword =
  process.env.ARUBA_SMS_API_PASSWORD ||
  process.env.ARUBA_SMS_PASSWORD ||
  process.env.ARUBA_API_PASSWORD;
const arubaDirectUserKey = arubaUsername ? "" : process.env.ARUBA_SMS_USER_KEY;
const hasArubaAuth = Boolean(
  (arubaUsername && arubaPassword) ||
  (arubaDirectUserKey && (process.env.ARUBA_SMS_ACCESS_TOKEN || process.env.ARUBA_SMS_SESSION_KEY))
);
const hasSmsProvider = Boolean(
  (process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    (process.env.TWILIO_VERIFY_SERVICE_SID || process.env.TWILIO_FROM_NUMBER)) ||
  (hasArubaAuth &&
    process.env.ARUBA_SMS_SENDER &&
    process.env.ARUBA_SMS_MESSAGE_TYPE)
);

const missing = requiredForProduction.filter((key) => !process.env[key]);
if (!hasStorage) missing.push("Redis/Upstash REST URL + TOKEN");
if (!hasSmsProvider) missing.push("provider SMS Aruba o Twilio completo");

const archiveMode = String(process.env.PDF_ARCHIVE_MODE || "off").trim().toLowerCase();
if (archiveMode !== "off") {
  if (!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    missing.push("SUPABASE_URL per archivio PDF");
  }
  if (!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY)) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY per archivio PDF");
  }
}

if (missing.length) {
  console.log("Variabili mancanti per produzione:");
  missing.forEach((key) => console.log(`- ${key}`));
  console.log("In sviluppo alcune possono mancare: OTP usa fallback demo e storage usa memoria temporanea.");
} else {
  console.log("Ambiente produzione completo.");
}
