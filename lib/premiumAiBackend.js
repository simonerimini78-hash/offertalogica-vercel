import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_BUCKET = "premium-bills";
const ALLOWED_STAFF_ROLES = new Set(["reviewer", "admin"]);
const PREMIUM_MODEL_PRICING_EUR_PER_MILLION = Object.freeze({
  "gpt-4.1": Object.freeze({
    inputPerMillion: 2,
    cachedInputPerMillion: 0.5,
    outputPerMillion: 8,
  }),
  "gpt-4.1-2025-04-14": Object.freeze({
    inputPerMillion: 2,
    cachedInputPerMillion: 0.5,
    outputPerMillion: 8,
  }),
});
const PREMIUM_PRICING_ENV = Object.freeze({
  inputPerMillion: "PREMIUM_AI_INPUT_EUR_PER_1M_TOKENS",
  cachedInputPerMillion: "PREMIUM_AI_CACHED_INPUT_EUR_PER_1M_TOKENS",
  outputPerMillion: "PREMIUM_AI_OUTPUT_EUR_PER_1M_TOKENS",
});
export const PREMIUM_CURRENT_ACCEPTANCE_VERSIONS = Object.freeze({
  terms: "premium-terms-v0.36.6-2026-08-04",
  privacy: "premium-privacy-v0.36.6-2026-08-04",
  cloud_storage: "premium-cloud-ai-v0.36.6-2026-08-04",
});

function cleanBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function positiveNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function resolvePremiumAiPricing(env = process.env, model = "") {
  const normalizedModel = String(model || "").trim().toLowerCase();
  const modelDefaults = PREMIUM_MODEL_PRICING_EUR_PER_MILLION[normalizedModel] || null;
  const pricing = {};
  const sources = {};
  const missing = [];

  for (const [field, envName] of Object.entries(PREMIUM_PRICING_ENV)) {
    const configured = positiveNumber(env?.[envName]);
    if (configured !== null) {
      pricing[field] = configured;
      sources[field] = "environment";
      continue;
    }
    const fallback = positiveNumber(modelDefaults?.[field]);
    if (fallback !== null) {
      pricing[field] = fallback;
      sources[field] = "model_default";
      continue;
    }
    pricing[field] = null;
    sources[field] = "missing";
    missing.push(envName);
  }

  return {
    ...pricing,
    complete: missing.length === 0,
    sources,
    missing,
    modelDefaultApplied: Object.values(sources).includes("model_default"),
  };
}

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

function isLegacyJwtKey(value) {
  return String(value || "").split(".").length === 3;
}

function encodeStoragePath(value) {
  return String(value || "")
    .split("/")
    .map(part => encodeURIComponent(part))
    .join("/");
}

