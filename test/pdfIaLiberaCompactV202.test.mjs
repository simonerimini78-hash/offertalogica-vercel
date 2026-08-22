import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  PDF_PURE_AI_READER_VERSION,
  buildPdfPureAiRequest,
  extractPdfPureAi,
  normalizePureAiOutput,
} from '../lib/pdfPureAiReader.js';

const row = (purpose, label, value_number = null, value_text = null, unit = null, period = 'none', band = 'none', page = 1) => ({
  purpose, label, value_text, value_number, unit, period, band, page,
});

function document(commodity = 'gas') {
  return { kind: 'bill', commodity, customer_type: 'consumer', page_count: 11 };
}

test('versione e richiesta usano il contratto compatto senza dati aggiuntivi', async () => {
  assert.equal(PDF_PURE_AI_READER_VERSION, 'pure-ai-native-pdf-v2.0.10-gas-history-price-recovery');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ia-compact-'));
  const filePath = path.join(dir, 'bolletta.pdf');
  await fs.writeFile(filePath, '%PDF-test');
  const request = await buildPdfPureAiRequest({ filePath, model: 'test-model' });
  const schema = request.text.format.schema;
  const item = schema.properties.supplies.items.properties.fields.items;
  assert.equal(request.max_output_tokens, 4500);
  assert.deepEqual(schema.required, ['document', 'supplies']);
  assert.deepEqual(schema.properties.document.required, ['kind', 'commodity', 'customer_type', 'page_count', 'billing_period_start', 'billing_period_end', 'issue_date', 'due_date', 'total_amount_eur', 'alerts']);
  assert.equal(schema.properties.additional_data, undefined);
  assert.equal(item.properties.evidence, undefined);
  assert.equal(item.properties.confidence, undefined);
  assert.equal(schema.properties.supplies.items.properties.fields.maxItems, 24);
  assert.ok(item.properties.purpose.enum.includes('period_consumption'));
  assert.ok(item.properties.purpose.enum.includes('conditions_start'));
  assert.ok(item.properties.purpose.enum.includes('conditions_end'));
  assert.match(request.input[0].content[0].text, /period_consumption/);
  assert.match(request.input[0].content[0].text, /coefficiente correttivo C/);
  assert.match(request.input[0].content[0].text, /non usare il periodo di fatturazione/);
  assert.match(request.input[0].content[0].text, /non cercare né restituire dati personali, POD, PDR/);
  assert.ok(JSON.stringify(schema).length < 3200);
  await fs.rm(dir, { recursive: true, force: true });
});



test('prima bolletta: conserva il consumo del periodo senza trasformarlo in consumo annuo', () => {
  const normalized = normalizePureAiOutput({
    document: {
      ...document('electricity'),
      billing_period_start: '2026-07-01',
      billing_period_end: '2026-07-31',
    },
    supplies: [{ commodity: 'electricity', provider: 'E.ON Energia', offer_name: 'Luce Insieme', offer_code: null, fields: [
      row('period_consumption', 'Consumo totale fatturato nel periodo', 924.39, '924,39', 'kWh', 'none', 'none', 2),
      row('unit_price', 'Spesa per la vendita di energia elettrica', 0.142614, '0,142614', '€/kWh', 'none', 'none', 2),
      row('fixed_fee', 'Quota fissa vendita', 9.09, '9,09', '€/mese', 'month', 'none', 2),
    ]}],
  });
  assert.equal(normalized.consumo_luce_kwh, undefined);
  assert.equal(normalized.consumo_periodo_luce_kwh, 924.39);
  assert.equal(normalized.adaptive_form.supplies[0].period_consumption.value, 924.39);
});



test('non accetta come consumo annuo un consumo mensile classificato annuale senza evidenza esplicita', () => {
  const normalized = normalizePureAiOutput({
    document: {
      ...document('electricity'),
      billing_period_start: '2026-07-01',
      billing_period_end: '2026-07-31',
    },
    supplies: [{ commodity: 'electricity', provider: 'E.ON Energia', offer_name: 'Luce Insieme', offer_code: null, fields: [
      row('annual_consumption', 'Consumo', 924.39, '924,39', 'kWh', 'none', 'none', 2),
      row('period_consumption', 'Consumo totale fatturato nel periodo', 924.39, '924,39', 'kWh', 'none', 'none', 2),
      row('unit_price', 'Materia energia', 0.104148, '0,104148', '€/kWh', 'none', 'none', 2),
      row('fixed_fee', 'Quota fissa vendita', 109.08, '109,08', '€/anno', 'year', 'none', 2),
    ]}],
  });
  assert.equal(normalized.consumo_luce_kwh, undefined);
  assert.equal(normalized.consumo_periodo_luce_kwh, 924.39);
});

