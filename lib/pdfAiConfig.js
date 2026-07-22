export const PDF_AI_FOUNDATION_VERSION = "8.0.0";
export const PDF_AI_MODES = Object.freeze(["off", "shadow", "fallback"]);

const DEFAULTS = Object.freeze({
  maxPages: 4,
  maxBytes: 8 * 1024 * 1024,
  timeoutMs: 12_000,
  reserveMs: 3_000,
});

function compact(value, maxLength = 160) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(minimum, Math.min(maximum, safe));
}

function validateFilenamePattern(source) {
  const pattern = compact(source, 300);
  if (!pattern) return { pattern: null, error: null };
  try {
    new RegExp(pattern, "i");
    return { pattern, error: null };
  } catch {
    return { pattern: null, error: "invalid_filename_pattern" };
  }
}

export function hasExplicitPdfAiConsent(value) {
  const current = Array.isArray(value) ? value[0] : value;
  if (current === true) return true;
  return /^(?:1|true|yes|on|si|sì)$/i.test(String(current ?? "").trim());
}

export function pdfAiConfig(env = process.env) {
  const requestedMode = compact(env.PDF_AI_MODE, 30).toLowerCase();
  const mode = PDF_AI_MODES.includes(requestedMode) ? requestedMode : "off";
  const model = compact(env.PDF_AI_MODEL, 120) || null;
  const filename = validateFilenamePattern(env.PDF_AI_FILENAME_PATTERN);
  const configErrors = [];

  if (requestedMode && !PDF_AI_MODES.includes(requestedMode)) configErrors.push("invalid_mode");
  if (filename.error) configErrors.push(filename.error);

  return Object.freeze({
    version: PDF_AI_FOUNDATION_VERSION,
    mode,
    enabled: mode !== "off",
    model,
    requires_consent: true,
    max_pages: boundedInteger(env.PDF_AI_MAX_PAGES, DEFAULTS.maxPages, 1, 8),
    max_bytes: boundedInteger(env.PDF_AI_MAX_BYTES, DEFAULTS.maxBytes, 1_000_000, 15_000_000),
    timeout_ms: boundedInteger(env.PDF_AI_TIMEOUT_MS, DEFAULTS.timeoutMs, 2_500, 20_000),
    reserve_ms: boundedInteger(env.PDF_AI_RESERVE_MS, DEFAULTS.reserveMs, 2_000, 10_000),
    filename_pattern: filename.pattern,
    config_errors: Object.freeze(configErrors),
  });
}
