import { pdfAiConfig } from "./pdfAiConfig.js";

export const PDF_AI_POLICY_VERSION = "8.4.1";

function missing(value) {
  return value === null || value === undefined || value === "" || value === "unknown";
}

function filenameAllowed(filename, patternSource) {
  if (!patternSource) return true;
  try {
    return new RegExp(patternSource, "i").test(String(filename || ""));
  } catch {
    return false;
  }
}

export function pdfAiIdentityGaps(normalized = {}) {
  const gaps = [];
  for (const field of ["fornitore", "kind", "commodity"]) {
    if (missing(normalized[field])) gaps.push(field);
  }

  if (normalized.commodity === "luce" && missing(normalized.pod)) gaps.push("pod");
  else if (normalized.commodity === "gas" && missing(normalized.pdr)) gaps.push("pdr");
  else if (normalized.commodity === "dual") {
    if (missing(normalized.pod)) gaps.push("pod");
    if (missing(normalized.pdr)) gaps.push("pdr");
  } else if (missing(normalized.pod) && missing(normalized.pdr)) {
    gaps.push("supply_identifier");
  }

  return [...new Set(gaps)];
}

export function pdfAiTimeBudget({ config = pdfAiConfig({}), deadlineAt, now = Date.now() } = {}) {
  const deadline = Number(deadlineAt || 0);
  if (!Number.isFinite(deadline) || deadline <= Number(now)) {
    return { available: false, reason: "deadline_required", remaining_ms: null, timeout_ms: null };
  }

  const remaining = deadline - Number(now) - Number(config.reserve_ms || 0);
  const timeout = Math.min(Number(config.timeout_ms || 0), remaining);
  if (!Number.isFinite(timeout) || timeout < 2_500) {
    return {
      available: false,
      reason: "insufficient_time_budget",
      remaining_ms: remaining,
      timeout_ms: null,
    };
  }

  return {
    available: true,
    reason: "budget_available",
    remaining_ms: remaining,
    timeout_ms: timeout,
  };
}

function denied(reason, config, extra = {}) {
  return {
    attempt: false,
    reason,
    mode: config.mode,
    model: config.model,
    timeout_ms: null,
    gaps: [],
    ...extra,
  };
}

export function shouldAttemptPdfAi({
  normalized = {},
  env,
  config = pdfAiConfig(env),
  deterministicExhausted = false,
  filename = "documento.pdf",
  fileSizeBytes,
  pageCount = normalized.page_count,
  deadlineAt,
  now = Date.now(),
} = {}) {
  if (config.mode === "off") return denied("disabled", config);
  if (config.config_errors?.length) return denied("invalid_configuration", config, { config_errors: [...config.config_errors] });
  if (!config.model) return denied("missing_model", config);
  if (!filenameAllowed(filename, config.filename_pattern)) return denied("filename_not_allowed", config);

  const bytes = Number(fileSizeBytes);
  if (!Number.isFinite(bytes) || bytes <= 0) return denied("file_size_unknown", config);
  if (bytes > config.max_bytes) return denied("file_too_large", config, { file_size_bytes: bytes });

  const pages = Number(pageCount);
  if (!Number.isInteger(pages) || pages < 1) return denied("page_count_unknown", config);
  if (pages > config.max_pages) return denied("too_many_pages", config, { page_count: pages });

  const budget = pdfAiTimeBudget({ config, deadlineAt, now });
  if (!budget.available) return denied(budget.reason, config, budget);

  const gaps = pdfAiIdentityGaps(normalized);
  if (config.mode === "fallback") {
    if (!deterministicExhausted) return denied("deterministic_pipeline_not_exhausted", config, { gaps });
    if (!gaps.length) return denied("deterministic_identity_complete", config, { gaps });
  }

  return {
    attempt: true,
    reason: config.mode === "shadow" ? "shadow_observation" : "identity_recovery_needed",
    mode: config.mode,
    model: config.model,
    timeout_ms: budget.timeout_ms,
    remaining_ms: budget.remaining_ms,
    gaps,
    max_pages: config.max_pages,
    max_bytes: config.max_bytes,
  };
}
