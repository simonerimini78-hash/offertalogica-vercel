import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const agriculture = readFileSync(new URL('../public/energia-aziende-agricole.html', import.meta.url), 'utf8');
const livestock = readFileSync(new URL('../public/costi-energetici-allevamenti.html', import.meta.url), 'utf8');

test('pagina allevamenti è indicizzabile con canonical e OG coerenti', () => {
  assert.match(livestock, /<meta name="robots" content="index,follow">/);
  assert.match(livestock, /<link rel="canonical" href="https:\/\/offertalogica\.it\/costi-energetici-allevamenti\.html">/);
  assert.match(livestock, /<meta property="og:url" content="https:\/\/offertalogica\.it\/costi-energetici-allevamenti\.html">/);
});

test('pagina allevamenti resta nel perimetro economico e non crea endpoint', () => {
  assert.match(livestock, /controllo economico preliminare della fornitura/i);
  assert.match(livestock, /non sostituisce una diagnosi energetica/i);
  assert.doesNotMatch(livestock, /fetch\s*\(/i);
  assert.doesNotMatch(livestock, /\/api\//i);
});

test('pagina allevamenti usa dati reali e non coefficienti zootecnici', () => {
  assert.match(livestock, /Consumo annuo kWh/i);
  assert.match(livestock, /Potenza impegnata/i);
  assert.match(livestock, /F1 \/ F2 \/ F3/i);
  assert.match(livestock, /Quota fissa/i);
  assert.match(livestock, /non usa medie per capo come base del confronto/i);
});

test('pagina allevamenti collega pillar e calcolatore esistenti', () => {
  const pillarLinks = [...livestock.matchAll(/href="\/energia-aziende-agricole\.html"/g)];
  assert.ok(pillarLinks.length >= 2);
  const rootLinks = [...livestock.matchAll(/href="\/"/g)];
  assert.ok(rootLinks.length >= 2);
});

test('la pillar collega la pagina allevamenti una sola volta', () => {
  const matches = [...agriculture.matchAll(/href="\/costi-energetici-allevamenti\.html"/g)];
  assert.equal(matches.length, 1);
  assert.match(agriculture, /Approfondisci i costi energetici negli allevamenti/);
});

test('la pagina allevamenti collega la specializzazione avicola, mentre la pillar mantiene la gerarchia', () => {
  assert.match(livestock, /href="\/energia-allevamento-avicolo\.html"/i);
  assert.doesNotMatch(agriculture, /href="\/energia-allevamento-avicolo\.html"/i);
});
