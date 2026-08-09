import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  new URL("../supabase/premium-staff-audit-v2.4A.sql", import.meta.url), "utf8"
);
const verify = fs.readFileSync(
  new URL("../supabase/premium-staff-audit-v2.4A-verify.sql", import.meta.url), "utf8"
);
const rollback = fs.readFileSync(
  new URL("../supabase/premium-staff-audit-v2.4A-rollback.sql", import.meta.url), "utf8"
);

test("V2.4A creates audit table with governance fields", () => {
  assert.match(migration, /create table if not exists public\.premium_staff_audit_events/i);
  for (const field of [
    "staff_user_id", "staff_email", "staff_role", "action", "target_type",
    "target_id", "result", "reason", "metadata", "source", "created_at"
  ]) assert.match(migration, new RegExp(`\\b${field}\\b`, "i"));
});

test("V2.4A denies direct authenticated access and writer execution", () => {
  assert.match(migration, /revoke all on table public\.premium_staff_audit_events from public, anon, authenticated/i);
  assert.match(migration, /revoke all on function public\.premium_staff_audit_insert[\s\S]*from public, anon, authenticated/i);
  assert.match(verify, /authenticated_can_select/);
  assert.match(verify, /authenticated_can_call_writer/);
});

test("V2.4A audit reader requires exact Owner role", () => {
  assert.match(migration, /create or replace function public\.premium_owner_list_audit/i);
  assert.match(migration, /premium_staff_raw_role\(\), ''\) <> 'owner'/i);
});

test("V2.4A preserves B2.1 dynamic upsert and audits add/upsert", () => {
  assert.match(migration, /execute \$upsert\$[\s\S]*on conflict \(user_id\) do update[\s\S]*\$upsert\$[\s\S]*using v_user_id, v_role/i);
  assert.match(migration, /rpc:premium_owner_add_staff/);
  assert.match(migration, /staff_member_added_existing_auth/);
  assert.match(migration, /premium_owner_protected/);
});

test("V2.4A audits role and access changes", () => {
  assert.match(migration, /rpc:premium_owner_update_staff/);
  assert.match(migration, /staff_role_changed/);
  assert.match(migration, /staff_access_deactivated/);
  assert.match(migration, /staff_access_reactivated/);
});

test("V2.4A verify is transactional", () => {
  assert.match(verify, /\bbegin;/i);
  assert.match(verify, /audit_verify/);
  assert.match(verify, /\brollback;/i);
});

test("V2.4A rollback restores B2.1/B1 and removes audit objects", () => {
  assert.match(rollback, /execute \$upsert\$[\s\S]*using v_user_id, v_role/i);
  assert.doesNotMatch(rollback, /perform public\.premium_staff_audit_insert/i);
  assert.match(rollback, /drop function if exists public\.premium_owner_list_audit/);
  assert.match(rollback, /drop function if exists public\.premium_staff_audit_insert/);
  assert.match(rollback, /drop table if exists public\.premium_staff_audit_events/);
  assert.doesNotMatch(rollback, /\bdelete\s+from\s+public\.premium_staff_members\b/i);
});

test("V2.4A contains no mutation statements for customer/commercial tables", () => {
  const stripped = migration.replace(/--.*$/gm, "");
  const forbiddenMutations = [
    /\b(insert\s+into|update|delete\s+from)\s+public\.premium_subscriptions\b/i,
    /\b(insert\s+into|update|delete\s+from)\s+public\.premium_bills\b/i,
    /\b(insert\s+into|update|delete\s+from)\s+public\.premium_checks\b/i,
    /\b(insert\s+into|update|delete\s+from)\s+public\.premium_complimentary_events\b/i,
    /\b(insert\s+into|update|delete\s+from)\s+public\.lead_/i,
  ];
  for (const pattern of forbiddenMutations) assert.doesNotMatch(stripped, pattern);
});
