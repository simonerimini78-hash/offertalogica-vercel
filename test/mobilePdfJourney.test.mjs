import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, "..", "public", "index.html"), "utf8");

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("mobile PDF: mostra uno stato persistente con progresso indeterminato", () => {
  assert.match(html, /id="mobile-pdf-status"/);
  assert.match(html, /Stiamo leggendo la tua bolletta/);
  assert.match(html, /Non chiudere la pagina/);
  assert.match(html, /position: fixed/);
  assert.match(html, /env\(safe-area-inset-bottom\)/);
  assert.match(html, /@keyframes mobilePdfProgressMove/);
  assert.doesNotMatch(html, /mobile-pdf[^\n]*(?:25%|50%|75%|90%)/);
});

test("mobile PDF: durante l'analisi disabilita i controlli e li riattiva alla fine", () => {
  const analysis = between(html, "window.preparaConfermaPdf = async function preparaConfermaPdf", "window.confermaPdfECalcola");
  assert.match(analysis, /impostaControlliPdfInAnalisi\(true\)/);
  assert.match(analysis, /mostraStatoPdfMobile\(\{[\s\S]*mode: "loading"/);
  assert.match(analysis, /impostaControlliPdfInAnalisi\(false\)/);
  assert.match(analysis, /aggiornaStatoPdfMobileDopoAnalisi/);
});

test("mobile PDF: dopo una bolletta completa mostra il teaser offerte e non il modulo", () => {
  const status = between(html, "function aggiornaStatoPdfMobileDopoAnalisi", "function attivaFocusOfferteMobile");
  assert.match(status, /Bolletta letta correttamente/);
  assert.match(status, /primaryLabel: "Confronta le offerte"/);
  assert.match(status, /primaryAction: "compare"/);
  const action = between(html, "function gestisciAzionePrimariaPdfMobile", "function controllaDatiDaStatoPdfMobile");
  assert.match(action, /attivaFocusOfferteMobile\(\)/);
  assert.match(action, /window\.avviaComparazioneDati\?\.\(\)/);
  assert.match(action, /portaAlTeaserOfferteMobile/);
  const target = between(html, "function portaAlTeaserOfferteMobile", "function gestisciAzionePrimariaPdfMobile");
  assert.match(target, /document\.getElementById\("lead-teaser"\)/);
  assert.match(target, /document\.querySelector\("\.fornitori-consigliati-section"\)/);
  assert.match(target, /portaElementoInVista\(target/);
});

test("mobile PDF: se mancano dati porta al primo campo evidenziato", () => {
  const status = between(html, "function aggiornaStatoPdfMobileDopoAnalisi", "function gestisciAzionePrimariaPdfMobile");
  assert.match(status, /campiMancanti\(configurazioniPdfDaControllare\(data, false\)\)/);
  assert.match(status, /Manca 1 dato per continuare/);
  assert.match(status, /missingFieldId: mancanti\[0\]\?\.id/);
  const action = between(html, "function gestisciAzionePrimariaPdfMobile", "function controllaDatiDaStatoPdfMobile");
  assert.match(action, /portaElementoInVista\(field/);
});

test("mobile PDF: gestisce il caricamento della seconda bolletta senza perdere la prima", () => {
  const status = between(html, "function aggiornaStatoPdfMobileDopoAnalisi", "function gestisciAzionePrimariaPdfMobile");
  assert.match(status, /\["pending_gas", "pending_luce"\]\.includes\(scope\)/);
  assert.match(status, /Prima bolletta acquisita/);
  assert.match(status, /Carica l'altra bolletta/);
  assert.match(status, /primaryAction: "upload_next"/);
});

test("mobile PDF: la sezione dell'offerta specifica parte chiusa solo su mobile", () => {
  assert.match(html, /id="mobile-optional-offer-toggle"/);
  assert.match(html, /id="mobile-optional-offer-content"/);
  const mobileSection = between(html, "function impostaOffertaFacoltativaMobileAperta", "function espandiOffertaFacoltativaMobile");
  assert.match(mobileSection, /if \(!esperienzaPdfMobileAttiva\(\)\)/);
  assert.match(mobileSection, /content\.hidden = false/);
  assert.match(mobileSection, /content\.hidden = !open/);
  const init = between(html, "function inizializzaOffertaFacoltativaMobile", "function svuotaDettagliAdattiviPdf");
  assert.match(init, /impostaOffertaFacoltativaMobileAperta\(media\?\.matches \? hasOffer : true\)/);
});

test("mobile PDF: una scheda sintetica riapre automaticamente la sezione facoltativa", () => {
  const review = between(html, "function accompagnaAllaRevisioneDatiPdf", "// OFFERTALOGICA_PDF_CURRENT_OFFER_SLOTS");
  assert.match(review, /if \(isOffer\) espandiOffertaFacoltativaMobile\(\)/);
});

test("mobile PDF: il reset chiude il pannello e ripristina i controlli", () => {
  const reset = between(html, "window.azzeraPdfEModulo = function azzeraPdfEModulo", "function aggiornaTestoPulsanteConfronto");
  assert.match(reset, /nascondiStatoPdfMobile\(\)/);
  assert.match(reset, /impostaControlliPdfInAnalisi\(false\)/);
});


test("mobile PDF: nasconde gli strumenti flottanti durante teaser e OTP", () => {
  assert.match(html, /body\.mobile-offers-focus \.guided-assistant-launcher/);
  assert.match(html, /body\.mobile-offers-focus \.activation-helper-fab/);
  const focus = between(html, "function attivaFocusOfferteMobile", "function portaAlTeaserOfferteMobile");
  assert.match(focus, /classList\.add\("mobile-offers-focus"\)/);
  assert.match(focus, /guided-assistant-panel/);
});

test("mobile PDF: i dati per attivare compaiono solo dopo l'avvio dell'attivazione", () => {
  const visibility = between(html, "function aggiornaAssistenteAttivazioneVisibilita", "function assistenteAttivazioneStatus");
  assert.match(visibility, /activationStarted/);
  assert.match(visibility, /LEAD_STATE\.activationAssistant\?\.pendingUrl/);
  assert.match(visibility, /LEAD_STATE\.activationAssistant\?\.offer/);
  assert.match(visibility, /activationStarted && assistenteAttivazioneDisponibile\(\)/);
  const opener = between(html, "window.apriAssistenteAttivazione", "function chiudiAssistenteAttivazione");
  assert.match(opener, /aggiornaAssistenteAttivazioneVisibilita\(\)/);
});

test("mobile PDF: il reset rimuove la modalità focalizzata sulle offerte", () => {
  const reset = between(html, "window.azzeraPdfEModulo = function azzeraPdfEModulo", "function aggiornaTestoPulsanteConfronto");
  assert.match(reset, /classList\.remove\("mobile-offers-focus"\)/);
});
