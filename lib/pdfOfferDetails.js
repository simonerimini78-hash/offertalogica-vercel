const DATE_PATTERN = "([0-3]?\\d[./-][01]?\\d[./-](?:19|20)\\d{2})";

function compactText(value) {
  return String(value ?? "")
    .replace(/\.{4,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanValue(value, maxLength = 240) {
  const normalized = compactText(value)
    .replace(/^[\s:;,-]+|[\s:;,-]+$/g, "")
    .trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

export function normalizeOfferDate(value) {
  const match = String(value ?? "").trim().match(/^([0-3]?\d)[./-]([01]?\d)[./-]((?:19|20)\d{2})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function firstMatch(text, patterns, group = 1) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = cleanValue(match?.[group]);
    if (value) return value;
  }
  return null;
}

function normalizePriceStructure(value) {
  const normalized = cleanValue(value, 100);
  if (!normalized) return null;
  if (/per\s+fasce|multiorar|biorar|fasce\s+orarie/i.test(normalized)) return "per fasce";
  if (/monorar/i.test(normalized)) return "monorario";
  return null;
}

function normalizePeriodicity(value) {
  const normalized = cleanValue(value, 80);
  if (!normalized) return null;
  if (/mensil/i.test(normalized)) return "mensile";
  if (/trimestral/i.test(normalized)) return "trimestrale";
  if (/bimestral/i.test(normalized)) return "bimestrale";
  if (/semestral/i.test(normalized)) return "semestrale";
  if (/annual/i.test(normalized)) return "annuale";
  return normalized.toLowerCase();
}

function normalizeRecesso(value) {
  const normalized = cleanValue(value, 120);
  if (!normalized) return null;
  if (/^(?:no|nessun[oa]?|non\s+previst[oa])$/i.test(normalized)) return "nessuno";
  return normalized;
}

function normalizeFeature(value) {
  const normalized = cleanValue(value, 220);
  if (!normalized || /^vedi\s+nota/i.test(normalized)) return null;
  return normalized;
}

function extractValidity(compact) {
  const range = compact.match(new RegExp(`validit[aà]\\s+condizioni\\s+economiche\\s*:?\\s*dal\\s*${DATE_PATTERN}\\s*al\\s*${DATE_PATTERN}`, "i"));
  const validFrom = normalizeOfferDate(range?.[1]) || normalizeOfferDate(firstMatch(compact, [
    new RegExp(`decorrenza\\s+(?:delle\\s+)?condizioni\\s+economiche\\s*:?\\s*${DATE_PATTERN}`, "i"),
  ]));
  const validTo = normalizeOfferDate(range?.[2]) || normalizeOfferDate(firstMatch(compact, [
    new RegExp(`scadenza\\s+(?:delle\\s+)?condizioni\\s+economiche\\s*:?\\s*${DATE_PATTERN}`, "i"),
  ]));
  return { validFrom, validTo };
}

function extractFormula(compact) {
  return firstMatch(compact, [
    /formula\s+per\s+il\s+calcolo\s+(?:dell['’]energia|del\s+gas\s+naturale|dell['’]offerta|del\s+prezzo)\s*:\s*(.{2,260}?)(?=\s+(?:valori\s+assunti|decorrenza\s+condizioni|scadenza\s+condizioni|oneri?\s+(?:di\s+)?recesso|quota\s+fissa|informazioni\s+corrispettivi|mese\s+di\s+riferimento|quali\s+spese|$))/i,
    /formula\s+prevista(?:\s+dal\s+contratto)?\s*:\s*(.{2,260}?)(?=\s+(?:mese\s+di\s+riferimento|corrispettivo\s+(?:energia|gas)\s+sconto|quali\s+spese|decorrenza\s+condizioni|scadenza\s+condizioni|oner[ei]\s+(?:di\s+)?recesso|quota\s+fissa|indice\s+di\s+riferimento|$))/i,
  ], 1);
}

const COMPONENT_RULES = [
  [/\bpun\s+fasce\b/i, "PUN fasce"],
  [/\bpun\s+index(?:\s+gme)?\b/i, "PUN Index GME"],
  [/\bpun\b/i, "PUN"],
  [/\bpsv(?:\s+day\s+ahead|\s*da)?\b/i, "PSV"],
  [/\bspread\b/i, "spread"],
  [/\bdispacciamento\b/i, "dispacciamento"],
  [/\bperdite\b/i, "perdite di rete"],
  [/\bsconto\s+domiciliazione\b/i, "sconto domiciliazione"],
  [/\bcorrispettivo\s+energia\b/i, "corrispettivo energia"],
  [/\bcorrispettivo\s+gas\b/i, "corrispettivo gas"],
  [/\bprezzo\s+fisso\b/i, "prezzo fisso"],
  [/\bprezzo\s+variabile\b/i, "prezzo variabile"],
];

function extractComponents(formula, compact) {
  const source = formula || compact.slice(0, 5000);
  const components = [];
  for (const [pattern, label] of COMPONENT_RULES) {
    if (pattern.test(source) && !components.includes(label)) components.push(label);
  }
  if (components.includes("PUN fasce") || components.includes("PUN Index GME")) {
    const index = components.indexOf("PUN");
    if (index >= 0) components.splice(index, 1);
  }
  return components;
}

function parseItalianDecimal(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function discountToken(label) {
  return label
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
}

function extractDiscountAmount(source, label, unit) {
  const token = discountToken(label);
  const windowPattern = new RegExp(`${token}([\\s\\S]{0,280})`, "ig");
  const candidates = [];
  for (const occurrence of source.matchAll(windowPattern)) {
    const window = occurrence[1] || "";
    const patterns = [
      new RegExp(`€\\s*\\/?\\s*${unit}\\s*(-?[0-9]+(?:[.,][0-9]+)?)`, "ig"),
      new RegExp(`(-?[0-9]+(?:[.,][0-9]+)?)\\s*€\\s*\\/?\\s*${unit}`, "ig"),
    ];
    for (const pattern of patterns) {
      for (const match of window.matchAll(pattern)) {
        const amount = parseItalianDecimal(match[1]);
        if (amount !== null) candidates.push(amount);
      }
    }
  }
  if (!candidates.length) return null;
  return candidates.find((amount) => amount < 0) ?? candidates[0];
}

function extractDiscounts(formula, compact, commodity) {
  const source = `${formula || ""} ${compact}`;
  const definitions = [
    [/\bsconto\s+domiciliazione\b/i, "Sconto domiciliazione"],
    [/\bsconto\s+(?:bolletta\s+)?(?:web|digitale)\b/i, "Sconto bolletta digitale"],
    [/\bsconto\s+(?:di\s+)?benvenuto\b|\bwelcome\s+bonus\b/i, "Sconto di benvenuto"],
    [/\bsconto\s+fedelt[aà]\b/i, "Sconto fedeltà"],
    [/\bsconto\s+rid\b/i, "Sconto RID"],
  ];
  const labels = definitions.filter(([pattern]) => pattern.test(source)).map(([, label]) => label);

  const unit = commodity === "gas" ? "smc" : commodity === "luce" ? "kwh" : "(?:kwh|smc)";
  const values = [];
  for (const label of labels) {
    const amount = extractDiscountAmount(source, label, unit);
    if (amount !== null) {
      values.push({
        nome: label,
        valore: amount,
        unita: commodity === "gas" ? "EUR/Smc" : commodity === "luce" ? "EUR/kWh" : "EUR/unità",
      });
    }
  }
  return { labels, values };
}

export function extractOfferDetails(section, commodity = null) {
  const compact = compactText(section);
  const { validFrom, validTo } = extractValidity(compact);
  const formula = extractFormula(compact);
  const priceStructure = normalizePriceStructure(firstMatch(compact, [
    /tipologia\s+prezzo\s+offerta\s*:\s*(.{2,100}?)(?=\s+(?:periodicit[aà]|spesa\s+per|formula|decorrenza|scadenza|oneri?|quota\s+fissa|$))/i,
    /tipologia\s+(?:di\s+)?prezzo\s*:\s*(.{2,100}?)(?=\s+(?:decorrenza|scadenza|oneri?|altre\s+caratteristiche|codice\s+offerta|$))/i,
  ]));
  const indexPeriodicity = normalizePeriodicity(firstMatch(compact, [
    /periodicit[aà]\s+(?:di\s+)?aggiornamento\s+indice\s*:\s*(.{2,80}?)(?=\s+(?:tipologia|spesa\s+per|formula|decorrenza|scadenza|oneri?|$))/i,
  ]));
  const billingFrequency = normalizePeriodicity(firstMatch(compact, [
    /frequenza\s+fatturazione\s*:\s*(.{2,80}?)(?=\s+(?:tipologia|oner[ei]|altre\s+caratteristiche|dettaglio)|$)/i,
  ]));
  const terminationFee = normalizeRecesso(firstMatch(compact, [
    /oner[ei]\s+(?:di\s+)?recesso(?:\s+anticipato)?\s*:\s*(.{1,100}?)(?=\s+(?:altre\s+caratteristiche|codice\s+offerta|dettaglio|informazioni|quota\s+fissa)|$)/i,
  ]));
  const economicConditionsCode = firstMatch(compact, [
    /codice\s+condizioni\s+economiche\s*:\s*([A-Z0-9_.-]{6,100})/i,
  ]);
  const otherFeatures = normalizeFeature(firstMatch(compact, [
    /altre\s+caratteristiche(?:\s+dell['’]offerta)?\s*:\s*(.{2,220}?)(?=\s+(?:formula\s+prevista|dettaglio|codice\s+offerta|calcolata\s+tramite|informazioni|quota\s+fissa)|$)/i,
  ]));
  const contractExpiryRaw = firstMatch(compact, [
    /scadenza\s+contratto\s*:\s*(.{2,80}?)(?=\s+(?:frequenza|tipologia|oner[ei]|altre\s+caratteristiche|scadenza\s+condizioni)|$)/i,
  ]);
  const contractExpiry = normalizeOfferDate(contractExpiryRaw) || contractExpiryRaw;
  const components = extractComponents(formula, compact);
  const discounts = extractDiscounts(formula, compact, commodity);

  return {
    validFrom,
    validTo,
    priceStructure,
    indexPeriodicity,
    billingFrequency,
    formula,
    components,
    discounts: discounts.labels,
    discountValues: discounts.values,
    terminationFee,
    economicConditionsCode,
    otherFeatures,
    contractExpiry,
  };
}

export function hasGroundedOfferUnit(section, commodity, token = "spread") {
  const source = String(section || "");
  const unit = commodity === "gas" ? "smc" : commodity === "luce" ? "kwh" : null;
  if (!unit) return false;
  const tokenPattern = new RegExp(`\\b${token}\\b`, "i");
  const match = tokenPattern.exec(source);
  if (!match) return false;
  const start = Math.max(0, match.index - 700);
  const end = Math.min(source.length, match.index + 500);
  const context = source.slice(start, end);
  return new RegExp(`(?:\\(\\s*€\\s*\\/\\s*${unit}\\s*\\)|€\\s*\\/\\s*${unit})`, "i").test(context);
}
