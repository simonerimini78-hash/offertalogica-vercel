import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/assets/ol-app-access.css", import.meta.url), "utf8");

test("D2 riproduce il conflitto: il desktop riserva una seconda colonna da 180px", () => {
  assert.match(
    index,
    /\.partner-vertical-card:not\(\.locked-offer\)\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(180px,\s*auto\);/s
  );
});

test("D2 conferma che il layout mobile originario voleva gia una sola colonna", () => {
  assert.match(
    index,
    /@media\s*\(max-width:\s*700px\)[\s\S]*?\.partner-vertical-card\s*\{[\s\S]*?grid-template-columns:\s*1fr;/
  );
});

test("D2 forza davvero una sola colonna su mobile superando la maggiore specificita desktop", () => {
  assert.match(
    css,
    /@media\s*\(max-width:\s*700px\)[\s\S]*?\.partner-vertical-card\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important;/
  );
});

test("D2 conserva la correzione D1 contro il focus-zoom iOS", () => {
  assert.match(css, /font-size:\s*16px\s*!important/);
  assert.doesNotMatch(css, /user-scalable\s*=\s*no/i);
  assert.doesNotMatch(css, /maximum-scale\s*=\s*1/i);
});
