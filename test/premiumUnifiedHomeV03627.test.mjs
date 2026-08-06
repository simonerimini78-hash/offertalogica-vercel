import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = relative => readFile(path.join(root, relative), 'utf8');

test('v0.36.27 espone una Home decisionale senza duplicazioni', async () => {
  const html = await read('public/app.html');
  const homeStart = html.indexOf('<section id="view-home"');
  const homeEnd = html.indexOf('<section id="view-bill"');
  assert.ok(homeStart >= 0 && homeEnd > homeStart);
  const home = html.slice(homeStart, homeEnd);

  assert.match(home, /Gestisci bollette e utenze, calcola il risparmio e confronta le offerte aggiornate\./);
  assert.ok(home.indexOf('home-premium-strip') < home.indexOf('home-action-grid'));
  for (const title of ['Le tue bollette', 'Le tue utenze', 'Calcola il risparmio', 'Offerte aggiornate']) {
    assert.equal((home.match(new RegExp(`<strong>${title}</strong>`, 'g')) || []).length, 1, `${title} deve comparire una volta come riquadro`);
  }
  assert.doesNotMatch(home, /archive-summary home-summary/);
  assert.doesNotMatch(home, /Azioni rapide/);
  assert.doesNotMatch(home, />Carica bolletta</);
  assert.doesNotMatch(home, />Esplora offerte</);
  assert.match(home, /data-scroll-target="premiumUtilitiesCard"/);
  assert.match(home, /data-app-url="\/\?entry=app#main-content"/);
  assert.match(home, /data-app-url="\/offerte-luce-gas-aggiornate\.html"/);
});

test('logo originale e design system argento-smeraldo sono applicati', async () => {
  const html = await read('public/app.html');
  assert.match(html, /<img src="\/assets\/logo-offertalogica-header\.png" alt="OffertaLogica">/);
  assert.match(html, /--silver-glass:/);
  assert.match(html, /--emerald-glass:/);
  assert.match(html, /\.brand\{[\s\S]*?backdrop-filter:blur\(25px\)/);
  assert.match(html, /filter:saturate\(1\.16\) contrast\(1\.04\)/);
  assert.match(html, /\.home-action\{[\s\S]*?background:var\(--emerald-glass\)/);
  assert.match(html, /\.hero,\.gradient-panel,\.spend-card,\.profile-card,\.premium-plan-paid\{/);
  assert.match(html, /<meta name="theme-color" content="#e3e9e7">/);
});

test('release v0.36.27 è coerente nei file di aggiornamento', async () => {
  const [app, bills, staff, staffPremium, version, sw] = await Promise.all([
    read('public/app.html'),
    read('public/app-premium-bills.js'),
    read('public/staff.html'),
    read('public/staff-premium.html'),
    read('public/version.json'),
    read('public/sw.js')
  ]);
  assert.match(app, /APP v0\.36\.27/);
  assert.match(app, /CURRENT_RELEASE="0\.36\.27"/);
  assert.match(bills, /app_version: "0\.36\.27"/);
  assert.match(staff, /CURRENT_RELEASE="0\.36\.27"/);
  assert.match(staffPremium, /0\.36\.27/);
  assert.equal(JSON.parse(version).version, '0.36.27');
  assert.equal(JSON.parse(version).cache, 'offertalogica-premium-v03627');
  assert.match(sw, /offertalogica-premium-v03627/);
});

test('il numero di funzioni Vercel resta 12', async () => {
  const files = (await readdir(path.join(root, 'api'))).filter(name => name.endsWith('.js'));
  assert.equal(files.length, 12);
});
