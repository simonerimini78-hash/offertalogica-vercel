const MODEL_USD_PRICING = Object.freeze({
  "gpt-4.1": Object.freeze({ inputPerMillion: 2, cachedInputPerMillion: 0.5, outputPerMillion: 8 }),
  "gpt-4.1-2025-04-14": Object.freeze({ inputPerMillion: 2, cachedInputPerMillion: 0.5, outputPerMillion: 8 }),
});

const FX_CACHE_MS = 6 * 60 * 60 * 1000;
const FX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SUPABASE_TIMEOUT_MS = 1500;
let fxCache = null;

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

function finitePositive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cleanBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function economicConfig(env = process.env) {
  return {
    supabaseUrl: cleanBaseUrl(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.CUSTOMER_DB_SUPABASE_URL),
    serviceKey: String(
      env.SUPABASE_SERVICE_ROLE_KEY ||
      env.SUPABASE_SERVICE_KEY ||
      env.SUPABASE_SECRET_KEY ||
      env.CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY ||
      ""
    ).trim(),
  };
}

function serviceHeaders(config, extra = {}) {
  const headers = { apikey: config.serviceKey, ...extra };
  if (String(config.serviceKey || "").split(".").length === 3) {
    headers.Authorization = `Bearer ${config.serviceKey}`;
  }
  return headers;
}

function usageFromBody(body = {}) {
  const usage = body?.usage && typeof body.usage === "object" ? body.usage : {};
  const inputTokens = integer(usage.input_tokens);
  const cachedInputTokens = Math.min(inputTokens, integer(usage?.input_tokens_details?.cached_tokens));
  const outputTokens = integer(usage.output_tokens);
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens: integer(usage?.output_tokens_details?.reasoning_tokens),
    totalTokens: integer(usage.total_tokens || inputTokens + outputTokens),
  };
}

export function createSitePdfUsageMeter({ fetchImpl = fetch } = {}) {
  const totals = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    responseIds: [],
    calls: [],
  };

  function capture(body, context = {}) {
    const usage = usageFromBody(body);
    totals.inputTokens += usage.inputTokens;
    totals.cachedInputTokens += usage.cachedInputTokens;
    totals.outputTokens += usage.outputTokens;
    totals.reasoningTokens += usage.reasoningTokens;
    totals.totalTokens += usage.totalTokens;
    const responseId = String(body?.id || "").trim();
    if (responseId && !totals.responseIds.includes(responseId)) totals.responseIds.push(responseId);
    totals.calls.push({
      profile: String(context.profile || "").slice(0, 80),
      model: String(context.model || "").slice(0, 120),
      responseId: responseId || null,
      ...usage,
    });
  }

  async function transport({ request, apiKey, signal, profile } = {}) {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
    try {
      const body = typeof response?.clone === "function"
        ? await response.clone().json()
        : null;
      if (body) capture(body, { profile, model: request?.model });
    } catch {
      // La metrica economica non deve interferire con la lettura del PDF.
    }
    return response;
  }

  return { totals, capture, transport };
}

export function estimateSitePdfAiUsdCost(usage = {}, model = "") {
  const pricing = MODEL_USD_PRICING[String(model || "").trim().toLowerCase()] || null;
  if (!pricing) return null;
  const inputTokens = integer(usage.inputTokens);
  const cachedInputTokens = Math.min(inputTokens, integer(usage.cachedInputTokens));
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const outputTokens = integer(usage.outputTokens);
  if (inputTokens + outputTokens <= 0) return null;
  const cost = (
    uncachedInputTokens * pricing.inputPerMillion +
    cachedInputTokens * pricing.cachedInputPerMillion +
    outputTokens * pricing.outputPerMillion
  ) / 1_000_000;
  return Number.isFinite(cost) ? Number(cost.toFixed(8)) : null;
}

function booleanTrue(value) {
  return value === true || String(value || "").toLowerCase() === "true";
}

async function fetchWithTimeout(fetchImpl, url, init = {}, timeoutMs = SUPABASE_TIMEOUT_MS) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller?.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function latestVerifiedPremiumFx(config, fetchImpl = fetch, nowMs = Date.now()) {
  if (fxCache && nowMs - fxCache.cachedAtMs < FX_CACHE_MS) return fxCache;
  const query = new URLSearchParams({
    select: "usage_details,created_at",
    order: "created_at.desc",
    limit: "25",
  });
  const response = await fetchWithTimeout(
    fetchImpl,
    `${config.supabaseUrl}/rest/v1/premium_analysis_runs?${query}`,
    { method: "GET", headers: serviceHeaders(config, { Accept: "application/json" }) },
  );
  if (!response.ok) throw new Error(`site_pdf_ai_fx_http_${response.status}`);
  const rows = await response.json();
  const row = (Array.isArray(rows) ? rows : []).find(item => {
    const details = item?.usage_details || {};
    return booleanTrue(details.pricing_verified_eur) && finitePositive(details.usd_to_eur_rate) !== null;
  });
  if (!row) return null;
  const details = row.usage_details || {};
  const observedAtMs = new Date(row.created_at || 0).getTime();
  const ageMs = Number.isFinite(observedAtMs) ? Math.max(0, nowMs - observedAtMs) : Number.POSITIVE_INFINITY;
  fxCache = {
    usdToEur: finitePositive(details.usd_to_eur_rate),
    eurToUsd: finitePositive(details.eur_to_usd_rate),
    ecbReferenceDate: String(details.ecb_reference_date || "") || null,
    observedAt: row.created_at || null,
    stale: ageMs > FX_MAX_AGE_MS,
    cachedAtMs: nowMs,
    source: "premium_verified_ecb_snapshot",
  };
  return fxCache;
}

