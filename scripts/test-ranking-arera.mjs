import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const ARERA_PATH = path.join(root, "data/offerte-arera-menu.json");
const PARAMS_PATH = path.join(root, "data/calcolo-parametri.json");
const DESTINATIONS_PATH = path.join(root, "data/destinazioni-offerte.csv");
const REPORT_PATH = path.join(root, "docs/RANKING-ARERA-TEST.md");
const RESULT_PATH = path.join(root, "data/ranking-arera-test.json");

const DEFAULT_LIMIT = 10;
const DEFAULT_LOSSES = 1.102;
const FORBIDDEN_PRIVATE_PATTERNS = [
  { pattern: /\bbusiness\b|\bbus\b|p\.?\s*iva|partita iva|professionist/i, reason: "fuori perimetro privato: business/P.IVA" },
  { pattern: /vulnerabil|stg|over\s*50|over\s*75|\bunder\b/i, reason: "fuori perimetro privato standard: vulnerabili/eta" },
  { pattern: /condominio|condoindex|\bcond\b/i, reason: "fuori perimetro privato standard: condominio" },
  { pattern: /\blavoro\b|second[ae]\s+cas[ae]/i, reason: "fuori perimetro privato standard: lavoro/seconda casa" },
  { pattern: /alto\s+adige|caldaro|carezza|sciliar/i, reason: "offerta territoriale: da non usare come proposta nazionale standard" },
];

const KNOWN_PROVIDER_MENTIONS = [
  ["a2a", /\ba2a\b/i],
  ["acea", /\bacea\b/i],
  ["alperia", /\balperia\b/i],
  ["axpo", /\baxpo\b/i],
  ["dolomiti", /\bdolomiti\b/i],
  ["eco", /\be\.?co\b|energia corrente/i],
  ["edison", /\bedison\b/i],
  ["enel", /\benel\b/i],
  ["eni", /\beni\b|plenitude/i],
  ["eon", /\be\.?on\b/i],
  ["hera", /\bhera\b/i],
  ["iren", /\biren\b/i],
  ["magis", /\bmagis\b/i],
  ["nen", /\bnen\b|\bneN\b/i],
  ["octopus", /\boctopus\b/i],
  ["pulsee", /\bpulsee\b/i],
  ["sorgenia", /\bsorgenia\b/i],
];

