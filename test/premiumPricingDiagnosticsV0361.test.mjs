import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { premiumAiConfig, resolvePremiumAiPricing } from "../lib/premiumAiBackend.js";

const api = await readFile(new URL("../api/premium-ai-analysis.js", import.meta.url), "utf8");
const staff = await readFile(new URL("../public/staff.js", import.meta.url), "utf8");
const staffHtml = await readFile(new URL("../public/staff.html", import.meta.url), "utf8");

test("v0.36.1 usa il listino GPT-4.1 come fallback operativo", () => {
  const pricing = resolvePremiumAiPricing({}, "gpt-4.1-2025-04-14");
  assert.equal(pricing.complete, true);
  assert.equal(pricing.inputPerMillion, 2);
  assert.equal(pricing.cachedInputPerMillion, 0.5);
  assert.equal(pricing.outputPerMillion, 8);
  assert.equal(pricing.sources.inputPerMillion, "model_default");
  assert.equal(pricing.sources.cachedInputPerMillion, "model_default");
  assert.equal(pricing.sources.outputPerMillion, "model_default");
  assert.deepEqual(pricing.missing, []);
  assert.equal(pricing.modelDefaultApplied, true);
});

test("le variabili Vercel hanno precedenza sul fallback del modello", () => {
  const config = premiumAiConfig({
    PDF_AI_PRIMARY_MODEL: "gpt-4.1-2025-04-14",
    PREMIUM_AI_INPUT_EUR_PER_1M_TOKENS: "2.1",
    PREMIUM_AI_CACHED_INPUT_EUR_PER_1M_TOKENS: "0.6",
    PREMIUM_AI_OUTPUT_EUR_PER_1M_TOKENS: "8.2",
  });
  assert.equal(config.pricing.complete, true);
  assert.equal(config.pricing.inputPerMillion, 2.1);
  assert.equal(config.pricing.cachedInputPerMillion, 0.6);
  assert.equal(config.pricing.outputPerMillion, 8.2);
  assert.equal(config.pricing.sources.inputPerMillion, "environment");
  assert.equal(config.pricing.modelDefaultApplied, false);
});

test("un modello sconosciuto indica esattamente le variabili mancanti", () => {
  const pricing = resolvePremiumAiPricing({}, "modello-non-censito");
  assert.equal(pricing.complete, false);
  assert.equal(pricing.inputPerMillion, null);
  assert.equal(pricing.cachedInputPerMillion, null);
  assert.equal(pricing.outputPerMillion, null);
  assert.deepEqual(pricing.missing, [
    "PREMIUM_AI_INPUT_EUR_PER_1M_TOKENS",
    "PREMIUM_AI_CACHED_INPUT_EUR_PER_1M_TOKENS",
    "PREMIUM_AI_OUTPUT_EUR_PER_1M_TOKENS",
  ]);
});

test("la diagnostica staff mostra valori e fonte per ogni tariffa", () => {
  for (const label of ["Tariffa input IA", "Tariffa cache IA", "Tariffa output IA"]) {
    assert.match(staff, new RegExp(label));
  }
  assert.match(staff, /Variabile Vercel/);
  assert.match(staff, /Fallback/);
  assert.match(staff, /pricing\.missing/);
  assert.match(api, /sources: backend\.pricing\.sources/);
  assert.match(api, /missing: Array\.isArray\(backend\.pricing\.missing\)/);
  assert.match(staffHtml, /v0\.36\.26/);
});

test("v0.36.1 non aggiunge funzioni Vercel", async () => {
  const files = (await readdir(new URL("../api/", import.meta.url))).filter(name => name.endsWith(".js"));
  assert.equal(files.length, 12);
  assert.ok(!files.includes("health.js"));
});
