function hasPositiveNumber(value) {
  if (value === null || value === undefined || value === "") return false;
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function canonicalAnnualLines(text) {
  const lines = [];
  const pattern = /consumo\s+(?:annuo|annuale)\s*:[\s\S]{0,260}?\b(?:da\s+)?\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}\s+a\s+\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}\s*:\s*([0-9]{1,3}(?:[.\s][0-9]{3})*(?:,[0-9]+)?|[0-9]+(?:[.,][0-9]+)?)\s*(Smc|kWh)\b/gi;
  for (const match of String(text || "").matchAll(pattern)) {
    lines.push(`Consumo annuo: ${match[1].trim()} ${match[2]}`);
  }
  return [...new Set(lines)];
}

/**
 * Correzioni conservative applicate soltanto al testo prodotto dall'OCR.
 * Non modifica mai il testo estratto normalmente dal PDF.
 */
export function normalizePdfOcrText(value = "") {
  let normalized = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    // Tesseract confonde spesso la c finale di Smc con e/E nelle bollette.
    .replace(/\bSM[Ee]\b/g, "Smc")
    .replace(/\bSm[Ee]\b/g, "Smc")
    .replace(/\bsM[Ee]\b/g, "Smc")
    .replace(/\bKWH\b/g, "kWh")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  const annualLines = canonicalAnnualLines(normalized);
  if (annualLines.length) normalized = `${normalized}\n${annualLines.join("\n")}`;
  return normalized;
}

const OFFER_SUFFIXES = [
  "nome_offerta",
  "codice_offerta",
  "tipo_prezzo",
  "tipo_prezzo_evidenza",
  "indice_riferimento",
  "decorrenza_condizioni_economiche",
  "scadenza_condizioni_economiche",
  "struttura_prezzo",
  "periodicita_aggiornamento_indice",
  "frequenza_fatturazione",
  "formula_prezzo",
  "onere_recesso_anticipato",
  "codice_condizioni_economiche",
  "altre_caratteristiche_offerta",
  "scadenza_contratto",
];

function copyOfferSide(candidate, from, to) {
  for (const prefix of OFFER_SUFFIXES) {
    const fromKey = `${prefix}_${from}`;
    const toKey = `${prefix}_${to}`;
    if ((candidate[toKey] === null || candidate[toKey] === undefined || candidate[toKey] === "")
      && candidate[fromKey] !== null && candidate[fromKey] !== undefined && candidate[fromKey] !== "") {
      candidate[toKey] = candidate[fromKey];
    }
    candidate[fromKey] = null;
  }
  const arrays = ["componenti_prezzo", "sconti_offerta"];
  for (const prefix of arrays) {
    const fromKey = `${prefix}_${from}`;
    const toKey = `${prefix}_${to}`;
    if ((!Array.isArray(candidate[toKey]) || candidate[toKey].length === 0)
      && Array.isArray(candidate[fromKey]) && candidate[fromKey].length) {
      candidate[toKey] = candidate[fromKey];
    }
    candidate[fromKey] = [];
  }
}

function rejectNoisyOfferName(candidate, side) {
  const key = side ? `nome_offerta_${side}` : "nome_offerta";
  if (/bollett[ae]\s+precedent|stato\s+pagament|totale\s+da\s+pagare/i.test(String(candidate[key] || ""))) {
    candidate[key] = null;
  }
}

/**
 * Corregge soltanto incongruenze create dal layout OCR, usando POD/PDR come
 * indicatori forti. Non inventa valori e non converte spread tra unità diverse.
 */
export function normalizePdfOcrCandidate(input = {}) {
  const candidate = { ...input };
  rejectNoisyOfferName(candidate, null);
  rejectNoisyOfferName(candidate, "luce");
  rejectNoisyOfferName(candidate, "gas");

  const hasLuceIdentifier = Boolean(candidate.pod);
  const hasGasIdentifier = Boolean(candidate.pdr);
  const hasLuceNumeric = hasPositiveNumber(candidate.consumo_luce_kwh)
    || hasPositiveNumber(candidate.prezzo_luce_eur_kwh)
    || hasPositiveNumber(candidate.potenza_impegnata_kw);
  const hasGasNumeric = hasPositiveNumber(candidate.consumo_gas_smc)
    || hasPositiveNumber(candidate.prezzo_gas_eur_smc);

  if (hasGasIdentifier && !hasLuceIdentifier && !hasLuceNumeric) {
    copyOfferSide(candidate, "luce", "gas");
    candidate.indirizzo_fornitura_gas = candidate.indirizzo_fornitura_gas
      || candidate.indirizzo_fornitura_luce
      || candidate.indirizzo_fornitura
      || null;
    candidate.indirizzo_fornitura_luce = null;
    candidate.commodity = "gas";
    candidate.nome_offerta = candidate.nome_offerta_gas || candidate.nome_offerta || null;
    candidate.codice_offerta = candidate.codice_offerta_gas || candidate.codice_offerta || null;
    candidate.tipo_prezzo = candidate.tipo_prezzo_gas || candidate.tipo_prezzo || null;
    candidate.indice_riferimento = candidate.indice_riferimento_gas || candidate.indice_riferimento || null;
    candidate.spread_luce_eur_kwh = null;
    candidate.warnings = (candidate.warnings || []).filter((warning) => !String(warning).startsWith("spread_luce"));
  } else if (hasLuceIdentifier && !hasGasIdentifier && !hasGasNumeric) {
    copyOfferSide(candidate, "gas", "luce");
    candidate.indirizzo_fornitura_luce = candidate.indirizzo_fornitura_luce
      || candidate.indirizzo_fornitura_gas
      || candidate.indirizzo_fornitura
      || null;
    candidate.indirizzo_fornitura_gas = null;
    candidate.commodity = "luce";
    candidate.nome_offerta = candidate.nome_offerta_luce || candidate.nome_offerta || null;
    candidate.codice_offerta = candidate.codice_offerta_luce || candidate.codice_offerta || null;
    candidate.tipo_prezzo = candidate.tipo_prezzo_luce || candidate.tipo_prezzo || null;
    candidate.indice_riferimento = candidate.indice_riferimento_luce || candidate.indice_riferimento || null;
    candidate.spread_gas_eur_smc = null;
    candidate.warnings = (candidate.warnings || []).filter((warning) => !String(warning).startsWith("spread_gas"));
  }

  for (const key of ["quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno"]) {
    if (hasPositiveNumber(candidate[key])) candidate[key] = Math.round(Number(candidate[key]) * 1_000_000) / 1_000_000;
  }

  return candidate;
}

export function hasComparableOcrCore(normalized = {}) {
  const hasLuce = ["luce", "dual"].includes(normalized.commodity);
  const hasGas = ["gas", "dual"].includes(normalized.commodity);
  const luceReady = !hasLuce || Boolean(
    normalized.pod
    && hasPositiveNumber(normalized.consumo_luce_kwh)
    && hasPositiveNumber(normalized.prezzo_luce_eur_kwh),
  );
  const gasReady = !hasGas || Boolean(
    normalized.pdr
    && hasPositiveNumber(normalized.consumo_gas_smc)
    && hasPositiveNumber(normalized.prezzo_gas_eur_smc),
  );
  return Boolean(normalized.recognized && (hasLuce || hasGas) && luceReady && gasReady);
}
