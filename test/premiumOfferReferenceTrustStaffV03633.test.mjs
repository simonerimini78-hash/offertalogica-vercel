import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { premiumBillScopedOfferSummary, premiumContractForAutomaticComparison, premiumOfferContractCanBindBill, premiumOfferMatchVerifiedForBill } from '../lib/premiumOfferReferenceTrust.js';
import { PREMIUM_RED_VERIFIER_VERSION } from '../lib/premiumRedVerifier.js';

test('Staff non passa alla seconda IA un contratto confermato soltanto dal cliente', () => {
  assert.equal(premiumContractForAutomaticComparison({
    verification_status: 'verified',
    customer_confirmation_status: 'confirmed',
    provider_name: 'E.ON Energia S.p.A.',
    gas_price_eur_smc: 0.469,
  }, { fornitore_gas: 'E.ON Energia S.p.A.' }), null);
});

test('Staff normalizza le varianti societarie del fornitore su riferimenti autorevoli', () => {
  const output = premiumContractForAutomaticComparison({
    verification_status: 'verified',
    customer_confirmation_status: 'not_required',
    provider_name: 'E.ON Energia S.p.A.',
  }, { fornitore_gas: 'E.ON' });
  assert.ok(output);
  assert.equal(output.provider_name, 'E.ON');
});

test('API Staff usa riferimento bolletta-scoped e non collega un contratto corrente non verificato per quella bolletta', async () => {
  const oldBill = { status: 'existing_verified', match: { verified: false, confidence: 20, method: 'none' }, contract: { id: 'current-contract' }, publicSummary: { status: 'existing_verified', verified: true, contractId: 'current-contract' } };
  assert.equal(premiumOfferMatchVerifiedForBill(oldBill), false);
  assert.equal(premiumOfferContractCanBindBill(oldBill), false);
  assert.equal(premiumBillScopedOfferSummary(oldBill).status, 'not_found');
  const api = await fs.readFile(new URL('../api/premium-ai-analysis.js', import.meta.url), 'utf8');
  assert.match(api, /premiumOfferMatchVerifiedForBill\(offerMatch\)/);
  assert.match(api, /premiumOfferContractCanBindBill\(offerMatch\)/);
  assert.match(api, /premiumContractForAutomaticComparison\(contract, snapshot\.firstRun\?\.extracted_data \|\| \{\}\)/);
});

test('Staff riconosce la v0.36.32 come risultato da ricalcolare', async () => {
  assert.equal(PREMIUM_RED_VERIFIER_VERSION, 'premium-red-verifier-v0.36.33');
  const ui = await fs.readFile(new URL('../public/staff-premium.js', import.meta.url), 'utf8');
  assert.match(ui, /RED_VERIFIER_VERSION = "premium-red-verifier-v0.36.33"/);
  assert.match(ui, /RICALCOLA SECONDA VERIFICA IA/);
});
