import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = name => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("app e staff propongono un aggiornamento esplicito senza eseguire il logout", async () => {
  const [app, staff, appAuth, staffJs] = await Promise.all([
    read("public/app.html"),
    read("public/staff.html"),
    read("public/app-auth.js"),
    read("public/staff.js"),
  ]);

  assert.match(app, /id="updateNotice"/);
  assert.match(app, /La sessione resta attiva/);
  assert.match(app, /worker\.postMessage\(\{type:'SKIP_WAITING'\}\)/);
  assert.match(staff, /id="staffUpdateNotice"/);
  assert.match(staff, /Aggiorna senza uscire dall’account/);
  assert.match(staff, /worker\.postMessage\(\{type:'SKIP_WAITING'\}\)/);
  assert.match(appAuth, /persistSession:\s*true/);
  assert.match(staffJs, /persistSession:\s*true/);
  assert.doesNotMatch(app, /auth\.signOut\(\).*SKIP_WAITING/s);
  assert.doesNotMatch(staff, /auth\.signOut\(\).*SKIP_WAITING/s);
});

test("il service worker v0.36.19 aggiorna anche i moduli staff", async () => {
  const sw = await read("public/sw.js");
  assert.match(sw, /offertalogica-premium-v03619/);
  for (const asset of [
    "/staff.html",
    "/staff.js",
    "/staff-premium.html",
    "/staff-premium.js",
    "/staff-pdf.html",
    "/premium-ai-validation.js",
  ]) assert.ok(sw.includes(`"${asset}"`), `asset staff mancante dalla cache: ${asset}`);
});

test("etichette applicative allineate alla v0.36.19", async () => {
  const [app, staff, staffPremium, bills] = await Promise.all([
    read("public/app.html"),
    read("public/staff.html"),
    read("public/staff-premium.html"),
    read("public/app-premium-bills.js"),
  ]);
  assert.match(app, /APP v0\.36\.19/);
  assert.match(app, /APP Premium v0\.36\.19/);
  assert.match(staff, /v0\.36\.19/);
  assert.match(staffPremium, /v0\.36\.19/);
  assert.match(bills, /app_version:\s*"0\.36\.19"/);
});
