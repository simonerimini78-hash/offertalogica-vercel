import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const auth = await readFile(new URL("../public/app-auth.js", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const bills = await readFile(new URL("../public/app-premium-bills.js", import.meta.url), "utf8");
const staffHtml = await readFile(new URL("../public/staff.html", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/premium-existing-user-enrollment-v0.36.16.sql", import.meta.url), "utf8");
const verify = await readFile(new URL("../supabase/premium-existing-user-enrollment-v0.36.16-verify.sql", import.meta.url), "utf8");

test("v0.36.16 associa un utente Auth esistente senza toccare i ruoli staff", () => {
  assert.match(migration, /create or replace function public\.premium_ensure_current_user_profile\(\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(migration, /from auth\.users users/);
  assert.match(migration, /insert into public\.premium_profiles/);
  assert.doesNotMatch(migration, /insert into public\.premium_staff_members|update public\.premium_staff_members|delete from public\.premium_staff_members/);
  assert.doesNotMatch(migration, /insert into public\.premium_subscriptions/);
  assert.match(migration, /grant execute on function public\.premium_ensure_current_user_profile\(\)[\s\S]*authenticated/);
  assert.match(verify, /anon_cannot_enroll/);
  assert.match(verify, /premium_existing_user_enrollment_v0\.36\.16_ok/);
});

test("l'app recupera il profilo mancante prima di mostrare il blocco Premium", () => {
  assert.match(auth, /async function ensureCurrentUserPremiumProfile\(profile\)/);
  assert.match(auth, /client\.rpc\("premium_ensure_current_user_profile"\)/);
  assert.match(auth, /if \(await ensureCurrentUserPremiumProfile\(profile\)\)[\s\S]*results = await fetchAccountData\(userId\)/);
  assert.match(auth, /if \(await activateBetaTrialIfEligible\(profile, subscription, acceptanceStatus\)\)/);
  assert.match(auth, /state\.legalPanel\.hidden = !profile/);
});

test("app, staff e cache sono allineati alla v0.36.16", () => {
  assert.match(app, /APP Premium v0\.36\.23/);
  assert.match(bills, /app_version: "0\.36\.23"/);
  assert.match(staffHtml, /controllo costi · v0\.36\.23/);
  assert.match(staffHtml, /Area staff unica v0\.36\.23/);
  assert.doesNotMatch(staffHtml, /controllo costi · v0\.36\.3/);
  assert.match(sw, /offertalogica-premium-v03623/);
});
