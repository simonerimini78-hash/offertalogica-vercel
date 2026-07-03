import fs from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);

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
  const scripts = [...html.matchAll(/<script(?:(?!src=)[^>]*)>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  scripts.forEach((script, index) => {
    try {
      new Function(script);
    } catch (error) {
      throw new Error(`${htmlPath} script ${index + 1}: ${error.message}`);
    }
  });
  return scripts;
}

function validateOffer(offer, index) {
  assert(offer.id, `offerta ${index + 1}: id mancante`);
  assert(offer.provider, `offerta ${offer.id}: provider mancante`);
  assert(offer.nome, `offerta ${offer.id}: nome mancante`);
  assert(["fisso", "variabile"].includes(offer.tipo), `offerta ${offer.id}: tipo non valido`);
  assert(["dual", "separate"].includes(offer.fornitura), `offerta ${offer.id}: fornitura non valida`);
  assert(offer.luce || offer.gas, `offerta ${offer.id}: manca luce o gas`);
  if (offer.fornitura === "dual") {
    assert(offer.luce && offer.gas, `offerta ${offer.id}: dual fuel senza luce o gas`);
  }

  for (const commodity of ["luce", "gas"]) {
    const voce = offer[commodity];
    if (!voce) continue;
    assert(Number.isFinite(Number(voce.prezzoVariabile)), `offerta ${offer.id}: prezzo ${commodity} non numerico`);
    assert(Number.isFinite(Number(voce.quotaFissaAnnua)), `offerta ${offer.id}: fisso ${commodity} non numerico`);
  }
}

function validateDataFiles() {
  assertSame("data/calcolo-parametri.json", "public/data/calcolo-parametri.json");
  assertSame("data/offerte-proposte.json", "public/data/offerte-proposte.json");

  const params = readJson("data/calcolo-parametri.json");
  const offers = readJson("data/offerte-proposte.json");

  assert(params.versioneDati, "calcolo-parametri.json: versioneDati mancante");
  assert(Number.isFinite(Number(params.parametriCalcolo?.perditeReteLuceVariabile)), "perditeReteLuceVariabile non numerico");
  assert(Number.isFinite(Number(params.parametriCalcolo?.profiloMedio?.luceConsumoKwh)), "profilo medio luce non numerico");
  assert(Number.isFinite(Number(params.parametriCalcolo?.profiloMedio?.gasConsumoSmc)), "profilo medio gas non numerico");
  for (const commodity of ["luce", "gas"]) {
    const regolate = params.parametriCalcolo?.componentiRegolate?.[commodity];
    assert(regolate, `componentiRegolate.${commodity} mancante`);
    assert(Number.isFinite(Number(regolate.variabileEurUnita)), `componentiRegolate.${commodity}.variabileEurUnita non numerico`);
    assert(Number.isFinite(Number(regolate.fissaAnnua)), `componentiRegolate.${commodity}.fissaAnnua non numerico`);
    assert(Number.isFinite(Number(regolate.imposteEurUnita)), `componentiRegolate.${commodity}.imposteEurUnita non numerico`);
    assert(Number.isFinite(Number(regolate.ivaPercentuale)), `componentiRegolate.${commodity}.ivaPercentuale non numerico`);
  }

  assert(offers.versioneDati, "offerte-proposte.json: versioneDati mancante");
  assert(Array.isArray(offers.offerte), "offerte-proposte.json: offerte non e un array");
  assert(offers.offerte.length > 0, "offerte-proposte.json: nessuna offerta");

  const ids = new Set();
  offers.offerte.forEach((offer, index) => {
    validateOffer(offer, index);
    assert(!ids.has(String(offer.id)), `offerta duplicata: ${offer.id}`);
    ids.add(String(offer.id));
  });

  return { params, offers };
}

function loadEngineContext() {
  const scripts = validateInlineScripts("public/index.html");

  const engine = scripts.find((script) => script.includes("MOTORE_CALCOLO_VERSION"));
  assert(engine, "script motore non trovato");

  const context = {
    console,
    document: {
      readyState: "loading",
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    window: {
      location: { protocol: "file:" },
      setTimeout: () => {},
    },
    navigator: { userAgent: "validate-calculator-data" },
  };
  vm.createContext(context);
  vm.runInContext(`${engine}
this.__engine = {
  applicaDatiCalcolo,
  applicaDatiOfferte,
  calcolaOfferta,
  scenarioAttualeComparabile,
  offertaPropostaPerCalcolo,
  get offers() { return OFFERTE_PROPOSTE; },
  get version() { return MOTORE_CALCOLO_VERSION; },
  get dataMeta() { return DATI_CALCOLO_META; },
  get offersMeta() { return DATI_OFFERTE_META; }
};`, context);
  return context.__engine;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function validateEngine(params, offers) {
  const engine = loadEngineContext();
  assert(engine.applicaDatiCalcolo(params), "applicaDatiCalcolo non ha caricato i parametri");
  assert(engine.applicaDatiOfferte(offers), "applicaDatiOfferte non ha caricato le offerte");
  assert(engine.offers.length === offers.offerte.length, "numero offerte caricate non coerente");

  const attuale = {
    luce: { consumo: 2700, prezzoVariabile: 0.15, quotaFissaAnnua: 144, quoteUniversaliAnnue: 0 },
    gas: { consumo: 700, prezzoVariabile: 0.68, quotaFissaAnnua: 120, quoteUniversaliAnnue: 0 },
  };
  const eon = engine.offers.find((offer) => Number(offer.id) === 1);
  const nenLuce = engine.offers.find((offer) => Number(offer.id) === 6);
  assert(eon, "offerta E.ON test non trovata");
  assert(nenLuce, "offerta NeN luce test non trovata");

  const attualeDual = engine.calcolaOfferta(engine.scenarioAttualeComparabile(attuale, eon), "fisso");
  const costoEon = engine.calcolaOfferta(engine.offertaPropostaPerCalcolo(eon, attuale), eon.tipo);
  const attualeSoloLuce = engine.calcolaOfferta(engine.scenarioAttualeComparabile(attuale, nenLuce), "fisso");
  const costoNenLuce = engine.calcolaOfferta(engine.offertaPropostaPerCalcolo(nenLuce, attuale), nenLuce.tipo);
  const risparmioDual = round2(attualeDual.totale - costoEon.totale);
  const risparmioSoloLuce = round2(attualeSoloLuce.totale - costoNenLuce.totale);

  assert(attualeDual.luce.totale > 0 && attualeDual.gas.totale > 0, "scenario dual fuel non include luce e gas");
  assert(Number.isFinite(risparmioDual), "risparmio dual fuel non numerico");
  assert(Number.isFinite(risparmioSoloLuce), "risparmio solo luce non numerico");
  assert(attualeSoloLuce.gas.totale === 0, "offerta solo luce sta includendo il gas");

  return {
    motore: engine.version,
    parametri: engine.dataMeta.versioneDati,
    offerte: engine.offersMeta.versioneDati,
    offerteCaricate: engine.offers.length,
  };
}

try {
  const { params, offers } = validateDataFiles();
  const result = validateEngine(params, offers);
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
