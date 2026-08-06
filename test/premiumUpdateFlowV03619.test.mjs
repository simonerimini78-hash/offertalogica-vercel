import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = name => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("app e staff controllano periodicamente e applicano automaticamente gli aggiornamenti", async () => {
  const [app, staff, appAuth, staffJs] = await Promise.all([
    read("public/app.html"),
    read("public/staff.html"),
    read("public/app-auth.js"),
    read("public/staff.js"),
  ]);

  assert.match(app, /setInterval\(checkForUpdate,30000\)/);
  assert.match(staff, /setInterval\(checkForUpdate,30000\)/);
  assert.match(app, /pendingWorker\.postMessage\(\{type:'SKIP_WAITING'\}\)/);
  assert.match(staff, /pendingWorker\.postMessage\(\{type:'SKIP_WAITING'\}\)/);
  assert.match(app, /tryActivateUpdate/);
  assert.match(staff, /tryActivateUpdate/);
  assert.doesNotMatch(app, /id="applyUpdate"/);
  assert.doesNotMatch(staff, /id="staffApplyUpdate"/);
  assert.match(appAuth, /persistSession:\s*true/);
  assert.match(staffJs, /persistSession:\s*true/);
  assert.doesNotMatch(app, /auth\.signOut\(\).*SKIP_WAITING/s);
  assert.doesNotMatch(staff, /auth\.signOut\(\).*SKIP_WAITING/s);
});

test("l’aggiornamento automatico attende operazioni, analisi e modifiche staff non salvate", async () => {
  const [app, staff, bills] = await Promise.all([
    read("public/app.html"),
    read("public/staff.html"),
    read("public/app-premium-bills.js"),
  ]);
  assert.match(app, /\[aria-busy="true"\],\[data-update-busy="true"\]/);
  assert.match(app, /hasSelectedFile/);
  assert.match(app, /action-dialog-open/);
  assert.match(bills, /data-update-busy/);
  assert.match(bills, /analysisInFlightIds\.size > 0/);
  assert.match(staff, /let dirty=false/);
  assert.match(staff, /Verrà applicata automaticamente dopo il salvataggio/);
  assert.match(staff, /document\.body\.getAttribute\('aria-busy'\)/);
});

test("il service worker v0.36.20 aggiorna anche i moduli staff", async () => {
  const sw = await read("public/sw.js");
  assert.match(sw, /offertalogica-premium-v03620/);
  for (const asset of [
    "/staff.html",
    "/staff.js",
    "/staff-premium.html",
    "/staff-premium.js",
    "/staff-pdf.html",
    "/premium-ai-validation.js",
  ]) assert.ok(sw.includes(`"${asset}"`), `asset staff mancante dalla cache: ${asset}`);
});

test("etichette applicative allineate alla v0.36.20", async () => {
  const [app, staff, staffPremium, bills] = await Promise.all([
    read("public/app.html"),
    read("public/staff.html"),
    read("public/staff-premium.html"),
    read("public/app-premium-bills.js"),
  ]);
  assert.match(app, /APP v0\.36\.20/);
  assert.match(app, /APP Premium v0\.36\.20/);
  assert.match(staff, /v0\.36\.20/);
  assert.match(staffPremium, /v0\.36\.20/);
  assert.match(bills, /app_version:\s*"0\.36\.20"/);
});
