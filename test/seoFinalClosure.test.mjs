import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const publicDir = path.join(root, "public");
const sitemap = fs.readFileSync(path.join(publicDir, "sitemap.xml"), "utf8");
const base = "https://offertalogica.it";
const approvedTrust = "Confronto trasparente delle offerte luce e gas per privati. Analisi preliminare dedicata alle aziende.";
const obsoleteTrust = "Analisi indipendente e trasparente delle offerte luce e gas per privati e aziende.";

function localFileFor(url) {
  const pathname = new URL(url).pathname;
  return pathname === "/" ? path.join(publicDir, "index.html") : path.join(publicDir, pathname.replace(/^\//, ""));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("blocco03 chiusura: sitemap contiene 16 URL canoniche uniche e nessuna pagina noindex", () => {
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs.length, 16);
  assert.equal(new Set(locs).size, 16);
  for (const url of locs) {
    assert.ok(url.startsWith(`${base}/`), `URL fuori dominio: ${url}`);
    const file = localFileFor(url);
    assert.ok(fs.existsSync(file), `file sitemap assente: ${file}`);
    const html = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(html, /<meta\s+name=["']robots["'][^>]*content=["'][^"']*noindex/i, `noindex presente in sitemap: ${url}`);
    assert.match(html, new RegExp(`<link\\s+rel=["']canonical["']\\s+href=["']${escapeRegex(url)}["']`), `canonical non coerente: ${url}`);
    assert.equal((html.match(/<h1\b/gi) || []).length, 1, `H1 non unico: ${url}`);
  }
});

test("blocco03 chiusura: Casa Smart e Internet Casa restano online ma fuori sitemap", () => {
  for (const slug of ["casa-smart.html", "internet-casa.html"]) {
    const html = fs.readFileSync(path.join(publicDir, slug), "utf8");
    assert.match(html, /<meta name="robots" content="noindex,follow">/);
    assert.doesNotMatch(sitemap, new RegExp(escapeRegex(`${base}/${slug}`)));
  }
});

test("blocco03 chiusura: wording trust coerente sulle pagine istituzionali", () => {
  for (const slug of ["come-funziona.html", "partner.html", "termini-condizioni.html"]) {
    const html = fs.readFileSync(path.join(publicDir, slug), "utf8");
    assert.ok(html.includes(approvedTrust), `wording approvato assente: ${slug}`);
    assert.ok(!html.includes(obsoleteTrust), `claim obsoleto presente: ${slug}`);
  }
});

test("blocco03 chiusura: lastmod aggiornato solo sulle pagine istituzionali modificate", () => {
  for (const slug of ["come-funziona.html", "partner.html", "termini-condizioni.html"]) {
    assert.match(sitemap, new RegExp(`<loc>${escapeRegex(`${base}/${slug}`)}</loc><lastmod>2026-08-25</lastmod>`));
  }
});
