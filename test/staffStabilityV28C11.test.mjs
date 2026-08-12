import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../public/staff-governance-v2.5B.js", import.meta.url), "utf8");

test("stability gate is installed synchronously before auth/bootstrap helpers", () => {
  const install = source.indexOf("v28bInstallStabilityGate();");
  const auth = source.indexOf("function storedAccessToken()");
  assert.ok(install > 0 && auth > install);
  assert.match(source, /#staffApp:not\(\[hidden\]\)[\s\S]*visibility:hidden!important/);
});

test("initial stabilization waits for governance role and V2.8 effective permissions", () => {
  const block = source.match(/async function v28bStabilizeInitialUi\(\)[\s\S]*?function v28bArmStabilityFallback/);
  assert.ok(block);
  assert.match(block[0], /refreshCurrentGovernance\(\{ silent: true \}\)/);
  assert.match(block[0], /v28bRefreshEffectivePermissions\(\{ silent: true \}\)/);
  assert.match(block[0], /syncOwnerDashboardVisibility\(\)/);
  assert.match(block[0], /syncOwnerLabVisibility\(\)/);
  assert.match(block[0], /v28bReleaseStabilityGate\(\)/);
});

test("legacy startup retry timers that caused visible resync are removed", () => {
  for (const pattern of [
    /setTimeout\(refreshAndSync, 50\)/,
    /setTimeout\(refreshAndSync, 650\)/,
    /setTimeout\(refresh, 25\)/,
    /setTimeout\(refresh, 350\)/,
    /setTimeout\(refresh, 900\)/,
    /setTimeout\(\(\) => refreshCurrentGovernance\(\{ silent: true \}\), 500\)/,
  ]) assert.doesNotMatch(source, pattern);
});

test("visible staff app uses one deterministic stabilization path", () => {
  assert.match(source, /v28bFailClosedUi\(\);\s*v28bArmStabilityFallback\(\);\s*v28bStabilizeInitialUi\(\);/);
});

test("fallback never opens non-owner modules without policy", () => {
  const block = source.match(/function v28bArmStabilityFallback\(\)[\s\S]*?function v28bRemoveAccessControls/);
  assert.ok(block);
  assert.match(block[0], /if \(role === "owner"\)/);
  assert.match(block[0], /else if \(!v28bPolicyReady\)/);
  assert.match(block[0], /v28bFailClosedUi\(\)/);
  assert.match(block[0], /v28bSetNoAccessMessage\(true\)/);
});

test("Owner-only collaborator decorations do not block first stable paint", () => {
  assert.match(source, /refreshPermissionControls\(\{ silent: true \}\)\.catch\(\(\) => \{\}\)/);
  assert.match(source, /v28bRefreshMatrix\(\{ silent: true \}\)\.catch\(\(\) => \{\}\)/);
});

test("gate is rearmed after logout/denied transition for a future login", () => {
  assert.match(source, /if \(staffApp\.hidden\) \{\s*v28bInitialUiStable = false;\s*v28bInstallStabilityGate\(\);/);
});

test("focus and visibility refreshes remain after removing bootstrap retries", () => {
  assert.match(source, /window\.addEventListener\("focus", refreshAndSync\)/);
  assert.match(source, /window\.addEventListener\("focus", refresh\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange"/);
});

test("no operational RPC names or Premium application code is introduced", () => {
  for (const name of [
    "premium_staff_claim_check",
    "premium_staff_set_check_status",
    "premium_staff_add_check_note",
    "premium_staff_add_anomaly",
    "premium_staff_complete_check",
    "premium_staff_delete_records",
  ]) {
    assert.doesNotMatch(source, new RegExp(`rpc\\(\\"${name}\\"`));
  }
  assert.doesNotMatch(source, /premium\.offertalogica\.it\/app\.html/);
});
