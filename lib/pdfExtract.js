import fs from "node:fs/promises";

const MINUS_PATTERN = /[−–—]/g;

function normalizeMinus(value) {
  return String(value ?? "").replace(MINUS_PATTERN, "-");
}

function numberFromItalian(value, { preferDecimal = false } = {}) {
  if (value === undefined || value === null) return null;
  const raw = normalizeMinus(value).trim().replace(/[\u00A0\s']/g, "");
  if (!raw || !/[0-9]/.test(raw)) return null;

  let normalized = raw;
  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");

  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(/,/g, "");
  } else if (comma >= 0) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (dot >= 0) {
    const unsigned = raw.replace(/^[+-]/, "");
    const parts = unsigned.split(".");
    const startsWithZero = /^0\./.test(unsigned);
    const thousands = parts.length > 1 && parts.slice(1).every((part) => /^\d{3}$/.test(part));
    if (thousands && !preferDecimal && !startsWithZero) normalized = raw.replace(/\./g, "");
  }

  const number = Number.parseFloat(normalized);
  return Number.isFinite(number) ? number : null;
}

function matchNumber(text, patterns, options) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const parsed = numberFromItalian(match[1], options);
    if (parsed !== null) return parsed;
  }
  return null;
}

function matchText(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = String(match?.[1] ?? "").replace(/\s+/g, " ").trim();
    if (value) return value;
  }
  return null;
}

function normalizePod(value) {
  if (!value) return null;
  const normalized = String(value).toUpperCase().replace(/[\s.-]/g, "");
  return /^IT\d{3}E[A-Z0-9]{8}$/.test(normalized) ? normalized : null;
}

function normalizePdr(value) {
  if (!value) return null;
  const normalized = String(value).replace(/\D/g, "");
  return /^\d{14}$/.test(normalized) ? normalized : null;
}

function detectProvider(text) {
  const providers = [
    [/\b(?:eni\s+)?plenitude\b/i, "Eni Plenitude"],
    [/\bdolomiti\s+energia\b/i, "Dolomiti Energia"],
    [/\bhera(?:\s+comm)?\b/i, "Hera Comm"],
    [/\bbutangas\b/i, "ButanGas"],
    [/\be[.\s-]*on\b/i, "E.ON"],
    [/\bacea(?:\s+energia)?\b/i, "Acea Energia"],
    [/\bpulsee\b/i, "Pulsee"],
    [/\billumia\b/i, "Illumia"],
    [/\benel\s+energia\b/i, "Enel Energia"],
  ];
  const header = String(text).slice(0, 12000);
  return providers
    .map(([pattern, label]) => {
      const match = header.match(pattern);
      return match && Number.isInteger(match.index) ? { label, index: match.index } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index)[0]?.label || "";
}

function detectDocumentKind(lower) {
  const opening = lower.slice(0, 6000);
  const strongBill = ["scontrino dell'energia", "scontrino dell’energia", "totale da pagare", "periodo di fatturazione", "fattura elettronica"].filter((x) => lower.includes(x)).length;
  if (strongBill >= 2) return "bolletta";
  if (["scheda sintetica", "condizioni tecnico economiche", "condizioni tecnico-economiche", "scheda di confrontabilità", "documentazione precontrattuale"].some((x) => opening.includes(x))) return "scheda_offerta";
  if (["bolletta", "fattura", "codice pod", "codice pdr"].some((x) => opening.includes(x))) return "bolletta";
  return "unknown";
}

function validatedNumber(value, { field, min = 0, max, warnings }) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < min || (Number.isFinite(max) && value > max)) {
    warnings.push(`${field}_fuori_intervallo`);
    return null;
  }
  return value;
}

