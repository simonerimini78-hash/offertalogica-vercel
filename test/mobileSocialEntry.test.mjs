import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, "..", "public", "index.html"), "utf8");

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("landing V1: e universale e la provenienza cambia solo il tracciamento", () => {
  const bootstrap = between(html, "const params = new URLSearchParams", "})();\n</script>");
  assert.match(bootstrap, /calculatorBypass = params\.get\("landing"\) === "0"/);
  assert.match(bootstrap, /staffPreview/);
  assert.match(bootstrap, /const requested = !staffPreview/);
  assert.match(bootstrap, /__OFFERTALOGICA_LANDING_REQUESTED__/);
  assert.doesNotMatch(bootstrap, /max-width: 768px/);
  assert.doesNotMatch(bootstrap, /explicitSocial \|\| socialSource/);

  const source = between(html, "function sorgenteIngressoLanding", "function inizializzaIngressoSocialMobile");
  assert.match(source, /utm_source/);
  assert.match(source, /document\.referrer/);
  assert.match(source, /return "direct"/);
});

test("landing V1: bootstrap diretto, social e Google convergono sulla stessa landing; bypass e staff no", () => {
  const bootstrap = between(html, "(function () {\n    try {\n        const params = new URLSearchParams", "})();\n</script>") + "})();";

  function requestedFor(search = "", hash = "", { staffSession = false } = {}) {
    const classes = new Set();
    const context = {
      URLSearchParams,
      window: { location: { search, hash } },
      sessionStorage: {
        getItem: (key) => key === "offertalogicaStaffMode" && staffSession ? "true" : null,
      },
      document: { documentElement: { classList: { add: (value) => classes.add(value) } } },
    };
    vm.runInNewContext(bootstrap, context);
    return { requested: context.window.__OFFERTALOGICA_LANDING_REQUESTED__, classes };
  }

  assert.equal(requestedFor("").requested, true);
  assert.equal(requestedFor("?utm_source=instagram").requested, true);
  assert.equal(requestedFor("?utm_source=facebook").requested, true);
  assert.equal(requestedFor("?utm_source=google").requested, true);
  assert.equal(requestedFor("?landing=0").requested, false);
  assert.equal(requestedFor("?staffToken=test").requested, false);
  assert.equal(requestedFor("", "#previewToken=test").requested, false);
  assert.equal(requestedFor("", "", { staffSession: true }).requested, false);
});

test("landing V1.3: mostra subito risparmio e due percorsi senza CTA intermedia", () => {
  assert.match(html, /id="social-entry-saving-value"/);
  assert.match(html, /Confronta le offerte luce e gas sui tuoi consumi/);
  assert.match(html, /Come vuoi procedere\?/);
  assert.match(html, /Catalogo ufficiale ARERA/);
  assert.match(html, /Indici di mercato aggiornati/);
  assert.match(html, /Confronto del costo reale/);
  assert.match(html, /id="landing-self-service"[^>]*disabled/);
  assert.match(html, /<strong>Confronto in autonomia<\/strong>/);
  assert.match(html, /id="landing-assisted"[^>]*disabled/);
  assert.match(html, /<strong>Preferisco essere guidato<\/strong>/);
  assert.doesNotMatch(html, /id="social-entry-cta"/);

  const prepare = between(html, "function preparaRisparmioIngressoSocialMobile", "function urlCalcolatoreDaLanding");
  assert.match(prepare, /btnMedi\?\.click\(\)/);
  assert.match(prepare, /window\.avviaComparazioneDati\?\.\(\)/);
  assert.match(prepare, /LEAD_STATE\.bestPartnerSaving/);
  assert.match(prepare, /impostaLandingPronta\(\)/);
});

test("landing V1: il risparmio resta quello delle offerte partner attivabili", () => {
  assert.match(
    html,
    /LEAD_STATE\.bestPartnerSaving = Math\.max\(0, \.\.\.attivabiliPrioritarie\.map\(\(item\) => item\.differenza\)\)/,
  );
  const teaser = between(html, "const teaserSaving = SOCIAL_ENTRY_STATE.isSocialJourney", "aggiornaPromptBollettaDopoOfferte();");
  assert.match(teaser, /LEAD_STATE\.bestPartnerSaving/);
  assert.match(teaser, /LEAD_STATE\.bestSaving/);
});

