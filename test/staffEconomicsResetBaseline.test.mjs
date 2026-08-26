import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const js = await fs.readFile(new URL("../public/staff-economics.js", import.meta.url), "utf8");
const sql = await fs.readFile(new URL("../supabase/premium-economics-baseline-v0.36.66.sql", import.meta.url), "utf8");

test("il reset usa una baseline e non cancella lo storico", () => {
  assert.match(sql, /create table if not exists public\.premium_economic_baselines/);
  assert.match(sql, /create or replace function public\.premium_owner_reset_economic_baseline\(\)/);
  assert.match(sql, /insert into public\.premium_economic_baselines/);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.premium_economic_entries/i);
  assert.doesNotMatch(sql, /truncate\s+/i);
});

test("il dashboard applica la baseline a tutte le fonti tramite v_since", () => {
  assert.match(sql, /select max\(b\.baseline_at\)/);
  assert.match(sql, /greatest\(v_requested_since, v_baseline_at\)/);
  assert.match(sql, /run\.created_at >= v_since/);
  assert.match(sql, /e\.occurred_at >= v_since/);
  assert.match(sql, /coalesce\(chk\.completed_at, chk\.created_at\) >= v_since/);
  assert.match(sql, /cost\.occurred_at >= v_since/);
  assert.match(sql, /where created_at >= \$1/);
  assert.match(sql, /greatest\(r\.valid_from, v_since\)/);
});

test("il dashboard espone baseline e inizio effettivo", () => {
  assert.match(sql, /'requested_from', v_requested_since/);
  assert.match(sql, /'baseline_at', v_baseline_at/);
  assert.match(sql, /'baseline_active'/);
  assert.match(sql, /'from', v_since/);
});

test("Staff offre AZZERA CONTEGGI con conferma esplicita", () => {
  assert.match(js, /id="economicResetBaseline"/);
  assert.match(js, />AZZERA CONTEGGI</);
  assert.match(js, /premium_owner_reset_economic_baseline/);
  assert.match(js, /I dati storici NON verranno cancellati dal database/);
  assert.match(js, /Tariffe e parametri restano invariati/);
});

test("Staff mostra la baseline attiva dopo l'azzeramento", () => {
  assert.match(js, /economicBaselineInfo/);
  assert.match(js, /Ultimo azzeramento conteggi/);
  assert.match(js, /renderBaselineInfo\(snapshot\)/);
});

test("la separazione costi IA sito resta intatta", () => {
  assert.match(js, /Analisi IA sito — Privati/);
  assert.match(js, /Analisi IA sito — Business/);
  assert.match(sql, /source_system = 'site_pdf_ai'/);
  assert.match(sql, /source_system <> 'site_pdf_ai'/);
});

test("le voci senza prezzo continuano a non essere trasformate in zero", () => {
  assert.match(js, /value === null \|\| value === undefined \|\| value === ""/);
  assert.match(sql, /e\.status = 'unpriced' or e\.amount_gross_eur is null/);
});
