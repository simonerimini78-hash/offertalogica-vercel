import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_BUCKET = "premium-bills";
const ALLOWED_STAFF_ROLES = new Set(["reviewer", "admin"]);

function cleanBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function positiveNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
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

export function premiumAiConfig(env = process.env) {
  const supabaseUrl = cleanBaseUrl(env.SUPABASE_URL || env.CUSTOMER_DB_SUPABASE_URL);
  const serviceKey = String(
    env.SUPABASE_SECRET_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY ||
    ""
  ).trim();
  const openAiApiKey = String(env.OPENAI_API_KEY || "").trim();
  const maxPdfBytes = Math.max(1_000_000, Math.min(20_000_000, Number(env.PREMIUM_AI_MAX_PDF_BYTES || 20_000_000)));
  const deadlineMs = Math.max(24_000, Math.min(52_000, Number(env.PREMIUM_AI_DEADLINE_MS || env.PDF_ANALYSIS_DEADLINE_MS || 52_000)));
  return {
    supabaseUrl,
    serviceKey,
    openAiApiKey,
    bucket: String(env.PREMIUM_BILLS_BUCKET || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET,
    model: String(env.PDF_AI_PRIMARY_MODEL || "gpt-4.1-2025-04-14").trim(),
    maxPdfBytes,
    deadlineMs,
    pricing: {
      inputPerMillion: positiveNumber(env.PREMIUM_AI_INPUT_EUR_PER_1M_TOKENS),
      cachedInputPerMillion: positiveNumber(env.PREMIUM_AI_CACHED_INPUT_EUR_PER_1M_TOKENS),
      outputPerMillion: positiveNumber(env.PREMIUM_AI_OUTPUT_EUR_PER_1M_TOKENS),
    },
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
    select: "id,user_id,utility_id,commodity,original_file_name,file_size,storage_bucket,storage_path,processing_status,customer_status,deleted_at,created_at",
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

export async function createPremiumAnalysisRun({ config, check, bill, staffUserId, fetchImpl = fetch } = {}) {
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
    parser_version: "premium-ai-assisted-v0.28",
    model: config.model,
    status: "running",
    started_at: new Date().toISOString(),
    requested_by_staff_id: staffUserId,
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

  await patchPremiumBill({ config, billId: bill.id, values: { processing_status: "analyzing", updated_at: new Date().toISOString() }, fetchImpl });
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

export function sanitizePremiumAnalysisData(normalized = {}, usage = {}) {
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
    version: "premium-ai-assisted-v0.28",
    staff_review_required: true,
    customer_visible: false,
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
    check_id: check.id,
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
  if (/premium_auth_required|premium_invalid_session/.test(message)) return { status: 401, code: "PREMIUM_AUTH_REQUIRED", error: "Sessione staff non valida. Accedi nuovamente." };
  if (/premium_staff_access_required/.test(message)) return { status: 403, code: "PREMIUM_STAFF_REQUIRED", error: "Account non autorizzato all’analisi Premium." };
  if (/premium_check_not_found|premium_bill_not_found/.test(message)) return { status: 404, code: "PREMIUM_RECORD_NOT_FOUND", error: "Controllo o bolletta non disponibili." };
  if (/premium_check_not_analyzable/.test(message)) return { status: 409, code: "PREMIUM_CHECK_CLOSED", error: "Il controllo è già concluso o annullato." };
  if (/premium_analysis_already_running|premium_analysis_runs_one_active/.test(message)) return { status: 409, code: "PREMIUM_AI_ALREADY_RUNNING", error: "È già in corso un’analisi IA per questa bolletta." };
  if (/premium_pdf_too_large|premium_pdf_size_invalid/.test(message)) return { status: 413, code: "PREMIUM_PDF_TOO_LARGE", error: "Il PDF supera il limite previsto per l’analisi." };
  if (/premium_supabase_not_configured|premium_openai_not_configured|openai_missing_api_key/.test(message)) return { status: 503, code: "PREMIUM_AI_NOT_CONFIGURED", error: "Analisi IA non configurata sul server." };
  if (/openai_timeout|deadline|insufficient_time_budget/.test(message)) return { status: 504, code: "PREMIUM_AI_TIMEOUT", error: "L’analisi IA ha richiesto troppo tempo. La revisione umana resta disponibile." };
  if (/openai_http_429/.test(message)) return { status: 503, code: "PREMIUM_AI_BUSY", error: "Servizio IA temporaneamente occupato." };
  if (/openai_|pure_ai_/.test(message)) return { status: 502, code: "PREMIUM_AI_INVALID_RESULT", error: "L’IA non ha restituito una bozza utilizzabile. Procedi con la revisione manuale." };
  return { status: 500, code: "PREMIUM_AI_ERROR", error: "Analisi IA non riuscita. La revisione manuale resta disponibile." };
}
