import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
const start = html.indexOf('const PDF_VISUAL_READING_PANEL_VERSION = "v106.5-visual-observation-panel-1";');
const end = html.indexOf("function renderPdfSummary(documents, merged) {", start);
assert.notEqual(start, -1, "blocco pannello visuale assente");
assert.notEqual(end, -1, "fine blocco pannello visuale assente");

const source = `${html.slice(start, end)}\nglobalThis.__collectVisual = collectPdfVisualReadingEntries;\nglobalThis.__renderVisual = renderPdfVisualReadingPanels;`;
const context = vm.createContext({
  testoHtmlSicuro(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  },
});
vm.runInContext(source, context);

function visualDocument() {
  return {
    filename: "sorgenia 2.pdf",
    commodity: "unknown",
    kind: "unknown",
    ai: {
      applied: true,
      field_meta: {
        fornitore: {
          field: "fornitore",
          value: "Sorgenia",
          confidence: 95,
          page: 1,
          evidence: "Sorgenia logo and name",
        },
        pod: {
          field: "pod",
          value: "IT001E53942290",
          confidence: 95,
          page: 1,
          evidence: "POD IT001E53942290",
        },
      },
      rejected_fields: [
        {
          field: "consumo_luce_kwh",
          value: 4084,
          unit: "kWh",
          confidence: 90,
          page: 1,
          label: "Consumi fatturati",
          reason: "value_or_unit_not_safe",
        },
        {
          field: "prezzo_luce_eur_kwh",
          value: 0.15,
          unit: "€/kWh",
          confidence: 85,
          page: 2,
          reason: "confidence_below_threshold",
        },
        {
          field: "totale_fattura",
          value: 1143.4,
          unit: "€",
          confidence: 95,
          page: 1,
          reason: "unknown_field",
        },
        {
          field: "intestatario",
          reason: "conflicting_ai_values",
        },
      ],
    },
  };
}

test("il pannello mostra sia i dati AI accettati sia le osservazioni non usate dal modulo", () => {
  const entries = context.__collectVisual(visualDocument());
  assert.equal(entries.some((entry) => entry.field === "fornitore" && entry.accepted), true);
  assert.equal(entries.some((entry) => entry.field === "pod" && entry.accepted), true);
  assert.equal(entries.some((entry) => entry.field === "consumo_luce_kwh" && !entry.accepted && entry.value === "4084 kWh"), true);
  assert.equal(entries.some((entry) => entry.field === "prezzo_luce_eur_kwh" && !entry.accepted), true);
  assert.equal(entries.some((entry) => entry.field === "totale_fattura" && !entry.accepted), true);
  assert.equal(entries.some((entry) => entry.field === "intestatario"), false, "un conflitto privo di valore non deve produrre una tessera vuota");
});

test("il riquadro dichiara che la lettura è solo osservativa e da verificare", () => {
  const rendered = context.__renderVisual([visualDocument()]);
  assert.match(rendered, /Dati letti dalla fotografia — da verificare/);
  assert.match(rendered, /Nessun elemento di questo riquadro viene inserito automaticamente nel modulo/);
  assert.match(rendered, /Sorgenia/);
  assert.match(rendered, /IT001E53942290/);
  assert.match(rendered, /4084 kWh/);
  assert.match(rendered, /0\.15 €\/kWh/);
  assert.match(rendered, /1143\.4 €/);
  assert.match(rendered, /pagina 1/);
  assert.match(rendered, /confidenza 95%/);
  assert.match(rendered, /is-observation/);
});

test("la visualizzazione non modifica il documento o il contratto di autofill", () => {
  const doc = visualDocument();
  doc.data_contract = {
    autofill_plan: {
      review_fields: [{ source_field: "pod", value: "IT001E53942290" }],
    },
  };
  const before = JSON.stringify(doc);
  context.__renderVisual([doc]);
  assert.equal(JSON.stringify(doc), before);
});

test("lo Step 8.5 è limitato al pannello di lettura e mantiene separate le osservazioni", () => {
  assert.match(html, /v106\.5-visual-observation-panel-1/);
  assert.match(html, /renderPdfVisualReadingPanels\(documents\)/);
  assert.match(html, /pdf-visual-reading-item\.is-observation/);
  assert.match(html, /compresi i valori che non sono adatti ai campi del comparatore/);
});
