import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  new URL("../supabase/premium-staff-permissions-v2.8A.sql", import.meta.url),
  "utf8"
);
const verify = fs.readFileSync(
  new URL("../supabase/premium-staff-permissions-v2.8A-verify.sql", import.meta.url),
  "utf8"
);
const rollback = fs.readFileSync(
  new URL("../supabase/premium-staff-permissions-v2.8A-rollback.sql", import.meta.url),
  "utf8"
);

test("V2.8A is additive and does not replace operational Staff functions", () => {
  for (const name of [
    "premium_staff_claim_check",
    "premium_staff_set_check_status",
    "premium_staff_add_check_note",
    "premium_staff_add_anomaly",
    "premium_staff_delete_anomaly",
    "premium_staff_complete_check",
    "premium_staff_validate_analysis",
    "premium_staff_delete_records",
    "premium_owner_add_staff",
    "premium_owner_update_staff",
    "premium_admin_set_complimentary",
    "premium_admin_revoke_complimentary",
  ]) {
    assert.doesNotMatch(
      migration,
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, "i"),
      `V2.8A must not replace ${name}`,
    );
  }
});

test("Owner is structurally always full", () => {
  assert.match(migration, /if v_role = 'owner' then\s+return true;/);
  assert.match(migration, /when staff\.role = 'owner' then true/);
  assert.match(migration, /premium_owner_protected/);
});

test("Admin is default-deny and only explicit configurable permissions can be granted", () => {
  assert.match(migration, /Admin e' intenzionalmente default-deny/);
  assert.match(migration, /if v_role = 'admin' then\s+return false;/);
  assert.match(migration, /premium_staff_permission_admin_configurable/);
  assert.match(migration, /premium_staff_permissions/);
});

test("Technician profile is fixed to checks, check management and PDF diagnostics", () => {
  for (const key of ["view_checks", "manage_checks", "view_pdf_diagnostics"]) {
    assert.match(migration, new RegExp(`\\('${key}'[\\s\\S]*?true`));
  }
  assert.match(migration, /premium_staff_permission_technician_fixed/);
});

test("Technician cannot receive matrix overrides", () => {
  assert.match(migration, /v_target_role in \('technician', 'reviewer'\)/);
  assert.match(migration, /premium_staff_permission_technician_fixed/);
});

test("Premium omaggio remains V2.5A-governed", () => {
  assert.match(migration, /\('manage_complimentary'[\s\S]*?'v2\.5A'\)/);
  assert.match(migration, /premium_staff_can_manage_complimentary\(\)/);
  assert.match(migration, /premium_staff_permission_dedicated_governance/);
  assert.doesNotMatch(migration, /create table if not exists public\.premium_staff_complimentary_permissions/i);
});

test("Owner-only surfaces are never Admin-configurable", () => {
  for (const key of [
    "view_audit",
    "manage_collaborators",
    "manage_staff_permissions",
    "view_owner_dashboard",
    "view_owner_lab",
  ]) {
    const row = migration.match(new RegExp(`\\('${key}'[^\\n]+\\)`));
    assert.ok(row, `catalog row missing for ${key}`);
    assert.match(row[0], /false,\s*false,\s*true/);
  }
});

test("permission mutations require a reason and are audited", () => {
  assert.match(migration, /premium_staff_permission_reason_required/);
  assert.match(migration, /premium_staff_audit_insert/);
  assert.match(migration, /staff_permission_granted/);
  assert.match(migration, /staff_permission_revoked/);
});

test("authenticated has no direct table access", () => {
  assert.match(
    migration,
    /revoke all on table public\.premium_staff_permissions\s+from public, anon, authenticated/i,
  );
  assert.doesNotMatch(
    migration,
    /grant\s+(select|insert|update|delete)[\s\S]{0,100}premium_staff_permissions[\s\S]{0,100}authenticated/i,
  );
});

test("verification is transactional and checks exact role policy", () => {
  assert.match(verify, /\bbegin\s*;/i);
  assert.match(verify, /\brollback\s*;\s*$/i);
  assert.match(verify, /admin_default_deny_all/);
  assert.match(verify, /technician_exact_three_fixed/);
  assert.match(verify, /owner_effective_all_true/);
});

test("rollback is scoped to V2.8A only", () => {
  assert.match(rollback, /premium_staff_permissions/);
  assert.doesNotMatch(rollback, /premium_staff_complimentary_permissions/);
  assert.doesNotMatch(rollback, /premium_staff_members/);
  assert.doesNotMatch(rollback, /premium_staff_audit_events/);
  assert.doesNotMatch(rollback, /premium_check_timeline_events/);
});
