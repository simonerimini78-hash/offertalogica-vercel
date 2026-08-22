import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

function loadComparisonHarness({ bills = [], contracts = [], parentDocument = null } = {}) {
  let source = read('public/app-premium-bills.js');
  source = source
    .replace('let bills = [];', 'let bills = globalThis.__TEST_BILLS__;')
    .replace('let contracts = [];', 'let contracts = globalThis.__TEST_CONTRACTS__;')
    .replace(
      'globalThis.OffertaLogicaPremiumBills = Object.freeze({ init });',
      'globalThis.OffertaLogicaPremiumBills = Object.freeze({ init, __test: { buildPremiumComparisonProfile, applyPremiumComparisonProfile } });',
    );
  const context = {
    __TEST_BILLS__: bills,
    __TEST_CONTRACTS__: contracts,
    document: parentDocument || { getElementById: () => null, querySelector: () => null },
    location: { origin: 'https://app.offertalogica.it' },
    URL,
    Intl,
    console,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'app-premium-bills.js' });
  return context.OffertaLogicaPremiumBills.__test;
}

function completeBill({ id, commodity, date, data, contractId = null, utilityId = 'u1', reasons = [] }) {
  return {
    id,
    commodity,
    utility_id: utilityId,
    contract_id: contractId,
    processing_status: 'completed',
    billing_period_end: date,
    issue_date: date,
    created_at: `${date}T12:00:00Z`,
    customer_analysis_data: data,
    automatic_screening_reasons: reasons,
  };
}

test('seleziona l’ultima bolletta completata che possiede tutti e tre i dati economici', () => {
  const bills = [
    completeBill({
      id: 'luce-new-incomplete', commodity: 'electricity', date: '2026-08-15',
      data: { consumo_luce_kwh: 3100, quota_fissa_vendita_luce_eur_anno: 120 },
    }),
    completeBill({
      id: 'luce-valid', commodity: 'electricity', date: '2026-07-31',
      data: { fornitore_luce: 'Luce Spa', consumo_luce_kwh: 2850, prezzo_luce_eur_kwh: 0.14321, quota_fissa_vendita_luce_eur_anno: 108, tipo_prezzo_luce: 'variabile', potenza_impegnata_kw: 4.5 },
    }),
    completeBill({
      id: 'gas-valid', commodity: 'gas', date: '2026-08-10', utilityId: 'u2',
      data: { fornitore_gas: 'Gas Spa', consumo_gas_smc: 890, prezzo_gas_eur_smc: 0.5123, quota_fissa_vendita_gas_eur_anno: 96, tipo_prezzo_gas: 'variabile' },
    }),
    completeBill({
      id: 'wrong-commodity', commodity: 'gas', date: '2026-08-20',
      data: { consumo_luce_kwh: 9999, prezzo_luce_eur_kwh: 0.01, quota_fissa_vendita_luce_eur_anno: 1 },
    }),
  ];
  bills.push({ ...completeBill({
    id: 'not-completed', commodity: 'electricity', date: '2026-08-21',
    data: { consumo_luce_kwh: 1, prezzo_luce_eur_kwh: 0.01, quota_fissa_vendita_luce_eur_anno: 1 },
  }), processing_status: 'analyzing' });

  const { buildPremiumComparisonProfile } = loadComparisonHarness({ bills });
  const profile = buildPremiumComparisonProfile();
  assert.equal(profile.luce.billId, 'luce-valid');
  assert.equal(profile.luce.consumption, 2850);
  assert.equal(profile.luce.price, 0.14321);
  assert.equal(profile.luce.fixedFee, 108);
  assert.equal(profile.gas.billId, 'gas-valid');
  assert.equal(profile.gas.consumption, 890);
  assert.equal(profile.priceType, 'variabile');
  assert.equal(profile.luce.committedPowerKw, 4.5);
  assert.equal(profile.precisionLimited, false);
  assert.equal(profile.supplyMode, 'separate');
});

