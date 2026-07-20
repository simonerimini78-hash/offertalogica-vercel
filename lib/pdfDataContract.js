export const PDF_DATA_CONTRACT_VERSION = "1.1.0";
export const PDF_AUTOFILL_POLICY_VERSION = "1.1.0";

const CORE_FIELDS = Object.freeze([
  "fornitore",
  "fornitore_luce",
  "fornitore_gas",
  "customer_type",
  "intestatario",
  "codice_fiscale",
  "codice_cliente",
  "codice_cliente_luce",
  "codice_cliente_gas",
  "consumo_luce_kwh",
  "prezzo_luce_eur_kwh",
  "quota_fissa_vendita_luce_eur_anno",
  "potenza_impegnata_kw",
  "potenza_disponibile_kw",
  "pod",
  "indirizzo_fornitura_luce",
  "nome_offerta_luce",
  "codice_offerta_luce",
  "tipo_prezzo_luce",
  "indice_riferimento_luce",
  "spread_luce_eur_kwh",
  "decorrenza_condizioni_economiche_luce",
  "scadenza_condizioni_economiche_luce",
  "struttura_prezzo_luce",
  "periodicita_aggiornamento_indice_luce",
  "formula_prezzo_luce",
  "frequenza_fatturazione_luce",
  "componenti_prezzo_luce",
  "sconti_offerta_luce",
  "valori_sconti_offerta_luce",
  "onere_recesso_anticipato_luce",
  "codice_condizioni_economiche_luce",
  "altre_caratteristiche_offerta_luce",
  "scadenza_contratto_luce",
  "consumo_gas_smc",
  "consumo_gas_mc",
  "coefficiente_conversione_gas_c",
  "prezzo_gas_eur_smc",
  "quota_fissa_vendita_gas_eur_anno",
  "pdr",
  "indirizzo_fornitura_gas",
  "nome_offerta_gas",
  "codice_offerta_gas",
  "tipo_prezzo_gas",
  "indice_riferimento_gas",
  "spread_gas_eur_smc",
  "decorrenza_condizioni_economiche_gas",
  "scadenza_condizioni_economiche_gas",
  "struttura_prezzo_gas",
  "periodicita_aggiornamento_indice_gas",
  "formula_prezzo_gas",
  "frequenza_fatturazione_gas",
  "componenti_prezzo_gas",
  "sconti_offerta_gas",
  "valori_sconti_offerta_gas",
  "onere_recesso_anticipato_gas",
  "codice_condizioni_economiche_gas",
  "altre_caratteristiche_offerta_gas",
  "scadenza_contratto_gas",
]);

const STATUS_ALIASES = Object.freeze({
  fornitore_luce: "fornitore",
  fornitore_gas: "fornitore",
  codice_cliente_luce: "codice_cliente",
  codice_cliente_gas: "codice_cliente",
});

const DIAGNOSTIC_ALIASES = Object.freeze({
  fornitore_luce: ["fornitore"],
  fornitore_gas: ["fornitore"],
  nome_offerta_luce: ["nome_offerta_luce", "nome_offerta"],
  nome_offerta_gas: ["nome_offerta_gas", "nome_offerta"],
  codice_offerta_luce: ["codice_offerta_luce", "codice_offerta"],
  codice_offerta_gas: ["codice_offerta_gas", "codice_offerta"],
  tipo_prezzo_luce: ["tipo_prezzo_luce", "tipo_prezzo"],
  tipo_prezzo_gas: ["tipo_prezzo_gas", "tipo_prezzo"],
  indice_riferimento_luce: ["indice_riferimento_luce", "indice_riferimento"],
  indice_riferimento_gas: ["indice_riferimento_gas", "indice_riferimento"],
  codice_cliente_luce: ["codice_cliente_luce", "codice_cliente"],
  codice_cliente_gas: ["codice_cliente_gas", "codice_cliente"],
});

