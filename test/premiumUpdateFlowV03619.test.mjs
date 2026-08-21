import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = name => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("app e staff controllano gli aggiornamenti automaticamente", async () => {
  const [app, staff, appAuth, staffJs] = await Promise.all([
    read("public/app.html"), read("public/staff.html"), read("public/app-auth.js"), read("public/staff.js"),
  ]);
  assert.match(app, /setInterval\(checkForUpdate,30000\)/);
  assert.match(app, /fetch\(`\/version\.json\?t=\$\{Date\.now\(\)\}`/);
  assert.match(staff, /setInterval\(checkForUpdate,20000\)/);
  assert.match(staff, /fetch\(`\/version\.json\?t=\$\{Date\.now\(\)\}`/);
  assert.match(staff, /cache:'no-store'/);
  assert.match(staff, /id="staffApplyUpdate"/);
  assert.match(staff, /retireLegacyRootWorker/);
  assert.match(staff, /location\.replace\(target\.href\)/);
  assert.doesNotMatch(staff, /navigator\.serviceWorker\.register/);
  assert.match(appAuth, /persistSession:\s*true/);
  assert.match(staffJs, /persistSession:\s*true/);
});

test("Staff v0.36.43 aggiorna da solo se libero e chiede conferma se c'è lavoro protetto", async () => {
  const staff = await read("public/staff.html");
  assert.match(staff, /CURRENT_RELEASE="0\.36\.43"/);
  assert.match(staff, /RECENT_ACTIVITY_MS=12000/);
  assert.match(staff, /recentlyActive/);
  assert.match(staff, /manualApprovalRequired=false/);
  assert.match(staff, /if\(protectedWorkInProgress\(\)\)manualApprovalRequired=true/);
  assert.match(staff, /if\(manualApprovalRequired\|\|!isSafeToReload\(\)\)showReady\(\);else await performUpdate\(\)/);
  assert.match(staff, /poi premi AGGIORNA/);
  assert.match(staff, /offertalogica:staff-save-complete/);
  assert.match(staff, /if\(latestRelease\)setTimeout\(checkForUpdate,0\)/);
  assert.doesNotMatch(staff, /if\(active&&editableTarget\(active\)\)return false/);
});

test("Staff protegge i moduli e ripulisce gli stati iframe non più attivi", async () => {
  const staff = await read("public/staff.html");
  assert.match(staff, /#staffComplimentaryForm,#staffSupportReplyForm,#collaboratorAddForm/);
  assert.match(staff, /pruneFrameStates/);
  assert.match(staff, /liveFrameWindows/);
  assert.match(staff, /embeddedModuleUnsafe/);
  assert.match(staff, /document\.body\.getAttribute\('aria-busy'\)/);
  assert.match(staff, /Salva o chiudi il lavoro in corso/);
});

test("Staff usa release 0.36.43 senza cambiare la versione applicativa Premium", async () => {
  const [app,staff,staffPremium,bills]=await Promise.all([read("public/app.html"),read("public/staff.html"),read("public/staff-premium.html"),read("public/app-premium-bills.js")]);
  assert.match(app,/APP v0\.36\.29/);
  assert.match(app,/APP Premium v0\.36\.29/);
  assert.match(staff,/v0\.36\.43/);
  assert.match(staff,/CURRENT_RELEASE="0\.36\.43"/);
  assert.match(staffPremium,/v0\.36\.29/);
  assert.match(bills,/app_version:\s*"0\.36\.29"/);
});
