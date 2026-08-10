import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const html = fs.readFileSync(
  new URL("../public/staff.html", import.meta.url),
  "utf8"
);
const governance = fs.readFileSync(
  new URL("../public/staff-governance-v2.5B.js", import.meta.url),
  "utf8"
);

function gitBlobSha(text) {
  const body = Buffer.from(text, "utf8");
  return crypto
    .createHash("sha1")
    .update(Buffer.from(`blob ${body.length}\0`))
    .update(body)
    .digest("hex");
}

const supplementalLine = '<script src="/staff-governance-v2.5B.js"></script>';
const restoredHtml = html.replace(`\n${supplementalLine}`, "");

test("V2.5B modifies staff.html only by loading the supplemental module", () => {
  assert.equal((html.match(/staff-governance-v2\.5B\.js/g) || []).length, 1);
  assert.match(html, /<script src="\/staff\.js"><\/script>\s*<script src="\/staff-governance-v2\.5B\.js"><\/script>/);
  assert.equal(
    gitBlobSha(restoredHtml),
    "c510cbda945367e8dec5dc82521f4aff19368624"
  );
});

test("V2.5B does not create a second Supabase auth client", () => {
  assert.doesNotMatch(governance, /\.createClient\s*\(/);
  assert.match(governance, /offertalogica-premium-staff-auth/);
  assert.match(governance, /Authorization:\s*`Bearer \$\{token\}`/);
});

test("V2.5B asks the authoritative V2.5A backend for role and capability", () => {
  assert.match(governance, /rpc\("premium_staff_raw_role"\)/);
  assert.match(governance, /rpc\("premium_staff_can_manage_complimentary"\)/);
  assert.match(governance, /governanceReady && canManageComplimentary/);
});

test("V2.5B Owner controls use only the Owner permission RPCs", () => {
  assert.match(governance, /premium_owner_list_complimentary_permissions/);
  assert.match(governance, /premium_owner_set_complimentary_permission/);
  assert.match(governance, /currentRole !== "owner"/);
  assert.match(governance, /targetRole !== "admin"/);
});

test("V2.5B hides customer complimentary controls unless capability is confirmed", () => {
  assert.match(governance, /button\.hidden = !\(governanceReady && canManageComplimentary\)/);
  assert.match(governance, /COMPLIMENTARY_BUTTON_LABELS/);
  assert.match(governance, /REGALA PREMIUM/);
  assert.match(governance, /GESTISCI OMAGGIO/);
});

test("V2.5B enforces a fresh mandatory reason in the UI", () => {
  assert.match(governance, /reason\.required = true/);
  assert.match(governance, /if \(clearReason\) reason\.value = ""/);
  assert.match(governance, /Inserisci una motivazione per questa operazione/);
  assert.match(governance, /Motivazione obbligatoria/);
});

test("V2.5B keeps unlimited complimentary Owner-only in the UI", () => {
  assert.match(governance, /const owner = currentRole === "owner"/);
  assert.match(governance, /unlimited\.hidden = !owner/);
  assert.match(governance, /unlimited\.disabled = !owner/);
  assert.match(governance, /duration === "unlimited" && currentRole !== "owner"/);
});

test("V2.5B renders explicit Admin permission state in Collaborators", () => {
  assert.match(governance, /Omaggio: autorizzato/);
  assert.match(governance, /Omaggio: negato/);
  assert.match(governance, /Autorizza omaggi/);
  assert.match(governance, /Revoca omaggi/);
  assert.match(governance, /Omaggio: non previsto/);
});

test("V2.5B permission changes require a reason before RPC execution", () => {
  const reasonCheck = governance.indexOf('if (!reason) {');
  const rpcCall = governance.indexOf('rpc("premium_owner_set_complimentary_permission"');
  assert.ok(reasonCheck >= 0);
  assert.ok(rpcCall > reasonCheck);
});

test("V2.5B contains no privileged backend secret", () => {
  assert.doesNotMatch(governance, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(governance, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(governance, /STRIPE_SECRET_KEY/);
  assert.doesNotMatch(governance, /\bservice_role\b/);
});

test("staff.html has no duplicate static element IDs after V2.5B", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], []);
});