const UNIT_BY_FIELD = Object.freeze({
  consumo_luce_kwh: "kWh/anno",
  prezzo_luce_eur_kwh: "EUR/kWh",
  quota_fissa_vendita_luce_eur_anno: "EUR/POD/anno",
  potenza_impegnata_kw: "kW",
  potenza_disponibile_kw: "kW",
  spread_luce_eur_kwh: "EUR/kWh",
  consumo_gas_smc: "Smc/anno",
  prezzo_gas_eur_smc: "EUR/Smc",
  quota_fissa_vendita_gas_eur_anno: "EUR/PDR/anno",
  spread_gas_eur_smc: "EUR/Smc",
  consumo_gas_mc: "mc/anno",
  coefficiente_conversione_gas_c: "coefficiente C",
});

const COMMODITY_BY_FIELD = Object.freeze({
  codice_cliente_luce: "luce",
  codice_cliente_gas: "gas",
  fornitore_luce: "luce",
  consumo_luce_kwh: "luce",
  prezzo_luce_eur_kwh: "luce",
  quota_fissa_vendita_luce_eur_anno: "luce",
  potenza_impegnata_kw: "luce",
  potenza_disponibile_kw: "luce",
  pod: "luce",
  indirizzo_fornitura_luce: "luce",
  nome_offerta_luce: "luce",
  codice_offerta_luce: "luce",
  tipo_prezzo_luce: "luce",
  indice_riferimento_luce: "luce",
  spread_luce_eur_kwh: "luce",
  decorrenza_condizioni_economiche_luce: "luce",
  scadenza_condizioni_economiche_luce: "luce",
  struttura_prezzo_luce: "luce",
  periodicita_aggiornamento_indice_luce: "luce",
  formula_prezzo_luce: "luce",
  frequenza_fatturazione_luce: "luce",
  componenti_prezzo_luce: "luce",
  sconti_offerta_luce: "luce",
  valori_sconti_offerta_luce: "luce",
  onere_recesso_anticipato_luce: "luce",
  codice_condizioni_economiche_luce: "luce",
  altre_caratteristiche_offerta_luce: "luce",
  scadenza_contratto_luce: "luce",
  fornitore_gas: "gas",
  consumo_gas_smc: "gas",
  prezzo_gas_eur_smc: "gas",
  quota_fissa_vendita_gas_eur_anno: "gas",
  pdr: "gas",
  indirizzo_fornitura_gas: "gas",
  nome_offerta_gas: "gas",
  codice_offerta_gas: "gas",
  tipo_prezzo_gas: "gas",
  indice_riferimento_gas: "gas",
  spread_gas_eur_smc: "gas",
  decorrenza_condizioni_economiche_gas: "gas",
  scadenza_condizioni_economiche_gas: "gas",
  struttura_prezzo_gas: "gas",
  periodicita_aggiornamento_indice_gas: "gas",
  formula_prezzo_gas: "gas",
  frequenza_fatturazione_gas: "gas",
  componenti_prezzo_gas: "gas",
  sconti_offerta_gas: "gas",
  valori_sconti_offerta_gas: "gas",
  onere_recesso_anticipato_gas: "gas",
  codice_condizioni_economiche_gas: "gas",
  altre_caratteristiche_offerta_gas: "gas",
  scadenza_contratto_gas: "gas",
  consumo_gas_mc: "gas",
  coefficiente_conversione_gas_c: "gas",
});

const COMPARISON_TARGETS = Object.freeze({
  fornitore_luce: ["nome-fornitore-att"],
  fornitore_gas: ["nome-fornitore-gas-att"],
  consumo_luce_kwh: ["in-luce-cons-att", "in-luce-cons-nuov", "master-luce-consumo"],
  prezzo_luce_eur_kwh: ["in-luce-prezzo-att"],
  quota_fissa_vendita_luce_eur_anno: ["in-luce-fisso-att"],
  potenza_impegnata_kw: ["master-luce-potenza"],
  consumo_gas_smc: ["in-gas-cons-att", "in-gas-cons-nuov", "master-gas-consumo"],
  prezzo_gas_eur_smc: ["in-gas-prezzo-att"],
  quota_fissa_vendita_gas_eur_anno: ["in-gas-fisso-att"],
  tipo_prezzo_luce: ["master-luce-tipo"],
  tipo_prezzo_gas: ["master-luce-tipo"],
});