function trimText(value, max = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function canonicalText(value) {
  return trimText(value, 240)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isActiveSubscription(subscription) {
  if (!subscription || !["trialing", "active"].includes(subscription.status)) return false;
  if (!subscription.current_period_end) return true;
  const end = new Date(subscription.current_period_end);
  return !Number.isNaN(end.getTime()) && end > new Date();
}

export function hasPremiumCurrentAcceptances(rows = []) {
  const granted = new Set((Array.isArray(rows) ? rows : [])
    .filter(record => record?.granted === true && !record?.revoked_at)
    .map(record => `${record.consent_type}:${record.version}`));
  return Object.entries(PREMIUM_CURRENT_ACCEPTANCE_VERSIONS)
    .every(([type, version]) => granted.has(`${type}:${version}`));
}

function validIsoDate(value) {
  const text = trimText(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? text : null;
}

export function premiumAiConfig(env = process.env) {
  const supabaseUrl = cleanBaseUrl(env.SUPABASE_URL || env.CUSTOMER_DB_SUPABASE_URL);
  const serviceKey = String(
    env.SUPABASE_SECRET_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY ||
    ""
  ).trim();
  const openAiApiKey = String(env.OPENAI_API_KEY || "").trim();
  const model = String(env.PDF_AI_PRIMARY_MODEL || "gpt-4.1-2025-04-14").trim();
  const maxPdfBytes = Math.max(1_000_000, Math.min(20_000_000, Number(env.PREMIUM_AI_MAX_PDF_BYTES || 20_000_000)));
  const deadlineMs = Math.max(24_000, Math.min(52_000, Number(env.PREMIUM_AI_DEADLINE_MS || env.PDF_ANALYSIS_DEADLINE_MS || 52_000)));
  return {
    supabaseUrl,
    serviceKey,
    openAiApiKey,
    bucket: String(env.PREMIUM_BILLS_BUCKET || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET,
    model,
    maxPdfBytes,
    deadlineMs,
    pricing: resolvePremiumAiPricing(env, model),
  };
}

export function assertPremiumAiConfigured(config) {
  if (!config?.supabaseUrl || !config?.serviceKey) throw new Error("premium_supabase_not_configured");
  if (!config?.openAiApiKey) throw new Error("premium_openai_not_configured");
}

export function readBearerToken(req) {
  const authorization = String(req?.headers?.authorization || "");
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}

function serviceHeaders(config, extra = {}) {
  const headers = { apikey: config.serviceKey, ...extra };
  if (isLegacyJwtKey(config.serviceKey)) headers.Authorization = `Bearer ${config.serviceKey}`;
  return headers;
}

async function parsedResponse(response) {
  const text = await response.text().catch(() => "");
  let body = null;
  if (text) {
    try { body = JSON.parse(text); }
    catch { body = text; }
  }
  if (!response.ok) {
    const details = typeof body === "string" ? body : JSON.stringify(body || {});
    const error = new Error(`premium_supabase_http_${response.status}:${details.slice(0, 500)}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function serviceRequest(config, endpoint, init = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.supabaseUrl}${endpoint}`, {
    ...init,
    headers: serviceHeaders(config, init.headers || {}),
  });
  if (response.status === 204) return null;
  return parsedResponse(response);
}

export async function verifyPremiumStaff({ config, accessToken, fetchImpl = fetch } = {}) {
  if (!accessToken) throw new Error("premium_auth_required");
  const userResponse = await fetchImpl(`${config.supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!userResponse.ok) throw new Error("premium_invalid_session");
  const user = await userResponse.json();
  if (!user?.id) throw new Error("premium_invalid_session");

  const query = new URLSearchParams({
    select: "user_id,role,active",
    user_id: `eq.${user.id}`,
    limit: "1",
  });
  const rows = await serviceRequest(config, `/rest/v1/premium_staff_members?${query}`, { method: "GET" }, fetchImpl);
  const staff = Array.isArray(rows) ? rows[0] : null;
  if (!staff?.active || !ALLOWED_STAFF_ROLES.has(staff.role)) throw new Error("premium_staff_access_required");
  return { user, staff };
}

export async function verifyPremiumCustomer({ config, accessToken, fetchImpl = fetch } = {}) {
  if (!accessToken) throw new Error("premium_auth_required");
  const userResponse = await fetchImpl(`${config.supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!userResponse.ok) throw new Error("premium_invalid_session");
  const user = await userResponse.json();
  if (!user?.id) throw new Error("premium_invalid_session");

  const profileQuery = new URLSearchParams({ select: "id,account_status", id: `eq.${user.id}`, limit: "1" });
  const subscriptionQuery = new URLSearchParams({
    select: "id,user_id,status,current_period_end,included_bills_per_year,created_at",
    user_id: `eq.${user.id}`,
    status: "in.(trialing,active)",
    order: "created_at.desc",
    limit: "5",
  });
  const consentQuery = new URLSearchParams({
    select: "consent_type,version,granted,revoked_at",
    user_id: `eq.${user.id}`,
    consent_type: "in.(terms,privacy,cloud_storage)",
    order: "recorded_at.desc",
    limit: "30",
  });
  const [profiles, subscriptions, consents] = await Promise.all([
    serviceRequest(config, `/rest/v1/premium_profiles?${profileQuery}`, { method: "GET" }, fetchImpl),
    serviceRequest(config, `/rest/v1/premium_subscriptions?${subscriptionQuery}`, { method: "GET" }, fetchImpl),
    serviceRequest(config, `/rest/v1/premium_consents?${consentQuery}`, { method: "GET" }, fetchImpl),
  ]);
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  const subscription = (Array.isArray(subscriptions) ? subscriptions : []).find(isActiveSubscription) || null;
  if (profile?.account_status !== "active" || !subscription) throw new Error("premium_service_access_required");
  if (!hasPremiumCurrentAcceptances(consents)) throw new Error("premium_legal_acceptance_required");
  return { user, profile, subscription, consents };
}

export async function checkPremiumBackendReadiness({ config, fetchImpl = fetch } = {}) {
  const checks = {
    database: { ok: false },
    storageBucket: { ok: false, bucket: config?.bucket || DEFAULT_BUCKET },
  };

  if (!config?.supabaseUrl || !config?.serviceKey) return checks;

  try {
    await serviceRequest(config, "/rest/v1/premium_profiles?select=id,account_status,deletion_requested_at&limit=1", { method: "GET" }, fetchImpl);
    await serviceRequest(config, "/rest/v1/premium_bills?select=id,processing_status,automatic_screening_status&limit=1", { method: "GET" }, fetchImpl);
    await serviceRequest(config, "/rest/v1/premium_checks?select=id,status,outcome&limit=1", { method: "GET" }, fetchImpl);
    checks.database = { ok: true };
  } catch (error) {
    checks.database = {
      ok: false,
      code: String(error?.message || "premium_database_check_failed").split(":")[0].slice(0, 120),
    };
  }

  try {
    await serviceRequest(config, `/storage/v1/bucket/${encodeURIComponent(config.bucket)}`, { method: "GET" }, fetchImpl);
    checks.storageBucket = { ok: true, bucket: config.bucket };
  } catch (error) {
    checks.storageBucket = {
      ok: false,
      bucket: config.bucket,
      code: String(error?.message || "premium_storage_check_failed").split(":")[0].slice(0, 120),
    };
  }

  return checks;
}

export async function loadPremiumCustomerBill({ config, billId, userId, fetchImpl = fetch } = {}) {
  const normalizedBillId = trimText(billId, 80);
  if (!normalizedBillId) throw new Error("premium_bill_id_required");
  const query = new URLSearchParams({
    select: "id,user_id,utility_id,contract_id,commodity,original_file_name,file_size,storage_bucket,storage_path,processing_status,customer_status,automatic_screening_status,deleted_at,created_at",
    id: `eq.${normalizedBillId}`,
    user_id: `eq.${userId}`,
    deleted_at: "is.null",
    limit: "1",
  });
  const rows = await serviceRequest(config, `/rest/v1/premium_bills?${query}`, { method: "GET" }, fetchImpl);
  const bill = Array.isArray(rows) ? rows[0] : null;
  if (!bill) throw new Error("premium_bill_not_found");
  if (bill.storage_bucket !== config.bucket || !bill.storage_path) throw new Error("premium_bill_storage_invalid");
  if (Number(bill.file_size || 0) > config.maxPdfBytes) throw new Error("premium_pdf_too_large");
  if (!["uploaded", "failed"].includes(bill.processing_status)) throw new Error("premium_bill_not_auto_analyzable");
  return bill;
}

export async function loadPremiumBillContract({ config, bill, fetchImpl = fetch } = {}) {
  const params = {
    select: "id,user_id,utility_id,provider_name,offer_name,pricing_type,electricity_price_eur_kwh,gas_price_eur_smc,electricity_fixed_fee_eur_year,gas_fixed_fee_eur_year,electricity_index_name,gas_index_name,electricity_spread_eur_kwh,gas_spread_eur_smc,electricity_formula,gas_formula,is_current,verification_status,customer_confirmation_status",
    user_id: `eq.${bill.user_id}`,
    limit: "1",
  };
  if (bill.contract_id) params.id = `eq.${bill.contract_id}`;
  else {
    params.utility_id = `eq.${bill.utility_id}`;
    params.is_current = "eq.true";
    params.order = "created_at.desc";
  }
  const query = new URLSearchParams(params);
  const rows = await serviceRequest(config, `/rest/v1/premium_contracts?${query}`, { method: "GET" }, fetchImpl);
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function loadPremiumCheckAndBill({ config, checkId, fetchImpl = fetch } = {}) {
  const normalizedCheckId = trimText(checkId, 80);
  if (!normalizedCheckId) throw new Error("premium_check_id_required");

  const checkQuery = new URLSearchParams({
    select: "id,bill_id,user_id,status,outcome,assigned_staff_id,created_at",
    id: `eq.${normalizedCheckId}`,
    limit: "1",
  });
  const checks = await serviceRequest(config, `/rest/v1/premium_checks?${checkQuery}`, { method: "GET" }, fetchImpl);
  const check = Array.isArray(checks) ? checks[0] : null;
  if (!check) throw new Error("premium_check_not_found");
  if (["completed", "canceled"].includes(check.status)) throw new Error("premium_check_not_analyzable");

  const billQuery = new URLSearchParams({
    select: "id,user_id,utility_id,contract_id,commodity,original_file_name,file_size,storage_bucket,storage_path,processing_status,customer_status,automatic_screening_status,deleted_at,created_at",
    id: `eq.${check.bill_id}`,
    user_id: `eq.${check.user_id}`,
    deleted_at: "is.null",
    limit: "1",
  });
  const bills = await serviceRequest(config, `/rest/v1/premium_bills?${billQuery}`, { method: "GET" }, fetchImpl);
  const bill = Array.isArray(bills) ? bills[0] : null;
  if (!bill) throw new Error("premium_bill_not_found");
  if (bill.storage_bucket !== config.bucket || !bill.storage_path) throw new Error("premium_bill_storage_invalid");
  if (Number(bill.file_size || 0) > config.maxPdfBytes) throw new Error("premium_pdf_too_large");
  return { check, bill };
}

export async function createPremiumAnalysisRun({ config, check = null, bill, staffUserId = null, requestedByUserId = null, origin = "staff_manual", fetchImpl = fetch } = {}) {
  const activeQuery = new URLSearchParams({
    select: "id,status,run_number",
    bill_id: `eq.${bill.id}`,
    status: "in.(queued,running)",
    limit: "1",
  });
  const active = await serviceRequest(config, `/rest/v1/premium_analysis_runs?${activeQuery}`, { method: "GET" }, fetchImpl);
  if (Array.isArray(active) && active.length) throw new Error("premium_analysis_already_running");

  const latestQuery = new URLSearchParams({
    select: "run_number",
    bill_id: `eq.${bill.id}`,
    order: "run_number.desc",
    limit: "1",
  });
  const latest = await serviceRequest(config, `/rest/v1/premium_analysis_runs?${latestQuery}`, { method: "GET" }, fetchImpl);
  const runNumber = Math.max(1, Number(latest?.[0]?.run_number || 0) + 1);
  const record = {
    bill_id: bill.id,
    user_id: bill.user_id,
    run_number: runNumber,
    parser_version: "premium-ai-auto-screening-v0.30",
    model: config.model,
    status: "running",
    origin,
    started_at: new Date().toISOString(),
    requested_by_staff_id: staffUserId,
    requested_by_user_id: requestedByUserId,
    usage_details: {},
    response_ids: [],
    extracted_data: {},
    warnings: [],
  };
  const inserted = await serviceRequest(config, "/rest/v1/premium_analysis_runs", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(record),
  }, fetchImpl);
  const run = Array.isArray(inserted) ? inserted[0] : inserted;
  if (!run?.id) throw new Error("premium_analysis_run_create_failed");

  await patchPremiumBill({
    config,
    billId: bill.id,
    values: origin === "customer_upload"
      ? { processing_status: "analyzing", automatic_screening_status: "running", updated_at: new Date().toISOString() }
      : { processing_status: "analyzing", updated_at: new Date().toISOString() },
    fetchImpl,
  });
  return run;
}

export async function createPremiumBillSignedUrl({ config, bill, fetchImpl = fetch } = {}) {
  const endpoint = `/storage/v1/object/sign/${encodeURIComponent(config.bucket)}/${encodeStoragePath(bill.storage_path)}`;
  const result = await serviceRequest(config, endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 180 }),
  }, fetchImpl);
  const signedPath = result?.signedURL || result?.signedUrl || result?.url;
  if (!signedPath) throw new Error("premium_bill_signed_url_failed");
  return signedPath.startsWith("http")
    ? signedPath
    : `${config.supabaseUrl}/storage/v1${signedPath.startsWith("/") ? "" : "/"}${signedPath}`;
}

export async function downloadPremiumBill({ config, bill, destinationPath, fetchImpl = fetch } = {}) {
  const signedUrl = await createPremiumBillSignedUrl({ config, bill, fetchImpl });
  const response = await fetchImpl(signedUrl, { method: "GET" });
  if (!response.ok) throw new Error(`premium_bill_download_failed:${response.status}`);
  const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
  if (contentType && !contentType.includes("pdf") && !contentType.includes("octet-stream")) {
    throw new Error("premium_bill_download_not_pdf");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > config.maxPdfBytes) throw new Error("premium_pdf_size_invalid");
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.writeFile(destinationPath, bytes);
  return { bytes: bytes.length, signedUrlExpiresSeconds: 180 };
}

export function createUsageMeter() {
  const totals = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    responseIds: [],
    calls: [],
  };
  return {
    totals,
    capture(body, context = {}) {
      const usage = body?.usage || {};
      const inputTokens = integer(usage.input_tokens);
      const cachedInputTokens = integer(usage.input_tokens_details?.cached_tokens);
      const outputTokens = integer(usage.output_tokens);
      const reasoningTokens = integer(usage.output_tokens_details?.reasoning_tokens);
      const totalTokens = integer(usage.total_tokens || inputTokens + outputTokens);
      totals.inputTokens += inputTokens;
      totals.cachedInputTokens += cachedInputTokens;
      totals.outputTokens += outputTokens;
      totals.reasoningTokens += reasoningTokens;
      totals.totalTokens += totalTokens;
      const responseId = trimText(body?.id, 180);
      if (responseId) totals.responseIds.push(responseId);
      totals.calls.push({
        attempt: integer(context.attempt) || 1,
        profile: trimText(context.profile, 120),
        response_id: responseId || null,
        model: trimText(body?.model, 120) || null,
        input_tokens: inputTokens,
        cached_input_tokens: cachedInputTokens,
        output_tokens: outputTokens,
        reasoning_tokens: reasoningTokens,
        total_tokens: totalTokens,
      });
    },
  };
}

export function createMeteredOpenAiTransport({ meter, fetchImpl = fetch } = {}) {
  return async ({ request, apiKey, signal, attempt, profile }) => {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
    const text = await response.text().catch(() => "");
    let body = null;
    try { body = text ? JSON.parse(text) : {}; }
    catch { throw new Error(`openai_invalid_json:${text.slice(0, 200)}`); }
    if (!response.ok) throw new Error(`openai_http_${response.status}:${text.slice(0, 300)}`);
    meter?.capture?.(body, { attempt, profile });
    return body;
  };
}

export function estimatePremiumAiCost(usage, pricing = {}) {
  const inputRate = positiveNumber(pricing.inputPerMillion);
  const outputRate = positiveNumber(pricing.outputPerMillion);
  const cachedRate = positiveNumber(pricing.cachedInputPerMillion);
  if (inputRate === null || outputRate === null) return null;
  const inputTokens = integer(usage?.inputTokens);
  const cachedTokens = Math.min(inputTokens, integer(usage?.cachedInputTokens));
  const uncachedTokens = Math.max(0, inputTokens - cachedTokens);
  const effectiveCachedRate = cachedRate === null ? inputRate : cachedRate;
  return Number((((uncachedTokens * inputRate) + (cachedTokens * effectiveCachedRate) + (integer(usage?.outputTokens) * outputRate)) / 1_000_000).toFixed(6));
}

function essentialMissing(normalized = {}) {
  const missing = [];
  const commodities = normalized.commodity === "dual"
    ? ["luce", "gas"]
    : normalized.commodity === "luce" || normalized.commodity === "gas"
      ? [normalized.commodity]
      : [];
  for (const commodity of commodities) {
    const fields = commodity === "luce"
      ? ["consumo_luce_kwh", "prezzo_luce_eur_kwh", "quota_fissa_vendita_luce_eur_anno"]
      : ["consumo_gas_smc", "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno"];
    for (const field of fields) {
      const value = normalized[field];
      if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) missing.push(field);
    }
  }
  return missing;
}

export function analysisCompletionStatus(normalized = {}) {
  const missing = essentialMissing(normalized);
  return {
    status: normalized.recognized && missing.length === 0 ? "completed" : "partial",
    missing,
  };
}

export function sanitizePremiumAnalysisData(normalized = {}, usage = {}, screening = null) {
  const safe = JSON.parse(JSON.stringify(normalized || {}));
  if (safe._reader_trace) {
    safe._reader_trace = {
      trace_version: safe._reader_trace.trace_version || null,
      captured_at: safe._reader_trace.captured_at || null,
      response_id: safe._reader_trace.response_id || null,
      recovery_response_id: safe._reader_trace.recovery_response_id || null,
      request_profile: safe._reader_trace.request_profile || null,
      recovery_profile: safe._reader_trace.recovery_profile || null,
      raw_output_chars: Number(safe._reader_trace.raw_output_chars || 0),
    };
  }
  safe._premium_analysis = {
    version: "premium-ai-traffic-light-v0.36.3",
    review_policy: "red_only_customer_requested",
    staff_review_required: screening ? screening.status === "review_recommended" : false,
    customer_visible: false,
    automatic_screening: screening ? {
      status: screening.status,
      traffic_light: screening.trafficLight || null,
      staff_review_allowed: screening.staffReviewAllowed === true,
      summary: screening.summary,
      reasons: screening.reasons,
    } : null,
    usage: {
      input_tokens: integer(usage.inputTokens),
      cached_input_tokens: integer(usage.cachedInputTokens),
      output_tokens: integer(usage.outputTokens),
      reasoning_tokens: integer(usage.reasoningTokens),
      total_tokens: integer(usage.totalTokens),
      calls: Array.isArray(usage.calls) ? usage.calls : [],
    },
  };
  return safe;
}

function screeningReason(code, title, description, severity = "medium", source = "automatic", extra = {}) {
  return {
    code,
    title: trimText(title, 160),
    description: trimText(description, 600),
    severity,
    source,
    ...extra,
  };
}

function expectedPricingType(value) {
  return ({ fixed: "fisso", indexed: "variabile", mixed: "ibrido" })[value] || null;
}

function numericMismatch(actual, expected, absoluteFloor, relativeTolerance = 0.05) {
  const a = finiteNumber(actual);
  const e = finiteNumber(expected);
  if (a === null || e === null) return false;
  return Math.abs(a - e) > Math.max(absoluteFloor, Math.abs(e) * relativeTolerance);
}

export const PREMIUM_TRAFFIC_LIGHT_POLICY = Object.freeze({
  expiryWarningWindowDays: 90,
  singleUtilitySavingThresholdEur: 60,
  dualSavingThresholdEur: 100,
});

export function qualifiesForBetterOfferWarning(input = {}) {
  const {
    savingEur,
    scope = "single",
    annualDataReliable = false,
    nearExpiry = false,
  } = input || {};
  const saving = finiteNumber(savingEur);
  if (saving === null || annualDataReliable !== true || nearExpiry !== true) return false;
  const threshold = scope === "dual"
    ? PREMIUM_TRAFFIC_LIGHT_POLICY.dualSavingThresholdEur
    : PREMIUM_TRAFFIC_LIGHT_POLICY.singleUtilitySavingThresholdEur;
  return saving > threshold;
}

function expiryWarningRequired(normalized = {}, nowValue = new Date()) {
  const now = nowValue instanceof Date ? new Date(nowValue) : new Date(nowValue);
  if (Number.isNaN(now.getTime())) return false;
  now.setUTCHours(0, 0, 0, 0);

  const expiries = [
    normalized.scadenza_condizioni_economiche_luce,
    normalized.scadenza_condizioni_economiche_gas,
    normalized.scadenza_contratto_luce,
    normalized.scadenza_contratto_gas,
  ]
    .map(validIsoDate)
    .filter(Boolean)
    .map(value => new Date(`${value}T00:00:00.000Z`))
    .filter(date => !Number.isNaN(date.getTime()));

  if (!expiries.length) return false;
  const nearestDays = Math.min(...expiries.map(date => Math.ceil((date.getTime() - now.getTime()) / 86_400_000)));
  return nearestDays <= PREMIUM_TRAFFIC_LIGHT_POLICY.expiryWarningWindowDays;
}

function documentAlertLevel(alert, normalized, nowValue) {
  const code = canonicalText(alert?.code).replaceAll(" ", "_");
  const severity = ["low", "medium", "high"].includes(alert?.severity) ? alert.severity : "medium";
  if (code === "scadenza_condizioni") return expiryWarningRequired(normalized, nowValue) ? "yellow" : "ignore";
  if (code === "doppio_addebito") return severity === "low" ? "yellow" : "red";
  if (["conguaglio", "quota_inattesa", "sconto_mancante", "penale", "importo_inusuale"].includes(code)) {
    return severity === "high" ? "red" : "yellow";
  }
  return severity === "high" ? "red" : "yellow";
}

function essentialContradiction(field) {
  return new Set([
    "consumo_luce_kwh",
    "consumo_gas_smc",
    "prezzo_luce_eur_kwh",
    "prezzo_gas_eur_smc",
    "quota_fissa_vendita_luce_eur_anno",
    "quota_fissa_vendita_gas_eur_anno",
  ]).has(trimText(field, 120));
}

function offerMatchWarning(normalized = {}) {
  const match = normalized?._offer_match;
  const status = trimText(match?.status, 50);
  if (!status || ["existing_verified"].includes(status) || (status === "matched" && match?.verified === true)) return null;
  if (["matched", "partial", "ambiguous"].includes(status)) {
    return screeningReason(
      "offerta_da_confermare",
      "Offerta da confermare",
      "Sono state trovate offerte compatibili. Conferma quella corretta per completare il controllo automatico.",
      "medium",
      "offer_match",
      { trafficLight: "yellow" },
    );
  }
  if (["not_found", "customer_rejected"].includes(status)) {
    return screeningReason(
      "offerta_non_riconosciuta",
      "Offerta non riconosciuta",
      "La bolletta è leggibile, ma l’offerta non è stata identificata nel catalogo disponibile.",
      "low",
      "offer_match",
      { trafficLight: "yellow" },
    );
  }
  if (status === "error") {
    return screeningReason(
      "ricerca_offerta_non_disponibile",
      "Ricerca offerta non disponibile",
      "L’analisi della bolletta è terminata, ma il riconoscimento dell’offerta non è disponibile.",
      "low",
      "offer_match",
      { trafficLight: "yellow" },
    );
  }
  return null;
}

export function classifyPremiumAutomaticAnalysis(normalized = {}, {
  contract = null,
  now = new Date(),
  savingOpportunity = null,
} = {}) {
  const completion = analysisCompletionStatus(normalized);
  const yellow = [];
  const red = [];

  if (!normalized.recognized || normalized.kind !== "bolletta") {
    yellow.push(screeningReason(
      "documento_non_riconosciuto",
      "Documento non leggibile",
      "Riprova l’analisi oppure carica un PDF o una scansione più nitida.",
      "medium",
      "quality",
      { trafficLight: "yellow", suggestedAction: "replace_pdf" },
    ));
  }
  completion.missing.forEach((field) => {
    yellow.push(screeningReason(
      `campo_mancante_${field}`,
      "Dato essenziale non letto",
      `Non è stato possibile leggere il campo ${field}. Riprova o carica un documento migliore.`,
      "medium",
      "quality",
      { trafficLight: "yellow", suggestedAction: "replace_pdf" },
    ));
  });
  const totalAmount = finiteNumber(normalized.total_amount_eur);
  if (totalAmount === null || totalAmount <= 0) {
    yellow.push(screeningReason(
      "importo_totale_mancante",
      "Importo totale non letto",
      "L’importo finale non è stato letto. Riprova o carica un documento migliore.",
      "medium",
      "quality",
      { trafficLight: "yellow", suggestedAction: "replace_pdf" },
    ));
  }
  if (!validIsoDate(normalized.billing_period_start) || !validIsoDate(normalized.billing_period_end)) {
    yellow.push(screeningReason(
      "periodo_fatturazione_incompleto",
      "Periodo non completo",
      "Il periodo della bolletta non è stato letto completamente.",
      "low",
      "quality",
      { trafficLight: "yellow" },
    ));
  }

  const matchReason = offerMatchWarning(normalized);
  if (matchReason) yellow.push(matchReason);

  for (const alert of Array.isArray(normalized.document_alerts) ? normalized.document_alerts : []) {
    const level = documentAlertLevel(alert, normalized, now);
    if (level === "ignore") continue;
    const reason = screeningReason(
      `documento_${trimText(alert.code, 80) || "altro"}`,
      alert.title || (level === "red" ? "Anomalia importante" : "Avviso"),
      alert.description || (level === "red" ? "È stata rilevata un’anomalia economicamente rilevante." : "La bolletta contiene un’informazione da tenere sotto controllo."),
      ["low", "medium", "high"].includes(alert.severity) ? alert.severity : "medium",
      "document",
      { trafficLight: level },
    );
    (level === "red" ? red : yellow).push(reason);
  }

  for (const issue of Array.isArray(normalized.validation_issues) ? normalized.validation_issues : []) {
    if (issue?.severity !== "review") continue;
    const field = trimText(issue.field, 100) || "dato";
    const level = essentialContradiction(field) ? "red" : "yellow";
    const reason = screeningReason(
      `coerenza_${trimText(issue.code, 100) || "dato"}`,
      level === "red" ? "Dato essenziale incoerente" : "Dato da verificare",
      level === "red"
        ? `Il campo ${field} resta contraddittorio dopo i controlli automatici.`
        : `Il campo ${field} non è stato verificato completamente.`,
      level === "red" ? "high" : "low",
      "validation",
      { trafficLight: level },
    );
    (level === "red" ? red : yellow).push(reason);
  }

  if (contract) {
    const provider = normalized.fornitore_luce || normalized.fornitore_gas || normalized.fornitore;
    if (provider && contract.provider_name && canonicalText(provider) !== canonicalText(contract.provider_name)) {
      red.push(screeningReason("fornitore_diverso_dal_contratto", "Fornitore diverso", "Il fornitore letto non coincide con quello registrato nel contratto.", "high", "contract", { trafficLight: "red" }));
    }
    const expectedType = expectedPricingType(contract.pricing_type);
    const actualTypes = [normalized.tipo_prezzo_luce, normalized.tipo_prezzo_gas].filter(Boolean);
    if (expectedType && actualTypes.length && actualTypes.some((value) => canonicalText(value) !== canonicalText(expectedType))) {
      red.push(screeningReason("tipo_prezzo_diverso_dal_contratto", "Tipo di prezzo diverso", "La tipologia di prezzo non coincide con quella registrata nel contratto.", "high", "contract", { trafficLight: "red" }));
    }
    if (numericMismatch(normalized.prezzo_luce_eur_kwh, contract.electricity_price_eur_kwh, 0.005)) {
      red.push(screeningReason("prezzo_luce_diverso_dal_contratto", "Prezzo luce diverso", "Il prezzo unitario luce differisce dal contratto oltre la tolleranza.", "high", "contract", { trafficLight: "red" }));
    }
    if (numericMismatch(normalized.prezzo_gas_eur_smc, contract.gas_price_eur_smc, 0.02)) {
      red.push(screeningReason("prezzo_gas_diverso_dal_contratto", "Prezzo gas diverso", "Il prezzo unitario gas differisce dal contratto oltre la tolleranza.", "high", "contract", { trafficLight: "red" }));
    }
    if (contract.electricity_index_name && normalized.indice_riferimento_luce
      && canonicalText(contract.electricity_index_name) !== canonicalText(normalized.indice_riferimento_luce)) {
      red.push(screeningReason("indice_luce_diverso_dal_contratto", "Indice luce diverso", "L’indice luce non coincide con quello registrato per l’offerta.", "high", "contract", { trafficLight: "red" }));
    }
    if (contract.gas_index_name && normalized.indice_riferimento_gas
      && canonicalText(contract.gas_index_name) !== canonicalText(normalized.indice_riferimento_gas)) {
      red.push(screeningReason("indice_gas_diverso_dal_contratto", "Indice gas diverso", "L’indice gas non coincide con quello registrato per l’offerta.", "high", "contract", { trafficLight: "red" }));
    }
    if (numericMismatch(normalized.spread_luce_eur_kwh, contract.electricity_spread_eur_kwh, 0.002)) {
      red.push(screeningReason("spread_luce_diverso_dal_contratto", "Spread luce diverso", "Lo spread luce differisce dal contratto oltre la tolleranza.", "high", "contract", { trafficLight: "red" }));
    }
    if (numericMismatch(normalized.spread_gas_eur_smc, contract.gas_spread_eur_smc, 0.01)) {
      red.push(screeningReason("spread_gas_diverso_dal_contratto", "Spread gas diverso", "Lo spread gas differisce dal contratto oltre la tolleranza.", "high", "contract", { trafficLight: "red" }));
    }
    if (numericMismatch(normalized.quota_fissa_vendita_luce_eur_anno, contract.electricity_fixed_fee_eur_year, 5)) {
      red.push(screeningReason("quota_fissa_luce_diversa", "Quota fissa luce diversa", "La quota fissa annua luce differisce dal contratto oltre la tolleranza.", "high", "contract", { trafficLight: "red" }));
    }
    if (numericMismatch(normalized.quota_fissa_vendita_gas_eur_anno, contract.gas_fixed_fee_eur_year, 5)) {
      red.push(screeningReason("quota_fissa_gas_diversa", "Quota fissa gas diversa", "La quota fissa annua gas differisce dal contratto oltre la tolleranza.", "high", "contract", { trafficLight: "red" }));
    }
  }

  const opportunity = savingOpportunity || normalized?._saving_opportunity || null;
  if (qualifiesForBetterOfferWarning(opportunity)) {
    const saving = finiteNumber(opportunity.savingEur);
    yellow.push(screeningReason(
      "offerta_migliore_disponibile",
      "Offerta più conveniente disponibile",
      `Il risparmio annuo stimato supera ${opportunity.scope === "dual" ? "100" : "60"} € ed è il momento utile per rivalutare l’offerta.`,
      "low",
      "saving",
      { trafficLight: "yellow", estimatedImpactEur: saving },
    ));
  }

  const unique = (items) => [...new Map(items.map((item) => [item.code, item])).values()];
  const redReasons = unique(red);
  const yellowReasons = unique(yellow);
  if (redReasons.length) {
    return {
      status: "review_recommended",
      trafficLight: "red",
      staffReviewAllowed: true,
      customerStatus: "anomaly_found",
      summary: "È stata rilevata un’anomalia importante.",
      reasons: [...redReasons, ...yellowReasons],
    };
  }
  if (yellowReasons.length) {
    return {
      status: "inconclusive",
      trafficLight: "yellow",
      staffReviewAllowed: false,
      customerStatus: "more_info_required",
      summary: "Controllo completato con un avviso.",
      reasons: yellowReasons,
    };
  }
  return {
    status: "clear",
    trafficLight: "green",
    staffReviewAllowed: false,
    customerStatus: "correct",
    summary: "Controllo completato: nessuna anomalia rilevata.",
    reasons: [],
  };
}

export function premiumBillValuesFromAnalysis(normalized = {}, screening, runId, completedAt = new Date().toISOString()) {
  const commodity = ({ luce: "electricity", gas: "gas", dual: "dual" })[normalized.commodity] || "unknown";
  return {
    commodity,
    billing_period_start: validIsoDate(normalized.billing_period_start),
    billing_period_end: validIsoDate(normalized.billing_period_end),
    issue_date: validIsoDate(normalized.issue_date),
    due_date: validIsoDate(normalized.due_date),
    total_amount_eur: finiteNumber(normalized.total_amount_eur),
    processing_status: "completed",
    customer_status: screening.customerStatus,
    automatic_screening_status: screening.status,
    automatic_screening_summary: screening.summary,
    automatic_screening_reasons: screening.reasons,
    automatic_screened_at: completedAt,
    automatic_analysis_run_id: runId,
    completed_at: completedAt,
    updated_at: completedAt,
  };
}

export async function patchPremiumAnalysisRun({ config, runId, values, fetchImpl = fetch } = {}) {
  const query = new URLSearchParams({ id: `eq.${runId}` });
  return serviceRequest(config, `/rest/v1/premium_analysis_runs?${query}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(values),
  }, fetchImpl);
}

export async function patchPremiumBill({ config, billId, values, fetchImpl = fetch } = {}) {
  const query = new URLSearchParams({ id: `eq.${billId}` });
  return serviceRequest(config, `/rest/v1/premium_bills?${query}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(values),
  }, fetchImpl);
}

