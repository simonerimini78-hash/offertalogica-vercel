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

function validateAreraCatalog() {
  assertSame("data/offerte-arera-menu.json", "public/data/offerte-arera-menu.json");
  const arera = readJson("data/offerte-arera-menu.json");
  assert(Array.isArray(arera.offerte), "catalogo ARERA: offerte singole mancanti");
  assert(Array.isArray(arera.offerteDual), "catalogo ARERA: vere offerte dual mancanti");
  assert(arera.offerteDual.length > 0, "catalogo ARERA: nessuna vera offerta dual privata");

  assert(arera.trasformatoreVersione, "catalogo ARERA: versione trasformatore mancante");

  for (const row of arera.offerte) {
    assert(row.customerType === "privato", `catalogo privati: offerta ${row.codice} non privata`);
    assert(Array.isArray(row.sconti), `catalogo ARERA: metadata sconti mancante per ${row.codice}`);
    if (row.providerKey === "eco") {
      assert(String(row.codice || "").startsWith("000742"), `E.CO associata al codice errato ${row.codice}`);
    }
    if (row.tipo === "variabile" && row.qualitaPrezzo === "indice_piu_spread_semantico") {
      assert(Number.isFinite(Number(row.provenienzaPrezzo?.valoreIndice)), `offerta variabile ${row.codice}: indice mancante`);
      assert(Number(row.prezzo) !== Number(row.provenienzaPrezzo?.valore), `offerta variabile ${row.codice}: spread pubblicato come prezzo`);
      const rebuilt = Number(row.provenienzaPrezzo.valoreIndice) + Number(row.provenienzaPrezzo?.valore || 0);
      assert(Math.abs(Number(row.prezzo) - rebuilt) < 1e-7, `offerta variabile ${row.codice}: prezzo non coerente con indice ufficiale + spread`);
    }
  }

  for (const dual of arera.offerteDual) {
    assert(dual.customerType === "privato", `catalogo dual privati: offerta ${dual.codice} non privata`);
    assert(dual.fornitura === "dual", `offerta ${dual.codice}: fornitura dual mancante`);
    assert(dual.luce?.commodity === "luce" && dual.gas?.commodity === "gas", `offerta ${dual.codice}: componenti dual non valide`);
    assert(dual.codiceOffertaLuce === dual.luce.codice, `offerta ${dual.codice}: riferimento luce non esatto`);
    assert(dual.codiceOffertaGas === dual.gas.codice, `offerta ${dual.codice}: riferimento gas non esatto`);
    assert(dual.providerKey === dual.luce.providerKey && dual.providerKey === dual.gas.providerKey, `offerta ${dual.codice}: fornitori mescolati`);
    assert(dual.tipo === dual.luce.tipo && dual.tipo === dual.gas.tipo, `offerta ${dual.codice}: tipi prezzo mescolati`);
    assert(Array.isArray(dual.luce.sconti), `offerta ${dual.codice}: metadata sconti luce mancante`);
    assert(Array.isArray(dual.gas.sconti), `offerta ${dual.codice}: metadata sconti gas mancante`);
  }

  const illumia = arera.offerteDual.filter((dual) => dual.providerKey === "illum");
  assert(illumia.length > 0, "catalogo ARERA: offerta dual Illumia non trovata");
  return arera;
}

