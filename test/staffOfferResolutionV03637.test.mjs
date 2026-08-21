import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { evaluatePremiumOfferResolution, gasOfferPriceCompatibility } from '../lib/premiumOfferResolution.js';

test('Staff: candidato non deterministico resta candidato e non auto-verificato', () => {
  const result = evaluatePremiumOfferResolution({
    rawResolution: {
      search_performed: true,
      bill_pcs_gj_smc: 0.03886,
      bill_coefficient_c: 1.01,
      candidates: [{
        commodity: 'gas', provider_name: 'E.ON Energia', offer_name: 'E.ON Gas Insieme', offer_code: '',
        pricing_type: 'fixed', unit_price: 0.494, annual_fixed_fee: 120, index_name: '', spread: null, formula: '',
        valid_from: '2026-01-01', valid_to: '2026-12-31', source_url: 'https://www.eon-energia.com/offerta', source_title: 'E.ON', reference_pcs_gj_smc: 0.03852,
      }],
    },
    firstAnalysis: { fornitore_gas: 'E.ON Energia S.p.A.', nome_offerta_gas: 'E.ON Gas Insieme', tipo_prezzo_gas: 'fisso', prezzo_gas_eur_smc: 0.4984, quota_fissa_vendita_gas_eur_anno: 120, billing_period_end: '2026-06-30' },
    webSources: [{ url: 'https://www.eon-energia.com/offerta' }],
  });
  assert.equal(result.status, 'candidates');
  assert.equal(result.candidates[0].auto_verifiable, false);
});

test('Staff UI mostra proposte IA, validazione manuale e testo umano', async () => {
  const ui = await fs.readFile(new URL('../public/staff-premium.js', import.meta.url), 'utf8');
  assert.match(ui, /Riferimento offerta/);
  assert.match(ui, /USA E VALIDA QUESTA OFFERTA/);
  assert.match(ui, /CORREGGI \/ VALIDA OFFERTA/);
  assert.match(ui, /action: "staff_validate_offer"/);
  assert.match(ui, /Conclusione IA/);
  assert.match(ui, /Non è disponibile un riferimento contrattuale verificato associabile a questa bolletta/);
  assert.doesNotMatch(ui, /infoCard\("Instradamento"/);
  assert.doesNotMatch(ui, /infoCard\("Decisione IA"/);
  assert.doesNotMatch(ui, /infoCard\("Esito verifica"/);
  assert.doesNotMatch(ui, /infoCard\("Confidenza dichiarata"/);
  assert.match(ui, /Elemento trovato nel PDF/);
  assert.match(ui, /Cosa manca per decidere/);
  assert.match(ui, /Perché serve lo Staff/);
  assert.doesNotMatch(ui, /Valore verificato|Dato verificato/);
});

test('Staff usa la stessa premium-ai-analysis: nessuna nuova API o SQL', async () => {
  const api = await fs.readFile(new URL('../api/premium-ai-analysis.js', import.meta.url), 'utf8');
  assert.match(api, /action === "staff_validate_offer"/);
  assert.match(api, /persistPremiumVerifiedOffer/);
  assert.match(api, /permission: "manage_checks"/);
  assert.doesNotMatch(api, /\/api\/premium-offer/);
});

test('PCS normalizza il prezzo gas senza applicare C al prezzo unitario', () => {
  const result = gasOfferPriceCompatibility({ referencePrice: 0.494, referencePcs: 0.03852, billPcs: 0.038863, billPrice: 0.4984 });
  assert.equal(result.compatible, true);
  assert.equal(result.method, 'pcs_normalized');
});

test('Staff non considera risolto un rosso se il nuovo confronto con offerta verificata resta rosso', async () => {
  const api = await fs.readFile(new URL('../api/premium-ai-analysis.js', import.meta.url), 'utf8');
  assert.match(api, /if \(resolvedOfferScreening\.status !== "review_recommended"\)[\s\S]*decision: "resolved_ai"/);
  assert.match(api, /const rerouted = routePremiumRedReasons\(resolvedOfferScreening\.reasons\)/);
  assert.match(api, /decision: rerouted\.route === "staff_required" \? "staff_required" : "quick_verify"/);
});
