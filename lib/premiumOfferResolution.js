import { premiumProviderNamesEquivalent } from "./premiumOfferReferenceTrust.js";

export const PREMIUM_OFFER_RESOLUTION_VERSION = "premium-offer-resolution-v0.36.37";
export const DEFAULT_GAS_REFERENCE_PCS_GJ_SMC = 0.03852;

function cleanText(value, max = 600) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}
function lower(value) { return cleanText(value, 600).toLowerCase(); }
function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function isoDate(value) {
  const text = cleanText(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const time = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(time) ? text : null;
}
function canonical(value) {
  return lower(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function sameText(left, right) {
  const a = canonical(left);
  const b = canonical(right);
  return Boolean(a && b && a === b);
}
function relativeClose(actual, expected, absoluteFloor, relativeTolerance = 0.05) {
  const a = finiteNumber(actual);
  const e = finiteNumber(expected);
  if (a === null || e === null) return false;
  return Math.abs(a - e) <= Math.max(absoluteFloor, Math.abs(e) * relativeTolerance);
}
function billOfferName(firstAnalysis = {}, commodity) {
  return cleanText(commodity === "gas"
    ? (firstAnalysis.nome_offerta_gas ?? firstAnalysis.nome_offerta)
    : (firstAnalysis.nome_offerta_luce ?? firstAnalysis.nome_offerta), 300);
}
function billOfferCode(firstAnalysis = {}, commodity) {
  return cleanText(commodity === "gas"
    ? (firstAnalysis.codice_offerta_gas ?? firstAnalysis.codice_offerta)
    : (firstAnalysis.codice_offerta_luce ?? firstAnalysis.codice_offerta), 180);
}
function billProvider(firstAnalysis = {}, commodity) {
  return cleanText(commodity === "gas"
    ? (firstAnalysis.fornitore_gas ?? firstAnalysis.fornitore)
    : (firstAnalysis.fornitore_luce ?? firstAnalysis.fornitore), 300);
}
function billReferenceDate(firstAnalysis = {}, bill = {}) {
  return isoDate(firstAnalysis.billing_period_end)
    || isoDate(bill.billing_period_end)
    || isoDate(firstAnalysis.issue_date)
    || isoDate(bill.issue_date)
    || null;
}
function periodContains(candidate, referenceDate) {
  const from = isoDate(candidate.valid_from);
  const to = isoDate(candidate.valid_to);
  if (!referenceDate || !from || !to) return false;
  return referenceDate >= from && referenceDate <= to;
}
function normalizedUrl(value) {
  try {
    const url = new URL(cleanText(value, 1200));
    if (url.protocol !== "https:") return "";
    url.hash = "";
    return url.toString();
  } catch { return ""; }
}
function urlUsedBySearch(url, webSources = []) {
  const target = normalizedUrl(url);
  if (!target) return false;
  const targetUrl = new URL(target);
  return webSources.some(source => {
    const current = normalizedUrl(source?.url || source);
    if (!current) return false;
    const currentUrl = new URL(current);
    return currentUrl.hostname === targetUrl.hostname && currentUrl.pathname === targetUrl.pathname;
  });
}
function regulatorSource(url) {
  const normalized = normalizedUrl(url);
  if (!normalized) return false;
  const host = new URL(normalized).hostname.toLowerCase().replace(/^www\./, "");
  return host === "arera.it" || host.endsWith(".arera.it")
    || host === "ilportaleofferte.it" || host.endsWith(".ilportaleofferte.it");
}

export function normalizeGasOfferPriceForBill({ referencePrice, referencePcs = DEFAULT_GAS_REFERENCE_PCS_GJ_SMC, billPcs } = {}) {
  const price = finiteNumber(referencePrice);
  const refPcs = finiteNumber(referencePcs);
  const actualPcs = finiteNumber(billPcs);
  if (price === null || refPcs === null || actualPcs === null || refPcs <= 0 || actualPcs <= 0) return null;
  return Number((price * actualPcs / refPcs).toFixed(9));
}

export function gasOfferPriceCompatibility({ referencePrice, referencePcs = DEFAULT_GAS_REFERENCE_PCS_GJ_SMC, billPcs, billPrice } = {}) {
  const price = finiteNumber(referencePrice);
  const applied = finiteNumber(billPrice);
  if (price === null || applied === null) return { compatible: false, normalizedExpectedPrice: null, method: "missing_price" };
  const normalizedExpectedPrice = normalizeGasOfferPriceForBill({ referencePrice: price, referencePcs, billPcs });
  const expected = normalizedExpectedPrice ?? price;
  return {
    compatible: relativeClose(applied, expected, 0.02, 0.05),
    normalizedExpectedPrice,
    method: normalizedExpectedPrice === null ? "raw_tolerance" : "pcs_normalized",
  };
}

function pricingTypeCompatible(candidate, firstAnalysis, commodity) {
  const candidateType = lower(candidate.pricing_type);
  const actual = lower(commodity === "gas" ? firstAnalysis.tipo_prezzo_gas : firstAnalysis.tipo_prezzo_luce);
  if (!candidateType || candidateType === "unknown" || !actual) return false;
  const normalizedActual = actual.includes("variab") || actual.includes("indicizz") ? "indexed"
    : actual.includes("fiss") ? "fixed"
      : actual.includes("ibrid") || actual.includes("misto") ? "mixed" : actual;
  return candidateType === normalizedActual;
}

function economicsCompatible(candidate, firstAnalysis, offerResolution = {}) {
  const commodity = candidate.commodity;
  const type = lower(candidate.pricing_type);
  const candidateFee = finiteNumber(candidate.annual_fixed_fee);
  const billFee = finiteNumber(commodity === "gas" ? firstAnalysis.quota_fissa_vendita_gas_eur_anno : firstAnalysis.quota_fissa_vendita_luce_eur_anno);
  const fixedFeeCompatible = candidateFee !== null && billFee !== null && relativeClose(billFee, candidateFee, 5, 0.05);
  if (!fixedFeeCompatible) return { compatible: false, priceCompatible: false, fixedFeeCompatible, normalization: null };

  if (type === "fixed") {
    const referencePrice = finiteNumber(candidate.unit_price);
    const billPrice = finiteNumber(commodity === "gas" ? firstAnalysis.prezzo_gas_eur_smc : firstAnalysis.prezzo_luce_eur_kwh);
    if (commodity === "gas") {
      const billPcs = finiteNumber(offerResolution.bill_pcs_gj_smc);
      const result = gasOfferPriceCompatibility({
        referencePrice,
        referencePcs: finiteNumber(candidate.reference_pcs_gj_smc) ?? DEFAULT_GAS_REFERENCE_PCS_GJ_SMC,
        billPcs,
        billPrice,
      });
      return { compatible: result.compatible && fixedFeeCompatible, priceCompatible: result.compatible, fixedFeeCompatible, normalization: result };
    }
    const priceCompatible = referencePrice !== null && billPrice !== null && relativeClose(billPrice, referencePrice, 0.005, 0.05);
    return { compatible: priceCompatible && fixedFeeCompatible, priceCompatible, fixedFeeCompatible, normalization: null };
  }

  if (type === "indexed") {
    const candidateIndex = cleanText(candidate.index_name, 100);
    const billIndex = cleanText(commodity === "gas" ? firstAnalysis.indice_riferimento_gas : firstAnalysis.indice_riferimento_luce, 100);
    const indexCompatible = Boolean(candidateIndex && billIndex && sameText(candidateIndex, billIndex));
    const candidateSpread = finiteNumber(candidate.spread);
    const billSpread = finiteNumber(commodity === "gas" ? firstAnalysis.spread_gas_eur_smc : firstAnalysis.spread_luce_eur_kwh);
    const spreadCompatible = candidateSpread !== null && billSpread !== null
      && relativeClose(billSpread, candidateSpread, commodity === "gas" ? 0.01 : 0.002, 0.05);
    return { compatible: indexCompatible && spreadCompatible && fixedFeeCompatible, priceCompatible: indexCompatible && spreadCompatible, fixedFeeCompatible, normalization: null };
  }

  return { compatible: false, priceCompatible: false, fixedFeeCompatible, normalization: null };
}

export function normalizeOfferResolutionCandidate(raw = {}) {
  const commodityRaw = lower(raw.commodity);
  const commodity = commodityRaw === "electricity" || commodityRaw === "luce" ? "electricity"
    : commodityRaw === "gas" ? "gas" : "unknown";
  const pricingRaw = lower(raw.pricing_type);
  const pricing_type = ["fixed", "indexed", "mixed", "unknown"].includes(pricingRaw) ? pricingRaw : "unknown";
  return {
    commodity,
    provider_name: cleanText(raw.provider_name, 300),
    offer_name: cleanText(raw.offer_name, 300),
    offer_code: cleanText(raw.offer_code, 180),
    pricing_type,
    unit_price: finiteNumber(raw.unit_price),
    annual_fixed_fee: finiteNumber(raw.annual_fixed_fee),
    index_name: cleanText(raw.index_name, 100),
    spread: finiteNumber(raw.spread),
    formula: cleanText(raw.formula, 500),
    valid_from: isoDate(raw.valid_from),
    valid_to: isoDate(raw.valid_to),
    source_url: normalizedUrl(raw.source_url),
    source_title: cleanText(raw.source_title, 300),
    reference_pcs_gj_smc: finiteNumber(raw.reference_pcs_gj_smc),
  };
}

export function evaluatePremiumOfferResolution({ rawResolution = {}, firstAnalysis = {}, bill = {}, webSources = [] } = {}) {
  const billPcs = finiteNumber(rawResolution.bill_pcs_gj_smc);
  const billCoefficientC = finiteNumber(rawResolution.bill_coefficient_c);
  const referenceDate = billReferenceDate(firstAnalysis, bill);
  const candidates = (Array.isArray(rawResolution.candidates) ? rawResolution.candidates : []).slice(0, 5).map((raw, index) => {
    const candidate = normalizeOfferResolutionCandidate(raw);
    const commodityKey = candidate.commodity === "electricity" ? "luce" : candidate.commodity;
    const provider = billProvider(firstAnalysis, commodityKey);
    const offerName = billOfferName(firstAnalysis, commodityKey);
    const offerCode = billOfferCode(firstAnalysis, commodityKey);
    const providerMatch = premiumProviderNamesEquivalent(provider, candidate.provider_name);
    const exactCodeMatch = Boolean(offerCode && candidate.offer_code && canonical(offerCode) === canonical(candidate.offer_code));
    const exactNameMatch = Boolean(offerName && candidate.offer_name && sameText(offerName, candidate.offer_name));
    const identityMatch = offerCode ? exactCodeMatch : exactNameMatch;
    const periodMatch = periodContains(candidate, referenceDate);
    const pricingMatch = pricingTypeCompatible(candidate, firstAnalysis, commodityKey);
    const economics = economicsCompatible(candidate, firstAnalysis, { bill_pcs_gj_smc: billPcs });
    const usedSource = urlUsedBySearch(candidate.source_url, webSources);
    const authoritativeSource = regulatorSource(candidate.source_url);
    const autoVerifiable = candidate.commodity !== "unknown"
      && providerMatch
      && identityMatch
      && periodMatch
      && pricingMatch
      && economics.compatible
      && usedSource
      && authoritativeSource;
    return {
      ...candidate,
      index,
      bill_reference_date: referenceDate,
      bill_pcs_gj_smc: billPcs,
      bill_coefficient_c: billCoefficientC,
      normalized_expected_price: economics.normalization?.normalizedExpectedPrice ?? null,
      normalization_method: economics.normalization?.method || "none",
      checks: {
        provider_match: providerMatch,
        identity_match: identityMatch,
        exact_code_match: exactCodeMatch,
        exact_name_match: exactNameMatch,
        period_match: periodMatch,
        pricing_type_match: pricingMatch,
        price_or_formula_match: economics.priceCompatible,
        fixed_fee_match: economics.fixedFeeCompatible,
        search_source_used: usedSource,
        authoritative_source: authoritativeSource,
      },
      auto_verifiable: autoVerifiable,
    };
  });
  const verified = candidates.find(item => item.auto_verifiable) || null;
  return {
    version: PREMIUM_OFFER_RESOLUTION_VERSION,
    status: verified ? "verified" : candidates.length ? "candidates" : "none",
    searched_web: Boolean(rawResolution.search_performed),
    bill_pcs_gj_smc: billPcs,
    bill_coefficient_c: billCoefficientC,
    verified_candidate_index: verified?.index ?? null,
    selected: verified,
    candidates,
    web_sources: webSources.slice(0, 12).map(source => ({
      url: normalizedUrl(source?.url || source),
      title: cleanText(source?.title, 300),
    })).filter(source => source.url),
  };
}

function serviceHeaders(config, extra = {}) {
  return { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, Accept: "application/json", ...extra };
}
async function serviceRequest(config, path, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.supabaseUrl}${path}`, { ...options, headers: serviceHeaders(config, options.headers || {}) });
  const text = await response.text().catch(() => "");
  if (!response.ok) throw new Error(`premium_offer_resolution_http_${response.status}:${text.slice(0, 240)}`);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}
const CONTRACT_SELECT = "id,user_id,utility_id,provider_name,offer_name,pricing_type,contract_start,contract_end,fixed_price_expiry,electricity_price_eur_kwh,gas_price_eur_smc,electricity_fixed_fee_eur_year,gas_fixed_fee_eur_year,source,verification_status,is_current,arera_offer_code_electricity,arera_offer_code_gas,electricity_index_name,gas_index_name,electricity_spread_eur_kwh,gas_spread_eur_smc,electricity_formula,gas_formula,automatic_match_status,automatic_match_confidence,automatic_match_method,automatic_match_candidates,automatic_matched_at,automatic_match_catalog_version,automatic_match_source_url,customer_confirmation_status,customer_confirmed_at,customer_rejected_at,customer_selected_candidates,customer_confirmation_version,created_at,updated_at";

async function loadContract(config, id, userId, fetchImpl) {
  if (!id) return null;
  const q = new URLSearchParams({ select: CONTRACT_SELECT, id: `eq.${id}`, user_id: `eq.${userId}`, limit: "1" });
  const rows = await serviceRequest(config, `/rest/v1/premium_contracts?${q}`, { method: "GET" }, fetchImpl);
  return Array.isArray(rows) ? rows[0] || null : null;
}
async function loadCurrentContract(config, bill, fetchImpl) {
  const q = new URLSearchParams({ select: CONTRACT_SELECT, user_id: `eq.${bill.user_id}`, utility_id: `eq.${bill.utility_id}`, is_current: "eq.true", order: "created_at.desc", limit: "1" });
  const rows = await serviceRequest(config, `/rest/v1/premium_contracts?${q}`, { method: "GET" }, fetchImpl);
  return Array.isArray(rows) ? rows[0] || null : null;
}
async function patchContract(config, id, values, fetchImpl) {
  const q = new URLSearchParams({ id: `eq.${id}` });
  const rows = await serviceRequest(config, `/rest/v1/premium_contracts?${q}`, { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(values) }, fetchImpl);
  return Array.isArray(rows) ? rows[0] || null : rows;
}
async function insertContract(config, values, fetchImpl) {
  const rows = await serviceRequest(config, "/rest/v1/premium_contracts", { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(values) }, fetchImpl);
  return Array.isArray(rows) ? rows[0] || null : rows;
}
function contractValuesFromOffer(offer, { actor = "ai", now = new Date().toISOString(), isCurrent = false } = {}) {
  const commodity = offer.commodity === "electricity" ? "electricity" : "gas";
  const values = {
    provider_name: cleanText(offer.provider_name, 300),
    offer_name: cleanText(offer.offer_name, 300),
    pricing_type: ["fixed", "indexed", "mixed"].includes(offer.pricing_type) ? offer.pricing_type : "unknown",
    contract_start: isoDate(offer.valid_from),
    contract_end: isoDate(offer.valid_to),
    fixed_price_expiry: offer.pricing_type === "fixed" ? isoDate(offer.valid_to) : null,
    source: actor === "staff" ? "staff" : "import",
    verification_status: "verified",
    is_current: Boolean(isCurrent),
    automatic_match_status: "matched",
    automatic_match_confidence: 100,
    automatic_match_method: actor === "staff" ? "staff_verified" : "web_official_verified",
    automatic_match_candidates: [],
    automatic_matched_at: now,
    automatic_match_catalog_version: PREMIUM_OFFER_RESOLUTION_VERSION,
    automatic_match_source_url: cleanText(offer.source_url, 1200),
    customer_confirmation_status: "not_required",
    customer_confirmed_at: null,
    customer_rejected_at: null,
    customer_selected_candidates: [],
    customer_confirmation_version: PREMIUM_OFFER_RESOLUTION_VERSION,
  };
  if (commodity === "gas") {
    values.gas_price_eur_smc = finiteNumber(offer.unit_price);
    values.gas_fixed_fee_eur_year = finiteNumber(offer.annual_fixed_fee);
    values.gas_index_name = cleanText(offer.index_name, 100);
    values.gas_spread_eur_smc = finiteNumber(offer.spread);
    values.gas_formula = cleanText(offer.formula, 500);
    values.arera_offer_code_gas = cleanText(offer.offer_code, 180);
  } else {
    values.electricity_price_eur_kwh = finiteNumber(offer.unit_price);
    values.electricity_fixed_fee_eur_year = finiteNumber(offer.annual_fixed_fee);
    values.electricity_index_name = cleanText(offer.index_name, 100);
    values.electricity_spread_eur_kwh = finiteNumber(offer.spread);
    values.electricity_formula = cleanText(offer.formula, 500);
    values.arera_offer_code_electricity = cleanText(offer.offer_code, 180);
  }
  return values;
}

export async function persistPremiumVerifiedOffer({ config, bill, offer, actor = "ai", fetchImpl = fetch, now = new Date().toISOString() } = {}) {
  if (!bill?.id || !bill?.user_id || !bill?.utility_id) throw new Error("premium_offer_bill_required");
  if (!offer || offer.commodity === "unknown") throw new Error("premium_offer_candidate_required");
  const current = await loadCurrentContract(config, bill, fetchImpl);
  const bound = await loadContract(config, bill.contract_id, bill.user_id, fetchImpl);
  const today = now.slice(0, 10);
  const validToday = Boolean(isoDate(offer.valid_from) && isoDate(offer.valid_to) && today >= offer.valid_from && today <= offer.valid_to);
  // Una bolletta storica non può sostituire un contratto corrente diverso,
  // neppure quando la validità commerciale della vecchia offerta comprende oggi.
  // L'aggiornamento automatico del corrente è ammesso solo se la bolletta era
  // già legata proprio a quel record corrente (tipico dato dichiarato da correggere).
  const makeCurrent = validToday && (!current || current.id === bound?.id);
  const boundEditable = bound
    && (bound.verification_status !== "verified" || bound.customer_confirmation_status === "confirmed" || lower(bound.automatic_match_method) === "customer_confirmed");
  const canReplaceBound = Boolean(boundEditable && (bound.id !== current?.id || makeCurrent));
  const preservedCurrentContractId = current?.id && current.id !== bound?.id ? current.id : null;
  const values = { ...contractValuesFromOffer(offer, { actor, now, isCurrent: makeCurrent }), user_id: bill.user_id, utility_id: bill.utility_id, updated_at: now };
  let contract = null;
  if (canReplaceBound) {
    contract = await patchContract(config, bound.id, values, fetchImpl);
  } else {
    // Se esiste già un corrente diverso, inseriamo prima lo storico come non corrente:
    // così non violiamo l'unicità e non lasciamo l'utenza senza riferimento in caso di errore.
    const insertValues = { ...values, is_current: makeCurrent && !current, created_at: now };
    contract = await insertContract(config, insertValues, fetchImpl);
    if (makeCurrent && current?.id && contract?.id) {
      await patchContract(config, current.id, { is_current: false, updated_at: now }, fetchImpl);
      contract = await patchContract(config, contract.id, { is_current: true, updated_at: now }, fetchImpl);
    }
  }
  return { contract, preservedCurrentContractId, historical: !makeCurrent };
}

function sanitizedDeclaredValues(raw = {}, commodity) {
  const values = {
    provider_name: cleanText(raw.provider_name, 300),
    offer_name: cleanText(raw.offer_name, 300),
    pricing_type: ["fixed", "indexed", "mixed", "unknown"].includes(lower(raw.pricing_type)) ? lower(raw.pricing_type) : "unknown",
    contract_start: isoDate(raw.contract_start),
    contract_end: isoDate(raw.contract_end),
    fixed_price_expiry: isoDate(raw.fixed_price_expiry),
  };
  const price = finiteNumber(raw.unit_price);
  const fixed = finiteNumber(raw.annual_fixed_fee);
  const spread = finiteNumber(raw.spread);
  if (price !== null && (price < 0 || price > (commodity === "gas" ? 20 : 5))) throw new Error("premium_offer_value_invalid");
  if (fixed !== null && (fixed < 0 || fixed > 10000)) throw new Error("premium_offer_value_invalid");
  if (spread !== null && Math.abs(spread) > 5) throw new Error("premium_offer_value_invalid");
  if (commodity === "gas") {
    values.gas_price_eur_smc = price;
    values.gas_fixed_fee_eur_year = fixed;
    values.gas_index_name = cleanText(raw.index_name, 100);
    values.gas_spread_eur_smc = spread;
    values.gas_formula = cleanText(raw.formula, 500);
    values.arera_offer_code_gas = cleanText(raw.offer_code, 180);
  } else {
    values.electricity_price_eur_kwh = price;
    values.electricity_fixed_fee_eur_year = fixed;
    values.electricity_index_name = cleanText(raw.index_name, 100);
    values.electricity_spread_eur_kwh = spread;
    values.electricity_formula = cleanText(raw.formula, 500);
    values.arera_offer_code_electricity = cleanText(raw.offer_code, 180);
  }
  return values;
}

export async function updatePremiumDeclaredOffer({ config, userId, billId, contractId, values, fetchImpl = fetch, now = new Date().toISOString() } = {}) {
  const billQ = new URLSearchParams({ select: "id,user_id,utility_id,contract_id,commodity,billing_period_end,issue_date,created_at", id: `eq.${billId}`, user_id: `eq.${userId}`, limit: "1" });
  const bills = await serviceRequest(config, `/rest/v1/premium_bills?${billQ}`, { method: "GET" }, fetchImpl);
  const bill = Array.isArray(bills) ? bills[0] || null : null;
  if (!bill || bill.contract_id !== contractId) throw new Error("premium_offer_bill_mismatch");
  const contract = await loadContract(config, contractId, userId, fetchImpl);
  if (!contract || contract.utility_id !== bill.utility_id) throw new Error("premium_offer_contract_not_found");
  const legacyDeclaration = contract.customer_confirmation_status === "confirmed" || lower(contract.automatic_match_method) === "customer_confirmed";
  if (contract.verification_status === "verified" && !legacyDeclaration) throw new Error("premium_offer_verified_locked");
  const commodity = bill.commodity === "electricity" ? "electricity" : bill.commodity === "gas" ? "gas" : null;
  if (!commodity) throw new Error("premium_offer_commodity_invalid");
  const declared = sanitizedDeclaredValues(values, commodity);
  if (!declared.provider_name || !declared.offer_name) throw new Error("premium_offer_declared_required");
  const updated = await patchContract(config, contract.id, {
    ...declared,
    source: "manual",
    verification_status: "needs_review",
    automatic_match_status: "not_attempted",
    automatic_match_confidence: 0,
    automatic_match_method: "customer_declared_edit",
    automatic_match_candidates: [],
    automatic_matched_at: null,
    automatic_match_catalog_version: "",
    automatic_match_source_url: "",
    customer_confirmation_status: "confirmed",
    customer_confirmed_at: now,
    customer_rejected_at: null,
    customer_selected_candidates: [],
    customer_confirmation_version: PREMIUM_OFFER_RESOLUTION_VERSION,
    updated_at: now,
  }, fetchImpl);
  return { bill, contract: updated };
}

export function staffOfferPayload(raw = {}, commodity = "gas") {
  const candidate = normalizeOfferResolutionCandidate({ ...raw, commodity });
  if (!candidate.provider_name || !candidate.offer_name) throw new Error("premium_offer_declared_required");
  return candidate;
}
