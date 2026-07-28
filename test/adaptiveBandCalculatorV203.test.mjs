import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function between(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing start marker: ${start}`);
  assert.ok(to > from, `missing end marker: ${end}`);
  return html.slice(from, to);
}

const context = {
  PDF_PROFILE_STATE: { current: {}, offer: {} },
  document: { getElementById: () => null },
  aggiornaTestoPulsanteConfronto: () => {},
  pulisciErroreCampo: () => {},
  console,
};
vm.createContext(context);
vm.runInContext(between('function numeroSicuro', 'function calcolaVoceEnergia'), context);
vm.runInContext(between('function fasceDaProfiloPdf', 'function leggiOffertaAttuale'), context);
vm.runInContext(between('function materiaLuceDaProfiloFasce', 'function erroreCampoId'), context);
vm.runInContext(between('function bandaAdattivaPdf', 'function rigaAdattivaPdf'), context);

const irina = JSON.parse(fs.readFileSync('/mnt/data/Pasted text (2)(13).txt', 'utf8')).normalized;
const irinaLuce = irina.adaptive_form.supplies.find((supply) => supply.commodity === 'luce');

const plenitude = JSON.parse(fs.readFileSync('/mnt/data/Pasted text(104).txt', 'utf8')).normalized;
const plenitudeLuce = plenitude.adaptive_form.supplies.find((supply) => supply.commodity === 'luce');

test('Irina F1/F23 is connected to the existing band calculator', () => {
  context.PDF_PROFILE_STATE.current = {};
  const bindings = context.sincronizzaProfiloDaFornituraAdattivaPdf(irinaLuce, 'current');
  assert.deepEqual({ ...bindings.consumptions }, { f1: 732.8, f23: 1117.2 });
  assert.deepEqual({ ...bindings.prices }, { f1: 0.156567, f23: 0.146567 });
  assert.equal(context.profiloPrezzoLucePerFasceCompleto('current'), true);
  assert.equal(context.campoEssenzialeCopertoDaProfiloAdattivo({ id: 'in-luce-prezzo-att' }), true);

  const materia = context.materiaLuceDaProfiloFasce('current');
  assert.equal(materia.modalitaPrezzo, 'f1_f23');
  assert.ok(Math.abs(materia.consumoFatturato - 1850) < 1e-9);
  assert.ok(Math.abs(materia.quotaMateria - 278.47695) < 1e-9);
  assert.ok(Math.abs((materia.quotaMateria / materia.consumoFatturato) - 0.1505280810810811) < 1e-12);
});

test('single-price Plenitude path is not replaced by incomplete band prices', () => {
  context.PDF_PROFILE_STATE.current = { prezzo_luce_f2: 0.222222 };
  const bindings = context.sincronizzaProfiloDaFornituraAdattivaPdf(plenitudeLuce, 'current');
  assert.deepEqual({ ...bindings.prices }, {});
  assert.equal(context.PDF_PROFILE_STATE.current.prezzo_luce_f2, 0.222222);
  assert.equal(context.profiloPrezzoLucePerFasceCompleto('current'), false);
  assert.equal(plenitude.prezzo_luce_eur_kwh, 0.149077);
});

test('ambiguous duplicate values for the same band are not used', () => {
  const mapped = context.mappaValoriBandaAdattivaPdf([
    { band: 'F1', value: 0.12 },
    { band: 'F1', value: 0.14 },
    { band: 'F23', value: 0.11 },
  ], { positive: true });
  assert.deepEqual({ ...mapped }, { f23: 0.11 });
});

test('Italian-formatted adaptive edits are parsed correctly', () => {
  assert.equal(context.numeroDaTestoAdattivoPdf('1.117,20 kWh'), 1117.2);
  assert.equal(context.numeroDaTestoAdattivoPdf('0,156567 €/kWh'), 0.156567);
  assert.equal(context.numeroDaTestoAdattivoPdf('-6,10 €/mese'), -6.1);
});
