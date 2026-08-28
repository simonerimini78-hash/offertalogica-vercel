import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const publicDir=path.join(root,"public");
function read(file){return fs.readFileSync(path.join(publicDir,file),"utf8");}
function fmt(value,digits){return new Intl.NumberFormat("it-IT",{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Number(value));}

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

test("PUN oggi: fallback HTML sincronizzato con il JSON locale",()=>{
  assert.match(pun,new RegExp(fmt(data.pun.valoreEurMwh,2).replace(",","[,]")));
  assert.ok(pun.includes(`${fmt(data.pun.valoreEurKwh,5)} €/kWh`));
  assert.ok(pun.includes(`"dateModified":"${data.pun.data}"`));
  assert.match(pun,/data-ol-choice/);
  assert.match(pun,/from=pun-oggi#pdf-upload-panel/);
  assert.match(pun,/href="\/pun-psv-spread-luce-gas\.html"/);
});

test("PSV gas oggi: fallback HTML distingue IG giornaliero e PSV mensile",()=>{
  const daily=data.gas.giornaliero;
  const monthly=data.gas.psvMensile;
  assert.match(gas,/IG Index GME/);
  assert.ok(gas.includes(`${fmt(daily.valoreEurMwh,2)} €/MWh`));
  assert.ok(gas.includes(`${fmt(monthly.valoreEurSmc,6)} €/Smc`));
  assert.ok(gas.includes(`"dateModified":"${daily.data}"`));
  assert.match(gas,/media mensile/);
  assert.match(gas,/non scriviamo semplicemente “PSV oggi =/i);
  assert.match(gas,/from=psv-oggi#pdf-upload-panel/);
});

test("dati locali: fonte tecnica, origine e periodicità restano esplicite",()=>{
  assert.equal(data.fonteInterna,"OffertaLogica - aggiornamento dati energia");
  assert.match(data.pun.data,/^\d{4}-\d{2}-\d{2}$/);
  assert.equal(data.gas.giornaliero.label,"IG Index GME");
  assert.ok(Number(data.pun.valoreEurMwh)>0);
  assert.ok(Number(data.gas.giornaliero.valoreEurMwh)>0);
  assert.ok(Number(data.gas.psvMensile.valoreEurSmc)>0);
  assert.ok(String(data.gas.giornaliero.stato||"").length>0);
  assert.match(String(data.gas.psvMensile.stato||""),/mensile/);
  assert.ok(String(data.pun.fonteOriginaleLabel||"").length>0);
  assert.ok(String(data.gas.giornaliero.fonteOriginaleLabel||"").length>0);
});

test("pagine oggi: nessuna nuova API e sitemap sincronizzata alle date dati",()=>{
  const js=read("assets/seo-energy-live.js");
  assert.doesNotMatch(js,/\/api\//);
  assert.match(js,/\/data\/energia-oggi\.json/);
  assert.ok(sitemap.includes(`<loc>https://offertalogica.it/pun-oggi.html</loc><lastmod>${data.pun.data}</lastmod>`));
  assert.ok(sitemap.includes(`<loc>https://offertalogica.it/psv-gas-oggi.html</loc><lastmod>${data.gas.giornaliero.data}</lastmod>`));
});

test("guida indici: collega le due pagine live senza duplicarne l'intento",()=>{
  const guide=read("pun-psv-spread-luce-gas.html");
  assert.match(guide,/href="\/pun-oggi\.html"/);
  assert.match(guide,/href="\/psv-gas-oggi\.html"/);
  assert.match(guide,/ultimo dato mensile ufficiale/i);
});
