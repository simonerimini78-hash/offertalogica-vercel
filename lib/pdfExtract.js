import fs from "node:fs/promises";
import { selectAnnualConsumptionFromText } from "./pdfEvidenceArbitration.js";

export const PDF_PARSER_VERSION = "v98-contract-period-evidence-1";

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
    [/\bedison(?:\s+energia)?\b/i, "Edison Energia"],
    [/\bunoenergy\b/i, "Unoenergy"],
    [/\bfree\s+luce\s*(?:&|e)\s*gas(?:\s+s\.?r\.?l\.?)?\b/i, "Free Luce&Gas"],
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
  return selectAnnualConsumptionFromText(text, unit);
}

function extractBillPrice(text, commodity) {
  const compact = String(text).replace(/[ \t]+/g, " ");
  const label = commodity === "luce" ? "energia\\s+elettrica" : "gas\\s+naturale";
  const unit = commodity === "luce" ? "kwh" : "smc";
  return matchNumber(compact, [
    commodity === "luce"
      ? /costo\s+unitario\s+della\s+materia\s+energia\s+([0-9]+[,.][0-9]{3,})\s*€\s*\/?\s*kwh/i
      : /costo\s+unitario\s+della\s+materia\s+gas\s+([0-9]+[,.][0-9]{3,})\s*€\s*\/?\s*smc/i,
    commodity === "luce"
      ? /di\s+cui\s+spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?energia\s+elettrica\s+([0-9]+[,.][0-9]{3,})\s*€\/?kwh/i
      : /di\s+cui\s+spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?gas\s+naturale\s+([0-9]+[,.][0-9]{3,})\s*€\/?smc/i,
    commodity === "luce"
      ? /di\s+cui\s+spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?energia\s+([0-9]+[,.][0-9]{3,})[\s\S]{0,100}?elettrica\s+€\/kwh/i
      : /di\s+cui\s+spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?gas\s+([0-9]+[,.][0-9]{3,})[\s\S]{0,100}?naturale\s+€\/smc/i,
    new RegExp(`spesa\\s+per\\s+(?:la\\s+)?vendita\\s+(?:di\\s+)?${label}[\\s\\S]{0,180}?quota\\s+per\\s+consumi[\\s\\S]{0,80}?([0-9]+(?:[,.][0-9]+)?)\\s*€\\s*\/?${unit}`, "i"),
    new RegExp(`spesa\\s+per\\s+(?:la\\s+)?vendita\\s+(?:di\\s+)?${label}[\\s\\S]{0,120}?([0-9]+(?:[,.][0-9]+)?)\\s*€\\s*\/?${unit}`, "i"),
    new RegExp(`quota\\s+per\\s+consumi[\\s\\S]{0,700}?di\\s+cui\\s+spesa\\s+per\\s+(?:la\\s+)?vendita\\s+(?:di\\s+)?${label}[\\s\\S]{0,120}?([0-9]+[,.][0-9]{3,})[\\s\\S]{0,150}?€\\s*\/?${unit}`, "i"),
    new RegExp(`di\\s+cui\\s+spesa\\s+per\\s+(?:la\\s+)?vendita\\s+(?:di\\s+)?${label}[\\s\\S]{0,120}?([0-9]+[,.][0-9]{3,})[\\s\\S]{0,150}?€\\s*\/?${unit}`, "i"),
    commodity === "luce"
      ? /prezzo\s+medio\s*(?:€|¢|euro)?\s*\/?\s*kwh[\s\S]{0,900}?di\s+cu[i1l]\s+spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?energia(?:\s+elettrica)?\s+([0-9]+[,.][0-9]{3,})/i
      : /prezzo\s+medio\s*(?:€|¢|euro)?\s*\/?\s*smc[\s\S]{0,900}?di\s+cu[i1l]\s+spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?g[ao]s(?:\s+naturale)?\s+([0-9]+[,.][0-9]{3,})/i,
  ], { preferDecimal: true });
}

function extractMonthlyFixed(text, commodity) {
  const compact = String(text).replace(/[ \t]+/g, " ");
  const label = commodity === "luce" ? "energia\\s+elettrica" : "gas\\s+naturale";
  return matchNumber(compact, [
    commodity === "luce"
      ? /quota\s+fissa[\s\S]{0,700}?di\s+cui\s+spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?energia\s+(?:elettrica\s+)?(?:\d+\s+)?([0-9]+[,.][0-9]{2,6})[\s\S]{0,100}?€\s*\/?mese/i
      : /quota\s+fissa[\s\S]{0,700}?di\s+cui\s+spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?gas\s+(?:naturale\s+)?(?:\d+\s+)?([0-9]+[,.][0-9]{2,6})[\s\S]{0,100}?€\s*\/?mese/i,
    new RegExp(`quota\\s+fissa[\\s\\S]{0,700}?di\\s+cui\\s+spesa\\s+per\\s+(?:la\\s+)?vendita\\s+(?:di\\s+)?${label}[\\s\\S]{0,120}?([0-9]+[,.][0-9]{3,})[\\s\\S]{0,150}?€\\s*\/?mese`, "i"),
    commodity === "luce"
      ? /prezzo\s+medio\s*(?:€|¢|euro)?\s*\/?\s*mese[\s\S]{0,900}?quota\s+fissa[\s\S]{0,500}?di\s+cu[i1l]\s+spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?energia(?:\s+elettrica)?\s+([0-9]+[,.][0-9]{3,})/i
      : /prezzo\s+medio\s*(?:€|¢|euro)?\s*\/?\s*mese[\s\S]{0,900}?quota\s+fissa[\s\S]{0,500}?di\s+cu[i1l]\s+spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?g[ao]s(?:\s+naturale)?\s+([0-9]+[,.][0-9]{3,})/i,
  ], { preferDecimal: true });
}