test('anche con etichetta annua scarta il duplicato identico al consumo del mese', () => {
  const normalized = normalizePureAiOutput({
    document: {
      ...document('electricity'),
      billing_period_start: '2026-07-01',
      billing_period_end: '2026-07-31',
    },
    supplies: [{ commodity: 'electricity', provider: 'E.ON Energia', offer_name: 'Luce Insieme', offer_code: null, fields: [
      row('annual_consumption', 'Consumo annuo', 924.39, '924,39', 'kWh', 'year', 'none', 2),
      row('period_consumption', 'Consumo totale fatturato nel periodo', 924.39, '924,39', 'kWh', 'none', 'none', 2),
      row('unit_price', 'Materia energia', 0.104148, '0,104148', '€/kWh', 'none', 'none', 2),
      row('fixed_fee', 'Quota fissa vendita', 109.08, '109,08', '€/anno', 'year', 'none', 2),
    ]}],
  });
  assert.equal(normalized.consumo_luce_kwh, undefined);
  assert.equal(normalized.consumo_periodo_luce_kwh, 924.39);
  assert.ok(!normalized.ai.filled_fields.includes('consumo_luce_kwh'));
});

test('mantiene il consumo annuo quando il documento lo dichiara esplicitamente', () => {
  const normalized = normalizePureAiOutput({
    document: {
      ...document('electricity'),
      billing_period_start: '2026-07-01',
      billing_period_end: '2026-07-31',
    },
    supplies: [{ commodity: 'electricity', provider: 'Test', offer_name: 'Test', offer_code: null, fields: [
      row('annual_consumption', 'Consumo annuo ultimi 12 mesi', 2400, '2400', 'kWh', 'year', 'none', 2),
      row('period_consumption', 'Consumo totale fatturato nel periodo', 924.39, '924,39', 'kWh', 'none', 'none', 2),
      row('unit_price', 'Materia energia', 0.12, '0,12', '€/kWh', 'none', 'none', 2),
      row('fixed_fee', 'Quota fissa vendita', 100, '100', '€/anno', 'year', 'none', 2),
    ]}],
  });
  assert.equal(normalized.consumo_luce_kwh, 2400);
  assert.equal(normalized.consumo_periodo_luce_kwh, 924.39);
});

test('recupero mirato conserva il consumo del periodo quando il consumo annuo non esiste', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ia-period-recovery-'));
  const filePath = path.join(dir, 'bolletta.pdf');
  await fs.writeFile(filePath, '%PDF-test');
  let calls = 0;
  const primary = {
    document: { ...document('electricity'), billing_period_start: '2026-07-01', billing_period_end: '2026-07-31' },
    supplies: [{ commodity: 'electricity', provider: 'E.ON Energia', offer_name: 'Luce Insieme', offer_code: null, fields: [
      row('unit_price', 'Spesa per la vendita di energia elettrica', 0.142614, '0,142614', '€/kWh', 'none', 'none', 2),
      row('fixed_fee', 'Quota fissa vendita', 9.09, '9,09', '€/mese', 'month', 'none', 2),
    ]}],
  };
  const recovery = {
    document: { ...document('electricity'), billing_period_start: '2026-07-01', billing_period_end: '2026-07-31' },
    supplies: [{ commodity: 'electricity', provider: null, offer_name: null, offer_code: null, fields: [
      row('period_consumption', 'Consumo totale fatturato nel periodo', 924.39, '924,39', 'kWh', 'none', 'none', 2),
    ]}],
  };
  const normalized = await extractPdfPureAi({
    filePath,
    apiKey: 'test',
    transport: async () => {
      calls += 1;
      const payload = calls === 1 ? primary : recovery;
      return { id: `resp-${calls}`, output_text: JSON.stringify(payload) };
    },
  });
  assert.equal(calls, 2);
  assert.equal(normalized.consumo_luce_kwh, undefined);
  assert.equal(normalized.consumo_periodo_luce_kwh, 924.39);
  assert.equal(normalized.ai.recovery_attempted, true);
  assert.match(String(normalized.ai.recovered_from), /essential_recovery/);
  await fs.rm(dir, { recursive: true, force: true });
});

