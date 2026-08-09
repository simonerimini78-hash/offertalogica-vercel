import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const js = fs.readFileSync(new URL("../public/app-install.js", import.meta.url), "utf8");
const sw = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

test("installazione: il pulsante parte in modalita aiuto", () => {
  assert.match(js, /setPrimaryMode\("help"\)/);
  assert.match(js, /button\.textContent = canInstall \? "INSTALLA APP" : "COME INSTALLARE"/);
});

test("installazione: beforeinstallprompt abilita INSTALLA APP", () => {
  assert.match(js, /beforeinstallprompt[\s\S]*setPrimaryMode\("install"\)/);
});

test("installazione: senza prompt resta COME INSTALLARE", () => {
  assert.match(js, /if \(!deferredPrompt\) \{[\s\S]*setPrimaryMode\("help"\)/);
});

test("installazione: dopo rifiuto torna COME INSTALLARE", () => {
  assert.match(js, /choice\?\.outcome === "accepted"[\s\S]*else \{[\s\S]*setPrimaryMode\("help"\)/);
});

test("installazione: cache aggiornata", () => {
  assert.match(sw, /support5-install-dynamic/);
});
