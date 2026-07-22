import test from "node:test";
import assert from "node:assert/strict";
import {
  hasExplicitPdfAiConsent,
  PDF_AI_MODES,
  pdfAiConfig,
} from "../lib/pdfAiConfig.js";
import {
  PDF_AI_REVIEW_FIELDS,
  PDF_AI_REVIEW_OUTPUT_SCHEMA,
} from "../lib/pdfAiSchema.js";

test("Step 8 foundation: AI è spenta per default e il consenso è sempre richiesto", () => {
  const config = pdfAiConfig({});
  assert.equal(config.mode, "off");
  assert.equal(config.enabled, false);
  assert.equal(config.model, null);
  assert.equal(config.requires_consent, true);
  assert.deepEqual(PDF_AI_MODES, ["off", "shadow", "fallback"]);
  assert.equal(hasExplicitPdfAiConsent(false), false);
  assert.equal(hasExplicitPdfAiConsent("yes"), true);
  assert.equal(hasExplicitPdfAiConsent(["sì"]), true);
});

test("Step 8 foundation: configurazione invalida torna in off e viene segnalata", () => {
  const config = pdfAiConfig({
    PDF_AI_MODE: "automatic",
    PDF_AI_FILENAME_PATTERN: "[",
  });
  assert.equal(config.mode, "off");
  assert.deepEqual([...config.config_errors].sort(), ["invalid_filename_pattern", "invalid_mode"]);
});

test("Step 8 foundation: limiti operativi restano nel perimetro controllato", () => {
  const config = pdfAiConfig({
    PDF_AI_MODE: "fallback",
    PDF_AI_MODEL: "model-from-env",
    PDF_AI_MAX_PAGES: "99",
    PDF_AI_MAX_BYTES: "999999999",
    PDF_AI_TIMEOUT_MS: "999999",
    PDF_AI_RESERVE_MS: "1",
  });
  assert.equal(config.max_pages, 8);
  assert.equal(config.max_bytes, 15_000_000);
  assert.equal(config.timeout_ms, 20_000);
  assert.equal(config.reserve_ms, 2_000);
  assert.equal(config.model, "model-from-env");
});

test("Step 8 foundation: schema ristretto esclude tutti i campi economici", () => {
  for (const forbidden of [
    "consumo_luce_kwh",
    "consumo_gas_smc",
    "prezzo_luce_eur_kwh",
    "prezzo_gas_eur_smc",
    "quota_fissa_vendita_luce_eur_anno",
    "spread_gas_eur_smc",
  ]) {
    assert.equal(PDF_AI_REVIEW_FIELDS.includes(forbidden), false);
  }
  assert.equal(PDF_AI_REVIEW_OUTPUT_SCHEMA.additionalProperties, false);
  assert.deepEqual(
    PDF_AI_REVIEW_OUTPUT_SCHEMA.properties.candidates.items.properties.field.enum,
    PDF_AI_REVIEW_FIELDS,
  );
});
