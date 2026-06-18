const requiredForProduction = [
  "OTP_SECRET",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
];

const missing = requiredForProduction.filter((key) => !process.env[key]);
if (missing.length) {
  console.log("Variabili mancanti per produzione:");
  missing.forEach((key) => console.log(`- ${key}`));
  console.log("In sviluppo alcune possono mancare: OTP usa fallback demo e storage usa memoria temporanea.");
} else {
  console.log("Ambiente produzione completo.");
}
