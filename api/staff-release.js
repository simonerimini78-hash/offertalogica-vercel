const RELEASE_VERSION = "0.36.55";

function normalizeOrigin(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).origin;
  } catch {
    return "";
  }
}

export default function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Cache-Control, Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const deploymentUrl = normalizeOrigin(process.env.VERCEL_URL);
  const productionUrl = normalizeOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(200).json({
    ok: true,
    version: RELEASE_VERSION,
    channel: "production",
    deploymentUrl,
    productionUrl,
  });
}
