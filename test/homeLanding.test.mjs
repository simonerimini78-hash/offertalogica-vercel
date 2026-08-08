import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/assets/ol-home-landing.css', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../public/assets/ol-home-landing.js', import.meta.url), 'utf8');

function occurrences(source, token) {
  return source.split(token).length - 1;
}

test('home landing: espone una proposta SEO e il logo ufficiale', () => {
  assert.match(html, /<title>Confronto offerte luce e gas sui tuoi consumi \| OffertaLogica<\/title>/);
  assert.match(html, /<h1 id="ol-home-title">Confronta le offerte luce e gas <strong>sui tuoi consumi reali<\/strong><\/h1>/);
  assert.match(html, /src="\/assets\/logo-offertalogica-header\.png"/);
  assert.match(html, /href="\/assets\/ol-home-landing\.css"/);
  assert.match(html, /src="\/assets\/ol-home-landing\.js"/);
});

test('home landing: mantiene un solo esemplare degli ID funzionali critici', () => {
  const ids = [
    'btn-segmento-privato',
    'btn-segmento-business',
    'business-panel',
    'pdf-upload-panel',
    'btn-attiva-medi',
    'btn-attiva-precisi',
    'comparison-submit-button',
    'results-area'
  ];
  for (const id of ids) {
    assert.equal(occurrences(html, `id="${id}"`), 1, `ID duplicato o mancante: ${id}`);
  }
});

test('home landing: include i due accessi app richiesti', () => {
  assert.match(html, /href="https:\/\/app\.offertalogica\.it\/app\.html\?install=1"[^>]*>[\s\S]*?Scarica app gratuita/);
  assert.match(html, /href="https:\/\/premium\.offertalogica\.it\/app\.html\?install=1"[^>]*>[\s\S]*?Scarica app premium/);
});

test('home landing: le azioni riutilizzano esclusivamente controlli frontend esistenti', () => {
  assert.match(js, /getElementById\("btn-segmento-privato"\)/);
  assert.match(js, /getElementById\("btn-segmento-business"\)/);
  assert.match(js, /getElementById\("btn-attiva-medi"\)/);
  assert.match(js, /getElementById\("btn-attiva-precisi"\)/);
  assert.match(js, /getElementById\("pdf-upload-panel"\)/);
  assert.doesNotMatch(js, /fetch\s*\(/);
  assert.doesNotMatch(js, /\/api\//);
});

test('home landing: pulsanti sfumati, movimento hover e reduced motion sono presenti', () => {
  assert.match(css, /--ol-home-gradient:\s*linear-gradient/);
  assert.match(css, /\.ol-home-cta:hover/);
  assert.match(css, /\.ol-home-cta-arrow/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});


test('home landing: i cinque percorsi attivano e scorrono i controlli corretti', () => {
  const calls = [];
  const nodes = new Map();
  for (const id of [
    'btn-segmento-privato', 'btn-segmento-business', 'btn-attiva-medi',
    'btn-attiva-precisi', 'pdf-upload-panel', 'business-panel', 'calculator-start'
  ]) {
    nodes.set(id, {
      id,
      click() { calls.push(`click:${id}`); },
      scrollIntoView() { calls.push(`scroll:${id}`); }
    });
  }
  let clickHandler;
  const document = {
    getElementById(id) { return nodes.get(id) || null; },
    addEventListener(type, handler) { if (type === 'click') clickHandler = handler; }
  };
  vm.runInNewContext(js, { document });
  assert.equal(typeof clickHandler, 'function');

  function run(action) {
    calls.length = 0;
    clickHandler({
      preventDefault() { calls.push('preventDefault'); },
      target: { closest() { return { dataset: { olHomeAction: action } }; } }
    });
    return [...calls];
  }

  assert.deepEqual(run('average'), ['preventDefault', 'click:btn-segmento-privato', 'click:btn-attiva-medi', 'scroll:calculator-start']);
  assert.deepEqual(run('manual'), ['preventDefault', 'click:btn-segmento-privato', 'click:btn-attiva-precisi', 'scroll:calculator-start']);
  assert.deepEqual(run('pdf'), ['preventDefault', 'click:btn-segmento-privato', 'scroll:pdf-upload-panel']);
  assert.deepEqual(run('business'), ['preventDefault', 'click:btn-segmento-business', 'scroll:business-panel']);
  assert.deepEqual(run('private'), ['preventDefault', 'click:btn-segmento-privato', 'scroll:calculator-start']);
});
