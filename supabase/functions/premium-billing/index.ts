import { createClient } from "npm:@supabase/supabase-js@2";
import {
  PREMIUM_CURRENCY,
  PREMIUM_FIRST_YEAR_AMOUNT_CENTS,
  PREMIUM_RENEWAL_AMOUNT_CENTS,
  billingConfigurationStatus,
  buildCheckoutParameters,
  compactBillingError,
  extractPaymentIntentId,
  extractSubscriptionIdFromInvoice,
  normalizeAppOrigin,
  normalizeBoolean,
  stripeStatusToPremium,
  shouldPreserveInternalTrial,
  unixToIso,
  validateStripeCommercialObjects,
  verifyStripeSignature,
  webhookEventRetryDecision,
} from "../_shared/premium-billing-core.mjs";

const CURRENT_ACCEPTANCES = [
  ["terms", "premium-terms-v0.36.22-2026-08-06"],
  ["privacy", "premium-privacy-v0.36.6-2026-08-04"],
  ["cloud_storage", "premium-cloud-ai-v0.36.6-2026-08-04"],
];

function envObject() {
  return {
    STRIPE_SECRET_KEY: Deno.env.get("STRIPE_SECRET_KEY") || "",
    STRIPE_WEBHOOK_SECRET: Deno.env.get("STRIPE_WEBHOOK_SECRET") || "",
    STRIPE_PREMIUM_ANNUAL_PRICE_ID: Deno.env.get("STRIPE_PREMIUM_ANNUAL_PRICE_ID") || "",
    STRIPE_PREMIUM_FIRST_YEAR_COUPON_ID: Deno.env.get("STRIPE_PREMIUM_FIRST_YEAR_COUPON_ID") || "",
    PREMIUM_BILLING_ENABLED: Deno.env.get("PREMIUM_BILLING_ENABLED") || "",
    STRIPE_BILLING_PORTAL_CONFIGURATION_ID: Deno.env.get("STRIPE_BILLING_PORTAL_CONFIGURATION_ID") || "",
  };
}

function resolveAdminKey() {
  const legacyServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (legacyServiceRole) return legacyServiceRole;
  const rawSecretKeys = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
  if (!rawSecretKeys) return "";
  try {
    const parsed = JSON.parse(rawSecretKeys);
    if (typeof parsed?.default === "string" && parsed.default.trim()) return parsed.default.trim();
    const first = Object.values(parsed || {}).find(value => typeof value === "string" && value.trim());
    return typeof first === "string" ? first.trim() : "";
  } catch {
    return "";
  }
}

function configuredOrigins() {
  const values = (Deno.env.get("PREMIUM_APP_ORIGINS") || "https://premium.offertalogica.it")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  return [...new Set(values)];
}

function corsHeaders(origin = "") {
  const allowed = normalizeAppOrigin(origin, configuredOrigins());
  return {
    "access-control-allow-origin": allowed || configuredOrigins()[0] || "https://premium.offertalogica.it",
    "access-control-allow-headers": "authorization, content-type, stripe-signature",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function jsonResponse(body: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function stripeRequest(path: string, options: {
  method?: string;
  parameters?: URLSearchParams | null;
  idempotencyKey?: string;
} = {}) {
  const secretKey = Deno.env.get("STRIPE_SECRET_KEY")?.trim() || "";
  if (!secretKey) throw new Error("stripe_secret_key_missing");
  const headers: Record<string, string> = {
    authorization: `Bearer ${secretKey}`,
  };
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  let body: string | undefined;
  if (options.parameters) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = options.parameters.toString();
  }
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: options.method || (body ? "POST" : "GET"),
    headers,
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || payload?.error?.code || `stripe_http_${response.status}`;
    throw new Error(`stripe:${compactBillingError(message)}`);
  }
  return payload;
}

async function authenticatedUser(request: Request, admin: any) {
  const header = request.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("authentication_required");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user?.id) throw new Error("authentication_invalid");
  return data.user;
}

