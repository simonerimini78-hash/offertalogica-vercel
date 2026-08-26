import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const management = await fs.readFile(new URL("../public/staff-management.js", import.meta.url), "utf8");
const economics = await fs.readFile(new URL("../public/staff-economics.js", import.meta.url), "utf8");
const version = JSON.parse(await fs.readFile(new URL("../public/version.json", import.meta.url), "utf8"));
const sql = await fs.readFile(new URL("../supabase/staff-management-foundation-v0.36.67.sql", import.meta.url), "utf8");

test("release gestionale e version.json sono sincronizzati", () => {
  assert.equal(version.version, "0.36.67");
  assert.equal(version.cache, "offertalogica-staff-v03667");
  assert.match(management, /const RELEASE = "0\.36\.67"/);
  assert.match(economics, /const MANAGEMENT_RELEASE = "0\.36\.67"/);
  assert.match(economics, /staff-management\.js\?v=/);
});

test("il calendario gestionale usa il mese italiano e non finestre mobili", () => {
  assert.match(management, /const TIME_ZONE = "Europe\/Rome"/);
  assert.match(management, /mode: "month"/);
  assert.match(management, /normalizeMonthKey/);
  assert.match(management, /currentMonthKey/);
});

test("il contratto prodotti include già il futuro Premium Business senza attivarlo", () => {
  for (const code of ["site_free_consumer", "site_free_business", "premium_casa", "premium_business"]) {
    assert.match(management, new RegExp(code));
    assert.match(sql, new RegExp(`'${code}'`));
  }
  assert.match(management, /premium_business:[\s\S]*enabled: false/);
  assert.match(sql, /'premium_business', 'Premium Business', 'premium', 'business', 'premium', false/);
});

test("subscription e bolletta Premium salvano segmentazione e snapshot del piano", () => {
  assert.match(sql, /alter table public\.premium_subscriptions[\s\S]*add column if not exists customer_segment text/);
  assert.match(sql, /alter table public\.premium_subscriptions[\s\S]*add column if not exists product_code text/);
  assert.match(sql, /alter table public\.premium_bills[\s\S]*add column if not exists plan_code_snapshot text/);
  assert.match(sql, /premium_bill_snapshot_management_dimensions/);
  assert.match(sql, /subscription\.plan_code/);
  assert.match(sql, /before insert on public\.premium_bills/);
});

test("lo storico pre-Business viene classificato Casa senza inferenze future", () => {
  assert.match(sql, /set customer_segment = 'consumer'/);
  assert.match(sql, /set product_code = 'premium_casa'/);
  assert.match(sql, /subscription\.created_at <= bill\.created_at/);
});

test("il punto zero è condiviso e non distruttivo", () => {
  assert.match(sql, /staff_owner_set_management_baseline/);
  assert.match(sql, /'scope', 'management'/);
  assert.match(sql, /'history_deleted', false/);
  assert.doesNotMatch(sql, /\bdelete\s+from\b/i);
  assert.doesNotMatch(sql, /\btruncate\b/i);
});

test("il contesto gestionale espone prodotti e slot Business", () => {
  assert.match(sql, /staff_owner_management_context/);
  assert.match(sql, /'premium_business_ready', true/);
  assert.match(sql, /'premium_business_enabled', false/);
  assert.match(sql, /'time_zone', 'Europe\/Rome'/);
});

test("la guardia updater nasconde solo il falso positivo della release corrente", () => {
  assert.match(management, /if \(latest && latest === RELEASE\)/);
  assert.match(management, /notice\.classList\.remove\("show"\)/);
  assert.match(management, /Se version\.json è realmente più nuovo di questo modulo, il pulsante resta visibile/);
});