test('decorrenza e scadenza condizioni economiche vengono salvate solo come date esplicite della fornitura', () => {
  const normalized = normalizePureAiOutput({
    document: {
      ...document('dual'),
      billing_period_start: '2026-07-01',
      billing_period_end: '2026-07-31',
      issue_date: '2026-08-05',
      due_date: '2026-08-25',
    },
    supplies: [
      { commodity: 'electricity', provider: 'Test Luce', offer_name: 'Offerta Luce', offer_code: 'L1', fields: [
        row('annual_consumption', 'Consumo annuo', 2400, '2400', 'kWh', 'year', 'none', 1),
        row('unit_price', 'Materia energia', 0.14, '0,14', '€/kWh', 'none', 'none', 2),
        row('fixed_fee', 'Quota fissa vendita', 10, '10', '€/mese', 'month', 'none', 2),
        row('conditions_start', 'Decorrenza condizioni economiche', null, '2026-07-01', null, 'none', 'none', 3),
        row('conditions_end', 'Scadenza condizioni economiche', null, '2027-06-30', null, 'none', 'none', 3),
      ]},
      { commodity: 'gas', provider: 'Test Gas', offer_name: 'Offerta Gas', offer_code: 'G1', fields: [
        row('annual_consumption', 'Consumo annuo', 900, '900', 'Smc', 'year', 'none', 4),
        row('unit_price', 'Materia gas', 0.5, '0,5', '€/Smc', 'none', 'none', 4),
        row('fixed_fee', 'Quota fissa vendita', 12, '12', '€/mese', 'month', 'none', 4),
        row('conditions_start', 'Decorrenza condizioni economiche', null, '2026-06-15', null, 'none', 'none', 5),
        row('conditions_end', 'Scadenza condizioni economiche', null, '2027-06-14', null, 'none', 'none', 5),
      ]},
    ],
  });

  assert.equal(normalized.decorrenza_condizioni_economiche_luce, '2026-07-01');
  assert.equal(normalized.scadenza_condizioni_economiche_luce, '2027-06-30');
  assert.equal(normalized.decorrenza_condizioni_economiche_gas, '2026-06-15');
  assert.equal(normalized.scadenza_condizioni_economiche_gas, '2027-06-14');
  assert.notEqual(normalized.scadenza_condizioni_economiche_luce, normalized.due_date);
});

test('date condizioni non valide non vengono trasformate in date contrattuali', () => {
  const normalized = normalizePureAiOutput({
    document: document('gas'),
    supplies: [{ commodity: 'gas', provider: 'Test', offer_name: 'Test', offer_code: null, fields: [
      row('annual_consumption', 'Consumo annuo', 900, '900', 'Smc', 'year', 'none', 1),
      row('unit_price', 'Materia gas', 0.5, '0,5', '€/Smc', 'none', 'none', 2),
      row('fixed_fee', 'Quota fissa vendita', 10, '10', '€/mese', 'month', 'none', 2),
      row('conditions_start', 'Decorrenza condizioni economiche', null, '01/07/2026', null, 'none', 'none', 3),
      row('conditions_end', 'Scadenza condizioni economiche', null, '12 mesi', null, 'none', 'none', 3),
    ]}],
  });
  assert.equal(normalized.decorrenza_condizioni_economiche_gas, undefined);
  assert.equal(normalized.scadenza_condizioni_economiche_gas, undefined);
});

test('Dolomiti conserva prezzo totale, componenti, formula e quota fissa', () => {
  const normalized = normalizePureAiOutput({
    document: document('gas'),
    supplies: [{
      commodity: 'gas', provider: 'Dolomiti Energia', offer_name: 'GAS ITALY CASA_R', offer_code: '000139', fields: [
        row('annual_consumption', 'CONSUMO ANNUO', 1883, '1.883', 'Smc', 'none', 'none', 4),
        row('unit_price', 'materia prima gas', 0.687479, '0,687479', '€/Smc', 'none', 'none', 7),
        row('price_component', 'MATERIA PRIMA GAS', 0.565747, '0,565747', '€/Smc', 'none', 'none', 3),
        row('spread', 'SPREAD', 0.121732, '0,121732', '€/Smc', 'none', 'none', 3),
        row('formula', 'Formula', null, 'MATERIA PRIMA GAS + SPREAD', null, 'none', 'none', 3),
        row('fixed_fee', 'commercializzazione vendita fissa', 12, '12,000000', '€/pdr/mese', 'month', 'none', 7),
      ],
    }],
  });
  assert.equal(normalized.consumo_gas_smc, 1883);
  assert.equal(normalized.prezzo_gas_eur_smc, 0.687479);
  assert.equal(normalized.spread_gas_eur_smc, 0.121732);
  assert.equal(normalized.formula_prezzo_gas, 'MATERIA PRIMA GAS + SPREAD');
  assert.equal(normalized.quota_fissa_vendita_gas_eur_anno, 144);
  assert.equal(normalized.adaptive_form.supplies[0].price_items[0].value, 0.565747);
});

test('Irina dual compila direttamente i sei valori principali', () => {
  const normalized = normalizePureAiOutput({
    document: document('dual'),
    supplies: [
      { commodity: 'electricity', provider: 'Hera Comm', offer_name: null, offer_code: null, fields: [
        row('annual_consumption', 'Consumo annuo', 732.8, '732,80', 'kWh', 'none', 'none', 4),
        row('unit_price', 'Spesa per la vendita', 0.180313, '0,180313', '€/kWh', 'none', 'none', 3),
        row('fixed_fee', 'Quota fissa vendita', 7.1, '7,10', '€/mese', 'month', 'none', 3),
      ]},
      { commodity: 'gas', provider: 'Hera Comm', offer_name: null, offer_code: null, fields: [
        row('annual_consumption', 'Consumo annuo', 516.41, '516,41', 'Smc', 'none', 'none', 6),
        row('unit_price', 'Spesa per la vendita', 0.440750, '0,440750', '€/Smc', 'none', 'none', 5),
        row('fixed_fee', 'Quota fissa vendita', 10, '10,00', '€/mese', 'month', 'none', 5),
      ]},
    ],
  });
  assert.equal(normalized.commodity, 'dual');
  assert.equal(normalized.consumo_luce_kwh, 732.8);
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.180313);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, 85.2);
  assert.equal(normalized.consumo_gas_smc, 516.41);
  assert.equal(normalized.prezzo_gas_eur_smc, 0.44075);
  assert.equal(normalized.quota_fissa_vendita_gas_eur_anno, 120);
});