function validateDataFiles() {
  assertSame("data/calcolo-parametri.json", "public/data/calcolo-parametri.json");
  assertSame("data/offerte-proposte.json", "public/data/offerte-proposte.json");
  validateAreraCatalog();

  const params = readJson("data/calcolo-parametri.json");
  const offers = readJson("data/offerte-proposte.json");
  const arera = readJson("data/offerte-arera-menu.json");

  assert(params.versioneDati, "calcolo-parametri.json: versioneDati mancante");
  for (const key of ["pun", "psv", "psbg"]) {
    const paramIndex = params.indiciMercato?.[key];
    const catalogIndex = Number(arera.indiciUsati?.[key]);
    const allowedStates = key === "psbg" ? ["ufficiale", "verificato"] : ["ufficiale"];
    assert(allowedStates.includes(String(paramIndex?.stato || "").toLowerCase()), `indice ${key.toUpperCase()}: stato verificato mancante`);
    assert(Number.isFinite(Number(paramIndex?.valore)) && Number(paramIndex.valore) > 0, `indice ${key.toUpperCase()}: valore verificato non valido`);
    assert(catalogIndex === Number(paramIndex.valore), `indice ${key.toUpperCase()}: catalogo ARERA e parametri non sincronizzati`);
  }
  const averageProfile = params.parametriCalcolo?.profiloMedio;
  const consumptionSource = params.parametriCalcolo?.profiloConsumiFonte;
  assert(consumptionSource?.fonte?.includes("ARERA"), "profilo consumi: fonte ARERA mancante");
  assert(consumptionSource?.urlFonte, "profilo consumi: URL fonte ARERA mancante");
  assert(String(consumptionSource?.luceConsumoKwh) === String(averageProfile?.luceConsumoKwh), "profilo consumi: luce non coerente con la fonte");
  assert(String(consumptionSource?.gasConsumoSmc) === String(averageProfile?.gasConsumoSmc), "profilo consumi: gas non coerente con la fonte");
  assert(String(consumptionSource?.potenzaKw) === String(averageProfile?.potenzaKw), "profilo consumi: potenza non coerente con la fonte");

  const averageSource = params.parametriCalcolo?.profiloMedioFonte;
  assert(averageSource?.fonte?.includes("ARERA"), "profilo medio: fonte ARERA mancante");
  assert(averageSource?.catalogoVersione === arera.versioneDati, "profilo medio: catalogo ARERA non sincronizzato");
  assert(averageSource?.catalogoAggiornatoIl === arera.aggiornatoIl, "profilo medio: data catalogo ARERA non sincronizzata");
  for (const field of ["prezzoLuceEurKwh", "prezzoGasEurSmc", "quotaFissaLuceAnnua", "quotaFissaGasAnnua"]) {
    assert(Number.isFinite(Number(averageProfile?.[field])) && Number(averageProfile[field]) > 0, `profilo medio: ${field} non valido`);
  }
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


function validateCanonicalEconomicRouting() {
  const html = read("public/index.html");
  const providerFunction = html.match(/function miglioreNuovaOffertaPerFornitore\([\s\S]*?\n}\n/);
  assert(providerFunction, "routing economico: funzione provider specifico non trovata");
  assert(providerFunction[0].includes("offertaPartnerConPrezziArera"), "routing economico: il confronto per fornitore usa ancora prezzi partner statici");
  assert(html.includes("DATI_UFFICIALI_CONFRONTO_PRONTI"), "routing economico: guardia dati ufficiali mancante");

  const localUpdater = read("scripts/aggiorna-arera-locale-mac.sh");
  assert(localUpdater.includes("update-arera-reference-data.py\" indices"), "pipeline Mac: aggiornamento indici ufficiali mancante");
  assert(localUpdater.includes("update-arera-menu.py"), "pipeline Mac: generazione catalogo mancante");
  assert(localUpdater.includes("update-arera-reference-data.py\" benchmark"), "pipeline Mac: benchmark medio mancante");
  assert(localUpdater.includes("update-energy-today.py"), "pipeline Mac: dati energia giornalieri mancanti");
  assert(localUpdater.includes("validate-calculator-data.mjs"), "pipeline Mac: validazione finale mancante");

  const workflow = read(".github/workflows/update-arera-menu.yml");
  assert(!workflow.includes("schedule:"), "workflow GitHub: download automatico ARERA ancora schedulato");
  assert(!workflow.includes("python scripts/update-arera-menu.py"), "workflow GitHub: non deve scaricare/generare ARERA");
  assert(workflow.includes("npm run validate:calculator"), "workflow GitHub: validazione dati mancante");
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
  validateCanonicalEconomicRouting();
  const result = validateEngine(params, offers);
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
