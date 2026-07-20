function hasPositiveNumber(value) {
  if (value === null || value === undefined || value === "") return false;
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function parseItalianNumber(value) {
  const raw = String(value || "").trim().replace(/[\s']/g, "");
  if (!raw || !/\d/.test(raw)) return null;
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, decimals = 7) {
  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}

function isMissing(value) {
  return value === null || value === undefined || value === "" || value === "unknown";
}

function setWhenMissing(candidate, key, value) {
  if (isMissing(candidate[key]) && !isMissing(value)) candidate[key] = value;
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
    // Errori OCR ricorrenti sui codici POD e sulla dicitura della potenza.
    .replace(/\b1T(?=\d{3}E[A-Z0-9]{8}\b)/g, "IT")
    .replace(/potenza\s+impiegata/gi, "potenza impegnata")
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

function normalizeAddressLine(value) {
  return String(value || "")
    .replace(/[|]/g, " ")
    .replace(/\s*[+*]\s*/g, " - ")
    // Punto OCR spurio tra due parole lunghe del nome strada: "DECIO. RAGGI".
    // Non rimuove abbreviazioni brevi come "S. MARIA".
    .replace(/\b([A-ZÀ-ÖØ-Ý]{4,})\.\s+(?=[A-ZÀ-ÖØ-Ý]{4,}\b)/g, "$1 ")
    .replace(/\s+/g, " ")
    .replace(/\bFORLI[!ÌI]\b/gi, "FORLI'")
    .trim()
    .replace(/[.;,]+$/g, "")
    .trim();
}

function strongestCustomerCode(text) {
  const candidates = [];
  for (const match of String(text || "").matchAll(/codice\s+cliente[\s\S]{0,90}?\b(\d{7,10})\b/gi)) {
    candidates.push({ value: match[1], index: match.index ?? Number.MAX_SAFE_INTEGER });
  }
  candidates.sort((left, right) => right.value.length - left.value.length || left.index - right.index);
  return candidates[0]?.value || null;
}

function supplyHeaderCustomerCode(text) {
  const source = String(text || "");
  const candidates = [];
  for (const match of source.matchAll(/(?:^|\n)[^A-Za-zÀ-ÖØ-öø-ÿ0-9\n]{0,40}(\d{7,10})\s*(?=\n|$)/g)) {
    const start = (match.index ?? 0) + match[0].length;
    const tail = source.slice(start, start + 240);
    const addressMatch = tail.match(/indirizzo\s+(?:di\s+)?fornitura\s*[:：]/i);
    if (!addressMatch) continue;
    candidates.push({
      value: match[1],
      distance: addressMatch.index ?? Number.MAX_SAFE_INTEGER,
      index: match.index ?? Number.MAX_SAFE_INTEGER,
    });
  }
  candidates.sort((left, right) => right.value.length - left.value.length
    || left.distance - right.distance
    || left.index - right.index);
  return candidates[0]?.value || null;
}

function headerCustomerName(text) {
  const opening = String(text || "").slice(0, 3200);
  const match = opening.match(/(?:^|\n)\s*([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý'.-]{1,35}(?:\s+[A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý'.-]{1,35}){1,3})\s*\n\s*(?:VIA|VIALE|PIAZZA|PIAZZALE|CORSO|STRADA|LARGO|VICOLO)\b/i);
  const name = String(match?.[1] || "").replace(/\s+/g, " ").trim();
  if (!name || /UNOENERGY|SERVIZIO|CLIENTE|ENERGIA|NATURALE/i.test(name)) return null;
  return name.toUpperCase();
}

function explicitSupplyAddress(text) {
  const match = String(text || "").match(/indirizzo\s+(?:di\s+)?fornitura\s*[:：]\s*([^\n\r]{8,140})/i);
  return normalizeAddressLine(match?.[1]);
}

function explicitPower(text) {
  const match = String(text || "").match(/potenza\s+impegnata\s*[:：]?\s*([0-9]+(?:[,.][0-9]+)?)\s*kW/i);
  return parseItalianNumber(match?.[1]);
}

function billingPeriodMonths(text) {
  const months = {
    GENNAIO: 1,
    FEBBRAIO: 2,
    MARZO: 3,
    APRILE: 4,
    MAGGIO: 5,
    GIUGNO: 6,
    LUGLIO: 7,
    AGOSTO: 8,
    SETTEMBRE: 9,
    OTTOBRE: 10,
    NOVEMBRE: 11,
    DICEMBRE: 12,
  };
  const match = String(text || "").match(/periodo\s+di\s+(?:riferimento|fatturazione)\s*:\s*([A-ZÀ]+)\s*[-–—]\s*([A-ZÀ]+)(?:\s+(\d{4}))?/i);
  const start = months[String(match?.[1] || "").toUpperCase()];
  const end = months[String(match?.[2] || "").toUpperCase()];
  if (!start || !end) return null;
  return ((end - start + 12) % 12) + 1;
}

function firstLineDecimal(text, pattern) {
  const match = String(text || "").match(pattern);
  return parseItalianNumber(match?.[1]);
}

function receiptCropText(text) {
  const source = String(text || "");
  const index = source.lastIndexOf("OCR_CROP_SCONTRINO");
  return index >= 0 ? source.slice(index + "OCR_CROP_SCONTRINO".length) : "";
}

function longDecimalValues(text, { min = 0, max = 1000 } = {}) {
  const values = [];
  for (const match of String(text || "").matchAll(/\b([0-9]+[,.][0-9]{5,8})\s*€/g)) {
    const parsed = parseItalianNumber(match[1]);
    if (parsed !== null && parsed >= min && parsed <= max) values.push(parsed);
  }
  return [...new Set(values.map((value) => round(value, 6)))];
}

function sellerComponentFromTotalTriad(values) {
  const sorted = [...values].sort((a, b) => a - b);
  for (let totalIndex = sorted.length - 1; totalIndex >= 0; totalIndex -= 1) {
    const total = sorted[totalIndex];
    for (let left = 0; left < sorted.length; left += 1) {
      if (left === totalIndex) continue;
      for (let right = left + 1; right < sorted.length; right += 1) {
        if (right === totalIndex) continue;
        const first = sorted[left];
        const second = sorted[right];
        if (Math.abs(total - first - second) <= 0.0025) return Math.max(first, second);
      }
    }
  }
  return null;
}

function electricityPriceFromReceiptCrop(text) {
  const crop = receiptCropText(text);
  if (!crop) return null;
  const fixedIndex = crop.search(/quota\s+fissa/i);
  const consumptionBlock = fixedIndex >= 0 ? crop.slice(0, fixedIndex) : crop;
  return sellerComponentFromTotalTriad(longDecimalValues(consumptionBlock, { min: 0.001, max: 5 }));
}

function ocrDecimalCandidates(token) {
  const compact = String(token || "").replace(/\s/g, "");
  if (!compact || !/\d/.test(compact)) return [];
  const candidates = new Set();
  const add = (value) => {
    if (Number.isFinite(value) && value > 0.01 && value < 100) candidates.add(round(value, 6));
  };

  const separatorIndex = Math.max(compact.lastIndexOf(","), compact.lastIndexOf("."));
  if (separatorIndex >= 0) {
    const integer = compact.slice(0, separatorIndex).replace(/\D/g, "") || "0";
    const decimals = compact.slice(separatorIndex + 1).replace(/\D/g, "");
    add(Number(`${integer}.${decimals}`));
    if (decimals.length >= 7) {
      for (let index = 0; index < decimals.length; index += 1) {
        const reduced = decimals.slice(0, index) + decimals.slice(index + 1);
        add(Number(`${integer}.${reduced}`));
      }
    }
  } else {
    const digits = compact.replace(/\D/g, "");
    const variants = new Set([digits]);
    if (digits.length >= 8) {
      for (let index = 0; index < digits.length; index += 1) {
        variants.add(digits.slice(0, index) + digits.slice(index + 1));
      }
    }
    for (const variant of variants) {
      for (const decimals of [6, 7]) {
        if (variant.length <= decimals) continue;
        add(Number(`${variant.slice(0, -decimals)}.${variant.slice(-decimals)}`));
      }
    }
  }
  return [...candidates];
}

function fixedRowTokens(block) {
  const tokens = [];
  for (const line of String(block || "").split(/\n/)) {
    const match = line.match(/([0-9](?:[0-9\s.,]{4,12})[0-9])\s*€?/);
    if (match?.[1]) tokens.push(match[1]);
  }
  return tokens.slice(0, 5);
}

function electricityFixedMonthlyFromReceiptCrop(text) {
  const crop = receiptCropText(text);
  if (!crop) return null;
  const fixedIndex = crop.search(/quota\s+fissa/i);
  if (fixedIndex < 0) return null;
  const endIndex = crop.slice(fixedIndex + 1).search(/quota\s+potenza/i);
  const fixedBlock = crop.slice(fixedIndex, endIndex >= 0 ? fixedIndex + 1 + endIndex : fixedIndex + 1600);

  const direct = sellerComponentFromTotalTriad(longDecimalValues(fixedBlock, { min: 0.1, max: 100 }));
  if (direct) return direct;

  const tokens = fixedRowTokens(fixedBlock);
  if (tokens.length < 3) return null;
  const totalCandidates = ocrDecimalCandidates(tokens[0]);
  const sellerCandidates = ocrDecimalCandidates(tokens[1]);
  const networkCandidates = ocrDecimalCandidates(tokens[2]);
  let best = null;
  for (const total of totalCandidates) {
    for (const seller of sellerCandidates) {
      for (const network of networkCandidates) {
        const error = Math.abs(total - seller - network);
        if (seller <= network || total <= seller) continue;
        if (!best || error < best.error) best = { seller, error };
      }
    }
  }
  return best && best.error <= 0.003 ? best.seller : null;
}

function offerFixedTotal(text) {
  return firstLineDecimal(text, /di\s+cui\s+per\s+la\s+quota\s+fissa[^\n\r]{0,120}?([0-9]+[,.][0-9]{2})\s*€/i);
}

function electricitySalePrice(text) {
  return electricityPriceFromReceiptCrop(text)
    || firstLineDecimal(text, /di\s+cu[i1l]\s+spesa\s+per\s*l?a?\s+vendita\s+d['’]?\s*energia\s+elett\w*[^\n\r]{0,170}?([0-9]+[,.][0-9]{5,8})\s*€/i);
}

function stableBandSpread(text) {
  const values = [];
  for (const match of String(text || "").matchAll(/\bSPREAD[_\s-]*F[123]\s*([0-9]+[,.][0-9]{4,8})/gi)) {
    const parsed = parseItalianNumber(match[1]);
    if (parsed !== null) values.push(parsed);
  }
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return max - min <= 0.0000001 ? round(values.reduce((sum, value) => sum + value, 0) / values.length, 7) : null;
}

function selectGasSpreadPerGj(text) {
  const exactSixDecimals = [];
  const all = [];
  for (const match of String(text || "").matchAll(/\bSPREAD\b\s*([0-9]+[,.][0-9]{5,8})/gi)) {
    const token = match[1];
    const parsed = parseItalianNumber(token);
    if (parsed === null) continue;
    all.push(parsed);
    const decimals = String(token).split(/[,.]/)[1]?.length || 0;
    if (decimals === 6) exactSixDecimals.push(parsed);
  }
  const pool = exactSixDecimals.length ? exactSixDecimals : all;
  if (!pool.length) return null;
  const counts = new Map();
  for (const value of pool) {
    const key = round(value, 6).toFixed(6);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const selected = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  return selected ? Number(selected) : null;
}

function selectGasPcs(text) {
  const values = [];
  for (const match of String(text || "").matchAll(/prezzo\s+PCS\s+GJ(?:\s*\/\s*Smc)?\s*[/=:]?\s*([0-9]+[,.][0-9]{5,8})/gi)) {
    const parsed = parseItalianNumber(match[1]);
    if (parsed !== null) values.push(parsed);
  }
  return values.find((value) => value > 0.02 && value < 0.06) || null;
}

function addWarning(candidate, warning) {
  candidate.warnings = [...new Set([...(candidate.warnings || []), warning])];
}

function removeWarnings(candidate, prefixes = []) {
  candidate.warnings = (candidate.warnings || []).filter((warning) => !prefixes.some((prefix) => String(warning).startsWith(prefix)));
}

function applyCommonOcrRecovery(candidate, text) {
  const code = strongestCustomerCode(text);
  if (code && (isMissing(candidate.codice_cliente)
    || (String(candidate.codice_cliente).length < code.length && code.startsWith(String(candidate.codice_cliente))))) {
    candidate.codice_cliente = code;
  }

  // In alcune scansioni Unoenergy la prima pagina tronca l'ultima cifra del
  // codice cliente, mentre l'intestazione dello scontrino nella pagina seguente
  // contiene il codice completo. L'upgrade è ammesso solo se il valore più lungo
  // estende esattamente quello già letto, senza correggere cifre discordanti.
  const supplyHeaderCode = supplyHeaderCustomerCode(text);
  const currentCode = String(candidate.codice_cliente || "");
  if (supplyHeaderCode && (isMissing(candidate.codice_cliente)
    || (supplyHeaderCode.startsWith(currentCode)
      && supplyHeaderCode.length > currentCode.length
      && supplyHeaderCode.length - currentCode.length <= 2))) {
    candidate.codice_cliente = supplyHeaderCode;
    addWarning(candidate, "codice_cliente_ocr_completato_da_intestazione_fornitura");
  }

  const name = headerCustomerName(text);
  setWhenMissing(candidate, "intestatario", name);

  const address = explicitSupplyAddress(text);
  if (address) {
    // L'etichetta esplicita "indirizzo di fornitura" è più affidabile della
    // cattura generica del parser sul testo OCR e conserva i separatori utili.
    candidate.indirizzo_fornitura = address;
    if (["luce", "dual"].includes(candidate.commodity)) candidate.indirizzo_fornitura_luce = address;
    if (["gas", "dual"].includes(candidate.commodity)) candidate.indirizzo_fornitura_gas = address;
  }

  const power = explicitPower(text);
  if (power && ["luce", "dual"].includes(candidate.commodity)) {
    setWhenMissing(candidate, "potenza_impegnata_kw", power);
  }
}

function applyUnoenergyElectricityRecovery(candidate, text) {
  if (!/unoenergy/i.test(String(candidate.fornitore || text)) || !candidate.pod || candidate.pdr) return;

  const salePrice = electricitySalePrice(text);
  if (salePrice && salePrice > 0 && salePrice < 5) {
    candidate.prezzo_luce_eur_kwh = round(salePrice, 8);
    removeWarnings(candidate, ["prezzo_luce"]);
  }

  const months = billingPeriodMonths(text);
  const fixedTotal = offerFixedTotal(text);
  const cropMonthly = electricityFixedMonthlyFromReceiptCrop(text);
  const monthly = cropMonthly || (months && fixedTotal ? fixedTotal / months : null);
  if (monthly && monthly > 0 && monthly < 1000) {
    candidate.quota_fissa_vendita_luce_eur_anno = round(monthly * 12, 6);
    candidate.quota_fissa_vendita_luce_method = "monthly_times_12";
    removeWarnings(candidate, ["quota_fissa_luce"]);
    addWarning(candidate, cropMonthly
      ? "quota_fissa_luce_ocr_derivata_da_triad_tabella"
      : "quota_fissa_luce_ocr_derivata_da_totale_periodo");
  }

  if (/\bPUN(?:[_\s-]+MEDIO)?[_\s-]+MESE(?=[_\s-]|$)/i.test(text)) {
    candidate.indice_riferimento_luce = "PUN";
    candidate.indice_riferimento = "PUN";
  }
  if (/prezzo\s+indicizzato\s+mensile/i.test(text)
    || /periodicit[aà]\s+aggiornamento\s+indice[\s\S]{0,140}?mensile/i.test(text)) {
    candidate.periodicita_aggiornamento_indice_luce = "mensile";
    candidate.periodicita_aggiornamento_indice = "mensile";
  }
  if (/tipologia\s+di\s+prezzo[\s\S]{0,140}?per\s+fasce/i.test(text)
    || /prezzo\s+indicizzato\s+mensile[\s\S]{0,220}?per\s+fasce/i.test(text)) {
    candidate.struttura_prezzo_luce = "per fasce";
    candidate.struttura_prezzo = "per fasce";
  }

  const bandSpread = stableBandSpread(text);
  if (bandSpread && /prezzo\s*=.*PUN[\s\S]{0,220}?spread/i.test(text)) {
    candidate.spread_luce_eur_kwh = bandSpread;
    removeWarnings(candidate, ["spread_luce"]);
    addWarning(candidate, "spread_luce_ocr_unita_inferita_da_formula_pun");
  }
}

function applyUnoenergyGasRecovery(candidate, text) {
  if (!/unoenergy/i.test(String(candidate.fornitore || text)) || !candidate.pdr || candidate.pod) return;

  if (/\bPSV\s+MESE\b/i.test(text)) {
    candidate.indice_riferimento_gas = "PSV";
    candidate.indice_riferimento = "PSV";
  }
  if (/periodicit[aà]\s+aggiornamento\s+indice[\s\S]{0,140}?mensile/i.test(text)
    || /prezzo\s+indicizzato\s+mensile/i.test(text)) {
    candidate.periodicita_aggiornamento_indice_gas = "mensile";
    candidate.periodicita_aggiornamento_indice = "mensile";
  }

  const spreadPerGj = selectGasSpreadPerGj(text);
  const pcs = selectGasPcs(text);
  const multiplicationShown = /prezzo\s*=[^\n\r]{0,300}\*/i.test(text)
    || /spread[^\n\r]{0,160}\*[\s\S]{0,80}?PCS/i.test(text);
  if (spreadPerGj && pcs && multiplicationShown) {
    const equivalentPerSmc = spreadPerGj * pcs;
    if (equivalentPerSmc > 0 && equivalentPerSmc < 5) {
      candidate.spread_gas_eur_smc = round(equivalentPerSmc, 7);
      removeWarnings(candidate, ["spread_gas"]);
      addWarning(candidate, "spread_gas_ocr_derivato_da_eur_gj_per_pcs");
    }
  }
}

/**
 * Corregge soltanto incongruenze create dal layout OCR, usando POD/PDR come
 * indicatori forti. Non inventa valori; le conversioni sono consentite solo
 * quando formula, unità e coefficiente sono tutti presenti nel testo OCR.
 */
export function normalizePdfOcrCandidate(input = {}, { text = "" } = {}) {
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

  const warnings = new Set(candidate.warnings || []);
  const ambiguousSpreadFields = [
    ["spread_luce_eur_kwh", "spread_luce_unita_non_esplicita", "spread_luce_ocr_unita_ambigua_omesso"],
    ["spread_gas_eur_smc", "spread_gas_unita_non_esplicita", "spread_gas_ocr_unita_ambigua_omesso"],
  ];
  for (const [field, parserWarning, ocrWarning] of ambiguousSpreadFields) {
    if (!warnings.has(parserWarning)) continue;
    candidate[field] = null;
    warnings.delete(parserWarning);
    warnings.add(ocrWarning);
  }
  candidate.warnings = [...warnings];

  applyCommonOcrRecovery(candidate, text);
  applyUnoenergyElectricityRecovery(candidate, text);
  applyUnoenergyGasRecovery(candidate, text);

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
