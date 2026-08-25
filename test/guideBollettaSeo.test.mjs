import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const guidePath = path.join(publicDir, 'come-leggere-bolletta-luce-gas.html');
const guideHtml = fs.readFileSync(guidePath, 'utf8');
const sitemap = fs.readFileSync(path.join(publicDir, 'sitemap.xml'), 'utf8');
const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const comeHtml = fs.readFileSync(path.join(publicDir, 'come-funziona.html'), 'utf8');
const offersHtml = fs.readFileSync(path.join(publicDir, 'offerte-luce-gas-aggiornate.html'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

const canonicalUrl = 'https://offertalogica.it/come-leggere-bolletta-luce-gas.html';
const pdfRel = '/assets/guida-bolletta/Guida-OffertaLogica-bolletta-luce-gas.pdf';

test('guida bolletta: SEO base, canonical e H1 sono presenti una sola volta', () => {
  assert.match(guideHtml, /<title>Come leggere la bolletta luce e gas:[^<]+OffertaLogica<\/title>/);
  assert.match(guideHtml, new RegExp(`<link rel="canonical" href="${canonicalUrl.replaceAll('.', '\\.')}">`));
  assert.match(guideHtml, /<meta name="robots" content="index,follow,max-image-preview:large">/);
  assert.equal((guideHtml.match(/<h1\b/g) || []).length, 1);
  assert.match(guideHtml, /<h1>Come leggere la bolletta luce e gas<\/h1>/);
});

test('guida bolletta: contiene tutti i 17 capitoli e link interni contestuali', () => {
  for (let i = 1; i <= 17; i += 1) assert.match(guideHtml, new RegExp(`<h2>${i}\\.`), `capitolo ${i} assente`);
  assert.match(guideHtml, /href="\/offerte-luce-gas-aggiornate\.html"/);
  assert.match(guideHtml, /href="\/come-funziona\.html"/);
  assert.match(guideHtml, /href="\/\?landing=0&amp;from=guide"/);
});

test('guida bolletta: ebook e immagini locali esistono', () => {
  const pdfPath = path.join(publicDir, pdfRel.slice(1));
  const pdf = fs.readFileSync(pdfPath);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.ok(pdf.length > 500_000, 'PDF troppo piccolo o incompleto');
  const images = ['cover.webp','struttura-bolletta.webp','pod-pdr.webp','letture-consumi.webp','fasce-f1-f2-f3.webp','prezzo-fisso-indicizzato.webp','totale-bolletta.webp','box-offerta.webp','checklist-confronto.webp','percorso-offertalogica.webp'];
  for (const name of images) { const p = path.join(publicDir,'assets','guida-bolletta',name); assert.ok(fs.existsSync(p), `${name} assente`); assert.ok(fs.statSync(p).size > 10_000, `${name} sembra vuota`); }
});

test('guida bolletta: sitemap contiene solo le 15 URL indicizzabili e lastmod significativo', () => {
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs.length, 15);
  assert.equal(new Set(locs).size, 15);
  assert.ok(locs.includes(canonicalUrl));
  assert.ok(!locs.includes('https://offertalogica.it/casa-smart.html'));
  assert.ok(!locs.includes('https://offertalogica.it/internet-casa.html'));
  assert.match(sitemap, /<loc>https:\/\/offertalogica\.it\/<\/loc><lastmod>2026-08-16<\/lastmod>/);
  assert.match(sitemap, /<loc>https:\/\/offertalogica\.it\/come-leggere-bolletta-luce-gas\.html<\/loc><lastmod>2026-08-25<\/lastmod>/);
});

test('guida bolletta: Home e pagine pilastro espongono link HTML crawlable', () => {
  const href = 'href="/come-leggere-bolletta-luce-gas.html"';
  assert.ok(indexHtml.includes(href)); assert.ok(comeHtml.includes(href)); assert.ok(offersHtml.includes(href));
});

test('guida bolletta: il PDF scaricabile non compete come URL indicizzabile', () => {
  const rule = (vercel.headers || []).find((item) => item.source === pdfRel);
  assert.ok(rule, 'header PDF dedicato assente'); assert.ok((rule.headers || []).some((h) => h.key === 'X-Robots-Tag' && h.value === 'noindex'));
});

test('guida bolletta: dati strutturati Article e BreadcrumbList sono presenti', () => {
  assert.match(guideHtml, /"@type": "Article"/); assert.match(guideHtml, /"@type": "BreadcrumbList"/); assert.match(guideHtml, /"datePublished": "2026-08-16"/); assert.match(guideHtml, /"dateModified": "2026-08-25"/); assert.match(guideHtml, /"publisher"/);
});
