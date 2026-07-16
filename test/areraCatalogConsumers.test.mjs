import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);

function read(path) {
  return fs.readFileSync(new URL(path, root), "utf8");
}

function readJson(path) {
  return JSON.parse(read(path));
}

test("frontend, SEO e pagine fornitore non usano cataloghi paralleli", () => {
  const paths = [
    "public/index.html",
    "public/offerte-luce-gas-aggiornate.html",
    "public/fornitori/a2a.html",
    "public/fornitori/alperia.html",
    "public/fornitori/enel.html",
    "public/fornitori/eon.html",
    "public/fornitori/octopus.html",
    "public/fornitori/plenitude.html",
  ];
  for (const path of paths) {
    const source = read(path);
    assert.equal(source.includes("offerte-proposte.json"), false, path);
    assert.equal(/\b(?:0\.066595|0\.25051333)\b/.test(source), false, path);
  }
  assert.match(read("public/index.html"), /schemaVersion, 0\) < 93/);
  assert.match(read("public/offerte-luce-gas-aggiornate.html"), /Catalogo ARERA non validato/);
});

test("cataloghi privato e business restano separati", () => {
  const catalog = readJson("data/offerte-arera-menu.json");
  assert.ok(Number(catalog.schemaVersion) >= 93);
  assert.ok(catalog.offerte.length > 0);
  assert.ok(catalog.offerte.every((row) => row.customerType === "privato"));
  assert.ok(catalog.offerteBusiness.every((row) => row.customerType === "business"));
  const privateCodes = new Set(catalog.offerte.map((row) => `${row.codice}|${row.commodity}`));
  assert.ok(catalog.offerteBusiness.every((row) => !privateCodes.has(`${row.codice}|${row.commodity}`)));
  assert.equal(catalog.offerte.some((row) => row.providerKey === "axpo" && row.customerType === "business"), false);
});

test("vecchia Octopus e valori Axpo errati non sono pubblicati", () => {
  const catalog = readJson("data/offerte-arera-menu.json");
  const all = [...catalog.offerte, ...catalog.offerteBusiness];
  const octopus = all.filter((row) => row.providerKey === "octopus");
  assert.equal(octopus.some((row) => row.commodity === "luce" && Math.abs(Number(row.prezzo) - 0.1199) < 1e-8), false);
  assert.equal(octopus.some((row) => row.commodity === "gas" && Math.abs(Number(row.prezzo) - 0.45) < 1e-8), false);
  assert.equal(all.some((row) => Math.abs(Number(row.prezzo) - 0.066595) < 1e-8), false);
  assert.equal(all.some((row) => Math.abs(Number(row.prezzo) - 0.25051333) < 1e-8), false);
});

test("catalogo reale conserva regressioni Axpo e Acea", () => {
  const catalog = readJson("data/offerte-arera-menu.json");
  const axpoLight = catalog.offerteBusiness.find((row) => row.codice === "000099ESFFL07XXAXPOIXFIX89922607");
  const axpoGas = catalog.offerteBusiness.find((row) => row.codice === "000099GSFML07XXAXPOIXFIX91292607");
  const acea = catalog.offerte.find((row) => row.codice === "000774ESFML01XXRT4D4028030000000");
  assert.ok(axpoLight);
  assert.equal(axpoLight.prezzo, 0.14586);
  assert.equal(axpoLight.quotaFissaAnnua, 144);
  assert.equal(axpoLight.durataMesi, 36);
  assert.ok(axpoGas);
  assert.equal(axpoGas.prezzo, 0.77154);
  assert.equal(axpoGas.quotaFissaAnnua, 156);
  assert.equal(axpoGas.durataMesi, 24);
  assert.ok(acea);
  assert.equal(acea.prezzo, 0.099);
  assert.equal(acea.quotaFissaAnnua, 111);
  assert.equal(acea.durataMesi, 12);
});

test("le card partner derivano soltanto da record correnti annotati", () => {
  const catalog = readJson("data/offerte-arera-menu.json");
  const metadata = readJson("data/partner-metadata.json");
  const routes = new Map(metadata.routes.map((route) => [route.routeId, route]));
  const annotated = catalog.offerte.filter((row) => row.partner);
  assert.ok(annotated.length > 0);
  for (const row of annotated) {
    const route = routes.get(row.partner.routeId);
    assert.ok(route, row.partner.routeId);
    assert.equal(route.providerKey, row.providerKey);
    assert.equal(route.url, row.partner.url);
    assert.equal(row.partner.destinationStatus, "attiva");
  }
  const activeRouteIds = new Set(annotated.map((row) => row.partner.routeId));
  assert.ok(metadata.routes.some((route) => !activeRouteIds.has(route.routeId)), "fixture senza route partner da nascondere");
  assert.ok(annotated.every((row) => activeRouteIds.has(row.partner.routeId)));
});

test("la pagina SEO genera elenchi dal solo catalogo privati v93", () => {
  const html = read("public/offerte-luce-gas-aggiornate.html");
  const scripts = [...html.matchAll(/<script(?:(?!src=)[^>]*)>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  const source = scripts.find((script) => script.includes("function buildOnlineOffers"));
  assert.ok(source);
  const context = { console, Intl, URL, Map, Set };
  vm.createContext(context);
  const withoutAutoLoad = source.replace(/\n\s*loadAreraMeta\(\);[\s\S]*$/, "");
  vm.runInContext(`${withoutAutoLoad}\nthis.__seo = { buildOnlineOffers, buildConsultantOffers };`, context);
  const catalog = readJson("data/offerte-arera-menu.json");
  const online = context.__seo.buildOnlineOffers(catalog.offerte, catalog.aggiornatoIl);
  const consultant = context.__seo.buildConsultantOffers(catalog.offerte, catalog.aggiornatoIl);
  assert.ok(online.length > 0);
  assert.ok(online.every((offer) => offer.destinationStatus === "attiva"));
  assert.ok(consultant.every((offer) => offer.destinationStatus === "da_contattare"));
  assert.equal(JSON.stringify([...online, ...consultant]).includes("offerteBusiness"), false);
});
