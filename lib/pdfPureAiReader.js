import fs from "node:fs/promises";
import { applyPdfDataContract } from "./pdfDataContract.js";
import { applyPdfFieldValidation } from "./pdfFieldValidation.js";


export const PDF_PURE_AI_READER_VERSION = "pure-ai-native-pdf-v1.0.14";
export const PDF_PURE_AI_DEFAULT_MODEL = "gpt-4.1-2025-04-14";

const QUESTION_SPECS = Object.freeze([
  { id: "fornitore", field: "fornitore", kind: "text", question: "Qual è il venditore che emette il documento? Copia il nome esatto e non la società del distributore." },
  { id: "fornitore_luce", field: "fornitore_luce", kind: "text", question: "Qual è il venditore della fornitura elettrica? Copia il nome esatto." },
  { id: "fornitore_gas", field: "fornitore_gas", kind: "text", question: "Qual è il venditore della fornitura gas? Copia il nome esatto." },
  { id: "customer_type", field: "customer_type", kind: "customer_type", question: "Il documento riguarda un cliente domestico/privato oppure business/azienda? Riporta la dicitura che lo dimostra." },
  { id: "intestatario", field: "intestatario", kind: "text", question: "Qual è il nome o la ragione sociale dell'intestatario del contratto?" },
  { id: "codice_fiscale", field: "codice_fiscale", kind: "code", question: "Qual è il codice fiscale o la partita IVA dell'intestatario, escludendo sempre quella del venditore?" },
  { id: "codice_cliente", field: "codice_cliente", kind: "code", question: "Qual è il codice cliente comune riportato per l'intestatario?" },
  { id: "codice_cliente_luce", field: "codice_cliente_luce", kind: "code", question: "Qual è il codice cliente riferito specificamente alla luce?" },
  { id: "codice_cliente_gas", field: "codice_cliente_gas", kind: "code", question: "Qual è il codice cliente riferito specificamente al gas?" },

  { id: "indirizzo_fornitura_luce", field: "indirizzo_fornitura_luce", kind: "text", question: "Qual è l'indirizzo completo del punto di fornitura elettrica?" },
  { id: "pod", field: "pod", kind: "code", question: "Qual è il POD della fornitura elettrica? Copialo carattere per carattere." },
  { id: "potenza_impegnata_kw", field: "potenza_impegnata_kw", kind: "number", question: "Qual è la potenza impegnata in kW?" },
  { id: "potenza_disponibile_kw", field: "potenza_disponibile_kw", kind: "number", question: "Qual è la potenza disponibile in kW?" },
  { id: "consumo_luce_kwh", field: "consumo_luce_kwh", kind: "number", question: "Esiste un consumo totale della luce riferito realmente a 12 mesi completi? Non usare consumi fatturati, consumi del mese, consumi da inizio fornitura con meno di 12 mesi, esempi, proiezioni o singole fasce. Se i 12 mesi non sono dimostrati usa found=false." },
  { id: "consumo_luce_f1_kwh", field: "consumo_luce_f1_kwh", kind: "number", band: "f1", annualBand: true, question: "Qual è il consumo annuo luce della sola fascia F1, riferito a 12 mesi completi? Accettalo soltanto se la riga o tabella dichiara Consumo annuo/ultimi 12 mesi. Non usare il consumo del periodo." },
  { id: "consumo_luce_f2_kwh", field: "consumo_luce_f2_kwh", kind: "number", band: "f2", annualBand: true, question: "Qual è il consumo annuo luce della sola fascia F2, riferito a 12 mesi completi? Accettalo soltanto se la riga o tabella dichiara Consumo annuo/ultimi 12 mesi. Non usare il consumo del periodo." },
  { id: "consumo_luce_f3_kwh", field: "consumo_luce_f3_kwh", kind: "number", band: "f3", annualBand: true, question: "Qual è il consumo annuo luce della sola fascia F3, riferito a 12 mesi completi? Accettalo soltanto se la riga o tabella dichiara Consumo annuo/ultimi 12 mesi. Non usare il consumo del periodo." },
  { id: "consumo_luce_f23_kwh", field: "consumo_luce_f23_kwh", kind: "number", band: "f23", annualBand: true, question: "Qual è il consumo annuo luce combinato F23, riferito a 12 mesi completi, se è stampato? Non sommare tu F2 e F3: riporta soltanto un valore F23 esplicito." },
  { id: "prezzo_luce_eur_kwh", field: "prezzo_luce_eur_kwh", kind: "number", question: "Qual è il prezzo contrattuale unico o monorario della componente commerciale energia in EUR/kWh? Se esiste un prezzo F0/monorario esplicito, riporta qui soltanto quel numero. Non inserire insieme F1/F2/F3. Non usare costo medio, costo unitario medio, spesa totale, stime annuali, esempi di calcolo, rete, oneri o imposte. Se esistono soltanto prezzi per fasce senza F0, usa found=false." },
  { id: "prezzo_luce_f0_eur_kwh", field: "prezzo_luce_f0_eur_kwh", kind: "number", band: "f0", question: "Qual è il prezzo contrattuale monorario F0 in EUR/kWh? Riporta un solo numero in value_number e la riga completa nelle evidence. Non includere F1/F2/F3." },
  { id: "prezzo_luce_f1_eur_kwh", field: "prezzo_luce_f1_eur_kwh", kind: "number", band: "f1", question: "Qual è il prezzo contrattuale F1 in EUR/kWh? Riporta un solo numero in value_number e la riga completa nelle evidence." },
  { id: "prezzo_luce_f2_eur_kwh", field: "prezzo_luce_f2_eur_kwh", kind: "number", band: "f2", question: "Qual è il prezzo contrattuale F2 in EUR/kWh? Riporta un solo numero in value_number e la riga completa nelle evidence." },
  { id: "prezzo_luce_f3_eur_kwh", field: "prezzo_luce_f3_eur_kwh", kind: "number", band: "f3", question: "Qual è il prezzo contrattuale F3 in EUR/kWh? Riporta un solo numero in value_number e la riga completa nelle evidence." },
  { id: "prezzo_luce_f23_eur_kwh", field: "prezzo_luce_f23_eur_kwh", kind: "number", band: "f23", question: "Qual è il prezzo contrattuale combinato F23 in EUR/kWh, se presente? Riporta un solo numero in value_number e la riga completa nelle evidence." },
  { id: "quota_fissa_vendita_luce", field: "quota_fissa_vendita_luce_eur_anno", kind: "fixed", question: "Qual è la quota fissa commerciale di vendita luce? Nelle schede sintetiche considera il Corrispettivo annuo riportato sotto CONDIZIONI ECONOMICHE / CORRISPETTIVI DEFINITI DAL VENDITORE. Escludi rete, trasporto, contatore e oneri. Indica period=month o year soltanto se €/mese, mensile, €/anno o annuale sono stampati nella stessa evidenza; altrimenti usa found=false." },
  { id: "nome_offerta_luce", field: "nome_offerta_luce", kind: "text", question: "Qual è il nome commerciale esatto dell'offerta luce? In una scheda sintetica usa il titolo/nome dell'offerta, non una descrizione generica." },
  { id: "codice_offerta_luce", field: "codice_offerta_luce", kind: "offer_code", question: "Qual è il codice offerta luce? Copialo carattere per carattere." },
  { id: "tipo_prezzo_luce", field: "tipo_prezzo_luce", kind: "price_type", question: "Le condizioni economiche luce dichiarano prezzo fisso, variabile o ibrido? Riporta solo ciò che è esplicitamente indicato." },
  { id: "indice_riferimento_luce", field: "indice_riferimento_luce", kind: "text", question: "Qual è l'indice contrattuale luce, per esempio PUN o PUN Index GME? Non usare valori storici mostrati come esempio." },
  { id: "spread_luce_eur_kwh", field: "spread_luce_eur_kwh", kind: "number", question: "Qual è lo spread/corrispettivo fisso della formula luce esplicitamente indicato in EUR/kWh? Non ricavarlo per sottrazione." },
  { id: "moltiplicatore_indice_luce", field: "moltiplicatore_indice_luce", kind: "number", multiplier: true, question: "Nella formula luce l'indice è moltiplicato per un coefficiente esplicito, per esempio PUN × 1,1? Riporta soltanto il coefficiente numerico. Se non è stampato usa found=false; non assumere 1." },
  { id: "periodicita_aggiornamento_indice_luce", field: "periodicita_aggiornamento_indice_luce", kind: "text", question: "Qual è la periodicità contrattuale di aggiornamento dell'indice luce?" },
  { id: "struttura_prezzo_luce", field: "struttura_prezzo_luce", kind: "text", question: "La struttura del prezzo luce è monoraria oppure per fasce F1/F2/F3?" },
  { id: "formula_prezzo_luce", field: "formula_prezzo_luce", kind: "text", question: "Qual è la formula contrattuale completa del prezzo luce stampata nel documento? Non usare formule di esempio o di rinnovo futuro come formula dell'offerta corrente." },
  { id: "decorrenza_condizioni_economiche_luce", field: "decorrenza_condizioni_economiche_luce", kind: "date", question: "Qual è la data di decorrenza o inizio validità delle condizioni economiche luce?" },
  { id: "scadenza_condizioni_economiche_luce", field: "scadenza_condizioni_economiche_luce", kind: "date", question: "Qual è la data di scadenza o fine validità delle condizioni economiche luce?" },

  { id: "indirizzo_fornitura_gas", field: "indirizzo_fornitura_gas", kind: "text", question: "Qual è l'indirizzo completo del punto di fornitura gas?" },
  { id: "pdr", field: "pdr", kind: "code", question: "Qual è il PDR della fornitura gas? Copialo carattere per carattere." },
  { id: "consumo_gas_smc", field: "consumo_gas_smc", kind: "number", question: "Esiste un consumo totale gas riferito realmente a 12 mesi completi in Smc? Non usare consumi fatturati, consumi del periodo, consumi da inizio fornitura con meno di 12 mesi, esempi o proiezioni. Se i 12 mesi non sono dimostrati usa found=false." },
  { id: "prezzo_gas_eur_smc", field: "prezzo_gas_eur_smc", kind: "number", question: "Qual è il costo commerciale totale per consumi gas in EUR/Smc applicabile alle condizioni correnti? Nelle schede sintetiche preferisci il riepilogo Costo per consumi/Corrispettivo per il consumo definito dal venditore, anche quando somma più componenti commerciali. Non usare costo medio, spesa stimata, rete, oneri, imposte, valori storici o condizioni di rinnovo futuro." },
  { id: "quota_fissa_vendita_gas", field: "quota_fissa_vendita_gas_eur_anno", kind: "fixed", question: "Qual è la quota fissa commerciale di vendita gas? Escludi rete, distribuzione, contatore e oneri. Indica period=month o year soltanto se la periodicità è stampata nella stessa evidenza; altrimenti usa found=false." },
  { id: "nome_offerta_gas", field: "nome_offerta_gas", kind: "text", question: "Qual è il nome commerciale esatto dell'offerta gas? In una scheda sintetica usa il titolo/nome dell'offerta, non una descrizione generica." },
  { id: "codice_offerta_gas", field: "codice_offerta_gas", kind: "offer_code", question: "Qual è il codice offerta gas? Copialo carattere per carattere." },
  { id: "tipo_prezzo_gas", field: "tipo_prezzo_gas", kind: "price_type", question: "Le condizioni economiche gas dichiarano prezzo fisso, variabile o ibrido? Riporta solo ciò che è esplicitamente indicato." },
  { id: "indice_riferimento_gas", field: "indice_riferimento_gas", kind: "text", question: "Qual è l'indice contrattuale gas, per esempio PSV? Non usare valori storici mostrati come esempio." },
  { id: "spread_gas_eur_smc", field: "spread_gas_eur_smc", kind: "number", question: "Qual è lo spread/corrispettivo della formula gas esplicitamente indicato in EUR/Smc? Non ricavarlo per sottrazione." },
  { id: "moltiplicatore_indice_gas", field: "moltiplicatore_indice_gas", kind: "number", multiplier: true, question: "Nella formula gas l'indice è moltiplicato per un coefficiente esplicito? Riporta soltanto il coefficiente numerico. Se non è stampato usa found=false; non assumere 1." },
  { id: "periodicita_aggiornamento_indice_gas", field: "periodicita_aggiornamento_indice_gas", kind: "text", question: "Qual è la periodicità contrattuale di aggiornamento dell'indice gas?" },
  { id: "formula_prezzo_gas", field: "formula_prezzo_gas", kind: "text", question: "Qual è la formula contrattuale completa del prezzo gas stampata nel documento? Non usare formule di esempio o valori del solo periodo fatturato." },
  { id: "decorrenza_condizioni_economiche_gas", field: "decorrenza_condizioni_economiche_gas", kind: "date", question: "Qual è la data di decorrenza o inizio validità delle condizioni economiche gas?" },
  { id: "scadenza_condizioni_economiche_gas", field: "scadenza_condizioni_economiche_gas", kind: "date", question: "Qual è la data di scadenza o fine validità delle condizioni economiche gas?" },
]);

