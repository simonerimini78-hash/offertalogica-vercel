import fs from "node:fs";

const root = new URL("../", import.meta.url);
const inputPath = new URL("data/offerte-reali-arera-candidati.csv", root);
const menuCandidatesPath = new URL("data/arera-candidati-menu.csv", root);
const outputPath = new URL("data/arera-shortlist-manutenzione.csv", root);
const menuHtmlPath = new URL("index.html", root);

const FUORI_PERIMETRO = [
  "business",
  "azienda",
  "aziende",
  "pmi",
  "corporate",
  "condominio",
  "condomini",
  "partita iva",
  "professionisti",
  "microbusiness",
  "hotel",
  "pubblica amministrazione",
  "vacanze",
];

const MENU_ALIAS_OVERRIDES = {
  a2a: ["a2a", "a2a energia", "a2aenergia", "casa.a2aenergia"],
  acea: ["acea", "acea energia", "aceaenergia"],
  agasco: ["agasco"],
  alperia: ["alperia"],
  amga: ["amga"],
  argos: ["argos"],
  axpo: ["axpo", "axpo energia"],
  dolomiti: ["dolomiti", "dolomiti energia", "dolomitienergia"],
  eon: ["eon", "e.on", "e.on energia", "eon energia", "eon-energia", "eonenergia"],
  edison: ["edison", "edison energia", "edisonenergia"],
  eni: ["eni plenitude", "eniplenitude", "plenitude"],
  enel: ["enel", "enel energia", "enelenergia"],
  enercom: ["enercom"],
  engie: ["engie"],
  eja: ["eja", "eja energia"],
  hera: ["hera", "hera comm", "heracomm", "gruppohera"],
  illum: ["illumia", "illum"],
  iren: ["iren", "iren luce e gas", "iren mercato"],
  magis: ["magis", "magis energia", "magisenergia"],
  nen: ["nen", "nen.it"],
  nova: ["nova aeg", "novaaeg", "nova-aeg"],
  octopus: ["octopus", "octopus energy", "octopusenergy"],
  optima: ["optima", "optima italia", "optimaitalia"],
  poste: ["poste", "poste energia", "posteenergia"],
  pulsee: ["pulsee", "pulsee luce e gas"],
  sen: ["servizio elettrico nazionale", "servizioelettriconazionale"],
  sorgenia: ["sorgenia"],
  tate: ["tate"],
  vivi: ["vivi", "vivi energia", "vivienergia"],
  wekiwi: ["wekiwi"],
  sinergy: ["sinergy"],
};

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readMenuProviders() {
  const html = read(menuHtmlPath);
  const selectMatch = html.match(/<select[^>]+id="nome-fornitore-att"[\s\S]*?<\/select>/i);
  const selectHtml = selectMatch ? selectMatch[0] : html;
  const providers = [];
  for (const match of selectHtml.matchAll(/<option\s+value="([^"]+)"[^>]*>([\s\S]*?)<\/option>/gi)) {
    const key = match[1].trim();
    const label = match[2].replace(/<[^>]*>/g, "").trim();
    if (!key || key === "altro") continue;
    providers.push({
      key,
      label,
      aliases: [...new Set([label, key, ...(MENU_ALIAS_OVERRIDES[key] || [])].map(normalizeText).filter(Boolean))],
    });
  }
  return providers;
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

