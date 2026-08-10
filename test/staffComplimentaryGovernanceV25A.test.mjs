import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  new URL("../supabase/premium-staff-complimentary-governance-v2.5A.sql", import.meta.url),
  "utf8"
);
const verify = fs.readFileSync(
  new URL("../supabase/premium-staff-complimentary-governance-v2.5A-verify.sql", import.meta.url),
  "utf8"
);
const rollback = fs.readFileSync(
  new URL("../supabase/premium-staff-complimentary-governance-v2.5A-rollback.sql", import.meta.url),
  "utf8"
);

test("V2.5A preserves v0.36.13 through internal rename instead of rewriting engine", () => {
  assert.match(migration, /rename to premium_internal_set_complimentary_v03613/i);
  assert.match(migration, /rename to premium_internal_revoke_complimentary_v03613/i);
  assert.match(migration, /premium_internal_set_complimentary_v03613\(/);
  assert.match(migration, /premium_internal_revoke_complimentary_v03613\(/);
});

test("Owner is always allowed and Admin requires explicit permission", () => {
  assert.match(migration, /if v_role = 'owner' then\s+return true/i);
  assert.match(migration, /if v_role <> 'admin' then\s+return false/i);
  assert.match(migration, /premium_staff_complimentary_permissions/);
  assert.match(migration, /permission_record\.allowed = true/);
});

test("Owner permission writer can target only active Admin", () => {
  assert.match(migration, /premium_owner_set_complimentary_permission/);
  assert.match(migration, /premium_staff_raw_role\(\), ''\) <> 'owner'/i);
  assert.match(migration, /v_target_role <> 'admin'/);
  assert.match(migration, /premium_complimentary_permission_admin_only/);
  assert.match(migration, /premium_owner_protected/);
});

test("Technician and legacy lower roles cannot manage complimentary", () => {
  assert.match(migration, /if v_role <> 'admin' then\s+return false/i);
  assert.doesNotMatch(migration, /v_role in \('technician'/i);
});

test("Unlimited complimentary is Owner-only", () => {
  assert.match(migration, /v_duration_code = 'unlimited' and v_role <> 'owner'/i);
  assert.match(migration, /premium_complimentary_unlimited_owner_only/);
});

test("Reason is mandatory for grant/extend and revoke", () => {
  const occurrences = migration.match(/premium_complimentary_reason_required/g) || [];
  assert.equal(occurrences.length, 2);
});

test("Successful grant/revoke and permission changes are audited", () => {
  assert.match(migration, /complimentary_granted/);
  assert.match(migration, /complimentary_extended/);
  assert.match(migration, /complimentary_revoked/);
  assert.match(migration, /complimentary_admin_permission_granted/);
  assert.match(migration, /complimentary_admin_permission_revoked/);
  assert.ok((migration.match(/premium_staff_audit_insert/g) || []).length >= 3);
});

test("Internal v0.36.13 engines are not executable from authenticated", () => {
  assert.match(migration, /revoke all on function public\.premium_internal_set_complimentary_v03613[\s\S]*authenticated, service_role/i);
  assert.match(migration, /revoke all on function public\.premium_internal_revoke_complimentary_v03613[\s\S]*authenticated, service_role/i);
});

test("Verify is non-destructive", () => {
  assert.doesNotMatch(verify, /\b(insert\s+into|update|delete\s+from)\b/i);
  assert.match(verify, /\bbegin;/i);
  assert.match(verify, /\brollback;/i);
});

test("Rollback restores original RPC names and does not touch Premium data", () => {
  assert.match(rollback, /rename to premium_admin_set_complimentary/i);
  assert.match(rollback, /rename to premium_admin_revoke_complimentary/i);
  assert.doesNotMatch(rollback, /\b(delete\s+from|update)\s+public\.premium_subscriptions\b/i);
  assert.doesNotMatch(rollback, /\bdelete\s+from\s+public\.premium_complimentary_events\b/i);
});
