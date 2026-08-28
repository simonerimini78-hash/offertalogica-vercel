import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=process.cwd();
const publicDir=path.join(root,"public");
function read(name){return fs.readFileSync(path.join(publicDir,name),"utf8");}
const pages=["pun-psv-spread-luce-gas.html","prezzo-fisso-o-variabile-luce-gas.html","quota-fissa-luce-gas-consumi-bassi.html"];
test("SEO interattiva: le tre pagine caricano il modulo condiviso senza nuove API",()=>{for(const name of pages){const html=read(name);assert.match(html,/\/assets\/seo-energy-interactions\.css/);assert.match(html,/\/assets\/seo-energy-interactions\.js/);assert.doesNotMatch(html,/href=["'][^"']*\/api\//);}});
test("SEO interattiva: PUN PSV distingue dato mensile e futuro dato giornaliero",()=>{const html=read(pages[0]);assert.match(html,/ultimo valore mensile ufficiale/i);assert.match(html,/non confondiamo i due dati/i);assert.match(html,/data-ol-market-monthly/);const js=read(path.join("assets","seo-energy-interactions.js"));assert.match(js,/\/data\/calcolo-parametri\.json/);assert.match(html,/from=seo-indici#pdf-upload-panel/);});
test("SEO interattiva: fisso variabile porta al lettore bolletta già esistente",()=>{const html=read(pages[1]);assert.match(html,/data-choice="fisso"/);assert.match(html,/data-choice="variabile"/);assert.match(html,/data-choice="non-so"/);assert.match(html,/from=seo-fisso-variabile#pdf-upload-panel/);});
test("SEO interattiva: quota fissa ha calcolo locale e nessun endpoint",()=>{const html=read(pages[2]);const js=read(path.join("assets","seo-energy-interactions.js"));assert.match(html,/data-ol-quota-calculator/);assert.match(js,/equivalent=q\/c/);assert.doesNotMatch(js,/\/api\//);assert.doesNotMatch(js,/https?:\/\//);});
test("SEO interattiva: le modifiche hanno lastmod 28 agosto 2026",()=>{const sitemap=read("sitemap.xml");for(const slug of pages.map(p=>p.replace(/\.html$/,''))){assert.match(sitemap,new RegExp(`<loc>https://offertalogica\\.it/${slug}\\.html</loc><lastmod>2026-08-28</lastmod>`));}});
