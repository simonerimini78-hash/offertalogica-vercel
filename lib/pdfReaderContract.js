export const PDF_CANDIDATE_CONTRACT_VERSION = "1.0.3";

export const PDF_CANDIDATE_SOURCES = Object.freeze(["parser", "ocr", "ai"]);

export const PDF_SEMANTIC_ROLES = Object.freeze([
  "actual_customer_value",
  "expected_or_estimated_customer_value",
  "offer_value",
  "billing_period",
  "contract_period",
  "threshold",
  "example",
  "discount",
  "penalty",
  "network_component",
  "sales_component",
  "tax",
  "identifier",
  "classification",
  "unknown",
]);

const FIELDS = {
  fornitore: { group: "document", roles: ["identifier", "classification"], critical: true },
  kind: { group: "document", roles: ["classification"], critical: true },
  commodity: { group: "document", roles: ["classification"], critical: true },
  customer_type: { group: "document", roles: ["classification"], critical: true },
  consumo_luce_kwh: { group: "consumption", unit: "kWh/anno", roles: ["actual_customer_value"], critical: true },
  consumo_gas_smc: { group: "consumption", unit: "Smc/anno", roles: ["actual_customer_value"], critical: true },
  prezzo_luce_eur_kwh: { group: "economic", unit: "EUR/kWh", roles: ["actual_customer_value", "offer_value"], critical: true },
  prezzo_gas_eur_smc: { group: "economic", unit: "EUR/Smc", roles: ["actual_customer_value", "offer_value"], critical: true },
  quota_fissa_vendita_luce_eur_anno: { group: "economic", unit: "EUR/POD/anno", roles: ["actual_customer_value", "offer_value", "sales_component"], critical: true },
  quota_fissa_vendita_gas_eur_anno: { group: "economic", unit: "EUR/PDR/anno", roles: ["actual_customer_value", "offer_value", "sales_component"], critical: true },
  potenza_impegnata_kw: { group: "power", unit: "kW", roles: ["actual_customer_value"], critical: true },
  potenza_disponibile_kw: { group: "power", unit: "kW", roles: ["actual_customer_value"], critical: false },
  pod: { group: "identifier", roles: ["identifier"], critical: true },
  pdr: { group: "identifier", roles: ["identifier"], critical: true },
  intestatario: { group: "identifier", roles: ["identifier", "actual_customer_value"], critical: false },
  codice_fiscale: { group: "identifier", roles: ["identifier"], critical: false },
  codice_cliente: { group: "identifier", roles: ["identifier"], critical: false },
  indirizzo_fornitura: { group: "identifier", roles: ["identifier", "actual_customer_value"], critical: false },
  indirizzo_fornitura_luce: { group: "identifier", roles: ["identifier", "actual_customer_value"], critical: false },
  indirizzo_fornitura_gas: { group: "identifier", roles: ["identifier", "actual_customer_value"], critical: false },
  nome_offerta: { group: "offer", roles: ["identifier", "offer_value"], critical: false },
  codice_offerta: { group: "offer", roles: ["identifier"], critical: false },
  codice_prodotto_fornitore: { group: "offer", roles: ["identifier"], critical: false },
  tipo_prezzo: { group: "offer", roles: ["classification"], critical: true },
  indice_riferimento: { group: "economic", roles: ["offer_value", "identifier"], critical: true },
  nome_offerta_luce: { group: "offer", roles: ["identifier", "offer_value"], critical: false },
  codice_offerta_luce: { group: "offer", roles: ["identifier"], critical: false },
  codice_prodotto_fornitore_luce: { group: "offer", roles: ["identifier"], critical: false },
  tipo_prezzo_luce: { group: "offer", roles: ["classification"], critical: true },
  indice_riferimento_luce: { group: "economic", roles: ["offer_value", "identifier"], critical: true },
  spread_luce_eur_kwh: { group: "economic", unit: "EUR/kWh", roles: ["offer_value", "sales_component"], critical: true },
  nome_offerta_gas: { group: "offer", roles: ["identifier", "offer_value"], critical: false },
  codice_offerta_gas: { group: "offer", roles: ["identifier"], critical: false },
  codice_prodotto_fornitore_gas: { group: "offer", roles: ["identifier"], critical: false },
  tipo_prezzo_gas: { group: "offer", roles: ["classification"], critical: true },
  indice_riferimento_gas: { group: "economic", roles: ["offer_value", "identifier"], critical: true },
  spread_gas_eur_smc: { group: "economic", unit: "EUR/Smc", roles: ["offer_value", "sales_component"], critical: true },
  tipo_prezzo_evidenza: { group: "offer", roles: ["classification"], critical: false },
  decorrenza_condizioni_economiche: { group: "offer", roles: ["contract_period"], critical: false },
  scadenza_condizioni_economiche: { group: "offer", roles: ["contract_period"], critical: false },
  struttura_prezzo: { group: "offer", roles: ["classification"], critical: false },
  periodicita_aggiornamento_indice: { group: "offer", roles: ["offer_value"], critical: false },
  formula_prezzo: { group: "economic", roles: ["offer_value"], critical: false },
  onere_recesso_anticipato: { group: "offer", roles: ["penalty"], critical: false },
  codice_condizioni_economiche: { group: "offer", roles: ["identifier"], critical: false },
  altre_caratteristiche_offerta: { group: "offer", roles: ["offer_value"], critical: false },
  tipo_prezzo_evidenza_luce: { group: "offer", roles: ["classification"], critical: false },
  decorrenza_condizioni_economiche_luce: { group: "offer", roles: ["contract_period"], critical: false },
  scadenza_condizioni_economiche_luce: { group: "offer", roles: ["contract_period"], critical: false },
  struttura_prezzo_luce: { group: "offer", roles: ["classification"], critical: false },
  periodicita_aggiornamento_indice_luce: { group: "offer", roles: ["offer_value"], critical: false },
  formula_prezzo_luce: { group: "economic", roles: ["offer_value"], critical: false },
  onere_recesso_anticipato_luce: { group: "offer", roles: ["penalty"], critical: false },
  codice_condizioni_economiche_luce: { group: "offer", roles: ["identifier"], critical: false },
  altre_caratteristiche_offerta_luce: { group: "offer", roles: ["offer_value"], critical: false },
  tipo_prezzo_evidenza_gas: { group: "offer", roles: ["classification"], critical: false },
  decorrenza_condizioni_economiche_gas: { group: "offer", roles: ["contract_period"], critical: false },
  scadenza_condizioni_economiche_gas: { group: "offer", roles: ["contract_period"], critical: false },
  struttura_prezzo_gas: { group: "offer", roles: ["classification"], critical: false },
  periodicita_aggiornamento_indice_gas: { group: "offer", roles: ["offer_value"], critical: false },
  formula_prezzo_gas: { group: "economic", roles: ["offer_value"], critical: false },
  onere_recesso_anticipato_gas: { group: "offer", roles: ["penalty"], critical: false },
  codice_condizioni_economiche_gas: { group: "offer", roles: ["identifier"], critical: false },
  altre_caratteristiche_offerta_gas: { group: "offer", roles: ["offer_value"], critical: false },
};

