import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('API riusa premium-ai-analysis e crea un run red_verification separato', () => {
  const api = read('api/premium-ai-analysis.js');
  assert.match(api, /body\?\.action === "verify_red"/);
  assert.match(api, /origin: "red_verification"/);
  assert.match(api, /verifyPremiumCustomer/);
  assert.match(api, /downloadPremiumBill/);
  assert.match(api, /insertPremiumAiCostEvent/);
  assert.doesNotMatch(api, /\/api\/premium-ai-red/);
});

test('client esegue la seconda IA prima di premium_request_check e non crea check se resolved_ai', () => {
  const app = read('public/app-premium-bills.js');
  const fn = app.slice(app.indexOf('async function requestCheck('), app.indexOf('async function runAutomaticAnalysis('));
  const verifyIndex = fn.indexOf('action: "verify_red"');
  const rpcIndex = fn.indexOf('premium_request_check');
  assert.ok(verifyIndex >= 0, 'verify_red assente');
  assert.ok(rpcIndex > verifyIndex, 'RPC umana deve avvenire dopo seconda IA');
  const resolvedIndex = fn.indexOf('redVerification?.decision === "resolved_ai"');
  const resolvedReturn = fn.indexOf('return;', resolvedIndex);
  assert.ok(resolvedIndex >= 0 && resolvedReturn > resolvedIndex && resolvedReturn < rpcIndex, 'resolved_ai deve uscire prima della RPC Staff');
});

test('stato seconda verifica è persistito sulla bolletta e invalida risultati vecchi dopo nuova prima analisi', () => {
  const api = read('api/premium-ai-analysis.js');
  const app = read('public/app-premium-bills.js');
  for (const field of ['red_verification_state','red_verification_result','red_verification_run_id','red_verified_at']) {
    assert.match(api, new RegExp(field));
    assert.match(app, new RegExp(field));
  }
  assert.match(api, /resetRedVerificationValues\(\)/);
});

test('migrazione è additiva: nessuna nuova tabella o API, origin red_verification e guardia scritture client', () => {
  const sql = read('supabase/premium-red-verification-v0.36.31.sql');
  assert.doesNotMatch(sql, /create\s+table/i);
  assert.match(sql, /add column if not exists red_verification_state/i);
  assert.match(sql, /add column if not exists red_verification_result/i);
  assert.match(sql, /add column if not exists red_verification_run_id/i);
  assert.match(sql, /add column if not exists red_verified_at/i);
  assert.match(sql, /'red_verification'/);
  assert.match(sql, /premium_guard_red_verification_client_write/);
  assert.match(sql, /request\.jwt\.claim\.role/);
});

test('service worker forza cache UX bollette v0.36.49', () => {
  const sw = read('public/sw.js');
  assert.match(sw, /offertalogica-premium-v03649-bills-archive-by-commodity/);
});

test('app mostra secondo esito e mantiene rosso anche quando risolto dalla seconda IA', () => {
  const app = read('public/app-premium-bills.js');
  assert.match(app, /Rosso · Verificata IA/);
  assert.match(app, /Seconda verifica IA completata/);
  assert.match(app, /renderRedVerificationDetail/);
  assert.match(app, /return "red"/);
});


test('nuove bollette rosse avviano automaticamente la seconda IA senza creare consenso Staff', () => {
  const app = read('public/app-premium-bills.js');
  const analysisFn = app.slice(app.indexOf('async function runAutomaticAnalysis('), app.indexOf('async function refreshPendingAnalyses('));
  assert.match(analysisFn, /automaticRedVerificationEligible\(updated\)/);
  assert.match(analysisFn, /await runAutomaticRedVerification\(id\)/);

  const autoFn = app.slice(app.indexOf('async function runAutomaticRedVerification('), app.indexOf('async function requestCheck('));
  assert.match(autoFn, /action: "verify_red"/);
  assert.doesNotMatch(autoFn, /premium_request_check/);
  assert.doesNotMatch(autoFn, /confirmProfessionalCheck/);
  assert.doesNotMatch(autoFn, /trialStaffCheckUsed/);
  assert.match(autoFn, /verification\?\.decision === "resolved_ai"/);
  assert.match(autoFn, /customer_reply/);
  assert.match(app, /!redVerificationInFlightIds\.has\(bill\.id\)/);
});

