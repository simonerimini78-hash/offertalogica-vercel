const CONSUMPTION_FIELD_UNITS = Object.freeze({
  consumo_luce_kwh: "kwh",
  consumo_gas_smc: "smc",
  consumo_gas_mc: "mc",
});

export const CONSUMPTION_FIELDS = Object.freeze(Object.keys(CONSUMPTION_FIELD_UNITS));

const TARGET_ROLES = new Set([
  "consumo_annuo_12_mesi",
  "consumo_annuo_dichiarato",
  "consumo_anno_solare_completo",
  "consumo_annuo_stimato",
]);

const COMPLETE_PERIOD_ROLES = new Set([
  "consumo_annuo_12_mesi",
  "consumo_anno_solare_completo",
]);

const ROLE_PRIORITY = Object.freeze({
  consumo_annuo_12_mesi: 120,
  consumo_anno_solare_completo: 115,
  consumo_annuo_dichiarato: 105,
  consumo_annuo_stimato: 90,
  consumo_progressivo_anno_corrente: 70,
  consumo_da_inizio_fornitura: 60,
  consumo_fatturato_periodo: 55,
  consumo_mensile: 45,
  consumo_fascia: 35,
  lettura_contatore: 20,
  totale_non_classificato: 10,
  non_classificato: 0,
});

const SOURCE_RANK = Object.freeze({ native: 3, ocr: 2, ai: 1 });
const STRENGTH_RANK = Object.freeze({ strong: 4, medium: 3, weak: 2, none: 0 });

function normalizeMinus(value) {
  return String(value ?? "").replace(/[−–—]/g, "-");
}

