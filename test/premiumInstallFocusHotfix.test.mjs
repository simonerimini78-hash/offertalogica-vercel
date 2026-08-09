import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/app.html', import.meta.url), 'utf8');
const install = fs.readFileSync(new URL('../public/app-install.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

test('premium install: il pulsante principale e sempre visibile quando il pannello viene aperto', () => {
  assert.match(html, /id="installEntryButton" class="install-entry-primary" type="button">INSTALLA APP<\/button>/);
  assert.doesNotMatch(html, /id="installEntryButton"[^>]* hidden/);
  assert.match(install, /panel\.hidden = false;\s*button\.hidden = false;/);
});

test('premium install: INSTALLA APP e visivamente dominante', () => {
  assert.match(html, /\.install-entry-actions\{display:grid;grid-template-columns:1fr;gap:10px\}/);
  assert.match(html, /\.install-entry-primary\{[^}]*min-height:62px[^}]*linear-gradient[^}]*color:#fff/);
  assert.match(html, /install-entry-attention 1\.1s ease-in-out 3/);
  assert.match(html, /\.install-entry-secondary\{[^}]*width:min\(78%,290px\)[^}]*min-height:43px/);
  assert.match(html, /prefers-reduced-motion:reduce/);
});

test('premium install: il nome del pulsante non cambia mai in COME INSTALLARE', () => {
  assert.match(install, /button\.textContent = "INSTALLA APP"/);
  assert.doesNotMatch(install, /COME INSTALLARE/);
  assert.doesNotMatch(install, /Il browser non ha aperto la finestra automatica/);
});

test('premium install: con prompt nativo il click apre direttamente la conferma', () => {
  assert.match(install, /deferredPrompt\.prompt\(\);/);
  assert.match(install, /const choice = await deferredPrompt\.userChoice;/);
});

test('premium install: senza prompt il click resta INSTALLA APP e passa alla guida', () => {
  assert.match(install, /if \(!deferredPrompt\) \{\s*keepInstallLabel\(\);\s*copy\.textContent = instructions\(\);/);
});

test('premium install: guida iPhone e Mac Safari concreta', () => {
  assert.match(install, /Aggiungi alla schermata Home/);
  assert.match(install, /Apri come app web/);
  assert.match(install, /Aggiungi al Dock/);
});

test('premium install: guida Samsung concreta', () => {
  assert.match(install, /Samsung Internet/);
  assert.match(install, /\+ Aggiungi pagina a/);
  assert.match(install, /Schermata Home/);
});

test('premium install: guida Chrome Android concreta', () => {
  assert.match(install, /Installa e crea scorciatoia/);
  assert.match(install, /Aggiungi a schermata Home/);
});

test('premium install: guida Chrome desktop concreta', () => {
  assert.match(install, /Trasmetti, salva e condividi/);
  assert.match(install, /Installa questa pagina come app/);
});

test('premium install: guida Edge desktop concreta', () => {
  assert.match(install, /Altri strumenti/);
  assert.match(install, /Applicazioni/);
  assert.match(install, /Installa questo sito come app/);
});

test('premium install: service worker distribuisce la nuova logica', () => {
  assert.match(sw, /offertalogica-premium-v03629-install-simple/);
  assert.match(sw, /"\/app-install\.js"/);
});
