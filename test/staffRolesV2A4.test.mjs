import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const migration = fs.readFileSync(path.join(root, "supabase/premium-staff-role-compat-v2.2A4.sql"), "utf8");
const rollback = fs.readFileSync(path.join(root, "supabase/premium-staff-role-compat-v2.2A4-rollback.sql"), "utf8");
const billing = fs.readFileSync(path.join(root, "supabase/functions/premium-staff-billing/index.ts"), "utf8");

function legacyRole(role) {
  if (role === "owner") return "admin";
  if (role === "technician") return "reviewer";
  return role;
}

test("A4 mantiene la matrice legacy per i ruoli attuali e prepara i nuovi", () => {
  assert.equal(legacyRole("support"), "support");
  assert.equal(legacyRole("reviewer"), "reviewer");
  assert.equal(legacyRole("technician"), "reviewer");
  assert.equal(legacyRole("admin"), "admin");
  assert.equal(legacyRole("owner"), "admin");
});

test("A4 non cambia il vincolo o i dati di premium_staff_members", () => {
  assert.doesNotMatch(migration, /alter\s+table\s+public\.premium_staff_members/i);
  assert.doesNotMatch(migration, /update\s+public\.premium_staff_members/i);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.premium_staff_members/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.premium_staff_members/i);
});

test("A4 normalizza solo il ruolo effettivo nei due helper centrali", () => {
  assert.match(migration, /when\s+'owner'\s+then\s+'admin'/i);
  assert.match(migration, /when\s+'technician'\s+then\s+'reviewer'/i);
  assert.match(migration, /create\s+or\s+replace\s+function\s+public\.premium_is_staff/i);
  assert.match(migration, /create\s+or\s+replace\s+function\s+public\.premium_staff_role/i);
  assert.match(migration, /=\s+any\(allowed_roles\)/i);
});

test("Stripe resta amministrativo: solo admin e owner", () => {
  assert.match(billing, /ADMIN_STAFF_ROLES\s*=\s*new Set\(\["admin",\s*"owner"\]\)/);
  assert.match(billing, /ADMIN_STAFF_ROLES\.has\(String\(staff\.role \|\| ""\)\.toLowerCase\(\)\)/);
  assert.doesNotMatch(billing, /ADMIN_STAFF_ROLES\s*=\s*new Set\([^\n]*(?:reviewer|technician)/);
});

test("rollback ripristina esattamente la semantica legacy dei due helper", () => {
  assert.match(rollback, /staff\.role\s*=\s*any\(allowed_roles\)/i);
  assert.match(rollback, /staff\.role\s+in\s*\('reviewer',\s*'admin'\)/i);
  assert.doesNotMatch(rollback, /when\s+'owner'/i);
  assert.doesNotMatch(rollback, /when\s+'technician'/i);
});
