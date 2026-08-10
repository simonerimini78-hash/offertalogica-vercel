import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../public/staff-governance-v2.5B.js", import.meta.url),
  "utf8"
);

const marker = "// Staff v2.6B — Dashboard Owner.";
const start = source.indexOf(marker);
const end = source.indexOf("  function init() {", start);
assert.ok(start >= 0, "marker V2.6B missing");
assert.ok(end > start, "V2.6B section boundary missing");
const v26b = source.slice(start, end);

test("V2.6B calls only the authoritative Owner dashboard RPC", () => {
  assert.match(v26b, /rpc\("premium_owner_dashboard_metrics"\)/);
  assert.doesNotMatch(v26b, /\.from\(/);
  assert.doesNotMatch(v26b, /\/api\//);
});

test("V2.6B is visually gated to the raw Owner role", () => {
  assert.match(v26b, /currentRole === "owner"/);
  assert.match(v26b, /currentRole !== "owner"/);
  assert.match(v26b, /button\.hidden = !visible/);
});

test("Owner tab deliberately avoids staff.js VALID_TABS routing", () => {
  assert.match(v26b, /button\.id = "staffOwnerDashboardTab"/);
  assert.doesNotMatch(v26b, /button\.dataset\.staffTab/);
  assert.doesNotMatch(v26b, /button\.setAttribute\("data-staff-tab"/);
  assert.match(v26b, /document\.querySelectorAll\("\[data-staff-tab\]"\)/);
});

test("Dashboard is read-only and contains no destructive calls", () => {
  for (const forbidden of [
    "premium_admin_set_complimentary",
    "premium_admin_revoke_complimentary",
    "premium_owner_set_complimentary_permission",
    "premium_staff_delete_records",
  ]) {
    assert.ok(!v26b.includes(forbidden), `forbidden operation in V2.6B: ${forbidden}`);
  }
});

test("All V2.6A metric groups are rendered", () => {
  for (const group of [
    "metrics?.customers",
    "metrics?.subscriptions",
    "metrics?.operations",
    "metrics?.costs",
    "metrics?.staff",
    "metrics?.governance",
  ]) {
    assert.ok(v26b.includes(group), `missing group ${group}`);
  }
  for (const metric of [
    "paid_active",
    "trial_active",
    "complimentary_active",
    "checks_open",
    "anomalies_open",
    "support_unread_messages",
    "ai_estimated_cost_eur_30d",
    "recorded_cost_eur_30d",
    "admins_complimentary_authorized",
    "audit_errors_30d",
  ]) {
    assert.ok(v26b.includes(metric), `missing metric ${metric}`);
  }
});

test("No unsupported income metric is read or rendered", () => {
  for (const forbidden of [
    "metrics?.revenue",
    "metrics?.mrr",
    "metrics?.arr",
    "ownerRevenue",
    "ownerMrr",
    "ownerArr",
  ]) {
    assert.ok(!v26b.includes(forbidden), `unsupported income metric found: ${forbidden}`);
  }
  assert.match(v26b, /non ricostruisce fatturato, MRR o valore degli omaggi/);
});

test("Dashboard refreshes from the existing Staff refresh control", () => {
  assert.match(v26b, /byId\("staffRefresh"\)\?\.addEventListener/);
  assert.match(v26b, /loadOwnerDashboard\(\{ silent: true \}\)/);
});

test("Dashboard closes when standard Staff navigation takes over", () => {
  assert.match(v26b, /tab\.addEventListener\("click", \(\) => closeOwnerDashboard\(\)\)/);
  assert.match(v26b, /window\.addEventListener\("hashchange", \(\) => closeOwnerDashboard\(\)\)/);
});

test("V2.5B governance engine remains present", () => {
  for (const existing of [
    "premium_staff_can_manage_complimentary",
    "premium_owner_list_complimentary_permissions",
    "premium_owner_set_complimentary_permission",
    "applyCustomerButtonPolicy",
    "applyDurationPolicy",
  ]) {
    assert.ok(source.includes(existing), `existing V2.5B contract missing: ${existing}`);
  }
});