test('Hera a fasce mantiene prezzi e componenti senza forzare un prezzo unico', () => {
  const normalized = normalizePureAiOutput({
    document: document('electricity'),
    supplies: [{ commodity: 'electricity', provider: 'Hera Comm', offer_name: null, offer_code: null, fields: [
      row('annual_consumption', 'Consumo annuo', 1628.91, '1.628,91', 'kWh', 'none', 'none', 4),
      row('band_price', 'CELD F1', 0.122252, '0,122252', '€/kWh', 'none', 'f1', 3),
      row('band_price', 'CELD F2', 0.152087, '0,152087', '€/kWh', 'none', 'f2', 3),
      row('band_price', 'CELD F3', 0.128295, '0,128295', '€/kWh', 'none', 'f3', 3),
      row('price_component', 'Dispacciamento', 0.015531, '0,015531', '€/kWh', 'none', 'none', 3),
      row('fixed_fee', 'Quota fissa vendita', -6.1, '-6,10', '€/mese', 'month', 'none', 3),
      row('price_type', 'Tipo prezzo', null, 'Variabile', null, 'none', 'none', 3),
    ]}],
  });
  assert.equal(normalized.prezzo_luce_eur_kwh, undefined);
  assert.equal(normalized.prezzo_luce_f1_eur_kwh, 0.122252);
  assert.equal(normalized.prezzo_luce_f2_eur_kwh, 0.152087);
  assert.equal(normalized.prezzo_luce_f3_eur_kwh, 0.128295);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, -73.2);
  assert.equal(normalized.adaptive_form.supplies[0].price_items.length, 4);
  assert.equal(normalized.tipo_prezzo_luce, 'variabile');
});

test('replay del formato v2.0.0 resta leggibile', () => {
  const normalized = normalizePureAiOutput({
    document: document('gas'),
    supplies: [{
      commodity: 'gas', provider: 'Test', offer_name: 'Test gas', offer_code: null,
      annual_consumption: { value: 900, value_text: '900', unit: 'Smc', period: 'none', page: 2, label: 'Consumo annuo', evidence: 'Consumo annuo 900', confidence: 100 },
      annual_band_consumptions: [],
      primary_price: { value: 0.5, value_text: '0,5', unit: '€/Smc', period: 'none', page: 3, label: 'Prezzo', evidence: 'Prezzo 0,5', confidence: 100 },
      price_items: [],
      fixed_fee: { value: 9, value_text: '9', unit: '€/mese', period: 'month', page: 3, label: 'Quota fissa', evidence: 'Quota fissa 9', confidence: 100 },
      price_type: 'fixed', price_structure: 'monoraria', index: null, multiplier: null, spread: null, formula: null, periodicity: null,
      committed_power_kw: null, available_power_kw: null, pricing_page: 3, pricing_evidence: 'Prezzo 0,5', confidence: 100,
    }],
    additional_data: [],
  });
  assert.equal(normalized.consumo_gas_smc, 900);
  assert.equal(normalized.prezzo_gas_eur_smc, 0.5);
  assert.equal(normalized.quota_fissa_vendita_gas_eur_anno, 108);
});



test('luce: separa materia e sconto da C.DISP.D. per il confronto', () => {
  const normalized = normalizePureAiOutput({
    document: document('electricity'),
    supplies: [{ commodity: 'electricity', provider: 'E.ON Energia', offer_name: 'Luce Insieme', offer_code: null, fields: [
      row('annual_consumption', 'Consumo annuo', 2700, '2700', 'kWh', 'year', 'none', 1),
      row('unit_price', 'Spesa per la vendita di energia elettrica', 0.142611, '0,142611', '€/kWh', 'none', 'none', 2),
      row('price_component', 'Corrispettivo consumo energia (luglio)', 0.115720, '0,115720', '€/kWh', 'none', 'none', 2),
      row('price_component', 'Corrispettivo C.DISP.D. (luglio)', 0.038463, '0,038463', '€/kWh', 'none', 'none', 2),
      row('price_component', 'Sconto Luce Insieme (luglio)', -0.011572, '-0,011572', '€/kWh', 'none', 'none', 2),
      row('formula', 'Formula vendita energia elettrica per la quota consumi', null, 'Corrispettivo consumo energia + Corrispettivo Cdispd + Sconto Luce Insieme', null, 'none', 'none', 2),
      row('fixed_fee', 'Quota fissa vendita', 10, '10', '€/mese', 'month', 'none', 2),
    ]}],
  });
  assert.equal(normalized.prezzo_vendita_bolletta_luce_eur_kwh, 0.142611);
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.104148);
  assert.equal(normalized.precisione_confronto_luce, 'completa');
  assert.deepEqual(normalized.motivi_precisione_confronto_luce, []);
  assert.equal(normalized.normalizzazione_prezzo_luce.excluded.ancillary.length, 1);
});

