import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { premiumAiConfig, resolvePremiumAiPricing } from "../lib/premiumAiBackend.js";

const api = await readFile(new URL("../api/premium-ai-analysis.js", import.meta.url), "utf8");
const staff = await readFile(new URL("../public/staff.js", import.meta.url), "utf8");
const staffHtml = await readFile(new URL("../public/staff.html", import.meta.url), "utf8");

test("il backend legacy conserva il listino modello solo come diagnostica compatibile", () => {
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

test("le vecchie variabili Vercel EUR restano leggibili dal backend legacy", () => {
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
});

test("un modello legacy sconosciuto indica le variabili mancanti", () => {
  const pricing = resolvePremiumAiPricing({}, "modello-non-censito");
  assert.equal(pricing.complete, false);
  assert.deepEqual(pricing.missing, [
    "PREMIUM_AI_INPUT_EUR_PER_1M_TOKENS",
    "PREMIUM_AI_CACHED_INPUT_EUR_PER_1M_TOKENS",
    "PREMIUM_AI_OUTPUT_EUR_PER_1M_TOKENS",
  ]);
});

test("v0.36.43 calcola i nuovi costi con listino OpenAI USD e cambio BCE automatico", () => {
  assert.match(api, /PREMIUM_COST_PRICING_VERSION = "premium-ecb-eur-v0\.36\.43"/);
  assert.match(api, /PREMIUM_ECB_DAILY_FX_URL = "https:\/\/www\.ecb\.europa\.eu\/stats\/eurofxref\/eurofxref-daily\.xml"/);
  assert.match(api, /inputPerMillion: 2/);
  assert.match(api, /cachedInputPerMillion: 0\.5/);
  assert.match(api, /outputPerMillion: 8/);
  assert.match(api, /PREMIUM_WEB_SEARCH_USD_PER_1K_RUNS = 10/);
  assert.match(api, /const usdToEur = 1 \/ usdQuote/);
  assert.match(api, /automaticEurPricing/);
  assert.match(api, /pricing_mode: "openai_usd_x_ecb"/);
  assert.match(api, /ecb_reference_date/);
  assert.match(api, /usd_to_eur_rate/);
  assert.match(api, /web_search_rate_usd_per_1k/);
  assert.doesNotMatch(api, /PREMIUM_AI_WEB_SEARCH_EUR_PER_1K_RUNS/);
});

test("la diagnostica Staff espone cambio BCE, tariffe automatiche e costo zero senza analisi", () => {
  for (const label of ["Cambio USD → EUR", "Tariffa input IA", "Tariffa cache IA", "Tariffa output IA", "Tariffa ricerca web IA"]) {
    assert.match(staff, new RegExp(label));
  }
  assert.match(staff, /Listino OpenAI USD × cambio BCE/);
  assert.match(staff, /Tariffe IA", pricing\.complete \? "Automatiche"/);
  assert.match(staff, /cache\.runs\.length \? "Storico non verificato" : formatMoney\(0\)/);
  assert.match(staff, /Tempo \/ costo operatore/);
  assert.match(staff, /Tariffa standard:/);
  assert.match(staff, /premium-ecb-eur-v0\.36\.43/);
  assert.match(staff, /premium-eur-v0\.36\.42/);
  assert.match(staffHtml, /v0\.36\.43/);
});

test("v0.36.43 non aggiunge funzioni Vercel", async () => {
  const files = (await readdir(new URL("../api/", import.meta.url))).filter(name => name.endsWith(".js"));
  assert.equal(files.length, 12);
  assert.ok(!files.includes("health.js"));
});
