import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const js = await fs.readFile(new URL("../public/staff-economics.js", import.meta.url), "utf8");
const sql = await fs.readFile(new URL("../supabase/staff-management-foundation-v0.36.67.sql", import.meta.url), "utf8");

test("il punto zero usa la baseline esistente e non cancella lo storico", () => {
  assert.match(sql, /create table if not exists public\.premium_economic_baselines/);
  assert.match(sql, /create or replace function public\.staff_owner_set_management_baseline\(\)/);
  assert.match(sql, /insert into public\.premium_economic_baselines/);
  assert.doesNotMatch(sql, /delete\s+from\s+/i);
  assert.doesNotMatch(sql, /truncate\s+/i);
});

test("Staff presenta il reset come PUNTO ZERO gestionale", () => {
  assert.match(js, /id="economicResetBaseline"/);
  assert.match(js, />IMPOSTA PUNTO ZERO</);
  assert.match(js, /staff_owner_set_management_baseline/);
  assert.match(js, /I dati storici NON verranno cancellati/);
  assert.match(js, /Tariffe e parametri restano invariati/);
  assert.doesNotMatch(js, />AZZERA CONTEGGI</);
});

test("Staff mostra il punto zero senza descriverlo come cancellazione", () => {
  assert.match(js, /economicBaselineInfo/);
  assert.match(js, /Punto zero gestionale:/);
  assert.match(js, /renderBaselineInfo\(snapshot\)/);
});

test("la separazione costi IA sito resta intatta", () => {
  assert.match(js, /Analisi IA sito — Privati/);
  assert.match(js, /Analisi IA sito — Business/);
});

test("le voci senza prezzo continuano a non essere trasformate in zero", () => {
  assert.match(js, /value === null \|\| value === undefined \|\| value === ""/);
});
