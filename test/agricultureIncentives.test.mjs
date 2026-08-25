import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const agriculture = readFileSync(new URL('../public/energia-aziende-agricole.html', import.meta.url), 'utf8');

test('5E espone una sezione incentivi datata e aggiornabile', () => {
  assert.match(agriculture, /id="incentivi"/);
  assert.match(agriculture, /Aggiornamento verificato: 25 agosto 2026/i);
  assert.match(agriculture, /Aperto, annunciato, chiuso o in graduatoria/i);
});

test('Facility Parco Agrisolare riporta la finestra 2026 come chiusa con fonte MASAF', () => {
  assert.match(agriculture, /Facility Parco Agrisolare/);
  assert.match(agriculture, /10 marzo 2026/i);
  assert.match(agriculture, /9 aprile 2026/i);
  assert.match(agriculture, /Finestra 2026 chiusa/i);
  assert.match(agriculture, /https:\/\/www\.masaf\.gov\.it\/flex\/cm\/pages\/ServeBLOB\.php\/L\/IT\/IDPagina\/24268/);
});

test('Parco Agrisolare distingue graduatorie e scorrimenti dalla finestra domande', () => {
  assert.match(agriculture, /Graduatorie \/ scorrimenti/i);
  assert.match(agriculture, /15 giugno 2026/i);
  assert.match(agriculture, /quindicesimo elenco/i);
  assert.match(agriculture, /https:\/\/www\.masaf\.gov\.it\/flex\/cm\/pages\/ServeBLOB\.php\/L\/IT\/IDPagina\/24766/);
});

test('sezione incentivi mantiene limiti chiari e non introduce endpoint', () => {
  assert.match(agriculture, /non garantisce l'accesso a contributi o agevolazioni/i);
  assert.doesNotMatch(agriculture, /fetch\s*\(/i);
  assert.doesNotMatch(agriculture, /\/api\//i);
});
