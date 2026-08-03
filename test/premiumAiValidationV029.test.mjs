import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/premium-ai-validation.js", import.meta.url), "utf8");
const context = { window: {}, Intl, Number, String, Object, Array, Set, Map, console };
vm.runInNewContext(source, context, { filename: "premium-ai-validation.js" });
const validation = context.window.OffertaLogicaPremiumAiValidation;

test("v0.29 seleziona i campi pertinenti per luce, gas e dual", () => {
  assert.ok(validation);
  const luce = validation.fieldsForAnalysis({ commodity: "luce", consumo_luce_kwh: 2000 }, "electricity");
  assert.equal(luce.some(field => field.key === "consumo_luce_kwh"), true);
  assert.equal(luce.some(field => field.key === "consumo_gas_smc"), false);

  const dual = validation.fieldsForAnalysis({ commodity: "dual" }, "dual");
  assert.equal(dual.some(field => field.key === "prezzo_luce_eur_kwh"), true);
  assert.equal(dual.some(field => field.key === "prezzo_gas_eur_smc"), true);
});

test("v0.29 usa il fornitore generico come fallback senza alterare gli altri campi", () => {
  const data = { fornitore: "Fornitore prova", consumo_luce_kwh: 1234 };
  assert.equal(validation.aiValueForField(data, "fornitore_luce"), "Fornitore prova");
  assert.equal(validation.aiValueForField(data, "consumo_luce_kwh"), 1234);
});

test("v0.29 converte valori numerici italiani e rifiuta numeri non validi", () => {
  const definition = validation.FIELD_DEFINITIONS.find(field => field.key === "prezzo_luce_eur_kwh");
  assert.equal(validation.parseReviewedValue("0,123456", definition), 0.123456);
  assert.throws(() => validation.parseReviewedValue("abc", definition), /Valore non valido/);
});

test("v0.29 calcola accordo e tasso di correzione sui soli campi applicabili", () => {
  const metrics = validation.calculateMetrics([
    { decision: "approved" },
    { decision: "approved" },
    { decision: "corrected" },
    { decision: "missing" },
    { decision: "not_applicable" }
  ]);
  assert.equal(metrics.applicable_fields, 4);
  assert.equal(metrics.accuracy_pct, 50);
  assert.equal(metrics.correction_rate_pct, 25);
  assert.equal(metrics.not_applicable_fields, 1);
});
