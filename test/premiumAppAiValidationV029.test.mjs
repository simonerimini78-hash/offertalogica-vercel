import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/staff-premium.html", import.meta.url), "utf8");
const staff = await readFile(new URL("../public/staff-premium.js", import.meta.url), "utf8");
const validation = await readFile(new URL("../public/premium-ai-validation.js", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/premium-ai-validation-v0.29.sql", import.meta.url), "utf8");
const verify = await readFile(new URL("../supabase/premium-ai-validation-v0.29-verify.sql", import.meta.url), "utf8");
const docs = await readFile(new URL("../docs/PREMIUM-AI-VALIDATION-V0.29.md", import.meta.url), "utf8");

test("Premium v0.30 aggiorna versione e cache", () => {
  assert.match(app, /APP Premium v0\.(?:30(?:\.\d+)?|31C)/);
  assert.match(html, /Area riservata allo staff autorizzato · v0\.30/);
  assert.match(sw, /offertalogica-premium-v(?:30\d*|031c)/);
  assert.match(html, /<script src="\/premium-ai-validation\.js"><\/script>/);
});

test("La dashboard consente conferma, correzione, mancante e non applicabile", () => {
  for (const label of ["Confermato", "Corretto", "Dato mancante", "Non applicabile", "SALVA VALIDAZIONE"]) {
    assert.match(staff, new RegExp(label));
  }
  assert.match(staff, /premium_staff_validate_analysis/);
  assert.match(staff, /premium_analysis_field_reviews/);
  assert.match(staff, /Accordo IA\/staff/);
});

test("La validazione copre i tre dati chiave luce e gas", () => {
  for (const field of [
    "consumo_luce_kwh",
    "prezzo_luce_eur_kwh",
    "quota_fissa_vendita_luce_eur_anno",
    "consumo_gas_smc",
    "prezzo_gas_eur_smc",
    "quota_fissa_vendita_gas_eur_anno"
  ]) assert.match(validation, new RegExp(field));
});

test("Il database conserva audit campo per campo e impedisce accessi anonimi", () => {
  assert.match(migration, /create table if not exists public\.premium_analysis_field_reviews/);
  assert.match(migration, /review_status/);
  assert.match(migration, /validation_seconds/);
  assert.match(migration, /validation_metrics/);
  assert.match(migration, /validated_data/);
  assert.match(migration, /premium_analysis_field_reviews_staff_all/);
  assert.match(migration, /premium_check_must_be_claimed/);
  assert.doesNotMatch(migration, /drop table/i);
  assert.doesNotMatch(staff, /service_role|sb_secret_/i);
});

test("La metrica è documentata come accordo operativo e non come precisione generale", () => {
  assert.match(docs, /campi confermati \/ campi applicabili/);
  assert.match(docs, /Non rappresenta un’accuratezza scientifica generale/);
  assert.match(migration, /metric_definition/);
});

test("La verifica SQL copre struttura, RLS, funzione e audit", () => {
  for (const field of [
    "field_reviews_table_present",
    "analysis_validation_columns_present",
    "field_reviews_index_present",
    "field_reviews_are_staff_only",
    "validation_function_present",
    "authenticated_staff_can_execute",
    "anon_cannot_execute",
    "anon_has_no_field_review_grants",
    "validated_runs_have_complete_audit",
    "no_orphan_field_reviews"
  ]) assert.match(verify, new RegExp(field));
});
