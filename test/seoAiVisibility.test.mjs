import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(`public/${rel}`, 'utf8');
const home = read('index.html');
const pun = read('pun-oggi.html');
const psv = read('psv-gas-oggi.html');
const offers = read('offerte-luce-gas-aggiornate.html');
const pv = read('fotovoltaico.html');
const agri = read('energia-aziende-agricole.html');
const livestock = read('costi-energetici-allevamenti.html');

const orgId = 'https://offertalogica.it/#organization';
const siteId = 'https://offertalogica.it/#website';

test('homepage definisce identita Organization, WebSite e calcolatore con @id stabili', () => {
  assert.match(home, /"@type"\s*:\s*"Organization"/);
  assert.ok(home.includes(orgId));
  assert.match(home, /"@type"\s*:\s*"WebSite"/);
  assert.ok(home.includes(siteId));
  assert.ok(home.includes('https://offertalogica.it/#calculator'));
});

test('pagine prioritarie referenziano la stessa identita OffertaLogica', () => {
  for (const html of [pun, psv, offers, pv, agri, livestock]) {
    assert.ok(html.includes(orgId));
    assert.ok(html.includes(siteId));
  }
});

test('simulatore fotovoltaico espone fonti primarie visibili e nel grafo strutturato', () => {
  const urls = [
    'https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis_en',
    'https://www.media.enea.it/comunicati-e-news/archivio-anni/anno-2026/energia-case-vuote-con-riqualificazione-energetica-valore-di-mercato-aumenta-del-45.html',
    'https://www.arera.it/bolletta/glossario-dei-termini/dettaglio/fasce-orarie'
  ];
  assert.match(pv, /Fonti ufficiali del calcolo/);
  assert.match(pv, /"isBasedOn"/);
  for (const url of urls) assert.ok(pv.includes(url));
});

test('nessuna modifica introduce endpoint API nelle pagine SEO prioritarie', () => {
  for (const html of [pun, psv, offers, pv, agri, livestock]) {
    assert.doesNotMatch(html, /(?:href|src)=["']\/api\//i);
  }
});