export function siteCustomerType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["business", "azienda", "aziende", "piva", "p.iva"].includes(normalized)) return "business";
  if (["privato", "consumer", "casa", "domestico"].includes(normalized)) return "consumer";
  return "unknown";
}

export function buildSitePdfAiEconomicEntry({
  eventId,
  usage,
  model,
  customerType,
  outcome = "success",
  ingressMode = "",
  analysisStage = "",
  elapsedMs = 0,
  errorCode = "",
  fx = null,
  occurredAt = new Date().toISOString(),
} = {}) {
  const normalizedCustomerType = siteCustomerType(customerType);
  const usdCost = estimateSitePdfAiUsdCost(usage, model);
  const usableFx = fx && finitePositive(fx.usdToEur) !== null ? fx : null;
  const eurCost = usdCost !== null && usableFx
    ? Number((usdCost * usableFx.usdToEur).toFixed(8))
    : null;
  const economicStatus = eurCost === null ? "unpriced" : usableFx?.stale ? "estimated" : "incurred";
  const category = `site_pdf_ai_${normalizedCustomerType}`;
  const label = normalizedCustomerType === "business" ? "business" : normalizedCustomerType === "consumer" ? "privato" : "tipo non determinato";
  return {
    direction: "cost",
    status: economicStatus,
    category,
    source_system: "site_pdf_ai",
    source_event_id: String(eventId || "").slice(0, 120) || null,
    quantity: 1,
    unit: "analysis",
    original_amount: usdCost,
    original_currency: "USD",
    fx_rate_to_eur: usableFx?.usdToEur ?? null,
    amount_net_eur: eurCost,
    vat_rate: null,
    vat_eur: null,
    amount_gross_eur: eurCost,
    occurred_at: occurredAt,
    notes: `Analisi IA calcolatore sito · ${label}`,
    metadata: {
      accounting_version: "site-pdf-ai-accounting-v1",
      pricing_version: "openai-gpt41-usd-v1",
      model: String(model || "").slice(0, 120),
      customer_type: normalizedCustomerType,
      outcome: String(outcome || "").slice(0, 40),
      ingress_mode: String(ingressMode || "").slice(0, 80),
      analysis_stage: String(analysisStage || "").slice(0, 80),
      elapsed_ms: integer(elapsedMs),
      error_code: String(errorCode || "").slice(0, 120),
      input_tokens: integer(usage?.inputTokens),
      cached_input_tokens: integer(usage?.cachedInputTokens),
      output_tokens: integer(usage?.outputTokens),
      reasoning_tokens: integer(usage?.reasoningTokens),
      total_tokens: integer(usage?.totalTokens),
      openai_calls: Array.isArray(usage?.calls) ? usage.calls.length : 0,
      response_ids: Array.isArray(usage?.responseIds) ? usage.responseIds.slice(0, 4) : [],
      usd_cost: usdCost,
      fx_source: usableFx?.source || null,
      fx_reference_date: usableFx?.ecbReferenceDate || null,
      fx_observed_at: usableFx?.observedAt || null,
      fx_stale: Boolean(fx?.stale),
    },
  };
}

export async function recordSitePdfAiEconomicEvent({
  eventId,
  usage,
  model,
  customerType,
  outcome,
  ingressMode,
  analysisStage,
  elapsedMs,
  errorCode,
  occurredAt,
  env = process.env,
  fetchImpl = fetch,
  nowMs = Date.now(),
} = {}) {
  if (!Array.isArray(usage?.calls) || usage.calls.length === 0) return { stored: false, reason: "no_openai_calls" };
  const config = economicConfig(env);
  if (!config.supabaseUrl || !config.serviceKey) return { stored: false, reason: "economic_store_not_configured" };

  let fx = null;
  try {
    fx = await latestVerifiedPremiumFx(config, fetchImpl, nowMs);
  } catch {
    fx = null;
  }
  const entry = buildSitePdfAiEconomicEntry({
    eventId,
    usage,
    model,
    customerType,
    outcome,
    ingressMode,
    analysisStage,
    elapsedMs,
    errorCode,
    fx,
    occurredAt,
  });
  const response = await fetchWithTimeout(
    fetchImpl,
    `${config.supabaseUrl}/rest/v1/premium_economic_entries`,
    {
      method: "POST",
      headers: serviceHeaders(config, {
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      }),
      body: JSON.stringify(entry),
    },
  );
  if (!response.ok) throw new Error(`site_pdf_ai_economic_insert_http_${response.status}`);
  return {
    stored: true,
    status: entry.status,
    category: entry.category,
    amountEur: entry.amount_gross_eur,
    amountUsd: entry.original_amount,
  };
}
