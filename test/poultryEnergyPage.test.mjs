import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const agriculture = readFileSync(new URL('../public/energia-aziende-agricole.html', import.meta.url), 'utf8');
const livestock = readFileSync(new URL('../public/costi-energetici-allevamenti.html', import.meta.url), 'utf8');
const poultry = readFileSync(new URL('../public/energia-allevamento-avicolo.html', import.meta.url), 'utf8');

test('pagina avicola è indicizzabile con canonical e OG coerenti', () => {
  assert.match(poultry, /<meta name="robots" content="index,follow">/);
  assert.match(poultry, /<link rel="canonical" href="https:\/\/offertalogica\.it\/energia-allevamento-avicolo\.html">/);
  assert.match(poultry, /<meta property="og:url" content="https:\/\/offertalogica\.it\/energia-allevamento-avicolo\.html">/);
});

test('pagina avicola mantiene il perimetro economico e non crea endpoint', () => {
  assert.match(poultry, /controllo economico preliminare della fornitura/i);
  assert.match(poultry, /non progetta ventilazione/i);
  assert.doesNotMatch(poultry, /fetch\s*\(/i);
  assert.doesNotMatch(poultry, /\/api\//i);
});

test('pagina avicola distingue profilo tecnico e dati reali della fornitura', () => {
  assert.match(poultry, /Broiler e ovaiole/i);
  assert.match(poultry, /Consumo annuo kWh/i);
  assert.match(poultry, /Potenza impegnata/i);
  assert.match(poultry, /F1 \/ F2 \/ F3/i);
  assert.match(poultry, /Quota fissa/i);
  assert.match(poultry, /Niente kWh standard per capo/i);
});

test('pagina avicola collega gerarchia e calcolatore esistenti', () => {
  assert.ok([...poultry.matchAll(/href="\/costi-energetici-allevamenti\.html"/g)].length >= 2);
  assert.ok([...poultry.matchAll(/href="\/energia-aziende-agricole\.html"/g)].length >= 2);
  assert.ok([...poultry.matchAll(/href="\/"/g)].length >= 2);
});

test('pagina allevamenti collega la specializzazione avicola senza saltare la gerarchia dalla pillar', () => {
  const livestockLinks = [...livestock.matchAll(/href="\/energia-allevamento-avicolo\.html"/g)];
  assert.equal(livestockLinks.length, 2);
  assert.match(livestock, /Approfondisci il profilo energetico avicolo/);
  assert.doesNotMatch(agriculture, /href="\/energia-allevamento-avicolo\.html"/i);
});
