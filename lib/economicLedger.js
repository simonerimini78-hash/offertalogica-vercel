const ECB_DAILY_FX_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const DEFAULT_TIMEOUT_MS = 1800;

function cleanBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function serviceConfig(env = process.env) {
  return {
    supabaseUrl: cleanBaseUrl(env.SUPABASE_URL || env.CUSTOMER_DB_SUPABASE_URL),
    serviceKey: String(
      env.SUPABASE_SECRET_KEY ||
      env.SUPABASE_SERVICE_ROLE_KEY ||
      env.CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY ||
      ""
    ).trim(),
  };
}

function isLegacyJwtKey(value) {
  return String(value || "").split(".").length === 3;
}

function serviceHeaders(key, extra = {}) {
  const headers = { apikey: key, ...extra };
  if (isLegacyJwtKey(key)) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timeoutSignal(ms = DEFAULT_TIMEOUT_MS) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  return undefined;
}

export function economicLedgerConfigured(env = process.env) {
  const config = serviceConfig(env);
  return Boolean(config.supabaseUrl && config.serviceKey);
}

async function requestJson(url, init = {}, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const response = await fetchImpl(url, { ...init, signal: init.signal || timeoutSignal(timeoutMs) });
  const text = await response.text().catch(() => "");
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(`economic_http_${response.status}:${String(text).slice(0, 300)}`);
  return body;
}

export function vatFromNet(netAmount, vatRate) {
  const net = finite(netAmount);
  const vat = finite(vatRate);
  if (net === null) return { net: null, vat: null, gross: null };
  if (vat === null) return { net, vat: null, gross: net };
  const vatAmount = net * vat / 100;
  return { net, vat: vatAmount, gross: net + vatAmount };
}

export function normalizeOpenAiUsage(body = {}) {
  const usage = body?.usage && typeof body.usage === "object" ? body.usage : {};
  return {
    inputTokens: Math.max(0, Number(usage.input_tokens || 0)),
    cachedInputTokens: Math.max(0, Number(usage.input_tokens_details?.cached_tokens || 0)),
    outputTokens: Math.max(0, Number(usage.output_tokens || 0)),
    reasoningTokens: Math.max(0, Number(usage.output_tokens_details?.reasoning_tokens || 0)),
    totalTokens: Math.max(0, Number(usage.total_tokens || 0)),
  };
}

export function openAiTokenCostUsd(usage, rates = {}) {
  const input = Math.max(0, Number(usage?.inputTokens || 0));
  const cached = Math.min(input, Math.max(0, Number(usage?.cachedInputTokens || 0)));
  const uncached = Math.max(0, input - cached);
  const output = Math.max(0, Number(usage?.outputTokens || 0));
  const inputRate = finite(rates.inputPerMillion);
  const cachedRate = finite(rates.cachedInputPerMillion);
  const outputRate = finite(rates.outputPerMillion);
  if ([inputRate, cachedRate, outputRate].some(value => value === null)) return null;
  return (uncached * inputRate + cached * cachedRate + output * outputRate) / 1_000_000;
}

export function stripeEstimatedFee(amountEur, percentRate, fixedRate) {
  const amount = finite(amountEur);
  const pct = finite(percentRate);
  const fixed = finite(fixedRate);
  if (amount === null || pct === null || fixed === null) return null;
  return amount * pct / 100 + fixed;
}

