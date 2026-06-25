const requiredForProduction = [
  "OTP_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
];

const hasStorage = Boolean(
  (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
  (process.env.UPSTASH_REDIS_KV_REST_API_URL && process.env.UPSTASH_REDIS_KV_REST_API_TOKEN) ||
  (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
);

const hasSmsProvider = Boolean(
  process.env.TWILIO_VERIFY_SERVICE_SID ||
  process.env.TWILIO_FROM_NUMBER ||
  (process.env.ARUBA_SMS_USER_KEY &&
    process.env.ARUBA_SMS_SENDER &&
    process.env.ARUBA_SMS_MESSAGE_TYPE &&
    (process.env.ARUBA_SMS_ACCESS_TOKEN || process.env.ARUBA_SMS_SESSION_KEY))
);

const missing = requiredForProduction.filter((key) => !process.env[key]);
if (!hasStorage) missing.push("Redis/Upstash REST URL + TOKEN");
if (!hasSmsProvider) missing.push("TWILIO_VERIFY_SERVICE_SID oppure altro provider SMS completo");

if (missing.length) {
  console.log("Variabili mancanti per produzione:");
  missing.forEach((key) => console.log(`- ${key}`));
  console.log("In sviluppo alcune possono mancare: OTP usa fallback demo e storage usa memoria temporanea.");
} else {
  console.log("Ambiente produzione completo.");
}
