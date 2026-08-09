import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const migration = read('supabase/premium-staff-role-schema-v2.2B1.sql');
const verify = read('supabase/premium-staff-role-schema-v2.2B1-verify.sql');
const rollback = read('supabase/premium-staff-role-schema-v2.2B1-rollback.sql');

test('B1 changes only the staff role constraint, not member rows', () => {
  assert.match(migration, /alter table public\.premium_staff_members/i);
  assert.match(migration, /add constraint premium_staff_members_role_check/i);
  assert.doesNotMatch(migration, /\b(update|insert into|delete from)\s+public\.premium_staff_members\b/i);
});

test('B1 preserves legacy roles and adds technician/owner', () => {
  for (const role of ['support', 'reviewer', 'technician', 'admin', 'owner']) {
    assert.match(migration, new RegExp(`'${role}'`));
  }
});

test('B1 validates the verified A4 precondition before replacing the constraint', () => {
  assert.match(migration, /premium_staff_role_constraint_missing/);
  assert.match(migration, /premium_staff_role_constraint_unexpected/);
  assert.match(migration, /v_definition like '%technician%'/);
  assert.match(migration, /v_definition like '%owner%'/);
});

test('B1 rollback refuses to run after new roles are assigned', () => {
  assert.match(rollback, /role in \('owner', 'technician'\)/i);
  assert.match(rollback, /rollback_blocked:new_roles_in_use/);
  assert.match(rollback, /check \(role in \('support', 'reviewer', 'admin'\)\)/i);
});

test('B1 verify checks constraint, member distribution and A4 helpers', () => {
  assert.match(verify, /pg_get_constraintdef/);
  assert.match(verify, /group by role, active/i);
  assert.match(verify, /premium_is_staff/);
  assert.match(verify, /premium_staff_role/);
});
