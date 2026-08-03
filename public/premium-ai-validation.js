(() => {
  "use strict";

  const FIELD_DEFINITIONS = Object.freeze([
    { key: "commodity", commodity: "general", label: "Tipo fornitura", type: "commodity", unit: "" },
    { key: "fornitore_luce", commodity: "luce", label: "Fornitore luce", type: "text", unit: "" },
    { key: "consumo_luce_kwh", commodity: "luce", label: "Consumo annuo luce", type: "number", unit: "kWh/anno", decimals: 3 },
    { key: "prezzo_luce_eur_kwh", commodity: "luce", label: "Prezzo materia luce", type: "number", unit: "€/kWh", decimals: 6 },
    { key: "quota_fissa_vendita_luce_eur_anno", commodity: "luce", label: "Quota fissa luce", type: "number", unit: "€/anno", decimals: 2 },
    { key: "tipo_prezzo_luce", commodity: "luce", label: "Tipo prezzo luce", type: "text", unit: "" },
    { key: "indice_riferimento_luce", commodity: "luce", label: "Indice luce", type: "text", unit: "" },
    { key: "formula_prezzo_luce", commodity: "luce", label: "Formula prezzo luce", type: "text", unit: "" },
    { key: "fornitore_gas", commodity: "gas", label: "Fornitore gas", type: "text", unit: "" },
    { key: "consumo_gas_smc", commodity: "gas", label: "Consumo annuo gas", type: "number", unit: "Smc/anno", decimals: 3 },
    { key: "prezzo_gas_eur_smc", commodity: "gas", label: "Prezzo materia gas", type: "number", unit: "€/Smc", decimals: 6 },
    { key: "quota_fissa_vendita_gas_eur_anno", commodity: "gas", label: "Quota fissa gas", type: "number", unit: "€/anno", decimals: 2 },
    { key: "tipo_prezzo_gas", commodity: "gas", label: "Tipo prezzo gas", type: "text", unit: "" },
    { key: "indice_riferimento_gas", commodity: "gas", label: "Indice gas", type: "text", unit: "" },
    { key: "formula_prezzo_gas", commodity: "gas", label: "Formula prezzo gas", type: "text", unit: "" }
  ]);

  function hasValue(value) {
    return value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "");
  }

  function normalizeCommodity(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (["electricity", "energia elettrica", "elettricità", "luce"].includes(raw)) return "luce";
    if (["gas", "gas naturale"].includes(raw)) return "gas";
    if (["dual", "luce e gas", "luce+gas", "electricity_gas"].includes(raw)) return "dual";
    return "unknown";
  }

  function aiValueForField(data = {}, key) {
    if (key === "fornitore_luce") return data.fornitore_luce ?? data.fornitore ?? null;
    if (key === "fornitore_gas") return data.fornitore_gas ?? data.fornitore ?? null;
    return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
  }

  function commoditySignals(data = {}, commodity) {
    return FIELD_DEFINITIONS
      .filter(field => field.commodity === commodity)
      .some(field => hasValue(aiValueForField(data, field.key)));
  }

  function fieldsForAnalysis(data = {}, billCommodity = "") {
    const detected = normalizeCommodity(data.commodity);
    const declared = normalizeCommodity(billCommodity);
    const active = new Set(["general"]);
    const source = detected !== "unknown" ? detected : declared;
    if (source === "dual") {
      active.add("luce");
      active.add("gas");
    } else if (source === "luce" || source === "gas") {
      active.add(source);
    } else {
      if (commoditySignals(data, "luce")) active.add("luce");
      if (commoditySignals(data, "gas")) active.add("gas");
    }
    return FIELD_DEFINITIONS.filter(field => active.has(field.commodity));
  }

  function parseReviewedValue(raw, definition) {
    if (definition.type === "number") {
      const normalized = String(raw ?? "").trim().replace(",", ".");
      if (!normalized) return null;
      const number = Number(normalized);
      if (!Number.isFinite(number)) throw new Error(`Valore non valido per ${definition.label}.`);
      return number;
    }
    const text = String(raw ?? "").trim();
    return text || null;
  }

  function formatValue(value, definition, locale = "it-IT") {
    if (!hasValue(value)) return "Dato non trovato";
    if (definition.type === "number") {
      const number = Number(value);
      if (!Number.isFinite(number)) return String(value);
      const decimals = Number.isInteger(definition.decimals) ? definition.decimals : 6;
      const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: decimals }).format(number);
      return definition.unit ? `${formatted} ${definition.unit}` : formatted;
    }
    if (definition.type === "commodity") {
      return ({ luce: "Luce", gas: "Gas", dual: "Luce e gas", unknown: "Non definita" })[normalizeCommodity(value)] || String(value);
    }
    return String(value);
  }

  function defaultDecision(aiValue) {
    return hasValue(aiValue) ? "approved" : "missing";
  }

  function calculateMetrics(items = []) {
    const counts = { approved: 0, corrected: 0, missing: 0, not_applicable: 0 };
    items.forEach(item => {
      if (Object.prototype.hasOwnProperty.call(counts, item?.decision)) counts[item.decision] += 1;
    });
    const applicable = counts.approved + counts.corrected + counts.missing;
    return {
      fields_total: items.length,
      applicable_fields: applicable,
      approved_fields: counts.approved,
      corrected_fields: counts.corrected,
      missing_fields: counts.missing,
      not_applicable_fields: counts.not_applicable,
      accuracy_pct: applicable ? Number(((counts.approved / applicable) * 100).toFixed(2)) : 0,
      correction_rate_pct: applicable ? Number(((counts.corrected / applicable) * 100).toFixed(2)) : 0
    };
  }

  window.OffertaLogicaPremiumAiValidation = Object.freeze({
    FIELD_DEFINITIONS,
    aiValueForField,
    calculateMetrics,
    defaultDecision,
    fieldsForAnalysis,
    formatValue,
    hasValue,
    normalizeCommodity,
    parseReviewedValue
  });
})();
