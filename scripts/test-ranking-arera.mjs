import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = path.join(root, "data/offerte-arera-menu.json");
const resultPath = path.join(root, "data/ranking-arera-test.json");
const reportPath = path.join(root, "docs/RANKING-ARERA-TEST.md");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function baseUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return `${url.hostname}${url.pathname}`.replace(/\/+$/g, "").toLowerCase();
  } catch {
    return "";
  }
}

function sameDualOffer(light, gas) {
  if (light.partner?.routeId && light.partner.routeId === gas.partner?.routeId) return true;
  return Boolean(baseUrl(light.url) && baseUrl(light.url) === baseUrl(gas.url));
}

function rowCost(row, consumption) {
  return round2((Number(row.prezzo) * consumption) + Number(row.quotaFissaAnnua));
}

function rankDual(rows, type, lightKwh, gasSmc) {
  const providers = [...new Set(rows.map((row) => row.providerKey))];
  const results = [];
  for (const providerKey of providers) {
    const lights = rows.filter((row) => row.providerKey === providerKey && row.commodity === "luce" && row.tipo === type);
    const gases = rows.filter((row) => row.providerKey === providerKey && row.commodity === "gas" && row.tipo === type);
    for (const light of lights) {
      for (const gas of gases) {
        if (!sameDualOffer(light, gas)) continue;
        results.push({
          providerKey,
          provider: light.providerLabel || gas.providerLabel,
          lightCode: light.codice,
          gasCode: gas.codice,
          lightCost: rowCost(light, lightKwh),
          gasCost: rowCost(gas, gasSmc),
          annualCost: round2(rowCost(light, lightKwh) + rowCost(gas, gasSmc)),
          partner: Boolean(light.partner && gas.partner && light.partner.routeId === gas.partner.routeId),
        });
      }
    }
  }
  return results.sort((a, b) => a.annualCost - b.annualCost);
}

function rankSeparate(rows, type, lightKwh, gasSmc) {
  const lights = rows
    .filter((row) => row.commodity === "luce" && row.tipo === type)
    .map((row) => ({ ...row, annualCost: rowCost(row, lightKwh) }))
    .sort((a, b) => a.annualCost - b.annualCost)
    .slice(0, 10);
  const gases = rows
    .filter((row) => row.commodity === "gas" && row.tipo === type)
    .map((row) => ({ ...row, annualCost: rowCost(row, gasSmc) }))
    .sort((a, b) => a.annualCost - b.annualCost)
    .slice(0, 10);
  const pairs = [];
  for (const light of lights) {
    for (const gas of gases) {
      pairs.push({
        provider: `${light.providerLabel} + ${gas.providerLabel}`,
        lightCode: light.codice,
        gasCode: gas.codice,
        annualCost: round2(light.annualCost + gas.annualCost),
      });
    }
  }
  return pairs.sort((a, b) => a.annualCost - b.annualCost);
}

try {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  assert(Number(catalog.schemaVersion) >= 93, "Catalogo ARERA non v93");
  assert(catalog.offerte.every((row) => row.customerType === "privato"), "Catalogo ranking contaminato da offerte business");
  const profiles = [
    { id: "dual-fisso-medio", mode: "dual", type: "fisso", lightKwh: 2700, gasSmc: 700 },
    { id: "dual-fisso-alto", mode: "dual", type: "fisso", lightKwh: 4500, gasSmc: 1200 },
    { id: "separate-fisso-medio", mode: "separate", type: "fisso", lightKwh: 2700, gasSmc: 700 },
    { id: "dual-variabile-senza-fallback", mode: "dual", type: "variabile", lightKwh: 2700, gasSmc: 700 },
  ].map((profile) => {
    const ranking = profile.mode === "dual"
      ? rankDual(catalog.offerte, profile.type, profile.lightKwh, profile.gasSmc)
      : rankSeparate(catalog.offerte, profile.type, profile.lightKwh, profile.gasSmc);
    return { ...profile, ranking: ranking.slice(0, 20) };
  });
  assert(profiles.filter((profile) => profile.type === "fisso").every((profile) => profile.ranking.length), "Ranking fisso vuoto");
  assert(profiles.find((profile) => profile.type === "variabile").ranking.length === 0, "Ranking variabile usa un fallback non validato");
  for (const profile of profiles) {
    for (let index = 1; index < profile.ranking.length; index += 1) {
      assert(profile.ranking[index - 1].annualCost <= profile.ranking[index].annualCost, `${profile.id}: ordine economico errato`);
    }
  }
  const result = {
    ok: true,
    generatedAt: new Date().toISOString(),
    catalogVersion: catalog.versioneDati,
    catalogDate: catalog.aggiornatoIl,
    profiles,
  };
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  const report = [
    "# Test ranking ARERA",
    "",
    `Catalogo canonico: ${catalog.versioneDati} (${catalog.aggiornatoIl})`,
    "",
    "Il test ordina esclusivamente prezzi e quote presenti nel catalogo ARERA validato. I metadati partner annotano il risultato ma non ne cambiano il costo o l'ordine.",
    "",
    ...profiles.flatMap((profile) => [
      `## ${profile.id}`,
      "",
      `Risultati: ${profile.ranking.length}`,
      "",
      ...profile.ranking.slice(0, 5).map((row, index) => `${index + 1}. ${row.provider}: ${row.annualCost.toFixed(2)} euro/anno`),
      "",
    ]),
  ];
  fs.writeFileSync(reportPath, `${report.join("\n").trimEnd()}\n`);
  console.log(JSON.stringify({
    ok: true,
    catalog: catalog.versioneDati,
    profiles: profiles.map((profile) => ({ id: profile.id, results: profile.ranking.length, best: profile.ranking[0]?.provider || null })),
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
