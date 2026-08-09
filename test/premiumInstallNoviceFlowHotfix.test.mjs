import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const install = fs.readFileSync(new URL('../public/app-install.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

test('installazione: il pulsante resta sempre INSTALLA APP', () => {
  assert.match(install, /button\.textContent = "INSTALLA APP"/);
  assert.doesNotMatch(install, /COME INSTALLARE/);
});

test('installazione: l ingresso usa un messaggio semplice senza gergo tecnico', () => {
  assert.match(install, /Premi INSTALLA APP\. Se il dispositivo chiede conferma, scegli Installa\./);
  assert.doesNotMatch(install, /browser supporta l’installazione diretta/);
  assert.doesNotMatch(install, /finestra automatica/);
});

test('installazione: iPhone e Mac Safari hanno passi espliciti', () => {
  assert.match(install, /Apri questa pagina in Safari/);
  assert.match(install, /Aggiungi alla schermata Home/);
  assert.match(install, /Apri come app web/);
  assert.match(install, /Aggiungi al Dock/);
});

test('installazione: Android Chrome e Samsung hanno istruzioni dedicate', () => {
  assert.match(install, /SamsungBrowser/);
  assert.match(install, /Samsung Internet cerca in alto l’icona per installare l’app/);
  assert.match(install, /Aggiungi a schermata Home/);
  assert.match(install, /Tocca “Installa”/);
});

test('installazione: Chrome ed Edge desktop hanno percorsi leggibili', () => {
  assert.match(install, /Trasmetti, salva e condividi/);
  assert.match(install, /Installa questa pagina come app/);
  assert.match(install, /Altri strumenti/);
  assert.match(install, /Installa questo sito come app/);
});

test('installazione: il prompt nativo resta la prima scelta quando disponibile', () => {
  assert.match(install, /beforeinstallprompt/);
  assert.match(install, /deferredPrompt\.prompt\(\)/);
  assert.match(install, /L’app è pronta\. Premi INSTALLA APP e conferma l’installazione\./);
});

test('installazione: aggiorna la cache PWA', () => {
  assert.match(sw, /offertalogica-premium-v03629-support5-install-simple/);
  assert.match(sw, /"\/app-install\.js"/);
});