test("landing V1: il percorso autonomo riapre il calcolatore esistente e conserva UTM", () => {
  const block = between(html, "function urlCalcolatoreDaLanding", "function apriPercorsoAssistitoDaLanding");
  assert.match(block, /new URL\("\/index\.html", window\.location\.origin\)/);
  assert.match(block, /target\.searchParams\.set\("landing", "0"\)/);
  assert.match(block, /target\.searchParams\.set\("from", "landing"\)/);
  assert.match(block, /utm_source/);
  assert.match(block, /window\.location\.assign\(urlCalcolatoreDaLanding\(\)\)/);
  assert.match(block, /landing_self_service_click/);
});

test("landing V1: il percorso assistito non inventa il link Switcho", () => {
  assert.match(html, /const SWITCHO_LANDING_URL = "";/);
  const assisted = between(html, "function apriPercorsoAssistitoDaLanding", "function tracciaAccessoAppLanding");
  assert.match(assisted, /destinationStatus: destinationReady \? "ready" : "pending_url"/);
  assert.match(assisted, /Il percorso assistito è in preparazione e sarà disponibile appena completato il collegamento\./);
  assert.match(assisted, /if \(!destinationReady\)/);
  assert.match(assisted, /window\.location\.assign\(SWITCHO_LANDING_URL\)/);
});

