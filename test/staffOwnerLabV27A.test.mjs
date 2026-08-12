import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/staff-owner-lab.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../public/staff-owner-lab-v2.7A.js", import.meta.url), "utf8");

test("V2.7A is a standalone additive Owner lab", () => {
  assert.match(html, /Control Center · Laboratorio Owner/);
  assert.match(html, /staff-owner-lab-v2\.7A\.js/);
  assert.doesNotMatch(html, /staff-premium\.js/);
});

test("Owner access uses the authoritative raw-role RPC", () => {
  assert.match(js, /client\.rpc\("premium_staff_raw_role"\)/);
  assert.match(js, /!== "owner"/);
  assert.match(js, /Accesso negato/);
});

test("Lab performs no Supabase table writes or storage operations", () => {
  assert.doesNotMatch(js, /client\.from\(/);
  assert.doesNotMatch(js, /client\.storage/);
  assert.doesNotMatch(js, /\.insert\(/);
  assert.doesNotMatch(js, /\.update\(/);
  assert.doesNotMatch(js, /\.delete\(/);
});

test("The only RPC used by the lab is the role reader", () => {
  const calls = [...js.matchAll(/client\.rpc\("([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(calls, ["premium_staff_raw_role"]);
});

test("Lab has the required green yellow and red scenarios", () => {
  for (const id of [
    "green-regular","yellow-saving","red-price","red-fixed-fee","red-consumption",
    "red-adjustment","red-duplicate","yellow-unreadable","yellow-ai-missing","red-ai-corrected"
  ]) assert.match(js, new RegExp(id));
});

test("Problem categories mirror current Staff Premium terminology", () => {
  for (const category of ["price","fixed_fee","consumption","adjustment","duplicate","contract","other"]) {
    assert.match(js, new RegExp(`${category}:|value="${category}"|category:"${category}"`));
  }
});

test("Workflow mutations are explicitly memory-only", () => {
  assert.match(html, /nessun dato cliente viene scritto/i);
  assert.match(js, /modificano soltanto lo scenario in memoria/i);
  assert.match(js, /RESET SCENARIO/);
});

test("Lab includes AI, validation, anomalies and workflow views", () => {
  assert.match(js, /Dati letti dalla bolletta/);
  assert.match(js, /Dettagli tecnici IA e validazione/);
  assert.match(js, /Anomalie e opportunità/);
  assert.match(js, /Lavorazione/);
});

test("No production Stripe, mail or Premium mutation endpoint appears", () => {
  assert.doesNotMatch(js, /stripe/i);
  assert.doesNotMatch(js, /resend/i);
  assert.doesNotMatch(js, /premium_admin_set_complimentary/);
  assert.doesNotMatch(js, /premium_staff_complete_check/);
  assert.doesNotMatch(js, /\/api\/premium-ai-analysis/);
});
