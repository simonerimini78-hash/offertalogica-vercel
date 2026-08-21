import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  DEFAULT_GAS_REFERENCE_PCS_GJ_SMC,
  evaluatePremiumOfferResolution,
  gasOfferPriceCompatibility,
} from '../lib/premiumOfferResolution.js';

const firstGas = {
  commodity: 'gas',
  fornitore_gas: 'E.ON Energia S.p.A.',
  nome_offerta_gas: 'E.ON Gas Insieme',
  codice_offerta_gas: 'EON-GAS-4940',
  tipo_prezzo_gas: 'fisso',
  prezzo_gas_eur_smc: 0.4984,
  quota_fissa_vendita_gas_eur_anno: 120,
  billing_period_end: '2026-06-30',
};

function candidate(overrides = {}) {
  return {
    commodity: 'gas',
    provider_name: 'E.ON Energia',
    offer_name: 'E.ON Gas Insieme',
    offer_code: 'EON-GAS-4940',
    pricing_type: 'fixed',
    unit_price: 0.494,
    annual_fixed_fee: 120,
    index_name: '',
    spread: null,
    formula: '',
    valid_from: '2026-01-01',
    valid_to: '2026-12-31',
    source_url: 'https://www.arera.it/offerte/eon-gas-insieme',
    source_title: 'ARERA - E.ON Gas Insieme',
    reference_pcs_gj_smc: DEFAULT_GAS_REFERENCE_PCS_GJ_SMC,
    ...overrides,
  };
}

test('gas: il prezzo offerta viene confrontato dopo normalizzazione PCS senza usare C sul prezzo', () => {
  const billPcs = 0.038863;
  const result = gasOfferPriceCompatibility({ referencePrice: 0.494, referencePcs: 0.03852, billPcs, billPrice: 0.4984 });
  assert.equal(result.compatible, true);
  assert.equal(result.method, 'pcs_normalized');
  assert.ok(result.normalizedExpectedPrice > 0.498 && result.normalizedExpectedPrice < 0.499);
});

test('corrispondenza web diventa verificata solo con identità, periodo, economia e fonte regolatoria effettivamente usata', () => {
  const result = evaluatePremiumOfferResolution({
    rawResolution: { search_performed: true, bill_pcs_gj_smc: 0.038863, bill_coefficient_c: 1.0123, candidates: [candidate()] },
    firstAnalysis: firstGas,
    webSources: [{ url: 'https://www.arera.it/offerte/eon-gas-insieme', title: 'ARERA' }],
  });
  assert.equal(result.status, 'verified');
  assert.equal(result.selected.auto_verifiable, true);
  assert.equal(result.selected.checks.exact_code_match, true);
  assert.equal(result.selected.checks.period_match, true);
  assert.equal(result.selected.normalization_method, 'pcs_normalized');
});

test('fonte fornitore o candidato incompleto resta proposta Staff e non modifica automaticamente', () => {
  const result = evaluatePremiumOfferResolution({
    rawResolution: { search_performed: true, bill_pcs_gj_smc: 0.038863, bill_coefficient_c: 1.01, candidates: [candidate({ source_url: 'https://www.eon-energia.com/offerta-gas' })] },
    firstAnalysis: firstGas,
    webSources: [{ url: 'https://www.eon-energia.com/offerta-gas', title: 'E.ON' }],
  });
  assert.equal(result.status, 'candidates');
  assert.equal(result.candidates[0].auto_verifiable, false);
  assert.equal(result.candidates[0].checks.authoritative_source, false);
});

test('codice offerta discordante impedisce sempre la validazione automatica', () => {
  const result = evaluatePremiumOfferResolution({
    rawResolution: { search_performed: true, bill_pcs_gj_smc: 0.038863, bill_coefficient_c: 1, candidates: [candidate({ offer_code: 'ALTRO-CODICE' })] },
    firstAnalysis: firstGas,
    webSources: [{ url: 'https://www.arera.it/offerte/eon-gas-insieme' }],
  });
  assert.equal(result.status, 'candidates');
  assert.equal(result.candidates[0].checks.identity_match, false);
});

test('seconda IA usa web_search solo per il riferimento contrattuale mancante e include le fonti', async () => {
  const verifier = await fs.readFile(new URL('../lib/premiumRedVerifier.js', import.meta.url), 'utf8');
  assert.match(verifier, /onlyContractReferenceReasons\(routeInfo\)/);
  assert.match(verifier, /type: "web_search"/);
  assert.match(verifier, /web_search_call\.action\.sources/);
  assert.match(verifier, /evaluatePremiumOfferResolution/);
});

