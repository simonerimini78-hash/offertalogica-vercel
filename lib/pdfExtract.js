import fs from "node:fs/promises";

const MINUS_PATTERN = /[−–—]/g;

function normalizeMinus(value) {
  return String(value || "").replace(MINUS_PATTERN, "-");
}

function numberFromItalian(value, { preferDecimal = false } = {}) {
  if (value === undefined || value === null || value === "") return null;

  const raw = normalizeMinus(value)
    .trim()
    .replace(/[\u00A0\s']/g, "");

  if (!raw) return null;

  let normalized = raw;
  const commaIndex = raw.lastIndexOf(",");
  const dotIndex = raw.lastIndexOf(".");

  if (commaIndex >= 0 && dotIndex >= 0) {
    if (commaIndex > dotIndex) {
      normalized = raw.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = raw.replace(/,/g, "");
    }
  } else if (commaIndex >= 0) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (dotIndex >= 0) {
    const unsigned = raw.replace(/^[+-]/, "");
    const groups = unsigned.split(".");
    const startsWithZero = /^0\./.test(unsigned);

    if (groups.length > 2) {
      const looksLikeThousands = groups.slice(1).every((group) => /^\d{3}$/.test(group));
      normalized = looksLikeThousands && !preferDecimal
        ? raw.replace(/\./g, "")
        : `${raw.slice(0, raw.lastIndexOf(".")).replace(/\./g, "")}.${groups.at(-1)}`;
    } else {
      const decimals = groups[1] || "";
      const looksLikeThousands = /^\d{1,3}$/.test(groups[0]) && /^\d{3}$/.test(decimals);
      if (looksLikeThousands && !preferDecimal && !startsWithZero) {
        normalized = raw.replace(".", "");
      }
    }
  }

  const number = Number.parseFloat(normalized);
  return Number.isFinite(number) ? number : null;
}

function matchNumber(text, patterns, options) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return numberFromItalian(match[1], options);
  }
  return null;
}

function matchText(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return String(match[1] || "").trim();
  }
  return null;
}

function matchNumberNear(text, anchorPattern, patterns, maxChars = 2200, options) {
  const anchor = text.match(anchorPattern);
  if (!anchor || typeof anchor.index !== "number") return null;
  const segment = text.slice(anchor.index, anchor.index + maxChars);
  return matchNumber(segment, patterns, options);
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

  const header = String(text || "").slice(0, 8000);
  const candidates = providers
    .map(([pattern, label]) => {
      const match = header.match(pattern);
      return match && typeof match.index === "number" ? { label, index: match.index } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);

  return candidates[0]?.label || "";
}

function detectDocumentKind(lower) {
  const offerMarkers = [
    "scheda sintetica",
    "condizioni tecnico economiche",
    "condizioni tecnico-economiche",
    "condizioni economiche dell'offerta",
    "scheda di confrontabilità",
    "documentazione precontrattuale",
  ];
  if (offerMarkers.some((marker) => lower.includes(marker))) return "scheda_offerta";

  const billMarkers = [
    "bolletta",
    "fattura",
    "totale da pagare",
    "periodo di fatturazione",
    "codice pod",
    "codice pdr",
    "punto di prelievo",
    "punto di riconsegna",
  ];
  if (billMarkers.some((marker) => lower.includes(marker))) return "bolletta";

  return "unknown";
}

function normalizePod(value) {
  if (!value) return null;
  const normalized = String(value).toUpperCase().replace(/[\s-]/g, "");
  return /^IT\d{3}E[A-Z0-9]{8}$/.test(normalized) ? normalized : null;
}

function normalizePdr(value) {
  if (!value) return null;
  const normalized = String(value).replace(/\D/g, "");
  return /^\d{14}$/.test(normalized) ? normalized : null;
}

function validatedNumber(value, { field, min = 0, max, warnings }) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < min || (Number.isFinite(max) && value > max)) {
    warnings.push(`${field}_fuori_intervallo`);
    return null;
  }
  return value;
}

