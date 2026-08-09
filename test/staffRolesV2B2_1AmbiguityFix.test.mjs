import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync(
  new URL("../supabase/premium-staff-collaborators-v2.3B2.1-fix-ambiguous-user-id.sql", import.meta.url),
  "utf8"
);

test("B2.1 keeps the existing RPC signature", () => {
  assert.match(sql, /premium_owner_add_staff\s*\(\s*p_email text,\s*p_role text default 'technician'/s);
  assert.match(sql, /returns table\s*\(\s*user_id uuid,\s*email text,\s*role text,\s*active boolean/s);
});

test("B2.1 preserves Owner-only and Owner protection", () => {
  assert.match(sql, /premium_staff_raw_role\(\).*<> 'owner'/s);
  assert.match(sql, /v_existing_role = 'owner'.*premium_owner_protected/s);
});

test("B2.1 moves ON CONFLICT into parameterized dynamic SQL", () => {
  assert.match(sql, /execute \$upsert\$[\s\S]*on conflict \(user_id\) do update[\s\S]*\$upsert\$[\s\S]*using v_user_id, v_role/i);
});

test("B2.1 does not alter schema or delete data", () => {
  assert.doesNotMatch(sql, /\balter\s+table\b/i);
  assert.doesNotMatch(sql, /\bdrop\s+table\b/i);
  assert.doesNotMatch(sql, /\bdelete\s+from\b/i);
  assert.doesNotMatch(sql, /\btruncate\b/i);
});
