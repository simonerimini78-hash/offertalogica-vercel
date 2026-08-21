import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PREMIUM_RED_VERIFIER_VERSION,
  normalizePremiumRedVerification,
  routePremiumRedReasons,
} from '../lib/premiumRedVerifier.js';

const reason = code => ({ code, trafficLight: 'red', title: code, severity: 'high' });
const raw = overrides => ({
  issue: 'Fornitore diverso dal contratto e prezzo gas diverso dal contratto',
  evidence: [{ page: 2, fact: 'Offerta E.ON Gas Insieme, prezzo 0,498399 €/Smc' }],
  verification_result: 'inconclusive',
  confidence: 'high',
  can_resolve_alone: 'no',
  customer_reply: 'Senza contratto non posso concludere.',
  escalation_reason: 'Manca il contratto.',
  missing_data: [],
  ...overrides,
});

test('v0.36.34: senza riferimento affidabile i rossi contrattuali non sono presentati come anomalie della bolletta', () => {
  assert.equal(PREMIUM_RED_VERIFIER_VERSION, 'premium-red-verifier-v0.36.34');
  const routeInfo = routePremiumRedReasons([
    reason('fornitore_diverso_dal_contratto'),
    reason('prezzo_gas_diverso_dal_contratto'),
  ]);
  const result = normalizePremiumRedVerification(raw(), {
    routeInfo,
    firstAnalysisRunId: 'run-old',
    trustedContractAvailable: false,
  });
  assert.equal(result.route, 'ai_verify');
  assert.equal(result.decision, 'inconclusive');
  assert.equal(result.verification_result, 'needs_data');
  assert.equal(result.issue, 'Offerta o contratto di riferimento non verificato');
  assert.equal(result.can_resolve_alone, 'no');
  assert.equal(result.agreement_with_first_check, false);
  assert.match(result.missing_data.join(' '), /offerta|contratto/i);
  assert.match(result.escalation_reason, /riferimento contrattuale registrato/i);
  assert.doesNotMatch(result.customer_reply, /fornitore diverso|prezzo.*diverso/i);
});

test('v0.36.34: anomalie documentali indipendenti dal contratto continuano a essere verificate normalmente', () => {
  const routeInfo = routePremiumRedReasons([reason('documento_doppio_addebito')]);
  const result = normalizePremiumRedVerification(raw({
    issue: 'Doppio addebito',
    verification_result: 'confirmed',
    confidence: 'high',
    can_resolve_alone: 'yes',
    missing_data: [],
  }), {
    routeInfo,
    trustedContractAvailable: false,
  });
  assert.equal(result.verification_result, 'confirmed');
  assert.equal(result.issue, 'Doppio addebito');
  assert.equal(result.decision, 'quick_verify');
});
