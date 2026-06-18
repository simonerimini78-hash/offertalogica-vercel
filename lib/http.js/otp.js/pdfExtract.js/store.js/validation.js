export function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));import fs from "node:fs/promises";
import pdfParse from "pdf-parse";

function numberFromItalian(value) {
  if (!value) return null;
  const normalized = String(value).replace(/\./g, "").replace(",", ".");export function normalizePhone(value) {
  const digits = String(value || "").replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.length >= 8) return `+39${digits}`;
  return digits;
}

export function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

export function sanitizeLead(input) {
  const name = String(input.name || input.nome || "").trim().slice(0, 120);
  const email = String(input.email || "").trim().toLowerCase().slice(0, 160);
  const phone = normalizePhone(input.phone || input.telefono || "");
  const consentService = Boolean(input.consentService ?? input.consensoServizio ?? input.consent);
  const consentMarketing = Boolean(input.consentMarketing ?? input.consensoMarketing);

  if (!name) throw new Error("Nome obbligatorio");
  if (!validEmail(email)) throw new Error("Email non valida");
  if (phone.replace(/\D/g, "").length < 8) throw new Error("Telefono non valido");
  if (!consentService) throw new Error("Consenso servizio obbligatorio");

  return { name, email, phone, consentService, consentMarketing };
}

  const number = Number.parseFloat(normalized);const memory = new Map();

const hasKv = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

