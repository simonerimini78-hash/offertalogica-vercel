import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const bills = fs.readFileSync(new URL("../public/app-premium-bills.js", import.meta.url), "utf8");
const utilities = fs.readFileSync(new URL("../public/app-utilities.js", import.meta.url), "utf8");
const auth = fs.readFileSync(new URL("../public/app-auth.js", import.meta.url), "utf8");
const sql = fs.readFileSync(new URL("../supabase/premium-prelaunch-access-v0.32.sql", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/app.html", import.meta.url), "utf8");
const sw = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

test("v0.32: staff PDF access requires a non-canceled customer check", () => {
  assert.match(sql, /premium_bills_staff_select[\s\S]*premium_checks[\s\S]*status <> 'canceled'/);
  assert.match(sql, /premium_bills_storage_staff_select[\s\S]*premium_checks[\s\S]*status <> 'canceled'/);
  assert.match(sql, /premium_is_staff\(array\['reviewer', 'admin'\]\)/);
});

test("v0.32: expired subscriptions keep owner read and delete access", () => {
  assert.match(sql, /premium_bills_owner_select[\s\S]*premium_has_profile/);
  assert.match(sql, /premium_bills_owner_delete[\s\S]*premium_has_profile/);
  assert.match(sql, /premium_bills_storage_owner_select[\s\S]*premium_has_profile/);
  assert.match(sql, /premium_bills_storage_owner_delete[\s\S]*premium_has_profile/);
  assert.match(sql, /premium_utilities_owner_delete[\s\S]*premium_has_profile/);
});

test("v0.32: customer UI enters maintenance mode without active subscription", () => {
  assert.match(bills, /let maintenanceMode = false/);
  assert.match(bills, /maintenanceMode \? "ARCHIVIO"/);
  assert.match(bills, /l’archivio resta disponibile in sola gestione/);
  assert.match(bills, /if \(!maintenanceMode\) scheduleAutomaticWork/);
  assert.match(utilities, /let maintenanceMode = false/);
  assert.match(utilities, /state\.addButton\.hidden = maintenanceMode/);
  assert.match(utilities, /puoi eliminare le utenze/);
});

test("v0.32: inactive mode does not allow paid operations", () => {
  assert.match(bills, /La conferma dell’offerta richiede un abbonamento attivo/);
  assert.match(bills, /La richiesta di controllo richiede un abbonamento attivo/);
  assert.match(bills, /if \(maintenanceMode\) return;\s+const bill = bills\.find/);
  assert.match(utilities, /La modifica delle utenze richiede un abbonamento attivo/);
});

test("v0.32: version and cache are aligned", () => {
  assert.match(html, /APP Premium v0\.(?:32|35(?:\.1)?|36)/);
  assert.match(sw, /offertalogica-premium-v(?:032|0351?|036)/);
  assert.match(auth, /Archivio in sola gestione/);
});