test('gas: scarta come falso annuo anche il quasi duplicato 15,28 vs 15,29 Smc del mese', () => {
  const normalized = normalizePureAiOutput({
    document: { ...document('gas'), billing_period_start: '2026-07-01', billing_period_end: '2026-07-31' },
    supplies: [{ commodity: 'gas', provider: 'E.ON Energia', offer_name: 'E.ON Gas Insieme', offer_code: null, fields: [
      row('annual_consumption', 'Consumo annuo', 15.28, '15,28', 'Smc', 'year', 'none', 2),
      row('period_consumption', 'Consumo fatturato nel periodo', 15.29, '15,29', 'Smc', 'none', 'none', 2),
      row('unit_price', 'Materia prima gas', 0.5, '0,5', '€/Smc', 'none', 'none', 2),
      row('fixed_fee', 'Quota fissa vendita', 9, '9', '€/mese', 'month', 'none', 2),
    ]}],
  });
  assert.equal(normalized.consumo_gas_smc, undefined);
  assert.equal(normalized.consumo_periodo_gas_smc, 15.29);
});

test('gas: scarta il falso annuo identico al consumo di un periodo breve', () => {
  const normalized = normalizePureAiOutput({
    document: { ...document('gas'), billing_period_start: '2026-07-01', billing_period_end: '2026-07-31' },
    supplies: [{ commodity: 'gas', provider: 'Gas Test', offer_name: 'Gas Casa', offer_code: null, fields: [
      row('annual_consumption', 'Consumo annuo', 15.28, '15,28', 'Smc', 'year', 'none', 2),
      row('period_consumption', 'Consumo fatturato nel periodo', 15.28, '15,28', 'Smc', 'none', 'none', 2),
      row('unit_price', 'Materia prima gas', 0.5, '0,5', '€/Smc', 'none', 'none', 2),
      row('fixed_fee', 'Quota fissa vendita', 8, '8', '€/mese', 'month', 'none', 2),
    ]}],
  });
  assert.equal(normalized.consumo_gas_smc, undefined);
  assert.equal(normalized.consumo_periodo_gas_smc, 15.28);
});

test('gas: conserva un vero consumo annuo diverso dal consumo del periodo', () => {
  const normalized = normalizePureAiOutput({
    document: { ...document('gas'), billing_period_start: '2026-07-01', billing_period_end: '2026-07-31' },
    supplies: [{ commodity: 'gas', provider: 'Gas Test', offer_name: 'Gas Casa', offer_code: null, fields: [
      row('annual_consumption', 'Consumo annuo ultimi 12 mesi', 740, '740', 'Smc', 'year', 'none', 2),
      row('period_consumption', 'Consumo fatturato nel periodo', 15.28, '15,28', 'Smc', 'none', 'none', 2),
      row('unit_price', 'Materia prima gas', 0.5, '0,5', '€/Smc', 'none', 'none', 2),
      row('fixed_fee', 'Quota fissa vendita', 8, '8', '€/mese', 'month', 'none', 2),
    ]}],
  });
  assert.equal(normalized.consumo_gas_smc, 740);
  assert.equal(normalized.consumo_periodo_gas_smc, 15.28);
});

test('gas: consumo del periodo già in Smc resta invariato e non diventa annuo', () => {
  const normalized = normalizePureAiOutput({
    document: { ...document('gas'), billing_period_start: '2026-07-01', billing_period_end: '2026-07-31' },
    supplies: [{ commodity: 'gas', provider: 'Gas Test', offer_name: 'Gas Casa', offer_code: null, fields: [
      row('period_consumption', 'Consumo fatturato nel periodo', 15.28, '15,28', 'Smc', 'none', 'none', 2),
      row('unit_price', 'Materia prima gas', 0.5, '0,5', '€/Smc', 'none', 'none', 2),
      row('fixed_fee', 'Quota fissa vendita', 8, '8', '€/mese', 'month', 'none', 2),
    ]}],
  });
  assert.equal(normalized.consumo_gas_smc, undefined);
  assert.equal(normalized.consumo_periodo_gas_smc, 15.28);
  assert.equal(normalized.consumo_periodo_gas_mc, undefined);
});