export function extractPdfDataFromText(text = "") {
  const sourceText = String(text || "");
  const lower = sourceText.toLowerCase();
  const warnings = [];

  const rawConsumoLuce = matchNumber(sourceText, [
    /in\s+un\s+anno\s+hai\s+consumato[\s\S]{0,100}?([\d\s.,]+)\s*kwh/i,
    /totale\s+consumo\s+annuo[^\d]{0,80}([\d\s.,]+)\s*kwh/i,
    /consumo annuo[^\d]{0,80}([\d\s.,]+)\s*kwh/i,
    /consumo annuo \(kwh\)[^\d]{0,30}([\d\s.,]+)/i,
    /consumo rilevato annuo[^\d]{0,80}([\d\s.,]+)\s*kwh/i,
  ]);
  const rawConsumoGas = matchNumber(sourceText, [
    /in\s+un\s+anno\s+hai\s+consumato[\s\S]{0,100}?([\d\s.,]+)\s*smc/i,
    /consumo annuo[^\d]{0,80}([\d\s.,]+)\s*smc/i,
    /consumo annuo \(mc\)[^\d]{0,30}([\d\s.,]+)/i,
    /consumo annuo[^\d]{0,80}([\d\s.,]+)\s*mc/i,
  ]);

  const rawPrezzoLuce = matchNumber(sourceText, [
    /di cui\s+spesa\s+per\s+(?:la\s+)?vendita\s+di\s+energia\s+elettrica[\s\S]{0,140}?[\d.,]+\s*€\s*([-−–]?\s*[\d.,]+)\s*€\/kwh/i,
    /di cui\s+spesa\s+per\s+(?:la\s+)?vendita\s+di\s+energia\s+elettrica[\s\S]{0,140}?([-−–]?\s*[\d.,]+)\s*€\/kwh/i,
    /spesa per (?:la )?vendita di energia elettrica[\s\S]{0,450}?quota per consumi[\s\S]{0,120}?([-−–]?\s*[\d.,]+)\s*€\/kwh/i,
    /spesa per (?:la )?(?:vendita )?(?:energia elettrica|materia energia)[\s\S]{0,160}?([-−–]?\s*[\d.,]+)\s*€\/kwh/i,
    /di cui spesa per (?:vendita )?(?:energia elettrica|materia energia)[^\d]{0,80}([-−–]?\s*[\d.,]+)\s*€\/kwh/i,
    /corrispettivo (?:energia|per il consumo)[^\d]{0,80}([-−–]?\s*[\d.,]+)\s*€\/kwh/i,
  ], { preferDecimal: true });

  const rawPrezzoGas = matchNumber(sourceText, [
    /di cui\s+spesa\s+per\s+(?:la\s+)?vendita\s+di\s+gas\s+naturale[\s\S]{0,140}?[\d.,]+\s*€\s*([-−–]?\s*[\d.,]+)\s*€\/smc/i,
    /di cui\s+spesa\s+per\s+(?:la\s+)?vendita\s+di\s+gas\s+naturale[\s\S]{0,140}?([-−–]?\s*[\d.,]+)\s*€\/smc/i,
    /spesa per (?:la )?vendita di gas naturale[\s\S]{0,450}?quota per consumi[\s\S]{0,120}?([-−–]?\s*[\d.,]+)\s*€\/smc/i,
    /spesa per (?:la )?(?:vendita )?gas naturale[\s\S]{0,160}?([-−–]?\s*[\d.,]+)\s*€\/smc/i,
    /di cui spesa per (?:vendita )?gas naturale[^\d]{0,80}([-−–]?\s*[\d.,]+)\s*€\/smc/i,
    /corrispettivo (?:gas|per il consumo)[^\d]{0,80}([-−–]?\s*[\d.,]+)\s*€\/smc/i,
  ], { preferDecimal: true });

  const fissoLuceMese = matchNumber(sourceText, [
    /quota\s+fissa[\s\S]{0,360}?di cui\s+spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?energia\s+elettrica[\s\S]{0,120}?([\d.,]+)\s*€\/mese/i,
  ]) || matchNumberNear(sourceText, /spesa per (?:la )?vendita (?:di )?energia elettrica/i, [
    /quota fissa[\s\S]{0,140}?[\d.,]+\s*€\s*([\d.,]+)\s*€\/mese/i,
    /di cui spesa per (?:la )?vendita (?:di )?energia elettrica\*?[\s\S]{0,120}?([\d.,]+)\s*€\/mese/i,
  ], 2200);

  const fissoGasMese = matchNumber(sourceText, [
    /quota\s+fissa[\s\S]{0,360}?di cui\s+spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?gas\s+naturale[\s\S]{0,120}?([\d.,]+)\s*€\/mese/i,
  ]) || matchNumberNear(sourceText, /spesa per (?:la )?vendita (?:di )?gas naturale/i, [
    /quota fissa[\s\S]{0,140}?[\d.,]+\s*€\s*([\d.,]+)\s*€\/mese/i,
    /di cui spesa per (?:la )?vendita (?:di )?gas naturale\*?[\s\S]{0,120}?([\d.,]+)\s*€\/mese/i,
  ], 2200);

  const fissoLuceAnno = matchNumberNear(sourceText, /spesa per (?:la )?vendita (?:di )?energia elettrica/i, [
    /corrispettivo (?:annuo|fisso)[^\d]{0,80}([\d.,]+)\s*€\/anno/i,
  ], 2200);
  const fissoGasAnno = matchNumberNear(sourceText, /spesa per (?:la )?vendita (?:di )?gas naturale/i, [
    /corrispettivo (?:annuo|fisso)[^\d]{0,80}([\d.,]+)\s*€\/anno/i,
  ], 2200);

  const podCandidate = matchText(sourceText, [
    /\b(IT\s*\d\s*\d\s*\d\s*E(?:\s*[A-Z0-9]){8})\b/i,
    /punto\s+di\s+prelievo\s*\(pod\)[\s\S]{0,220}?\b(IT\s*\d\s*\d\s*\d\s*E(?:\s*[A-Z0-9]){8})\b/i,
    /codice\s+pod[:\s]+(IT\s*\d\s*\d\s*\d\s*E(?:\s*[A-Z0-9]){8})/i,
    /\bPOD[:\s]+(IT\s*\d\s*\d\s*\d\s*E(?:\s*[A-Z0-9]){8})/i,
  ]);
  const pdrCandidate = matchText(sourceText, [
    /indirizzo\s+di\s+fornitura\s+PDR[\s\S]{0,240}?\b((?:\d[\s.-]*){14})\b/i,
    /\bPDR[\s\S]{0,160}?\b((?:\d[\s.-]*){14})\b/i,
    /punto\s+di\s+riconsegna\s*\(pdr\)[\s\S]{0,220}?\b((?:\d[\s.-]*){14})\b/i,
    /codice\s+pdr[:\s]+((?:\d[\s.-]*){14})/i,
  ]);

  const rawPotenzaImpegnata = matchNumber(sourceText, [
    /\b([\d.,]+)\s*kW\s*IT\s*\d{3}\s*E[A-Z0-9\s-]{8,20}\b/i,
    /potenza\s+impegnata[^\d]{0,40}([\d.,]+)\s*kW/i,
    /potenza\s+contrattualmente\s+impegnata[^\d]{0,40}([\d.,]+)\s*kW/i,
  ], { preferDecimal: true });
  const rawPotenzaDisponibile = matchNumber(sourceText, [
    /potenza\s+disponibile[^\d]{0,40}([\d.,]+)\s*kW/i,
  ], { preferDecimal: true });

  const consumoLuce = validatedNumber(rawConsumoLuce, { field: "consumo_luce", max: 100_000_000, warnings });
  const consumoGas = validatedNumber(rawConsumoGas, { field: "consumo_gas", max: 100_000_000, warnings });
  const prezzoLuce = validatedNumber(rawPrezzoLuce, { field: "prezzo_luce", max: 5, warnings });
  const prezzoGas = validatedNumber(rawPrezzoGas, { field: "prezzo_gas", max: 20, warnings });
  const potenzaImpegnata = validatedNumber(rawPotenzaImpegnata, { field: "potenza_impegnata", max: 1000, warnings });
  const potenzaDisponibile = validatedNumber(rawPotenzaDisponibile, { field: "potenza_disponibile", max: 1000, warnings });
  const fixedLuceAnnual = validatedNumber(
    fissoLuceAnno || (fissoLuceMese ? fissoLuceMese * 12 : null),
    { field: "quota_fissa_luce", max: 10_000, warnings },
  );
  const fixedGasAnnual = validatedNumber(
    fissoGasAnno || (fissoGasMese ? fissoGasMese * 12 : null),
    { field: "quota_fissa_gas", max: 10_000, warnings },
  );

  const pod = normalizePod(podCandidate);
  const pdr = normalizePdr(pdrCandidate);
  if (podCandidate && !pod) warnings.push("pod_formato_non_valido");
  if (pdrCandidate && !pdr) warnings.push("pdr_formato_non_valido");

  const hasLuceData = Boolean(consumoLuce || prezzoLuce || fixedLuceAnnual || pod || potenzaImpegnata);
  const hasGasData = Boolean(consumoGas || prezzoGas || fixedGasAnnual || pdr);
  const hasLuceMarker = lower.includes("energia elettrica") || lower.includes("kwh") || lower.includes("codice pod");
  const hasGasMarker = lower.includes("gas naturale") || lower.includes("smc") || lower.includes("codice pdr");
  const hasLuce = hasLuceData || (!hasGasData && hasLuceMarker);
  const hasGas = hasGasData || (!hasLuceData && hasGasMarker);
  const commodity = hasLuce && hasGas ? "dual" : hasGas ? "gas" : hasLuce ? "luce" : "unknown";
  const detectedKind = detectDocumentKind(lower);
  const hasUsefulData = hasLuceData || hasGasData;
  const kind = detectedKind === "unknown" && hasUsefulData ? "bolletta" : detectedKind;
  const recognized = kind !== "unknown" && commodity !== "unknown" && hasUsefulData;

  if (sourceText.trim().length < 20) warnings.push("testo_pdf_assente_o_insufficiente");
  if (!hasUsefulData) warnings.push("nessun_dato_utile_rilevato");
  if (kind === "unknown") warnings.push("tipo_documento_non_riconosciuto");
  if (commodity === "unknown") warnings.push("commodity_non_riconosciuta");

  const confidence = !recognized
    ? "low"
    : warnings.length === 0 && (pod || pdr) && (consumoLuce || consumoGas)
      ? "high"
      : "medium";

  return {
    kind,
    commodity,
    recognized,
    confidence,
    warnings: [...new Set(warnings)],
    fornitore: detectProvider(sourceText),
    consumo_luce_kwh: consumoLuce,
    consumo_gas_smc: consumoGas,
    prezzo_luce_eur_kwh: prezzoLuce,
    prezzo_gas_eur_smc: prezzoGas,
    quota_fissa_vendita_luce_eur_anno: fixedLuceAnnual,
    quota_fissa_vendita_gas_eur_anno: fixedGasAnnual,
    potenza_impegnata_kw: potenzaImpegnata,
    potenza_disponibile_kw: potenzaDisponibile,
    pod,
    pdr,
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