function annualConsumption(text, unit) {
  const wanted = unit.toLowerCase();
  const direct = matchNumber(text, [
    new RegExp(`in\\s+un\\s+anno\\s+hai\\s+consumato[\\s\\S]{0,260}?([0-9][0-9.,]*)\\s*${wanted}`, "i"),
    new RegExp(`consumo\\s+annuo\\s*\\(${wanted}\\)\\s*[:：]?\\s*([0-9][0-9.,]*)`, "i"),
    new RegExp(`(?:totale\\s+)?consumo\\s+annuo\\s*[:：]?\\s*([0-9][0-9.,]*)\\s*${wanted}`, "i"),
  ]);
  if (direct !== null) return direct;

  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!/(?:totale\s+)?consumo\s+annuo|in\s+un\s+anno\s+hai\s+consumato/i.test(lines[i])) continue;
    const window = lines.slice(i, i + 2).join(" ");
    const candidates = [];
    for (const match of window.matchAll(new RegExp(`([0-9][0-9.,]*)\\s*${wanted}`, "ig"))) {
      const value = numberFromItalian(match[1]);
      if (value !== null) candidates.push(value);
    }
    if (candidates.length) return Math.max(...candidates);
  }
  return null;
}

function extractBillPrice(text, commodity) {
  const compact = String(text).replace(/[ \t]+/g, " ");
  const label = commodity === "luce" ? "energia\\s+elettrica" : "gas\\s+naturale";
  const unit = commodity === "luce" ? "kwh" : "smc";
  return matchNumber(compact, [
    new RegExp(`spesa\\s+per\\s+(?:la\\s+)?vendita\\s+(?:di\\s+)?${label}[\\s\\S]{0,180}?quota\\s+per\\s+consumi[\\s\\S]{0,80}?([0-9]+(?:[,.][0-9]+)?)\\s*€\\s*\/?${unit}`, "i"),
    new RegExp(`spesa\\s+per\\s+(?:la\\s+)?vendita\\s+(?:di\\s+)?${label}[\\s\\S]{0,120}?([0-9]+(?:[,.][0-9]+)?)\\s*€\\s*\/?${unit}`, "i"),
    commodity === "luce"
      ? /di\s+cui\s+spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?energia\s+([0-9]+[,.][0-9]{3,})[\s\S]{0,100}?elettrica\s+€\/kwh/i
      : /di\s+cui\s+spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?gas\s+([0-9]+[,.][0-9]{3,})[\s\S]{0,100}?naturale\s+€\/smc/i,
    new RegExp(`quota\\s+per\\s+consumi[\\s\\S]{0,700}?di\\s+cui\\s+spesa\\s+per\\s+(?:la\\s+)?vendita\\s+(?:di\\s+)?${label}[\\s\\S]{0,120}?([0-9]+[,.][0-9]{3,})[\\s\\S]{0,150}?€\\s*\/?${unit}`, "i"),
    new RegExp(`di\\s+cui\\s+spesa\\s+per\\s+(?:la\\s+)?vendita\\s+(?:di\\s+)?${label}[\\s\\S]{0,120}?([0-9]+[,.][0-9]{3,})[\\s\\S]{0,150}?€\\s*\/?${unit}`, "i"),
  ], { preferDecimal: true });
}

function extractMonthlyFixed(text, commodity) {
  const compact = String(text).replace(/[ \t]+/g, " ");
  const label = commodity === "luce" ? "energia\\s+elettrica" : "gas\\s+naturale";
  return matchNumber(compact, [
    commodity === "luce"
      ? /quota\s+fissa[\s\S]{0,700}?di\s+cui\s+spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?energia\s+([0-9]+[,.][0-9]{3,})[\s\S]{0,100}?elettrica\s+€\/mese/i
      : /quota\s+fissa[\s\S]{0,700}?di\s+cui\s+spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?gas\s+([0-9]+[,.][0-9]{3,})[\s\S]{0,100}?naturale\s+€\/mese/i,
    new RegExp(`quota\\s+fissa[\\s\\S]{0,700}?di\\s+cui\\s+spesa\\s+per\\s+(?:la\\s+)?vendita\\s+(?:di\\s+)?${label}[\\s\\S]{0,120}?([0-9]+[,.][0-9]{3,})[\\s\\S]{0,150}?€\\s*\/?mese`, "i"),
  ], { preferDecimal: true });
}

