import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { isStaffAdminRole, staffRoleSatisfiesBaseline } from "../lib/staffRoles.js";

test("owner eredita il livello admin senza promuovere technician/reviewer", () => {
  assert.equal(isStaffAdminRole("owner"), true);
  assert.equal(isStaffAdminRole("admin"), true);
  assert.equal(isStaffAdminRole("technician"), false);
  assert.equal(isStaffAdminRole("reviewer"), false);
});

test("la gerarchia base legacy resta invariata", () => {
  assert.equal(staffRoleSatisfiesBaseline("reviewer", ["reviewer", "admin"]), true);
  assert.equal(staffRoleSatisfiesBaseline("admin", ["reviewer", "admin"]), true);
  assert.equal(staffRoleSatisfiesBaseline("owner", ["admin"]), true);
  assert.equal(staffRoleSatisfiesBaseline("technician", ["admin"]), false);
});

test("le API distruttive non usano piu il confronto letterale admin", () => {
  for (const path of ["api/staff-leads.js", "api/staff-analytics.js"]) {
    const source = fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, /isStaffAdminRole\(identity\.staff\.role\)/);
    assert.doesNotMatch(source, /identity\.staff\.role\s*!==\s*["']admin["']/);
  }
});
