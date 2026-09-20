import { resolveEconomicUsdToEurFx } from "./sitePdfAiEconomics.js";

const ARTICLE_PRICING = Object.freeze({ input: 2, cachedInput: 0.2, output: 12 });
const IMAGE_PRICING = Object.freeze({ textInput: 2.5, cachedTextInput: 0.625, imageInput: 4, cachedImageInput: 1, imageOutput: 15 });
const WEB_SEARCH_USD_PER_CALL = 0.01;
const LONG_CONTEXT_THRESHOLD = 272000;
const ECONOMIC_STORE_TIMEOUT_MS = 1500;

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

function finitePositive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function modelKey(value) {
  return String(value || "").trim().toLowerCase();
}

function articlePricingKnown(model) {
  const key = modelKey(model);
  return key === "gpt-5.6-terra" || key.startsWith("gpt-5.6-terra-");
}

function imagePricingKnown(model) {
  const key = modelKey(model);
  return key === "gpt-image-2" || key === "gpt-image-2-2026-04-21";
}

export function editorialArticleUsage(response = {}) {
  const usage = response?.usage && typeof response.usage === "object" ? response.usage : {};
  const inputTokens = integer(usage.input_tokens);
  const cachedInputTokens = Math.min(inputTokens, integer(usage?.input_tokens_details?.cached_tokens));
  const outputTokens = integer(usage.output_tokens);
  const webSearchCalls = (Array.isArray(response?.output) ? response.output : [])
    .filter((item) => item?.type === "web_search_call").length;
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens: integer(usage?.output_tokens_details?.reasoning_tokens),
    totalTokens: integer(usage.total_tokens || inputTokens + outputTokens),
    webSearchCalls,
  };
}

export function estimateEditorialArticleUsdCost(response = {}, model = "") {
  if (!articlePricingKnown(model)) return null;
  const usage = editorialArticleUsage(response);
  if (usage.inputTokens + usage.outputTokens <= 0 && usage.webSearchCalls <= 0) return null;
  const longContext = usage.inputTokens > LONG_CONTEXT_THRESHOLD;
  const inputMultiplier = longContext ? 2 : 1;
  const outputMultiplier = longContext ? 1.5 : 1;
  const cached = Math.min(usage.inputTokens, usage.cachedInputTokens);
  const uncached = Math.max(0, usage.inputTokens - cached);
  const tokenCost = (
    uncached * ARTICLE_PRICING.input * inputMultiplier +
    cached * ARTICLE_PRICING.cachedInput * inputMultiplier +
    usage.outputTokens * ARTICLE_PRICING.output * outputMultiplier
  ) / 1_000_000;
  return Number((tokenCost + usage.webSearchCalls * WEB_SEARCH_USD_PER_CALL).toFixed(8));
}

export function editorialImageUsage(response = {}) {
  const usage = response?.usage && typeof response.usage === "object" ? response.usage : {};
  const inputTokens = integer(usage.input_tokens);
  const outputTokens = integer(usage.output_tokens);
  const input = usage?.input_tokens_details && typeof usage.input_tokens_details === "object" ? usage.input_tokens_details : {};
  const output = usage?.output_tokens_details && typeof usage.output_tokens_details === "object" ? usage.output_tokens_details : {};
  const imageInputTokens = Math.min(inputTokens, integer(input.image_tokens));
  const textInputTokens = Math.max(0, inputTokens - imageInputTokens);
  const cachedInputTokens = Math.min(inputTokens, integer(input.cached_tokens));
  const cachedImageInputTokens = Math.min(imageInputTokens, integer(input.cached_image_tokens));
  const cachedTextInputTokens = Math.min(textInputTokens, Math.max(0, cachedInputTokens - cachedImageInputTokens));
  return {
    inputTokens,
    outputTokens,
    totalTokens: integer(usage.total_tokens || inputTokens + outputTokens),
    textInputTokens,
    cachedTextInputTokens,
    imageInputTokens,
    cachedImageInputTokens,
    imageOutputTokens: integer(output.image_tokens) || outputTokens,
  };
}

export function estimateEditorialImageUsdCost(response = {}, model = "") {
  if (!imagePricingKnown(model)) return null;
  const usage = editorialImageUsage(response);
  if (usage.inputTokens + usage.outputTokens <= 0) return null;
  const uncachedText = Math.max(0, usage.textInputTokens - usage.cachedTextInputTokens);
  const uncachedImage = Math.max(0, usage.imageInputTokens - usage.cachedImageInputTokens);
  const usd = (
    uncachedText * IMAGE_PRICING.textInput +
    usage.cachedTextInputTokens * IMAGE_PRICING.cachedTextInput +
    uncachedImage * IMAGE_PRICING.imageInput +
    usage.cachedImageInputTokens * IMAGE_PRICING.cachedImageInput +
    usage.imageOutputTokens * IMAGE_PRICING.imageOutput
  ) / 1_000_000;
  return Number(usd.toFixed(8));
}

