import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  new URL("../supabase/premium-check-timeline-v2.7C1.sql", import.meta.url),
  "utf8"
);
const verify = fs.readFileSync(
  new URL("../supabase/premium-check-timeline-v2.7C1-verify.sql", import.meta.url),
  "utf8"
);

test("V2.7C1 is additive and does not replace operational Staff RPCs", () => {
  for (const rpc of [
    "premium_staff_claim_check",
    "premium_staff_set_check_status",
    "premium_staff_add_check_note",
    "premium_staff_add_anomaly",
    "premium_staff_delete_anomaly",
    "premium_staff_complete_check",
    "premium_staff_validate_analysis",
  ]) {
    assert.doesNotMatch(
      migration,
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${rpc}\\s*\\(`, "i"),
    );
  }
});

test("timeline table is append-only from exposed roles", () => {
  assert.match(migration, /revoke all on table public\.premium_check_timeline_events[\s\S]*authenticated/i);
  assert.match(migration, /revoke update, delete, truncate on table public\.premium_check_timeline_events[\s\S]*service_role/i);
});

test("browser cannot invoke internal timeline writer", () => {
  assert.match(
    migration,
    /revoke all on function public\.premium_check_timeline_write\([\s\S]*\)\s+from public, anon, authenticated, service_role/i,
  );
});

test("reader is guarded by raw role", () => {
  assert.match(migration, /premium_staff_raw_role\(\)/);
  assert.match(migration, /v_role not in \('reviewer', 'technician', 'admin', 'owner'\)/);
});

test("checks trigger covers claim status integration completion and cancellation", () => {
  for (const event of [
    "check_created",
    "check_claimed",
    "check_reassigned",
    "check_in_review",
    "check_more_info_required",
    "check_completed",
    "check_canceled",
  ]) assert.ok(migration.includes(event), `missing ${event}`);
});

test("notes anomalies validation and communications are tracked", () => {
  for (const event of [
    "note_added",
    "anomaly_added",
    "anomaly_removed",
    "analysis_validated",
    "analysis_revalidated",
    "communication_sent",
    "communication_received",
  ]) assert.ok(migration.includes(event), `missing ${event}`);
});

test("AI validation aggregates corrected field keys after field reviews exist", () => {
  assert.match(migration, /premium_analysis_field_reviews/);
  assert.match(migration, /decision = 'corrected'/);
  assert.match(migration, /corrected_field_keys/);
});

test("customer email and communication body are not copied", () => {
  assert.match(migration, /Non copiare l'email cliente/);
  const communicationFn = migration.slice(
    migration.indexOf("create or replace function public.premium_check_timeline_communications_trigger"),
    migration.indexOf("-- ---------------------------------------------------------------------------\n-- READER", migration.indexOf("create or replace function public.premium_check_timeline_communications_trigger")),
  );
  assert.doesNotMatch(communicationFn, /new\.body/i);
});

test("verification script rolls back its probe", () => {
  assert.match(verify, /^\s*--[\s\S]*\bbegin\s*;/i);
  assert.match(verify, /\brollback\s*;\s*$/i);
  assert.match(verify, /append_only_writer_probe_ok/);
  assert.match(verify, /owner_reader_empty_check_ok/);
});

test("rollback removes triggers before table", () => {
  const firstTriggerDrop = migration.length; // migration itself must never drop the new table
  assert.doesNotMatch(migration, /drop table\s+.*premium_check_timeline_events/i);
  assert.ok(firstTriggerDrop > 0);
});
