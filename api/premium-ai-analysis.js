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
  updatePremiumDeclaredOffer,
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
  createMeteredOpenAiTransport,
  createPremiumAnalysisRun,
  createUsageMeter,
  downloadPremiumBill,
  estimatePremiumAiCost,
  insertPremiumAiCostEvent,
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

export const config = { maxDuration: 60 };

const PREMIUM_COST_PRICING_VERSION = "premium-ecb-eur-v0.36.43";
const PREMIUM_ECB_DAILY_FX_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const PREMIUM_ECB_CACHE_MS = 6 * 60 * 60 * 1000;
const PREMIUM_WEB_SEARCH_USD_PER_1K_RUNS = 10;
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

async function verifiedPremiumAiCost(meter, backend, fetchImpl, nowMs) {
  const pricing = await automaticEurPricing(backend?.model, fetchImpl, nowMs);
  const webSearchCalls = Math.max(0, Number(meter?.totals?.webSearchCalls || 0));
  if (!pricing.complete) {
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
  const tokenCost = estimatePremiumAiCost(meter.totals, pricing);
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

function finiteAnalysisNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function premiumBillValuesWithPeriodConsumption(normalized, screening, runId, completedAt) {
  const values = premiumBillValuesFromAnalysis(normalized, screening, runId, completedAt);
  const customer = values.customer_analysis_data && typeof values.customer_analysis_data === "object"
    ? { ...values.customer_analysis_data }
    : {};
  for (const field of ["consumo_periodo_luce_kwh", "consumo_periodo_gas_smc"]) {
    const value = finiteAnalysisNumber(normalized?.[field]);
    if (value !== null && value > 0) customer[field] = value;
  }
  values.customer_analysis_data = customer;
  return values;
}

function customerOfferIdentityRead(normalized = {}) {
  return Boolean(
    String(normalized?.nome_offerta_luce || normalized?.nome_offerta_gas || "").trim()
    || String(normalized?.codice_offerta_luce || normalized?.codice_offerta_gas || "").trim()
  );
}

function refineCustomerScreening(screening = {}, normalized = {}) {
  const reasons = (Array.isArray(screening?.reasons) ? screening.reasons : []).map((reason) => {
    const code = String(reason?.code || "").trim();
    if (code === "offerta_non_riconosciuta" && customerOfferIdentityRead(normalized)) {
      return {
        ...reason,
        code: "offerta_letta_non_verificata_catalogo",
        title: "Offerta letta dalla bolletta",
        description: "L’offerta è stata letta dalla bolletta, ma la specifica versione economica non è stata verificata nel catalogo disponibile.",
        severity: "low",
        source: "offer_match",
        trafficLight: "neutral",
      };
    }
    const periodField = code === "campo_mancante_consumo_luce_kwh"
      ? "consumo_periodo_luce_kwh"
      : code === "campo_mancante_consumo_gas_smc"
        ? "consumo_periodo_gas_smc"
        : "";
    const periodValue = periodField ? finiteAnalysisNumber(normalized?.[periodField]) : null;
    if (periodValue !== null && periodValue > 0) {
      const commodity = periodField.includes("luce") ? "luce" : "gas";
      return {
        ...reason,
        code: `storico_consumi_${commodity}_in_costruzione`,
        title: "Storico consumi in costruzione",
        description: `La bolletta riporta il consumo del periodo, ma non un consumo annuo ${commodity}. OffertaLogica userà progressivamente le bollette della stessa utenza per ricostruire gli ultimi 12 mesi.`,
        severity: "low",
        source: "consumption_history",
        trafficLight: "neutral",
        suggestedAction: null,
      };
    }
    return reason;
  });
  const informationalCodes = new Set([
    "offerta_letta_non_verificata_catalogo",
    "storico_consumi_luce_in_costruzione",
    "storico_consumi_gas_in_costruzione",
  ]);
  const actionableReasons = reasons.filter(reason => !informationalCodes.has(String(reason?.code || "").trim()));
  if (screening?.status === "inconclusive" && reasons.length && actionableReasons.length === 0) {
    return {
      ...screening,
      status: "clear",
      trafficLight: "green",
      staffReviewAllowed: false,
      customerStatus: "correct",
      summary: "Controllo completato: nessuna anomalia rilevata.",
      reasons,
    };
  }
  return { ...screening, reasons };
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

    try {
      const body = await readJson(req);
      const accessToken = readBearerToken(req);
      const offerDecision = body?.action === "confirm_offer"
        ? "confirm"
        : body?.action === "reject_offer"
          ? "reject"
          : "";

      if (body?.action === "config_status") {
        if (!backend.supabaseUrl || !backend.serviceKey) throw new Error("premium_supabase_not_configured");
        const { staff } = await verifyPremiumStaff({ config: backend, accessToken, fetchImpl });
        if (staff.role !== "admin") throw new Error("premium_admin_delete_required");
        const persistentRateLimitConfigured = persistentStoreConfigured();
        const [backendReadiness, offerHistory, persistentRateLimitOperational] = await Promise.all([
          checkPremiumBackendReadiness({ config: backend, fetchImpl }),
          checkPremiumOfferHistory({ env, fetchImpl }),
          persistentRateLimitConfigured ? checkStore().catch(() => false) : Promise.resolve(false),
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
            rateLimits: {
              customerAnalysis: { limit: numberOr("RATE_LIMIT_PREMIUM_AI_CUSTOMER_LIMIT", 24), windowSeconds: numberOr("RATE_LIMIT_PREMIUM_AI_CUSTOMER_WINDOW_SECONDS", 3600) },
              staffAnalysis: { limit: numberOr("RATE_LIMIT_PREMIUM_AI_LIMIT", 12), windowSeconds: numberOr("RATE_LIMIT_PREMIUM_AI_WINDOW_SECONDS", 3600) },
              offerConfirmation: { limit: numberOr("RATE_LIMIT_PREMIUM_OFFER_CONFIRM_LIMIT", 30), windowSeconds: numberOr("RATE_LIMIT_PREMIUM_OFFER_CONFIRM_WINDOW_SECONDS", 3600) },
            },
          },
        });
      }

      if (body?.action === "update_declared_offer") {
        if (!backend.supabaseUrl || !backend.serviceKey) throw new Error("premium_supabase_not_configured");
        const { user } = await verifyPremiumCustomer({ config: backend, accessToken, fetchImpl });
        if (!(await enforceRateLimit(req, res, {
          label: "premium-offer-confirmation",
          identifier: user.id,
          limit: Number(env.RATE_LIMIT_PREMIUM_OFFER_CONFIRM_LIMIT || 30),
          windowSeconds: Number(env.RATE_LIMIT_PREMIUM_OFFER_CONFIRM_WINDOW_SECONDS || 3600),
        }))) return;
        const updated = await updatePremiumDeclaredOffer({
          config: backend,
          userId: user.id,
          billId: body?.billId,
          contractId: body?.contractId,
          values: body?.offer || {},
          fetchImpl,
        });
        await patchPremiumBill({
          config: backend,
          billId: updated.bill.id,
          fetchImpl,
          values: { ...resetRedVerificationValues(), contract_id: updated.contract.id, updated_at: new Date().toISOString() },
        });
        return json(res, 200, {
          ok: true,
          mode: "declared_offer_update",
          contract: {
            id: updated.contract.id,
            verificationStatus: updated.contract.verification_status,
            confirmationStatus: updated.contract.customer_confirmation_status,
            providerName: updated.contract.provider_name,
            offerName: updated.contract.offer_name,
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
          screening = refineCustomerScreening(
            classifyPremiumAutomaticAnalysis(decisionResult.normalized, {
              contract: premiumContractForAutomaticComparison(
                decisionResult.contract,
                decisionResult.normalized,
              ),
            }),
            decisionResult.normalized,
          );
          const completedAt = new Date().toISOString();
          await patchPremiumBill({
            config: backend,
            billId: decisionResult.bill.id,
            fetchImpl,
            values: {
              ...premiumBillValuesWithPeriodConsumption(
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

      if (body?.action === "verify_red") {
        assertPremiumAiConfigured(backend);
        try {
          const { user } = await verifyPremiumCustomer({ config: backend, accessToken, fetchImpl });
          if (!(await enforceRateLimit(req, res, {
            label: "premium-ai-red-verification",
            identifier: user.id,
            limit: Number(env.RATE_LIMIT_PREMIUM_AI_RED_LIMIT || 12),
            windowSeconds: Number(env.RATE_LIMIT_PREMIUM_AI_RED_WINDOW_SECONDS || 3600),
          }))) return;

          const snapshot = await loadPremiumRedVerificationSnapshot({
            config: backend,
            billId: body.billId,
            userId: user.id,
            fetchImpl,
          });
          bill = snapshot.bill;
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
              reused: true,
              verification: publicRedVerification(cachedResult),
            });
          }

          const contract = await loadPremiumBillContract({ config: backend, bill, fetchImpl });
          const trustedContract = premiumContractForAutomaticComparison(contract, snapshot.firstRun?.extracted_data || {});
          run = await createPremiumAnalysisRun({
            config: backend,
            bill,
            requestedByUserId: user.id,
            origin: "red_verification",
            staleAfterMs: Math.max(90000, Number(backend.deadlineMs || 0) + 30000),
            fetchImpl,
          });
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

          const meter = instrumentWebSearchMeter(createUsageMeter());
          const transport = createMeteredOpenAiTransport({ meter, fetchImpl });
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
            ? verification.offer_resolution.selected
            : null;
          if (verifiedOffer?.auto_verifiable && snapshot.firstRun?.extracted_data) {
            const persisted = await persistPremiumVerifiedOffer({
              config: backend,
              bill,
              offer: verifiedOffer,
              actor: "ai",
              fetchImpl,
              now: completedAt,
            });
            resolvedOfferContract = persisted.contract;
            const normalizedForResolvedOffer = {
              ...snapshot.firstRun.extracted_data,
              _offer_match: { status: "matched", verified: true },
            };
            resolvedOfferScreening = refineCustomerScreening(
              classifyPremiumAutomaticAnalysis(normalizedForResolvedOffer, {
                contract: premiumContractForAutomaticComparison(resolvedOfferContract, normalizedForResolvedOffer),
              }),
              normalizedForResolvedOffer,
            );
            await patchPremiumAnalysisRun({
              config: backend,
              runId: snapshot.firstRun.id,
              fetchImpl,
              values: {
                automatic_classification: resolvedOfferScreening.status,
                automatic_summary: resolvedOfferScreening.summary,
                automatic_reasons: resolvedOfferScreening.reasons,
              },
            });
            if (resolvedOfferScreening.status !== "review_recommended") {
              verification = {
                ...verification,
                decision: "resolved_ai",
                can_resolve_alone: "yes",
                resolved_screening_status: resolvedOfferScreening.status,
                customer_reply: resolvedOfferScreening.status === "clear"
                  ? `La bolletta è coerente con l’offerta ${resolvedOfferContract.offer_name || "verificata"} identificata per il periodo del documento. Non risultano anomalie contrattuali.`
                  : `Il riferimento dell’offerta è stato verificato e il precedente codice rosso contrattuale non è confermato. Rimane soltanto l’avviso indicato nell’analisi.`,
                escalation_reason: "",
                missing_data: [],
              };
            } else {
              const rerouted = routePremiumRedReasons(resolvedOfferScreening.reasons);
              verification = {
                ...verification,
                route: rerouted.route,
                reason_codes: rerouted.codes,
                decision: rerouted.route === "staff_required" ? "staff_required" : "quick_verify",
                verification_result: "inconclusive",
                can_resolve_alone: "no",
                issue: "Offerta verificata; resta un’anomalia da controllare",
                customer_reply: "",
                escalation_reason: "L’offerta di riferimento è stata verificata, ma il nuovo confronto mantiene un’anomalia rossa. È necessaria una verifica prima di comunicare l’esito al cliente.",
                missing_data: [],
              };
            }
          }
          const durationMs = Math.max(0, now() - startedAt);
          const costResult = await verifiedPremiumAiCost(meter, backend, fetchImpl, now());
          const estimatedCostEur = costResult.estimatedCostEur;
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
              usage_details: {
                input_tokens: meter.totals.inputTokens,
                cached_input_tokens: meter.totals.cachedInputTokens,
                output_tokens: meter.totals.outputTokens,
                reasoning_tokens: meter.totals.reasoningTokens,
                total_tokens: meter.totals.totalTokens,
                calls: meter.totals.calls,
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
              },
              response_ids: verified.responseId ? [verified.responseId] : [],
              automatic_classification: "not_applicable",
              automatic_summary: "",
              automatic_reasons: [],
              error_code: "",
              error_message: "",
            },
          });
          const finalBillValues = {
            processing_status: "completed",
            red_verification_state: state,
            red_verification_result: verification,
            red_verification_run_id: run.id,
            red_verified_at: completedAt,
            updated_at: completedAt,
          };
          if (resolvedOfferContract?.id) finalBillValues.contract_id = resolvedOfferContract.id;
          if (resolvedOfferScreening && snapshot.firstRun?.extracted_data) {
            Object.assign(finalBillValues, premiumBillValuesWithPeriodConsumption(
              { ...snapshot.firstRun.extracted_data, _offer_match: { status: "matched", verified: true } },
              resolvedOfferScreening,
              snapshot.firstRun.id,
              completedAt,
            ));
            Object.assign(finalBillValues, {
              red_verification_state: state,
              red_verification_result: verification,
              red_verification_run_id: run.id,
              red_verified_at: completedAt,
              contract_id: resolvedOfferContract.id,
            });
          }
          await patchPremiumBill({ config: backend, billId: bill.id, fetchImpl, values: finalBillValues });
          await insertPremiumAiCostEvent({
            config: backend,
            bill,
            check: null,
            run: { ...run, origin: "red_verification" },
            usage: meter.totals,
            estimatedCostEur,
            model: backend.model,
            fetchImpl,
          }).catch(() => null);

          return json(res, 200, {
            ok: true,
            mode: "red_verification",
            reused: false,
            verification: publicRedVerification(verification),
          });
        } catch (redError) {
          const completedAt = new Date().toISOString();
          if (run?.id) {
            await patchPremiumAnalysisRun({
              config: backend,
              runId: run.id,
              fetchImpl,
              values: {
                status: "failed",
                completed_at: completedAt,
                duration_ms: Math.max(0, now() - startedAt),
                automatic_classification: "not_applicable",
                error_code: String(redError?.message || "premium_red_verification_error").split(":")[0].slice(0, 120),
                error_message: String(redError?.message || "Seconda verifica IA non riuscita").slice(0, 500),
              },
            }).catch(() => {});
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
          const safe = publicPremiumAiError(redError);
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

      temporaryFilePath = path.join(os.tmpdir(), `offertalogica-premium-ai-${crypto.randomUUID()}.pdf`);
      await downloadPremiumBill({ config: backend, bill, destinationPath: temporaryFilePath, fetchImpl });
      const header = await normalizePdfFileHeader(temporaryFilePath);
      if (!header.valid) throw new Error("premium_bill_download_not_pdf");

      const meter = instrumentWebSearchMeter(createUsageMeter());
      const transport = createMeteredOpenAiTransport({ meter, fetchImpl });
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
      const screening = refineCustomerScreening(
        classifyPremiumAutomaticAnalysis(normalized, { contract: contractForScreening }),
        normalized,
      );
      const durationMs = Math.max(0, now() - startedAt);
      const costResult = await verifiedPremiumAiCost(meter, backend, fetchImpl, now());
      const estimatedCostEur = costResult.estimatedCostEur;
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
          usage_details: {
            input_tokens: meter.totals.inputTokens,
            cached_input_tokens: meter.totals.cachedInputTokens,
            output_tokens: meter.totals.outputTokens,
            reasoning_tokens: meter.totals.reasoningTokens,
            total_tokens: meter.totals.totalTokens,
            calls: meter.totals.calls,
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
          },
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
          ...premiumBillValuesWithPeriodConsumption(normalized, screening, run.id, completedAt),
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

      await insertPremiumAiCostEvent({
        config: backend,
        bill,
        check,
        run: { ...run, origin: customerMode ? "customer_upload" : "staff_manual" },
        usage: meter.totals,
        estimatedCostEur,
        model: normalized?.ai?.model || backend.model,
        fetchImpl,
      }).catch(() => null);

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
      }
      if (bill?.id && !analysisAlreadyRunning) {
        await patchPremiumBill({
          config: backend,
          billId: bill.id,
          fetchImpl,
          values: customerMode
            ? {
                ...resetRedVerificationValues(),
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
                updated_at: completedAt,
              }
            : { processing_status: "ready_for_review", updated_at: completedAt },
        }).catch(() => {});
      }
      const safe = publicPremiumAiError(error);
      return json(res, safe.status, { ok: false, code: safe.code, error: safe.error });
    } finally {
      if (temporaryFilePath) await fs.unlink(temporaryFilePath).catch(() => {});
    }
  };
}

export default createPremiumAiAnalysisHandler();
