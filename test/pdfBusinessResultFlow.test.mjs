import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

function extractFunction(name) {
  const candidates = [`async function ${name}(`, `function ${name}(`, `window.${name} = function ${name}(`];
  const start = candidates.map((prefix) => html.indexOf(prefix)).find((index) => index >= 0) ?? -1;
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

test("PDF business: acquisisce la pratica senza obbligare il confronto automatico", () => {
  const source = extractFunction("confermaPdfECalcola");
  const applyIndex = source.indexOf("applicaDatiPdfAlBusiness(data, selectedAutofillRows)");
  assert.ok(applyIndex >= 0, "applicazione dati business non trovata");
  const businessBlock = source.slice(applyIndex, source.indexOf("const master =", applyIndex));
  assert.doesNotMatch(businessBlock, /calcolaBusiness/);
  assert.match(businessBlock, /Bolletta business acquisita e salvata/);
  assert.match(businessBlock, /Non è necessario completare il confronto automatico/);
});

test("richiesta business: può partire anche senza dati economici completi", () => {
  const source = extractFunction("apriLeadBusiness");
  assert.match(source, /leggiProfiloBusiness\(\)/);
  assert.doesNotMatch(source, /calcolaBusiness\(\)/);
  assert.match(source, /LEAD_STATE\.businessProfile = profile/);
  assert.match(source, /apriLeadModal\("business"\)/);
});

test("profilo business: non usa prezzi o quote fisse predefiniti", () => {
  const source = extractFunction("leggiProfiloBusiness");
  assert.doesNotMatch(source, /0\.155/);
  assert.doesNotMatch(source, /0\.68/);
  assert.doesNotMatch(source, /\? 240/);
  assert.match(source, /campiMancanti/);
  assert.match(source, /datiCompleti/);
  assert.match(source, /pdfArchiveStored/);
  assert.match(source, /codiceClienteLuce/);
  assert.match(source, /codiceOffertaLuce/);
});

test("calcolo business manuale: resta disponibile ma blocca dati incompleti", () => {
  const source = extractFunction("calcolaBusiness");
  assert.match(source, /!profile\.datiCompleti/);
  assert.match(source, /Nessun valore standard è stato inserito/);
  assert.match(source, /result\.style\.display = "none"/);
});

test("profilo business: le offerte domestiche 6+3 restano escluse", () => {
  const source = extractFunction("selezionaSegmentoCliente");
  assert.match(source, /if \(isBusiness\) setDisplay\("\.fornitori-consigliati-section", "none"\)/);
});
