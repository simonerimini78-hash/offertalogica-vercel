import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { json, method, readJson, requireAllowedOrigin } from "../lib/http.js";
import { normalizePdfFileHeader } from "../lib/pdfFileValidation.js";
import { extractPdfPureAi } from "../lib/pdfPureAiReader.js";
import { enforceRateLimit } from "../lib/rateLimit.js";
import { checkStore, persistentStoreConfigured } from "../lib/store.js";
import {
  applyPremiumOfferCustomerDecision,
  checkPremiumOfferHistory,
  matchAndPersistPremiumOffer,
} from "../lib/premiumOfferMatcher.js";
import {
  persistPremiumVerifiedOffer,
  staffOfferPayload,
} from "../lib/premiumOfferResolution.js";
import {
  PREMIUM_RED_VERIFIER_VERSION,
  loadPremiumRedVerificationSnapshot,
  routePremiumRedReasons,
  verifyPremiumRedPdf,
} from "../lib/premiumRedVerifier.js";
import {
  premiumBillScopedOfferSummary,
  premiumContractForAutomaticComparison,
  premiumOfferContractCanBindBill,
  premiumOfferMatchVerifiedForBill,
} from "../lib/premiumOfferReferenceTrust.js";
import {
  analysisCompletionStatus,
  assertPremiumAiConfigured,
  checkPremiumBackendReadiness,
  classifyPremiumAutomaticAnalysis,
  createPremiumAnalysisRun,
  createUsageMeter,
  downloadPremiumBill,
  estimatePremiumAiCost,
  loadPremiumBillContract,
  loadPremiumCheckAndBill,
  loadPremiumCustomerBill,
  patchPremiumAnalysisRun,
  patchPremiumBill,
  premiumAiConfig,
  premiumBillValuesFromAnalysis,
  publicPremiumAiError,
  readBearerToken,
  sanitizePremiumAnalysisData,
  verifyPremiumCustomer,
  verifyPremiumStaff,
} from "../lib/premiumAiBackend.js";
import { staffPermissionAllowed } from "../lib/staffSessionAuth.js";

export const config = { maxDuration: 60 };

