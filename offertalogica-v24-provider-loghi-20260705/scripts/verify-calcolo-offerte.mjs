import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const HTML_PATH = path.join(root, "public/index.html");
const PARAMS_PATH = path.join(root, "public/data/calcolo-parametri.json");
const OFFERS_PATH = path.join(root, "public/data/offerte-proposte.json");
const ARERA_PATH = path.join(root, "public/data/offerte-arera-menu.json");
const REPORT_PATH = path.join(root, "docs/VERIFICA-CALCOLO-OFFERTE.md");
const RESULT_PATH = path.join(root, "data/verifica-calcolo-offerte.json");

const PROFILES = [
  {
    id: "medio-dual-fisso",
    label: "Privato medio - dual fuel - fisso",
    tipo: "fisso",
    fornitura: "dual",
    luceKwh: 2700,
    gasSmc: 700,
    prezzoLuceAttuale: 0.15,
    prezzoGasAttuale: 0.68,
    quotaFissaLuceAttuale: 144,
    quotaFissaGasAttuale: 120,
  },
  {
    id: "medio-dual-variabile",
    label: "Privato medio - dual fuel - variabile",
    tipo: "variabile",
    fornitura: "dual",
    luceKwh: 2700,
    gasSmc: 700,
    prezzoLuceAttuale: 0.15,
    prezzoGasAttuale: 0.68,
    quotaFissaLuceAttuale: 144,
    quotaFissaGasAttuale: 120,
  },
  {
    id: "alto-dual-fisso",
    label: "Privato alto consumo - dual fuel - fisso",
    tipo: "fisso",
    fornitura: "dual",
    luceKwh: 4000,
    gasSmc: 1200,
    prezzoLuceAttuale: 0.15,
    prezzoGasAttuale: 0.68,
    quotaFissaLuceAttuale: 144,
    quotaFissaGasAttuale: 120,
  },
  {
    id: "medio-separata-fisso",
    label: "Privato medio - forniture separate - fisso",
    tipo: "fisso",
    fornitura: "separate",
    luceKwh: 2700,
    gasSmc: 700,
    prezzoLuceAttuale: 0.15,
    prezzoGasAttuale: 0.68,
    quotaFissaLuceAttuale: 144,
    quotaFissaGasAttuale: 120,
  },
  {
    id: "medio-separata-variabile",
    label: "Privato medio - forniture separate - variabile",
    tipo: "variabile",
    fornitura: "separate",
    luceKwh: 2700,
    gasSmc: 700,
    prezzoLuceAttuale: 0.15,
    prezzoGasAttuale: 0.68,
    quotaFissaLuceAttuale: 144,
    quotaFissaGasAttuale: 120,
  },
];

const BAD_NAME_PATTERNS = [
  /\bbusiness\b|\bbus\b|p\.?\s*iva|partita iva/i,
  /vulnerabil|stg|over\s*50|over\s*75|\bunder\b/i,
  /condominio|condoindex|\bcond\b/i,
  /\blavoro\b|second[ae]\s+cas[ae]/i,
  /alto\s+adige|caldaro|carezza|sciliar/i,
];

function providerKeyFromName(value) {
  const text = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!text) return "";
  if (text.includes("e.on") || text.includes("eon")) return "eon";
  if (text.includes("plenitude") || text.includes("eni gas") || /\beni\b/.test(text)) return "eni";
  if (text.includes("alperia")) return "alperia";
  if (text.includes("enel")) return "enel";
  if (text.includes("octopus")) return "octopus";
  if (text.includes("dolomiti")) return "dolomiti";
  if (text.includes("e.co") || text.includes("energia corrente") || text.includes("eco energia")) return "eco";
  if (text.includes("sorgenia")) return "sorgenia";
  if (text.includes("a2a")) return "a2a";
  if (text.includes("acea")) return "acea";
  if (text.includes("edison")) return "edison";
  if (text.includes("iren")) return "iren";
  if (text.includes("magis")) return "magis";
  if (text.includes("axpo")) return "axpo";
  if (text.includes("illumia")) return "illum";
  if (text.includes("nen")) return "nen";
  if (text.includes("engie")) return "engie";
  if (text.includes("pulsee")) return "pulsee";
  return text.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function money(value) {
  return `${round(value, 2).toFixed(2)} EUR`;
}

function escapeCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}

