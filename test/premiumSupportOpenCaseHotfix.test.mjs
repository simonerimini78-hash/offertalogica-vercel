import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("hotfix: una pratica rossa aperta non blocca l'assistenza automatica", () => {
  const js = read("public/app-support.js");
  assert.match(js, /CONTINUA CON ASSISTENZA AUTOMATICA/);
  const restart = js.match(/byId\("premiumSupportRestart"\)[\s\S]{0,260}?\n\s*\}\);/)?.[0] || "";
  assert.match(restart, /renderMain\(\)/);
  assert.doesNotMatch(restart, /if \(currentCase\)/);
});

test("hotfix: resta impossibile creare una seconda pratica rossa", () => {
  const js = read("public/app-support.js");
  assert.match(js, /const existing = await loadSupportCommunications\(\)/);
  assert.match(js, /if \(existing\.openCase\)[\s\S]{0,180}renderOpenCase\(existing\.openCase, existing\.messages\)/);
});

test("hotfix: la conferma staff è sopra il dialog della pratica", () => {
  const js = read("public/staff.js");
  const support = Number(js.match(/\.support-dialog-layer\{[^}]*z-index:(\d+)/)?.[1]);
  const confirm = Number(js.match(/\.confirm-layer\{z-index:(\d+)!important\}/)?.[1]);
  assert.ok(Number.isFinite(support) && Number.isFinite(confirm));
  assert.ok(confirm > support, `z-index conferma ${confirm} deve essere > dialog ${support}`);
});

test("hotfix: la chiusura staff verifica che almeno una riga sia stata chiusa", () => {
  const js = read("public/staff.js");
  assert.match(js, /update\(\{ read_at: new Date\(\)\.toISOString\(\) \}\)[\s\S]{0,300}\.select\("id"\)/);
  assert.match(js, /if \(!closedRows\?\.length\) throw new Error/);
});

test("hotfix: le cancellazioni verificano l'effettiva eliminazione", () => {
  const app = read("public/app-support.js");
  const staff = read("public/staff.js");
  assert.match(app, /\.delete\(\)[\s\S]{0,220}\.select\("id"\)[\s\S]{0,100}!deletedRows\?\.length/);
  assert.match(staff, /\.delete\(\)[\s\S]{0,220}\.select\("id"\)[\s\S]{0,130}!deletedRows\?\.length/);
});

test("hotfix: service worker distribuisce i nuovi script", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /offertalogica-premium-v03629-support(?:4-fix1|5-(?:account|install-(?:focus|dynamic|simple)))/);
  assert.match(sw, /"\/app-support\.js"/);
});
