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

test("ingresso social: si attiva soltanto con segnale esplicito e su mobile", () => {
  const bootstrap = between(html, "const params = new URLSearchParams", "})();\n</script>");
  assert.match(bootstrap, /params\.get\("social"\) === "1"/);
  assert.match(bootstrap, /utm_source/);
  assert.match(bootstrap, /max-width: 768px/);
  assert.match(bootstrap, /explicitSocial \|\| socialSource/);
});

test("ingresso social: la cifra e visibile subito e la CTA non introduce un calcolo aggiuntivo", () => {
  assert.match(html, /id="social-entry-saving-value"/);
  assert.match(html, /Oggi potresti risparmiare fino a/);
  assert.match(html, /id="social-entry-cta"[^>]*>Scopri l'offerta</);
  assert.match(html, /Senza bolletta e senza inserire consumi/);

  const prepare = between(html, "function preparaRisparmioIngressoSocialMobile", "function apriOfferteDaIngressoSocial");
  assert.match(prepare, /btnMedi\?\.click\(\)/);
  assert.match(prepare, /window\.avviaComparazioneDati\?\.\(\)/);
  assert.match(prepare, /LEAD_STATE\.bestPartnerSaving/);
});

test("ingresso social: usa solo il miglior risparmio delle offerte partner attivabili", () => {
  assert.match(
    html,
    /LEAD_STATE\.bestPartnerSaving = Math\.max\(0, \.\.\.attivabiliPrioritarie\.map\(\(item\) => item\.differenza\)\)/,
  );
  const teaser = between(html, "const teaserSaving = SOCIAL_ENTRY_STATE.isSocialJourney", "aggiornaPromptBollettaDopoOfferte();");
  assert.match(teaser, /LEAD_STATE\.bestPartnerSaving/);
  assert.match(teaser, /LEAD_STATE\.bestSaving/);
});

test("ingresso social: il pulsante usa il gradiente, il pulse e rispetta reduced motion", () => {
  assert.match(html, /\.social-entry-cta[\s\S]*background: var\(--logo-green-gradient\)/);
  assert.match(html, /animation: social-entry-pulse/);
  assert.match(html, /@keyframes social-entry-pulse/);
  assert.match(html, /prefers-reduced-motion: reduce/);
});

test("ingresso social: su viewport bassi non taglia il logo in alto", () => {
  assert.match(html, /html\.social-entry-requested \.social-mobile-entry[\s\S]*align-items: flex-start/);
  assert.match(html, /padding: max\(32px, calc\(env\(safe-area-inset-top\) \+ 12px\)\)/);
  assert.match(html, /\.social-entry-card[\s\S]*margin-block: auto/);
});

test("offerte: propone la bolletta senza bloccare la stima media", () => {
  assert.match(html, /id="offers-personalize-prompt" hidden/);
  assert.match(html, /id="offers-upload-bill">Carica la bolletta</);
  assert.match(html, /id="offers-keep-average">Continua con la stima media</);
  assert.match(html, /modalitaCalcolo === "media"/);
  assert.match(html, /vaiAlCaricatoreScheda\(\{ source: "offers_personalization" \}\)/);
});

test("percorso normale: la landing resta nascosta senza classe social-entry-requested", () => {
  assert.match(html, /\.social-mobile-entry \{ display: none; \}/);
  assert.match(html, /html\.social-entry-requested \.social-mobile-entry/);
  assert.match(html, /document\.documentElement\.classList\.remove\("social-entry-requested"\)/);
});
