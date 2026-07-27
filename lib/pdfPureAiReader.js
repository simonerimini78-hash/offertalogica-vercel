import fs from "node:fs/promises";
import { applyPdfDataContract } from "./pdfDataContract.js";
import { applyPdfFieldValidation } from "./pdfFieldValidation.js";


export const PDF_PURE_AI_READER_VERSION = "pure-ai-native-pdf-v1.0.5";
export const PDF_PURE_AI_DEFAULT_MODEL = "gpt-4.1-2025-04-14";

const QUESTION_SPECS = Object.freeze([
  { id: "fornitore", field: "fornitore", kind: "text", question: "Qual è il fornitore o venditore che emette il documento?" },
  { id: "fornitore_luce", field: "fornitore_luce", kind: "text", question: "Qual è il fornitore della fornitura elettrica?" },
  { id: "fornitore_gas", field: "fornitore_gas", kind: "text", question: "Qual è il fornitore della fornitura gas?" },
  { id: "customer_type", field: "customer_type", kind: "customer_type", question: "La tipologia del cliente è privato/domestico oppure business/azienda?" },
  { id: "intestatario", field: "intestatario", kind: "text", question: "Qual è il nome o la ragione sociale dell'intestatario?" },
  { id: "codice_fiscale", field: "codice_fiscale", kind: "code", question: "Qual è il codice fiscale o la partita IVA dell'intestatario, non quella del fornitore?" },
  { id: "codice_cliente", field: "codice_cliente", kind: "code", question: "Qual è il codice cliente comune?" },
  { id: "codice_cliente_luce", field: "codice_cliente_luce", kind: "code", question: "Qual è il codice cliente riferito alla luce?" },
  { id: "codice_cliente_gas", field: "codice_cliente_gas", kind: "code", question: "Qual è il codice cliente riferito al gas?" },

  { id: "indirizzo_fornitura_luce", field: "indirizzo_fornitura_luce", kind: "text", question: "Qual è l'indirizzo completo della fornitura elettrica?" },
  { id: "pod", field: "pod", kind: "code", question: "Qual è il POD della fornitura elettrica?" },
  { id: "potenza_impegnata_kw", field: "potenza_impegnata_kw", kind: "number", question: "Qual è la potenza impegnata in kW?" },
  { id: "potenza_disponibile_kw", field: "potenza_disponibile_kw", kind: "number", question: "Qual è la potenza disponibile in kW?" },
  { id: "consumo_luce_kwh", field: "consumo_luce_kwh", kind: "number", question: "Qual è il consumo annuo complessivo degli ultimi 12 mesi in kWh?" },
  { id: "prezzo_luce_eur_kwh", field: "prezzo_luce_eur_kwh", kind: "number", question: "Qual è il prezzo unitario della componente di vendita energia elettrica in EUR/kWh, escludendo rete, oneri, imposte e importi totali?" },
  { id: "quota_fissa_vendita_luce", field: "quota_fissa_vendita_luce_eur_anno", kind: "fixed", question: "Qual è la quota fissa della componente di vendita luce e qual è la periodicità stampata?" },
  { id: "nome_offerta_luce", field: "nome_offerta_luce", kind: "text", question: "Qual è il nome dell'offerta luce?" },
  { id: "codice_offerta_luce", field: "codice_offerta_luce", kind: "offer_code", question: "Qual è il codice offerta luce?" },
  { id: "tipo_prezzo_luce", field: "tipo_prezzo_luce", kind: "price_type", question: "Il prezzo luce è fisso, variabile o ibrido?" },
  { id: "indice_riferimento_luce", field: "indice_riferimento_luce", kind: "text", question: "Qual è l'indice di riferimento luce, per esempio PUN?" },
  { id: "spread_luce_eur_kwh", field: "spread_luce_eur_kwh", kind: "number", question: "Qual è lo spread commerciale luce esplicitamente indicato in EUR/kWh?" },
  { id: "periodicita_aggiornamento_indice_luce", field: "periodicita_aggiornamento_indice_luce", kind: "text", question: "Qual è la periodicità di aggiornamento dell'indice luce?" },
  { id: "struttura_prezzo_luce", field: "struttura_prezzo_luce", kind: "text", question: "La struttura del prezzo luce è monoraria o per fasce?" },
  { id: "formula_prezzo_luce", field: "formula_prezzo_luce", kind: "text", question: "Qual è la formula del prezzo luce stampata nel documento?" },
  { id: "decorrenza_condizioni_economiche_luce", field: "decorrenza_condizioni_economiche_luce", kind: "date", question: "Qual è la decorrenza delle condizioni economiche luce?" },
  { id: "scadenza_condizioni_economiche_luce", field: "scadenza_condizioni_economiche_luce", kind: "date", question: "Qual è la scadenza delle condizioni economiche luce?" },

  { id: "indirizzo_fornitura_gas", field: "indirizzo_fornitura_gas", kind: "text", question: "Qual è l'indirizzo completo della fornitura gas?" },
  { id: "pdr", field: "pdr", kind: "code", question: "Qual è il PDR della fornitura gas?" },
  { id: "consumo_gas_smc", field: "consumo_gas_smc", kind: "number", question: "Qual è il consumo annuo complessivo degli ultimi 12 mesi in Smc?" },
  { id: "prezzo_gas_eur_smc", field: "prezzo_gas_eur_smc", kind: "number", question: "Qual è il prezzo unitario della componente di vendita gas naturale in EUR/Smc, escludendo rete, oneri, imposte e importi totali?" },
  { id: "quota_fissa_vendita_gas", field: "quota_fissa_vendita_gas_eur_anno", kind: "fixed", question: "Qual è la quota fissa della componente di vendita gas e qual è la periodicità stampata?" },
  { id: "nome_offerta_gas", field: "nome_offerta_gas", kind: "text", question: "Qual è il nome dell'offerta gas?" },
  { id: "codice_offerta_gas", field: "codice_offerta_gas", kind: "offer_code", question: "Qual è il codice offerta gas?" },
  { id: "tipo_prezzo_gas", field: "tipo_prezzo_gas", kind: "price_type", question: "Il prezzo gas è fisso, variabile o ibrido?" },
  { id: "indice_riferimento_gas", field: "indice_riferimento_gas", kind: "text", question: "Qual è l'indice di riferimento gas, per esempio PSV?" },
  { id: "spread_gas_eur_smc", field: "spread_gas_eur_smc", kind: "number", question: "Qual è lo spread commerciale gas esplicitamente indicato in EUR/Smc?" },
  { id: "periodicita_aggiornamento_indice_gas", field: "periodicita_aggiornamento_indice_gas", kind: "text", question: "Qual è la periodicità di aggiornamento dell'indice gas?" },
  { id: "formula_prezzo_gas", field: "formula_prezzo_gas", kind: "text", question: "Qual è la formula del prezzo gas stampata nel documento?" },
  { id: "decorrenza_condizioni_economiche_gas", field: "decorrenza_condizioni_economiche_gas", kind: "date", question: "Qual è la decorrenza delle condizioni economiche gas?" },
  { id: "scadenza_condizioni_economiche_gas", field: "scadenza_condizioni_economiche_gas", kind: "date", question: "Qual è la scadenza delle condizioni economiche gas?" },
]);

