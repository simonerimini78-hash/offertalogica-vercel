import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const auth = await readFile(new URL("../public/app-auth.js", import.meta.url), "utf8");
const staffHtml = await readFile(new URL("../public/staff.html", import.meta.url), "utf8");
const staffJs = await readFile(new URL("../public/staff.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/premium-complimentary-v0.36.10.sql", import.meta.url), "utf8");
const verify = await readFile(new URL("../supabase/premium-complimentary-v0.36.10-verify.sql", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

 test("v0.36.10 sostituisce il blocco permanente con un avviso compatto e popup", () => {
  assert.match(app, /id="premiumInfoOpen"/);
  assert.match(app, /id="premiumInfoLayer"[^>]*hidden/);
  assert.match(app, /aria-haspopup="dialog"/);
  assert.match(app, /Prova, condizioni e prezzi/);
  assert.match(app, /premiumInfoLayer\.hidden=false/);
  assert.match(app, /event\.key==='Escape'/);
  assert.doesNotMatch(app, /<div class="premium-preview-head"><strong>Servizio Premium/);
});

test("v0.36.10 mostra correttamente il piano omaggio nell’app", () => {
  assert.match(auth, /premium-complimentary/);
  assert.match(auth, /Premium offerto da OffertaLogica/);
  assert.match(auth, /0 € · offerto da OffertaLogica/);
  assert.match(auth, /Nessun rinnovo automatico/);
  assert.match(auth, /Premium completo · nessun pagamento/);
});

test("v0.36.10 consente soltanto agli amministratori di concedere e revocare omaggi", () => {
  assert.match(migration, /premium_admin_set_complimentary/);
  assert.match(migration, /premium_admin_revoke_complimentary/);
  assert.match(migration, /premium_is_staff\(array\['admin'\]\)/);
  assert.match(migration, /premium_complimentary_paid_subscription_conflict/);
  assert.match(migration, /v_update_existing boolean := false/);
  assert.match(migration, /Gli storici[\s\S]+Stripe terminati restano invece separati/);
  assert.match(migration, /plan_code = 'premium-complimentary'/);
  assert.match(migration, /included_bills_per_year = 1200/);
  assert.match(migration, /provider = 'offertalogica-complimentary'/);
  assert.match(migration, /interval '90 days'/);
  assert.match(migration, /revoke all on function public\.premium_admin_set_complimentary/);
  assert.match(migration, /grant execute on function public\.premium_admin_set_complimentary[^;]+authenticated, service_role/s);
});

test("v0.36.10 registra gli omaggi e li include nella pulizia a scadenza", () => {
  assert.match(migration, /create table if not exists public\.premium_complimentary_events/);
  assert.match(migration, /action in \('grant', 'extend', 'revoke'\)/);
  assert.match(migration, /premium_trial_cleanup_candidates/);
  assert.match(migration, /premium_finalize_trial_data_purge/);
  assert.match(migration, /offertalogica-complimentary/);
  assert.match(verify, /premium_complimentary_v0\.36\.10_ok/);
});

test("v0.36.10 aggiunge la gestione omaggi all’area clienti staff", () => {
  assert.match(staffHtml, /id="staffComplimentaryLayer"/);
  assert.match(staffHtml, /Senza scadenza/);
  assert.match(staffJs, /REGALA PREMIUM/);
  assert.match(staffJs, /GESTISCI OMAGGIO/);
  assert.match(staffJs, /premium_admin_set_complimentary/);
  assert.match(staffJs, /premium_admin_revoke_complimentary/);
  assert.match(staffJs, /L’archivio passerà in sola lettura per 90 giorni/);
});

test("v0.36.10 aggiorna versione applicativa e cache PWA", () => {
  assert.match(app, /APP Premium v0\.36\.10/);
  assert.match(sw, /offertalogica-premium-v03610/);
});
