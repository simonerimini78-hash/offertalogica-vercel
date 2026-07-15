import fs from "node:fs/promises";

export const PDF_PARSER_VERSION = "v89-archive-diagnostics-1";

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
  const compact = text.replace(/[\s.,-]/g, "");
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
      const compact = lower.replace(/[\s.,-]/g, "");
      for (const value of normalizedValues) {
        let index = lower.indexOf(value);
        if (index < 0) {
          const compactValue = value.replace(/[\s.,-]/g, "");
          const compactIndex = compact.indexOf(compactValue);
          if (compactIndex >= 0) index = 0;
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
  const present = value !== null && value !== undefined && value !== "";
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
  return {
    field: config.key,
    label: config.label,
    value: present ? value : null,
    status: present ? (warningHit || derived ? "review" : "found") : required ? "missing" : "optional_missing",
    confidence: present ? (warningHit || derived ? "medium" : normalized.confidence || "medium") : "low",
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
    { key: "fornitore", label: "Fornitore", labels: [/dolomiti\s+energia|eni\s+plenitude|plenitude|hera(?:\s+comm)?|e[.\s-]*on|acea\s+energia|pulsee|illumia|enel\s+energia|butangas/i], required: true },
    { key: "kind", label: "Tipo documento", labels: [/scheda\s+sintetica|scontrino\s+dell['’]energia|fattura\s+elettronica|totale\s+da\s+pagare/i], method: "document_classifier", required: true },
    { key: "commodity", label: "Fornitura rilevata", labels: [/energia\s+elettrica|gas\s+naturale|codice\s+pod|codice\s+pdr/i], method: "commodity_classifier", required: true },
    { key: "customer_type", label: "Tipo cliente", labels: [/tipologia\s+(?:di\s+)?cliente|client[ei]\s+non\s+domestic[io]|domestico\s+residente|microbusiness|partita\s+iva/i], extraValues: (n) => [n.customer_type_evidence], applicable: isBill, required: isBill },
    { key: "consumo_luce_kwh", label: "Consumo annuo luce", labels: [/in\s+un\s+anno\s+hai\s+consumato|consumo\s+annuo/i], warningPrefixes: ["consumo_luce"], applicable: hasLuce, required: isBill },
    { key: "consumo_gas_smc", label: "Consumo annuo gas", labels: [/in\s+un\s+anno\s+hai\s+consumato|consumo\s+annuo/i], sourceValue: (n) => n.warnings?.includes("consumo_gas_convertito_da_mc_a_smc") ? n.consumo_gas_mc : n.consumo_gas_smc, derived: (n) => n.warnings?.includes("consumo_gas_convertito_da_mc_a_smc"), derivedMethod: "mc_times_coefficiente_c", warningPrefixes: ["consumo_gas"], applicable: hasGas, required: isBill },
    { key: "prezzo_luce_eur_kwh", label: "Prezzo vendita luce", labels: [/spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?energia|materia\s+energia|corrispettivo\s+energia/i], warningPrefixes: ["prezzo_luce"], applicable: hasLuce, required: (n) => isBill(n) || (isOffer(n) && n.tipo_prezzo === "fisso") },
    { key: "prezzo_gas_eur_smc", label: "Prezzo vendita gas", labels: [/spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?gas|materia\s+prima\s+gas|corrispettivo\s+gas/i], warningPrefixes: ["prezzo_gas"], applicable: hasGas, required: (n) => isBill(n) || (isOffer(n) && n.tipo_prezzo === "fisso") },
    { key: "quota_fissa_vendita_luce_eur_anno", label: "Quota fissa luce annua", labels: [/quota\s+fissa|costo\s+fisso\s+anno|corrispettivo\s+fisso/i], sourceValue: (n) => n.kind === "bolletta" && Number.isFinite(n.quota_fissa_vendita_luce_eur_anno) ? n.quota_fissa_vendita_luce_eur_anno / 12 : n.quota_fissa_vendita_luce_eur_anno, extraValues: (n) => [n.quota_fissa_vendita_luce_eur_anno], derived: (n) => n.kind === "bolletta" && Number.isFinite(n.quota_fissa_vendita_luce_eur_anno), derivedMethod: "monthly_times_12", warningPrefixes: ["quota_fissa_luce"], applicable: hasLuce, required: true },
    { key: "quota_fissa_vendita_gas_eur_anno", label: "Quota fissa gas annua", labels: [/quota\s+fissa|costo\s+fisso\s+anno|corrispettivo\s+fisso/i], sourceValue: (n) => n.kind === "bolletta" && Number.isFinite(n.quota_fissa_vendita_gas_eur_anno) ? n.quota_fissa_vendita_gas_eur_anno / 12 : n.quota_fissa_vendita_gas_eur_anno, extraValues: (n) => [n.quota_fissa_vendita_gas_eur_anno], derived: (n) => n.kind === "bolletta" && Number.isFinite(n.quota_fissa_vendita_gas_eur_anno), derivedMethod: "monthly_times_12", warningPrefixes: ["quota_fissa_gas"], applicable: hasGas, required: true },
    { key: "potenza_impegnata_kw", label: "Potenza impegnata", labels: [/potenza\s+impegnata|potenza\s+contrattualmente\s+impegnata/i], warningPrefixes: ["potenza_impegnata"], applicable: (n) => isBill(n) && hasLuce(n), required: (n) => isBill(n) && hasLuce(n) },
    { key: "potenza_disponibile_kw", label: "Potenza disponibile", labels: [/potenza\s+disponibile/i], warningPrefixes: ["potenza_disponibile"], applicable: (n) => isBill(n) && hasLuce(n) },
    { key: "pod", label: "POD", labels: [/(?:codice\s+)?pod|punto\s+di\s+prelievo/i], applicable: (n) => isBill(n) && hasLuce(n), required: (n) => isBill(n) && hasLuce(n) },
    { key: "pdr", label: "PDR", labels: [/(?:codice\s+)?pdr|punto\s+di\s+riconsegna/i], applicable: (n) => isBill(n) && hasGas(n), required: (n) => isBill(n) && hasGas(n) },
    { key: "intestatario", label: "Intestatario", labels: [/contratto\s+intestato\s+a|i\s+tuoi\s+dati\s+identificativi|intestata\s+a/i], applicable: isBill, required: isBill },
    { key: "codice_fiscale", label: "Codice fiscale / P.IVA", labels: [/codice\s+fiscale(?:\s*\/\s*partita\s+iva)?|partita\s+iva/i], applicable: isBill, required: isBill },
    { key: "codice_cliente", label: "Codice cliente", labels: [/codice\s+cliente|numero\s+cliente/i], applicable: isBill, required: isBill },
    { key: "indirizzo_fornitura", label: "Indirizzo fornitura", labels: [/indirizzo\s+di\s+fornitura|servizio\s+fornito\s+in/i], applicable: isBill, required: isBill },
    { key: "nome_offerta", label: "Nome offerta", labels: [/nome\s+offerta|\bofferta\s*:/i], applicable: (n) => isOffer(n) || Boolean(n.nome_offerta), required: isOffer },
    { key: "codice_offerta", label: "Codice offerta", labels: [/codice\s+offerta/i], applicable: (n) => isOffer(n) || Boolean(n.codice_offerta), required: isOffer },
    { key: "tipo_prezzo", label: "Tipo prezzo", labels: [/tipologia\s+(?:di\s+)?offerta|tipologia\s+prezzo|prezzo\s+fisso|prezzo\s+variabile/i], applicable: (n) => isOffer(n) || Boolean(n.tipo_prezzo), required: isOffer },
    { key: "indice_riferimento", label: "Indice di riferimento", labels: [/indice\s+di\s+riferimento|pun\s+index|\bpsv(?:da)?\b/i], applicable: (n) => isOffer(n) && n.tipo_prezzo === "variabile", required: (n) => isOffer(n) && n.tipo_prezzo === "variabile" },
    { key: "spread_luce_eur_kwh", label: "Spread luce", labels: [/spread|pun[\s\S]{0,80}\+/i], applicable: (n) => isOffer(n) && hasLuce(n) && n.tipo_prezzo === "variabile", required: (n) => isOffer(n) && hasLuce(n) && n.tipo_prezzo === "variabile" },
    { key: "spread_gas_eur_smc", label: "Spread gas", labels: [/spread|psv[\s\S]{0,80}\+/i], applicable: (n) => isOffer(n) && hasGas(n) && n.tipo_prezzo === "variabile", required: (n) => isOffer(n) && hasGas(n) && n.tipo_prezzo === "variabile" },
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
  return normalized;
}