export function parseEcbUsdToEur(xml = "") {
  const source = String(xml || "");
  const usd = Number(source.match(/<Cube\s+currency=["']USD["']\s+rate=["']([^"']+)["']/i)?.[1]);
  const referenceDate = source.match(/<Cube\s+time=["']([^"']+)["']\s*>/i)?.[1] || null;
  if (!Number.isFinite(usd) || usd <= 0) return null;
  return { eurToUsd: usd, usdToEur: 1 / usd, referenceDate };
}

async function activeRate(rateKey, { at = new Date(), env = process.env, fetchImpl = fetch } = {}) {
  const config = serviceConfig(env);
  if (!config.supabaseUrl || !config.serviceKey) return null;
  const iso = new Date(at).toISOString();
  const query = new URLSearchParams({
    select: "id,rate_key,label,category,rate_type,rate_value,currency,vat_rate,source_mode,source_reference,valid_from,valid_to",
    rate_key: `eq.${rateKey}`,
    valid_from: `lte.${iso}`,
    order: "valid_from.desc",
    limit: "1",
  });
  const rows = await requestJson(
    `${config.supabaseUrl}/rest/v1/premium_economic_rate_versions?${query}`,
    { method: "GET", headers: serviceHeaders(config.serviceKey, { Accept: "application/json" }) },
    fetchImpl
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  if (row.valid_to && new Date(row.valid_to) <= new Date(at)) return null;
  return row;
}

async function insertEntry(row, { env = process.env, fetchImpl = fetch } = {}) {
  const config = serviceConfig(env);
  if (!config.supabaseUrl || !config.serviceKey) return { stored: false, reason: "not_configured" };
  const params = row.source_event_id
    ? "?on_conflict=source_system,source_event_id,category"
    : "";
  await requestJson(
    `${config.supabaseUrl}/rest/v1/premium_economic_entries${params}`,
    {
      method: "POST",
      headers: serviceHeaders(config.serviceKey, {
        "Content-Type": "application/json",
        Prefer: row.source_event_id ? "resolution=ignore-duplicates,return=minimal" : "return=minimal",
      }),
      body: JSON.stringify([row]),
    },
    fetchImpl
  );
  return { stored: true };
}

export async function recordRatedCost({
  rateKey,
  category,
  sourceSystem,
  sourceEventId,
  quantity = 1,
  unit = "event",
  userId = null,
  occurredAt = new Date(),
  metadata = {},
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  if (!economicLedgerConfigured(env)) return { stored: false, reason: "not_configured" };
  let rate = null;
  try { rate = await activeRate(rateKey, { at: occurredAt, env, fetchImpl }); } catch {}
  const value = rate ? finite(rate.rate_value) : null;
  const qty = Math.max(0, Number(quantity || 0));
  const net = value === null ? null : value * qty;
  const amounts = vatFromNet(net, rate?.vat_rate);
  return insertEntry({
    direction: "cost",
    status: rate ? "incurred" : "unpriced",
    category: category || rate?.category || rateKey || "other",
    source_system: sourceSystem || "application",
    source_event_id: sourceEventId || null,
    user_id: userId || null,
    rate_version_id: rate?.id || null,
    quantity: qty,
    unit,
    original_amount: net,
    original_currency: rate?.currency || "EUR",
    fx_rate_to_eur: rate?.currency === "EUR" ? 1 : null,
    amount_net_eur: rate?.currency === "EUR" ? amounts.net : null,
    vat_rate: finite(rate?.vat_rate),
    vat_eur: rate?.currency === "EUR" ? amounts.vat : null,
    amount_gross_eur: rate?.currency === "EUR" ? amounts.gross : null,
    occurred_at: new Date(occurredAt).toISOString(),
    metadata: { ...metadata, rate_key: rateKey, rate_source_mode: rate?.source_mode || null },
  }, { env, fetchImpl });
}

async function ecbUsdToEur(fetchImpl = fetch) {
  const response = await fetchImpl(ECB_DAILY_FX_URL, { signal: timeoutSignal(1400) });
  if (!response.ok) throw new Error(`ecb_http_${response.status}`);
  return parseEcbUsdToEur(await response.text());
}

function gpt41RateKeys(model = "") {
  const normalized = String(model || "").trim().toLowerCase();
  if (!["gpt-4.1", "gpt-4.1-2025-04-14"].includes(normalized)) return null;
  return {
    input: "openai_gpt41_input_usd_1m",
    cached: "openai_gpt41_cached_input_usd_1m",
    output: "openai_gpt41_output_usd_1m",
  };
}

export async function recordPublicPdfOpenAiResponses(responses = [], {
  env = process.env,
  fetchImpl = fetch,
  occurredAt = new Date(),
} = {}) {
  if (!economicLedgerConfigured(env)) return { stored: 0, reason: "not_configured" };
  const items = (Array.isArray(responses) ? responses : []).filter(item => item?.body);
  if (!items.length) return { stored: 0, reason: "no_usage" };

  let stored = 0;
  for (const item of items) {
    const model = String(item.model || item.body?.model || env.PDF_AI_PRIMARY_MODEL || "").trim();
    const keys = gpt41RateKeys(model);
    const usage = normalizeOpenAiUsage(item.body);
    const sourceEventId = String(item.body?.id || item.responseId || "").trim() || null;
    let pricing = null;
    let fx = null;
    if (keys) {
      try {
        const [input, cached, output, exchange] = await Promise.all([
          activeRate(keys.input, { at: occurredAt, env, fetchImpl }),
          activeRate(keys.cached, { at: occurredAt, env, fetchImpl }),
          activeRate(keys.output, { at: occurredAt, env, fetchImpl }),
          ecbUsdToEur(fetchImpl),
        ]);
        if (input && cached && output && exchange) {
          pricing = {
            inputPerMillion: input.rate_value,
            cachedInputPerMillion: cached.rate_value,
            outputPerMillion: output.rate_value,
            rateVersionIds: [input.id, cached.id, output.id],
          };
          fx = exchange;
        }
      } catch {}
    }

    const costUsd = pricing ? openAiTokenCostUsd(usage, pricing) : null;
    const costEur = costUsd === null || !fx ? null : costUsd * fx.usdToEur;
    await insertEntry({
      direction: "cost",
      status: costEur === null ? "unpriced" : "incurred",
      category: "public_pdf_ai",
      source_system: "openai",
      source_event_id: sourceEventId,
      quantity: usage.totalTokens || (usage.inputTokens + usage.outputTokens),
      unit: "tokens",
      original_amount: costUsd,
      original_currency: "USD",
      fx_rate_to_eur: fx?.usdToEur || null,
      amount_net_eur: costEur,
      vat_rate: null,
      vat_eur: null,
      amount_gross_eur: costEur,
      occurred_at: new Date(occurredAt).toISOString(),
      metadata: {
        model,
        profile: item.profile || null,
        input_tokens: usage.inputTokens,
        cached_input_tokens: usage.cachedInputTokens,
        output_tokens: usage.outputTokens,
        reasoning_tokens: usage.reasoningTokens,
        total_tokens: usage.totalTokens,
        ecb_reference_date: fx?.referenceDate || null,
        pricing_rate_version_ids: pricing?.rateVersionIds || [],
      },
    }, { env, fetchImpl });
    stored += 1;
  }
  return { stored };
}
