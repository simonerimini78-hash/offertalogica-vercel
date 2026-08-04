import { createClient } from "npm:@supabase/supabase-js@2";
import {
  constantTimeStringEqual,
  normalizeCleanupLimit,
  runPremiumTrialCleanup,
} from "../_shared/premium-trial-cleanup-core.mjs";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function resolveAdminKey() {
  const legacyServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (legacyServiceRole) return legacyServiceRole;

  const rawSecretKeys = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
  if (!rawSecretKeys) return "";
  try {
    const parsed = JSON.parse(rawSecretKeys);
    if (typeof parsed?.default === "string" && parsed.default.trim()) return parsed.default.trim();
    const firstKey = Object.values(parsed || {}).find((value) => typeof value === "string" && value.trim());
    return typeof firstKey === "string" ? firstKey.trim() : "";
  } catch {
    return "";
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);

  const expectedSecret = Deno.env.get("PREMIUM_CLEANUP_CRON_SECRET")?.trim() || "";
  const suppliedSecret = request.headers.get("x-offertalogica-cron-secret")?.trim() || "";
  if (!expectedSecret || !constantTimeStringEqual(expectedSecret, suppliedSecret)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() || "";
  const adminKey = resolveAdminKey();
  if (!supabaseUrl || !adminKey) {
    return jsonResponse({ ok: false, error: "supabase_admin_configuration_missing" }, 500);
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const dryRun = payload.dry_run === true;
  const limit = normalizeCleanupLimit(payload.limit);
  const source = dryRun ? "manual_dry_run" : "cron";
  const admin = createClient(supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const result = await runPremiumTrialCleanup({ admin, dryRun, limit, source });
    return jsonResponse(result, result.ok ? 200 : 500);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "cleanup_failed");
    console.error("premium-trial-cleanup", message);
    return jsonResponse({ ok: false, error: message.slice(0, 500) }, 500);
  }
});
