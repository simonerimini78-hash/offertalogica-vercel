import test from "node:test";
import assert from "node:assert/strict";

import {
  STAFF_ROLES,
  canonicalStaffRole,
  staffRoleSatisfiesBaseline,
} from "../lib/staffRoles.js";

test("normalizza i ruoli legacy e v2 senza cambiare admin", () => {
  assert.equal(canonicalStaffRole("reviewer"), STAFF_ROLES.TECHNICIAN);
  assert.equal(canonicalStaffRole("technician"), STAFF_ROLES.TECHNICIAN);
  assert.equal(canonicalStaffRole("admin"), STAFF_ROLES.ADMIN);
  assert.equal(canonicalStaffRole("owner"), STAFF_ROLES.OWNER);
  assert.equal(canonicalStaffRole("unknown"), "");
});

test("mantiene invariato l'accesso corrente reviewer/admin", () => {
  const currentDefaultRoles = ["reviewer", "admin"];
  assert.equal(staffRoleSatisfiesBaseline("reviewer", currentDefaultRoles), true);
  assert.equal(staffRoleSatisfiesBaseline("admin", currentDefaultRoles), true);
  assert.equal(staffRoleSatisfiesBaseline("unknown", currentDefaultRoles), false);
});

test("technician eredita il livello operativo legacy reviewer", () => {
  assert.equal(staffRoleSatisfiesBaseline("technician", ["reviewer", "admin"]), true);
  assert.equal(staffRoleSatisfiesBaseline("technician", ["admin"]), false);
  assert.equal(staffRoleSatisfiesBaseline("reviewer", ["technician"]), true);
});

test("owner eredita il livello admin", () => {
  assert.equal(staffRoleSatisfiesBaseline("owner", ["admin"]), true);
  assert.equal(staffRoleSatisfiesBaseline("owner", ["reviewer", "admin"]), true);
  assert.equal(staffRoleSatisfiesBaseline("admin", ["owner"]), false);
});

test("un requisito owner resta esclusivo", () => {
  assert.equal(staffRoleSatisfiesBaseline("owner", ["owner"]), true);
  assert.equal(staffRoleSatisfiesBaseline("admin", ["owner"]), false);
  assert.equal(staffRoleSatisfiesBaseline("technician", ["owner"]), false);
  assert.equal(staffRoleSatisfiesBaseline("reviewer", ["owner"]), false);
});

test("nega richieste senza ruolo valido", () => {
  assert.equal(staffRoleSatisfiesBaseline("admin", []), false);
  assert.equal(staffRoleSatisfiesBaseline("admin", ["unknown"]), false);
  assert.equal(staffRoleSatisfiesBaseline("", ["reviewer"]), false);
});