const OFFER_TARGETS = Object.freeze({
  fornitore_luce: ["nome-fornitore-nuov"],
  fornitore_gas: ["nome-fornitore-nuov"],
  prezzo_luce_eur_kwh: ["in-luce-prezzo-nuov"],
  quota_fissa_vendita_luce_eur_anno: ["in-luce-fisso-nuov"],
  prezzo_gas_eur_smc: ["in-gas-prezzo-nuov"],
  quota_fissa_vendita_gas_eur_anno: ["in-gas-fisso-nuov"],
  tipo_prezzo_luce: ["master-luce-tipo"],
  tipo_prezzo_gas: ["master-luce-tipo"],
});

const ACTIVATION_TARGETS = Object.freeze({
  intestatario: ["activation.intestatario"],
  codice_fiscale: ["activation.codice_fiscale"],
  codice_cliente: ["activation.codice_cliente"],
  codice_cliente_luce: ["activation.codice_cliente_luce"],
  codice_cliente_gas: ["activation.codice_cliente_gas"],
  pod: ["activation.pod"],
  pdr: ["activation.pdr"],
  indirizzo_fornitura_luce: ["activation.indirizzo_luce"],
  indirizzo_fornitura_gas: ["activation.indirizzo_gas"],
  potenza_impegnata_kw: ["activation.potenza_impegnata_kw"],
});

function hasValue(value) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function compact(value, maxLength = 420) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function fieldValue(input, field) {
  if (field === "fornitore_luce") {
    return ["luce", "dual"].includes(input.commodity) ? input.fornitore_luce || input.fornitore : null;
  }
  if (field === "fornitore_gas") {
    return ["gas", "dual"].includes(input.commodity) ? input.fornitore_gas || input.fornitore : null;
  }
  if (field === "codice_cliente_luce") {
    return ["luce", "dual"].includes(input.commodity)
      ? input.codice_cliente_luce || input.codice_cliente || null
      : null;
  }
  if (field === "codice_cliente_gas") {
    return ["gas", "dual"].includes(input.commodity)
      ? input.codice_cliente_gas || input.codice_cliente || null
      : null;
  }
  if (field === "codice_cliente") {
    const luce = input.codice_cliente_luce || null;
    const gas = input.codice_cliente_gas || null;
    if (luce && gas && String(luce) !== String(gas)) return null;
    return input.codice_cliente || luce || gas || null;
  }
  return input[field] ?? null;
}

function fieldStatus(input, field, value) {
  const commodity = COMMODITY_BY_FIELD[field];
  if (commodity && ![commodity, "dual"].includes(input.commodity)) {
    return { status: "non_applicabile", reason: null };
  }
  if (field === "codice_cliente") {
    const luce = input.codice_cliente_luce || null;
    const gas = input.codice_cliente_gas || null;
    if (luce && gas && String(luce) !== String(gas)) {
      return { status: "non_applicabile", reason: "codici_specifici_per_utenza" };
    }
  }
  const statusField = STATUS_ALIASES[field] || field;
  const explicit = input.field_status?.[statusField];
  if (explicit?.status) return { status: explicit.status, reason: explicit.reason || null };
  return hasValue(value)
    ? { status: "completo", reason: null }
    : { status: "mancante", reason: "valore_non_estratto" };
}

function diagnosticFor(input, field) {
  const aliases = DIAGNOSTIC_ALIASES[field] || [field];
  const diagnostics = Array.isArray(input.diagnostics) ? input.diagnostics : [];
  const matches = diagnostics.filter((item) => aliases.includes(item?.field) && ["found", "review"].includes(item?.status));
  return matches.find((item) => item?.status === "found") || matches[0] || null;
}

