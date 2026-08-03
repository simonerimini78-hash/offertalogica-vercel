const DEFAULT_HISTORY_URLS = Object.freeze([
  "https://offertalogica.it/data/offerte-arera-history.json",
  "https://raw.githubusercontent.com/simonerimini78-hash/offertalogica-vercel/main/public/data/offerte-arera-history.json",
]);

const HISTORY_CACHE_MS = 10 * 60 * 1000;
const HISTORY_TIMEOUT_MS = 6_000;
let historyCache = { url: "", expiresAt: 0, payload: null };

function trimText(value, max = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function canonicalText(value) {
  return trimText(value, 400)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizedCode(value) {
  return trimText(value, 240).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validIsoDate(value) {
  const text = trimText(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? text
    : null;
}

function areraDateToIso(value) {
  const text = trimText(value, 40);
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return validIsoDate(text);
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function canonicalPriceType(value) {
  const text = canonicalText(value);
  if (/ibrid|mixed/.test(text)) return "ibrido";
  if (/variabil|indicizz|indexed/.test(text)) return "variabile";
  if (/fiss|fixed/.test(text)) return "fisso";
  return "unknown";
}

function databasePriceType(types) {
  const values = [...new Set(types.filter(value => value && value !== "unknown"))];
  if (!values.length) return "unknown";
  if (values.length > 1 || values.includes("ibrido")) return "mixed";
  return values[0] === "fisso" ? "fixed" : values[0] === "variabile" ? "indexed" : "unknown";
}

function tokens(value) {
  return new Set(canonicalText(value).split(" ").filter(token => token.length > 1));
}

function similarity(left, right) {
  const a = canonicalText(left);
  const b = canonicalText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return Math.max(0.78, ratio);
  }
  const at = tokens(a);
  const bt = tokens(b);
  if (!at.size || !bt.size) return 0;
  let intersection = 0;
  at.forEach(token => { if (bt.has(token)) intersection += 1; });
  const union = new Set([...at, ...bt]).size;
  return union ? intersection / union : 0;
}

function relativeClose(actual, expected, absoluteFloor, relativeTolerance = 0.05) {
  const a = finiteNumber(actual);
  const e = finiteNumber(expected);
  if (a === null || e === null) return null;
  return Math.abs(a - e) <= Math.max(absoluteFloor, Math.abs(e) * relativeTolerance);
}

function referenceDate(normalized) {
  return validIsoDate(normalized?.issue_date)
    || validIsoDate(normalized?.billing_period_end)
    || validIsoDate(normalized?.billing_period_start)
    || new Date().toISOString().slice(0, 10);
}

function selectVersion(record, onDate) {
  const versions = Array.isArray(record?.versions) ? record.versions.filter(Boolean) : [];
  if (!versions.length) return null;
  const sorted = [...versions].sort((a, b) => String(a.catalogDate || "").localeCompare(String(b.catalogDate || "")));
  const usable = sorted.filter(version => !version.catalogDate || String(version.catalogDate) <= onDate);
  return usable.at(-1) || sorted.at(-1) || null;
}

function supplyInputs(normalized = {}) {
  const inputs = [];
  const commodities = normalized.commodity === "dual"
    ? ["luce", "gas"]
    : ["luce", "gas"].filter(value => normalized.commodity === value);

  for (const commodity of commodities) {
    const light = commodity === "luce";
    inputs.push({
      commodity,
      provider: trimText(
        light
          ? normalized.fornitore_luce || normalized.fornitore
          : normalized.fornitore_gas || normalized.fornitore,
        240,
      ),
      offerName: trimText(light ? normalized.nome_offerta_luce : normalized.nome_offerta_gas, 300),
      offerCode: normalizedCode(light ? normalized.codice_offerta_luce : normalized.codice_offerta_gas),
      priceType: canonicalPriceType(light ? normalized.tipo_prezzo_luce : normalized.tipo_prezzo_gas),
      price: finiteNumber(light ? normalized.prezzo_luce_eur_kwh : normalized.prezzo_gas_eur_smc),
      annualFixedFee: finiteNumber(
        light
          ? normalized.quota_fissa_vendita_luce_eur_anno
          : normalized.quota_fissa_vendita_gas_eur_anno,
      ),
      indexName: trimText(light ? normalized.indice_riferimento_luce : normalized.indice_riferimento_gas, 80),
      spread: finiteNumber(light ? normalized.spread_luce_eur_kwh : normalized.spread_gas_eur_smc),
      formula: trimText(light ? normalized.formula_prezzo_luce : normalized.formula_prezzo_gas, 600),
      conditionsStart: validIsoDate(
        light
          ? normalized.decorrenza_condizioni_economiche_luce
          : normalized.decorrenza_condizioni_economiche_gas,
      ),
      conditionsEnd: validIsoDate(
        light
          ? normalized.scadenza_condizioni_economiche_luce
          : normalized.scadenza_condizioni_economiche_gas,
      ),
    });
  }
  return inputs;
}

function publicCandidate(candidate) {
  if (!candidate) return null;
  return {
    key: candidate.record.key || "",
    providerName: candidate.record.providerName || "",
    offerName: candidate.record.offerName || "",
    offerCode: candidate.record.offerCode || "",
    commodity: candidate.record.commodity || "",
    active: Boolean(candidate.record.active),
    score: Number(candidate.score.toFixed(2)),
    method: candidate.method,
    priceType: candidate.version?.priceType || "",
    price: finiteNumber(candidate.version?.price),
    annualFixedFee: finiteNumber(candidate.version?.annualFixedFee),
    validFrom: areraDateToIso(candidate.version?.validFrom),
    validTo: areraDateToIso(candidate.version?.validTo),
  };
}

function scoreCandidate(input, record, version) {
  if (!record || !version || record.recordType !== "single" || record.commodity !== input.commodity) return null;
  const code = normalizedCode(record.offerCode);
  if (input.offerCode && code && input.offerCode === code) {
    return {
      record,
      version,
      score: 100,
      method: "offer_code",
      providerSimilarity: similarity(input.provider, record.providerName),
      nameSimilarity: similarity(input.offerName, record.offerName),
      exactCode: true,
    };
  }

  if (!input.provider && !input.offerName && input.price === null && input.annualFixedFee === null) return null;

  const providerSimilarity = similarity(input.provider, record.providerName);
  const nameSimilarity = similarity(input.offerName, record.offerName);
  const hasName = Boolean(input.offerName);
  let score = 0;

  if (input.provider) {
    score += providerSimilarity * (hasName ? 30 : 35);
    if (providerSimilarity < 0.25) score -= 22;
  }

  if (hasName) {
    score += nameSimilarity * 45;
    if (nameSimilarity < 0.2) score -= 18;
  }

  const expectedType = canonicalPriceType(version.priceType);
  if (input.priceType !== "unknown" && expectedType !== "unknown") {
    score += input.priceType === expectedType ? (hasName ? 8 : 15) : -12;
  }

  const priceFloor = input.commodity === "luce" ? 0.005 : 0.02;
  const priceClose = relativeClose(input.price, version.price, priceFloor);
  if (priceClose === true) score += hasName ? 10 : 30;
  if (priceClose === false) score -= hasName ? 12 : 25;

  const feeClose = relativeClose(input.annualFixedFee, version.annualFixedFee, 5);
  if (feeClose === true) score += hasName ? 5 : 18;
  if (feeClose === false) score -= hasName ? 7 : 18;

  if (record.active) score += 2;

  return {
    record,
    version,
    score: Math.max(0, Math.min(99, score)),
    method: hasName ? "provider_offer_name" : "economic_fingerprint",
    providerSimilarity,
    nameSimilarity,
    exactCode: false,
  };
}

function matchSupply(input, records, onDate) {
  const candidates = records
    .map(record => scoreCandidate(input, record, selectVersion(record, onDate)))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  const top = candidates[0] || null;
  const second = candidates[1] || null;
  const margin = top ? top.score - (second?.score || 0) : 0;

  if (!top) {
    return { commodity: input.commodity, status: "not_found", confidence: 0, method: "none", verified: false, candidate: null, candidates: [] };
  }

  if (top.exactCode) {
    return {
      commodity: input.commodity,
      status: "matched",
      confidence: 100,
      method: "offer_code",
      verified: true,
      candidate: top,
      candidates: candidates.slice(0, 3).map(publicCandidate),
    };
  }

  const strongIdentity = top.providerSimilarity >= 0.65 && (!input.offerName || top.nameSimilarity >= 0.65);
  if (top.score >= 90 && margin >= 8 && strongIdentity) {
    return {
      commodity: input.commodity,
      status: "matched",
      confidence: Math.round(top.score),
      method: top.method,
      verified: true,
      candidate: top,
      candidates: candidates.slice(0, 3).map(publicCandidate),
    };
  }

  if (top.score >= 78 && margin >= 10 && top.providerSimilarity >= 0.5) {
    return {
      commodity: input.commodity,
      status: "matched",
      confidence: Math.round(top.score),
      method: top.method,
      verified: false,
      candidate: top,
      candidates: candidates.slice(0, 3).map(publicCandidate),
    };
  }

  if (top.score >= 65) {
    return {
      commodity: input.commodity,
      status: "ambiguous",
      confidence: Math.round(top.score),
      method: top.method,
      verified: false,
      candidate: top,
      candidates: candidates.slice(0, 3).map(publicCandidate),
    };
  }

  return {
    commodity: input.commodity,
    status: "not_found",
    confidence: Math.round(top.score),
    method: "none",
    verified: false,
    candidate: null,
    candidates: candidates.slice(0, 3).map(publicCandidate),
  };
}

function findSingleByCode(records, commodity, code, onDate) {
  const normalized = normalizedCode(code);
  if (!normalized) return null;
  const record = records.find(item =>
    item?.recordType === "single"
    && item?.commodity === commodity
    && normalizedCode(item.offerCode) === normalized
  );
  if (!record) return null;
  const version = selectVersion(record, onDate);
  return version ? {
    commodity,
    status: "matched",
    confidence: 100,
    method: "dual_offer_code",
    verified: true,
    candidate: {
      record,
      version,
      score: 100,
      method: "dual_offer_code",
      providerSimilarity: 1,
      nameSimilarity: 1,
      exactCode: true,
    },
    candidates: [publicCandidate({
      record,
      version,
      score: 100,
      method: "dual_offer_code",
    })],
  } : null;
}

function dualCodeMatches(inputs, records, onDate) {
  if (inputs.length !== 2) return null;
  const codes = [...new Set(inputs.map(input => input.offerCode).filter(Boolean))];
  for (const code of codes) {
    const dual = records.find(record =>
      record?.recordType === "dual"
      && normalizedCode(record.offerCode) === code
    );
    if (!dual) continue;
    const version = selectVersion(dual, onDate);
    if (!version) continue;
    const light = findSingleByCode(records, "luce", version.electricityOfferCode, onDate);
    const gas = findSingleByCode(records, "gas", version.gasOfferCode, onDate);
    if (light && gas) return [light, gas];
  }
  return null;
}

export function matchPremiumOfferHistory(normalized = {}, history = {}) {
  const records = Array.isArray(history.offers) ? history.offers.filter(Boolean) : [];
  const inputs = supplyInputs(normalized);
  const onDate = referenceDate(normalized);
  const dualMatches = dualCodeMatches(inputs, records, onDate);
  const supplies = dualMatches || inputs.map(input => matchSupply(input, records, onDate));

  let status = "not_found";
  if (supplies.length && supplies.every(item => item.status === "matched")) status = "matched";
  else if (supplies.some(item => item.status === "matched")) status = "partial";
  else if (supplies.some(item => item.status === "ambiguous")) status = "ambiguous";

  const verified = status === "matched" && supplies.every(item => item.verified);
  const confidence = supplies.length
    ? Math.round(Math.min(...supplies.map(item => Number(item.confidence || 0))))
    : 0;
  const methods = [...new Set(supplies.map(item => item.method).filter(value => value && value !== "none"))];

  return {
    status,
    verified,
    confidence,
    method: methods.join("+") || "none",
    catalogVersion: trimText(history.version || history.sourceCatalogVersion, 160),
    catalogUpdatedAt: validIsoDate(history.updatedAt),
    supplies,
    inputs,
  };
}

function sameOrNull(values) {
  const clean = [...new Set(values.filter(Boolean))];
  return clean.length === 1 ? clean[0] : null;
}

function earliestDate(values) {
  const clean = values.map(validIsoDate).filter(Boolean).sort();
  return clean[0] || null;
}

function matchedProviderName(match) {
  return sameOrNull(match.supplies.map(item => item.candidate?.record?.providerName))
    || match.supplies.map(item => item.candidate?.record?.providerName).filter(Boolean).join(" / ");
}

function matchedOfferName(match) {
  return sameOrNull(match.supplies.map(item => item.candidate?.record?.offerName))
    || match.supplies.map(item => item.candidate?.record?.offerName).filter(Boolean).join(" / ");
}

function supplyByCommodity(match, commodity) {
  return match.supplies.find(item => item.commodity === commodity) || null;
}

function inputByCommodity(match, commodity) {
  return match.inputs.find(item => item.commodity === commodity) || null;
}

export function buildPremiumContractValues(normalized = {}, match = {}, sourceUrl = "") {
  const light = supplyByCommodity(match, "luce");
  const gas = supplyByCommodity(match, "gas");
  const lightInput = inputByCommodity(match, "luce");
  const gasInput = inputByCommodity(match, "gas");
  const lightVersion = light?.candidate?.version || null;
  const gasVersion = gas?.candidate?.version || null;
  const useMatched = ["matched", "partial", "ambiguous"].includes(match.status);
  const verified = Boolean(match.verified);

  const priceTypes = [
    canonicalPriceType(lightVersion?.priceType || lightInput?.priceType),
    canonicalPriceType(gasVersion?.priceType || gasInput?.priceType),
  ];

  const providerName = useMatched
    ? matchedProviderName(match)
    : sameOrNull([lightInput?.provider, gasInput?.provider]) || [lightInput?.provider, gasInput?.provider].filter(Boolean).join(" / ");
  const offerName = useMatched
    ? matchedOfferName(match)
    : sameOrNull([lightInput?.offerName, gasInput?.offerName]) || [lightInput?.offerName, gasInput?.offerName].filter(Boolean).join(" / ");

  const lightType = canonicalPriceType(lightVersion?.priceType || lightInput?.priceType);
  const gasType = canonicalPriceType(gasVersion?.priceType || gasInput?.priceType);

  return {
    provider_name: trimText(providerName, 250),
    offer_name: trimText(offerName, 300),
    pricing_type: databasePriceType(priceTypes),
    contract_start: sameOrNull([lightInput?.conditionsStart, gasInput?.conditionsStart]),
    contract_end: null,
    fixed_price_expiry: earliestDate([lightInput?.conditionsEnd, gasInput?.conditionsEnd]),
    electricity_price_eur_kwh: lightType === "fisso"
      ? finiteNumber(lightVersion?.price ?? lightInput?.price)
      : null,
    gas_price_eur_smc: gasType === "fisso"
      ? finiteNumber(gasVersion?.price ?? gasInput?.price)
      : null,
    electricity_fixed_fee_eur_year: finiteNumber(lightVersion?.annualFixedFee ?? lightInput?.annualFixedFee),
    gas_fixed_fee_eur_year: finiteNumber(gasVersion?.annualFixedFee ?? gasInput?.annualFixedFee),
    source: useMatched ? "import" : "bill",
    verification_status: verified ? "verified" : "needs_review",
    is_current: true,

    arera_offer_code_electricity: trimText(light?.candidate?.record?.offerCode, 240),
    arera_offer_code_gas: trimText(gas?.candidate?.record?.offerCode, 240),
    arera_history_key_electricity: trimText(light?.candidate?.record?.key, 300),
    arera_history_key_gas: trimText(gas?.candidate?.record?.key, 300),
    electricity_arera_valid_from: areraDateToIso(lightVersion?.validFrom),
    electricity_arera_valid_to: areraDateToIso(lightVersion?.validTo),
    gas_arera_valid_from: areraDateToIso(gasVersion?.validFrom),
    gas_arera_valid_to: areraDateToIso(gasVersion?.validTo),
    electricity_index_name: trimText(lightVersion?.indexName || lightInput?.indexName, 80),
    gas_index_name: trimText(gasVersion?.indexName || gasInput?.indexName, 80),
    electricity_spread_eur_kwh: finiteNumber(lightVersion?.spreadEstimate ?? lightInput?.spread),
    gas_spread_eur_smc: finiteNumber(gasVersion?.spreadEstimate ?? gasInput?.spread),
    electricity_formula: trimText(lightInput?.formula, 1000),
    gas_formula: trimText(gasInput?.formula, 1000),
    automatic_match_status: match.status || "not_found",
    automatic_match_confidence: Math.max(0, Math.min(100, Number(match.confidence || 0))),
    automatic_match_method: trimText(match.method, 120) || "none",
    automatic_match_candidates: match.supplies.map(item => ({
      commodity: item.commodity,
      status: item.status,
      confidence: item.confidence,
      method: item.method,
      candidates: item.candidates,
    })),
    automatic_matched_at: new Date().toISOString(),
    automatic_match_catalog_version: trimText(match.catalogVersion, 160),
    automatic_match_source_url: trimText(sourceUrl, 1000),
  };
}

function isLegacyJwtKey(value) {
  return String(value || "").split(".").length === 3;
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
    throw new Error(`premium_offer_match_supabase_${response.status}:${details.slice(0, 500)}`);
  }
  return body;
}

async function serviceRequest(config, endpoint, init, fetchImpl) {
  const response = await fetchImpl(`${config.supabaseUrl}${endpoint}`, {
    ...init,
    headers: serviceHeaders(config, init?.headers || {}),
  });
  if (response.status === 204) return null;
  return parsedResponse(response);
}

function safeHttpsUrl(value) {
  const text = trimText(value, 1200);
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

async function fetchHistoryUrl(url, fetchImpl) {
  const now = Date.now();
  if (historyCache.payload && historyCache.url === url && historyCache.expiresAt > now) {
    return historyCache.payload;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HISTORY_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`arera_history_http_${response.status}`);
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.offers) || !payload.offers.length) {
      throw new Error("arera_history_invalid");
    }
    historyCache = { url, payload, expiresAt: now + HISTORY_CACHE_MS };
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadHistory(env, fetchImpl) {
  const configured = safeHttpsUrl(env?.ARERA_HISTORY_URL);
  const urls = [...new Set([configured, ...DEFAULT_HISTORY_URLS].filter(Boolean))];
  let lastError = null;
  for (const url of urls) {
    try {
      return { payload: await fetchHistoryUrl(url, fetchImpl), url };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("arera_history_unavailable");
}

const CONTRACT_SELECT = [
  "id", "user_id", "utility_id", "provider_name", "offer_name", "pricing_type",
  "contract_start", "contract_end", "fixed_price_expiry",
  "electricity_price_eur_kwh", "gas_price_eur_smc",
  "electricity_fixed_fee_eur_year", "gas_fixed_fee_eur_year",
  "source", "verification_status", "is_current",
  "arera_offer_code_electricity", "arera_offer_code_gas",
  "arera_history_key_electricity", "arera_history_key_gas",
  "automatic_match_status", "automatic_match_confidence", "automatic_match_method",
  "automatic_match_catalog_version", "created_at", "updated_at",
].join(",");

async function loadCurrentContract(config, bill, fetchImpl) {
  const query = new URLSearchParams({
    select: CONTRACT_SELECT,
    user_id: `eq.${bill.user_id}`,
    utility_id: `eq.${bill.utility_id}`,
    is_current: "eq.true",
    order: "created_at.desc",
    limit: "1",
  });
  const rows = await serviceRequest(config, `/rest/v1/premium_contracts?${query}`, { method: "GET" }, fetchImpl);
  return Array.isArray(rows) ? rows[0] || null : null;
}

function sameAutomaticIdentity(current, values) {
  return String(current?.arera_history_key_electricity || "") === String(values.arera_history_key_electricity || "")
    && String(current?.arera_history_key_gas || "") === String(values.arera_history_key_gas || "");
}

async function patchContract(config, id, values, fetchImpl) {
  const query = new URLSearchParams({ id: `eq.${id}` });
  const result = await serviceRequest(config, `/rest/v1/premium_contracts?${query}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(values),
  }, fetchImpl);
  return Array.isArray(result) ? result[0] || null : result;
}

async function insertContract(config, values, fetchImpl) {
  const result = await serviceRequest(config, "/rest/v1/premium_contracts", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(values),
  }, fetchImpl);
  return Array.isArray(result) ? result[0] || null : result;
}

async function persistContract({ config, bill, values, fetchImpl }) {
  const current = await loadCurrentContract(config, bill, fetchImpl);

  if (
    current?.verification_status === "verified"
    && ["manual", "staff"].includes(current.source)
  ) {
    return { contract: current, preserved: true };
  }

  if (
    current?.verification_status === "verified"
    && current.source === "import"
    && values.verification_status !== "verified"
  ) {
    return { contract: current, preserved: true };
  }

  const completeValues = {
    ...values,
    user_id: bill.user_id,
    utility_id: bill.utility_id,
    updated_at: new Date().toISOString(),
  };

  if (current && (sameAutomaticIdentity(current, values) || ["unverified", "needs_review"].includes(current.verification_status))) {
    const contract = await patchContract(config, current.id, completeValues, fetchImpl);
    return { contract, preserved: false };
  }

  const contract = await insertContract(config, {
    ...completeValues,
    created_at: new Date().toISOString(),
  }, fetchImpl);

  if (current?.id && contract?.id) {
    await patchContract(config, current.id, { is_current: false, updated_at: new Date().toISOString() }, fetchImpl);
  }
  return { contract, preserved: false };
}

function publicSummary(match, contract, sourceUrl, preserved = false) {
  return {
    status: preserved ? "existing_verified" : match.status,
    verified: contract?.verification_status === "verified",
    confidence: preserved ? 100 : match.confidence,
    method: preserved ? "existing_contract" : match.method,
    catalogVersion: match.catalogVersion || "",
    sourceUrl,
    providerName: contract?.provider_name || "",
    offerName: contract?.offer_name || "",
    contractId: contract?.id || null,
    supplies: match.supplies.map(item => ({
      commodity: item.commodity,
      status: item.status,
      confidence: item.confidence,
      method: item.method,
      selected: publicCandidate(item.candidate),
      candidates: item.candidates,
    })),
  };
}

export async function matchAndPersistPremiumOffer({
  config,
  bill,
  normalized,
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  try {
    const { payload, url } = await loadHistory(env, fetchImpl);
    const match = matchPremiumOfferHistory(normalized, payload);
    const values = buildPremiumContractValues(normalized, match, url);
    const { contract, preserved } = await persistContract({
      config,
      bill,
      values,
      fetchImpl,
    });
    return {
      ok: true,
      status: preserved ? "existing_verified" : match.status,
      verified: contract?.verification_status === "verified",
      contract,
      match,
      publicSummary: publicSummary(match, contract, url, preserved),
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      verified: false,
      contract: null,
      match: null,
      publicSummary: {
        status: "error",
        verified: false,
        confidence: 0,
        method: "none",
        catalogVersion: "",
        sourceUrl: "",
        providerName: "",
        offerName: "",
        contractId: null,
        supplies: [],
        errorCode: trimText(error?.message, 160).split(":")[0],
      },
    };
  }
}

export function resetPremiumOfferHistoryCacheForTests() {
  historyCache = { url: "", expiresAt: 0, payload: null };
}
