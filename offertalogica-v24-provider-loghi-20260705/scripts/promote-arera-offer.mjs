import fs from "node:fs";
import path from "node:path";

const root = new URL("../", import.meta.url);
const candidatesPath = new URL("data/arera-candidati-menu.csv", root);
const offersPath = new URL("data/offerte-proposte.json", root);
const publicOffersPath = new URL("public/data/offerte-proposte.json", root);
const certificationPath = new URL("data/certificazione-offerte.csv", root);
const metaPath = new URL("data/arera-sync-meta.json", root);

const CERT_HEADERS = [
  "offerta_id",
  "provider",
  "nome_offerta",
  "commodity",
  "stato_certificazione",
  "fonte_tipo",
  "fonte",
  "fonte_data",
  "codice_offerta",
  "validita_da",
  "validita_a",
  "prezzo_base",
  "prezzo_sconto",
  "prezzo_netto",
  "quota_fissa_annua",
  "unita",
  "link_offerta",
  "note",
];

function read(pathUrl) {
  return fs.readFileSync(pathUrl, "utf8");
}

function readJson(pathUrl) {
  return JSON.parse(read(pathUrl));
}

function writeJson(pathUrl, value) {
  fs.writeFileSync(pathUrl, `${JSON.stringify(value, null, 2)}\n`);
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

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function writeCsv(pathUrl, headers, rows) {
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
  fs.writeFileSync(pathUrl, `${csv}\n`);
}

function parseArgs(argv) {
  const args = { dryRun: false, updateLink: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--update-link") {
      args.updateLink = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Valore mancante per ${arg}`);
      args[key] = value;
      index += 1;
    }
  }
  return args;
}

function usage() {
  return `Uso:
  npm run promote:arera -- --offer-id 11 --luce CODICE_LUCE --gas CODICE_GAS
  npm run promote:arera -- --offer-id 6 --luce CODICE_LUCE

Opzioni:
  --dry-run       Mostra cosa cambierebbe senza scrivere file.
  --update-link   Aggiorna il link live con il link ARERA. Di default conserva link affiliati/partner.
`;
}

function toNumber(value, label) {
  const number = Number(String(value || "").replace(",", "."));
  if (!Number.isFinite(number)) throw new Error(`${label} non numerico: ${value}`);
  return number;
}

function parseAreraDate(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})_(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return "";
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function sourceDateFromFonte(value) {
  const match = String(value || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return new Date().toISOString().slice(0, 10);
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function basenameFromUrl(value) {
  try {
    return path.basename(new URL(value).pathname);
  } catch {
    return "";
  }
}

function sourceFile(meta, commodity) {
  if (commodity === "luce") return basenameFromUrl(meta?.sources?.offerteLuce);
  if (commodity === "gas") return basenameFromUrl(meta?.sources?.offerteGas);
  return "arera-candidati-menu.csv";
}

function nextVersion(current, date) {
  const base = `offerte-proposte-${date}`;
  const match = String(current || "").match(new RegExp(`^${base}-v(\\d+)`));
  if (!match) return `${base}-v1-arera-promotion`;
  return `${base}-v${Number(match[1]) + 1}-arera-promotion`;
}

function commodityUnit(commodity) {
  return commodity === "luce" ? "eur/kWh" : "eur/Smc";
}

function findCandidate(rows, commodity, code) {
  if (!code) return null;
  const row = rows.find((candidate) => (
    candidate.commodity === commodity &&
    candidate.codice_offerta === code
  ));
  if (!row) throw new Error(`Codice ${commodity} non trovato in data/arera-candidati-menu.csv: ${code}`);
  if (row.azione !== "pronta_fisso") {
    throw new Error(`Codice ${commodity} non promuovibile automaticamente: ${row.azione}. Motivo: ${row.motivi || "n.d."}`);
  }
  return row;
}

function buildCommodity(row, commodity) {
  return {
    prezzoVariabile: toNumber(row.prezzo_calcolo, `prezzo ${commodity}`),
    quotaFissaAnnua: toNumber(row.quota_fissa_calcolo, `quota fissa ${commodity}`),
  };
}

function buildCertificationRows(offer, rows, meta, today, linkNote) {
  return rows.map((row) => ({
    offerta_id: offer.id,
    provider: offer.provider,
    nome_offerta: row.nome_offerta,
    commodity: row.commodity,
    stato_certificazione: "certificata",
    fonte_tipo: "portale_offerte_arera_au",
    fonte: sourceFile(meta, row.commodity),
    fonte_data: sourceDateFromFonte(row.fonte),
    codice_offerta: row.codice_offerta,
    validita_da: parseAreraDate(row.data_inizio),
    validita_a: parseAreraDate(row.data_fine),
    prezzo_base: row.prezzo_calcolo,
    prezzo_sconto: "",
    prezzo_netto: row.prezzo_calcolo,
    quota_fissa_annua: row.quota_fissa_calcolo,
    unita: commodityUnit(row.commodity),
    link_offerta: row.url_offerta,
    note: `Promossa nel JSON pubblico il ${today} con scripts/promote-arera-offer.mjs. ${linkNote}`,
  }));
}

function updateCertificationCsv(offer, promotedRows, meta, today, linkNote) {
  const existing = fs.existsSync(certificationPath) ? readCsv(certificationPath) : [];
  const commodities = new Set(promotedRows.map((row) => row.commodity));
  const filtered = existing.filter((row) => !(
    String(row.offerta_id) === String(offer.id) &&
    row.fonte_tipo === "portale_offerte_arera_au" &&
    commodities.has(row.commodity)
  ));
  const additions = buildCertificationRows(offer, promotedRows, meta, today, linkNote);
  writeCsv(certificationPath, CERT_HEADERS, [...filtered, ...additions]);
}

function buildFonte(rows) {
  const date = sourceDateFromFonte(rows[0]?.fonte);
  const details = rows
    .map((row) => `${row.nome_offerta} ${row.codice_offerta}`)
    .join(" + ");
  return `Certificata da Portale Offerte ARERA/AU open data ${date}: ${details}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.offerId || (!args.luce && !args.gas)) {
    console.error(usage());
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const candidates = readCsv(candidatesPath);
  const offersData = readJson(offersPath);
  const meta = fs.existsSync(metaPath) ? readJson(metaPath) : {};
  const offer = offersData.offerte.find((item) => String(item.id) === String(args.offerId));
  if (!offer) throw new Error(`Offerta live non trovata: id ${args.offerId}`);

  const promotedRows = [
    findCandidate(candidates, "luce", args.luce),
    findCandidate(candidates, "gas", args.gas),
  ].filter(Boolean);

  const providerKeys = new Set(promotedRows.map((row) => row.menu_provider_key).filter(Boolean));
  if (providerKeys.size > 1) {
    throw new Error(`Le righe scelte appartengono a fornitori diversi: ${[...providerKeys].join(", ")}`);
  }

  const before = JSON.parse(JSON.stringify(offer));
  const luce = promotedRows.find((row) => row.commodity === "luce");
  const gas = promotedRows.find((row) => row.commodity === "gas");

  if (luce) offer.luce = buildCommodity(luce, "luce");
  if (gas) offer.gas = buildCommodity(gas, "gas");
  if (!luce) offer.luce = null;
  if (!gas) offer.gas = null;
  offer.tipo = "fisso";
  offer.fornitura = luce && gas ? "dual" : "separate";
  offer.fonte = buildFonte(promotedRows);
  offer.aggiornataIl = today;
  offer.certificazione = {
    stato: "certificata",
    fonte: "portale_offerte_arera_au",
    dataFonte: sourceDateFromFonte(promotedRows[0]?.fonte),
    validita: `${parseAreraDate(promotedRows[0]?.data_inizio)}/${parseAreraDate(promotedRows[0]?.data_fine)}`,
    codici: Object.fromEntries(promotedRows.map((row) => [row.commodity, row.codice_offerta])),
    note: "Promossa da data/arera-candidati-menu.csv. Le offerte variabili e le righe ambigue restano escluse dalla promozione automatica.",
  };

  const linkNote = args.updateLink
    ? "Link live aggiornato con URL ARERA."
    : "Link live commerciale preservato.";
  if (args.updateLink && promotedRows[0]?.url_offerta) {
    offer.link = promotedRows[0].url_offerta;
  }

  offersData.aggiornatoIl = today;
  offersData.versioneDati = nextVersion(offersData.versioneDati, today);
  offersData.fonte = "Configurazione OffertaLogica aggiornata da shortlist ARERA/AU controllata; offerte live promosse solo da righe pronte e verificate.";

  const summary = {
    ok: true,
    dryRun: args.dryRun,
    offerId: offer.id,
    provider: offer.provider,
    nome: offer.nome,
    before: {
      luce: before.luce,
      gas: before.gas,
      fonte: before.fonte,
      link: before.link,
    },
    after: {
      luce: offer.luce,
      gas: offer.gas,
      fonte: offer.fonte,
      link: offer.link,
      versioneDati: offersData.versioneDati,
    },
    promotedCodes: promotedRows.map((row) => ({
      commodity: row.commodity,
      codice: row.codice_offerta,
      nome: row.nome_offerta,
    })),
  };

  if (args.dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  writeJson(offersPath, offersData);
  writeJson(publicOffersPath, offersData);
  updateCertificationCsv(offer, promotedRows, meta, today, linkNote);

  console.log(JSON.stringify(summary, null, 2));
}

main();
