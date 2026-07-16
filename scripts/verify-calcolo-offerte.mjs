import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = path.join(root, "public/index.html");
const paramsPath = path.join(root, "public/data/calcolo-parametri.json");
const catalogPath = path.join(root, "public/data/offerte-arera-menu.json");
const resultPath = path.join(root, "data/verifica-calcolo-offerte.json");
const reportPath = path.join(root, "docs/VERIFICA-CALCOLO-OFFERTE.md");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadEngine() {
  const html = fs.readFileSync(htmlPath, "utf8");
  const scripts = [...html.matchAll(/<script(?:(?!src=)[^>]*)>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  const source = scripts.find((script) => script.includes("MOTORE_CALCOLO_VERSION"));
  assert(source, "Script motore non trovato");
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const context = {
    console,
    Date,
    Math,
    URL,
    Blob,
    setTimeout: () => 0,
    clearTimeout: () => {},
    sessionStorage: storage,
    localStorage: storage,
    document: {
      readyState: "loading",
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    window: {
      location: { protocol: "file:", hostname: "localhost", pathname: "/", origin: "http://localhost" },
      addEventListener: () => {},
      setTimeout: () => 0,
      fetch: null,
    },
    navigator: { userAgent: "verify-calcolo-offerte" },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.__engine = {\n  applicaDatiCalcolo,\n  applicaDatiAreraMenu,\n  costruisciOfferteRanking,\n  calcolaOfferta,\n  offertaPropostaPerCalcolo,\n  scenarioAttualeComparabile,\n  offertaAttivabileOnline,\n  get rows() { return OFFERTE_ARERA_MENU; },\n  get version() { return MOTORE_CALCOLO_VERSION; },\n  get areraMeta() { return DATI_ARERA_MENU_META; }\n};`, context);
  return context.__engine;
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function actualProfile(luceKwh, gasSmc) {
  return {
    luce: { consumo: luceKwh, prezzoVariabile: 0.15, quotaFissaAnnua: 144, quoteUniversaliAnnue: 0, componentiRegolate: {} },
    gas: { consumo: gasSmc, prezzoVariabile: 0.68, quotaFissaAnnua: 120, quoteUniversaliAnnue: 0, componentiRegolate: {} },
  };
}

function analyze(engine, profile) {
  const actual = actualProfile(profile.luceKwh, profile.gasSmc);
  const offers = engine.costruisciOfferteRanking(actual, profile.tipo, profile.fornitura);
  const rows = offers.map((offer) => {
    const proposed = engine.calcolaOfferta(engine.offertaPropostaPerCalcolo(offer, actual), offer.tipo);
    const current = engine.calcolaOfferta(engine.scenarioAttualeComparabile(actual, offer), offer.tipo);
    return {
      id: offer.id,
      provider: offer.provider,
      name: offer.nome,
      type: offer.tipo,
      supply: offer.fornitura,
      annualCost: round2(proposed.totale),
      annualSaving: round2(current.totale - proposed.totale),
      online: engine.offertaAttivabileOnline(offer),
      destinationStatus: offer.destinationStatus,
      codes: offer.codiciArera || String(offer.id).split("-").filter((part) => /^[A-Z0-9]{20,40}$/i.test(part)),
    };
  }).sort((a, b) => a.annualCost - b.annualCost);
  for (const row of rows) {
    assert(Number.isFinite(row.annualCost) && row.annualCost > 0, `${profile.id}: costo non valido per ${row.provider}`);
    assert(String(row.id).startsWith("arera-"), `${profile.id}: offerta non canonica ${row.id}`);
  }
  return { ...profile, offers: rows.length, top: rows.slice(0, 10) };
}

try {
  const params = readJson(paramsPath);
  const catalog = readJson(catalogPath);
  assert(Number(catalog.schemaVersion) >= 93, "Catalogo ARERA non v93");
  const engine = loadEngine();
  assert(engine.applicaDatiCalcolo(params), "Parametri calcolo non caricati");
  assert(engine.applicaDatiAreraMenu(catalog), "Catalogo ARERA non caricato");
  assert(engine.rows.length === catalog.offerte.length, "Il motore non usa tutte e sole le offerte private validate");
  assert(engine.rows.every((row) => row.customerType === "privato"), "Offerta business nel motore privati");
  const axpoBusiness = catalog.offerteBusiness.filter((row) => row.providerKey === "axpo");
  assert(axpoBusiness.length >= 2, "Regressione Axpo business non presente nel catalogo business");
  assert(!engine.rows.some((row) => row.providerKey === "axpo" && row.customerType === "business"), "Axpo business visibile ai privati");
  const octopus = engine.rows.filter((row) => row.providerKey === "octopus");
  assert(!octopus.some((row) => row.commodity === "luce" && Math.abs(row.prezzo - 0.1199) < 1e-8), "Vecchia Octopus luce ripescata");
  assert(!octopus.some((row) => row.commodity === "gas" && Math.abs(row.prezzo - 0.45) < 1e-8), "Vecchia Octopus gas ripescata");

  const profiles = [
    { id: "privato-medio-dual-fisso", tipo: "fisso", fornitura: "dual", luceKwh: 2700, gasSmc: 700 },
    { id: "privato-alto-dual-fisso", tipo: "fisso", fornitura: "dual", luceKwh: 4500, gasSmc: 1200 },
    { id: "privato-medio-separate-fisso", tipo: "fisso", fornitura: "separate", luceKwh: 2700, gasSmc: 700 },
    { id: "privato-solo-luce-fisso", tipo: "fisso", fornitura: "luce", luceKwh: 2700, gasSmc: 0 },
    { id: "privato-solo-gas-fisso", tipo: "fisso", fornitura: "gas", luceKwh: 0, gasSmc: 700 },
    { id: "privato-dual-variabile-senza-fallback", tipo: "variabile", fornitura: "dual", luceKwh: 2700, gasSmc: 700 },
  ].map((profile) => analyze(engine, profile));

  for (const profile of profiles.filter((item) => item.tipo === "fisso")) {
    assert(profile.offers > 0, `${profile.id}: nessuna offerta`);
  }
  const variable = profiles.find((item) => item.tipo === "variabile");
  assert(variable.offers === 0, "Offerte variabili non validate pubblicate tramite fallback");

  const output = {
    ok: true,
    generatedAt: new Date().toISOString(),
    engineVersion: engine.version,
    catalogVersion: catalog.versioneDati,
    catalogDate: catalog.aggiornatoIl,
    privateOffers: catalog.offerte.length,
    businessOffers: catalog.offerteBusiness.length,
    profiles,
  };
  fs.writeFileSync(resultPath, `${JSON.stringify(output, null, 2)}\n`);
  const lines = [
    "# Verifica calcolo offerte",
    "",
    `Catalogo: ${catalog.versioneDati} (${catalog.aggiornatoIl})`,
    `Motore: ${engine.version}`,
    `Offerte private validate: ${catalog.offerte.length}`,
    `Offerte business separate: ${catalog.offerteBusiness.length}`,
    "",
    "Il ranking usa esclusivamente il catalogo ARERA v93 validato. Le offerte variabili prive di prezzo principale certo restano in quarantena e non ricevono fallback statici.",
    "",
    ...profiles.flatMap((profile) => [
      `## ${profile.id}`,
      "",
      `Offerte generate: ${profile.offers}`,
      "",
      ...profile.top.slice(0, 5).map((row, index) => `${index + 1}. ${row.provider}: ${row.annualCost.toFixed(2)} euro/anno`),
      "",
    ]),
  ];
  fs.writeFileSync(reportPath, `${lines.join("\n").trimEnd()}\n`);
  console.log(JSON.stringify({
    ok: true,
    catalog: catalog.versioneDati,
    privateOffers: catalog.offerte.length,
    businessOffers: catalog.offerteBusiness.length,
    profiles: profiles.map(({ id, offers, top }) => ({ id, offers, best: top[0]?.provider || null })),
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
