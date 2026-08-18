export function normalizePhone(value) {
  const digits = String(value || "").replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.length >= 8) return `+39${digits}`;
  return digits;
}

export function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

export function sanitizeLead(input) {
  const name = String(input.name || input.nome || "").trim().slice(0, 120);
  const email = String(input.email || "").trim().toLowerCase().slice(0, 160);
  const phone = normalizePhone(input.phone || input.telefono || "");
  const consentService = Boolean(input.consentService ?? input.consensoServizio ?? input.consent);
  const consentMarketing = Boolean(input.consentMarketing ?? input.consensoMarketing);
  const consentPartners = Boolean(input.consentPartners ?? input.consensoPartner);
  const consentProfiling = false;

  if (!name) throw new Error("Nome obbligatorio");
  if (!validEmail(email)) throw new Error("Email non valida");
  if (phone.replace(/\D/g, "").length < 8) throw new Error("Telefono non valido");
  if (!consentService) throw new Error("Consenso servizio obbligatorio");

  return { name, email, phone, consentService, consentMarketing, consentPartners, consentProfiling };
}

function finiteOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function limitedString(value, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function sanitizeBands(input = {}) {
  return {
    f0: finiteOrNull(input?.f0),
    f1: finiteOrNull(input?.f1),
    f2: finiteOrNull(input?.f2),
    f3: finiteOrNull(input?.f3),
    f23: finiteOrNull(input?.f23),
  };
}

function sanitizeFormula(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const tipo = limitedString(input.tipo, 60);
  const indice = limitedString(input.indice, 40);
  const result = {
    tipo,
    indice,
    moltiplicatore: finiteOrNull(input.moltiplicatore),
    moltiplicatoreEsplicito: Boolean(input.moltiplicatoreEsplicito),
    spread: finiteOrNull(input.spread),
  };
  return tipo || indice || result.moltiplicatore !== null || result.spread !== null ? result : null;
}

function sanitizeRegulated(input = {}) {
  return {
    variabileEurUnita: finiteOrNull(input?.variabileEurUnita),
    fissaAnnua: finiteOrNull(input?.fissaAnnua),
    imposteEurUnita: finiteOrNull(input?.imposteEurUnita),
    ivaPercentuale: finiteOrNull(input?.ivaPercentuale),
  };
}

function sanitizeSupply(input = {}) {
  const supply = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    consumo: finiteOrNull(supply.consumo),
    prezzoVariabile: finiteOrNull(supply.prezzoVariabile),
    consumiFasce: sanitizeBands(supply.consumiFasce),
    prezziFasce: sanitizeBands(supply.prezziFasce),
    formula: sanitizeFormula(supply.formula),
    quotaFissaAnnua: finiteOrNull(supply.quotaFissaAnnua),
    quoteUniversaliAnnue: finiteOrNull(supply.quoteUniversaliAnnue),
    componentiRegolate: sanitizeRegulated(supply.componentiRegolate),
  };
}

const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function sanitizeStructuredValue(value, depth = 0) {
  if (depth > 8) return null;
  if (value === null) return null;
  if (typeof value === "string") return value.slice(0, 2000);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 80).map((item) => sanitizeStructuredValue(item, depth + 1));
  }
  if (!value || typeof value !== "object") return null;

  const output = {};
  let count = 0;
  for (const [rawKey, item] of Object.entries(value)) {
    if (count >= 160) break;
    const key = String(rawKey || "").slice(0, 80);
    if (!key || FORBIDDEN_JSON_KEYS.has(key)) continue;
    output[key] = sanitizeStructuredValue(item, depth + 1);
    count += 1;
  }
  return output;
}

function sanitizeComparisonProfile(input = {}) {
  const profile = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    dataOrigin: limitedString(profile.dataOrigin, 80),
    tipoPrezzo: limitedString(profile.tipoPrezzo, 40),
    tipoFornitura: limitedString(profile.tipoFornitura, 40),
    gasDecision: limitedString(profile.gasDecision, 60),
    electricityDecision: limitedString(profile.electricityDecision, 60),
    regioneGas: limitedString(profile.regioneGas, 80),
    potenzaKw: finiteOrNull(profile.potenzaKw),
    luceConsumoKwh: finiteOrNull(profile.luceConsumoKwh),
    gasConsumoSmc: finiteOrNull(profile.gasConsumoSmc),
    fornitoreAttuale: limitedString(profile.fornitoreAttuale, 120),
    fornitoreLuceAttuale: limitedString(profile.fornitoreLuceAttuale, 120),
    fornitoreGasAttuale: limitedString(profile.fornitoreGasAttuale, 120),
    fornitoreNuovaOfferta: limitedString(profile.fornitoreNuovaOfferta, 120),
    pdfDocumentCount: Math.max(0, Math.min(80, Number.isFinite(Number(profile.pdfDocumentCount)) ? Math.floor(Number(profile.pdfDocumentCount)) : 0)),
  };
}