async function kv(command, ...args) {
  const url = `${process.env.KV_REST_API_URL}/${command}/${args.map(encodeURIComponent).join("/")}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  if (!response.ok) throw new Error(`KV error ${response.status}`);
  const payload = await response.json();
  return payload.result;
}

export async function setJson(key, value, ttlSeconds) {
  const serialized = JSON.stringify(value);
  if (hasKv) {
    if (ttlSeconds) return kv("set", key, serialized, "EX", String(ttlSeconds));
    return kv("set", key, serialized);
  }
  memory.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
  return true;
}

export async function getJson(key) {
  if (hasKv) {
    const result = await kv("get", key);
    return result ? JSON.parse(result) : null;
  }
  const item = memory.get(key);
  if (!item) return null;
  if (item.expiresAt && item.expiresAt < Date.now()) {
    memory.delete(key);
    return null;
  }
  return item.value;
}

export async function del(key) {
  if (hasKv) return kv("del", key);
  memory.delete(key);
  return true;
}

  return Number.isFinite(number) ? number : null;
}

function matchNumber(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return numberFromItalian(match[1]);
  }
  return null;
}

function matchText(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return String(match[1] || "").trim();
  }
  return null;
}

function detectProvider(text) {
  const lowered = text.toLowerCase();
  if (lowered.includes("dolomiti energia")) return "Dolomiti Energia";
  if (lowered.includes("hera")) return "Hera Comm";
  if (lowered.includes("butangas")) return "ButanGas";
  if (lowered.includes("e.on")) return "E.ON";
  if (lowered.includes("acea")) return "Acea Energia";
  if (lowered.includes("pulsee")) return "Pulsee";
  if (lowered.includes("illumia")) return "Illumia";
  if (lowered.includes("enel energia")) return "Enel Energia";
  if (lowered.includes("eni plenitude") || lowered.includes("plenitude")) return "Eni Plenitude";
  return "";
}

export async function extractPdf(filePath) {
  const buffer = await fs.readFile(filePath);
  const parsed = await pdfParse(buffer);
  const text = parsed.text || "";
  const lower = text.toLowerCase();
  const commodity = lower.includes("gas naturale") || lower.includes("smc") ? "gas" : "luce";

  const consumoLuce = matchNumber(text, [
    /consumo annuo[^\d]{0,80}([\d.,]+)\s*kwh/i,
    /consumo annuo \(kwh\)[^\d]{0,30}([\d.,]+)/i,
    /consumo rilevato annuo[^\d]{0,80}([\d.,]+)\s*kwh/i,
  ]);
  const consumoGas = matchNumber(text, [
    /consumo annuo[^\d]{0,80}([\d.,]+)\s*smc/i,
    /consumo annuo \(mc\)[^\d]{0,30}([\d.,]+)/i,
    /consumo annuo[^\d]{0,80}([\d.,]+)\s*mc/i,
  ]);
  const prezzoLuce = matchNumber(text, [
    /spesa per (?:la )?(?:vendita )?(?:energia elettrica|materia energia)[\s\S]{0,160}?([\d.,]+)\s*€\/kwh/i,
    /di cui spesa per (?:vendita )?(?:energia elettrica|materia energia)[^\d]{0,80}([\d.,]+)\s*€\/kwh/i,
    /corrispettivo (?:energia|per il consumo)[^\d]{0,80}([\d.,]+)\s*€\/kwh/i,
    /([\d.,]+)\s*€\/kwh/i,
  ]);
  const prezzoGas = matchNumber(text, [
    /spesa per (?:la )?(?:vendita )?gas naturale[\s\S]{0,160}?([\d.,]+)\s*€\/smc/i,
    /di cui spesa per (?:vendita )?gas naturale[^\d]{0,80}([\d.,]+)\s*€\/smc/i,
    /corrispettivo (?:gas|per il consumo)[^\d]{0,80}([\d.,]+)\s*€\/smc/i,
    /([\d.,]+)\s*€\/smc/i,
  ]);
  const fissoMese = matchNumber(text, [
    /spesa per (?:la )?(?:vendita )?(?:energia elettrica|gas naturale|materia energia)[\s\S]{0,160}?([\d.,]+)\s*€\/mese/i,
    /di cui spesa per (?:vendita )?(?:energia elettrica|gas naturale)[^\d]{0,100}([\d.,]+)\s*€\/mese/i,
    /corrispettivo (?:annuo|fisso)[^\d]{0,80}([\d.,]+)\s*€\/anno/i,
    /([\d.,]+)\s*€\/mese/i,
    /([\d.,]+)\s*euro\/mese/i,
  ]);
  const fissoAnno = text.match(/corrispettivo (?:annuo|fisso)[^\d]{0,80}([\d.,]+)\s*€\/anno/i)
    ? matchNumber(text, [/corrispettivo (?:annuo|fisso)[^\d]{0,80}([\d.,]+)\s*€\/anno/i])
    : null;
  const pod = matchText(text, [
    /codice\s+pod[:\s]+([A-Z0-9]{10,})/i,
    /\bPOD[:\s]+([A-Z0-9]{10,})/i,
  ]);
  const pdr = matchText(text, [
    /codice\s+pdr[:\s]+([0-9]{8,})/i,
    /\bPDR[:\s]+([0-9]{8,})/i,
  ]);
  const fixedAnnual = fissoAnno || (fissoMese ? fissoMese * 12 : null);

  return {
    kind: lower.includes("scheda sintetica") ? "scheda_offerta" : "bolletta",
    commodity,
    fornitore: detectProvider(text),
    consumo_luce_kwh: consumoLuce,
    consumo_gas_smc: consumoGas,
    prezzo_luce_eur_kwh: prezzoLuce,
    prezzo_gas_eur_smc: prezzoGas,
    quota_fissa_vendita_luce_eur_anno: commodity === "luce" ? fixedAnnual : null,
    quota_fissa_vendita_gas_eur_anno: commodity === "gas" ? fixedAnnual : null,
    pod,
    pdr,
    textExtracted: text.length,
    needsReview: true,
  };
}

}

export function method(req, res, allowed) {
  if (allowed.includes(req.method)) return true;
  res.setHeader("Allow", allowed.join(", "));
  json(res, 405, { ok: false, error: "Metodo non consentito" });import crypto from "node:crypto";

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

  return false;
}

export async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();
}
