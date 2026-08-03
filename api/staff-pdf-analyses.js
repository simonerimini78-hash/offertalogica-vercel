import crypto from "node:crypto";
import { json, method, requireAllowedOrigin } from "../lib/http.js";
import { requireStaffSession } from "../lib/staffSessionAuth.js";
import {
  cleanupExpiredPdfAnalyses,
  createPdfSignedUrl,
  deletePdfAnalysis,
  deletePdfAnalyses,
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

  const identity = await requireStaffSession(req, res, {
    roles: req.method === "DELETE" ? ["admin"] : ["reviewer", "admin"],
  });
  if (!identity) return;
  if (["PATCH", "DELETE"].includes(req.method) && !requireAllowedOrigin(req, res)) return;

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
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const resetAll = body.scope === "all" || String(req.query?.scope || "") === "all";

    if (req.method === "DELETE") {
      const confirmation = String(req.headers["x-staff-confirmation"] || "").trim();
      if (resetAll) {
        if (confirmation !== "AZZERA_ARCHIVIO_PDF") {
          return json(res, 400, { ok: false, error: "Conferma eliminazione non valida" });
        }
        let requested = 0;
        let deleted = 0;
        for (let batch = 0; batch < 20; batch += 1) {
          const allRows = await listPdfAnalyses({ limit: 500 });
          if (!Array.isArray(allRows) || allRows.length === 0) break;
          const result = await deletePdfAnalyses(allRows.map(row => row.id));
          requested += result.requested || 0;
          deleted += result.deleted || 0;
          if (allRows.length < 500) break;
        }
        return json(res, 200, { ok: true, requested, deleted, resetAll: true });
      }
      if (ids.length) {
        if (confirmation !== "ELIMINA_PDF_VISIBILI") {
          return json(res, 400, { ok: false, error: "Conferma eliminazione non valida" });
        }
        const result = await deletePdfAnalyses(ids);
        return json(res, 200, { ok: true, ...result, resetAll: false });
      }
      if (!id) return json(res, 400, { ok: false, error: "Analisi PDF mancante" });
      if (confirmation && confirmation !== "ELIMINA_PDF") {
        return json(res, 400, { ok: false, error: "Conferma eliminazione non valida" });
      }
      const result = await deletePdfAnalysis(id);
      return json(res, result.deleted ? 200 : 404, { ok: Boolean(result.deleted), ...result });
    }

    if (!id) return json(res, 400, { ok: false, error: "Analisi PDF mancante" });

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
