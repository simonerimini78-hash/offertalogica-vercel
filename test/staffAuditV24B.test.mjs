import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync(
  new URL("../supabase/premium-staff-audit-v2.4B.sql", import.meta.url), "utf8"
);
const verify = fs.readFileSync(
  new URL("../supabase/premium-staff-audit-v2.4B-verify.sql", import.meta.url), "utf8"
);
const rollback = fs.readFileSync(
  new URL("../supabase/premium-staff-audit-v2.4B-rollback.sql", import.meta.url), "utf8"
);
const edge = fs.readFileSync(
  new URL("../supabase/functions/premium-staff-billing/index.ts", import.meta.url), "utf8"
);
const edgeRollback = fs.readFileSync(
  new URL("../rollback/supabase/functions/premium-staff-billing/index.ts", import.meta.url), "utf8"
);

test("V2.4B audits Premium deletions inside the deletion RPC", () => {
  assert.match(sql, /premium_staff_audit_insert/);
  assert.match(sql, /premium_records_deleted/);
  assert.match(sql, /requested_ids/);
  assert.match(sql, /deleted_count/);
  assert.match(sql, /rpc:premium_staff_delete_records/);
});

test("V2.4B preserves all supported deletion resources", () => {
  for (const resource of ["bills", "contracts", "utilities", "customers", "checks", "analysis_runs", "cost_events"]) {
    assert.match(sql, new RegExp(`v_resource = '${resource}'`));
  }
  assert.match(sql, /premium_admin_delete_required/);
  assert.match(sql, /premium_staff_account_delete_blocked/);
});

test("V2.4B records the raw real role", () => {
  assert.match(sql, /premium_staff_raw_role/);
  assert.match(sql, /v_raw_role/);
});

test("V2.4B Stripe audit uses authenticated server identity", () => {
  assert.match(edge, /return \{ user: data\.user, staff: \{ \.\.\.staff, role \} \}/);
  assert.match(edge, /premium_staff_audit_insert/);
  assert.match(edge, /p_staff_user_id: identity\.user\.id/);
  assert.match(edge, /p_staff_role: identity\.staff\.role/);
});

test("V2.4B Stripe has request, success and failure events", () => {
  assert.match(edge, /stripe_subscription_sync_requested/);
  assert.match(edge, /stripe_subscription_synced/);
  assert.match(edge, /stripe_subscription_sync_failed/);
  assert.match(edge, /result: "error"/);
});

test("V2.4B Stripe audit contains only billing snapshots, not tokens/passwords", () => {
  assert.match(edge, /before: result\.before/);
  assert.match(edge, /after: result\.after/);
  assert.doesNotMatch(edge, /p_metadata:[\s\S]{0,300}(password|access_token|refresh_token)/i);
});

test("V2.4B SQL verify is non-destructive", () => {
  assert.doesNotMatch(verify, /\bdelete\s+from\b/i);
  assert.doesNotMatch(verify, /\bupdate\s+public\./i);
  assert.doesNotMatch(verify, /\binsert\s+into\b/i);
});

test("V2.4B SQL rollback removes audit hook but preserves original deletion behavior", () => {
  assert.doesNotMatch(rollback, /premium_staff_audit_insert/);
  for (const resource of ["bills", "contracts", "utilities", "customers", "checks", "analysis_runs", "cost_events"]) {
    assert.match(rollback, new RegExp(`v_resource = '${resource}'`));
  }
});

test("V2.4B Edge rollback restores pre-audit billing function", () => {
  assert.doesNotMatch(edgeRollback, /premium_staff_audit_insert/);
  assert.doesNotMatch(edgeRollback, /stripe_subscription_sync_requested/);
  assert.match(edgeRollback, /await authenticatedAdmin\(request, admin\)/);
  assert.match(edgeRollback, /const result = await syncSubscription\(admin, userId\)/);
});
