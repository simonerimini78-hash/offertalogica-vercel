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

test("la diagnostica App mantiene compatibilità e i nuovi costi usano il cambio BCE automatico", () => {
  for (const label of ["Tariffa input IA", "Tariffa cache IA", "Tariffa output IA"]) {
    assert.match(staff, new RegExp(label));
  }
  assert.match(staff, /Variabile Vercel/);
  assert.match(staff, /Fallback/);
  assert.match(staff, /pricing\.missing/);
  assert.match(api, /PREMIUM_COST_PRICING_VERSION = "premium-ecb-eur-v0\.36\.43"/);
  assert.match(api, /eurofxref-daily\.xml/);
  assert.match(api, /inputPerMillion: 2/);
  assert.match(api, /cachedInputPerMillion: 0\.5/);
  assert.match(api, /outputPerMillion: 8/);
  assert.match(api, /PREMIUM_WEB_SEARCH_USD_PER_1K_RUNS = 10/);
  assert.match(api, /const usdToEur = 1 \/ usdQuote/);
  assert.match(api, /automaticEurPricing/);
  assert.match(api, /pricing_mode: "openai_usd_x_ecb"/);
  assert.match(api, /ecb_reference_date/);
  assert.match(api, /usd_to_eur_rate/);
  assert.doesNotMatch(api, /PREMIUM_AI_WEB_SEARCH_EUR_PER_1K_RUNS/);
  assert.match(staffHtml, /v0\.36\.29/);
});

test("v0.36.1 non aggiunge funzioni Vercel", async () => {
  const files = (await readdir(new URL("../api/", import.meta.url))).filter(name => name.endsWith(".js"));
  assert.equal(files.length, 12);
  assert.ok(!files.includes("health.js"));
});
