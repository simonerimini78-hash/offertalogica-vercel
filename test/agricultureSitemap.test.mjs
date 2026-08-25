import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sitemapUrl = new URL('../public/sitemap.xml', import.meta.url);
const sitemap = await readFile(sitemapUrl, 'utf8');

const agricultureUrls = [
  'https://offertalogica.it/energia-aziende-agricole.html',
  'https://offertalogica.it/costi-energetici-allevamenti.html',
  'https://offertalogica.it/energia-allevamento-avicolo.html'
];

test('sitemap includes all three agriculture vertical pages exactly once', () => {
  for (const url of agricultureUrls) {
    const count = sitemap.split(`<loc>${url}</loc>`).length - 1;
    assert.equal(count, 1, `${url} should appear exactly once`);
  }
});

test('agriculture sitemap entries use current lastmod and non-daily cadence', () => {
  for (const url of agricultureUrls) {
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`<url><loc>${escaped}</loc><lastmod>2026-08-25</lastmod><changefreq>monthly</changefreq><priority>0\\.8</priority></url>`);
    assert.match(sitemap, pattern);
  }
});

test('sitemap remains a valid sitemap-shaped XML document', () => {
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(sitemap, /<\/urlset>\s*$/);
});
