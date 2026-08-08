import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("fase 2: l'app Premium espone la richiesta assistenza senza cambiare navigazione", () => {
  const html = read("public/app.html");
  assert.match(html, /id="premiumSupportOpen"/);
  assert.match(html, /id="premiumSupportPanel"/);
  assert.match(html, /id="premiumSupportForm"/);
  assert.match(html, /Account e accesso/);
  assert.match(html, /Abbonamento e pagamento/);
  assert.match(html, /Installazione e aggiornamento app/);
  assert.match(html, /<script src="\/app-support\.js"><\/script>/);
  assert.match(html, /OffertaLogicaPremiumSupport\?\.init\(\)/);
});

test("fase 2: la richiesta usa premium_communications esistente e resta user_to_staff", () => {
  const js = read("public/app-support.js");
  assert.match(js, /\.from\("premium_communications"\)\.insert\(/);
  assert.match(js, /direction:\s*"user_to_staff"/);
  assert.match(js, /channel:\s*"in_app"/);
  assert.match(js, /created_by_user_id:\s*session\.user\.id/);
  assert.match(js, /`\[support:\$\{category\}\]/);
  assert.doesNotMatch(js, /fetch\(["'`]\/api\//);
  assert.doesNotMatch(js, /premium_support_cases/);
});

test("fase 2: lo staff porta le comunicazioni non gestite dentro Pratiche", () => {
  const js = read("public/staff.js");
  const html = read("public/staff.html");
  assert.match(js, /\.from\("premium_communications"\)/);
  assert.match(js, /\.eq\("direction",\s*"user_to_staff"\)/);
  assert.match(js, /communication\.read_at/);
  assert.match(js, /type:\s*"support_request"/);
  assert.match(js, /data-support-resolve/);
  assert.match(js, /\.update\(\{\s*read_at:\s*new Date\(\)\.toISOString\(\)\s*\}\)/);
  assert.match(html, /option value="support_request">Richiesta assistenza/);
});

test("fase 2: lo schema già presente consente comunicazioni cliente-staff", () => {
  const sql = read("supabase/premium-schema-v0.2.sql");
  assert.match(sql, /create table if not exists public\.premium_communications/);
  assert.match(sql, /direction text not null check \(direction in \('user_to_staff', 'staff_to_user', 'system_to_user'\)\)/);
  assert.match(sql, /premium_communications_owner_insert/);
  assert.match(sql, /direction = 'user_to_staff'/);
  assert.match(sql, /premium_communications_staff_all/);
});

test("fase 2: il service worker conosce il nuovo modulo assistenza", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /"\/app-support\.js"/);
});