const FIELD_ALIASES = {
  supplier: "fornitore",
  document_type: "kind",
  annual_consumption_electricity: "consumo_luce_kwh",
  annual_consumption_gas: "consumo_gas_smc",
  committed_power: "potenza_impegnata_kw",
  available_power: "potenza_disponibile_kw",
  supply_address: "indirizzo_fornitura",
  customer_code: "codice_cliente",
  fiscal_code: "codice_fiscale",
  energy_price_f0: "prezzo_luce_eur_kwh",
  gas_price: "prezzo_gas_eur_smc",
  fixed_sales_fee_electricity: "quota_fissa_vendita_luce_eur_anno",
  fixed_sales_fee_gas: "quota_fissa_vendita_gas_eur_anno",
  index_reference_electricity: "indice_riferimento_luce",
  index_reference_gas: "indice_riferimento_gas",
  spread_electricity: "spread_luce_eur_kwh",
  spread_gas: "spread_gas_eur_smc",
  offer_name: "nome_offerta",
  offer_code: "codice_offerta",
  supplier_product_code: "codice_prodotto_fornitore",
  supplier_product_code_electricity: "codice_prodotto_fornitore_luce",
  supplier_product_code_gas: "codice_prodotto_fornitore_gas",
  price_type: "tipo_prezzo",
};

function cleanText(value, maxLength = 360) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function confidenceNumber(value) {
  if (Number.isFinite(Number(value))) return Math.max(0, Math.min(100, Math.round(Number(value))));
  if (value === "high") return 90;
  if (value === "medium") return 70;
  if (value === "low") return 40;
  return 0;
}

function canonicalCommodity(value) {
  const commodity = String(value || "unknown").trim().toLowerCase();
  if (commodity === "electricity") return "luce";
  if (commodity === "gas") return "gas";
  if (commodity === "dual") return "dual";
  if (commodity === "not_applicable") return "not_applicable";
  return ["luce", "gas", "dual"].includes(commodity) ? commodity : "unknown";
}

