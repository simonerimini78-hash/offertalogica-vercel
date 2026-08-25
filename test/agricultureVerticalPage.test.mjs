import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const agriculture = readFileSync(new URL('../public/energia-aziende-agricole.html', import.meta.url), 'utf8');
const offers = readFileSync(new URL('../public/offerte-luce-gas-aggiornate.html', import.meta.url), 'utf8');

test('pagina agricola è indicizzabile e ha canonical/OG coerenti', () => {
  assert.match(agriculture, /<meta name="robots" content="index,follow">/);
  assert.match(agriculture, /<link rel="canonical" href="https:\/\/offertalogica\.it\/energia-aziende-agricole\.html">/);
  assert.match(agriculture, /<meta property="og:url" content="https:\/\/offertalogica\.it\/energia-aziende-agricole\.html">/);
});

test('pagina agricola mantiene il perimetro economico e non crea nuovi endpoint', () => {
  assert.match(agriculture, /check economico della fornitura/i);
  assert.match(agriculture, /non progetta né dimensiona impianti fotovoltaici/i);
  assert.doesNotMatch(agriculture, /fetch\s*\(/i);
  assert.doesNotMatch(agriculture, /\/api\//i);
});

test('CTA porta al calcolatore business esistente senza inventare deep-link', () => {
  assert.match(agriculture, /Scegli Azienda \/ P\.IVA/i);
  assert.match(agriculture, /Agricoltura \/ Allevamento/i);
  const rootLinks = [...agriculture.matchAll(/href="\/"/g)];
  assert.ok(rootLinks.length >= 2);
});

test('non vengono linkate le pagine verticali future prima della pubblicazione', () => {
  assert.doesNotMatch(agriculture, /costi-energetici-allevamenti\.html/i);
  assert.doesNotMatch(agriculture, /energia-allevamento-avicolo\.html/i);
});

test('la pagina offerte aggiornata collega la nuova pillar agricola una sola volta', () => {
  const matches = [...offers.matchAll(/href="\/energia-aziende-agricole\.html"/g)];
  assert.equal(matches.length, 1);
  assert.match(offers, />Energia per aziende agricole<\/a>/);
});
