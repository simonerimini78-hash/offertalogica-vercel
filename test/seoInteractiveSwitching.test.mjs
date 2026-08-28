import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const html=fs.readFileSync(path.join(root,"public","come-cambiare-fornitore-luce-gas.html"),"utf8");
const sitemap=fs.readFileSync(path.join(root,"public","sitemap.xml"),"utf8");

test("SEO switching: mantiene intento, canonical, H1 e dati strutturati",()=>{
  assert.match(html,/<link rel="canonical" href="https:\/\/offertalogica\.it\/come-cambiare-fornitore-luce-gas\.html">/);
  assert.equal((html.match(/<h1\b/g)||[]).length,1);
  assert.match(html,/<h1>Come cambiare fornitore luce e gas<\/h1>/);
  assert.match(html,/"@type":"Article"/);
  assert.match(html,/"@type":"BreadcrumbList"/);
  assert.match(html,/"datePublished":"2026-08-25"/);
  assert.match(html,/"dateModified":"2026-08-28"/);
});

test("SEO switching: riusa il componente interattivo condiviso",()=>{
  assert.match(html,/href="\/assets\/seo-energy-interactions\.css"/);
  assert.match(html,/src="\/assets\/seo-energy-interactions\.js"/);
  assert.match(html,/data-ol-choice/);
  for(const value of ["switch","voltura","subentro"]){
    assert.match(html,new RegExp(`data-choice="${value}"`));
    assert.match(html,new RegExp(`data-choice-result="${value}"`));
  }
});

test("SEO switching: distingue switching, voltura e subentro senza duplicare funzioni",()=>{
  assert.match(html,/voltura, non di semplice cambio venditore/);
  assert.match(html,/contatore è disattivato, non stai facendo un normale cambio venditore/);
  assert.match(html,/riattivazione\/subentro/);
  assert.match(html,/from=seo-switch#pdf-upload-panel/);
  assert.match(html,/from=seo-switch-dati#pdf-upload-panel/);
  assert.match(html,/Conosco già i miei dati/);
  assert.doesNotMatch(html,/\/api\//);
  assert.doesNotMatch(html,/fetch\s*\(/);
});

test("SEO switching: sitemap aggiorna solo il lastmod della pagina modificata",()=>{
  assert.match(sitemap,/<loc>https:\/\/offertalogica\.it\/come-cambiare-fornitore-luce-gas\.html<\/loc><lastmod>2026-08-28<\/lastmod>/);
  assert.match(sitemap,/<loc>https:\/\/offertalogica\.it\/come-leggere-bolletta-luce-gas\.html<\/loc><lastmod>2026-08-25<\/lastmod>/);
  assert.match(sitemap,/<loc>https:\/\/offertalogica\.it\/offerte-luce-gas-aggiornate\.html<\/loc><lastmod>2026-08-25<\/lastmod>/);
});
