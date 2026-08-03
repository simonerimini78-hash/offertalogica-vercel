import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const auth = await readFile(new URL("../public/app-auth.js", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

test("v0.35.1 usa una descrizione chiara nella sezione cambio password", () => {
  assert.match(app, /Aggiorna la password del tuo account/);
  assert.doesNotMatch(app, /Aggiorna la password dell.account autenticato/);
});

test("il cambio password ricarica sessione e profilo prima del messaggio conclusivo", () => {
  assert.match(auth, /auth\.updateUser\(\{ password \}\)/);
  assert.match(auth, /auth\.getSession\(\)/);
  assert.match(auth, /await loadAccount\(sessionData\.session, \{ retry: true \}\)/);
  assert.match(auth, /Password aggiornata correttamente\./);
  assert.match(auth, /form\.hidden = true/);
  assert.match(auth, /passwordUpdateInProgress = true/);
  assert.match(auth, /passwordUpdateInProgress && \["TOKEN_REFRESHED", "USER_UPDATED"\]/);
});

test("la lettura account riprova una volta e scarta caricamenti superati", () => {
  assert.match(auth, /let accountLoadSequence = 0/);
  assert.match(auth, /async function fetchAccountData/);
  assert.match(auth, /await wait\(500\)/);
  assert.match(auth, /sequence !== accountLoadSequence/);
  assert.match(auth, /accountLoadSequence \+= 1/);
  assert.match(auth, /Aggiornamento account in corso/);
});

test("il messaggio fuorviante non compare più e gli errori reali restano distinti", () => {
  assert.doesNotMatch(auth, /Account autenticato, ma il profilo Premium non è accessibile/);
  assert.match(auth, /Non è stato possibile aggiornare i dati dell.account\. Riprova\./);
  assert.match(auth, /Aggiornamento non riuscito/);
});

test("versione e cache PWA sono aggiornate", () => {
  assert.match(app, /APP Premium v0\.(?:35\.1|36)/);
  assert.match(sw, /offertalogica-premium-v(?:0351|036)/);
});
