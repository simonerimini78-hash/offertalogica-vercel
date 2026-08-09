import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/app.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

test('free v0.28: INSTALLA APP e dominante e non ambiguo', () => {
  assert.match(html, /offertalogica-app-version" content="APP v0\.28"/);
  assert.match(html, /id="installApp" class="install" type="button">INSTALLA APP<\/button>/);
  assert.match(html, /\.install\{[^}]*min-height:62px[^}]*linear-gradient[^}]*color:#fff/);
  assert.match(html, /\.install\.show\{display:block;animation:install-attention 1\.1s ease-in-out 3\}/);
  assert.match(html, /prefers-reduced-motion:reduce/);
});

test('free v0.28: il fallback browser resta disponibile senza prompt nativo', () => {
  assert.match(html, /if\(deferredPrompt\)/);
  assert.match(html, /showInstallHelp\(\);/);
  assert.match(html, /Installa app<\/b> o <b>Aggiungi alla schermata Home/);
});

test('free v0.28: service worker forza la nuova shell', () => {
  assert.match(sw, /offertalogica-app-v28-install-focus/);
});
