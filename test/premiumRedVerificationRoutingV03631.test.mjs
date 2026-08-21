import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  PREMIUM_RED_VERIFIER_VERSION,
  normalizePremiumRedVerification,
  routePremiumRedReasons,
  verifyPremiumRedPdf,
} from '../lib/premiumRedVerifier.js';

const reason = code => ({ code, title: code, description: 'test', severity: 'high', source: 'test' });
const verified = overrides => ({
  issue: 'Prezzo diverso dal contratto',
  evidence: [{ page: 2, fact: 'Prezzo vendita 0,20 €/kWh' }],
  verification_result: 'confirmed',
  confidence: 'medium',
  can_resolve_alone: 'yes',
  customer_reply: 'La seconda verifica conferma la differenza.',
  escalation_reason: '',
  missing_data: [],
  ...overrides,
});

test('routing FASE2: anomalie deterministiche vanno a auto_ai', () => {
  const codes = [
    'prezzo_luce_diverso_dal_contratto',
    'prezzo_gas_diverso_dal_contratto',
    'quota_fissa_luce_diversa',
    'quota_fissa_gas_diversa',
    'indice_luce_diverso_dal_contratto',
    'indice_gas_diverso_dal_contratto',
    'spread_luce_diverso_dal_contratto',
    'spread_gas_diverso_dal_contratto',
  ];
  for (const code of codes) assert.equal(routePremiumRedReasons([reason(code)]).route, 'auto_ai', code);
});

test('routing FASE2: casi da verifica rapida vanno a ai_verify', () => {
  const codes = [
    'tipo_prezzo_diverso_dal_contratto',
    'fornitore_diverso_dal_contratto',
    'documento_doppio_addebito',
    'documento_conguaglio',
    'documento_variazione_prezzo',
    'documento_quota_inattesa',
    'documento_sconto_mancante',
    'documento_importo_inusuale',
    'coerenza_prezzo_luce',
  ];
  for (const code of codes) assert.equal(routePremiumRedReasons([reason(code)]).route, 'ai_verify', code);
});

test('routing FASE2: penali, documento_altro e codici sconosciuti richiedono Staff', () => {
  for (const code of ['documento_penale', 'documento_altro', 'nuovo_codice_non_classificato']) {
    assert.equal(routePremiumRedReasons([reason(code)]).route, 'staff_required', code);
  }
});

test('routing misto usa priorità staff_required > ai_verify > auto_ai', () => {
  assert.equal(routePremiumRedReasons([
    reason('prezzo_luce_diverso_dal_contratto'),
    reason('documento_conguaglio'),
  ]).route, 'ai_verify');
  assert.equal(routePremiumRedReasons([
    reason('prezzo_luce_diverso_dal_contratto'),
    reason('documento_conguaglio'),
    reason('documento_penale'),
  ]).route, 'staff_required');
});

test('auto_ai si chiude senza umano solo con conferma, evidenza e nessun dato mancante', () => {
  const routeInfo = routePremiumRedReasons([reason('prezzo_luce_diverso_dal_contratto')]);
  const result = normalizePremiumRedVerification(verified(), { routeInfo, firstAnalysisRunId: 'run-1' });
  assert.equal(result.decision, 'resolved_ai');
  assert.equal(result.can_resolve_alone, 'yes');
  assert.equal(result.first_analysis_run_id, 'run-1');
  assert.equal(result.version, PREMIUM_RED_VERIFIER_VERSION);
});

test('disaccordo tra prima e seconda IA non viene mai risolto automaticamente', () => {
  const routeInfo = routePremiumRedReasons([reason('prezzo_luce_diverso_dal_contratto')]);
  for (const verification_result of ['not_confirmed', 'inconclusive', 'needs_data']) {
    const result = normalizePremiumRedVerification(verified({ verification_result }), { routeInfo });
    assert.equal(result.decision, 'inconclusive', verification_result);
    assert.equal(result.agreement_with_first_check, false);
  }
});

test('dati mancanti impediscono la chiusura automatica', () => {
  const routeInfo = routePremiumRedReasons([reason('quota_fissa_luce_diversa')]);
  const result = normalizePremiumRedVerification(verified({ missing_data: ['pagina contratto con quota fissa'] }), { routeInfo });
  assert.equal(result.decision, 'inconclusive');
});

test('ai_verify resta verifica umana rapida anche quando la seconda IA conferma', () => {
  const routeInfo = routePremiumRedReasons([reason('documento_conguaglio')]);
  const result = normalizePremiumRedVerification(verified(), { routeInfo });
  assert.equal(result.decision, 'quick_verify');
});

test('staff_required resta sempre Staff anche con risultato inconcludente o apparentemente risolvibile', () => {
  const routeInfo = routePremiumRedReasons([reason('documento_penale')]);
  assert.equal(normalizePremiumRedVerification(verified(), { routeInfo }).decision, 'staff_required');
  assert.equal(normalizePremiumRedVerification(verified({ verification_result: 'inconclusive' }), { routeInfo }).decision, 'staff_required');
});

test('la confidence è categoriale e non introduce una soglia numerica nascosta', () => {
  const routeInfo = routePremiumRedReasons([reason('prezzo_gas_diverso_dal_contratto')]);
  const low = normalizePremiumRedVerification(verified({ confidence: 'low' }), { routeInfo });
  assert.equal(low.confidence, 'low');
  assert.equal(low.decision, 'resolved_ai');
});

test('seconda verifica usa direttamente il PDF e JSON schema strutturato', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ol-red-verify-'));
  const pdf = path.join(dir, 'test.pdf');
  await fs.writeFile(pdf, Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF'));
  let requestSeen = null;
  const transport = async ({ request, profile }) => {
    requestSeen = request;
    assert.equal(profile, PREMIUM_RED_VERIFIER_VERSION);
    return {
      id: 'resp-test-1',
      output_text: JSON.stringify(verified()),
    };
  };
  try {
    const output = await verifyPremiumRedPdf({
      filePath: pdf,
      filename: 'test.pdf',
      reasons: [reason('prezzo_luce_diverso_dal_contratto')],
      firstAnalysis: { prezzo_luce_eur_kwh: 0.2, codice_fiscale: 'NON_DEVE_ESSERE_INVIATO' },
      firstAnalysisRunId: 'run-first',
      contract: { verification_status: 'verified', electricity_price_eur_kwh: 0.18 },
      apiKey: 'test-key',
      model: 'test-model',
      transport,
      env: { PDF_AI_FILE_ID_THRESHOLD_BYTES: '12000000' },
    });
    assert.equal(output.result.decision, 'resolved_ai');
    assert.equal(output.responseId, 'resp-test-1');
    assert.equal(requestSeen.text.format.type, 'json_schema');
    assert.equal(requestSeen.text.format.strict, true);
    assert.match(requestSeen.input[1].content[0].file_data, /^data:application\/pdf;base64,/);
    const context = requestSeen.input[1].content[1].text;
    assert.match(context, /prezzo_luce_eur_kwh/);
    assert.doesNotMatch(context, /NON_DEVE_ESSERE_INVIATO/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