function normalizeOfferName(value) {
  const normalized = String(value || "")
    .replace(/\s+(?:codice|data\s+scadenza|mercato\s+libero)\b.*$/i, "")
    .replace(/\.{4,}.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  if (/\b(?:bollett[ae]\s+precedent|stato\s+pagament|regolarmente\s+pagat|totale\s+da\s+pagare|scadenza|rateizzazion|coordinate\s+iban|saldo\s+della\s+fattura)\b/i.test(normalized)) return null;
  if (normalized.length > 120 || normalized.split(/\s+/).length > 14) return null;
  return normalized;
}

function normalizeOfferIndex(value) {
  const compact = String(value || "").replace(/\s+/g, " ").trim();
  if (!compact) return null;
  if (/^pun\s+index\s+gme$/i.test(compact)) return "PUN Index GME";
  if (/^pun(?:\s+index)?$/i.test(compact)) return compact.toUpperCase() === "PUN" ? "PUN" : "PUN Index";
  if (/^psv\s*(?:da|day\s+ahead)$/i.test(compact)) return "PSV day ahead";
  if (/^psv$/i.test(compact)) return "PSV";
  return compact;
}

function detectOfferPriceType(section) {
  const lower = String(section || "").toLowerCase();
  if (/struttura\s+di\s+prezzo\s+non\s+convenzionale|struttura\s+ibrida|prezzo\s+ibrido/.test(lower)) return "ibrido";
  if (/tipologia\s+(?:di\s+)?offerta\s*:\s*(?:a\s+)?prezzo\s+variabile|tipologia\s+offerta\s*:\s*variabile|prezzo\s+(?:variabile|indicizzato)/.test(lower)) return "variabile";
  if (/tipologia\s+(?:di\s+)?offerta\s*:\s*(?:a\s+)?prezzo\s+fisso|tipologia\s+offerta\s*:\s*fisso|prezzo\s+fisso/.test(lower)) return "fisso";
  if (/indice\s+di\s+riferimento\s*:\s*(?:pun|psv)/.test(lower)) return "variabile";
  return null;
}

function extractOfferIndex(section) {
  return normalizeOfferIndex(matchText(section, [
    /indice\s+di\s+riferimento\s*:\s*(PUN(?:\s+Index(?:\s+GME)?)?|PSV\s*(?:DA|day\s+ahead)?)/i,
    /\bindice\b[\s\S]{0,120}?(PUN(?:\s+Index(?:\s+GME)?)?|PSV\s*(?:DA|day\s+ahead)?)/i,
  ]));
}

function extractOfferSpread(section, commodity) {
  const unit = commodity === "luce" ? "kwh" : "smc";
  const index = commodity === "luce" ? "pun" : "psv(?:da|\\s+day\\s+ahead)?";
  const explicitValue = matchNumber(section, [
    new RegExp(`(?:energia\\s+)?spread(?:\\s+${index})?\\s*[:=]?\\s*([+-]?[0-9]+[,.][0-9]{3,})\\s*€\\s*\\/?${unit}`, "i"),
    new RegExp(`${index}[^\\n]{0,100}?\\+\\s*([+-]?[0-9]+[,.][0-9]{3,})\\s*€\\s*\\/?${unit}`, "i"),
  ], { preferDecimal: true });
  if (explicitValue !== null) return { value: explicitValue, explicitUnit: true };

  const inferredValue = matchNumber(section, [
    /\bspread\b\s*[:=]?\s*([+-]?[0-9]+[,.][0-9]{3,})/i,
  ], { preferDecimal: true });
  return { value: inferredValue, explicitUnit: false };
}

function detectOfferCommodity(name, section) {
  const normalizedName = String(name || "");
  if (/\bgas\b/i.test(normalizedName)) return "gas";
  if (/\bluce\b|\bEE(?:_|\b)|energia\s+elettrica/i.test(normalizedName)) return "luce";
  const nearby = String(section || "").slice(0, 1800);
  const gasIndex = nearby.search(/spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?gas\s+naturale|\bgas\s+naturale\b/i);
  const lightIndex = nearby.search(/spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?energia\s+elettrica|\benergia\s+elettrica\b/i);
  if (gasIndex >= 0 && (lightIndex < 0 || gasIndex < lightIndex)) return "gas";
  if (lightIndex >= 0) return "luce";
  return null;
}

function extractLegacyOfferData(text, lower) {
  const nomeOfferta = normalizeOfferName(matchText(text, [
    /E[.\s-]*ON\s+([^\n\r]+?)\s+-\s+codice offerta/i,
    /(?:energia elettrica|gas naturale)\s*-\s*([^\n\r]+?)\s*-\s*codice offerta/i,
    /nome\s+offerta\s*:\s*([^\n\r]{2,100})/i,
    /\bofferta\s*:\s*([^\n\r]{2,100})/i,
  ]));
  const codiceOfferta = matchText(text, [/codice\s+offerta\s*:\s*([A-Z0-9_-]{12,})/i]);
  const tipoPrezzo = detectOfferPriceType(lower);
  const indice = extractOfferIndex(text);
  const likelyLuce = /energia\s+elettrica\s+mercato\s+libero|(?:codice\s+)?pod\s*[:：]|€\s*\/?kwh/i.test(text);
  const likelyGas = /gas\s+naturale\s+mercato\s+libero|(?:codice\s+)?pdr\s*[:：]|€\s*\/?smc/i.test(text);
  const spreadLuceResult = likelyLuce ? extractOfferSpread(text, "luce") : { value: null, explicitUnit: false };
  const spreadGasResult = likelyGas ? extractOfferSpread(text, "gas") : { value: null, explicitUnit: false };
  const spreadLuce = spreadLuceResult.value;
  const spreadGas = spreadGasResult.value;
  const costoFissoAnno = matchNumber(text, [
    /costo\s+fisso\s+anno[\s\S]{0,300}?([\d.,]+)\s*€\s*\/\s*anno/i,
    /corrispettivo\s+(?:fisso|annuo)[^\d]{0,50}([\d.,]+)\s*€\s*\/\s*anno/i,
  ], { preferDecimal: true });
  return {
    nomeOfferta,
    codiceOfferta,
    tipoPrezzo,
    indice,
    spreadLuce,
    spreadGas,
    spreadLuceExplicitUnit: spreadLuceResult.explicitUnit,
    spreadGasExplicitUnit: spreadGasResult.explicitUnit,
    costoFissoAnno,
  };
}

function bestOffer(entries, commodity) {
  return entries
    .filter((entry) => entry.commodity === commodity)
    .sort((a, b) => b.score - a.score)[0] || null;
}

function extractOfferData(text, lower) {
  const source = String(text || "");
  const matches = [...source.matchAll(/(?:\bnome\s+offerta|\bdenominazione\s+commerciale\s+offerta|(?:^|\n)\s*offerta)\s*:\s*([^\n\r]{2,180})/gim)];
  const entries = matches.map((match, index) => {
    const name = normalizeOfferName(match[1]);
    const matchIndex = Number(match.index || 0);
    const contextStart = Math.max(0, matchIndex - 1200);
    const nextIndex = matches[index + 1]?.index;
    const end = Math.min(source.length, Number.isInteger(nextIndex) ? nextIndex : matchIndex + 4200);
    const section = source.slice(matchIndex, end);
    const commodityContext = `${source.slice(contextStart, matchIndex)}\n${section}`;
    const code = matchText(section, [/codice\s+offerta\s*:\s*([A-Z0-9_-]{12,})/i]);
    const commodity = detectOfferCommodity(name, commodityContext);
    const type = detectOfferPriceType(section);
    const offerIndex = extractOfferIndex(section);
    const spreadResult = commodity ? extractOfferSpread(section, commodity) : { value: null, explicitUnit: false };
    const spread = spreadResult.value;
    const fixedAnnual = matchNumber(section, [
      /costo\s+fisso\s+anno[\s\S]{0,300}?([\d.,]+)\s*€\s*\/\s*anno/i,
      /corrispettivo\s+(?:fisso|annuo)[^\d]{0,50}([\d.,]+)\s*€\s*\/\s*anno/i,
    ], { preferDecimal: true });
    const score = [name, code, commodity, type, offerIndex, spread, fixedAnnual].filter((value) => value !== null && value !== "").length;
    return { name, code, commodity, type, index: offerIndex, spread, spreadExplicitUnit: spreadResult.explicitUnit, fixedAnnual, score };
  });
  return {
    luce: bestOffer(entries, "luce"),
    gas: bestOffer(entries, "gas"),
    generic: extractLegacyOfferData(source, lower),
  };
}

function commonOfferValue(luce, gas, key) {
  const left = luce?.[key] ?? null;
  const right = gas?.[key] ?? null;
  if (left === null || right === null) return null;
  return String(left).toLowerCase() === String(right).toLowerCase() ? left : null;
}

function finalizeOfferData(offer, commodity) {
  let luce = offer.luce;
  let gas = offer.gas;
  const fallback = offer.generic;
  if (commodity === "luce" && !luce && fallback.nomeOfferta) {
    luce = { name: fallback.nomeOfferta, code: fallback.codiceOfferta, type: fallback.tipoPrezzo, index: fallback.indice, spread: fallback.spreadLuce, spreadExplicitUnit: fallback.spreadLuceExplicitUnit, fixedAnnual: fallback.costoFissoAnno };
  }
  if (commodity === "gas" && !gas && fallback.nomeOfferta) {
    gas = { name: fallback.nomeOfferta, code: fallback.codiceOfferta, type: fallback.tipoPrezzo, index: fallback.indice, spread: fallback.spreadGas, spreadExplicitUnit: fallback.spreadGasExplicitUnit, fixedAnnual: fallback.costoFissoAnno };
  }

  const mono = commodity === "luce" ? luce : commodity === "gas" ? gas : null;
  return {
    luce,
    gas,
    nomeOfferta: mono?.name ?? (commodity === "dual" ? commonOfferValue(luce, gas, "name") : fallback.nomeOfferta),
    codiceOfferta: mono?.code ?? (commodity === "dual" ? commonOfferValue(luce, gas, "code") : fallback.codiceOfferta),
    tipoPrezzo: mono?.type ?? (commodity === "dual" ? commonOfferValue(luce, gas, "type") : fallback.tipoPrezzo),
    indice: mono?.index ?? (commodity === "dual" ? commonOfferValue(luce, gas, "index") : fallback.indice),
    spreadLuce: luce?.spread ?? fallback.spreadLuce,
    spreadGas: gas?.spread ?? fallback.spreadGas,
    spreadLuceExplicitUnit: luce?.spread !== null && luce?.spread !== undefined ? Boolean(luce.spreadExplicitUnit) : Boolean(fallback.spreadLuceExplicitUnit),
    spreadGasExplicitUnit: gas?.spread !== null && gas?.spread !== undefined ? Boolean(gas.spreadExplicitUnit) : Boolean(fallback.spreadGasExplicitUnit),
    costoFissoAnno: mono?.fixedAnnual ?? fallback.costoFissoAnno,
  };
}

function normalizeAddress(value) {
  if (!value) return null;
  const normalized = String(value)
    .replace(/\s+\+\s+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim()
    .replace(/[|;]+$/g, "")
    .trim();
  if (normalized.length < 5) return null;
  if (/\b(?:il\s+modulo|documentazione\s+contrattuale|lo\s+potete\s+trovare|reclami?|informazioni|obbligatoriamente|rilasciat[ao]|sottoscrizione)\b/i.test(normalized)) return null;
  const hasStreet = /\b(?:via|viale|piazza|piazzale|corso|vicolo|largo|strada|contrada|localit[aà])\b/i.test(normalized);
  const hasCivic = /\b\d+[A-Z]?(?:\/[A-Z0-9]+)?\b/i.test(normalized);
  const hasCap = /\b\d{5}\b/.test(normalized);
  const hasProvince = /\([A-Z]{2}\)|(?:^|[\s,-])[A-Z]{2}(?:$|[\s,-])/i.test(normalized);
  return hasStreet && hasCivic && (hasCap || hasProvince || normalized.split(/[,\s]+/).length >= 3) ? normalized : null;
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


function extractAddressNearSupplyPoint(text, commodity) {
  const source = String(text || "");
  const marker = commodity === "gas" ? "PDR" : "POD";
  const codePattern = commodity === "gas" ? "(?:\\d[\\s.-]*){14}" : "IT(?:[\\s.-]*[A-Z0-9]){12}";
  const street = "(?:via|viale|piazza|piazzale|corso|vicolo|largo|strada|contrada|localit[aà])";
  const patterns = [
    new RegExp(`(?:punto\\s+di\\s+fornitura\\s*\\(${marker}\\)|${marker})[\\s\\S]{0,120}?${codePattern}[\\s\\S]{0,100}?sito\\s+in\\s+(${street}[\\s\\S]{0,120}?)(?=\\s+e\\s+l['’]offerta|\\.|\\n|$)`, "i"),
    new RegExp(`${marker}[\\s\\S]{0,120}?${codePattern}[\\s\\S]{0,100}?sito\\s+in\\s+(${street}[\\s\\S]{0,120}?)(?=\\s+e\\s+l['’]offerta|\\.|\\n|$)`, "i"),
  ];
  return normalizeAddress(matchText(source, patterns));
}

function extractAddressNearKnownSupplyCode(text, code) {
  const source = String(text || "");
  const normalizedCode = String(code || "").replace(/[^A-Z0-9]/gi, "");
  if (!normalizedCode) return null;
  const escaped = normalizedCode.split("").map((char) => String.raw`${char}[\s.-]*`).join("");
  const street = "(?:via|viale|piazza|piazzale|corso|vicolo|largo|strada|contrada|localit[aà])";

  const summaryPattern = new RegExp(String.raw`${escaped}[\s\S]{0,90}?(${street}[\s\S]{0,140}?)(?=\s+(?:imp\.?\s*\d|dis\.?\s*\d|potenza|bta\d*|bassa\s+tensione|opzione\s+tariffaria|offerta|tensione)|[;\n]|$)`, "ig");
  for (const match of source.matchAll(summaryPattern)) {
    const address = normalizeAddress(match[1]);
    if (address) return address;
  }

  const pattern = new RegExp(String.raw`${escaped}[\s\S]{0,260}?(?:sito|ubicat[oa]|servizio\s+fornito)\s+(?:in|presso)\s+(${street}[\s\S]{0,180}?)(?=\s+(?:e\s+l[’']?offerta|codice\s+offerta|la\s+fornitura|il\s+contratto)|[.;\n]|$)`, "ig");
  for (const match of source.matchAll(pattern)) {
    const address = normalizeAddress(match[1]);
    if (address) return address;
  }
  return null;
}


function normalizeCustomerName(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length < 4 || normalized.length > 120) return null;
  if (/\b(?:unoenergy|energia|fattura|bolletta|mercato|cliente|codice|fornitura|totale|pagina|documento|informazioni|pagamenti?|scadenza|servizio\s+clienti|riepilogo|importi)\b/i.test(normalized)) return null;
  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 7 ? normalized : null;
}

function customerContextSegments(source, customerHeader = {}) {
  const text = String(source || "");
  const segments = [];
  const markers = /dati\s+cliente|fornitura\s+e\s+riepilogo\s+degli\s+importi|contratto\s+intestato\s+a|gentile\s+cliente/gi;
  for (const match of text.matchAll(markers)) {
    const index = match.index || 0;
    segments.push(text.slice(index, Math.min(text.length, index + 1800)));
  }
  if (customerHeader.intestatario) {
    const index = text.toLowerCase().indexOf(String(customerHeader.intestatario).toLowerCase());
    if (index >= 0) segments.push(text.slice(index, Math.min(text.length, index + 1200)));
  }
  return [...new Set(segments.filter(Boolean))];
}

function extractCustomerTaxId(source, customerHeader = {}) {
  const personalPattern = /\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/i;
  const labeledPattern = /(?:codice\s+fiscale(?:\s*\/\s*partita\s+iva)?|partita\s+iva|\bP\.?\s*Iva\b|\bC\.?\s*F\.?)\s*[:：]?\s*\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]|\d{11})\b/i;
  const looseLabeledPattern = /(?:codice\s+fiscale(?:\s*\/\s*partita\s+iva)?|partita\s+iva|\bP\.?\s*Iva\b|\bC\.?\s*F\.?)\s*[:：]?[\s\S]{0,180}?\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]|\d{11})\b/i;
  const segments = customerContextSegments(source, customerHeader);

  for (const segment of segments) {
    const personal = matchText(segment, [personalPattern]);
    if (personal) return personal.toUpperCase().replace(/[\s.-]/g, "");
    const labeled = matchText(segment, [labeledPattern, looseLabeledPattern]);
    if (labeled) return labeled.toUpperCase().replace(/[\s.-]/g, "");
  }

  // Un codice fiscale personale a 16 caratteri può essere riconosciuto anche
  // fuori dal blocco cliente; una P.IVA a 11 cifre no, perché in testata è
  // quasi sempre quella del fornitore.
  const personal = matchText(source, [
    /(?:codice\s+fiscale|\bC\.?\s*F\.?)\s*[:：]?\s*\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/i,
  ]);
  return personal ? personal.toUpperCase().replace(/[\s.-]/g, "") : null;
}

