import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const js = await fs.readFile(new URL("../public/staff-economics.js", import.meta.url), "utf8");
const sql = await fs.readFile(new URL("../supabase/premium-economics-site-ai-v0.36.65.sql", import.meta.url), "utf8");

test("Staff mostra separatamente IA sito privati e business", () => {
  assert.match(js, /Analisi IA sito — Privati/);
  assert.match(js, /Analisi IA sito — Business/);
  assert.match(js, /site_pdf_ai_consumer_cost_real_eur/);
  assert.match(js, /site_pdf_ai_business_cost_real_eur/);
});

test("le voci senza prezzo non vengono formattate come zero euro", () => {
  assert.match(js, /value === null \|\| value === undefined \|\| value === ""/);
});

test("il dashboard SQL separa il ledger IA sito dagli altri costi", () => {
  assert.match(sql, /source_system = 'site_pdf_ai'/);
  assert.match(sql, /source_system <> 'site_pdf_ai'/);
  assert.match(sql, /ledger_cost_real_other_eur/);
  assert.match(sql, /ledger_cost_estimated_other_eur/);
});

test("i KPI complessivi continuano a usare il ledger totale", () => {
  assert.match(sql, /'cost_real_eur', ai\.cost \+ human\.cost \+ legacy_costs\.cost \+ ledger\.cost_real/);
  assert.match(sql, /'cost_estimated_eur', ledger\.cost_estimated \+ scheduled_costs\.cost/);
});

test("il breakdown espone conteggi e non prezzati per segmento", () => {
  for (const key of [
    "site_pdf_ai_consumer_runs",
    "site_pdf_ai_consumer_unpriced",
    "site_pdf_ai_business_runs",
    "site_pdf_ai_business_unpriced",
  ]) assert.match(sql, new RegExp(`'${key}'`));
});
