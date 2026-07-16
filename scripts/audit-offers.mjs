import fs from "node:fs";

const root = new URL("../", import.meta.url);

function readJson(path) {
  return JSON.parse(fs.readFileSync(new URL(path, root), "utf8"));
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const catalog = readJson("data/offerte-arera-menu.json");
  const report = readJson("data/arera-update-report.json");
  assert(Number(catalog.schemaVersion) >= 93, "Catalogo ARERA non v93");
  assert(Number(report.schemaVersion) >= 93, "Report ARERA non v93");
  assert(report.offertePrecedentiRipescate === 0, "Il report contiene recuperi selettivi dal catalogo precedente");

  const rows = (report.quarantena || []).map((item) => ({
    codice: item.codiceOfferta || "",
    commodity: item.commodity || "",
    fornitore: item.fornitore || "",
    nome: item.nome || "",
    campo_problematico: item.campoProblematico || "",
    unita: item.unita || "",
    motivi: (item.motivi || [item.motivo]).filter(Boolean).join("; "),
    testo_sorgente: item.testoSorgente || "",
    stato: "quarantena_non_pubblicata",
  }));
  const headers = Object.keys(rows[0] || {
    codice: "", commodity: "", fornitore: "", nome: "", campo_problematico: "",
    unita: "", motivi: "", testo_sorgente: "", stato: "",
  });
  const csv = [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
  fs.writeFileSync(new URL("data/audit-offerte.csv", root), `${csv}\n`);

  const stats = report.statistiche || {};
  const reasons = new Map();
  for (const row of rows) {
    for (const reason of row.motivi.split("; ").filter(Boolean)) {
      reasons.set(reason, (reasons.get(reason) || 0) + 1);
    }
  }
  const summary = [
    "# Audit catalogo ARERA",
    "",
    `Catalogo: ${catalog.versioneDati} (${catalog.aggiornatoIl})`,
    `Pubblicazione atomica: ${report.statoPubblicazioneAtomica}`,
    "",
    `- Offerte ricevute: ${stats.offerteRicevute || 0}`,
    `- Offerte private pubblicate: ${catalog.offerte.length}`,
    `- Offerte business pubblicate: ${catalog.offerteBusiness.length}`,
    `- Offerte in quarantena: ${rows.length}`,
    `- Record precedenti ripescati: ${report.offertePrecedentiRipescate || 0}`,
    "",
    "## Motivi principali",
    "",
    ...[...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([reason, count]) => `- ${reason}: ${count}`),
    "",
    "Il file `data/audit-offerte.csv` e un report di quarantena, non un catalogo prezzi e non alimenta il frontend.",
    "",
  ].join("\n");
  fs.writeFileSync(new URL("docs/AUDIT-OFFERTE.md", root), summary);
  console.log(JSON.stringify({
    ok: true,
    catalog: catalog.versioneDati,
    privateOffers: catalog.offerte.length,
    businessOffers: catalog.offerteBusiness.length,
    quarantined: rows.length,
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
