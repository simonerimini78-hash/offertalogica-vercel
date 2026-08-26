import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const homepage = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const hub = fs.readFileSync(path.join(root, "public", "fornitori", "index.html"), "utf8");
const sitemap = fs.readFileSync(path.join(root, "public", "sitemap.xml"), "utf8");

const providers = {
  enel: ["Enel Energia", "/assets/providers/enel.png"],
  plenitude: ["Eni Plenitude", "/assets/providers/plenitude-user.png"],
  a2a: ["A2A Energia", "/assets/providers/a2a-user.png"],
  eon: ["E.ON", "/assets/providers/eon-user.png"],
  octopus: ["Octopus Energy", "/assets/providers/octopus-user.png"],
  alperia: ["Alperia", "/assets/providers/alperia.png"],
};

test("battaglia04: hub fornitori è indicizzabile con canonical univoco", () => {
  assert.match(hub, /<meta name="robots" content="index,follow">/);
  assert.match(hub, /<link rel="canonical" href="https:\/\/offertalogica\.it\/fornitori\/">/);
  assert.match(hub, /<h1>Fornitori luce e gas:/);
  assert.match(hub, /"@type": "CollectionPage"/);
  assert.match(hub, /"@type": "ItemList"/);
});

test("battaglia04: hub collega esattamente le sei pagine fornitore già esistenti", () => {
  for (const [key, [name, logo]] of Object.entries(providers)) {
    assert.match(hub, new RegExp(`href="/fornitori/${key}\\.html"`));
    assert.ok(hub.includes(name));
    assert.ok(hub.includes(logo));
  }
  const providerPageLinks = [...hub.matchAll(/href="\/fornitori\/([a-z0-9-]+)\.html"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(providerPageLinks)].sort(), Object.keys(providers).sort());
});

test("battaglia04: homepage collega l'hub senza modificare il funnel", () => {
  const links = homepage.match(/href="\/fornitori\/"/g) || [];
  assert.ok(links.length >= 2);
  assert.match(homepage, />Fornitori<\/a>/);
  assert.match(homepage, /id="landing-self-service"/);
  assert.match(homepage, /id="landing-assisted"/);
});

test("battaglia04: sitemap include hub e conserva le sei pagine individuali", () => {
  assert.match(sitemap, /<loc>https:\/\/offertalogica\.it\/fornitori\/<\/loc>\s*<lastmod>2026-08-26<\/lastmod>/);
  assert.match(sitemap, /<loc>https:\/\/offertalogica\.it\/<\/loc>\s*<lastmod>2026-08-26<\/lastmod>/);
  for (const key of Object.keys(providers)) {
    assert.match(sitemap, new RegExp(`<loc>https://offertalogica\\.it/fornitori/${key}\\.html</loc>`));
  }
});

test("battaglia04: hub non introduce nuove chiamate applicative", () => {
  assert.doesNotMatch(hub, /\bfetch\s*\(/);
  assert.doesNotMatch(hub, /\/api\//);
  assert.doesNotMatch(hub, /XMLHttpRequest/);
});
