import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=process.cwd();
const pages={
  "prezzo-fisso-o-variabile-luce-gas":"Prezzo fisso o variabile per luce e gas: cosa cambia davvero",
  "pun-psv-spread-luce-gas":"PUN, PSV e spread: come funzionano nelle offerte luce e gas",
  "come-cambiare-fornitore-luce-gas":"Come cambiare fornitore luce e gas",
  "quota-fissa-luce-gas-consumi-bassi":"Quota fissa luce e gas: perché conta soprattutto con consumi bassi"
};
function read(slug){return fs.readFileSync(path.join(root,"public",`${slug}.html`),"utf8");}
test("blocco03 3E: long-tail indicizzabili con canonical e un H1",()=>{for(const [slug,h1] of Object.entries(pages)){const html=read(slug);assert.match(html,/meta name="robots" content="index,follow,max-image-preview:large"/);assert.ok(html.includes(`<link rel="canonical" href="https://offertalogica.it/${slug}.html">`));assert.equal((html.match(/<h1\b/g)||[]).length,1);assert.ok(html.includes(`<h1>${h1}</h1>`));}});
test("blocco03 3E: Article e Breadcrumb presenti",()=>{for(const slug of Object.keys(pages)){const html=read(slug);assert.match(html,/"@type": "Article"/);assert.match(html,/"@type": "BreadcrumbList"/);assert.match(html,/"datePublished": "2026-08-25"/);}});
test("blocco03 3E: pagine collegate al nucleo OffertaLogica",()=>{for(const slug of Object.keys(pages)){const html=read(slug);assert.match(html,/href="\/come-leggere-bolletta-luce-gas\.html"/);assert.match(html,/href="\/\?landing=0&amp;from=seo-guide"/);}});
test("blocco03 3E: sitemap include le quattro long-tail ed esclude i thin content",()=>{const s=fs.readFileSync(path.join(root,"public","sitemap.xml"),"utf8");for(const slug of Object.keys(pages)){assert.match(s,new RegExp(`<loc>https://offertalogica\\.it/${slug}\\.html</loc><lastmod>2026-08-25</lastmod>`));}assert.doesNotMatch(s,/casa-smart\.html/);assert.doesNotMatch(s,/internet-casa\.html/);const locs=[...s.matchAll(/<loc>([^<]+)<\/loc>/g)];assert.equal(locs.length,16);});
test("blocco03 3E: i quattro intenti restano distinti",()=>{const texts=Object.fromEntries(Object.keys(pages).map(k=>[k,read(k).toLowerCase()]));assert.ok(texts["prezzo-fisso-o-variabile-luce-gas"].includes("prezzo fisso"));assert.ok(texts["pun-psv-spread-luce-gas"].includes("pun index gme"));assert.ok(texts["come-cambiare-fornitore-luce-gas"].includes("switching"));assert.ok(texts["quota-fissa-luce-gas-consumi-bassi"].includes("consumi bassi"));});

test("blocco03 3E.2: guida e offerte espongono link contestuali alle quattro long-tail",()=>{
  const guide=fs.readFileSync(path.join(root,"public","come-leggere-bolletta-luce-gas.html"),"utf8");
  const offers=fs.readFileSync(path.join(root,"public","offerte-luce-gas-aggiornate.html"),"utf8");
  for(const slug of Object.keys(pages)){
    const href=`href="/${slug}.html"`;
    assert.ok(guide.includes(href),`link ${slug} assente dalla guida`);
    assert.ok(offers.includes(href),`link ${slug} assente da offerte aggiornate`);
  }
  assert.match(guide,/id="approfondimenti"/);
  assert.match(offers,/id="approfondimenti"/);
});

test("blocco03 3E.2: footer trust coerente sulle due pagine pilastro modificate",()=>{
  for(const html of [
    fs.readFileSync(path.join(root,"public","come-leggere-bolletta-luce-gas.html"),"utf8"),
    fs.readFileSync(path.join(root,"public","offerte-luce-gas-aggiornate.html"),"utf8")
  ]){
    assert.doesNotMatch(html,/Analisi indipendente e trasparente/i);
    assert.match(html,/Confronto trasparente delle offerte luce e gas per privati\. Analisi preliminare dedicata alle aziende\./);
  }
});

test("blocco03 3E.2: sitemap aggiorna i lastmod delle due pagine pilastro realmente modificate",()=>{
  const s=fs.readFileSync(path.join(root,"public","sitemap.xml"),"utf8");
  assert.match(s,/<loc>https:\/\/offertalogica\.it\/come-leggere-bolletta-luce-gas\.html<\/loc><lastmod>2026-08-25<\/lastmod>/);
  assert.match(s,/<loc>https:\/\/offertalogica\.it\/offerte-luce-gas-aggiornate\.html<\/loc><lastmod>2026-08-25<\/lastmod>/);
});


test("blocco03 3E.3: quota fissa riceve un link contestuale anche da fisso o variabile",()=>{
  const fixed=fs.readFileSync(path.join(root,"public","prezzo-fisso-o-variabile-luce-gas.html"),"utf8");
  assert.match(fixed,/href="\/quota-fissa-luce-gas-consumi-bassi\.html"/);
});

test("blocco03 3E.3: lastmod Home riflette la modifica reale del 25 agosto",()=>{
  const s=fs.readFileSync(path.join(root,"public","sitemap.xml"),"utf8");
  assert.match(s,/<loc>https:\/\/offertalogica\.it\/<\/loc><lastmod>2026-08-25<\/lastmod>/);
});