test('gas: converte mc in Smc usando soltanto il coefficiente correttivo C', () => {
  const normalized = normalizePureAiOutput({
    document: { ...document('gas'), billing_period_start: '2026-07-01', billing_period_end: '2026-07-31' },
    supplies: [{ commodity: 'gas', provider: 'Gas Test', offer_name: 'Gas Casa', offer_code: null, fields: [
      row('period_consumption', 'Consumo misurato nel periodo', 15, '15', 'mc', 'none', 'none', 2),
      row('multiplier', 'Coefficiente correttivo C', 1.018, '1,018', null, 'none', 'none', 2),
      row('unit_price', 'Materia prima gas', 0.5, '0,5', '€/Smc', 'none', 'none', 2),
      row('price_component', 'Materia prima gas', 0.5, '0,5', '€/Smc', 'none', 'none', 2),
      row('fixed_fee', 'Quota fissa vendita', 8, '8', '€/mese', 'month', 'none', 2),
    ]}],
  });
  assert.equal(normalized.consumo_periodo_gas_mc, 15);
  assert.equal(normalized.coefficiente_conversione_gas_c, 1.018);
  assert.equal(normalized.consumo_periodo_gas_smc, 15.27);
  assert.equal(normalized.moltiplicatore_indice_gas, undefined);
  assert.equal(normalized.prezzo_gas_eur_smc, 0.5);
  assert.equal(normalized.precisione_confronto_gas, 'completa');
});

test('gas: un consumo in mc senza coefficiente C non viene spacciato per Smc', () => {
  const normalized = normalizePureAiOutput({
    document: { ...document('gas'), billing_period_start: '2026-07-01', billing_period_end: '2026-07-31' },
    supplies: [{ commodity: 'gas', provider: 'Gas Test', offer_name: 'Gas Casa', offer_code: null, fields: [
      row('period_consumption', 'Consumo misurato nel periodo', 15, '15', 'mc', 'none', 'none', 2),
      row('unit_price', 'Materia prima gas', 0.5, '0,5', '€/Smc', 'none', 'none', 2),
      row('fixed_fee', 'Quota fissa vendita', 8, '8', '€/mese', 'month', 'none', 2),
    ]}],
  });
  assert.equal(normalized.consumo_periodo_gas_mc, 15);
  assert.equal(normalized.consumo_periodo_gas_smc, undefined);
  assert.equal(normalized.coefficiente_conversione_gas_c, undefined);
});

test('gas: il coefficiente C non viene usato come moltiplicatore della formula prezzo', () => {
  const normalized = normalizePureAiOutput({
    document: document('gas'),
    supplies: [{ commodity: 'gas', provider: 'Gas Test', offer_name: 'Gas Casa', offer_code: null, fields: [
      row('annual_consumption', 'Consumo annuo', 1000, '1000', 'Smc', 'year', 'none', 1),
      row('unit_price', 'Materia prima gas', 0.5, '0,5', '€/Smc', 'none', 'none', 2),
      row('price_component', 'Materia prima gas', 0.5, '0,5', '€/Smc', 'none', 'none', 2),
      row('multiplier', 'Coefficiente C conversione mc in Smc', 1.03, '1,03', null, 'none', 'none', 2),
      row('formula', 'Formula prezzo', null, 'Materia prima gas; coefficiente C usato per convertire i consumi', null, 'none', 'none', 2),
      row('fixed_fee', 'Quota fissa vendita', 10, '10', '€/mese', 'month', 'none', 2),
    ]}],
  });
  assert.equal(normalized.prezzo_gas_eur_smc, 0.5);
  assert.equal(normalized.coefficiente_conversione_gas_c, 1.03);
  assert.equal(normalized.moltiplicatore_indice_gas, undefined);
  assert.equal(normalized.normalizzazione_prezzo_gas.factor, null);
});

test('recupero gas: se il periodo è in mc recupera anche C e salva lo storico in Smc', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ia-gas-mc-recovery-'));
  const filePath = path.join(dir, 'bolletta.pdf');
  await fs.writeFile(filePath, '%PDF-test');
  let calls = 0;
  const primary = {
    document: { ...document('gas'), billing_period_start: '2026-07-01', billing_period_end: '2026-07-31' },
    supplies: [{ commodity: 'gas', provider: 'Gas Test', offer_name: 'Gas Casa', offer_code: null, fields: [
      row('unit_price', 'Materia prima gas', 0.5, '0,5', '€/Smc', 'none', 'none', 2),
      row('fixed_fee', 'Quota fissa vendita', 8, '8', '€/mese', 'month', 'none', 2),
    ]}],
  };
  const recovery = {
    document: { ...document('gas'), billing_period_start: '2026-07-01', billing_period_end: '2026-07-31' },
    supplies: [{ commodity: 'gas', provider: null, offer_name: null, offer_code: null, fields: [
      row('period_consumption', 'Consumo misurato nel periodo', 15, '15', 'mc', 'none', 'none', 2),
      row('multiplier', 'Coefficiente correttivo C', 1.018, '1,018', null, 'none', 'none', 2),
    ]}],
  };
  const normalized = await extractPdfPureAi({
    filePath,
    apiKey: 'test',
    transport: async () => ({ id: `resp-${++calls}`, output_text: JSON.stringify(calls === 1 ? primary : recovery) }),
  });
  assert.equal(calls, 2);
  assert.equal(normalized.consumo_periodo_gas_mc, 15);
  assert.equal(normalized.coefficiente_conversione_gas_c, 1.018);
  assert.equal(normalized.consumo_periodo_gas_smc, 15.27);
  await fs.rm(dir, { recursive: true, force: true });
});