const PROFILES = [
  {
    id: "privato-medio-dual-fisso",
    label: "Privato medio - dual fuel - prezzo fisso",
    target: "privato_standard",
    tipo: "fisso",
    fornitura: "dual",
    luceKwh: 2700,
    gasSmc: 700,
  },
  {
    id: "privato-medio-dual-variabile",
    label: "Privato medio - dual fuel - prezzo variabile",
    target: "privato_standard",
    tipo: "variabile",
    fornitura: "dual",
    luceKwh: 2700,
    gasSmc: 700,
  },
  {
    id: "privato-alto-dual-fisso",
    label: "Privato alto consumo - dual fuel - prezzo fisso",
    target: "privato_standard",
    tipo: "fisso",
    fornitura: "dual",
    luceKwh: 4000,
    gasSmc: 1200,
  },
  {
    id: "privato-medio-separata-fisso",
    label: "Privato medio - forniture separate - prezzo fisso",
    target: "privato_standard",
    tipo: "fisso",
    fornitura: "separata",
    luceKwh: 2700,
    gasSmc: 700,
  },
  {
    id: "privato-medio-separata-variabile",
    label: "Privato medio - forniture separate - prezzo variabile",
    target: "privato_standard",
    tipo: "variabile",
    fornitura: "separata",
    luceKwh: 2700,
    gasSmc: 700,
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function money(value) {
  return `${round(value, 2).toFixed(2)} EUR`;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseItalianDate(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})_(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, day, month, year, hour, minute, second] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute, second);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function providerKeyFromName(value) {
  const text = normalizeText(value);
  if (!text) return "";
  if (text.includes("e.on") || text === "eon" || text.includes("eon energia")) return "eon";
  if (text.includes("plenitude") || text.includes("eni gas") || text === "eni") return "eni";
  if (text.includes("dolomiti")) return "dolomiti";
  if (text.includes("e.co") || text.includes("energia corrente") || text.includes("eco energia")) return "eco";
  if (text.includes("octopus")) return "octopus";
  if (text.includes("alperia")) return "alperia";
  if (text.includes("enel")) return "enel";
  if (text.includes("edison")) return "edison";
  if (text.includes("sorgenia")) return "sorgenia";
  if (text.includes("nen")) return "nen";
  if (text.includes("a2a")) return "a2a";
  if (text.includes("acea")) return "acea";
  if (text.includes("iren")) return "iren";
  if (text.includes("hera")) return "hera";
  if (text.includes("engie")) return "engie";
  if (text.includes("pulsee")) return "pulsee";
  if (text.includes("poste")) return "poste";
  if (text.includes("vivi")) return "vivi";
  if (text.includes("magis")) return "magis";
  if (text.includes("argos")) return "argos";
  if (text.includes("axpo")) return "axpo";
  if (text.includes("enercom")) return "enercom";
  if (text.includes("illumia")) return "illum";
  if (text.includes("optima")) return "optima";
  return text.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const [headers, ...records] = rows.filter((item) => item.some((cellValue) => cellValue.trim()));
  if (!headers) return [];
  return records.map((record) => {
    const entry = {};
    headers.forEach((header, index) => {
      entry[header.trim()] = record[index] || "";
    });
    return entry;
  });
}

function readDestinations() {
  if (!fs.existsSync(DESTINATIONS_PATH)) return [];
  return parseCsv(fs.readFileSync(DESTINATIONS_PATH, "utf8"));
}

function destinationMatchesType(destination, tipo) {
  const text = normalizeText(`${destination.offerta} ${destination.link_tracking} ${destination.note}`);
  const isVariable = text.includes("variabile") || text.includes("pun") || text.includes("psv");
  const isFixed = text.includes("fisso") || text.includes("fix") || text.includes("fixa") || text.includes("smile easy");
  if (tipo === "variabile" && isVariable) return true;
  if (tipo === "fisso" && isFixed) return true;
  return !isVariable && !isFixed;
}

function mentionedProviderKey(row) {
  const name = String(row.nome || "");
  for (const [key, pattern] of KNOWN_PROVIDER_MENTIONS) {
    if (pattern.test(name)) return key;
  }
  return "";
}

function eligibilityReasons(row, profile, now = new Date()) {
  const reasons = [];
  const text = `${row.nome || ""} ${row.url || ""} ${row.fonte || ""}`;

  for (const rule of FORBIDDEN_PRIVATE_PATTERNS) {
    if (rule.pattern.test(text)) reasons.push(rule.reason);
  }

  const mentioned = mentionedProviderKey(row);
  if (mentioned && mentioned !== row.providerKey) {
    reasons.push(`fornitore non coerente: offerta sembra ${mentioned}, ma providerKey e ${row.providerKey}`);
  }

  const startsAt = parseItalianDate(row.dataInizio);
  const endsAt = parseItalianDate(row.dataFine);
  if (startsAt && startsAt > now) reasons.push("offerta non ancora attiva");
  if (endsAt && endsAt < now) reasons.push("offerta scaduta");

  if (profile?.target === "privato_standard" && row.commodity === "luce") {
    const price = numberOrNull(row.prezzo);
    if (price !== null && price < 0.04) reasons.push("prezzo luce anomalo per profilo privato standard");
  }
  if (profile?.target === "privato_standard" && row.commodity === "gas") {
    const price = numberOrNull(row.prezzo);
    if (price !== null && row.tipo === "fisso" && price < 0.25) reasons.push("prezzo gas fisso anomalo per profilo privato standard");
  }

  return [...new Set(reasons)];
}

function rememberExclusion(diagnostics, row, reasons) {
  if (!diagnostics || !reasons.length) return;
  const key = row.codice || `${row.providerKey}-${row.commodity}-${row.tipo}-${row.nome}`;
  if (diagnostics.excluded.has(key)) return;
  diagnostics.excluded.set(key, {
    providerKey: row.providerKey,
    providerLabel: row.providerLabel || row.fornitore || row.providerKey,
    commodity: row.commodity,
    tipo: row.tipo,
    nome: row.nome,
    codice: row.codice,
    prezzo: row.prezzo,
    quotaFissaAnnua: row.quotaFissaAnnua,
    reasons,
  });
}

function buildCommercialIndex(destinations) {
  const byProvider = new Map();
  for (const destination of destinations) {
    const key = providerKeyFromName(destination.fornitore);
    if (!key) continue;
    if (!byProvider.has(key)) byProvider.set(key, []);
    byProvider.get(key).push(destination);
  }
  return byProvider;
}

function commercialStatus(providerKey, tipo, commercialIndex) {
  const rows = commercialIndex.get(providerKey) || [];
  const typedRows = rows.filter((row) => destinationMatchesType(row, tipo));
  const candidates = typedRows.length ? typedRows : rows;

  const activeAffiliate = candidates.find((row) => {
    return row.stato === "attiva" && row.tipo_destinazione === "affiliazione";
  });
  if (activeAffiliate) {
    return {
      status: "attivabile_online",
      label: "attivabile online",
      network: activeAffiliate.network_partner || "",
      model: activeAffiliate.modello_pagamento || "",
      priority: activeAffiliate.priorita || "",
    };
  }

  const pendingAffiliate = candidates.find((row) => {
    return row.tipo_destinazione === "affiliazione" && row.stato === "in_attesa_approvazione";
  });
  if (pendingAffiliate) {
    return {
      status: "affiliazione_in_attesa",
      label: "affiliazione in attesa",
      network: pendingAffiliate.network_partner || "",
      model: pendingAffiliate.modello_pagamento || "",
      priority: pendingAffiliate.priorita || "",
    };
  }

  const lead = candidates.find((row) => {
    return row.tipo_destinazione === "partner_lead" || row.stato === "da_contattare";
  });
  if (lead) {
    return {
      status: "richiede_consulente",
      label: "richiede consulente",
      network: lead.network_partner || "",
      model: lead.modello_pagamento || "",
      priority: lead.priorita || "",
    };
  }

  return {
    status: "solo_confronto",
    label: "solo confronto",
    network: "",
    model: "",
    priority: "",
  };
}

function isUsableOffer(row, profile, commodity, diagnostics) {
  const tipo = profile.tipo;
  if (!row || row.tipo !== tipo || row.commodity !== commodity) return false;
  const price = numberOrNull(row.prezzo);
  const fixed = numberOrNull(row.quotaFissaAnnua);
  if (!(price !== null && price > 0 && fixed !== null && fixed >= 0)) return false;
  const reasons = eligibilityReasons(row, profile);
  if (reasons.length) {
    rememberExclusion(diagnostics, row, reasons);
    return false;
  }
  return true;
}

function lossesFor(row, params) {
  if (row.commodity !== "luce" || row.tipo !== "variabile") return 1;
  return numberOrNull(params.parametriCalcolo?.perditeReteLuceVariabile) || DEFAULT_LOSSES;
}

function calcCommodity(row, profile, params) {
  const consumption = row.commodity === "luce" ? profile.luceKwh : profile.gasSmc;
  if (!Number.isFinite(consumption) || consumption <= 0) return null;

  const price = Number(row.prezzo);
  const fixed = Number(row.quotaFissaAnnua || 0);
  const billableConsumption = consumption * lossesFor(row, params);
  const variableCost = billableConsumption * price;
  const total = variableCost + fixed;

  return {
    providerKey: row.providerKey,
    providerLabel: row.providerLabel || row.fornitore || row.providerKey,
    commodity: row.commodity,
    tipo: row.tipo,
    nome: row.nome,
    codice: row.codice,
    dataInizio: row.dataInizio,
    dataFine: row.dataFine,
    url: row.url,
    fonte: row.fonte,
    qualitaPrezzo: row.qualitaPrezzo || "",
    consumo: round(consumption, 3),
    consumoFatturato: round(billableConsumption, 3),
    prezzo: round(price, 8),
    quotaFissaAnnua: round(fixed, 2),
    costoVariabile: round(variableCost, 2),
    costoFisso: round(fixed, 2),
    totale: round(total, 2),
  };
}

function bestPerProvider(arera, params, profile, commodity, diagnostics) {
  const best = new Map();
  for (const row of arera.offerte) {
    if (!isUsableOffer(row, profile, commodity, diagnostics)) continue;
    const calc = calcCommodity(row, profile, params);
    if (!calc) continue;
    const current = best.get(calc.providerKey);
    if (!current || calc.totale < current.totale) {
      best.set(calc.providerKey, calc);
    }
  }
  return best;
}

function combineDual(luce, gas, profile, commercial) {
  return {
    providerKey: luce.providerKey,
    providerLabel: luce.providerLabel,
    tipo: profile.tipo,
    fornitura: "dual",
    luce,
    gas,
    costoVariabile: round(luce.costoVariabile + gas.costoVariabile, 2),
    costoFisso: round(luce.costoFisso + gas.costoFisso, 2),
    totale: round(luce.totale + gas.totale, 2),
    commercial,
  };
}

function combineSeparate(luce, gas, profile, commercialIndex) {
  const providerKey = `${luce.providerKey}+${gas.providerKey}`;
  return {
    providerKey,
    providerLabel: `${luce.providerLabel} + ${gas.providerLabel}`,
    tipo: profile.tipo,
    fornitura: "separata",
    luce,
    gas,
    costoVariabile: round(luce.costoVariabile + gas.costoVariabile, 2),
    costoFisso: round(luce.costoFisso + gas.costoFisso, 2),
    totale: round(luce.totale + gas.totale, 2),
    commercial: {
      status: "separata",
      label: `${commercialStatus(luce.providerKey, profile.tipo, commercialIndex).label} / ${commercialStatus(gas.providerKey, profile.tipo, commercialIndex).label}`,
      network: "",
      model: "",
      priority: "",
    },
  };
}

function rankProfile(arera, params, commercialIndex, profile, limit = DEFAULT_LIMIT) {
  const diagnostics = { excluded: new Map() };
  const lightByProvider = bestPerProvider(arera, params, profile, "luce", diagnostics);
  const gasByProvider = bestPerProvider(arera, params, profile, "gas", diagnostics);

  if (profile.fornitura === "dual") {
    const ranked = [];
    for (const [providerKey, luce] of lightByProvider) {
      const gas = gasByProvider.get(providerKey);
      if (!gas) continue;
      ranked.push(combineDual(luce, gas, profile, commercialStatus(providerKey, profile.tipo, commercialIndex)));
    }
    ranked.sort((a, b) => a.totale - b.totale);
    return {
      mode: "dual",
      providerCount: ranked.length,
      ranking: ranked.slice(0, limit),
      diagnostics: {
        excludedCount: diagnostics.excluded.size,
        excludedExamples: [...diagnostics.excluded.values()].slice(0, 20),
      },
    };
  }

  const lightRanked = [...lightByProvider.values()].sort((a, b) => a.totale - b.totale);
  const gasRanked = [...gasByProvider.values()].sort((a, b) => a.totale - b.totale);
  const pairs = [];
  for (const luce of lightRanked.slice(0, limit)) {
    for (const gas of gasRanked.slice(0, limit)) {
      pairs.push(combineSeparate(luce, gas, profile, commercialIndex));
    }
  }
  pairs.sort((a, b) => a.totale - b.totale);

  return {
    mode: "separata",
    providerCount: new Set([...lightByProvider.keys(), ...gasByProvider.keys()]).size,
    ranking: pairs.slice(0, limit),
    luce: lightRanked.slice(0, limit),
    gas: gasRanked.slice(0, limit),
    diagnostics: {
      excludedCount: diagnostics.excluded.size,
      excludedExamples: [...diagnostics.excluded.values()].slice(0, 20),
    },
  };
}

function inferredSpread(offer, arera) {
  if (offer.tipo !== "variabile") return null;
  const index = offer.commodity === "luce" ? arera.indiciUsati?.pun : arera.indiciUsati?.psv;
  const numericIndex = numberOrNull(index);
  if (numericIndex === null) return null;
  return round(offer.prezzo - numericIndex, 8);
}

function priceLabel(offer, arera) {
  const unit = offer.commodity === "luce" ? "EUR/kWh" : "EUR/Smc";
  if (offer.tipo !== "variabile") return `${round(offer.prezzo, 6)} ${unit}`;
  const indexName = offer.commodity === "luce" ? "PUN" : "PSV";
  const spread = inferredSpread(offer, arera);
  if (spread === null) return `${round(offer.prezzo, 6)} ${unit}`;
  const sign = spread >= 0 ? "+" : "";
  return `${indexName}${sign}${round(spread, 6)} = ${round(offer.prezzo, 6)} ${unit}`;
}

function escapeCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}

