export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;
export const PREMIUM_FIRST_YEAR_AMOUNT_CENTS = 4990;
export const PREMIUM_RENEWAL_AMOUNT_CENTS = 5988;
export const PREMIUM_CURRENCY = "eur";

export function normalizeBoolean(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function compactBillingError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "unknown_error");
  return message.replace(/\s+/g, " ").trim().slice(0, 500) || "unknown_error";
}

export function parseStripeSignature(header) {
  const result = { timestamp: null, signatures: [] };
  for (const part of String(header || "").split(",")) {
    const [rawKey, ...rawValue] = part.split("=");
    const key = rawKey?.trim();
    const value = rawValue.join("=").trim();
    if (key === "t" && /^\d+$/.test(value)) result.timestamp = Number.parseInt(value, 10);
    if (key === "v1" && /^[a-f0-9]{64}$/i.test(value)) result.signatures.push(value.toLowerCase());
  }
  return result;
}

export function constantTimeHexEqual(left, right) {
  const a = String(left || "").toLowerCase();
  const b = String(right || "").toLowerCase();
  const maxLength = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyStripeSignature({
  payload,
  header,
  secret,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = STRIPE_SIGNATURE_TOLERANCE_SECONDS,
}) {
  const parsed = parseStripeSignature(header);
  if (!parsed.timestamp || parsed.signatures.length === 0 || !secret) return false;
  if (Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signedPayload = `${parsed.timestamp}.${payload}`;
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const expected = bytesToHex(digest);
  return parsed.signatures.some(signature => constantTimeHexEqual(expected, signature));
}

export function normalizeAppOrigin(origin, configuredOrigins = []) {
  let parsed;
  try {
    parsed = new URL(String(origin || ""));
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") return "";
  const normalized = parsed.origin;
  if (configuredOrigins.includes(normalized)) return normalized;
  if (/^https:\/\/offertalogica-vercel-[a-z0-9-]+-simonerimini78-3990s-projects\.vercel\.app$/i.test(normalized)) return normalized;
  return "";
}

export function stripeStatusToPremium(status) {
  switch (String(status || "").toLowerCase()) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "paused":
      return "paused";
    case "canceled":
      return "canceled";
    case "incomplete":
    case "incomplete_expired":
      return "pending";
    default:
      return "pending";
  }
}


export function shouldPreserveInternalTrial(subscriptionRow, stripeStatus, nowMs = Date.now()) {
  if (subscriptionRow?.status !== "trialing" || subscriptionRow?.plan_code !== "premium-beta") return false;
  const end = new Date(subscriptionRow?.current_period_end || 0).getTime();
  if (!Number.isFinite(end) || end <= nowMs) return false;
  return stripeStatusToPremium(stripeStatus) !== "active";
}

export function extractSubscriptionIdFromInvoice(invoice) {
  if (typeof invoice?.subscription === "string") return invoice.subscription;
  if (typeof invoice?.subscription?.id === "string") return invoice.subscription.id;
  const parent = invoice?.parent?.subscription_details?.subscription;
  if (typeof parent === "string") return parent;
  if (typeof parent?.id === "string") return parent.id;
  return "";
}

export function extractPaymentIntentId(invoice) {
  if (typeof invoice?.payment_intent === "string") return invoice.payment_intent;
  if (typeof invoice?.payment_intent?.id === "string") return invoice.payment_intent.id;
  const payment = invoice?.payments?.data?.[0]?.payment?.payment_intent;
  if (typeof payment === "string") return payment;
  if (typeof payment?.id === "string") return payment.id;
  return "";
}

export function unixToIso(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

export function buildCheckoutParameters({
  customerId,
  userId,
  priceId,
  couponId,
  successUrl,
  cancelUrl,
  automaticTax = false,
}) {
  const parameters = new URLSearchParams();
  parameters.set("mode", "subscription");
  parameters.set("customer", customerId);
  parameters.set("client_reference_id", userId);
  parameters.set("line_items[0][price]", priceId);
  parameters.set("line_items[0][quantity]", "1");
  parameters.set("success_url", successUrl);
  parameters.set("cancel_url", cancelUrl);
  parameters.set("locale", "it");
  parameters.set("billing_address_collection", "required");
  parameters.set("customer_update[address]", "auto");
  parameters.set("customer_update[name]", "auto");
  parameters.set("metadata[user_id]", userId);
  parameters.set("metadata[offertalogica_plan]", "premium-casa-annual");
  parameters.set("subscription_data[metadata][user_id]", userId);
  parameters.set("subscription_data[metadata][offertalogica_plan]", "premium-casa-annual");
  if (couponId) parameters.set("discounts[0][coupon]", couponId);
  if (automaticTax) parameters.set("automatic_tax[enabled]", "true");
  return parameters;
}


export function validateStripeCommercialObjects({ price, coupon, requireInclusiveTax = false, requireCoupon = true }) {
  const errors = [];
  const productId = typeof price?.product === "string" ? price.product : String(price?.product?.id || "");
  if (!price?.id || price.active !== true) errors.push("annual_price_inactive");
  if (Number(price?.unit_amount) !== PREMIUM_RENEWAL_AMOUNT_CENTS) errors.push("annual_price_amount_invalid");
  if (String(price?.currency || "").toLowerCase() !== PREMIUM_CURRENCY) errors.push("annual_price_currency_invalid");
  if (String(price?.type || "") !== "recurring") errors.push("annual_price_not_recurring");
  if (String(price?.recurring?.interval || "") !== "year" || Number(price?.recurring?.interval_count || 1) !== 1) {
    errors.push("annual_price_interval_invalid");
  }
  if (requireInclusiveTax && String(price?.tax_behavior || "") !== "inclusive") errors.push("annual_price_tax_not_inclusive");

  if (requireCoupon) {
    if (!coupon?.id || coupon.valid === false) errors.push("intro_coupon_inactive");
    if (Number(coupon?.amount_off) !== PREMIUM_RENEWAL_AMOUNT_CENTS - PREMIUM_FIRST_YEAR_AMOUNT_CENTS) {
      errors.push("intro_coupon_amount_invalid");
    }
    if (String(coupon?.currency || "").toLowerCase() !== PREMIUM_CURRENCY) errors.push("intro_coupon_currency_invalid");
    if (String(coupon?.duration || "") !== "once") errors.push("intro_coupon_duration_invalid");
    const couponProducts = Array.isArray(coupon?.applies_to?.products) ? coupon.applies_to.products.map(String) : [];
    if (!productId || !couponProducts.includes(productId)) errors.push("intro_coupon_product_scope_invalid");
  }

  return { valid: errors.length === 0, errors };
}

export function webhookEventRetryDecision(eventRow, nowMs = Date.now(), staleAfterMs = 10 * 60 * 1000) {
  if (!eventRow) return "new";
  const status = String(eventRow.status || "");
  if (status === "processed" || status === "ignored") return "duplicate";
  if (status === "failed") return "retry";
  if (status === "processing") {
    const receivedAt = new Date(eventRow.received_at || 0).getTime();
    if (Number.isFinite(receivedAt) && receivedAt <= nowMs - staleAfterMs) return "retry";
    return "in_progress";
  }
  return "retry";
}

export function billingConfigurationStatus(env) {
  const missing = [];
  if (!String(env.STRIPE_SECRET_KEY || "").trim()) missing.push("STRIPE_SECRET_KEY");
  if (!String(env.STRIPE_WEBHOOK_SECRET || "").trim()) missing.push("STRIPE_WEBHOOK_SECRET");
  if (!String(env.STRIPE_PREMIUM_ANNUAL_PRICE_ID || "").trim()) missing.push("STRIPE_PREMIUM_ANNUAL_PRICE_ID");
  if (!String(env.STRIPE_PREMIUM_FIRST_YEAR_COUPON_ID || "").trim()) missing.push("STRIPE_PREMIUM_FIRST_YEAR_COUPON_ID");
  if (!String(env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID || "").trim()) missing.push("STRIPE_BILLING_PORTAL_CONFIGURATION_ID");
  const enabled = normalizeBoolean(env.PREMIUM_BILLING_ENABLED, false) && missing.length === 0;
  return { enabled, missing };
}
