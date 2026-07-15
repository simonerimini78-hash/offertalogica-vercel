import crypto from "node:crypto";
import { json, method } from "../lib/http.js";
import { cleanupExpiredPdfAnalyses } from "../lib/pdfArchive.js";

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (!method(req, res, ["GET", "POST"])) return;
  const expected = String(process.env.CRON_SECRET || "").trim();
  const received = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!expected || !safeEqual(received, expected)) return json(res, 401, { ok: false, error: "Non autorizzato" });

  try {
    const result = await cleanupExpiredPdfAnalyses({ limit: req.query?.limit || 100 });
    return json(res, 200, { ok: true, ...result });
  } catch {
    return json(res, 500, { ok: false, error: "Pulizia archivio non disponibile" });
  }
}
