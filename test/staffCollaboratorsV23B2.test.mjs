import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/staff.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../public/staff.js', import.meta.url), 'utf8');
const activate = fs.readFileSync(new URL('../public/staff-activate.html', import.meta.url), 'utf8');
const edge = fs.readFileSync(new URL('../supabase/functions/premium-staff-invite/index.ts', import.meta.url), 'utf8');

 test('Staff UI keeps existing-account action and adds explicit new-user invite action', () => {
  assert.match(html, /Aggiungi collaboratore esistente/);
  assert.match(html, /id="collaboratorInvite"/);
  assert.match(html, /Invita nuovo/);
  assert.match(js, /PREMIUM_STAFF_INVITE_URL/);
  assert.match(js, /inviteCollaborator/);
});

test('invite backend requires a real Owner and only assigns admin or technician', () => {
  assert.match(edge, /String\(staff\.role \|\| ""\)\.toLowerCase\(\) !== "owner"/);
  assert.match(edge, /new Set\(\["admin", "technician"\]\)/);
  assert.match(edge, /premium_owner_required/);
  assert.doesNotMatch(edge, /service_role[^\n]*browser/i);
});

test('invite backend refuses existing Auth users and rolls back a new Auth user if membership fails', () => {
  assert.match(edge, /premium_staff_auth_user_exists/);
  assert.match(edge, /inviteUserByEmail/);
  assert.match(edge, /premium_staff_members/);
  assert.match(edge, /deleteUser\(invitedUserId\)/);
});

test('invite redirect is restricted to OffertaLogica or its Vercel preview and uses the isolated activation page', () => {
  assert.match(edge, /offertalogica\.it/);
  assert.match(edge, /offertalogica-vercel/);
  assert.match(edge, /staff-activate\.html/);
  assert.match(activate, /offertalogica-staff-activation/);
  assert.doesNotMatch(activate, /premium_refresh_trial_lifecycle|premium_activate_beta_trial|premium_profiles/);
});

test('activation page verifies an active admin or technician before setting the password', () => {
  assert.match(activate, /premium_staff_members/);
  assert.match(activate, /new Set\(\["admin", "technician"\]\)/);
  assert.match(activate, /updateUser\(\{ password \}\)/);
  assert.match(activate, /window\.location\.replace\("\/staff\.html"\)/);
});
