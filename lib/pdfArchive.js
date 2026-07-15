import crypto from "node:crypto";
import fs from "node:fs/promises";

const DEFAULT_BUCKET = "pdf-test-archive";
const DEFAULT_RETENTION_DAYS = 180;

function cleanEnv(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

export function pdfArchiveConfig() {
  const mode = String(process.env.PDF_ARCHIVE_MODE || "off").trim().toLowerCase();
  const requestedRetention = Number(process.env.PDF_ARCHIVE_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);
  const retentionDays = Number.isFinite(requestedRetention)
    ? Math.max(1, Math.min(3650, requestedRetention))
    : DEFAULT_RETENTION_DAYS;
  return {
    mode: ["off", "all", "problematic"].includes(mode) ? mode : "off",
    bucket: String(process.env.PDF_ARCHIVE_BUCKET || DEFAULT_BUCKET).trim(),
    retentionDays,
    supabaseUrl: cleanEnv(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
    serviceRoleKey: cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY),
  };
}

function archiveConfigured(config = pdfArchiveConfig()) {
  return Boolean(config.mode !== "off" && config.bucket && config.supabaseUrl && config.serviceRoleKey);
}

function normalizedStatus(normalized, error) {
  if (error) return "failed";
  if (!normalized?.recognized) return "unrecognized";
  const diagnostics = Array.isArray(normalized?.diagnostics) ? normalized.diagnostics : [];
  const missingCount = diagnostics.filter((item) => item.status === "missing").length;
  const reviewCount = diagnostics.filter((item) => item.status === "review").length;
  if (normalized?.needsReview || (normalized?.warnings || []).length > 0 || reviewCount > 0 || missingCount > 0) return "partial";
  return "complete";
}

export function shouldArchivePdf({ normalized, error, mode = pdfArchiveConfig().mode } = {}) {
  if (mode === "all") return true;
  if (mode !== "problematic") return false;
  return normalizedStatus(normalized, error) !== "complete";
}

function supabaseHeaders(config, extra = {}) {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    ...extra,
  };
}

async function supabaseRequest(path, init = {}, config = pdfArchiveConfig()) {
  if (!archiveConfigured({ ...config, mode: config.mode === "off" ? "all" : config.mode })) {
    throw new Error("Archivio PDF non configurato");
  }
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    ...init,
    headers: supabaseHeaders(config, init.headers || {}),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Supabase PDF archive ${response.status}: ${body.slice(0, 300)}`);
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("application/json") ? response.json() : response.text();
}

function safeFileName(value) {
  const base = String(value || "documento.pdf").split(/[\\/]/).pop() || "documento.pdf";
  return base.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) || "documento.pdf";
}

function storageObjectPath(fileHash) {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}/${month}/${fileHash}.pdf`;
}

function encodeStoragePath(path) {
  return String(path).split("/").map(encodeURIComponent).join("/");
}

