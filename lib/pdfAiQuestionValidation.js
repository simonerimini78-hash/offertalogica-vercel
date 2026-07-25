export const PDF_AI_QUESTION_VALIDATION_VERSION = "step8-question-validation-v1";

function compact(value, maxLength = 520) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function comparable(value) {
  return compact(value, 600)
    .toLocaleLowerCase("it-IT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`*]/g, "")
    .replace(/[«»“”\"()\[\]{}:;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseItalianNumber(value) {
  let source = compact(value, 140)
    .replace(/[€$£]/g, "")
    .replace(/\s/g, "")
    .replace(/[^0-9,.-]/g, "");
  if (!source) return null;
  const negative = source.startsWith("-");
  source = source.replace(/-/g, "");
  const comma = source.lastIndexOf(",");
  const dot = source.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    if (comma > dot) source = source.replace(/\./g, "").replace(",", ".");
    else source = source.replace(/,/g, "");
  } else if (comma >= 0) {
    source = source.replace(/\./g, "").replace(",", ".");
  } else if ((source.match(/\./g) || []).length > 1) {
    source = source.replace(/\./g, "");
  } else if (dot >= 0) {
    const decimals = source.length - dot - 1;
    if (decimals === 3 && /^\d{1,3}\.\d{3}$/.test(source)) source = source.replace(".", "");
  }
  const parsed = Number(source);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

function includesComparable(haystack, needle) {
  const left = comparable(haystack);
  const right = comparable(needle);
  return Boolean(left && right && left.includes(right));
}

function matchesAny(value, accepted = []) {
  const actual = comparable(value);
  if (!actual) return false;
  return accepted.some((entry) => {
    const expected = comparable(entry);
    return Boolean(expected && (actual === expected || actual.includes(expected) || expected.includes(actual)));
  });
}

function normalizeClassification(question, value) {
  const source = comparable(value).replace(/\s/g, "_");
  if (question.field === "kind") {
    if (source.includes("scheda") && source.includes("offerta")) return "scheda_offerta";
    if (source.includes("bolletta") || source.includes("fattura")) return "bolletta";
    return "unknown";
  }
  if (question.field === "commodity") {
    const hasLuce = /(?:luce|elettric|energia_elettrica)/.test(source);
    const hasGas = /(?:^|_)gas(?:_|$)|gas_naturale/.test(source);
    if (source === "dual" || (hasLuce && hasGas)) return "dual";
    if (hasLuce) return "luce";
    if (hasGas) return "gas";
    return "unknown";
  }
  if (question.field === "customer_type") {
    if (/(?:privato|domestico|persona_fisica)/.test(source)) return "privato";
    if (/(?:business|azienda|impresa|professionista|partita_iva)/.test(source)) return "business";
    return "unknown";
  }
  return source || "unknown";
}

function normalizedUnit(question, unitLiteral) {
  if (question.field === "consumo_luce_kwh") return "kWh/anno";
  if (question.field === "consumo_gas_smc") return "Smc/anno";
  if (question.field === "potenza_impegnata_kw") return "kW";
  if (["prezzo_luce_eur_kwh", "spread_luce_eur_kwh"].includes(question.field)) return "EUR/kWh";
  if (["prezzo_gas_eur_smc", "spread_gas_eur_smc"].includes(question.field)) return "EUR/Smc";
  if (question.field === "quota_fissa_vendita_luce_eur_anno") return "EUR/POD/anno";
  if (question.field === "quota_fissa_vendita_gas_eur_anno") return "EUR/PDR/anno";
  return compact(unitLiteral, 80) || null;
}

function normalizePriceType(value) {
  const source = comparable(value);
  if (/\bvariabil/.test(source)) return "variabile";
  if (/\bfiss/.test(source)) return "fisso";
  return null;
}

function normalizeIdentifier(field, value) {
  const raw = compact(value, 220);
  if (field === "pod") {
    const normalized = raw.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    return /^IT[A-Z0-9]{12,20}$/.test(normalized) ? normalized : null;
  }
  if (field === "pdr") {
    const normalized = raw.replace(/\D/g, "");
    return /^\d{14}$/.test(normalized) ? normalized : null;
  }
  if (field === "codice_fiscale") {
    const normalized = raw.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    return /^(?:[A-Z0-9]{11}|[A-Z0-9]{16})$/.test(normalized) ? normalized : null;
  }
  if (field.startsWith("codice_")) {
    const normalized = raw.replace(/\s/g, "");
    return /^[A-Z0-9._/-]{4,80}$/i.test(normalized) ? normalized : null;
  }
  return raw || null;
}

function unitMatches(question, unitLiteral) {
  if (!question.unitPatterns?.length) return true;
  const unit = comparable(unitLiteral);
  return question.unitPatterns.some((pattern) => unit.includes(comparable(pattern)));
}

function fixedFeeValue(question, numberValue, unitLiteral) {
  const unit = comparable(unitLiteral);
  const monthly = /(?:mese|mensil|month)/.test(unit);
  const annual = /(?:anno|annual|year|pod anno|pdr anno)/.test(unit);
  if (!monthly && !annual) return null;
  const normalizedValue = monthly ? Number((numberValue * 12).toFixed(8)) : numberValue;
  return {
    normalizedValue,
    derivation: monthly
      ? {
        type: "monthly_to_annual",
        original_value: numberValue,
        original_unit: compact(unitLiteral, 80),
        factor: 12,
        derived_value: normalizedValue,
      }
      : null,
  };
}

export function singleQuestionOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "found", "label_literal", "value_literal", "unit_literal", "page",
      "evidence_literal", "confidence", "not_found_reason",
    ],
    properties: {
      found: { type: "boolean" },
      label_literal: { type: ["string", "null"], maxLength: 220 },
      value_literal: { type: ["string", "null"], maxLength: 260 },
      unit_literal: { type: ["string", "null"], maxLength: 100 },
      page: { type: ["integer", "null"], minimum: 1, maximum: 100 },
      evidence_literal: { type: ["string", "null"], maxLength: 560 },
      confidence: { type: "integer", minimum: 0, maximum: 100 },
      not_found_reason: { type: ["string", "null"], maxLength: 220 },
    },
  };
}

