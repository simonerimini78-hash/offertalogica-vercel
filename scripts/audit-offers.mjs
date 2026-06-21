import fs from "node:fs";

const root = new URL("../", import.meta.url);

function read(path) {
  return fs.readFileSync(new URL(path, root), "utf8");
}

function readJson(path) {
  return JSON.parse(read(path));
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      result.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  result.push(current);
  return result;
}

function readCsv(path) {
  const lines = read(path).trim().split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));
  });
}

function money(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

function statusForOffer(offer, destination) {
  const issues = [];
  const checks = [];
  const commodities = [];
  if (offer.luce) commodities.push("luce");
  if (offer.gas) commodities.push("gas");

  if (offer.fornitura === "dual" && commodities.length !== 2) {
    issues.push("Dual fuel senza entrambe le commodity");
  }
  if (offer.fornitura === "separate" && commodities.length === 2) {
    checks.push("Fornitura separate con luce e gas entrambe presenti: verificare se e bundle reale o due offerte separate");
  }
  if (offer.tipo === "variabile") {
    const hasFormula = commodities.some((commodity) => offer[commodity]?.formula?.tipo === "indice_spread");
    if (!hasFormula) checks.push("Variabile senza formula PUN/PSV esplicita: oggi usa prezzo di calcolo statico");
  }
  for (const commodity of commodities) {
    const voce = offer[commodity];
    if (Number(voce.prezzoVariabile) <= 0) issues.push(`${commodity}: prezzo non positivo`);
    if (Number(voce.quotaFissaAnnua) < 0) issues.push(`${commodity}: quota fissa negativa`);
  }
  if (!offer.fonte || /da verificare/i.test(offer.fonte)) {
    checks.push("Fonte tariffaria da verificare con scheda sintetica o fonte ufficiale");
  }
  if (!destination) {
    checks.push("Destinazione monetizzazione mancante in data/destinazioni-offerte.csv");
  } else {
    if (destination.stato === "da_cercare" || destination.stato === "in_attesa_approvazione") {
      checks.push(`Monetizzazione non attiva: ${destination.stato}`);
    }
    if (!destination.link_tracking) {
      checks.push("Link tracking non configurato");
    }
  }

  const priority = issues.length ? "bloccante" : checks.length >= 3 ? "alta" : checks.length ? "media" : "bassa";
  const status = issues.length ? "non_pubblicare" : checks.length ? "da_verificare" : "coerente";

  return { issues, checks, priority, status };
}

function main() {
  const offersData = readJson("data/offerte-proposte.json");
  const destinations = readCsv("data/destinazioni-offerte.csv");
  const destinationById = new Map(destinations.map((row) => [String(row.offerta_id), row]));
  const rows = [];

  for (const offer of offersData.offerte) {
    const destination = destinationById.get(String(offer.id));
    const audit = statusForOffer(offer, destination);
    const commodities = [
      offer.luce ? `luce ${offer.luce.prezzoVariabile} eur/kWh fisso ${money(offer.luce.quotaFissaAnnua)}` : "",
      offer.gas ? `gas ${offer.gas.prezzoVariabile} eur/Smc fisso ${money(offer.gas.quotaFissaAnnua)}` : "",
    ].filter(Boolean).join(" | ");

    rows.push({
      id: offer.id,
      provider: offer.provider,
      nome: offer.nome,
      tipo: offer.tipo,
      fornitura: offer.fornitura,
      commodities,
      stato_audit: audit.status,
      priorita_verifica: audit.priority,
      problemi: audit.issues.join("; "),
      verifiche: audit.checks.join("; "),
      monetizzazione: destination ? `${destination.tipo_destinazione}/${destination.network_partner}/${destination.stato}` : "mancante",
      fonte: offer.fonte || "",
    });
  }

  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => `"${String(row[header] ?? "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  fs.writeFileSync(new URL("data/audit-offerte.csv", root), `${csv}\n`);

  const high = rows.filter((row) => row.priorita_verifica === "alta" || row.priorita_verifica === "bloccante");
  const summary = [
    "# Audit offerte proposte",
    "",
    "Aggiornamento: 2026-06-21",
    "",
    `Offerte analizzate: ${rows.length}`,
    "",
    "## Risultato sintetico",
    "",
    "```text",
    `Coerenti senza rilievi: ${rows.filter((row) => row.stato_audit === "coerente").length}`,
    `Da verificare: ${rows.filter((row) => row.stato_audit === "da_verificare").length}`,
    `Non pubblicare: ${rows.filter((row) => row.stato_audit === "non_pubblicare").length}`,
    "```",
    "",
    "## Priorita alte",
    "",
    high.length
      ? high.map((row) => `- ${row.id} ${row.provider} - ${row.nome}: ${row.verifiche || row.problemi}`).join("\n")
      : "- Nessuna priorita alta o bloccante.",
    "",
    "## Regole applicate",
    "",
    "- Le offerte dual fuel devono contenere luce e gas.",
    "- Le offerte solo luce o solo gas possono restare `separate`, ma vengono confrontate solo sulla commodity corretta.",
    "- Le offerte variabili dovrebbero usare una formula PUN/PSV esplicita, non solo un prezzo statico.",
    "- Le offerte senza fonte ufficiale o scheda sintetica restano da verificare.",
    "- Le offerte senza link tracking o accordo partner non sono ancora monetizzabili.",
    "",
    "## File operativo",
    "",
    "```text",
    "data/audit-offerte.csv",
    "```",
    "",
    "Usare questo CSV come checklist prima di promuovere un'offerta tra le prime 3 definitive.",
    "",
  ].join("\n");
  fs.writeFileSync(new URL("docs/AUDIT-OFFERTE.md", root), summary);

  console.log(JSON.stringify({
    ok: true,
    offerteAnalizzate: rows.length,
    coerenti: rows.filter((row) => row.stato_audit === "coerente").length,
    daVerificare: rows.filter((row) => row.stato_audit === "da_verificare").length,
    nonPubblicare: rows.filter((row) => row.stato_audit === "non_pubblicare").length,
  }, null, 2));
}

main();
