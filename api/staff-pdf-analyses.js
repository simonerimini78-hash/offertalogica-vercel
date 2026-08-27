import crypto from "node:crypto";
import { json, method, requireAllowedOrigin } from "../lib/http.js";
import { requireStaffSession } from "../lib/staffSessionAuth.js";
import { writeStaffAudit } from "../lib/staffAudit.js";
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

async function requireMutationAudit(res, identity, payload) {
  try {
    await writeStaffAudit({ identity, ...payload, source: "api:staff-pdf-analyses" });
    return true;
  } catch (error) {
    console.error("[staff-pdf-audit-required]", String(error?.message || error || "unknown_error"));
    json(res, 503, { ok: false, error: "Audit Staff non disponibile: operazione annullata" });
    return false;
  }
}

async function writeMutationResultAudit(identity, payload) {
  try {
    await writeStaffAudit({ identity, ...payload, source: "api:staff-pdf-analyses" });
  } catch (error) {
    console.error("[staff-pdf-audit-result]", String(error?.message || error || "unknown_error"));
  }
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

  const permissions = req.method === "DELETE"
    ? ["view_pdf_diagnostics", "delete_records"]
    : req.method === "PATCH"
      ? ["view_pdf_diagnostics", "manage_checks"]
      : ["view_pdf_diagnostics"];

  const identity = await requireStaffSession(req, res, {
    roles: req.method === "DELETE" ? ["admin"] : ["reviewer", "admin"],
    permissions,
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
    const ids = Array.isArray(body.ids) ? body.ids.map(value => String(value || "").trim()).filter(Boolean) : [];
    const resetAll = body.scope === "all" || String(req.query?.scope || "") === "all";

    if (req.method === "DELETE") {
      const confirmation = String(req.headers["x-staff-confirmation"] || "").trim();
      if (resetAll) {
        if (confirmation !== "AZZERA_ARCHIVIO_PDF") {
          return json(res, 400, { ok: false, error: "Conferma eliminazione non valida" });
        }
        if (!(await requireMutationAudit(res, identity, {
          action: "pdf_archive_delete_authorized",
          targetType: "pdf_analysis",
          targetId: "all",
          result: "success",
          reason: "Azzeramento archivio diagnostico PDF autorizzato dal Control Center",
          metadata: { mode: "reset_all" },
        }))) return;

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
        await writeMutationResultAudit(identity, {
          action: "pdf_archive_deleted",
          targetType: "pdf_analysis",
          targetId: "all",
          result: "success",
          reason: "Archivio diagnostico PDF azzerato dal Control Center",
          metadata: { mode: "reset_all", requested, deleted },
        });
        return json(res, 200, { ok: true, requested, deleted, resetAll: true });
      }
      if (ids.length) {
        if (confirmation !== "ELIMINA_PDF_VISIBILI") {
          return json(res, 400, { ok: false, error: "Conferma eliminazione non valida" });
        }
        if (!(await requireMutationAudit(res, identity, {
          action: "pdf_batch_delete_authorized",
          targetType: "pdf_analysis",
          targetId: `batch:${ids.length}`,
          result: "success",
          reason: "Eliminazione analisi PDF visibili autorizzata dal Control Center",
          metadata: { mode: "visible_batch", requested: ids.length },
        }))) return;
        const result = await deletePdfAnalyses(ids);
        await writeMutationResultAudit(identity, {
          action: "pdf_batch_deleted",
          targetType: "pdf_analysis",
          targetId: `batch:${ids.length}`,
          result: "success",
          reason: "Analisi PDF visibili eliminate dal Control Center",
          metadata: { mode: "visible_batch", requested: result.requested || ids.length, deleted: result.deleted || 0 },
        });
        return json(res, 200, { ok: true, ...result, resetAll: false });
      }
      if (!id) return json(res, 400, { ok: false, error: "Analisi PDF mancante" });
      if (confirmation !== "ELIMINA_PDF") {
        return json(res, 400, { ok: false, error: "Conferma eliminazione non valida" });
      }
      if (!(await requireMutationAudit(res, identity, {
        action: "pdf_analysis_delete_authorized",
        targetType: "pdf_analysis",
        targetId: id,
        result: "success",
        reason: "Eliminazione analisi PDF autorizzata dal Control Center",
        metadata: { mode: "single" },
      }))) return;
      const result = await deletePdfAnalysis(id);
      await writeMutationResultAudit(identity, {
        action: "pdf_analysis_deleted",
        targetType: "pdf_analysis",
        targetId: id,
        result: result.deleted ? "success" : "error",
        reason: result.deleted ? "Analisi PDF eliminata dal Control Center" : "Analisi PDF non trovata durante l’eliminazione",
        metadata: { mode: "single", deleted: Boolean(result.deleted) },
      });
      return json(res, result.deleted ? 200 : 404, { ok: Boolean(result.deleted), ...result });
    }

    if (!id) return json(res, 400, { ok: false, error: "Analisi PDF mancante" });

    if (req.method !== "PATCH") {
      return json(res, 405, { ok: false, error: "Metodo non consentito" });
    }

    const changedFields = [
      ["confirmedData", body.confirmedData],
      ["correctionSummary", body.correctionSummary],
      ["reviewStatus", body.reviewStatus],
      ["staffNotes", body.staffNotes],
    ].filter(([, value]) => value !== undefined).map(([key]) => key);

    if (!(await requireMutationAudit(res, identity, {
      action: "pdf_analysis_modify_authorized",
      targetType: "pdf_analysis",
      targetId: id,
      result: "success",
      reason: "Modifica diagnostica PDF autorizzata dal Control Center",
      metadata: { changed_fields: changedFields },
    }))) return;

    const updated = await updatePdfAnalysis(id, {
      confirmedData: body.confirmedData,
      correctionSummary: body.correctionSummary,
      reviewStatus: body.reviewStatus,
      staffNotes: body.staffNotes,
    });
    await writeMutationResultAudit(identity, {
      action: "pdf_analysis_modified",
      targetType: "pdf_analysis",
      targetId: id,
      result: "success",
      reason: "Diagnostica PDF modificata dal Control Center",
      metadata: { changed_fields: changedFields },
    });
    return json(res, 200, { ok: true, analysis: updated });
  } catch (error) {
    console.error("[staff-pdf-archive-error]", String(error?.message || error || "unknown_error"));
    return json(res, 500, {
      ok: false,
      error: req.method === "DELETE" ? "Eliminazione archivio PDF non riuscita" : "Archivio PDF non disponibile",
    });
  }
}