function extractOfferData(text, lower) {
  const nomeOfferta = matchText(text, [
    /E[.\s-]*ON\s+([^\n\r]+?)\s+-\s+codice offerta/i,
    /(?:energia elettrica|gas naturale)\s*-\s*([^\n\r]+?)\s*-\s*codice offerta/i,
    /nome\s+offerta\s*:\s*([^\n\r]{2,100})/i,
    /\bofferta\s*:\s*([^\n\r]{2,100})/i,
  ]);
  const codiceOfferta = matchText(text, [/codice\s+offerta\s*:\s*([A-Z0-9_-]{12,})/i]);
  let tipoPrezzo = null;
  if (/prezzo\s+(?:variabile|indicizzato)|tipologia\s+(?:di\s+)?offerta\s*:\s*prezzo\s+variabile/i.test(lower)) tipoPrezzo = "variabile";
  if (/prezzo\s+fisso|tipologia\s+(?:di\s+)?offerta\s*:\s*(?:a\s+)?prezzo\s+fisso/i.test(lower)) tipoPrezzo = "fisso";
  const indice = matchText(text, [
    /indice\s+di\s+riferimento\s*:\s*(PUN(?:\s+Index(?:\s+GME)?)?|PSV(?:DA|\s+day\s+ahead)?)/i,
    /\bindice\b[\s\S]{0,120}?(PUN(?:\s+Index(?:\s+GME)?)?|PSV(?:DA|\s+day\s+ahead)?)/i,
  ]);
  const spreadLuce = matchNumber(text, [/(?:PUN[^\n]{0,80}?\+|spread\s*)\s*([\d.,]+)\s*€?\s*\/\s*kwh/i, /totale\s+PUN[^+]{0,50}\+\s*([\d.,]+)\s*€\/kwh/i], { preferDecimal: true });
  const spreadGas = matchNumber(text, [/(?:PSV[^\n]{0,80}?\+|spread\s*)\s*([\d.,]+)\s*€?\s*\/\s*smc/i], { preferDecimal: true });
  const costoFissoAnno = matchNumber(text, [
    /costo\s+fisso\s+anno[\s\S]{0,300}?([\d.,]+)\s*€\s*\/\s*anno/i,
    /corrispettivo\s+(?:fisso|annuo)[^\d]{0,50}([\d.,]+)\s*€\s*\/\s*anno/i,
  ], { preferDecimal: true });
  return { nomeOfferta, codiceOfferta, tipoPrezzo, indice, spreadLuce, spreadGas, costoFissoAnno };
}

function normalizeAddress(value) {
  if (!value) return null;
  const normalized = String(value)
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim()
    .replace(/[|;]+$/g, "")
    .trim();
  return normalized.length >= 5 ? normalized : null;
}

function extractAddressNearSupplyHeader(text, commodity) {
  const source = String(text || "");
  const marker = commodity === "gas" ? "PDR" : "POD";
  const codePattern = commodity === "gas" ? "(?:\\d[\\s.-]*){14}" : "IT(?:[\\s.-]*[A-Z0-9]){12}";
  const header = new RegExp(`indirizzo\\s+di\\s+fornitura[\\s\\S]{0,90}?${marker}[\\s\\S]{0,260}?(${codePattern})`, "i");
  const match = source.match(header);
  if (!match || typeof match.index !== "number") return null;

  const segment = source.slice(match.index, match.index + 360);
  const afterHeader = segment
    .replace(/^.*?indirizzo\s+di\s+fornitura[^\n\r]*/i, "")
    .replace(new RegExp(codePattern, "i"), " __CODE__ ")
    .replace(/\b\d+(?:[,.]\d+)?\s*kW\b/ig, " __POWER__ ")
    .replace(/\b(?:matricola|potenza\s+impegnata|potenza\s+disponibile)\b/ig, " ");
  const candidate = afterHeader.split(/__CODE__|__POWER__/)[0];
  return normalizeAddress(candidate);
}

