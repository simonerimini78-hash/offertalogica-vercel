export const PDF_AI_VISUAL_RECOVERY_VERSION = "v106.8.8.1-safe-consensus-recovery-1";

const ITALIAN_CF_PATTERN = /^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/;
const ITALIAN_VAT_PATTERN = /^\d{11}$/;
const CF_POSITION_MASK = "LLLLLLDDLDDLDDDL";

const ODD_CF_VALUES = Object.freeze({
  0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21,
  K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14,
  U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
});

const LETTER_TO_NUMBER = Object.freeze({
  A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9,
  K: 10, L: 11, M: 12, N: 13, O: 14, P: 15, Q: 16, R: 17,
  S: 18, T: 19, U: 20, V: 21, W: 22, X: 23, Y: 24, Z: 25,
});

const OCR_TO_LETTER = Object.freeze({
  "0": ["O", "D", "Q"],
  "1": ["I", "L"],
  "2": ["Z"],
  "5": ["S"],
  "6": ["G"],
  "8": ["B"],
});

const OCR_TO_DIGIT = Object.freeze({
  O: ["0"], D: ["0"], Q: ["0"],
  I: ["1"], L: ["1"],
  Z: ["2"], S: ["5"], G: ["6"], B: ["8"],
});

const EXPLICIT_TAX_LABEL = /(?:codice\s+fiscale|c\.?\s*f\.?|p\.?\s*iva|partita\s+iva|vat(?:\s+id)?)/i;
const EXPLICIT_POD_LABEL = /(?:\bpod\b|punto\s+di\s+prelievo)/i;
const EXPLICIT_PDR_LABEL = /(?:\bpdr\b|punto\s+di\s+riconsegna)/i;
const EXPLICIT_ANNUAL_LABEL = /(?:consum[oi]\s+annu[oi]|consumo\s+annuale|ultimi\s+12\s+mesi|rolling\s*12|annual\s+consumption)/i;
const BILLED_PERIOD_LABEL = /(?:consum[oi]\s+(?:totale\s+)?fatturat[oi]|consumo\s+(?:del|nel)\s+periodo|periodo\s+fatturato)/i;
const CONSENSUS_WARNING = "cross_pass_visual_consensus";
const FOCUSED_WARNING = "focused_visual_recovery";

