import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bills = await readFile(new URL("../public/app-premium-bills.js", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const auth = await readFile(new URL("../public/app-auth.js", import.meta.url), "utf8");
const staff = await readFile(new URL("../public/staff.html", import.meta.url), "utf8");
const staffPremium = await readFile(new URL("../public/staff-premium.html", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Funzione ${name} non trovata`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = brace; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (["\"", "'", "`"].includes(char)) { quote = char; continue; }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Funzione ${name} incompleta`);
}

const finiteBillAmount = Function(`return (${extractFunction(bills, "finiteBillAmount")})`)();
const analysisIsPending = Function(`return (${extractFunction(bills, "analysisIsPending")})`)();
const automaticStatusCopy = Function(`return (${extractFunction(bills, "automaticStatusCopy")})`)();

test("i valori assenti non vengono più trasformati in zero", () => {
  assert.equal(finiteBillAmount(null), null);
  assert.equal(finiteBillAmount(undefined), null);
  assert.equal(finiteBillAmount(""), null);
  assert.equal(finiteBillAmount("   "), null);
  assert.equal(finiteBillAmount(0), 0);
  assert.equal(finiteBillAmount("0"), 0);
  assert.equal(finiteBillAmount("12.50"), 12.5);
  assert.doesNotMatch(bills, /Number\.isFinite\(Number\(bill\.total_amount_eur\)\)/);
  assert.doesNotMatch(app, /id="premiumCloudSpendTotal">€ 0,00/);
});

test("durante l’analisi non vengono mostrati dati parziali o importi fittizi", () => {
  assert.equal(analysisIsPending({ automatic_screening_status: "running" }), true);
  assert.equal(analysisIsPending({ processing_status: "analyzing" }), true);
  assert.equal(analysisIsPending({ automatic_screening_status: "clear", processing_status: "completed" }), false);
  assert.match(bills, /if \(!analysisIsPending\(bill\)\) \{[\s\S]*renderCustomerAnalysisData\(bill\)/);
  assert.match(bills, /pendingCount \? "In lettura" : "—"/);
  assert.match(bills, /Importo non disponibile/);
});

test("un esito verde comunica esplicitamente che la bolletta è regolare", () => {
  assert.equal(automaticStatusCopy({ automatic_screening_status: "clear" }), "Bolletta verificata. Non sono state rilevate anomalie.");
  assert.equal(automaticStatusCopy({ automatic_screening_status: "clear", automatic_screening_summary: "Controllo completato." }), "Bolletta verificata. Non sono state rilevate anomalie.");
  assert.match(bills, /clear: "Tutto regolare"/);
  assert.match(bills, /if \(!generalRows && !supplyCards\) return null/);
});

test("versione applicativa e termini commerciali sono aggiornati insieme", () => {
  assert.match(app, /APP v0\.36\.29/);
  assert.match(app, /APP Premium v0\.36\.29/);
  assert.match(app, /Versione condizioni correnti: v0\.36\.22/);
  assert.match(auth, /premium-terms-v0\.36\.22-2026-08-06/);
  assert.match(bills, /app_version: "0\.36\.29"/);
  assert.match(staff, /v0\.36\.29/);
  assert.match(staffPremium, /v0\.36\.29/);
  assert.match(sw, /offertalogica-premium-v03629/);
});

test("il prezzo mensile è principale e l’addebito annuale resta esplicito", () => {
  const accountStart = app.indexOf('<div class="subscription-commercial">');
  const accountEnd = app.indexOf('<p id="premiumSubscriptionActionCopy"', accountStart);
  const accountCard = app.slice(accountStart, accountEnd);
  assert.ok(accountCard.indexOf("3,99 €") >= 0);
  assert.ok(accountCard.indexOf("3,99 €") < accountCard.indexOf("47,88 €"));
  assert.match(accountCard, /Pagamento annuale unico di 47,88 € IVA inclusa/);
  assert.match(accountCard, /Dal secondo anno 4,99 €\/mese, addebitati 59,88 €/);
  assert.match(auth, /ATTIVA PREMIUM · 3,99 €\/MESE\*/);
  assert.match(auth, /RIATTIVA PREMIUM · 4,99 €\/MESE\*/);
  assert.match(app, /premium-plan-price monthly/);
});
