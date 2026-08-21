import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('Staff riusa premium-ai-analysis e non introduce una nuova API', () => {
  const api = read('api/premium-ai-analysis.js');
  assert.match(api, /body\?\.action === "verify_red"/);
  assert.match(api, /Boolean\(body\?\.checkId\)/);
  assert.match(api, /loadPremiumCheckAndBill/);
  assert.match(api, /permission: "manage_checks"/);
  assert.match(api, /origin: "red_verification"/);
  assert.doesNotMatch(api, /\/api\/premium-ai-red/);
});

test('la verifica Staff usa la pratica esistente e non crea premium_checks', () => {
  const api = read('api/premium-ai-analysis.js');
  const match = api.match(/if \(body\?\.action === "verify_red"\) \{([\s\S]*?)\n      \}\n\n      assertPremiumAiConfigured\(backend\);/);
  assert.ok(match, 'blocco verify_red non trovato');
  const block = match[1];
  assert.match(block, /checkId: body\.checkId/);
  assert.doesNotMatch(block, /premium_request_check/);
  assert.doesNotMatch(block, /from\("premium_checks"\)\.insert/);
});

test('snapshot red accetta bollette già analizzate e valida storage', () => {
  const verifier = read('lib/premiumRedVerifier.js');
  assert.match(verifier, /automatic_screening_status !== "review_recommended"/);
  assert.match(verifier, /storage_bucket !== config\.bucket/);
  assert.match(verifier, /file_size/);
  assert.match(verifier, /processing_status/);
});

test('dashboard Staff carica e mostra lo stato della seconda verifica', () => {
  const ui = read('public/staff-premium.js');
  assert.match(ui, /red_verification_state, red_verification_result, red_verification_run_id, red_verified_at/);
  assert.match(ui, /function renderRedVerification/);
  assert.match(ui, /Seconda verifica IA/);
  assert.match(ui, /AVVIA SECONDA VERIFICA IA/);
  assert.match(ui, /result\.escalation_reason/);
  assert.match(ui, /result\.customer_reply/);
});

test('pulsante Staff chiama verify_red con checkId della pratica corrente', () => {
  const ui = read('public/staff-premium.js');
  assert.match(ui, /action: "verify_red", checkId: row\.check\.id/);
  assert.match(ui, /La pratica esistente non verrà duplicata né chiusa automaticamente/);
});

test('run red_verification non sostituisce la normale lettura IA nello Staff', () => {
  const ui = read('public/staff-premium.js');
  assert.match(ui, /\.neq\("origin", "red_verification"\)/);
});

test('resolved_ai non chiude automaticamente una pratica preesistente', () => {
  const ui = read('public/staff-premium.js');
  assert.match(ui, /Poiché questa pratica era già aperta, resta comunque allo Staff la chiusura finale/);
  assert.doesNotMatch(ui, /premium_staff_complete_check[^\n]*resolved_ai/);
});


test('router v0.36.33 mantiene il filtro dei gialli e permette di ricalcolare risultati precedenti', () => {
  const verifier = read('lib/premiumRedVerifier.js');
  const api = read('api/premium-ai-analysis.js');
  const ui = read('public/staff-premium.js');
  assert.match(verifier, /premium-red-verifier-v0\.36\.33/);
  assert.match(verifier, /trafficLight === "red"/);
  assert.match(verifier, /first_red_reasons: reasonContext\(redRoutingReasons\(reasons\)\)/);
  assert.match(verifier, /necessaria una verifica Staff per risolvere il disaccordo/);
  assert.match(api, /cachedResult\.version === PREMIUM_RED_VERIFIER_VERSION/);
  assert.match(ui, /RICALCOLA SECONDA VERIFICA IA/);
  assert.match(ui, /RED_VERIFIER_VERSION = "premium-red-verifier-v0\.36\.33"/);
});
