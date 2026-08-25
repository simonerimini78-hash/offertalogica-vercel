import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

function between(start, end) {
  const a = html.indexOf(start);
  assert.notEqual(a, -1, `Marker iniziale non trovato: ${start}`);
  const b = html.indexOf(end, a + start.length);
  assert.ok(b > a, `Marker finale non trovato: ${end}`);
  return html.slice(a, b);
}

test("battaglia 02: il caricatore parla sia di bolletta sia di scheda sintetica", () => {
  const panel = between('<div class="pdf-lead-panel" id="pdf-upload-panel">', '<!-- TESTATA CENTRATA');
  assert.match(panel, /Seleziona la bolletta o la scheda sintetica/);
  assert.match(panel, /Dopo la lettura controlla i dati inseriti prima di avviare il confronto/);
  assert.match(panel, /il caricamento non avvia alcun cambio di fornitore/);
  assert.doesNotMatch(panel, /Ogni nuova analisi sostituisce i dati letti dalla precedente/);
});

test("battaglia 02: il testo descrive la persistenza reale di luce gas e scheda offerta", () => {
  const panel = between('<div class="pdf-lead-panel" id="pdf-upload-panel">', '<!-- TESTATA CENTRATA');
  assert.match(panel, /bolletta luce e la bolletta gas: se sono compatibili restano insieme/);
  assert.match(panel, /La bolletta attuale e l'eventuale scheda di una nuova offerta restano separate/);
  const slotUpdate = between("function aggiornaSlotBollettaCorrente", "function pdfFileFingerprint");
  assert.match(slotUpdate, /const retained = existing\.filter/);
  assert.match(slotUpdate, /const candidate = \[\.\.\.retained, \.\.\.incoming\]/);
});

test("battaglia 02: una bolletta business mobile usa il profilo business e non i campi consumer", () => {
  const status = between("function aggiornaStatoPdfMobileDopoAnalisi", "function attivaFocusOfferteMobile");
  const businessStart = status.indexOf('LEAD_STATE.customerType === "business"');
  const consumerStart = status.indexOf("const mancanti = campiMancanti(configurazioniPdfDaControllare(data, false))");
  assert.ok(businessStart >= 0, "ramo business mobile assente");
  assert.ok(consumerStart > businessStart, "il controllo consumer precede ancora quello business");
  assert.match(status, /const businessProfile = leggiProfiloBusiness\(\)/);
  assert.match(status, /businessProfile\.datiCompleti/);
  assert.match(status, /primaryAction: "business_missing"/);
  assert.match(status, /primaryAction: "business_compare"/);
  assert.match(status, /Confronta offerte business/);
});

test("battaglia 02: la CTA business mobile avvia il ranking business", () => {
  const action = between("function gestisciAzionePrimariaPdfMobile", "function controllaDatiDaStatoPdfMobile");
  assert.match(action, /action === "business_compare"/);
  assert.match(action, /window\.calcolaBusiness\?\.\(\)/);
  assert.match(action, /document\.getElementById\("business-result"\)/);
  assert.match(action, /action === "business_missing"/);
  assert.match(action, /document\.getElementById\("business-panel"\)/);
  assert.match(action, /action === "compare"[\s\S]*window\.avviaComparazioneDati\?\.\(\)/);
});

test("battaglia 02: Controlla i dati porta il business al pannello aziendale", () => {
  const review = between("function controllaDatiDaStatoPdfMobile", "function impostaOffertaFacoltativaMobileAperta");
  assert.match(review, /businessReview/);
  assert.match(review, /"business_compare", "business_missing"/);
  assert.match(review, /document\.getElementById\("business-panel"\)/);
  assert.match(review, /document\.getElementById\("pdf-data-review-guidance"\)/);
});

test("battaglia 02: non introduce API o fetch nella nuova logica mobile", () => {
  const status = between("function aggiornaStatoPdfMobileDopoAnalisi", "function impostaOffertaFacoltativaMobileAperta");
  assert.doesNotMatch(status, /fetch\s*\(/);
  assert.doesNotMatch(status, /\/api\//);
});