test('quota fissa zero è valida e dual è assunto solo per stessa bolletta o stesso contratto', () => {
  const dualBill = completeBill({
    id: 'dual', commodity: 'dual', date: '2026-08-01', contractId: 'c1',
    data: {
      consumo_luce_kwh: 2500, prezzo_luce_eur_kwh: 0.15, quota_fissa_vendita_luce_eur_anno: 0,
      consumo_gas_smc: 700, prezzo_gas_eur_smc: 0.5, quota_fissa_vendita_gas_eur_anno: 0,
    },
  });
  let harness = loadComparisonHarness({ bills: [dualBill] });
  let profile = harness.buildPremiumComparisonProfile();
  assert.equal(profile.supplyMode, 'dual');
  assert.equal(profile.luce.fixedFee, 0);
  assert.equal(profile.gas.fixedFee, 0);

  const separateBills = [
    completeBill({ id: 'l', commodity: 'electricity', date: '2026-08-02', contractId: 'same', data: { consumo_luce_kwh: 2500, prezzo_luce_eur_kwh: 0.15, quota_fissa_vendita_luce_eur_anno: 100 } }),
    completeBill({ id: 'g', commodity: 'gas', date: '2026-08-02', contractId: 'same', data: { consumo_gas_smc: 700, prezzo_gas_eur_smc: 0.5, quota_fissa_vendita_gas_eur_anno: 100 } }),
  ];
  harness = loadComparisonHarness({ bills: separateBills });
  profile = harness.buildPremiumComparisonProfile();
  assert.equal(profile.supplyMode, 'dual');

  separateBills[1].contract_id = 'different';
  harness = loadComparisonHarness({ bills: separateBills });
  profile = harness.buildPremiumComparisonProfile();
  assert.equal(profile.supplyMode, 'separate');
});

class FakeEvent {
  constructor(type, options = {}) { this.type = type; this.bubbles = Boolean(options.bubbles); }
}

function fakeField(doc, { options = null } = {}) {
  return {
    value: '',
    options: options || [],
    ownerDocument: doc,
    events: [],
    dispatchEvent(event) { this.events.push(event.type); return true; },
  };
}

test('applica i dati al comparatore esistente senza avviare automaticamente il calcolo', () => {
  const fields = new Map();
  const created = [];
  const intro = { after(element) { created.push(element); fields.set(element.id, element); } };
  const currentBlock = {
    scrollCalls: [],
    querySelector(selector) { return selector === '.compare-card-intro' ? intro : null; },
    prepend(element) { created.push(element); fields.set(element.id, element); },
    scrollIntoView(options) { this.scrollCalls.push(options); },
  };
  const childDoc = {
    defaultView: { Event: FakeEvent },
    getElementById(id) { return id === 'blocco-attuale' ? currentBlock : fields.get(id) || null; },
    createElement() {
      return { id: '', textContent: '', style: { cssText: '' }, setAttribute() {}, remove() { this.removed = true; } };
    },
  };
  const precise = { clicks: 0, click() { this.clicks += 1; } };
  fields.set('btn-attiva-precisi', precise);
  fields.set('master-tipo-fornitura', fakeField(childDoc, { options: [{ value: 'luce' }, { value: 'gas' }, { value: 'separate' }, { value: 'dual' }] }));
  fields.set('master-luce-tipo', fakeField(childDoc, { options: [{ value: 'fisso' }, { value: 'variabile' }] }));
  fields.set('master-luce-potenza', fakeField(childDoc, { options: [{ value: '3' }, { value: '4.5' }, { value: '6' }] }));
  for (const id of [
    'in-luce-cons-att','in-luce-cons-nuov','in-luce-prezzo-att','in-luce-fisso-att',
    'in-gas-cons-att','in-gas-cons-nuov','in-gas-prezzo-att','in-gas-fisso-att',
    'nome-fornitore-att','nome-fornitore-gas-att',
  ]) fields.set(id, fakeField(childDoc));
  fields.set('in-luce-fisso-att-unita', fakeField(childDoc, { options: [{ value: 'mese' }, { value: 'anno' }] }));
  fields.set('in-gas-fisso-att-unita', fakeField(childDoc, { options: [{ value: 'mese' }, { value: 'anno' }] }));

  const subtitle = { textContent: '' };
  const parentDocument = { getElementById: id => id === 'appBrowserSubtitle' ? subtitle : null, querySelector: () => null };
  const { applyPremiumComparisonProfile } = loadComparisonHarness({ parentDocument });
  const frame = {
    contentDocument: childDoc,
    contentWindow: { location: { href: 'https://app.offertalogica.it/?entry=app#main-content' } },
  };
  const profile = {
    supplyMode: 'separate',
    priceType: 'variabile',
    precisionLimited: true,
    luce: { consumption: 2850, price: 0.104148, fixedFee: 108, sourceDate: '2026-07-31', provider: 'Luce Spa', committedPowerKw: 4.5, precisionLimited: true },
    gas: { consumption: 890, price: 0.5123, fixedFee: 96, sourceDate: '2026-08-10', provider: 'Gas Spa', precisionLimited: false },
  };
  assert.equal(applyPremiumComparisonProfile(frame, profile), true);
  assert.equal(precise.clicks, 1);
  assert.equal(fields.get('master-tipo-fornitura').value, 'separate');
  assert.equal(fields.get('master-luce-tipo').value, 'variabile');
  assert.equal(fields.get('master-luce-potenza').value, '4.5');
  assert.equal(fields.get('nome-fornitore-att').value, 'Luce Spa');
  assert.equal(fields.get('nome-fornitore-gas-att').value, 'Gas Spa');
  assert.equal(fields.get('in-luce-cons-att').value, '2850');
  assert.equal(fields.get('in-luce-cons-nuov').value, '2850');
  assert.equal(fields.get('in-luce-prezzo-att').value, '0.104148');
  assert.equal(fields.get('in-luce-fisso-att').value, '108');
  assert.equal(fields.get('in-luce-fisso-att-unita').value, 'anno');
  assert.equal(fields.get('in-gas-cons-att').value, '890');
  assert.equal(fields.get('in-gas-cons-nuov').value, '890');
  assert.equal(fields.get('in-gas-prezzo-att').value, '0.5123');
  assert.equal(fields.get('in-gas-fisso-att').value, '96');
  assert.equal(fields.get('in-gas-fisso-att-unita').value, 'anno');
  assert.match(subtitle.textContent, /Dati Premium inseriti/);
  assert.match(subtitle.textContent, /precisione limitata/);
  assert.equal(currentBlock.scrollCalls.length, 1);
  assert.equal(currentBlock.scrollCalls[0].block, 'start');
  const notice = fields.get('premium-comparison-precision-notice');
  assert.ok(notice);
  assert.match(notice.textContent, /può essere meno preciso/);
});