function fieldMethod(input, field, diagnostic) {
  if (diagnostic?.method) return compact(diagnostic.method, 120);
  if (field === "quota_fissa_vendita_luce_eur_anno") return compact(input.quota_fissa_vendita_luce_method || "parser_output", 120);
  if (field === "quota_fissa_vendita_gas_eur_anno") return compact(input.quota_fissa_vendita_gas_method || "parser_output", 120);
  if (["indirizzo_fornitura_luce", "indirizzo_fornitura_gas"].includes(field)
      && (input.validation_notes || []).some((note) => String(note).includes(field.includes("luce") ? "indirizzo_luce" : "indirizzo_gas"))) {
    return "validated_address_completion";
  }
  return "deterministic_parser";
}

function valueVariants(value) {
  if (!hasValue(value) || Array.isArray(value) || typeof value === "object") return [];
  if (typeof value === "number" && Number.isFinite(value)) {
    const canonical = String(value);
    const [integerPart, decimalPart = ""] = canonical.split(".");
    const groupedIt = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (decimalPart ? `,${decimalPart}` : "");
    const groupedEn = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (decimalPart ? `.${decimalPart}` : "");
    return [...new Set([
      canonical,
      canonical.replace(".", ","),
      groupedIt,
      groupedEn,
    ])].filter((item) => item.length >= 3);
  }
  const text = compact(value, 240);
  return text ? [text] : [];
}

function fieldEvidence(input, field, diagnostic, value) {
  const snippet = compact(diagnostic?.source_snippet, 360);
  const match = compact(diagnostic?.source_match, 180);
  const haystack = `${snippet} ${match}`.toLocaleLowerCase("it");
  const literalValue = valueVariants(value).find((variant) => haystack.includes(variant.toLocaleLowerCase("it"))) || null;
  const literalValuePresent = Boolean(literalValue);
  const available = Boolean(snippet || match);
  return {
    available,
    quality: !available ? "unavailable" : literalValuePresent ? "literal_value" : "context_only",
    literal_value_present: literalValuePresent,
    literal_value: literalValue,
    page: Number.isInteger(Number(diagnostic?.page)) && Number(diagnostic.page) > 0 ? Number(diagnostic.page) : null,
    label: compact(diagnostic?.label, 180) || null,
    source_match: match || null,
    snippet: snippet || null,
    note: !available
      ? "evidenza_testuale_non_esposta_dal_parser_legacy"
      : literalValuePresent
        ? null
        : "snippet_disponibile_ma_valore_normalizzato_non_presente_letteralmente",
  };
}

function sharedPriceTypeConflict(input, field, value) {
  if (!["tipo_prezzo_luce", "tipo_prezzo_gas"].includes(field)) return false;
  if (input.commodity !== "dual") return false;
  const other = field === "tipo_prezzo_luce" ? input.tipo_prezzo_gas : input.tipo_prezzo_luce;
  return hasValue(other) && String(other) !== String(value);
}

function targetSupportsValue(field, value) {
  if (!["tipo_prezzo_luce", "tipo_prezzo_gas"].includes(field)) return true;
  return ["fisso", "variabile"].includes(String(value || "").toLowerCase());
}

function targetMapFor(input) {
  return input.kind === "scheda_offerta" ? OFFER_TARGETS : COMPARISON_TARGETS;
}

function isOcrField(input, field) {
  if (!input?.ocr?.applied) return false;
  const filled = new Set(Array.isArray(input.ocr.filled_fields) ? input.ocr.filled_fields : []);
  const aliases = DIAGNOSTIC_ALIASES[field] || [field];
  return aliases.some((alias) => filled.has(alias));
}

function deniedAutofill(reason, targets, use) {
  return {
    allowed: false,
    review_selectable: false,
    requires_explicit_selection: false,
    reason,
    targets,
    use,
  };
}

