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

  function requestedFor(search = "", hash = "") {
    const classes = new Set();
    const context = {
      URLSearchParams,
      window: { location: { search, hash } },
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
});

test("landing V1: mostra subito risparmio e due percorsi senza CTA intermedia", () => {
  assert.match(html, /id="social-entry-saving-value"/);
  assert.match(html, /Oggi potresti risparmiare fino a/);
  assert.match(html, /Come preferisci procedere\?/);
  assert.match(html, /id="landing-self-service"[^>]*disabled/);
  assert.match(html, /<strong>Confronto da solo<\/strong>/);
  assert.match(html, /id="landing-assisted"[^>]*disabled/);
  assert.match(html, /<strong>Preferisco essere seguito<\/strong>/);
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
  assert.match(assisted, /Percorso assistito predisposto: manca solo il collegamento definitivo alla pagina Switcho\./);
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

test("landing V1.1: usa la palette ufficiale di app e sito e resta responsive", () => {
  const css = between(html, "/* OFFERTALOGICA_LANDING_GLASS_V1_20260814 */", ".offers-personalize-prompt {");
  assert.match(css, /#123044/);
  assert.match(css, /#f4f7f5/);
  assert.match(css, /#087f3a/);
  assert.match(css, /#18a84b/);
  assert.match(css, /#73c928/);
  assert.match(css, /rgba\(132, 209, 38/);
  assert.match(css, /background: linear-gradient\(145deg,#087f3a 0%,#18a84b 56%,#73c928 100%\)/);
  assert.match(css, /filter: saturate\(1\.08\) brightness\(1\.02\)/);
  assert.match(css, /backdrop-filter: blur\(24px\)/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("landing V1.1: i pulsanti app riusano le classi originali del sito", () => {
  assert.match(html, /class="social-entry-app-link ol-app-access-link ol-app-access-free"/);
  assert.match(html, /class="social-entry-app-link ol-app-access-link ol-app-access-premium"/);
});

test("landing V1: mantiene accessi app e informativa sul partner", () => {
  assert.match(html, /https:\/\/app\.offertalogica\.it\/app\.html\?install=1/);
  assert.match(html, /https:\/\/premium\.offertalogica\.it\/app\.html\?install=1/);
  assert.match(html, /Il percorso assistito sarà gestito dal partner Switcho\./);
});

test("offerte: propone ancora la bolletta senza bloccare la stima media", () => {
  assert.match(html, /id="offers-personalize-prompt" hidden/);
  assert.match(html, /id="offers-upload-bill">Carica la bolletta/);
  assert.match(html, /id="offers-keep-average">Continua con la stima media/);
  assert.match(html, /modalitaCalcolo === "media"/);
  assert.match(html, /vaiAlCaricatoreScheda\(\{ source: "offers_personalization" \}\)/);
});
