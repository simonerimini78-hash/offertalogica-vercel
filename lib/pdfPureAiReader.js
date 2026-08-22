import fs from "node:fs/promises";
import { applyPdfDataContract } from "./pdfDataContract.js";
import { applyPdfFieldValidation } from "./pdfFieldValidation.js";

export const PDF_PURE_AI_READER_VERSION = "pure-ai-native-pdf-v2.0.7-annual-consumption-evidence";
export const PDF_PURE_AI_DEFAULT_MODEL = "gpt-4.1-2025-04-14";
export const PDF_PURE_AI_QUESTION_IDS = Object.freeze([
  "fornitore",
  "fornitore_luce",
  "fornitore_gas",
  "customer_type",
  "intestatario",
  "codice_fiscale",
  "codice_cliente",
  "codice_cliente_luce",
  "codice_cliente_gas",
  "indirizzo_fornitura_luce",
  "pod",
  "potenza_impegnata_kw",
  "potenza_disponibile_kw",
  "consumo_luce_kwh",
  "consumo_luce_f1_kwh",
  "consumo_luce_f2_kwh",
  "consumo_luce_f3_kwh",
  "consumo_luce_f23_kwh",
  "prezzo_luce_eur_kwh",
  "prezzo_luce_f0_eur_kwh",
  "prezzo_luce_f1_eur_kwh",
  "prezzo_luce_f2_eur_kwh",
  "prezzo_luce_f3_eur_kwh",
  "prezzo_luce_f23_eur_kwh",
  "quota_fissa_vendita_luce",
  "nome_offerta_luce",
  "codice_offerta_luce",
  "tipo_prezzo_luce",
  "indice_riferimento_luce",
  "spread_luce_eur_kwh",
  "moltiplicatore_indice_luce",
  "periodicita_aggiornamento_indice_luce",
  "struttura_prezzo_luce",
  "formula_prezzo_luce",
  "decorrenza_condizioni_economiche_luce",
  "scadenza_condizioni_economiche_luce",
  "indirizzo_fornitura_gas",
  "pdr",
  "consumo_gas_smc",
  "prezzo_gas_eur_smc",
  "quota_fissa_vendita_gas",
  "nome_offerta_gas",
  "codice_offerta_gas",
  "tipo_prezzo_gas",
  "indice_riferimento_gas",
  "spread_gas_eur_smc",
  "moltiplicatore_indice_gas",
  "periodicita_aggiornamento_indice_gas",
  "formula_prezzo_gas",
  "decorrenza_condizioni_economiche_gas",
  "scadenza_condizioni_economiche_gas"
]);
export const PDF_PURE_AI_REQUEST_QUESTION_IDS = Object.freeze([]);

const REQUEST_PROFILE = "ia_libera_compact_form_v3_4";
const FIELD_PURPOSES = Object.freeze([
  "annual_consumption", "period_consumption", "band_consumption", "unit_price", "band_price", "price_component",
  "fixed_fee", "price_type", "price_structure", "index", "spread", "multiplier", "formula",
  "power_committed", "power_available", "periodicity", "conditions_start", "conditions_end", "other",
]);

const REQUEST_FIELD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["purpose", "label", "value_text", "value_number", "unit", "period", "band", "page"],
  properties: {
    purpose: { type: "string", enum: FIELD_PURPOSES },
    label: { type: "string", minLength: 1, maxLength: 120 },
    value_text: { type: ["string", "null"], maxLength: 240 },
    value_number: { type: ["number", "null"] },
    unit: { type: ["string", "null"], maxLength: 40 },
    period: { type: "string", enum: ["none", "month", "year"] },
    band: { type: "string", enum: ["none", "f0", "f1", "f2", "f3", "f23"] },
    page: { type: ["integer", "null"], minimum: 1 },
  },
};

const REQUEST_SUPPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["commodity", "provider", "offer_name", "offer_code", "fields"],
  properties: {
    commodity: { type: "string", enum: ["electricity", "gas"] },
    provider: { type: ["string", "null"], maxLength: 240 },
    offer_name: { type: ["string", "null"], maxLength: 300 },
    offer_code: { type: ["string", "null"], maxLength: 180 },
    fields: { type: "array", minItems: 0, maxItems: 24, items: REQUEST_FIELD_SCHEMA },
  },
};

const REQUEST_ALERT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["code", "title", "description", "severity", "page"],
  properties: {
    code: { type: "string", enum: ["conguaglio", "variazione_prezzo", "quota_inattesa", "sconto_mancante", "penale", "doppio_addebito", "scadenza_condizioni", "importo_inusuale", "altro"] },
    title: { type: "string", minLength: 1, maxLength: 140 },
    description: { type: "string", minLength: 1, maxLength: 500 },
    severity: { type: "string", enum: ["low", "medium", "high"] },
    page: { type: ["integer", "null"], minimum: 1 },
  },
};

const REQUEST_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["document", "supplies"],
  properties: {
    document: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "commodity", "customer_type", "page_count", "billing_period_start", "billing_period_end", "issue_date", "due_date", "total_amount_eur", "alerts"],
      properties: {
        kind: { type: "string", enum: ["bill", "offer_sheet", "unknown"] },
        commodity: { type: "string", enum: ["electricity", "gas", "dual", "unknown"] },
        customer_type: { type: "string", enum: ["consumer", "business", "unknown"] },
        page_count: { type: ["integer", "null"], minimum: 1 },
        billing_period_start: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        billing_period_end: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        issue_date: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        due_date: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        total_amount_eur: { type: ["number", "null"], minimum: 0 },
        alerts: { type: "array", minItems: 0, maxItems: 8, items: REQUEST_ALERT_SCHEMA },
      },
    },
    supplies: { type: "array", minItems: 0, maxItems: 2, items: REQUEST_SUPPLY_SCHEMA },
  },
};

const SYSTEM_PROMPT = `Leggi integralmente il PDF e compila direttamente il modulo economico, come farebbe una persona.

Nel blocco document estrai anche: importo totale da pagare in euro, data emissione, scadenza e periodo fatturato. Usa date ISO YYYY-MM-DD e null quando il dato non è leggibile. L’importo deve essere il totale finale della bolletta, non un subtotale.

Nel campo alerts segnala soltanto elementi espliciti nel PDF che meritano un approfondimento umano: conguagli o ricalcoli, variazioni di prezzo dichiarate, quote inattese, sconti dichiarati ma non applicati, penali, possibili doppi addebiti, condizioni economiche in scadenza o altri elementi chiaramente motivati. Una scadenza delle condizioni economiche deve diventare alert solo quando è già trascorsa oppure dista al massimo 30 giorni dalla data corrente; se è più lontana estrai comunque la data, ma non classificarla come anomalia. Non inventare anomalie e non usare alerts per semplici dati mancanti. Ogni alert deve indicare pagina ed evidenza sintetica.

Per ogni fornitura luce o gas restituisci solo le righe realmente utili al confronto.

PRIORITÀ ASSOLUTA: prima di completare una fornitura, cerca in tutto il PDF i tre dati minimi del confronto: (1) consumo annuo/ultimi 12 mesi, (2) prezzo unitario della sola vendita o materia energia/gas, (3) quota fissa della sola vendita/commercializzazione. Se il consumo annuo non è presente, cerca e restituisci comunque il consumo totale del periodo fatturato come period_consumption: servirà allo storico della stessa utenza e non deve essere confuso con un consumo annuo. Se uno di questi dati è presente nel documento non ometterlo, anche quando compare nello Scontrino dell'energia, nel Box dell'offerta o negli Elementi di dettaglio. Non sostituire mai il consumo annuo con il consumo del periodo e non sostituire mai il prezzo vendita con quota consumi totale, rete, oneri, imposte o IVA.

- annual_consumption: consumo annuo o ultimi 12 mesi;
- period_consumption: consumo totale effettivamente fatturato nel periodo indicato nel blocco document. Usalo quando è esplicito, anche se annual_consumption è assente. Deve essere il totale dell’intero periodo di fatturazione per quella fornitura, non una singola fascia, un giorno o un sotto-periodo tariffario;
- band_consumption: consumo annuo F1/F2/F3/F23;
- unit_price: prezzo unitario della vendita mostrato esplicitamente nel documento. Se lo “Scontrino dell’energia” espone il prezzo medio della vendita, restituiscilo come unit_price anche quando comprende più componenti commerciali: servirà come controllo aritmetico, non come prova che sia già omogeneo alle nuove offerte;
- band_price: prezzo finale F0/F1/F2/F3/F23;
- price_component: restituisci tutte le componenti unitarie necessarie a ricostruire il prezzo commerciale e a separare la sola materia confrontabile. In particolare non omettere il corrispettivo materia/consumo energia o gas, spread, C.DISP.D./dispacciamento o componenti analoghe del venditore, sconti/riduzioni unitari, perdite e componenti legate a PCS/potere calorifico o coefficienti di conversione quando sono esplicite. Mantieni sempre l'etichetta originale e il segno del valore;
- fixed_fee: quota fissa della vendita/commercializzazione, con segno e periodicità originali;
- price_type: soltanto fisso, variabile/indicizzato o ibrido;
- price_structure: soltanto monoraria, bioraria, multioraria o per fasce;
- formula: espressione o testo che descrive come si forma il prezzo; copia anche i riferimenti a sconti, C.DISP.D., perdite, PCS/potere calorifico e coefficienti quando fanno parte della formula;
- index, spread, multiplier, periodicity. Usa multiplier quando il documento espone un moltiplicatore numerico della componente indice/materia, compresi coefficienti legati a PCS o conversione;
- power_committed e power_available per la luce;
- conditions_start: data di decorrenza/inizio delle condizioni economiche, soltanto se esplicitamente indicata per quella fornitura; usa value_text in formato ISO YYYY-MM-DD, value_number null, unit null, period none e band none;
- conditions_end: data di scadenza/fine delle condizioni economiche, soltanto se esplicitamente indicata per quella fornitura; usa value_text in formato ISO YYYY-MM-DD, value_number null, unit null, period none e band none.

Regole:
- usa le etichette reali del documento e copia i numeri senza arrotondare;
- escludi rete, trasporto, oneri, imposte e IVA dai prezzi di vendita;
- non usare consumi del solo periodo come consumi annui; estraili separatamente come period_consumption quando il totale del periodo è esplicito;
- non duplicare la stessa riga come unit_price e price_component; se unit_price è un prezzo medio/aggregato, restituisci comunque separatamente come price_component le singole componenti esplicite che lo formano;
- non creare righe prive di contenuto: almeno value_text o value_number deve contenere un valore reale; non usare le stringhe “null”, “undefined” o “nan”;
- non inventare e non creare righe duplicate;
- per conditions_start e conditions_end non usare il periodo di fatturazione, la data di emissione, la scadenza di pagamento o la validità di catalogo dell’offerta; non dedurre una data da durate come “12 mesi”: se la decorrenza/scadenza delle condizioni economiche non è scritta chiaramente, non creare la riga;
- non cercare né restituire dati personali, POD, PDR, indirizzi o codici cliente;
- massimo 24 righe per fornitura, scegliendo solo quelle necessarie a compilare il modulo;
- restituisci esclusivamente JSON conforme allo schema.`;

