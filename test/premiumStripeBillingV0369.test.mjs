import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  PREMIUM_FIRST_YEAR_AMOUNT_CENTS,
  PREMIUM_RENEWAL_AMOUNT_CENTS,
  billingConfigurationStatus,
  buildCheckoutParameters,
  extractSubscriptionIdFromInvoice,
  normalizeAppOrigin,
  parseStripeSignature,
  shouldPreserveInternalTrial,
  stripeStatusToPremium,
  validateStripeCommercialObjects,
  verifyStripeSignature,
  webhookEventRetryDecision,
} from "../supabase/functions/_shared/premium-billing-core.mjs";

const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const auth = await readFile(new URL("../public/app-auth.js", import.meta.url), "utf8");
const edge = await readFile(new URL("../supabase/functions/premium-billing/index.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/premium-stripe-billing-v0.36.9.sql", import.meta.url), "utf8");
const verify = await readFile(new URL("../supabase/premium-stripe-billing-v0.36.9-verify.sql", import.meta.url), "utf8");
const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

async function stripeSignature(payload, secret, timestamp) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

test("v0.36.9 usa 59,88 euro annuali con sconto iniziale di 9,98 euro", () => {
  assert.equal(PREMIUM_FIRST_YEAR_AMOUNT_CENTS, 4990);
  assert.equal(PREMIUM_RENEWAL_AMOUNT_CENTS, 5988);
  assert.equal(PREMIUM_RENEWAL_AMOUNT_CENTS - PREMIUM_FIRST_YEAR_AMOUNT_CENTS, 998);
  const params = buildCheckoutParameters({
    customerId: "cus_test",
    userId: "user-test",
    priceId: "price_5988",
    couponId: "coupon_998_once",
    successUrl: "https://premium.offertalogica.it/app.html?billing=success",
    cancelUrl: "https://premium.offertalogica.it/app.html?billing=cancel",
    automaticTax: true,
  });
  assert.equal(params.get("mode"), "subscription");
  assert.equal(params.get("line_items[0][price]"), "price_5988");
  assert.equal(params.get("discounts[0][coupon]"), "coupon_998_once");
  assert.equal(params.get("automatic_tax[enabled]"), "true");
});

test("firma webhook Stripe valida solo entro la tolleranza", async () => {
  const payload = JSON.stringify({ id: "evt_test", type: "invoice.paid" });
  const secret = "whsec_test";
  const timestamp = 1_786_000_000;
  const signature = await stripeSignature(payload, secret, timestamp);
  const header = `t=${timestamp},v1=${signature}`;
  assert.deepEqual(parseStripeSignature(header), { timestamp, signatures: [signature] });
  assert.equal(await verifyStripeSignature({ payload, header, secret, nowSeconds: timestamp + 10 }), true);
  assert.equal(await verifyStripeSignature({ payload, header, secret: "wrong", nowSeconds: timestamp + 10 }), false);
  assert.equal(await verifyStripeSignature({ payload, header, secret, nowSeconds: timestamp + 301 }), false);
});

test("un pagamento fallito non interrompe una prova interna ancora valida", () => {
  const row = { status: "trialing", plan_code: "premium-beta", current_period_end: "2026-09-01T00:00:00Z" };
  assert.equal(shouldPreserveInternalTrial(row, "incomplete", Date.parse("2026-08-10T00:00:00Z")), true);
  assert.equal(shouldPreserveInternalTrial(row, "past_due", Date.parse("2026-08-10T00:00:00Z")), true);
  assert.equal(shouldPreserveInternalTrial(row, "active", Date.parse("2026-08-10T00:00:00Z")), false);
  assert.equal(shouldPreserveInternalTrial(row, "incomplete", Date.parse("2026-09-02T00:00:00Z")), false);
});

test("stati Stripe e formati fattura vengono normalizzati", () => {
  assert.equal(stripeStatusToPremium("active"), "active");
  assert.equal(stripeStatusToPremium("past_due"), "past_due");
  assert.equal(stripeStatusToPremium("canceled"), "canceled");
  assert.equal(extractSubscriptionIdFromInvoice({ subscription: "sub_old" }), "sub_old");
  assert.equal(extractSubscriptionIdFromInvoice({ parent: { subscription_details: { subscription: "sub_new" } } }), "sub_new");
});

test("origini Preview sono ammesse senza aprire CORS a domini generici", () => {
  const production = "https://premium.offertalogica.it";
  const preview = "https://offertalogica-vercel-abc123-simonerimini78-3990s-projects.vercel.app";
  assert.equal(normalizeAppOrigin(production, [production]), production);
  assert.equal(normalizeAppOrigin(preview, [production]), preview);
  assert.equal(normalizeAppOrigin("https://evil.example", [production]), "");
});

