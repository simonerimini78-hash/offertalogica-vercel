import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/staff.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../public/staff.js', import.meta.url), 'utf8');
const sql = fs.readFileSync(new URL('../supabase/premium-staff-collaborators-v2.3A.sql', import.meta.url), 'utf8');
const rollback = fs.readFileSync(new URL('../supabase/premium-staff-collaborators-v2.3A-rollback.sql', import.meta.url), 'utf8');

test('collaborators is an Owner-only Staff tab', () => {
  assert.match(html, /id="staffCollaboratorsTab"[^>]*data-staff-tab="collaborators"[^>]*hidden/);
  assert.match(js, /function isOwner\(\)/);
  assert.match(js, /requested === "collaborators" && !isOwner\(\)/);
  assert.match(js, /activeTab === "collaborators" && !isOwner\(\)/);
});

test('frontend lists collaborators through the dedicated RPC', () => {
  assert.match(js, /client\.rpc\("premium_owner_list_staff"\)/);
  assert.match(js, /loadCollaborators/);
  assert.match(js, /renderCollaborators/);
});

test('database RPC enforces raw Owner role', () => {
  assert.match(sql, /premium_staff_raw_role\(\)/);
  assert.match(sql, /<> 'owner'/);
  assert.match(sql, /premium_owner_required/);
});

test('v2.3A is read-only for staff membership', () => {
  assert.doesNotMatch(sql, /\b(update|insert\s+into|delete\s+from|alter\s+table)\s+public\.premium_staff_members\b/i);
  assert.match(sql, /returns table/);
});

test('rollback removes only the v2.3A RPC', () => {
  assert.match(rollback, /drop function if exists public\.premium_owner_list_staff\(\)/);
  assert.doesNotMatch(rollback, /premium_staff_members/);
});
