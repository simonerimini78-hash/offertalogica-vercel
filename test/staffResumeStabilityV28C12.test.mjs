import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../public/staff-governance-v2.5B.js", import.meta.url),
  "utf8"
);

test("V2.8C1.2 keeps the initial stability gate", () => {
  assert.match(source, /const V28B_STABILITY_CLASS = "v28b-policy-stabilizing"/);
  assert.match(source, /v28bInstallStabilityGate\(\);/);
  assert.match(source, /v28bStabilizeInitialUi\(\)/);
});

test("resume uses exactly one focus listener and one visibility listener", () => {
  assert.equal((source.match(/window\.addEventListener\("focus"/g) || []).length, 1);
  assert.equal((source.match(/document\.addEventListener\("visibilitychange"/g) || []).length, 1);
  assert.match(source, /window\.addEventListener\("focus", v28bScheduleResumeRefresh\)/);
});

test("focus and visibilitychange are debounced into one resume path", () => {
  assert.match(source, /function v28bScheduleResumeRefresh\(\)/);
  assert.match(source, /clearTimeout\(v28bResumeTimer\)/);
  assert.match(source, /window\.setTimeout\(\(\) => \{[\s\S]*v28bRunResumeRefresh\(\);[\s\S]*\}, 140\)/);
});

test("resume refreshes governance and effective permissions only in background mode", () => {
  const block = source.match(/async function v28bRunResumeRefresh\(\)[\s\S]*?function v28bBindResumeRefresh/);
  assert.ok(block);
  assert.match(block[0], /refreshCurrentGovernance\(\{ silent: true, background: true \}\)/);
  assert.match(block[0], /v28bRefreshEffectivePermissions\(\{ silent: true, background: true \}\)/);
});

test("unchanged effective permissions do not rewrite module visibility", () => {
  assert.match(source, /if \(!background \|\| policyChanged\) v28bApplyModuleVisibility\(\);/);
  assert.match(source, /v28bPermissionMapsEqual\(previousPermissions, nextPermissions\)/);
});

test("transient resume errors preserve last-known-good governance", () => {
  assert.match(source, /background && v28bInitialUiStable && previousReady && previousRole/);
  assert.match(source, /refresh governance non disponibile; UI invariata/);
});

test("transient resume errors preserve last-known-good permission matrix", () => {
  assert.match(source, /refresh permessi non disponibile; UI invariata/);
  assert.match(source, /L'enforcement backend resta autorevole/);
});

test("periodic governance refresh is background-only", () => {
  const block = source.match(/function startPeriodicRefresh\(\)[\s\S]*?\/\/ Staff v2\.6B/);
  assert.ok(block);
  assert.match(block[0], /refreshCurrentGovernance\(\{ silent: true, background: true \}\)/);
  assert.doesNotMatch(block[0], /addEventListener\("focus"/);
  assert.doesNotMatch(block[0], /visibilitychange/);
});

test("Owner dashboard no longer owns separate focus or visibility listeners", () => {
  const block = source.match(/function initOwnerDashboard\(\)[\s\S]*?if \(document\.readyState === "loading"\)/);
  assert.ok(block);
  assert.doesNotMatch(block[0], /focus/);
  assert.doesNotMatch(block[0], /visibilitychange/);
});

test("Collaboratori no longer shows internal governance notes", () => {
  assert.doesNotMatch(source, /Premium omaggio: il Proprietario è sempre autorizzato/);
  assert.doesNotMatch(source, /Accessi Control Center: il Proprietario vede sempre tutto/);
  assert.match(source, /data-v25b-governance-note="true"\]\x27\)\?\.remove\(\)/);
  assert.match(source, /data-v28b-matrix-note="true"\]\x27\)\?\.remove\(\)/);
});

test("permission descriptions contain no internal rollout language", () => {
  assert.doesNotMatch(source, /Saranno protette lato backend in V2\.8C/);
  assert.doesNotMatch(source, /Sarà protetta lato backend in V2\.8C/);
  assert.match(source, /manage_checks: "Gestione operativa delle verifiche bollette\."/);
  assert.match(source, /delete_records: "Esecuzione delle eliminazioni critiche autorizzate\."/);
});

test("no operational RPC or Premium application code is introduced", () => {
  for (const name of [
    "premium_staff_claim_check",
    "premium_staff_set_check_status",
    "premium_staff_add_check_note",
    "premium_staff_add_anomaly",
    "premium_staff_complete_check",
    "premium_staff_delete_records",
  ]) {
    assert.doesNotMatch(source, new RegExp(`rpc\\("${name}"`));
  }
  assert.doesNotMatch(source, /premium\.offertalogica\.it\/app\.html/);
});