test('gas: se il primo prezzo è aggregato recupera componenti e ricostruisce la materia senza usare gli oneri', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ia-gas-price-recovery-'));
  const filePath = path.join(dir, 'bolletta.pdf');
  await fs.writeFile(filePath, '%PDF-test');
  let calls = 0;
  const primary = {
    document: { ...document('gas'), billing_period_start: '2026-07-01', billing_period_end: '2026-07-31' },
    supplies: [{ commodity: 'gas', provider: 'E.ON Energia', offer_name: 'E.ON Gas Insieme', offer_code: null, fields: [
      row('annual_consumption', 'Consumo annuo', 15.28, '15,28', 'Smc', 'year', 'none', 2),
      row('period_consumption', 'Consumo fatturato nel periodo', 15.29, '15,29', 'Smc', 'none', 'none', 2),
      row('unit_price', 'Corrispettivo consumo gas', 0.750215, '0,750215', '€/Smc', 'none', 'none', 2),
      row('formula', 'Formula', null, 'Prezzo all’ingrosso + spread', null, 'none', 'none', 2),
      row('fixed_fee', 'Quota fissa vendita', 9, '9', '€/mese', 'month', 'none', 2),
    ]}],
  };
  const recovery = {
    document: { ...document('gas'), billing_period_start: '2026-07-01', billing_period_end: '2026-07-31' },
    supplies: [{ commodity: 'gas', provider: null, offer_name: null, offer_code: null, fields: [
      row('period_consumption', 'Consumo fatturato nel periodo', 15.29, '15,29', 'Smc', 'none', 'none', 2),
      row('price_component', 'Prezzo all’ingrosso gas', 0.43, '0,43', '€/Smc', 'none', 'none', 3),
      row('spread', 'Spread commerciale', 0.044, '0,044', '€/Smc', 'none', 'none', 3),
      row('formula', 'Formula', null, 'Prezzo all’ingrosso + spread', null, 'none', 'none', 3),
    ]}],
  };
  const normalized = await extractPdfPureAi({
    filePath,
    apiKey: 'test',
    transport: async ({ profile }) => {
      calls += 1;
      return { id: `resp-${calls}`, output_text: JSON.stringify(profile.includes('recovery') ? recovery : primary) };
    },
  });
  assert.equal(calls, 2);
  assert.equal(normalized.consumo_gas_smc, undefined);
  assert.equal(normalized.consumo_periodo_gas_smc, 15.29);
  assert.equal(normalized.prezzo_vendita_bolletta_gas_eur_smc, 0.750215);
  assert.equal(normalized.prezzo_gas_eur_smc, 0.474);
  assert.equal(normalized.normalizzazione_prezzo_gas.source, 'componenti_deterministiche');
  assert.deepEqual(normalized.ai.price_recovery_requested, ['gas']);
  assert.equal(normalized.ai.recovery_attempted, true);
  await fs.rm(dir, { recursive: true, force: true });
});

test('gas: normalizza un fattore PCS quando la relazione aritmetica è verificabile', () => {
  const normalized = normalizePureAiOutput({
    document: document('gas'),
    supplies: [{ commodity: 'gas', provider: 'Gas Test', offer_name: 'PSV Casa', offer_code: null, fields: [
      row('annual_consumption', 'Consumo annuo', 1000, '1000', 'Smc', 'year', 'none', 1),
      row('unit_price', 'Spesa per la vendita di gas naturale', 0.565, '0,565', '€/Smc', 'none', 'none', 2),
      row('price_component', 'Materia prima gas adeguata al PCS', 0.515, '0,515', '€/Smc', 'none', 'none', 2),
      row('spread', 'Spread', 0.05, '0,05', '€/Smc', 'none', 'none', 2),
      row('multiplier', 'Coefficiente PCS', 1.03, '1,03', null, 'none', 'none', 2),
      row('formula', 'Formula', null, 'PSV × coefficiente PCS + spread', null, 'none', 'none', 2),
      row('fixed_fee', 'Quota fissa vendita', 10, '10', '€/mese', 'month', 'none', 2),
    ]}],
  });
  assert.equal(normalized.prezzo_vendita_bolletta_gas_eur_smc, 0.565);
  assert.equal(normalized.prezzo_gas_eur_smc, 0.55);
  assert.equal(normalized.precisione_confronto_gas, 'completa');
  assert.equal(normalized.normalizzazione_prezzo_gas.factorMode, 'base_after_normalization_factor');
});

