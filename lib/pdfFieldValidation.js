export const PDF_FIELD_VALIDATION_VERSION = "v102-field-validation-step4";

export const PDF_FIELD_STATES = Object.freeze([
  "completo",
  "parziale",
  "mancante",
  "da_verificare",
  "non_applicabile",
]);

const DATE_ISO = /^((?:19|20)\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const POD_PATTERN = /^IT\d{3}E[A-Z0-9]{8}$/i;
const PDR_PATTERN = /^\d{14}$/;
const TAX_ID_PATTERN = /^(?:[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]|\d{11})$/i;
const CUSTOMER_CODE_PATTERN = /^(?=.{6,20}$)(?=.*\d)[A-Z0-9]+$/i;

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function finitePositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizedAddress(value) {
  return compact(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[’']/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function addressStreetCivicKey(value) {
  const normalized = normalizedAddress(value);
  if (!normalized) return null;
  const match = normalized.match(/\b(?:VIA|VIALE|PIAZZA|PIAZZALE|CORSO|VICOLO|LARGO|STRADA|CONTRADA|LOCALITA)\b[\s\S]*?\b\d+[A-Z]?(?:\s*[\/]\s*[A-Z0-9]+)?\b/);
  return match ? match[0].replace(/\s+/g, " ").trim() : null;
}

function addressQuality(value) {
  const source = compact(value);
  if (!source) return 0;
  const normalized = normalizedAddress(source);
  const hasStreet = /\b(?:VIA|VIALE|PIAZZA|PIAZZALE|CORSO|VICOLO|LARGO|STRADA|CONTRADA|LOCALITA)\b/.test(normalized);
  const hasCivic = /\b\d+[A-Z]?(?:\s*\/\s*[A-Z0-9]+)?\b/.test(normalized);
  const hasCap = /\b\d{5}\b/.test(normalized);
  const hasProvince = /(?:^|\s)[A-Z]{2}(?:$|\s)/.test(normalized);
  const streetKey = addressStreetCivicKey(source);
  const tail = streetKey ? normalized.slice(normalized.indexOf(streetKey) + streetKey.length).trim() : "";
  const hasLocality = tail.split(/\s+/).filter((token) => token && !/^\d{5}$/.test(token) && !/^[A-Z]{2}$/.test(token)).length >= 1;
  return Number(hasStreet) + Number(hasCivic) + Number(hasCap) + Number(hasProvince) + Number(hasLocality);
}

function sameStreetAndCivic(left, right) {
  const leftKey = addressStreetCivicKey(left);
  const rightKey = addressStreetCivicKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function richerAddress(left, right) {
  if (!left) return right || null;
  if (!right) return left || null;
  const leftScore = addressQuality(left);
  const rightScore = addressQuality(right);
  if (rightScore > leftScore) return right;
  if (leftScore > rightScore) return left;
  return compact(right).length > compact(left).length ? right : left;
}

function setStatus(target, field, status, reason = null, evidence = null) {
  target[field] = {
    status: PDF_FIELD_STATES.includes(status) ? status : "da_verificare",
    reason: reason || null,
    evidence: evidence || null,
  };
}

function statusForPositiveNumber(value, { max = Infinity } = {}) {
  if (!hasValue(value)) return { status: "mancante", reason: "valore_non_estratto" };
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > max) return { status: "da_verificare", reason: "valore_fuori_intervallo" };
  return { status: "completo", reason: null };
}

function isValidIsoDate(value) {
  const match = compact(value).match(DATE_ISO);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function periodStatus(validFrom, validTo) {
  const fromPresent = hasValue(validFrom);
  const toPresent = hasValue(validTo);
  if (!fromPresent && !toPresent) return { status: "mancante", reason: "periodo_non_estratto" };
  if ((fromPresent && !isValidIsoDate(validFrom)) || (toPresent && !isValidIsoDate(validTo))) {
    return { status: "da_verificare", reason: "data_non_valida" };
  }
  if (fromPresent && toPresent) {
    if (String(validFrom) > String(validTo)) return { status: "da_verificare", reason: "decorrenza_successiva_alla_scadenza" };
    return { status: "completo", reason: null };
  }
  return {
    status: "parziale",
    reason: fromPresent ? "manca_scadenza" : "manca_decorrenza",
  };
}

function addressStatus(value) {
  if (!hasValue(value)) return { status: "mancante", reason: "indirizzo_non_estratto" };
  const quality = addressQuality(value);
  if (quality >= 4) return { status: "completo", reason: null };
  if (quality >= 2) return { status: "parziale", reason: "indirizzo_senza_localita_o_cap_completo" };
  return { status: "da_verificare", reason: "indirizzo_non_strutturato" };
}

function typeStatus(normalized, commodity) {
  const suffix = commodity === "luce" ? "luce" : "gas";
  const type = compact(normalized[`tipo_prezzo_${suffix}`]).toLowerCase();
  const evidence = compact(normalized[`tipo_prezzo_evidenza_${suffix}`]).toLowerCase();
  const index = compact(normalized[`indice_riferimento_${suffix}`]).toUpperCase();
  const formula = compact(normalized[`formula_prezzo_${suffix}`]).toUpperCase();
  const spread = normalized[commodity === "luce" ? "spread_luce_eur_kwh" : "spread_gas_eur_smc"];
  if (!type) return { status: "mancante", reason: "tipo_prezzo_non_estratto" };
  if (!["fisso", "variabile", "ibrido"].includes(type)) return { status: "da_verificare", reason: "tipo_prezzo_non_standard" };
  const indexMismatch = commodity === "luce" ? /\bPSV\b/.test(index || formula) : /\bPUN\b/.test(index || formula);
  if (indexMismatch) return { status: "da_verificare", reason: "indice_non_coerente_con_commodity" };
  if (type === "fisso" && (index || finitePositive(spread))) return { status: "da_verificare", reason: "prezzo_fisso_con_indice_o_spread" };
  if (type === "variabile" && !index && !/\b(?:PUN|PSV)\b/.test(formula)) return { status: "parziale", reason: "prezzo_variabile_senza_indice" };
  if (type === "ibrido") {
    const grounded = /hybrid|ibrid|non\s+convenzionale/.test(`${evidence} ${compact(normalized[`nome_offerta_${suffix}`]).toLowerCase()}`);
    if (!grounded) return { status: "da_verificare", reason: "classificazione_ibrida_senza_evidenza" };
    if (!index && !/\b(?:PUN|PSV)\b/.test(formula)) return { status: "parziale", reason: "prezzo_ibrido_senza_indice" };
  }
  return { status: "completo", reason: null };
}

function indexStatus(normalized, commodity) {
  const suffix = commodity === "luce" ? "luce" : "gas";
  const type = compact(normalized[`tipo_prezzo_${suffix}`]).toLowerCase();
  const index = compact(normalized[`indice_riferimento_${suffix}`]);
  if (!index) {
    return ["variabile", "ibrido"].includes(type)
      ? { status: "parziale", reason: "indice_atteso_non_estratto" }
      : { status: "non_applicabile", reason: null };
  }
  if (commodity === "luce" && /\bPSV\b/i.test(index)) return { status: "da_verificare", reason: "indice_gas_su_luce" };
  if (commodity === "gas" && /\bPUN\b/i.test(index)) return { status: "da_verificare", reason: "indice_luce_su_gas" };
  return { status: "completo", reason: null };
}

function offerCodeStatus(value) {
  if (!hasValue(value)) return { status: "mancante", reason: "codice_offerta_non_estratto" };
  return /^[A-Z0-9_.-]{12,100}$/i.test(compact(value))
    ? { status: "completo", reason: null }
    : { status: "da_verificare", reason: "formato_codice_offerta_non_valido" };
}

function identifierStatus(value, pattern, missingReason, invalidReason) {
  if (!hasValue(value)) return { status: "mancante", reason: missingReason };
  return pattern.test(compact(value).replace(/[\s.-]/g, ""))
    ? { status: "completo", reason: null }
    : { status: "da_verificare", reason: invalidReason };
}

function readinessFromFields(fieldStatus, required, recommended = []) {
  const missing = [];
  const review = [];
  const partial = [];
  const missingRecommended = [];
  const partialRecommended = [];
  for (const field of required) {
    const status = fieldStatus[field]?.status || "mancante";
    if (status === "mancante") missing.push(field);
    else if (status === "da_verificare") review.push(field);
    else if (status === "parziale") partial.push(field);
  }
  for (const field of recommended) {
    const status = fieldStatus[field]?.status || "mancante";
    if (status === "mancante") missingRecommended.push(field);
    else if (status === "da_verificare") review.push(field);
    else if (status === "parziale") partialRecommended.push(field);
  }
  let status = "completo";
  if (review.length) status = "da_verificare";
  else if (missing.length) status = "incompleto";
  else if (partial.length) status = "parziale";
  return {
    status,
    missing,
    partial: [...new Set(partial)],
    review: [...new Set(review)],
    missing_recommended: missingRecommended,
    partial_recommended: partialRecommended,
  };
}

function commodityPresent(normalized, commodity) {
  return normalized.commodity === commodity || normalized.commodity === "dual";
}

function addIssue(issues, field, severity, code) {
  if (!issues.some((item) => item.field === field && item.code === code)) issues.push({ field, severity, code });
}

export function completeDualSupplyAddresses(input = {}) {
  const normalized = { ...input };
  const notes = [];
  const generic = compact(normalized.indirizzo_fornitura) || null;
  let luce = compact(normalized.indirizzo_fornitura_luce) || null;
  let gas = compact(normalized.indirizzo_fornitura_gas) || null;

  if (normalized.commodity === "dual") {
    if (!luce && generic) {
      luce = generic;
      notes.push("indirizzo_luce_derivato_da_indirizzo_comune");
    }
    if (!gas && generic) {
      gas = generic;
      notes.push("indirizzo_gas_derivato_da_indirizzo_comune");
    }
    if (luce && gas && sameStreetAndCivic(luce, gas)) {
      const richer = richerAddress(luce, gas);
      if (richer && richer !== luce) {
        luce = richer;
        notes.push("indirizzo_luce_completato_da_indirizzo_gas_stesso_civico");
      }
      if (richer && richer !== gas) {
        gas = richer;
        notes.push("indirizzo_gas_completato_da_indirizzo_luce_stesso_civico");
      }
    }
  } else if (normalized.commodity === "luce" && !luce && generic) {
    luce = generic;
    notes.push("indirizzo_luce_derivato_da_indirizzo_comune");
  } else if (normalized.commodity === "gas" && !gas && generic) {
    gas = generic;
    notes.push("indirizzo_gas_derivato_da_indirizzo_comune");
  }

  normalized.indirizzo_fornitura_luce = luce;
  normalized.indirizzo_fornitura_gas = gas;
  if (!generic) normalized.indirizzo_fornitura = luce || gas || null;
  else normalized.indirizzo_fornitura = generic;
  return { normalized, notes };
}

export function buildPdfFieldValidation(input = {}) {
  const completed = completeDualSupplyAddresses(input);
  const normalized = completed.normalized;
  const fieldStatus = {};
  const validationIssues = [];

  const providerStatus = hasValue(normalized.fornitore)
    ? { status: "completo", reason: null }
    : { status: "mancante", reason: "fornitore_non_estratto" };
  setStatus(fieldStatus, "fornitore", providerStatus.status, providerStatus.reason);

  const customerTypeStatus = ["privato", "business"].includes(normalized.customer_type)
    ? { status: "completo", reason: null }
    : hasValue(normalized.customer_type)
      ? { status: "da_verificare", reason: "profilo_cliente_non_standard" }
      : { status: "mancante", reason: "profilo_cliente_non_estratto" };
  setStatus(fieldStatus, "customer_type", customerTypeStatus.status, customerTypeStatus.reason);

  setStatus(fieldStatus, "intestatario", hasValue(normalized.intestatario) ? "completo" : "mancante", hasValue(normalized.intestatario) ? null : "intestatario_non_estratto");

  const taxStatus = identifierStatus(normalized.codice_fiscale, TAX_ID_PATTERN, "codice_fiscale_non_estratto", "formato_codice_fiscale_non_valido");
  setStatus(fieldStatus, "codice_fiscale", taxStatus.status, taxStatus.reason);
  const customerCodeStatus = identifierStatus(normalized.codice_cliente, CUSTOMER_CODE_PATTERN, "codice_cliente_non_estratto", "formato_codice_cliente_non_valido");
  setStatus(fieldStatus, "codice_cliente", customerCodeStatus.status, customerCodeStatus.reason);

  for (const commodity of ["luce", "gas"]) {
    if (!commodityPresent(normalized, commodity)) {
      for (const field of [
        `indirizzo_fornitura_${commodity}`,
        commodity === "luce" ? "pod" : "pdr",
        commodity === "luce" ? "consumo_luce_kwh" : "consumo_gas_smc",
        commodity === "luce" ? "prezzo_luce_eur_kwh" : "prezzo_gas_eur_smc",
        commodity === "luce" ? "quota_fissa_vendita_luce_eur_anno" : "quota_fissa_vendita_gas_eur_anno",
        `nome_offerta_${commodity}`,
        `codice_offerta_${commodity}`,
        `tipo_prezzo_${commodity}`,
        `indice_riferimento_${commodity}`,
        `validita_condizioni_economiche_${commodity}`,
      ]) setStatus(fieldStatus, field, "non_applicabile");
      continue;
    }

    const addressField = `indirizzo_fornitura_${commodity}`;
    const addressResult = addressStatus(normalized[addressField]);
    setStatus(fieldStatus, addressField, addressResult.status, addressResult.reason);

    const supplyField = commodity === "luce" ? "pod" : "pdr";
    const supplyResult = identifierStatus(
      normalized[supplyField],
      commodity === "luce" ? POD_PATTERN : PDR_PATTERN,
      commodity === "luce" ? "pod_non_estratto" : "pdr_non_estratto",
      commodity === "luce" ? "formato_pod_non_valido" : "formato_pdr_non_valido",
    );
    setStatus(fieldStatus, supplyField, supplyResult.status, supplyResult.reason);

    const consumptionField = commodity === "luce" ? "consumo_luce_kwh" : "consumo_gas_smc";
    const priceField = commodity === "luce" ? "prezzo_luce_eur_kwh" : "prezzo_gas_eur_smc";
    const fixedField = commodity === "luce" ? "quota_fissa_vendita_luce_eur_anno" : "quota_fissa_vendita_gas_eur_anno";
    for (const [field, options] of [
      [consumptionField, { max: 100_000_000 }],
      [priceField, { max: commodity === "luce" ? 5 : 20 }],
      [fixedField, { max: 10_000 }],
    ]) {
      const result = statusForPositiveNumber(normalized[field], options);
      setStatus(fieldStatus, field, result.status, result.reason);
    }

    setStatus(fieldStatus, `nome_offerta_${commodity}`, hasValue(normalized[`nome_offerta_${commodity}`]) ? "completo" : "mancante", hasValue(normalized[`nome_offerta_${commodity}`]) ? null : "nome_offerta_non_estratto");
    const codeResult = offerCodeStatus(normalized[`codice_offerta_${commodity}`]);
    setStatus(fieldStatus, `codice_offerta_${commodity}`, codeResult.status, codeResult.reason);
    const typeResult = typeStatus(normalized, commodity);
    setStatus(fieldStatus, `tipo_prezzo_${commodity}`, typeResult.status, typeResult.reason, normalized[`tipo_prezzo_evidenza_${commodity}`] || null);
    const indexResult = indexStatus(normalized, commodity);
    setStatus(fieldStatus, `indice_riferimento_${commodity}`, indexResult.status, indexResult.reason);
    const validityResult = periodStatus(
      normalized[`decorrenza_condizioni_economiche_${commodity}`],
      normalized[`scadenza_condizioni_economiche_${commodity}`],
    );
    setStatus(fieldStatus, `validita_condizioni_economiche_${commodity}`, validityResult.status, validityResult.reason);

    for (const field of [addressField, supplyField, consumptionField, priceField, fixedField, `tipo_prezzo_${commodity}`, `indice_riferimento_${commodity}`, `validita_condizioni_economiche_${commodity}`]) {
      const status = fieldStatus[field];
      if (status.status === "da_verificare") addIssue(validationIssues, field, "review", status.reason);
      else if (status.status === "parziale") addIssue(validationIssues, field, "partial", status.reason);
    }
  }

  for (const field of ["codice_fiscale", "codice_cliente", "customer_type"]) {
    const status = fieldStatus[field];
    if (status.status === "da_verificare") addIssue(validationIssues, field, "review", status.reason);
  }

  const readiness = { confronto: {}, attivazione: {} };
  for (const commodity of ["luce", "gas"]) {
    if (!commodityPresent(normalized, commodity)) continue;
    const comparisonFields = commodity === "luce"
      ? ["consumo_luce_kwh", "prezzo_luce_eur_kwh", "quota_fissa_vendita_luce_eur_anno"]
      : ["consumo_gas_smc", "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno"];
    readiness.confronto[commodity] = readinessFromFields(fieldStatus, comparisonFields, [
      `tipo_prezzo_${commodity}`,
      `nome_offerta_${commodity}`,
      `validita_condizioni_economiche_${commodity}`,
    ]);
    readiness.attivazione[commodity] = readinessFromFields(fieldStatus, [
      commodity === "luce" ? "pod" : "pdr",
      "codice_fiscale",
      `indirizzo_fornitura_${commodity}`,
      "customer_type",
    ], ["intestatario", "codice_cliente"]);
  }

  const counts = Object.values(fieldStatus).reduce((accumulator, item) => {
    accumulator[item.status] = (accumulator[item.status] || 0) + 1;
    return accumulator;
  }, {
    completo: 0,
    parziale: 0,
    mancante: 0,
    da_verificare: 0,
    non_applicabile: 0,
  });
  const applicable = counts.completo + counts.parziale + counts.mancante + counts.da_verificare;
  const score = applicable ? Math.round(((counts.completo + counts.parziale * 0.5) / applicable) * 100) : 0;

  return {
    normalized,
    fieldStatus,
    readiness,
    completeness: {
      score,
      counts,
      validation_version: PDF_FIELD_VALIDATION_VERSION,
    },
    validationNotes: completed.notes,
    validationIssues,
  };
}

export function applyPdfFieldValidation(input = {}) {
  const validation = buildPdfFieldValidation(input);
  const hasReviewIssue = validation.validationIssues.some((item) => item.severity === "review");
  return {
    ...validation.normalized,
    field_status: validation.fieldStatus,
    readiness: validation.readiness,
    completeness: validation.completeness,
    validation_notes: validation.validationNotes,
    validation_issues: validation.validationIssues,
    needsReview: Boolean(validation.normalized.needsReview || hasReviewIssue),
  };
}
