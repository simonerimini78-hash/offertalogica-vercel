import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const providers = {"eon": "E.ON", "alperia": "Alperia", "octopus": "Octopus Energy", "a2a": "A2A Energia", "enel": "Enel Energia", "plenitude": "Eni Plenitude"};

function read(key) {
  return fs.readFileSync(path.join(root, "public", "fornitori", `${key}.html`), "utf8");
}

test("blocco03: pagine fornitore mantengono canonical unici e indicizzabili", () => {
  for (const [key, name] of Object.entries(providers)) {
    const html = read(key);
    assert.match(html, /<meta name="robots" content="index,follow">/);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://offertalogica\\.it/fornitori/${key}\\.html">`));
    assert.match(html, new RegExp(`<h1>[^<]*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^<]*</h1>`));
  }
});

test("blocco03: contenuti fornitori non sono piu il template generico", () => {
  const expected = {
    eon: "fisso e variabile richiedono due letture diverse",
    alperia: "durata, indici e quote fisse possono cambiare il risultato",
    octopus: "il prezzo fisso non basta per stimare la spesa",
    a2a: "una proposta dual va letta come costo complessivo",
    enel: "separare prezzo, quote fisse ed eventuali bonus",
    plenitude: "il costo di commercializzazione pesa sul totale annuo",
  };
  for (const [key, marker] of Object.entries(expected)) {
    assert.ok(read(key).toLowerCase().includes(marker));
  }
});

test("blocco03: FAQ strutturate hanno contenuto visibile coerente", () => {
  for (const key of Object.keys(providers)) {
    const html = read(key);
    assert.match(html, /"@type": "FAQPage"/);
    assert.match(html, /id="faq"/);
    assert.match(html, /Domande frequenti su/);
  }
});

test("blocco03: guida bolletta collegata e vecchio claim indipendente rimosso", () => {
  for (const key of Object.keys(providers)) {
    const html = read(key);
    assert.ok((html.match(/\/come-leggere-bolletta-luce-gas\.html/g) || []).length >= 2);
    assert.doesNotMatch(html, /Analisi indipendente e trasparente/i);
    assert.match(html, /Confronto trasparente delle offerte luce e gas per privati/);
  }
});

test("blocco03: filtro ARERA invariato e variabile template rinominata", () => {
  const providerKeys = { eon: "eon", alperia: "alperia", octopus: "octopus", a2a: "a2a", enel: "enel", plenitude: "eni" };
  for (const key of Object.keys(providers)) {
    const html = read(key);
    assert.match(html, new RegExp(`providerKey === "${providerKeys[key]}"`));
    assert.match(html, /const providerOffers = offers/);
    assert.doesNotMatch(html, /const eon = offers/);
  }
});


test("blocco03: sitemap aggiorna solo le sei pagine fornitore modificate", () => {
  const sitemap = fs.readFileSync(path.join(root, "public", "sitemap.xml"), "utf8");
  for (const key of Object.keys(providers)) {
    const block = new RegExp(`<loc>https://offertalogica\\.it/fornitori/${key}\\.html</loc>\\s*<lastmod>2026-08-25</lastmod>`);
    assert.match(sitemap, block);
  }
  assert.match(sitemap, /<loc>https:\/\/offertalogica\.it\/<\/loc>\s*<lastmod>2026-08-16<\/lastmod>/);
});