test("landing V1: tracking riusa track-event e usa i campi gia supportati", () => {
  assert.match(html, /trackEvent\("landing_view"/);
  assert.match(html, /trackEvent\("landing_saving_ready"/);
  assert.match(html, /trackEvent\("landing_self_service_click"/);
  assert.match(html, /trackEvent\("landing_assisted_click"/);
  assert.match(html, /"landing_premium_app_click" : "landing_free_app_click"/);
  assert.match(html, /bestSaving: saving/);
  assert.doesNotMatch(html, /fetch\("\/api\/landing/);
});

test("landing V1.3: usa palette OffertaLogica, vetro piu evidente e resta responsive", () => {
  const css = between(html, "/* OFFERTALOGICA_LANDING_GLASS_V1_7_20260814 */", ".offers-personalize-prompt {");
  assert.match(css, /#123044/);
  assert.match(css, /#f4f7f5/);
  assert.match(css, /#087f3a/);
  assert.match(css, /#18a84b/);
  assert.match(css, /rgba\(115, 201, 40, \.76\)/);
  assert.match(css, /#e3e9e7/);
  assert.match(css, /rgba\(132, 209, 38/);
  assert.match(css, /rgba\(5, 93, 56, \.96\)/);
  assert.match(css, /filter: saturate\(1\.08\) brightness\(1\.02\)/);
  assert.match(css, /backdrop-filter: blur\(32px\) saturate\(138%\)/);
  assert.match(css, /backdrop-filter: blur\(20px\) saturate\(136%\)/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.social-entry-saving \{[\s\S]*width: min\(100%, 610px\);[\s\S]*border-radius: 30px;[\s\S]*backdrop-filter: blur\(26px\) saturate\(145%\)/);
  assert.match(css, /\.social-entry-saving strong \{[\s\S]*linear-gradient\(135deg, #087f3a 0%, #18a84b 58%, #73c928 108%\)/);
});

test("landing V1.3: disclaimer e compatto e uniforme", () => {
  assert.match(html, /class="social-entry-disclaimer">La cifra mostrata è un esempio calcolato su un profilo medio\. Il confronto reale usa i tuoi consumi e la tua tariffa attuale\.<\/p>/);
  assert.doesNotMatch(html, /class="social-entry-copy-small"/);
  const css = between(html, "/* OFFERTALOGICA_LANDING_GLASS_V1_7_20260814 */", ".offers-personalize-prompt {");
  assert.match(css, /\.social-entry-disclaimer \{[\s\S]*font-size: clamp\(11\.5px, 1\.7vw, 13px\);[\s\S]*font-weight: 500;/);
});

test("landing V1.3: i due percorsi sono strutturalmente simmetrici, centrati e usano testo argento", () => {
  const css = between(html, "/* OFFERTALOGICA_LANDING_GLASS_V1_7_20260814 */", ".offers-personalize-prompt {");
  assert.match(css, /\.social-entry-actions \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*grid-auto-rows: 1fr;[\s\S]*align-items: stretch;/);
  assert.match(css, /\.social-entry-route \{[\s\S]*height: 100%;[\s\S]*min-height: 110px;[\s\S]*grid-template-rows: minmax\(28px, auto\) minmax\(34px, auto\);/);
  assert.match(css, /\.social-entry-route \{[\s\S]*justify-items: center;[\s\S]*text-align: center;/);
  assert.match(css, /\.social-entry-route strong \{[\s\S]*justify-content: center;[\s\S]*color: #e3e9e7;[\s\S]*text-transform: none;/);
  assert.match(css, /\.social-entry-route span \{[\s\S]*justify-content: center;[\s\S]*color: rgba\(227,233,231,\.86\);/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*grid-auto-rows: 1fr;[\s\S]*min-height: 102px;/);
});

test("landing V1.3: i pulsanti app riusano le classi originali del sito", () => {
  assert.match(html, /class="social-entry-app-link ol-app-access-link ol-app-access-free"/);
  assert.match(html, /class="social-entry-app-link ol-app-access-link ol-app-access-premium"/);
});

test("landing V1.3: mantiene gli accessi app e non espone la nota partner nella landing", () => {
  assert.match(html, /https:\/\/app\.offertalogica\.it\/app\.html\?install=1/);
  assert.match(html, /https:\/\/premium\.offertalogica\.it\/app\.html\?install=1/);
  assert.doesNotMatch(html, /class="social-entry-partner-note"/);
  assert.doesNotMatch(html, /Il percorso assistito sarà gestito dal partner Switcho\./);
});

test("offerte: propone ancora la bolletta senza bloccare la stima media", () => {
  assert.match(html, /id="offers-personalize-prompt" hidden/);
  assert.match(html, /id="offers-upload-bill">Carica la bolletta/);
  assert.match(html, /id="offers-keep-average">Continua con la stima media/);
  assert.match(html, /modalitaCalcolo === "media"/);
  assert.match(html, /vaiAlCaricatoreScheda\(\{ source: "offers_personalization" \}\)/);
});

test("landing V1.4: include il footer informativo completo del sito", () => {
  assert.match(html, /class="social-entry-footer"/);
  assert.match(html, /&copy; 2026 OffertaLogica\.it - Calcolatore Energetico/);
  assert.match(html, /Confronto trasparente delle offerte luce e gas per privati\. Analisi preliminare dedicata alle aziende\./);
  assert.match(html, /Le stime sono informative e non sostituiscono scheda sintetica, condizioni economiche e contratto del fornitore\./);
  for (const href of [
    "/come-funziona.html",
    "/offerte-luce-gas-aggiornate.html",
    "/partner.html",
    "/termini-condizioni.html",
    "/casa-smart.html",
    "/internet-casa.html",
  ]) assert.match(html, new RegExp(`href="${href.replaceAll("/", "\\/").replaceAll(".", "\\.")}"`));
  assert.match(html, /privacy-policy\/36565194"[^>]*>Privacy Policy<\/a>/);
  assert.match(html, /privacy-policy\/36565194\/cookie-policy"[^>]*>Cookie Policy<\/a>/);
  assert.match(html, /onclick="apriPreferenzeCookie\(event\)">Modifica preferenze cookie<\/button>/);
  assert.match(html, /function apriPreferenzeCookie\(event\)/);
});

test("landing V1.4: mantiene visibili i contenitori Iubenda e oscura il calcolatore sottostante", () => {
  const css = between(html, "/* OFFERTALOGICA_LANDING_GLASS_V1_7_20260814 */", ".offers-personalize-prompt {");
  assert.match(css, /body > :not\(\.social-mobile-entry\):not\(script\):not\(\[id\*="iubenda"\]\):not\(\[class\*="iubenda"\]\):not\(\[id\^="_iub"\]\):not\(\[class\*="_iub"\]\)/);
});



test("landing V1.7: Privacy e Cookie tornano al modal Iubenda standard sopra la landing", () => {
  const landing = between(html, '<section class="social-mobile-entry"', '<aside class="mobile-pdf-status"');
  const privacy = landing.match(/<a href="https:\/\/www\.iubenda\.com\/privacy-policy\/36565194"[^>]*>Privacy Policy<\/a>/)?.[0] || "";
  const cookie = landing.match(/<a href="https:\/\/www\.iubenda\.com\/privacy-policy\/36565194\/cookie-policy"[^>]*>Cookie Policy<\/a>/)?.[0] || "";
  for (const anchor of [privacy, cookie]) {
    assert.ok(anchor, "link policy landing non trovato");
    assert.match(anchor, /class="iubenda-white iubenda-noiframe iubenda-embed"/);
    assert.doesNotMatch(anchor, /target="_blank"/);
    assert.doesNotMatch(anchor, /rel="noopener noreferrer"/);
  }

  const css = between(html, "/* OFFERTALOGICA_LANDING_GLASS_V1_7_20260814 */", ".offers-personalize-prompt {");
  const landingZ = Number(css.match(/html\.social-entry-requested \.social-mobile-entry \{[\s\S]*?z-index: (\d+);/)?.[1]);
  assert.equal(landingZ, 9000);
  assert.ok(landingZ < 10000, "la landing deve restare sotto al modal Iubenda standard (z-index 10000)");
  assert.match(css, /\.iubenda-tp-btn\.iubenda-cs-preferences-link \{ visibility: hidden !important; \}/);

  const originalFooter = html.slice(html.lastIndexOf('<footer style="text-align: center;'));
  assert.match(originalFooter, /class="iubenda-white iubenda-noiframe iubenda-embed"[^>]*>Privacy Policy<\/a>/);
  assert.match(originalFooter, /class="iubenda-white iubenda-noiframe iubenda-embed"[^>]*>Cookie Policy<\/a>/);
});

test("blocco 02: OTP, fonti e business comunicano il servizio reale senza cambiare il flusso", () => {
  assert.match(html, /Verifica il numero per vedere il confronto completo/);
  assert.match(html, /I tuoi dati non vengono inviati a fornitori o partner finché non scegli di procedere con un'offerta\./);
  assert.match(html, /L'SMS serve solo a confermare il numero e sbloccare il confronto\./);
  assert.match(html, /L'invio dei dati a fornitori o partner resta separato e facoltativo fino alla scelta di un'offerta\./);
  assert.match(html, /const isBusiness = source === "business"/);
  assert.match(html, /Verifica il numero per proseguire con la richiesta aziendale/);
  assert.match(html, /Verifica e prosegui con la richiesta/);
  assert.match(html, /Richiedo l'analisi preliminare e il ricontatto necessario alla gestione della mia richiesta\./);
  assert.match(html, /L'SMS serve solo a confermare il numero e proseguire con la richiesta aziendale\./);
  assert.match(html, /L'invio dei dati a consulenti o partner resta separato e facoltativo\./);
  assert.match(html, /catalogo ARERA e gli indici di mercato disponibili/);
  assert.match(html, />Avvia analisi business<\/button>/);
  assert.match(html, />Richiedi un contatto aziendale<\/button>/);
  assert.match(html, /Puoi iniziare dall'analisi preliminare oppure richiedere direttamente un contatto\./);
  assert.match(html, />Prosegui con la richiesta<\/button>/);
  assert.match(html, />Analisi preliminare in elaborazione<\/strong>/);
  assert.doesNotMatch(html, />Richiedi analisi aziendale<\/button>/);
  assert.doesNotMatch(html, />Sblocca analisi aziendale<\/button>/);
  assert.doesNotMatch(html, /Calcola margine business/);
  assert.doesNotMatch(html, /Margine stimato in elaborazione/);
  assert.doesNotMatch(html, /Qui stimiamo il margine/);
});


test("blocco 02: risultati separano convenienza economica e percorso di attivazione", () => {
  assert.match(html, /Il costo annuo stimato mostra il risultato economico del confronto\. I badge di attivazione indicano come puoi procedere con la singola offerta\./);
  assert.match(html, /Offerte con attivazione online disponibile/);
  assert.match(html, /Qui trovi le offerte per cui è disponibile un percorso di attivazione online\./);
  assert.match(html, /Offerte più convenienti per costo annuo stimato/);
  assert.match(html, /Ordinate in base al costo annuo stimato sul tuo profilo\. Per procedere può essere necessaria una verifica\./);
  assert.match(html, /return "Vedi come procedere";/);
  assert.match(html, /if \(item\.gruppoVisuale === "attivabile"\) return "Attivabile online";/);
  assert.match(html, /id="offer-consent-title">Come procedere con l'offerta<\/h3>/);
  assert.doesNotMatch(html, /Migliore partner attivabile/);
  assert.doesNotMatch(html, /Partner attivabile online/);
  assert.doesNotMatch(html, /3 migliori offerte per costo con consulente/);
});


test("blocco02: risultati usano formattazione italiana senza cambiare i valori di calcolo", () => {
  assert.match(html, /function numeroItaliano\(value, cifre = 2\)/);
  assert.match(html, /new Intl\.NumberFormat\("it-IT"/);
  assert.match(html, /function euro\(value\) \{[\s\S]*numeroItaliano\(value, 2\)/);
  assert.match(html, /numeroItaliano\(voce\.formula\.spread, 4\)/);
  assert.match(html, /numeroItaliano\(voce\.prezzoVariabile, 4\)/);
  assert.match(html, /Confronto trasparente delle offerte luce e gas per privati\. Analisi preliminare dedicata alle aziende\./);
  assert.doesNotMatch(html, /Analisi indipendente e trasparente delle offerte Luce e Gas per privati e aziende\./);
});


test("blocco02: CTA principali leggibili anche su mobile", () => {
  assert.match(html, /\.choice-card strong \{[\s\S]*font-size: 23px;/);
  assert.match(html, /\.choice-card span \{[\s\S]*font-size: 15\.5px;/);
  assert.match(html, /\.pdf-lead-panel h3 \{[\s\S]*font-size: 28px;/);
  assert.match(html, /@media \(max-width: 700px\)[\s\S]*\.choice-card strong \{[\s\S]*font-size: 21px;[\s\S]*\.pdf-lead-panel h3 \{[\s\S]*font-size: 24px;[\s\S]*\.segment-switch button \{[\s\S]*font-size: 19px;/);
});


test("blocco02: CTA offerte e modali restano leggibili su mobile", () => {
  assert.match(html, /\.offers-personalize-actions button \{[\s\S]*min-height: 56px;[\s\S]*font-size: 17px;/);
  assert.match(html, /@media \(max-width: 700px\)[\s\S]*\.offers-personalize-actions button \{[\s\S]*min-height: 62px;[\s\S]*font-size: 18px;/);
  assert.match(html, /@media \(max-width: 680px\) \{[\s\S]*\.lead-modal-backdrop,[\s\S]*\.offer-consent-backdrop[\s\S]*align-items: flex-end;/);
  assert.match(html, /\.lead-modal,[\s\S]*\.offer-consent-modal \{[\s\S]*max-height: 92dvh;[\s\S]*overflow: auto;[\s\S]*border-radius: 14px 14px 0 0;/);
  assert.match(html, /\.lead-form-grid input \{[\s\S]*font-size: 16px;/);
  assert.match(html, /\.lead-actions button \{[\s\S]*min-height: 48px;[\s\S]*font-size: 15px;/);
});