function occurredAt(response = {}) {
  const raw = Number(response.completed_at ?? response.created_at ?? response.created);
  if (Number.isFinite(raw) && raw > 0) {
    const parsed = new Date(raw > 1e12 ? raw : raw * 1000);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function buildEntry({ category, eventId, unit, usdCost, fx, notes, metadata, response }) {
  const rate = finitePositive(fx?.usdToEur);
  const amountEur = usdCost !== null && rate !== null ? Number((usdCost * rate).toFixed(8)) : null;
  return {
    direction: "cost",
    status: amountEur === null ? "unpriced" : fx?.stale ? "estimated" : "incurred",
    category,
    source_system: "editorial_ai",
    source_event_id: String(eventId || "").slice(0, 160) || null,
    quantity: 1,
    unit,
    original_amount: usdCost,
    original_currency: "USD",
    fx_rate_to_eur: rate,
    amount_net_eur: amountEur,
    vat_rate: null,
    vat_eur: null,
    amount_gross_eur: amountEur,
    occurred_at: occurredAt(response),
    notes,
    metadata: {
      accounting_version: "editorial-ai-accounting-v1",
      pricing_source: "openai_api_public_pricing",
      ...metadata,
      usd_cost: usdCost,
      fx_source: fx?.source || null,
      fx_reference_date: fx?.ecbReferenceDate || null,
      fx_observed_at: fx?.observedAt || null,
      fx_stale: Boolean(fx?.stale),
    },
  };
}

export function buildEditorialArticleAiEconomicEntry({ eventId, response = {}, model, outcome, opportunityId, articleId, runSource, fx = null } = {}) {
  const usage = editorialArticleUsage(response);
  return buildEntry({
    category: "editorial_ai_article",
    eventId,
    unit: "article_generation",
    usdCost: estimateEditorialArticleUsdCost(response, model),
    fx,
    response,
    notes: "Editoriale IA · generazione articolo",
    metadata: {
      pricing_version: "openai-gpt56-terra-websearch-2026-07-30-v1",
      model: String(model || "").slice(0, 120),
      outcome: String(outcome || "").slice(0, 40),
      provider_status: String(response?.status || "").slice(0, 40),
      response_id: String(response?.id || eventId || "").slice(0, 160) || null,
      opportunity_id: String(opportunityId || "").slice(0, 120) || null,
      article_id: String(articleId || "").slice(0, 120) || null,
      run_source: String(runSource || "").slice(0, 80),
      input_tokens: usage.inputTokens,
      cached_input_tokens: usage.cachedInputTokens,
      output_tokens: usage.outputTokens,
      reasoning_tokens: usage.reasoningTokens,
      total_tokens: usage.totalTokens,
      web_search_calls: usage.webSearchCalls,
      web_search_usd_per_call: WEB_SEARCH_USD_PER_CALL,
      long_context_pricing_applied: usage.inputTokens > LONG_CONTEXT_THRESHOLD,
    },
  });
}

export function buildEditorialImageAiEconomicEntry({ eventId, response = {}, model, outcome, opportunityId, articleId, size, quality, fx = null } = {}) {
  const usage = editorialImageUsage(response);
  return buildEntry({
    category: "editorial_ai_image",
    eventId,
    unit: "image_generation",
    usdCost: estimateEditorialImageUsdCost(response, model),
    fx,
    response,
    notes: "Editoriale IA · generazione immagine",
    metadata: {
      pricing_version: "openai-gpt-image-2-2026-09-v1",
      model: String(model || "").slice(0, 120),
      outcome: String(outcome || "").slice(0, 40),
      opportunity_id: String(opportunityId || "").slice(0, 120) || null,
      article_id: String(articleId || "").slice(0, 120) || null,
      size: String(size || "").slice(0, 40),
      quality: String(quality || "").slice(0, 40),
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
      text_input_tokens: usage.textInputTokens,
      image_input_tokens: usage.imageInputTokens,
      image_output_tokens: usage.imageOutputTokens,
      usage_available: usage.inputTokens + usage.outputTokens > 0,
    },
  });
}

function economicConfig(env = process.env) {
  return {
    url: String(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.CUSTOMER_DB_SUPABASE_URL || "").trim().replace(/\/+$/, ""),
    key: String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.SUPABASE_SECRET_KEY || env.CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  };
}

async function store(entry, { env = process.env, fetchImpl = fetch } = {}) {
  if (!entry?.source_event_id) return { stored: false, reason: "missing_source_event_id" };
  const config = economicConfig(env);
  if (!config.url || !config.key) return { stored: false, reason: "economic_store_not_configured" };
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = setTimeout(() => controller?.abort(), ECONOMIC_STORE_TIMEOUT_MS);
  try {
    const headers = {
      apikey: config.key,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    };
    if (config.key.split(".").length === 3) headers.Authorization = `Bearer ${config.key}`;
    const response = await fetchImpl(`${config.url}/rest/v1/premium_economic_entries?on_conflict=source_system,source_event_id,category`, {
      method: "POST",
      headers,
      body: JSON.stringify(entry),
      signal: controller?.signal,
    });
    if (!response.ok) throw new Error(`editorial_ai_economic_insert_http_${response.status}`);
    return { stored: true, category: entry.category, status: entry.status, amountEur: entry.amount_gross_eur, amountUsd: entry.original_amount };
  } finally {
    clearTimeout(timeout);
  }
}

async function record(builder, args = {}) {
  const config = economicConfig(args.env || process.env);
  if (!config.url || !config.key) return { stored: false, reason: "economic_store_not_configured" };
  const fx = await resolveEconomicUsdToEurFx({ env: args.env || process.env, fetchImpl: args.fetchImpl || fetch, nowMs: args.nowMs || Date.now() });
  return store(builder({ ...args, fx }), { env: args.env || process.env, fetchImpl: args.fetchImpl || fetch });
}

export function recordEditorialArticleAiEconomicEvent(args = {}) {
  return record(buildEditorialArticleAiEconomicEntry, args);
}

export function recordEditorialImageAiEconomicEvent(args = {}) {
  return record(buildEditorialImageAiEconomicEntry, args);
}
