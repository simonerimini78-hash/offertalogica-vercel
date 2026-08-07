import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = relative => readFile(path.join(root, relative), 'utf8');

test('v0.36.29 mantiene la Home decisionale senza duplicazioni', async () => {
  const html = await read('public/app.html');
  const homeStart = html.indexOf('<section id="view-home"');
  const homeEnd = html.indexOf('<section id="view-bill"');
  assert.ok(homeStart >= 0 && homeEnd > homeStart);
  const home = html.slice(homeStart, homeEnd);

  assert.match(home, /Bollette, utenze, risparmio e offerte sempre aggiornate\./);
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

test('release v0.36.29 è coerente nei file di aggiornamento', async () => {
  const [app, bills, staff, staffPremium, version, sw] = await Promise.all([
    read('public/app.html'),
    read('public/app-premium-bills.js'),
    read('public/staff.html'),
    read('public/staff-premium.html'),
    read('public/version.json'),
    read('public/sw.js')
  ]);
  assert.match(app, /APP v0\.36\.29/);
  assert.match(app, /CURRENT_RELEASE="0\.36\.29"/);
  assert.match(bills, /app_version: "0\.36\.29"/);
  assert.match(staff, /CURRENT_RELEASE="0\.36\.29"/);
  assert.match(staffPremium, /0\.36\.29/);
  assert.equal(JSON.parse(version).version, '0.36.29');
  assert.equal(JSON.parse(version).cache, 'offertalogica-premium-v03629');
  assert.match(sw, /offertalogica-premium-v03629/);
});

test('il numero di funzioni Vercel resta 12', async () => {
  const files = (await readdir(path.join(root, 'api'))).filter(name => name.endsWith('.js'));
  assert.equal(files.length, 12);
});

test('v0.36.29 compatta e centra titolo e sottotitolo della Home', async () => {
  const app = await read('public/app.html');
  assert.match(app, /<h1>La tua energia, più semplice\.<\/h1>/);
  assert.match(app, /Bollette, utenze, risparmio e offerte sempre aggiornate\./);
  assert.match(app, /\.home-welcome\{[^}]*text-align:center/s);
  assert.match(app, /\.home-welcome h1\{[^}]*white-space:nowrap[^}]*text-align:center/s);
  assert.match(app, /\.home-welcome p\{[^}]*white-space:nowrap[^}]*text-align:center/s);
  assert.match(app, /\.brand\{transform:translateY\(5px\)\}/);
});

test('v0.36.29 rende simmetriche le quattro azioni e le testate delle pagine', async () => {
  const app = await read('public/app.html');
  assert.match(app, /\.home-action-grid\{[^}]*grid-auto-rows:1fr/s);
  assert.match(app, /\.section-head\{[^}]*text-align:center/s);
  assert.match(app, /\.section-head \.kicker:before,\.section-head \.kicker:after/);
  assert.match(app, /#view-bill \.cloud-bill-card/);
  assert.match(app, /#view-offers \.hero/);
  assert.match(app, /#view-profile \.profile-card/);
});

test('v0.36.29 usa lo stesso sistema argento e smeraldo in tutte le viste cliente', async () => {
  const app = await read('public/app.html');
  assert.match(app, /--silver-panel:/);
  assert.match(app, /--emerald-panel:/);
  assert.match(app, /Icone argento sulle superfici verdi/);
  assert.match(app, /Bollette: moduli e righe allineati/);
  assert.match(app, /Confronta: due azioni distinte ma visivamente coordinate/);
  assert.match(app, /Profilo: sezioni regolari e leggibili/);
});

test('v0.36.29 conserva i quattro collegamenti operativi della Home', async () => {
  const app = await read('public/app.html');
  assert.match(app, /data-open-tab="bill"/);
  assert.match(app, /data-scroll-target="premiumUtilitiesCard"/);
  assert.match(app, /data-app-title="Calcola il risparmio"/);
  assert.match(app, /data-app-title="Offerte aggiornate"/);
  assert.doesNotMatch(app, /Installa OffertaLogica sul telefono/i);
});
