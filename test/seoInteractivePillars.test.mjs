import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(__dirname,'..');
const publicDir=path.join(root,'public');
const guide=fs.readFileSync(path.join(publicDir,'come-leggere-bolletta-luce-gas.html'),'utf8');
const offers=fs.readFileSync(path.join(publicDir,'offerte-luce-gas-aggiornate.html'),'utf8');
const sitemap=fs.readFileSync(path.join(publicDir,'sitemap.xml'),'utf8');

test('guida bolletta: interazioni contestuali riusano il lettore PDF esistente',()=>{
  assert.match(guide,/id="guide-price-help"/);
  assert.match(guide,/id="guide-type-help"/);
  assert.match(guide,/id="guide-expiry-help"/);
  assert.ok((guide.match(/#pdf-upload-panel/g)||[]).length>=3);
  assert.match(guide,/\/assets\/seo-energy-interactions\.js/);
  assert.match(guide,/\/assets\/seo-energy-interactions\.css/);
  assert.doesNotMatch(guide,/\/api\//);
});

test('offerte aggiornate: scelta iniziale porta ai tre percorsi esistenti',()=>{
  assert.match(offers,/id="offers-start-question"/);
  assert.match(offers,/data-choice="bolletta"/);
  assert.match(offers,/data-choice="consumi"/);
  assert.match(offers,/data-choice="profilo"/);
  assert.match(offers,/from=offerte-aggiornate-bolletta#pdf-upload-panel/);
  assert.match(offers,/from=offerte-aggiornate-consumi/);
  assert.match(offers,/from=offerte-aggiornate-profilo/);
  assert.match(offers,/\/assets\/seo-energy-interactions\.js/);
});

test('pagine pilastro: canonical e H1 restano unici',()=>{
  for(const [html,slug] of [[guide,'come-leggere-bolletta-luce-gas'],[offers,'offerte-luce-gas-aggiornate']]){
    assert.equal((html.match(/<h1\b/g)||[]).length,1,`${slug}: H1 duplicato`);
    assert.equal((html.match(/rel="canonical"/g)||[]).length,1,`${slug}: canonical duplicata`);
    assert.match(html,new RegExp(`https://offertalogica\\.it/${slug}\\.html`));
  }
});

test('sitemap: lastmod aggiornato solo sulle due pagine del pacchetto',()=>{
  assert.match(sitemap,/come-leggere-bolletta-luce-gas\.html<\/loc><lastmod>2026-08-28<\/lastmod>/);
  assert.match(sitemap,/offerte-luce-gas-aggiornate\.html<\/loc><lastmod>2026-08-28<\/lastmod>/);
});
