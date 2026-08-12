import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync(new URL("../supabase/premium-staff-permissions-enforcement-v2.8C1.sql", import.meta.url), "utf8");
const verify = fs.readFileSync(new URL("../supabase/premium-staff-permissions-enforcement-v2.8C1-verify.sql", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../supabase/premium-staff-permissions-enforcement-v2.8C1-rollback.sql", import.meta.url), "utf8");
const executableSql = sql.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");

const checkRpcs = [
  "premium_staff_claim_check",
  "premium_staff_set_check_status",
  "premium_staff_add_check_note",
  "premium_staff_add_anomaly",
  "premium_staff_delete_anomaly",
  "premium_staff_complete_check",
  "premium_staff_validate_analysis",
];

test("C1 is pinned to the exact verified V2.8B1 base", () => {
  assert.match(sql, /906d01d0bd60ccaeab30b836bd7914fd49e1fce4/);
});

test("all check mutations are gated by manage_checks", () => {
  for (const name of checkRpcs) {
    assert.match(sql, new RegExp(`create or replace function public\\.${name}`));
  }
  const count = (sql.match(/premium_staff_permission_allowed\('manage_checks'\)/g) || []).length;
  assert.equal(count, checkRpcs.length);
});

test("destructive RPCs are gated by delete_records", () => {
  assert.match(sql, /create or replace function public\.premium_staff_delete_records/);
  assert.match(sql, /create or replace function public\.premium_staff_complete_account_deletion/);
  assert.equal((sql.match(/premium_staff_permission_allowed\('delete_records'\)/g) || []).length, 2);
});

test("legacy implementations are preserved but not executable by browser roles", () => {
  for (const name of [...checkRpcs, "premium_staff_delete_records", "premium_staff_complete_account_deletion"]) {
    assert.match(sql, new RegExp(`${name}_v28c1_legacy`));
  }
  assert.match(sql, /revoke all on function public\.premium_staff_claim_check_v28c1_legacy\(uuid\)[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(sql, /revoke all on function public\.premium_staff_delete_records_v28c1_legacy\(text,uuid\[\]\)[\s\S]*from public, anon, authenticated, service_role/);
});

test("direct writes to notes anomalies and field reviews are removed", () => {
  for (const table of ["premium_check_notes", "premium_anomalies", "premium_analysis_field_reviews"]) {
    assert.match(sql, new RegExp(`revoke insert, update, delete on table public\\.${table} from authenticated`));
  }
});

test("read compatibility policies remain present", () => {
  assert.match(sql, /create policy premium_check_notes_staff_select/);
  assert.match(sql, /create policy premium_anomalies_staff_select/);
  assert.match(sql, /create policy premium_analysis_field_reviews_staff_select/);
});

test("C1 does not touch Stripe lead analytics frontend or Premium app", () => {
  assert.doesNotMatch(executableSql, /stripe|lead_events|lead_records|staff-leads|staff-analytics|public\/staff\.js|public\/app\.html/i);
});

test("verifier checks wrappers legacy revokes and direct-write closure", () => {
  assert.match(verify, /wrappers_call_permission_engine/);
  assert.match(verify, /authenticated_cannot_execute_legacy/);
  assert.match(verify, /notes_direct_write_blocked/);
  assert.match(verify, /legacy_staff_all_write_policies_removed/);
});

test("rollback restores original function names and write policies", () => {
  assert.match(rollback, /rename to premium_staff_claim_check/);
  assert.match(rollback, /rename to premium_staff_delete_records/);
  assert.match(rollback, /create policy premium_check_notes_staff_all/);
  assert.match(rollback, /create policy premium_anomalies_staff_all/);
  assert.match(rollback, /create policy premium_analysis_field_reviews_staff_all/);
});

test("migration is transactional", () => {
  assert.match(sql.trim(), /^--[\s\S]*\nbegin;/);
  assert.match(sql.trim(), /commit;$/);
});
