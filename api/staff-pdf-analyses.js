import crypto from "node:crypto";
import { json, method } from "../lib/http.js";
import { cleanupExpiredPdfAnalyses } from "../lib/pdfArchive.js";

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireCronSecret(req, res) {
  const expected = String(process.env.CRON_SECRET || "").trim();
  const received = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!expected || !safeEqual(received, expected)) {
    json(res, 401, { ok: false, error: "Non autorizzato" });
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  if (!method(req, res, ["GET", "POST", "PATCH", "DELETE"])) return;

  const action = String(req.query?.action || "").trim().toLowerCase();
  if (action !== "cleanup") {
    return json(res, 404, { ok: false, error: "Not found" });
  }

  if (!["GET", "POST"].includes(req.method)) {
    return json(res, 405, { ok: false, error: "Metodo non consentito" });
  }
  if (!requireCronSecret(req, res)) return;

  try {
    const result = await cleanupExpiredPdfAnalyses({ limit: req.query?.limit || 100 });
    return json(res, 200, { ok: true, ...result });
  } catch {
    return json(res, 500, { ok: false, error: "Pulizia archivio non disponibile" });
  }
}
