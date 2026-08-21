import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const uiPromise = fs.readFile(new URL('../public/staff-premium.js', import.meta.url), 'utf8');

test('FASE 2B usa le priorità reali della seconda IA nella coda Staff', async () => {
  const ui = await uiPromise;
  assert.match(ui, /CONTROL_CENTER_VERSION = "premium-control-center-v0\.36\.42"/);
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

test('metriche FASE 2B.2 usano stesso perimetro rosso e costo umano a 30 euro ora', async () => {
  const ui = await uiPromise;
  assert.match(ui, /id, bill_id, human_seconds, completed_at/);
  assert.match(ui, /humanChecksAll\.filter\(item => redIdSet\.has\(item\.bill_id\)\)/);
  assert.match(ui, /HUMAN_COST_EUR_PER_HOUR = 30/);
  assert.match(ui, /humanCost: Number\(\(\(humanSeconds \/ 3600\) \* HUMAN_COST_EUR_PER_HOUR\)/);
  assert.match(ui, /Costo IA \/ caso/);
  assert.match(ui, /pricing_verified_eur === true/);
  assert.match(ui, /premium-eur-v0\.36\.42/);
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


test('FASE 2B.1 rende esplicite le rosse senza seconda IA', async () => {
  const ui = await uiPromise;
  assert.match(ui, /Seconda IA non eseguita/);
  assert.match(ui, /secondAiNotRun: states\.filter\(value => value === "not_run"\)\.length/);
});

test('FASE 2B.2 misura tempo umano attivo e sospende il conteggio dopo inattività', async () => {
  const ui = await uiPromise;
  assert.match(ui, /ACTIVE_WORK_IDLE_MS = 5 \* 60 \* 1000/);
  assert.match(ui, /function automaticHumanSeconds\(row\)/);
  assert.match(ui, /return currentActiveHumanSeconds\(row\)/);
  assert.doesNotMatch(ui, /row\?\.check\?\.started_at/);
  assert.match(ui, /sessionStorage\.setItem\(activeWorkStorageKey/);
  assert.match(ui, /document\.visibilityState !== "hidden"/);
  assert.match(ui, /function resolvedHumanSeconds\(row, manualMinutesValue\)/);
  assert.match(ui, /p_human_seconds: humanSeconds/);
  assert.match(ui, /Dopo 5 minuti senza attività il conteggio si mette in pausa/);
});