const USER_PROMPT = `Compila il modulo libero con importo totale, periodo, date, consumo annuo e, se disponibile, consumo totale del periodo fatturato, prezzo finale se esplicito, fasce, componenti, formula, quota fissa e, quando esplicitamente indicate, decorrenza e scadenza delle condizioni economiche. Mantieni la struttura tariffaria originale senza produrre spiegazioni.`;

function compact(value, maxLength = 600) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function parseLocaleNumber(value) {
  const raw = compact(value, 120).replace(/[^0-9,.-]/g, "");
  if (!raw || !/\d/.test(raw)) return null;
  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  let normalized = raw;
  if (comma >= 0 && dot >= 0) normalized = comma > dot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  else if (comma >= 0) normalized = raw.replace(/\./g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}
function rowNumber(row) {
  return finite(row?.value_number) ?? parseLocaleNumber(row?.value_text);
}
function normalizePriceType(value) {
  const text = compact(value, 120).toLowerCase();
  if (/ibrid|hybrid/.test(text)) return "ibrido";
  if (/variabil|variable|indicizzat|indexed/.test(text)) return "variabile";
  if (/fiss|fixed/.test(text)) return "fisso";
  return null;
}
function normalizeCode(value) {
  return compact(value, 180).toUpperCase().replace(/\s+/g, "");
}
function normalizeIsoDate(value) {
  const text = compact(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? text : null;
}
function normalizeDocumentAlerts(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((item) => ({
    code: compact(item?.code, 80) || "altro",
    title: compact(item?.title, 140),
    description: compact(item?.description, 500),
    severity: ["low", "medium", "high"].includes(item?.severity) ? item.severity : "medium",
    page: Number.isInteger(Number(item?.page)) && Number(item.page) > 0 ? Number(item.page) : null,
  })).filter((item) => item.title && item.description);
}
function documentKind(value) {
  return value === "bill" ? "bolletta" : value === "offer_sheet" ? "scheda_offerta" : "unknown";
}
function documentCommodity(value) {
  return value === "electricity" ? "luce" : value === "gas" ? "gas" : value === "dual" ? "dual" : "unknown";
}
function responseOutputText(body) {
  if (typeof body?.output_text === "string") return body.output_text;
  for (const item of body?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "refusal") throw new Error(`openai_refusal:${content.refusal || "refused"}`);
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}
async function transportBody(result) {
  if (result && typeof result.json === "function") {
    if (result.ok === false) {
      const text = await result.text().catch(() => "");
      throw new Error(`openai_http_${result.status}:${text.slice(0, 300)}`);
    }
    return result.json();
  }
  return result;
}
async function defaultTransport({ request, apiKey, signal }) {
  return fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
}
async function defaultFileUploadTransport({ filePath, filename, apiKey, signal }) {
  const bytes = await fs.readFile(filePath);
  const formData = new FormData();
  formData.append("purpose", "user_data");
  formData.append("expires_after[anchor]", "created_at");
  formData.append("expires_after[seconds]", "3600");
  formData.append("file", new Blob([bytes], { type: "application/pdf" }), filename || "documento.pdf");
  return fetch("https://api.openai.com/v1/files", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: formData, signal });
}
async function defaultFileDeleteTransport({ fileId, apiKey, signal }) {
  return fetch(`https://api.openai.com/v1/files/${encodeURIComponent(fileId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${apiKey}` }, signal });
}
async function openAiFileTransportBody(result, operation) {
  if (result && typeof result.json === "function") {
    if (result.ok === false) {
      const text = await result.text().catch(() => "");
      throw new Error(`openai_file_${operation}_http_${result.status}:${text.slice(0, 300)}`);
    }
    return result.json();
  }
  return result;
}
function boundedTimeout(value) {
  const parsed = Number(value || 44_000);
  return Math.max(8_000, Math.min(45_000, Number.isFinite(parsed) ? parsed : 44_000));
}
function boundedFileIdThreshold(value) {
  const parsed = Number(value ?? 12_000_000);
  return Number.isFinite(parsed) ? Math.max(1_000_000, Math.min(20_000_000, parsed)) : 12_000_000;
}
function boundedFileUploadTimeout(value) {
  const parsed = Number(value ?? 15_000);
  return Number.isFinite(parsed) ? Math.max(5_000, Math.min(20_000, parsed)) : 15_000;
}
function boundedFileDeleteTimeout(value) {
  const parsed = Number(value ?? 2_000);
  return Number.isFinite(parsed) ? Math.max(500, Math.min(3_000, parsed)) : 2_000;
}

const ESSENTIAL_RECOVERY_PROFILE = "ia_libera_essential_recovery_v1";
const ESSENTIAL_RECOVERY_SYSTEM_PROMPT = `Verifica esclusivamente i dati economici indispensabili mancanti in una bolletta luce o gas.

Per ogni fornitura indicata restituisci soltanto le righe mancanti richieste:
- annual_consumption: consumo annuo o ultimi 12 mesi, mai il consumo del solo periodo fatturato. Se il consumo annuo non è presente ma è esplicito il consumo totale del periodo della bolletta, restituisci quel dato come period_consumption invece di inventare annual_consumption;
- period_consumption: solo il consumo totale dell’intero periodo fatturato della fornitura, in kWh per luce o Smc per gas; non annualizzarlo;
- unit_price: prezzo medio unitario della vendita/materia. Nelle bollette cerca prima nello “Scontrino dell’energia”, sotto “Quota per consumi”, la riga “di cui spesa per la vendita di energia elettrica” oppure “di cui spesa per la vendita di gas naturale”. Copia il singolo valore in €/kWh o €/Smc mostrato in quella riga. Questo recupero serve solo come fallback: se il prezzo non è scomponibile, il confronto verrà marcato a precisione limitata;
- fixed_fee: quota fissa della sola vendita/commercializzazione, con segno e periodicità originali.

Regole vincolanti:
- non usare il prezzo medio totale della quota per consumi, perché comprende rete e oneri;
- non usare rete, trasporto, distribuzione, oneri, imposte, IVA, accise o quota potenza;
- se il Box dell’offerta contiene due o più colonne mensili, non unire i numeri in una stringa e non sceglierne uno arbitrariamente: cerca il prezzo medio della sola vendita nello Scontrino dell’energia;
- restituisci value_number come singolo numero quando il valore è presente;
- non inventare, non calcolare e non restituire dati personali;
- restituisci esclusivamente JSON conforme allo schema.`;

async function buildPdfEssentialRecoveryRequest({
  filePath,
  fileId = null,
  filename = "documento.pdf",
  model = process.env.PDF_AI_PRIMARY_MODEL || PDF_PURE_AI_DEFAULT_MODEL,
  missing = [],
} = {}) {
  if (!filePath && !fileId) throw new Error("pure_ai_file_path_required");
  let fileInput;
  if (fileId) fileInput = { type: "input_file", file_id: String(fileId) };
  else {
    const bytes = await fs.readFile(filePath);
    fileInput = { type: "input_file", filename: filename || "documento.pdf", file_data: `data:application/pdf;base64,${bytes.toString("base64")}` };
  }
  const requested = missing.map((item) => `${item.commodity}: ${item.fields.join(", ")}`).join("; ");
  return {
    model,
    store: false,
    temperature: 0,
    max_output_tokens: 1_800,
    input: [
      { role: "system", content: [{ type: "input_text", text: ESSENTIAL_RECOVERY_SYSTEM_PROMPT }] },
      { role: "user", content: [fileInput, { type: "input_text", text: `Campi mancanti da recuperare: ${requested}. Esamina tutte le pagine pertinenti e restituisci solo questi dati.` }] },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "offertalogica_essential_recovery",
        description: "Recupero mirato dei dati indispensabili al confronto",
        strict: true,
        schema: REQUEST_OUTPUT_SCHEMA,
      },
    },
  };
}

export async function buildPdfPureAiRequest({
  filePath,
  fileId = null,
  filename = "documento.pdf",
  model = process.env.PDF_AI_PRIMARY_MODEL || PDF_PURE_AI_DEFAULT_MODEL,
  maxOutputTokens = null,
} = {}) {
  if (!filePath && !fileId) throw new Error("pure_ai_file_path_required");
  let fileInput;
  if (fileId) fileInput = { type: "input_file", file_id: String(fileId) };
  else {
    const bytes = await fs.readFile(filePath);
    fileInput = { type: "input_file", filename: filename || "documento.pdf", file_data: `data:application/pdf;base64,${bytes.toString("base64")}` };
  }
  return {
    model,
    store: false,
    temperature: 0,
    max_output_tokens: Number(maxOutputTokens || 4_500),
    input: [
      { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
      { role: "user", content: [fileInput, { type: "input_text", text: USER_PROMPT }] },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "offertalogica_compact_adaptive_form",
        description: "Modulo economico adattivo compatto, senza dati personali e senza schema tariffario rigido",
        strict: true,
        schema: REQUEST_OUTPUT_SCHEMA,
      },
    },
  };
}

function fieldRow({ purpose, label, valueText = null, valueNumber = null, unit = null, period = "none", band = "none", page = null, evidence = null, confidence = 0 }) {
  return {
    purpose,
    label: compact(label, 220) || purpose,
    value_text: valueText === null ? null : compact(valueText, 500),
    value_number: finite(valueNumber),
    unit: unit === null ? null : compact(unit, 80),
    period: ["month", "year"].includes(period) ? period : "none",
    band: ["f0", "f1", "f2", "f3", "f23"].includes(band) ? band : "none",
    page: Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : null,
    evidence: evidence === null ? null : compact(evidence, 700),
    confidence: Math.max(0, Math.min(100, Number(confidence || 0))),
  };
}