function compact(value, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeAlnum(value) {
  return compact(value, 180).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function candidateRawValue(candidate) {
  return candidate?.normalized_value ?? candidate?.value_text ?? candidate?.value_number;
}

function candidateContext(candidate) {
  return `${candidate?.unit || candidate?.normalized_unit || ""} ${candidate?.label || ""} ${candidate?.evidence || ""}`;
}

function candidateWarnings(candidate) {
  return Array.isArray(candidate?.warnings) ? candidate.warnings : [];
}

export function isValidItalianFiscalCode(value) {
  const normalized = normalizeAlnum(value);
  if (!ITALIAN_CF_PATTERN.test(normalized)) return false;
  let total = 0;
  for (let index = 0; index < 15; index += 1) {
    const char = normalized[index];
    if ((index + 1) % 2 === 1) total += ODD_CF_VALUES[char];
    else if (/\d/.test(char)) total += Number(char);
    else total += LETTER_TO_NUMBER[char];
  }
  return String.fromCharCode(65 + (total % 26)) === normalized[15];
}

export function isValidItalianVatNumber(value) {
  const normalized = normalizeAlnum(value);
  if (!ITALIAN_VAT_PATTERN.test(normalized)) return false;
  let total = 0;
  for (let index = 0; index < 10; index += 1) {
    let digit = Number(normalized[index]);
    if ((index + 1) % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    total += digit;
  }
  return (10 - (total % 10)) % 10 === Number(normalized[10]);
}

export function isValidItalianTaxId(value) {
  const normalized = normalizeAlnum(value);
  return isValidItalianFiscalCode(normalized) || isValidItalianVatNumber(normalized);
}

function normalizedLetters(value) {
  return String(value || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z]+/g, "");
}

function surnameCode(value) {
  const source = normalizedLetters(value);
  const consonants = source.replace(/[AEIOU]/g, "");
  const vowels = source.replace(/[^AEIOU]/g, "");
  return `${consonants}${vowels}XXX`.slice(0, 3);
}

function givenNameCode(value) {
  const source = normalizedLetters(value);
  const consonants = source.replace(/[AEIOU]/g, "");
  const vowels = source.replace(/[^AEIOU]/g, "");
  if (consonants.length >= 4) return `${consonants[0]}${consonants[2]}${consonants[3]}`;
  return `${consonants}${vowels}XXX`.slice(0, 3);
}

export function italianTaxIdNameCodes(holder) {
  const tokens = String(holder || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^A-Z]+/)
    .filter(Boolean);
  if (tokens.length < 2) return [];

  const possibilities = [];
  possibilities.push(`${surnameCode(tokens[tokens.length - 1])}${givenNameCode(tokens.slice(0, -1).join(""))}`);
  possibilities.push(`${surnameCode(tokens[0])}${givenNameCode(tokens.slice(1).join(""))}`);
  return unique(possibilities);
}

function positionOptions(char, expectedType) {
  const normalized = String(char || "").toUpperCase();
  const values = [normalized];
  if (expectedType === "L") values.push(...(OCR_TO_LETTER[normalized] || []));
  else values.push(...(OCR_TO_DIGIT[normalized] || []));
  return unique(values);
}

function candidateBases(source) {
  if (source.length === 16) return [{ value: source, deletions: 0 }];
  if (source.length !== 17) return [];
  return Array.from({ length: source.length }, (_, index) => ({
    value: `${source.slice(0, index)}${source.slice(index + 1)}`,
    deletions: 1,
  }));
}

function enumeratePatternCandidates(base, limit = 800) {
  const output = [];
  const walk = (index, text, substitutions) => {
    if (output.length >= limit) return;
    if (index === CF_POSITION_MASK.length) {
      output.push({ value: text, substitutions });
      return;
    }
    for (const option of positionOptions(base[index], CF_POSITION_MASK[index])) {
      walk(index + 1, `${text}${option}`, substitutions + (option === base[index] ? 0 : 1));
    }
  };
  walk(0, "", 0);
  return output;
}

export function recoverItalianFiscalCode(value, holder = "") {
  const source = normalizeAlnum(value);
  if (isValidItalianFiscalCode(source)) return source;
  const expectedNameCodes = italianTaxIdNameCodes(holder);
  const possible = [];

  for (const base of candidateBases(source)) {
    for (const candidate of enumeratePatternCandidates(base.value)) {
      if (!ITALIAN_CF_PATTERN.test(candidate.value)) continue;
      if (!isValidItalianFiscalCode(candidate.value)) continue;
      if (expectedNameCodes.length && !expectedNameCodes.includes(candidate.value.slice(0, 6))) continue;
      const edits = base.deletions + candidate.substitutions;
      if (edits > 2) continue;
      possible.push({ value: candidate.value, edits });
    }
  }

  const byValue = new Map();
  possible.forEach((candidate) => {
    const previous = byValue.get(candidate.value);
    if (!previous || candidate.edits < previous.edits) byValue.set(candidate.value, candidate);
  });
  const ordered = [...byValue.values()].sort((left, right) => left.edits - right.edits || left.value.localeCompare(right.value));
  if (!ordered.length) return null;
  const bestScore = ordered[0].edits;
  const best = ordered.filter((candidate) => candidate.edits === bestScore);
  return best.length === 1 ? best[0].value : null;
}

export function recoverItalianTaxIdCandidate({ candidate, holder = "" } = {}) {
  if (!candidate) return null;
  const context = candidateContext(candidate);
  if (!EXPLICIT_TAX_LABEL.test(context)) return null;
  const normalized = normalizeAlnum(candidateRawValue(candidate));
  if (!normalized || isValidItalianTaxId(normalized)) return null;
  const recovered = recoverItalianFiscalCode(normalized, holder);
  if (!recovered) return null;
  return {
    value: recovered,
    original_value: normalized,
    confidence: Math.min(93, Math.max(90, Number(candidate.confidence || 0))),
    page: Number(candidate.page || 1),
    label: candidate.label || "Codice fiscale",
    evidence: compact(`${candidate.evidence || context}; recupero controllato da caratteri OCR ambigui, checksum e coerenza con intestatario`, 360),
    commodity: candidate.commodity || "unknown",
    source_version: candidate.source_version || "unknown",
    method: "controlled_italian_tax_id_ocr_recovery",
    warnings: unique([...(candidate.warnings || []), "recovered_from_ocr_ambiguity", "requires_explicit_user_confirmation"]),
  };
}

function normalizedPod(value) {
  const source = normalizeAlnum(value);
  return /^IT\d{3}E[A-Z0-9]{8}$/.test(source) ? source : null;
}

function normalizedPdr(value) {
  const source = normalizeAlnum(value).replace(/\D/g, "");
  return /^\d{14}$/.test(source) ? source : null;
}

function normalizedIdentifier(field, candidate) {
  if (field === "pod") return normalizedPod(candidateRawValue(candidate));
  if (field === "pdr") return normalizedPdr(candidateRawValue(candidate));
  if (field === "codice_fiscale") {
    const value = normalizeAlnum(candidateRawValue(candidate));
    return isValidItalianTaxId(value) ? value : null;
  }
  return null;
}

function hasExplicitIdentifierLabel(field, candidate) {
  const context = candidateContext(candidate);
  if (field === "pod") return EXPLICIT_POD_LABEL.test(context);
  if (field === "pdr") return EXPLICIT_PDR_LABEL.test(context);
  if (field === "codice_fiscale") return EXPLICIT_TAX_LABEL.test(context);
  return false;
}

export function prepareSafeAiVisualCandidates(ai = {}) {
  const candidates = Array.isArray(ai.candidates) ? ai.candidates : [];
  for (const field of ["pod", "pdr", "codice_fiscale"]) {
    const groups = new Map();
    for (const candidate of candidates.filter((item) => item?.field === field)) {
      const value = normalizedIdentifier(field, candidate);
      if (!value || !hasExplicitIdentifierLabel(field, candidate)) continue;
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(candidate);
    }
    for (const entries of groups.values()) {
      const hasFocused = entries.some((candidate) => candidateWarnings(candidate).includes(FOCUSED_WARNING));
      const hasPrimary = entries.some((candidate) => !candidateWarnings(candidate).includes(FOCUSED_WARNING));
      if (!hasFocused || !hasPrimary) continue;
      for (const candidate of entries) {
        candidate.confidence = Math.max(94, Number(candidate.confidence || 0));
        candidate.warnings = unique([...candidateWarnings(candidate), CONSENSUS_WARNING, "requires_explicit_user_confirmation"]);
      }
    }
  }
  return ai;
}

function explicitAnnualConsumptionThreshold(candidate) {
  const field = String(candidate?.field || "");
  if (!["consumo_luce_kwh", "consumo_gas_smc"].includes(field)) return null;
  if (candidate?.semantic_role !== "actual_customer_value") return null;
  const context = candidateContext(candidate);
  if (!EXPLICIT_ANNUAL_LABEL.test(context) || BILLED_PERIOD_LABEL.test(context)) return null;
  const unit = String(candidate?.unit || candidate?.normalized_unit || "");
  if (field === "consumo_luce_kwh" && !/kwh/i.test(unit)) return null;
  if (field === "consumo_gas_smc" && !/(?:smc|std\.?\s*m3|standard\s*m3)/i.test(unit)) return null;
  return 90;
}

export function safeVisualFieldThreshold(candidate) {
  const field = String(candidate?.field || "");
  const context = candidateContext(candidate);
  const raw = candidateRawValue(candidate);
  const warnings = candidateWarnings(candidate);

  if (field === "codice_fiscale" && EXPLICIT_TAX_LABEL.test(context) && isValidItalianTaxId(raw)) return 90;
  if (field === "pod" && EXPLICIT_POD_LABEL.test(context) && normalizedPod(raw) && warnings.includes(CONSENSUS_WARNING)) return 90;
  if (field === "pdr" && EXPLICIT_PDR_LABEL.test(context) && normalizedPdr(raw) && warnings.includes(CONSENSUS_WARNING)) return 90;
  return explicitAnnualConsumptionThreshold(candidate);
}

// Compatibilità con il nome introdotto dallo Step 8.8.8 iniziale.
export function explicitVisualIdentifierThreshold(candidate) {
  return safeVisualFieldThreshold(candidate);
}

export const PDF_AI_FOCUSED_RECOVERY_FIELDS = Object.freeze([
  "codice_fiscale", "pod", "pdr",
  "consumo_luce_kwh", "consumo_gas_smc",
  "prezzo_luce_eur_kwh", "prezzo_gas_eur_smc",
  "quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno",
  "tipo_prezzo_luce", "tipo_prezzo_gas",
  "indice_riferimento_luce", "indice_riferimento_gas",
  "spread_luce_eur_kwh", "spread_gas_eur_smc",
  "formula_prezzo_luce", "formula_prezzo_gas",
  "codice_offerta_luce", "codice_offerta_gas",
  "scadenza_condizioni_economiche_luce", "scadenza_condizioni_economiche_gas",
]);