test('confirm_offer non usa piu una conferma cliente come contratto tecnico per generare rossi', () => {
  const api = read('api/premium-ai-analysis.js');
  const app = read('public/app-premium-bills.js');
  const confirmStart = api.indexOf('if (offerDecision)');
  const redStart = api.indexOf('if (body?.action === "verify_red")');
  const confirmFlow = api.slice(confirmStart, redStart);
  assert.match(confirmFlow, /premiumContractForAutomaticComparison\(\s*decisionResult\.contract,\s*decisionResult\.normalized/);
  assert.doesNotMatch(confirmFlow, /contract:\s*decisionResult\.contract\s*[,}]/);
  assert.match(app, /decision === "confirm"[\s\S]*automaticRedVerificationEligible\(updatedBill\)[\s\S]*runAutomaticRedVerification\(billId\)/);
});


test('app sincronizza automaticamente esito e messaggio dei controlli Staff attivi', () => {
  const app = read('public/app-premium-bills.js');
  assert.match(app, /function hasActiveHumanCheck\(check\)/);
  assert.match(app, /async function refreshActiveChecks\(\)/);
  assert.match(app, /\.from\("premium_checks"\)[\s\S]*?\.select\(CHECK_COLUMNS\)[\s\S]*?\.in\("id", activeIds\)/);
  assert.match(app, /const staffCheckPending = checks\.some\(hasActiveHumanCheck\)/);
  assert.match(app, /const staffMessage = String\(check\?\.customer_message \|\| ""\)\.trim\(\)/);
  assert.match(app, /if \(staffMessage\) return staffMessage/);
  assert.match(app, /document\.addEventListener\("visibilitychange", resumeAutomaticWork\)/);
  assert.match(app, /window\.addEventListener\("focus", resumeAutomaticWork\)/);
  assert.match(app, /scheduleAutomaticWork\(0\)/);
  assert.doesNotMatch(app, /setInterval\(/);
});


test('editor offerta dichiarata resta chiuso finche il cliente non lo apre', () => {
  const app = read('public/app-premium-bills.js');
  assert.match(app, /function setDeclaredOfferEditorOpen\(editor, open\)/);
  assert.match(app, /editor\.style\.display = open \? "grid" : "none"/);
  assert.match(app, /setDeclaredOfferEditorOpen\(editor, false\)/);
  assert.match(app, /MODIFICA DATI OFFERTA/);
  assert.match(app, /setDeclaredOfferEditorOpen\(editor, editor\.hidden\)/);
});


test('storico consumi conserva il periodo e distingue offerta letta da catalogo non verificato', () => {
  const api = read('api/premium-ai-analysis.js');
  const app = read('public/app-premium-bills.js');
  const sql = read('supabase/premium-consumption-history-v0.36.42.sql');
  assert.match(api, /premiumBillValuesWithPeriodConsumption/);
  assert.match(api, /consumo_periodo_luce_kwh/);
  assert.match(api, /consumo_periodo_gas_smc/);
  assert.match(api, /offerta_letta_non_verificata_catalogo/);
  assert.match(api, /Storico consumi in costruzione/);
  assert.match(api, /trafficLight: "neutral"/);
  assert.match(api, /const informationalCodes = new Set/);
  assert.match(api, /actionableReasons\.length === 0/);
  assert.match(api, /status: "clear"/);
  assert.match(api, /summary: "Controllo completato: nessuna anomalia rilevata\."/);
  assert.match(app, /comparisonConsumptionForUtility/);
  assert.match(app, /history_partial/);
  assert.match(app, /history_12m/);
  assert.doesNotMatch(app, /history_annualized/);
  assert.match(app, /comparisonIntervalsOverlap/);
  assert.match(sql, /premium_sync_customer_period_consumption/);
  assert.doesNotMatch(sql, /create\s+table/i);
  assert.match(sql, /consumo_periodo_luce_kwh/);
  assert.match(sql, /consumo_periodo_gas_smc/);
});