function autofillDecision(input, field, value, status, ocrField = false) {
  const targets = targetMapFor(input)[field] || ACTIVATION_TARGETS[field] || [];
  const use = ACTIVATION_TARGETS[field] ? "activation_helper" : input.kind === "scheda_offerta" ? "new_offer" : "current_supply";
  if (!targets.length) return deniedAutofill("campo_non_mappato", [], use);
  if (!hasValue(value)) return deniedAutofill("valore_assente", targets, use);
  if (status.status !== "completo") return deniedAutofill(`stato_${status.status}`, targets, use);
  if (sharedPriceTypeConflict(input, field, value)) return deniedAutofill("target_condiviso_con_valori_in_conflitto", targets, use);
  if (!targetSupportsValue(field, value)) return deniedAutofill("valore_non_supportato_dal_modulo", targets, use);
  if (ocrField) {
    return {
      allowed: false,
      review_selectable: true,
      requires_explicit_selection: true,
      reason: "ocr_da_verificare_con_conferma_esplicita",
      targets,
      use,
    };
  }
  return {
    allowed: true,
    review_selectable: false,
    requires_explicit_selection: false,
    reason: "campo_completo_con_conferma_utente",
    targets,
    use,
  };
}

function makeFieldMeta(input, field) {
  const value = fieldValue(input, field);
  const status = fieldStatus(input, field, value);
  const diagnostic = diagnosticFor(input, field);
  const evidence = fieldEvidence(input, field, diagnostic, value);
  const ocrField = isOcrField(input, field);
  const decision = autofillDecision(input, field, value, status, ocrField);
  return {
    field,
    commodity: COMMODITY_BY_FIELD[field] || "common",
    normalized_value: value,
    original_value: evidence.literal_value ?? diagnostic?.value ?? value,
    original_value_kind: evidence.literal_value ? "source_literal" : diagnostic ? "parser_diagnostic_value" : "parser_output_value",
    unit: UNIT_BY_FIELD[field] || null,
    status: status.status,
    status_reason: status.reason,
    provenance: {
      source: ocrField ? "ocr" : "parser",
      origin: ocrField ? "pdf_image_ocr" : "pdf_native_text",
      source_version: ocrField
        ? input.ocr?.pipeline_version || input.parser_version || "unknown"
        : input.parser_version || "unknown",
      method: fieldMethod(input, field, diagnostic),
      confidence: ocrField ? "medium" : diagnostic?.confidence || input.confidence || "unknown",
    },
    review_required: ocrField,
    evidence,
    autofill: decision,
  };
}

function safeFieldRows(fields) {
  return Object.values(fields)
    .filter((entry) => entry.autofill.allowed)
    .flatMap((entry) => entry.autofill.targets.map((target) => ({
      source_field: entry.field,
      target,
      use: entry.autofill.use,
      value: entry.normalized_value,
      unit: entry.unit,
      requires_user_confirmation: true,
    })));
}

function reviewFieldRows(fields) {
  return Object.values(fields)
    .filter((entry) => entry.autofill.review_selectable)
    .flatMap((entry) => entry.autofill.targets.map((target) => ({
      source_field: entry.field,
      target,
      use: entry.autofill.use,
      value: entry.normalized_value,
      unit: entry.unit,
      requires_user_confirmation: true,
      requires_explicit_selection: true,
      provenance: entry.provenance.origin,
    })));
}

function blockedFieldRows(fields) {
  return Object.values(fields)
    .filter((entry) => entry.status !== "non_applicabile" && entry.autofill.targets.length && !entry.autofill.allowed && !entry.autofill.review_selectable)
    .map((entry) => ({
      source_field: entry.field,
      targets: entry.autofill.targets,
      use: entry.autofill.use,
      status: entry.status,
      reason: entry.autofill.reason,
    }));
}

