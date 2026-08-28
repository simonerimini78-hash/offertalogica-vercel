import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=process.cwd();
const publicDir=path.join(root,"public");
function read(file){return fs.readFileSync(path.join(publicDir,file),"utf8");}
const pun=read("pun-oggi.html");
const gas=read("psv-gas-oggi.html");
const data=JSON.parse(read("data/energia-oggi.json"));
const sitemap=read("sitemap.xml");

test("pagine oggi: intenti distinti, canonical e un solo H1",()=>{
  for(const [file,html,h1] of [["pun-oggi.html",pun,"PUN oggi: valore PUN Index GME"],["psv-gas-oggi.html",gas,"PSV gas oggi: valore e riferimento del mercato italiano"]]){
    assert.match(html,/meta name="robots" content="index,follow,max-image-preview:large"/);
    assert.ok(html.includes(`<link rel="canonical" href="https://offertalogica.it/${file}">`));
    assert.equal((html.match(/<h1\b/g)||[]).length,1);
    assert.ok(html.includes(`<h1>${h1}</h1>`));
    assert.match(html,/"@type":"WebPage"/);
    assert.match(html,/"@type":"BreadcrumbList"/);
  }
});

test("PUN oggi: dato visibile subito e collegamento al motore esistente",()=>{
  assert.match(pun,/205,52/);
  assert.match(pun,/0,20552 €\/kWh/);
  assert.match(pun,/data-ol-choice/);
  assert.match(pun,/from=pun-oggi#pdf-upload-panel/);
  assert.match(pun,/href="\/pun-psv-spread-luce-gas\.html"/);
});

test("PSV gas oggi: non confonde IG giornaliero e PSV mensile",()=>{
  assert.match(gas,/IG Index GME/);
  assert.match(gas,/71,71 €\/MWh/);
  assert.match(gas,/0,606612 €\/Smc/);
  assert.match(gas,/media mensile/);
  assert.match(gas,/non scriviamo semplicemente “PSV oggi = 71,71”/i);
  assert.match(gas,/from=psv-oggi#pdf-upload-panel/);
});

test("snapshot dati: PUN e gas hanno fonte e periodicità esplicite",()=>{
  assert.equal(data.pun.data,"2026-08-28");
  assert.equal(data.pun.valoreEurMwh,205.52);
  assert.equal(data.gas.giornaliero.label,"IG Index GME");
  assert.equal(data.gas.giornaliero.valoreEurMwh,71.71);
  assert.equal(data.gas.psvMensile.valoreEurSmc,0.606612);
  assert.match(data.gas.giornaliero.stato,/giornaliero/);
  assert.match(data.gas.psvMensile.stato,/mensile/);
});

test("pagine oggi: nessuna nuova API applicativa e sitemap aggiornata",()=>{
  const js=read("assets/seo-energy-live.js");
  assert.doesNotMatch(js,/\/api\//);
  assert.match(js,/\/data\/energia-oggi\.json/);
  assert.match(sitemap,/<loc>https:\/\/offertalogica\.it\/pun-oggi\.html<\/loc>/);
  assert.match(sitemap,/<loc>https:\/\/offertalogica\.it\/psv-gas-oggi\.html<\/loc>/);
});

test("guida indici: collega le due pagine live senza duplicarne l'intento",()=>{
  const guide=read("pun-psv-spread-luce-gas.html");
  assert.match(guide,/href="\/pun-oggi\.html"/);
  assert.match(guide,/href="\/psv-gas-oggi\.html"/);
  assert.match(guide,/ultimo dato mensile ufficiale/i);
});
