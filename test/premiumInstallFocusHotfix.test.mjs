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

test('premium install: niente istruzione che cita un pulsante nascosto', () => {
  assert.doesNotMatch(install, /Premi INSTALLA APP\. Se il browser non mostra la finestra/);
  assert.match(install, /Il browser non ha aperto la finestra automatica/);
  assert.match(install, /Premi il pulsante verde qui sotto/);
});

test('premium install: se il prompt viene rifiutato il pulsante resta disponibile', () => {
  assert.match(install, /else \{\s*button\.hidden = false;\s*copy\.textContent = instructions\(\);/);
});

test('premium install: service worker distribuisce la nuova logica', () => {
  assert.match(sw, /offertalogica-premium-v03629-install-focus/);
  assert.match(sw, /"\/app-install\.js"/);
});