test('precisione limitata deriva dagli avvisi automatici della bolletta per luce e gas', () => {
  const bills = [
    completeBill({
      id: 'l', commodity: 'electricity', date: '2026-08-21',
      reasons: [{ code: 'coerenza_comparison_precision_limited_luce' }],
      data: { consumo_luce_kwh: 2500, prezzo_luce_eur_kwh: 0.18, quota_fissa_vendita_luce_eur_anno: 100 },
    }),
    completeBill({
      id: 'g', commodity: 'gas', date: '2026-08-21', utilityId: 'u2',
      reasons: [],
      data: { consumo_gas_smc: 700, prezzo_gas_eur_smc: 0.55, quota_fissa_vendita_gas_eur_anno: 90 },
    }),
  ];
  const { buildPremiumComparisonProfile } = loadComparisonHarness({ bills });
  const profile = buildPremiumComparisonProfile();
  assert.equal(profile.luce.precisionLimited, true);
  assert.equal(profile.gas.precisionLimited, false);
  assert.equal(profile.precisionLimited, true);
});

test('trasferimento è solo in memoria, non usa POD/PDR/indirizzo e non mette dati nell’URL', () => {
  const app = read('public/app-premium-bills.js');
  const start = app.indexOf('let pendingComparisonPrefill = null');
  const end = app.indexOf('function formatDecimal(', start);
  const transfer = app.slice(start, end);
  const apply = app.slice(app.indexOf('function applyPremiumComparisonProfile('), app.indexOf('function preparePremiumComparisonPrefill('));
  assert.match(transfer, /pendingComparisonPrefill/);
  assert.doesNotMatch(transfer, /localStorage|sessionStorage|URLSearchParams/);
  assert.doesNotMatch(apply, /\bpod\b|\bpdr\b|indirizzo/i);
  assert.equal((apply.match(/\.click\(\)/g) || []).length, 1, 'solo la modalità precisa viene attivata automaticamente');
});

test('prefill usa il percorso già esistente dell’app e aggiorna la CTA solo quando i dati sono disponibili', () => {
  const app = read('public/app-premium-bills.js');
  assert.match(app, /data-app-url="\/\?entry=app#main-content"/);
  assert.match(app, /addEventListener\("load", applyPendingComparisonPrefill\)/);
  assert.match(app, /addEventListener\("click", preparePremiumComparisonPrefill, true\)/);
  assert.match(app, /CONFRONTA CON I MIEI CONSUMI/);
  assert.match(app, /INIZIA IL CONFRONTO/);
});

test('service worker forza il rilascio della cache della normalizzazione v0.36.41', () => {
  const sw = read('public/sw.js');
  assert.match(sw, /offertalogica-premium-v03641-comparison-normalization/);
  assert.match(sw, /"\/app-premium-bills\.js"/);
});
