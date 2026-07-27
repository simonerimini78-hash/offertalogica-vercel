import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

function extractFunction(name) {
  const asyncPrefix = `async function ${name}(`;
  const normalPrefix = `function ${name}(`;
  const start = html.indexOf(asyncPrefix) >= 0 ? html.indexOf(asyncPrefix) : html.indexOf(normalPrefix);
  assert.notEqual(start, -1, `Funzione ${name} non trovata`);
  const braceStart = html.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = braceStart; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }
  throw new Error(`Fine funzione ${name} non trovata`);
}

test("PDF business: dopo l'applicazione dei dati avvia il calcolo preliminare", () => {
  const source = extractFunction("confermaPdfECalcola");
  const applyIndex = source.indexOf("applicaDatiPdfAlBusiness(data, selectedAutofillRows)");
  const calculateIndex = source.indexOf("window.calcolaBusiness?.()");
  assert.ok(applyIndex >= 0, "applicazione dati business non trovata");
  assert.ok(calculateIndex > applyIndex, "il calcolo business deve avvenire dopo l'applicazione dei dati");
});

test("PDF business: non mostra risultati con dati economici incompleti", () => {
  const source = extractFunction("confermaPdfECalcola");
  assert.match(source, /il risultato preliminare è stato calcolato/);
  assert.match(source, /il confronto non è stato calcolato/);
  assert.match(source, /Consumi del periodo, costi medi e periodicità non dimostrate non vengono usati/);
  assert.match(source, /nessun valore predefinito viene inserito/);
});

test("profilo business: non usa prezzi o quote fisse predefiniti", () => {
  const source = extractFunction("leggiProfiloBusiness");
  assert.doesNotMatch(source, /0\.155/);
  assert.doesNotMatch(source, /0\.68/);
  assert.doesNotMatch(source, /\? 240/);
  assert.match(source, /campiMancanti/);
  assert.match(source, /datiCompleti/);
});

test("calcolo business: blocca il risultato finché i dati verificati non sono completi", () => {
  const source = extractFunction("calcolaBusiness");
  assert.match(source, /!profile\.datiCompleti/);
  assert.match(source, /Nessun valore standard è stato inserito/);
  assert.match(source, /result\.style\.display = "none"/);
});

test("profilo business: le offerte domestiche 6+3 restano escluse", () => {
  const source = extractFunction("selezionaSegmentoCliente");
  assert.match(source, /if \(isBusiness\) setDisplay\("\.fornitori-consigliati-section", "none"\)/);
});
