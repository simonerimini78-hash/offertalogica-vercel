import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const uiPromise = fs.readFile(new URL('../public/staff-premium.js', import.meta.url), 'utf8');

test('FASE 2B usa le priorità reali della seconda IA nella coda Staff', async () => {
  const ui = await uiPromise;
  assert.match(ui, /CONTROL_CENTER_VERSION = "premium-control-center-v0\.36\.40"/);
  assert.match(ui, /staff_required", "inconclusive", "failed"/);
  assert.match(ui, /verificationState === "quick_verify"/);
  assert.match(ui, /verificationState === "resolved_ai"/);
  assert.match(ui, /Seconda IA da eseguire/);
  assert.match(ui, /sortOperationalRows/);
  assert.match(ui, /option\(`route:\$\{key\}`/);
  assert.match(ui, /staff_required: \"Staff necessario\"/);
  assert.match(ui, /quick_verify: \"Verifica rapida\"/);
});

test('FASE 2B separa metriche globali IA dalla coda umana autorizzata', async () => {
  const ui = await uiPromise;
  assert.match(ui, /premium_staff_permission_allowed/);
  assert.match(ui, /p_permission_key: "view_control"/);
  assert.match(ui, /automatic_screening_status", "review_recommended"/);
  assert.match(ui, /red_verification_state/);
  assert.match(ui, /Rosse · \$\{CONTROL_METRICS_DAYS\} gg/);
  assert.match(ui, /Risolte IA/);
  assert.match(ui, /IA \+ verifica/);
  assert.match(ui, /Staff necessario/);
});

test('metriche FASE 2B usano human_seconds e costi reali senza inventare costo umano', async () => {
  const ui = await uiPromise;
  assert.match(ui, /human_seconds, completed_at/);
  assert.match(ui, /estimated_cost_eur/);
  assert.match(ui, /Costo IA \/ caso/);
  assert.match(ui, /Costo umano stimato · tariffa non configurata/);
  assert.doesNotMatch(ui, /HUMAN_HOURLY_RATE|costo_orario|hourlyRate/);
});

test('pratica storica completata non invita più a eseguire una seconda IA impossibile', async () => {
  const ui = await uiPromise;
  assert.match(ui, /\["completed", "canceled"\]\.includes\(row\.check\.status\)/);
  assert.match(ui, /Questa pratica è precedente alla seconda verifica IA, che non è stata eseguita su questo controllo\./);
  assert.match(ui, /: "Questa pratica è precedente alla seconda verifica IA\. Puoi eseguirla ora sulla stessa bolletta\."/);
});

test('FASE 2B non inventa code lettura cliente o riapertura per premium_checks', async () => {
  const ui = await uiPromise;
  assert.doesNotMatch(ui, /In attesa lettura cliente/);
  assert.doesNotMatch(ui, /route:reopened|route:riapert/);
  assert.match(ui, /In attesa integrazione/);
});

test('FASE 2B resta nel frontend Staff e non introduce nuove API o SQL', async () => {
  const ui = await uiPromise;
  assert.match(ui, /client\.from\("premium_bills"\)/);
  assert.match(ui, /client\.from\("premium_analysis_runs"\)/);
  assert.doesNotMatch(ui, /\/api\/staff-control-center|\/api\/premium-control-center/);
});
