import fs from "node:fs";

const root = new URL("../", import.meta.url);
const inputPath = new URL("data/arera-candidati-menu.csv", root);
const dataOutputPath = new URL("data/offerte-arera-menu.json", root);
const publicOutputPath = new URL("public/data/offerte-arera-menu.json", root);

function read(pathUrl) {
  return fs.readFileSync(pathUrl, "utf8");
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function readCsv(pathUrl) {
  const text = read(pathUrl).trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));
  });
}

function toNumber(value) {
  const number = Number(String(value || "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function sourceDate(value) {
  const match = String(value || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return new Date().toISOString().slice(0, 10);
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

const rows = readCsv(inputPath)
  .filter((row) => row.azione === "pronta_fisso")
  .map((row) => ({
    providerKey: row.menu_provider_key,
    providerLabel: row.menu_provider_label,
    fornitore: row.fornitore,
    commodity: row.commodity,
    tipo: row.tipo_prezzo,
    nome: row.nome_offerta,
    codice: row.codice_offerta,
    dataInizio: row.data_inizio,
    dataFine: row.data_fine,
    prezzo: toNumber(row.prezzo_calcolo),
    quotaFissaAnnua: toNumber(row.quota_fissa_calcolo),
    url: row.url_offerta,
    fonte: row.fonte,
    score: toNumber(row.score),
  }))
  .filter((row) => row.providerKey && row.commodity && row.tipo && row.prezzo !== null && row.quotaFissaAnnua !== null)
  .sort((a, b) => (
    a.providerKey.localeCompare(b.providerKey) ||
    a.commodity.localeCompare(b.commodity) ||
    (a.score ?? 999) - (b.score ?? 999)
  ));

const payload = {
  versioneDati: `offerte-arera-menu-${sourceDate(rows[0]?.fonte)}-fixed-ready`,
  fonte: "Estratto leggero da data/arera-candidati-menu.csv: solo offerte ARERA/AU con prezzo e quota fissa leggibili e azione pronta_fisso.",
  aggiornatoIl: sourceDate(rows[0]?.fonte),
  offerte: rows,
};

fs.writeFileSync(dataOutputPath, `${JSON.stringify(payload, null, 2)}\n`);
fs.writeFileSync(publicOutputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, offerte: rows.length, output: ["data/offerte-arera-menu.json", "public/data/offerte-arera-menu.json"] }, null, 2));