function table(headers, rows) {
  if (!rows.length) return "_Nessuna riga._";
  return [
    `| ${headers.map(escapeCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
  ].join("\n");
}

function loadFrontendEngine() {
  const html = readText(HTML_PATH);
  const scripts = [...html.matchAll(/<script(?:(?!src=)[^>]*)>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  const engine = scripts.find((script) => script.includes("MOTORE_CALCOLO_VERSION"));
  if (!engine) throw new Error("Script motore non trovato in public/index.html");

  const context = {
    console,
    Date,
    Math,
    document: {
      readyState: "loading",
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    window: {
      location: { protocol: "file:", href: "file://verify" },
      setTimeout: () => {},
    },
    navigator: { userAgent: "verify-calcolo-offerte" },
  };
  vm.createContext(context);
  vm.runInContext(`${engine}
this.__engine = {
  applicaDatiCalcolo,
  applicaDatiOfferte,
  applicaDatiAreraMenu,
  costruisciOfferteRanking,
  calcolaOfferta,
  offertaPropostaPerCalcolo,
  scenarioAttualeComparabile,
  offertaAttivabileOnline,
  offertaCompatibileConRanking,
  motiviEsclusioneArera,
  get version() { return MOTORE_CALCOLO_VERSION; },
  get dataMeta() { return DATI_CALCOLO_META; },
  get offersMeta() { return DATI_OFFERTE_META; },
  get areraMeta() { return DATI_ARERA_MENU_META; },
  get areraRows() { return OFFERTE_ARERA_MENU; },
};`, context);
  return context.__engine;
}

function buildActual(profile) {
  const emptyRegulated = {};
  return {
    luce: {
      consumo: profile.luceKwh,
      prezzoVariabile: profile.prezzoLuceAttuale,
      quotaFissaAnnua: profile.quotaFissaLuceAttuale,
      quoteUniversaliAnnue: 0,
      componentiRegolate: emptyRegulated,
    },
    gas: {
      consumo: profile.gasSmc,
      prezzoVariabile: profile.prezzoGasAttuale,
      quotaFissaAnnua: profile.quotaFissaGasAttuale,
      quoteUniversaliAnnue: 0,
      componentiRegolate: emptyRegulated,
    },
  };
}

function reconcile(cost) {
  const subtotal = cost.quotaVariabile
    + cost.quotaFissaVendita
    + cost.quotaTecnicaProfilo
    + cost.quotaRegolata
    + cost.quotaFiscale;
  return round(cost.totale - subtotal, 4);
}

function nameHasBadPattern(name) {
  return BAD_NAME_PATTERNS.some((pattern) => pattern.test(String(name || "")));
}

function isActiveCommercialOffer(offer) {
  return offer?.destinationType === "affiliazione"
    && offer?.destinationStatus === "attiva"
    && Boolean(offer?.link)
    && offer.link !== "#";
}

function checkAffiliateMatch(item) {
  if (!item.active) return null;
  const provider = String(item.provider || "").toLowerCase();
  const name = String(item.name || "").toLowerCase();

  if (provider.includes("enel") && !name.includes("fix")) {
    return "Enel attivabile ma offerta ARERA non riconducibile a Fix Web";
  }
  if (provider.includes("alperia") && item.tipo === "variabile" && !(name.includes("free") || name.includes("home"))) {
    return "Alperia variabile attivabile ma nome ARERA non coerente";
  }
  if (provider.includes("plenitude") && item.tipo === "fisso" && !name.includes("fixa")) {
    return "Plenitude attivabile ma nome ARERA non riconducibile a Fixa";
  }
  return null;
}

function analyzeOffer(engine, profile, offer, rank) {
  const actual = buildActual(profile);
  const currentComparable = engine.calcolaOfferta(engine.scenarioAttualeComparabile(actual, offer), offer.tipo || profile.tipo);
  const proposed = engine.calcolaOfferta(engine.offertaPropostaPerCalcolo(offer, actual), offer.tipo || profile.tipo);
  const saving = currentComparable.totale - proposed.totale;
  const active = engine.offertaAttivabileOnline(offer);
  const item = {
    rank,
    id: String(offer.id || ""),
    provider: offer.provider || "",
    name: offer.nome || "",
    tipo: offer.tipo || "",
    fornitura: offer.fornitura || "",
    destinationType: offer.destinationType || "",
    destinationStatus: offer.destinationStatus || "",
    active,
    link: offer.link || "",
    total: round(proposed.totale, 2),
    saving: round(saving, 2),
    variable: round(proposed.quotaVariabile, 2),
    fixedSales: round(proposed.quotaFissaVendita, 2),
    profileCharges: round(proposed.quotaTecnicaProfilo, 2),
    regulatedAndTaxes: round(proposed.quotaRegolata + proposed.quotaFiscale, 2),
    reconcileDelta: reconcile(proposed),
    lightPrice: offer.luce?.prezzoVariabile ?? null,
    lightFixed: offer.luce?.quotaFissaAnnua ?? null,
    gasPrice: offer.gas?.prezzoVariabile ?? null,
    gasFixed: offer.gas?.quotaFissaAnnua ?? null,
    lightTotal: round(proposed.luce.totale, 2),
    gasTotal: round(proposed.gas.totale, 2),
  };

  const errors = [];
  const warnings = [];

  if (item.tipo !== profile.tipo) errors.push(`tipo non coerente: atteso ${profile.tipo}, trovato ${item.tipo}`);
  if (profile.fornitura === "dual" && item.fornitura !== "dual") errors.push(`fornitura non coerente: attesa dual, trovata ${item.fornitura}`);
  if (profile.fornitura === "separate" && item.fornitura !== "separate") errors.push(`fornitura non coerente: attesa separate, trovata ${item.fornitura}`);
  if (profile.fornitura === "dual" && (!offer.luce || !offer.gas)) errors.push("dual senza luce o gas");
  if (item.total <= 0 || !Number.isFinite(item.total)) errors.push("totale annuo non valido");
  if (item.variable < 0 || item.fixedSales < 0) errors.push("componenti negative");
  if (Math.abs(item.reconcileDelta) > 0.02) errors.push(`totale non riconciliato con componenti: delta ${item.reconcileDelta}`);
  if (nameHasBadPattern(item.name)) errors.push("nome offerta contiene pattern escluso per profilo privato standard");
  if (item.active && !(item.destinationType === "affiliazione" && item.destinationStatus === "attiva" && item.link && item.link !== "#")) {
    errors.push("offerta marcata attivabile ma destinazione/link non validi");
  }

  const affiliateIssue = checkAffiliateMatch(item);
  if (affiliateIssue) errors.push(affiliateIssue);

  if (!item.active && item.destinationStatus !== "da_contattare") {
    warnings.push("offerta non attivabile senza stato lead/ricontatto");
  }
  if (item.tipo === "variabile" && (Number(item.lightPrice || 0) === 0 || Number(item.gasPrice || 0) === 0)) {
    warnings.push("prezzo variabile pari a zero su una commodity inclusa");
  }

  return { item, errors, warnings };
}

function analyzeProfile(engine, profile) {
  const actual = buildActual(profile);
  const offers = engine.costruisciOfferteRanking(actual, profile.tipo, profile.fornitura);
  const analyzed = offers.map((offer, index) => analyzeOffer(engine, profile, offer, index + 1));
  const sorted = analyzed
    .sort((a, b) => (a.item.total - b.item.total) || (b.item.saving - a.item.saving))
    .map((entry, index) => ({
      ...entry,
      item: { ...entry.item, economicRank: index + 1 },
    }));
  const top = sorted.slice(0, 10).map((entry, index) => ({
    ...entry,
    item: { ...entry.item, displayRank: index + 1 },
  }));
  const active = sorted.filter((entry) => entry.item.active);
  const errors = [];
  const warnings = [];

  if (!offers.length) errors.push("nessuna offerta generata");
  if (!top.length) errors.push("nessuna top offerta calcolata");
  if (profile.fornitura === "dual" && top.some((entry) => !entry.item.lightPrice || !entry.item.gasPrice)) {
    errors.push("top dual con commodity mancante");
  }

  for (const entry of top) {
    entry.errors.forEach((error) => errors.push(`#${entry.item.displayRank} ${entry.item.provider}: ${error}`));
    entry.warnings.forEach((warning) => warnings.push(`#${entry.item.displayRank} ${entry.item.provider}: ${warning}`));
  }

  return {
    profile,
    generatedOffers: offers.length,
    top: top.map((entry) => entry.item),
    active: active.slice(0, 10).map((entry) => entry.item),
    errors,
    warnings,
  };
}

