import fs from "node:fs/promises";
import { applyPdfDataContract } from "./pdfDataContract.js";
import { applyPdfFieldValidation } from "./pdfFieldValidation.js";


export const PDF_PURE_AI_READER_VERSION = "pure-ai-native-pdf-v1.0.7";
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
  { id: "prezzo_luce_eur_kwh", field: "prezzo_luce_eur_kwh", kind: "number", question: "Qual è il prezzo contrattuale della componente commerciale energia in EUR/kWh? Non usare costo medio, costo unitario medio, spesa totale, stime annuali, esempi di calcolo, rete, oneri o imposte. Se il documento mostra soltanto prezzi fatturati F1/F2/F3 o una formula variabile incompleta, usa found=false per questo singolo prezzo." },
  { id: "quota_fissa_vendita_luce", field: "quota_fissa_vendita_luce_eur_anno", kind: "fixed", question: "Qual è la quota fissa commerciale di vendita luce? Escludi rete, trasporto, contatore e oneri. Indica period=month o year soltanto se €/mese, mensile, €/anno o annuale sono stampati nella stessa evidenza; altrimenti usa found=false." },
  { id: "nome_offerta_luce", field: "nome_offerta_luce", kind: "text", question: "Qual è il nome commerciale esatto dell'offerta luce? In una scheda sintetica usa il titolo/nome dell'offerta, non una descrizione generica." },
  { id: "codice_offerta_luce", field: "codice_offerta_luce", kind: "offer_code", question: "Qual è il codice offerta luce? Copialo carattere per carattere." },
  { id: "tipo_prezzo_luce", field: "tipo_prezzo_luce", kind: "price_type", question: "Le condizioni economiche luce dichiarano prezzo fisso, variabile o ibrido? Riporta solo ciò che è esplicitamente indicato." },
  { id: "indice_riferimento_luce", field: "indice_riferimento_luce", kind: "text", question: "Qual è l'indice contrattuale luce, per esempio PUN o PUN Index GME? Non usare valori storici mostrati come esempio." },
  { id: "spread_luce_eur_kwh", field: "spread_luce_eur_kwh", kind: "number", question: "Qual è lo spread/corrispettivo fisso della formula luce esplicitamente indicato in EUR/kWh? Non ricavarlo per sottrazione." },
  { id: "periodicita_aggiornamento_indice_luce", field: "periodicita_aggiornamento_indice_luce", kind: "text", question: "Qual è la periodicità contrattuale di aggiornamento dell'indice luce?" },
  { id: "struttura_prezzo_luce", field: "struttura_prezzo_luce", kind: "text", question: "La struttura del prezzo luce è monoraria oppure per fasce F1/F2/F3?" },
  { id: "formula_prezzo_luce", field: "formula_prezzo_luce", kind: "text", question: "Qual è la formula contrattuale completa del prezzo luce stampata nel documento? Non usare formule di esempio o di rinnovo futuro come formula dell'offerta corrente." },
  { id: "decorrenza_condizioni_economiche_luce", field: "decorrenza_condizioni_economiche_luce", kind: "date", question: "Qual è la data di decorrenza o inizio validità delle condizioni economiche luce?" },
  { id: "scadenza_condizioni_economiche_luce", field: "scadenza_condizioni_economiche_luce", kind: "date", question: "Qual è la data di scadenza o fine validità delle condizioni economiche luce?" },

  { id: "indirizzo_fornitura_gas", field: "indirizzo_fornitura_gas", kind: "text", question: "Qual è l'indirizzo completo del punto di fornitura gas?" },
  { id: "pdr", field: "pdr", kind: "code", question: "Qual è il PDR della fornitura gas? Copialo carattere per carattere." },
  { id: "consumo_gas_smc", field: "consumo_gas_smc", kind: "number", question: "Esiste un consumo totale gas riferito realmente a 12 mesi completi in Smc? Non usare consumi fatturati, consumi del periodo, consumi da inizio fornitura con meno di 12 mesi, esempi o proiezioni. Se i 12 mesi non sono dimostrati usa found=false." },
  { id: "prezzo_gas_eur_smc", field: "prezzo_gas_eur_smc", kind: "number", question: "Qual è il prezzo contrattuale della componente commerciale gas in EUR/Smc? Non usare costo medio, costo unitario medio, spesa totale, stime annuali, esempi, rete, oneri o imposte. Se è disponibile soltanto una formula variabile incompleta o un prezzo fatturato del periodo usa found=false." },
  { id: "quota_fissa_vendita_gas", field: "quota_fissa_vendita_gas_eur_anno", kind: "fixed", question: "Qual è la quota fissa commerciale di vendita gas? Escludi rete, distribuzione, contatore e oneri. Indica period=month o year soltanto se la periodicità è stampata nella stessa evidenza; altrimenti usa found=false." },
  { id: "nome_offerta_gas", field: "nome_offerta_gas", kind: "text", question: "Qual è il nome commerciale esatto dell'offerta gas? In una scheda sintetica usa il titolo/nome dell'offerta, non una descrizione generica." },
  { id: "codice_offerta_gas", field: "codice_offerta_gas", kind: "offer_code", question: "Qual è il codice offerta gas? Copialo carattere per carattere." },
  { id: "tipo_prezzo_gas", field: "tipo_prezzo_gas", kind: "price_type", question: "Le condizioni economiche gas dichiarano prezzo fisso, variabile o ibrido? Riporta solo ciò che è esplicitamente indicato." },
  { id: "indice_riferimento_gas", field: "indice_riferimento_gas", kind: "text", question: "Qual è l'indice contrattuale gas, per esempio PSV? Non usare valori storici mostrati come esempio." },
  { id: "spread_gas_eur_smc", field: "spread_gas_eur_smc", kind: "number", question: "Qual è lo spread/corrispettivo della formula gas esplicitamente indicato in EUR/Smc? Non ricavarlo per sottrazione." },
  { id: "periodicita_aggiornamento_indice_gas", field: "periodicita_aggiornamento_indice_gas", kind: "text", question: "Qual è la periodicità contrattuale di aggiornamento dell'indice gas?" },
  { id: "formula_prezzo_gas", field: "formula_prezzo_gas", kind: "text", question: "Qual è la formula contrattuale completa del prezzo gas stampata nel documento? Non usare formule di esempio o valori del solo periodo fatturato." },
  { id: "decorrenza_condizioni_economiche_gas", field: "decorrenza_condizioni_economiche_gas", kind: "date", question: "Qual è la data di decorrenza o inizio validità delle condizioni economiche gas?" },
  { id: "scadenza_condizioni_economiche_gas", field: "scadenza_condizioni_economiche_gas", kind: "date", question: "Qual è la data di scadenza o fine validità delle condizioni economiche gas?" },
]);