test('cliente modifica la dichiarazione tramite la API esistente e l app rilancia la verifica rossa', async () => {
  const api = await fs.readFile(new URL('../api/premium-ai-analysis.js', import.meta.url), 'utf8');
  const app = await fs.readFile(new URL('../public/app-premium-bills.js', import.meta.url), 'utf8');
  assert.match(api, /action === "update_declared_offer"/);
  assert.match(api, /updatePremiumDeclaredOffer/);
  assert.match(app, /MODIFICA DATI OFFERTA/);
  assert.match(app, /action: "update_declared_offer"/);
  assert.match(app, /automaticRedVerificationEligible\(updatedBill\)/);
  assert.doesNotMatch(api, /\/api\/premium-offer/);
});

test('offerta storica verificata non sostituisce un contratto corrente diverso', async () => {
  const { persistPremiumVerifiedOffer } = await import('../lib/premiumOfferResolution.js');
  const calls = [];
  const current = {
    id: 'current-1', user_id: 'user-1', utility_id: 'utility-1', is_current: true,
    verification_status: 'verified', customer_confirmation_status: 'not_required', automatic_match_method: 'offer_code',
  };
  const historical = {
    id: 'old-1', user_id: 'user-1', utility_id: 'utility-1', is_current: false,
    verification_status: 'needs_review', customer_confirmation_status: 'confirmed', automatic_match_method: 'customer_declared_edit',
  };
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    let payload = [];
    if ((init.method || 'GET') === 'GET' && String(url).includes('is_current=eq.true')) payload = [current];
    else if ((init.method || 'GET') === 'GET' && String(url).includes('id=eq.old-1')) payload = [historical];
    else if (init.method === 'PATCH' && String(url).includes('id=eq.old-1')) payload = [{ ...historical, ...JSON.parse(init.body) }];
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  };
  const result = await persistPremiumVerifiedOffer({
    config: { supabaseUrl: 'https://db.test', serviceKey: 'secret' },
    bill: { id: 'bill-1', user_id: 'user-1', utility_id: 'utility-1', contract_id: 'old-1' },
    offer: candidate({ valid_from: '2026-01-01', valid_to: '2026-12-31' }),
    actor: 'ai', fetchImpl, now: '2026-08-21T10:00:00.000Z',
  });
  assert.equal(result.contract.id, 'old-1');
  assert.equal(result.contract.is_current, false);
  assert.equal(result.preservedCurrentContractId, 'current-1');
  assert.equal(calls.some(call => call.method === 'PATCH' && call.url.includes('id=eq.current-1')), false);
});

test('offerta storica di una bolletta legata al corrente viene inserita come storico senza spegnere il corrente', async () => {
  const { persistPremiumVerifiedOffer } = await import('../lib/premiumOfferResolution.js');
  const calls = [];
  const current = {
    id: 'current-1', user_id: 'user-1', utility_id: 'utility-1', is_current: true,
    verification_status: 'needs_review', customer_confirmation_status: 'confirmed', automatic_match_method: 'customer_declared_edit',
  };
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    let payload = [];
    if ((init.method || 'GET') === 'GET' && String(url).includes('is_current=eq.true')) payload = [current];
    else if ((init.method || 'GET') === 'GET' && String(url).includes('id=eq.current-1')) payload = [current];
    else if (init.method === 'POST') payload = [{ id: 'historical-new', ...JSON.parse(init.body) }];
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  };
  const result = await persistPremiumVerifiedOffer({
    config: { supabaseUrl: 'https://db.test', serviceKey: 'secret' },
    bill: { id: 'bill-1', user_id: 'user-1', utility_id: 'utility-1', contract_id: 'current-1' },
    offer: candidate({ valid_from: '2025-01-01', valid_to: '2025-12-31' }),
    actor: 'ai', fetchImpl, now: '2026-08-21T10:00:00.000Z',
  });
  assert.equal(result.contract.id, 'historical-new');
  assert.equal(result.contract.is_current, false);
  assert.equal(result.historical, true);
  assert.equal(calls.some(call => call.method === 'PATCH' && call.url.includes('id=eq.current-1')), false);
});

test('un offerta web verificata non chiude il rosso se il nuovo confronto resta rosso', async () => {
  const api = await fs.readFile(new URL('../api/premium-ai-analysis.js', import.meta.url), 'utf8');
  assert.match(api, /if \(resolvedOfferScreening\.status !== "review_recommended"\)[\s\S]*decision: "resolved_ai"/);
  assert.match(api, /const rerouted = routePremiumRedReasons\(resolvedOfferScreening\.reasons\)/);
  assert.match(api, /decision: rerouted\.route === "staff_required" \? "staff_required" : "quick_verify"/);
  assert.match(api, /if \(resolvedOfferScreening && snapshot\.firstRun\?\.extracted_data\)/);
});
