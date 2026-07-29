import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

function extractFunction(name, nextMarker) {
  const start = html.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`Funzione ${name} non trovata`);
  const end = nextMarker ? html.indexOf(nextMarker, start) : -1;
  if (end < 0) throw new Error(`Fine funzione ${name} non trovata`);
  return html.slice(start, end);
}

const bandCode = [
  extractFunction("numeroPrezzoSchedaPdf", "// Regola esclusiva per le schede sintetiche"),
  extractFunction("mediaPrezziSchedaPdf", "function calcolaPrezzoSchedaLuceDaFasce"),
  extractFunction("calcolaPrezzoSchedaLuceDaFasce", "function prezzoSchedaLuceDaContrattoPdf"),
].join("\n");
const context = {};
vm.createContext(context);
vm.runInContext(`${bandCode}\nthis.calc = calcolaPrezzoSchedaLuceDaFasce;`, context);
const calc = context.calc;
const close = (a, b) => Number.isFinite(a) && Math.abs(a - b) < 1e-9;

assert(close(calc({ f0: .11, f1: .2, f23: .1 })?.value, .11), "F0 non prioritario");
assert(close(calc({ f1: .2, f23: .1 })?.value, .15), "Media aritmetica F1/F23 errata");
assert(close(calc({ f1: .2, f23: .1 }, { f1: 40, f23: 60 })?.value, .14), "Media ponderata F1/F23 errata");
assert(close(calc({ f1: .18, f2: .12, f3: .09 })?.value, .13), "Media aritmetica F1/F2/F3 errata");
assert(close(calc({ f1: .18, f2: .12, f3: .09 }, { f1: 33, f2: 31, f3: 36 })?.value, .129), "Media ponderata F1/F2/F3 errata");
assert(calc({ f1: .18, f2: .12 }) === null, "Fasce incomplete producono un prezzo");

assert(html.includes("OFFERTALOGICA_PDF_SLOT_REBUILD_20260729"), "Marker ricostruzione slot mancante");
assert(html.includes("ricostruisciModuloDaSlotPdf(activeSlot)"), "Il flusso di analisi non ricostruisce i due slot");
assert(html.includes("BLOCCO_AUTOFILL_NUOVA_OFFERTA = true;"), "Blocco catalogo durante autocompilazione assente");
assert(!html.includes('? ["nome-fornitore-nuov", "in-luce-cons-nuov"'), "Lo slot offer cancella ancora il consumo della proposta");
assert(html.includes("const validCurrent = batch.valid.filter"), "Separazione lotto current assente");
assert(html.includes("const validOffer = batch.valid.filter"), "Separazione lotto offer assente");
assert(html.includes("Una lettura fallita non cancella"), "Protezione dello stato dopo errore assente");
assert(!html.includes('"6 offerte partner attivabili online",'), "Titolo partner ancora statico e non verificabile");
assert(!html.includes("if (!dual) return normalizzaOfferta(offerta, 0);"), "Fallback ai prezzi partner statici presente");

const result = { ok: failures.length === 0, checks: 15, failures };
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