export const PDF_PURE_AI_QUESTION_IDS = Object.freeze(QUESTION_SPECS.map((spec) => spec.id));
const QUESTION_BY_ID = new Map(QUESTION_SPECS.map((spec) => [spec.id, spec]));

const ESSENTIAL_QUESTION_IDS = Object.freeze([
  "fornitore", "fornitore_luce", "fornitore_gas", "customer_type", "intestatario",
  "codice_fiscale", "codice_cliente", "pod", "pdr", "potenza_impegnata_kw",
  "potenza_disponibile_kw", "consumo_luce_kwh", "consumo_gas_smc",
  "prezzo_luce_eur_kwh", "prezzo_gas_eur_smc",
  "quota_fissa_vendita_luce", "quota_fissa_vendita_gas",
  "nome_offerta_luce", "nome_offerta_gas", "codice_offerta_luce", "codice_offerta_gas",
  "tipo_prezzo_luce", "tipo_prezzo_gas", "indice_riferimento_luce", "indice_riferimento_gas",
  "spread_luce_eur_kwh", "spread_gas_eur_smc", "struttura_prezzo_luce",
  "formula_prezzo_luce", "formula_prezzo_gas",
]);
const ESSENTIAL_QUESTION_ID_SET = new Set(ESSENTIAL_QUESTION_IDS);

