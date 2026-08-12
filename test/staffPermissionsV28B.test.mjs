import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../public/staff-governance-v2.5B.js", import.meta.url), "utf8");
const marker = "// Staff v2.8B — matrice permessi nel Control Center.";
const start = source.indexOf(marker);
const end = source.lastIndexOf("})();");
assert.ok(start >= 0 && end > start, "V2.8B section missing");
const v28b = source.slice(start, end);

test("V2.8B consumes only V2.8A authoritative permission RPCs", () => {
  assert.match(v28b, /rpc\("premium_staff_effective_permissions"\)/);
  assert.match(v28b, /rpc\("premium_owner_list_staff_permission_matrix"\)/);
  assert.match(v28b, /rpc\("premium_owner_set_staff_permission"/);
  assert.doesNotMatch(v28b, /\.from\(/);
  assert.doesNotMatch(v28b, /\/api\//);
});

test("all standard Control Center tabs map to explicit permission keys", () => {
  const expected = {
    overview: "view_control",
    cases: "view_cases",
    customers: "view_customers",
    checks: "view_checks",
    leads: "view_leads",
    analytics: "view_analytics",
    collaborators: "manage_collaborators",
    pdf: "view_pdf_diagnostics",
    costs: "view_ai_costs",
  };
  for (const [tab, permission] of Object.entries(expected)) {
    assert.match(v28b, new RegExp(`${tab}:\\s*"${permission}"`));
  }
  assert.match(v28b, /staffSitePreview:\s*"view_site_preview"/);
});

test("Owner remains visually full independent of matrix rows", () => {
  assert.match(v28b, /if \(role === "owner"\) return true;/);
});

test("non-owner UI fails closed until effective permissions are ready", () => {
  assert.match(v28b, /if \(!v28bPolicyReady\) return false;/);
  assert.match(v28b, /function v28bFailClosedUi\(\)/);
  assert.match(v28b, /Permessi Staff non disponibili/);
});

test("unauthorized tabs and views are hidden and guarded", () => {
  assert.match(v28b, /button\.hidden = !v28bAllowed\(permission\)/);
  assert.match(v28b, /view\.hidden = !allowed/);
  assert.match(v28b, /event\.stopImmediatePropagation\(\)/);
  assert.match(v28b, /Questo modulo non è assegnato al tuo account Staff/);
});

test("Owner can manage Admin permissions with mandatory reason", () => {
  assert.match(v28b, /staffAccessPermissionReason/);
  assert.match(v28b, /Inserisci una motivazione prima di salvare/);
  assert.match(v28b, /p_permission_key: change\.permissionKey/);
  assert.match(v28b, /p_allowed: change\.allowed/);
  assert.match(v28b, /p_reason: reason/);
  assert.match(v28b, /String\(sample\.staff_role[^\n]+!== "admin"/);
});

test("Premium omaggio remains explicitly outside the V2.8 matrix editor", () => {
  assert.match(v28b, /permission_key === "manage_complimentary"/);
  assert.match(v28b, /governance dedicata V2\.5A/);
  assert.doesNotMatch(v28b, /premium_owner_set_complimentary_permission/);
});

test("Technician access is described as fixed, not editable from this UI", () => {
  assert.match(v28b, /Accesso: tecnico fisso/);
  assert.match(v28b, /\["technician", "reviewer"\]\.includes\(role\)/);
  assert.doesNotMatch(v28b, /v28bOpenAccessDialog\(userId\)[\s\S]{0,120}technician/);
});

test("V2.8B states action-level backend enforcement belongs to V2.8C", () => {
  assert.match(v28b, /enforcement server-side[\s\S]*V2\.8C/);
  assert.match(v28b, /Saranno protette lato backend in V2\.8C/);
});

test("existing V2.5B/V2.6B/V2.7B contracts remain present", () => {
  for (const contract of [
    "premium_staff_can_manage_complimentary",
    "premium_owner_set_complimentary_permission",
    "premium_owner_dashboard_metrics",
    "staffOwnerDashboardTab",
    "staffOwnerLabTab",
    "/staff-owner-lab.html",
  ]) assert.ok(source.includes(contract), `missing preserved contract ${contract}`);
});
