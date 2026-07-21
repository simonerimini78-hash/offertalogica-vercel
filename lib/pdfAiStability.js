export const PDF_AI_STABILITY_VERSION = "v106.8.8.3-general-stability-1";

const ELECTRICITY_FIELDS = Object.freeze({
  pod: 5,
  consumo_luce_kwh: 3,
  potenza_impegnata_kw: 3,
  potenza_disponibile_kw: 2,
  nome_offerta_luce: 1,
  codice_offerta_luce: 1,
  codice_prodotto_fornitore_luce: 1,
  tipo_prezzo_luce: 1,
  indice_riferimento_luce: 1,
  spread_luce_eur_kwh: 1,
  formula_prezzo_luce: 1,
  indirizzo_fornitura_luce: 1,
});

const GAS_FIELDS = Object.freeze({
  pdr: 5,
  consumo_gas_smc: 3,
  nome_offerta_gas: 1,
  codice_offerta_gas: 1,
  codice_prodotto_fornitore_gas: 1,
  tipo_prezzo_gas: 1,
  indice_riferimento_gas: 1,
  spread_gas_eur_smc: 1,
  formula_prezzo_gas: 1,
  indirizzo_fornitura_gas: 1,
});

function compact(value, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function hasValue(value) {
  if (value === null || value === undefined || value === "" || value === "unknown") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function candidateValue(candidate) {
  return candidate?.normalized_value ?? candidate?.value_text ?? candidate?.value_number ?? candidate?.value ?? null;
}

function normalizeIdentifier(field, value) {
  const source = compact(value, 160).toUpperCase();
  if (field === "pod") {
    const normalized = source.replace(/[\s.-]/g, "");
    return /^IT\d{3}E[A-Z0-9]{8}$/.test(normalized) ? normalized : null;
  }
  if (field === "pdr") {
    const normalized = source.replace(/\D/g, "");
    return /^\d{14}$/.test(normalized) ? normalized : null;
  }
  return null;
}

export function isAverageBillPriceLabel(context) {
  return /\b(?:(?:prezzo|costo|spesa)\s+(?:medio|media)(?:\s+unitari[oa])?|(?:prezzo|costo)\s+unitari[oa]\s+medio|average\s+(?:unit\s+cost|price))\b/i
    .test(compact(context, 800));
}

function scoreMappedFields(merged, selectedFields, weights) {
  let score = 0;
  for (const [field, weight] of Object.entries(weights)) {
    const present = hasValue(merged?.[field]) || selectedFields.has(field);
    if (!present) continue;
    score += weight;
  }
  return score;
}

function selectedFieldSet(selected = []) {
  return new Set((selected || []).map((item) => String(item?.field || "")).filter(Boolean));
}

function validSelectedIdentifier(selected, field) {
  return (selected || []).some((item) => item?.field === field && normalizeIdentifier(field, item?.value ?? candidateValue(item)));
}

function pageMapScores(pageMap = []) {
  let electricity = 0;
  let gas = 0;
  for (const page of pageMap || []) {
    const role = compact(page?.role, 160);
    const summary = compact(page?.summary, 500);
    const text = `${role} ${summary}`;
    if (/\b(?:electricity|energia\s+elettrica|luce)\b/i.test(text)) electricity += 2;
    if (/\bgas(?:\s+naturale)?\b/i.test(text)) gas += 2;
  }
  return { electricity: Math.min(electricity, 4), gas: Math.min(gas, 4) };
}

export function inferCommodityFromEvidence({ merged = {}, selected = [], ai = {} } = {}) {
  const fields = selectedFieldSet(selected);
  let electricity = scoreMappedFields(merged, fields, ELECTRICITY_FIELDS);
  let gas = scoreMappedFields(merged, fields, GAS_FIELDS);

  if (normalizeIdentifier("pod", merged.pod) || validSelectedIdentifier(selected, "pod")) electricity = Math.max(electricity, 5);
  if (normalizeIdentifier("pdr", merged.pdr) || validSelectedIdentifier(selected, "pdr")) gas = Math.max(gas, 5);

  let aiElectricity = 0;
  let aiGas = 0;
  for (const candidate of ai?.candidates || []) {
    if (!Number(candidate?.page || 0) || compact(candidate?.evidence, 500).length < 6) continue;
    const field = String(candidate?.field || "");
    if (Object.hasOwn(ELECTRICITY_FIELDS, field)) aiElectricity += 1;
    if (Object.hasOwn(GAS_FIELDS, field)) aiGas += 1;
  }
  electricity += Math.min(aiElectricity, 3);
  gas += Math.min(aiGas, 3);

  const pageScores = pageMapScores(ai?.page_map || []);
  electricity += pageScores.electricity;
  gas += pageScores.gas;

  const current = ["luce", "gas", "dual"].includes(merged?.commodity) ? merged.commodity : null;
  if (current === "dual" && electricity >= 3 && gas >= 3) return "dual";
  if (electricity >= 3 && gas >= 3) return "dual";
  if (electricity >= 4 && gas < 2) return "luce";
  if (gas >= 4 && electricity < 2) return "gas";
  if (current === "luce" && electricity >= 2 && gas < 3) return "luce";
  if (current === "gas" && gas >= 2 && electricity < 3) return "gas";
  return null;
}

function focusedCandidateKey(candidate) {
  const field = compact(candidate?.field, 120).toLowerCase();
  const value = compact(candidateValue(candidate), 300).toUpperCase().replace(/\s+/g, "");
  const unit = compact(candidate?.unit || candidate?.normalized_unit, 80).toLowerCase();
  const role = compact(candidate?.semantic_role, 80).toLowerCase();
  const page = Number(candidate?.page || 0) || 0;
  return `${field}|${value}|${unit}|${role}|${page}`;
}

function mergeUniqueObjects(primary = [], secondary = []) {
  const seen = new Set();
  const output = [];
  for (const item of [...primary, ...secondary]) {
    const key = JSON.stringify(item || {});
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

export function mergeFocusedVisualResults(primary = {}, recovery = {}, missingFields = []) {
  const primaryCandidates = Array.isArray(primary.candidates) ? primary.candidates : [];
  const seen = new Set(primaryCandidates.map(focusedCandidateKey));
  const focusedCandidates = [];

  for (const candidate of recovery.candidates || []) {
    const key = focusedCandidateKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    focusedCandidates.push({
      ...candidate,
      warnings: unique([...(candidate.warnings || []), "focused_visual_recovery"]),
    });
  }

  return {
    ...primary,
    candidates: [...primaryCandidates, ...focusedCandidates],
    conflicts: mergeUniqueObjects(primary.conflicts || [], recovery.conflicts || []),
    review_reasons: unique([...(primary.review_reasons || []), ...(recovery.review_reasons || [])]),
    attempts: Number(primary.attempts || 1) + 1,
    request_profile: "full+focused",
    focused_recovery: {
      attempted: true,
      status: "completed",
      missing_fields: [...missingFields],
      candidate_count: focusedCandidates.length,
      raw_candidate_count: (recovery.candidates || []).length,
      response_id: recovery.response_id || null,
      timeout_ms: recovery.timeout_ms || null,
      non_blocking: true,
      primary_preserved: true,
    },
  };
}

export function focusedRecoveryBudget({
  deadlineAt = 0,
  now = Date.now(),
  configuredMs = 6_500,
  reserveMs = 3_000,
  allowWithoutDeadline = false,
} = {}) {
  const configured = Math.min(7_000, Math.max(2_500, Number(configuredMs) || 6_500));
  const reserve = Math.min(10_000, Math.max(2_000, Number(reserveMs) || 3_000));
  const deadline = Number(deadlineAt || 0);

  if (!deadline && !allowWithoutDeadline) {
    return { attempt: false, status: "no_deadline_budget", timeout_ms: null, remaining_ms: null, reserve_ms: reserve };
  }

  const remaining = deadline ? deadline - Number(now) - reserve : configured;
  if (!Number.isFinite(remaining) || remaining < 2_500) {
    return { attempt: false, status: "insufficient_time_budget", timeout_ms: null, remaining_ms: remaining, reserve_ms: reserve };
  }

  return {
    attempt: true,
    status: "ready",
    timeout_ms: Math.min(configured, remaining),
    remaining_ms: remaining,
    reserve_ms: reserve,
  };
}

export function withFocusedRecoveryStatus(primary = {}, metadata = {}, incrementAttempts = false) {
  return {
    ...primary,
    attempts: Number(primary.attempts || 1) + (incrementAttempts ? 1 : 0),
    focused_recovery: {
      attempted: false,
      non_blocking: true,
      primary_preserved: true,
      ...metadata,
    },
  };
}
