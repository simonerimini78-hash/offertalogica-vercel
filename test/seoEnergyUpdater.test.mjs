import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/update-arera-menu.yml', 'utf8');
const script = fs.readFileSync('scripts/update-energy-today.py', 'utf8');
const live = fs.readFileSync('public/assets/seo-energy-live.js', 'utf8');
const data = JSON.parse(fs.readFileSync('public/data/energia-oggi.json', 'utf8'));

test('il workflow esistente aggiorna anche i dati energia senza nuova API applicativa', () => {
  assert.match(workflow, /name: Aggiorna dati OffertaLogica/);
  assert.match(workflow, /cron: "30 17 \* \* \*"/);
  assert.match(workflow, /python scripts\/update-energy-today\.py/);
  assert.match(workflow, /git add public\/data\/energia-oggi\.json/);
  assert.doesNotMatch(workflow, /\/api\//);
});

test('lo script usa ARERA Vigilanza e non duplica il PSV mensile', () => {
  assert.match(script, /https:\/\/www\.arera\.it\/vigilanza-energetica/);
  assert.match(script, /public\/data\/calcolo-parametri\.json/);
  assert.match(script, /PSV mensile non presente in calcolo-parametri\.json/);
  assert.match(script, /Il file esistente non è stato sovrascritto/);
  assert.doesNotMatch(script, /gme\.mercatoelettrico\.org/);
});

test('energia-oggi è dichiarato come fonte tecnica locale OffertaLogica', () => {
  assert.equal(data.fonteInterna, 'OffertaLogica - aggiornamento dati energia');
  assert.equal(data.gas.psvMensile.fonte, 'OffertaLogica - calcolo-parametri.json');
  assert.equal(data.gas.psvMensile.valoreEurSmc, 0.606612);
});

test('la pagina distingue dato locale, origine e stato di aggiornamento', () => {
  assert.match(live, /Aggiornamento OffertaLogica/);
  assert.match(live, /ARERA — Vigilanza Energetica/);
  assert.match(live, /Non viene presentato come valore di oggi/);
  assert.match(live, /calcolo-parametri\.json/);
});
