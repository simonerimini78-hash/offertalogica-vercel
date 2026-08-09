import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { canonicalStaffRole, isStaffAdminRole } from "../lib/staffRoles.js";
import { verifyPremiumStaff } from "../lib/premiumAiBackend.js";

function fakeFetchForRole(role, active = true) {
  let call = 0;
  return async () => {
    call += 1;
    if (call === 1) {
      return new Response(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify([{ user_id: "11111111-1111-4111-8111-111111111111", role, active }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

const config = {
  supabaseUrl: "https://example.supabase.co",
  serviceKey: "test-service-key",
};

test("canonicalizza i ruoli legacy e v2", () => {
  assert.equal(canonicalStaffRole("reviewer"), "technician");
  assert.equal(canonicalStaffRole("technician"), "technician");
  assert.equal(canonicalStaffRole("admin"), "admin");
  assert.equal(canonicalStaffRole("owner"), "owner");
  assert.equal(canonicalStaffRole("unknown"), "");
});

test("Owner eredita Admin, Tecnico e Reviewer no", () => {
  assert.equal(isStaffAdminRole("owner"), true);
  assert.equal(isStaffAdminRole("admin"), true);
  assert.equal(isStaffAdminRole("technician"), false);
  assert.equal(isStaffAdminRole("reviewer"), false);
});

test("verifyPremiumStaff accetta solo i quattro ruoli autorizzati e attivi", async () => {
  for (const role of ["reviewer", "technician", "admin", "owner"]) {
    const identity = await verifyPremiumStaff({
      config,
      accessToken: "session-token",
      fetchImpl: fakeFetchForRole(role, true),
    });
    assert.equal(identity.staff.role, role);
  }

  await assert.rejects(
    verifyPremiumStaff({ config, accessToken: "session-token", fetchImpl: fakeFetchForRole("unknown", true) }),
    /premium_staff_access_required/,
  );
  await assert.rejects(
    verifyPremiumStaff({ config, accessToken: "session-token", fetchImpl: fakeFetchForRole("owner", false) }),
    /premium_staff_access_required/,
  );
});

test("i frontend non contengono più gate admin rigidi", () => {
  const staff = fs.readFileSync(new URL("../public/staff.js", import.meta.url), "utf8");
  const premium = fs.readFileSync(new URL("../public/staff-premium.js", import.meta.url), "utf8");
  const pdf = fs.readFileSync(new URL("../public/staff-pdf.html", import.meta.url), "utf8");
  assert.doesNotMatch(staff, /currentStaff\?\.role\s*[!=]==?\s*["']admin["']/);
  assert.doesNotMatch(premium, /currentStaff\?\.role\s*[!=]==?\s*["']admin["']/);
  assert.doesNotMatch(pdf, /currentStaff\?\.role\s*[!=]==?\s*["']admin["']/);
});

test("config_status usa la policy amministrativa condivisa", () => {
  const source = fs.readFileSync(new URL("../api/premium-ai-analysis.js", import.meta.url), "utf8");
  assert.match(source, /isStaffAdminRole\(staff\.role\)/);
  assert.doesNotMatch(source, /staff\.role\s*!==\s*["']admin["']/);
});
