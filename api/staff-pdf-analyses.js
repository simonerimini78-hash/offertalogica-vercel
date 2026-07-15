import { json, method } from "../lib/http.js";
import { requireStaffToken } from "../lib/staffAuth.js";
import {
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

export default async function handler(req, res) {
  if (!method(req, res, ["GET", "PATCH", "DELETE"])) return;
  if (!requireStaffToken(req, res)) return;

  try {
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

    const updated = await updatePdfAnalysis(id, {
      confirmedData: body.confirmedData,
      correctionSummary: body.correctionSummary,
      reviewStatus: body.reviewStatus,
      staffNotes: body.staffNotes,
    });
    return json(res, 200, { ok: true, analysis: updated });
  } catch (error) {
    return json(res, 500, { ok: false, error: "Archivio PDF non disponibile" });
  }
}
