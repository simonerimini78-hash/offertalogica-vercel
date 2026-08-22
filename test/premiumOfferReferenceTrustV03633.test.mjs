import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { premiumBillScopedOfferSummary, premiumContractForAutomaticComparison, premiumOfferContractCanBindBill, premiumOfferMatchVerifiedForBill } from '../lib/premiumOfferReferenceTrust.js';
import { PREMIUM_RED_VERIFIER_VERSION } from '../lib/premiumRedVerifier.js';

test('offerta confermata soltanto dal cliente non puo generare rossi contrattuali', () => {
  const contract = {
    verification_status: 'verified',
    customer_confirmation_status: 'confirmed',
    provider_name: 'E.ON Energia S.p.A.',
    offer_name: 'E.ON Gas Insieme',
    gas_price_eur_smc: 0.469,
  };
  assert.equal(premiumContractForAutomaticComparison(contract, {
    fornitore_gas: 'E.ON Energia S.p.A.',
    nome_offerta_gas: 'E.ON Gas Insieme',
  }), null);
});

test('legacy customer_confirmed resta non autorevole anche senza flag confirmed', () => {
  assert.equal(premiumContractForAutomaticComparison({
    verification_status: 'verified',
    customer_confirmation_status: 'not_available',
    automatic_match_method: 'customer_confirmed',
  }, {}), null);
});

test('varianti societarie E.ON non producono un falso mismatch fornitore', () => {
  const contract = {
    verification_status: 'verified',
    customer_confirmation_status: 'not_required',
    provider_name: 'E.ON Energia S.p.A.',
    offer_name: 'E.ON Gas Insieme',
  };
  const output = premiumContractForAutomaticComparison(contract, { fornitore_gas: 'E.ON' });
  assert.ok(output);
  assert.equal(output.provider_name, 'E.ON');
});

test('un contratto non verificato non guida mai il rosso', () => {
  assert.equal(premiumContractForAutomaticComparison({
    verification_status: 'needs_review',
    customer_confirmation_status: 'not_available',
  }, {}), null);
});

test('il confronto automatico cliente richiede un match verificato sulla bolletta corrente', async () => {
  const oldBill = { status: 'existing_verified', match: { verified: false, status: 'not_found', confidence: 31, method: 'none' }, contract: { id: 'current-contract' }, publicSummary: { status: 'existing_verified', verified: true, contractId: 'current-contract' } };
  assert.equal(premiumOfferMatchVerifiedForBill(oldBill), false);
  assert.equal(premiumOfferContractCanBindBill(oldBill), false);
  assert.deepEqual(premiumBillScopedOfferSummary(oldBill), { status: 'not_found', verified: false, contractId: null, confidence: 31, method: 'none' });
  const provisional = premiumBillScopedOfferSummary({
    status: 'matched',
    match: { verified: false },
    contract: { id: 'provisional' },
    publicSummary: { status: 'matched', verified: false, contractId: 'provisional' },
  });
  assert.equal(provisional.status, 'not_found');

  const api = await fs.readFile(new URL('../api/premium-ai-analysis.js', import.meta.url), 'utf8');
  assert.match(api, /premiumOfferMatchVerifiedForBill\(offerMatch\)/);
  assert.match(api, /premiumOfferContractCanBindBill\(offerMatch\)/);
});

test('la UI distingue dichiarazione cliente da verifica tecnica', async () => {
  const ui = await fs.readFile(new URL('../public/app-premium-bills.js', import.meta.url), 'utf8');
  assert.match(ui, /customer_confirmation_status === "confirmed"\) return "DICHIARATA"/);
  assert.match(ui, /non costituisce una verifica tecnica delle condizioni economiche/);
  assert.doesNotMatch(ui, /Le condizioni registrate vengono usate anche per ricontrollare la bolletta/);
});

test('v0.36.47 mantiene verificatore v0.36.37 e aggiorna cache PWA', async () => {
  assert.equal(PREMIUM_RED_VERIFIER_VERSION, 'premium-red-verifier-v0.36.37');
  const sw = await fs.readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /offertalogica-premium-v03647-gas-history-price-recovery/);
});