function editDistanceAtMostOne(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (i < a.length || j < b.length ? 1 : 0) <= 1;
}

function extractCustomerCode(source, supplyPoints = {}) {
  const candidates = [...String(source || "").matchAll(/codice\s+cliente\s*[:：]?\s*([A-Z0-9]{6,20})/gi)]
    .map((match) => String(match[1] || "").toUpperCase())
    .filter(Boolean);
  const pdr = String(supplyPoints.pdr || "").replace(/\D/g, "");
  const pod = String(supplyPoints.pod || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const filtered = candidates.filter((candidate) => {
    const compact = candidate.replace(/[^A-Z0-9]/g, "");
    if (pdr && /^\d+$/.test(compact) && editDistanceAtMostOne(compact, pdr)) return false;
    if (pod && editDistanceAtMostOne(compact, pod)) return false;
    return true;
  });
  const unique = [...new Set(filtered)];
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) return null;
  return matchText(source, [
    /codice\s+cliente\s+data\s+emissione[\s\S]{0,180}?\b([A-Z0-9]{6,20})\b\s+\d{2}\/\d{2}\/\d{4}/i,
    /numero\s+cliente[\s\S]{0,300}?\b([0-9]{8,20})\b/i,
  ]);
}

function extractCustomerHeaderData(text) {
  const source = String(text || "").slice(0, 12000);
  const street = "(?:via|viale|piazza|piazzale|corso|vicolo|largo|strada|contrada|localit[aà])";
  const intestatario = normalizeCustomerName(matchText(source, [
    new RegExp(String.raw`dati\s+cliente\s+([A-ZÀ-ÖØ-Ý' .&-]{4,100}?)\s+(?=${street}\b)`, "i"),
    new RegExp(String.raw`fornitura\s+e\s+riepilogo\s+degli\s+importi\s+([A-ZÀ-ÖØ-Ý' .&-]{4,120}?)\s+(?=${street}\b)`, "i"),
    /\b([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý'&.-]{1,40}(?:\s+[A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý'&.-]{1,40}){1,5})\s+gentile\s+cliente\b/i,
  ]));
  const address = matchText(source, [
    new RegExp(String.raw`dati\s+cliente[\s\S]{0,140}?${street}\s+([A-ZÀ-ÖØ-Ý0-9' .,&/()-]{4,140}?)(?=\s+codice\s+fiscale|\s+codice\s+cliente|\s+bolletta\s+n|$)`, "i"),
  ]);
  const fullAddress = address ? normalizeAddress(`${source.match(new RegExp(String.raw`dati\s+cliente[\s\S]{0,140}?(${street})`, "i"))?.[1] || ""} ${address}`) : null;
  return { intestatario, address: fullAddress };
}