async function uploadPdf(buffer, storagePath, config) {
  return supabaseRequest(
    `/storage/v1/object/${encodeURIComponent(config.bucket)}/${encodeStoragePath(storagePath)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/pdf",
        "x-upsert": "true",
        "cache-control": "private, max-age=0, no-store",
      },
      body: buffer,
    },
    config,
  );
}

async function insertPdfAnalysis(record, config) {
  const result = await supabaseRequest(
    "/rest/v1/pdf_analyses",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(record),
    },
    config,
  );
  return Array.isArray(result) ? result[0] : result;
}

export async function archivePdfAnalysis({
  filePath,
  originalFilename,
  mimeType = "application/pdf",
  fileSize,
  normalized = null,
  error = null,
  context = {},
} = {}) {
  const config = pdfArchiveConfig();
  if (!archiveConfigured(config)) return { stored: false, reason: "disabled" };
  if (!shouldArchivePdf({ normalized, error, mode: config.mode })) return { stored: false, reason: "mode_filtered" };
  if (!filePath) return { stored: false, reason: "missing_file" };

  const buffer = await fs.readFile(filePath);
  const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
  const storagePath = storageObjectPath(fileHash);
  const analysisId = crypto.randomUUID();
  const status = normalizedStatus(normalized, error);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + config.retentionDays * 86_400_000);

  await uploadPdf(buffer, storagePath, config);
  const record = {
    id: analysisId,
    created_at: createdAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    parser_version: normalized?.parser_version || "unknown",
    archive_mode: config.mode,
    status,
    review_status: "pending",
    original_file_name: safeFileName(originalFilename),
    storage_bucket: config.bucket,
    storage_path: storagePath,
    file_sha256: fileHash,
    file_size: Number(fileSize || buffer.length),
    mime_type: mimeType || "application/pdf",
    kind: normalized?.kind || "unknown",
    commodity: normalized?.commodity || "unknown",
    provider: normalized?.fornitore || "",
    recognized: Boolean(normalized?.recognized),
    confidence: normalized?.confidence || "low",
    text_length: Number(normalized?.textExtracted || 0),
    page_count: Number(normalized?.page_count || 0) || null,
    warnings: normalized?.warnings || [],
    normalized_data: normalized || {},
    diagnostics: normalized?.diagnostics || [],
    confirmed_data: {},
    correction_summary: {},
    staff_notes: "",
    source_context: {
      sessionId: String(context?.sessionId || "").slice(0, 120),
      staffMode: Boolean(context?.staffMode),
      customerType: String(context?.customerType || "").slice(0, 40),
      uploadSequence: Number(context?.uploadSequence || 0) || null,
    },
    error_code: error ? String(error?.code || error?.name || "pdf_analysis_error").slice(0, 120) : "",
    error_message: error ? String(error?.message || "Errore analisi PDF").slice(0, 500) : "",
  };

  const saved = await insertPdfAnalysis(record, config);
  return {
    stored: true,
    analysisId: saved?.id || analysisId,
    status,
    expiresAt: saved?.expires_at || expiresAt.toISOString(),
  };
}

function staffConfig() {
  const config = pdfArchiveConfig();
  if (!config.supabaseUrl || !config.serviceRoleKey) throw new Error("Supabase non configurato");
  return { ...config, mode: config.mode === "off" ? "all" : config.mode };
}

export async function listPdfAnalyses({ limit = 100, status = "", provider = "", reviewStatus = "" } = {}) {
  const config = staffConfig();
  const params = new URLSearchParams({
    select: "id,created_at,expires_at,parser_version,status,review_status,original_file_name,storage_path,file_sha256,file_size,kind,commodity,provider,recognized,confidence,text_length,page_count,warnings,normalized_data,diagnostics,confirmed_data,correction_summary,staff_notes,error_code,error_message,source_context",
    order: "created_at.desc",
    limit: String(Math.max(1, Math.min(500, Number(limit) || 100))),
  });
  if (status) params.set("status", `eq.${status}`);
  if (provider) params.set("provider", `ilike.*${provider.replace(/[*,]/g, "")}*`);
  if (reviewStatus) params.set("review_status", `eq.${reviewStatus}`);
  return supabaseRequest(`/rest/v1/pdf_analyses?${params.toString()}`, { method: "GET" }, config);
}

export async function getPdfAnalysis(id) {
  const config = staffConfig();
  const params = new URLSearchParams({ select: "*", id: `eq.${id}`, limit: "1" });
  const rows = await supabaseRequest(`/rest/v1/pdf_analyses?${params.toString()}`, { method: "GET" }, config);
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function updatePdfAnalysis(id, { confirmedData = {}, correctionSummary = {}, reviewStatus = "reviewed", staffNotes = "" } = {}) {
  const config = staffConfig();
  const allowedReviewStatus = ["pending", "reviewed", "test_case", "discarded"].includes(reviewStatus) ? reviewStatus : "reviewed";
  const params = new URLSearchParams({ id: `eq.${id}` });
  const rows = await supabaseRequest(
    `/rest/v1/pdf_analyses?${params.toString()}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({
        confirmed_data: confirmedData && typeof confirmedData === "object" ? confirmedData : {},
        correction_summary: correctionSummary && typeof correctionSummary === "object" ? correctionSummary : {},
        review_status: allowedReviewStatus,
        staff_notes: String(staffNotes || "").slice(0, 4000),
        reviewed_at: new Date().toISOString(),
      }),
    },
    config,
  );
  return Array.isArray(rows) ? rows[0] || null : rows;
}

async function deleteStorageObject(storagePath, config) {
  return supabaseRequest(
    `/storage/v1/object/${encodeURIComponent(config.bucket)}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [storagePath] }),
    },
    config,
  );
}

export async function deletePdfAnalysis(id) {
  const config = staffConfig();
  const analysis = await getPdfAnalysis(id);
  if (!analysis) return { deleted: false, reason: "not_found" };

  const query = new URLSearchParams({
    select: "id",
    storage_path: `eq.${analysis.storage_path}`,
    id: `neq.${id}`,
    limit: "1",
  });
  const otherRows = await supabaseRequest(`/rest/v1/pdf_analyses?${query.toString()}`, { method: "GET" }, config);
  const params = new URLSearchParams({ id: `eq.${id}` });
  await supabaseRequest(`/rest/v1/pdf_analyses?${params.toString()}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }, config);
  if (!Array.isArray(otherRows) || otherRows.length === 0) {
    await deleteStorageObject(analysis.storage_path, config).catch(() => {});
  }
  return { deleted: true };
}

export async function createPdfSignedUrl(id, expiresIn = 300) {
  const config = staffConfig();
  const analysis = await getPdfAnalysis(id);
  if (!analysis?.storage_path) return null;
  const result = await supabaseRequest(
    `/storage/v1/object/sign/${encodeURIComponent(analysis.storage_bucket || config.bucket)}/${encodeStoragePath(analysis.storage_path)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: Math.max(60, Math.min(1800, Number(expiresIn) || 300)) }),
    },
    config,
  );
  const signedPath = result?.signedURL || result?.signedUrl || result?.url;
  if (!signedPath) return null;
  return signedPath.startsWith("http") ? signedPath : `${config.supabaseUrl}/storage/v1${signedPath.startsWith("/") ? "" : "/"}${signedPath}`;
}

export async function cleanupExpiredPdfAnalyses({ limit = 100 } = {}) {
  const config = staffConfig();
  const params = new URLSearchParams({
    select: "id",
    expires_at: `lt.${new Date().toISOString()}`,
    order: "expires_at.asc",
    limit: String(Math.max(1, Math.min(500, Number(limit) || 100))),
  });
  const rows = await supabaseRequest(`/rest/v1/pdf_analyses?${params.toString()}`, { method: "GET" }, config);
  const results = [];
  for (const row of rows || []) {
    results.push(await deletePdfAnalysis(row.id));
  }
  return { processed: results.length, deleted: results.filter((item) => item.deleted).length };
}
