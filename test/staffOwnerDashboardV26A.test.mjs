import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  new URL("../supabase/premium-owner-dashboard-v2.6A.sql", import.meta.url),
  "utf8"
);
const verify = fs.readFileSync(
  new URL("../supabase/premium-owner-dashboard-v2.6A-verify.sql", import.meta.url),
  "utf8"
);
const rollback = fs.readFileSync(
  new URL("../supabase/premium-owner-dashboard-v2.6A-rollback.sql", import.meta.url),
  "utf8"
);

test("V2.6A is Owner-only through the raw role", () => {
  assert.match(migration, /premium_staff_raw_role\(\)/);
  assert.match(migration, /<> 'owner'/);
  assert.match(migration, /premium_owner_required/);
});

test("V2.6A returns aggregate JSON sections", () => {
  assert.match(migration, /returns jsonb/i);
  for (const section of [
    "customers", "subscriptions", "operations", "costs",
    "complimentary", "staff", "governance"
  ]) {
    assert.match(migration, new RegExp(`'${section}'`));
  }
});

test("V2.6A does not expose common PII fields", () => {
  assert.doesNotMatch(migration, /\bauth\.users\b/i);
  assert.doesNotMatch(migration, /\bfull_name\b/i);
  assert.doesNotMatch(migration, /\bphone\b/i);
  assert.doesNotMatch(migration, /\bstaff_email\b/i);
});

test("V2.6A avoids browser list limits by aggregating in SQL", () => {
  assert.match(migration, /count\(\*\)/i);
  assert.doesNotMatch(migration, /\.limit\(/);
  assert.doesNotMatch(migration, /\blimit\s+(100|200|250|500)\b/i);
});

test("Latest subscription is deduplicated per user", () => {
  assert.match(migration, /distinct on \(subscription\.user_id\)/i);
  assert.match(migration, /subscription\.created_at desc/i);
  assert.match(migration, /subscription\.id desc/i);
});

test("Paid metrics require a real Stripe linkage", () => {
  assert.match(migration, /subscription\.provider = 'stripe'/);
  assert.match(migration, /provider_subscription_id/);
  assert.match(migration, /paid_active/);
  assert.match(migration, /paid_attention/);
});

test("Complimentary metrics use current subscriptions and historical events", () => {
  assert.match(migration, /premium-complimentary/);
  assert.match(migration, /offertalogica-complimentary/);
  assert.match(migration, /premium_complimentary_events/);
  assert.match(migration, /complimentary_unlimited/);
  assert.match(migration, /grants_30d/);
  assert.match(migration, /revokes_30d/);
});

test("Economic output contains costs only, no invented income metric keys", () => {
  assert.match(migration, /estimated_cost_eur/);
  assert.match(migration, /premium_cost_events/);
  const outputKeyPattern = /'(revenue|fatturato|ricavo|ricavi|mrr|arr)'/i;
  assert.doesNotMatch(migration, outputKeyPattern);
});

test("Operational support metric is exact unread-message count", () => {
  assert.match(migration, /support_unread_messages/);
  assert.match(migration, /communication\.direction = 'user_to_staff'/);
  assert.match(migration, /communication\.read_at is null/);
  assert.doesNotMatch(migration, /support_threads_open/);
});

test("Migration does not mutate existing application rows or tables", () => {
  assert.doesNotMatch(migration, /\binsert\s+into\s+public\./i);
  assert.doesNotMatch(migration, /\bupdate\s+public\./i);
  assert.doesNotMatch(migration, /\bdelete\s+from\s+public\./i);
  assert.doesNotMatch(migration, /\balter\s+table\s+public\./i);
});

test("Verify is transactional and rollback removes only the new RPC", () => {
  assert.match(verify, /\bbegin;/i);
  assert.match(verify, /\brollback;/i);
  assert.match(verify, /premium_owner_dashboard_non_owner_not_blocked/);
  assert.match(verify, /payload_has_no_email_key/);
  assert.match(rollback, /drop function if exists public\.premium_owner_dashboard_metrics\(\)/i);
  assert.doesNotMatch(rollback, /\b(drop table|delete from|update)\b/i);
});
