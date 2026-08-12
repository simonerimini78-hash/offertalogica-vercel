import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
const staff = read("public/staff.js");
const html = read("public/staff.html");
const gov = read("public/staff-governance-v2.5B.js");
const auth = read("lib/staffSessionAuth.js");
const leads = read("api/staff-leads.js");
const analytics = read("api/staff-analytics.js");
const preview = read("api/staff-preview.js");
const pdf = read("api/staff-pdf-analyses.js");
const ai = read("api/premium-ai-analysis.js");
const billing = read("supabase/functions/premium-staff-billing/index.ts");
const removal = read("supabase/premium-staff-collaborator-removal-v2.8F.sql");
const removalVerify = read("supabase/premium-staff-collaborator-removal-v2.8F-verify.sql");
const security = read("supabase/premium-staff-permissions-final-v2.8F.sql");
const securityVerify = read("supabase/premium-staff-permissions-final-v2.8F-verify.sql");

function block(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing block ${start}`);
  return source.slice(a, b);
}

test("Auth callback is event-aware and unchanged context becomes a no-op", () => {
  assert.match(staff, /function handleAuthStateChange\(event, session\)/);
  assert.match(staff, /\["TOKEN_REFRESHED", "INITIAL_SESSION"\]\.includes\(String\(event \|\| ""\)\)/);
  assert.match(staff, /if \(!contextChanged && appAlreadyVisible\) return;/);
});

test("initial bootstrap verifies once before subscribing to Auth changes", () => {
  const init = block(staff, "async function init()", "document.addEventListener(\"DOMContentLoaded\"");
  assert.ok(init.indexOf("await verifyStaff(data.session)") < init.indexOf("onAuthStateChange(handleAuthStateChange)"));
  assert.equal((init.match(/verifyStaff\(data\.session/g) || []).length, 1);
});

test("full overview reload happens only on real staff-context change", () => {
  const verify = block(staff, "async function verifyStaff(", "async function handleLogin(");
  assert.match(verify, /if \(refreshOverview && \(contextChanged \|\| !appAlreadyVisible\)\) \{/);
  assert.match(verify, /await loadOverview\(\{ silent: true \}\)/);
  assert.match(staff, /offertalogica:staff-context-changed/);
});

test("governance no longer observes staffIdentity and uses one explicit context event", () => {
  assert.doesNotMatch(gov, /new MutationObserver[\s\S]{0,220}staffIdentity/);
  assert.doesNotMatch(gov, /const identity = byId\("staffIdentity"\)/);
  assert.equal((gov.match(/offertalogica:staff-context-changed/g) || []).length, 1);
});

test("resume remains single/debounced and unchanged policy does not rewrite modules", () => {
  assert.equal((gov.match(/window\.addEventListener\("focus"/g) || []).length, 1);
  assert.equal((gov.match(/document\.addEventListener\("visibilitychange"/g) || []).length, 1);
  assert.match(gov, /window\.setTimeout\(\(\) => \{[\s\S]*?v28bRunResumeRefresh\(\);[\s\S]*?\}, 140\)/);
  assert.match(gov, /if \(!background \|\| policyChanged\) v28bApplyModuleVisibility\(\);/);
});

test("Collaboratori page contains no implementation/roadmap wording", () => {
  const forbidden = [
    "Supabase Auth",
    "governance dedicata V2.5A",
    "Owner sempre completo",
    "Accesso: tecnico fisso",
    "Saranno protette lato backend",
    "Sarà protetta lato backend",
    "separato dalla matrice",
  ];
  for (const phrase of forbidden) {
    assert.ok(!html.includes(phrase), `html exposes ${phrase}`);
    assert.ok(!gov.includes(phrase), `governance exposes ${phrase}`);
  }
  assert.match(html, /Gestisci collaboratori, ruoli, accessi e stato degli inviti\./);
});

test("Owner can hide/show removed collaborators and soft-remove or restore them", () => {
  assert.match(html, /id="collaboratorShowRemoved"/);
  assert.match(staff, /premium_owner_remove_staff/);
  assert.match(staff, /premium_owner_restore_staff/);
  assert.match(staff, /premium_owner_list_staff_v2/);
  assert.match(staff, /Annulla invito/);
  assert.match(staff, /Ripristina/);
});

test("collaborator removal preserves history and protects Owner", () => {
  assert.match(removal, /history_preserved', true/);
  assert.match(removal, /auth_user_deleted', false/);
  assert.match(removal, /premium_owner_protected/);
  assert.doesNotMatch(removal, /delete\s+from\s+auth\.users/i);
  assert.doesNotMatch(removal, /delete\s+from\s+public\.premium_staff_members/i);
  assert.match(removal, /delete from public\.premium_staff_permissions/);
  assert.match(removal, /delete from public\.premium_staff_complimentary_permissions/);
});

test("restored Admin returns with permissions reset/default-deny", () => {
  assert.match(removal, /permissions_reset', true/);
  assert.match(removal, /delete from public\.premium_staff_permissions where staff_user_id = p_user_id/);
});

test("staff session helper enforces authoritative V2.8 permissions", () => {
  assert.match(auth, /premium_staff_permission_allowed/);
  assert.match(auth, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(auth, /permissionMode === "any"/);
  assert.match(auth, /Permesso Staff non autorizzato/);
});

test("Leads and Analytics map view/delete to module plus destructive permission", () => {
  assert.match(leads, /\["view_leads", "delete_records"\]/);
  assert.match(leads, /\["view_leads", "view_control"\]/);
  assert.match(analytics, /\["view_analytics", "delete_records"\]/);
  assert.match(analytics, /\["view_analytics", "view_control"\]/);
});

test("Preview, PDF diagnostics and AI endpoints use the intended V2.8 permissions", () => {
  assert.match(preview, /permissions: \["view_site_preview"\]/);
  assert.match(pdf, /\["view_pdf_diagnostics", "delete_records"\]/);
  assert.match(pdf, /\["view_pdf_diagnostics"\]/);
  assert.match(ai, /permission: "view_ai_costs"/);
  assert.match(ai, /permission: "manage_checks"/);
});

test("Stripe staff billing requires manage_billing with the original staff JWT", () => {
  assert.match(billing, /premium_staff_permission_allowed/);
  assert.match(billing, /Authorization: `Bearer \$\{token\}`/);
  assert.match(billing, /staffPermissionAllowed\(request, "manage_billing"/);
});

test("final RLS removes legacy Staff ALL policies and keys access to V2.8", () => {
  for (const legacy of [
    "premium_subscriptions_staff_all",
    "premium_utilities_staff_all",
    "premium_contracts_staff_all",
    "premium_analysis_runs_staff_all",
    "premium_checks_staff_all",
    "premium_anomalies_staff_all",
    "premium_communications_staff_all",
    "premium_analysis_field_reviews_staff_all",
    "premium_cost_events_staff_all",
  ]) assert.match(security, new RegExp(`drop policy if exists ${legacy}`));
  assert.ok((security.match(/premium_staff_permission_allowed\('/g) || []).length >= 25);
});

test("final RLS preserves requested-check restriction for bill/PDF access", () => {
  assert.match(security, /premium_bills_staff_select[\s\S]*view_checks[\s\S]*check_record\.status <> 'canceled'/);
  assert.match(security, /premium_bills_storage_staff_select[\s\S]*view_checks[\s\S]*check_record\.status <> 'canceled'/);
});

test("support write/delete and snapshot are permission-gated", () => {
  assert.match(security, /premium_communications_staff_insert[\s\S]*view_cases/);
  assert.match(security, /premium_communications_staff_delete[\s\S]*view_cases[\s\S]*delete_records/);
  assert.match(security, /premium_staff_account_support_snapshot[\s\S]*premium_staff_permission_allowed\('view_cases'\)/);
});

test("customer policies are not dropped by the final migration", () => {
  for (const policy of [
    "premium_bills_owner_select",
    "premium_bills_owner_delete",
    "premium_bills_storage_owner_select",
    "premium_consents_owner_insert",
  ]) assert.doesNotMatch(security, new RegExp(`drop policy if exists ${policy}`));
});


test("generic DB deletion requires destructive plus resource-module permission", () => {
  assert.match(security, /premium_staff_delete_records[\s\S]*delete_records[\s\S]*view_customers[\s\S]*view_ai_costs/);
  assert.match(security, /premium_delete_resource_not_allowed/);
  assert.match(security, /premium_staff_complete_account_deletion[\s\S]*delete_records[\s\S]*view_customers/);
});

test("both SQL verifiers are transactional", () => {
  assert.match(removalVerify, /^--[\s\S]*\bbegin\s*;/i);
  assert.match(removalVerify, /\brollback\s*;\s*$/i);
  assert.match(securityVerify, /^--[\s\S]*\bbegin\s*;/i);
  assert.match(securityVerify, /\brollback\s*;\s*$/i);
});