function readCsv(path) {
  const lines = read(path).trim().split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));
  });
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function toNumber(value) {
  const number = Number(String(value || "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function parseAreraDate(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})_(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, day, month, year, hour, minute, second] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+02:00`);
}

function isActive(row, today = new Date()) {
  const start = parseAreraDate(row.data_inizio);
  const end = parseAreraDate(row.data_fine);
  if (start && today < start) return false;
  if (end && today > end) return false;
  return true;
}

function fuoriPerimetro(row) {
  const text = [
    row.nome_offerta,
    row.url_offerta,
    row.codice_offerta,
  ].join(" ").toLowerCase();
  return FUORI_PERIMETRO.find((word) => text.includes(word)) || "";
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function classificazione(row) {
  const motivi = [];
  const prezzo = toNumber(row.prezzo_calcolo);
  const quota = toNumber(row.quota_fissa_calcolo);
  const active = isActive(row);
  const fuori = fuoriPerimetro(row);
  const utilizzabile = String(row.utilizzabile_calcolatore || "").toLowerCase() === "si";

  if (!utilizzabile) motivi.push("non utilizzabile direttamente");
  if (!active) motivi.push("fuori validita alla data di esecuzione");
  if (fuori) motivi.push(`fuori perimetro domestico: ${fuori}`);
  if (!isHttpUrl(row.url_offerta)) motivi.push("link non assoluto");
  if (prezzo === null) motivi.push("prezzo_calcolo mancante o ambiguo");
  if (quota === null) motivi.push("quota_fissa_calcolo mancante o ambigua");

  if (motiBloccanti(motivi)) return { azione: "scartata", motivi, prezzo, quota };
  if (row.tipo_prezzo === "variabile") {
    return {
      azione: "richiede_indice_pun_psv",
      motivi: ["serve formula indice + spread e PUN/PSV valorizzati"],
      prezzo,
      quota,
    };
  }
  if (row.tipo_prezzo === "fisso") return { azione: "pronta_fisso", motivi: ["prezzo fisso domestico leggibile"], prezzo, quota };
  return { azione: "da_verificare", motivi: ["tipo prezzo non riconosciuto"], prezzo, quota };
}

function matchMenuProvider(row, menuProviders) {
  const haystack = normalizeText([
    row.provider_key,
    row.fornitore,
    row.nome_offerta,
    row.codice_offerta,
    row.url_offerta,
  ].join(" "));

  return menuProviders.find((provider) => (
    provider.aliases.some((alias) => {
      if (!alias) return false;
      if (alias.length <= 3) {
        return new RegExp(`(^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(haystack);
      }
      return haystack.includes(alias);
    })
  )) || null;
}

function motiBloccanti(motivi) {
  return motivi.some((motivo) => (
    motivo.startsWith("non utilizzabile") ||
    motivo.startsWith("fuori validita") ||
    motivo.startsWith("fuori perimetro") ||
    motivo.startsWith("prezzo_calcolo") ||
    motivo.startsWith("quota_fissa")
  ));
}

function score(row, status) {
  let value = 0;
  if (status.azione === "pronta_fisso") value += 100;
  if (status.azione === "richiede_indice_pun_psv") value += 80;
  if (row.commodity === "luce") value += 5;
  if (row.commodity === "gas") value += 4;
  if (/luce.?gas|gas.?luce|dual/i.test(row.nome_offerta)) value += 8;
  if (isHttpUrl(row.url_offerta)) value += 2;
  value -= Number(status.quota || 0) / 1000;
  value -= Number(status.prezzo || 0) / 10;
  return value;
}

function main() {
  const menuProviders = readMenuProviders();
  const rows = readCsv(inputPath);
  const evaluated = rows.map((row) => {
    const status = classificazione(row);
    const menuProvider = matchMenuProvider(row, menuProviders);
    return {
      menu_provider_key: menuProvider ? menuProvider.key : "",
      menu_provider_label: menuProvider ? menuProvider.label : "",
      provider_key: row.provider_key,
      fornitore: row.fornitore,
      commodity: row.commodity,
      tipo_prezzo: row.tipo_prezzo,
      nome_offerta: row.nome_offerta,
      codice_offerta: row.codice_offerta,
      data_inizio: row.data_inizio,
      data_fine: row.data_fine,
      prezzo_calcolo: row.prezzo_calcolo,
      quota_fissa_calcolo: row.quota_fissa_calcolo,
      azione: status.azione,
      motivi: status.motivi.join("; "),
      url_offerta: row.url_offerta,
      fonte: row.fonte,
      score: score(row, status).toFixed(3),
    };
  });

  const shortlisted = evaluated
    .filter((row) => row.azione !== "scartata" && row.menu_provider_key)
    .sort((a, b) => Number(b.score) - Number(a.score) || a.fornitore.localeCompare(b.fornitore))
    .slice(0, 80);
  const menuCandidates = evaluated
    .filter((row) => row.menu_provider_key)
    .sort((a, b) => (
      a.menu_provider_label.localeCompare(b.menu_provider_label) ||
      a.commodity.localeCompare(b.commodity) ||
      a.nome_offerta.localeCompare(b.nome_offerta) ||
      a.codice_offerta.localeCompare(b.codice_offerta)
    ));

  const headers = [
    "menu_provider_key",
    "menu_provider_label",
    "provider_key",
    "fornitore",
    "commodity",
    "tipo_prezzo",
    "nome_offerta",
    "codice_offerta",
    "data_inizio",
    "data_fine",
    "prezzo_calcolo",
    "quota_fissa_calcolo",
    "azione",
    "motivi",
    "url_offerta",
    "fonte",
    "score",
  ];
  const shortlistCsv = [
    headers.join(","),
    ...shortlisted.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
  const menuCsv = [
    headers.join(","),
    ...menuCandidates.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
  fs.writeFileSync(outputPath, `${shortlistCsv}\n`);
  fs.writeFileSync(menuCandidatesPath, `${menuCsv}\n`);

  const counts = evaluated.reduce((acc, row) => {
    acc[row.azione] = (acc[row.azione] || 0) + 1;
    if (row.menu_provider_key) {
      acc.menuMatchedRows = (acc.menuMatchedRows || 0) + 1;
      acc[`menu_${row.menu_provider_key}`] = (acc[`menu_${row.menu_provider_key}`] || 0) + 1;
    }
    return acc;
  }, { menuProviders: menuProviders.length, menuMatchedRows: 0 });
  console.log(JSON.stringify({
    ok: true,
    candidateRows: rows.length,
    menuCandidatesRows: menuCandidates.length,
    shortlistedRows: shortlisted.length,
    output: "data/arera-shortlist-manutenzione.csv",
    menuOutput: "data/arera-candidati-menu.csv",
    counts,
  }, null, 2));
}

main();