function extractActivationData(text) {
  const source = String(text || "");
  const customerOpening = source.slice(0, 10000);
  const codiceFiscale = matchText(source, [
    /codice\s+fiscale\s*\/\s*partita\s+iva[\s\S]{0,120}?\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/i,
    /codice\s+fiscale\s*\/\s*partita\s+iva\s*[:：]\s*\b(\d{11})\b/i,
    /i\s+tuoi\s+dati\s+identificativi[\s\S]{0,300}?codice\s+fiscale\s*[:：]?\s*\b([A-Z0-9]{11,16})\b/i,
    /intestata\s+a[\s\S]{0,500}?codice\s+fiscale\s*[:：]\s*\b([A-Z0-9]{11,16})\b/i,
    /codice\s+fiscale\s*[:：]\s*\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]|\d{11})\b/i,
    /codice\s+fiscale(?:\s*\/\s*partita\s+iva)?\s*[:：]?\s*\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/i,
  ]);
  const codiceCliente = matchText(source, [
    /codice\s+cliente\s*[:：]?\s*([A-Z0-9]{6,20})/i,
    /numero\s+cliente[\s\S]{0,300}?\b([0-9]{8,20})\b/i,
  ]);
  const indirizzoGas = extractAddressNearSupplyHeader(source, "gas");
  const indirizzoLuce = extractAddressNearSupplyHeader(source, "luce");
  let indirizzoFornitura = indirizzoLuce || indirizzoGas || matchText(source, [
    /indirizzo\s+di\s+fornitura\s*[:：]\s*([^\n\r]{5,120})/i,
    /servizio\s+fornito\s+in\s*[:：]?\s*([^\n\r]{5,120})/i,
  ]);
  indirizzoFornitura = normalizeAddress(indirizzoFornitura);
  if (indirizzoFornitura && /punto di (?:prelievo|riconsegna)|box dell'offerta/i.test(indirizzoFornitura)) indirizzoFornitura = null;
  const intestatario = matchText(source, [
    /contratto\s+intestato\s+a\s*[:：]?\s*([A-ZÀ-ÖØ-Ý' .&-]{4,100})/i,
    /i\s+tuoi\s+dati\s+identificativi[\s\S]{0,100}?\n\s*([A-ZÀ-ÖØ-Ý' .&-]{4,100})\s*\n/i,
    /intestata\s+a\s+([A-ZÀ-ÖØ-Ý' .&-]{4,100})/i,
  ]);
  return {
    codiceFiscale,
    codiceCliente,
    indirizzoFornitura,
    indirizzoFornituraLuce: indirizzoLuce,
    indirizzoFornituraGas: indirizzoGas,
    intestatario,
  };
}

function detectCustomerType(text, activation = {}) {
  const source = String(text || "");
  const opening = source.slice(0, 14000);
  const lower = source.toLowerCase();
  const businessPatterns = [
    /client[ei]\s+non\s+domestic[io]/i,
    /tipologia\s+(?:di\s+)?cliente\s*:\s*(?:non\s+domestico|altri\s+usi|microbusiness|business)/i,
    /uso\s+(?:non\s+domestico|diverso\s+dall['’]abitazione)/i,
    /\bmicrobusiness\b/i,
  ];
  const privatePatterns = [
    /tipologia\s+(?:di\s+)?cliente\s*:\s*domestico(?:\s+residente|\s+non\s+residente)?/i,
    /\bdomestico\s+residente\b/i,
    /\buso\s+domestico\b/i,
    /client[ei]\s+domestic[io]/i,
  ];
  const companyName = /\b(?:s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|societ[aà]|cooperativa|studio\s+associato)\b/i.test(activation.intestatario || "");
  const customerVat = /^\d{11}$/.test(String(activation.codiceFiscale || ""));
  const businessEvidence = businessPatterns.find((pattern) => pattern.test(source));
  const privateEvidence = privatePatterns.find((pattern) => pattern.test(source));

  if (businessEvidence || companyName || customerVat) {
    return {
      type: "business",
      confidence: businessEvidence || companyName ? "high" : "medium",
      evidence: businessEvidence ? String(source.match(businessEvidence)?.[0] || "utenza non domestica") : companyName ? "ragione sociale" : "partita IVA cliente",
    };
  }
  if (privateEvidence) {
    return {
      type: "privato",
      confidence: "high",
      evidence: String(source.match(privateEvidence)?.[0] || "utenza domestica"),
    };
  }
  if (/\babitazione\b|canone\s+di\s+abbonamento\s+alla\s+televisione/i.test(lower)) {
    return { type: "privato", confidence: "medium", evidence: "riferimento abitazione" };
  }
  return { type: "unknown", confidence: "low", evidence: "" };
}

export function extractPdfDataFromText(text = "") {
  const sourceText = String(text || "");
  const lower = sourceText.toLowerCase();
  const warnings = [];
  const kind = detectDocumentKind(lower);

  const rawConsumoLuce = annualConsumption(sourceText, "kwh");
  let rawConsumoGas = annualConsumption(sourceText, "smc");
  const consumoGasMc = matchNumber(sourceText, [
    /consumo\s+annuo\s*\(mc\)\s*[:：]?[\s\S]{0,45}?([\d\s.,]+)/i,
    /consumo\s+annuo\s+mc[\s\S]{0,60}?([\d\s.,]+)(?:\s+fino|\n)/i,
  ]);
  const coefficienteC = matchNumber(sourceText, [/coefficiente(?:\s+correttivo)?\s*\(C\)\s*[:：]?\s*([\d.,]+)/i, /coefficiente\s+C\*?\s*[:：]?\s*([\d.,]+)/i], { preferDecimal: true });
  if (!rawConsumoGas && consumoGasMc && coefficienteC) {
    rawConsumoGas = Math.round(consumoGasMc * coefficienteC * 1000) / 1000;
    warnings.push("consumo_gas_convertito_da_mc_a_smc");
  }

  const rawPrezzoLuce = kind === "scheda_offerta" ? null : extractBillPrice(sourceText, "luce");
  const rawPrezzoGas = kind === "scheda_offerta" ? null : extractBillPrice(sourceText, "gas");
  const fissoLuceMese = kind === "scheda_offerta" ? null : extractMonthlyFixed(sourceText, "luce");
  const fissoGasMese = kind === "scheda_offerta" ? null : extractMonthlyFixed(sourceText, "gas");
  const offer = extractOfferData(sourceText, lower);

  const pod = normalizePod(matchText(sourceText, [
    /(?:codice\s+)?POD\s*[:：]?\s*(IT(?:[\s.-]*[A-Z0-9]){12})/i,
    /indirizzo\s+di\s+fornitura[\s\S]{0,100}?POD[\s\S]{0,280}?(IT(?:[\s.-]*[A-Z0-9]){12})/i,
    /punto\s+di\s+prelievo\s*\(POD\)[\s\S]{0,220}?(IT(?:[\s.-]*[A-Z0-9]){12})/i,
    /\b(IT\d{3}E[A-Z0-9]{8})\b/i,
  ]));
  const pdr = normalizePdr(matchText(sourceText, [
    /(?:codice\s+)?PDR\s*[:：]?\s*((?:\d[\s.-]*){14})/i,
    /indirizzo\s+di\s+fornitura[\s\S]{0,100}?PDR[\s\S]{0,280}?((?:\d[\s.-]*){14})/i,
    /punto\s+di\s+riconsegna\s*\(PDR\)[\s\S]{0,220}?((?:\d[\s.-]*){14})/i,
  ]));
  const rawPotenzaImpegnata = matchNumber(sourceText, [
    /potenza\s+impegnata\s*[:：]?\s*([\d.,]+)\s*kW/i,
    /potenza\s+contrattualmente\s+impegnata\s*[:：]?\s*([\d.,]+)\s*kW/i,
    /indirizzo\s+di\s+fornitura[\s\S]{0,100}?potenza\s+impegnata[\s\S]{0,260}?([\d.,]+)\s*kW\s*IT/i,
    /\b([\d.,]+)\s*kW\s*IT\d{3}E[A-Z0-9]{8}\b/i,
  ], { preferDecimal: true });
  const rawPotenzaDisponibile = matchNumber(sourceText, [
    /potenza\s+disponibile\s*[:：]?\s*([\d.,]+)\s*kW/i,
    /IT\d{3}E[A-Z0-9]{8}\s*([\d.,]+)\s*kW/i,
  ], { preferDecimal: true });

  const consumoLuce = validatedNumber(rawConsumoLuce, { field: "consumo_luce", max: 100_000_000, warnings });
  const consumoGas = validatedNumber(rawConsumoGas, { field: "consumo_gas", max: 100_000_000, warnings });
  const prezzoLuce = validatedNumber(rawPrezzoLuce, { field: "prezzo_luce", max: 5, warnings });
  const prezzoGas = validatedNumber(rawPrezzoGas, { field: "prezzo_gas", max: 20, warnings });
  const potenzaImpegnata = validatedNumber(rawPotenzaImpegnata, { field: "potenza_impegnata", max: 1000, warnings });
  const potenzaDisponibile = validatedNumber(rawPotenzaDisponibile, { field: "potenza_disponibile", max: 1000, warnings });

  let fixedLuceAnnual = validatedNumber(fissoLuceMese ? fissoLuceMese * 12 : null, { field: "quota_fissa_luce", max: 10_000, warnings });
  let fixedGasAnnual = validatedNumber(fissoGasMese ? fissoGasMese * 12 : null, { field: "quota_fissa_gas", max: 10_000, warnings });
  if (kind === "scheda_offerta" && offer.costoFissoAnno) {
    const offerOpening = sourceText.slice(0, 6000);
    if (/energia elettrica|kwh|luce/i.test(offerOpening)) fixedLuceAnnual = offer.costoFissoAnno;
    if (/gas naturale|smc/i.test(offerOpening)) fixedGasAnnual = offer.costoFissoAnno;
  }

  const hasLuceData = Boolean(consumoLuce || prezzoLuce || fixedLuceAnnual || pod || potenzaImpegnata || offer.spreadLuce);
  const hasGasData = Boolean(consumoGas || prezzoGas || fixedGasAnnual || pdr || offer.spreadGas);
  const commodity = hasLuceData && hasGasData ? "dual" : hasGasData ? "gas" : hasLuceData ? "luce" : "unknown";
  const recognized = kind !== "unknown" && commodity !== "unknown";
  if (sourceText.trim().length < 20) warnings.push("testo_pdf_assente_o_insufficiente");
  if (!recognized) warnings.push("nessun_dato_utile_rilevato");

  const activation = extractActivationData(sourceText);
  const customer = detectCustomerType(sourceText, activation);
  const essential = [consumoLuce, consumoGas, prezzoLuce, prezzoGas, fixedLuceAnnual, fixedGasAnnual, pod, pdr].filter((v) => v !== null && v !== "").length;
  const confidence = !recognized ? "low" : warnings.length === 0 && essential >= 3 ? "high" : "medium";

  return {
    kind,
    commodity,
    recognized,
    confidence,
    warnings: [...new Set(warnings)],
    fornitore: detectProvider(sourceText),
    consumo_luce_kwh: consumoLuce,
    consumo_gas_smc: consumoGas,
    consumo_gas_mc: consumoGasMc,
    coefficiente_conversione_gas_c: coefficienteC,
    prezzo_luce_eur_kwh: prezzoLuce,
    prezzo_gas_eur_smc: prezzoGas,
    quota_fissa_vendita_luce_eur_anno: fixedLuceAnnual,
    quota_fissa_vendita_gas_eur_anno: fixedGasAnnual,
    potenza_impegnata_kw: potenzaImpegnata,
    potenza_disponibile_kw: potenzaDisponibile,
    pod,
    pdr,
    intestatario: activation.intestatario,
    codice_fiscale: activation.codiceFiscale,
    codice_cliente: activation.codiceCliente,
    indirizzo_fornitura: activation.indirizzoFornitura,
    indirizzo_fornitura_luce: activation.indirizzoFornituraLuce,
    indirizzo_fornitura_gas: activation.indirizzoFornituraGas,
    customer_type: customer.type,
    customer_type_confidence: customer.confidence,
    customer_type_evidence: customer.evidence,
    nome_offerta: offer.nomeOfferta,
    codice_offerta: offer.codiceOfferta,
    tipo_prezzo: offer.tipoPrezzo,
    indice_riferimento: offer.indice,
    spread_luce_eur_kwh: offer.spreadLuce,
    spread_gas_eur_smc: offer.spreadGas,
    textExtracted: sourceText.length,
    needsReview: confidence !== "high" || warnings.length > 0,
  };
}

export async function extractPdf(filePath) {
  const buffer = await fs.readFile(filePath);
  const pdfParseModule = await import("pdf-parse");
  const pdfParse = pdfParseModule.default || pdfParseModule;
  const parsed = await pdfParse(buffer);
  return extractPdfDataFromText(parsed.text || "");
}