export const PDF_PURE_AI_QUESTION_IDS = Object.freeze(QUESTION_SPECS.map((spec) => spec.id));
const QUESTION_BY_ID = new Map(QUESTION_SPECS.map((spec) => [spec.id, spec]));

const ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "question_id", "found", "value_text", "value_number", "unit", "period",
    "page", "label", "evidence", "confidence",
  ],
  properties: {
    question_id: { type: "string", enum: PDF_PURE_AI_QUESTION_IDS },
    found: { type: "boolean" },
    value_text: { type: ["string", "null"] },
    value_number: { type: ["number", "null"] },
    unit: { type: ["string", "null"] },
    period: { type: "string", enum: ["none", "month", "year"] },
    page: { type: ["integer", "null"], minimum: 1 },
    label: { type: ["string", "null"] },
    evidence: { type: ["string", "null"], maxLength: 600 },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
  },
};

const OUTPUT_SCHEMA = {
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
      minItems: QUESTION_SPECS.length,
      maxItems: QUESTION_SPECS.length,
      items: ANSWER_SCHEMA,
    },
  },
};

const SYSTEM_PROMPT = `Sei il lettore visuale di OffertaLogica, specializzato in bollette e documenti di offerta luce e gas italiani.

Regole obbligatorie:
- Analizza tutte le pagine allegate come un unico documento multipagina.
- Tratta luce e gas separatamente, anche nei documenti dual.
- Copia solo dati realmente visibili. Non inventare, non stimare e non completare valori mancanti.
- Per ogni domanda restituisci una risposta; usa found=false quando il dato non è leggibile o non è presente.
- Il codice fiscale o la partita IVA devono appartenere all'intestatario. Ignora i dati fiscali del fornitore, distributore e società del gruppo.
- Determina il profilo cliente dalla voce Tipologia cliente, Domestico residente/non residente, Altri usi, Condominio, Impresa o equivalente. Non classificare come business solo perché compare la partita IVA del fornitore.
- Il consumo annuo è il totale complessivo riferito a 12 mesi. Accettalo solo se evidence contiene letteralmente “consumo annuo”, “ultimi 12 mesi”, “12 mesi” o una formula equivalente inequivocabile. Non usare il consumo del periodo fatturato, una lettura, una stima mensile o una singola fascia F1/F2/F3.
- Non sommare fasce o periodi: se il totale annuo non è scritto chiaramente, usa found=false.
- Per il prezzo luce cerca la componente commerciale di vendita energia elettrica espressa in EUR/kWh. Non usare costo/prezzo medio unitario, totale bolletta, colonna Importi, rete, trasporto, contatore, oneri o imposte.
- Per il prezzo gas cerca la componente commerciale di vendita gas naturale espressa in EUR/Smc. Non usare costo/prezzo medio unitario, totale bolletta, colonna Importi, rete, trasporto, contatore, oneri o imposte.
- Per le quote fisse usa solo la componente commerciale di vendita. Escludi trasporto, distribuzione, gestione contatore, oneri e imposte. Riporta il valore stampato e period=month oppure period=year; non annualizzare.
- Classifica come bill una bolletta riferita a un cliente o punto di fornitura specifico, con POD/PDR, codice cliente, intestatario, consumi o dati di fornitura. Classifica come offer_sheet una scheda sintetica/condizioni economiche che descrive un’offerta senza dati specifici del cliente o del punto di fornitura.
- Per offerte variabili separa indice, spread e periodicità di aggiornamento. Non calcolare un prezzo sommando indice e spread.
- POD, PDR, codice fiscale, codice cliente e codice offerta devono essere copiati carattere per carattere.
- evidence deve contenere la riga o le righe contigue che giustificano il valore; page deve indicare la pagina visiva.
- value_text è il valore letterale; value_number è la normalizzazione numerica dello stesso valore, quando applicabile.
- Restituisci soltanto JSON conforme allo schema.`;

