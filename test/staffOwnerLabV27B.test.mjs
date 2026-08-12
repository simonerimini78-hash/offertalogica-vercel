import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const governance = fs.readFileSync(
  new URL("../public/staff-governance-v2.5B.js", import.meta.url),
  "utf8"
);
const lab = fs.readFileSync(
  new URL("../public/staff-owner-lab-v2.7A.js", import.meta.url),
  "utf8"
);
const html = fs.readFileSync(
  new URL("../public/staff-owner-lab.html", import.meta.url),
  "utf8"
);

const v27bGovStart = governance.indexOf("// Staff v2.7B — accesso al Laboratorio Owner");
const v27bGovEnd = governance.indexOf("  function initOwnerDashboard()", v27bGovStart);
assert.ok(v27bGovStart >= 0 && v27bGovEnd > v27bGovStart);
const v27bGov = governance.slice(v27bGovStart, v27bGovEnd);

test("V2.7B adds the Laboratorio Owner to the Control Center without staff.js/html changes", () => {
  assert.match(v27bGov, /staffOwnerLabTab/);
  assert.match(v27bGov, /Laboratorio Owner/);
  assert.match(v27bGov, /\/staff-owner-lab\.html/);
});

test("Laboratorio navigation is gated to the exact Owner role", () => {
  assert.match(v27bGov, /currentRole !== "owner"/);
  assert.match(v27bGov, /currentRole === "owner"/);
  assert.match(v27bGov, /button\.hidden/);
});

test("V2.7B lab still performs no table/storage/API writes", () => {
  assert.doesNotMatch(lab, /client\.from\(/);
  assert.doesNotMatch(lab, /client\.storage/);
  assert.doesNotMatch(lab, /\/api\//);
  assert.doesNotMatch(lab, /\.insert\(/);
  assert.doesNotMatch(lab, /\.update\(/);
  assert.doesNotMatch(lab, /\.delete\(/);
});

test("The lab still uses only premium_staff_raw_role RPC", () => {
  const calls = [...lab.matchAll(/client\.rpc\("([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(calls, ["premium_staff_raw_role"]);
});

test("V2.7B includes an explicit simulated operator selector", () => {
  assert.match(html, /id="labActor"/);
  assert.match(html, /Tecnico demo/);
  assert.match(html, /Amministratore demo/);
  assert.match(html, /Proprietario/);
  assert.match(lab, /DEMO_ACTORS/);
});

test("V2.7B includes a complete in-memory practice timeline", () => {
  assert.match(lab, /buildInitialTimeline/);
  assert.match(lab, /pushTimeline/);
  assert.match(lab, /renderPracticeTimeline/);
  assert.match(lab, /Timeline operativa della pratica/);
  assert.match(html, /practice-timeline/);
});

test("Claim, status, anomaly and completion actions append timeline events", () => {
  assert.match(lab, /Pratica presa in carico/);
  assert.match(lab, /Richiesta integrazione al cliente/);
  assert.match(lab, /Anomalia registrata/);
  assert.match(lab, /Pratica conclusa/);
});

test("Timeline clearly states that real history is not guessed", () => {
  assert.match(lab, /non verrà ricostruita per supposizione/i);
  assert.match(lab, /registreremo gli eventi operativi nel database/i);
});

test("Existing V2.6B Owner dashboard contract is preserved", () => {
  assert.match(governance, /premium_owner_dashboard_metrics/);
  assert.match(governance, /staffOwnerDashboardTab/);
  assert.match(governance, /ownerDashboardActive/);
});

test("Existing V2.5B complimentary governance is preserved", () => {
  assert.match(governance, /premium_staff_can_manage_complimentary/);
  assert.match(governance, /premium_owner_set_complimentary_permission/);
  assert.match(governance, /applyCustomerButtonPolicy/);
});
