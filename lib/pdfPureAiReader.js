import fs from "node:fs/promises";
import { applyPdfDataContract } from "./pdfDataContract.js";
import { applyPdfFieldValidation } from "./pdfFieldValidation.js";


export const PDF_PURE_AI_READER_VERSION = "pure-ai-native-pdf-v1.0.2";
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
- Il consumo annuo è il totale complessivo riferito a 12 mesi. Non usare il consumo del periodo fatturato, una lettura, una stima mensile o una singola fascia F1/F2/F3.
- Non sommare fasce o periodi: se il totale annuo non è scritto chiaramente, usa found=false.
- Per il prezzo luce cerca la componente di vendita energia elettrica espressa in EUR/kWh. Non usare il totale bolletta, la colonna Importi, il prezzo medio complessivo, rete, oneri o imposte.
- Per il prezzo gas cerca la componente di vendita gas naturale espressa in EUR/Smc. Non usare il totale bolletta, la colonna Importi, il prezzo medio complessivo, rete, oneri o imposte.
- Per le quote fisse usa solo la componente di vendita. Riporta il valore stampato e period=month oppure period=year; non annualizzare.
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

function boundedTimeout(value) {
  const parsed = Number(value || 46_000);
  return Math.max(8_000, Math.min(48_000, Number.isFinite(parsed) ? parsed : 46_000));
}

function boundedRetryDelay(value) {
  const parsed = Number(value ?? 750);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(2_000, parsed)) : 750;
}

export async function buildPdfPureAiRequest({
  filePath,
  filename = "documento.pdf",
  model = process.env.PDF_AI_PRIMARY_MODEL || PDF_PURE_AI_DEFAULT_MODEL,
} = {}) {
  if (!filePath) throw new Error("pure_ai_file_path_required");
  const bytes = await fs.readFile(filePath);
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
          {
            type: "input_file",
            filename: filename || "documento.pdf",
            file_data: `data:application/pdf;base64,${bytes.toString("base64")}`,
          },
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

function normalizeAnswer(spec, answer) {
  if (!answer || answer.question_id !== spec.id || answer.found !== true) return { accepted: false, reason: "not_found" };
  if (Number(answer.confidence || 0) < 35) return { accepted: false, reason: "confidence_too_low" };
  if (["number", "fixed"].includes(spec.kind)) {
    const number = Number.isFinite(Number(answer.value_number)) ? Number(answer.value_number) : parseLocaleNumber(answer.value_text);
    if (!Number.isFinite(number) || number <= 0) return { accepted: false, reason: "invalid_number" };
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
    const hasLuce = Boolean(normalized.pod || normalized.consumo_luce_kwh || normalized.prezzo_luce_eur_kwh);
    const hasGas = Boolean(normalized.pdr || normalized.consumo_gas_smc || normalized.prezzo_gas_eur_smc);
    normalized.commodity = hasLuce && hasGas ? "dual" : hasLuce ? "luce" : hasGas ? "gas" : "unknown";
  }
  if (normalized.kind === "unknown" && coreFieldCount(normalized) > 0) normalized.kind = "bolletta";
  if (!normalized.fornitore_luce && normalized.fornitore && ["luce", "dual"].includes(normalized.commodity)) normalized.fornitore_luce = normalized.fornitore;
  if (!normalized.fornitore_gas && normalized.fornitore && ["gas", "dual"].includes(normalized.commodity)) normalized.fornitore_gas = normalized.fornitore;
  if (!normalized.codice_cliente_luce && normalized.codice_cliente && ["luce", "dual"].includes(normalized.commodity)) normalized.codice_cliente_luce = normalized.codice_cliente;
  if (!normalized.codice_cliente_gas && normalized.codice_cliente && ["gas", "dual"].includes(normalized.commodity)) normalized.codice_cliente_gas = normalized.codice_cliente;

  normalized.recognized = normalized.kind !== "unknown" && normalized.commodity !== "unknown" && coreFieldCount(normalized) > 0;
  normalized.confidence = normalized.recognized ? "medium" : "low";
  normalized.warnings = ["lettura_solo_ia_da_verificare"];
  normalized.ocr = { attempted: false, applied: false, reason: "ai_only_mode" };
  normalized.ai = {
    applied: true,
    reader_version: PDF_PURE_AI_READER_VERSION,
    pipeline_version: PDF_PURE_AI_READER_VERSION,
    model,
    response_id: responseId,
    transport_mode: transportMode,
    request_build_ms: Number(timings.request_build_ms || 0),
    openai_ms: Number(timings.openai_ms || 0),
    total_ms: Number(timings.total_ms || 0),
    openai_attempts: Math.max(1, Number(timings.openai_attempts || 1)),
    retry_count: Math.max(0, Number(timings.openai_attempts || 1) - 1),
    page_count: normalized.page_count,
    accepted_count: filledFields.length,
    filled_fields: [...new Set(filledFields)],
    rejected_questions: rejected,
  };
  return applyPdfDataContract(applyPdfFieldValidation(normalized));
}

export async function extractPdfPureAi({
  filePath,
  filename = "documento.pdf",
  deadlineAt = null,
  transport = defaultTransport,
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.PDF_AI_PRIMARY_MODEL || PDF_PURE_AI_DEFAULT_MODEL,
  env = process.env,
} = {}) {
  if (!apiKey) throw new Error("openai_missing_api_key");
  const startedAt = Date.now();
  const configuredTimeout = boundedTimeout(env.PDF_AI_TIMEOUT_MS || env.PDF_AI_DIRECT_TIMEOUT_MS);
  const remainingBudget = () => deadlineAt
    ? Number(deadlineAt) - Date.now() - 2_000
    : configuredTimeout - (Date.now() - startedAt);
  const initialRemaining = remainingBudget();
  if (!Number.isFinite(initialRemaining) || initialRemaining < 8_000) throw new Error("openai_insufficient_time_budget");

  const requestStartedAt = Date.now();
  const request = await buildPdfPureAiRequest({ filePath, filename, model });
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
      return normalizePureAiOutput(JSON.parse(outputText), {
        model,
        responseId: compact(body?.id, 160) || null,
        transportMode: "pdf_originale",
        timings: {
          request_build_ms: requestBuildMs,
          openai_ms: now - openaiStartedAt,
          total_ms: now - startedAt,
          openai_attempts: attempt,
        },
      });
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

  throw new Error("openai_invalid_output");
}

