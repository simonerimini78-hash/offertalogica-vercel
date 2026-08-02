import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../public/app.html', import.meta.url), 'utf8');
const cloudBills = await readFile(new URL('../public/app-premium-bills.js', import.meta.url), 'utf8');
const utilities = await readFile(new URL('../public/app-utilities.js', import.meta.url), 'utf8');
const sw = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/premium-bills-v0.25.sql', import.meta.url), 'utf8');
const verify = await readFile(new URL('../supabase/premium-bills-v0.25-verify.sql', import.meta.url), 'utf8');

test('Premium v0.25 aggiunge archivio cloud senza rimuovere archivio locale', () => {
  assert.match(html, /APP Premium v0\.25/);
  assert.match(html, /id="premiumCloudBillsCard"/);
  assert.match(html, /id="premiumCloudBillUtility"/);
  assert.match(html, /id="premiumCloudBillFile"/);
  assert.match(html, /id="premiumCloudBillList"/);
  assert.match(html, /id="billFileInput"/);
  assert.match(html, /<script src="\/app-premium-bills\.js"><\/script>/);
  assert.match(html, /OffertaLogicaPremiumBills\?\.init\(\)/);
});

test('Il caricamento usa bucket privato, percorso utente e record premium_bills', () => {
  assert.match(cloudBills, /const BUCKET = "premium-bills"/);
  assert.match(cloudBills, /\.storage\s*\.from\(BUCKET\)\s*\.upload\(/s);
  assert.match(cloudBills, /currentUser\.id.*billId/s);
  assert.match(cloudBills, /\.from\("premium_bills"\)\s*\.insert\(/s);
  assert.match(cloudBills, /processing_status: "uploaded"/);
  assert.match(cloudBills, /customer_status: "awaiting_review"/);
  assert.match(cloudBills, /contentType: "application\/pdf"/);
  assert.match(cloudBills, /upsert: false/);
});

test('Il client valida PDF, dimensione, hash e annulla il record se lo Storage rifiuta', () => {
  assert.match(cloudBills, /MAX_FILE_SIZE = 20_000_000/);
  assert.match(cloudBills, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(cloudBills, /file\.name.*\.pdf/s);
  assert.ok(cloudBills.indexOf('.from(\"premium_bills\")') < cloudBills.indexOf('.upload(storagePath, file'), 'Il record quota deve precedere l’upload Storage');
  assert.match(cloudBills, /await client\.storage\.from\(BUCKET\)\.remove\(\[storagePath\]\)/);
  assert.match(cloudBills, /\.delete\(\)\s*\.eq\(\"id\", billId\)/s);
  assert.match(cloudBills, /premium_bills_user_sha_active_uidx/);
});

test('Apertura ed eliminazione usano le API Storage del client autenticato', () => {
  assert.match(cloudBills, /\.storage\.from\(BUCKET\)\.download\(bill\.storage_path\)/);
  assert.match(cloudBills, /Documento cloud Premium/);
  assert.match(cloudBills, /\.storage\.from\(BUCKET\)\.remove\(\[bill\.storage_path\]\)/);
  assert.match(cloudBills, /\.from\("premium_bills"\)\s*\.delete\(\)/s);
  assert.match(cloudBills, /bill\.processing_status !== "uploaded"/);
  assert.match(cloudBills, /window\.confirm/);
});

test('Le modifiche utenze aggiornano il selettore cloud senza ricaricare la pagina', () => {
  assert.match(utilities, /offertalogica:utilities-changed/);
  assert.match(cloudBills, /addEventListener\("offertalogica:utilities-changed"/);
});

test('La migrazione applica quota rolling annuale e duplicati lato database', () => {
  assert.match(migration, /create or replace function public\.premium_can_add_bill\(p_utility_id uuid\)/i);
  assert.match(migration, /included_bills_per_year/);
  assert.match(migration, /expected_bills_per_year/);
  assert.match(migration, /interval '1 year'/);
  assert.match(migration, /create unique index if not exists premium_bills_user_sha_active_uidx/i);
  assert.match(migration, /premium_can_add_bill\(utility_id\)/);
  assert.match(migration, /premium_bills_storage_owner_insert/);
  assert.match(migration, /premium_bills_storage_owner_delete/);
  assert.match(migration, /processing_status = 'uploaded'/);
  assert.doesNotMatch(migration, /drop table/i);
  assert.match(verify, /private_pdf_bucket_valid/);
});

test('La cache include il modulo cloud ed esclude chiavi segrete', () => {
  assert.match(sw, /offertalogica-premium-v25/);
  assert.match(sw, /"\/app-premium-bills\.js"/);
  assert.doesNotMatch(sw, /offertalogica-premium-v24/);
  assert.doesNotMatch(cloudBills, /service_role/i);
  assert.doesNotMatch(cloudBills, /sb_secret_/i);
  assert.doesNotMatch(cloudBills, /innerHTML\s*=/);
});
