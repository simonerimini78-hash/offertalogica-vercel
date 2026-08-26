import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, "..", "public", "index.html"), "utf8");

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

function contractHelpers() {
  const source = between(html, "function formatPdfContractDate", "const PDF_READINESS_FIELD_LABELS");
  return Function("testoHtmlSicuro", `${source}; return { formatPdfContractDate, parsePdfContractIsoDate, pdfContractDateDistanceLabel, pdfContractCheckRow, renderPdfContractControl };`)(String);
}

test("battaglia05: il riepilogo PDF mostra un controllo separato del contratto", () => {
  assert.match(html, /Controllo contratto e condizioni economiche/);
  assert.match(html, /const contractControl = renderPdfContractControl\(merged\)/);
  assert.match(html, /\$\{contractControl\}/);
});

test("battaglia05: condizioni economiche e scadenza contratto restano concetti distinti", () => {
  const check = between(html, "function renderPdfContractControl", "const PDF_READINESS_FIELD_LABELS");
  assert.match(check, /Scadenza condizioni economiche luce/);
  assert.match(check, /Scadenza contratto luce/);
  assert.match(check, /Scadenza condizioni economiche gas/);
  assert.match(check, /Scadenza contratto gas/);
});

test("battaglia05: se una data manca non viene inventata", () => {
  const row = between(html, "function pdfContractCheckRow", "function renderPdfContractControl");
  assert.match(row, /non rilevata nel documento/);
  assert.doesNotMatch(row, /Date\.now\(\).*\+|setDate\(|setMonth\(|setFullYear\(/);
});

test("battaglia05: una data ISO reale può essere mostrata come futura, odierna o trascorsa", () => {
  const distance = between(html, "function pdfContractDateDistanceLabel", "function pdfContractCheckRow");
  assert.match(distance, /diffDays === 0/);
  assert.match(distance, /tra \$\{diffDays\}/);
  assert.match(distance, /trascorsa da \$\{elapsed\}/);
  assert.match(distance, /86400000/);
});

test("battaglia05: il controllo non deduce rinnovi automatici e non introduce API", () => {
  const check = between(html, "function renderPdfContractControl", "const PDF_READINESS_FIELD_LABELS");
  assert.match(check, /non prova un rinnovo automatico/);
  assert.match(check, /OffertaLogica non la stima/);
  assert.doesNotMatch(check, /\bfetch\s*\(/);
  assert.doesNotMatch(check, /\/api\//);
});


test("battaglia05: calcolo relativo delle scadenze è verificato su date note", () => {
  const { pdfContractDateDistanceLabel, renderPdfContractControl } = contractHelpers();
  const now = new Date(2026, 7, 26);
  assert.equal(pdfContractDateDistanceLabel("2026-08-26", now), "oggi");
  assert.equal(pdfContractDateDistanceLabel("2026-08-27", now), "tra 1 giorno");
  assert.equal(pdfContractDateDistanceLabel("2026-09-05", now), "tra 10 giorni");
  assert.equal(pdfContractDateDistanceLabel("2026-08-25", now), "trascorsa da 1 giorno");
  assert.equal(pdfContractDateDistanceLabel("dato non ISO", now), "");
  const rendered = renderPdfContractControl({ commodity: "luce", scadenza_condizioni_economiche_luce: "2026-09-30" });
  assert.match(rendered, /Scadenza condizioni economiche luce: 30\/09\/2026/);
  assert.match(rendered, /Scadenza contratto luce: non rilevata nel documento/);
});
