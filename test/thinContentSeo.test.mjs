import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const thinPages = ["casa-smart.html", "internet-casa.html"];

function readPublic(file) {
  return fs.readFileSync(path.join(root, "public", file), "utf8");
}

test("blocco03: pagine verticali sottili restano online ma non indicizzabili", () => {
  for (const file of thinPages) {
    const html = readPublic(file);
    assert.match(html, /<meta name="robots" content="noindex,follow">/);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://offertalogica\\.it/${file.replace(".", "\\.")}">`));
  }
});

test("blocco03: sitemap esclude temporaneamente i due verticali thin", () => {
  const sitemap = readPublic("sitemap.xml");
  assert.doesNotMatch(sitemap, /https:\/\/offertalogica\.it\/casa-smart\.html/);
  assert.doesNotMatch(sitemap, /https:\/\/offertalogica\.it\/internet-casa\.html/);
  assert.match(sitemap, /https:\/\/offertalogica\.it\/come-leggere-bolletta-luce-gas\.html/);
  assert.match(sitemap, /https:\/\/offertalogica\.it\/fornitori\/eon\.html/);
});