const USER_PROMPT = `Rispondi alle domande seguenti sul documento allegato:\n\n${QUESTION_SPECS
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
  const parsed = Number(value || 46_000);
  return Math.max(8_000, Math.min(48_000, Number.isFinite(parsed) ? parsed : 46_000));
}

function boundedRetryDelay(value) {
  const parsed = Number(value ?? 750);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(2_000, parsed)) : 750;
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
    max_output_tokens: 6_500,
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
        name: "offertalogica_pure_ai_bill",
        description: "Dati visuali strutturati da bollette italiane luce e gas",
        strict: true,
        schema: OUTPUT_SCHEMA,
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

function normalizeCode(field, value) {
  const text = compact(value, 140).toUpperCase();
  if (["codice_offerta_luce", "codice_offerta_gas"].includes(field)) return text.replace(/\s+/g, "");
  if (field === "pdr") return text.replace(/\D/g, "");
  return text.replace(/[^A-Z0-9]/g, "");
}

function normalizePriceType(value) {
  const text = compact(value, 100).toLowerCase();
  if (/variabil/.test(text)) return "variabile";
  if (/ibrid/.test(text)) return "ibrido";
  if (/fiss/.test(text)) return "fisso";
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
  return semanticText([answer?.label, answer?.evidence, answer?.value_text, answer?.unit].filter(Boolean).join(" | "));
}

function semanticValidation(spec, answer) {
  const text = answerSemanticText(answer);
  if (!text) return { accepted: false, reason: "semantic_evidence_missing" };

  if (["consumo_luce_kwh", "consumo_gas_smc"].includes(spec.field)) {
    const explicitAnnual = /\b(consum[oi]\s+annu(?:o|i|ale|ali)|annu(?:o|ale|alizzat[oa])|ultim[oi]\s+12\s+mesi|12\s+mesi|dodici\s+mesi)\b/.test(text);
    const expectedUnit = spec.field === "consumo_luce_kwh"
      ? /\bkwh\b/.test(text)
      : /\bsmc\b|standard\s*m(?:3|³)/.test(text);
    const singleBandOnly = /\b(f1|f2|f3)\b/.test(text) && !/\b(totale|complessiv|annu|12\s+mesi|dodici\s+mesi)\b/.test(text);
    if (!explicitAnnual) return { accepted: false, reason: "semantic_consumption_not_annual" };
    if (!expectedUnit) return { accepted: false, reason: "semantic_consumption_unit_mismatch" };
    if (singleBandOnly) return { accepted: false, reason: "semantic_consumption_single_band" };
  }

  if (["prezzo_luce_eur_kwh", "prezzo_gas_eur_smc"].includes(spec.field)) {
    const averageOrTotal = /\b(costo|prezzo|spesa)\s+medi[oa]|\bmedi[oa]\s+unitari[oa]|\bcosto\s+unitario\s+medi[oa]|\btotale\s+(bolletta|fattura|da\s+pagare)|\bimporto\s+totale|\bspesa\s+totale/.test(text);
    const regulatedOrFixed = /\b(trasporto|distribuzione|gestione\s+contatore|oneri|impost[ae]|accis[ae]|iva|commercializzazione\s+fiss|quota\s+fissa)\b/.test(text);
    const hasCurrency = /€|\beur\b/.test(text);
    const expectedUnit = hasCurrency && (spec.field === "prezzo_luce_eur_kwh"
      ? /\bkwh\b/.test(text)
      : /\bsmc\b|standard\s*m(?:3|³)/.test(text));
    const commercialLabel = (/\b(prezzo|corrispettivo|componente|quota)\b/.test(text)
      && /\b(energia|elettrica|gas|materia|vendita|fornitura)\b/.test(text))
      || /\bvendita\s+(?:di\s+)?(?:energia|gas)\b/.test(text)
      || /\bmateria\s+(?:prima\s+)?(?:energia|gas)\b/.test(text);
    if (averageOrTotal) return { accepted: false, reason: "semantic_price_average_or_total" };
    if (regulatedOrFixed) return { accepted: false, reason: "semantic_price_regulated_or_fixed_component" };
    if (!expectedUnit || !commercialLabel) return { accepted: false, reason: "semantic_price_not_commercial_component" };
  }

  if (["quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno"].includes(spec.field)) {
    const regulated = /\b(trasporto|distribuzione|gestione\s+contatore|oneri|impost[ae]|accis[ae]|iva)\b/.test(text);
    const commercialFixed = /\b(quota|corrispettivo|componente|costo)\s+fiss[oa]\b|\b(commercializzazione|vendita|pcv|ccv|qvd)\b/.test(text);
    const hasCurrency = /€|\beur\b/.test(text);
    if (regulated) return { accepted: false, reason: "semantic_fixed_fee_regulated_component" };
    if (!commercialFixed || !hasCurrency) return { accepted: false, reason: "semantic_fixed_fee_not_commercial" };
  }

  if (["spread_luce_eur_kwh", "spread_gas_eur_smc"].includes(spec.field)) {
    const hasLabel = /\b(spread|margine|fee)\b/.test(text);
    const hasCurrency = /€|\beur\b/.test(text);
    const hasUnit = spec.field === "spread_luce_eur_kwh" ? /\bkwh\b/.test(text) : /\bsmc\b/.test(text);
    if (!hasLabel || !hasCurrency || !hasUnit) return { accepted: false, reason: "semantic_spread_not_explicit" };
  }

  return { accepted: true };
}

function normalizeAnswer(spec, answer) {
  if (!answer || answer.question_id !== spec.id || answer.found !== true) return { accepted: false, reason: "not_found" };
  if (Number(answer.confidence || 0) < 35) return { accepted: false, reason: "confidence_too_low" };
  const semantic = semanticValidation(spec, answer);
  if (!semantic.accepted) return semantic;
  if (["number", "fixed"].includes(spec.kind)) {
    const number = Number.isFinite(Number(answer.value_number)) ? Number(answer.value_number) : parseLocaleNumber(answer.value_text);
    if (!Number.isFinite(number)) return { accepted: false, reason: "invalid_number" };
    if (spec.kind === "fixed") {
      if (!['month', 'year'].includes(answer.period)) return { accepted: false, reason: "fixed_period_missing" };
      const value = answer.period === "month" ? Number((number * 12).toFixed(6)) : number;
      return {
        accepted: true,
        value,
        derivation: {
          type: answer.period === "month" ? "monthly_to_annual" : "annual_literal",
          original_value: number,
          original_unit: compact(answer.unit, 60) || null,
          factor: answer.period === "month" ? 12 : 1,
          derived_value: value,
        },
      };
    }
    if (number <= 0) return { accepted: false, reason: "invalid_number" };
    return { accepted: true, value: number };
  }
  const text = compact(answer.value_text, 300);
  if (!text) return { accepted: false, reason: "empty_text" };
  if (spec.kind === "code" || spec.kind === "offer_code") return { accepted: true, value: normalizeCode(spec.field, text) };
  if (spec.kind === "price_type") {
    const value = normalizePriceType(text);
    return value ? { accepted: true, value } : { accepted: false, reason: "invalid_price_type" };
  }
  if (spec.kind === "customer_type") {
    const value = normalizeCustomerType(text);
    return value ? { accepted: true, value } : { accepted: false, reason: "invalid_customer_type" };
  }
  if (spec.kind === "date") {
    const value = normalizeIsoDate(text);
    return value ? { accepted: true, value } : { accepted: false, reason: "invalid_date" };
  }
  return { accepted: true, value: text };
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
    source_snippet: compact(answer.evidence, 600) || compact(answer.value_text, 300),
    source_match: compact(answer.value_text, 180) || null,
    method: "openai_visual_ai_only",
    source_version: PDF_PURE_AI_READER_VERSION,
    derivation: normalized.derivation || null,
  };
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
  const offerSignals = presentFieldCount(input, [
    "nome_offerta_luce", "nome_offerta_gas", "codice_offerta_luce", "codice_offerta_gas",
    "tipo_prezzo_luce", "tipo_prezzo_gas", "indice_riferimento_luce", "indice_riferimento_gas",
    "spread_luce_eur_kwh", "spread_gas_eur_smc", "formula_prezzo_luce", "formula_prezzo_gas",
    "decorrenza_condizioni_economiche_luce", "decorrenza_condizioni_economiche_gas",
    "scadenza_condizioni_economiche_luce", "scadenza_condizioni_economiche_gas",
    "prezzo_luce_eur_kwh", "prezzo_gas_eur_smc",
    "quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno",
  ]);

  if (strongBillSignals > 0) {
    return { kind: "bolletta", reason: declaredKind === "bolletta" ? "declared_bill_confirmed" : "customer_specific_bill_signals" };
  }
  if (offerSignals >= 2) {
    return { kind: "scheda_offerta", reason: declaredKind === "scheda_offerta" ? "declared_offer_confirmed" : "offer_only_signals" };
  }
  if (declaredKind === "bolletta" && supportingBillSignals > 0) {
    return { kind: "bolletta", reason: "declared_bill_with_supporting_signals" };
  }
  return { kind: declaredKind, reason: declaredKind === "unknown" ? "insufficient_signals" : "declared_kind_without_conflict" };
}

function commoditySignalCount(input, commodity) {
  const fields = commodity === "luce"
    ? [
      "pod", "consumo_luce_kwh", "prezzo_luce_eur_kwh", "quota_fissa_vendita_luce_eur_anno",
      "nome_offerta_luce", "codice_offerta_luce", "tipo_prezzo_luce", "indice_riferimento_luce",
      "spread_luce_eur_kwh", "formula_prezzo_luce",
    ]
    : [
      "pdr", "consumo_gas_smc", "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno",
      "nome_offerta_gas", "codice_offerta_gas", "tipo_prezzo_gas", "indice_riferimento_gas",
      "spread_gas_eur_smc", "formula_prezzo_gas",
    ];
  return presentFieldCount(input, fields);
}

export function normalizePureAiOutput(parsed, {
  model = PDF_PURE_AI_DEFAULT_MODEL,
  responseId = null,
  transportMode = "pdf_originale",
  timings = {},
} = {}) {
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
    textExtracted: 0,
    needsReview: true,
  };
  const filledFields = [];
  const rejected = [];
  for (const spec of QUESTION_SPECS) {
    const answer = answerById.get(spec.id);
    const result = normalizeAnswer(spec, answer);
    if (!result.accepted) {
      rejected.push({ question_id: spec.id, reason: result.reason });
      continue;
    }
    normalized[spec.field] = result.value;
    filledFields.push(spec.field);
    normalized.diagnostics.push(diagnosticFor(spec, answer, result));
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
    "indice_riferimento_luce", "indice_riferimento_gas", "prezzo_luce_eur_kwh", "prezzo_gas_eur_smc",
    "quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno",
  ]);
  normalized.recognized = normalized.kind !== "unknown"
    && normalized.commodity !== "unknown"
    && (coreFieldCount(normalized) > 0 || (normalized.kind === "scheda_offerta" && offerRecognitionCount >= 2));
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
  const initialRemaining = remainingBudget();
  if (!Number.isFinite(initialRemaining) || initialRemaining < 8_000) throw new Error("openai_insufficient_time_budget");

  const fileStats = await fs.stat(filePath);
  const fileIdThreshold = boundedFileIdThreshold(env.PDF_AI_FILE_ID_THRESHOLD_BYTES);
  const useOpenAiFileId = Number(fileStats.size || 0) >= fileIdThreshold;
  let openAiFileId = "";
  let openAiFileUploadMs = 0;
  let openAiFileDeleted = null;
  let openAiFileDeleteError = null;
  let normalizedResult = null;
  let analysisError = null;

  try {
    if (useOpenAiFileId) {
      const uploadRemaining = remainingBudget();
      const uploadTimeoutMs = Math.min(
        boundedFileUploadTimeout(env.PDF_AI_FILE_UPLOAD_TIMEOUT_MS),
        uploadRemaining - 8_000,
      );
      if (!Number.isFinite(uploadTimeoutMs) || uploadTimeoutMs < 5_000) {
        throw new Error("openai_insufficient_time_budget");
      }
      const uploadController = new AbortController();
      let uploadTimeoutId;
      const uploadStartedAt = Date.now();
      try {
        const uploadTimeoutPromise = new Promise((_, reject) => {
          uploadTimeoutId = setTimeout(() => {
            uploadController.abort();
            reject(new Error("openai_file_upload_timeout"));
          }, uploadTimeoutMs);
        });
        const uploadRaw = await Promise.race([
          fileUploadTransport({
            filePath,
            filename,
            apiKey,
            signal: uploadController.signal,
          }),
          uploadTimeoutPromise,
        ]);
        const uploadBody = await openAiFileTransportBody(uploadRaw, "upload");
        openAiFileId = compact(uploadBody?.id, 180);
        if (!openAiFileId) throw new Error("openai_file_upload_invalid_response");
      } finally {
        clearTimeout(uploadTimeoutId);
        openAiFileUploadMs = Date.now() - uploadStartedAt;
      }
    }

    const requestStartedAt = Date.now();
    const request = await buildPdfPureAiRequest({
      filePath: useOpenAiFileId ? null : filePath,
      fileId: openAiFileId || null,
      filename,
      model,
    });
    const requestBuildMs = Date.now() - requestStartedAt;
    const openaiStartedAt = Date.now();
    const maxAttempts = 2;
    const retryDelayMs = boundedRetryDelay(env.PDF_AI_RETRY_DELAY_MS);
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt += 1;
      const remaining = remainingBudget();
      const timeoutMs = Math.min(configuredTimeout, remaining);
      if (!Number.isFinite(timeoutMs) || timeoutMs < 8_000) throw new Error("openai_insufficient_time_budget");

      const controller = new AbortController();
      let timeoutId;
      try {
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            controller.abort();
            reject(new Error("openai_timeout"));
          }, timeoutMs);
        });
        const raw = await Promise.race([
          transport({ request, apiKey, signal: controller.signal, attempt }),
          timeoutPromise,
        ]);
        const body = await transportBody(raw);
        if (body?.status === "incomplete") throw new Error(`openai_incomplete:${body?.incomplete_details?.reason || "unknown"}`);
        const outputText = responseOutputText(body);
        if (!outputText) throw new Error("openai_empty_output");
        const now = Date.now();
        normalizedResult = normalizePureAiOutput(JSON.parse(outputText), {
          model,
          responseId: compact(body?.id, 160) || null,
          transportMode: useOpenAiFileId ? "openai_file_id" : "pdf_originale",
          timings: {
            request_build_ms: requestBuildMs,
            openai_file_upload_ms: openAiFileUploadMs,
            openai_ms: now - openaiStartedAt,
            total_ms: now - startedAt,
            openai_attempts: attempt,
            input_file_bytes: Number(fileStats.size || 0),
            file_id_threshold_bytes: fileIdThreshold,
          },
        });
        break;
      } catch (error) {
        const retryable5xx = /^openai_http_(500|502|503|504):/i.test(String(error?.message || ""));
        const retryRemaining = remainingBudget() - retryDelayMs;
        const canRetry = attempt < maxAttempts && retryable5xx && Number.isFinite(retryRemaining) && retryRemaining >= 8_000;
        if (!canRetry) throw error;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (!normalizedResult) throw new Error("openai_invalid_output");
  } catch (error) {
    analysisError = error;
  } finally {
    if (openAiFileId) {
      const deleteController = new AbortController();
      let deleteTimeoutId;
      try {
        const deleteTimeoutMs = boundedFileDeleteTimeout(env.PDF_AI_FILE_DELETE_TIMEOUT_MS);
        const deleteTimeoutPromise = new Promise((_, reject) => {
          deleteTimeoutId = setTimeout(() => {
            deleteController.abort();
            reject(new Error("openai_file_delete_timeout"));
          }, deleteTimeoutMs);
        });
        const deleteRaw = await Promise.race([
          fileDeleteTransport({ fileId: openAiFileId, apiKey, signal: deleteController.signal }),
          deleteTimeoutPromise,
        ]);
        const deleteBody = await openAiFileTransportBody(deleteRaw, "delete");
        openAiFileDeleted = deleteBody?.deleted !== false;
        if (!openAiFileDeleted) throw new Error("openai_file_delete_not_confirmed");
      } catch (error) {
        openAiFileDeleted = false;
        openAiFileDeleteError = compact(error?.message || error, 180) || "openai_file_delete_failed";
      } finally {
        clearTimeout(deleteTimeoutId);
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
    };
    return normalizedResult;
  }
  throw analysisError || new Error("openai_invalid_output");
}