function numberFromItalian(value) {
  const raw = normalizeMinus(value).trim().replace(/[\u00a0\s']/g, "");
  if (!raw || !/[0-9]/.test(raw)) return null;
  let normalized = raw;
  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  } else if (comma >= 0) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (dot >= 0) {
    const unsigned = raw.replace(/^[+-]/, "");
    const parts = unsigned.split(".");
    const thousands = parts.length > 1 && parts.slice(1).every((part) => /^\d{3}$/.test(part));
    if (thousands && !/^0\./.test(unsigned)) normalized = raw.replace(/\./g, "");
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function numericEquivalent(left, right) {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const tolerance = Math.max(0.00001, Math.abs(a) * 0.002);
  return Math.abs(a - b) <= tolerance;
}

function digitSignature(value) {
  return String(value ?? "").replace(/\D/g, "").replace(/^0+/, "") || "0";
}

function compactNumericEquivalent(observation, canonicalValue) {
  if (observation?.number_format !== "ambiguous_compact") return false;
  const canonicalItalian = Number(canonicalValue).toFixed(2).replace(".", "");
  return digitSignature(observation.raw_value) === digitSignature(canonicalItalian);
}

function normalizeUnit(rawUnit, source) {
  const value = String(rawUnit || "").toLowerCase().replace(/[^a-z]/g, "");
  if (value === "kwh") return { unit: "kwh", exact: true, raw: rawUnit };
  if (value === "smc") return { unit: "smc", exact: true, raw: rawUnit };
  if (value === "mc") return { unit: "mc", exact: true, raw: rawUnit };
  if (source === "ocr" && ["sme", "sinc", "snnc"].includes(value)) {
    return { unit: "smc", exact: false, raw: rawUnit };
  }
  return null;
}

function fieldForUnit(unit) {
  return Object.entries(CONSUMPTION_FIELD_UNITS).find(([, expected]) => expected === unit)?.[0] || null;
}

function plausibleConsumption(field, value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return false;
  if (field === "consumo_luce_kwh") return numeric <= 1_000_000_000;
  if (field === "consumo_gas_smc") return numeric <= 100_000_000;
  if (field === "consumo_gas_mc") return numeric <= 100_000_000;
  return false;
}

function parseDate(value) {
  const match = String(value || "").match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/);
  if (!match) return null;
  const timestamp = Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  return Number.isFinite(timestamp) ? { raw: match[0], timestamp } : null;
}

function parseLocalDateRange(text) {
  const dates = [...String(text || "").matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g)]
    .map((match) => parseDate(match[0]))
    .filter(Boolean);
  if (dates.length < 2) return null;
  for (let index = 0; index < dates.length - 1; index += 1) {
    const first = dates[index];
    const second = dates[index + 1];
    const ordered = first.timestamp <= second.timestamp ? [first, second] : [second, first];
    const days = (ordered[1].timestamp - ordered[0].timestamp) / 86_400_000;
    if (days >= 0 && days <= 800) {
      return {
        from: ordered[0].raw,
        to: ordered[1].raw,
        from_ts: ordered[0].timestamp,
        to_ts: ordered[1].timestamp,
        days: Math.round(days),
      };
    }
  }
  return null;
}

function periodIsCompleteAnnual(period) {
  return Boolean(period && period.days >= 330 && period.days <= 400);
}

function periodKey(period) {
  if (!period) return "no-period";
  return `${period.from_ts || period.from}-${period.to_ts || period.to}`;
}

function periodsEqual(left, right) {
  if (!left || !right) return false;
  return Math.abs(Number(left.from_ts) - Number(right.from_ts)) <= 86_400_000
    && Math.abs(Number(left.to_ts) - Number(right.to_ts)) <= 86_400_000;
}

function snippetAround(text, start, end) {
  const source = String(text || "");
  const from = Math.max(0, start - 220);
  const to = Math.min(source.length, end + 120);
  return source.slice(from, to).replace(/\s+/g, " ").trim().slice(0, 520);
}

function lineWindow(text, start, end) {
  const source = String(text || "");
  const lineStart = Math.max(source.lastIndexOf("\n", start - 1) + 1, start - 280, 0);
  const nextNewline = source.indexOf("\n", end);
  const lineEnd = Math.min(nextNewline >= 0 ? nextNewline : source.length, end + 180);
  return { start: lineStart, end: lineEnd, text: source.slice(lineStart, lineEnd) };
}

function markerMatches(prefix) {
  const definitions = [
    {
      role: "consumo_progressivo_anno_corrente",
      priority: 160,
      pattern: /consumo\s+progressivo\s+annuo(?:\s+da\s+gennaio|\s+dall['’]?inizio\s+dell['’]?anno)?|progressivo\s+(?:annuo|anno\s+corrente)|year\s*to\s*date/gi,
    },
    {
      role: "consumo_da_inizio_fornitura",
      priority: 150,
      pattern: /(?:consumo\s+)?da\s+inizio\s+fornitura|dall['’]?attivazione\s+della\s+fornitura/gi,
    },
    {
      role: "consumo_fatturato_periodo",
      priority: 145,
      pattern: /consum[oi]\s+(?:totale\s+)?fatturat[oi]|consumi\s+fatturati|(?:di\s+cui\s+)?effettiv[oi]|quota\s+per\s+consumi|consumo\s+del\s+periodo/gi,
    },
    {
      role: "consumo_mensile",
      priority: 140,
      pattern: /consumo\s+(?:del\s+)?mese|consumo\s+mensile/gi,
    },
    {
      role: "consumo_annuo_stimato",
      priority: 135,
      pattern: /consumo\s+(?:annuo|annuale)[^\n]{0,45}(?:stimato|presunto|previsionale)|stima\s+annua\s+dei\s+consumi/gi,
    },
    {
      role: "consumo_annuo_12_mesi",
      priority: 130,
      pattern: /[cç]?onsumo\s+(?:annuo|annuale)(?:\s+aggiornato)?|ultimi\s+12\s+mesi|periodo\s+(?:di|degli)\s+12\s+mesi|365\s+giorni|in\s+un\s+anno\s+hai\s+consumato/gi,
    },
    {
      role: "consumo_anno_solare_completo",
      priority: 125,
      pattern: /consumo\s+(?:anno\s+solare|nell['’]?anno)\s+20\d{2}/gi,
    },
    {
      role: "lettura_contatore",
      priority: 80,
      pattern: /lettura(?:\s+del)?\s+contatore|autolettura|matricola\s+contatore/gi,
    },
  ];

  const matches = [];
  for (const definition of definitions) {
    for (const match of String(prefix || "").matchAll(definition.pattern)) {
      matches.push({
        role: definition.role,
        priority: definition.priority,
        marker: match[0],
        start: match.index || 0,
        end: (match.index || 0) + match[0].length,
      });
    }
  }
  return matches;
}

function classifyRole(text, matchStart, matchEnd) {
  const source = String(text || "");
  const window = lineWindow(source, matchStart, matchEnd);
  const prefix = source.slice(window.start, matchStart);
  const directPrefix = source.slice(Math.max(window.start, matchStart - 70), matchStart);

  if (/(?:^|\s)(?:ea\s*)?f[123]\s*[:=]?\s*$/i.test(directPrefix)) {
    return { role: "consumo_fascia", marker: directPrefix.trim(), period: null, local_context: window.text };
  }

  const markers = markerMatches(prefix)
    .map((item) => ({ ...item, distance: prefix.length - item.end }))
    .filter((item) => item.distance <= 220)
    .sort((a, b) => a.distance - b.distance || b.priority - a.priority);

  const selected = markers[0] || null;
  if (selected) {
    const markerAbsoluteStart = window.start + selected.start;
    const semanticBlock = source.slice(markerAbsoluteStart, Math.min(source.length, matchEnd + 40));
    const period = parseLocalDateRange(semanticBlock);
    let role = selected.role;

    if (role === "consumo_annuo_12_mesi" && !periodIsCompleteAnnual(period)) {
      role = /ultimi\s+12\s+mesi|365\s+giorni|in\s+un\s+anno/i.test(selected.marker)
        ? "consumo_annuo_12_mesi"
        : "consumo_annuo_dichiarato";
    }
    if (role === "consumo_anno_solare_completo" && !period) {
      const year = selected.marker.match(/20\d{2}/)?.[0];
      if (year) {
        const from = `01/01/${year}`;
        const to = `31/12/${year}`;
        const fromDate = parseDate(from);
        const toDate = parseDate(to);
        role = "consumo_anno_solare_completo";
        return {
          role,
          marker: selected.marker,
          period: {
            from,
            to,
            from_ts: fromDate?.timestamp || null,
            to_ts: toDate?.timestamp || null,
            days: 364,
          },
          local_context: semanticBlock,
        };
      }
    }

    return { role, marker: selected.marker, period, local_context: semanticBlock };
  }

  if (/(?:totale|tot)\s*[:=]?\s*$/i.test(directPrefix)) {
    return { role: "totale_non_classificato", marker: directPrefix.trim(), period: null, local_context: window.text };
  }
  return { role: "non_classificato", marker: "", period: null, local_context: window.text };
}

function numberFormat(rawValue, source) {
  const raw = String(rawValue || "").replace(/\s/g, "");
  if (source === "ocr" && /^\d{5,9}$/.test(raw)) return "ambiguous_compact";
  if (/[.,]/.test(raw)) return "explicit_separator";
  return "plain_integer";
}

function strengthForObservation({ role, unitExact, source, period, format }) {
  if (!TARGET_ROLES.has(role)) return "none";
  if (format === "ambiguous_compact") return "weak";
  if (!unitExact) return "weak";
  if (role === "consumo_annuo_stimato") return source === "ai" ? "weak" : "medium";
  if (COMPLETE_PERIOD_ROLES.has(role) && periodIsCompleteAnnual(period)) return "strong";
  if (role === "consumo_annuo_dichiarato") return source === "ai" ? "medium" : "strong";
  return "medium";
}

function confidenceForSource(source, sourceConfidence) {
  if (Number.isFinite(sourceConfidence)) return Math.max(0, Math.min(1, sourceConfidence));
  if (source === "native") return 0.98;
  if (source === "ocr") return 0.78;
  if (source === "ai") return 0.9;
  return 0.5;
}

function exclusionReason(observation) {
  if (!plausibleConsumption(observation.field, observation.value)) return "implausible_consumption_value";
  if (observation.number_format === "ambiguous_compact") return "ocr_number_format_corrupted";
  const reasons = {
    consumo_progressivo_anno_corrente: "year_to_date_not_complete_annual_consumption",
    consumo_da_inizio_fornitura: "since_supply_start_not_rolling_annual",
    consumo_fatturato_periodo: "billing_period_not_annual_consumption",
    consumo_mensile: "monthly_not_annual_consumption",
    consumo_fascia: "tariff_band_not_total_annual_consumption",
    lettura_contatore: "meter_reading_not_consumption",
    totale_non_classificato: "unclassified_total_not_annual_consumption",
    non_classificato: "not_semantically_classified_as_annual",
  };
  return reasons[observation.role] || "not_eligible_for_annual_consumption";
}

export function collectConsumptionObservations(pageTexts = [], {
  source = "native",
  pageConfidences = {},
} = {}) {
  const observations = [];
  const numberToken = "([0-9]{1,3}(?:[.\\s][0-9]{3})+(?:,[0-9]+)?|[0-9]+(?:[.,][0-9]+)?)";
  const unitToken = source === "ocr" ? "(kwh|smc|mc|sme|sinc|snnc)" : "(kwh|smc|mc)";
  const pattern = new RegExp(`(?<![A-Za-z0-9])${numberToken}\\s*${unitToken}\\b`, "gi");

  for (let index = 0; index < pageTexts.length; index += 1) {
    const text = String(pageTexts[index] || "");
    if (!text) continue;

    const labelUnitPattern = new RegExp(
      `(?:consumo\\s+(?:annuo|annuale)(?:\\s+aggiornato)?)\\s*\\(\\s*(kwh|smc|mc)\\s*\\)\\s*[:：]?\\s*${numberToken}`,
      "gi",
    );
    for (const match of text.matchAll(labelUnitPattern)) {
      const unitInfo = normalizeUnit(match[1], source);
      const rawValue = match[2];
      const value = numberFromItalian(rawValue);
      const field = unitInfo ? fieldForUnit(unitInfo.unit) : null;
      if (!field || value === null) continue;
      const start = match.index || 0;
      const end = start + match[0].length;
      const period = parseLocalDateRange(match[0]);
      const role = periodIsCompleteAnnual(period) ? "consumo_annuo_12_mesi" : "consumo_annuo_dichiarato";
      const format = numberFormat(rawValue, source);
      observations.push({
        field,
        value,
        raw_value: rawValue,
        raw_unit: match[1],
        number_format: format,
        unit: unitInfo.unit,
        unit_exact: unitInfo.exact,
        role,
        role_priority: ROLE_PRIORITY[role],
        strength: strengthForObservation({ role, unitExact: unitInfo.exact, source, period, format }),
        source,
        page: index + 1,
        evidence: snippetAround(text, start, end),
        local_context: match[0],
        marker: match[0].slice(0, Math.max(0, match[0].indexOf(rawValue))).trim(),
        period,
        confidence: confidenceForSource(source, Number(pageConfidences[index + 1])),
        grounded: source !== "ai",
        grounded_by: source !== "ai" ? [source] : [],
      });
    }

    for (const match of text.matchAll(pattern)) {
      const rawValue = match[1];
      const value = numberFromItalian(rawValue);
      const unitInfo = normalizeUnit(match[2], source);
      if (value === null || !unitInfo) continue;
      const field = fieldForUnit(unitInfo.unit);
      if (!field) continue;
      const start = match.index || 0;
      const end = start + match[0].length;
      const classification = classifyRole(text, start, end);
      const format = numberFormat(rawValue, source);
      observations.push({
        field,
        value,
        raw_value: rawValue,
        raw_unit: match[2],
        number_format: format,
        unit: unitInfo.unit,
        unit_exact: unitInfo.exact,
        role: classification.role,
        role_priority: ROLE_PRIORITY[classification.role] || 0,
        strength: strengthForObservation({
          role: classification.role,
          unitExact: unitInfo.exact,
          source,
          period: classification.period,
          format,
        }),
        source,
        page: index + 1,
        evidence: snippetAround(text, start, end),
        local_context: classification.local_context,
        marker: classification.marker,
        period: classification.period,
        confidence: confidenceForSource(source, Number(pageConfidences[index + 1])),
        grounded: source !== "ai",
        grounded_by: source !== "ai" ? [source] : [],
      });
    }
  }
  return dedupeObservations(observations);
}

function dedupeObservations(observations = []) {
  const result = [];
  for (const observation of observations) {
    const duplicate = result.find((item) => item.field === observation.field
      && item.source === observation.source
      && item.page === observation.page
      && item.role === observation.role
      && numericEquivalent(item.value, observation.value)
      && periodKey(item.period) === periodKey(observation.period));
    if (!duplicate) result.push(observation);
    else if (String(observation.evidence || "").length > String(duplicate.evidence || "").length) {
      Object.assign(duplicate, observation);
    }
  }
  return result;
}

function aiEvidenceByField(aiResult = {}) {
  const result = {};
  for (const item of Array.isArray(aiResult?.evidence) ? aiResult.evidence : []) {
    const field = String(item?.field || "");
    if (!CONSUMPTION_FIELDS.includes(field)) continue;
    const confidence = Number(item?.confidence);
    if (!result[field] || confidence > result[field].confidence) {
      result[field] = {
        page: Number.isInteger(item?.page) && item.page > 0 ? item.page : null,
        quote: String(item?.quote || "").trim(),
        confidence: Number.isFinite(confidence) ? confidence : 0,
      };
    }
  }
  return result;
}

function observationFromAi(field, value, evidence) {
  if (!Number.isFinite(Number(value)) || !evidence?.quote) return null;
  const local = collectConsumptionObservations([evidence.quote], { source: "ai" })
    .filter((item) => item.field === field && numericEquivalent(item.value, value));
  const best = local.sort((a, b) => (ROLE_PRIORITY[b.role] || 0) - (ROLE_PRIORITY[a.role] || 0))[0];
  if (!best) {
    return {
      field,
      value: Number(value),
      raw_value: String(value),
      raw_unit: CONSUMPTION_FIELD_UNITS[field],
      number_format: "ai_value_without_parseable_quote",
      unit: CONSUMPTION_FIELD_UNITS[field],
      unit_exact: false,
      role: "non_classificato",
      role_priority: 0,
      strength: "none",
      source: "ai",
      page: evidence.page,
      evidence: evidence.quote,
      local_context: evidence.quote,
      marker: "",
      period: null,
      confidence: evidence.confidence,
      grounded: false,
      grounded_by: [],
    };
  }
  return {
    ...best,
    page: evidence.page,
    evidence: evidence.quote,
    local_context: evidence.quote,
    confidence: evidence.confidence,
    grounded: false,
    grounded_by: [],
  };
}

function compatibleAnnualRole(left, right) {
  if (!TARGET_ROLES.has(left.role) || !TARGET_ROLES.has(right.role)) return false;
  if (left.role === "consumo_annuo_stimato" || right.role === "consumo_annuo_stimato") {
    return left.role === right.role;
  }
  if (left.period && right.period) return periodsEqual(left.period, right.period);
  return true;
}

function groundAiObservations(aiObservations, directObservations) {
  return aiObservations.map((observation) => {
    const supporting = directObservations.filter((item) => item.field === observation.field
      && numericEquivalent(item.value, observation.value)
      && compatibleAnnualRole(item, observation));
    return {
      ...observation,
      grounded: supporting.length > 0,
      grounded_by: [...new Set(supporting.map((item) => item.source))],
    };
  });
}

function normalizedFallbackObservation(field, normalized, source) {
  const value = Number(normalized?.[field]);
  if (!Number.isFinite(value) || !plausibleConsumption(field, value)) return null;
  const diagnostic = (Array.isArray(normalized?.diagnostics) ? normalized.diagnostics : [])
    .find((item) => item?.field === field);
  const evidence = String(diagnostic?.source_snippet || diagnostic?.source_match || "").trim();
  const parsed = evidence
    ? observationFromAi(field, value, {
      page: diagnostic?.page || null,
      quote: evidence,
      confidence: source === "native" ? 0.98 : 0.75,
    })
    : null;
  if (parsed) {
    return {
      ...parsed,
      source,
      grounded: source !== "ai",
      grounded_by: source !== "ai" ? [source] : [],
    };
  }
  return {
    field,
    value,
    raw_value: String(value),
    raw_unit: CONSUMPTION_FIELD_UNITS[field],
    number_format: "fallback",
    unit: CONSUMPTION_FIELD_UNITS[field],
    unit_exact: false,
    role: "non_classificato",
    role_priority: 0,
    strength: "none",
    source,
    page: diagnostic?.page || null,
    evidence,
    local_context: evidence,
    marker: "",
    period: null,
    confidence: source === "native" ? 0.98 : 0.75,
    grounded: source !== "ai",
    grounded_by: source !== "ai" ? [source] : [],
  };
}

function groupCompatibleObservation(groups, observation) {
  return groups.find((group) => numericEquivalent(group.value, observation.value)
    && group.role_family === roleFamily(observation.role)
    && ((group.period && observation.period && periodsEqual(group.period, observation.period))
      || (!group.period && !observation.period)
      || (!group.period && observation.role === "consumo_annuo_dichiarato")
      || (!observation.period && group.role_family === "annual_declared")));
}

function roleFamily(role) {
  if (COMPLETE_PERIOD_ROLES.has(role)) return "annual_complete";
  if (role === "consumo_annuo_dichiarato") return "annual_declared";
  if (role === "consumo_annuo_stimato") return "annual_estimated";
  return role;
}

function groupAnnualObservations(observations = []) {
  const groups = [];
  for (const observation of observations) {
    let group = groupCompatibleObservation(groups, observation);
    if (!group) {
      group = {
        value: observation.value,
        role_family: roleFamily(observation.role),
        period: observation.period || null,
        observations: [],
        approximate_support: [],
      };
      groups.push(group);
    }
    group.observations.push(observation);
    if (!group.period && observation.period) group.period = observation.period;
  }
  return groups;
}

function attachApproximateOcrSupport(groups, observations) {
  const corrupted = observations.filter((item) => item.source === "ocr"
    && item.number_format === "ambiguous_compact"
    && TARGET_ROLES.has(item.role));
  for (const observation of corrupted) {
    const candidates = groups.filter((group) => compactNumericEquivalent(observation, group.value)
      && (group.period && observation.period ? periodsEqual(group.period, observation.period) : true));
    if (candidates.length === 1) candidates[0].approximate_support.push(observation);
  }
}

function summarizeGroup(group) {
  const sources = [...new Set(group.observations.map((item) => item.source))];
  const directSources = [...new Set(group.observations.filter((item) => item.source !== "ai").map((item) => item.source))];
  const groundedAi = group.observations.some((item) => item.source === "ai" && item.grounded);
  const strong = group.observations.some((item) => item.strength === "strong");
  const medium = group.observations.some((item) => item.strength === "medium");
  const hasNative = directSources.includes("native");
  const hasUsableOcr = group.observations.some((item) => item.source === "ocr"
    && item.number_format !== "ambiguous_compact"
    && ["smc", "kwh", "mc"].includes(item.unit));
  const measured = group.role_family !== "annual_estimated";
  const accepted = measured
    ? (hasNative || (hasUsableOcr && groundedAi))
    : (hasNative && groundedAi);
  const best = [...group.observations].sort((a, b) => {
    return (STRENGTH_RANK[b.strength] || 0) - (STRENGTH_RANK[a.strength] || 0)
      || (SOURCE_RANK[b.source] || 0) - (SOURCE_RANK[a.source] || 0)
      || b.confidence - a.confidence;
  })[0];
  return {
    ...group,
    sources,
    direct_sources: directSources,
    grounded_ai: groundedAi,
    strong,
    medium,
    accepted: Boolean(accepted && (strong || medium)),
    best,
  };
}

function compactObservation(item, reason = null) {
  return {
    value: item.value,
    raw_value: item.raw_value,
    role: item.role,
    source: item.source,
    page: item.page,
    unit: item.unit,
    raw_unit: item.raw_unit,
    unit_exact: item.unit_exact,
    number_format: item.number_format,
    strength: item.strength,
    confidence: item.confidence,
    evidence: item.evidence,
    period: item.period,
    grounded: item.grounded,
    grounded_by: item.grounded_by,
    reason: reason || exclusionReason(item),
  };
}

function latestPeriodGroup(groups) {
  const dated = groups.filter((group) => Number.isFinite(Number(group.period?.to_ts)));
  if (dated.length !== groups.length || !dated.length) return null;
  const ordered = [...dated].sort((a, b) => Number(b.period.to_ts) - Number(a.period.to_ts));
  if (ordered.length > 1 && Number(ordered[0].period.to_ts) === Number(ordered[1].period.to_ts)) return null;
  return ordered[0];
}

function groupSummary(group) {
  return {
    value: group.value,
    sources: group.sources,
    direct_sources: group.direct_sources,
    accepted: group.accepted,
    role_family: group.role_family,
    page: group.best?.page || null,
    period: group.period || null,
    evidence: group.best?.evidence || "",
    approximate_ocr_support: group.approximate_support.map((item) => compactObservation(item, "ocr_approximate_support_only")),
  };
}

function sourceAssessment(sourceAvailability, observations, selected = null) {
  const result = {};
  for (const source of ["parser", "ocr", "ai"]) {
    const observationSource = source === "parser" ? "native" : source;
    const available = sourceAvailability?.[source] || "not_requested";
    const sourceObservations = observations.filter((item) => item.source === observationSource);
    let quality = "none";
    if (sourceObservations.some((item) => item.strength === "strong" && item.number_format !== "ambiguous_compact")) quality = "high";
    else if (sourceObservations.some((item) => item.strength === "medium")) quality = "medium";
    else if (sourceObservations.length) quality = "low";
    let relation = "unavailable";
    if (["completed", "not_required"].includes(available)) relation = "unrelated";
    if (selected && sourceObservations.some((item) => numericEquivalent(item.value, selected.value)
      && compatibleAnnualRole(item, selected.best || item))) relation = "supports";
    else if (selected && sourceObservations.some((item) => compactNumericEquivalent(item, selected.value)
      && compatibleAnnualRole(item, selected.best || item))) relation = "supports_approximate";
    else if (selected && sourceObservations.some((item) => TARGET_ROLES.has(item.role)
      && item.number_format !== "ambiguous_compact"
      && compatibleAnnualRole(item, selected.best || item)
      && !numericEquivalent(item.value, selected.value))) relation = "contradicts";
    result[source] = { availability: available, quality, relation };
  }
  return result;
}

function selectDecision(field, selected, groups, excluded, observations, sourceAvailability, rule) {
  return {
    field,
    contract: "complete_annual_consumption",
    status: "found",
    value: selected.value,
    decision_rule: rule,
    selected_candidate: {
      value: selected.value,
      sources: selected.sources,
      direct_sources: selected.direct_sources,
      page: selected.best?.page || null,
      role: selected.best?.role || null,
      role_family: selected.role_family,
      period: selected.period || selected.best?.period || null,
      evidence: selected.best?.evidence || "",
      approximate_ocr_support: selected.approximate_support.map((item) => compactObservation(item, "ocr_approximate_support_only")),
    },
    excluded_candidates: excluded,
    competing_annual_candidates: groups.filter((group) => group !== selected).map(groupSummary),
    source_availability: sourceAvailability,
    source_assessment: sourceAssessment(sourceAvailability, observations, selected),
  };
}

function arbitrateField(field, observations, sourceAvailability) {
  const fieldObservations = observations.filter((item) => item.field === field);
  const eligible = fieldObservations.filter((item) => TARGET_ROLES.has(item.role)
    && plausibleConsumption(item.field, item.value)
    && item.number_format !== "ambiguous_compact");
  const excludedObservations = fieldObservations.filter((item) => !eligible.includes(item));
  const groups = groupAnnualObservations(eligible);
  attachApproximateOcrSupport(groups, fieldObservations);
  const summarized = groups.map(summarizeGroup);
  const credible = summarized.filter((group) => group.accepted);
  const excluded = excludedObservations.map((item) => compactObservation(item));

  const measuredCredible = credible.filter((group) => group.role_family !== "annual_estimated");
  const considered = measuredCredible.length ? measuredCredible : credible;

  if (considered.length === 1) {
    const selected = considered[0];
    const rule = selected.direct_sources.includes("native")
      ? "complete_annual_native_evidence"
      : "complete_annual_ocr_ai_agreement";
    return selectDecision(field, selected, summarized, excluded, fieldObservations, sourceAvailability, rule);
  }

  if (considered.length > 1) {
    const completeGroups = considered.filter((group) => group.role_family === "annual_complete");
    const samePeriodConflict = completeGroups.some((group, index) => completeGroups
      .slice(index + 1)
      .some((other) => periodsEqual(group.period, other.period) && !numericEquivalent(group.value, other.value)));

    if (!samePeriodConflict) {
      const latest = latestPeriodGroup(completeGroups.length === considered.length ? completeGroups : []);
      if (latest) {
        return selectDecision(
          field,
          latest,
          summarized,
          excluded,
          fieldObservations,
          sourceAvailability,
          "latest_complete_annual_period",
        );
      }
    }

    return {
      field,
      contract: "complete_annual_consumption",
      status: "review",
      value: null,
      candidate_value: null,
      decision_rule: samePeriodConflict
        ? "conflicting_complete_annual_evidence_same_period"
        : "ambiguous_multiple_complete_annual_periods",
      selected_candidate: null,
      excluded_candidates: excluded,
      competing_annual_candidates: considered.map(groupSummary),
      source_availability: sourceAvailability,
      source_assessment: sourceAssessment(sourceAvailability, fieldObservations, null),
    };
  }

  const bestUnconfirmed = summarized.sort((a, b) => Number(b.strong) - Number(a.strong)
    || b.sources.length - a.sources.length
    || (b.best?.confidence || 0) - (a.best?.confidence || 0))[0];
  return {
    field,
    contract: "complete_annual_consumption",
    status: bestUnconfirmed ? "review" : "missing",
    value: null,
    candidate_value: bestUnconfirmed?.value ?? null,
    decision_rule: bestUnconfirmed ? "annual_candidate_not_independently_grounded" : "no_annual_candidate",
    selected_candidate: bestUnconfirmed ? {
      value: bestUnconfirmed.value,
      sources: bestUnconfirmed.sources,
      page: bestUnconfirmed.best?.page || null,
      role: bestUnconfirmed.best?.role || null,
      role_family: bestUnconfirmed.role_family,
      period: bestUnconfirmed.period || null,
      evidence: bestUnconfirmed.best?.evidence || "",
    } : null,
    excluded_candidates: excluded,
    competing_annual_candidates: summarized.map(groupSummary),
    source_availability: sourceAvailability,
    source_assessment: sourceAssessment(sourceAvailability, fieldObservations, bestUnconfirmed || null),
  };
}

export function arbitrateConsumptionEvidence({
  nativeNormalized = {},
  ocrNormalized = {},
  aiResult = {},
  nativePageTexts = [],
  ocrPageTexts = [],
  ocrPageConfidences = {},
  sourceAvailability = {},
} = {}) {
  const nativeObservations = collectConsumptionObservations(nativePageTexts, { source: "native" });
  const ocrObservations = collectConsumptionObservations(ocrPageTexts, { source: "ocr", pageConfidences: ocrPageConfidences });
  const directObservations = [...nativeObservations, ...ocrObservations];
  const aiEvidence = aiEvidenceByField(aiResult);
  const aiFields = aiResult?.fields && typeof aiResult.fields === "object" ? aiResult.fields : {};
  const aiObservations = groundAiObservations(CONSUMPTION_FIELDS
    .map((field) => observationFromAi(field, Number(aiFields[field]), aiEvidence[field]))
    .filter(Boolean), directObservations);

  const observations = [...directObservations, ...aiObservations];
  for (const [normalized, source] of [[nativeNormalized, "native"], [ocrNormalized, "ocr"]]) {
    for (const field of CONSUMPTION_FIELDS) {
      if (observations.some((item) => item.field === field
        && item.source === source
        && numericEquivalent(item.value, normalized?.[field]))) continue;
      const fallback = normalizedFallbackObservation(field, normalized, source);
      if (fallback) observations.push(fallback);
    }
  }

  const deduped = dedupeObservations(observations);
  return {
    observations: deduped,
    decisions: Object.fromEntries(CONSUMPTION_FIELDS.map((field) => [
      field,
      arbitrateField(field, deduped, sourceAvailability),
    ])),
  };
}

export function selectAnnualConsumptionFromText(text, unit) {
  const normalizedUnit = String(unit || "").toLowerCase();
  const field = fieldForUnit(normalizedUnit);
  if (!field) return null;
  const result = arbitrateConsumptionEvidence({
    nativePageTexts: [String(text || "")],
    sourceAvailability: { parser: "completed", ocr: "not_required", ai: "not_required" },
  });
  const decision = result.decisions[field];
  return decision?.status === "found" ? decision.value : null;
}

function fieldApplicable(normalized, field) {
  const commodity = String(normalized?.commodity || "unknown");
  if (field === "consumo_luce_kwh") return ["luce", "dual"].includes(commodity);
  if (["consumo_gas_smc", "consumo_gas_mc"].includes(field)) return ["gas", "dual"].includes(commodity);
  return false;
}

export function applyConsumptionDecisions(normalized = {}, decisions = {}) {
  const result = { ...normalized };
  const diagnostics = Array.isArray(result.diagnostics) ? result.diagnostics.map((item) => ({ ...item })) : [];
  const byField = new Map(diagnostics.map((item, index) => [String(item?.field || ""), index]));
  const resolvedFields = [];
  const decisionFields = [];

  for (const field of CONSUMPTION_FIELDS) {
    const decision = decisions[field];
    if (!decision || !fieldApplicable(result, field)) continue;
    const index = byField.get(field);
    if (field === "consumo_gas_mc" && index === undefined && !Number.isFinite(Number(result[field]))) continue;
    decisionFields.push(field);
    const existing = index === undefined ? { field, required: false } : diagnostics[index];
    if (decision.status === "found") {
      result[field] = decision.value;
      result.field_sources = {
        ...(result.field_sources || {}),
        [field]: [...new Set([...(decision.selected_candidate?.sources || []), "semantic_arbitration"])],
      };
      const updated = {
        ...existing,
        value: decision.value,
        status: "found",
        confidence: "high",
        page: decision.selected_candidate?.page || existing.page || null,
        source_snippet: decision.selected_candidate?.evidence || existing.source_snippet || "",
        source_match: decision.selected_candidate?.evidence || existing.source_match || "",
        method: "semantic_evidence_arbitration",
        decision_contract: decision.contract,
        decision_rule: decision.decision_rule,
        selected_candidate: decision.selected_candidate,
        excluded_candidates: decision.excluded_candidates,
        competing_annual_candidates: decision.competing_annual_candidates,
        source_availability: decision.source_availability,
        source_assessment: decision.source_assessment,
      };
      delete updated.candidate_value;
      delete updated.calculation_blocked;
      delete updated.ai_alternative;
      delete updated.ocr_alternative;
      if (index === undefined) {
        byField.set(field, diagnostics.length);
        diagnostics.push(updated);
      } else diagnostics[index] = updated;
      resolvedFields.push(field);
    } else {
      result[field] = decision.candidate_value ?? null;
      const updated = {
        ...existing,
        value: decision.candidate_value ?? null,
        status: decision.status,
        confidence: decision.status === "review" ? "medium" : "low",
        page: decision.selected_candidate?.page || existing.page || null,
        source_snippet: decision.selected_candidate?.evidence || existing.source_snippet || "",
        source_match: decision.selected_candidate?.evidence || existing.source_match || "",
        method: "semantic_evidence_arbitration",
        decision_contract: decision.contract,
        decision_rule: decision.decision_rule,
        selected_candidate: decision.selected_candidate,
        excluded_candidates: decision.excluded_candidates,
        competing_annual_candidates: decision.competing_annual_candidates,
        source_availability: decision.source_availability,
        source_assessment: decision.source_assessment,
      };
      if (index === undefined) {
        byField.set(field, diagnostics.length);
        diagnostics.push(updated);
      } else diagnostics[index] = updated;
    }
  }

  result.diagnostics = diagnostics;
  result.field_decisions = {
    ...(result.field_decisions || {}),
    ...Object.fromEntries(decisionFields.map((field) => [field, decisions[field]]).filter(([, value]) => value)),
  };
  return { normalized: result, resolvedFields };
}
