import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { json, method, readJson, requireAllowedOrigin } from "../lib/http.js";
import { normalizePdfFileHeader } from "../lib/pdfFileValidation.js";
import { extractPdfPureAi } from "../lib/pdfPureAiReader.js";
import { enforceRateLimit } from "../lib/rateLimit.js";
import {
  analysisCompletionStatus,
  assertPremiumAiConfigured,
  createMeteredOpenAiTransport,
  createPremiumAnalysisRun,
  createUsageMeter,
  downloadPremiumBill,
  estimatePremiumAiCost,
  insertPremiumAiCostEvent,
  loadPremiumCheckAndBill,
  patchPremiumAnalysisRun,
  patchPremiumBill,
  premiumAiConfig,
  publicPremiumAiError,
  readBearerToken,
  sanitizePremiumAnalysisData,
  verifyPremiumStaff,
} from "../lib/premiumAiBackend.js";

export const config = { maxDuration: 60 };

export function createPremiumAiAnalysisHandler({
  env = process.env,
  fetchImpl = fetch,
  analyzePdf = extractPdfPureAi,
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
    let temporaryFilePath = "";

    try {
      assertPremiumAiConfigured(backend);
      const accessToken = readBearerToken(req);
      const { user } = await verifyPremiumStaff({ config: backend, accessToken, fetchImpl });
      if (!(await enforceRateLimit(req, res, {
        label: "premium-ai-analysis",
        identifier: user.id,
        limit: Number(env.RATE_LIMIT_PREMIUM_AI_LIMIT || 12),
        windowSeconds: Number(env.RATE_LIMIT_PREMIUM_AI_WINDOW_SECONDS || 3600),
      }))) return;

      const body = await readJson(req);
      ({ check, bill } = await loadPremiumCheckAndBill({ config: backend, checkId: body.checkId, fetchImpl }));
      run = await createPremiumAnalysisRun({ config: backend, check, bill, staffUserId: user.id, fetchImpl });

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
      const completion = analysisCompletionStatus(normalized);
      const durationMs = Math.max(0, now() - startedAt);
      const estimatedCostEur = estimatePremiumAiCost(meter.totals, backend.pricing);
      const extractedData = sanitizePremiumAnalysisData(normalized, meter.totals);
      const warnings = [...new Set([
        ...(Array.isArray(normalized?.warnings) ? normalized.warnings : []),
        ...completion.missing.map(field => `campo_essenziale_mancante:${field}`),
        "bozza_ia_da_verificare_dallo_staff",
      ])];

      await patchPremiumAnalysisRun({
        config: backend,
        runId: run.id,
        fetchImpl,
        values: {
          status: completion.status,
          parser_version: normalized?.parser_version || "premium-ai-assisted-v0.28",
          model: normalized?.ai?.model || backend.model,
          completed_at: new Date().toISOString(),
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
          error_code: "",
          error_message: "",
        },
      });
      await patchPremiumBill({
        config: backend,
        billId: bill.id,
        fetchImpl,
        values: { processing_status: "ready_for_review", updated_at: new Date().toISOString() },
      });
      await insertPremiumAiCostEvent({
        config: backend,
        bill,
        check,
        run,
        usage: meter.totals,
        estimatedCostEur,
        model: normalized?.ai?.model || backend.model,
        fetchImpl,
      });

      return json(res, 200, {
        ok: true,
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
          extractedData,
          warnings,
        },
      });
    } catch (error) {
      if (run?.id) {
        const durationMs = Math.max(0, now() - startedAt);
        await patchPremiumAnalysisRun({
          config: backend,
          runId: run.id,
          fetchImpl,
          values: {
            status: "failed",
            completed_at: new Date().toISOString(),
            duration_ms: durationMs,
            error_code: String(error?.message || "premium_ai_error").split(":")[0].slice(0, 120),
            error_message: String(error?.message || "Analisi IA non riuscita").slice(0, 500),
          },
        }).catch(() => {});
      }
      if (bill?.id) {
        await patchPremiumBill({
          config: backend,
          billId: bill.id,
          fetchImpl,
          values: { processing_status: "ready_for_review", updated_at: new Date().toISOString() },
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
