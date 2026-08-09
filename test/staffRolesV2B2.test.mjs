import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (name) => fs.readFileSync(path.join(root, 'supabase', name), 'utf8');

const promote = read('premium-staff-owner-promote-v2.2B2.sql');
const verify = read('premium-staff-owner-promote-v2.2B2-verify.sql');
const rollback = read('premium-staff-owner-promote-v2.2B2-rollback.sql');
const uuid = '9e81ab10-22ff-4c62-bf23-fbec1aa5af67';
const email = 'offertalogica@gmail.com';

test('promotion is pinned to exact UUID and email', () => {
  assert.match(promote, new RegExp(uuid));
  assert.match(promote, new RegExp(email.replace('.', '\\.')));
  assert.match(promote, /staff\.role = 'admin'/);
  assert.match(promote, /staff\.active = true/);
});

test('promotion changes only admin to owner on target row', () => {
  assert.match(promote, /update public\.premium_staff_members[\s\S]*set role = 'owner'/i);
  assert.match(promote, /where user_id = v_target[\s\S]*and role = 'admin'[\s\S]*and active = true/i);
  assert.doesNotMatch(promote, /\binsert\b/i);
  assert.doesNotMatch(promote, /\bdelete\b/i);
  assert.doesNotMatch(promote, /\balter table\b/i);
});

test('promotion blocks unexpected starting state', () => {
  assert.match(promote, /v_active_admins <> 1/);
  assert.match(promote, /v_owners <> 0/);
  assert.match(promote, /role_schema_not_ready/);
  assert.match(promote, /target_mismatch/);
});

test('verify checks exact target and keeps B1/A4 compatibility visible', () => {
  assert.match(verify, new RegExp(uuid));
  assert.match(verify, /premium_staff_members_role_check/);
  assert.match(verify, /premium_is_staff/);
  assert.match(verify, /premium_staff_role/);
});

test('rollback is pinned and only reverts owner to admin', () => {
  assert.match(rollback, new RegExp(uuid));
  assert.match(rollback, new RegExp(email.replace('.', '\\.')));
  assert.match(rollback, /v_owners <> 1/);
  assert.match(rollback, /set role = 'admin'/);
  assert.match(rollback, /and role = 'owner'/);
  assert.doesNotMatch(rollback, /\binsert\b/i);
  assert.doesNotMatch(rollback, /\bdelete\b/i);
});
