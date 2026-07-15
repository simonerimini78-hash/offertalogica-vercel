import crypto from "node:crypto";
import { json, method } from "../lib/http.js";
import { requireStaffToken } from "../lib/staffAuth.js";
import {
  cleanupExpiredPdfAnalyses,
  createPdfSignedUrl,
  deletePdfAnalysis,
  listPdfAnalyses,
  updatePdfAnalysis,
} from "../lib/pdfArchive.js";

function bodyObject(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(String(req.body || "{}"));
  } catch {
    return {};
  }
}

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

  if (action === "cleanup") {
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

  if (!requireStaffToken(req, res)) return;

  try {
    if (action === "file") {
      if (req.method !== "GET") {
        return json(res, 405, { ok: false, error: "Metodo non consentito" });
      }
      const id = String(req.query?.id || "").trim();
      if (!id) return json(res, 400, { ok: false, error: "Analisi PDF mancante" });

      const signedUrl = await createPdfSignedUrl(id, 300);
      if (!signedUrl) return json(res, 404, { ok: false, error: "PDF non trovato" });
      return json(res, 200, { ok: true, signedUrl, expiresIn: 300 });
    }

    if (req.method === "GET") {
      const rows = await listPdfAnalyses({
        limit: req.query?.limit,
        status: String(req.query?.status || ""),
        provider: String(req.query?.provider || ""),
        reviewStatus: String(req.query?.reviewStatus || ""),
      });
      return json(res, 200, { ok: true, analyses: rows || [] });
    }

    const body = bodyObject(req);
    const id = String(body.id || req.query?.id || "").trim();
    if (!id) return json(res, 400, { ok: false, error: "Analisi PDF mancante" });

    if (req.method === "DELETE") {
      const result = await deletePdfAnalysis(id);
      return json(res, result.deleted ? 200 : 404, { ok: Boolean(result.deleted), ...result });
    }

    if (req.method !== "PATCH") {
      return json(res, 405, { ok: false, error: "Metodo non consentito" });
    }

    const updated = await updatePdfAnalysis(id, {
      confirmedData: body.confirmedData,
      correctionSummary: body.correctionSummary,
      reviewStatus: body.reviewStatus,
      staffNotes: body.staffNotes,
    });
    return json(res, 200, { ok: true, analysis: updated });
  } catch {
    return json(res, 500, { ok: false, error: "Archivio PDF non disponibile" });
  }
}