function oldCompactToAdaptive(parsed) {
  const supplies = [];
  for (const [key, commodity] of [["electricity", "electricity"], ["gas", "gas"]]) {
    const supply = (Array.isArray(parsed?.supplies) ? parsed.supplies.find((item) => item?.commodity === commodity) : null) || parsed?.[key];
    if (!supply) continue;
    const rows = [];
    const consumption = supply.annual_consumption || {};
    if (finite(consumption.total) !== null) rows.push(fieldRow({ purpose: "annual_consumption", label: consumption.label || "Consumo annuo", valueNumber: consumption.total, valueText: String(consumption.total), unit: consumption.unit, page: consumption.page, evidence: consumption.evidence, confidence: consumption.confidence }));
    if (commodity === "electricity") for (const band of ["f1", "f2", "f3", "f23"]) if (finite(consumption[band]) !== null) rows.push(fieldRow({ purpose: "band_consumption", label: `Consumo ${band.toUpperCase()}`, valueNumber: consumption[band], valueText: String(consumption[band]), unit: consumption.unit, band, page: consumption.page, evidence: consumption.evidence, confidence: consumption.confidence }));
    const price = supply.price || {};
    if (finite(price.single) !== null) rows.push(fieldRow({ purpose: "unit_price", label: price.label || "Prezzo unitario", valueNumber: price.single, valueText: String(price.single), unit: price.unit, page: price.page, evidence: price.evidence, confidence: price.confidence }));
    if (commodity === "electricity") for (const band of ["f0", "f1", "f2", "f3", "f23"]) if (finite(price[band]) !== null) rows.push(fieldRow({ purpose: "band_price", label: `Prezzo ${band.toUpperCase()}`, valueNumber: price[band], valueText: String(price[band]), unit: price.unit, band, page: price.page, evidence: price.evidence, confidence: price.confidence }));
    if (price.type && price.type !== "unknown") rows.push(fieldRow({ purpose: "price_type", label: "Tipo prezzo", valueText: price.type, page: price.page, evidence: price.evidence, confidence: price.confidence }));
    if (price.index) rows.push(fieldRow({ purpose: "index", label: "Indice", valueText: price.index, page: price.page, evidence: price.evidence, confidence: price.confidence }));
    if (finite(price.spread) !== null) rows.push(fieldRow({ purpose: "spread", label: "Spread", valueNumber: price.spread, valueText: String(price.spread), unit: price.unit, page: price.page, evidence: price.evidence, confidence: price.confidence }));
    if (finite(price.multiplier) !== null) rows.push(fieldRow({ purpose: "multiplier", label: "Moltiplicatore", valueNumber: price.multiplier, valueText: String(price.multiplier), page: price.page, evidence: price.evidence, confidence: price.confidence }));
    if (price.formula) rows.push(fieldRow({ purpose: "formula", label: "Formula", valueText: price.formula, page: price.page, evidence: price.evidence, confidence: price.confidence }));
    if (price.periodicity) rows.push(fieldRow({ purpose: "periodicity", label: "Periodicità aggiornamento", valueText: price.periodicity, page: price.page, evidence: price.evidence, confidence: price.confidence }));
    const fixed = supply.fixed_fee || {};
    if (finite(fixed.value) !== null) rows.push(fieldRow({ purpose: "fixed_fee", label: fixed.label || "Quota fissa", valueNumber: fixed.value, valueText: fixed.value_text || String(fixed.value), unit: fixed.unit, period: fixed.period, page: fixed.page, evidence: fixed.evidence, confidence: fixed.confidence }));
    supplies.push({ commodity, provider: supply.identity?.provider || null, offer_name: supply.identity?.offer_name || null, offer_code: supply.identity?.offer_code || null, fields: rows.length ? rows : [fieldRow({ purpose: "other", label: "Dato non classificato", valueText: null })] });
  }
  return { document: parsed?.document || { kind: "unknown", commodity: supplies.length === 2 ? "dual" : supplies[0]?.commodity || "unknown", customer_type: "unknown", page_count: null }, supplies };
}

const LEGACY_PURPOSE = {
  consumo_luce_kwh: ["electricity", "annual_consumption", "none"], consumo_gas_smc: ["gas", "annual_consumption", "none"],
  consumo_luce_f1_kwh: ["electricity", "band_consumption", "f1"], consumo_luce_f2_kwh: ["electricity", "band_consumption", "f2"], consumo_luce_f3_kwh: ["electricity", "band_consumption", "f3"], consumo_luce_f23_kwh: ["electricity", "band_consumption", "f23"],
  prezzo_luce_eur_kwh: ["electricity", "unit_price", "none"], prezzo_gas_eur_smc: ["gas", "unit_price", "none"],
  prezzo_luce_f0_eur_kwh: ["electricity", "band_price", "f0"], prezzo_luce_f1_eur_kwh: ["electricity", "band_price", "f1"], prezzo_luce_f2_eur_kwh: ["electricity", "band_price", "f2"], prezzo_luce_f3_eur_kwh: ["electricity", "band_price", "f3"], prezzo_luce_f23_eur_kwh: ["electricity", "band_price", "f23"],
  quota_fissa_vendita_luce: ["electricity", "fixed_fee", "none"], quota_fissa_vendita_gas: ["gas", "fixed_fee", "none"],
  tipo_prezzo_luce: ["electricity", "price_type", "none"], tipo_prezzo_gas: ["gas", "price_type", "none"],
  indice_riferimento_luce: ["electricity", "index", "none"], indice_riferimento_gas: ["gas", "index", "none"],
  spread_luce_eur_kwh: ["electricity", "spread", "none"], spread_gas_eur_smc: ["gas", "spread", "none"],
  moltiplicatore_indice_luce: ["electricity", "multiplier", "none"], moltiplicatore_indice_gas: ["gas", "multiplier", "none"],
  formula_prezzo_luce: ["electricity", "formula", "none"], formula_prezzo_gas: ["gas", "formula", "none"],
  periodicita_aggiornamento_indice_luce: ["electricity", "periodicity", "none"], periodicita_aggiornamento_indice_gas: ["gas", "periodicity", "none"],
  decorrenza_condizioni_economiche_luce: ["electricity", "conditions_start", "none"], scadenza_condizioni_economiche_luce: ["electricity", "conditions_end", "none"],
  decorrenza_condizioni_economiche_gas: ["gas", "conditions_start", "none"], scadenza_condizioni_economiche_gas: ["gas", "conditions_end", "none"],
  potenza_impegnata_kw: ["electricity", "power_committed", "none"], potenza_disponibile_kw: ["electricity", "power_available", "none"],
};
function oldAnswersToAdaptive(parsed) {
  const supplies = new Map();
  const providers = { electricity: null, gas: null };
  for (const answer of parsed?.answers || []) {
    if (!answer?.found) continue;
    if (answer.question_id === "fornitore_luce") providers.electricity = answer.value_text;
    if (answer.question_id === "fornitore_gas") providers.gas = answer.value_text;
    const map = LEGACY_PURPOSE[answer.question_id];
    if (!map) continue;
    const [commodity, purpose, band] = map;
    if (!supplies.has(commodity)) supplies.set(commodity, []);
    supplies.get(commodity).push(fieldRow({ purpose, band, label: answer.label || answer.question_id, valueText: answer.value_text, valueNumber: answer.value_number, unit: answer.unit, period: answer.period, page: answer.page, evidence: answer.evidence, confidence: answer.confidence }));
  }
  return {
    document: parsed?.document || { kind: "unknown", commodity: supplies.size === 2 ? "dual" : [...supplies.keys()][0] || "unknown", customer_type: "unknown", page_count: null },
    supplies: [...supplies.entries()].map(([commodity, fields]) => ({ commodity, provider: providers[commodity], offer_name: null, offer_code: null, fields })),
  };
}

function directFormV2ToAdaptive(parsed) {
  return {
    document: parsed?.document || { kind: "unknown", commodity: "unknown", customer_type: "unknown", page_count: null },
    supplies: (Array.isArray(parsed?.supplies) ? parsed.supplies : []).map((supply) => {
      const rows = [];
      const pushValue = (purpose, entry, band = "none") => {
        if (!entry) return;
        const number = finite(entry.value);
        const text = compact(entry.value_text, 500) || (number !== null ? String(number) : null);
        if (text === null && number === null) return;
        rows.push(fieldRow({ purpose, band: String(band || "none").toLowerCase(), label: entry.label || purpose, valueText: text, valueNumber: number, unit: entry.unit, period: entry.period, page: entry.page, evidence: entry.evidence, confidence: entry.confidence }));
      };
      pushValue("annual_consumption", supply.annual_consumption);
      for (const item of Array.isArray(supply.annual_band_consumptions) ? supply.annual_band_consumptions : []) pushValue("band_consumption", item, item.band);
      pushValue("unit_price", supply.primary_price);
      for (const item of Array.isArray(supply.price_items) ? supply.price_items : []) {
        const band = String(item?.band || "none").toLowerCase();
        pushValue(band !== "none" ? "band_price" : "price_component", item, band);
      }
      pushValue("fixed_fee", supply.fixed_fee);
      if (supply.price_type && supply.price_type !== "unknown") rows.push(fieldRow({ purpose: "price_type", label: "Tipo prezzo", valueText: supply.price_type, page: supply.pricing_page, evidence: supply.pricing_evidence, confidence: supply.confidence }));
      if (supply.price_structure) rows.push(fieldRow({ purpose: "price_structure", label: "Struttura prezzo", valueText: supply.price_structure, page: supply.pricing_page, evidence: supply.pricing_evidence, confidence: supply.confidence }));
      if (supply.index) rows.push(fieldRow({ purpose: "index", label: "Indice", valueText: supply.index, page: supply.pricing_page, evidence: supply.pricing_evidence, confidence: supply.confidence }));
      if (finite(supply.multiplier) !== null) rows.push(fieldRow({ purpose: "multiplier", label: "Moltiplicatore", valueNumber: supply.multiplier, valueText: String(supply.multiplier), page: supply.pricing_page, evidence: supply.pricing_evidence, confidence: supply.confidence }));
      if (finite(supply.spread) !== null) rows.push(fieldRow({ purpose: "spread", label: "Spread", valueNumber: supply.spread, valueText: String(supply.spread), page: supply.pricing_page, evidence: supply.pricing_evidence, confidence: supply.confidence }));
      if (supply.formula) rows.push(fieldRow({ purpose: "formula", label: "Formula", valueText: supply.formula, page: supply.pricing_page, evidence: supply.pricing_evidence, confidence: supply.confidence }));
      if (supply.periodicity) rows.push(fieldRow({ purpose: "periodicity", label: "Periodicità", valueText: supply.periodicity, page: supply.pricing_page, evidence: supply.pricing_evidence, confidence: supply.confidence }));
      if (finite(supply.committed_power_kw) !== null) rows.push(fieldRow({ purpose: "power_committed", label: "Potenza impegnata", valueNumber: supply.committed_power_kw, valueText: String(supply.committed_power_kw), unit: "kW", page: supply.pricing_page, evidence: supply.pricing_evidence, confidence: supply.confidence }));
      if (finite(supply.available_power_kw) !== null) rows.push(fieldRow({ purpose: "power_available", label: "Potenza disponibile", valueNumber: supply.available_power_kw, valueText: String(supply.available_power_kw), unit: "kW", page: supply.pricing_page, evidence: supply.pricing_evidence, confidence: supply.confidence }));
      return { commodity: supply.commodity, provider: supply.provider || null, offer_name: supply.offer_name || null, offer_code: supply.offer_code || null, fields: rows };
    }),
  };
}

function coerceAdaptive(parsed) {
  if (parsed?.document && Array.isArray(parsed?.supplies) && parsed.supplies.every((supply) => Array.isArray(supply?.fields))) return parsed;
  if (parsed?.document && Array.isArray(parsed?.supplies) && parsed.supplies.some((supply) => Object.prototype.hasOwnProperty.call(supply || {}, "primary_price"))) return directFormV2ToAdaptive(parsed);
  if (Array.isArray(parsed?.answers)) return oldAnswersToAdaptive(parsed);
  return oldCompactToAdaptive(parsed);
}

function rowHasUsefulValue(row) {
  const text = compact(row?.value_text, 240);
  if (text && !["null", "undefined", "nan"].includes(text.toLowerCase())) return true;
  return finite(row?.value_number) !== null;
}

function canonicalizeAdaptiveRow(row) {
  if (!row || typeof row !== "object" || !rowHasUsefulValue(row)) return null;
  const label = compact(row.label, 160).toLowerCase();
  const text = compact(row.value_text, 300).toLowerCase();
  let purpose = row.purpose;

  // Corregge solo classificazioni inequivocabili, conservando etichetta e valore originali.
  if (purpose === "price_structure" && /\bformula\b|formula prevista|formula prezzo/.test(label)) purpose = "formula";
  if (purpose === "price_type"
      && /(monorari|biorari|multiorari|triorari|per fasce|fascia f1|fascia f23)/.test(text)
      && !/(fiss|variabil|indicizz|ibrid|fixed|variable|indexed|hybrid)/.test(text)) {
    purpose = "price_structure";
  }

  return { ...row, purpose };
}

