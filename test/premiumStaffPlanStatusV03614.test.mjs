import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const staff = await readFile(new URL("../public/staff.js", import.meta.url), "utf8");
const staffHtml = await readFile(new URL("../public/staff.html", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const env = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const diagnostic = await readFile(new URL("../supabase/premium-complimentary-state-diagnostic-v0.36.14.sql", import.meta.url), "utf8");

test("v0.36.14 distingue prova ripristinata e omaggio revocato nella pagina staff", () => {
  assert.match(staff, /function subscriptionBadgeDescriptor/);
  assert.match(staff, /Prova ripristinata/);
  assert.match(staff, /Omaggio revocato · sola lettura/);
  assert.match(staff, /Omaggio scaduto · sola lettura/);
  assert.doesNotMatch(staff, /badge\(complimentaryIsActive\(subscription\) \? "Premium omaggio" : "Omaggio terminato"/);
});

test("v0.36.14 completa la configurazione di esempio Premium", () => {
  assert.match(env, /ALLOWED_ORIGINS=.*https:\/\/premium\.offertalogica\.it/);
  assert.match(env, /ARERA_HISTORY_URL=/);
});

test("la diagnostica omaggio e prova è esclusivamente di lettura", () => {
  assert.match(diagnostic, /diagnostic_state/);
  assert.match(diagnostic, /trial_restored/);
  assert.match(diagnostic, /complimentary_revoked_read_only/);
  assert.doesNotMatch(diagnostic, /\b(update|insert|delete|alter|drop|truncate|create)\b/i);
});

test("v0.36.14 aggiorna app staff e cache PWA", () => {
  assert.match(app, /APP Premium v0\.36\.19/);
  assert.match(staffHtml, /Area staff unica v0\.36\.19/);
  assert.match(sw, /offertalogica-premium-v03619/);
});
