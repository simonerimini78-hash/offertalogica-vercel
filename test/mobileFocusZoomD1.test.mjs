import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(
  new URL("../public/assets/ol-app-access.css", import.meta.url),
  "utf8"
);

test("D1 mobile: campi testuali, select e textarea arrivano a 16px", () => {
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /select,\s*\n\s*textarea\s*\{/);
  assert.match(css, /font-size:\s*16px\s*!important/);
});

test("D1 mobile: non altera checkbox, radio, file, range e pulsanti", () => {
  for (const type of ["checkbox", "radio", "file", "range", "button", "submit", "reset", "hidden"]) {
    assert.match(css, new RegExp(`:not\\(\\[type="${type}"\\]\\)`));
  }
});

test("D1 mobile: nessun blocco dello zoom manuale/accessibile", () => {
  assert.doesNotMatch(css, /user-scalable\s*=\s*no/i);
  assert.doesNotMatch(css, /maximum-scale\s*=\s*1/i);
  assert.doesNotMatch(css, /touch-action\s*:\s*none/i);
});

test("D1 mobile: stili CTA app esistenti restano presenti", () => {
  assert.match(css, /\.ol-app-access-free\s*\{/);
  assert.match(css, /\.ol-app-access-premium\s*\{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
