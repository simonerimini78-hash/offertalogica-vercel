import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const arera = JSON.parse(fs.readFileSync(path.join(root, "data/offerte-arera-menu.json"), "utf8"));
const proposals = JSON.parse(fs.readFileSync(path.join(root, "data/offerte-proposte.json"), "utf8"));

const mappingMatch = html.match(
  /const ABBINAMENTI_PARTNER_ARERA = Object\.freeze\((\{[\s\S]*?\n\})\);/,
);
if (!mappingMatch) throw new Error("ABINAMENTI_PARTNER_ARERA non trovato in public/index.html");
const mappings = vm.runInNewContext(`(${mappingMatch[1]})`, Object.create(null));

for (const scriptMatch of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
  if (scriptMatch[0].includes(" src=")) continue;
  new vm.Script(scriptMatch[1], { filename: "public/index.html" });
}

function normalized(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function providerKey(value) {
  const text = normalized(value);
  if (text.includes("e on")) return "eon";
  if (text.includes("plenitude") || text === "eni") return "eni";
  if (text.includes("octopus")) return "octopus";
  if (text.includes("alperia")) return "alperia";
  if (text.includes("enel")) return "enel";
  if (text.includes("a2a")) return "a2a";
  return text.replace(/\s+/g, "-");
}

const privateRows = Array.isArray(arera.offerte) ? arera.offerte : [];
const activeDual = proposals.offerte.filter(
  (offer) => offer.destinationStatus === "attiva" && offer.fornitura === "dual",
);
if (!activeDual.length) throw new Error("Nessun partner dual attivo da verificare");

const selected = [];
for (const offer of activeDual) {
  const mapping = mappings[String(offer.id)];
  if (!mapping?.luce || !mapping?.gas) {
    throw new Error(`Mappatura ARERA assente per partner attivo ${offer.id} ${offer.nome}`);
  }
  const expectedProvider = providerKey(offer.provider);
  const pair = {};
  for (const commodity of ["luce", "gas"]) {
    const rule = mapping[commodity];
    const allowedNames = new Set(rule.nomi.map(normalized));
    const matches = privateRows.filter((row) => (
      row.providerKey === expectedProvider
      && row.commodity === commodity
      && row.tipo === offer.tipo
      && row.customerType === "privato"
      && allowedNames.has(normalized(row.nome))
      && (!rule.codiceInclude || String(row.codice || "").includes(rule.codiceInclude))
    ));
    if (matches.length !== 1) {
      throw new Error(
        `${offer.nome}: attese una riga ARERA ${commodity}, trovate ${matches.length}`,
      );
    }
    pair[commodity] = matches[0];
  }
  if (pair.luce.providerKey !== pair.gas.providerKey || pair.luce.tipo !== pair.gas.tipo) {
    throw new Error(`${offer.nome}: coppia partner luce/gas incoerente`);
  }
  selected.push({
    id: offer.id,
    partner: offer.provider,
    tipo: offer.tipo,
    luce: { codice: pair.luce.codice, nome: pair.luce.nome, prezzo: pair.luce.prezzo },
    gas: { codice: pair.gas.codice, nome: pair.gas.nome, prezzo: pair.gas.prezzo },
  });
}

if (/"(?:prezzo|quotaFissaAnnua)"\s*:/.test(JSON.stringify(mappings))) {
  throw new Error("La mappatura partner non deve contenere prezzi hardcoded");
}

console.log(JSON.stringify({ ok: true, partnerVerificati: selected.length, offerte: selected }, null, 2));