const PREMIUM_COST_PRICING_VERSION = "premium-ecb-eur-v0.36.43";
const PREMIUM_AI_ACCOUNTING_VERSION = "premium-ai-accounting-v0.36.52";
const PREMIUM_ECB_DAILY_FX_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const PREMIUM_ECB_CACHE_MS = 6 * 60 * 60 * 1000;
const PREMIUM_WEB_SEARCH_USD_PER_1K_RUNS = 10;
const PREMIUM_PROVIDER_RECONCILIATION_VERSION = "premium-provider-reconciliation-v0.36.53";
const PREMIUM_PROVIDER_RECONCILIATION_LAG_MS = 15 * 60 * 1000;
const PREMIUM_OPENAI_ADMIN_BASE_URL = "https://api.openai.com/v1";
const PREMIUM_OPENAI_USD_PRICING = Object.freeze({
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
let premiumEcbFxCache = null;

function configuredOpenAiUsdPricing(model = "") {
  return PREMIUM_OPENAI_USD_PRICING[String(model || "").trim().toLowerCase()] || null;
}

function ecbXmlRate(xml = "") {
  const date = String(xml).match(/<Cube\s+time=["']([^"']+)["']\s*>/i)?.[1] || "";
  const usdQuote = Number(String(xml).match(/<Cube\s+currency=["']USD["']\s+rate=["']([^"']+)["']/i)?.[1]);
  if (!date || !Number.isFinite(usdQuote) || usdQuote <= 0) return null;
  const usdToEur = 1 / usdQuote;
  if (!Number.isFinite(usdToEur) || usdToEur <= 0) return null;
  return { referenceDate: date, eurToUsd: usdQuote, usdToEur };
}

async function latestEcbUsdToEur(fetchImpl = fetch, nowMs = Date.now()) {
  const cached = premiumEcbFxCache;
  if (cached && Number(nowMs) - cached.fetchedAtMs < PREMIUM_ECB_CACHE_MS) {
    return { ...cached, stale: false, cacheHit: true };
  }
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = setTimeout(() => controller?.abort(), 4000);
  try {
    const response = await fetchImpl(PREMIUM_ECB_DAILY_FX_URL, {
      method: "GET",
      headers: { Accept: "application/xml,text/xml;q=0.9,*/*;q=0.1" },
      signal: controller?.signal,
    });
    if (!response?.ok) throw new Error(`ecb_fx_http_${response?.status || 0}`);
    const parsed = ecbXmlRate(await response.text());
    if (!parsed) throw new Error("ecb_fx_invalid_payload");
    premiumEcbFxCache = {
      ...parsed,
      fetchedAtMs: Number(nowMs),
      source: "ecb_reference_rate",
    };
    return { ...premiumEcbFxCache, stale: false, cacheHit: false };
  } catch (error) {
    if (cached) return { ...cached, stale: true, cacheHit: true, errorCode: String(error?.message || "ecb_fx_unavailable") };
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function convertedEurRate(usdRate, usdToEur) {
  const value = Number(usdRate) * Number(usdToEur);
  return Number.isFinite(value) && value >= 0 ? Number(value.toFixed(8)) : null;
}

async function automaticEurPricing(model, fetchImpl = fetch, nowMs = Date.now()) {
  const usd = configuredOpenAiUsdPricing(model);
  const fx = await latestEcbUsdToEur(fetchImpl, nowMs);
  if (!usd || !fx) {
    return {
      inputPerMillion: null,
      cachedInputPerMillion: null,
      outputPerMillion: null,
      webSearchPerThousand: null,
      complete: false,
      sources: {},
      missing: [
        ...(!usd ? [`Listino USD non censito per ${String(model || "modello sconosciuto")}`] : []),
        ...(!fx ? ["Cambio BCE USD/EUR non disponibile"] : []),
      ],
      modelDefaultApplied: false,
      automation: "openai_usd_x_ecb",
      fx: fx || null,
      usd: usd ? { ...usd, webSearchPerThousand: PREMIUM_WEB_SEARCH_USD_PER_1K_RUNS } : null,
    };
  }
  const pricing = {
    inputPerMillion: convertedEurRate(usd.inputPerMillion, fx.usdToEur),
    cachedInputPerMillion: convertedEurRate(usd.cachedInputPerMillion, fx.usdToEur),
    outputPerMillion: convertedEurRate(usd.outputPerMillion, fx.usdToEur),
    webSearchPerThousand: convertedEurRate(PREMIUM_WEB_SEARCH_USD_PER_1K_RUNS, fx.usdToEur),
  };
  const complete = Object.values(pricing).every(value => Number.isFinite(value) && value >= 0);
  return {
    ...pricing,
    complete,
    tokenPricingVerifiedEur: complete,
    sources: {
      inputPerMillion: "openai_usd_x_ecb",
      cachedInputPerMillion: "openai_usd_x_ecb",
      outputPerMillion: "openai_usd_x_ecb",
      webSearchPerThousand: "openai_usd_x_ecb",
    },
    missing: complete ? [] : ["Conversione automatica USD/EUR incompleta"],
    modelDefaultApplied: false,
    automation: "openai_usd_x_ecb",
    fx,
    usd: { ...usd, webSearchPerThousand: PREMIUM_WEB_SEARCH_USD_PER_1K_RUNS },
  };
}

function instrumentWebSearchMeter(meter) {
  if (!meter?.totals || typeof meter.capture !== "function") return meter;
  meter.totals.webSearchCalls = Number(meter.totals.webSearchCalls || 0);
  const capture = meter.capture.bind(meter);
  meter.capture = (body, context = {}) => {
    capture(body, context);
    const calls = Array.isArray(body?.output)
      ? body.output.filter(item => item?.type === "web_search_call").length
      : 0;
    meter.totals.webSearchCalls += calls;
  };
  return meter;
}

function verifiedPremiumAiCostFromPricing(meter, pricing = {}) {
  const webSearchCalls = Math.max(0, Number(meter?.totals?.webSearchCalls || 0));
  if (!pricing?.complete) {
    return {
      estimatedCostEur: null,
      pricingVerified: false,
      pricingSources: pricing?.sources || {},
      webSearchCalls,
      webSearchCostEur: null,
      webSearchRateEurPer1k: pricing?.webSearchPerThousand ?? null,
      webSearchRateUsdPer1k: pricing?.usd?.webSearchPerThousand ?? PREMIUM_WEB_SEARCH_USD_PER_1K_RUNS,
      tokenRatesUsd: pricing?.usd || null,
      usdToEurRate: pricing?.fx?.usdToEur ?? null,
      eurToUsdRate: pricing?.fx?.eurToUsd ?? null,
      ecbReferenceDate: pricing?.fx?.referenceDate || null,
      ecbRateStale: Boolean(pricing?.fx?.stale),
    };
  }
  const tokenCost = estimatePremiumAiCost(meter?.totals || {}, pricing);
  if (tokenCost === null) {
    return {
      estimatedCostEur: null,
      pricingVerified: false,
      pricingSources: pricing.sources || {},
      webSearchCalls,
      webSearchCostEur: null,
      webSearchRateEurPer1k: pricing.webSearchPerThousand,
      webSearchRateUsdPer1k: pricing.usd?.webSearchPerThousand ?? PREMIUM_WEB_SEARCH_USD_PER_1K_RUNS,
      tokenRatesUsd: pricing.usd || null,
      usdToEurRate: pricing.fx?.usdToEur ?? null,
      eurToUsdRate: pricing.fx?.eurToUsd ?? null,
      ecbReferenceDate: pricing.fx?.referenceDate || null,
      ecbRateStale: Boolean(pricing.fx?.stale),
    };
  }
  const webSearchCostEur = webSearchCalls > 0 ? (webSearchCalls * pricing.webSearchPerThousand) / 1000 : 0;
  return {
    estimatedCostEur: Number((tokenCost + webSearchCostEur).toFixed(6)),
    pricingVerified: true,
    pricingSources: pricing.sources || {},
    webSearchCalls,
    webSearchCostEur: Number(webSearchCostEur.toFixed(6)),
    webSearchRateEurPer1k: pricing.webSearchPerThousand,
    webSearchRateUsdPer1k: pricing.usd.webSearchPerThousand,
    tokenRatesUsd: pricing.usd,
    usdToEurRate: pricing.fx.usdToEur,
    eurToUsdRate: pricing.fx.eurToUsd,
    ecbReferenceDate: pricing.fx.referenceDate,
    ecbRateStale: Boolean(pricing.fx.stale),
  };
}

async function requireVerifiedPremiumPricing(backend, fetchImpl, nowMs) {
  const pricing = await automaticEurPricing(backend?.model, fetchImpl, nowMs);
  if (!pricing?.complete) {
    const details = Array.isArray(pricing?.missing) ? pricing.missing.join(",") : "pricing_incomplete";
    throw new Error(`premium_ai_pricing_unavailable:${details}`);
  }
  return pricing;
}

function providerKeyFingerprint(value = "") {
  const secret = String(value || "").trim();
  if (!secret) return null;
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex").slice(0, 16);
}

function premiumAiUsageDetails(meter, costResult, backend, nowMs = Date.now()) {
  return {
    input_tokens: Number(meter?.totals?.inputTokens || 0),
    cached_input_tokens: Number(meter?.totals?.cachedInputTokens || 0),
    output_tokens: Number(meter?.totals?.outputTokens || 0),
    reasoning_tokens: Number(meter?.totals?.reasoningTokens || 0),
    total_tokens: Number(meter?.totals?.totalTokens || 0),
    calls: Array.isArray(meter?.totals?.calls) ? meter.totals.calls : [],
    pricing_verified_eur: costResult.pricingVerified,
    pricing_version: costResult.pricingVerified ? PREMIUM_COST_PRICING_VERSION : null,
    pricing_sources: costResult.pricingSources || {},
    pricing_mode: "openai_usd_x_ecb",
    usd_to_eur_rate: costResult.usdToEurRate,
    eur_to_usd_rate: costResult.eurToUsdRate,
    ecb_reference_date: costResult.ecbReferenceDate,
    ecb_rate_stale: costResult.ecbRateStale,
    token_rates_usd_per_million: costResult.tokenRatesUsd,
    web_search_rate_usd_per_1k: costResult.webSearchRateUsdPer1k,
    web_search_calls: costResult.webSearchCalls,
    web_search_cost_eur: costResult.webSearchCostEur,
    web_search_rate_eur_per_1k: costResult.webSearchRateEurPer1k,
    accounting_version: PREMIUM_AI_ACCOUNTING_VERSION,
    provider_key_fingerprint: providerKeyFingerprint(backend?.openAiApiKey),
    cost_checkpointed_at: new Date(nowMs).toISOString(),
  };
}

function premiumAiAccountingSnapshot(meter, pricingSnapshot, backend, nowMs = Date.now()) {
  const costResult = verifiedPremiumAiCostFromPricing(meter, pricingSnapshot);
  if (!costResult.pricingVerified || costResult.estimatedCostEur === null) {
    throw new Error("premium_ai_cost_required");
  }
  return {
    costResult,
    estimatedCostEur: costResult.estimatedCostEur,
    usageDetails: premiumAiUsageDetails(meter, costResult, backend, nowMs),
  };
}

async function checkpointPremiumAiRunCost({ backend, run, meter, pricingSnapshot, fetchImpl, nowMs }) {
  if (!run?.id) throw new Error("premium_ai_cost_context_invalid");
  const accounting = premiumAiAccountingSnapshot(meter, pricingSnapshot, backend, nowMs);
  await patchPremiumAnalysisRun({
    config: backend,
    runId: run.id,
    fetchImpl,
    values: {
      input_tokens: Number(meter?.totals?.inputTokens || 0),
      output_tokens: Number(meter?.totals?.outputTokens || 0),
      estimated_cost_eur: accounting.estimatedCostEur,
      usage_details: accounting.usageDetails,
      response_ids: Array.isArray(meter?.totals?.responseIds) ? meter.totals.responseIds : [],
    },
  });
  return accounting;
}

async function createAccountedOpenAiTransport({ meter, fetchImpl = fetch, onUsage } = {}) {
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
    if (typeof onUsage === "function") await onUsage({ body, attempt, profile, totals: meter?.totals || null });
    return body;
  };
}

function serviceHeaders(config, extra = {}) {
  const headers = { apikey: config.serviceKey, ...extra };
  if (String(config?.serviceKey || "").split(".").length === 3) headers.Authorization = `Bearer ${config.serviceKey}`;
  return headers;
}

async function localServiceRequest(config, endpoint, init = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.supabaseUrl}${endpoint}`, {
    ...init,
    headers: serviceHeaders(config, init.headers || {}),
  });
  const text = await response.text().catch(() => "");
  let body = null;
  if (text) {
    try { body = JSON.parse(text); }
    catch { body = text; }
  }
  if (!response.ok) {
    const details = typeof body === "string" ? body : JSON.stringify(body || {});
    throw new Error(`premium_supabase_http_${response.status}:${details.slice(0, 500)}`);
  }
  return body;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function finiteNonNegative(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

async function upsertPremiumAiCostEvent({ backend, bill, check, run, meter, accounting, model, fetchImpl = fetch }) {
  const cost = finiteNonNegative(accounting?.estimatedCostEur);
  if (cost === null) throw new Error("premium_ai_cost_required");
  if (!bill?.id || !bill?.user_id || !run?.id) throw new Error("premium_ai_cost_context_invalid");
  const usage = meter?.totals || {};
  const details = accounting?.usageDetails && typeof accounting.usageDetails === "object" ? accounting.usageDetails : {};
  const record = {
    user_id: bill.user_id,
    bill_id: bill.id,
    analysis_run_id: run.id,
    check_id: check?.id || null,
    event_type: "ai_analysis",
    provider: "openai",
    quantity: nonNegativeInteger(usage.totalTokens),
    unit: "tokens",
    cost_eur: cost,
    currency: "EUR",
    provider_event_id: Array.isArray(usage.responseIds) ? usage.responseIds[0] || null : null,
    metadata: {
      model: String(model || ""),
      input_tokens: nonNegativeInteger(usage.inputTokens),
      cached_input_tokens: nonNegativeInteger(usage.cachedInputTokens),
      output_tokens: nonNegativeInteger(usage.outputTokens),
      reasoning_tokens: nonNegativeInteger(usage.reasoningTokens),
      total_tokens: nonNegativeInteger(usage.totalTokens),
      calls: Array.isArray(usage.calls) ? usage.calls : [],
      pricing_configured: true,
      pricing_verified_eur: details.pricing_verified_eur === true,
      pricing_version: details.pricing_version || null,
      pricing_source: details.pricing_mode || "openai_usd_x_ecb",
      pricing_sources: details.pricing_sources || {},
      usd_to_eur_rate: details.usd_to_eur_rate ?? null,
      eur_to_usd_rate: details.eur_to_usd_rate ?? null,
      ecb_reference_date: details.ecb_reference_date || null,
      ecb_rate_stale: Boolean(details.ecb_rate_stale),
      token_rates_usd_per_million: details.token_rates_usd_per_million || null,
      web_search_rate_usd_per_1k: details.web_search_rate_usd_per_1k ?? null,
      web_search_calls: nonNegativeInteger(details.web_search_calls),
      web_search_cost_eur: finiteNonNegative(details.web_search_cost_eur),
      web_search_rate_eur_per_1k: finiteNonNegative(details.web_search_rate_eur_per_1k),
      accounting_version: details.accounting_version || PREMIUM_AI_ACCOUNTING_VERSION,
      provider_key_fingerprint: details.provider_key_fingerprint || providerKeyFingerprint(backend?.openAiApiKey),
      origin: run?.origin || (check ? "staff_manual" : "customer_upload"),
    },
  };
  const existingQuery = new URLSearchParams({
    select: "id",
    event_type: "eq.ai_analysis",
    analysis_run_id: `eq.${run.id}`,
    order: "occurred_at.desc",
    limit: "1",
  });
  const existing = await localServiceRequest(backend, `/rest/v1/premium_cost_events?${existingQuery}`, { method: "GET" }, fetchImpl);
  const existingId = Array.isArray(existing) ? existing[0]?.id : null;
  if (existingId) {
    const patchQuery = new URLSearchParams({ id: `eq.${existingId}` });
    return localServiceRequest(backend, `/rest/v1/premium_cost_events?${patchQuery}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(record),
    }, fetchImpl);
  }
  return localServiceRequest(backend, "/rest/v1/premium_cost_events", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(record),
  }, fetchImpl);
}

async function syncPremiumAiCostEvent({ backend, bill, check, run, meter, accounting, model, fetchImpl }) {
  return upsertPremiumAiCostEvent({ backend, bill, check, run, meter, accounting, model, fetchImpl });
}

async function reconcilePremiumAiCostEventsLocal({ backend, limit = 250, fetchImpl = fetch } = {}) {
  const safeLimit = Math.max(1, Math.min(500, nonNegativeInteger(limit) || 250));
  const runQuery = new URLSearchParams({
    select: "id,bill_id,user_id,origin,model,input_tokens,output_tokens,estimated_cost_eur,usage_details,response_ids,created_at",
    estimated_cost_eur: "not.is.null",
    order: "created_at.desc",
    limit: String(safeLimit),
  });
  const runs = await localServiceRequest(backend, `/rest/v1/premium_analysis_runs?${runQuery}`, { method: "GET" }, fetchImpl);
  const eligible = (Array.isArray(runs) ? runs : []).filter(run => {
    const usage = run?.usage_details && typeof run.usage_details === "object" ? run.usage_details : {};
    const cost = finiteNonNegative(run?.estimated_cost_eur);
    return run?.id && run?.bill_id && run?.user_id && cost !== null && usage.pricing_verified_eur === true;
  });
  if (!eligible.length) return { scanned: Array.isArray(runs) ? runs.length : 0, eligible: 0, restored: 0, alreadyPresent: 0 };
  const ids = eligible.map(run => run.id);
  const eventQuery = new URLSearchParams({
    select: "id,analysis_run_id,cost_eur,quantity",
    event_type: "eq.ai_analysis",
    analysis_run_id: `in.(${ids.join(",")})`,
    limit: String(Math.min(1000, Math.max(ids.length * 2, ids.length))),
  });
  const events = await localServiceRequest(backend, `/rest/v1/premium_cost_events?${eventQuery}`, { method: "GET" }, fetchImpl);
  const byRunId = new Map((Array.isArray(events) ? events : [])
    .filter(event => event?.analysis_run_id)
    .map(event => [String(event.analysis_run_id), event]));
  let restored = 0;
  let repaired = 0;
  let alreadyPresent = 0;
  for (const run of eligible) {
    const details = run.usage_details && typeof run.usage_details === "object" ? run.usage_details : {};
    const meter = {
      totals: {
        inputTokens: nonNegativeInteger(details.input_tokens ?? run.input_tokens),
        cachedInputTokens: nonNegativeInteger(details.cached_input_tokens),
        outputTokens: nonNegativeInteger(details.output_tokens ?? run.output_tokens),
        reasoningTokens: nonNegativeInteger(details.reasoning_tokens),
        totalTokens: nonNegativeInteger(details.total_tokens ?? (nonNegativeInteger(run.input_tokens) + nonNegativeInteger(run.output_tokens))),
        responseIds: Array.isArray(run.response_ids) ? run.response_ids : [],
        calls: Array.isArray(details.calls) ? details.calls : [],
        webSearchCalls: nonNegativeInteger(details.web_search_calls),
      },
    };
    const existing = byRunId.get(run.id) || null;
    const expectedCost = finiteNonNegative(run.estimated_cost_eur);
    const expectedQuantity = nonNegativeInteger(meter.totals.totalTokens);
    const eventMatches = existing
      && expectedCost !== null
      && Math.abs(Number(existing.cost_eur) - expectedCost) <= 0.000001
      && nonNegativeInteger(existing.quantity) === expectedQuantity;
    if (eventMatches) {
      alreadyPresent += 1;
      continue;
    }
    await upsertPremiumAiCostEvent({
      backend,
      bill: { id: run.bill_id, user_id: run.user_id },
      check: null,
      run,
      meter,
      accounting: { estimatedCostEur: run.estimated_cost_eur, usageDetails: details },
      model: run.model,
      fetchImpl,
    });
    if (existing) repaired += 1;
    else restored += 1;
  }
  return { scanned: Array.isArray(runs) ? runs.length : 0, eligible: eligible.length, restored, repaired, alreadyPresent };
}

function redactedApiKeyMatches(secretValue, redactedValue) {
  const secret = String(secretValue || "").trim();
  const redacted = String(redactedValue || "").trim();
  if (!secret || !redacted) return false;
  const wildcard = redacted.search(/\*|…|\.\.\./);
  if (wildcard < 0) return secret === redacted;
  const prefix = redacted.slice(0, wildcard).replace(/[.*…]+$/g, "");
  const suffix = redacted.slice(wildcard).replace(/[.*…]/g, "");
  return (!prefix || secret.startsWith(prefix)) && (!suffix || secret.endsWith(suffix));
}

async function openAiAdminRequest(pathname, adminKey, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${PREMIUM_OPENAI_ADMIN_BASE_URL}${pathname}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${adminKey}`, "Content-Type": "application/json" },
      signal: controller?.signal,
    });
    const text = await response.text().catch(() => "");
    let body = null;
    try { body = text ? JSON.parse(text) : {}; }
    catch { throw new Error(`openai_admin_invalid_json:${text.slice(0, 180)}`); }
    if (!response.ok) throw new Error(`openai_admin_http_${response.status}:${text.slice(0, 240)}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveCurrentOpenAiApiKey({ adminKey, apiKey, fetchImpl = fetch }) {
  if (!adminKey) throw new Error("premium_openai_admin_not_configured");
  if (!apiKey) throw new Error("premium_openai_not_configured");
  const projects = [];
  let after = "";
  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams({ limit: "100", include_archived: "false" });
    if (after) query.set("after", after);
    const payload = await openAiAdminRequest(`/organization/projects?${query}`, adminKey, { fetchImpl });
    projects.push(...(Array.isArray(payload?.data) ? payload.data : []));
    if (!payload?.has_more || !payload?.last_id) break;
    after = payload.last_id;
  }
  const matches = [];
  for (const project of projects.filter(item => item?.id && item?.status !== "archived")) {
    let keyAfter = "";
    for (let page = 0; page < 10; page += 1) {
      const query = new URLSearchParams({ limit: "100" });
      if (keyAfter) query.set("after", keyAfter);
      const payload = await openAiAdminRequest(`/organization/projects/${encodeURIComponent(project.id)}/api_keys?${query}`, adminKey, { fetchImpl });
      const keys = Array.isArray(payload?.data) ? payload.data : [];
      for (const key of keys) {
        if (key?.id && redactedApiKeyMatches(apiKey, key?.redacted_value)) {
          matches.push({
            apiKeyId: key.id,
            apiKeyName: String(key.name || ""),
            projectId: project.id,
            projectName: String(project.name || ""),
            lastUsedAt: Number(key.last_used_at || 0) || null,
          });
        }
      }
      if (!payload?.has_more || !payload?.last_id) break;
      keyAfter = payload.last_id;
    }
  }
  if (matches.length !== 1) throw new Error(matches.length ? "premium_openai_api_key_ambiguous" : "premium_openai_api_key_not_found");
  return matches[0];
}

function appendArrayParam(query, name, values) {
  for (const value of values) query.append(`${name}[]`, String(value));
}

async function fetchOpenAiUsagePage(pathname, query, adminKey, fetchImpl) {
  const totals = [];
  let page = "";
  for (let index = 0; index < 20; index += 1) {
    const current = new URLSearchParams(query);
    if (page) current.set("page", page);
    const payload = await openAiAdminRequest(`${pathname}?${current}`, adminKey, { fetchImpl });
    totals.push(...(Array.isArray(payload?.data) ? payload.data : []));
    if (!payload?.has_more || !payload?.next_page) break;
    page = payload.next_page;
  }
  return totals;
}

function flattenUsageResults(buckets = []) {
  return (Array.isArray(buckets) ? buckets : []).flatMap(bucket => Array.isArray(bucket?.results) ? bucket.results : []);
}

async function reconcileOpenAiProviderCosts({ backend, env, fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const adminKey = String(env?.OPENAI_ADMIN_KEY || "").trim();
  if (!adminKey) throw new Error("premium_openai_admin_not_configured");
  const identity = await resolveCurrentOpenAiApiKey({ adminKey, apiKey: backend?.openAiApiKey, fetchImpl });
  const fingerprint = providerKeyFingerprint(backend?.openAiApiKey);
  const runQuery = new URLSearchParams({
    select: "id,status,model,origin,input_tokens,output_tokens,estimated_cost_eur,usage_details,response_ids,created_at",
    order: "created_at.desc",
    limit: "500",
  });
  const rows = await localServiceRequest(backend, `/rest/v1/premium_analysis_runs?${runQuery}`, { method: "GET" }, fetchImpl);
  const cutoffMs = Number(nowMs) - PREMIUM_PROVIDER_RECONCILIATION_LAG_MS;
  const eligible = (Array.isArray(rows) ? rows : []).filter(run => {
    const createdMs = new Date(run?.created_at || 0).getTime();
    const details = run?.usage_details && typeof run.usage_details === "object" ? run.usage_details : {};
    return run?.id && Number.isFinite(createdMs) && createdMs > 0 && createdMs <= cutoffMs
      && details.provider_key_fingerprint === fingerprint
      && details.pricing_verified_eur === true;
  });
  if (!eligible.length) {
    return {
      version: PREMIUM_PROVIDER_RECONCILIATION_VERSION,
      status: "waiting_for_accounted_run",
      adminKeyOperational: true,
      apiKeyId: identity.apiKeyId,
      apiKeyName: identity.apiKeyName,
      projectId: identity.projectId,
      projectName: identity.projectName,
      lagMinutes: PREMIUM_PROVIDER_RECONCILIATION_LAG_MS / 60000,
    };
  }
  const startMs = Math.max(0, Math.min(...eligible.map(run => new Date(run.created_at).getTime())) - 5000);
  const startTime = Math.floor(startMs / 1000);
  const endTime = Math.floor(cutoffMs / 1000);
  if (endTime <= startTime) throw new Error("premium_openai_reconciliation_window_invalid");

  const completionQuery = new URLSearchParams({
    start_time: String(startTime), end_time: String(endTime), bucket_width: "1m", limit: "1440",
  });
  appendArrayParam(completionQuery, "api_key_ids", [identity.apiKeyId]);
  appendArrayParam(completionQuery, "group_by", ["api_key_id", "model"]);
  const webQuery = new URLSearchParams({
    start_time: String(startTime), end_time: String(endTime), bucket_width: "1m", limit: "1440",
  });
  appendArrayParam(webQuery, "api_key_ids", [identity.apiKeyId]);
  appendArrayParam(webQuery, "group_by", ["api_key_id", "model"]);
  const costQuery = new URLSearchParams({ start_time: String(startTime), end_time: String(endTime), bucket_width: "1d", limit: "180" });
  appendArrayParam(costQuery, "api_key_ids", [identity.apiKeyId]);
  appendArrayParam(costQuery, "group_by", ["api_key_id", "line_item"]);

  const [completionBuckets, webBuckets, costBuckets] = await Promise.all([
    fetchOpenAiUsagePage("/organization/usage/completions", completionQuery, adminKey, fetchImpl),
    fetchOpenAiUsagePage("/organization/usage/web_search_calls", webQuery, adminKey, fetchImpl),
    fetchOpenAiUsagePage("/organization/costs", costQuery, adminKey, fetchImpl),
  ]);
  const completionResults = flattenUsageResults(completionBuckets).filter(item => !item?.api_key_id || item.api_key_id === identity.apiKeyId);
  const webResults = flattenUsageResults(webBuckets).filter(item => !item?.api_key_id || item.api_key_id === identity.apiKeyId);
  const costResults = flattenUsageResults(costBuckets).filter(item => !item?.api_key_id || item.api_key_id === identity.apiKeyId);
  const provider = {
    inputTokens: completionResults.reduce((sum, item) => sum + nonNegativeInteger(item?.input_tokens), 0),
    cachedInputTokens: completionResults.reduce((sum, item) => sum + nonNegativeInteger(item?.input_cached_tokens), 0),
    outputTokens: completionResults.reduce((sum, item) => sum + nonNegativeInteger(item?.output_tokens), 0),
    modelRequests: completionResults.reduce((sum, item) => sum + nonNegativeInteger(item?.num_model_requests), 0),
    webSearchCalls: webResults.reduce((sum, item) => sum + nonNegativeInteger(item?.num_requests), 0),
    costUsd: Number(costResults.reduce((sum, item) => {
      const amount = item?.amount?.currency === "usd" ? Number(item?.amount?.value || 0) : 0;
      return sum + (Number.isFinite(amount) ? amount : 0);
    }, 0).toFixed(6)),
  };
  const internal = eligible.reduce((totals, run) => {
    const details = run?.usage_details && typeof run.usage_details === "object" ? run.usage_details : {};
    totals.inputTokens += nonNegativeInteger(details.input_tokens ?? run.input_tokens);
    totals.cachedInputTokens += nonNegativeInteger(details.cached_input_tokens);
    totals.outputTokens += nonNegativeInteger(details.output_tokens ?? run.output_tokens);
    totals.modelRequests += Array.isArray(details.calls) ? details.calls.length : 0;
    totals.webSearchCalls += nonNegativeInteger(details.web_search_calls);
    totals.costEur += finiteNonNegative(run.estimated_cost_eur) || 0;
    const fx = finiteNonNegative(details.usd_to_eur_rate);
    const eurCost = finiteNonNegative(run.estimated_cost_eur);
    if (fx && eurCost !== null) totals.estimatedCostUsd += eurCost / fx;
    return totals;
  }, { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, modelRequests: 0, webSearchCalls: 0, costEur: 0, estimatedCostUsd: 0 });
  internal.costEur = Number(internal.costEur.toFixed(6));
  internal.estimatedCostUsd = Number(internal.estimatedCostUsd.toFixed(6));
  const usageMatches = provider.inputTokens === internal.inputTokens
    && provider.cachedInputTokens === internal.cachedInputTokens
    && provider.outputTokens === internal.outputTokens
    && provider.modelRequests === internal.modelRequests
    && provider.webSearchCalls === internal.webSearchCalls;
  const providerCostAvailable = provider.costUsd > 0 || (provider.modelRequests === 0 && provider.webSearchCalls === 0);
  const costDeltaUsd = Number((provider.costUsd - internal.estimatedCostUsd).toFixed(6));
  const toleranceUsd = Math.max(0.02, Math.abs(provider.costUsd) * 0.05);
  const costMatches = providerCostAvailable && Math.abs(costDeltaUsd) <= toleranceUsd;
  const status = !usageMatches
    ? "usage_mismatch"
    : !providerCostAvailable
      ? "provider_cost_pending"
      : costMatches ? "matched" : "cost_mismatch";
  return {
    version: PREMIUM_PROVIDER_RECONCILIATION_VERSION,
    status,
    adminKeyOperational: true,
    apiKeyId: identity.apiKeyId,
    apiKeyName: identity.apiKeyName,
    projectId: identity.projectId,
    projectName: identity.projectName,
    window: { startTime, endTime, lagMinutes: PREMIUM_PROVIDER_RECONCILIATION_LAG_MS / 60000 },
    runsCompared: eligible.length,
    provider,
    internal,
    usageMatches,
    providerCostAvailable,
    costMatches,
    costDeltaUsd,
    toleranceUsd: Number(toleranceUsd.toFixed(6)),
  };
}

function publicPremiumAccountingError(error) {
  const message = String(error?.message || "");
  if (/premium_ai_pricing_unavailable|premium_ai_cost_required|premium_ai_cost_context_invalid/.test(message)) {
    return { status: 503, code: "PREMIUM_AI_ACCOUNTING_UNAVAILABLE", error: "Analisi temporaneamente sospesa perché il costo IA non è verificabile. Riprova tra poco." };
  }
  if (/premium_openai_admin_not_configured/.test(message)) {
    return { status: 503, code: "PREMIUM_OPENAI_ADMIN_NOT_CONFIGURED", error: "Riconciliazione OpenAI non configurata sul server." };
  }
  if (/premium_openai_api_key_not_found|premium_openai_api_key_ambiguous/.test(message)) {
    return { status: 503, code: "PREMIUM_OPENAI_KEY_NOT_RESOLVED", error: "La chiave OpenAI operativa non è stata identificata in modo univoco dall’amministrazione OpenAI." };
  }
  if (/openai_admin_/.test(message)) {
    return { status: 502, code: "PREMIUM_OPENAI_ADMIN_UNAVAILABLE", error: "OpenAI non ha restituito i dati amministrativi necessari alla riconciliazione." };
  }
  return publicPremiumAiError(error);
}

function resetRedVerificationValues() {
  return {
    red_verification_state: "not_run",
    red_verification_result: {},
    red_verification_run_id: null,
    red_verified_at: null,
  };
}

function publicRedVerification(result = {}) {
  return {
    route: result.route || "staff_required",
    decision: result.decision || "staff_required",
    issue: result.issue || "",
    evidence: Array.isArray(result.evidence) ? result.evidence : [],
    verification_result: result.verification_result || "inconclusive",
    confidence: result.confidence || "low",
    can_resolve_alone: result.can_resolve_alone || "no",
    customer_reply: result.customer_reply || "",
    escalation_reason: result.escalation_reason || "",
    missing_data: Array.isArray(result.missing_data) ? result.missing_data : [],
    offer_resolution: result.offer_resolution && typeof result.offer_resolution === "object" ? result.offer_resolution : { status: "none", candidates: [] },
  };
}

function offerMatchWarning(offerMatch) {
  if (!offerMatch) return "";
  if (offerMatch.status === "existing_verified") return "offerta_attiva_gia_verificata";
  if (offerMatch.status === "matched" && offerMatch.verified) return "offerta_attiva_identificata_arera";
  if (["matched", "partial", "ambiguous"].includes(offerMatch.status)) return "offerta_attiva_da_confermare";
  if (offerMatch.status === "customer_rejected") return "offerta_attiva_esclusa_dal_cliente";
  if (offerMatch.status === "not_found") return "offerta_attiva_non_trovata_nello_storico_arera";
  if (offerMatch.status === "error") return "ricerca_offerta_arera_non_disponibile";
  return "";
}

export function createPremiumAiAnalysisHandler({
  env = process.env,
  fetchImpl = fetch,
  analyzePdf = extractPdfPureAi,
  matchOffer = matchAndPersistPremiumOffer,
  decideOffer = applyPremiumOfferCustomerDecision,
  verifyRedPdf = verifyPremiumRedPdf,
  now = () => Date.now(),
} = {}) {
  return async function handler(req, res) {
    if (!method(req, res, ["POST"])) return;
    if (!requireAllowedOrigin(req, res)) return;

    const startedAt = now();
    const backend = premiumAiConfig(env);
    let run = null;
    let bill = null;
    let check = null;
    let customerMode = false;
    let temporaryFilePath = "";
    let meter = null;
    let pricingSnapshot = null;

    try {
      const body = await readJson(req);
      const accessToken = readBearerToken(req);
      const offerDecision = body?.action === "confirm_offer"
        ? "confirm"
        : body?.action === "reject_offer"
          ? "reject"
          : "";

      if (body?.action === "provider_cost_reconciliation") {
        if (!backend.supabaseUrl || !backend.serviceKey) throw new Error("premium_supabase_not_configured");
        await verifyPremiumStaff({ config: backend, accessToken, fetchImpl });
        if (!(await staffPermissionAllowed({
          config: backend,
          accessToken,
          permission: "view_ai_costs",
          fetchImpl,
        }))) throw new Error("premium_staff_permission_required:view_ai_costs");
        try {
          const reconciliation = await reconcileOpenAiProviderCosts({ backend, env, fetchImpl, nowMs: now() });
          return json(res, 200, { ok: true, mode: "provider_cost_reconciliation", reconciliation });
        } catch (providerError) {
          const safe = publicPremiumAccountingError(providerError);
          return json(res, safe.status, { ok: false, code: safe.code, error: safe.error });
        }
      }

      if (body?.action === "config_status") {
        if (!backend.supabaseUrl || !backend.serviceKey) throw new Error("premium_supabase_not_configured");
        await verifyPremiumStaff({ config: backend, accessToken, fetchImpl });
        if (!(await staffPermissionAllowed({
          config: backend,
          accessToken,
          permission: "view_ai_costs",
          fetchImpl,
        }))) throw new Error("premium_staff_permission_required:view_ai_costs");
        const persistentRateLimitConfigured = persistentStoreConfigured();
        const [backendReadiness, offerHistory, persistentRateLimitOperational, costReconciliation] = await Promise.all([
          checkPremiumBackendReadiness({ config: backend, fetchImpl }),
          checkPremiumOfferHistory({ env, fetchImpl }),
          persistentRateLimitConfigured ? checkStore().catch(() => false) : Promise.resolve(false),
          reconcilePremiumAiCostEventsLocal({ backend, limit: 250, fetchImpl }).catch(error => ({
            error: String(error?.message || "premium_ai_cost_reconciliation_failed").slice(0, 180),
          })),
        ]);
        const numberOr = (name, fallback) => {
          const value = Number(env[name]);
          return Number.isFinite(value) && value > 0 ? value : fallback;
        };
        const pricing = await automaticEurPricing(backend.model, fetchImpl, now());
        return json(res, 200, {
          ok: true,
          mode: "config_status",
          configuration: {
            supabaseConfigured: Boolean(backend.supabaseUrl && backend.serviceKey),
            openAiConfigured: Boolean(backend.openAiApiKey),
            openAiAdminConfigured: Boolean(String(env.OPENAI_ADMIN_KEY || "").trim()),
            persistentRateLimitConfigured,
            persistentRateLimitOperational,
            databaseOperational: Boolean(backendReadiness.database?.ok),
            storageBucketOperational: Boolean(backendReadiness.storageBucket?.ok),
            storageBucket: backendReadiness.storageBucket?.bucket || backend.bucket,
            offerHistoryOperational: Boolean(offerHistory.ok),
            offerHistoryOffers: Number(offerHistory.offers || 0),
            offerHistoryVersion: offerHistory.version || "",
            model: backend.model,
            maxPdfBytes: backend.maxPdfBytes,
            deadlineMs: backend.deadlineMs,
            pricing,
            costReconciliation,
            rateLimits: {
              customerAnalysis: { limit: numberOr("RATE_LIMIT_PREMIUM_AI_CUSTOMER_LIMIT", 24), windowSeconds: numberOr("RATE_LIMIT_PREMIUM_AI_CUSTOMER_WINDOW_SECONDS", 3600) },
              staffAnalysis: { limit: numberOr("RATE_LIMIT_PREMIUM_AI_LIMIT", 12), windowSeconds: numberOr("RATE_LIMIT_PREMIUM_AI_WINDOW_SECONDS", 3600) },
              offerConfirmation: { limit: numberOr("RATE_LIMIT_PREMIUM_OFFER_CONFIRM_LIMIT", 30), windowSeconds: numberOr("RATE_LIMIT_PREMIUM_OFFER_CONFIRM_WINDOW_SECONDS", 3600) },
            },
          },
        });
      }

      if (offerDecision) {
        if (!backend.supabaseUrl || !backend.serviceKey) throw new Error("premium_supabase_not_configured");
        const { user } = await verifyPremiumCustomer({ config: backend, accessToken, fetchImpl });
        if (!(await enforceRateLimit(req, res, {
          label: "premium-offer-confirmation",
          identifier: user.id,
          limit: Number(env.RATE_LIMIT_PREMIUM_OFFER_CONFIRM_LIMIT || 30),
          windowSeconds: Number(env.RATE_LIMIT_PREMIUM_OFFER_CONFIRM_WINDOW_SECONDS || 3600),
        }))) return;

        const decisionResult = await decideOffer({
          config: backend,
          userId: user.id,
          contractId: body?.contractId,
          billId: body?.billId,
          decision: offerDecision,
          selections: body?.selections,
          fetchImpl,
        });

        let screening = null;
        if (offerDecision === "confirm" && decisionResult.normalized && decisionResult.run?.id) {
          screening = classifyPremiumAutomaticAnalysis(decisionResult.normalized, {
            contract: decisionResult.contract,
          });
          const completedAt = new Date().toISOString();
          await patchPremiumBill({
            config: backend,
            billId: decisionResult.bill.id,
            fetchImpl,
            values: {
              ...premiumBillValuesFromAnalysis(
                decisionResult.normalized,
                screening,
                decisionResult.run.id,
                completedAt,
              ),
              ...resetRedVerificationValues(),
              contract_id: decisionResult.contract.id,
            },
          });
          await patchPremiumAnalysisRun({
            config: backend,
            runId: decisionResult.run.id,
            fetchImpl,
            values: {
              automatic_classification: screening.status,
              automatic_summary: screening.summary,
              automatic_reasons: screening.reasons,
            },
          });
        }

        return json(res, 200, {
          ok: true,
          mode: "offer_confirmation",
          decision: offerDecision,
          contract: {
            id: decisionResult.contract?.id || null,
            verificationStatus: decisionResult.contract?.verification_status || null,
            confirmationStatus: decisionResult.contract?.customer_confirmation_status || null,
            providerName: decisionResult.contract?.provider_name || "",
            offerName: decisionResult.contract?.offer_name || "",
          },
          screening,
        });
      }

      if (body?.action === "staff_validate_offer") {
        if (!backend.supabaseUrl || !backend.serviceKey) throw new Error("premium_supabase_not_configured");
        const { user } = await verifyPremiumStaff({ config: backend, accessToken, fetchImpl });
        if (!(await staffPermissionAllowed({ config: backend, accessToken, permission: "manage_checks", fetchImpl }))) {
          throw new Error("premium_staff_permission_required:manage_checks");
        }
        if (!(await enforceRateLimit(req, res, {
          label: "premium-offer-validation-staff",
          identifier: user.id,
          limit: Number(env.RATE_LIMIT_PREMIUM_OFFER_CONFIRM_LIMIT || 30),
          windowSeconds: Number(env.RATE_LIMIT_PREMIUM_OFFER_CONFIRM_WINDOW_SECONDS || 3600),
        }))) return;
        ({ check, bill } = await loadPremiumCheckAndBill({ config: backend, checkId: body?.checkId, fetchImpl }));
        const snapshot = await loadPremiumRedVerificationSnapshot({
          config: backend, billId: bill.id, userId: check.user_id, fetchImpl,
        });
        const commodity = bill.commodity === "electricity" ? "electricity" : bill.commodity === "gas" ? "gas" : null;
        if (!commodity) throw new Error("premium_offer_commodity_invalid");
        const offer = staffOfferPayload(body?.offer || {}, commodity);
        const completedAt = new Date().toISOString();
        const persisted = await persistPremiumVerifiedOffer({
          config: backend, bill: snapshot.bill, offer, actor: "staff", fetchImpl, now: completedAt,
        });
        const normalized = snapshot.firstRun?.extracted_data || null;
        let screening = null;
        if (normalized && snapshot.firstRun?.id) {
          const normalizedWithOffer = { ...normalized, _offer_match: { status: "matched", verified: true } };
          screening = classifyPremiumAutomaticAnalysis(normalizedWithOffer, {
            contract: premiumContractForAutomaticComparison(persisted.contract, normalizedWithOffer),
          });
          await patchPremiumAnalysisRun({
            config: backend, runId: snapshot.firstRun.id, fetchImpl,
            values: { automatic_classification: screening.status, automatic_summary: screening.summary, automatic_reasons: screening.reasons },
          });
          const existingVerification = snapshot.bill.red_verification_result && typeof snapshot.bill.red_verification_result === "object"
            ? snapshot.bill.red_verification_result : {};
          const offerResolution = {
            ...(existingVerification.offer_resolution && typeof existingVerification.offer_resolution === "object" ? existingVerification.offer_resolution : {}),
            status: "staff_verified",
            selected: { ...offer, staff_verified: true },
          };
          await patchPremiumBill({
            config: backend, billId: bill.id, fetchImpl,
            values: {
              ...premiumBillValuesFromAnalysis(normalizedWithOffer, screening, snapshot.firstRun.id, completedAt),
              contract_id: persisted.contract.id,
              red_verification_state: snapshot.bill.red_verification_state,
              red_verification_result: { ...existingVerification, offer_resolution: offerResolution },
              red_verification_run_id: snapshot.bill.red_verification_run_id,
              red_verified_at: snapshot.bill.red_verified_at,
            },
          });
        } else {
          await patchPremiumBill({ config: backend, billId: bill.id, fetchImpl, values: { contract_id: persisted.contract.id, updated_at: completedAt } });
        }
        return json(res, 200, {
          ok: true, mode: "staff_offer_validation", screening,
          contract: { id: persisted.contract.id, providerName: persisted.contract.provider_name, offerName: persisted.contract.offer_name, verificationStatus: persisted.contract.verification_status },
        });
      }

      if (body?.action === "verify_red") {
        assertPremiumAiConfigured(backend);
        try {
          const staffMode = Boolean(body?.checkId);
          let actorUserId = null;
          let snapshot = null;

          if (staffMode) {
            const { user } = await verifyPremiumStaff({ config: backend, accessToken, fetchImpl });
            if (!(await staffPermissionAllowed({
              config: backend,
              accessToken,
              permission: "manage_checks",
              fetchImpl,
            }))) throw new Error("premium_staff_permission_required:manage_checks");
            actorUserId = user.id;
            if (!(await enforceRateLimit(req, res, {
              label: "premium-ai-red-verification-staff",
              identifier: user.id,
              limit: Number(env.RATE_LIMIT_PREMIUM_AI_RED_LIMIT || 12),
              windowSeconds: Number(env.RATE_LIMIT_PREMIUM_AI_RED_WINDOW_SECONDS || 3600),
            }))) return;
            ({ check, bill } = await loadPremiumCheckAndBill({ config: backend, checkId: body.checkId, fetchImpl }));
            snapshot = await loadPremiumRedVerificationSnapshot({
              config: backend,
              billId: bill.id,
              userId: check.user_id,
              fetchImpl,
            });
            bill = snapshot.bill;
          } else {
            const { user } = await verifyPremiumCustomer({ config: backend, accessToken, fetchImpl });
            actorUserId = user.id;
            if (!(await enforceRateLimit(req, res, {
              label: "premium-ai-red-verification",
              identifier: user.id,
              limit: Number(env.RATE_LIMIT_PREMIUM_AI_RED_LIMIT || 12),
              windowSeconds: Number(env.RATE_LIMIT_PREMIUM_AI_RED_WINDOW_SECONDS || 3600),
            }))) return;
            snapshot = await loadPremiumRedVerificationSnapshot({
              config: backend,
              billId: body.billId,
              userId: user.id,
              fetchImpl,
            });
            bill = snapshot.bill;
          }

          const cachedResult = snapshot.bill.red_verification_result && typeof snapshot.bill.red_verification_result === "object"
            ? snapshot.bill.red_verification_result
            : {};
          const cachedState = String(snapshot.bill.red_verification_state || "not_run");
          const reusable = ["resolved_ai", "quick_verify", "staff_required", "inconclusive"].includes(cachedState)
            && cachedResult.version === PREMIUM_RED_VERIFIER_VERSION
            && cachedResult.first_analysis_run_id
            && cachedResult.first_analysis_run_id === snapshot.bill.automatic_analysis_run_id;
          if (reusable) {
            return json(res, 200, {
              ok: true,
              mode: "red_verification",
              source: staffMode ? "staff_existing_check" : "customer_request",
              reused: true,
              verification: publicRedVerification(cachedResult),
            });
          }

          const contract = await loadPremiumBillContract({ config: backend, bill, fetchImpl });
          const trustedContract = premiumContractForAutomaticComparison(contract, snapshot.firstRun?.extracted_data || {});
          pricingSnapshot = await requireVerifiedPremiumPricing(backend, fetchImpl, now());
          run = await createPremiumAnalysisRun({
            config: backend,
            check: staffMode ? check : null,
            bill,
            staffUserId: staffMode ? actorUserId : null,
            requestedByUserId: staffMode ? null : actorUserId,
            origin: "red_verification",
            staleAfterMs: Math.max(90000, Number(backend.deadlineMs || 0) + 30000),
            fetchImpl,
          });
          meter = instrumentWebSearchMeter(createUsageMeter());
          await patchPremiumBill({
            config: backend,
            billId: bill.id,
            fetchImpl,
            values: {
              red_verification_state: "running",
              red_verification_result: {},
              red_verification_run_id: run.id,
              red_verified_at: null,
              updated_at: new Date().toISOString(),
            },
          });

          temporaryFilePath = path.join(os.tmpdir(), `offertalogica-premium-red-${crypto.randomUUID()}.pdf`);
          await downloadPremiumBill({ config: backend, bill, destinationPath: temporaryFilePath, fetchImpl });
          const header = await normalizePdfFileHeader(temporaryFilePath);
          if (!header.valid) throw new Error("premium_bill_download_not_pdf");

          const transport = await createAccountedOpenAiTransport({
            meter,
            fetchImpl,
            onUsage: async () => {
              await checkpointPremiumAiRunCost({
                backend,
                run,
                meter,
                pricingSnapshot,
                fetchImpl,
                nowMs: now(),
              });
            },
          });
          const verified = await verifyRedPdf({
            filePath: temporaryFilePath,
            filename: bill.original_file_name || "bolletta.pdf",
            reasons: snapshot.bill.automatic_screening_reasons,
            firstAnalysis: snapshot.firstRun?.extracted_data || {},
            firstAnalysisRunId: snapshot.bill.automatic_analysis_run_id || null,
            contract: trustedContract,
            declaredContract: trustedContract ? null : contract,
            apiKey: backend.openAiApiKey,
            model: backend.model,
            transport,
            fetchImpl,
            deadlineAt: startedAt + backend.deadlineMs,
            env,
          });
          let verification = verified.result;
          const completedAt = new Date().toISOString();
          let resolvedOfferContract = null;
          let resolvedOfferScreening = null;
          const verifiedOffer = verification?.offer_resolution?.status === "verified"
            ? verification.offer_resolution.selected : null;
          if (verifiedOffer?.auto_verifiable && snapshot.firstRun?.extracted_data) {
            const persisted = await persistPremiumVerifiedOffer({
              config: backend, bill, offer: verifiedOffer, actor: "ai", fetchImpl, now: completedAt,
            });
            resolvedOfferContract = persisted.contract;
            const normalizedForResolvedOffer = { ...snapshot.firstRun.extracted_data, _offer_match: { status: "matched", verified: true } };
            resolvedOfferScreening = classifyPremiumAutomaticAnalysis(normalizedForResolvedOffer, {
              contract: premiumContractForAutomaticComparison(resolvedOfferContract, normalizedForResolvedOffer),
            });
            await patchPremiumAnalysisRun({
              config: backend, runId: snapshot.firstRun.id, fetchImpl,
              values: { automatic_classification: resolvedOfferScreening.status, automatic_summary: resolvedOfferScreening.summary, automatic_reasons: resolvedOfferScreening.reasons },
            });
            if (resolvedOfferScreening.status !== "review_recommended") {
              verification = {
                ...verification, decision: "resolved_ai", can_resolve_alone: "yes",
                resolved_screening_status: resolvedOfferScreening.status,
                customer_reply: resolvedOfferScreening.status === "clear"
                  ? `La bolletta è coerente con l’offerta ${resolvedOfferContract.offer_name || "verificata"} identificata per il periodo del documento. Non risultano anomalie contrattuali.`
                  : `Il riferimento dell’offerta è stato verificato e il precedente codice rosso contrattuale non è confermato. Rimane soltanto l’avviso indicato nell’analisi.`,
                escalation_reason: "", missing_data: [],
              };
            } else {
              const rerouted = routePremiumRedReasons(resolvedOfferScreening.reasons);
              verification = {
                ...verification, route: rerouted.route, reason_codes: rerouted.codes,
                decision: rerouted.route === "staff_required" ? "staff_required" : "quick_verify",
                verification_result: "inconclusive", can_resolve_alone: "no",
                issue: "Offerta verificata; resta un’anomalia da controllare",
                customer_reply: "",
                escalation_reason: "L’offerta di riferimento è stata verificata, ma il nuovo confronto mantiene un’anomalia rossa. È necessaria una verifica prima di comunicare l’esito al cliente.",
                missing_data: [],
              };
            }
          }
          const durationMs = Math.max(0, now() - startedAt);
          const accounting = premiumAiAccountingSnapshot(meter, pricingSnapshot, backend, now());
          const costResult = accounting.costResult;
          const estimatedCostEur = accounting.estimatedCostEur;
          const usageDetails = accounting.usageDetails;
          const state = verification.decision === "resolved_ai"
            ? "resolved_ai"
            : verification.decision === "quick_verify"
              ? "quick_verify"
              : verification.decision === "inconclusive"
                ? "inconclusive"
                : "staff_required";

          await patchPremiumAnalysisRun({
            config: backend,
            runId: run.id,
            fetchImpl,
            values: {
              status: "completed",
              parser_version: PREMIUM_RED_VERIFIER_VERSION,
              model: backend.model,
              completed_at: completedAt,
              duration_ms: durationMs,
              input_tokens: meter.totals.inputTokens,
              output_tokens: meter.totals.outputTokens,
              estimated_cost_eur: estimatedCostEur,
              extracted_data: { _red_verification: verification },
              warnings: state === "resolved_ai" ? [] : ["seconda_verifica_ia_da_escalare"],
              usage_details: usageDetails,
              response_ids: verified.responseId ? [verified.responseId] : [],
              automatic_classification: "not_applicable",
              automatic_summary: "",
              automatic_reasons: [],
              error_code: "",
              error_message: "",
            },
          });
          const finalBillValues = {
            processing_status: "completed", red_verification_state: state, red_verification_result: verification,
            red_verification_run_id: run.id, red_verified_at: completedAt, updated_at: completedAt,
          };
          if (resolvedOfferContract?.id) finalBillValues.contract_id = resolvedOfferContract.id;
          if (resolvedOfferScreening && snapshot.firstRun?.extracted_data) {
            Object.assign(finalBillValues, premiumBillValuesFromAnalysis(
              { ...snapshot.firstRun.extracted_data, _offer_match: { status: "matched", verified: true } },
              resolvedOfferScreening, snapshot.firstRun.id, completedAt,
            ));
            Object.assign(finalBillValues, {
              red_verification_state: state, red_verification_result: verification, red_verification_run_id: run.id,
              red_verified_at: completedAt, contract_id: resolvedOfferContract.id,
            });
          }
          await patchPremiumBill({ config: backend, billId: bill.id, fetchImpl, values: finalBillValues });
          await syncPremiumAiCostEvent({
            backend,
            bill,
            check: staffMode ? check : null,
            run: { ...run, origin: "red_verification" },
            meter,
            accounting,
            model: backend.model,
            fetchImpl,
          }).catch(error => {
            console.error("premium_ai_cost_event_pending", run?.id || "", String(error?.message || error));
          });

          return json(res, 200, {
            ok: true,
            mode: "red_verification",
            source: staffMode ? "staff_existing_check" : "customer_request",
            reused: false,
            verification: publicRedVerification(verification),
          });
        } catch (redError) {
          const completedAt = new Date().toISOString();
          let failedAccounting = null;
          if (run?.id && meter && pricingSnapshot?.complete) {
            try { failedAccounting = premiumAiAccountingSnapshot(meter, pricingSnapshot, backend, now()); }
            catch (accountingError) { console.error("premium_ai_failed_cost_unavailable", run.id, String(accountingError?.message || accountingError)); }
          }
          if (run?.id) {
            await patchPremiumAnalysisRun({
              config: backend,
              runId: run.id,
              fetchImpl,
              values: {
                status: "failed",
                completed_at: completedAt,
                duration_ms: Math.max(0, now() - startedAt),
                ...(failedAccounting ? {
                  input_tokens: Number(meter?.totals?.inputTokens || 0),
                  output_tokens: Number(meter?.totals?.outputTokens || 0),
                  estimated_cost_eur: failedAccounting.estimatedCostEur,
                  usage_details: failedAccounting.usageDetails,
                  response_ids: Array.isArray(meter?.totals?.responseIds) ? meter.totals.responseIds : [],
                } : {}),
                automatic_classification: "not_applicable",
                error_code: String(redError?.message || "premium_red_verification_error").split(":")[0].slice(0, 120),
                error_message: String(redError?.message || "Seconda verifica IA non riuscita").slice(0, 500),
              },
            }).catch(() => {});
            if (failedAccounting && bill?.id) {
              await syncPremiumAiCostEvent({
                backend,
                bill,
                check: staffMode ? check : null,
                run: { ...run, origin: "red_verification" },
                meter,
                accounting: failedAccounting,
                model: backend.model,
                fetchImpl,
              }).catch(error => {
                console.error("premium_ai_cost_event_pending", run.id, String(error?.message || error));
              });
            }
          }
          if (bill?.id) {
            await patchPremiumBill({
              config: backend,
              billId: bill.id,
              fetchImpl,
              values: {
                processing_status: "completed",
                red_verification_state: "failed",
                red_verification_result: {
                  version: PREMIUM_RED_VERIFIER_VERSION,
                  decision: "staff_required",
                  route: "staff_required",
                  issue: "Seconda verifica IA non completata",
                  evidence: [],
                  verification_result: "inconclusive",
                  confidence: "low",
                  can_resolve_alone: "no",
                  customer_reply: "",
                  escalation_reason: "La seconda verifica automatica non è stata completata.",
                  missing_data: [],
                  first_analysis_run_id: null,
                },
                red_verification_run_id: run?.id || null,
                red_verified_at: completedAt,
                updated_at: completedAt,
              },
            }).catch(() => {});
          }
          const safe = publicPremiumAccountingError(redError);
          return json(res, safe.status, { ok: false, code: safe.code, error: safe.error });
        }
      }

      assertPremiumAiConfigured(backend);
      customerMode = Boolean(body?.billId) && !body?.checkId;
      let actorUserId = null;
      let contract = null;

      if (customerMode) {
        const { user } = await verifyPremiumCustomer({ config: backend, accessToken, fetchImpl });
        actorUserId = user.id;
        if (!(await enforceRateLimit(req, res, {
          label: "premium-ai-customer-analysis",
          identifier: user.id,
          limit: Number(env.RATE_LIMIT_PREMIUM_AI_CUSTOMER_LIMIT || 24),
          windowSeconds: Number(env.RATE_LIMIT_PREMIUM_AI_CUSTOMER_WINDOW_SECONDS || 3600),
        }))) return;
        bill = await loadPremiumCustomerBill({ config: backend, billId: body.billId, userId: user.id, fetchImpl });
        contract = await loadPremiumBillContract({ config: backend, bill, fetchImpl });
      } else {
        const { user } = await verifyPremiumStaff({ config: backend, accessToken, fetchImpl });
        if (!(await staffPermissionAllowed({
          config: backend,
          accessToken,
          permission: "manage_checks",
          fetchImpl,
        }))) throw new Error("premium_staff_permission_required:manage_checks");
        actorUserId = user.id;
        if (!(await enforceRateLimit(req, res, {
          label: "premium-ai-analysis",
          identifier: user.id,
          limit: Number(env.RATE_LIMIT_PREMIUM_AI_LIMIT || 12),
          windowSeconds: Number(env.RATE_LIMIT_PREMIUM_AI_WINDOW_SECONDS || 3600),
        }))) return;
        ({ check, bill } = await loadPremiumCheckAndBill({ config: backend, checkId: body.checkId, fetchImpl }));
        contract = await loadPremiumBillContract({ config: backend, bill, fetchImpl });
      }

      pricingSnapshot = await requireVerifiedPremiumPricing(backend, fetchImpl, now());
      run = await createPremiumAnalysisRun({
        config: backend,
        check,
        bill,
        staffUserId: customerMode ? null : actorUserId,
        requestedByUserId: customerMode ? actorUserId : null,
        origin: customerMode ? "customer_upload" : "staff_manual",
        staleAfterMs: Math.max(90000, Number(backend.deadlineMs || 0) + 30000),
        fetchImpl,
      });
      meter = instrumentWebSearchMeter(createUsageMeter());

      temporaryFilePath = path.join(os.tmpdir(), `offertalogica-premium-ai-${crypto.randomUUID()}.pdf`);
      await downloadPremiumBill({ config: backend, bill, destinationPath: temporaryFilePath, fetchImpl });
      const header = await normalizePdfFileHeader(temporaryFilePath);
      if (!header.valid) throw new Error("premium_bill_download_not_pdf");

      const transport = await createAccountedOpenAiTransport({
        meter,
        fetchImpl,
        onUsage: async () => {
          await checkpointPremiumAiRunCost({
            backend,
            run,
            meter,
            pricingSnapshot,
            fetchImpl,
            nowMs: now(),
          });
        },
      });
      const normalized = await analyzePdf({
        filePath: temporaryFilePath,
        filename: bill.original_file_name || "bolletta.pdf",
        deadlineAt: startedAt + backend.deadlineMs,
        transport,
        apiKey: backend.openAiApiKey,
        model: backend.model,
        env,
      });

      let offerMatch = null;
      if (customerMode) {
        offerMatch = await matchOffer({
          config: backend,
          bill,
          normalized,
          fetchImpl,
          env,
        });
        if (offerMatch?.contract) contract = offerMatch.contract;
        const scopedOfferSummary = premiumBillScopedOfferSummary(offerMatch);
        if (scopedOfferSummary) normalized._offer_match = scopedOfferSummary;
      }

      const contractForScreening = customerMode
        ? (premiumOfferMatchVerifiedForBill(offerMatch) ? premiumContractForAutomaticComparison(contract, normalized) : null)
        : premiumContractForAutomaticComparison(contract, normalized);
      const completion = analysisCompletionStatus(normalized);
      const screening = classifyPremiumAutomaticAnalysis(normalized, { contract: contractForScreening });
      const durationMs = Math.max(0, now() - startedAt);
      const accounting = premiumAiAccountingSnapshot(meter, pricingSnapshot, backend, now());
      const costResult = accounting.costResult;
      const estimatedCostEur = accounting.estimatedCostEur;
      const usageDetails = accounting.usageDetails;
      const extractedData = sanitizePremiumAnalysisData(normalized, meter.totals, customerMode ? screening : null);
      const matchWarning = offerMatchWarning(normalized._offer_match || offerMatch);
      const warnings = [...new Set([
        ...(Array.isArray(normalized?.warnings) ? normalized.warnings : []),
        ...completion.missing.map(field => `campo_essenziale_mancante:${field}`),
        ...(customerMode && screening.status !== "clear" ? ["screening_automatico_da_approfondire"] : []),
        ...(matchWarning ? [matchWarning] : []),
        customerMode ? "analisi_automatica_cliente_v0.31" : "bozza_ia_da_verificare_dallo_staff",
      ])];
      const completedAt = new Date().toISOString();

      await patchPremiumAnalysisRun({
        config: backend,
        runId: run.id,
        fetchImpl,
        values: {
          status: completion.status,
          parser_version: normalized?.parser_version || "premium-ai-auto-screening-v0.31",
          model: normalized?.ai?.model || backend.model,
          completed_at: completedAt,
          duration_ms: durationMs,
          input_tokens: meter.totals.inputTokens,
          output_tokens: meter.totals.outputTokens,
          estimated_cost_eur: estimatedCostEur,
          extracted_data: extractedData,
          warnings,
          usage_details: usageDetails,
          response_ids: meter.totals.responseIds,
          automatic_classification: customerMode ? screening.status : "not_applicable",
          automatic_summary: customerMode ? screening.summary : "",
          automatic_reasons: customerMode ? screening.reasons : [],
          error_code: "",
          error_message: "",
        },
      });

      if (customerMode) {
        const values = {
          ...premiumBillValuesFromAnalysis(normalized, screening, run.id, completedAt),
          ...resetRedVerificationValues(),
        };
        if (premiumOfferContractCanBindBill(offerMatch)) values.contract_id = offerMatch.contract.id;
        await patchPremiumBill({
          config: backend,
          billId: bill.id,
          fetchImpl,
          values,
        });
      } else {
        await patchPremiumBill({
          config: backend,
          billId: bill.id,
          fetchImpl,
          values: { processing_status: "ready_for_review", updated_at: completedAt },
        });
      }

      await syncPremiumAiCostEvent({
        backend,
        bill,
        check,
        run: { ...run, origin: customerMode ? "customer_upload" : "staff_manual" },
        meter,
        accounting,
        model: normalized?.ai?.model || backend.model,
        fetchImpl,
      }).catch(error => {
        console.error("premium_ai_cost_event_pending", run?.id || "", String(error?.message || error));
      });

      return json(res, 200, {
        ok: true,
        mode: customerMode ? "customer_upload" : "staff_manual",
        run: {
          id: run.id,
          runNumber: run.run_number,
          status: completion.status,
          durationMs,
          inputTokens: meter.totals.inputTokens,
          outputTokens: meter.totals.outputTokens,
          totalTokens: meter.totals.totalTokens,
          estimatedCostEur,
          pricingConfigured: estimatedCostEur !== null,
          extractedData: customerMode ? undefined : extractedData,
          warnings,
        },
        screening: customerMode ? screening : null,
        offerMatch: customerMode ? offerMatch?.publicSummary || null : null,
      });
    } catch (error) {
      const completedAt = new Date().toISOString();
      const errorMessage = String(error?.message || error || "");
      let failedAccounting = null;
      if (run?.id && meter && pricingSnapshot?.complete) {
        try { failedAccounting = premiumAiAccountingSnapshot(meter, pricingSnapshot, backend, now()); }
        catch (accountingError) { console.error("premium_ai_failed_cost_unavailable", run.id, String(accountingError?.message || accountingError)); }
      }
      const analysisAlreadyRunning = /premium_analysis_already_running|premium_analysis_runs_one_active/.test(errorMessage);
      if (run?.id) {
        const durationMs = Math.max(0, now() - startedAt);
        await patchPremiumAnalysisRun({
          config: backend,
          runId: run.id,
          fetchImpl,
          values: {
            status: "failed",
            completed_at: completedAt,
            duration_ms: durationMs,
            ...(failedAccounting ? {
              input_tokens: Number(meter?.totals?.inputTokens || 0),
              output_tokens: Number(meter?.totals?.outputTokens || 0),
              estimated_cost_eur: failedAccounting.estimatedCostEur,
              usage_details: failedAccounting.usageDetails,
              response_ids: Array.isArray(meter?.totals?.responseIds) ? meter.totals.responseIds : [],
            } : {}),
            automatic_classification: customerMode ? "failed" : "not_applicable",
            automatic_summary: customerMode ? "Analisi non completata. Riprova o carica un PDF più leggibile." : "",
            automatic_reasons: customerMode ? [{
              code: "analisi_automatica_fallita",
              title: "Analisi non completata",
              description: "I tentativi automatici non hanno prodotto un risultato utilizzabile. Riprova o carica un PDF più leggibile.",
              severity: "medium",
              source: "technical",
            }] : [],
            error_code: String(error?.message || "premium_ai_error").split(":")[0].slice(0, 120),
            error_message: String(error?.message || "Analisi IA non riuscita").slice(0, 500),
          },
        }).catch(() => {});
        if (failedAccounting && bill?.id) {
          await syncPremiumAiCostEvent({
            backend,
            bill,
            check,
            run: { ...run, origin: customerMode ? "customer_upload" : "staff_manual" },
            meter,
            accounting: failedAccounting,
            model: backend.model,
            fetchImpl,
          }).catch(costError => {
            console.error("premium_ai_cost_event_pending", run.id, String(costError?.message || costError));
          });
        }
      }
      if (bill?.id && !analysisAlreadyRunning) {
        await patchPremiumBill({
          config: backend,
          billId: bill.id,
          fetchImpl,
          values: customerMode
            ? {
                processing_status: "failed",
                customer_status: "more_info_required",
                automatic_screening_status: "failed",
                automatic_screening_summary: "Analisi non completata. Riprova o carica un PDF più leggibile.",
                automatic_screening_reasons: [{
                  code: "analisi_automatica_fallita",
                  title: "Analisi non completata",
                  description: "Riprova l’analisi oppure carica un PDF o una scansione più nitida.",
                  severity: "medium",
                  source: "technical",
                }],
                automatic_screened_at: completedAt,
                ...resetRedVerificationValues(),
                updated_at: completedAt,
              }
            : { processing_status: "ready_for_review", updated_at: completedAt },
        }).catch(() => {});
      }
      const safe = publicPremiumAccountingError(error);
      return json(res, safe.status, { ok: false, code: safe.code, error: safe.error });
    } finally {
      if (temporaryFilePath) await fs.unlink(temporaryFilePath).catch(() => {});
    }
  };
}

export default createPremiumAiAnalysisHandler();
