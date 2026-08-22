import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

function loadComparisonHarness({ bills = [], contracts = [], utilities = [], checks = [], parentDocument = null } = {}) {
  let source = read('public/app-premium-bills.js');
  source = source
    .replace('let bills = [];', 'let bills = globalThis.__TEST_BILLS__;')
    .replace('let contracts = [];', 'let contracts = globalThis.__TEST_CONTRACTS__;')
    .replace('let utilities = [];', 'let utilities = globalThis.__TEST_UTILITIES__;')
    .replace('let checks = [];', 'let checks = globalThis.__TEST_CHECKS__;')
    .replace(
      'globalThis.OffertaLogicaPremiumBills = Object.freeze({ init });',
      'globalThis.OffertaLogicaPremiumBills = Object.freeze({ init, __test: { buildPremiumComparisonProfile, applyPremiumComparisonProfile, comparisonConsumptionForUtility, automaticReasonKind, automaticReasonPresentation, automaticDisplayTrafficLight, automaticStatusCopy, billArchiveCommodity, recentBillsForOverview, archivedBillsByCommodity } });',
    );
  const context = {
    __TEST_BILLS__: bills,
    __TEST_CONTRACTS__: contracts,
    __TEST_UTILITIES__: utilities,
    __TEST_CHECKS__: checks,
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

test('usa il prezzo dell’ultima bolletta economicamente completa e il consumo annuo più recente della stessa utenza', () => {
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
  assert.equal(profile.luce.consumption, 3100);
  assert.equal(profile.luce.price, 0.14321);
  assert.equal(profile.luce.consumptionSource, 'declared_annual');
  assert.equal(profile.luce.fixedFee, 108);
  assert.equal(profile.gas.billId, 'gas-valid');
  assert.equal(profile.gas.consumption, 890);
  assert.equal(profile.priceType, 'variabile');
  assert.equal(profile.luce.committedPowerKw, 4.5);
  assert.equal(profile.precisionLimited, false);
  assert.equal(profile.supplyMode, 'separate');
});


test('prima bolletta del nuovo fornitore alimenta lo storico reale ma non viene annualizzata', () => {
  const bills = [
    completeBill({
      id: 'eon-july', commodity: 'electricity', date: '2026-07-31', utilityId: 'luce-casa',
      data: {
        fornitore_luce: 'E.ON Energia S.p.A.',
        consumo_periodo_luce_kwh: 924.39,
        prezzo_luce_eur_kwh: 0.104148,
        quota_fissa_vendita_luce_eur_anno: 109.08,
        tipo_prezzo_luce: 'fisso',
      },
    }),
  ];
  bills[0].billing_period_start = '2026-07-01';
  const { buildPremiumComparisonProfile, comparisonConsumptionForUtility } = loadComparisonHarness({ bills });
  const history = comparisonConsumptionForUtility('luce-casa', 'luce');
  assert.equal(history.source, 'history_partial');
  assert.equal(history.coverageDays, 31);
  assert.equal(history.billCount, 1);
  assert.equal(history.periodTotal, 924.39);
  assert.equal(history.value, null);
  assert.equal(buildPremiumComparisonProfile(), null);
});

test('gas: il consumo del periodo alimenta lo storico in Smc e non viene chiamato annuo', () => {
  const bill = completeBill({
    id: 'gas-july', commodity: 'gas', date: '2026-07-31', utilityId: 'gas-casa',
    data: {
      fornitore_gas: 'Gas Spa',
      consumo_periodo_gas_smc: 15.28,
      prezzo_gas_eur_smc: 0.5,
      quota_fissa_vendita_gas_eur_anno: 96,
      tipo_prezzo_gas: 'fisso',
    },
  });
  bill.billing_period_start = '2026-07-01';
  const { buildPremiumComparisonProfile, comparisonConsumptionForUtility } = loadComparisonHarness({ bills: [bill] });
  const history = comparisonConsumptionForUtility('gas-casa', 'gas');
  assert.equal(history.source, 'history_partial');
  assert.equal(history.periodTotal, 15.28);
  assert.equal(history.coverageDays, 31);
  assert.equal(history.value, null);
  assert.equal(buildPremiumComparisonProfile(), null);
});

test('gas: un quasi duplicato annuo 15,28 vs periodo 15,29 viene trattato come storico parziale', () => {
  const bill = completeBill({
    id: 'gas-eon-july', commodity: 'gas', date: '2026-07-31', utilityId: 'gas-casa',
    data: {
      consumo_gas_smc: 15.28,
      consumo_periodo_gas_smc: 15.29,
      prezzo_gas_eur_smc: 0.474,
      quota_fissa_vendita_gas_eur_anno: 108,
    },
  });
  bill.billing_period_start = '2026-07-01';
  const { buildPremiumComparisonProfile, comparisonConsumptionForUtility } = loadComparisonHarness({ bills: [bill] });
  const history = comparisonConsumptionForUtility('gas-casa', 'gas');
  assert.equal(history.source, 'history_partial');
  assert.equal(history.periodTotal, 15.29);
  assert.equal(history.value, null);
  assert.equal(buildPremiumComparisonProfile(), null);
});

test('somma periodi non sovrapposti della stessa utenza anche con cambio fornitore', () => {
  const bills = [
    completeBill({
      id: 'old-june', commodity: 'electricity', date: '2026-06-30', utilityId: 'luce-casa',
      data: { fornitore_luce: 'Vecchio Fornitore', consumo_periodo_luce_kwh: 300, prezzo_luce_eur_kwh: 0.15, quota_fissa_vendita_luce_eur_anno: 100 },
    }),
    completeBill({
      id: 'eon-july', commodity: 'electricity', date: '2026-07-31', utilityId: 'luce-casa',
      data: { fornitore_luce: 'E.ON Energia', consumo_periodo_luce_kwh: 400, prezzo_luce_eur_kwh: 0.104148, quota_fissa_vendita_luce_eur_anno: 109.08 },
    }),
  ];
  bills[0].billing_period_start = '2026-06-01';
  bills[1].billing_period_start = '2026-07-01';
  const { buildPremiumComparisonProfile, comparisonConsumptionForUtility } = loadComparisonHarness({ bills });
  const history = comparisonConsumptionForUtility('luce-casa', 'luce');
  assert.equal(history.billCount, 2);
  assert.equal(history.coverageDays, 61);
  assert.equal(history.periodTotal, 700);
  assert.equal(history.value, null);
  assert.equal(buildPremiumComparisonProfile(), null);
});

test('periodi sovrapposti non vengono contati due volte nello storico consumi', () => {
  const bills = [
    completeBill({ id: 'full-july', commodity: 'electricity', date: '2026-07-31', utilityId: 'u1', data: { consumo_periodo_luce_kwh: 310, prezzo_luce_eur_kwh: 0.14, quota_fissa_vendita_luce_eur_anno: 100 } }),
    completeBill({ id: 'overlap', commodity: 'electricity', date: '2026-07-31', utilityId: 'u1', data: { consumo_periodo_luce_kwh: 150, prezzo_luce_eur_kwh: 0.14, quota_fissa_vendita_luce_eur_anno: 100 } }),
  ];
  bills[0].billing_period_start = '2026-07-01';
  bills[1].billing_period_start = '2026-07-15';
  const { comparisonConsumptionForUtility } = loadComparisonHarness({ bills });
  const history = comparisonConsumptionForUtility('u1', 'luce');
  assert.equal(history.billCount, 1);
  assert.equal(history.coverageDays, 31);
  assert.equal(history.periodTotal, 310);
});

test('lo storico diventa consumo reale degli ultimi 12 mesi senza annualizzazione', () => {
  const bills = [];
  const starts = [
    ['2026-07-01','2026-07-31',900], ['2026-08-01','2026-08-31',800],
    ['2026-09-01','2026-09-30',700], ['2026-10-01','2026-10-31',650],
    ['2026-11-01','2026-11-30',600], ['2026-12-01','2026-12-31',700],
    ['2027-01-01','2027-01-31',850], ['2027-02-01','2027-02-28',750],
    ['2027-03-01','2027-03-31',700], ['2027-04-01','2027-04-30',650],
    ['2027-05-01','2027-05-31',600], ['2027-06-01','2027-06-30',700],
  ];
  for (const [start, end, value] of starts) {
    const bill = completeBill({
      id: end, commodity: 'electricity', date: end, utilityId: 'luce-casa',
      data: { consumo_periodo_luce_kwh: value, prezzo_luce_eur_kwh: 0.11, quota_fissa_vendita_luce_eur_anno: 100 },
    });
    bill.billing_period_start = start;
    bills.push(bill);
  }
  const { buildPremiumComparisonProfile, comparisonConsumptionForUtility } = loadComparisonHarness({ bills });
  const history = comparisonConsumptionForUtility('luce-casa', 'luce');
  const expected = starts.reduce((sum, item) => sum + item[2], 0);
  assert.equal(history.source, 'history_12m');
  assert.equal(history.coverageDays, 365);
  assert.equal(history.billCount, 12);
  assert.equal(history.value, expected);
  assert.equal(history.periodTotal, expected);
  const profile = buildPremiumComparisonProfile();
  assert.equal(profile.luce.consumption, expected);
  assert.equal(profile.luce.consumptionPrecisionLimited, false);
});

test('un falso annuale uguale al consumo del singolo periodo non abilita il confronto', () => {
  const bill = completeBill({
    id: 'eon-july', commodity: 'electricity', date: '2026-07-31', utilityId: 'luce-casa',
    data: {
      consumo_luce_kwh: 924.39,
      consumo_periodo_luce_kwh: 924.39,
      prezzo_luce_eur_kwh: 0.104148,
      quota_fissa_vendita_luce_eur_anno: 109.08,
    },
  });
  bill.billing_period_start = '2026-07-01';
  const { buildPremiumComparisonProfile, comparisonConsumptionForUtility } = loadComparisonHarness({ bills: [bill] });
  const history = comparisonConsumptionForUtility('luce-casa', 'luce');
  assert.equal(history.source, 'history_partial');
  assert.equal(history.periodTotal, 924.39);
  assert.equal(history.value, null);
  assert.equal(buildPremiumComparisonProfile(), null);
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
    luce: { consumption: 2850, price: 0.104148, fixedFee: 108, sourceDate: '2026-07-31', provider: 'Luce Spa', committedPowerKw: 4.5, pricePrecisionLimited: true, consumptionPrecisionLimited: false, precisionLimited: true },
    gas: { consumption: 890, price: 0.5123, fixedFee: 96, sourceDate: '2026-08-10', provider: 'Gas Spa', pricePrecisionLimited: false, consumptionPrecisionLimited: false, precisionLimited: false },
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
  assert.equal(profile.luce.pricePrecisionLimited, true);
  assert.equal(profile.luce.precisionLimited, true);
  assert.equal(profile.gas.pricePrecisionLimited, false);
  assert.equal(profile.gas.precisionLimited, false);
  assert.equal(profile.precisionLimited, true);
});

test('note informative non trasformano la bolletta in un falso giallo', () => {
  const bill = {
    id: 'info-only', processing_status: 'completed', automatic_screening_status: 'inconclusive',
    automatic_screening_reasons: [
      { code: 'storico_consumi_gas_in_costruzione', severity: 'low', trafficLight: 'yellow' },
      { code: 'offerta_letta_non_verificata_catalogo', severity: 'low', trafficLight: 'yellow' },
    ],
  };
  const { automaticReasonKind, automaticReasonPresentation, automaticDisplayTrafficLight, automaticStatusCopy } = loadComparisonHarness({ bills: [bill] });
  bill.automatic_screening_summary = 'Controllo completato con un avviso.';
  assert.equal(automaticReasonKind(bill.automatic_screening_reasons[0]), 'info');
  assert.equal(automaticReasonKind(bill.automatic_screening_reasons[1]), 'info');
  assert.equal(automaticDisplayTrafficLight(bill), 'green');
  assert.doesNotMatch(automaticStatusCopy(bill), /avviso/i);
  assert.equal(automaticReasonPresentation(bill.automatic_screening_reasons[1]).hideWhenOfferCard, true);
});

test('precisione economica limitata resta una nota informativa e non un falso giallo', () => {
  const reason = { code: 'comparison_precision_limited_gas', severity: 'review', trafficLight: 'yellow' };
  const bill = { id: 'price-review', processing_status: 'completed', automatic_screening_status: 'inconclusive', automatic_screening_reasons: [reason] };
  const { automaticReasonKind, automaticReasonPresentation, automaticDisplayTrafficLight } = loadComparisonHarness({ bills: [bill] });
  assert.equal(automaticReasonKind(reason), 'info');
  assert.equal(automaticDisplayTrafficLight(bill), 'green');
  assert.equal(automaticReasonPresentation(reason).title, 'Nota sul confronto gas');
  assert.doesNotMatch(automaticReasonPresentation(reason).description, /precisione_confronto_gas/);
});

test('vista Bollette mantiene ultima luce e ultimo gas della stessa utenza e separa i due archivi', () => {
  const bills = [
    { id: 'gas-new', utility_id: 'u1', commodity: 'gas', processing_status: 'completed', automatic_screening_status: 'clear' },
    { id: 'luce-new', utility_id: 'u1', commodity: 'electricity', processing_status: 'completed', automatic_screening_status: 'clear' },
    { id: 'gas-old', utility_id: 'u1', commodity: 'gas', processing_status: 'completed', automatic_screening_status: 'clear' },
    { id: 'luce-old', utility_id: 'u1', commodity: 'electricity', processing_status: 'completed', automatic_screening_status: 'clear' },
  ];
  const utilities = [{ id: 'u1', supply_type: 'dual' }];
  const { recentBillsForOverview, archivedBillsByCommodity } = loadComparisonHarness({ bills, utilities });
  const recentBills = recentBillsForOverview(bills);
  const recent = recentBills.map(item => item.id);
  assert.deepEqual(Array.from(recent), ['gas-new', 'luce-new']);
  const archived = archivedBillsByCommodity(recentBills, bills);
  assert.deepEqual(Array.from(archived.electricity, item => item.id), ['luce-old']);
  assert.deepEqual(Array.from(archived.gas, item => item.id), ['gas-old']);
});

test('ultima bolletta significa periodo più recente anche se una vecchia viene caricata dopo', () => {
  const bills = [
    { id: 'luce-old-uploaded-later', utility_id: 'u1', commodity: 'electricity', billing_period_end: '2026-07-31', created_at: '2026-09-02T10:00:00Z', processing_status: 'completed', automatic_screening_status: 'clear' },
    { id: 'luce-actual-new', utility_id: 'u1', commodity: 'electricity', billing_period_end: '2026-08-31', created_at: '2026-09-01T10:00:00Z', processing_status: 'completed', automatic_screening_status: 'clear' },
  ];
  const { recentBillsForOverview, archivedBillsByCommodity } = loadComparisonHarness({ bills, utilities: [{ id: 'u1' }] });
  const recentBills = recentBillsForOverview(bills);
  assert.deepEqual(Array.from(recentBills, item => item.id), ['luce-actual-new']);
  assert.deepEqual(Array.from(archivedBillsByCommodity(recentBills, bills).electricity, item => item.id), ['luce-old-uploaded-later']);
});

test('un vecchio caso rosso resta visibile fuori dall’archivio della propria commodity', () => {
  const bills = [
    { id: 'luce-new', utility_id: 'u1', commodity: 'electricity', processing_status: 'completed', automatic_screening_status: 'clear' },
    { id: 'luce-old-red', utility_id: 'u1', commodity: 'electricity', processing_status: 'completed', automatic_screening_status: 'review_recommended' },
    { id: 'luce-old-ok', utility_id: 'u1', commodity: 'electricity', processing_status: 'completed', automatic_screening_status: 'clear' },
  ];
  const { recentBillsForOverview, archivedBillsByCommodity } = loadComparisonHarness({ bills, utilities: [{ id: 'u1' }] });
  const recentBills = recentBillsForOverview(bills);
  assert.deepEqual(Array.from(recentBills, item => item.id), ['luce-new', 'luce-old-red']);
  assert.deepEqual(Array.from(archivedBillsByCommodity(recentBills, bills).electricity, item => item.id), ['luce-old-ok']);
});

test('una bolletta caricata su utenza dual viene assegnata all’archivio in base ai dati letti', () => {
  const gasBill = { id: 'dual-gas', commodity: 'dual', customer_analysis_data: { consumo_periodo_gas_smc: 15.29 } };
  const lightBill = { id: 'dual-luce', commodity: 'dual', customer_analysis_data: { consumo_periodo_luce_kwh: 924.39 } };
  const { billArchiveCommodity } = loadComparisonHarness({ bills: [gasBill, lightBill] });
  assert.equal(billArchiveCommodity(gasBill), 'gas');
  assert.equal(billArchiveCommodity(lightBill), 'electricity');
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
  assert.match(app, /premiumUtilityList/);
  assert.match(app, /Storico consumi/);
  assert.match(app, /Consumo ultimi 12 mesi/);
  assert.doesNotMatch(app, /history_annualized/);
});

test('service worker forza il rilascio della cache informativa v0.36.51', () => {
  const sw = read('public/sw.js');
  assert.match(sw, /offertalogica-premium-v03651-analysis-info-ux/);
  assert.match(sw, /"\/app-premium-bills\.js"/);
});