export function canonicalPdfField(field) {
  const value = String(field || "").trim();
  return FIELD_ALIASES[value] || value;
}

export function pdfFieldDefinition(field) {
  return FIELDS[canonicalPdfField(field)] || null;
}

export function pdfFieldNames() {
  return Object.keys(FIELDS);
}

export function requiredPdfFields(normalized = {}) {
  const required = ["fornitore", "kind", "commodity"];
  const hasLuce = ["luce", "dual"].includes(normalized.commodity);
  const hasGas = ["gas", "dual"].includes(normalized.commodity);
  if (normalized.kind === "bolletta") {
    if (hasLuce) required.push("consumo_luce_kwh", "prezzo_luce_eur_kwh", "quota_fissa_vendita_luce_eur_anno");
    if (hasGas) required.push("consumo_gas_smc", "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno");
  }
  if (normalized.kind === "scheda_offerta") {
    if (hasLuce) {
      required.push("tipo_prezzo_luce", "quota_fissa_vendita_luce_eur_anno");
      if (normalized.tipo_prezzo_luce === "variabile") required.push("indice_riferimento_luce", "spread_luce_eur_kwh");
      else required.push("prezzo_luce_eur_kwh");
    }
    if (hasGas) {
      required.push("tipo_prezzo_gas", "quota_fissa_vendita_gas_eur_anno");
      if (normalized.tipo_prezzo_gas === "variabile") required.push("indice_riferimento_gas", "spread_gas_eur_smc");
      else required.push("prezzo_gas_eur_smc");
    }
  }
  return [...new Set(required)];
}

function semanticRoleForLegacyField(field, normalized) {
  const definition = pdfFieldDefinition(field);
  if (!definition) return "unknown";
  if (definition.roles.length === 1) return definition.roles[0];
  if (normalized.kind === "scheda_offerta") return definition.roles.includes("offer_value") ? "offer_value" : definition.roles[0];
  if (normalized.kind === "bolletta") return definition.roles.includes("actual_customer_value") ? "actual_customer_value" : definition.roles[0];
  return definition.roles[0];
}

export function createPdfCandidate(input = {}, index = 0) {
  const field = canonicalPdfField(input.field);
  const definition = pdfFieldDefinition(field);
  const value = input.normalized_value ?? input.value_number ?? input.value_text ?? input.value ?? null;
  return {
    id: cleanText(input.id || `${input.source || "unknown"}:${field}:${index}`, 180),
    contract_version: PDF_CANDIDATE_CONTRACT_VERSION,
    field,
    value_text: input.value_text === null || input.value_text === undefined ? (typeof value === "string" ? value : null) : cleanText(input.value_text, 500),
    value_number: input.value_number !== null && input.value_number !== undefined && input.value_number !== "" && Number.isFinite(Number(input.value_number))
      ? Number(input.value_number)
      : (typeof value === "number" && Number.isFinite(value) ? value : null),
    normalized_value: value,
    unit: input.unit || definition?.unit || null,
    normalized_unit: input.normalized_unit || input.unit || definition?.unit || null,
    commodity: canonicalCommodity(input.commodity),
    page: Number.isInteger(Number(input.page)) && Number(input.page) > 0 ? Number(input.page) : null,
    label: cleanText(input.label, 180) || null,
    evidence: cleanText(input.evidence, 360),
    semantic_role: PDF_SEMANTIC_ROLES.includes(input.semantic_role) ? input.semantic_role : "unknown",
    source: PDF_CANDIDATE_SOURCES.includes(input.source) ? input.source : "parser",
    source_version: cleanText(input.source_version, 120) || "unknown",
    confidence: confidenceNumber(input.confidence),
    method: cleanText(input.method, 120) || "unknown",
    warnings: Array.isArray(input.warnings) ? input.warnings.map((item) => cleanText(item, 180)).filter(Boolean) : [],
    agrees_with: Array.isArray(input.agrees_with) ? input.agrees_with.filter((item) => ["parser", "ocr"].includes(item)) : [],
    contradicts: Array.isArray(input.contradicts) ? input.contradicts.filter((item) => ["parser", "ocr"].includes(item)) : [],
    status: "candidate",
  };
}

