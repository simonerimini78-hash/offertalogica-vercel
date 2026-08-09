import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => {
  const url = new URL(`../${path}`, import.meta.url);
  return fs.existsSync(url) ? fs.readFileSync(url, "utf8") : "";
};

const staff = () => read("public/staff.js");
const edge = () => read("supabase/functions/premium-staff-billing/index.ts");

test("fase 6: la scheda cliente admin espone il riallineamento Stripe solo per abbonamenti Stripe", () => {
  const js = staff();
  assert.match(js, /AGGIORNA DA STRIPE/);
  assert.match(js, /subscription\?\.provider === "stripe"/);
  assert.match(js, /subscription\?\.provider_subscription_id/);
  assert.match(js, /if \(isAdmin\(\).*subscription/);
});

test("fase 6: lo staff chiama una Edge Function separata senza toccare premium-billing", () => {
  const js = staff();
  assert.match(js, /premium-staff-billing/);
  assert.match(js, /action:\s*"sync_subscription"/);
  assert.match(js, /user_id:\s*customer\.profile\.id/);
});

test("fase 6: la Edge Function richiede sessione valida, staff attivo e ruolo admin", () => {
  const ts = edge();
  assert.match(ts, /admin\.auth\.getUser\(token\)/);
  assert.match(ts, /from\("premium_staff_members"\)/);
  assert.match(ts, /\.eq\("active", true\)/);
  assert.match(ts, /staff\.role !== "admin"/);
});

test("fase 6: Stripe viene interrogato in sola lettura", () => {
  const ts = edge();
  assert.match(ts, /https:\/\/api\.stripe\.com\/v1\/subscriptions\//);
  assert.match(ts, /method:\s*"GET"/);
  assert.doesNotMatch(ts, /method:\s*"POST"[^\n]*api\.stripe\.com|method:\s*"DELETE"[^\n]*api\.stripe\.com/);
  assert.doesNotMatch(ts, /\/v1\/subscriptions\/[^`"']+\/cancel|cancel_at_period_end\]/);
});

test("fase 6: il riallineamento verifica la corrispondenza utente e cliente prima di aggiornare Supabase", () => {
  const ts = edge();
  assert.match(ts, /stripe_subscription_mismatch/);
  assert.match(ts, /stripe_customer_mismatch/);
  assert.match(ts, /stripe_user_mismatch/);
  assert.match(ts, /\.from\("premium_subscriptions"\)\s*\.update\(update\)\s*\.eq\("id", row\.id\)\s*\.eq\("user_id", userId\)/s);
});

test("fase 6: usa gli stessi stati Premium e preserva una prova interna ancora valida", () => {
  const ts = edge();
  assert.match(ts, /case "past_due":\s*case "unpaid":\s*return "past_due";/s);
  assert.match(ts, /case "paused":\s*return "paused";/s);
  assert.match(ts, /case "canceled":\s*return "canceled";/s);
  assert.match(ts, /preserveInternalTrial/);
  assert.match(ts, /plan_code:\s*preserveTrial \? row\.plan_code : "premium-casa-annual"/);
});

test("fase 6: il risultato espone prima/dopo e lo staff ricarica clienti e pratiche", () => {
  const ts = edge();
  const js = staff();
  assert.match(ts, /before:\s*snapshot\(row\)/);
  assert.match(ts, /after:\s*snapshot\(updated\)/);
  assert.match(ts, /changed(?:,|:)/);
  assert.match(js, /await loadCases\(\{ silent: true \}\)/);
  assert.match(js, /Nessuno sblocco manuale eseguito/);
  assert.match(read("public/sw.js"), /phase6-stripe-sync/);
});
