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
  assert.equal(PDF_PURE_AI_READER_VERSION, 'pure-ai-native-pdf-v2.0.4-premium-contract-dates');
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
  assert.ok(item.properties.purpose.enum.includes('conditions_start'));
  assert.ok(item.properties.purpose.enum.includes('conditions_end'));
  assert.match(request.input[0].content[0].text, /non usare il periodo di fatturazione/);
  assert.match(request.input[0].content[0].text, /non cercare né restituire dati personali, POD, PDR/);
  assert.ok(JSON.stringify(schema).length < 3200);
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
