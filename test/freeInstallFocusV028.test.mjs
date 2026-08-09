import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/app.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

test('free v0.29: INSTALLA APP resta l unica azione primaria', () => {
  assert.match(html, /offertalogica-app-version" content="APP v0\.29"/);
  assert.match(html, /id="installApp" class="install" type="button">INSTALLA APP<\/button>/);
  assert.doesNotMatch(html, />COME INSTALLARE<|Come installare/);
});

test('free v0.29: il CTA installazione resta realmente verde dopo tutte le regole CSS', () => {
  assert.match(html, /\.install\{min-height:62px;margin:0 0 14px;[^}]*background:linear-gradient\(145deg,#087f3a 0%,#18a84b 56%,#73c928 100%\);color:#fff/);
  assert.doesNotMatch(html, /\.install,\.ios-tip\{[^}]*background:var\(--silver-panel\)/);
});

test('free v0.29: il CTA mantiene animazione breve e accessibilita movimento ridotto', () => {
  assert.match(html, /\.install\.show\{display:block;animation:install-attention 1\.1s ease-in-out 3\}/);
  assert.match(html, /prefers-reduced-motion:reduce/);
});

test('free v0.29: con prompt nativo il click apre direttamente l installazione', () => {
  assert.match(html, /if\(deferredPrompt\)\{\s*deferredPrompt\.prompt\(\);/);
  assert.match(html, /const choice=await deferredPrompt\.userChoice/);
});

test('free v0.29: senza prompt il click mostra la guida senza cambiare nome al pulsante', () => {
  assert.match(html, /const keepInstallLabel=\(\)=>\{install\.textContent='INSTALLA APP'\}/);
  assert.match(html, /showInstallHelp\(\);/);
  assert.doesNotMatch(html, /Il browser non ha aperto la finestra automatica/);
});

test('free v0.29: guida Apple concreta', () => {
  assert.match(html, /Aggiungi alla schermata Home/);
  assert.match(html, /Apri come app web/);
  assert.match(html, /Aggiungi al Dock/);
});

test('free v0.29: guida Samsung concreta', () => {
  assert.match(html, /Samsung Internet/);
  assert.match(html, /\+ Aggiungi pagina a/);
  assert.match(html, /Schermata Home/);
});

test('free v0.29: guida Chrome Android e desktop concreta', () => {
  assert.match(html, /Installa e crea scorciatoia/);
  assert.match(html, /Trasmetti, salva e condividi/);
  assert.match(html, /Installa questa pagina come app/);
});

test('free v0.29: deep link mostra prima INSTALLA APP e non la guida', () => {
  assert.match(html, /if\(installRequested\)install\.classList\.add\('show'\);\s*else if\(isIos/);
  assert.doesNotMatch(html, /if\(\(isIos&&\(installRequested/);
});

test('free v0.29: service worker forza la nuova shell', () => {
  assert.match(sw, /offertalogica-app-v29-install-simple/);
});


test('free v0.29: versione tecnica e badge Profilo sono allineati', () => {
  assert.match(html, /offertalogica-app-version" content="APP v0\.29"/);
  assert.match(html, /<span class="version-badge">APP v0\.29<\/span>/);
  assert.doesNotMatch(html, /<span class="version-badge">APP v0\.28<\/span>/);
  assert.match(sw, /offertalogica-app-v29-install-simple-badge-fix/);
});
