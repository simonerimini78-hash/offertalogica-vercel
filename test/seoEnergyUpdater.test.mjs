import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const workflow = fs.readFileSync('.github/workflows/update-arera-menu.yml', 'utf8');
const script = fs.readFileSync('scripts/update-energy-today.py', 'utf8');
const live = fs.readFileSync('public/assets/seo-energy-live.js', 'utf8');
const data = JSON.parse(fs.readFileSync('public/data/energia-oggi.json', 'utf8'));

test('il workflow esistente aggiorna dati, HTML e sitemap senza nuova API applicativa', () => {
  assert.match(workflow, /name: Aggiorna dati OffertaLogica/);
  assert.match(workflow, /cron: "30 17 \* \* \*"/);
  assert.match(workflow, /python scripts\/update-energy-today\.py/);
  assert.match(workflow, /git add public\/data\/energia-oggi\.json public\/pun-oggi\.html public\/psv-gas-oggi\.html public\/sitemap\.xml/);
  assert.doesNotMatch(workflow, /\/api\//);
});

test('lo script usa ARERA Vigilanza, riusa il PSV mensile e sincronizza le superfici SEO', () => {
  assert.match(script, /https:\/\/www\.arera\.it\/vigilanza-energetica/);
  assert.match(script, /public\/data\/calcolo-parametri\.json/);
  assert.match(script, /PSV mensile non presente in calcolo-parametri\.json/);
  assert.match(script, /render_pun_page/);
  assert.match(script, /render_gas_page/);
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

test('sync-from-json aggiorna davvero fallback HTML, dateModified e sitemap senza rete', () => {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ol-energy-sync-'));
  try{
    const publicDir=path.join(tmp,'public');
    fs.mkdirSync(path.join(publicDir,'data'),{recursive:true});
    for(const file of ['pun-oggi.html','psv-gas-oggi.html','sitemap.xml']){
      fs.copyFileSync(path.join('public',file),path.join(publicDir,file));
    }
    const fixture=structuredClone(data);
    fixture.pun.data='2026-09-01';
    fixture.pun.valoreEurMwh=123.45;
    fixture.pun.valoreEurKwh=0.12345;
    fixture.pun.ieriEurMwh=120;
    fixture.pun.variazionePercentuale=2.875;
    fixture.pun.minimoEurMwh=null;
    fixture.pun.massimoEurMwh=null;
    fixture.pun.fonteOriginaleLabel='ARERA — Vigilanza Energetica';
    fixture.pun.urlFonteOriginale='https://www.arera.it/test-pun.pdf';
    fixture.gas.giornaliero.data='2026-08-31';
    fixture.gas.giornaliero.valoreEurMwh=66.5;
    fixture.gas.giornaliero.ieriEurMwh=65;
    fixture.gas.giornaliero.variazionePercentuale=2.307692;
    fixture.gas.giornaliero.fonteOriginaleLabel='ARERA — Vigilanza Energetica';
    fixture.gas.giornaliero.urlFonteOriginale='https://www.arera.it/test-gas.pdf';
    const jsonPath=path.join(publicDir,'data','energia-oggi.json');
    fs.writeFileSync(jsonPath,JSON.stringify(fixture,null,2));

    const run=spawnSync('python3',['scripts/update-energy-today.py','--sync-from-json','--output',jsonPath,'--pun-page',path.join(publicDir,'pun-oggi.html'),'--gas-page',path.join(publicDir,'psv-gas-oggi.html'),'--sitemap',path.join(publicDir,'sitemap.xml')],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr||run.stdout);
    const pun=fs.readFileSync(path.join(publicDir,'pun-oggi.html'),'utf8');
    const gas=fs.readFileSync(path.join(publicDir,'psv-gas-oggi.html'),'utf8');
    const sitemap=fs.readFileSync(path.join(publicDir,'sitemap.xml'),'utf8');
    assert.match(pun,/123,45/);
    assert.match(pun,/"dateModified":"2026-09-01"/);
    assert.match(pun,/ARERA — Vigilanza Energetica/);
    assert.match(gas,/66,50 €\/MWh/);
    assert.match(gas,/"dateModified":"2026-08-31"/);
    assert.match(sitemap,/pun-oggi\.html<\/loc><lastmod>2026-09-01<\/lastmod>/);
    assert.match(sitemap,/psv-gas-oggi\.html<\/loc><lastmod>2026-08-31<\/lastmod>/);
  } finally {
    fs.rmSync(tmp,{recursive:true,force:true});
  }
});