function sanitizeCurrentSupply(input = {}) {
  const current = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    provider: limitedString(current.provider, 120),
    providerLuce: limitedString(current.providerLuce, 120),
    providerGas: limitedString(current.providerGas, 120),
    luce: sanitizeSupply(current.luce),
    gas: sanitizeSupply(current.gas),
  };
}

function sanitizeBusinessProfile(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  return {
    ragioneSociale: limitedString(input.ragioneSociale, 180),
    partitaIva: limitedString(input.partitaIva, 40),
    attivita: limitedString(input.attivita, 180),
    referente: limitedString(input.referente, 160),
    telefono: limitedString(input.telefono, 40),
    email: limitedString(input.email, 160).toLowerCase(),
    fornitore: limitedString(input.fornitore, 120),
    fornitoreLuce: limitedString(input.fornitoreLuce, 120),
    fornitoreGas: limitedString(input.fornitoreGas, 120),
    potenzaKw: finiteOrNull(input.potenzaKw),
    consumoLuceKwh: finiteOrNull(input.consumoLuceKwh),
    fasce: sanitizeBands(input.fasce),
    consumoGasSmc: finiteOrNull(input.consumoGasSmc),
    prezzoLuceEurKwh: finiteOrNull(input.prezzoLuceEurKwh),
    prezzoGasEurSmc: finiteOrNull(input.prezzoGasEurSmc),
    quotaFissaLuceAnnua: finiteOrNull(input.quotaFissaLuceAnnua),
    quotaFissaGasAnnua: finiteOrNull(input.quotaFissaGasAnnua),
    costoAttuale: finiteOrNull(input.costoAttuale),
    costoBenchmark: finiteOrNull(input.costoBenchmark),
    risparmioStimato: finiteOrNull(input.risparmioStimato),
    campiMancanti: (Array.isArray(input.campiMancanti) ? input.campiMancanti : [])
      .slice(0, 30)
      .map((item) => limitedString(item, 160))
      .filter(Boolean),
    datiCompleti: Boolean(input.datiCompleti),
    pdfAnalysisIds: (Array.isArray(input.pdfAnalysisIds) ? input.pdfAnalysisIds : [])
      .slice(0, 40)
      .map((item) => limitedString(item, 120))
      .filter(Boolean),
    pdfArchiveStored: Boolean(input.pdfArchiveStored),
    pod: limitedString(input.pod, 40) || null,
    pdr: limitedString(input.pdr, 40) || null,
    codiceCliente: limitedString(input.codiceCliente, 80) || null,
    codiceClienteLuce: limitedString(input.codiceClienteLuce, 80) || null,
    codiceClienteGas: limitedString(input.codiceClienteGas, 80) || null,
    nomeOffertaLuce: limitedString(input.nomeOffertaLuce, 180) || null,
    nomeOffertaGas: limitedString(input.nomeOffertaGas, 180) || null,
    codiceOffertaLuce: limitedString(input.codiceOffertaLuce, 120) || null,
    codiceOffertaGas: limitedString(input.codiceOffertaGas, 120) || null,
    metodologia: limitedString(input.metodologia, 600),
  };
}

export function sanitizeLeadCalculation(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const customerType = limitedString(input.customerType, 20).toLowerCase();
  const requestType = limitedString(input.requestType, 40).toLowerCase();

  return {
    customerType: ["privato", "business"].includes(customerType) ? customerType : "privato",
    dataOrigin: limitedString(input.dataOrigin, 80),
    comparisonProfile: sanitizeComparisonProfile(input.comparisonProfile),
    bestSaving: finiteOrNull(input.bestSaving),
    pdfData: sanitizeStructuredValue(input.pdfData),
    pdfDocuments: Array.isArray(input.pdfDocuments)
      ? input.pdfDocuments.slice(0, 20).map((item) => sanitizeStructuredValue(item))
      : [],
    currentSupply: sanitizeCurrentSupply(input.currentSupply),
    businessProfile: sanitizeBusinessProfile(input.businessProfile),
    requestType: requestType === "assistance_callback" ? "assistance_callback" : "comparison",
    assistanceReason: limitedString(input.assistanceReason, 180),
    dataStewardship: {
      originalPdfStored: Boolean(input.dataStewardship?.originalPdfStored),
      internalImprovement: Boolean(input.dataStewardship?.internalImprovement),
      anonymizedInsight: Boolean(input.dataStewardship?.anonymizedInsight),
    },
  };
}