test('materia presente ma sconto citato senza valore mantiene il prezzo e avvisa sulla precisione', () => {
  const normalized = normalizePureAiOutput({
    document: document('electricity'),
    supplies: [{ commodity: 'electricity', provider: 'Test', offer_name: 'Test', offer_code: null, fields: [
      row('annual_consumption', 'Consumo annuo', 2000, '2000', 'kWh', 'year', 'none', 1),
      row('unit_price', 'Spesa per la vendita di energia elettrica', 0.15, '0,15', '€/kWh', 'none', 'none', 2),
      row('price_component', 'Materia energia', 0.12, '0,12', '€/kWh', 'none', 'none', 2),
      row('formula', 'Formula', null, 'Materia energia - sconto commerciale', null, 'none', 'none', 2),
      row('fixed_fee', 'Quota fissa vendita', 10, '10', '€/mese', 'month', 'none', 2),
    ]}],
  });
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.12);
  assert.equal(normalized.precisione_confronto_luce, 'limitata');
  assert.ok(normalized.motivi_precisione_confronto_luce.includes('sconto_citato_non_quantificato'));
});

test('formula non scomponibile mantiene il confronto ma lo marca a precisione limitata', () => {
  const normalized = normalizePureAiOutput({
    document: document('electricity'),
    supplies: [{ commodity: 'electricity', provider: 'Test', offer_name: 'Test', offer_code: null, fields: [
      row('annual_consumption', 'Consumo annuo', 2000, '2000', 'kWh', 'year', 'none', 1),
      row('unit_price', 'Spesa per la vendita di energia elettrica', 0.18, '0,18', '€/kWh', 'none', 'none', 2),
      row('formula', 'Formula', null, 'Materia energia + C.DISP.D. - sconto', null, 'none', 'none', 2),
      row('fixed_fee', 'Quota fissa vendita', 10, '10', '€/mese', 'month', 'none', 2),
    ]}],
  });
  assert.equal(normalized.prezzo_luce_eur_kwh, 0.18);
  assert.equal(normalized.precisione_confronto_luce, 'limitata');
  assert.ok(normalized.motivi_precisione_confronto_luce.includes('formula_e_componenti_insufficienti'));
  assert.ok(normalized.validation_issues.some((issue) => issue.code === 'comparison_precision_limited_luce'));
});

test('risposta incompleta non avvia un secondo tentativo nascosto', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ia-incomplete-'));
  const filePath = path.join(dir, 'bolletta.pdf');
  await fs.writeFile(filePath, '%PDF-test');
  let calls = 0;
  await assert.rejects(
    extractPdfPureAi({
      filePath,
      apiKey: 'test',
      transport: async () => {
        calls += 1;
        return { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } };
      },
    }),
    /openai_incomplete:max_output_tokens/,
  );
  assert.equal(calls, 1);
  await fs.rm(dir, { recursive: true, force: true });
});


test('classificazioni palesemente errate vengono corrette senza alterare il raw', () => {
  const raw = {
    document: document('dual'),
    supplies: [
      { commodity: 'electricity', provider: 'Eni Plenitude', offer_name: null, offer_code: null, fields: [
        row('annual_consumption', 'Consumo annuo', 2196, '2.196', 'kWh', 'year', 'none', 1),
        row('unit_price', 'Corrispettivo Energia', 0.123, '0,12300000', '€/kWh', 'none', 'none', 12),
        row('price_structure', 'Formula prevista', null, 'Corrispettivo Energia * 1,1 - Sconto + Dispacciamento', null, 'none', 'none', 5),
        row('price_type', 'Tipologia prezzo', null, 'offerta monoraria', null, 'none', 'none', 5),
        row('multiplier', 'Moltiplicatore', null, 'null', null, 'none', 'none', 5),
      ]},
      { commodity: 'gas', provider: 'Eni Plenitude', offer_name: null, offer_code: null, fields: [
        row('annual_consumption', 'Consumo annuo', 1363, '1.363', 'Smc', 'year', 'none', 1),
        row('unit_price', 'Corrispettivo Gas', 0.4324081, '0,43240810', '€/Smc', 'none', 'none', 2),
        row('price_structure', 'Formula prevista', null, 'Corrispettivo Gas - Sconto Domiciliazione', null, 'none', 'none', 2),
      ]},
    ],
  };
  const normalized = normalizePureAiOutput(raw);
  const luce = normalized.adaptive_form.supplies.find((supply) => supply.commodity === 'luce');
  const gas = normalized.adaptive_form.supplies.find((supply) => supply.commodity === 'gas');

  assert.equal(normalized.comparison_form_raw.supplies[0].fields[2].purpose, 'price_structure');
  assert.equal(normalized.formula_prezzo_luce, 'Corrispettivo Energia * 1,1 - Sconto + Dispacciamento');
  assert.equal(normalized.formula_prezzo_gas, 'Corrispettivo Gas - Sconto Domiciliazione');
  assert.equal(normalized.struttura_prezzo_luce, 'offerta monoraria');
  assert.equal(normalized.tipo_prezzo_luce, undefined);
  assert.equal(luce.formula, 'Corrispettivo Energia * 1,1 - Sconto + Dispacciamento');
  assert.equal(luce.price_structure, 'offerta monoraria');
  assert.equal(luce.multiplier, null);
  assert.equal(gas.formula, 'Corrispettivo Gas - Sconto Domiciliazione');
});