const ANSWER_SOURCE_ROLES = Object.freeze([
  "identity", "customer_data", "annual_total", "period_total", "contract_term",
  "billed_rate", "average_cost", "regulated", "example", "unknown",
]);

const ANSWER_CERTAINTY = Object.freeze(["certain", "derived", "review", "not_available"]);

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
    evidence: { type: ["string", "null"], maxLength: 450 },
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
      minItems: 0,
      maxItems: QUESTION_SPECS.length,
      items: ANSWER_SCHEMA,
    },
  },
};

const SYSTEM_PROMPT = `Sei il lettore visuale di OffertaLogica, specializzato in bollette, schede sintetiche e condizioni economiche luce e gas italiane.

OBIETTIVO
Estrai tutti i dati realmente presenti che possono servire a identificare la fornitura e completare un confronto. Una lettura parziale è valida: non bloccare l'intero documento se alcuni campi mancano.

REGOLE OBBLIGATORIE
- Analizza tutte le pagine come un unico documento multipagina e tratta luce e gas separatamente.
- Copia solo dati visibili. Non inventare, non stimare, non annualizzare e non completare valori mancanti.
- Nell'array answers inserisci soltanto le risposte effettivamente trovate. Non creare una risposta found=false per ogni domanda assente.
- Per ogni risposta trovata usa found=true e riporta valore, pagina, etichetta reale ed evidence breve (massimo due righe, circa 300 caratteri) che lo dimostra.
- Non inserire nel label il nome tecnico della domanda: usa l'etichetta stampata nel documento.
- POD, PDR, codice fiscale, codice cliente e codice offerta devono essere copiati carattere per carattere.
- La partita IVA dell'intestatario non va confusa con quella del venditore. Non classificare business solo perché compare la partita IVA del venditore.

CONSUMI
- Un consumo è annuale solo se il valore è dichiarato come consumo annuo o totale degli ultimi 12 mesi e non è contraddetto dalla stessa evidenza.
- La sola intestazione “ultimi 12 mesi” non basta se la riga dice “da inizio fornitura” o se risultano meno di 12 mesi.
- Non usare consumi fatturati, del periodo, del mese, letture, stime, proiezioni o singole fasce come consumo annuo.

PREZZI E COSTI
- Per prezzo luce/gas usa soltanto una condizione commerciale contrattuale in EUR/kWh o EUR/Smc.
- Non usare costo medio, costo unitario della materia, costo dell'intera bolletta, spesa annua stimata, esempi di consumo, importi totali, rete, oneri o imposte.
- Se una bolletta mostra prezzi F1/F2/F3 del solo periodo, non trasformarli in un unico prezzo contrattuale.
- Per offerte variabili separa indice, spread, formula e periodicità. Non ricavare lo spread per sottrazione e non sommare indice e spread.
- Per la quota fissa indica period=month o year soltanto quando la stessa evidenza contiene chiaramente €/mese, mensile, €/anno o annuale. Non dedurre la periodicità dalla quantità 1.

SCHEDE SINTETICHE E CONDIZIONI ECONOMICHE
- Riporta, quando presenti: venditore, nome esatto offerta, codice offerta, commodity, destinatari, tipo prezzo, prezzo commerciale, quota fissa, indice, spread, formula, periodicità e validità.
- Non usare tabelle di spesa annua stimata, esempi per profili di consumo, valori storici dell'indice, rinnovi futuri o componenti regolate come condizioni dell'offerta corrente.
- I dati di una scheda descrivono esclusivamente una nuova offerta: non cercare POD, PDR, codice cliente o consumo dell'utente.

CLASSIFICAZIONE
- bill: bolletta riferita a un cliente o punto di fornitura specifico.
- offer_sheet: scheda sintetica o condizioni economiche senza dati specifici del cliente.
- unknown: documento non pertinente o non classificabile.

Restituisci soltanto JSON conforme allo schema.`;

