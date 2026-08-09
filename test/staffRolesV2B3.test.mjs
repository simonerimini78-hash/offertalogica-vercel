import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/premium-staff-raw-role-v2.2B3.sql'), 'utf8');
const verify = fs.readFileSync(path.join(root, 'supabase/premium-staff-raw-role-v2.2B3-verify.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(root, 'supabase/premium-staff-raw-role-v2.2B3-rollback.sql'), 'utf8');

test('B3 creates only the raw role helper', () => {
  assert.match(migration, /create or replace function public\.premium_staff_raw_role\(\)/i);
  assert.doesNotMatch(migration, /create or replace function public\.premium_staff_role\(\)/i);
  assert.doesNotMatch(migration, /create or replace function public\.premium_is_staff\(/i);
});

test('B3 raw helper recognizes all five current role values', () => {
  for (const role of ['support', 'reviewer', 'technician', 'admin', 'owner']) {
    assert.match(migration, new RegExp(`'${role}'`, 'i'));
  }
});

test('B3 migration does not mutate staff member rows or schema role constraint', () => {
  assert.doesNotMatch(migration, /\b(update|insert\s+into|delete\s+from)\s+public\.premium_staff_members\b/i);
  assert.doesNotMatch(migration, /alter\s+table\s+public\.premium_staff_members/i);
});

test('B3 verify checks owner, five-role constraint, raw helper and legacy helpers', () => {
  assert.match(verify, /premium_staff_raw_role/i);
  assert.match(verify, /9e81ab10-22ff-4c62-bf23-fbec1aa5af67/i);
  assert.match(verify, /premium_staff_members_role_check/i);
  assert.match(verify, /premium_is_staff/i);
  assert.match(verify, /premium_staff_role/i);
});

test('B3 rollback removes only the raw helper', () => {
  assert.match(rollback, /drop function if exists public\.premium_staff_raw_role\(\)/i);
  assert.doesNotMatch(rollback, /premium_staff_members/i);
  assert.doesNotMatch(rollback, /premium_is_staff/i);
  assert.doesNotMatch(rollback, /premium_staff_role\(\)/i);
});
