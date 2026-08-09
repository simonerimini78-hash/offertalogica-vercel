import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const js = fs.readFileSync(new URL("../public/app-install.js", import.meta.url), "utf8");
const sw = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

test("installazione: il pulsante resta INSTALLA APP anche senza prompt", () => {
  assert.match(js, /button\.textContent = "INSTALLA APP"/);
  assert.doesNotMatch(js, /COME INSTALLARE/);
});

test("installazione: beforeinstallprompt usa l installazione diretta", () => {
  assert.match(js, /beforeinstallprompt/);
  assert.match(js, /deferredPrompt\.prompt\(\)/);
  assert.match(js, /L’app è pronta\. Premi INSTALLA APP e conferma l’installazione\./);
});

test("installazione: senza prompt mostra passi concreti senza cambiare CTA", () => {
  assert.match(js, /if \(!deferredPrompt\) \{[\s\S]*copy\.textContent = instructions\(\)/);
  assert.match(js, /Manca solo un ultimo passaggio/);
  assert.match(js, /setPrimaryLabel\(\)/);
});

test("installazione: dopo rifiuto resta INSTALLA APP e mostra la guida", () => {
  assert.match(js, /choice\?\.outcome === "accepted"[\s\S]*setPrimaryLabel\(\);[\s\S]*copy\.textContent = instructions\(\);/);
});

test("installazione: cache aggiornata", () => {
  assert.match(sw, /support5-install-simple/);
});
