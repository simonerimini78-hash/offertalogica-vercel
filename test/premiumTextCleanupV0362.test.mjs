import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const auth = await readFile(new URL("../public/app-auth.js", import.meta.url), "utf8");
const bills = await readFile(new URL("../public/app-premium-bills.js", import.meta.url), "utf8");
const staffHtml = await readFile(new URL("../public/staff.html", import.meta.url), "utf8");
const staff = await readFile(new URL("../public/staff.js", import.meta.url), "utf8");
const checks = await readFile(new URL("../public/staff-premium.js", import.meta.url), "utf8");
const pdf = await readFile(new URL("../public/staff-pdf.html", import.meta.url), "utf8");
const pdfApi = await readFile(new URL("../api/staff-pdf-analyses.js", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

test("v0.36.3 riduce i testi cliente alle informazioni operative", () => {
  assert.match(app, /Carica le bollette e tieni sotto controllo costi e scadenze/);
  assert.match(app, /La verifica dello staff è disponibile solo per le anomalie rosse/);
  for (const item of [
    "Verifica delle condizioni realmente applicate",
    "Segnalazione di anomalie e conguagli",
    "Controllo periodico della convenienza",
  ]) assert.match(app, new RegExp(item));
  assert.doesNotMatch(app, /bucket privato|Supabase Auth|FLUSSO ATTIVO|Ogni bolletta viene analizzata dall’IA|versione gratuita v0\.22/);
  assert.doesNotMatch(bills, /Storico ARERA .*affidabilità/);
  assert.match(auth, /Servizio Premium attivo/);
  assert.match(app, /APP Premium v0\.36\.18/);
  assert.match(bills, /app_version: "0\.36\.18"/);
  assert.match(sw, /offertalogica-premium-v03618/);
});

test("le conferme staff non mostrano più il nome tecnico della Preview", () => {
  assert.match(staffHtml, /id="staffConfirmLayer"/);
  assert.match(staff, /window\.OffertaLogicaStaffConfirm = confirmAction/);
  for (const source of [staff, checks, pdf]) {
    assert.doesNotMatch(source, /window\.(?:confirm|prompt|alert)\s*\(/);
    assert.doesNotMatch(source, /(?:confirm|prompt|alert)\s*\(/);
  }
});

test("l’azzeramento archivio PDF mostra sempre avanzamento ed esito", () => {
  assert.match(pdf, /id="archive-status"/);
  assert.match(pdf, /Eliminazione archivio in corso/);
  assert.match(pdf, /result\.deleted/);
  assert.match(pdf, /AZZERA_ARCHIVIO_PDF/);
  assert.match(pdfApi, /Eliminazione archivio PDF non riuscita/);
  assert.match(pdfApi, /\[staff-pdf-archive-error\]/);
});