export const PDF_PURE_AI_QUESTION_IDS = Object.freeze(QUESTION_SPECS.map((spec) => spec.id));
const QUESTION_BY_ID = new Map(QUESTION_SPECS.map((spec) => [spec.id, spec]));

const ANSWER_SOURCE_ROLES = Object.freeze([
  "identity", "customer_data", "annual_total", "period_total", "contract_term",
  "billed_rate", "sales_component_rate", "average_cost", "regulated", "example", "unknown",
]);

const ANSWER_CERTAINTY = Object.freeze(["certain", "derived", "review", "not_available"]);

// La richiesta OpenAI usa una sola chiamata e obbliga il modello a rispondere
// separatamente a ogni dato economico. Il normalizzatore continua ad accettare
// anche il precedente schema compatto per i replay già archiviati.
const REQUEST_QUESTION_IDS = Object.freeze([
  // Prezzo luce: prima priorità.
  "prezzo_luce_eur_kwh",
  "prezzo_luce_f0_eur_kwh",
  "prezzo_luce_f1_eur_kwh",
  "prezzo_luce_f2_eur_kwh",
  "prezzo_luce_f3_eur_kwh",
  "prezzo_luce_f23_eur_kwh",
  "quota_fissa_vendita_luce",
  "tipo_prezzo_luce",
  "indice_riferimento_luce",
  "spread_luce_eur_kwh",
  "moltiplicatore_indice_luce",
  "periodicita_aggiornamento_indice_luce",
  "struttura_prezzo_luce",
  "formula_prezzo_luce",
  // Consumo e identificazione luce.
  "consumo_luce_kwh",
  "consumo_luce_f1_kwh",
  "consumo_luce_f2_kwh",
  "consumo_luce_f3_kwh",
  "consumo_luce_f23_kwh",
  "nome_offerta_luce",
  "fornitore_luce",
  // Prezzo gas: stessa logica, separata dalla luce.
  "prezzo_gas_eur_smc",
  "quota_fissa_vendita_gas",
  "tipo_prezzo_gas",
  "indice_riferimento_gas",
  "spread_gas_eur_smc",
  "moltiplicatore_indice_gas",
  "periodicita_aggiornamento_indice_gas",
  "formula_prezzo_gas",
  "consumo_gas_smc",
  "nome_offerta_gas",
  "fornitore_gas",
  "fornitore",
]);

export const PDF_PURE_AI_REQUEST_QUESTION_IDS = REQUEST_QUESTION_IDS;
const REQUEST_QUESTION_SPECS = Object.freeze(REQUEST_QUESTION_IDS.map((id) => QUESTION_BY_ID.get(id)));
const REQUEST_PROFILE = "forced_economic_questions_v1";

const REQUEST_ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "question_id", "found", "value_text", "value_number", "unit", "period",
    "page", "label", "evidence", "confidence",
  ],
  properties: {
    question_id: { type: "string", enum: REQUEST_QUESTION_IDS },
    found: { type: "boolean" },
    value_text: { type: ["string", "null"] },
    value_number: { type: ["number", "null"] },
    unit: { type: ["string", "null"] },
    period: { type: "string", enum: ["none", "month", "year"] },
    page: { type: ["integer", "null"], minimum: 1 },
    label: { type: ["string", "null"], maxLength: 180 },
    evidence: { type: ["string", "null"], maxLength: 650 },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
  },
};

const REQUEST_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["document", "answers"],
  properties: {
    document: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "commodity", "customer_type", "page_count"],
      properties: {
        kind: { type: "string", enum: ["bill", "offer_sheet", "unknown"] },
        commodity: { type: "string", enum: ["electricity", "gas", "dual", "unknown"] },
        customer_type: { type: "string", enum: ["consumer", "business", "unknown"] },
        page_count: { type: ["integer", "null"], minimum: 1 },
      },
    },
    answers: {
      type: "array",
      minItems: REQUEST_QUESTION_SPECS.length,
      maxItems: REQUEST_QUESTION_SPECS.length,
      items: REQUEST_ANSWER_SCHEMA,
    },
  },
};

const SYSTEM_PROMPT = `Sei il lettore visuale di OffertaLogica, specializzato nelle condizioni economiche di bollette e schede luce/gas italiane.

OBIETTIVO
Trova prima di tutto prezzo luce/gas, quota fissa di vendita e consumo annuo. Analizza tutte le pagine e rispondi a ogni domanda elencata, esattamente una volta e nello stesso ordine. Quando un dato non è presente o non è dimostrato, usa found=false: non omettere la domanda.

REGOLE OBBLIGATORIE
- Tratta luce e gas separatamente, anche nei documenti dual.
- Copia solo dati visibili. Non inventare, stimare, sommare fasce o ricavare spread per sottrazione.
- evidence deve riportare la riga completa o poche righe contigue che dimostrano valore, unità e significato; page è la pagina visiva.
- value_text è il valore letterale; value_number è la normalizzazione numerica dello stesso valore.
- Prezzo luce: cerca il prezzo unitario della sola componente/spesa di vendita energia in EUR/kWh. Nelle bollette accetta anche la riga specifica “di cui spesa per la vendita di energia elettrica” quando contiene il suo prezzo unitario, anche se la colonna o il riquadro è intitolato “Prezzo medio”. Non usare il prezzo medio totale della bolletta, quota consumi complessiva, rete, oneri, imposte o importi in euro.
- Prezzo gas: applica la stessa regola alla sola spesa/componente di vendita gas in EUR/Smc. Non usare il prezzo medio totale della bolletta, rete, oneri, imposte o importi complessivi.
- Schede/condizioni economiche: usa il prezzo contrattuale corrente, oppure indice, moltiplicatore e spread espliciti. Escludi esempi, valori storici e condizioni di rinnovo futuro.
- Prezzi per fasce: riporta F0/F1/F2/F3/F23 soltanto nei rispettivi campi. Non calcolare medie.
- Quota fissa: usa soltanto vendita/commercializzazione/corrispettivo definito dal venditore. Escludi rete, distribuzione, contatore, potenza e oneri. period=month o year solo quando la periodicità compare nella stessa evidenza.
- Consumo annuo: accetta soltanto consumo annuo/ultimi 12 mesi/dodici mesi. Escludi consumi fatturati, del periodo, mensili, da inizio fornitura inferiore a 12 mesi, esempi e proiezioni.
- Una risposta parziale è valida, ma ogni domanda deve comunque essere presente nell'array answers.
- Restituisci soltanto JSON conforme allo schema.`;