function table(headers, rows) {
  const headerLine = `| ${headers.map(escapeCell).join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`).join("\n");
  return `${headerLine}\n${separator}\n${body}`;
}

function offerCell(offer, arera) {
  return `${offer.nome} - ${priceLabel(offer, arera)} - fisso ${money(offer.quotaFissaAnnua)}`;
}

function rankingRows(result, arera) {
  return result.ranking.map((item, index) => [
    index + 1,
    item.providerLabel,
    money(item.totale),
    money(item.costoVariabile),
    money(item.costoFisso),
    offerCell(item.luce, arera),
    offerCell(item.gas, arera),
    item.commercial.label,
  ]);
}

function commodityRows(items, arera) {
  return items.map((item, index) => [
    index + 1,
    item.providerLabel,
    item.nome,
    money(item.totale),
    money(item.costoVariabile),
    money(item.costoFisso),
    priceLabel(item, arera),
    item.qualitaPrezzo,
  ]);
}

function exclusionRows(examples) {
  return examples.map((item, index) => [
    index + 1,
    item.providerLabel,
    item.commodity,
    item.tipo,
    item.nome,
    item.reasons.join("; "),
  ]);
}

function writeReport(arera, params, profileResults) {
  const generatedAt = new Date().toISOString();
  const lines = [
    "# Test ranking ARERA",
    "",
    `Generato: ${generatedAt}`,
    `Fonte ARERA: ${arera.versioneDati || "n.d."} (${arera.aggiornatoIl || "n.d."})`,
    `Offerte lette: ${arera.offerte.length}`,
    `Indici usati: PUN ${arera.indiciUsati?.pun ?? "n.d."}, PSV ${arera.indiciUsati?.psv ?? "n.d."}`,
    `Perdite rete luce variabile: ${params.parametriCalcolo?.perditeReteLuceVariabile ?? DEFAULT_LOSSES}`,
    "",
    "Nota: il ranking tecnico usa solo i dati ARERA disponibili nel file aggiornato. La monetizzazione viene marcata dopo e non modifica l'ordine economico.",
    "Nota: oneri, imposte, IVA e costi accessori non presenti nel file ARERA sono indicati come n.n. e non entrano nel ranking tecnico.",
    "",
  ];

  for (const item of profileResults) {
    lines.push(`## ${item.profile.label}`);
    lines.push("");
    lines.push(`Consumi: ${item.profile.luceKwh} kWh luce, ${item.profile.gasSmc} Smc gas`);
    lines.push(`Tipo prezzo: ${item.profile.tipo}`);
    lines.push(`Tipo fornitura: ${item.profile.fornitura}`);
    lines.push(`Fornitori confrontabili: ${item.result.providerCount}`);
    lines.push(`Offerte escluse dal filtro idoneita: ${item.result.diagnostics?.excludedCount || 0}`);
    lines.push("");
    lines.push(table(
      ["#", "Fornitore", "Totale annuo", "Quota variabile", "Quota fissa vendita", "Luce", "Gas", "Esito commerciale"],
      rankingRows(item.result, arera),
    ));
    lines.push("");

    if (item.result.diagnostics?.excludedExamples?.length) {
      lines.push("### Esempi di offerte escluse dal ranking");
      lines.push("");
      lines.push(table(
        ["#", "Fornitore", "Commodity", "Tipo", "Offerta", "Motivo"],
        exclusionRows(item.result.diagnostics.excludedExamples),
      ));
      lines.push("");
    }

    if (item.result.mode === "separata") {
      lines.push("### Migliori offerte luce separate");
      lines.push("");
      lines.push(table(
        ["#", "Fornitore", "Offerta", "Totale annuo", "Quota variabile", "Quota fissa vendita", "Prezzo usato", "Qualita prezzo"],
        commodityRows(item.result.luce, arera),
      ));
      lines.push("");
      lines.push("### Migliori offerte gas separate");
      lines.push("");
      lines.push(table(
        ["#", "Fornitore", "Offerta", "Totale annuo", "Quota variabile", "Quota fissa vendita", "Prezzo usato", "Qualita prezzo"],
        commodityRows(item.result.gas, arera),
      ));
      lines.push("");
    }
  }

  fs.writeFileSync(REPORT_PATH, `${lines.join("\n")}\n`);
}

