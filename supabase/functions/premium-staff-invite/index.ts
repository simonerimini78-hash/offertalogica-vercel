import { createClient } from "npm:@supabase/supabase-js@2";

const STAFF_ROLES = new Set(["admin", "technician"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resolveAdminKey() {
  const directSecret = Deno.env.get("SUPABASE_SECRET_KEY")?.trim();
  if (directSecret) return directSecret;
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
    headers: { ...corsHeaders(), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function compactError(error: unknown) {
  return String((error as { message?: unknown })?.message || error || "operation_failed")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 280);
}

function allowedRedirectOrigin(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return "";
    const host = url.hostname.toLowerCase();
    const offertaLogica = host === "offertalogica.it" || host.endsWith(".offertalogica.it");
    const vercelPreview = host.endsWith(".vercel.app") && host.includes("offertalogica-vercel");
    return offertaLogica || vercelPreview ? url.origin : "";
  } catch {
    return "";
  }
}

async function authenticatedOwner(request: Request, admin: any) {
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
  if (String(staff.role || "").toLowerCase() !== "owner") throw new Error("premium_owner_required");
  return data.user;
}

async function findAuthUserByEmail(admin: any, email: string) {
  const perPage = 1000;
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`premium_staff_auth_list_failed:${compactError(error)}`);
    const users = Array.isArray(data?.users) ? data.users : [];
    const match = users.find((user: any) => String(user?.email || "").trim().toLowerCase() === email);
    if (match) return match;
    if (users.length < perPage) return null;
  }
  throw new Error("premium_staff_auth_directory_limit");
}

async function inviteStaff(admin: any, inviter: any, payload: Record<string, unknown>) {
  const email = String(payload.email || "").trim().toLowerCase();
  const role = String(payload.role || "technician").trim().toLowerCase();
  const origin = allowedRedirectOrigin(payload.redirect_origin);
  if (!EMAIL_RE.test(email)) throw new Error("premium_staff_email_invalid");
  if (!STAFF_ROLES.has(role)) throw new Error("premium_staff_role_invalid");
  if (!origin) throw new Error("premium_staff_invite_redirect_invalid");

  const existing = await findAuthUserByEmail(admin, email);
  if (existing) throw new Error("premium_staff_auth_user_exists");

  const redirectTo = `${origin}/staff-activate.html`;
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {
      offertalogica_product: "staff",
      offertalogica_staff_role: role,
      invited_by: inviter.id,
    },
  });
  if (error || !data?.user?.id) throw new Error(`premium_staff_invite_failed:${compactError(error || "missing_user")}`);

  const invitedUserId = data.user.id;
  const { error: staffError } = await admin.from("premium_staff_members").insert({
    user_id: invitedUserId,
    role,
    active: true,
  });
  if (staffError) {
    await admin.auth.admin.deleteUser(invitedUserId).catch(() => {});
    throw new Error(`premium_staff_membership_create_failed:${compactError(staffError)}`);
  }

  return { user_id: invitedUserId, email, role, redirect_to: redirectTo };
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() || "";
  const adminKey = resolveAdminKey();
  if (!supabaseUrl || !adminKey) return jsonResponse({ ok: false, error: "supabase_admin_configuration_missing" }, 500);
  const admin = createClient(supabaseUrl, adminKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  let payload: Record<string, unknown> = {};
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400);
  }

  try {
    const owner = await authenticatedOwner(request, admin);
    const action = String(payload.action || "");
    if (action !== "invite") return jsonResponse({ ok: false, error: "unknown_action" }, 400);
    const result = await inviteStaff(admin, owner, payload);
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    const message = compactError(error);
    const status = message.includes("authentication") ? 401
      : message.includes("premium_staff_required") || message.includes("premium_owner_required") ? 403
      : message.includes("premium_staff_auth_user_exists") ? 409
      : message.includes("premium_staff_email_invalid") || message.includes("premium_staff_role_invalid") || message.includes("premium_staff_invite_redirect_invalid") ? 400
      : message.includes("configuration_missing") ? 500
      : 409;
    console.error("premium-staff-invite", message);
    return jsonResponse({ ok: false, error: message }, status);
  }
});