test("configurazione resta disattivata finché tutti i segreti non sono presenti", () => {
  assert.deepEqual(billingConfigurationStatus({ PREMIUM_BILLING_ENABLED: "true" }).enabled, false);
  assert.equal(billingConfigurationStatus({
    PREMIUM_BILLING_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_test_x",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    STRIPE_PREMIUM_ANNUAL_PRICE_ID: "price_x",
    STRIPE_PREMIUM_FIRST_YEAR_COUPON_ID: "coupon_x",
    STRIPE_BILLING_PORTAL_CONFIGURATION_ID: "bpc_x",
  }).enabled, true);
});

test("prezzo e coupon Stripe devono corrispondere alla formula commerciale", () => {
  const valid = validateStripeCommercialObjects({
    price: {
      id: "price_annual",
      active: true,
      unit_amount: 5988,
      currency: "eur",
      type: "recurring",
      recurring: { interval: "year", interval_count: 1 },
      product: "prod_premium",
      tax_behavior: "inclusive",
    },
    coupon: {
      id: "coupon_intro",
      valid: true,
      amount_off: 998,
      currency: "eur",
      duration: "once",
      applies_to: { products: ["prod_premium"] },
    },
    requireInclusiveTax: true,
  });
  assert.deepEqual(valid, { valid: true, errors: [] });
  const renewalOnly = validateStripeCommercialObjects({
    price: {
      id: "price_annual",
      active: true,
      unit_amount: 5988,
      currency: "eur",
      type: "recurring",
      recurring: { interval: "year", interval_count: 1 },
      product: "prod_premium",
    },
    coupon: null,
    requireCoupon: false,
  });
  assert.deepEqual(renewalOnly, { valid: true, errors: [] });

  const invalid = validateStripeCommercialObjects({
    price: { id: "price_wrong", active: true, unit_amount: 4990, currency: "eur", type: "one_time", product: "prod_other" },
    coupon: { id: "coupon_wrong", valid: true, amount_off: 500, currency: "usd", duration: "forever", applies_to: { products: [] } },
    requireInclusiveTax: true,
  });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join(","), /annual_price_amount_invalid/);
  assert.match(invalid.errors.join(","), /intro_coupon_duration_invalid/);
  assert.match(invalid.errors.join(","), /intro_coupon_product_scope_invalid/);
});

test("webhook falliti o bloccati possono essere ritentati senza duplicare quelli completati", () => {
  const now = Date.parse("2026-08-04T10:00:00Z");
  assert.equal(webhookEventRetryDecision({ status: "processed", received_at: "2026-08-04T09:59:00Z" }, now), "duplicate");
  assert.equal(webhookEventRetryDecision({ status: "failed", received_at: "2026-08-04T09:59:00Z" }, now), "retry");
  assert.equal(webhookEventRetryDecision({ status: "processing", received_at: "2026-08-04T09:55:00Z" }, now), "in_progress");
  assert.equal(webhookEventRetryDecision({ status: "processing", received_at: "2026-08-04T09:40:00Z" }, now), "retry");
});

test("database, Edge Function e interfaccia sono collegati senza nuove API Vercel", async () => {
  assert.match(config, /\[functions\.premium-billing\][\s\S]*verify_jwt = false/);
  assert.match(edge, /verifyStripeSignature/);
  assert.match(edge, /checkout\.session\.completed/);
  assert.match(edge, /invoice\.paid/);
  assert.match(edge, /set_cancel_at_period_end/);
  assert.match(edge, /premium_payment_events/);
  assert.match(edge, /webhookEventRetryDecision/);
  assert.match(edge, /validateStripeCommercialConfiguration/);
  assert.match(edge, /stripe_event_processing/);
  assert.match(migration, /create table if not exists public\.premium_checkout_sessions/);
  assert.match(migration, /create table if not exists public\.premium_payment_events/);
  assert.match(migration, /intro_price_redeemed_at/);
  assert.match(verify, /premium_stripe_billing_v0\.36\.9_ok/);
  assert.match(app, /premiumSubscriptionPurchase/);
  assert.match(app, /premiumSubscriptionCancel/);
  assert.match(auth, /create_checkout/);
  assert.match(auth, /create_portal/);
  assert.match(auth, /set_cancel_at_period_end/);
  assert.match(auth, /\["active", "past_due", "paused", "canceled"\]/);
  assert.match(app, /APP Premium v0\.36\.9/);
  assert.match(sw, /offertalogica-premium-v0369/);
  const apiFiles = (await readdir(new URL("../api/", import.meta.url))).filter(name => name.endsWith(".js"));
  assert.equal(apiFiles.length, 12);
});