const USER_PROMPT = `Rispondi alle seguenti domande nello stesso ordine. Inserisci sempre una voce answers per ciascun question_id; usa found=false e valori null quando il dato non è dimostrato.\n\n${REQUEST_QUESTION_SPECS
  .map((spec, index) => `${index + 1}. ${spec.id}: ${spec.question}`)
  .join("\n")}`;

function compact(value, maxLength = 600) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
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
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
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
  return fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
    signal,
  });
}

async function defaultFileDeleteTransport({ fileId, apiKey, signal }) {
  return fetch(`https://api.openai.com/v1/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
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

export async function buildPdfPureAiRequest({
  filePath,
  fileId = null,
  filename = "documento.pdf",
  model = process.env.PDF_AI_PRIMARY_MODEL || PDF_PURE_AI_DEFAULT_MODEL,
  maxOutputTokens = null,
} = {}) {
  if (!filePath && !fileId) throw new Error("pure_ai_file_path_required");
  let fileInput;
  if (fileId) {
    fileInput = { type: "input_file", file_id: String(fileId) };
  } else {
    const bytes = await fs.readFile(filePath);
    fileInput = {
      type: "input_file",
      filename: filename || "documento.pdf",
      file_data: `data:application/pdf;base64,${bytes.toString("base64")}`,
    };
  }
  return {
    model,
    store: false,
    temperature: 0,
    max_output_tokens: Number(maxOutputTokens || 4_000),
    input: [
      { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
      {
        role: "user",
        content: [
          fileInput,
          { type: "input_text", text: USER_PROMPT },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "offertalogica_forced_economic_questions",
        description: "Dati minimi verificabili per confrontare bollette e offerte luce/gas",
        strict: true,
        schema: REQUEST_OUTPUT_SCHEMA,
      },
    },
  };
}

function parseLocaleNumber(value) {
  const raw = compact(value, 100).replace(/[^0-9,.-]/g, "");
  if (!raw || !/\d/.test(raw)) return null;
  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  let normalized = raw;
  if (comma >= 0 && dot >= 0) normalized = comma > dot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  else if (comma >= 0) normalized = raw.replace(/\./g, "").replace(",", ".");
  else if (dot >= 0) {
    const decimals = raw.length - dot - 1;
    normalized = decimals === 3 && Number(raw.replace(/\./g, "")) > 20 ? raw.replace(/\./g, "") : raw;
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeCode(field, value) {
  const text = compact(value, 140).toUpperCase();
  if (["codice_offerta_luce", "codice_offerta_gas"].includes(field)) return text.replace(/\s+/g, "");
  if (field === "pdr") return text.replace(/\D/g, "");
  return text.replace(/[^A-Z0-9]/g, "");
}

function normalizePriceType(value) {
  const text = semanticText(value, 180);
  if (!text) return null;

  const canonical = text
    .replace(/[,:;|()[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(?:prezzo\s+)?fiss\w*$/.test(canonical)) return "fisso";
  if (/^(?:prezzo\s+)?variabil\w*$/.test(canonical)) return "variabile";
  if (/^(?:prezzo\s+)?(?:ibrid\w*|hybrid)$/.test(canonical)) return "ibrido";

  const withoutNegations = canonical
    .replace(/\bnon\s+(?:e\s+)?(?:un\s+)?(?:prezzo\s+)?fiss\w*\b/g, " ")
    .replace(/\bnon\s+(?:e\s+)?(?:un\s+)?(?:prezzo\s+)?variabil\w*\b/g, " ")
    .replace(/\bnon\s+(?:e\s+)?(?:un\s+)?(?:prezzo\s+)?(?:ibrid\w*|hybrid)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const hybrid = /\b(?:ibrid\w*|hybrid)\b/.test(withoutNegations);
  if (hybrid) return "ibrido";

  const fixedExplicit = /\b(?:prezzo|tipologia|struttura|offerta)\s+(?:a\s+)?(?:prezzo\s+)?fiss\w*\b/.test(withoutNegations);
  const variableExplicit = /\b(?:prezzo|tipologia|struttura|offerta)\s+(?:a\s+)?(?:prezzo\s+)?variabil\w*\b/.test(withoutNegations);
  if (fixedExplicit && variableExplicit) return null;
  if (fixedExplicit) return "fisso";
  if (variableExplicit) return "variabile";

  const fixed = /\bfiss\w*\b/.test(withoutNegations);
  const variable = /\bvariabil\w*\b/.test(withoutNegations);
  if (fixed && variable) return null;
  if (fixed) return "fisso";
  if (variable) return "variabile";
  return null;
}

function normalizeCustomerType(value) {
  const text = compact(value, 120).toLowerCase();
  if (/business|azienda|impresa|altri\s+usi|condominio/.test(text)) return "business";
  if (/consumer|privato|domestic|residente|non\s+residente/.test(text)) return "privato";
  return null;
}

function normalizeIsoDate(value) {
  const text = compact(value, 100);
  let match = text.match(/\b((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
  match = text.match(/\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.]((?:19|20)\d{2})\b/);
  return match ? `${match[3]}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}` : null;
}

function semanticText(value, maxLength = 1400) {
  return compact(value, maxLength)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function answerSemanticText(answer) {
  // Il label è utile solo quando è l'etichetta reale del documento. I vecchi
  // label tecnici (per esempio "prezzo_luce_eur_kwh") non devono creare
  // riscontri semantici artificiali.
  const rawLabel = compact(answer?.label, 220);
  const safeLabel = PDF_PURE_AI_QUESTION_IDS.includes(rawLabel) ? "" : rawLabel;
  return semanticText([safeLabel, answer?.evidence, answer?.value_text, answer?.unit].filter(Boolean).join(" | "));
}

function inferSourceRole(answer) {
  const text = answerSemanticText(answer);
  if (!text) return "unknown";
  const saleSpecificAverage = /\b(costo|prezzo|spesa)\s+medi[oa]\b|\bmedi[oa]\s+unitari[oa]\b/.test(text)
    && /\b(?:di\s+cui\s+)?spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?(?:energia(?:\s+elettrica)?|gas(?:\s+naturale)?)\b/.test(text)
    && /\b(?:kwh|smc)\b/.test(text);
  if (saleSpecificAverage) return "sales_component_rate";
  if (/\b(costo|prezzo|spesa)\s+medi[oa]\b|\bcosto\s+unitario\s+(?:della|del|di)\b|\bcosto\s+unitario\s+medi[oa]\b/.test(text)) return "average_cost";
  if (/\b(trasporto|distribuzione|gestione\s+contatore|oneri|impost[ae]|accis[ae]|iva|rete)\b/.test(text)) return "regulated";
  if (/\b(esempio|simulazione|stima\s+annua|spesa\s+annua\s+stimata|valori\s+recenti|valore\s+massimo|rinnovo\s+in\s+assenza)\b/.test(text)) return "example";
  if (/\b(da\s+inizio\s+fornitura|consum[oi]\s+fatturat[oi]|periodo\s+fatturat|nel\s+periodo|mese\s+di|consuntivo)\b/.test(text)) return "period_total";
  if (/\b(consum[oi]\s+annu(?:o|i|ale|ali)|ultim[oi]\s+12\s+mesi|dodici\s+mesi|12\s+mesi)\b/.test(text)) return "annual_total";
  if (
    /\b(?:codice|nome)\s+offerta\b/.test(text)
    || /\bcondizioni\s+economiche\b/.test(text)
    || /\bscheda\s+sintetica\b/.test(text)
    || /\bofferta\s+(?:valida|riservata)\b/.test(text)
    || /\bvalida\s+(?:dal|fino\s+al)\b/.test(text)
    || /\bdata\s+(?:di\s+)?(?:decorrenza|scadenza)\b/.test(text)
    || /\bdurata\s+(?:delle\s+)?condizioni\b/.test(text)
    || /\btipologia\s+(?:di\s+)?(?:offerta|prezzo)\b/.test(text)
    || /\bprezzo\s+(?:fiss[oa]|variabil[ei]|ibrid[oa])\b/.test(text)
    || /\bprezzo\s+(?:della\s+)?(?:componente\s+)?(?:energia|elettrica|gas|materia)\b/.test(text)
    || /\bcorrispettiv[oi]\b/.test(text)
    || /\bcommercializzazione\b/.test(text)
    || /\bquota\s+fiss[ao]\b/.test(text)
    || /\bvendita\s+(?:di\s+)?(?:energia|gas)\b/.test(text)
    || /\bmateria\s+(?:prima\s+)?(?:energia|gas)\b/.test(text)
    || /\bformula\s+prevista\b/.test(text)
    || /\bindice(?:\s+di\s+riferimento)?\b/.test(text)
    || /\bspread\b/.test(text)
    || /\bprodotto\s+attivo\b/.test(text)
    || /\bcodice\s+prodotto\b/.test(text)
    || /\bbox\s+dell[’'\s]?offerta\b/.test(text)
  ) return "contract_term";
  if (/\b(quota\s+energia\s+attiva|prezzo\s+applicato|fatturato\s+attuale)\b/.test(text)) return "billed_rate";
  return "unknown";
}

function sourceRole(answer) {
  return ANSWER_SOURCE_ROLES.includes(answer?.source_role) ? answer.source_role : inferSourceRole(answer);
}

function answerCertainty(answer) {
  return ANSWER_CERTAINTY.includes(answer?.certainty)
    ? answer.certainty
    : answer?.found === true ? "certain" : "not_available";
}

function answerUsable(answer, role) {
  if (typeof answer?.usable_for_comparison === "boolean") return answer.usable_for_comparison;
  return !["period_total", "average_cost", "regulated", "example", "unknown"].includes(role);
}

const LIGHT_BAND_PRICE_FIELDS = Object.freeze([
  "prezzo_luce_f0_eur_kwh",
  "prezzo_luce_f1_eur_kwh",
  "prezzo_luce_f2_eur_kwh",
  "prezzo_luce_f3_eur_kwh",
  "prezzo_luce_f23_eur_kwh",
]);

const LIGHT_BAND_CONSUMPTION_FIELDS = Object.freeze([
  "consumo_luce_f1_kwh",
  "consumo_luce_f2_kwh",
  "consumo_luce_f3_kwh",
  "consumo_luce_f23_kwh",
]);

const INDEX_MULTIPLIER_FIELDS = Object.freeze([
  "moltiplicatore_indice_luce",
  "moltiplicatore_indice_gas",
]);

function offerSheetContractRole(spec, answer, text, document, inferredRole) {
  if (document?.kind !== "offer_sheet" || !["unknown", "annual_total"].includes(inferredRole)) return inferredRole;
  const disqualifying = /\b(costo|prezzo|spesa)\s+medi[oa]\b|\bspesa\s+annua\s+stimat[ae]\b|\b(esempio|simulazione|valori\s+recenti|valore\s+massimo|rinnovo\s+in\s+assenza)\b|\b(trasporto|distribuzione|gestione\s+contatore|oneri|impost[ae]|accis[ae]|iva|rete)\b|\b(periodo\s+fatturat|fatturato\s+attuale)\b/.test(text);
  if (disqualifying) return inferredRole;

  const value = semanticText(answer?.value_text, 300);
  if (["nome_offerta_luce", "nome_offerta_gas"].includes(spec.field)) {
    const generic = /^(offerta|offerta\s+(luce|gas|energia)|energia\s+elettrica|gas\s+naturale)$/.test(value);
    if (value && !generic && text.includes(value)) return "contract_term";
  }
  if (["tipo_prezzo_luce", "tipo_prezzo_gas"].includes(spec.field)) {
    if (normalizePriceType(value) && /\b(?:fiss\w*|variabil\w*|ibrid\w*)/.test(text)) return "contract_term";
  }
  if (["quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno"].includes(spec.field)) {
    if (/\bcorrispettivo\s+annuo\b|\bquota\s+fiss[ao]\b|\bcommercializzazione\b/.test(text)
        && /€|\beur\b/.test(text)
        && /\banno\b|\bannuale\b|\bmese\b|\bmensile\b/.test(text)) return "contract_term";
  }
  if (["prezzo_luce_eur_kwh", ...LIGHT_BAND_PRICE_FIELDS].includes(spec.field)) {
    if (/\bkwh\b/.test(text)
        && (/\b(prezzo|corrispettivo|componente|consumo|energia)\b/.test(text) || /\bf(?:0|1|2|3|23)\b/.test(text))) {
      return "contract_term";
    }
  }
  if (spec.field === "prezzo_gas_eur_smc") {
    if (/\bsmc\b|standard\s*m(?:3|³)/.test(text)
        && /\b(prezzo|corrispettivo|componente|consumo|gas|materia|costo\s+per\s+consumi)\b/.test(text)) return "contract_term";
  }
  if (INDEX_MULTIPLIER_FIELDS.includes(spec.field)) {
    if (/\b(?:pun|psv|psbil|indice)\b/.test(text) && /(?:[x×*]|moltiplicat|coefficiente)/.test(text)) return "contract_term";
  }
  return inferredRole;
}

function comparisonCriticalField(field) {
  return [
    "consumo_luce_kwh", ...LIGHT_BAND_CONSUMPTION_FIELDS, "consumo_gas_smc",
    "prezzo_luce_eur_kwh", ...LIGHT_BAND_PRICE_FIELDS, "prezzo_gas_eur_smc",
    "quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno",
    "nome_offerta_luce", "nome_offerta_gas", "codice_offerta_luce", "codice_offerta_gas",
    "tipo_prezzo_luce", "tipo_prezzo_gas", "indice_riferimento_luce", "indice_riferimento_gas",
    "spread_luce_eur_kwh", "spread_gas_eur_smc", ...INDEX_MULTIPLIER_FIELDS,
    "formula_prezzo_luce", "formula_prezzo_gas",
    "decorrenza_condizioni_economiche_luce", "decorrenza_condizioni_economiche_gas",
    "scadenza_condizioni_economiche_luce", "scadenza_condizioni_economiche_gas",
  ].includes(field);
}

function comparisonEconomicField(field) {
  return [
    "consumo_luce_kwh", ...LIGHT_BAND_CONSUMPTION_FIELDS, "consumo_gas_smc",
    "prezzo_luce_eur_kwh", ...LIGHT_BAND_PRICE_FIELDS, "prezzo_gas_eur_smc",
    "quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno",
    "tipo_prezzo_luce", "tipo_prezzo_gas", "indice_riferimento_luce", "indice_riferimento_gas",
    "spread_luce_eur_kwh", "spread_gas_eur_smc", ...INDEX_MULTIPLIER_FIELDS,
    "formula_prezzo_luce", "formula_prezzo_gas",
  ].includes(field);
}

function semanticValidation(spec, answer, document = {}) {
  const text = answerSemanticText(answer);
  if (!text) return { accepted: false, reason: "semantic_evidence_missing" };
  const isOfferSheet = document?.kind === "offer_sheet";
  let role = sourceRole(answer);
  role = offerSheetContractRole(spec, answer, text, document, role);
  const certainty = answerCertainty(answer);
  const usable = answerUsable(answer, role);

  if (comparisonCriticalField(spec.field) && ["review", "not_available"].includes(certainty)) {
    return { accepted: false, reason: "semantic_answer_not_certain" };
  }

  if (LIGHT_BAND_CONSUMPTION_FIELDS.includes(spec.field)) {
    const explicitAnnual = /\b(consum[oi]\s+annu(?:o|i|ale|ali)|ultim[oi]\s+12\s+mesi|12\s+mesi|dodici\s+mesi)\b/.test(text);
    const contradictoryPeriod = /\b(da\s+inizio\s+fornitura|consum[oi]\s+fatturat[oi]|periodo\s+fatturat|nel\s+periodo|mese\s+di|bimestre|trimestre|consuntivo)\b/.test(text);
    const expectedBand = spec.band ? new RegExp(`\\b${spec.band}\\b`, "i").test(text) : false;
    if (contradictoryPeriod) return { accepted: false, reason: "semantic_band_consumption_not_annual" };
    if (role !== "annual_total" || !explicitAnnual || !expectedBand || !/\bkwh\b/.test(text)) {
      return { accepted: false, reason: "semantic_band_consumption_not_annual" };
    }
  }

  if (["consumo_luce_kwh", "consumo_gas_smc"].includes(spec.field)) {
    const explicitAnnual = /\b(consum[oi]\s+annu(?:o|i|ale|ali)|annu(?:o|ale|alizzat[oa])|ultim[oi]\s+12\s+mesi|12\s+mesi|dodici\s+mesi)\b/.test(text);
    const contradictoryPeriod = /\b(da\s+inizio\s+fornitura|consum[oi]\s+fatturat[oi]|periodo\s+fatturat|nel\s+periodo|mese\s+di|bimestre|trimestre|consuntivo)\b/.test(text);
    const expectedUnit = spec.field === "consumo_luce_kwh"
      ? /\bkwh\b/.test(text)
      : /\bsmc\b|standard\s*m(?:3|³)/.test(text);
    const singleBandOnly = /\b(f1|f2|f3)\b/.test(text) && !/\b(totale|complessiv|annu|12\s+mesi|dodici\s+mesi)\b/.test(text);
    const coverageMonths = Number(answer?.coverage_months);
    if (contradictoryPeriod) return { accepted: false, reason: /da\s+inizio\s+fornitura/.test(text) ? "semantic_consumption_period_conflict" : "semantic_consumption_not_annual" };
    if (role !== "annual_total" || !explicitAnnual) return { accepted: false, reason: "semantic_consumption_not_annual" };
    if (Number.isFinite(coverageMonths) && coverageMonths > 0 && coverageMonths < 12) return { accepted: false, reason: "semantic_consumption_less_than_12_months" };
    if (!expectedUnit) return { accepted: false, reason: "semantic_consumption_unit_mismatch" };
    if (singleBandOnly) return { accepted: false, reason: "semantic_consumption_single_band" };
  }

  if (["prezzo_luce_eur_kwh", ...LIGHT_BAND_PRICE_FIELDS, "prezzo_gas_eur_smc"].includes(spec.field)) {
    const averageOrTotal = /\b(costo|prezzo|spesa)\s+medi[oa]\b|\bmedi[oa]\s+unitari[oa]\b|\bcosto\s+unitario\s+(?:della|del|di)\b|\btotale\s+(bolletta|fattura|da\s+pagare)\b|\bimporto\s+totale\b|\bspesa\s+totale\b|\bspesa\s+annua\s+stimat[ae]\b/.test(text);
    const examples = /\b(esempio|simulazione|valori\s+recenti|valore\s+massimo|rinnovo\s+in\s+assenza|profili?\s+di\s+consumo|dal\s+(?:13|25|37)[°ºo]?\s+mese|a\s+partire\s+dal\s+(?:13|25|37)[°ºo]?\s+mese)\b/.test(text);
    const regulatedOrFixed = /\b(trasporto|distribuzione|gestione\s+contatore|oneri|impost[ae]|accis[ae]|iva|commercializzazione\s+fiss|quota\s+fissa|rete)\b/.test(text);
    const hasCurrency = /€|\beur\b/.test(text);
    const isLightPrice = spec.field === "prezzo_luce_eur_kwh" || LIGHT_BAND_PRICE_FIELDS.includes(spec.field);
    const expectedUnit = hasCurrency && (isLightPrice
      ? /\bkwh\b/.test(text)
      : /\bsmc\b|standard\s*m(?:3|³)/.test(text));
    const expectedBand = spec.band ? new RegExp(`\\b${spec.band}\\b`, "i").test(text) : true;
    const commercialLabel = (/\b(prezzo|corrispettivo|componente)\b/.test(text)
      && /\b(energia|elettrica|gas|materia|vendita|fornitura|consumo)\b/.test(text))
      || /\bvendita\s+(?:di\s+)?(?:energia|gas)\b/.test(text)
      || /\bmateria\s+(?:prima\s+)?(?:energia|gas)\b/.test(text)
      || /\bcosto\s+per\s+consumi\b/.test(text)
      || (Boolean(spec.band) && /\bf(?:0|1|2|3|23)\b/.test(text));
    const saleSpecificAverage = /\b(?:di\s+cui\s+)?spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?(?:energia(?:\s+elettrica)?|gas(?:\s+naturale)?)\b/.test(text)
      && expectedUnit;
    if ((averageOrTotal || role === "average_cost") && !saleSpecificAverage) return { accepted: false, reason: "semantic_price_average_or_total" };
    if (examples || role === "example") return { accepted: false, reason: "semantic_price_example_or_estimate" };
    if (regulatedOrFixed || role === "regulated") return { accepted: false, reason: "semantic_price_regulated_or_fixed_component" };
    if (["period_total", "billed_rate"].includes(role)) return { accepted: false, reason: `semantic_price_source_${role}` };
    if (isOfferSheet && role !== "contract_term") return { accepted: false, reason: "semantic_offer_price_not_contract_term" };
    if (!expectedUnit || !commercialLabel || !expectedBand) return { accepted: false, reason: "semantic_price_not_commercial_component" };
    if (!usable) return { accepted: false, reason: "semantic_not_usable_for_comparison" };
  }

  if (["quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno"].includes(spec.field)) {
    const regulated = /\b(trasporto|distribuzione|gestione\s+contatore|oneri|impost[ae]|accis[ae]|iva|rete)\b/.test(text);
    const commercialFixed = /\b(quota|corrispettivo|componente|costo)\s+fiss[oa]\b|\b(commercializzazione|vendita|pcv|ccv|qvd)\b/.test(text)
      || (isOfferSheet && /\b(?:corrispettivo\s+annuo|costo\s+fisso\s+ann(?:o|uo))\b/.test(text));
    const futureTerm = /\b(?:dal|a\s+partire\s+dal)\s+\d{1,3}(?:°|º|o|esimo)?\s+mese\b|\bal\s+termine\s+de(?:i|l)\s+\d{1,3}\s+mesi\b|\brinnovo\s+in\s+assenza\b/.test(text);
    const hasCurrency = /€|\beur\b/.test(text);
    const monthlyEvidence = /€\s*\/?\s*(?:pod\s*\/\s*)?mese\b|\beur\s*\/?\s*(?:pod\s*\/\s*)?mese\b|\bmensil[ei]\b|\bal\s+mese\b/.test(text);
    const annualEvidence = /€\s*\/?\s*(?:pod|pdr|utenza)?\s*\/?\s*anno\b|\beur\s*\/?\s*(?:pod|pdr|utenza)?\s*\/?\s*anno\b|\bannu(?:o|ale|i|ali)\b|\ball['’]?anno\b/.test(text);
    if (futureTerm) return { accepted: false, reason: "semantic_fixed_fee_future_term" };
    if (regulated || role === "regulated") return { accepted: false, reason: "semantic_fixed_fee_regulated_component" };
    if (!commercialFixed || !hasCurrency) return { accepted: false, reason: "semantic_fixed_fee_not_commercial" };
    if (answer.period === "month" && !monthlyEvidence) return { accepted: false, reason: "semantic_fixed_month_not_evidenced" };
    if (answer.period === "year" && !annualEvidence) return { accepted: false, reason: "semantic_fixed_year_not_evidenced" };
    if (role !== "contract_term") return { accepted: false, reason: `semantic_fixed_source_${role}` };
    if (!usable) return { accepted: false, reason: "semantic_not_usable_for_comparison" };
  }

  if (INDEX_MULTIPLIER_FIELDS.includes(spec.field)) {
    const expectedIndex = spec.field === "moltiplicatore_indice_luce" ? /\bpun\b|\bindice\s+gme\b/.test(text) : /\bpsv\b|\bpsbil\b|\bindice\s+gas\b/.test(text);
    const explicitMultiplier = /(?:[x×*]|moltiplicat|coefficiente)/.test(text);
    const futureTerm = /\b(?:dal|a\s+partire\s+dal)\s+\d{1,3}(?:°|º|o|esimo)?\s+mese\b|\bal\s+termine\s+de(?:i|l)\s+\d{1,3}\s+mesi\b|\brinnovo\s+in\s+assenza\b/.test(text);
    if (futureTerm) return { accepted: false, reason: "semantic_multiplier_future_term" };
    if (role !== "contract_term" || !expectedIndex || !explicitMultiplier) return { accepted: false, reason: "semantic_multiplier_not_explicit" };
  }

  if (["spread_luce_eur_kwh", "spread_gas_eur_smc"].includes(spec.field)) {
    const hasLabel = /\b(spread|margine|fee|delta\s+su\s+indice|corrispettivo\s+fiss[oa])\b/.test(text);
    const additiveFormulaTerm = /\b(?:pun|psv|psbil|indice)\b[\s\S]{0,160}[+-]\s*\d/.test(text);
    const futureTerm = /\b(?:dal|a\s+partire\s+dal)\s+\d{1,3}(?:°|º|o|esimo)?\s+mese\b|\bal\s+termine\s+de(?:i|l)\s+\d{1,3}\s+mesi\b|\brinnovo\s+in\s+assenza\b/.test(text);
    const hasCurrency = /€|\beur\b/.test(text);
    const hasUnit = spec.field === "spread_luce_eur_kwh" ? /\bkwh\b/.test(text) : /\bsmc\b/.test(text);
    if (futureTerm) return { accepted: false, reason: "semantic_spread_future_term" };
    if (role !== "contract_term") return { accepted: false, reason: "semantic_spread_not_contract_term" };
    if (!(hasLabel || additiveFormulaTerm) || !hasCurrency || !hasUnit) return { accepted: false, reason: "semantic_spread_not_explicit" };
    if (!usable) return { accepted: false, reason: "semantic_not_usable_for_comparison" };
  }

  if (isOfferSheet && ["nome_offerta_luce", "nome_offerta_gas"].includes(spec.field)) {
    const value = semanticText(answer?.value_text, 300);
    if (role !== "contract_term") return { accepted: false, reason: "semantic_offer_name_not_contract_term" };
    if (!value || /^(offerta|offerta\s+(luce|gas|energia)|energia\s+elettrica|gas\s+naturale)$/.test(value)) return { accepted: false, reason: "semantic_offer_name_generic" };
  }

  if (isOfferSheet && [
    "codice_offerta_luce", "codice_offerta_gas", "tipo_prezzo_luce", "tipo_prezzo_gas",
    "indice_riferimento_luce", "indice_riferimento_gas", "formula_prezzo_luce", "formula_prezzo_gas",
    "decorrenza_condizioni_economiche_luce", "decorrenza_condizioni_economiche_gas",
    "scadenza_condizioni_economiche_luce", "scadenza_condizioni_economiche_gas",
  ].includes(spec.field) && role !== "contract_term") {
    return { accepted: false, reason: "semantic_offer_field_not_contract_term" };
  }

  if (comparisonEconomicField(spec.field) && !usable) return { accepted: false, reason: "semantic_not_usable_for_comparison" };
  return { accepted: true, role, certainty, usable };
}

function normalizeAnswer(spec, answer, document = {}) {
  if (!answer || answer.question_id !== spec.id || answer.found !== true) return { accepted: false, reason: "not_found" };
  if (Number(answer.confidence || 0) < 35) return { accepted: false, reason: "confidence_too_low" };
  const semantic = semanticValidation(spec, answer, document);
  if (!semantic.accepted) return semantic;
  if (["number", "fixed"].includes(spec.kind)) {
    const directNumber = finiteNumberOrNull(answer.value_number);
    const number = directNumber ?? parseLocaleNumber(answer.value_text);
    if (!Number.isFinite(number)) return { accepted: false, reason: "invalid_number" };
    if (spec.kind === "fixed") {
      if (!["month", "year"].includes(answer.period)) return { accepted: false, reason: "fixed_period_missing" };
      const value = answer.period === "month" ? Number((number * 12).toFixed(6)) : number;
      return {
        accepted: true,
        value,
        source_role: semantic.role,
        certainty: semantic.certainty,
        usable_for_comparison: semantic.usable,
        derivation: {
          type: answer.period === "month" ? "monthly_to_annual" : "annual_literal",
          original_value: number,
          original_unit: compact(answer.unit, 60) || null,
          factor: answer.period === "month" ? 12 : 1,
          derived_value: value,
        },
      };
    }
    const signedSpread = ["spread_luce_eur_kwh", "spread_gas_eur_smc"].includes(spec.field);
    const bandConsumption = LIGHT_BAND_CONSUMPTION_FIELDS.includes(spec.field);
    const positivePrice = ["prezzo_luce_eur_kwh", ...LIGHT_BAND_PRICE_FIELDS, "prezzo_gas_eur_smc"].includes(spec.field);
    const positiveMultiplier = INDEX_MULTIPLIER_FIELDS.includes(spec.field);
    if (signedSpread && Math.abs(number) > 20) return { accepted: false, reason: "invalid_number" };
    if (bandConsumption && number < 0) return { accepted: false, reason: "invalid_number" };
    if (positivePrice && number <= 0) return { accepted: false, reason: "invalid_number" };
    if (positiveMultiplier && number <= 0) return { accepted: false, reason: "invalid_number" };
    if (!signedSpread && !bandConsumption && !positivePrice && !positiveMultiplier && number <= 0) return { accepted: false, reason: "invalid_number" };
    return { accepted: true, value: number, source_role: semantic.role, certainty: semantic.certainty, usable_for_comparison: semantic.usable };
  }
  const text = compact(answer.value_text, 300);
  if (!text) return { accepted: false, reason: "empty_text" };
  if (spec.kind === "code" || spec.kind === "offer_code") return { accepted: true, value: normalizeCode(spec.field, text), source_role: semantic.role, certainty: semantic.certainty, usable_for_comparison: semantic.usable };
  if (spec.kind === "price_type") {
    const value = normalizePriceType(text);
    return value ? { accepted: true, value, source_role: semantic.role, certainty: semantic.certainty, usable_for_comparison: semantic.usable } : { accepted: false, reason: "invalid_price_type" };
  }
  if (spec.kind === "customer_type") {
    const value = normalizeCustomerType(text);
    return value ? { accepted: true, value, source_role: semantic.role, certainty: semantic.certainty, usable_for_comparison: semantic.usable } : { accepted: false, reason: "invalid_customer_type" };
  }
  if (spec.kind === "date") {
    const value = normalizeIsoDate(text);
    return value ? { accepted: true, value, source_role: semantic.role, certainty: semantic.certainty, usable_for_comparison: semantic.usable } : { accepted: false, reason: "invalid_date" };
  }
  return { accepted: true, value: text, source_role: semantic.role, certainty: semantic.certainty, usable_for_comparison: semantic.usable };
}

function documentKind(value) {
  if (value === "bill") return "bolletta";
  if (value === "offer_sheet") return "scheda_offerta";
  return "unknown";
}

function documentCommodity(value) {
  if (value === "electricity") return "luce";
  if (value === "gas") return "gas";
  if (value === "dual") return "dual";
  return "unknown";
}

function diagnosticFor(spec, answer, normalized) {
  return {
    field: spec.field,
    label: compact(answer.label, 180) || spec.id,
    value: normalized.value,
    status: "review",
    confidence: Number(answer.confidence || 0),
    page: Number.isInteger(Number(answer.page)) && Number(answer.page) > 0 ? Number(answer.page) : null,
    source_snippet: compact(answer.evidence, 900) || compact(answer.value_text, 300),
    source_match: compact(answer.value_text, 180) || null,
    source_role: normalized.source_role || sourceRole(answer),
    certainty: normalized.certainty || answerCertainty(answer),
    usable_for_comparison: normalized.usable_for_comparison ?? answerUsable(answer, sourceRole(answer)),
    verification_reason: null,
    coverage_months: null,
    method: "openai_visual_ai_only",
    source_version: PDF_PURE_AI_READER_VERSION,
    derivation: normalized.derivation || null,
  };
}

function compactAnswer(question_id, { valueText = null, valueNumber = null, unit = null, period = "none", page = null, label = null, evidence = null, confidence = 0, sourceRole = null } = {}) {
  return {
    question_id,
    found: valueText !== null || valueNumber !== null,
    value_text: valueText,
    value_number: valueNumber,
    unit,
    period,
    page,
    label,
    evidence,
    confidence,
    ...(sourceRole ? { source_role: sourceRole, usable_for_comparison: true, certainty: "certain" } : {}),
  };
}

function compactSupplyAnswers(supply, commodity) {
  if (!supply || typeof supply !== "object") return [];
  const answers = [];
  const prefix = commodity === "luce" ? "luce" : "gas";
  const identity = supply.identity || {};
  const identityEvidence = compact(identity.evidence, 450) || compact([identity.provider, identity.offer_name].filter(Boolean).join(" - "), 450) || null;
  if (identity.provider) {
    answers.push(compactAnswer(`fornitore_${prefix}`, {
      valueText: compact(identity.provider, 300), page: identity.page, label: "Venditore",
      evidence: identityEvidence, confidence: identity.confidence, sourceRole: "identity",
    }));
  }
  if (identity.offer_name) {
    answers.push(compactAnswer(`nome_offerta_${prefix}`, {
      valueText: compact(identity.offer_name, 300), page: identity.page, label: "Nome offerta",
      evidence: identityEvidence, confidence: identity.confidence, sourceRole: "contract_term",
    }));
  }

  const consumption = supply.annual_consumption || {};
  const consumptionEvidence = compact(consumption.evidence, 450) || null;
  const consumptionPage = consumption.page || null;
  const consumptionLabel = compact(consumption.label, 180) || "Consumo annuo";
  const consumptionConfidence = Number(consumption.confidence || 0);
  const consumptionFields = commodity === "luce"
    ? [["consumo_luce_kwh", "total"], ["consumo_luce_f1_kwh", "f1"], ["consumo_luce_f2_kwh", "f2"], ["consumo_luce_f3_kwh", "f3"], ["consumo_luce_f23_kwh", "f23"]]
    : [["consumo_gas_smc", "total"]];
  for (const [questionId, key] of consumptionFields) {
    const numericValue = finiteNumberOrNull(consumption[key]);
    if (numericValue !== null) {
      answers.push(compactAnswer(questionId, {
        valueNumber: numericValue, valueText: String(numericValue), unit: compact(consumption.unit, 60) || (commodity === "luce" ? "kWh" : "Smc"),
        page: consumptionPage, label: consumptionLabel, evidence: consumptionEvidence,
        confidence: consumptionConfidence,
      }));
    }
  }

  const price = supply.price || {};
  const priceEvidence = compact(price.evidence, 650) || null;
  const pricePage = price.page || null;
  const priceLabel = compact(price.label, 180) || "Condizioni economiche";
  const priceConfidence = Number(price.confidence || 0);
  const priceUnit = compact(price.unit, 60) || (commodity === "luce" ? "€/kWh" : "€/Smc");
  if (["fixed", "variable", "hybrid"].includes(price.type)) {
    const value = price.type === "fixed" ? "fisso" : price.type === "variable" ? "variabile" : "ibrido";
    answers.push(compactAnswer(`tipo_prezzo_${prefix}`, { valueText: value, page: pricePage, label: priceLabel, evidence: priceEvidence, confidence: priceConfidence }));
  }
  if (commodity === "luce") {
    const lightPrices = [
      ["prezzo_luce_eur_kwh", "single"], ["prezzo_luce_f0_eur_kwh", "f0"], ["prezzo_luce_f1_eur_kwh", "f1"],
      ["prezzo_luce_f2_eur_kwh", "f2"], ["prezzo_luce_f3_eur_kwh", "f3"], ["prezzo_luce_f23_eur_kwh", "f23"],
    ];
    for (const [questionId, key] of lightPrices) {
      const numericValue = finiteNumberOrNull(price[key]);
      if (numericValue !== null) {
        answers.push(compactAnswer(questionId, {
          valueNumber: numericValue, valueText: String(numericValue), unit: priceUnit,
          page: pricePage, label: key === "single" ? priceLabel : `Prezzo ${key.toUpperCase()}`,
          evidence: priceEvidence, confidence: priceConfidence,
        }));
      }
    }
    const bands = ["f1", "f2", "f3", "f23"].filter((key) => finiteNumberOrNull(price[key]) !== null);
    if (bands.length) {
      answers.push(compactAnswer("struttura_prezzo_luce", {
        valueText: `fasce ${bands.map((band) => band.toUpperCase()).join("/")}`,
        page: pricePage, label: priceLabel, evidence: priceEvidence, confidence: priceConfidence,
      }));
    } else if (finiteNumberOrNull(price.single) !== null || finiteNumberOrNull(price.f0) !== null) {
      answers.push(compactAnswer("struttura_prezzo_luce", {
        valueText: "monoraria", page: pricePage, label: priceLabel, evidence: priceEvidence, confidence: priceConfidence,
      }));
    }
  } else {
    const gasSingle = finiteNumberOrNull(price.single);
    if (gasSingle !== null) answers.push(compactAnswer("prezzo_gas_eur_smc", {
      valueNumber: gasSingle, valueText: String(gasSingle), unit: priceUnit,
      page: pricePage, label: priceLabel, evidence: priceEvidence, confidence: priceConfidence,
    }));
  }
  if (price.index) answers.push(compactAnswer(`indice_riferimento_${prefix}`, { valueText: compact(price.index, 200), page: pricePage, label: priceLabel, evidence: priceEvidence, confidence: priceConfidence }));
  const multiplier = finiteNumberOrNull(price.multiplier);
  if (multiplier !== null) answers.push(compactAnswer(`moltiplicatore_indice_${prefix}`, { valueNumber: multiplier, valueText: String(multiplier), unit: "coefficiente", page: pricePage, label: priceLabel, evidence: priceEvidence, confidence: priceConfidence }));
  const spread = finiteNumberOrNull(price.spread);
  if (spread !== null) answers.push(compactAnswer(`spread_${prefix}_${commodity === "luce" ? "eur_kwh" : "eur_smc"}`, { valueNumber: spread, valueText: String(spread), unit: priceUnit, page: pricePage, label: priceLabel, evidence: priceEvidence, confidence: priceConfidence }));
  if (price.formula) answers.push(compactAnswer(`formula_prezzo_${prefix}`, { valueText: compact(price.formula, 300), page: pricePage, label: priceLabel, evidence: priceEvidence, confidence: priceConfidence }));
  if (price.periodicity) answers.push(compactAnswer(`periodicita_aggiornamento_indice_${prefix}`, { valueText: compact(price.periodicity, 120), page: pricePage, label: priceLabel, evidence: priceEvidence, confidence: priceConfidence }));

  const fixed = supply.fixed_fee || {};
  const fixedValue = finiteNumberOrNull(fixed.value);
  if (fixedValue !== null && ["month", "year"].includes(fixed.period)) {
    answers.push(compactAnswer(`quota_fissa_vendita_${prefix}`, {
      valueNumber: fixedValue, valueText: String(fixedValue), unit: compact(fixed.unit, 60) || null,
      period: fixed.period, page: fixed.page || null, label: compact(fixed.label, 180) || "Quota fissa commerciale",
      evidence: compact(fixed.evidence, 450) || null, confidence: Number(fixed.confidence || 0), sourceRole: "contract_term",
    }));
  }
  return answers;
}

function compactOutputToLegacy(parsed) {
  if (Array.isArray(parsed?.answers)) return parsed;
  if (!parsed?.document || !parsed?.electricity || !parsed?.gas) return parsed;
  const electricityAnswers = compactSupplyAnswers(parsed.electricity, "luce");
  const gasAnswers = compactSupplyAnswers(parsed.gas, "gas");
  const providers = [parsed.electricity?.identity?.provider, parsed.gas?.identity?.provider].filter(Boolean);
  const answers = [...electricityAnswers, ...gasAnswers];
  if (providers.length) {
    answers.unshift(compactAnswer("fornitore", {
      valueText: compact(providers[0], 300), page: parsed.electricity?.identity?.page || parsed.gas?.identity?.page || null,
      label: "Venditore", evidence: compact(parsed.electricity?.identity?.evidence || parsed.gas?.identity?.evidence, 450) || compact(providers[0], 300),
      confidence: Math.max(Number(parsed.electricity?.identity?.confidence || 0), Number(parsed.gas?.identity?.confidence || 0)), sourceRole: "identity",
    }));
  }
  return { document: parsed.document, answers };
}

function coreFieldCount(input) {
  return [
    "fornitore", "intestatario", "codice_fiscale", "pod", "pdr",
    "consumo_luce_kwh", "consumo_gas_smc", "prezzo_luce_eur_kwh", "prezzo_gas_eur_smc",
  ].filter((field) => input[field] !== null && input[field] !== undefined && input[field] !== "").length;
}

function presentFieldCount(input, fields) {
  return fields.filter((field) => input[field] !== null && input[field] !== undefined && input[field] !== "").length;
}

function resolveDocumentKind(declaredKind, input) {
  const strongBillSignals = presentFieldCount(input, [
    "pod", "pdr", "codice_cliente", "codice_cliente_luce", "codice_cliente_gas",
    "intestatario", "codice_fiscale", "indirizzo_fornitura_luce", "indirizzo_fornitura_gas",
  ]);
  const supportingBillSignals = presentFieldCount(input, [
    "potenza_impegnata_kw", "potenza_disponibile_kw", "consumo_luce_kwh", "consumo_gas_smc",
  ]);
  const offerIdentitySignals = presentFieldCount(input, [
    "nome_offerta_luce", "nome_offerta_gas", "codice_offerta_luce", "codice_offerta_gas",
  ]);
  const offerEconomicSignals = presentFieldCount(input, [
    "tipo_prezzo_luce", "tipo_prezzo_gas", "indice_riferimento_luce", "indice_riferimento_gas",
    "spread_luce_eur_kwh", "spread_gas_eur_smc", "moltiplicatore_indice_luce", "moltiplicatore_indice_gas",
    "formula_prezzo_luce", "formula_prezzo_gas",
    "decorrenza_condizioni_economiche_luce", "decorrenza_condizioni_economiche_gas",
    "scadenza_condizioni_economiche_luce", "scadenza_condizioni_economiche_gas",
    "prezzo_luce_eur_kwh", "prezzo_gas_eur_smc",
    "quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno",
  ]);

  if (strongBillSignals > 0) {
    return { kind: "bolletta", reason: declaredKind === "bolletta" ? "declared_bill_confirmed" : "customer_specific_bill_signals" };
  }
  if (declaredKind === "bolletta" && supportingBillSignals > 0) {
    return { kind: "bolletta", reason: "declared_bill_with_supporting_signals" };
  }
  if (offerIdentitySignals >= 1 && offerEconomicSignals >= 1) {
    return { kind: "scheda_offerta", reason: declaredKind === "scheda_offerta" ? "declared_offer_confirmed" : "offer_identity_and_economic_signals" };
  }
  if (declaredKind === "scheda_offerta" && offerEconomicSignals >= 2) {
    return { kind: "scheda_offerta", reason: "declared_offer_with_economic_signals" };
  }
  return { kind: declaredKind, reason: declaredKind === "unknown" ? "insufficient_signals" : "declared_kind_without_conflict" };
}

function commoditySignalCount(input, commodity) {
  const fields = commodity === "luce"
    ? [
      "pod", "consumo_luce_kwh", ...LIGHT_BAND_CONSUMPTION_FIELDS, "prezzo_luce_eur_kwh", ...LIGHT_BAND_PRICE_FIELDS, "quota_fissa_vendita_luce_eur_anno",
      "nome_offerta_luce", "codice_offerta_luce", "tipo_prezzo_luce", "indice_riferimento_luce",
      "spread_luce_eur_kwh", "moltiplicatore_indice_luce", "formula_prezzo_luce",
    ]
    : [
      "pdr", "consumo_gas_smc", "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno",
      "nome_offerta_gas", "codice_offerta_gas", "tipo_prezzo_gas", "indice_riferimento_gas",
      "spread_gas_eur_smc", "moltiplicatore_indice_gas", "formula_prezzo_gas",
    ];
  return presentFieldCount(input, fields);
}

export function normalizePureAiOutput(parsed, {
  model = PDF_PURE_AI_DEFAULT_MODEL,
  responseId = null,
  transportMode = "pdf_originale",
  timings = {},
} = {}) {
  parsed = compactOutputToLegacy(parsed);
  if (!parsed || typeof parsed !== "object" || !parsed.document || !Array.isArray(parsed.answers)) {
    throw new Error("openai_invalid_output");
  }
  const answerById = new Map();
  for (const answer of parsed.answers) {
    if (QUESTION_BY_ID.has(answer?.question_id) && !answerById.has(answer.question_id)) answerById.set(answer.question_id, answer);
  }
  const normalized = {
    parser_version: PDF_PURE_AI_READER_VERSION,
    page_count: Number(parsed.document.page_count || 0) || null,
    diagnostics: [],
    kind: documentKind(parsed.document.kind),
    commodity: documentCommodity(parsed.document.commodity),
    customer_type: parsed.document.customer_type === "consumer" ? "privato" : parsed.document.customer_type === "business" ? "business" : null,
    document_classification_evidence: compact(parsed.document.classification_evidence, 500) || null,
    billing_period_start: normalizeIsoDate(parsed.document.billing_period_start) || null,
    billing_period_end: normalizeIsoDate(parsed.document.billing_period_end) || null,
    supply_start_date: normalizeIsoDate(parsed.document.supply_start_date) || null,
    textExtracted: 0,
    needsReview: true,
  };
  const filledFields = [];
  const rejected = [];
  for (const spec of QUESTION_SPECS) {
    const answer = answerById.get(spec.id);
    const result = normalizeAnswer(spec, answer, parsed.document);
    if (!result.accepted) {
      rejected.push({ question_id: spec.id, reason: result.reason });
      continue;
    }
    normalized[spec.field] = result.value;
    filledFields.push(spec.field);
    normalized.diagnostics.push(diagnosticFor(spec, answer, result));
  }

  const derivedBandDiagnostics = [];
  const f1Consumption = finiteNumberOrNull(normalized.consumo_luce_f1_kwh);
  const f2Consumption = finiteNumberOrNull(normalized.consumo_luce_f2_kwh);
  const f3Consumption = finiteNumberOrNull(normalized.consumo_luce_f3_kwh);
  const f23Consumption = finiteNumberOrNull(normalized.consumo_luce_f23_kwh);
  if (f23Consumption === null && f2Consumption !== null && f3Consumption !== null) {
    normalized.consumo_luce_f23_kwh = Number((f2Consumption + f3Consumption).toFixed(6));
    filledFields.push("consumo_luce_f23_kwh");
    derivedBandDiagnostics.push({
      field: "consumo_luce_f23_kwh", label: "F23 derivato da F2 + F3", value: normalized.consumo_luce_f23_kwh,
      status: "review", confidence: 100, page: null, source_snippet: "Somma esatta dei consumi annui F2 e F3 già validati",
      source_match: null, source_role: "annual_total", certainty: "certain", usable_for_comparison: true,
      verification_reason: null, coverage_months: 12, method: "deterministic_sum", source_version: PDF_PURE_AI_READER_VERSION,
      derivation: { type: "annual_f2_plus_f3_to_f23", source_fields: ["consumo_luce_f2_kwh", "consumo_luce_f3_kwh"], derived_value: normalized.consumo_luce_f23_kwh },
    });
  }
  if (finiteNumberOrNull(normalized.consumo_luce_kwh) === null) {
    const normalizedF23 = finiteNumberOrNull(normalized.consumo_luce_f23_kwh);
    const derivedTotal = f1Consumption !== null && normalizedF23 !== null
      ? f1Consumption + normalizedF23
      : f1Consumption !== null && f2Consumption !== null && f3Consumption !== null
        ? f1Consumption + f2Consumption + f3Consumption
        : NaN;
    if (Number.isFinite(derivedTotal) && derivedTotal > 0) {
      normalized.consumo_luce_kwh = Number(derivedTotal.toFixed(6));
      filledFields.push("consumo_luce_kwh");
      derivedBandDiagnostics.push({
        field: "consumo_luce_kwh", label: "Consumo annuo totale derivato dalle fasce", value: normalized.consumo_luce_kwh,
        status: "review", confidence: 100, page: null, source_snippet: "Somma esatta dei consumi annui per fascia già validati",
        source_match: null, source_role: "annual_total", certainty: "certain", usable_for_comparison: true,
        verification_reason: null, coverage_months: 12, method: "deterministic_sum", source_version: PDF_PURE_AI_READER_VERSION,
        derivation: { type: "annual_bands_to_total", source_fields: normalizedF23 !== null ? ["consumo_luce_f1_kwh", "consumo_luce_f23_kwh"] : ["consumo_luce_f1_kwh", "consumo_luce_f2_kwh", "consumo_luce_f3_kwh"], derived_value: normalized.consumo_luce_kwh },
      });
      const rejectedIndex = rejected.findIndex((item) => item.question_id === "consumo_luce_kwh");
      if (rejectedIndex >= 0) rejected.splice(rejectedIndex, 1);
    }
  }
  normalized.diagnostics.push(...derivedBandDiagnostics);

  const validatedF0 = finiteNumberOrNull(normalized.prezzo_luce_f0_eur_kwh);
  if (normalized.prezzo_luce_eur_kwh === undefined && validatedF0 !== null && validatedF0 > 0) {
    normalized.prezzo_luce_eur_kwh = validatedF0;
    filledFields.push("prezzo_luce_eur_kwh");
    const f0Diagnostic = normalized.diagnostics.find((item) => item.field === "prezzo_luce_f0_eur_kwh");
    if (f0Diagnostic) {
      normalized.diagnostics.push({
        ...f0Diagnostic,
        field: "prezzo_luce_eur_kwh",
        label: `${f0Diagnostic.label || "F0"} (prezzo monorario)`,
        value: normalized.prezzo_luce_eur_kwh,
        derivation: {
          type: "monoraria_f0_to_sales_price",
          source_field: "prezzo_luce_f0_eur_kwh",
          derived_value: normalized.prezzo_luce_eur_kwh,
        },
      });
    }
    const rejectedIndex = rejected.findIndex((item) => item.question_id === "prezzo_luce_eur_kwh");
    if (rejectedIndex >= 0) rejected.splice(rejectedIndex, 1);
  }

  if (normalized.commodity === "unknown") {
    const hasLuce = commoditySignalCount(normalized, "luce") > 0;
    const hasGas = commoditySignalCount(normalized, "gas") > 0;
    normalized.commodity = hasLuce && hasGas ? "dual" : hasLuce ? "luce" : hasGas ? "gas" : "unknown";
  }
  const declaredKind = normalized.kind;
  const kindResolution = resolveDocumentKind(declaredKind, normalized);
  normalized.kind = kindResolution.kind;
  if (!normalized.fornitore_luce && normalized.fornitore && ["luce", "dual"].includes(normalized.commodity)) normalized.fornitore_luce = normalized.fornitore;
  if (!normalized.fornitore_gas && normalized.fornitore && ["gas", "dual"].includes(normalized.commodity)) normalized.fornitore_gas = normalized.fornitore;
  if (!normalized.codice_cliente_luce && normalized.codice_cliente && ["luce", "dual"].includes(normalized.commodity)) normalized.codice_cliente_luce = normalized.codice_cliente;
  if (!normalized.codice_cliente_gas && normalized.codice_cliente && ["gas", "dual"].includes(normalized.commodity)) normalized.codice_cliente_gas = normalized.codice_cliente;

  const offerRecognitionCount = presentFieldCount(normalized, [
    "fornitore", "fornitore_luce", "fornitore_gas", "nome_offerta_luce", "nome_offerta_gas",
    "codice_offerta_luce", "codice_offerta_gas", "tipo_prezzo_luce", "tipo_prezzo_gas",
    "indice_riferimento_luce", "indice_riferimento_gas", "prezzo_luce_eur_kwh", ...LIGHT_BAND_PRICE_FIELDS, "prezzo_gas_eur_smc",
    "moltiplicatore_indice_luce", "moltiplicatore_indice_gas",
    "quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno",
  ]);
  const offerIdentityCount = presentFieldCount(normalized, ["nome_offerta_luce", "nome_offerta_gas", "codice_offerta_luce", "codice_offerta_gas"]);
  const offerEconomicCount = presentFieldCount(normalized, [
    "prezzo_luce_eur_kwh", "prezzo_gas_eur_smc", "quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno",
    "tipo_prezzo_luce", "tipo_prezzo_gas", "indice_riferimento_luce", "indice_riferimento_gas",
    "spread_luce_eur_kwh", "spread_gas_eur_smc", "formula_prezzo_luce", "formula_prezzo_gas",
  ]);
  normalized.recognized = normalized.kind !== "unknown"
    && normalized.commodity !== "unknown"
    && (coreFieldCount(normalized) > 0
      || (normalized.kind === "scheda_offerta" && offerRecognitionCount >= 2 && offerIdentityCount >= 1 && offerEconomicCount >= 1));
  normalized.confidence = normalized.recognized ? "medium" : "low";
  normalized.warnings = ["lettura_solo_ia_da_verificare"];
  if (declaredKind !== normalized.kind) normalized.warnings.push("tipo_documento_riclassificato_da_evidenze");
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
    document_kind_declared: declaredKind,
    document_kind_resolved: normalized.kind,
    document_kind_reason: kindResolution.reason,
    document_classification_evidence: normalized.document_classification_evidence,
    billing_period_start: normalized.billing_period_start,
    billing_period_end: normalized.billing_period_end,
    supply_start_date: normalized.supply_start_date,
    verification_protocol: "comparison_essentials_compact_v1",
  };
  return applyPdfDataContract(applyPdfFieldValidation(normalized));
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
  const remainingBudget = () => deadlineAt
    ? Number(deadlineAt) - Date.now() - 2_000
    : configuredTimeout - (Date.now() - startedAt);
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
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => { controller.abort(); reject(new Error("openai_file_upload_timeout")); }, uploadTimeoutMs);
        });
        const uploadRaw = await Promise.race([
          fileUploadTransport({ filePath, filename, apiKey, signal: controller.signal }),
          timeoutPromise,
        ]);
        const uploadBody = await openAiFileTransportBody(uploadRaw, "upload");
        openAiFileId = compact(uploadBody?.id, 180);
        if (!openAiFileId) throw new Error("openai_file_upload_invalid_response");
      } finally {
        clearTimeout(timeoutId);
        openAiFileUploadMs = Date.now() - uploadStartedAt;
      }
    }

    const buildStartedAt = Date.now();
    const request = await buildPdfPureAiRequest({
      filePath: useOpenAiFileId ? null : filePath,
      fileId: openAiFileId || null,
      filename,
      model,
    });
    requestBuildMs = Date.now() - buildStartedAt;
    const effectiveTimeout = Math.min(configuredTimeout, remainingBudget());
    if (!Number.isFinite(effectiveTimeout) || effectiveTimeout < 8_000) throw new Error("openai_insufficient_time_budget");
    const controller = new AbortController();
    let timeoutId;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => { controller.abort(); reject(new Error("openai_timeout")); }, effectiveTimeout);
      });
      const raw = await Promise.race([
        transport({ request, apiKey, signal: controller.signal, attempt: 1, profile: REQUEST_PROFILE }),
        timeoutPromise,
      ]);
      const body = await transportBody(raw);
      if (body?.status === "incomplete") throw new Error(`openai_incomplete:${body?.incomplete_details?.reason || "unknown"}`);
      const outputText = responseOutputText(body);
      if (!outputText) throw new Error("openai_empty_output");
      const parsedOutput = JSON.parse(outputText);
      const now = Date.now();
      normalizedResult = normalizePureAiOutput(parsedOutput, {
        model,
        responseId: compact(body?.id, 160) || null,
        transportMode: useOpenAiFileId ? "openai_file_id" : "pdf_originale",
        timings: {
          request_build_ms: requestBuildMs,
          openai_file_upload_ms: openAiFileUploadMs,
          openai_ms: now - openaiStartedAt,
          total_ms: now - startedAt,
          openai_attempts: 1,
          input_file_bytes: Number(fileStats.size || 0),
          file_id_threshold_bytes: fileIdThreshold,
        },
      });
      normalizedResult.ai = {
        ...(normalizedResult.ai || {}),
        request_profile: REQUEST_PROFILE,
        recovery_attempted: false,
        recovered_from: null,
      };
      // Traccia interna: permette di confrontare la risposta originale dell'IA
      // con normalizzazione, validazione e valori mostrati. La route pubblica la
      // rimuove prima di rispondere al browser; resta soltanto nell'archivio staff.
      normalizedResult._reader_trace = {
        trace_version: "reader-trace-v1",
        captured_at: new Date(now).toISOString(),
        response_id: compact(body?.id, 160) || null,
        request_profile: REQUEST_PROFILE,
        raw_output_chars: outputText.length,
        raw_ai: parsedOutput,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    analysisError = error;
  } finally {
    if (openAiFileId) {
      const controller = new AbortController();
      let timeoutId;
      try {
        const timeoutMs = boundedFileDeleteTimeout(env.PDF_AI_FILE_DELETE_TIMEOUT_MS);
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => { controller.abort(); reject(new Error("openai_file_delete_timeout")); }, timeoutMs);
        });
        const deleteRaw = await Promise.race([
          fileDeleteTransport({ fileId: openAiFileId, apiKey, signal: controller.signal }),
          timeoutPromise,
        ]);
        const deleteBody = await openAiFileTransportBody(deleteRaw, "delete");
        openAiFileDeleted = deleteBody?.deleted !== false;
        if (!openAiFileDeleted) throw new Error("openai_file_delete_not_confirmed");
      } catch (error) {
        openAiFileDeleted = false;
        openAiFileDeleteError = compact(error?.message || error, 180) || "openai_file_delete_failed";
      } finally {
        clearTimeout(timeoutId);
      }
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
      recovery_attempted: false,
      recovered_from: null,
      openai_attempts: 1,
      retry_count: 0,
    };
    return normalizedResult;
  }
  throw analysisError || new Error("openai_invalid_output");
}

