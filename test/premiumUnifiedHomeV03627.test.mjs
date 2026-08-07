import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = relative => readFile(path.join(root, relative), 'utf8');

test('v0.36.28 mantiene la Home decisionale senza duplicazioni', async () => {
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
  assert.doesNotMatch(home, /Installa OffertaLogica sul telefono/);
  assert.doesNotMatch(home, /iosInstallTip|installApp/);
  assert.doesNotMatch(home, /archive-summary home-summary|Azioni rapide|>Carica bolletta|>Esplora offerte/);
  assert.match(home, /data-scroll-target="premiumUtilitiesCard"/);
  assert.match(home, /data-app-url="\/\?entry=app#main-content"/);
  assert.match(home, /data-app-url="\/offerte-luce-gas-aggiornate\.html"/);
});

test('logo libero e icone argento sono applicati senza riquadro del marchio', async () => {
  const html = await read('public/app.html');
  assert.match(html, /<img src="\/assets\/logo-offertalogica-header\.png" alt="OffertaLogica">/);
  assert.match(html, /\.brand\{display:flex;align-items:center;padding:0;border:0;border-radius:0;background:none;box-shadow:none/);
  assert.match(html, /\.brand:after\{display:none\}/);
  assert.doesNotMatch(html, /\.brand\{[\s\S]{0,300}?backdrop-filter:blur\(25px\)/);
  assert.match(html, /filter:saturate\(1\.20\) contrast\(1\.06\)/);
  assert.match(html, /\.home-action \.action-icon\{[\s\S]*?border-radius:50%[\s\S]*?color:#f1f5f4/);
  assert.match(html, /\.home-action \.action-icon \.icon\{[\s\S]*?color:#f1f5f4/);
  assert.match(html, /--emerald-glass:/);
  assert.match(html, /<meta name="theme-color" content="#e3e9e7">/);
});

test('nessun codice di invito installazione resta nella pagina', async () => {
  const html = await read('public/app.html');
  for (const forbidden of ['beforeinstallprompt', 'deferredPrompt', 'iosInstallTipDismissed', 'Aggiungi a Home']) {
    assert.doesNotMatch(html, new RegExp(forbidden));
  }
  assert.match(html, /if\(!\('serviceWorker' in navigator\)\)return;/);
});

test('release v0.36.28 è coerente nei file di aggiornamento', async () => {
  const [app, bills, staff, staffPremium, version, sw] = await Promise.all([
    read('public/app.html'),
    read('public/app-premium-bills.js'),
    read('public/staff.html'),
    read('public/staff-premium.html'),
    read('public/version.json'),
    read('public/sw.js')
  ]);
  assert.match(app, /APP v0\.36\.28/);
  assert.match(app, /CURRENT_RELEASE="0\.36\.28"/);
  assert.match(bills, /app_version: "0\.36\.28"/);
  assert.match(staff, /CURRENT_RELEASE="0\.36\.28"/);
  assert.match(staffPremium, /0\.36\.28/);
  assert.equal(JSON.parse(version).version, '0.36.28');
  assert.equal(JSON.parse(version).cache, 'offertalogica-premium-v03628');
  assert.match(sw, /offertalogica-premium-v03628/);
});

test('il numero di funzioni Vercel resta 12', async () => {
  const files = (await readdir(path.join(root, 'api'))).filter(name => name.endsWith('.js'));
  assert.equal(files.length, 12);
});
