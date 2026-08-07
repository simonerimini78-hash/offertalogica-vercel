import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const premiumBills = await readFile(new URL("../public/app-premium-bills.js", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const staff = await readFile(new URL("../public/staff.html", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../public/version.json", import.meta.url), "utf8"));

test("l'analisi locale non avvia il polling che ricostruiva la lista ogni cinque secondi", () => {
  assert.match(premiumBills, /analysisIsPending\(bill\) && !analysisInFlightIds\.has\(bill\.id\)/);
  assert.match(premiumBills, /async function refreshPendingAnalyses\(\)/);
  assert.match(premiumBills, /analysisStateFingerprint\(updated\) !== analysisStateFingerprint\(bill\)/);
  assert.doesNotMatch(premiumBills, /pollTimer = window\.setTimeout\(async \(\) => \{\s*try \{ await loadData/);
});

test("durante l'analisi i pulsanti restano stabili", () => {
  assert.match(premiumBills, /button\.textContent = "ANALISI IN CORSO"/);
  assert.match(premiumBills, /button\.dataset\.permanentDisabled = "true"/);
  assert.match(premiumBills, /openButton\.textContent = "APRI"/);
  assert.match(premiumBills, /const sameRows = existingIds\.length === currentIds\.length/);
  assert.match(premiumBills, /updateBillArticle\(/);
  assert.match(premiumBills, /if \(!refreshedFromServer\) renderEnabled\(\);\s*else scheduleAutomaticWork\(\);/);
});

test("la release 0.36.28 è allineata tra app, staff, manifest e cache", () => {
  assert.match(app, /APP Premium v0\.36\.28/);
  assert.match(staff, /Area staff unica v0\.36\.28/);
  assert.match(premiumBills, /app_version: "0\.36\.28"/);
  assert.match(sw, /offertalogica-premium-v03628/);
  assert.equal(manifest.version, "0.36.28");
});