function extractActivationData(text, supplyPoints = {}) {
  const source = String(text || "");
  const customerHeader = extractCustomerHeaderData(source);
  const codiceFiscale = extractCustomerTaxId(source, customerHeader);
  const codiceCliente = extractCustomerCode(source, supplyPoints);
  const indirizzoGas = extractAddressNearSupplyHeader(source, "gas")
    || extractAddressNearSupplyPoint(source, "gas")
    || extractAddressNearKnownSupplyCode(source, supplyPoints.pdr);
  const indirizzoLuce = extractAddressNearSupplyHeader(source, "luce")
    || extractAddressNearSupplyPoint(source, "luce")
    || extractAddressNearKnownSupplyCode(source, supplyPoints.pod);
  const fallbackAddress = matchText(source, [
    /indirizzo\s+di\s+fornitura\s*[:：]\s*([^\n\r]{5,120})/i,
    /servizio\s+fornito\s+in\s*[:：]?\s*([^\n\r]{5,120})/i,
  ]);
  const indirizzoFornitura = indirizzoLuce || indirizzoGas || normalizeAddress(fallbackAddress) || customerHeader.address;
  const intestatario = normalizeCustomerName(matchText(source, [
    /contratto\s+intestato\s+a\s*[:：]?\s*([A-ZÀ-ÖØ-Ý' .&-]{4,100})/i,
    /i\s+tuoi\s+dati\s+identificativi[\s\S]{0,100}?\n\s*([A-ZÀ-ÖØ-Ý' .&-]{4,100})\s*\n/i,
    /intestata\s+a\s+([A-ZÀ-ÖØ-Ý' .&-]{4,100})/i,
    /dati\s+cliente\s+([A-ZÀ-ÖØ-Ý' .&-]{4,100}?)\s+(?=(?:via|viale|piazza|piazzale|corso|vicolo|largo|strada|contrada|localit[aà])\b)/i,
    /\b([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý'&.-]{1,40}(?:\s+[A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý'&.-]{1,40}){1,5})\s+gentile\s+cliente\b/i,
  ])) || customerHeader.intestatario;
  return {
    codiceFiscale,
    codiceCliente,
    indirizzoFornitura,
    indirizzoFornituraLuce: indirizzoLuce,
    indirizzoFornituraGas: indirizzoGas,
    addressRejected: Boolean(fallbackAddress) && !indirizzoFornitura,
    intestatario,
  };
}

function detectCustomerType(text, activation = {}) {
  const source = String(text || "");
  const opening = source.slice(0, 14000);
  const lower = source.toLowerCase();
  const businessPatterns = [
    /tipologia\s+(?:di\s+)?cliente\s*:\s*(?:non\s+domestico|altri\s+usi|microbusiness|business)/i,
    /categoria\s+(?:cliente|uso)\s*:\s*(?:non\s+domestico|altri\s+usi|microbusiness|business)/i,
    /uso\s+(?:non\s+domestico|diverso\s+dall['’]abitazione|altri\s+usi)/i,
    /\bmicrobusiness\b/i,
  ];
  const privatePatterns = [
    /tipologia\s+(?:di\s+)?cliente\s*:\s*domestico(?:\s+residente|\s+non\s+residente)?/i,
    /\bdomestico\s+residente\b/i,
    /\buso\s+domestico\b/i,
  ];
  const companyName = /\b(?:s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|societ[aà]|cooperativa|studio\s+associato)\b/i.test(activation.intestatario || "");
  const customerVat = /^\d{11}$/.test(String(activation.codiceFiscale || ""));
  const personalTaxCode = /^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/i.test(String(activation.codiceFiscale || ""));
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
  if (personalTaxCode && !companyName && !customerVat) {
    return { type: "privato", confidence: "medium", evidence: "codice fiscale persona fisica" };
  }
  if (/\babitazione\b|canone\s+di\s+abbonamento\s+alla\s+televisione/i.test(lower)) {
    return { type: "privato", confidence: "medium", evidence: "riferimento abitazione" };
  }
  return { type: "unknown", confidence: "low", evidence: "" };
}


function normalizeDiagnosticText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function numericDiagnosticVariants(value) {
  if (!Number.isFinite(value)) return [];
  const variants = new Set([String(value), String(value).replace(".", ",")]);
  for (const digits of [2, 3, 4, 5, 6]) {
    variants.add(value.toFixed(digits));
    variants.add(value.toFixed(digits).replace(".", ","));
  }
  if (Number.isInteger(value)) {
    variants.add(new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 }).format(value));
  }
  return [...variants].filter(Boolean);
}

function diagnosticVariants(value) {
  if (value === null || value === undefined || value === "") return [];
  if (typeof value === "number") return numericDiagnosticVariants(value);
  const text = normalizeDiagnosticText(value);
  const compact = text.replace(/[\s.,+\-]/g, "");
  return [...new Set([text, compact])].filter(Boolean);
}

function snippetAround(text, index, length = 320) {
  const compact = normalizeDiagnosticText(text);
  if (!compact) return "";
  const safeIndex = Math.max(0, Math.min(Number.isFinite(index) ? index : 0, compact.length));
  const start = Math.max(0, safeIndex - Math.floor(length / 3));
  return compact.slice(start, start + length).trim();
}

function findDiagnosticEvidence(pageTexts, { labels = [], values = [] } = {}) {
  const normalizedValues = values
    .flatMap((value) => diagnosticVariants(value))
    .map((value) => value.toLowerCase());

  const compactIndexToOriginal = (text, compactIndex) => {
    let compactPosition = 0;
    for (let originalIndex = 0; originalIndex < text.length; originalIndex += 1) {
      if (/[\s.,+\-]/.test(text[originalIndex])) continue;
      if (compactPosition === compactIndex) return originalIndex;
      compactPosition += 1;
    }
    return 0;
  };

  for (let pageIndex = 0; pageIndex < pageTexts.length; pageIndex += 1) {
    const page = normalizeDiagnosticText(pageTexts[pageIndex]);
    const lower = page.toLowerCase();
    for (const label of labels) {
      const match = lower.match(label);
      if (!match || !Number.isInteger(match.index)) continue;
      const nearby = lower.slice(match.index, match.index + 900);
      const valueMatches = normalizedValues.length === 0 || normalizedValues.some((value) => nearby.includes(value) || nearby.replace(/[\s.,-]/g, "").includes(value.replace(/[\s.,-]/g, "")));
      if (valueMatches) {
        return { page: pageIndex + 1, snippet: snippetAround(page, match.index), match: match[0] };
      }
    }
  }

  if (normalizedValues.length) {
    for (let pageIndex = 0; pageIndex < pageTexts.length; pageIndex += 1) {
      const page = normalizeDiagnosticText(pageTexts[pageIndex]);
      const lower = page.toLowerCase();
      const compact = lower.replace(/[\s.,+\-]/g, "");
      for (const value of normalizedValues) {
        let index = lower.indexOf(value);
        if (index < 0) {
          const compactValue = value.replace(/[\s.,+\-]/g, "");
          const compactIndex = compact.indexOf(compactValue);
          if (compactIndex >= 0) index = compactIndexToOriginal(lower, compactIndex);
        }
        if (index >= 0) return { page: pageIndex + 1, snippet: snippetAround(page, index), match: value };
      }
    }
  }

  return { page: null, snippet: "", match: "" };
}

function diagnosticField(normalized, pageTexts, config) {
  const applicable = typeof config.applicable === "function" ? Boolean(config.applicable(normalized)) : true;
  const required = applicable && (typeof config.required === "function" ? Boolean(config.required(normalized)) : Boolean(config.required));
  const value = normalized[config.key];
  const present = value !== null && value !== undefined && value !== "" && value !== "unknown";
  if (!applicable) {
    return {
      field: config.key,
      label: config.label,
      value: null,
      status: "not_applicable",
      confidence: "none",
      required: false,
      page: null,
      source_snippet: "",
      source_match: "",
      method: config.method || "text_pattern",
    };
  }
  const sourceValue = typeof config.sourceValue === "function" ? config.sourceValue(normalized) : value;
  const evidence = present
    ? findDiagnosticEvidence(pageTexts, { labels: config.labels || [], values: [sourceValue, ...(config.extraValues?.(normalized) || [])] })
    : findDiagnosticEvidence(pageTexts, { labels: config.labels || [], values: [] });
  const warningHit = (normalized.warnings || []).some((warning) => (config.warningPrefixes || [config.key]).some((prefix) => warning.includes(prefix)));
  const derived = Boolean(config.derived?.(normalized));
  const derivedNeedsReview = derived && config.derivedNeedsReview !== false;
  return {
    field: config.key,
    label: config.label,
    value: present ? value : null,
    status: present ? (warningHit || derivedNeedsReview ? "review" : "found") : required ? "missing" : "optional_missing",
    confidence: present ? (warningHit || derivedNeedsReview ? "medium" : normalized.confidence || "medium") : "low",
    required,
    page: evidence.page,
    source_snippet: evidence.snippet,
    source_match: evidence.match,
    method: derived ? config.derivedMethod || "derived" : config.method || "text_pattern",
  };
}

export function buildPdfDiagnostics(normalized, pageTexts = []) {
  const isBill = (n) => n.kind === "bolletta";
  const isOffer = (n) => n.kind === "scheda_offerta";
  const hasLuce = (n) => ["luce", "dual"].includes(n.commodity);
  const hasGas = (n) => ["gas", "dual"].includes(n.commodity);
  const configs = [
    { key: "fornitore", label: "Fornitore", labels: [/dolomiti\s+energia|eni\s+plenitude|plenitude|edison(?:\s+energia)?|unoenergy|free\s+luce\s*(?:&|e)\s*gas|hera(?:\s+comm)?|e[.\s-]*on|acea\s+energia|pulsee|illumia|enel\s+energia|butangas/i], required: true },
    { key: "kind", label: "Tipo documento", labels: [/scheda\s+sintetica|scontrino\s+dell['’]energia|fattura\s+elettronica|totale\s+da\s+pagare/i], method: "document_classifier", required: true },
    { key: "commodity", label: "Fornitura rilevata", labels: [/energia\s+elettrica|gas\s+naturale|codice\s+pod|codice\s+pdr/i], method: "commodity_classifier", required: true },
    { key: "customer_type", label: "Tipo cliente", labels: [/tipologia\s+(?:di\s+)?cliente|client[ei]\s+non\s+domestic[io]|domestico\s+residente|microbusiness|partita\s+iva|codice\s+fiscale|\bC\.?\s*F\.?\s*:/i], extraValues: (n) => [n.customer_type_evidence], applicable: isBill, required: isBill },
    { key: "consumo_luce_kwh", label: "Consumo annuo luce", labels: [/in\s+un\s+anno\s+hai\s+consumato|consumo\s+annuo/i], warningPrefixes: ["consumo_luce"], applicable: hasLuce, required: isBill },
    { key: "consumo_gas_smc", label: "Consumo annuo gas", labels: [/in\s+un\s+anno\s+hai\s+consumato|consumo\s+annuo/i], sourceValue: (n) => n.warnings?.includes("consumo_gas_convertito_da_mc_a_smc") ? n.consumo_gas_mc : n.consumo_gas_smc, derived: (n) => n.warnings?.includes("consumo_gas_convertito_da_mc_a_smc"), derivedMethod: "mc_times_coefficiente_c", warningPrefixes: ["consumo_gas"], applicable: hasGas, required: isBill },
    { key: "prezzo_luce_eur_kwh", label: "Prezzo vendita luce", labels: [/spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?energia|materia\s+energia|corrispettivo\s+energia/i], warningPrefixes: ["prezzo_luce"], applicable: hasLuce, required: (n) => isBill(n) || (isOffer(n) && n.tipo_prezzo === "fisso") },
    { key: "prezzo_gas_eur_smc", label: "Prezzo vendita gas", labels: [/spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?g[ao]s|materia\s+prima\s+g[ao]s|corrispettivo\s+g[ao]s/i], warningPrefixes: ["prezzo_gas"], applicable: hasGas, required: (n) => isBill(n) || (isOffer(n) && n.tipo_prezzo === "fisso") },
    { key: "quota_fissa_vendita_luce_eur_anno", label: "Quota fissa luce annua", labels: [/quota\s+fissa|costo\s+fisso\s+anno|corrispettivo\s+(?:fisso|annuo)/i], sourceValue: (n) => n.quota_fissa_vendita_luce_method === "monthly_times_12" && Number.isFinite(n.quota_fissa_vendita_luce_eur_anno) ? n.quota_fissa_vendita_luce_eur_anno / 12 : n.quota_fissa_vendita_luce_eur_anno, extraValues: (n) => [n.quota_fissa_vendita_luce_eur_anno], derived: (n) => n.quota_fissa_vendita_luce_method === "monthly_times_12", derivedNeedsReview: false, derivedMethod: "monthly_times_12", method: "explicit_annual", warningPrefixes: ["quota_fissa_luce"], applicable: hasLuce, required: true },
    { key: "quota_fissa_vendita_gas_eur_anno", label: "Quota fissa gas annua", labels: [/quota\s+fissa|costo\s+fisso\s+anno|corrispettivo\s+(?:fisso|annuo)/i], sourceValue: (n) => n.quota_fissa_vendita_gas_method === "monthly_times_12" && Number.isFinite(n.quota_fissa_vendita_gas_eur_anno) ? n.quota_fissa_vendita_gas_eur_anno / 12 : n.quota_fissa_vendita_gas_eur_anno, extraValues: (n) => [n.quota_fissa_vendita_gas_eur_anno], derived: (n) => n.quota_fissa_vendita_gas_method === "monthly_times_12", derivedNeedsReview: false, derivedMethod: "monthly_times_12", method: "explicit_annual", warningPrefixes: ["quota_fissa_gas"], applicable: hasGas, required: true },
    { key: "potenza_impegnata_kw", label: "Potenza impegnata", labels: [/potenza\s+impegnata|potenza\s+contrattualmente\s+impegnata/i], warningPrefixes: ["potenza_impegnata"], applicable: (n) => isBill(n) && hasLuce(n), required: (n) => isBill(n) && hasLuce(n) },
    { key: "potenza_disponibile_kw", label: "Potenza disponibile", labels: [/potenza\s+disponibile/i], warningPrefixes: ["potenza_disponibile"], applicable: (n) => isBill(n) && hasLuce(n) },
    { key: "pod", label: "POD", labels: [/(?:codice\s+)?pod|punto\s+di\s+prelievo/i], applicable: (n) => isBill(n) && hasLuce(n), required: (n) => isBill(n) && hasLuce(n) },
    { key: "pdr", label: "PDR", labels: [/(?:codice\s+)?pdr|punto\s+di\s+riconsegna/i], applicable: (n) => isBill(n) && hasGas(n), required: (n) => isBill(n) && hasGas(n) },
    { key: "intestatario", label: "Intestatario", labels: [/contratto\s+intestato\s+a|i\s+tuoi\s+dati\s+identificativi|intestata\s+a/i], applicable: isBill, required: isBill },
    { key: "codice_fiscale", label: "Codice fiscale / P.IVA", labels: [/codice\s+fiscale(?:\s*\/\s*partita\s+iva)?|partita\s+iva/i], applicable: isBill, required: isBill },
    { key: "codice_cliente", label: "Codice cliente", labels: [/codice\s+cliente|numero\s+cliente/i], applicable: isBill, required: isBill },
    { key: "indirizzo_fornitura", label: "Indirizzo fornitura", labels: [/indirizzo\s+di\s+fornitura|servizio\s+fornito\s+in/i], applicable: isBill, required: isBill },
    { key: "nome_offerta", label: "Nome offerta comune", labels: [/nome\s+offerta|\bofferta\s*:/i], applicable: (n) => Boolean(n.nome_offerta) },
    { key: "codice_offerta", label: "Codice offerta comune", labels: [/codice\s+offerta/i], applicable: (n) => Boolean(n.codice_offerta) },
    { key: "tipo_prezzo", label: "Tipo prezzo comune", labels: [/tipologia\s+(?:di\s+)?offerta|tipologia\s+prezzo|prezzo\s+fisso|prezzo\s+variabile/i], applicable: (n) => Boolean(n.tipo_prezzo) },
    { key: "indice_riferimento", label: "Indice comune", labels: [/indice\s+di\s+riferimento|pun\s+index|\bpsv(?:da)?\b/i], applicable: (n) => Boolean(n.indice_riferimento), required: (n) => isOffer(n) && n.commodity !== "dual" && n.tipo_prezzo === "variabile" },
    { key: "nome_offerta_luce", label: "Nome offerta luce", labels: [/nome\s+offerta|offerta\s+contrattuale\s+attiva/i], applicable: (n) => hasLuce(n) && (isOffer(n) || Boolean(n.nome_offerta_luce)), required: (n) => isOffer(n) && hasLuce(n) },
    { key: "codice_offerta_luce", label: "Codice offerta luce", labels: [/codice\s+offerta/i], applicable: (n) => hasLuce(n) && (isOffer(n) || Boolean(n.codice_offerta_luce)), required: (n) => isOffer(n) && hasLuce(n) },
    { key: "tipo_prezzo_luce", label: "Tipo prezzo luce", labels: [/tipologia\s+(?:di\s+)?offerta|struttura\s+di\s+prezzo|prezzo\s+fisso|prezzo\s+variabile/i], applicable: (n) => hasLuce(n) && (isOffer(n) || Boolean(n.tipo_prezzo_luce)), required: (n) => isOffer(n) && hasLuce(n) },
    { key: "indice_riferimento_luce", label: "Indice luce", labels: [/indice\s+di\s+riferimento|pun\s+index|\bpun\b/i], applicable: (n) => hasLuce(n) && Boolean(n.indice_riferimento_luce), required: (n) => isOffer(n) && hasLuce(n) && ["variabile", "ibrido"].includes(n.tipo_prezzo_luce) },
    { key: "spread_luce_eur_kwh", label: "Spread luce", labels: [/spread|pun[\s\S]{0,80}\+/i], warningPrefixes: ["spread_luce"], applicable: (n) => hasLuce(n) && (Boolean(n.spread_luce_eur_kwh) || (isOffer(n) && n.tipo_prezzo_luce === "variabile")), required: (n) => isOffer(n) && hasLuce(n) && n.tipo_prezzo_luce === "variabile" },
    { key: "nome_offerta_gas", label: "Nome offerta gas", labels: [/nome\s+offerta|offerta\s+contrattuale\s+attiva/i], applicable: (n) => hasGas(n) && (isOffer(n) || Boolean(n.nome_offerta_gas)), required: (n) => isOffer(n) && hasGas(n) },
    { key: "codice_offerta_gas", label: "Codice offerta gas", labels: [/codice\s+offerta/i], applicable: (n) => hasGas(n) && (isOffer(n) || Boolean(n.codice_offerta_gas)), required: (n) => isOffer(n) && hasGas(n) },
    { key: "tipo_prezzo_gas", label: "Tipo prezzo gas", labels: [/tipologia\s+(?:di\s+)?offerta|struttura\s+di\s+prezzo|prezzo\s+fisso|prezzo\s+variabile/i], applicable: (n) => hasGas(n) && (isOffer(n) || Boolean(n.tipo_prezzo_gas)), required: (n) => isOffer(n) && hasGas(n) },
    { key: "indice_riferimento_gas", label: "Indice gas", labels: [/indice\s+di\s+riferimento|\bpsv(?:da)?\b|psv\s+day\s+ahead/i], applicable: (n) => hasGas(n) && Boolean(n.indice_riferimento_gas), required: (n) => isOffer(n) && hasGas(n) && ["variabile", "ibrido"].includes(n.tipo_prezzo_gas) },
    { key: "spread_gas_eur_smc", label: "Spread gas", labels: [/spread|psv[\s\S]{0,80}\+/i], warningPrefixes: ["spread_gas"], applicable: (n) => hasGas(n) && (Boolean(n.spread_gas_eur_smc) || (isOffer(n) && n.tipo_prezzo_gas === "variabile")), required: (n) => isOffer(n) && hasGas(n) && n.tipo_prezzo_gas === "variabile" },
  ];

  return configs.map((config) => diagnosticField(normalized, pageTexts, config));
}

async function renderPdfPageText(pageData) {
  const textContent = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
  let text = "";
  let lastY = null;
  for (const item of textContent.items || []) {
    const value = String(item?.str || "");
    if (!value) continue;
    const y = Array.isArray(item.transform) ? item.transform[5] : null;
    if (lastY === null || y === null || Math.abs(y - lastY) > 1.5) text += "\n";
    else text += " ";
    text += value;
    lastY = y;
  }
  return text.trim();
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
    /\bimp\.?\s*([\d.,]+)\s*kW\s*-?\s*dis\.?\s*[\d.,]+\s*kW/i,
    /potenza\s+impegnata\s*[:：]?\s*([\d.,]+)\s*kW/i,
    /potenza\s+contrattualmente\s+impegnata\s*[:：]?\s*([\d.,]+)\s*kW/i,
    /indirizzo\s+di\s+fornitura[\s\S]{0,100}?potenza\s+impegnata[\s\S]{0,260}?([\d.,]+)\s*kW\s*IT/i,
    /\b([\d.,]+)\s*kW\s*IT\d{3}E[A-Z0-9]{8}\b/i,
  ], { preferDecimal: true });
  const rawPotenzaDisponibile = matchNumber(sourceText, [
    /\bimp\.?\s*[\d.,]+\s*kW\s*-?\s*dis\.?\s*([\d.,]+)\s*kW/i,
    /potenza\s+disponibile\s*[:：]?\s*([\d.,]+)\s*kW/i,
    /IT\d{3}E[A-Z0-9]{8}\s*([\d.,]+)\s*kW/i,
  ], { preferDecimal: true });

  const consumoLuce = validatedNumber(rawConsumoLuce, { field: "consumo_luce", max: 100_000_000, warnings });
  const consumoGas = validatedNumber(rawConsumoGas, { field: "consumo_gas", max: 100_000_000, warnings });
  const prezzoLuce = validatedNumber(rawPrezzoLuce, { field: "prezzo_luce", max: 5, warnings });
  const prezzoGas = validatedNumber(rawPrezzoGas, { field: "prezzo_gas", max: 20, warnings });
  const potenzaImpegnata = validatedNumber(rawPotenzaImpegnata, { field: "potenza_impegnata", max: 1000, warnings });
  const potenzaDisponibile = validatedNumber(rawPotenzaDisponibile, { field: "potenza_disponibile", max: 1000, warnings });

  let fixedLuceMethod = fissoLuceMese ? "monthly_times_12" : null;
  let fixedGasMethod = fissoGasMese ? "monthly_times_12" : null;
  let fixedLuceAnnual = validatedNumber(fissoLuceMese ? fissoLuceMese * 12 : null, { field: "quota_fissa_luce", max: 10_000, warnings });
  let fixedGasAnnual = validatedNumber(fissoGasMese ? fissoGasMese * 12 : null, { field: "quota_fissa_gas", max: 10_000, warnings });
  const explicitLuceAnnual = offer.luce?.fixedAnnual ?? null;
  const explicitGasAnnual = offer.gas?.fixedAnnual ?? null;
  if (Number.isFinite(explicitLuceAnnual)) {
    fixedLuceAnnual = validatedNumber(explicitLuceAnnual, { field: "quota_fissa_luce", max: 10_000, warnings });
    fixedLuceMethod = "explicit_annual";
  }
  if (Number.isFinite(explicitGasAnnual)) {
    fixedGasAnnual = validatedNumber(explicitGasAnnual, { field: "quota_fissa_gas", max: 10_000, warnings });
    fixedGasMethod = "explicit_annual";
  }
  if (kind === "scheda_offerta") {
    const offerOpening = sourceText.slice(0, 6000);
    const luceFixedAnnual = offer.luce?.fixedAnnual ?? offer.generic.costoFissoAnno;
    const gasFixedAnnual = offer.gas?.fixedAnnual ?? offer.generic.costoFissoAnno;
    if (/energia elettrica|kwh|luce/i.test(offerOpening) && Number.isFinite(luceFixedAnnual)) { fixedLuceAnnual = luceFixedAnnual; fixedLuceMethod = "explicit_annual"; }
    if (/gas naturale|smc/i.test(offerOpening) && Number.isFinite(gasFixedAnnual)) { fixedGasAnnual = gasFixedAnnual; fixedGasMethod = "explicit_annual"; }
  }

  const provisionalSpreadLuce = offer.luce?.spread ?? offer.generic.spreadLuce;
  const provisionalSpreadGas = offer.gas?.spread ?? offer.generic.spreadGas;
  const provisionalSpreadLuceExplicitUnit = offer.luce?.spread !== null && offer.luce?.spread !== undefined
    ? Boolean(offer.luce.spreadExplicitUnit)
    : Boolean(offer.generic.spreadLuceExplicitUnit);
  const provisionalSpreadGasExplicitUnit = offer.gas?.spread !== null && offer.gas?.spread !== undefined
    ? Boolean(offer.gas.spreadExplicitUnit)
    : Boolean(offer.generic.spreadGasExplicitUnit);
  if (Number.isFinite(provisionalSpreadLuce) && !provisionalSpreadLuceExplicitUnit) warnings.push("spread_luce_unita_non_esplicita");
  if (Number.isFinite(provisionalSpreadGas) && !provisionalSpreadGasExplicitUnit) warnings.push("spread_gas_unita_non_esplicita");
  const hasLuceData = Boolean(consumoLuce || prezzoLuce || fixedLuceAnnual || pod || potenzaImpegnata || offer.luce || provisionalSpreadLuce);
  const hasGasData = Boolean(consumoGas || prezzoGas || fixedGasAnnual || pdr || offer.gas || provisionalSpreadGas);
  const commodity = hasLuceData && hasGasData ? "dual" : hasGasData ? "gas" : hasLuceData ? "luce" : "unknown";
  const finalizedOffer = finalizeOfferData(offer, commodity);
  const recognized = kind !== "unknown" && commodity !== "unknown";
  if (sourceText.trim().length < 20) warnings.push("testo_pdf_assente_o_insufficiente");
  if (!recognized) warnings.push("nessun_dato_utile_rilevato");

  const activation = extractActivationData(sourceText, { pod, pdr });
  if (activation.addressRejected) warnings.push("indirizzo_fornitura_non_valido");
  const customer = detectCustomerType(sourceText, activation);
  const essential = [consumoLuce, consumoGas, prezzoLuce, prezzoGas, fixedLuceAnnual, fixedGasAnnual, pod, pdr].filter((v) => v !== null && v !== "").length;
  const confidence = !recognized ? "low" : warnings.length === 0 && essential >= 3 ? "high" : "medium";

  return {
    parser_version: PDF_PARSER_VERSION,
    page_count: null,
    diagnostics: [],
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
    quota_fissa_vendita_luce_method: fixedLuceMethod,
    quota_fissa_vendita_gas_method: fixedGasMethod,
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
    nome_offerta: finalizedOffer.nomeOfferta,
    codice_offerta: finalizedOffer.codiceOfferta,
    tipo_prezzo: finalizedOffer.tipoPrezzo,
    indice_riferimento: finalizedOffer.indice,
    nome_offerta_luce: finalizedOffer.luce?.name ?? null,
    codice_offerta_luce: finalizedOffer.luce?.code ?? null,
    tipo_prezzo_luce: finalizedOffer.luce?.type ?? null,
    indice_riferimento_luce: finalizedOffer.luce?.index ?? null,
    spread_luce_eur_kwh: finalizedOffer.spreadLuce,
    nome_offerta_gas: finalizedOffer.gas?.name ?? null,
    codice_offerta_gas: finalizedOffer.gas?.code ?? null,
    tipo_prezzo_gas: finalizedOffer.gas?.type ?? null,
    indice_riferimento_gas: finalizedOffer.gas?.index ?? null,
    spread_gas_eur_smc: finalizedOffer.spreadGas,
    textExtracted: sourceText.length,
    needsReview: confidence !== "high" || warnings.length > 0,
  };
}

export async function extractPdfWithPages(filePath) {
  const buffer = await fs.readFile(filePath);
  const pdfParseModule = await import("pdf-parse");
  const pdfParse = pdfParseModule.default || pdfParseModule;
  const pageTexts = [];
  const parsed = await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const pageText = await renderPdfPageText(pageData);
      pageTexts.push(pageText);
      return pageText;
    },
  });
  const normalized = extractPdfDataFromText(parsed.text || pageTexts.join("\n"));
  normalized.page_count = Number(parsed.numpages || pageTexts.length || 0) || null;
  normalized.diagnostics = buildPdfDiagnostics(normalized, pageTexts);
  return { normalized, pageTexts };
}

export async function extractPdf(filePath) {
  const result = await extractPdfWithPages(filePath);
  return result.normalized;
}