export async function insertPremiumAiCostEvent({ config, bill, check, run, usage, estimatedCostEur, model, fetchImpl = fetch } = {}) {
  const record = {
    user_id: bill.user_id,
    bill_id: bill.id,
    analysis_run_id: run.id,
    check_id: check?.id || null,
    event_type: "ai_analysis",
    provider: "openai",
    quantity: integer(usage.totalTokens),
    unit: "tokens",
    cost_eur: estimatedCostEur ?? 0,
    currency: "EUR",
    provider_event_id: usage.responseIds?.[0] || null,
    metadata: {
      model,
      input_tokens: integer(usage.inputTokens),
      cached_input_tokens: integer(usage.cachedInputTokens),
      output_tokens: integer(usage.outputTokens),
      reasoning_tokens: integer(usage.reasoningTokens),
      total_tokens: integer(usage.totalTokens),
      calls: Array.isArray(usage.calls) ? usage.calls : [],
      pricing_configured: estimatedCostEur !== null,
      pricing_source: "vercel_environment",
      origin: run?.origin || (check ? "staff_manual" : "customer_upload"),
    },
  };
  return serviceRequest(config, "/rest/v1/premium_cost_events", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(record),
  }, fetchImpl);
}

export function publicPremiumAiError(error) {
  const message = String(error?.message || "");
  if (/premium_auth_required|premium_invalid_session/.test(message)) return { status: 401, code: "PREMIUM_AUTH_REQUIRED", error: "Sessione non valida. Accedi nuovamente." };
  if (/premium_staff_access_required/.test(message)) return { status: 403, code: "PREMIUM_STAFF_REQUIRED", error: "Account non autorizzato all’analisi Premium." };
  if (/premium_admin_delete_required/.test(message)) return { status: 403, code: "PREMIUM_ADMIN_REQUIRED", error: "Operazione riservata agli amministratori." };
  if (/premium_legal_acceptance_required/.test(message)) return { status: 403, code: "PREMIUM_LEGAL_ACCEPTANCE_REQUIRED", error: "Accetta le condizioni Premium correnti dal profilo prima di continuare." };
  if (/premium_service_access_required/.test(message)) return { status: 403, code: "PREMIUM_SERVICE_REQUIRED", error: "Abbonamento Premium non attivo." };
  if (/premium_offer_contract_not_found/.test(message)) return { status: 404, code: "PREMIUM_OFFER_NOT_FOUND", error: "L’offerta associata non è più disponibile." };
  if (/premium_check_not_found|premium_bill_not_found/.test(message)) return { status: 404, code: "PREMIUM_RECORD_NOT_FOUND", error: "Controllo o bolletta non disponibili." };
  if (/premium_offer_selection_incomplete|premium_offer_selection_invalid|premium_offer_decision_invalid/.test(message)) return { status: 400, code: "PREMIUM_OFFER_SELECTION_INVALID", error: "Seleziona un’offerta valida prima di confermare." };
  if (/premium_offer_confirmation_not_allowed|premium_offer_bill_mismatch/.test(message)) return { status: 409, code: "PREMIUM_OFFER_CONFIRMATION_NOT_ALLOWED", error: "Questa offerta non può essere confermata nello stato attuale." };
  if (/premium_bill_not_auto_analyzable/.test(message)) return { status: 409, code: "PREMIUM_BILL_NOT_ANALYZABLE", error: "La bolletta non è nello stato corretto per l’analisi automatica." };
  if (/premium_check_not_analyzable/.test(message)) return { status: 409, code: "PREMIUM_CHECK_CLOSED", error: "Il controllo è già concluso o annullato." };
  if (/premium_analysis_already_running|premium_analysis_runs_one_active/.test(message)) return { status: 409, code: "PREMIUM_AI_ALREADY_RUNNING", error: "È già in corso un’analisi IA per questa bolletta." };
  if (/premium_pdf_too_large|premium_pdf_size_invalid/.test(message)) return { status: 413, code: "PREMIUM_PDF_TOO_LARGE", error: "Il PDF supera il limite previsto per l’analisi." };
  if (/premium_supabase_not_configured|premium_openai_not_configured|openai_missing_api_key/.test(message)) return { status: 503, code: "PREMIUM_AI_NOT_CONFIGURED", error: "Analisi IA non configurata sul server." };
  if (/openai_timeout|deadline|insufficient_time_budget/.test(message)) return { status: 504, code: "PREMIUM_AI_TIMEOUT", error: "L’analisi ha richiesto troppo tempo. Riprova." };
  if (/openai_http_429/.test(message)) return { status: 503, code: "PREMIUM_AI_BUSY", error: "Servizio IA temporaneamente occupato." };
  if (/openai_|pure_ai_/.test(message)) return { status: 502, code: "PREMIUM_AI_INVALID_RESULT", error: "Analisi non completata. Riprova o carica un PDF più leggibile." };
  return { status: 500, code: "PREMIUM_AI_ERROR", error: "Analisi non completata. Riprova o carica un PDF più leggibile." };
}
