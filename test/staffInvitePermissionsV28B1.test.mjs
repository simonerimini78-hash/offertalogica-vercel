import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const governance = fs.readFileSync(
  new URL("../public/staff-governance-v2.5B.js", import.meta.url),
  "utf8"
);
const sql = fs.readFileSync(
  new URL("../supabase/premium-staff-invite-status-v2.8B1.sql", import.meta.url),
  "utf8"
);
const verify = fs.readFileSync(
  new URL("../supabase/premium-staff-invite-status-v2.8B1-verify.sql", import.meta.url),
  "utf8"
);

test("V2.8B1 uses a dedicated Owner-only Auth status RPC", () => {
  assert.match(governance, /premium_owner_list_staff_activation_status/);
  assert.match(sql, /create or replace function public\.premium_owner_list_staff_activation_status\(\)/i);
  assert.match(sql, /premium_staff_raw_role\(\)/);
  assert.match(sql, /<> 'owner'/);
});

test("pending invitation is derived from Auth invited_at + email_confirmed_at, not staff.active alone", () => {
  assert.match(sql, /auth_user\.invited_at is not null/);
  assert.match(sql, /auth_user\.email_confirmed_at is null then 'invited_pending'/);
  assert.match(sql, /when staff\.active = false then 'disabled'/);
  assert.match(governance, /activation_status/);
  assert.match(governance, /invited_pending/);
});

test("UI renders exact pending invitation wording", () => {
  assert.match(governance, /Invito inviato/);
  assert.match(governance, /In attesa di attivazione/);
});

test("invite capture is restricted to current invite button and exact email/role", () => {
  assert.match(governance, /closest\("#collaboratorInvite"\)/);
  assert.match(governance, /form\?\.elements\?\.email/);
  assert.match(governance, /form\?\.elements\?\.role/);
  assert.match(governance, /\["admin", "technician"\]\.includes\(role\)/);
});

test("automatic permission opening requires the real success message for the same email", () => {
  assert.match(governance, /messageTarget\?\.classList\?\.contains\("success"\)/);
  assert.match(governance, /expectedPrefix = `Invito inviato a \$\{pending\.email\}\.`/);
  assert.match(governance, /message\.startsWith\(expectedPrefix\)/);
});

test("new Admin opens existing V2.8B access dialog automatically", () => {
  assert.match(governance, /pending\.role === "admin"/);
  assert.match(governance, /await v28bOpenAccessDialog\(userId\)/);
  assert.match(governance, /premium_owner_list_staff_permission_matrix/);
});

test("Technician invite does not open editable permissions", () => {
  assert.match(governance, /Il Tecnico userà automaticamente il profilo tecnico fisso/);
  const handlerStart = governance.indexOf("async function v28b1HandleInviteSuccess()");
  const handlerEnd = governance.indexOf("function v28b1BindInviteFlow()", handlerStart);
  const handler = governance.slice(handlerStart, handlerEnd);
  assert.match(handler, /if \(pending\.role === "admin"\)/);
  assert.equal((handler.match(/v28bOpenAccessDialog/g) || []).length, 1);
});

test("V2.8B1 does not replace the existing invite Edge Function or staff member RPCs", () => {
  assert.doesNotMatch(sql, /premium_owner_add_staff/);
  assert.doesNotMatch(sql, /premium_owner_update_staff/);
  assert.doesNotMatch(sql, /premium_staff_members\s+set/i);
  assert.doesNotMatch(sql, /update\s+auth\.users/i);
  assert.doesNotMatch(sql, /insert\s+into\s+auth\.users/i);
});

test("verification script checks invariants and rolls back", () => {
  assert.match(verify, /pending_invite_invariant_ok/);
  assert.match(verify, /owner_activation_list_nonempty/);
  assert.match(verify, /\brollback\s*;\s*$/i);
});

test("existing V2.8B matrix and historical Owner modules remain present", () => {
  assert.match(governance, /premium_staff_effective_permissions/);
  assert.match(governance, /premium_owner_set_staff_permission/);
  assert.match(governance, /staffOwnerDashboardTab/);
  assert.match(governance, /staffOwnerLabTab/);
  assert.match(governance, /premium_staff_can_manage_complimentary/);
});
