import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("fase 3: l'assistente applica la logica verde giallo rosso prima dello staff", () => {
  const js = read("public/app-support.js");
  assert.match(js, /VERDE · AUTOMATICO/);
  assert.match(js, /GIALLO · TENTATIVO AUTOMATICO/);
  assert.match(js, /ROSSO · VERIFICA STAFF/);
  assert.match(js, /Prima provo a risolvere qui/);
});

test("fase 3: le bollette mantengono il canale staff dedicato soltanto sul rosso", () => {
  const js = read("public/app-support.js");
  assert.match(js, /verde e giallo restano automatici; lo staff entra solo quando la bolletta è classificata rossa/);
  assert.match(js, /usa il pulsante di verifica staff direttamente sulla bolletta rossa/i);
  assert.match(js, /currentCategory === "bills" \|\| currentCategory === "installation"/);
});

test("fase 3: una sola pratica rossa può restare aperta per cliente", () => {
  const js = read("public/app-support.js");
  assert.match(js, /OPEN_CASE_PREFIX|\[support:red:/);
  assert.match(js, /openUserMessages/);
  assert.match(js, /if \(existing\.openCase\)/);
  assert.match(js, /non verrà creata una seconda richiesta/i);
  assert.match(js, /SUBMIT_COOLDOWN_MS/);
});

test("fase 3: la pratica rossa conserva categoria percorso automatico e descrizione", () => {
  const js = read("public/app-support.js");
  assert.match(js, /Classificazione automatica: ROSSO/);
  assert.match(js, /Percorso automatico:/);
  assert.match(js, /Descrizione cliente:/);
  assert.match(js, /\[support:red:\$\{category\}:\$\{caseId\}\]/);
});

test("fase 3: lo staff può rispondere nella conversazione e poi chiudere la pratica", () => {
  const js = read("public/staff.js");
  assert.match(js, /direction: "staff_to_user"/);
  assert.match(js, /created_by_staff_id: currentSession\.user\.id/);
  assert.match(js, /INVIA RISPOSTA/);
  assert.match(js, /CHIUDI PRATICA/);
  assert.match(js, /La conversazione resta registrata/);
});

test("fase 3: APRI non porta più direttamente al cliente per l'assistenza rossa", () => {
  const js = read("public/staff.js");
  assert.match(js, /if \(item\.type === "support_request"\)/);
  assert.match(js, /openSupportCase\(item\)/);
  assert.match(js, /GESTISCI/);
  assert.match(js, /VEDI CLIENTE/);
});

test("fase 3: cache PWA aggiornata senza cambiare versione commerciale", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /offertalogica-premium-v03629-support3/);
  assert.match(sw, /"\/app-support\.js"/);
});