export function validateQuestionAnswer(question, rawAnswer, { pageCount = 0 } = {}) {
  const answer = {
    found: Boolean(rawAnswer?.found),
    label_literal: compact(rawAnswer?.label_literal, 220) || null,
    value_literal: compact(rawAnswer?.value_literal, 260) || null,
    unit_literal: compact(rawAnswer?.unit_literal, 100) || null,
    page: Number(rawAnswer?.page || 0) || null,
    evidence_literal: compact(rawAnswer?.evidence_literal, 560) || null,
    confidence: Math.max(0, Math.min(100, Number(rawAnswer?.confidence || 0))),
    not_found_reason: compact(rawAnswer?.not_found_reason, 220) || null,
  };

  if (!answer.found) {
    return {
      accepted: false,
      status: "not_found",
      reason: answer.not_found_reason || "not_found",
      answer,
    };
  }

  if (question.valueType === "classification") {
    const normalizedValue = normalizeClassification(question, answer.value_literal);
    if (!question.allowedValues?.includes(normalizedValue) || normalizedValue === "unknown") {
      return { accepted: false, status: "not_found", reason: "classification_unknown", answer };
    }
    return {
      accepted: true,
      status: "accepted",
      field: question.field,
      normalizedValue,
      rawValue: answer.value_literal,
      unit: null,
      page: answer.page || 1,
      label: answer.label_literal || question.question,
      evidence: answer.evidence_literal || `Classificazione: ${normalizedValue}`,
      confidence: answer.confidence,
      derivation: null,
      answer,
    };
  }

  if (!answer.label_literal || !answer.value_literal || !answer.page || !answer.evidence_literal) {
    return { accepted: false, status: "rejected", reason: "incomplete_literal_answer", answer };
  }
  if (pageCount && answer.page > pageCount) {
    return { accepted: false, status: "rejected", reason: "page_out_of_range", answer };
  }
  if (question.acceptedLabels?.length && !matchesAny(answer.label_literal, question.acceptedLabels)) {
    return { accepted: false, status: "rejected", reason: "label_not_allowed", answer };
  }
  if (!includesComparable(answer.evidence_literal, answer.label_literal)
    || !includesComparable(answer.evidence_literal, answer.value_literal)) {
    return { accepted: false, status: "rejected", reason: "evidence_not_literal", answer };
  }
  if (question.acceptedSections?.length) {
    const evidence = comparable(answer.evidence_literal);
    const sectionFound = question.acceptedSections.some((section) => evidence.includes(comparable(section)));
    if (!sectionFound) {
      return { accepted: false, status: "rejected", reason: "section_not_confirmed", answer };
    }
  }

  let normalizedValue;
  let derivation = null;
  if (["number", "fixed_fee"].includes(question.valueType)) {
    const numberValue = parseItalianNumber(answer.value_literal);
    if (!Number.isFinite(numberValue) || numberValue <= 0) {
      return { accepted: false, status: "rejected", reason: "number_invalid", answer };
    }
    if (Number.isFinite(question.min) && numberValue < question.min) {
      return { accepted: false, status: "rejected", reason: "number_below_range", answer };
    }
    if (Number.isFinite(question.max) && numberValue > question.max) {
      return { accepted: false, status: "rejected", reason: "number_above_range", answer };
    }
    if (!answer.unit_literal || !unitMatches(question, answer.unit_literal)) {
      return { accepted: false, status: "rejected", reason: "unit_invalid", answer };
    }
    if (question.valueType === "fixed_fee") {
      const fixed = fixedFeeValue(question, numberValue, answer.unit_literal);
      if (!fixed) return { accepted: false, status: "rejected", reason: "fixed_period_missing", answer };
      normalizedValue = fixed.normalizedValue;
      derivation = fixed.derivation;
    } else {
      normalizedValue = numberValue;
    }
  } else if (question.valueType === "price_type") {
    normalizedValue = normalizePriceType(answer.value_literal);
    if (!normalizedValue) return { accepted: false, status: "rejected", reason: "price_type_invalid", answer };
  } else if (["pod", "pdr", "tax_id", "identifier"].includes(question.valueType)) {
    normalizedValue = normalizeIdentifier(question.field, answer.value_literal);
    if (!normalizedValue) return { accepted: false, status: "rejected", reason: "identifier_invalid", answer };
  } else {
    normalizedValue = compact(answer.value_literal, 260) || null;
    if (!normalizedValue) return { accepted: false, status: "rejected", reason: "text_empty", answer };
  }

  return {
    accepted: true,
    status: "accepted",
    field: question.field,
    normalizedValue,
    rawValue: answer.value_literal,
    unit: normalizedUnit(question, answer.unit_literal),
    page: answer.page,
    label: answer.label_literal,
    evidence: answer.evidence_literal,
    confidence: answer.confidence,
    derivation,
    answer,
  };
}

export function questionAnswerNeedsRetry(result) {
  return [
    "incomplete_literal_answer",
    "label_not_allowed",
    "evidence_not_literal",
    "section_not_confirmed",
    "number_invalid",
    "unit_invalid",
    "identifier_invalid",
    "fixed_period_missing",
  ].includes(result?.reason);
}
