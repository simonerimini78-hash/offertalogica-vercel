import { createClient } from "npm:@supabase/supabase-js@2";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-max-age": "86400",
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function compactError(error: unknown) {
  return String((error as { message?: unknown })?.message || error || "operation_failed")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 280);
}

function stripeStatusToPremium(status: unknown) {
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
    default:
      return "pending";
  }
}

function unixToIso(value: unknown) {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function periodFromStripe(subscription: any) {
  const item = subscription?.items?.data?.[0] || null;
  return {
    start: unixToIso(subscription?.current_period_start || item?.current_period_start),
    end: unixToIso(subscription?.current_period_end || item?.current_period_end),
  };
}

function preserveInternalTrial(row: any, stripeStatus: unknown) {
  if (row?.status !== "trialing" || row?.plan_code !== "premium-beta") return false;
  const end = new Date(row?.current_period_end || 0).getTime();
  if (!Number.isFinite(end) || end <= Date.now()) return false;
  return stripeStatusToPremium(stripeStatus) !== "active";
}

function snapshot(row: any) {
  return {
    id: row?.id || null,
    user_id: row?.user_id || null,
    status: row?.status || null,
    plan_code: row?.plan_code || null,
    provider: row?.provider || null,
    provider_customer_id: row?.provider_customer_id || null,
    provider_subscription_id: row?.provider_subscription_id || null,
    current_period_start: row?.current_period_start || null,
    current_period_end: row?.current_period_end || null,
    cancel_at_period_end: Boolean(row?.cancel_at_period_end),
    billing_updated_at: row?.billing_updated_at || null,
  };
}

async function authenticatedAdmin(request: Request, admin: any) {
  const header = request.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("authentication_required");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user?.id) throw new Error("authentication_invalid");

  const { data: staff, error: staffError } = await admin
    .from("premium_staff_members")
    .select("user_id,role,active")
    .eq("user_id", data.user.id)
    .eq("active", true)
    .maybeSingle();
  if (staffError) throw new Error(`premium_staff_lookup:${compactError(staffError)}`);
  if (!staff) throw new Error("premium_staff_required");
  if (staff.role !== "admin") throw new Error("premium_admin_required");
  return data.user;
}

async function getStripeSubscription(subscriptionId: string) {
  const secretKey = Deno.env.get("STRIPE_SECRET_KEY")?.trim() || "";
  if (!secretKey) throw new Error("stripe_secret_key_missing");
  const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "GET",
    headers: { authorization: `Bearer ${secretKey}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.code || payload?.error?.message || `http_${response.status}`;
    throw new Error(`stripe_read_failed:${compactError(detail)}`);
  }
  return payload;
}

async function syncSubscription(admin: any, userId: string) {
  const { data: row, error } = await admin
    .from("premium_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`premium_subscription_lookup:${compactError(error)}`);
  if (!row) throw new Error("premium_subscription_missing");
  if (row.provider !== "stripe" || !row.provider_subscription_id) throw new Error("stripe_subscription_not_linked");

  const stripeSubscription = await getStripeSubscription(String(row.provider_subscription_id));
  if (String(stripeSubscription?.id || "") !== String(row.provider_subscription_id)) {
    throw new Error("stripe_subscription_mismatch");
  }

  const stripeCustomerId = typeof stripeSubscription?.customer === "string"
    ? stripeSubscription.customer
    : String(stripeSubscription?.customer?.id || "");
  if (row.provider_customer_id && stripeCustomerId && String(row.provider_customer_id) !== stripeCustomerId) {
    throw new Error("stripe_customer_mismatch");
  }

  const stripeUserId = String(stripeSubscription?.metadata?.user_id || "");
  if (stripeUserId && stripeUserId !== userId) throw new Error("stripe_user_mismatch");

  const preserveTrial = preserveInternalTrial(row, stripeSubscription?.status);
  const period = periodFromStripe(stripeSubscription);
  const update = {
    provider: "stripe",
    provider_customer_id: stripeCustomerId || row.provider_customer_id,
    provider_subscription_id: String(stripeSubscription.id),
    status: preserveTrial ? row.status : stripeStatusToPremium(stripeSubscription?.status),
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

  const { data: updated, error: updateError } = await admin
    .from("premium_subscriptions")
    .update(update)
    .eq("id", row.id)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (updateError) throw new Error(`premium_subscription_sync:${compactError(updateError)}`);

  const before = snapshot(row);
  const after = snapshot(updated);
  const changed = before.status !== after.status
    || before.plan_code !== after.plan_code
    || before.current_period_start !== after.current_period_start
    || before.current_period_end !== after.current_period_end
    || before.cancel_at_period_end !== after.cancel_at_period_end
    || before.provider_customer_id !== after.provider_customer_id
    || before.provider_subscription_id !== after.provider_subscription_id;

  return {
    before: snapshot(row),
    after: snapshot(updated),
    changed,
    stripe_status: String(stripeSubscription?.status || ""),
    source: "stripe_read_only",
  };
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() || "";
  const adminKey = resolveAdminKey();
  if (!supabaseUrl || !adminKey) return jsonResponse({ ok: false, error: "supabase_admin_configuration_missing" }, 500);
  const admin = createClient(supabaseUrl, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let payload: Record<string, unknown> = {};
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400);
  }

  try {
    await authenticatedAdmin(request, admin);
    const action = String(payload.action || "");
    if (action !== "sync_subscription") return jsonResponse({ ok: false, error: "unknown_action" }, 400);
    const userId = String(payload.user_id || "").trim();
    if (!UUID_RE.test(userId)) return jsonResponse({ ok: false, error: "invalid_user_id" }, 400);
    const result = await syncSubscription(admin, userId);
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    const message = compactError(error);
    const status = message.includes("authentication") ? 401
      : message.includes("premium_staff_required") || message.includes("premium_admin_required") ? 403
      : message.includes("premium_subscription_missing") ? 404
      : message.includes("stripe_read_failed") ? 502
      : message.includes("configuration_missing") || message.includes("secret_key_missing") ? 500
      : 409;
    console.error("premium-staff-billing", message);
    return jsonResponse({ ok: false, error: message }, status);
  }
});
