import fs from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const blockedQualities = new Set([
  "media_fasce",
  "media_fasce_pun_fallback",
  "media_fasce_psv_fallback",
  "somma_componenti",
  "puntuale_pun_fallback",
  "puntuale_psv_fallback",
]);
const allowedPartnerFields = new Set([
  "routeId", "providerKey", "providerLabel", "logo", "url", "destinationType",
  "destinationStatus", "editorialText", "priority", "namePatterns",
]);
const forbiddenPartnerParts = ["prezzo", "price", "quota", "codice", "code", "durata", "spread", "formula", "indice", "tipoofferta", "tipoprezzo"];

function read(path) {
  return fs.readFileSync(new URL(path, root), "utf8");
}

function readJson(path) {
  return JSON.parse(read(path));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSame(pathA, pathB) {
  assert(read(pathA) === read(pathB), `${pathA} e ${pathB} non sono sincronizzati`);
}

function validateInlineScripts(htmlPath) {
  const html = read(htmlPath);
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !/\bsrc\s*=/i.test(match[1]) && !/application\/ld\+json/i.test(match[1]))
    .map((match) => match[2]);
  scripts.forEach((script, index) => {
    try {
      new Function(script);
    } catch (error) {
      throw new Error(`${htmlPath} script ${index + 1}: ${error.message}`);
    }
  });
  return scripts;
}

function parseAreraDate(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})_(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, day, month, year, hour, minute, second] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return Number.isNaN(date.getTime()) ? null : date;
}

function validateRow(row, expectedCustomer, index, catalogDate) {
  const label = `${expectedCustomer}[${index}] ${row.codice || "senza-codice"}`;
  assert(/^[A-Z0-9]{20,40}$/i.test(String(row.codice || "")), `${label}: codice non valido`);
  assert(row.customerType === expectedCustomer, `${label}: customerType ${row.customerType}`);
  assert(["luce", "gas"].includes(row.commodity), `${label}: commodity non valida`);
  assert(["fisso", "variabile"].includes(row.tipo), `${label}: tipo prezzo non valido`);
  assert(Number(row.prezzo) > 0, `${label}: prezzo principale non valido`);
  assert(Number(row.quotaFissaAnnua) >= 0, `${label}: quota fissa non valida`);
  assert(row.unitaPrezzo === (row.commodity === "luce" ? "€/kWh" : "€/Smc"), `${label}: unita prezzo incoerente`);
  assert(row.unitaQuotaFissa === (row.commodity === "luce" ? "€/POD/anno" : "€/PDR/anno"), `${label}: unita quota fissa incoerente`);
  assert(row.confidenza === "alta", `${label}: confidenza non alta`);
  assert(!blockedQualities.has(row.qualitaPrezzo), `${label}: qualita prezzo bloccata ${row.qualitaPrezzo}`);
  assert(["prezzo_esplicito", "verificato_specifica_commerciale"].includes(row.qualitaPrezzo), `${label}: qualita prezzo non ammessa`);
  assert(row.metodoEstrazione, `${label}: metodo estrazione mancante`);
  assert(row.fonte, `${label}: fonte mancante`);
  const start = parseAreraDate(row.dataInizio);
  const end = parseAreraDate(row.dataFine);
  assert(start && end, `${label}: periodo validita non valido`);
  assert(start <= catalogDate && catalogDate <= end, `${label}: offerta fuori validita`);
  const provenance = row.provenienzaPrezzo;
  assert(provenance && typeof provenance === "object", `${label}: provenienza prezzo mancante`);
  for (const field of ["sorgente", "codiceOfferta", "etichettaOriginale", "unitaMisura", "periodoValidita", "testoVicino", "ruolo"]) {
    assert(provenance[field], `${label}: provenienza.${field} mancante`);
  }
  assert(provenance.codiceOfferta === row.codice, `${label}: codice provenienza incoerente`);
  assert(provenance.ruolo === "prezzo_principale_selezionato", `${label}: ruolo prezzo non valido`);
}

function validatePartnerMetadata(catalog) {
  const metadata = readJson("data/partner-metadata.json");
  assert(Array.isArray(metadata.routes), "partner-metadata.json: routes non e un array");
  const routes = new Map();
  for (const route of metadata.routes) {
    for (const key of Object.keys(route)) {
      assert(allowedPartnerFields.has(key), `partner ${route.routeId}: campo non ammesso ${key}`);
      const compact = key.toLowerCase().replace(/[^a-z]/g, "");
      assert(!forbiddenPartnerParts.some((part) => compact.includes(part)), `partner ${route.routeId}: campo economico ${key}`);
    }
    assert(route.routeId && route.providerKey && route.url, "partner incompleto");
    assert(Array.isArray(route.namePatterns) && route.namePatterns.length, `partner ${route.routeId}: namePatterns mancanti`);
    assert(!routes.has(route.routeId), `route partner duplicata: ${route.routeId}`);
    routes.set(route.routeId, route);
  }
  const annotated = [...catalog.offerte, ...catalog.offerteBusiness].filter((row) => row.partner);
  for (const row of annotated) {
    const route = routes.get(row.partner.routeId);
    assert(route, `${row.codice}: route partner sconosciuta`);
    assert(route.providerKey === row.providerKey, `${row.codice}: provider partner incoerente`);
    assert(route.url === row.partner.url, `${row.codice}: URL partner non canonico`);
  }
  return { routes: routes.size, annotated: annotated.length };
}

