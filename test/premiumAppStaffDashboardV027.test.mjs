import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../public/staff-premium.html', import.meta.url), 'utf8');
const staff = await readFile(new URL('../public/staff-premium.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.html', import.meta.url), 'utf8');
const sw = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/premium-staff-v0.27.sql', import.meta.url), 'utf8');
const verify = await readFile(new URL('../supabase/premium-staff-v0.27-verify.sql', import.meta.url), 'utf8');

test('Premium v0.27 aggiunge una dashboard staff separata e non pubblica', () => {
  assert.match(html, /Dashboard controlli Premium/);
  assert.match(html, /noindex,nofollow,noarchive/);
  assert.match(html, /Area riservata allo staff autorizzato · v0\.29/);
  assert.match(html, /id="staffLoginForm"/);
  assert.match(html, /id="staffDashboard"/);
  assert.match(html, /<script src="\/staff-premium\.js"><\/script>/);
  assert.doesNotMatch(html, /Crea account/i);
  assert.match(app, /APP Premium v0\.29/);
  assert.match(sw, /offertalogica-premium-v29/);
});

test('Il client staff verifica il ruolo e usa una sessione separata', () => {
  assert.match(staff, /offertalogica-premium-staff-auth/);
  assert.match(staff, /premium_staff_members/);
  assert.match(staff, /MANAGER_ROLES = new Set\(\["reviewer", "admin"\]\)/);
  assert.match(staff, /signInWithPassword/);
  assert.match(staff, /signOut/);
  assert.match(staff, /persistSession: true/);
  assert.doesNotMatch(staff, /signUp/);
});

test('La coda carica controlli, bollette, utenze e profili senza leggere auth.users', () => {
  assert.match(staff, /\.from\("premium_checks"\)/);
  assert.match(staff, /fetchMap\(\s*"premium_bills"/s);
  assert.match(staff, /fetchMap\("premium_utilities"/);
  assert.match(staff, /fetchMap\("premium_profiles"/);
  assert.match(staff, /full_name, email, phone/);
  assert.doesNotMatch(staff, /\.from\("auth\.users"\)/);
  for (const label of ['Da assegnare', 'In lavorazione', 'Richieste integrazione', 'Completati oggi']) {
    assert.match(html, new RegExp(label));
  }
});

test('La lavorazione staff usa RPC atomiche per presa in carico, stato, note, anomalie ed esito', () => {
  for (const rpc of [
    'premium_staff_claim_check',
    'premium_staff_set_check_status',
    'premium_staff_add_check_note',
    'premium_staff_add_anomaly',
    'premium_staff_delete_anomaly',
    'premium_staff_complete_check'
  ]) {
    assert.match(staff, new RegExp(rpc));
    assert.match(migration, new RegExp(`create or replace function public\\.${rpc}`));
  }
  assert.match(staff, /COMPLETA CONTROLLO/);
  assert.match(staff, /Messaggio conclusivo al cliente/);
  assert.match(staff, /Minuti di revisione/);
  assert.match(staff, /window\.confirm/);
});

test('Il PDF privato è leggibile soltanto da reviewer e admin autorizzati', () => {
  assert.match(staff, /\.storage\.from\(BUCKET\)\.download\(row\.bill\.storage_path\)/);
  assert.match(migration, /premium_bills_storage_staff_select/);
  assert.match(migration, /premium_is_staff\(array\['reviewer', 'admin'\]\)/);
  assert.doesNotMatch(migration, /premium_bills_storage_staff_(insert|delete|update)/);
});

test('Il database applica transizioni, assegnazione, dettaglio anomalie e costo umano', () => {
  assert.match(migration, /premium_invalid_check_transition/);
  assert.match(migration, /premium_check_assigned_to_other_staff/);
  assert.match(migration, /premium_anomaly_required/);
  assert.match(migration, /human_seconds = coalesce\(p_human_seconds, 0\)/);
  assert.match(migration, /status = 'completed'/);
  assert.match(migration, /add column if not exists email text not null default ''/);
  assert.match(migration, /premium_on_auth_user_email_updated/);
  assert.doesNotMatch(migration, /drop table/i);
});

test('La verifica copre permessi, storage, indici e funzioni staff', () => {
  for (const field of [
    'profile_email_column_present',
    'profile_email_sync_trigger_present',
    'staff_queue_indexes_present',
    'staff_can_read_private_pdfs',
    'staff_functions_present',
    'authenticated_staff_can_execute',
    'anon_cannot_execute',
    'dashboard_is_reviewer_admin_only',
    'completion_enforces_outcome',
    'status_transitions_are_enforced'
  ]) {
    assert.match(verify, new RegExp(field));
  }
});

test('Il frontend staff non contiene chiavi segrete o HTML dinamico non sicuro', () => {
  assert.doesNotMatch(staff, /service_role/i);
  assert.doesNotMatch(staff, /sb_secret_/i);
  assert.doesNotMatch(staff, /innerHTML\s*=/);
  assert.doesNotMatch(html, /service_role/i);
});