function questionSpecsForProfile(profile = "full") {
  return profile === "essential"
    ? QUESTION_SPECS.filter((spec) => ESSENTIAL_QUESTION_ID_SET.has(spec.id))
    : QUESTION_SPECS;
}

function userPromptFor(specs, profile = "full") {
  const prefix = profile === "essential"
    ? "RECUPERO RAPIDO: cerca prima i dati essenziali sotto elencati. Restituisci subito tutti quelli leggibili, anche se il risultato resta parziale."
    : "Rispondi alle domande sotto elencate. Ometti completamente le domande il cui dato non è presente o non è dimostrato.";
  return `${prefix}

${specs
    .map((spec, index) => `${index + 1}. ${spec.id}: ${spec.question}`)
    .join("\n")}`;
}

function outputSchemaFor(specs) {
  const ids = specs.map((spec) => spec.id);
  return {
    ...OUTPUT_SCHEMA,
    properties: {
      ...OUTPUT_SCHEMA.properties,
      answers: {
        ...OUTPUT_SCHEMA.properties.answers,
        maxItems: specs.length,
        items: {
          ...ANSWER_SCHEMA,
          properties: {
            ...ANSWER_SCHEMA.properties,
            question_id: { type: "string", enum: ids },
          },
        },
      },
    },
  };
}

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

function boundedRecoveryTimeout(value) {
  const parsed = Number(value ?? 11_000);
  return Number.isFinite(parsed) ? Math.max(8_000, Math.min(14_000, parsed)) : 11_000;
}

function recoveryModel(env, primaryModel) {
  const configured = compact(env?.PDF_AI_RECOVERY_MODEL, 120);
  return configured || (primaryModel === "gpt-4.1-2025-04-14" ? "gpt-4.1-mini-2025-04-14" : primaryModel);
}

