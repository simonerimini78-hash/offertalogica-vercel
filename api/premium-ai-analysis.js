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
import { staffPermissionAllowed } from "../lib/staffSessionAuth.js";

export const config = { maxDuration: 60 };

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
        await verifyPremiumStaff({ config: backend, accessToken, fetchImpl });
        if (!(await staffPermissionAllowed({
          config: backend,
          accessToken,
          permission: "view_ai_costs",
          fetchImpl,
        }))) throw new Error("premium_staff_permission_required:view_ai_costs");
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
        const pricing = {
          inputPerMillion: backend.pricing.inputPerMillion,
          cachedInputPerMillion: backend.pricing.cachedInputPerMillion,
          outputPerMillion: backend.pricing.outputPerMillion,
          complete: Boolean(backend.pricing.complete),
          sources: backend.pricing.sources || {},
          missing: Array.isArray(backend.pricing.missing) ? backend.pricing.missing : [],
          modelDefaultApplied: Boolean(backend.pricing.modelDefaultApplied),
        };
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

      const meter = createUsageMeter();
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
        if (offerMatch?.publicSummary) normalized._offer_match = offerMatch.publicSummary;
      }

      const contractForScreening = contract?.verification_status === "verified" ? contract : null;
      const completion = analysisCompletionStatus(normalized);
      const screening = classifyPremiumAutomaticAnalysis(normalized, { contract: contractForScreening });
      const durationMs = Math.max(0, now() - startedAt);
      const estimatedCostEur = estimatePremiumAiCost(meter.totals, backend.pricing);
      const extractedData = sanitizePremiumAnalysisData(normalized, meter.totals, customerMode ? screening : null);
      const matchWarning = offerMatchWarning(offerMatch);
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
        const values = premiumBillValuesFromAnalysis(normalized, screening, run.id, completedAt);
        if (offerMatch?.contract?.id) values.contract_id = offerMatch.contract.id;
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