function validateRuntimeSources() {
  const runtimePaths = [
    "public/index.html",
    "public/offerte-luce-gas-aggiornate.html",
    "public/fornitori/a2a.html",
    "public/fornitori/alperia.html",
    "public/fornitori/enel.html",
    "public/fornitori/eon.html",
    "public/fornitori/octopus.html",
    "public/fornitori/plenitude.html",
  ];
  for (const path of runtimePaths) {
    const source = read(path);
    assert(!source.includes("offerte-proposte.json"), `${path}: usa ancora il catalogo parallelo offerte-proposte`);
    assert(!/\b(?:0\.066595|0\.25051333)\b/.test(source), `${path}: contiene un valore Axpo obsoleto`);
    validateInlineScripts(path);
  }
}

function loadEngine() {
  const scripts = validateInlineScripts("public/index.html");
  const engineSource = scripts.find((script) => script.includes("MOTORE_CALCOLO_VERSION"));
  assert(engineSource, "script motore non trovato");
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
    navigator: { userAgent: "validate-calculator-data" },
  };
  vm.createContext(context);
  vm.runInContext(`${engineSource}\nthis.__engine = {\n  applicaDatiCalcolo,\n  applicaDatiAreraMenu,\n  costruisciOfferteRanking,\n  get rows() { return OFFERTE_ARERA_MENU; },\n  get meta() { return DATI_ARERA_MENU_META; },\n  get version() { return MOTORE_CALCOLO_VERSION; }\n};`, context);
  return context.__engine;
}

function validateEngine(params, catalog) {
  const engine = loadEngine();
  assert(engine.applicaDatiCalcolo(params), "il motore non carica i parametri");
  assert(engine.applicaDatiAreraMenu(catalog), "il motore non carica il catalogo v93");
  assert(engine.rows.length === catalog.offerte.length, "il motore non usa esattamente il catalogo privati validato");
  assert(engine.rows.every((row) => row.customerType === "privato"), "il motore contiene offerte business");
  const actual = {
    luce: { consumo: 2700, prezzoVariabile: 0.15, quotaFissaAnnua: 144, quoteUniversaliAnnue: 0, componentiRegolate: {} },
    gas: { consumo: 700, prezzoVariabile: 0.68, quotaFissaAnnua: 120, quoteUniversaliAnnue: 0, componentiRegolate: {} },
  };
  const fixed = engine.costruisciOfferteRanking(actual, "fisso", "dual");
  assert(fixed.length > 0, "il ranking fisso dual non produce offerte");
  assert(fixed.every((offer) => String(offer.id).startsWith("arera-")), "il ranking contiene una offerta non ARERA");
  const variable = engine.costruisciOfferteRanking(actual, "variabile", "dual");
  assert(variable.length === 0, "il ranking usa fallback per offerte variabili non validate");
  return { version: engine.version, rows: engine.rows.length, fixedDual: fixed.length };
}

try {
  assertSame("data/calcolo-parametri.json", "public/data/calcolo-parametri.json");
  assertSame("data/offerte-arera-menu.json", "public/data/offerte-arera-menu.json");
  assertSame("data/arera-update-report.json", "public/data/arera-update-report.json");
  const params = readJson("data/calcolo-parametri.json");
  const catalog = readJson("data/offerte-arera-menu.json");
  const report = readJson("data/arera-update-report.json");
  assert(Number(catalog.schemaVersion) >= 93, "catalogo precedente allo schema 93");
  assert(Number(report.schemaVersion) >= 93, "report precedente allo schema 93");
  assert(report.pubblicazioneAutorizzata === true, "report non autorizza la pubblicazione corrente");
  assert(report.offertePrecedentiRipescate === 0, "il report indica recuperi selettivi dal catalogo precedente");
  assert(Array.isArray(catalog.offerte) && catalog.offerte.length > 0, "catalogo privati vuoto");
  assert(Array.isArray(catalog.offerteBusiness), "catalogo business mancante");
  const catalogDate = new Date(`${catalog.aggiornatoIl}T12:00:00Z`);
  catalog.offerte.forEach((row, index) => validateRow(row, "privato", index, catalogDate));
  catalog.offerteBusiness.forEach((row, index) => validateRow(row, "business", index, catalogDate));
  const keys = new Set();
  for (const row of [...catalog.offerte, ...catalog.offerteBusiness]) {
    const key = `${row.codice}|${row.commodity}`;
    assert(!keys.has(key), `record catalogo duplicato: ${key}`);
    keys.add(key);
  }
  validateRuntimeSources();
  const partner = validatePartnerMetadata(catalog);
  const engine = validateEngine(params, catalog);
  console.log(JSON.stringify({
    ok: true,
    schemaVersion: catalog.schemaVersion,
    privateOffers: catalog.offerte.length,
    businessOffers: catalog.offerteBusiness.length,
    quarantined: report.quarantena?.length || 0,
    partner,
    engine,
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
