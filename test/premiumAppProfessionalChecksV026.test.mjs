import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../public/app.html', import.meta.url), 'utf8');
const cloudBills = await readFile(new URL('../public/app-premium-bills.js', import.meta.url), 'utf8');
const sw = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/premium-checks-v0.26.sql', import.meta.url), 'utf8');
const verify = await readFile(new URL('../supabase/premium-checks-v0.26-verify.sql', import.meta.url), 'utf8');
const trafficMigration = await readFile(new URL('../supabase/premium-traffic-light-v0.36.3.sql', import.meta.url), 'utf8');
const trafficVerify = await readFile(new URL('../supabase/premium-traffic-light-v0.36.3-verify.sql', import.meta.url), 'utf8');

test('Premium v0.36.3 limita la richiesta umana alle anomalie rosse', () => {
  assert.match(html, /APP Premium v0\.36\.8/);
  assert.match(html, /La verifica dello staff è disponibile solo per le anomalie rosse/);
  assert.doesNotMatch(html, /FLUSSO ATTIVO|Ogni bolletta viene analizzata dall’IA/);
  assert.match(cloudBills, /function canRequestCheck\(bill, check\)/);
  assert.match(cloudBills, /automatic_screening_status === \"review_recommended\"/);
  assert.match(cloudBills, /data-cloud-check-request/);
  assert.match(cloudBills, /RICHIEDI CONTROLLO/);
  assert.match(cloudBills, /window\.confirm/);
  assert.match(cloudBills, /Autorizzi lo staff incaricato/);
});

test('Il client richiede il controllo tramite RPC atomica e ricarica lo stato reale', () => {
  assert.match(cloudBills, /client\.rpc\("premium_request_check", \{ p_bill_id: bill\.id \}\)/);
  assert.match(cloudBills, /\.from\("premium_checks"\)/);
  assert.match(cloudBills, /\.from\("premium_anomalies"\)/);
  assert.match(cloudBills, /customer_message/);
  assert.match(cloudBills, /possible_saving/);
  assert.match(cloudBills, /offertalogica:professional-checks-changed/);
  assert.doesNotMatch(cloudBills, /premium_check_notes/);
});

test('Gli stati cliente coprono presa in carico, integrazione ed esiti', () => {
  for (const value of ['pending', 'assigned', 'in_review', 'more_info_required', 'completed']) {
    assert.match(cloudBills, new RegExp(value));
  }
  for (const label of ['Verifica richiesta', 'Verifica in corso', 'Integrazione', 'Verde · Regolare', 'Rosso · Anomalia', 'Giallo · Avviso']) {
    assert.match(cloudBills, new RegExp(label));
  }
  assert.match(cloudBills, /estimated_impact_eur/);
  assert.match(cloudBills, /Impatto stimato/);
});

test('La migrazione protegge proprietà, abbonamento e duplicati', () => {
  assert.match(migration, /create or replace function public\.premium_request_check\(p_bill_id uuid\)/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /public\.premium_has_service_access\(\)/);
  assert.match(migration, /bill\.user_id = v_user_id/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /premium_checks_bill_active_uidx/);
  assert.match(migration, /consent_type[\s\S]*'remote_review'/);
  assert.match(migration, /premium-check-v0\.26/);
  assert.match(migration, /status <> 'canceled'/);
  assert.match(migration, /premium_sync_bill_from_check/);
  assert.match(migration, /premium_checks_sync_bill/);
  assert.match(migration, /processing_status = 'queued'/);
  assert.match(migration, /customer_status = 'awaiting_review'/);
  assert.match(migration, /revoke all on function public\.premium_request_check\(uuid\) from public, anon/i);
  assert.doesNotMatch(migration, /drop table/i);
});

test('La verifica controlla RPC, indice, lettura cliente e note interne', () => {
  for (const field of [
    'request_function_present',
    'authenticated_can_execute',
    'anon_cannot_execute',
    'request_function_is_security_definer',
    'bill_status_sync_trigger_present',
    'remote_review_consent_recorded',
    'duplicate_request_index_present',
    'customer_can_read_own_checks',
    'internal_notes_remain_staff_only'
  ]) {
    assert.match(verify, new RegExp(field));
  }
});


test('La regola server accetta soltanto il rosso', () => {
  assert.match(trafficMigration, /v_screening_status <> 'review_recommended'/);
  assert.match(trafficMigration, /v_processing_status <> 'completed'/);
  assert.match(trafficMigration, /v_customer_status <> 'anomaly_found'/);
  assert.doesNotMatch(trafficMigration, /'inconclusive', 'failed'/);
  assert.match(trafficMigration, /premium-traffic-light-v0\.36\.3/);
  assert.match(trafficVerify, /legacy_yellow_staff_rule_still_present/);
});

test('Cache e frontend non contengono chiavi segrete', () => {
  assert.match(sw, /offertalogica-premium-v0368/);
  assert.doesNotMatch(sw, /offertalogica-premium-v25/);
  assert.doesNotMatch(cloudBills, /service_role/i);
  assert.doesNotMatch(cloudBills, /sb_secret_/i);
  assert.doesNotMatch(cloudBills, /innerHTML\s*=/);
});
