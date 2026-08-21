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
  PREMIUM_RED_VERIFIER_VERSION,
  loadPremiumRedVerificationSnapshot,
  verifyPremiumRedPdf,
} from "../lib/premiumRedVerifier.js";
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

          const meter = createUsageMeter();
          const transport = createMeteredOpenAiTransport({ meter, fetchImpl });
          const verified = await verifyRedPdf({
            filePath: temporaryFilePath,
            filename: bill.original_file_name || "bolletta.pdf",
            reasons: snapshot.bill.automatic_screening_reasons,
            firstAnalysis: snapshot.firstRun?.extracted_data || {},
            firstAnalysisRunId: snapshot.bill.automatic_analysis_run_id || null,
            contract: contract?.verification_status === "verified" ? contract : null,
            apiKey: backend.openAiApiKey,
            model: backend.model,
            transport,
            fetchImpl,
            deadlineAt: startedAt + backend.deadlineMs,
            env,
          });
          const verification = verified.result;
          const completedAt = new Date().toISOString();
          const durationMs = Math.max(0, now() - startedAt);
          const estimatedCostEur = estimatePremiumAiCost(meter.totals, backend.pricing);
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
              },
              response_ids: verified.responseId ? [verified.responseId] : [],
              automatic_classification: "not_applicable",
              automatic_summary: "",
              automatic_reasons: [],
              error_code: "",
              error_message: "",
            },
          });
          await patchPremiumBill({
            config: backend,
            billId: bill.id,
            fetchImpl,
            values: {
              processing_status: "completed",
              red_verification_state: state,
              red_verification_result: verification,
              red_verification_run_id: run.id,
              red_verified_at: completedAt,
              updated_at: completedAt,
            },
          });
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
        const values = {
          ...premiumBillValuesFromAnalysis(normalized, screening, run.id, completedAt),
          ...resetRedVerificationValues(),
        };
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
