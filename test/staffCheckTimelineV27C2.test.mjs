import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/staff-premium.html", import.meta.url), "utf8");
const timeline = fs.readFileSync(new URL("../public/staff-premium-timeline-v2.7C2.js", import.meta.url), "utf8");

test("V2.7C2 loads only one supplemental timeline module after staff-premium.js", () => {
  assert.match(html, /<script src="\/staff-premium\.js"><\/script>\s*<script src="\/staff-premium-timeline-v2\.7C2\.js"><\/script>/);
  assert.equal((html.match(/staff-premium-timeline-v2\.7C2\.js/g) || []).length, 1);
});

test("existing specialist modules remain loaded", () => {
  assert.match(html, /premium-ai-validation\.js/);
  assert.match(html, /staff-premium\.js/);
});

test("timeline uses the guarded V2.7C1 RPC and never reads timeline table directly", () => {
  assert.match(timeline, /premium_staff_list_check_timeline/);
  assert.match(timeline, /\.rpc\(TIMELINE_RPC/);
  assert.doesNotMatch(timeline, /\.from\(["']premium_check_timeline_events["']\)/);
});

test("timeline supplemental module performs no operational write RPC", () => {
  for (const rpc of [
    "premium_staff_claim_check",
    "premium_staff_set_check_status",
    "premium_staff_add_check_note",
    "premium_staff_add_anomaly",
    "premium_staff_delete_anomaly",
    "premium_staff_complete_check",
    "premium_staff_validate_analysis",
    "premium_staff_delete_records",
  ]) {
    assert.ok(!timeline.includes(rpc), `unexpected operational RPC ${rpc}`);
  }
});

test("all V2.7C1 event families have readable labels", () => {
  for (const event of [
    "check_created",
    "check_claimed",
    "check_unassigned",
    "check_reassigned",
    "check_assigned",
    "check_in_review",
    "check_more_info_required",
    "check_completed",
    "check_canceled",
    "check_status_changed",
    "customer_message_updated",
    "note_added",
    "anomaly_added",
    "anomaly_removed",
    "analysis_validated",
    "analysis_revalidated",
    "communication_sent",
    "communication_received",
    "system_message_sent",
  ]) {
    assert.ok(timeline.includes(`${event}:`), `missing label for ${event}`);
  }
});

test("timeline never renders message bodies or note contents from metadata", () => {
  assert.doesNotMatch(timeline, /metadata\.body/);
  assert.doesNotMatch(timeline, /metadata\.note\b/);
  assert.match(timeline, /Contenuto riservato alle note interne/);
});

test("AI validation exposes corrected field names without raw PDF data", () => {
  assert.match(timeline, /corrected_field_keys/);
  assert.match(timeline, /FIELD_LABELS/);
  assert.doesNotMatch(timeline, /storage_path/);
  assert.doesNotMatch(timeline, /download\(/);
});

test("timeline refreshes when Staff rebuilds detail or selected queue row", () => {
  assert.match(timeline, /new MutationObserver\(scheduleTimeline\)/);
  assert.match(timeline, /observer\.observe\(detail/);
  assert.match(timeline, /observer\.observe\(queue/);
});

test("supplemental client reuses Staff auth storage without owning refresh", () => {
  assert.match(timeline, /offertalogica-premium-staff-auth/);
  assert.match(timeline, /autoRefreshToken:\s*false/);
});

test("UI insertion is limited to the selected practice detail", () => {
  assert.match(timeline, /#staffDetail \.detail-body/);
  assert.match(timeline, /#staffQueue \.queue-item\.active/);
  assert.match(timeline, /checkTimelineFor/);
});