function canonicalizeAdaptive(parsed) {
  return {
    ...parsed,
    supplies: (Array.isArray(parsed?.supplies) ? parsed.supplies : []).map((supply) => ({
      ...supply,
      fields: (Array.isArray(supply?.fields) ? supply.fields : [])
        .map(canonicalizeAdaptiveRow)
        .filter(Boolean),
    })),
  };
}

function diagnostic(field, row, value, derivation = null) {
  return {
    field,
    label: compact(row?.label, 180) || field,
    value,
    status: "review",
    confidence: Math.max(0, Math.min(100, Number(row?.confidence ?? 90))),
    page: Number.isInteger(Number(row?.page)) && Number(row.page) > 0 ? Number(row.page) : null,
    source_snippet: compact(row?.evidence, 900) || compact([row?.label, row?.value_text, row?.value_number, row?.unit].filter((item) => item !== null && item !== undefined && item !== "").join(" "), 300),
    source_match: compact(row?.value_text, 180) || (value !== null && value !== undefined ? String(value) : null),
    source_role: ["annual_consumption", "band_consumption"].includes(row?.purpose) ? "annual_total" : row?.purpose === "period_consumption" ? "billing_period_total" : ["power_committed", "power_available"].includes(row?.purpose) ? "customer_data" : "contract_term",
    certainty: derivation ? "derived" : "certain",
    usable_for_comparison: true,
    verification_reason: null,
    coverage_months: ["annual_consumption", "band_consumption"].includes(row?.purpose) ? 12 : null,
    method: derivation ? "deterministic_projection" : "openai_visual_ai_direct_form",
    source_version: PDF_PURE_AI_READER_VERSION,
    derivation,
  };
}
function bestRow(rows, purpose, band = null) {
  return rows
    .filter((row) => row?.purpose === purpose && (band === null || row?.band === band))
    .filter((row) => row?.value_text !== null || finite(row?.value_number) !== null)
    .sort((a, b) => Number(b.confidence ?? 90) - Number(a.confidence ?? 90) || Number(a.page || 9999) - Number(b.page || 9999))[0] || null;
}

