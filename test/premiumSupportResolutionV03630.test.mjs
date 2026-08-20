import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const app = read("public/app-support.js");
const staff = read("public/staff.js");
const sql = read("supabase/premium-support-resolution-v0.36.30.sql");

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `manca ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `manca ${endMarker}`);
  return source.slice(start, end);
}

const appLoad = sliceBetween(app, "async function loadSupportCommunications", "async function markStaffMessagesRead");
const appRender = sliceBetween(app, "function renderOpenCase", "async function confirmDeleteRequest");
const appReply = sliceBetween(app, "async function submitReply", "async function openPanel");
const staffBuild = sliceBetween(staff, "function buildOperationalCases()", "function filteredCases()");
const staffClose = sliceBetween(staff, "async function closeSupportCase()", "async function deleteSupportCase");

test("FASE1: read_at resta la lettura del messaggio Staff", () => {
  assert.match(app, /message\.direction === "staff_to_user" && !message\.read_at/);
  assert.match(app, /update\(\{ read_at: new Date\(\)\.toISOString\(\) \}\)/);
  assert.doesNotMatch(staffClose, /update\(\{ read_at:/);
});

test("FASE1: resolved_at determina se la richiesta cliente è ancora aperta", () => {
  assert.match(appLoad, /message\.direction === "user_to_staff" && !message\.resolved_at/);
  assert.match(staffBuild, /!message\.resolved_at/);
  assert.match(staffClose, /!message\.resolved_at/);
  assert.match(staffClose, /update\(\{ resolved_at: new Date\(\)\.toISOString\(\) \}\)/);
});

test("FASE1: una pratica risolta resta visibile finché esiste una risposta Staff non letta", () => {
  assert.match(appLoad, /message\.direction === "staff_to_user" && !message\.read_at/);
  assert.match(appLoad, /waitingForRead: !unresolved && unreadStaff/);
  assert.match(appRender, /Lo staff ha chiuso la pratica/);
});

test("FASE1: la conversazione corrente può riaprirsi dopo la lettura", () => {
  assert.match(appLoad, /\{ caseId = "", category = "" \} = \{\}/);
  assert.match(appLoad, /const preferredMessage = caseId/);
  assert.match(appReply, /loadSupportCommunications\(\{ caseId: currentCase\.caseId, category: currentCase\.category \}\)/);
  assert.match(appReply, /direction:\s*"user_to_staff"/);
});

test("FASE1: il backfill conserva la vecchia chiusura ma libera read_at", () => {
  assert.match(sql, /resolved_at = read_at/);
  assert.match(sql, /read_at = null/);
  assert.match(sql, /subject like '\[support:%'/);
});
