export function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function normalizeConfiguredOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    return parsed.origin;
  } catch {
    return "";
  }
}

function configuredOrigins() {
  const defaults = [
    "https://offertalogica.it",
    "https://www.offertalogica.it",
    "https://offertalogica-vercel.vercel.app",
  ];
  const custom = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => normalizeConfiguredOrigin(origin))
    .filter(Boolean);
  const vercel = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ]
    .map((origin) => normalizeConfiguredOrigin(origin))
    .filter(Boolean);
  return new Set([...defaults, ...custom, ...vercel]);
}

function requestHost(req) {
  return String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
}

function isSameDeploymentOrigin(req, origin) {
  const host = requestHost(req);
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

export function requireAllowedOrigin(req, res) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return true;
  const normalizedOrigin = normalizeConfiguredOrigin(origin);
  if (!normalizedOrigin) {
    json(res, 403, { ok: false, error: "Origine richiesta non autorizzata" });
    return false;
  }
  if (configuredOrigins().has(normalizedOrigin)) return true;
  if (isSameDeploymentOrigin(req, normalizedOrigin)) return true;
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