async function currentAcceptancesComplete(admin: any, userId: string) {
  const { data, error } = await admin
    .from("premium_consents")
    .select("consent_type,version,granted,revoked_at")
    .eq("user_id", userId)
    .eq("granted", true)
    .is("revoked_at", null)
    .in("consent_type", CURRENT_ACCEPTANCES.map(item => item[0]))
    .in("version", CURRENT_ACCEPTANCES.map(item => item[1]));
  if (error) throw new Error(`consents:${compactBillingError(error.message || error)}`);
  const found = new Set((data || []).map((row: any) => `${row.consent_type}:${row.version}`));
  return CURRENT_ACCEPTANCES.every(([type, version]) => found.has(`${type}:${version}`));
}

async function accountContext(admin: any, userId: string) {
  const [profileResult, subscriptionResult] = await Promise.all([
    admin.from("premium_profiles").select("id,full_name,account_status").eq("id", userId).maybeSingle(),
    admin
      .from("premium_subscriptions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (profileResult.error) throw new Error(`profile:${compactBillingError(profileResult.error.message || profileResult.error)}`);
  if (subscriptionResult.error) throw new Error(`subscription:${compactBillingError(subscriptionResult.error.message || subscriptionResult.error)}`);
  if (!profileResult.data || profileResult.data.account_status !== "active") throw new Error("premium_account_not_active");
  return { profile: profileResult.data, subscription: subscriptionResult.data };
}

function isBusinessSubscription(subscription: any) {
  return String(subscription?.customer_segment || "").trim().toLowerCase() === "business"
    || String(subscription?.product_code || "").trim().toLowerCase() === "premium_business";
}

async function ensureStripeCustomer(admin: any, user: any, context: any) {
  if (context.subscription?.provider === "stripe" && context.subscription?.provider_customer_id) {
    return context.subscription.provider_customer_id;
  }
  const parameters = new URLSearchParams();
  parameters.set("email", String(user.email || ""));
  if (context.profile?.full_name) parameters.set("name", context.profile.full_name);
  parameters.set("metadata[user_id]", user.id);
  parameters.set("metadata[offertalogica_product]", "premium");
  const customer = await stripeRequest("/v1/customers", {
    parameters,
    idempotencyKey: `ol-customer-${user.id}`,
  });
  if (!context.subscription?.id) throw new Error("premium_subscription_missing");
  const { error } = await admin
    .from("premium_subscriptions")
    .update({ provider: "stripe", provider_customer_id: customer.id, billing_updated_at: new Date().toISOString() })
    .eq("id", context.subscription.id);
  if (error) throw new Error(`customer_store:${compactBillingError(error.message || error)}`);
  context.subscription.provider = "stripe";
  context.subscription.provider_customer_id = customer.id;
  return customer.id;
}

function periodFromStripe(subscription: any) {
  const item = subscription?.items?.data?.[0] || null;
  return {
    start: unixToIso(subscription?.current_period_start || item?.current_period_start),
    end: unixToIso(subscription?.current_period_end || item?.current_period_end),
  };
}

async function locateSubscriptionRow(admin: any, stripeSubscription: any, userIdHint = "") {
  const stripeId = String(stripeSubscription?.id || "");
  const customerId = typeof stripeSubscription?.customer === "string"
    ? stripeSubscription.customer
    : String(stripeSubscription?.customer?.id || "");
  const metadataUserId = String(stripeSubscription?.metadata?.user_id || userIdHint || "");

  const attempts: Array<[string, string]> = [];
  if (stripeId) attempts.push(["provider_subscription_id", stripeId]);
  if (metadataUserId) attempts.push(["user_id", metadataUserId]);
  if (customerId) attempts.push(["provider_customer_id", customerId]);
  for (const [column, value] of attempts) {
    const result = await admin.from("premium_subscriptions").select("*").eq(column, value).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (result.error) throw new Error(`subscription_lookup:${compactBillingError(result.error.message || result.error)}`);
    if (result.data) return result.data;
  }
  return null;
}

async function syncStripeSubscription(admin: any, stripeSubscription: any, userIdHint = "") {
  const row = await locateSubscriptionRow(admin, stripeSubscription, userIdHint);
  if (!row) throw new Error("premium_subscription_mapping_missing");
  const period = periodFromStripe(stripeSubscription);
  const customerId = typeof stripeSubscription?.customer === "string"
    ? stripeSubscription.customer
    : String(stripeSubscription?.customer?.id || "");
  const mappedStatus = stripeStatusToPremium(stripeSubscription?.status);
  const preserveTrial = shouldPreserveInternalTrial(row, stripeSubscription?.status);
  const preserveBusinessProduct = isBusinessSubscription(row);
  const update: Record<string, unknown> = {
    provider: "stripe",
    provider_customer_id: customerId || row.provider_customer_id,
    provider_subscription_id: stripeSubscription.id || row.provider_subscription_id,
    status: preserveTrial ? row.status : mappedStatus,
    plan_code: preserveTrial ? row.plan_code : "premium-casa-annual",
    included_utilities: preserveTrial ? row.included_utilities : 4,
    included_bills_per_year: preserveTrial ? row.included_bills_per_year : 60,
    current_period_start: preserveTrial ? row.current_period_start : (period.start || row.current_period_start),
    current_period_end: preserveTrial ? row.current_period_end : (period.end || row.current_period_end),
    cancel_at_period_end: Boolean(stripeSubscription?.cancel_at_period_end),
    archive_access_until: preserveTrial ? row.archive_access_until : null,
    data_purged_at: preserveTrial ? row.data_purged_at : null,
    billing_updated_at: new Date().toISOString(),
  };
  if (preserveBusinessProduct && !preserveTrial) {
    update.plan_code = row.plan_code;
    update.included_utilities = row.included_utilities;
    update.included_bills_per_year = row.included_bills_per_year;
  }
  const { data, error } = await admin
    .from("premium_subscriptions")
    .update(update)
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) throw new Error(`subscription_sync:${compactBillingError(error.message || error)}`);
  return data;
}

async function retrieveAndSyncSubscription(admin: any, subscriptionId: string, userIdHint = "") {
  if (!subscriptionId) throw new Error("stripe_subscription_id_missing");
  const stripeSubscription = await stripeRequest(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}`);
  return syncStripeSubscription(admin, stripeSubscription, userIdHint);
}

async function findOpenCheckout(admin: any, userId: string) {
  const result = await admin
    .from("premium_checkout_sessions")
    .select("provider_session_id,checkout_url,expires_at,status")
    .eq("user_id", userId)
    .eq("status", "open")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(`checkout_lookup:${compactBillingError(result.error.message || result.error)}`);
  return result.data || null;
}

async function validateStripeCommercialConfiguration({ requireCoupon = true } = {}) {
  const priceId = Deno.env.get("STRIPE_PREMIUM_ANNUAL_PRICE_ID")?.trim() || "";
  const couponId = Deno.env.get("STRIPE_PREMIUM_FIRST_YEAR_COUPON_ID")?.trim() || "";
  const price = await stripeRequest(`/v1/prices/${encodeURIComponent(priceId)}`);
  const coupon = requireCoupon
    ? await stripeRequest(`/v1/coupons/${encodeURIComponent(couponId)}`)
    : null;
  const validation = validateStripeCommercialObjects({
    price,
    coupon,
    requireCoupon,
    requireInclusiveTax: normalizeBoolean(Deno.env.get("STRIPE_AUTOMATIC_TAX_ENABLED"), false),
  });
  if (!validation.valid) throw new Error(`stripe_commercial_configuration_invalid:${validation.errors.join(",")}`);
  return { price, coupon };
}

async function createCheckout(admin: any, user: any, requestOrigin: string) {
  const configuration = billingConfigurationStatus(envObject());
  if (!configuration.enabled) throw new Error("premium_billing_not_enabled");
  const context = await accountContext(admin, user.id);
  if (!(await currentAcceptancesComplete(admin, user.id))) throw new Error("premium_legal_acceptance_required");
  if (!context.subscription?.id) throw new Error("premium_subscription_missing");
  if (isBusinessSubscription(context.subscription)) throw new Error("premium_business_billing_not_configured");
  if (context.subscription.status === "active" && context.subscription.provider_subscription_id) {
    throw new Error("premium_subscription_already_active");
  }

  const existing = await findOpenCheckout(admin, user.id);
  if (existing?.checkout_url) return { url: existing.checkout_url, reused: true };

  const origin = normalizeAppOrigin(requestOrigin, configuredOrigins()) || configuredOrigins()[0];
  if (!origin) throw new Error("premium_app_origin_invalid");
  const firstPurchase = !context.subscription.first_paid_at && !context.subscription.intro_price_redeemed_at;
  await validateStripeCommercialConfiguration({ requireCoupon: firstPurchase });
  const customerId = await ensureStripeCustomer(admin, user, context);
  const couponId = firstPurchase ? Deno.env.get("STRIPE_PREMIUM_FIRST_YEAR_COUPON_ID")?.trim() || "" : "";
  const successUrl = `${origin}/app.html?billing=success&session_id={CHECKOUT_SESSION_ID}#profile`;
  const cancelUrl = `${origin}/app.html?billing=cancel#profile`;
  const parameters = buildCheckoutParameters({
    customerId,
    userId: user.id,
    priceId: Deno.env.get("STRIPE_PREMIUM_ANNUAL_PRICE_ID")?.trim() || "",
    couponId,
    successUrl,
    cancelUrl,
    automaticTax: normalizeBoolean(Deno.env.get("STRIPE_AUTOMATIC_TAX_ENABLED"), false),
  });
  const session = await stripeRequest("/v1/checkout/sessions", {
    parameters,
    idempotencyKey: `ol-checkout-${user.id}-${context.subscription.id}-${firstPurchase ? "intro" : "standard"}-${Math.floor(Date.now() / 1_800_000)}`,
  });
  const expiresAt = unixToIso(session.expires_at) || new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { error } = await admin.from("premium_checkout_sessions").insert({
    user_id: user.id,
    provider: "stripe",
    provider_session_id: session.id,
    provider_customer_id: customerId,
    status: "open",
    checkout_url: session.url,
    expires_at: expiresAt,
  });
  if (error && String(error.code || "") !== "23505") throw new Error(`checkout_store:${compactBillingError(error.message || error)}`);
  return { url: session.url, reused: false };
}

async function createPortal(admin: any, user: any, requestOrigin: string) {
  const configuration = billingConfigurationStatus(envObject());
  if (!configuration.enabled) throw new Error("premium_billing_not_enabled");
  const context = await accountContext(admin, user.id);
  const customerId = context.subscription?.provider_customer_id;
  if (!customerId) throw new Error("premium_billing_customer_missing");
  const origin = normalizeAppOrigin(requestOrigin, configuredOrigins()) || configuredOrigins()[0];
  const parameters = new URLSearchParams();
  parameters.set("customer", customerId);
  parameters.set("return_url", `${origin}/app.html#profile`);
  const configurationId = Deno.env.get("STRIPE_BILLING_PORTAL_CONFIGURATION_ID")?.trim();
  if (configurationId) parameters.set("configuration", configurationId);
  const session = await stripeRequest("/v1/billing_portal/sessions", { parameters });
  return { url: session.url };
}

async function setCancellation(admin: any, user: any, cancelAtPeriodEnd: boolean) {
  const context = await accountContext(admin, user.id);
  const subscriptionId = context.subscription?.provider_subscription_id;
  if (!subscriptionId || context.subscription?.provider !== "stripe") throw new Error("premium_paid_subscription_missing");
  const parameters = new URLSearchParams();
  parameters.set("cancel_at_period_end", cancelAtPeriodEnd ? "true" : "false");
  parameters.set("proration_behavior", "none");
  const stripeSubscription = await stripeRequest(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, { parameters });
  const subscription = await syncStripeSubscription(admin, stripeSubscription, user.id);
  return { subscription };
}

async function beginWebhookEvent(admin: any, event: any) {
  const object = event?.data?.object || {};
  const customerId = typeof object.customer === "string" ? object.customer : object.customer?.id || null;
  const subscriptionId = event.type?.startsWith("customer.subscription.")
    ? object.id
    : extractSubscriptionIdFromInvoice(object) || (typeof object.subscription === "string" ? object.subscription : null);
  const row = {
    provider: "stripe",
    provider_event_id: event.id,
    event_type: event.type,
    status: "processing",
    provider_customer_id: customerId,
    provider_subscription_id: subscriptionId,
    payload_summary: {
      livemode: Boolean(event.livemode),
      api_version: event.api_version || null,
      object_id: object.id || null,
    },
  };
  const result = await admin.from("premium_payment_events").insert(row).select("id").single();
  if (!result.error) return { duplicate: false, inProgress: false, id: result.data.id };
  if (String(result.error.code || "") !== "23505") {
    throw new Error(`event_store:${compactBillingError(result.error.message || result.error)}`);
  }

  const existing = await admin
    .from("premium_payment_events")
    .select("id,status,received_at")
    .eq("provider", "stripe")
    .eq("provider_event_id", event.id)
    .maybeSingle();
  if (existing.error || !existing.data) {
    throw new Error(`event_lookup:${compactBillingError(existing.error?.message || existing.error || "not_found")}`);
  }
  const decision = webhookEventRetryDecision(existing.data);
  if (decision === "duplicate") return { duplicate: true, inProgress: false, id: existing.data.id };
  if (decision === "in_progress") return { duplicate: false, inProgress: true, id: existing.data.id };

  const reclaimed = await admin
    .from("premium_payment_events")
    .update({
      status: "processing",
      received_at: new Date().toISOString(),
      processed_at: null,
      error_message: "",
      event_type: event.type,
      provider_customer_id: customerId,
      provider_subscription_id: subscriptionId,
      payload_summary: row.payload_summary,
    })
    .eq("id", existing.data.id)
    .select("id")
    .single();
  if (reclaimed.error) throw new Error(`event_retry:${compactBillingError(reclaimed.error.message || reclaimed.error)}`);
  return { duplicate: false, inProgress: false, id: reclaimed.data.id };
}

async function finishWebhookEvent(admin: any, id: string, status: string, errorMessage = "") {
  if (!id) return;
  const { error } = await admin.from("premium_payment_events").update({
    status,
    processed_at: new Date().toISOString(),
    error_message: errorMessage || "",
  }).eq("id", id);
  if (error) console.error("premium-billing-event-finish", compactBillingError(error.message || error));
}

async function updateCheckoutSession(admin: any, stripeSession: any, status: string) {
  const { error } = await admin.from("premium_checkout_sessions").update({
    status,
    completed_at: status === "completed" ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("provider", "stripe").eq("provider_session_id", stripeSession.id);
  if (error) throw new Error(`checkout_update:${compactBillingError(error.message || error)}`);
}

async function processWebhookEvent(admin: any, event: any) {
  const object = event?.data?.object || {};
  switch (event.type) {
    case "checkout.session.completed": {
      await updateCheckoutSession(admin, object, "completed");
      const subscriptionId = typeof object.subscription === "string" ? object.subscription : object.subscription?.id || "";
      const userId = String(object.client_reference_id || object.metadata?.user_id || "");
      if (subscriptionId) await retrieveAndSyncSubscription(admin, subscriptionId, userId);
      return;
    }
    case "checkout.session.expired":
      await updateCheckoutSession(admin, object, "expired");
      return;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      await syncStripeSubscription(admin, object, String(object.metadata?.user_id || ""));
      return;
    case "invoice.paid": {
      const subscriptionId = extractSubscriptionIdFromInvoice(object);
      if (!subscriptionId) return;
      const synced = await retrieveAndSyncSubscription(admin, subscriptionId);
      const paymentIntentId = extractPaymentIntentId(object);
      const paidAt = unixToIso(object.status_transitions?.paid_at) || new Date().toISOString();
      const update: Record<string, unknown> = {
        latest_invoice_id: object.id || null,
        latest_payment_intent_id: paymentIntentId || null,
        latest_amount_paid_cents: Number.isFinite(Number(object.amount_paid)) ? Number(object.amount_paid) : null,
        latest_currency: String(object.currency || PREMIUM_CURRENCY).toLowerCase(),
        latest_payment_at: paidAt,
        billing_updated_at: new Date().toISOString(),
      };
      if (!synced.first_paid_at) {
        update.first_paid_at = paidAt;
        update.intro_price_redeemed_at = paidAt;
        update.first_invoice_id = object.id || null;
        update.first_payment_intent_id = paymentIntentId || null;
        update.first_amount_paid_cents = Number.isFinite(Number(object.amount_paid)) ? Number(object.amount_paid) : null;
      }
      const { error } = await admin.from("premium_subscriptions").update(update).eq("id", synced.id);
      if (error) throw new Error(`invoice_paid_store:${compactBillingError(error.message || error)}`);
      return;
    }
    case "invoice.payment_failed": {
      const subscriptionId = extractSubscriptionIdFromInvoice(object);
      if (!subscriptionId) return;
      const synced = await retrieveAndSyncSubscription(admin, subscriptionId);
      const { error } = await admin.from("premium_subscriptions").update({
        status: synced.status === "trialing" && synced.plan_code === "premium-beta" ? "trialing" : "past_due",
        latest_invoice_id: object.id || null,
        latest_payment_intent_id: extractPaymentIntentId(object) || null,
        billing_updated_at: new Date().toISOString(),
      }).eq("id", synced.id);
      if (error) throw new Error(`invoice_failed_store:${compactBillingError(error.message || error)}`);
      return;
    }
    default:
      return;
  }
}

async function handleWebhook(request: Request, admin: any, rawBody: string) {
  const signature = request.headers.get("stripe-signature") || "";
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET")?.trim() || "";
  const valid = await verifyStripeSignature({ payload: rawBody, header: signature, secret });
  if (!valid) return jsonResponse({ ok: false, error: "stripe_signature_invalid" }, 400);
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ ok: false, error: "stripe_payload_invalid" }, 400);
  }
  const stored = await beginWebhookEvent(admin, event);
  if (stored.duplicate) return jsonResponse({ ok: true, duplicate: true });
  if (stored.inProgress) return jsonResponse({ ok: false, retry: true, error: "stripe_event_processing" }, 409);
  try {
    await processWebhookEvent(admin, event);
    await finishWebhookEvent(admin, stored.id, "processed");
    return jsonResponse({ ok: true });
  } catch (error) {
    const message = compactBillingError(error);
    await finishWebhookEvent(admin, stored.id, "failed", message);
    console.error("premium-billing-webhook", event?.type, message);
    return jsonResponse({ ok: false, error: message }, 500);
  }
}

Deno.serve(async request => {
  const origin = request.headers.get("origin") || "";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() || "";
  const adminKey = resolveAdminKey();
  if (!supabaseUrl || !adminKey) return jsonResponse({ ok: false, error: "supabase_admin_configuration_missing" }, 500, origin);
  const admin = createClient(supabaseUrl, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const rawBody = await request.text();
  if (request.headers.get("stripe-signature")) return handleWebhook(request, admin, rawBody);

  const allowedOrigin = normalizeAppOrigin(origin, configuredOrigins());
  if (!allowedOrigin) return jsonResponse({ ok: false, error: "origin_not_allowed" }, 403, origin);

  let payload: Record<string, unknown> = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400, origin);
  }

  try {
    const user = await authenticatedUser(request, admin);
    const action = String(payload.action || "status");
    if (action === "status") {
      const configuration = billingConfigurationStatus(envObject());
      return jsonResponse({
        ok: true,
        provider: "stripe",
        enabled: configuration.enabled,
        missing: configuration.missing,
        first_year_amount_cents: PREMIUM_FIRST_YEAR_AMOUNT_CENTS,
        renewal_amount_cents: PREMIUM_RENEWAL_AMOUNT_CENTS,
        currency: PREMIUM_CURRENCY,
        automatic_tax_enabled: normalizeBoolean(Deno.env.get("STRIPE_AUTOMATIC_TAX_ENABLED"), false),
      }, 200, origin);
    }
    if (action === "create_checkout") {
      const result = await createCheckout(admin, user, origin);
      return jsonResponse({ ok: true, ...result }, 200, origin);
    }
    if (action === "create_portal") {
      const result = await createPortal(admin, user, origin);
      return jsonResponse({ ok: true, ...result }, 200, origin);
    }
    if (action === "set_cancel_at_period_end") {
      const result = await setCancellation(admin, user, payload.value === true);
      return jsonResponse({ ok: true, ...result }, 200, origin);
    }
    return jsonResponse({ ok: false, error: "unknown_action" }, 400, origin);
  } catch (error) {
    const message = compactBillingError(error);
    const status = message.includes("authentication") ? 401
      : message.includes("origin") ? 403
      : message.includes("not_enabled") || message.includes("missing") ? 409
      : 400;
    console.error("premium-billing-action", message);
    return jsonResponse({ ok: false, error: message }, status, origin);
  }
});