function buildSummary(profileResults) {
  return profileResults.map(({ profile, result }) => ({
    profile: profile.id,
    label: profile.label,
    tipo: profile.tipo,
    fornitura: profile.fornitura,
    providerCount: result.providerCount,
    excludedCount: result.diagnostics?.excludedCount || 0,
    excludedExamples: result.diagnostics?.excludedExamples || [],
    top: result.ranking.slice(0, 5).map((item, index) => ({
      rank: index + 1,
      provider: item.providerLabel,
      totale: item.totale,
      costoVariabile: item.costoVariabile,
      costoFisso: item.costoFisso,
      luce: {
        nome: item.luce.nome,
        prezzo: item.luce.prezzo,
        quotaFissaAnnua: item.luce.quotaFissaAnnua,
        qualitaPrezzo: item.luce.qualitaPrezzo,
      },
      gas: {
        nome: item.gas.nome,
        prezzo: item.gas.prezzo,
        quotaFissaAnnua: item.gas.quotaFissaAnnua,
        qualitaPrezzo: item.gas.qualitaPrezzo,
      },
      commercialStatus: item.commercial.status,
      commercialLabel: item.commercial.label,
    })),
  }));
}

function main() {
  const arera = readJson(ARERA_PATH);
  const params = readJson(PARAMS_PATH);
  const destinations = readDestinations();
  const commercialIndex = buildCommercialIndex(destinations);
  const profileResults = PROFILES.map((profile) => ({
    profile,
    result: rankProfile(arera, params, commercialIndex, profile),
  }));

  const output = {
    ok: true,
    generatedAt: new Date().toISOString(),
    arera: {
      versioneDati: arera.versioneDati,
      aggiornatoIl: arera.aggiornatoIl,
      offerte: arera.offerte.length,
      indiciUsati: arera.indiciUsati || {},
    },
    profiles: buildSummary(profileResults),
  };

  fs.writeFileSync(RESULT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  writeReport(arera, params, profileResults);
  console.log(JSON.stringify({
    ok: true,
    report: path.relative(root, REPORT_PATH),
    result: path.relative(root, RESULT_PATH),
    profiles: output.profiles.map((profile) => ({
      id: profile.profile,
      topProvider: profile.top[0]?.provider || "n.d.",
      topTotal: profile.top[0]?.totale ?? null,
      providerCount: profile.providerCount,
    })),
  }, null, 2));
}

main();