function recoverableAnalysisError(error) {
  const message = String(error?.message || error || "");
  return /openai_timeout|openai_incomplete|openai_empty_output|openai_invalid_output|Unexpected end of JSON|JSON at position|unterminated/i.test(message);
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
  profile = "full",
  maxOutputTokens = null,
} = {}) {
  if (!filePath && !fileId) throw new Error("pure_ai_file_path_required");
  const specs = questionSpecsForProfile(profile);
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
    max_output_tokens: Number(maxOutputTokens || (profile === "essential" ? 1_800 : 3_400)),
    input: [
      { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
      {
        role: "user",
        content: [
          fileInput,
          { type: "input_text", text: userPromptFor(specs, profile) },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: profile === "essential" ? "offertalogica_pure_ai_essential" : "offertalogica_pure_ai_document",
        description: profile === "essential"
          ? "Recupero rapido dei dati essenziali da bollette e schede italiane"
          : "Risposte compatte a domande mirate su bollette e schede sintetiche italiane",
        strict: true,
        schema: outputSchemaFor(specs),
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

function comparisonCriticalField(field) {
  return [
    "consumo_luce_kwh", "consumo_gas_smc", "prezzo_luce_eur_kwh", "prezzo_gas_eur_smc",
    "quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno",
    "nome_offerta_luce", "nome_offerta_gas", "codice_offerta_luce", "codice_offerta_gas",
    "tipo_prezzo_luce", "tipo_prezzo_gas", "indice_riferimento_luce", "indice_riferimento_gas",
    "spread_luce_eur_kwh", "spread_gas_eur_smc", "formula_prezzo_luce", "formula_prezzo_gas",
    "decorrenza_condizioni_economiche_luce", "decorrenza_condizioni_economiche_gas",
    "scadenza_condizioni_economiche_luce", "scadenza_condizioni_economiche_gas",
  ].includes(field);
}

function comparisonEconomicField(field) {
  return [
    "consumo_luce_kwh", "consumo_gas_smc", "prezzo_luce_eur_kwh", "prezzo_gas_eur_smc",
    "quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno",
    "tipo_prezzo_luce", "tipo_prezzo_gas", "indice_riferimento_luce", "indice_riferimento_gas",
    "spread_luce_eur_kwh", "spread_gas_eur_smc", "formula_prezzo_luce", "formula_prezzo_gas",
  ].includes(field);
}

function semanticValidation(spec, answer, document = {}) {
  const text = answerSemanticText(answer);
  if (!text) return { accepted: false, reason: "semantic_evidence_missing" };
  const role = sourceRole(answer);
  const certainty = answerCertainty(answer);
  const usable = answerUsable(answer, role);
  const isOfferSheet = document?.kind === "offer_sheet";

  if (comparisonCriticalField(spec.field) && ["review", "not_available"].includes(certainty)) {
    return { accepted: false, reason: "semantic_answer_not_certain" };
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

  if (["prezzo_luce_eur_kwh", "prezzo_gas_eur_smc"].includes(spec.field)) {
    const averageOrTotal = /\b(costo|prezzo|spesa)\s+medi[oa]\b|\bmedi[oa]\s+unitari[oa]\b|\bcosto\s+unitario\s+(?:della|del|di)\b|\btotale\s+(bolletta|fattura|da\s+pagare)\b|\bimporto\s+totale\b|\bspesa\s+totale\b|\bspesa\s+annua\s+stimat[ae]\b/.test(text);
    const examples = /\b(esempio|simulazione|valori\s+recenti|valore\s+massimo|rinnovo\s+in\s+assenza|profili?\s+di\s+consumo)\b/.test(text);
    const regulatedOrFixed = /\b(trasporto|distribuzione|gestione\s+contatore|oneri|impost[ae]|accis[ae]|iva|commercializzazione\s+fiss|quota\s+fissa|rete)\b/.test(text);
    const hasCurrency = /€|\beur\b/.test(text);
    const expectedUnit = hasCurrency && (spec.field === "prezzo_luce_eur_kwh"
      ? /\bkwh\b/.test(text)
      : /\bsmc\b|standard\s*m(?:3|³)/.test(text));
    const commercialLabel = (/\b(prezzo|corrispettivo|componente)\b/.test(text)
      && /\b(energia|elettrica|gas|materia|vendita|fornitura|consumo)\b/.test(text))
      || /\bvendita\s+(?:di\s+)?(?:energia|gas)\b/.test(text)
      || /\bmateria\s+(?:prima\s+)?(?:energia|gas)\b/.test(text);
    if (averageOrTotal || role === "average_cost") return { accepted: false, reason: "semantic_price_average_or_total" };
    if (examples || role === "example") return { accepted: false, reason: "semantic_price_example_or_estimate" };
    if (regulatedOrFixed || role === "regulated") return { accepted: false, reason: "semantic_price_regulated_or_fixed_component" };
    if (["period_total", "billed_rate"].includes(role)) return { accepted: false, reason: `semantic_price_source_${role}` };
    if (isOfferSheet && role !== "contract_term") return { accepted: false, reason: "semantic_offer_price_not_contract_term" };
    if (!expectedUnit || !commercialLabel) return { accepted: false, reason: "semantic_price_not_commercial_component" };
    if (!usable) return { accepted: false, reason: "semantic_not_usable_for_comparison" };
  }

  if (["quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno"].includes(spec.field)) {
    const regulated = /\b(trasporto|distribuzione|gestione\s+contatore|oneri|impost[ae]|accis[ae]|iva|rete)\b/.test(text);
    const commercialFixed = /\b(quota|corrispettivo|componente|costo)\s+fiss[oa]\b|\b(commercializzazione|vendita|pcv|ccv|qvd)\b/.test(text);
    const hasCurrency = /€|\beur\b/.test(text);
    const monthlyEvidence = /€\s*\/?\s*(?:pod\s*\/\s*)?mese\b|\beur\s*\/?\s*(?:pod\s*\/\s*)?mese\b|\bmensil[ei]\b|\bal\s+mese\b/.test(text);
    const annualEvidence = /€\s*\/?\s*(?:pod|pdr|utenza)?\s*\/?\s*anno\b|\beur\s*\/?\s*(?:pod|pdr|utenza)?\s*\/?\s*anno\b|\bannu(?:o|ale|i|ali)\b|\ball['’]?anno\b/.test(text);
    if (regulated || role === "regulated") return { accepted: false, reason: "semantic_fixed_fee_regulated_component" };
    if (!commercialFixed || !hasCurrency) return { accepted: false, reason: "semantic_fixed_fee_not_commercial" };
    if (answer.period === "month" && !monthlyEvidence) return { accepted: false, reason: "semantic_fixed_month_not_evidenced" };
    if (answer.period === "year" && !annualEvidence) return { accepted: false, reason: "semantic_fixed_year_not_evidenced" };
    if (role !== "contract_term") return { accepted: false, reason: `semantic_fixed_source_${role}` };
    if (!usable) return { accepted: false, reason: "semantic_not_usable_for_comparison" };
  }

  if (["spread_luce_eur_kwh", "spread_gas_eur_smc"].includes(spec.field)) {
    const hasLabel = /\b(spread|margine|fee|corrispettivo\s+fiss[oa])\b/.test(text);
    const hasCurrency = /€|\beur\b/.test(text);
    const hasUnit = spec.field === "spread_luce_eur_kwh" ? /\bkwh\b/.test(text) : /\bsmc\b/.test(text);
    if (role !== "contract_term") return { accepted: false, reason: "semantic_spread_not_contract_term" };
    if (!hasLabel || !hasCurrency || !hasUnit) return { accepted: false, reason: "semantic_spread_not_explicit" };
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
    const number = Number.isFinite(Number(answer.value_number)) ? Number(answer.value_number) : parseLocaleNumber(answer.value_text);
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
    if (number <= 0) return { accepted: false, reason: "invalid_number" };
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
    "spread_luce_eur_kwh", "spread_gas_eur_smc", "formula_prezzo_luce", "formula_prezzo_gas",
    "decorrenza_condizioni_economiche_luce", "decorrenza_condizioni_economiche_gas",
    "scadenza_condizioni_economiche_luce", "scadenza_condizioni_economiche_gas",
    "prezzo_luce_eur_kwh", "prezzo_gas_eur_smc",
    "quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno",
  ]);

  if (strongBillSignals > 0) {
    return { kind: "bolletta", reason: declaredKind === "bolletta" ? "declared_bill_confirmed" : "customer_specific_bill_signals" };
  }
  if (offerIdentitySignals >= 1 && offerEconomicSignals >= 1) {
    return { kind: "scheda_offerta", reason: declaredKind === "scheda_offerta" ? "declared_offer_confirmed" : "offer_identity_and_economic_signals" };
  }
  if (declaredKind === "scheda_offerta" && offerEconomicSignals >= 2) {
    return { kind: "scheda_offerta", reason: "declared_offer_with_economic_signals" };
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
    verification_protocol: "targeted_questions_compact_v2",
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
  const recoveryTimeout = boundedRecoveryTimeout(env.PDF_AI_RECOVERY_TIMEOUT_MS);
  const remainingBudget = () => deadlineAt
    ? Number(deadlineAt) - Date.now() - 2_000
    : configuredTimeout + recoveryTimeout - (Date.now() - startedAt);
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
  let recoveredFrom = null;
  let recoveryAttempted = false;
  let totalOpenAiAttempts = 0;
  let requestBuildMs = 0;
  const openaiStartedAt = Date.now();

  async function runProfile({ profile, requestModel, timeoutMs, allow5xxRetry }) {
    const buildStartedAt = Date.now();
    const request = await buildPdfPureAiRequest({
      filePath: useOpenAiFileId ? null : filePath,
      fileId: openAiFileId || null,
      filename,
      model: requestModel,
      profile,
    });
    requestBuildMs += Date.now() - buildStartedAt;
    const maxAttempts = allow5xxRetry ? 2 : 1;
    const retryDelayMs = boundedRetryDelay(env.PDF_AI_RETRY_DELAY_MS);
    let profileAttempt = 0;

    while (profileAttempt < maxAttempts) {
      profileAttempt += 1;
      totalOpenAiAttempts += 1;
      const remaining = remainingBudget();
      const effectiveTimeout = Math.min(timeoutMs, remaining);
      if (!Number.isFinite(effectiveTimeout) || effectiveTimeout < 8_000) throw new Error("openai_insufficient_time_budget");

      const controller = new AbortController();
      let timeoutId;
      try {
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            controller.abort();
            reject(new Error("openai_timeout"));
          }, effectiveTimeout);
        });
        const raw = await Promise.race([
          transport({
            request,
            apiKey,
            signal: controller.signal,
            attempt: totalOpenAiAttempts,
            profile,
          }),
          timeoutPromise,
        ]);
        const body = await transportBody(raw);
        if (body?.status === "incomplete") throw new Error(`openai_incomplete:${body?.incomplete_details?.reason || "unknown"}`);
        const outputText = responseOutputText(body);
        if (!outputText) throw new Error("openai_empty_output");
        const now = Date.now();
        const normalized = normalizePureAiOutput(JSON.parse(outputText), {
          model: requestModel,
          responseId: compact(body?.id, 160) || null,
          transportMode: useOpenAiFileId ? "openai_file_id" : "pdf_originale",
          timings: {
            request_build_ms: requestBuildMs,
            openai_file_upload_ms: openAiFileUploadMs,
            openai_ms: now - openaiStartedAt,
            total_ms: now - startedAt,
            openai_attempts: totalOpenAiAttempts,
            input_file_bytes: Number(fileStats.size || 0),
            file_id_threshold_bytes: fileIdThreshold,
          },
        });
        normalized.ai = {
          ...(normalized.ai || {}),
          request_profile: profile,
          recovery_attempted: recoveryAttempted,
          recovered_from: recoveredFrom,
        };
        return normalized;
      } catch (error) {
        const retryable5xx = /^openai_http_(500|502|503|504):/i.test(String(error?.message || ""));
        const retryRemaining = remainingBudget() - retryDelayMs;
        const canRetry = profileAttempt < maxAttempts
          && retryable5xx
          && Number.isFinite(retryRemaining)
          && retryRemaining >= 8_000;
        if (!canRetry) throw error;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      } finally {
        clearTimeout(timeoutId);
      }
    }
    throw new Error("openai_invalid_output");
  }

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
          fileUploadTransport({ filePath, filename, apiKey, signal: uploadController.signal }),
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

    const availableBeforePrimary = remainingBudget();
    const reserveForRecovery = Math.min(recoveryTimeout, Math.max(0, availableBeforePrimary - 8_000));
    const primaryTimeout = Math.min(configuredTimeout, availableBeforePrimary - reserveForRecovery);
    try {
      normalizedResult = await runProfile({
        profile: "full",
        requestModel: model,
        timeoutMs: primaryTimeout,
        allow5xxRetry: true,
      });
    } catch (error) {
      analysisError = error;
      const remaining = remainingBudget();
      if (recoverableAnalysisError(error) && Number.isFinite(remaining) && remaining >= 8_000) {
        recoveryAttempted = true;
        recoveredFrom = compact(error?.message || error, 180) || "primary_failed";
        try {
          normalizedResult = await runProfile({
            profile: "essential",
            requestModel: recoveryModel(env, model),
            timeoutMs: Math.min(recoveryTimeout, remaining),
            allow5xxRetry: false,
          });
        } catch (recoveryError) {
          const primaryMessage = compact(error?.message || error, 140) || "primary_failed";
          const recoveryMessage = compact(recoveryError?.message || recoveryError, 140) || "recovery_failed";
          throw new Error(`openai_recovery_failed:${primaryMessage}:${recoveryMessage}`);
        }
      } else {
        throw error;
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
      recovery_attempted: recoveryAttempted,
      recovered_from: recoveredFrom,
      openai_attempts: Math.max(1, totalOpenAiAttempts),
      retry_count: Math.max(0, totalOpenAiAttempts - 1),
    };
    return normalizedResult;
  }
  throw analysisError || new Error("openai_invalid_output");
}
