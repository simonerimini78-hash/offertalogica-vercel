export function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function configuredOrigins() {
  const defaults = [
    "https://offertalogica.it",
    "https://www.offertalogica.it",
    "https://offertalogica-vercel.vercel.app",
  ];
  const custom = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([...defaults, ...custom]);
}

export function requireAllowedOrigin(req, res) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return true;
  if (configuredOrigins().has(origin)) return true;
  json(res, 403, { ok: false, error: "Origine richiesta non autorizzata" });
  return false;
}

export function method(req, res, allowed) {
  if (allowed.includes(req.method)) return true;
  res.setHeader("Allow", allowed.join(", "));
  json(res, 405, { ok: false, error: "Metodo non consentito" });
  return false;
}

export async function readJson(req) {
  const chunks = [];
  const maxBytes = Number(process.env.MAX_JSON_BYTES || 200_000);
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) throw new Error("Richiesta troppo grande");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();
}
