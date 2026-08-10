import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const leads = fs.readFileSync(new URL("../api/staff-leads.js", import.meta.url), "utf8");
const analytics = fs.readFileSync(new URL("../api/staff-analytics.js", import.meta.url), "utf8");
const helper = fs.readFileSync(new URL("../lib/staffAudit.js", import.meta.url), "utf8");

test("lead pre-audit occurs before destructive engine", () => {
  const audit = leads.indexOf('action: "lead_deletion_authorized"');
  const deletion = leads.indexOf("await deleteCustomerLeads({ id, ids, all: resetAll })");
  assert.ok(audit > 0 && deletion > audit);
  assert.match(leads, /Audit Staff non disponibile: eliminazione non eseguita/);
});

test("analytics pre-audit occurs before destructive engine", () => {
  const audit = analytics.indexOf('action: "analytics_deletion_authorized"');
  const deletion = analytics.indexOf("await deleteCustomerAnalytics({ id, ids, all: resetAll })");
  assert.ok(audit > 0 && deletion > audit);
  assert.match(analytics, /Audit Staff non disponibile: eliminazione non eseguita/);
});

test("original delete calls remain exactly once", () => {
  assert.equal((leads.match(/deleteCustomerLeads\(\{ id, ids, all: resetAll \}\)/g) || []).length, 1);
  assert.equal((analytics.match(/deleteCustomerAnalytics\(\{ id, ids, all: resetAll \}\)/g) || []).length, 1);
});

test("lead result is audited", () => {
  assert.match(leads, /lead_deletion_completed/);
  assert.match(leads, /lead_deletion_failed/);
  assert.match(leads, /deleted_count/);
  assert.match(leads, /deleted_ids/);
});

test("analytics result is audited", () => {
  assert.match(analytics, /analytics_deletion_completed/);
  assert.match(analytics, /analytics_deletion_failed/);
  assert.match(analytics, /deleted_count/);
  assert.match(analytics, /deleted_ids/);
});

test("audit actor comes only from verified server identity", () => {
  assert.match(helper, /identity\?\.user\?\.id/);
  assert.match(helper, /identity\?\.staff\?\.role/);
  assert.doesNotMatch(helper, /req\.body|body\.role|body\.staff/);
});

test("audit helper reuses existing Supabase config", () => {
  assert.match(helper, /premiumAiConfig/);
  assert.match(helper, /config\.supabaseUrl/);
  assert.match(helper, /config\.serviceKey/);
  assert.doesNotMatch(helper, /STAFF_AUDIT_/);
});

test("audit metadata excludes customer PII", () => {
  for (const source of [leads, analytics]) {
    const match = source.match(/const auditMetadata = \{[\s\S]*?\n    \};/);
    assert.ok(match);
    assert.doesNotMatch(match[0], /\b(email|phone|name|pdf|pod|pdr)\b/i);
  }
});
