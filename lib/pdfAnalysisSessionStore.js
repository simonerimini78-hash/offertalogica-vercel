import crypto from "node:crypto";
import { del, getJson, persistentStoreConfigured, setJson } from "./store.js";
import { mirrorPdfAnalysisSession } from "./pdfAnalysisSessionAudit.js";

export const PDF_ANALYSIS_SESSION_VERSION = "step8-session-v2-page-by-page";
const DEFAULT_TTL_SECONDS = 3600;
const SESSION_PREFIX = "pdf-analysis-session:v2:";

function ttlSeconds(env = process.env) {
  const parsed = Number.parseInt(env.PDF_ANALYSIS_SESSION_TTL_SECONDS || String(DEFAULT_TTL_SECONDS), 10);
  return Number.isFinite(parsed) ? Math.max(600, Math.min(86_400, parsed)) : DEFAULT_TTL_SECONDS;
}

function sessionKey(id) {
  return `${SESSION_PREFIX}${id}`;
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function productionRuntime(env = process.env) {
  return env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
}

export function pdfSessionPersistenceReady(env = process.env) {
  return persistentStoreConfigured() || !productionRuntime(env);
}

export async function createPdfAnalysisSession({ filename, originalBytes = 0, expectedPageCount = 0, archiveContext = {}, baseline = null, env = process.env } = {}) {
  if (!pdfSessionPersistenceReady(env)) throw new Error("pdf_session_store_not_configured");
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const ttl = ttlSeconds(env);
  const expiresAt = new Date(now.getTime() + ttl * 1000);
  const session = {
    version: PDF_ANALYSIS_SESSION_VERSION,
    id,
    token_hash: tokenHash(token),
    status: "uploading",
    revision: 1,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    filename: String(filename || "documento.pdf").slice(0, 180),
    original_bytes: Number(originalBytes || 0),
    expected_page_count: Number(expectedPageCount || 0),
    archive_context: archiveContext && typeof archiveContext === "object" ? archiveContext : {},
    baseline: baseline && typeof baseline === "object" ? baseline : null,
    archive: null,
    pages: [],
    plan: [],
    answers: {},
    final: null,
    errors: [],
  };
  await setJson(sessionKey(id), session, ttl);
  await mirrorPdfAnalysisSession(session, env).catch(() => {});
  return { session, token };
}

export async function readPdfAnalysisSession(id, token, { env = process.env, allowExpired = false } = {}) {
  const session = await getJson(sessionKey(id));
  if (!session) throw new Error("pdf_session_not_found");
  if (!secureEqual(session.token_hash, tokenHash(token))) throw new Error("pdf_session_unauthorized");
  if (!allowExpired && session.expires_at && Date.parse(session.expires_at) <= Date.now()) {
    throw new Error("pdf_session_expired");
  }
  return session;
}

export async function savePdfAnalysisSession(session, { env = process.env } = {}) {
  if (!session?.id) throw new Error("pdf_session_id_missing");
  const ttl = ttlSeconds(env);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttl * 1000);
  const next = {
    ...session,
    revision: Number(session.revision || 0) + 1,
    updated_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };
  await setJson(sessionKey(session.id), next, ttl);
  await mirrorPdfAnalysisSession(next, env).catch(() => {});
  return next;
}

export async function deletePdfAnalysisSession(id) {
  if (!id) return false;
  await del(sessionKey(id));
  return true;
}

export function publicPdfAnalysisSession(session = {}) {
  const answers = Object.values(session.answers || {});
  return {
    analysisId: session.id || null,
    status: session.status || "unknown",
    filename: session.filename || "documento.pdf",
    expectedPageCount: Number(session.expected_page_count || 0),
    uploadedPageCount: Array.isArray(session.pages) ? session.pages.length : 0,
    questionCount: Array.isArray(session.plan) ? session.plan.length : 0,
    completedQuestionCount: answers.filter((item) => ["completed", "not_found", "conflict", "failed", "skipped"].includes(item?.status)).length,
    acceptedQuestionCount: answers.filter((item) => item?.status === "completed").length,
    expiresAt: session.expires_at || null,
    finalReady: Boolean(session.final?.normalized),
  };
}
