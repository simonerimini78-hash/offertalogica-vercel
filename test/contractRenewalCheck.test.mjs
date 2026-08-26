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

test("battaglia05 v2: il controllo contratto resta nel modulo privato e business", () => {
  assert.match(html, /id="pdf-contract-control-current" class="pdf-contract-persistent" hidden/);
  assert.match(html, /id="pdf-contract-control-business" class="pdf-contract-persistent" hidden/);
  const updater = between(html, "function aggiornaControlloContrattoPersistente", "const PDF_READINESS_FIELD_LABELS");
  assert.match(updater, /datiBollettaCorrentePdf/);
  assert.match(updater, /LEAD_STATE\.customerType === "business"/);
  assert.match(updater, /renderPdfContractControl\(currentData\)/);
});

test("battaglia05 v2: il controllo persistente viene aggiornato dopo lettura, cambio profilo e rimozione PDF", () => {
  const segment = between(html, "function selezionaSegmentoCliente", "function businessPdfDataRows");
  assert.match(segment, /aggiornaControlloContrattoPersistente\(\)/);
  const direct = between(html, "function applicaRisultatoPdfDirettamente", "function risultatoPdfUtilizzabile");
  assert.ok((direct.match(/aggiornaControlloContrattoPersistente\(\)/g) || []).length >= 2);
  const rebuild = between(html, "function ricostruisciModuloDaSlotPdf", "function classificaLottoPdf");
  assert.match(rebuild, /aggiornaControlloContrattoPersistente\(\)/);
  const reset = between(html, "function resetModuloPrimaDiNuovaLetturaPdf", "function toggleDettagliEconomiciPdf");
  assert.match(reset, /aggiornaControlloContrattoPersistente\(\)/);
  const fullReset = between(html, "window.azzeraPdfEModulo", "function applicaDatiPdfAlModulo");
  assert.match(fullReset, /aggiornaControlloContrattoPersistente\(\)/);
});

test("battaglia05 v2: condizioni economiche e scadenza contratto restano concetti distinti", () => {
  const check = between(html, "function renderPdfContractControl", "function aggiornaControlloContrattoPersistente");
  assert.match(check, /Scadenza condizioni economiche luce/);
  assert.match(check, /Scadenza contratto luce/);
  assert.match(check, /Scadenza condizioni economiche gas/);
  assert.match(check, /Scadenza contratto gas/);
});

test("battaglia05 v2: se una data manca non viene inventata", () => {
  const row = between(html, "function pdfContractCheckRow", "function renderPdfContractControl");
  assert.match(row, /non rilevata nel documento/);
  assert.doesNotMatch(row, /Date\.now\(\).*\+|setDate\(|setMonth\(|setFullYear\(/);
});

test("battaglia05 v2: una data ISO reale può essere mostrata come futura, odierna o trascorsa", () => {
  const distance = between(html, "function pdfContractDateDistanceLabel", "function pdfContractCheckRow");
  assert.match(distance, /diffDays === 0/);
  assert.match(distance, /tra \$\{diffDays\}/);
  assert.match(distance, /trascorsa da \$\{elapsed\}/);
  assert.match(distance, /86400000/);
});

test("battaglia05 v2: il controllo non deduce rinnovi automatici e non introduce API", () => {
  const check = between(html, "function renderPdfContractControl", "function aggiornaControlloContrattoPersistente");
  assert.match(check, /non prova un rinnovo automatico/);
  assert.match(check, /OffertaLogica non la stima/);
  assert.doesNotMatch(check, /\bfetch\s*\(/);
  assert.doesNotMatch(check, /\/api\//);
});

test("battaglia05 v2: le voci economiche sono chiuse di default dietro un pulsante", () => {
  const renderer = between(html, "function renderDettagliAdattiviFornitura", "function renderModuloAdattivoPdf");
  assert.match(renderer, /Vedi voci economiche/);
  assert.match(renderer, /aria-expanded="false"/);
  assert.match(renderer, /adaptive-price-details-body/);
  assert.match(renderer, /hidden>/);
  assert.match(renderer, /toggleDettagliEconomiciPdf\(this\)/);
});

test("battaglia05 v2: il pulsante apre e richiude le voci senza eliminare i valori", () => {
  const toggle = between(html, "function toggleDettagliEconomiciPdf", "function valoreAdattivoPdf");
  assert.match(toggle, /body\.hidden = !willOpen/);
  assert.match(toggle, /Nascondi voci economiche/);
  assert.match(toggle, /Vedi voci economiche/);
  assert.doesNotMatch(toggle, /innerHTML\s*=\s*""/);
});

test("battaglia05 v2: il riepilogo PDF non duplica il controllo persistente", () => {
  const summary = between(html, "function renderPdfSummary", "window.azzeraPdfEModulo");
  assert.doesNotMatch(summary, /const contractControl = renderPdfContractControl/);
  assert.doesNotMatch(summary, /\$\{contractControl\}/);
});

test("battaglia05 v2: calcolo relativo delle scadenze è verificato su date note", () => {
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
