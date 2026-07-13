import fs from "node:fs/promises";
import pdfParse from "pdf-parse";

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
  const lowered = text.toLowerCase();
  if (lowered.includes("dolomiti energia")) return "Dolomiti Energia";
  if (lowered.includes("hera")) return "Hera Comm";
  if (lowered.includes("butangas")) return "ButanGas";
  if (lowered.includes("e.on")) return "E.ON";
  if (lowered.includes("acea")) return "Acea Energia";
  if (lowered.includes("pulsee")) return "Pulsee";
  if (lowered.includes("illumia")) return "Illumia";
  if (lowered.includes("enel energia")) return "Enel Energia";
  if (lowered.includes("eni plenitude") || lowered.includes("plenitude")) return "Eni Plenitude";
  return "";
}

export async function extractPdf(filePath) {
  const buffer = await fs.readFile(filePath);
  const parsed = await pdfParse(buffer);
  const text = parsed.text || "";
  const lower = text.toLowerCase();

  const consumoLuce = matchNumber(text, [
    /totale\s+consumo\s+annuo[^\d]{0,80}([\d.,]+)\s*kwh/i,
    /consumo annuo[^\d]{0,80}([\d.,]+)\s*kwh/i,
    /consumo annuo \(kwh\)[^\d]{0,30}([\d.,]+)/i,
    /consumo rilevato annuo[^\d]{0,80}([\d.,]+)\s*kwh/i,
  ]);
  const consumoGas = matchNumber(text, [
    /consumo annuo[^\d]{0,80}([\d.,]+)\s*smc/i,
    /consumo annuo \(mc\)[^\d]{0,30}([\d.,]+)/i,
    /consumo annuo[^\d]{0,80}([\d.,]+)\s*mc/i,
  ]);
  const prezzoLuce = matchNumber(text, [
    /spesa per (?:la )?vendita di energia elettrica[\s\S]{0,450}?quota per consumi[\s\S]{0,120}?([\d.,]+)\s*€\/kwh/i,
    /spesa per (?:la )?(?:vendita )?(?:energia elettrica|materia energia)[\s\S]{0,160}?([\d.,]+)\s*€\/kwh/i,
    /di cui spesa per (?:vendita )?(?:energia elettrica|materia energia)[^\d]{0,80}([\d.,]+)\s*€\/kwh/i,
    /corrispettivo (?:energia|per il consumo)[^\d]{0,80}([\d.,]+)\s*€\/kwh/i,
    /([\d.,]+)\s*€\/kwh/i,
  ]);
  const prezzoGas = matchNumber(text, [
    /spesa per (?:la )?vendita di gas naturale[\s\S]{0,450}?quota per consumi[\s\S]{0,120}?([\d.,]+)\s*€\/smc/i,
    /spesa per (?:la )?(?:vendita )?gas naturale[\s\S]{0,160}?([\d.,]+)\s*€\/smc/i,
    /di cui spesa per (?:vendita )?gas naturale[^\d]{0,80}([\d.,]+)\s*€\/smc/i,
    /corrispettivo (?:gas|per il consumo)[^\d]{0,80}([\d.,]+)\s*€\/smc/i,
    /([\d.,]+)\s*€\/smc/i,
  ]);

  const fissoLuceMese = matchNumberNear(text, /spesa per (?:la )?vendita di energia elettrica/i, [
    /quota fissa e quota potenza[\s\S]{0,140}?([\d.,]+)\s*€\s*[\d.,]+\s*€\/mese/i,
    /quota fissa[\s\S]{0,140}?([\d.,]+)\s*€\s*[\d.,]+\s*€\/mese/i,
    /di cui spesa per la vendita di energia elettrica\*?[^\d]{0,80}([\d.,]+)\s*€\/mese/i,
    /([\d.,]+)\s*€\/mese/i,
  ]);
  const fissoGasMese = matchNumberNear(text, /spesa per (?:la )?vendita di gas naturale/i, [
    /quota fissa[\s\S]{0,140}?([\d.,]+)\s*€\s*[\d.,]+\s*€\/mese/i,
    /di cui spesa per la vendita di gas naturale\*?[^\d]{0,80}([\d.,]+)\s*€\/mese/i,
    /([\d.,]+)\s*€\/mese/i,
  ]);
  const fissoLuceAnno = matchNumberNear(text, /spesa per (?:la )?vendita di energia elettrica/i, [
    /corrispettivo (?:annuo|fisso)[^\d]{0,80}([\d.,]+)\s*€\/anno/i,
  ]);
  const fissoGasAnno = matchNumberNear(text, /spesa per (?:la )?vendita di gas naturale/i, [
    /corrispettivo (?:annuo|fisso)[^\d]{0,80}([\d.,]+)\s*€\/anno/i,
  ]);

  const pod = matchText(text, [
    /punto\s+di\s+prelievo\s*\(pod\)[\s\S]{0,220}?\b(IT[A-Z0-9]{8,})\b/i,
    /codice\s+pod[:\s]+([A-Z0-9]{10,})/i,
    /\bPOD[:\s]+([A-Z0-9]{10,})/i,
  ]);
  const pdr = matchText(text, [
    /punto\s+di\s+riconsegna\s*\(pdr\)[\s\S]{0,220}?\b([0-9]{8,})\b/i,
    /codice\s+pdr[:\s]+([0-9]{8,})/i,
    /\bPDR[:\s]+([0-9]{8,})/i,
  ]);
  const potenzaImpegnata = matchNumber(text, [
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
