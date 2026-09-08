import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const workflow = fs.readFileSync('.github/workflows/update-arera-menu.yml', 'utf8');
const localUpdater = fs.readFileSync('scripts/aggiorna-arera-locale-mac.sh', 'utf8');
const script = fs.readFileSync('scripts/update-energy-today.py', 'utf8');
const live = fs.readFileSync('public/assets/seo-energy-live.js', 'utf8');
const data = JSON.parse(fs.readFileSync('public/data/energia-oggi.json', 'utf8'));

test('acquisizione energia resta sul Mac; GitHub esegue soltanto verifiche offline', () => {
  assert.match(workflow, /name: Verifica dati OffertaLogica/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /cron:/);
  assert.doesNotMatch(workflow, /python scripts\/update-energy-today\.py/);
  assert.doesNotMatch(workflow, /git push/);
  assert.match(localUpdater, /scripts\/update-energy-today\.py/);
  assert.match(localUpdater, /scripts\/update-sitemap-lastmod\.py/);
  assert.match(localUpdater, /public\/offerte-luce-gas-aggiornate\.html/);
  assert.doesNotMatch(localUpdater, /\/api\//);
});

test('lo script usa ARERA Vigilanza, riusa il PSV mensile e sincronizza tutte le superfici energia', () => {
  assert.match(script, /https:\/\/www\.arera\.it\/vigilanza-energetica/);
  assert.match(script, /public\/data\/calcolo-parametri\.json/);
  assert.match(script, /PSV mensile non presente in calcolo-parametri\.json/);
  assert.match(script, /render_pun_page/);
  assert.match(script, /render_gas_page/);
  assert.match(script, /render_pun_method_section/);
  assert.match(script, /render_gas_method_section/);
  assert.match(script, /render_sitemap/);
  assert.match(script, /--sync-from-json/);
  assert.match(script, /I file pubblici esistenti non sono stati sovrascritti/);
  assert.doesNotMatch(script, /gme\.mercatoelettrico\.org/);
});

test('energia-oggi è la fonte tecnica locale e conserva etichette di origine coerenti', () => {
  assert.equal(data.fonteInterna, 'OffertaLogica - aggiornamento dati energia');
  assert.equal(data.gas.psvMensile.fonte, 'OffertaLogica - calcolo-parametri.json');
  assert.ok(data.pun.fonteOriginaleLabel);
  assert.ok(data.gas.giornaliero.fonteOriginaleLabel);
  assert.ok(data.gas.psvMensile.fonteOriginaleLabel);
});

test('il JS usa l’etichetta di origine del JSON e mantiene anche la fonte PSV mensile', () => {
  assert.match(live, /fonteOriginaleLabel/);
  assert.match(live, /setGasSources/);
  assert.match(live, /PSV mensile:/);
  assert.match(live, /Non viene presentato come valore di oggi/);
  assert.match(live, /calcolo-parametri\.json/);
});

test('sync-from-json aggiorna fallback, Fonti e metodo, dateModified e solo i lastmod energia', () => {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ol-energy-sync-'));
  try{
    const publicDir=path.join(tmp,'public');
    fs.mkdirSync(path.join(publicDir,'data'),{recursive:true});
    for(const file of ['pun-oggi.html','psv-gas-oggi.html','sitemap.xml']){
      fs.copyFileSync(path.join('public',file),path.join(publicDir,file));
    }
    const fixture=structuredClone(data);
    fixture.pun.data='2026-11-15';
    fixture.pun.valoreEurMwh=123.45;
    fixture.pun.valoreEurKwh=0.12345;
    fixture.pun.ieriEurMwh=120;
    fixture.pun.variazionePercentuale=2.875;
    fixture.pun.minimoEurMwh=null;
    fixture.pun.massimoEurMwh=null;
    fixture.pun.fonteOriginaleLabel='ARERA — Test PUN futuro';
    fixture.pun.urlFonteOriginale='https://www.arera.it/test-pun-futuro.pdf';
    fixture.gas.giornaliero.data='2026-11-14';
    fixture.gas.giornaliero.valoreEurMwh=66.5;
    fixture.gas.giornaliero.ieriEurMwh=65;
    fixture.gas.giornaliero.variazionePercentuale=2.307692;
    fixture.gas.giornaliero.fonteOriginaleLabel='ARERA — Test gas futuro';
    fixture.gas.giornaliero.urlFonteOriginale='https://www.arera.it/test-gas-futuro.pdf';
    fixture.gas.psvMensile.label='PSV TEST MENSILE';
    fixture.gas.psvMensile.periodo='2026-10';
    fixture.gas.psvMensile.periodoLabel='Ottobre 2026';
    fixture.gas.psvMensile.valoreEurSmc=0.712345;
    fixture.gas.psvMensile.fonteOriginaleLabel='ARERA — Test PSV futuro';
    fixture.gas.psvMensile.urlFonteOriginale='https://www.arera.it/test-psv-futuro';
    const jsonPath=path.join(publicDir,'data','energia-oggi.json');
    fs.writeFileSync(jsonPath,JSON.stringify(fixture,null,2));
    const sitemapBefore=fs.readFileSync(path.join(publicDir,'sitemap.xml'),'utf8');
    const offersBefore=sitemapBefore.match(/offerte-luce-gas-aggiornate\.html<\/loc><lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/)?.[1];

    const run=spawnSync('python3',['scripts/update-energy-today.py','--sync-from-json','--output',jsonPath,'--pun-page',path.join(publicDir,'pun-oggi.html'),'--gas-page',path.join(publicDir,'psv-gas-oggi.html'),'--sitemap',path.join(publicDir,'sitemap.xml')],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr||run.stdout);
    const pun=fs.readFileSync(path.join(publicDir,'pun-oggi.html'),'utf8');
    const gas=fs.readFileSync(path.join(publicDir,'psv-gas-oggi.html'),'utf8');
    const sitemap=fs.readFileSync(path.join(publicDir,'sitemap.xml'),'utf8');
    assert.match(pun,/123,45/);
    assert.match(pun,/"dateModified":"2026-11-15"/);
    assert.match(pun,/data-energy-method="pun"/);
    assert.match(pun,/15\/11\/2026/);
    assert.match(pun,/ARERA — Test PUN futuro/);
    assert.match(gas,/66,50 €\/MWh/);
    assert.match(gas,/"dateModified":"2026-11-14"/);
    assert.match(gas,/data-energy-method="gas"/);
    assert.match(gas,/Ottobre 2026/);
    assert.match(gas,/0,712345 €\/Smc/);
    assert.match(gas,/ARERA — Test PSV futuro/);
    assert.match(sitemap,/pun-oggi\.html<\/loc><lastmod>2026-11-15<\/lastmod>/);
    assert.match(sitemap,/psv-gas-oggi\.html<\/loc><lastmod>2026-11-14<\/lastmod>/);
    if(offersBefore){
      assert.match(sitemap,new RegExp(`offerte-luce-gas-aggiornate\\.html</loc><lastmod>${offersBefore}</lastmod>`));
    }
  } finally {
    fs.rmSync(tmp,{recursive:true,force:true});
  }
});
