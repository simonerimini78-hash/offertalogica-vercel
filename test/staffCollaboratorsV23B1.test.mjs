import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/premium-staff-collaborators-v2.3B1.sql', import.meta.url), 'utf8');
const rollback = fs.readFileSync(new URL('../supabase/premium-staff-collaborators-v2.3B1-rollback.sql', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/staff.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../public/staff.js', import.meta.url), 'utf8');

test('management RPCs are Owner-only', () => {
  assert.match(sql, /premium_owner_add_staff/);
  assert.match(sql, /premium_owner_update_staff/);
  assert.ok((sql.match(/premium_staff_raw_role\(\)/g) || []).length >= 2);
  assert.ok((sql.match(/<> 'owner'/g) || []).length >= 2);
});

test('Owner is explicitly protected from collaborator mutations', () => {
  assert.ok((sql.match(/premium_owner_protected/g) || []).length >= 2);
  assert.match(sql, /role <> 'owner'/);
});

test('only admin and technician can be assigned by B1', () => {
  assert.ok((sql.match(/not in \('admin', 'technician'\)/g) || []).length >= 2);
});

test('frontend exposes add, role update and active toggle controls', () => {
  assert.match(html, /id="collaboratorAddForm"/);
  assert.match(html, /Aggiungi collaboratore/);
  assert.match(js, /premium_owner_add_staff/);
  assert.match(js, /premium_owner_update_staff/);
  assert.match(js, /toggleCollaboratorActive/);
  assert.match(js, /saveCollaboratorRole/);
});

test('rollback removes only B1 management functions', () => {
  assert.match(rollback, /drop function if exists public\.premium_owner_update_staff/);
  assert.match(rollback, /drop function if exists public\.premium_owner_add_staff/);
  assert.doesNotMatch(rollback, /delete\s+from\s+public\.premium_staff_members/i);
  assert.doesNotMatch(rollback, /update\s+public\.premium_staff_members/i);
});