function profileForCommercialOffer(offer) {
  return PROFILES.find((profile) => profile.tipo === offer.tipo && profile.fornitura === offer.fornitura) || null;
}

function reasonSummary(reasons) {
  const counts = new Map();
  reasons.forEach((reason) => counts.set(reason, (counts.get(reason) || 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([reason, count]) => `${reason} (${count})`)
    .join(", ");
}

function commodityDiagnostic(engine, providerKey, tipo, commodity) {
  const rows = engine.areraRows.filter((row) => (
    row.providerKey === providerKey
    && row.tipo === tipo
    && row.commodity === commodity
  ));
  const eligible = rows.filter((row) => engine.motiviEsclusioneArera(row).length === 0);
  const excludedReasons = rows.flatMap((row) => engine.motiviEsclusioneArera(row));
  return {
    commodity,
    rows: rows.length,
    eligible: eligible.length,
    bestEligible: eligible[0] ? `${eligible[0].nome} (${eligible[0].codice || "senza codice"})` : "",
    excludedSummary: excludedReasons.length ? reasonSummary(excludedReasons) : "",
  };
}

function explainPartnerVisibility(engine, commercialOffer) {
  const providerKey = providerKeyFromName(`${commercialOffer.provider} ${commercialOffer.nome}`);
  const profile = profileForCommercialOffer(commercialOffer);
  const base = {
    provider: commercialOffer.provider || "",
    offer: commercialOffer.nome || "",
    providerKey,
    tipo: commercialOffer.tipo || "",
    fornitura: commercialOffer.fornitura || "",
    status: "non_verificato",
    reason: "",
    areraLight: null,
    areraGas: null,
    matchedOffer: "",
  };

  if (!providerKey) {
    return { ...base, status: "non_visibile", reason: "fornitore commerciale non riconosciuto" };
  }
  if (!profile) {
    return { ...base, status: "non_visibile", reason: "nessun profilo di verifica coerente con tipo/fornitura dell'offerta" };
  }

  const actual = buildActual(profile);
  const generated = engine.costruisciOfferteRanking(actual, profile.tipo, profile.fornitura);
  const providerGenerated = generated.filter((offer) => providerKeyFromName(offer.provider) === providerKey);
  const activeMatch = providerGenerated.find((offer) => engine.offertaAttivabileOnline(offer));
  const anyMatch = providerGenerated[0] || null;
  const light = commodityDiagnostic(engine, providerKey, commercialOffer.tipo, "luce");
  const gas = commodityDiagnostic(engine, providerKey, commercialOffer.tipo, "gas");

  if (activeMatch) {
    return {
      ...base,
      status: "visibile",
      reason: "offerta ARERA valida e agganciata a funnel partner attivo",
      areraLight: light,
      areraGas: gas,
      matchedOffer: activeMatch.nome || "",
    };
  }

  if (commercialOffer.fornitura === "dual") {
    const missing = [];
    if (!light.eligible) {
      missing.push(light.rows ? `luce non idonea: ${light.excludedSummary || "nessuna riga valida"}` : "luce assente nel file ARERA");
    }
    if (!gas.eligible) {
      missing.push(gas.rows ? `gas non idoneo: ${gas.excludedSummary || "nessuna riga valida"}` : "gas assente nel file ARERA");
    }
    if (missing.length) {
      return {
        ...base,
        status: "non_visibile",
        reason: missing.join("; "),
        areraLight: light,
        areraGas: gas,
        matchedOffer: anyMatch?.nome || "",
      };
    }
  }

  if (anyMatch) {
    return {
      ...base,
      status: "non_visibile",
      reason: "righe ARERA valide, ma nome/codici non agganciati al funnel partner commerciale",
      areraLight: light,
      areraGas: gas,
      matchedOffer: anyMatch.nome || "",
    };
  }

  return {
    ...base,
    status: "non_visibile",
    reason: "nessuna offerta generata nel ranking ARERA per questo partner e filtro",
    areraLight: light,
    areraGas: gas,
    matchedOffer: "",
  };
}

function analyzePartnerVisibility(engine, offersData) {
  const commercialOffers = (Array.isArray(offersData) ? offersData : offersData?.offerte || [])
    .filter(isActiveCommercialOffer);
  return commercialOffers.map((offer) => explainPartnerVisibility(engine, offer));
}

function rowsForOffers(offers) {
  return offers.map((offer) => [
    offer.displayRank || offer.economicRank || offer.rank,
    offer.provider,
    offer.name,
    money(offer.total),
    money(offer.variable),
    money(offer.fixedSales),
    money(offer.saving),
    offer.active ? "attivabile" : offer.destinationStatus,
  ]);
}

function rowsForPartnerAudit(rows) {
  return rows.map((row) => [
    row.provider,
    row.offer,
    `${row.tipo} / ${row.fornitura}`,
    row.status === "visibile" ? "visibile" : "non visibile",
    row.reason,
    row.matchedOffer || "-",
  ]);
}

function writeReport(result) {
  const lines = [
    "# Verifica calcolo offerte",
    "",
    `Generato: ${result.generatedAt}`,
    `Motore frontend: ${result.engineVersion}`,
    `Parametri: ${result.paramsVersion}`,
    `Offerte commerciali: ${result.offersVersion}`,
    `ARERA: ${result.areraVersion} (${result.areraUpdatedAt})`,
    "",
    result.ok
      ? "**Esito automatico: OK.** Nessun errore bloccante trovato nei profili verificati."
      : "**Esito automatico: ATTENZIONE.** Sono presenti errori da risolvere prima di pubblicare.",
    "",
    "La verifica usa il motore del frontend, non una copia separata: carica `public/index.html`, applica i JSON pubblici e calcola le offerte come farebbe il sito.",
    "",
    "## Audit partner attivi",
    "",
    "Questa sezione spiega perche un'offerta affiliata attiva viene mostrata oppure esclusa. Il principio e: il funnel partner viene agganciato solo se esiste una proposta ARERA coerente e valida per lo stesso filtro.",
    "",
    table(
      ["Partner", "Offerta commerciale", "Filtro", "Esito", "Motivo", "Offerta ARERA agganciata"],
      rowsForPartnerAudit(result.partnerAudit),
    ),
    "",
  ];

  for (const profileResult of result.profiles) {
    lines.push(`## ${profileResult.profile.label}`);
    lines.push("");
    lines.push(`Offerte generate: ${profileResult.generatedOffers}`);
    lines.push("");
    lines.push(table(
      ["#", "Fornitore", "Offerta", "Totale", "Variabile", "Fissa vendita", "Risparmio vs attuale", "Stato"],
      rowsForOffers(profileResult.top),
    ));
    lines.push("");

    if (profileResult.active.length) {
      lines.push("### Attivabili online rilevate");
      lines.push("");
      lines.push(table(
        ["#", "Fornitore", "Offerta", "Totale", "Variabile", "Fissa vendita", "Risparmio vs attuale", "Stato"],
        rowsForOffers(profileResult.active),
      ));
      lines.push("");
    }

    if (profileResult.errors.length) {
      lines.push("### Errori");
      lines.push("");
      profileResult.errors.forEach((error) => lines.push(`- ${error}`));
      lines.push("");
    }

    if (profileResult.warnings.length) {
      lines.push("### Avvisi");
      lines.push("");
      profileResult.warnings.forEach((warning) => lines.push(`- ${warning}`));
      lines.push("");
    }
  }

  fs.writeFileSync(REPORT_PATH, `${lines.join("\n")}\n`);
}

function main() {
  const params = readJson(PARAMS_PATH);
  const offers = readJson(OFFERS_PATH);
  const arera = readJson(ARERA_PATH);
  const engine = loadFrontendEngine();

  if (!engine.applicaDatiCalcolo(params)) throw new Error("Parametri calcolo non caricati");
  if (!engine.applicaDatiOfferte(offers)) throw new Error("Offerte proposte non caricate");
  if (!engine.applicaDatiAreraMenu(arera)) throw new Error("Offerte ARERA non caricate");

  const profiles = PROFILES.map((profile) => analyzeProfile(engine, profile));
  const partnerAudit = analyzePartnerVisibility(engine, offers);
  const allErrors = profiles.flatMap((profile) => profile.errors);
  const allWarnings = profiles.flatMap((profile) => profile.warnings);
  const partnerWarnings = partnerAudit
    .filter((row) => row.status !== "visibile")
    .map((row) => `${row.provider} ${row.offer}: ${row.reason}`);
  const result = {
    ok: allErrors.length === 0,
    generatedAt: new Date().toISOString(),
    engineVersion: engine.version,
    paramsVersion: engine.dataMeta.versioneDati,
    offersVersion: engine.offersMeta.versioneDati,
    areraVersion: engine.areraMeta.versioneDati,
    areraUpdatedAt: engine.areraMeta.aggiornatoIl,
    areraRows: engine.areraRows.length,
    errorCount: allErrors.length,
    warningCount: allWarnings.length + partnerWarnings.length,
    partnerWarningCount: partnerWarnings.length,
    partnerAudit,
    profiles,
  };

  fs.writeFileSync(RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`);
  writeReport(result);
  console.log(JSON.stringify({
    ok: result.ok,
    report: path.relative(root, REPORT_PATH),
    result: path.relative(root, RESULT_PATH),
    errors: result.errorCount,
    warnings: result.warningCount,
    partnerWarnings: result.partnerWarningCount,
    profiles: profiles.map((profile) => ({
      id: profile.profile.id,
      generatedOffers: profile.generatedOffers,
      first: profile.top[0] ? {
        provider: profile.top[0].provider,
        total: profile.top[0].total,
        status: profile.top[0].active ? "attivabile" : profile.top[0].destinationStatus,
      } : null,
    })),
  }, null, 2));

  if (!result.ok) process.exit(1);
}

main();
