import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=process.cwd();
const pages={
  "prezzo-fisso-o-variabile-luce-gas":"Prezzo fisso o variabile per luce e gas: cosa cambia davvero",
  "pun-psv-spread-luce-gas":"PUN, PSV e spread: come funzionano nelle offerte luce e gas",
  "come-cambiare-fornitore-luce-gas":"Come cambiare fornitore luce e gas"
};
function read(slug){return fs.readFileSync(path.join(root,"public",`${slug}.html`),"utf8");}
test("blocco03 3E: long-tail indicizzabili con canonical e un H1",()=>{for(const [slug,h1] of Object.entries(pages)){const html=read(slug);assert.match(html,/meta name="robots" content="index,follow,max-image-preview:large"/);assert.ok(html.includes(`<link rel="canonical" href="https://offertalogica.it/${slug}.html">`));assert.equal((html.match(/<h1\b/g)||[]).length,1);assert.ok(html.includes(`<h1>${h1}</h1>`));}});
test("blocco03 3E: Article e Breadcrumb presenti",()=>{for(const slug of Object.keys(pages)){const html=read(slug);assert.match(html,/"@type": "Article"/);assert.match(html,/"@type": "BreadcrumbList"/);assert.match(html,/"datePublished": "2026-08-25"/);}});
test("blocco03 3E: pagine collegate al nucleo OffertaLogica",()=>{for(const slug of Object.keys(pages)){const html=read(slug);assert.match(html,/href="\/come-leggere-bolletta-luce-gas\.html"/);assert.match(html,/href="\/\?landing=0&amp;from=seo-guide"/);}});
test("blocco03 3E: sitemap include le tre nuove URL ed esclude i thin content",()=>{const s=fs.readFileSync(path.join(root,"public","sitemap.xml"),"utf8");for(const slug of Object.keys(pages)){assert.match(s,new RegExp(`<loc>https://offertalogica\\.it/${slug}\\.html</loc><lastmod>2026-08-25</lastmod>`));}assert.doesNotMatch(s,/casa-smart\.html/);assert.doesNotMatch(s,/internet-casa\.html/);const locs=[...s.matchAll(/<loc>([^<]+)<\/loc>/g)];assert.equal(locs.length,15);});
test("blocco03 3E: i tre intenti restano distinti",()=>{const texts=Object.fromEntries(Object.keys(pages).map(k=>[k,read(k).toLowerCase()]));assert.ok(texts["prezzo-fisso-o-variabile-luce-gas"].includes("prezzo fisso"));assert.ok(texts["pun-psv-spread-luce-gas"].includes("pun index gme"));assert.ok(texts["come-cambiare-fornitore-luce-gas"].includes("switching"));});
