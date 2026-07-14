import fs from "node:fs/promises";

function numberFromItalian(value) {
  if (!value) return null;
  const raw = String(value).trim().replace(/\s/g, "");
  let normalized = raw;
  if (raw.includes(",") && raw.includes(".")) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (raw.includes(",")) {
    normalized = raw.replace(",", ".");
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(raw)) {
    normalized = raw.replace(/\./g, "");
  }
  const number = Number.parseFloat(normalized);
  return Number.isFinite(number) ? number : null;
}

function matchNumber(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return numberFromItalian(match[1]);
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

function matchNumberNear(text, anchorPattern, patterns, maxChars = 2200) {
  const anchor = text.match(anchorPattern);
  if (!anchor || typeof anchor.index !== "number") return null;
  const segment = text.slice(anchor.index, anchor.index + maxChars);
  return matchNumber(segment, patterns);
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
  const found = providers.find(([pattern]) => pattern.test(text));
  if (found) return found[1];
  return "";
}

export function extractPdfDataFromText(text = "") {
  const lower = text.toLowerCase();

  const consumoLuce = matchNumber(text, [
    /in\s+un\s+anno\s+hai\s+consumato[\s\S]{0,100}?([\d.,]+)\s*kwh/i,
    /totale\s+consumo\s+annuo[^\d]{0,80}([\d.,]+)\s*kwh/i,
    /consumo annuo[^\d]{0,80}([\d.,]+)\s*kwh/i,
    /consumo annuo \(kwh\)[^\d]{0,30}([\d.,]+)/i,
    /consumo rilevato annuo[^\d]{0,80}([\d.,]+)\s*kwh/i,
  ]);
  const consumoGas = matchNumber(text, [
    /in\s+un\s+anno\s+hai\s+consumato[\s\S]{0,100}?([\d.,]+)\s*smc/i,
    /consumo annuo[^\d]{0,80}([\d.,]+)\s*smc/i,
    /consumo annuo \(mc\)[^\d]{0,30}([\d.,]+)/i,
    /consumo annuo[^\d]{0,80}([\d.,]+)\s*mc/i,
  ]);
  const prezzoLuce = matchNumber(text, [
    /di cui\s+spesa\s+per\s+(?:la\s+)?vendita\s+di\s+energia\s+elettrica[\s\S]{0,140}?[\d.,]+\s*€\s*([\d.,]+)\s*€\/kwh/i,
    /di cui\s+spesa\s+per\s+(?:la\s+)?vendita\s+di\s+energia\s+elettrica[\s\S]{0,140}?([\d.,]+)\s*€\/kwh/i,
    /spesa per (?:la )?vendita di energia elettrica[\s\S]{0,450}?quota per consumi[\s\S]{0,120}?([\d.,]+)\s*€\/kwh/i,
    /spesa per (?:la )?(?:vendita )?(?:energia elettrica|materia energia)[\s\S]{0,160}?([\d.,]+)\s*€\/kwh/i,
    /di cui spesa per (?:vendita )?(?:energia elettrica|materia energia)[^\d]{0,80}([\d.,]+)\s*€\/kwh/i,
    /corrispettivo (?:energia|per il consumo)[^\d]{0,80}([\d.,]+)\s*€\/kwh/i,
    /([\d.,]+)\s*€\/kwh/i,
  ]);
  const prezzoGas = matchNumber(text, [
    /di cui\s+spesa\s+per\s+(?:la\s+)?vendita\s+di\s+gas\s+naturale[\s\S]{0,140}?[\d.,]+\s*€\s*([\d.,]+)\s*€\/smc/i,
    /di cui\s+spesa\s+per\s+(?:la\s+)?vendita\s+di\s+gas\s+naturale[\s\S]{0,140}?([\d.,]+)\s*€\/smc/i,
    /spesa per (?:la )?vendita di gas naturale[\s\S]{0,450}?quota per consumi[\s\S]{0,120}?([\d.,]+)\s*€\/smc/i,
    /spesa per (?:la )?(?:vendita )?gas naturale[\s\S]{0,160}?([\d.,]+)\s*€\/smc/i,
    /di cui spesa per (?:vendita )?gas naturale[^\d]{0,80}([\d.,]+)\s*€\/smc/i,
    /corrispettivo (?:gas|per il consumo)[^\d]{0,80}([\d.,]+)\s*€\/smc/i,
    /([\d.,]+)\s*€\/smc/i,
  ]);

  const fissoLuceMese = matchNumber(text, [
    /quota\s+fissa[\s\S]{0,360}?di cui\s+spesa\s+per\s+(?:la\s+)?vendita\s+di\s+energia\s+elettrica[\s\S]{0,120}?([\d.,]+)\s*€\/mese/i,
  ]) || matchNumberNear(text, /spesa per (?:la )?vendita di energia elettrica/i, [
    /quota fissa e quota potenza[\s\S]{0,140}?[\d.,]+\s*€\s*([\d.,]+)\s*€\/mese/i,
    /quota fissa[\s\S]{0,140}?[\d.,]+\s*€\s*([\d.,]+)\s*€\/mese/i,
    /di cui spesa per la vendita di energia elettrica\*?[\s\S]{0,120}?([\d.,]+)\s*€\/mese/i,
    /([\d.,]+)\s*€\/mese/i,
  ]);
  const fissoGasMese = matchNumber(text, [
    /quota\s+fissa[\s\S]{0,360}?di cui\s+spesa\s+per\s+(?:la\s+)?vendita\s+di\s+gas\s+naturale[\s\S]{0,120}?([\d.,]+)\s*€\/mese/i,
  ]) || matchNumberNear(text, /spesa per (?:la )?vendita di gas naturale/i, [
    /quota fissa[\s\S]{0,140}?[\d.,]+\s*€\s*([\d.,]+)\s*€\/mese/i,
    /di cui spesa per la vendita di gas naturale\*?[\s\S]{0,120}?([\d.,]+)\s*€\/mese/i,
    /([\d.,]+)\s*€\/mese/i,
  ]);
  const fissoLuceAnno = matchNumberNear(text, /spesa per (?:la )?vendita di energia elettrica/i, [
    /corrispettivo (?:annuo|fisso)[^\d]{0,80}([\d.,]+)\s*€\/anno/i,
  ]);
  const fissoGasAnno = matchNumberNear(text, /spesa per (?:la )?vendita di gas naturale/i, [
    /corrispettivo (?:annuo|fisso)[^\d]{0,80}([\d.,]+)\s*€\/anno/i,
  ]);

  const pod = matchText(text, [
    /(IT[A-Z0-9]{12,16})/i,
    /punto\s+di\s+prelievo\s*\(pod\)[\s\S]{0,220}?\b(IT[A-Z0-9]{8,})\b/i,
    /codice\s+pod[:\s]+([A-Z0-9]{10,})/i,
    /\bPOD[:\s]+([A-Z0-9]{10,})/i,
  ]);
  const pdr = matchText(text, [
    /indirizzo\s+di\s+fornitura\s+PDR[\s\S]{0,240}?\b([0-9]{14})\b/i,
    /\bPDR[\s\S]{0,160}?\b([0-9]{14})\b/i,
    /punto\s+di\s+riconsegna\s*\(pdr\)[\s\S]{0,220}?\b([0-9]{8,})\b/i,
    /codice\s+pdr[:\s]+([0-9]{8,})/i,
    /\bPDR[:\s]+([0-9]{8,})/i,
  ]);
  const potenzaImpegnata = matchNumber(text, [
    /\b([\d.,]+)\s*kW\s*IT[A-Z0-9]{12,16}\b/i,
    /potenza\s+impegnata[^\d]{0,40}([\d.,]+)\s*kW/i,
    /potenza\s+contrattualmente\s+impegnata[^\d]{0,40}([\d.,]+)\s*kW/i,
  ]);
  const potenzaDisponibile = matchNumber(text, [
    /potenza\s+disponibile[^\d]{0,40}([\d.,]+)\s*kW/i,
  ]);
  const hasLuce = Boolean(consumoLuce || prezzoLuce || pod || lower.includes("energia elettrica") || lower.includes("kwh"));
  const hasGas = Boolean(consumoGas || prezzoGas || pdr || lower.includes("gas naturale") || lower.includes("smc"));
  const commodity = hasLuce && hasGas ? "dual" : hasGas ? "gas" : "luce";
  const fixedLuceAnnual = fissoLuceAnno || (fissoLuceMese ? fissoLuceMese * 12 : null);
  const fixedGasAnnual = fissoGasAnno || (fissoGasMese ? fissoGasMese * 12 : null);

  return {
    kind: lower.includes("scheda sintetica") ? "scheda_offerta" : "bolletta",
    commodity,
    fornitore: detectProvider(text),
    consumo_luce_kwh: consumoLuce,
    consumo_gas_smc: consumoGas,
    prezzo_luce_eur_kwh: prezzoLuce,
    prezzo_gas_eur_smc: prezzoGas,
    quota_fissa_vendita_luce_eur_anno: fixedLuceAnnual,
    quota_fissa_vendita_gas_eur_anno: fixedGasAnnual,
    potenza_impegnata_kw: potenzaImpegnata || potenzaDisponibile,
    pod,
    pdr,
    textExtracted: text.length,
    needsReview: true,
  };
}

export async function extractPdf(filePath) {
  const buffer = await fs.readFile(filePath);
  const pdfParseModule = await import("pdf-parse");
  const pdfParse = pdfParseModule.default || pdfParseModule;
  const parsed = await pdfParse(buffer);
  return extractPdfDataFromText(parsed.text || "");
}