function supplyObject(input, commodity) {
  const isLuce = commodity === "luce";
  if (![commodity, "dual"].includes(input.commodity)) return null;
  return {
    commodity,
    provider: input[`fornitore_${commodity}`] || input.fornitore || null,
    customer_code: input[`codice_cliente_${commodity}`] || input.codice_cliente || null,
    annual_consumption: isLuce ? input.consumo_luce_kwh ?? null : input.consumo_gas_smc ?? null,
    annual_consumption_unit: isLuce ? "kWh/anno" : "Smc/anno",
    sales_price: isLuce ? input.prezzo_luce_eur_kwh ?? null : input.prezzo_gas_eur_smc ?? null,
    sales_price_unit: isLuce ? "EUR/kWh" : "EUR/Smc",
    fixed_sales_fee_annual: isLuce ? input.quota_fissa_vendita_luce_eur_anno ?? null : input.quota_fissa_vendita_gas_eur_anno ?? null,
    supply_identifier: isLuce ? input.pod || null : input.pdr || null,
    supply_address: isLuce ? input.indirizzo_fornitura_luce || null : input.indirizzo_fornitura_gas || null,
    committed_power_kw: isLuce ? input.potenza_impegnata_kw ?? null : null,
    available_power_kw: isLuce ? input.potenza_disponibile_kw ?? null : null,
    offer: {
      name: input[`nome_offerta_${commodity}`] || null,
      code: input[`codice_offerta_${commodity}`] || null,
      price_type: input[`tipo_prezzo_${commodity}`] || null,
      price_structure: input[`struttura_prezzo_${commodity}`] || null,
      index: input[`indice_riferimento_${commodity}`] || null,
      spread: input[isLuce ? "spread_luce_eur_kwh" : "spread_gas_eur_smc"] ?? null,
      index_update_periodicity: input[`periodicita_aggiornamento_indice_${commodity}`] || null,
      valid_from: input[`decorrenza_condizioni_economiche_${commodity}`] || null,
      valid_to: input[`scadenza_condizioni_economiche_${commodity}`] || null,
      formula: input[`formula_prezzo_${commodity}`] || null,
    },
    readiness: {
      comparison: input.readiness?.confronto?.[commodity] || null,
      bill_data: input.readiness?.dati_bolletta?.[commodity] || null,
      activation: input.readiness?.attivazione?.[commodity] || null,
    },
  };
}

export function buildPdfDataContract(input = {}) {
  const fields = Object.fromEntries(CORE_FIELDS.map((field) => [field, makeFieldMeta(input, field)]));
  const safeFields = safeFieldRows(fields);
  const reviewFields = reviewFieldRows(fields);
  const blockedFields = blockedFieldRows(fields);
  const luceCustomerCode = fieldValue(input, "codice_cliente_luce");
  const gasCustomerCode = fieldValue(input, "codice_cliente_gas");
  const commonCustomerCode = luceCustomerCode && gasCustomerCode
    ? String(luceCustomerCode) === String(gasCustomerCode) ? luceCustomerCode : null
    : luceCustomerCode || gasCustomerCode || fieldValue(input, "codice_cliente");
  return {
    schema: "offertalogica.pdf-data",
    contract_version: PDF_DATA_CONTRACT_VERSION,
    parser: {
      mode: input.ocr?.applied ? "deterministic_with_controlled_ocr" : "deterministic",
      parser_version: input.parser_version || "unknown",
      ocr_pipeline_version: input.ocr?.applied ? input.ocr.pipeline_version || null : null,
      page_count: input.page_count ?? null,
      text_length: input.textExtracted ?? null,
    },
    document: {
      kind: input.kind || "unknown",
      commodity: input.commodity || "unknown",
      recognized: Boolean(input.recognized),
      confidence: input.confidence || "low",
      needs_review: Boolean(input.needsReview),
    },
    customer: {
      profile: input.customer_type || null,
      holder: input.intestatario || null,
      tax_id: input.codice_fiscale || null,
      customer_code: commonCustomerCode,
      customer_codes: {
        luce: luceCustomerCode || null,
        gas: gasCustomerCode || null,
      },
    },
    supplies: {
      luce: supplyObject(input, "luce"),
      gas: supplyObject(input, "gas"),
    },
    fields,
    autofill_plan: {
      policy_version: PDF_AUTOFILL_POLICY_VERSION,
      requires_user_confirmation: true,
      policy: "complete_native_fields_plus_explicitly_selected_ocr_fields",
      safe_fields: safeFields,
      review_fields: reviewFields,
      blocked_fields: blockedFields,
      safe_target_count: safeFields.length,
      review_target_count: reviewFields.length,
      blocked_field_count: blockedFields.length,
    },
    readiness: input.readiness || null,
    completeness: input.completeness || null,
  };
}

export function applyPdfDataContract(input = {}) {
  return {
    ...input,
    data_contract: buildPdfDataContract(input),
  };
}
