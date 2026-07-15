import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

function extractFunction(name) {
  const start = html.indexOf(`async function ${name}(`) >= 0
    ? html.indexOf(`async function ${name}(`)
    : html.indexOf(`function ${name}(`);
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

const functionSource = extractFunction("confermaAmbitoPdf");

async function runDecision(data, choice) {
  const context = {
    LEAD_STATE: {
      comparisonScope: "unknown",
      gasDecision: "",
      electricityDecision: "",
    },
    ambitoConfrontoAttivo: () => "dual",
    apriDecisionePdf: async () => choice,
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}; globalThis.fn = confermaAmbitoPdf;`, context);
  const scope = await context.fn(data);
  return { scope, state: context.LEAD_STATE };
}

test("bolletta solo gas: consente di dichiarare che la luce non esiste", async () => {
  const result = await runDecision({ kind: "bolletta", commodity: "gas" }, "gas_no_luce");
  assert.equal(result.scope, "gas");
  assert.equal(result.state.gasDecision, "detected");
  assert.equal(result.state.electricityDecision, "not_present");
});

test("bolletta solo gas: conserva il gas e attende la bolletta luce", async () => {
  const result = await runDecision({ kind: "bolletta", commodity: "gas" }, "pending_luce");
  assert.equal(result.scope, "pending_luce");
  assert.equal(result.state.gasDecision, "detected");
  assert.equal(result.state.electricityDecision, "pending_upload");
});

test("bolletta solo gas: permette di confrontare soltanto il gas", async () => {
  const result = await runDecision({ kind: "bolletta", commodity: "gas" }, "gas_not_compare");
  assert.equal(result.scope, "gas");
  assert.equal(result.state.electricityDecision, "not_compared");
});

test("bolletta solo luce: mantiene il percorso simmetrico verso il gas", async () => {
  const result = await runDecision({ kind: "bolletta", commodity: "luce" }, "pending_gas");
  assert.equal(result.scope, "pending_gas");
  assert.equal(result.state.electricityDecision, "detected");
  assert.equal(result.state.gasDecision, "pending_upload");
});

test("la modalità staff include entrambe le domande", () => {
  assert.match(html, /Vuoi confrontare anche una fornitura gas\?/);
  assert.match(html, /Vuoi confrontare anche una fornitura luce\?/);
  assert.match(html, /Sì, devo ancora caricare la bolletta luce/);
  assert.match(html, /Sì, devo ancora caricare la bolletta gas/);
});
