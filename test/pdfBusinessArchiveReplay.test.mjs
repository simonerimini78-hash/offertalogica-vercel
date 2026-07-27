import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const staffHtml = fs.readFileSync(new URL("../public/staff-pdf.html", import.meta.url), "utf8");

function extractFunction(source, name) {
  const candidates = [`async function ${name}(`, `function ${name}(`, `window.${name} = function ${name}(`];
  const start = candidates.map((prefix) => source.indexOf(prefix)).find((index) => index >= 0) ?? -1;
  assert.notEqual(start, -1, `Funzione ${name} non trovata`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Fine funzione ${name} non trovata`);
}

test("business: mostra nel sito tutti gli identificativi già presenti nel response Sorgenia", () => {
  const firstValueSource = extractFunction(html, "firstValue");
  const rowsSource = extractFunction(html, "businessPdfDataRows");
  const rowsFn = new Function(`${firstValueSource}; ${rowsSource}; return businessPdfDataRows;`)();
  const rows = rowsFn({
    commodity: "luce",
    fornitore: "Sorgenia",
    fornitore_luce: "Sorgenia",
    intestatario: "Romagna Allevamenti Societa' Agricola S.S.",
    codice_fiscale: "02525880395",
    codice_cliente: "4615991",
    codice_cliente_luce: "4615991",
    pod: "IT001E53942290",
    indirizzo_fornitura_luce: "VICOLO S. CROCE, 2/A, 48125, RAVENNA (RA)",
    potenza_impegnata_kw: 10,
    potenza_disponibile_kw: 11,
    nome_offerta_luce: "Soluzione Luce Flexi",
    codice_offerta_luce: "SLFLE052012016",
  });
  const values = Object.fromEntries(rows.map((row) => [row.label, String(row.value)]));
  assert.equal(values["Fornitore luce"], "Sorgenia");
  assert.equal(values["Codice cliente"], "4615991");
  assert.equal(values.POD, "IT001E53942290");
  assert.equal(values["Indirizzo luce"], "VICOLO S. CROCE, 2/A, 48125, RAVENNA (RA)");
  assert.equal(values["Potenza impegnata"], "10 kW");
  assert.equal(values["Potenza disponibile"], "11 kW");
  assert.equal(values["Offerta luce"], "Soluzione Luce Flexi");
  assert.equal(values["Codice offerta luce"], "SLFLE052012016");
  assert.equal(rows.filter((row) => row.label.includes("Codice cliente")).length, 1, "il codice comune non deve essere duplicato");
});

test("business: il lead conserva PDF, identificativi e stato reale dell'archivio", () => {
  const profile = extractFunction(html, "leggiProfiloBusiness");
  assert.match(profile, /pdfAnalysisIds/);
  assert.match(profile, /pod: LEAD_STATE\.pdfData\?\.pod/);
  assert.match(profile, /nomeOffertaLuce/);
  assert.match(html, /originalPdfStored: \(LEAD_STATE\.pdfDocuments \|\| \[\]\)\.some/);
  const origin = extractFunction(html, "determinaOrigineDatoLead");
  assert.ok(origin.indexOf("pdfDocuments") < origin.indexOf('customerType === "business"'), "un business con PDF deve risultare di origine pdf_upload");
});

test("archivio staff: riusa il response senza chiamare di nuovo OpenAI", () => {
  const importSource = extractFunction(html, "importaAnalisiPdfDaArchivio");
  const replaySource = extractFunction(staffHtml, "replayAnalysis");
  assert.match(importSource, /PDF_ARCHIVE_REPLAY_STORAGE_KEY/);
  assert.match(html, /offertalogicaPdfArchiveReplay/);
  assert.match(importSource, /Nessuna nuova chiamata IA/);
  assert.doesNotMatch(importSource, /\/api\/analyze-pdf/);
  assert.match(replaySource, /normalized: item\.normalized_data/);
  assert.match(replaySource, /pdfReplay=1/);
  assert.doesNotMatch(replaySource, /\/api\/analyze-pdf/);
});

test("archivio staff: rende revisionabili fornitori e codici cliente specifici", () => {
  assert.match(staffHtml, /"fornitore_luce","fornitore_gas"/);
  assert.match(staffHtml, /"codice_cliente_luce","codice_cliente_gas"/);
  assert.match(staffHtml, /Prova questi dati nel calcolatore/);
  assert.match(staffHtml, /Prove sullo stesso PDF/);
});