export function validatePdfCandidate(candidate) {
  const errors = [];
  const definition = pdfFieldDefinition(candidate?.field);
  if (!definition) errors.push("unknown_field");
  if (!PDF_CANDIDATE_SOURCES.includes(candidate?.source)) errors.push("invalid_source");
  if (!PDF_SEMANTIC_ROLES.includes(candidate?.semantic_role)) errors.push("invalid_semantic_role");
  if (candidate?.normalized_value === null || candidate?.normalized_value === undefined || candidate?.normalized_value === "") errors.push("missing_value");
  if (String(candidate?.evidence || "").length > 360) errors.push("evidence_too_long");
  if (candidate?.page !== null && (!Number.isInteger(candidate.page) || candidate.page < 1)) errors.push("invalid_page");
  if (!Number.isFinite(candidate?.confidence) || candidate.confidence < 0 || candidate.confidence > 100) errors.push("invalid_confidence");
  return { valid: errors.length === 0, errors };
}

export function legacyPdfToCandidates(normalized = {}) {
  const diagnostics = Array.isArray(normalized.diagnostics) ? normalized.diagnostics : [];
  const candidates = [];
  for (const diagnostic of diagnostics) {
    if (!["found", "review"].includes(diagnostic?.status)) continue;
    if (diagnostic.value === null || diagnostic.value === undefined || diagnostic.value === "") continue;
    const field = canonicalPdfField(diagnostic.field);
    if (!pdfFieldDefinition(field)) continue;
    candidates.push(createPdfCandidate({
      field,
      value: diagnostic.value,
      value_text: typeof diagnostic.value === "string" ? diagnostic.value : null,
      value_number: typeof diagnostic.value === "number" ? diagnostic.value : null,
      normalized_value: diagnostic.value,
      commodity: normalized.commodity || "unknown",
      page: diagnostic.page,
      label: diagnostic.label,
      evidence: diagnostic.source_snippet,
      semantic_role: semanticRoleForLegacyField(field, normalized),
      source: "parser",
      source_version: normalized.parser_version || "unknown",
      confidence: diagnostic.confidence,
      method: diagnostic.method,
      warnings: diagnostic.status === "review" ? ["legacy_diagnostic_review"] : [],
    }, candidates.length));
  }
  return candidates;
}

export function aiPdfToCandidates(aiResult = {}, sourceVersion = "unknown") {
  const documentCommodity = aiResult?.document?.commodity || "unknown";
  const candidates = (Array.isArray(aiResult?.candidates) ? aiResult.candidates : []).map((candidate, index) => createPdfCandidate({
    ...candidate,
    field: canonicalPdfField(candidate.field),
    normalized_value: candidate.value_number ?? candidate.value_text,
    commodity: candidate.commodity || documentCommodity,
    source: "ai",
    source_version: sourceVersion,
    method: "gpt41_visual_semantic",
  }, index));

  const firstPage = Array.isArray(aiResult?.page_map) ? aiResult.page_map.find((item) => Number(item?.page) > 0) : null;
  const hasCommodity = candidates.some((candidate) => candidate.field === "commodity");
  const normalizedDocumentCommodity = canonicalCommodity(documentCommodity);
  if (!hasCommodity && ["luce", "gas", "dual"].includes(normalizedDocumentCommodity)) {
    candidates.push(createPdfCandidate({
      field: "commodity",
      value_text: documentCommodity,
      normalized_value: documentCommodity,
      commodity: documentCommodity,
      page: Number(firstPage?.page || 1),
      label: "Fornitura",
      evidence: String(firstPage?.summary || `Commodity visually classified as ${documentCommodity}`).slice(0, 360),
      semantic_role: "classification",
      source: "ai",
      source_version: sourceVersion,
      confidence: 94,
      method: "gpt41_visual_document_metadata",
      warnings: ["derived_from_visual_document_metadata"],
    }, candidates.length));
  }

  const hasKind = candidates.some((candidate) => candidate.field === "kind");
  const documentType = String(aiResult?.document?.document_type || "").trim();
  if (!hasKind && ["bill", "bolletta", "invoice", "synthetic_sheet", "scheda_offerta", "combined_offer_document", "placet", "cte"].includes(documentType)) {
    candidates.push(createPdfCandidate({
      field: "kind",
      value_text: documentType,
      normalized_value: documentType,
      commodity: documentCommodity,
      page: Number(firstPage?.page || 1),
      label: "Tipo documento",
      evidence: String(firstPage?.summary || `Document type visually classified as ${documentType}`).slice(0, 360),
      semantic_role: "classification",
      source: "ai",
      source_version: sourceVersion,
      confidence: 94,
      method: "gpt41_visual_document_metadata",
      warnings: ["derived_from_visual_document_metadata"],
    }, candidates.length));
  }

  return candidates;
}