// OFFERTALOGICA_ESSENTIAL_COMPARISON_FIELDS_V1_20260730
// I tre dati minimi del confronto (consumo annuo, prezzo materia e quota fissa
// vendita) non possono dipendere dal solo purpose scelto dal modello. Quando la
// riga esiste nel PDF ma viene classificata come price_component/other, la
// recuperiamo con regole deterministiche e conservative. Il raw IA resta intatto.
function essentialRowText(row, includeEvidence = true) {
  return [row?.label, row?.value_text, row?.unit, includeEvidence ? row?.evidence : null]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function essentialCommodityUnit(row, commodity, kind) {
  const explicitUnit = compact(row?.unit, 80).toLowerCase();
  const fallbackText = [row?.label, row?.value_text, row?.evidence].filter(Boolean).join(" ").toLowerCase();
  const text = explicitUnit || fallbackText;

  if (commodity === "electricity") {
    if (!/\bkwh\b/i.test(text)) return false;
    const hasCurrencyPerUnit = /(?:€|eur)\s*\/\s*kwh\b/i.test(text);
    return kind === "price" ? hasCurrencyPerUnit : !hasCurrencyPerUnit;
  }

  if (kind === "price") {
    return /(?:€|eur)\s*\/\s*smc\b/i.test(text);
  }

  // Alcune bollette gas indicano il consumo annuo come "mc" anziché "Smc".
  // L'alias è ammesso solo per i consumi: prezzi e spread restano vincolati a €/Smc.
  const hasGasVolumeUnit = /\b(?:smc|mc|m3)\b|m³/i.test(text);
  const hasCurrencyPerVolume = /(?:€|eur)\s*\/\s*(?:smc|mc|m3)\b|(?:€|eur)\s*\/\s*m³/i.test(text);
  return hasGasVolumeUnit && !hasCurrencyPerVolume;
}

function inferredFixedPeriod(row) {
  if (["month", "year"].includes(row?.period)) return row.period;
  const text = essentialRowText(row, true);
  if (/(?:€|eur)\s*\/[^ ]*(?:mese|month)|\bmensil/.test(text)) return "month";
  if (/(?:€|eur)\s*\/[^ ]*(?:anno|year)|\bannua/.test(text)) return "year";
  return null;
}

function chooseEssentialCandidate(candidates) {
  const valid = candidates.filter(Boolean).sort((a, b) =>
    b.score - a.score
    || Number(b.row?.confidence ?? 90) - Number(a.row?.confidence ?? 90)
    || Number(a.row?.page || 9999) - Number(b.row?.page || 9999)
  );
  if (!valid.length) return null;
  const top = valid[0];
  const second = valid[1];
  const topValue = rowNumber(top.row);
  const secondValue = rowNumber(second?.row);
  if (second && second.score === top.score && topValue !== null && secondValue !== null && Math.abs(topValue - secondValue) > 0.0000005) return null;
  return top;
}

function annualConsumptionCandidate(row, commodity) {
  const value = rowNumber(row);
  if (value === null || value <= 0 || !essentialCommodityUnit(row, commodity, "consumption")) return null;
  const label = essentialRowText(row, false);
  const evidence = essentialRowText(row, true);
  const annual = /(?:totale\s+)?consum[oi]\s+(?:annuo|annui|annuale)|consumo\s+annuo\s+aggiornato|ultimi\s+12\s+mesi|12\s+mesi/;
  const periodOnly = /consum[oi]\s+(?:totale\s+)?fatturat|consumo\s+totale\s+fatturato\s+del\s+periodo|periodo\s+oggetto\s+di\s+fatturazione/;
  if (periodOnly.test(label) && !annual.test(label)) return null;
  if (periodOnly.test(evidence) && !annual.test(evidence) && !annual.test(label)) return null;

  let score = 0;
  if (annual.test(label)) score = 280;
  else if (annual.test(evidence)) score = 235;
  else if (row?.purpose === "annual_consumption" && (row?.period === "year" || /\/\s*(?:anno|year)\b/.test(evidence))) score = 210;
  if (!score) return null;
  if (row?.purpose === "annual_consumption") score += 30;
  return { row, score, recovered: row?.purpose !== "annual_consumption", mode: row?.purpose === "annual_consumption" ? "declared_annual" : "semantic_annual" };
}

function periodConsumptionCandidate(row, commodity) {
  const value = rowNumber(row);
  if (value === null || value <= 0 || !essentialCommodityUnit(row, commodity, "consumption")) return null;
  const label = essentialRowText(row, false);
  const evidence = essentialRowText(row, true);
  const annual = /(?:totale\s+)?consum[oi]\s+(?:annuo|annui|annuale)|ultimi\s+12\s+mesi|12\s+mesi|annual/;
  if (annual.test(label) || annual.test(evidence)) return null;
  const periodTotal = /consum[oi].{0,35}(?:fatturat|del\s+periodo|nel\s+periodo|periodo\s+fatturat)|(?:totale\s+)?(?:energia|gas).{0,25}fatturat|consumo\s+(?:del\s+)?mese|quantit[aà].{0,25}fatturat/;
  let score = 0;
  if (row?.purpose === "period_consumption") score = periodTotal.test(evidence) ? 320 : 260;
  else if (periodTotal.test(label)) score = 240;
  else if (periodTotal.test(evidence)) score = 205;
  if (!score) return null;
  return { row, score, recovered: row?.purpose !== "period_consumption", mode: row?.purpose === "period_consumption" ? "declared_period" : "semantic_period" };
}

function salePriceCandidate(row, commodity, rows) {
  const value = rowNumber(row);
  if (value === null || value <= 0 || !essentialCommodityUnit(row, commodity, "price")) return null;
  if (row?.band && String(row.band).toLowerCase() !== "none") return null;
  if (["month", "year"].includes(row?.period)) return null;

  const label = essentialRowText(row, false);
  const evidence = essentialRowText(row, true);
  const excluded = /rete|oneri|trasport|distribuz|impost|\biva\b|accis|quota\s+fissa|potenza|\bpun\b|\bpsv\b|spread|dispacci|capacit[aà]|perdit|sconto|bonus|totale|intera\s+bolletta|quota\s+per\s+consumi/;
  if (!label || excluded.test(label)) return null;

  const specific = commodity === "electricity"
    ? /(?:di\s+cui\s+)?(?:spesa|costo)\s+per\s+(?:la\s+)?(?:vendita|materia)(?:\s+di)?\s+(?:energia\s+elettrica|materia\s+energia)|(?:prezzo|costo)\s+(?:unitario\s+)?(?:finale\s+)?(?:per\s+|della\s+|di\s+)?(?:materia\s+prima|materia\s+energia|energia\s+elettrica)|prezzo\s+materia\s+prima|\bprzmp\b|(?:materia\s+prima|materia\s+energia)\b/
    : /(?:di\s+cui\s+)?(?:spesa|costo)\s+per\s+(?:la\s+)?(?:vendita|materia)(?:\s+di)?\s+(?:gas\s+naturale|gas)|(?:prezzo|costo)\s+(?:unitario\s+)?(?:finale\s+)?(?:per\s+|della\s+|di\s+)?(?:materia\s+prima\s+gas|materia\s+gas\s+naturale|gas\s+naturale|gas)|prezzo\s+materia\s+prima|\bprzmp\b|materia\s+(?:prima\s+)?gas(?:\s+naturale)?\b/;
  const genericSale = /(?:di\s+cui\s+)?(?:spesa|costo)\s+per\s+(?:la\s+)?vendita\b/;
  const genericPrice = /prezzo\s+(?:unitario|applicato|effettivo|finale|fisso)\b/;
  const component = commodity === "electricity"
    ? /(?:corrispettivo|componente)\s+(?:di\s+)?(?:energia|materia\s+energia)\b/
    : /(?:corrispettivo|componente)\s+(?:di\s+)?gas\b/;

  let score = 0;
  if (row?.purpose === "unit_price") score = 1000;
  else if (specific.test(label)) score = 270;
  else if (genericSale.test(label)) score = 235;
  else if (component.test(label)) score = 155;
  else if (genericPrice.test(label)) score = 145;
  else if (specific.test(evidence)) score = 225;
  else if (genericSale.test(evidence)) score = 190;
  else if (genericPrice.test(evidence) && /vendita|materia/.test(evidence)) score = 135;
  if (!score) return null;

  const potentiallyBase = /^(?:corrispettivo|componente)\b|^prezzo\s+(?:fisso|unitario)\b/.test(label);
  if (potentiallyBase && score < 220) {
    const otherRows = rows.filter((item) => item !== row && essentialCommodityUnit(item, commodity, "price"));
    const hasModifier = otherRows.some((item) => {
      const otherLabel = essentialRowText(item, false);
      const otherValue = rowNumber(item);
      return (otherValue !== null && otherValue < 0) || /sconto|perdit|spread|dispacci|maggioraz|riduz|bonus/.test(otherLabel);
    });
    if (hasModifier) score -= 100;
  }
  if (score < 120) return null;
  return { row, score, recovered: row?.purpose !== "unit_price", mode: row?.purpose === "unit_price" ? "declared_unit_price" : "semantic_sale_price" };
}

function fixedFeeCandidate(row, commodity) {
  const value = rowNumber(row);
  const period = inferredFixedPeriod(row);
  if (value === null || !period) return null;
  const label = essentialRowText(row, false);
  const evidence = essentialRowText(row, true);
  const unit = compact(row?.unit, 80).toLowerCase();
  if (!/(?:€|eur)/.test(unit || evidence) || /\/\s*kw\b/.test(unit)) return null;
  if (/potenza|rete|oneri|trasport|distribuz/.test(label)) return null;
  if (/quota\s+fissa\s+e\s+quota\s+potenza|totale\s+quota\s+fissa/.test(label)) return null;

  const commoditySale = commodity === "electricity"
    ? /(?:spesa|costo)\s+per\s+(?:la\s+)?vendita(?:\s+di)?\s+(?:energia\s+elettrica|materia\s+energia)/
    : /(?:spesa|costo)\s+per\s+(?:la\s+)?vendita(?:\s+di)?\s+(?:gas\s+naturale|gas)/;
  const commercial = /quota\s+fissa[^;,.]{0,60}(?:vendita|commercializz)|(?:vendita|commercializz)[^;,.]{0,60}quota\s+fissa|corrispettivo[^;,.]{0,50}commercializz|commercializzazione\s+(?:al\s+dettaglio\s+)?(?:fissa|vendita)/;
  const genericSale = /(?:spesa|costo)\s+per\s+(?:la\s+)?vendita\b/;
  const genericFixed = /quota\s+fissa|commercializzazione/;

  let score = 0;
  if (row?.purpose === "fixed_fee" && !/rete|oneri|potenza/.test(label)) score = 900;
  if (commoditySale.test(label)) score = Math.max(score, 280);
  else if (commoditySale.test(evidence)) score = Math.max(score, 240);
  if (commercial.test(label)) score = Math.max(score, 260);
  else if (commercial.test(evidence)) score = Math.max(score, 220);
  if (genericSale.test(label)) score = Math.max(score, 225);
  else if (genericSale.test(evidence)) score = Math.max(score, 190);
  if (row?.purpose === "fixed_fee" && genericFixed.test(label)) score = Math.max(score, 210);
  if (!score) return null;

  const normalizedRow = period === row.period ? row : { ...row, period };
  return { row: normalizedRow, score, recovered: row?.purpose !== "fixed_fee" || period !== row?.period, mode: row?.purpose === "fixed_fee" ? "declared_fixed_fee" : "semantic_fixed_fee" };
}

function essentialRowsForSupply(supply) {
  const rows = Array.isArray(supply?.fields) ? supply.fields : [];
  const commodity = supply?.commodity;
  return {
    annual: chooseEssentialCandidate(rows.map((row) => annualConsumptionCandidate(row, commodity))),
    period: chooseEssentialCandidate(rows.map((row) => periodConsumptionCandidate(row, commodity))),
    price: chooseEssentialCandidate(rows.map((row) => salePriceCandidate(row, commodity, rows))),
    fixed: chooseEssentialCandidate(rows.map((row) => fixedFeeCandidate(row, commodity))),
  };
}

function setMapped(normalized, filledFields, field, row, transform = (item) => rowNumber(item), derivation = null) {
  if (!row) return;
  const value = transform(row);
  if (value === null || value === undefined || value === "") return;
  normalized[field] = value;
  filledFields.push(field);
  normalized.diagnostics.push(diagnostic(field, row, value, derivation));
}
function rawFixedDetails(row) {
  if (!row) return null;
  const number = rowNumber(row);
  const valid = number !== null && ["month", "year"].includes(row.period);
  return {
    commercial_component: {
      value: valid ? number : null,
      value_text: valid ? (compact(row.value_text, 120) || String(number)) : null,
      unit: valid ? (compact(row.unit, 60) || null) : null,
      period: valid ? row.period : "none",
      page: valid ? row.page : null,
      label: valid ? row.label : null,
      evidence: valid ? (row.evidence || compact([row.label, row.value_text, row.value_number, row.unit].filter((item) => item !== null && item !== undefined && item !== "").join(" "), 300) || null) : null,
      confidence: valid ? Number(row.confidence ?? 90) : 0,
    },
    section_total: { value: null, value_text: null, unit: null, period: "none", page: null, label: null, evidence: null, confidence: 0 },
    selected_for_comparison: valid ? "commercial_component" : null,
  };
}


function rowEvidence(row) {
  return compact(row?.evidence, 700)
    || compact([row?.label, row?.value_text, row?.value_number, row?.unit].filter((item) => item !== null && item !== undefined && item !== "").join(" "), 300)
    || null;
}

function frontendEntry(row) {
  if (!row) return null;
  return {
    value: rowNumber(row),
    value_text: compact(row.value_text, 240) || (rowNumber(row) !== null ? String(rowNumber(row)) : null),
    unit: compact(row.unit, 40) || null,
    period: ["month", "year"].includes(row.period) ? row.period : "none",
    page: Number.isInteger(Number(row.page)) && Number(row.page) > 0 ? Number(row.page) : null,
    label: compact(row.label, 120) || null,
    evidence: rowEvidence(row),
    confidence: Math.max(0, Math.min(100, Number(row.confidence ?? 90))),
  };
}


function comparisonCanonicalText(value) {
  return compact(value, 1200)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function comparisonRowText(row) {
  return comparisonCanonicalText(`${row?.label || ""} ${rowEvidence(row) || ""}`);
}

function comparisonUnitMatches(row, commodity) {
  const unit = comparisonCanonicalText(row?.unit || "").replace(/\s+/g, "");
  return commodity === "electricity" ? /kwh/.test(unit) : /smc|scm/.test(unit);
}

function comparisonClose(left, right) {
  const a = finite(left);
  const b = finite(right);
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= Math.max(0.000002, Math.abs(b) * 0.003);
}

function comparisonDiscountRow(row, commodity) {
  if (!comparisonUnitMatches(row, commodity)) return false;
  const value = rowNumber(row);
  const text = comparisonRowText(row);
  return value !== null && /sconto|riduz|discount|bonus|promo|agevol/.test(text);
}

function comparisonExtraRow(row, commodity) {
  if (!comparisonUnitMatches(row, commodity)) return false;
  const text = comparisonRowText(row);
  return /c\.?\s*disp\.?\s*d|cdispd|dispacci|capacita|capacity|perequaz|rete|trasport|distribuz|oneri|impost|\biva\b|accis|perdit/.test(text);
}

function comparisonSpreadRow(row, commodity) {
  if (!comparisonUnitMatches(row, commodity)) return false;
  return row?.purpose === "spread" || /\bspread\b/.test(comparisonRowText(row));
}

function comparisonBaseRow(row, commodity) {
  if (!comparisonUnitMatches(row, commodity)) return false;
  const text = comparisonRowText(row);
  if (comparisonDiscountRow(row, commodity) || comparisonExtraRow(row, commodity) || comparisonSpreadRow(row, commodity)) return false;
  const pattern = commodity === "electricity"
    ? /corrispettivo(?:\s+consumo)?\s+energia|materia\s+energia|prezzo\s+(?:della\s+)?materia|componente\s+energia|energia\s+elettrica/
    : /corrispettivo(?:\s+consumo)?\s+gas|materia\s+(?:prima\s+)?gas|prezzo\s+(?:della\s+)?materia|componente\s+gas|gas\s+naturale/;
  return pattern.test(text);
}

function comparisonNormalizationFactor(rows, commodity) {
  const multiplierRow = bestRow(rows, "multiplier");
  const multiplier = rowNumber(multiplierRow);
  if (multiplier === null || multiplier <= 0 || comparisonClose(multiplier, 1)) return null;
  const formula = comparisonCanonicalText(bestRow(rows, "formula")?.value_text || "");
  const evidence = comparisonRowText(multiplierRow);
  const normalizationFactor = commodity === "gas"
    ? /pcs|potere\s+calorifico|coefficiente\s+c\b|coefficiente.*conversion|conversione/.test(`${formula} ${evidence}`)
    : /perdit|rete|coefficiente.*perdit/.test(`${formula} ${evidence}`);
  return normalizationFactor ? { multiplier, row: multiplierRow } : null;
}

function comparisonPriceForSupply(supply, essentials) {
  const rows = Array.isArray(supply?.fields) ? supply.fields : [];
  const commodity = supply?.commodity;
  const observed = rowNumber(essentials?.price?.row);
  const priceComponents = rows.filter((row) => row?.purpose === "price_component" && comparisonUnitMatches(row, commodity));
  const baseRows = priceComponents.filter((row) => comparisonBaseRow(row, commodity));
  const discountRows = priceComponents.filter((row) => comparisonDiscountRow(row, commodity));
  const extraRows = priceComponents.filter((row) => comparisonExtraRow(row, commodity));
  const componentSpreadRows = priceComponents.filter((row) => comparisonSpreadRow(row, commodity));
  const declaredSpread = bestRow(rows, "spread");
  const spreadRows = [
    ...(declaredSpread && comparisonUnitMatches(declaredSpread, commodity) ? [declaredSpread] : []),
    ...componentSpreadRows.filter((row) => row !== declaredSpread),
  ];
  const classified = new Set([...baseRows, ...discountRows, ...extraRows, ...componentSpreadRows]);
  const unknownRows = priceComponents.filter((row) => !classified.has(row));
  const uniqueBaseValues = [...new Set(baseRows.map(rowNumber).filter((value) => value !== null).map((value) => Number(value.toFixed(9))))];
  const sumRows = (items) => items.reduce((sum, row) => sum + (rowNumber(row) ?? 0), 0);
  const sumDiscountRows = (items) => items.reduce((sum, row) => {
    const value = rowNumber(row);
    if (value === null) return sum;
    return sum + (value > 0 ? -value : value);
  }, 0);
  const formulaText = comparisonCanonicalText(bestRow(rows, "formula")?.value_text || "");
  const formulaMentionsDiscount = /sconto|riduz|discount|bonus|promo|agevol/.test(formulaText);
  const formulaMentionsAncillary = /c\.?\s*disp\.?\s*d|cdispd|dispacci|capacita|perequaz|oneri|perdit/.test(formulaText);
  const formulaMentionsSpread = /\bspread\b/.test(formulaText);
  const formulaMentionsFactor = /pcs|potere\s+calorifico|coefficiente|conversion/.test(formulaText);
  const modifierMentioned = formulaMentionsDiscount || formulaMentionsAncillary || formulaMentionsSpread || formulaMentionsFactor;
  const factor = comparisonNormalizationFactor(rows, commodity);
  const reasons = [];
  let comparison = null;
  let source = "unavailable";
  let factorMode = null;

  if (uniqueBaseValues.length === 1) {
    const base = uniqueBaseValues[0];
    const discounts = sumDiscountRows(discountRows);
    const spreads = sumRows(spreadRows);
    const extras = sumRows(extraRows);
    const unknown = sumRows(unknownRows);
    let normalizedBase = base;

    if (factor) {
      const plainTotal = base + discounts + spreads + extras + unknown;
      const factorTotal = base * factor.multiplier + discounts + spreads + extras + unknown;
      if (observed !== null && comparisonClose(observed, factorTotal) && !comparisonClose(observed, plainTotal)) {
        factorMode = "base_before_normalization_factor";
      } else if (observed !== null && comparisonClose(observed, plainTotal)) {
        normalizedBase = base / factor.multiplier;
        factorMode = "base_after_normalization_factor";
      } else {
        reasons.push("fattore_conversione_non_ricostruibile");
      }
    }

    comparison = normalizedBase + spreads + discounts;
    source = "componenti_deterministiche";
    const explainedTotal = base + discounts + spreads + extras + unknown;
    if (observed !== null && !factor && !comparisonClose(observed, explainedTotal)) reasons.push("componenti_non_riconciliano_prezzo_medio");
    if (unknownRows.length) reasons.push("componenti_unitarie_non_classificate");
    if (formulaMentionsDiscount && !discountRows.length) reasons.push("sconto_citato_non_quantificato");
    if (formulaMentionsAncillary && !extraRows.length) reasons.push("componente_accessoria_citata_non_quantificata");
    if (formulaMentionsSpread && !spreadRows.length) reasons.push("spread_citato_non_quantificato");
    if (formulaMentionsFactor && !factor) reasons.push("fattore_conversione_citato_non_quantificato");
    if (factor && discountRows.length) reasons.push("sconto_con_fattore_conversione_da_verificare");
  } else if (uniqueBaseValues.length > 1) {
    reasons.push("piu_prezzi_materia_non_ponderabili");
  }

  if (comparison === null && observed !== null) {
    const directText = comparisonRowText(essentials?.price?.row);
    const aggregate = /spesa\s+per\s+(?:la\s+)?vendita|costo\s+per\s+(?:la\s+)?vendita|prezzo\s+medio|quota\s+per\s+consumi/.test(directText);
    const direct = commodity === "electricity"
      ? /materia\s+energia|corrispettivo\s+energia|prezzo\s+energia/.test(directText)
      : /materia\s+(?:prima\s+)?gas|corrispettivo\s+gas|prezzo\s+gas/.test(directText);
    comparison = observed;
    source = direct && !aggregate && !modifierMentioned ? "prezzo_materia_diretto" : "prezzo_medio_fallback";
    if (source === "prezzo_medio_fallback") reasons.push("formula_e_componenti_insufficienti");
  }

  if (comparison !== null && (!Number.isFinite(comparison) || comparison <= 0)) {
    comparison = observed;
    source = "prezzo_medio_fallback";
    reasons.push("prezzo_normalizzato_non_valido");
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    comparison: comparison === null ? null : Number(comparison.toFixed(9)),
    observed: observed === null ? null : observed,
    precision: comparison !== null && uniqueReasons.length === 0 ? "completa" : "limitata",
    reasons: uniqueReasons,
    source,
    factor: factor ? factor.multiplier : null,
    factorMode,
    included: {
      base: baseRows.map(frontendEntry).filter(Boolean),
      spread: spreadRows.map(frontendEntry).filter(Boolean),
      discounts: discountRows.map(frontendEntry).filter(Boolean),
    },
    excluded: {
      ancillary: extraRows.map(frontendEntry).filter(Boolean),
      unknown: unknownRows.map(frontendEntry).filter(Boolean),
    },
  };
}

function appendComparisonPrecisionIssues(normalized) {
  const issues = Array.isArray(normalized.validation_issues) ? normalized.validation_issues : [];
  for (const suffix of ["luce", "gas"]) {
    if (normalized[`precisione_confronto_${suffix}`] !== "limitata") continue;
    issues.push({
      field: `precisione_confronto_${suffix}`,
      code: `comparison_precision_limited_${suffix}`,
      severity: "review",
      message: `La formula economica ${suffix} non è ricostruibile completamente: il confronto resta disponibile ma può essere meno preciso.`,
    });
  }
  normalized.validation_issues = issues;
  return normalized;
}

function adaptiveSupplyForFrontend(supply) {
  const rows = Array.isArray(supply?.fields) ? supply.fields : [];
  const essentials = essentialRowsForSupply(supply);
  const firstText = (purpose) => compact(bestRow(rows, purpose)?.value_text, 240) || null;
  const firstNumber = (purpose) => rowNumber(bestRow(rows, purpose));
  const annual = frontendEntry(bestRow(rows, "annual_consumption"));
  const bands = rows.filter((row) => row?.purpose === "band_consumption").map((row) => ({
    band: String(row.band || "none").toUpperCase(),
    ...frontendEntry(row),
  }));
  const priceItems = rows.filter((row) => ["band_price", "price_component"].includes(row?.purpose)).map((row) => ({
    label: compact(row.label, 120) || "Voce prezzo",
    value: rowNumber(row),
    value_text: compact(row.value_text, 240) || (rowNumber(row) !== null ? String(rowNumber(row)) : null),
    unit: compact(row.unit, 40) || null,
    period: ["month", "year"].includes(row.period) ? row.period : "none",
    band: row.band && row.band !== "none" ? String(row.band).toUpperCase() : null,
    page: Number.isInteger(Number(row.page)) && Number(row.page) > 0 ? Number(row.page) : null,
    evidence: rowEvidence(row),
    confidence: Math.max(0, Math.min(100, Number(row.confidence ?? 90))),
  }));
  const priceTypeIt = normalizePriceType(firstText("price_type"));
  const priceType = priceTypeIt === "fisso" ? "fixed" : priceTypeIt === "variabile" ? "variable" : priceTypeIt === "ibrido" ? "hybrid" : "unknown";
  const firstPage = rows.map((row) => Number(row?.page)).find((page) => Number.isInteger(page) && page > 0) || null;
  return {
    commodity: supply.commodity === "electricity" ? "luce" : "gas",
    provider: compact(supply.provider, 240) || null,
    offer_name: compact(supply.offer_name, 300) || null,
    offer_code: compact(supply.offer_code, 180) || null,
    annual_consumption: annual,
    period_consumption: frontendEntry(essentials.period?.row || bestRow(rows, "period_consumption")),
    annual_band_consumptions: bands,
    primary_price: frontendEntry(essentials.price?.row),
    price_items: priceItems,
    fixed_fee: frontendEntry(essentials.fixed?.row || bestRow(rows, "fixed_fee")),
    price_type: priceType,
    price_structure: firstText("price_structure") || (priceItems.some((item) => item.band) ? "per fasce" : essentials.price?.row ? "monoraria" : null),
    index: firstText("index"),
    multiplier: firstNumber("multiplier"),
    spread: firstNumber("spread"),
    formula: firstText("formula"),
    periodicity: firstText("periodicity"),
    committed_power_kw: firstNumber("power_committed"),
    available_power_kw: firstNumber("power_available"),
    pricing_page: firstPage,
    pricing_evidence: compact(rows.map(rowEvidence).filter(Boolean).slice(0, 3).join(" | "), 700) || null,
    confidence: rows.length ? 90 : 0,
  };
}

export function normalizePureAiOutput(parsed, { model = PDF_PURE_AI_DEFAULT_MODEL, responseId = null, transportMode = "pdf_originale", timings = {} } = {}) {
  const rawAdaptive = coerceAdaptive(parsed);
  if (!rawAdaptive?.document || !Array.isArray(rawAdaptive?.supplies)) throw new Error("openai_invalid_output");
  const adaptive = canonicalizeAdaptive(rawAdaptive);
  const normalized = {
    parser_version: PDF_PURE_AI_READER_VERSION,
    page_count: Number(adaptive.document.page_count || 0) || null,
    diagnostics: [],
    kind: documentKind(adaptive.document.kind),
    commodity: documentCommodity(adaptive.document.commodity),
    customer_type: adaptive.document.customer_type === "consumer" ? "privato" : adaptive.document.customer_type === "business" ? "business" : null,
    document_classification_evidence: null,
    billing_period_start: normalizeIsoDate(adaptive.document.billing_period_start),
    billing_period_end: normalizeIsoDate(adaptive.document.billing_period_end),
    issue_date: normalizeIsoDate(adaptive.document.issue_date),
    due_date: normalizeIsoDate(adaptive.document.due_date),
    total_amount_eur: finite(adaptive.document.total_amount_eur),
    document_alerts: normalizeDocumentAlerts(adaptive.document.alerts),
    supply_start_date: null,
    textExtracted: 0,
    needsReview: true,
    adaptive_form: { version: "adaptive-form-v3.2-premium", supplies: [] },
    comparison_form_raw: rawAdaptive,
    activation_data_archive: [],
    componenti_prezzo_luce: [],
    componenti_prezzo_gas: [],
  };
  const filledFields = [];
  const rejected = [];
  const providers = [];

  for (const supply of adaptive.supplies) {
    if (!supply || !["electricity", "gas"].includes(supply.commodity)) continue;
    const isLight = supply.commodity === "electricity";
    const suffix = isLight ? "luce" : "gas";
    const rows = Array.isArray(supply.fields) ? supply.fields : [];
    const essentials = essentialRowsForSupply(supply);
    normalized.adaptive_form.supplies.push(adaptiveSupplyForFrontend(supply));
    if (supply.provider) {
      const provider = compact(supply.provider, 240);
      normalized[`fornitore_${suffix}`] = provider;
      providers.push(provider);
      filledFields.push(`fornitore_${suffix}`);
      normalized.diagnostics.push(diagnostic(`fornitore_${suffix}`, { label: "Fornitore", value_text: provider, confidence: 100 }, provider));
    }
    if (supply.offer_name) normalized[`nome_offerta_${suffix}`] = compact(supply.offer_name, 300);
    if (supply.offer_code) normalized[`codice_offerta_${suffix}`] = normalizeCode(supply.offer_code);

    setMapped(
      normalized,
      filledFields,
      isLight ? "consumo_luce_kwh" : "consumo_gas_smc",
      essentials.annual?.row,
      (item) => rowNumber(item),
      essentials.annual?.recovered ? { type: "essential_field_semantic_recovery", original_purpose: essentials.annual.row?.purpose || null, resolved_as: "annual_consumption", mode: essentials.annual.mode } : null,
    );
    setMapped(
      normalized,
      filledFields,
      isLight ? "consumo_periodo_luce_kwh" : "consumo_periodo_gas_smc",
      essentials.period?.row,
      (item) => rowNumber(item),
      essentials.period?.recovered ? { type: "period_consumption_semantic_recovery", original_purpose: essentials.period.row?.purpose || null, resolved_as: "period_consumption", mode: essentials.period.mode } : null,
    );
    if (isLight) {
      for (const band of ["f1", "f2", "f3", "f23"]) setMapped(normalized, filledFields, `consumo_luce_${band}_kwh`, bestRow(rows, "band_consumption", band));
      for (const band of ["f0", "f1", "f2", "f3", "f23"]) setMapped(normalized, filledFields, `prezzo_luce_${band}_eur_kwh`, bestRow(rows, "band_price", band));
      setMapped(
        normalized,
        filledFields,
        "prezzo_luce_eur_kwh",
        essentials.price?.row,
        (item) => rowNumber(item),
        essentials.price?.recovered ? { type: "essential_field_semantic_recovery", original_purpose: essentials.price.row?.purpose || null, resolved_as: "unit_price", mode: essentials.price.mode } : null,
      );
      setMapped(normalized, filledFields, "potenza_impegnata_kw", bestRow(rows, "power_committed"));
      setMapped(normalized, filledFields, "potenza_disponibile_kw", bestRow(rows, "power_available"));
      if (["f0", "f1", "f2", "f3", "f23"].some((band) => bestRow(rows, "band_price", band))) normalized.struttura_prezzo_luce = "per fasce";
      else if (essentials.price?.row) normalized.struttura_prezzo_luce = "monoraria";
    } else setMapped(
      normalized,
      filledFields,
      "prezzo_gas_eur_smc",
      essentials.price?.row,
      (item) => rowNumber(item),
      essentials.price?.recovered ? { type: "essential_field_semantic_recovery", original_purpose: essentials.price.row?.purpose || null, resolved_as: "unit_price", mode: essentials.price.mode } : null,
    );

    setMapped(normalized, filledFields, `tipo_prezzo_${suffix}`, bestRow(rows, "price_type"), (row) => normalizePriceType(row.value_text));
    setMapped(normalized, filledFields, `struttura_prezzo_${suffix}`, bestRow(rows, "price_structure"), (row) => compact(row.value_text, 180));
    setMapped(normalized, filledFields, `indice_riferimento_${suffix}`, bestRow(rows, "index"), (row) => compact(row.value_text, 180));
    setMapped(normalized, filledFields, `spread_${suffix}_${isLight ? "eur_kwh" : "eur_smc"}`, bestRow(rows, "spread"));
    setMapped(normalized, filledFields, `moltiplicatore_indice_${suffix}`, bestRow(rows, "multiplier"));
    setMapped(normalized, filledFields, `formula_prezzo_${suffix}`, bestRow(rows, "formula"), (row) => compact(row.value_text, 500));
    setMapped(normalized, filledFields, `periodicita_aggiornamento_indice_${suffix}`, bestRow(rows, "periodicity"), (row) => compact(row.value_text, 160));
    setMapped(normalized, filledFields, `decorrenza_condizioni_economiche_${suffix}`, bestRow(rows, "conditions_start"), (row) => normalizeIsoDate(row.value_text));
    setMapped(normalized, filledFields, `scadenza_condizioni_economiche_${suffix}`, bestRow(rows, "conditions_end"), (row) => normalizeIsoDate(row.value_text));

    const fixedRow = essentials.fixed?.row || null;
    const fixedNumber = rowNumber(fixedRow);
    normalized[`quota_fissa_dettaglio_${suffix}`] = rawFixedDetails(fixedRow);
    if (fixedRow && fixedNumber !== null && ["month", "year"].includes(fixedRow.period)) {
      const annual = fixedRow.period === "month" ? Number((fixedNumber * 12).toFixed(6)) : fixedNumber;
      const field = `quota_fissa_vendita_${suffix}_eur_anno`;
      normalized[field] = annual;
      filledFields.push(field);
      normalized.diagnostics.push(diagnostic(field, fixedRow, annual, {
        type: essentials.fixed?.recovered ? "essential_fixed_fee_semantic_recovery" : (fixedRow.period === "month" ? "monthly_to_annual" : "annual_literal"),
        original_purpose: essentials.fixed?.recovered ? fixedRow?.purpose || null : undefined,
        original_value: fixedNumber,
        original_period: fixedRow.period,
        factor: fixedRow.period === "month" ? 12 : 1,
        derived_value: annual,
        mode: essentials.fixed?.mode || null,
      }));
    }

    const components = rows.filter((row) => row?.purpose === "price_component").map((row) => ({
      label: compact(row.label, 220), value: rowNumber(row), value_text: compact(row.value_text, 300) || null, unit: compact(row.unit, 80) || null,
      period: row.period || "none", band: row.band || "none", page: row.page || null, evidence: rowEvidence(row), confidence: Number(row.confidence ?? 90),
    }));
    normalized[`componenti_prezzo_${suffix}`] = components;

    const comparisonPrice = comparisonPriceForSupply(supply, essentials);
    normalized[`prezzo_vendita_bolletta_${suffix}_${isLight ? "eur_kwh" : "eur_smc"}`] = comparisonPrice.observed;
    normalized[`precisione_confronto_${suffix}`] = comparisonPrice.precision;
    normalized[`motivi_precisione_confronto_${suffix}`] = comparisonPrice.reasons;
    normalized[`normalizzazione_prezzo_${suffix}`] = comparisonPrice;
    if (comparisonPrice.comparison !== null) {
      normalized[isLight ? "prezzo_luce_eur_kwh" : "prezzo_gas_eur_smc"] = comparisonPrice.comparison;
      filledFields.push(isLight ? "prezzo_luce_eur_kwh" : "prezzo_gas_eur_smc");
    }
  }

  if (providers.length) normalized.fornitore = providers[0];
  if (finite(normalized.consumo_luce_kwh) === null) {
    const f1 = finite(normalized.consumo_luce_f1_kwh), f2 = finite(normalized.consumo_luce_f2_kwh), f3 = finite(normalized.consumo_luce_f3_kwh), f23 = finite(normalized.consumo_luce_f23_kwh);
    const total = f1 !== null && f23 !== null ? f1 + f23 : [f1, f2, f3].every((v) => v !== null) ? f1 + f2 + f3 : null;
    if (total !== null && total > 0) {
      normalized.consumo_luce_kwh = Number(total.toFixed(6));
      filledFields.push("consumo_luce_kwh");
      normalized.diagnostics.push(diagnostic("consumo_luce_kwh", { purpose: "annual_consumption", label: "Consumo annuo derivato dalle fasce", confidence: 100, evidence: "Somma esatta delle fasce annue" }, normalized.consumo_luce_kwh, { type: "annual_bands_to_total", derived_value: normalized.consumo_luce_kwh }));
    }
  }

  const lightSignals = ["consumo_luce_kwh", "prezzo_luce_eur_kwh", "prezzo_luce_f1_eur_kwh", "quota_fissa_vendita_luce_eur_anno", "indice_riferimento_luce"].some((field) => normalized[field] !== null && normalized[field] !== undefined && normalized[field] !== "");
  const gasSignals = ["consumo_gas_smc", "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno", "indice_riferimento_gas"].some((field) => normalized[field] !== null && normalized[field] !== undefined && normalized[field] !== "");
  if (lightSignals && gasSignals) normalized.commodity = "dual";
  else if (lightSignals) normalized.commodity = "luce";
  else if (gasSignals) normalized.commodity = "gas";

  normalized.recognized = normalized.kind !== "unknown" && normalized.commodity !== "unknown" && adaptive.supplies.some((supply) => Array.isArray(supply.fields) && supply.fields.length);
  normalized.confidence = normalized.recognized ? "medium" : "low";
  normalized.warnings = ["lettura_ia_libera_da_verificare_nel_modulo"];
  normalized.ocr = { attempted: false, applied: false, reason: "ai_only_mode" };
  normalized.ai = {
    applied: true,
    reader_version: PDF_PURE_AI_READER_VERSION,
    pipeline_version: PDF_PURE_AI_READER_VERSION,
    model,
    response_id: responseId,
    transport_mode: transportMode,
    request_build_ms: Number(timings.request_build_ms || 0),
    openai_file_upload_ms: Number(timings.openai_file_upload_ms || 0),
    openai_ms: Number(timings.openai_ms || 0),
    total_ms: Number(timings.total_ms || 0),
    input_file_bytes: Number(timings.input_file_bytes || 0) || null,
    file_id_threshold_bytes: Number(timings.file_id_threshold_bytes || 0) || null,
    openai_attempts: Math.max(1, Number(timings.openai_attempts || 1)),
    retry_count: Math.max(0, Number(timings.openai_attempts || 1) - 1),
    page_count: normalized.page_count,
    accepted_count: filledFields.length,
    filled_fields: [...new Set(filledFields)],
    rejected_questions: rejected,
    document_kind_declared: documentKind(adaptive.document.kind),
    document_kind_resolved: normalized.kind,
    document_kind_reason: "ai_direct_form",
    verification_protocol: REQUEST_PROFILE,
    activation_archive_count: 0,
  };
  const validated = appendComparisonPrecisionIssues(applyPdfFieldValidation(normalized));
  return applyPdfDataContract(validated);
}

function missingEssentialFields(normalized, parsed) {
  const adaptive = canonicalizeAdaptive(coerceAdaptive(parsed));
  const missing = [];
  for (const supply of adaptive.supplies || []) {
    if (!supply || !["electricity", "gas"].includes(supply.commodity)) continue;
    const isLight = supply.commodity === "electricity";
    const fields = [];
    if (finite(normalized[isLight ? "consumo_luce_kwh" : "consumo_gas_smc"]) === null) fields.push("annual_consumption");
    if (finite(normalized[isLight ? "prezzo_luce_eur_kwh" : "prezzo_gas_eur_smc"]) === null) fields.push("unit_price");
    if (finite(normalized[isLight ? "quota_fissa_vendita_luce_eur_anno" : "quota_fissa_vendita_gas_eur_anno"]) === null) fields.push("fixed_fee");
    if (fields.length) missing.push({ commodity: supply.commodity, fields });
  }
  return missing;
}

function safeEssentialRecoveryRow(row, commodity, purpose, rows = []) {
  if (!row || row.purpose !== purpose) return false;
  if (purpose === "annual_consumption") return Boolean(annualConsumptionCandidate(row, commodity));
  if (purpose === "period_consumption") return Boolean(periodConsumptionCandidate(row, commodity));
  if (purpose === "fixed_fee") return Boolean(fixedFeeCandidate(row, commodity));
  if (purpose === "unit_price") {
    const text = essentialRowText(row, true);
    if (!/(?:vendita|materia\s+(?:prima|energia|gas)|costo\s+materia)/.test(text)) return false;
    return Boolean(salePriceCandidate(row, commodity, rows));
  }
  return false;
}

function mergeEssentialRecoveryOutput(primaryParsed, recoveryParsed, missing) {
  const primary = canonicalizeAdaptive(coerceAdaptive(primaryParsed));
  const recovery = canonicalizeAdaptive(coerceAdaptive(recoveryParsed));
  const merged = JSON.parse(JSON.stringify(primary));
  const requestedByCommodity = new Map(missing.map((item) => [item.commodity, new Set(item.fields)]));
  for (const recoverySupply of recovery.supplies || []) {
    const requested = requestedByCommodity.get(recoverySupply?.commodity);
    if (!requested) continue;
    let target = (merged.supplies || []).find((item) => item?.commodity === recoverySupply.commodity);
    if (!target) {
      target = { commodity: recoverySupply.commodity, provider: recoverySupply.provider || null, offer_name: recoverySupply.offer_name || null, offer_code: recoverySupply.offer_code || null, fields: [] };
      merged.supplies.push(target);
    }
    if (!target.provider && recoverySupply.provider) target.provider = recoverySupply.provider;
    if (!target.offer_name && recoverySupply.offer_name) target.offer_name = recoverySupply.offer_name;
    if (!target.offer_code && recoverySupply.offer_code) target.offer_code = recoverySupply.offer_code;
    const recoveryRows = Array.isArray(recoverySupply.fields) ? recoverySupply.fields : [];
    for (const row of recoveryRows) {
      const requestedDirectly = requested.has(row?.purpose);
      const periodFallbackForAnnual = row?.purpose === "period_consumption" && requested.has("annual_consumption");
      if (!requestedDirectly && !periodFallbackForAnnual) continue;
      if (!safeEssentialRecoveryRow(row, recoverySupply.commodity, row.purpose, [...target.fields, ...recoveryRows])) continue;
      target.fields.push({ ...row, confidence: Math.max(95, Number(row.confidence ?? 95)) });
    }
  }
  return merged;
}

function essentialMissingCount(items) {
  return items.reduce((sum, item) => sum + item.fields.length, 0);
}

export async function extractPdfPureAi({
  filePath,
  filename = "documento.pdf",
  deadlineAt = null,
  transport = defaultTransport,
  fileUploadTransport = defaultFileUploadTransport,
  fileDeleteTransport = defaultFileDeleteTransport,
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.PDF_AI_PRIMARY_MODEL || PDF_PURE_AI_DEFAULT_MODEL,
  env = process.env,
} = {}) {
  if (!apiKey) throw new Error("openai_missing_api_key");
  if (!filePath) throw new Error("pure_ai_file_path_required");
  const startedAt = Date.now();
  const configuredTimeout = boundedTimeout(env.PDF_AI_TIMEOUT_MS || env.PDF_AI_DIRECT_TIMEOUT_MS);
  const remainingBudget = () => deadlineAt ? Number(deadlineAt) - Date.now() - 2_000 : configuredTimeout - (Date.now() - startedAt);
  if (!Number.isFinite(remainingBudget()) || remainingBudget() < 8_000) throw new Error("openai_insufficient_time_budget");

  const fileStats = await fs.stat(filePath);
  const fileIdThreshold = boundedFileIdThreshold(env.PDF_AI_FILE_ID_THRESHOLD_BYTES);
  const useOpenAiFileId = Number(fileStats.size || 0) >= fileIdThreshold;
  let openAiFileId = "";
  let openAiFileUploadMs = 0;
  let openAiFileDeleted = null;
  let openAiFileDeleteError = null;
  let normalizedResult = null;
  let analysisError = null;
  let requestBuildMs = 0;
  const openaiStartedAt = Date.now();

  try {
    if (useOpenAiFileId) {
      const uploadTimeoutMs = Math.min(boundedFileUploadTimeout(env.PDF_AI_FILE_UPLOAD_TIMEOUT_MS), remainingBudget() - 8_000);
      if (!Number.isFinite(uploadTimeoutMs) || uploadTimeoutMs < 5_000) throw new Error("openai_insufficient_time_budget");
      const controller = new AbortController();
      let timeoutId;
      const uploadStartedAt = Date.now();
      try {
        const timeoutPromise = new Promise((_, reject) => { timeoutId = setTimeout(() => { controller.abort(); reject(new Error("openai_file_upload_timeout")); }, uploadTimeoutMs); });
        const uploadRaw = await Promise.race([fileUploadTransport({ filePath, filename, apiKey, signal: controller.signal }), timeoutPromise]);
        const uploadBody = await openAiFileTransportBody(uploadRaw, "upload");
        openAiFileId = compact(uploadBody?.id, 180);
        if (!openAiFileId) throw new Error("openai_file_upload_invalid_response");
      } finally {
        clearTimeout(timeoutId);
        openAiFileUploadMs = Date.now() - uploadStartedAt;
      }
    }

    const buildStartedAt = Date.now();
    const request = await buildPdfPureAiRequest({ filePath: useOpenAiFileId ? null : filePath, fileId: openAiFileId || null, filename, model });
    requestBuildMs = Date.now() - buildStartedAt;
    const effectiveTimeout = Math.min(configuredTimeout, remainingBudget());
    if (!Number.isFinite(effectiveTimeout) || effectiveTimeout < 8_000) throw new Error("openai_insufficient_time_budget");
    const controller = new AbortController();
    let timeoutId;
    try {
      const timeoutPromise = new Promise((_, reject) => { timeoutId = setTimeout(() => { controller.abort(); reject(new Error("openai_timeout")); }, effectiveTimeout); });
      const raw = await Promise.race([transport({ request, apiKey, signal: controller.signal, attempt: 1, profile: REQUEST_PROFILE }), timeoutPromise]);
      const body = await transportBody(raw);
      if (body?.status === "incomplete") throw new Error(`openai_incomplete:${body?.incomplete_details?.reason || "unknown"}`);
      const outputText = responseOutputText(body);
      if (!outputText) throw new Error("openai_empty_output");
      const parsedOutput = JSON.parse(outputText);
      const primaryResponseId = compact(body?.id, 160) || null;
      let finalParsedOutput = parsedOutput;
      let recoveryOutput = null;
      let recoveryResponseId = null;
      let recoveryError = null;
      let recoveryAttempted = false;
      let recoveryAccepted = false;
      let openaiAttempts = 1;
      let now = Date.now();
      normalizedResult = normalizePureAiOutput(parsedOutput, {
        model,
        responseId: primaryResponseId,
        transportMode: useOpenAiFileId ? "openai_file_id" : "pdf_originale",
        timings: { request_build_ms: requestBuildMs, openai_file_upload_ms: openAiFileUploadMs, openai_ms: now - openaiStartedAt, total_ms: now - startedAt, openai_attempts: 1, input_file_bytes: Number(fileStats.size || 0), file_id_threshold_bytes: fileIdThreshold },
      });

      const missingBefore = missingEssentialFields(normalizedResult, parsedOutput);
      if (essentialMissingCount(missingBefore) > 0) {
        recoveryAttempted = true;
        const recoveryBudget = Math.min(18_000, remainingBudget());
        if (Number.isFinite(recoveryBudget) && recoveryBudget >= 8_000) {
          let recoveryTimeoutId;
          const recoveryController = new AbortController();
          try {
            const recoveryRequest = await buildPdfEssentialRecoveryRequest({ filePath: useOpenAiFileId ? null : filePath, fileId: openAiFileId || null, filename, model, missing: missingBefore });
            const recoveryTimeout = new Promise((_, reject) => { recoveryTimeoutId = setTimeout(() => { recoveryController.abort(); reject(new Error("openai_essential_recovery_timeout")); }, recoveryBudget); });
            const recoveryRaw = await Promise.race([transport({ request: recoveryRequest, apiKey, signal: recoveryController.signal, attempt: 2, profile: ESSENTIAL_RECOVERY_PROFILE }), recoveryTimeout]);
            const recoveryBody = await transportBody(recoveryRaw);
            openaiAttempts = 2;
            if (recoveryBody?.status === "incomplete") throw new Error(`openai_essential_recovery_incomplete:${recoveryBody?.incomplete_details?.reason || "unknown"}`);
            const recoveryText = responseOutputText(recoveryBody);
            if (!recoveryText) throw new Error("openai_essential_recovery_empty_output");
            recoveryOutput = JSON.parse(recoveryText);
            recoveryResponseId = compact(recoveryBody?.id, 160) || null;
            const mergedOutput = mergeEssentialRecoveryOutput(parsedOutput, recoveryOutput, missingBefore);
            now = Date.now();
            const recoveredResult = normalizePureAiOutput(mergedOutput, {
              model,
              responseId: primaryResponseId,
              transportMode: useOpenAiFileId ? "openai_file_id" : "pdf_originale",
              timings: { request_build_ms: requestBuildMs, openai_file_upload_ms: openAiFileUploadMs, openai_ms: now - openaiStartedAt, total_ms: now - startedAt, openai_attempts: 2, input_file_bytes: Number(fileStats.size || 0), file_id_threshold_bytes: fileIdThreshold },
            });
            const missingAfter = missingEssentialFields(recoveredResult, mergedOutput);
            const recoveredPeriodConsumption = missingBefore.some((item) => {
              if (!item.fields.includes("annual_consumption")) return false;
              const field = item.commodity === "electricity" ? "consumo_periodo_luce_kwh" : "consumo_periodo_gas_smc";
              return finite(normalizedResult?.[field]) === null && finite(recoveredResult?.[field]) !== null;
            });
            if (essentialMissingCount(missingAfter) < essentialMissingCount(missingBefore) || recoveredPeriodConsumption) {
              normalizedResult = recoveredResult;
              finalParsedOutput = mergedOutput;
              recoveryAccepted = true;
            } else recoveryError = "essential_recovery_no_improvement";
          } catch (error) {
            recoveryError = compact(error?.message || error, 220) || "essential_recovery_failed";
          } finally {
            clearTimeout(recoveryTimeoutId);
          }
        } else recoveryError = "essential_recovery_insufficient_time_budget";
      }

      now = Date.now();
      const missingAfter = missingEssentialFields(normalizedResult, finalParsedOutput);
      normalizedResult.ai = {
        ...(normalizedResult.ai || {}),
        request_profile: REQUEST_PROFILE,
        recovery_attempted: recoveryAttempted,
        recovered_from: recoveryAccepted ? ESSENTIAL_RECOVERY_PROFILE : null,
        recovery_response_id: recoveryResponseId,
        recovery_error: recoveryError,
        essential_missing_before: missingBefore,
        essential_missing_after: missingAfter,
        openai_attempts: openaiAttempts,
        retry_count: 0,
      };
      normalizedResult._reader_trace = {
        trace_version: "reader-trace-v3-compact-form",
        captured_at: new Date(now).toISOString(),
        response_id: primaryResponseId,
        recovery_response_id: recoveryResponseId,
        request_profile: REQUEST_PROFILE,
        recovery_profile: recoveryAttempted ? ESSENTIAL_RECOVERY_PROFILE : null,
        raw_output_chars: outputText.length,
        raw_ai: finalParsedOutput,
        primary_raw_ai: parsedOutput,
        recovery_raw_ai: recoveryOutput,
      };
    } finally { clearTimeout(timeoutId); }
  } catch (error) { analysisError = error; }
  finally {
    if (openAiFileId) {
      const controller = new AbortController();
      let timeoutId;
      try {
        const timeoutMs = boundedFileDeleteTimeout(env.PDF_AI_FILE_DELETE_TIMEOUT_MS);
        const timeoutPromise = new Promise((_, reject) => { timeoutId = setTimeout(() => { controller.abort(); reject(new Error("openai_file_delete_timeout")); }, timeoutMs); });
        const deleteRaw = await Promise.race([fileDeleteTransport({ fileId: openAiFileId, apiKey, signal: controller.signal }), timeoutPromise]);
        const deleteBody = await openAiFileTransportBody(deleteRaw, "delete");
        openAiFileDeleted = deleteBody?.deleted !== false;
        if (!openAiFileDeleted) throw new Error("openai_file_delete_not_confirmed");
      } catch (error) {
        openAiFileDeleted = false;
        openAiFileDeleteError = compact(error?.message || error, 180) || "openai_file_delete_failed";
      } finally { clearTimeout(timeoutId); }
    }
  }

  if (normalizedResult) {
    normalizedResult.ai = {
      ...(normalizedResult.ai || {}),
      openai_file_upload_ms: openAiFileUploadMs,
      input_file_bytes: Number(fileStats.size || 0),
      file_id_threshold_bytes: fileIdThreshold,
      openai_file_deleted: openAiFileDeleted,
      openai_file_delete_error: openAiFileDeleteError,
    };
    return normalizedResult;
  }
  throw analysisError || new Error("openai_invalid_output");
}
