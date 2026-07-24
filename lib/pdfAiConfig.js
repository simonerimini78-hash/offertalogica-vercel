export const PDF_AI_CONFIG_VERSION = "step8-clean-budget-v1";
export const PDF_AI_PRIMARY_MODEL = "gpt-4.1-mini-2025-04-14";
export const PDF_AI_CRITICAL_MODEL = "gpt-4.1-2025-04-14";

function integerSetting(value, fallback, { min, max }) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  const resolved = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, resolved));
}

function booleanSetting(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return /^(?:1|true|yes|on)$/i.test(String(value).trim());
}

export function pdfAiConfig(env = process.env) {
  const requestedMode = String(env.PDF_AI_MODE || "off").trim().toLowerCase();
  return {
    version: PDF_AI_CONFIG_VERSION,
    mode: ["off", "shadow", "fallback"].includes(requestedMode) ? requestedMode : "off",
    disabled: booleanSetting(env.PDF_AI_DISABLED, false),
    filenamePattern: String(env.PDF_AI_FILENAME_PATTERN || "").trim(),
    model: String(env.PDF_AI_MODEL || PDF_AI_PRIMARY_MODEL).trim(),
    criticalModel: String(
      env.PDF_AI_CRITICAL_MODEL
      || env.PDF_AI_ESCALATION_MODEL
      || PDF_AI_CRITICAL_MODEL,
    ).trim(),
    totalBudgetMs: integerSetting(env.PDF_ANALYSIS_DEADLINE_MS, 55_000, { min: 24_000, max: 55_000 }),
    responseMarginMs: integerSetting(env.PDF_AI_RESPONSE_MARGIN_MS, 4_000, { min: 2_500, max: 8_000 }),
    generalPhaseMs: integerSetting(env.PDF_AI_GENERAL_PHASE_MS, 24_000, { min: 8_000, max: 30_000 }),
    criticalPhaseMs: integerSetting(env.PDF_AI_CRITICAL_PHASE_MS, 22_000, { min: 8_000, max: 28_000 }),
    standardPdfMs: integerSetting(env.PDF_AI_STANDARD_TIMEOUT_MS, 30_000, { min: 8_000, max: 42_000 }),
  };
}

export function filenameAllowedByPdfAi(filename, patternSource) {
  const source = String(patternSource || "").trim();
  if (!source) return true;
  try {
    return new RegExp(source, "i").test(String(filename || ""));
  } catch {
    return false;
  }
}

export function createPdfAiBudgetPlan({
  deadlineAt = null,
  now = Date.now(),
  raster = false,
  env = process.env,
} = {}) {
  const config = pdfAiConfig(env);
  const deadlineBudget = deadlineAt
    ? Math.max(0, Number(deadlineAt) - Number(now))
    : config.totalBudgetMs;
  const availableMs = Math.min(config.totalBudgetMs, deadlineBudget);
  const responseMarginMs = Math.min(
    config.responseMarginMs,
    Math.max(2_500, Math.floor(availableMs * 0.14)),
  );
  const workMs = Math.max(0, availableMs - responseMarginMs);

  if (!raster) {
    const standardTimeoutMs = Math.min(config.standardPdfMs, workMs);
    return {
      configVersion: config.version,
      mode: config.mode,
      totalBudgetMs: availableMs,
      responseMarginMs,
      standardTimeoutMs,
      sufficient: standardTimeoutMs >= 8_000,
    };
  }

  const requestedWorkMs = config.generalPhaseMs + config.criticalPhaseMs;
  const scale = requestedWorkMs > 0 ? Math.min(1, workMs / requestedWorkMs) : 0;
  const generalPhaseMs = Math.floor(config.generalPhaseMs * scale);
  const criticalPhaseMs = Math.floor(config.criticalPhaseMs * scale);
  return {
    configVersion: config.version,
    mode: config.mode,
    totalBudgetMs: availableMs,
    responseMarginMs,
    generalPhaseMs,
    criticalPhaseMs,
    generalRequestTimeoutMs: Math.max(0, generalPhaseMs - 750),
    criticalRequestTimeoutMs: Math.max(0, criticalPhaseMs - 750),
    sufficient: generalPhaseMs >= 8_000 && criticalPhaseMs >= 8_000,
  };
}
