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

test("aiuto mobile: sostituisce la pillola fissa con un pulsante circolare", () => {
  assert.match(html, /id="guided-assistant-mobile-toggle"/);
  assert.match(html, /aria-label="Apri l'assistente"/);
  assert.match(html, /title="Hai bisogno di aiuto\?"/);
  const css = between(html, "\/\* OFFERTALOGICA_MOBILE_HELP_NEAR_IUBENDA_20260730 \*\/", "</style>");
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /\.guided-assistant-launcher \{ display: none !important; \}/);
  assert.match(css, /\.guided-assistant-mobile-toggle[\s\S]*width: 42px;[\s\S]*height: 42px;/);
});

test("aiuto mobile: si posiziona accanto al controllo Iubenda reale", () => {
  const init = between(html, "(function initGuidedAssistant()", "</script>");
  assert.match(init, /\.iubenda-tp-btn\.iubenda-cs-preferences-link/);
  assert.match(init, /getBoundingClientRect\(\)/);
  assert.match(init, /rect\.right \+ gap/);
  assert.match(init, /rect\.left - size - gap/);
  assert.match(init, /MutationObserver/);
});

test("aiuto mobile: apre lo stesso assistente del pulsante desktop", () => {
  const init = between(html, "(function initGuidedAssistant()", "</script>");
  assert.match(init, /mobileToggle\?\.addEventListener\("click", \(\) => setOpen/);
  assert.match(init, /mobileToggle\?\.setAttribute\("aria-expanded"/);
  assert.match(init, /panel\.classList\.toggle\("is-open", isOpen\)/);
});

test("aiuto mobile: resta disponibile nelle offerte ma non durante PDF o landing social", () => {
  const css = between(html, "\/\* OFFERTALOGICA_MOBILE_HELP_NEAR_IUBENDA_20260730 \*\/", "</style>");
  assert.match(css, /body\.mobile-pdf-status-visible \.guided-assistant-mobile-toggle/);
  assert.match(css, /html\.social-entry-requested \.guided-assistant-mobile-toggle/);
  assert.doesNotMatch(css, /body\.mobile-offers-focus \.guided-assistant-mobile-toggle/);

  const mobileJourneyCss = between(html, "\/\* OFFERTALOGICA_MOBILE_PDF_JOURNEY_V1_20260730 \*\/", "\/\* OFFERTALOGICA_SOCIAL_ENTRY_MOBILE_V1_20260730 \*\/");
  assert.doesNotMatch(mobileJourneyCss, /body\.mobile-offers-focus \.guided-assistant[,\s]/);
});
