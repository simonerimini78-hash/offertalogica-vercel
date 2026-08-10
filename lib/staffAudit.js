import { premiumAiConfig } from "./premiumAiBackend.js";

function isLegacyJwtKey(value) {
  return String(value || "").split(".").length === 3;
}

function cleanText(value, max = 500) {
  return String(value ?? "")
    .replace(/[\\r\\n\\t]+/g, " ")
    .replace(/\\s+/g, " ")
    .trim()
    .slice(0, max);
}

function serviceHeaders(serviceKey) {
  const headers = {
    apikey: serviceKey,
    "Content-Type": "application/json",
  };
  if (isLegacyJwtKey(serviceKey)) headers.Authorization = `Bearer ${serviceKey}`;
  return headers;
}

export async function writeStaffAudit(
  {
    identity,
    action,
    targetType,
    targetId = null,
    result = "success",
    reason = "",
    metadata = {},
    source = "api",
  } = {},
  { fetchImpl = fetch, env = process.env } = {},
) {
  const staffUserId = String(identity?.user?.id || "").trim();
  const staffRole = String(identity?.staff?.role || "").trim().toLowerCase();
  if (!staffUserId || !staffRole) throw new Error("staff_audit_identity_required");

  const config = premiumAiConfig(env);
  if (!config.supabaseUrl || !config.serviceKey) {
    throw new Error("staff_audit_supabase_not_configured");
  }

  const response = await fetchImpl(
    `${config.supabaseUrl}/rest/v1/rpc/premium_staff_audit_insert`,
    {
      method: "POST",
      headers: serviceHeaders(config.serviceKey),
      body: JSON.stringify({
        p_staff_user_id: staffUserId,
        p_staff_role: staffRole,
        p_action: cleanText(action, 120),
        p_target_type: cleanText(targetType, 80),
        p_target_id: targetId == null ? null : cleanText(targetId, 200),
        p_result: cleanText(result, 20) || "success",
        p_reason: cleanText(reason, 500),
        p_metadata: metadata && typeof metadata === "object" ? metadata : {},
        p_source: cleanText(source, 120) || "api",
      }),
    },
  );

  if (!response.ok) {
    const detail = cleanText(await response.text().catch(() => ""), 280);
    throw new Error(
      `staff_audit_write_failed:${response.status}${detail ? `:${detail}` : ""}`,
    );
  }

  return { ok: true };
}
