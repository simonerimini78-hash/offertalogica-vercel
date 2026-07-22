import { pdfAiConfig } from "./pdfAiConfig.js";
import { shouldAttemptPdfAi } from "./pdfAiPolicy.js";
import { runPdfAiReview } from "./pdfAiClient.js";
import { buildPdfAiReviewPlan } from "./pdfAiMerge.js";

export const PDF_AI_SHADOW_VERSION = "8.4.2";

function compact(value, maxLength = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function clonePrivate(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // Fallback JSON below for plain normalized data.
    }
  }
  return JSON.parse(JSON.stringify(value ?? {}));
}

function byteLength(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.byteLength;
  return null;
}

function safePolicy(decision = {}, config = {}) {
  return {
    attempt: Boolean(decision.attempt),
    reason: compact(decision.reason, 120) || "unknown",
    mode: compact(decision.mode || config.mode, 30) || "off",
    model: compact(decision.model || config.model, 120) || null,
    timeout_ms: Number.isFinite(Number(decision.timeout_ms)) ? Number(decision.timeout_ms) : null,
    remaining_ms: Number.isFinite(Number(decision.remaining_ms)) ? Number(decision.remaining_ms) : null,
    gaps: Array.isArray(decision.gaps) ? decision.gaps.map((gap) => compact(gap, 80)).filter(Boolean) : [],
  };
}

function safeClient(result = {}) {
  return {
    ok: Boolean(result.ok),
    status: compact(result.status, 40) || (result.ok ? "completed" : "error"),
    provider: compact(result.provider, 80) || null,
    model: compact(result.model, 120) || null,
    client_version: compact(result.client_version, 40) || null,
    elapsed_ms: Number.isFinite(Number(result.elapsed_ms)) ? Number(result.elapsed_ms) : null,
    response_id: compact(result.response_id, 160) || null,
    request_id: compact(result.request_id, 160) || null,
    usage: result.usage && typeof result.usage === "object" ? {
      input_tokens: Number.isFinite(Number(result.usage.input_tokens)) ? Number(result.usage.input_tokens) : null,
      output_tokens: Number.isFinite(Number(result.usage.output_tokens)) ? Number(result.usage.output_tokens) : null,
      total_tokens: Number.isFinite(Number(result.usage.total_tokens)) ? Number(result.usage.total_tokens) : null,
    } : null,
    error: result.error && typeof result.error === "object" ? {
      code: compact(result.error.code, 120) || "unknown_error",
      retryable: Boolean(result.error.retryable),
      http_status: Number.isInteger(result.error.http_status) ? result.error.http_status : null,
      provider_code: compact(result.error.provider_code, 120) || null,
    } : null,
  };
}

function baseResult({ config, policy, status, reason, attempted = false, diagnostics = {}, observation = null }) {
  return {
    shadow_version: PDF_AI_SHADOW_VERSION,
    mode: compact(config?.mode, 30) || "off",
    attempted,
    status,
    reason,
    review_only: true,
    public_output_unchanged: true,
    diagnostics: {
      policy: safePolicy(policy, config),
      ...diagnostics,
    },
    observation,
  };
}

/**
 * Runs a private, review-only visual observation.
 *
 * This module intentionally does not receive a public result setter and does not
 * import the public API endpoint. The caller may archive the returned sidecar,
 * but must never merge it into the public output automatically.
 */
export async function runPdfAiShadowObservation({
  normalized = {},
  pdfBuffer,
  loadPdfBuffer,
  filename = "documento.pdf",
  fileSizeBytes,
  pageCount,
  deterministicExhausted = false,
  deadlineAt,
  now = Date.now(),
  env,
  config = pdfAiConfig(env),
  apiKey = process.env.OPENAI_API_KEY,
  transport = globalThis.fetch,
  policyRunner = shouldAttemptPdfAi,
  reviewRunner = runPdfAiReview,
  planBuilder = buildPdfAiReviewPlan,
} = {}) {
  const privateNormalized = clonePrivate(normalized ?? {});
  const resolvedBytes = Number.isFinite(Number(fileSizeBytes))
    ? Number(fileSizeBytes)
    : byteLength(pdfBuffer);
  const resolvedPages = Number.isInteger(Number(pageCount))
    ? Number(pageCount)
    : Number(privateNormalized?.page_count);

  let decision;
  try {
    decision = policyRunner({
      normalized: privateNormalized,
      config,
      deterministicExhausted,
      filename,
      fileSizeBytes: resolvedBytes,
      pageCount: resolvedPages,
      deadlineAt,
      now,
    });
  } catch {
    return baseResult({
      config,
      policy: { attempt: false, reason: "policy_error", mode: config?.mode, model: config?.model },
      status: "error",
      reason: "policy_error",
    });
  }

  if (config.mode !== "shadow") {
    const reason = decision?.attempt ? "shadow_mode_required" : (decision?.reason || "shadow_mode_required");
    return baseResult({ config, policy: decision, status: "skipped", reason });
  }

  if (!decision?.attempt) {
    return baseResult({
      config,
      policy: decision,
      status: "skipped",
      reason: compact(decision?.reason, 120) || "policy_denied",
    });
  }

  let selectedPdfBuffer = pdfBuffer;
  if (!selectedPdfBuffer && typeof loadPdfBuffer === "function") {
    try {
      selectedPdfBuffer = await loadPdfBuffer();
    } catch {
      return baseResult({
        config,
        policy: decision,
        attempted: true,
        status: "error",
        reason: "pdf_read_error",
        diagnostics: {
          client: safeClient({ ok: false, status: "error", error: { code: "pdf_read_error", retryable: false } }),
        },
      });
    }
  }

  let clientResult;
  try {
    clientResult = await reviewRunner({
      pdfBuffer: selectedPdfBuffer,
      filename,
      model: decision.model || config.model,
      pageCount: resolvedPages,
      gaps: decision.gaps,
      apiKey,
      timeoutMs: decision.timeout_ms,
      transport,
    });
  } catch {
    return baseResult({
      config,
      policy: decision,
      attempted: true,
      status: "error",
      reason: "review_runner_error",
      diagnostics: {
        client: safeClient({ ok: false, status: "error", error: { code: "review_runner_error", retryable: false } }),
      },
    });
  }

  const clientDiagnostics = safeClient(clientResult);
  if (!clientResult?.ok || !clientResult?.output) {
    return baseResult({
      config,
      policy: decision,
      attempted: true,
      status: clientResult?.status === "timeout" ? "timeout" : "error",
      reason: compact(clientResult?.error?.code, 120) || "review_failed",
      diagnostics: { client: clientDiagnostics },
    });
  }

  let reviewPlan;
  try {
    reviewPlan = planBuilder({
      normalized: clonePrivate(privateNormalized),
      aiOutput: clonePrivate(clientResult.output),
      model: clientResult.model || decision.model || config.model,
    });
  } catch {
    return baseResult({
      config,
      policy: decision,
      attempted: true,
      status: "error",
      reason: "review_plan_error",
      diagnostics: { client: clientDiagnostics },
    });
  }

  return baseResult({
    config,
    policy: decision,
    attempted: true,
    status: "observed",
    reason: "shadow_observation_completed",
    diagnostics: { client: clientDiagnostics },
    observation: {
      document: clonePrivate(clientResult.output.document),
      candidates: clonePrivate(clientResult.output.candidates),
      review_reasons: clonePrivate(clientResult.output.review_reasons),
      review_plan: clonePrivate(reviewPlan),
    },
  });
}
