import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("v0.36.27 usa un fondo argento neutro e mantiene verdi solo gli elementi di marca", async () => {
  const app = await read("public/app.html");
  assert.match(app, /v0\.36\.27 — fondo argento/);
  assert.match(app, /linear-gradient\(155deg,#eef2f0 0%,#d1d8d5 50%,#f3f5f4 100%\)/);
  assert.match(app, /body:after\{[\s\S]*rgba\(156,170,164,\.20\)/);
  assert.match(app, /\.profile-card\{[\s\S]*linear-gradient\(145deg,#087b39 0%,#0ea046 48%,#7dcd2b 100%\)/);
  assert.match(app, /\.auth-submit,[\s\S]*linear-gradient\(135deg,#075f31 0%,#16a34a 54%,#82cf2b 100%\)/);
});

test("v0.36.27 separa l'aggiornamento automatico app da quello manuale staff", async () => {
  const [app, staff, sw, manifest] = await Promise.all([
    read("public/app.html"), read("public/staff.html"), read("public/sw.js"), read("public/version.json")
  ]);
  assert.match(app, /APP_WORKER_SCOPE='\/app\.html'/);
  assert.match(app, /retireLegacyRootWorker/);
  assert.doesNotMatch(sw, /"\/staff\.html"/);
  assert.match(staff, /id="staffApplyUpdate"/);
  assert.match(staff, /retireLegacyRootWorker/);
  assert.match(staff, /location\.replace\(target\.href\)/);
  assert.doesNotMatch(staff, /navigator\.serviceWorker\.register/);
  assert.equal(JSON.parse(manifest).version, "0.36.27");
});
