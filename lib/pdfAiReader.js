import fs from "node:fs/promises";
import {
  PDF_AI_CRITICAL_MODEL,
  PDF_AI_PRIMARY_MODEL,
  pdfAiConfig,
} from "./pdfAiConfig.js";
import { aiPdfToCandidates, pdfFieldNames } from "./pdfReaderContract.js";

export const PDF_AI_ADAPTER_VERSION = "step8-clean-reader-v6-targeted-label-questions";
export { PDF_AI_PRIMARY_MODEL };
export const PDF_AI_ESCALATION_MODEL = PDF_AI_CRITICAL_MODEL;

const CANDIDATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "field", "value_text", "value_number", "unit", "commodity", "page", "label",
    "evidence", "semantic_role", "confidence", "agrees_with", "contradicts",
  ],
  properties: {
    field: { type: "string" },
    value_text: { type: ["string", "null"] },
    value_number: { type: ["number", "null"] },
    unit: { type: ["string", "null"] },
    commodity: {
      type: "string",
      enum: ["electricity", "gas", "dual", "not_applicable", "unknown"],
    },
    page: { type: ["integer", "null"] },
    label: { type: ["string", "null"] },
    evidence: { type: "string", maxLength: 360 },
    semantic_role: {
      type: "string",
      enum: [
        "actual_customer_value", "expected_or_estimated_customer_value", "offer_value",
        "billing_period", "contract_period", "threshold", "example", "discount",
        "penalty", "network_component", "sales_component", "tax", "identifier",
        "classification", "unknown",
      ],
    },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    agrees_with: {
      type: "array",
      items: { type: "string", enum: ["parser", "ocr"] },
    },
    contradicts: {
      type: "array",
      items: { type: "string", enum: ["parser", "ocr"] },
    },
  },
};


const CONSUMPTION_OBSERVATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["commodity", "page", "label", "value_number", "unit", "period_role", "evidence", "confidence"],
  properties: {
    commodity: { type: "string", enum: ["electricity", "gas", "unknown"] },
    page: { type: ["integer", "null"] },
    label: { type: ["string", "null"], maxLength: 220 },
    value_number: { type: ["number", "null"] },
    unit: { type: ["string", "null"], maxLength: 60 },
    period_role: { type: "string", enum: ["annual", "billing_period", "monthly", "meter_reading", "other", "unknown"] },
    evidence: { type: "string", maxLength: 420 },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
  },
};

const ECONOMIC_ROW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "commodity", "page", "section_label", "row_label", "row_relation",
    "quantity_number", "quantity_unit", "amount_number", "amount_unit",
    "unit_rate_number", "unit_rate_unit", "period_unit", "component_role",
    "price_basis", "validity_role", "formula_text", "index_reference",
    "evidence", "confidence",
  ],
  properties: {
    commodity: { type: "string", enum: ["electricity", "gas", "unknown"] },
    page: { type: ["integer", "null"] },
    section_label: { type: ["string", "null"], maxLength: 180 },
    row_label: { type: ["string", "null"], maxLength: 240 },
    row_relation: { type: "string", enum: ["parent", "child", "standalone", "unknown"] },
    quantity_number: { type: ["number", "null"] },
    quantity_unit: { type: ["string", "null"], maxLength: 60 },
    amount_number: { type: ["number", "null"] },
    amount_unit: { type: ["string", "null"], maxLength: 60 },
    unit_rate_number: { type: ["number", "null"] },
    unit_rate_unit: { type: ["string", "null"], maxLength: 60 },
    period_unit: { type: "string", enum: ["month", "year", "none", "unknown"] },
    component_role: {
      type: "string",
      enum: [
        "sales_variable", "sales_fixed", "network_variable", "network_fixed",
        "power", "tax", "average_or_total", "consumption", "discount_or_adjustment",
        "other", "unknown",
      ],
    },
    price_basis: {
      type: "string",
      enum: [
        "total_unit_price", "spread", "index_value", "fixed_charge",
        "single_component", "average_or_total", "not_applicable", "unknown",
      ],
    },
    validity_role: {
      type: "string",
      enum: ["current_contract", "future_or_renewal", "expired", "unclear"],
    },
    formula_text: { type: ["string", "null"], maxLength: 220 },
    index_reference: { type: ["string", "null"], maxLength: 100 },
    evidence: { type: "string", maxLength: 520 },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
  },
};


const TARGETED_SHARED_QUESTIONS = Object.freeze([
  {
    id: "fornitore",
    field: "fornitore",
    kind: "text",
    semantic_role: "identifier",
    question: "Qual è il valore scritto accanto all'etichetta del fornitore o della società emittente?",
    accepted_labels: ["Società emittente", "Fornitore", "Società di vendita"],
  },
  {
    id: "intestatario",
    field: "intestatario",
    kind: "text",
    semantic_role: "identifier",
    question: "Qual è il nome scritto accanto all'etichetta dell'intestatario?",
    accepted_labels: ["Intestata a", "Intestatario", "Cliente"],
  },
  {
    id: "codice_fiscale",
    field: "codice_fiscale",
    kind: "identifier",
    semantic_role: "identifier",
    question: "Qual è il codice scritto accanto all'etichetta del codice fiscale o della partita IVA?",
    accepted_labels: ["Codice fiscale", "C.F.", "CF", "Partita IVA", "P. IVA"],
  },
  {
    id: "codice_cliente",
    field: "codice_cliente",
    kind: "identifier",
    semantic_role: "identifier",
    question: "Qual è il codice scritto accanto all'etichetta del codice cliente?",
    accepted_labels: ["Codice cliente", "Numero cliente", "N. cliente"],
  },
]);

const TARGETED_QUERY_PLANS = Object.freeze({
  critical_luce: Object.freeze([
    ...TARGETED_SHARED_QUESTIONS,
    {
      id: "luce_indirizzo_fornitura",
      field: "indirizzo_fornitura_luce",
      kind: "text",
      semantic_role: "identifier",
      commodity: "electricity",
      question: "Qual è l'indirizzo completo scritto accanto all'etichetta della fornitura elettrica?",
      accepted_labels: ["Servizio fornito in", "Indirizzo di fornitura", "Indirizzo fornitura"],
    },
    {
      id: "luce_pod",
      field: "pod",
      kind: "identifier",
      semantic_role: "identifier",
      commodity: "electricity",
      question: "Qual è il codice scritto accanto all'etichetta POD o Punto di prelievo (POD)? Copialo carattere per carattere.",
      accepted_labels: ["Punto di prelievo (POD)", "POD", "Codice POD"],
    },
    {
      id: "luce_consumo_annuo",
      field: "consumo_luce_kwh",
      kind: "annual_consumption",
      commodity: "electricity",
      question: "Qual è il valore scritto accanto all'etichetta Consumo annuo, in kWh? Non usare il consumo del periodo, i consumi fatturati o le letture del contatore.",
      accepted_labels: ["Consumo annuo", "Consumo annuale", "Consumi annui", "Consumo ultimi 12 mesi", "Consumo degli ultimi 12 mesi"],
    },
    {
      id: "luce_potenza_impegnata",
      field: "potenza_impegnata_kw",
      kind: "numeric_candidate",
      semantic_role: "actual_customer_value",
      commodity: "electricity",
      question: "Qual è il valore scritto accanto all'etichetta Potenza impegnata?",
      accepted_labels: ["Potenza impegnata"],
    },
    {
      id: "luce_potenza_disponibile",
      field: "potenza_disponibile_kw",
      kind: "numeric_candidate",
      semantic_role: "actual_customer_value",
      commodity: "electricity",
      question: "Qual è il valore scritto accanto all'etichetta Potenza disponibile?",
      accepted_labels: ["Potenza disponibile"],
    },
    {
      id: "luce_prezzo_vendita",
      field: "prezzo_luce_eur_kwh",
      kind: "sales_variable",
      commodity: "electricity",
      question: "Nella sezione Quota per consumi, qual è il prezzo unitario della riga di cui spesa per la vendita di energia elettrica? Restituisci il valore della colonna prezzo, non l'importo in euro e non il prezzo medio complessivo della riga padre.",
      accepted_sections: ["Quota per consumi", "Spesa per la materia energia", "Materia energia"],
      accepted_labels: ["di cui spesa per la vendita di energia elettrica", "di cui per la vendita di energia elettrica", "Prezzo di vendita energia elettrica", "Prezzo energia", "Corrispettivo energia"],
    },
    {
      id: "luce_quota_fissa_vendita",
      field: "quota_fissa_vendita_luce_eur_anno",
      kind: "sales_fixed",
      commodity: "electricity",
      question: "Nella sezione Quota fissa oppure Quota fissa e quota potenza, qual è il prezzo unitario della riga di cui spesa per la vendita di energia elettrica? Restituisci il valore mensile o annuale stampato sulla riga figlia, non la quota fissa complessiva della riga padre.",
      accepted_sections: ["Quota fissa", "Quota fissa e quota potenza", "Commercializzazione e vendita"],
      accepted_labels: ["di cui spesa per la vendita di energia elettrica", "di cui per la vendita di energia elettrica", "Quota fissa vendita energia elettrica", "Commercializzazione e vendita"],
    },
    {
      id: "luce_nome_offerta",
      field: "nome_offerta_luce",
      kind: "text",
      semantic_role: "offer_value",
      commodity: "electricity",
      question: "Qual è il nome completo scritto accanto all'etichetta dell'offerta commerciale in vigore per la luce?",
      accepted_labels: ["Offerta commerciale in vigore", "Nome offerta", "Offerta"],
    },
    {
      id: "luce_codice_offerta",
      field: "codice_offerta_luce",
      kind: "identifier",
      semantic_role: "identifier",
      commodity: "electricity",
      question: "Qual è il codice completo scritto accanto all'etichetta Codice offerta per la luce?",
      accepted_labels: ["Codice offerta", "Codice dell'offerta"],
    },
    {
      id: "luce_indice",
      field: "indice_riferimento_luce",
      kind: "text",
      semantic_role: "offer_value",
      commodity: "electricity",
      question: "Qual è il nome letterale scritto accanto all'etichetta Indice di riferimento per la luce?",
      accepted_labels: ["Indice di riferimento", "Indice", "Parametro di indicizzazione"],
    },
    {
      id: "luce_spread",
      field: "spread_luce_eur_kwh",
      kind: "spread",
      commodity: "electricity",
      question: "Qual è il valore unitario scritto accanto all'etichetta Spread, Delta o Maggiorazione per la luce? Non restituire l'indice né il prezzo totale.",
      accepted_labels: ["Spread", "Delta", "Maggiorazione"],
    },
    {
      id: "luce_tipo_prezzo",
      field: "tipo_prezzo_luce",
      kind: "price_type",
      semantic_role: "classification",
      commodity: "electricity",
      question: "Quale parola è scritta accanto all'etichetta Tipologia di prezzo o Tipo prezzo? Restituisci solo se il documento dice esplicitamente fisso o variabile; Monoraria, Bioraria e Multioraria non indicano il tipo di prezzo.",
      accepted_labels: ["Tipologia di prezzo", "Tipo prezzo", "Prezzo fisso", "Prezzo variabile"],
    },
  ]),
  critical_gas: Object.freeze([
    ...TARGETED_SHARED_QUESTIONS,
    {
      id: "gas_indirizzo_fornitura",
      field: "indirizzo_fornitura_gas",
      kind: "text",
      semantic_role: "identifier",
      commodity: "gas",
      question: "Qual è l'indirizzo completo scritto accanto all'etichetta della fornitura gas?",
      accepted_labels: ["Servizio fornito in", "Indirizzo di fornitura", "Indirizzo fornitura"],
    },
    {
      id: "gas_pdr",
      field: "pdr",
      kind: "identifier",
      semantic_role: "identifier",
      commodity: "gas",
      question: "Qual è il codice di 14 cifre scritto accanto all'etichetta PDR o Punto di riconsegna (PDR)? Copialo cifra per cifra.",
      accepted_labels: ["Punto di riconsegna (PDR)", "PDR", "Codice PDR"],
    },
    {
      id: "gas_consumo_annuo",
      field: "consumo_gas_smc",
      kind: "annual_consumption",
      commodity: "gas",
      question: "Qual è il valore scritto accanto all'etichetta Consumo annuo, in Smc? Non usare il consumo del periodo, i consumi fatturati o le letture del contatore.",
      accepted_labels: ["Consumo annuo", "Consumo annuale", "Consumi annui", "Consumo ultimi 12 mesi", "Consumo degli ultimi 12 mesi"],
    },
    {
      id: "gas_prezzo_vendita",
      field: "prezzo_gas_eur_smc",
      kind: "sales_variable",
      commodity: "gas",
      question: "Nella sezione Quota per consumi, qual è il prezzo unitario della riga di cui spesa per la vendita di gas naturale? Restituisci il valore della colonna prezzo, non l'importo in euro e non il prezzo medio complessivo della riga padre.",
      accepted_sections: ["Quota per consumi", "Spesa per la materia gas naturale", "Materia gas naturale"],
      accepted_labels: ["di cui spesa per la vendita di gas naturale", "di cui per la vendita di gas naturale", "Prezzo di vendita gas naturale", "Prezzo gas", "Corrispettivo gas"],
    },
    {
      id: "gas_quota_fissa_vendita",
      field: "quota_fissa_vendita_gas_eur_anno",
      kind: "sales_fixed",
      commodity: "gas",
      question: "Nella sezione Quota fissa, qual è il prezzo unitario della riga di cui spesa per la vendita di gas naturale? Restituisci il valore mensile o annuale stampato sulla riga figlia, non la quota fissa complessiva della riga padre.",
      accepted_sections: ["Quota fissa", "Commercializzazione e vendita"],
      accepted_labels: ["di cui spesa per la vendita di gas naturale", "di cui per la vendita di gas naturale", "Quota fissa vendita gas naturale", "Commercializzazione e vendita"],
    },
    {
      id: "gas_nome_offerta",
      field: "nome_offerta_gas",
      kind: "text",
      semantic_role: "offer_value",
      commodity: "gas",
      question: "Qual è il nome completo scritto accanto all'etichetta dell'offerta commerciale in vigore per il gas?",
      accepted_labels: ["Offerta commerciale in vigore", "Nome offerta", "Offerta"],
    },
    {
      id: "gas_codice_offerta",
      field: "codice_offerta_gas",
      kind: "identifier",
      semantic_role: "identifier",
      commodity: "gas",
      question: "Qual è il codice completo scritto accanto all'etichetta Codice offerta per il gas?",
      accepted_labels: ["Codice offerta", "Codice dell'offerta"],
    },
    {
      id: "gas_indice",
      field: "indice_riferimento_gas",
      kind: "text",
      semantic_role: "offer_value",
      commodity: "gas",
      question: "Qual è il nome letterale scritto accanto all'etichetta Indice di riferimento per il gas?",
      accepted_labels: ["Indice di riferimento", "Indice", "Parametro di indicizzazione"],
    },
    {
      id: "gas_spread",
      field: "spread_gas_eur_smc",
      kind: "spread",
      commodity: "gas",
      question: "Qual è il valore unitario scritto accanto all'etichetta Spread, Delta o Maggiorazione per il gas? Non restituire l'indice né il prezzo totale.",
      accepted_labels: ["Spread", "Delta", "Maggiorazione"],
    },
    {
      id: "gas_tipo_prezzo",
      field: "tipo_prezzo_gas",
      kind: "price_type",
      semantic_role: "classification",
      commodity: "gas",
      question: "Quale parola è scritta accanto all'etichetta Tipologia di prezzo o Tipo prezzo? Restituisci solo se il documento dice esplicitamente fisso o variabile.",
      accepted_labels: ["Tipologia di prezzo", "Tipo prezzo", "Prezzo fisso", "Prezzo variabile"],
    },
  ]),
});

function targetedQuestionPlan(profile) {
  return TARGETED_QUERY_PLANS[profile] || null;
}

export function targetedQuestionsForProfile(profile) {
  return (targetedQuestionPlan(profile) || []).map((item) => ({
    id: item.id,
    field: item.field,
    question: item.question,
    accepted_labels: [...(item.accepted_labels || [])],
    accepted_sections: [...(item.accepted_sections || [])],
  }));
}

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["document", "quality", "page_map", "candidates", "conflicts", "review_reasons"],
  properties: {
    document: {
      type: "object",
      additionalProperties: false,
      required: ["document_type", "supplier", "commodity", "customer_type", "page_count"],
      properties: {
        document_type: {
          type: "string",
          enum: [
            "bill", "bill_guide", "bill_facsimile", "synthetic_sheet", "cte",
            "combined_offer_document", "placet", "unknown",
          ],
        },
        supplier: { type: ["string", "null"] },
        commodity: {
          type: "string",
          enum: ["electricity", "gas", "dual", "unknown"],
        },
        customer_type: {
          type: "string",
          enum: ["consumer", "business", "unknown"],
        },
        page_count: { type: ["integer", "null"] },
      },
    },
    quality: {
      type: "object",
      additionalProperties: false,
      required: ["native_text_quality", "visual_quality", "table_density", "ocr_recommended"],
      properties: {
        native_text_quality: {
          type: "string",
          enum: ["good", "partial", "poor", "none", "unknown"],
        },
        visual_quality: {
          type: "string",
          enum: ["good", "readable", "poor", "unknown"],
        },
        table_density: { type: "string", enum: ["low", "medium", "high"] },
        ocr_recommended: { type: "boolean" },
      },
    },
    page_map: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["page", "role", "summary"],
        properties: {
          page: { type: "integer", minimum: 1 },
          role: { type: "string" },
          summary: { type: "string" },
        },
      },
    },
    candidates: { type: "array", items: CANDIDATE_SCHEMA },
    conflicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "description", "pages", "critical"],
        properties: {
          field: { type: "string" },
          description: { type: "string" },
          pages: { type: "array", items: { type: "integer" } },
          critical: { type: "boolean" },
        },
      },
    },
    review_reasons: { type: "array", items: { type: "string" } },
  },
};

const GENERAL_PAGE_MAP_SCHEMA = {
  type: "array",
  maxItems: 4,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["page", "role", "summary", "domains", "signals"],
    properties: {
      page: { type: "integer", minimum: 1 },
      role: { type: "string", maxLength: 100 },
      summary: { type: "string", maxLength: 220 },
      domains: {
        type: "array",
        maxItems: 6,
        items: {
          type: "string",
          enum: [
            "electricity", "gas", "shared_identity", "offer_terms",
            "totals_taxes", "instructions", "unknown",
          ],
        },
      },
      signals: {
        type: "object",
        additionalProperties: false,
        required: [
          "customer_identity", "activation_identifiers", "annual_consumption",
          "economic_terms", "offer_name_or_code",
        ],
        properties: {
          customer_identity: { type: "boolean" },
          activation_identifiers: { type: "boolean" },
          annual_consumption: { type: "boolean" },
          economic_terms: { type: "boolean" },
          offer_name_or_code: { type: "boolean" },
        },
      },
    },
  },
};

const GENERAL_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["document", "quality", "page_map", "review_reasons"],
  properties: {
    document: OUTPUT_SCHEMA.properties.document,
    quality: OUTPUT_SCHEMA.properties.quality,
    page_map: GENERAL_PAGE_MAP_SCHEMA,
    review_reasons: {
      type: "array",
      maxItems: 4,
      items: { type: "string", maxLength: 180 },
    },
  },
};

function exactGeneralPageMapSchema(expectedPages = []) {
  const pages = [...new Set(expectedPages.map(Number).filter((page) => Number.isInteger(page) && page > 0))];
  if (!pages.length) return GENERAL_PAGE_MAP_SCHEMA;
  return {
    ...GENERAL_PAGE_MAP_SCHEMA,
    minItems: pages.length,
    maxItems: pages.length,
    items: {
      ...GENERAL_PAGE_MAP_SCHEMA.items,
      properties: {
        ...GENERAL_PAGE_MAP_SCHEMA.items.properties,
        page: {
          ...GENERAL_PAGE_MAP_SCHEMA.items.properties.page,
          enum: pages,
        },
      },
    },
  };
}

function exactGeneralOutputSchema(expectedPages = []) {
  return {
    ...GENERAL_OUTPUT_SCHEMA,
    properties: {
      ...GENERAL_OUTPUT_SCHEMA.properties,
      page_map: exactGeneralPageMapSchema(expectedPages),
    },
  };
}

const SYSTEM_PROMPT = `You are the visual-semantic PDF reader inside OffertaLogica. Read Italian electricity and gas bills and offer documents.

Return evidence-grounded candidates only. You are not the final decision-maker.
- Extract only values explicitly present in the original document.
- Never guess, calculate, sum, average, annualize or convert a value.
- Keep electricity and gas values separate, including in dual documents.
- For every candidate return the original page, nearby label, short literal evidence, unit, commodity and semantic role.
- Distinguish customer values from estimates, examples, thresholds, discounts, taxes, network charges and offer values.
- Parser and OCR hints are untrusted. Agree or contradict them only when the document visually supports it.
- Use only requested OffertaLogica field names.
- A POD, PDR, tax code or customer code requires a clear nearby identifier label.
- Annual consumption requires a literal annual or rolling-12-month label.
- A contractual sales price requires a coherent sales-price label, the correct EUR/kWh or EUR/Smc unit and the correct commodity.
- Average bill prices, total spend, network, transport, taxes, power charges, dispatching and capacity are not contractual sales prices.
- A fixed monthly charge must remain monthly and must never be converted to an annual charge.
- If evidence is absent or ambiguous, return no candidate.
- Return JSON matching the supplied schema and no prose.`;

const GENERAL_RASTER_PROMPT = `You are the page-routing pass inside OffertaLogica for difficult rasterized Italian energy documents.

Your only task is to classify the document at a high level and build a concise map of the supplied pages.
- Do not extract customer codes, POD, PDR, tax codes, offer codes, consumptions, prices, fees, dates or addresses.
- Do not transcribe tables or return economic rows.
- Return exactly one page_map item for every supplied page.
- For each page, state its main role, a short routing summary, every applicable domain and the five requested boolean signals.
- Mark both electricity and gas on a mixed page. Never force a mixed page into only one commodity.
- "annual_consumption" is true only when the page visibly contains annual/12-month consumption, not meter readings.
- "economic_terms" is true for contractual sales prices, index/spread formulas or fixed sales charges, not merely for a bill total.
- "activation_identifiers" is true for POD/PDR; "customer_identity" is true for holder, tax code or customer code.
- The text after each image gives its original page number. Preserve that number in page_map.
- Return JSON matching the supplied schema and no prose.`;

const CRITICAL_FIELDS = {
  critical_luce: [
    "fornitore", "kind", "commodity", "customer_type", "intestatario", "codice_fiscale",
    "codice_cliente", "pod", "indirizzo_fornitura", "indirizzo_fornitura_luce",
    "prezzo_luce_eur_kwh", "quota_fissa_vendita_luce_eur_anno",
    "potenza_impegnata_kw", "potenza_disponibile_kw", "nome_offerta_luce",
    "codice_offerta_luce", "tipo_prezzo_luce", "indice_riferimento_luce",
    "spread_luce_eur_kwh",
  ],
  critical_gas: [
    "fornitore", "kind", "commodity", "customer_type", "intestatario", "codice_fiscale",
    "codice_cliente", "pdr", "indirizzo_fornitura", "indirizzo_fornitura_gas",
    "prezzo_gas_eur_smc", "quota_fissa_vendita_gas_eur_anno",
    "nome_offerta_gas", "codice_offerta_gas", "tipo_prezzo_gas",
    "indice_riferimento_gas", "spread_gas_eur_smc",
  ],
};

const CRITICAL_PROMPTS = {
  critical_luce: `${SYSTEM_PROMPT}

Focus only on electricity and shared customer identity. This is a targeted recovery pass, not a full bill transcription.
- Re-check POD character by character and copy customer identifiers only from clearly labelled rows.
- Return at most 6 distinct electricity consumption observations. Prioritize literal annual or rolling-12-month values, then billing-period or monthly values. Omit individual meter readings, repeated values and intermediate calculations unless they are the only evidence or resolve a conflict. Do not put consumption in candidates.
- Return at most 10 economic rows and only when they can plausibly represent the current offer's electricity sales price, index/spread formula or fixed sales charge. Keep quantity, total amount and printed unit rate separate.
- Classify price_basis strictly: total_unit_price is the complete current contractual unit price; spread is only the add-on to an index; index_value is the index itself; fixed_charge is a time-based sales charge; single_component is one component that is not the complete price.
- Mark future_or_renewal for values that apply only after a future month, renewal or expiry. They are not current prices.
- Never label PUN, PUN Index GME, an index value, "+ spread", delta, dispatching, capacity or one child component as total_unit_price.
- Copy the printed index name and formula into index_reference and formula_text when present.
- Do not reconstruct bill totals, taxes, network, transport, power, system charges or generic spending summaries. Include a non-sales row only when it is immediately adjacent and necessary to distinguish it from a sales row.
- Preserve parent and indented child rows separately when both are relevant. A child row labelled "di cui" must not be merged into its parent.
- For fixed sales rows preserve the printed monthly or annual unit. Never annualize in the model.
- Return price/index/spread/offer candidates only when explicitly labelled and visually supported. Prefer no value over a weak or inferred value.
- Omit gas-only values and return empty arrays when no relevant observation or row is present.`,
  critical_gas: `${SYSTEM_PROMPT}

Focus only on gas and shared customer identity. This is a targeted recovery pass, not a full bill transcription.
- Re-check all 14 PDR digits and copy customer identifiers only from clearly labelled rows.
- Return at most 6 distinct gas consumption observations. Prioritize literal annual or rolling-12-month values, then billing-period or monthly values. Omit individual meter readings, repeated values and intermediate calculations unless they are the only evidence or resolve a conflict. Do not put consumption in candidates.
- Return at most 10 economic rows and only when they can plausibly represent the current offer's gas sales price, index/spread formula or fixed sales charge. Keep quantity, total amount and printed unit rate separate.
- Classify price_basis strictly: total_unit_price is the complete current contractual unit price; spread is only the add-on to an index; index_value is the index itself; fixed_charge is a time-based sales charge; single_component is one component that is not the complete price.
- Mark future_or_renewal for values that apply only after a future month, renewal or expiry. They are not current prices.
- Never label PSV, PSBIL, TTF, an index value, "+ spread", delta, balancing, dispatching or one child component as total_unit_price.
- Copy the printed index name and formula into index_reference and formula_text when present.
- Do not reconstruct bill totals, taxes, network, transport, system charges or generic spending summaries. Include a non-sales row only when it is immediately adjacent and necessary to distinguish it from a sales row.
- Preserve parent and indented child rows separately when both are relevant. A child row labelled "di cui" must not be merged into its parent.
- For fixed sales rows preserve the printed monthly or annual unit. Never annualize in the model.
- Return price/index/spread/offer candidates only when explicitly labelled and visually supported. Prefer no value over a weak or inferred value.
- Omit electricity-only values and return empty arrays when no relevant observation or row is present.`,
};

function boundedTimeout(value, fallback = 12_000) {
  const parsed = Number(value ?? fallback);
  return Math.max(2_000, Math.min(48_000, Number.isFinite(parsed) ? parsed : fallback));
}

function candidateHint(candidate) {
  return {
    field: candidate.field,
    normalized_value: candidate.normalized_value,
    unit: candidate.normalized_unit,
    page: candidate.page,
    evidence: candidate.evidence,
    semantic_role: candidate.semantic_role,
    confidence: candidate.confidence,
  };
}

export function pdfAiMode(env = process.env) {
  return pdfAiConfig(env).mode;
}

export function choosePdfInputDetail({ pageCount = 0, diagnostics = [] } = {}) {
  const denseEvidence = diagnostics.some((item) => String(item?.source_snippet || "").length >= 280);
  return Number(pageCount || 0) >= 6 || denseEvidence ? "high" : "low";
}

export async function buildPdfAiRequest({
  filePath,
  filename = "documento.pdf",
  parserVersion = "unknown",
  parserCandidates = [],
  pageCount = 0,
  diagnostics = [],
  model = PDF_AI_PRIMARY_MODEL,
  profile = "document",
} = {}) {
  if (!filePath) throw new Error("filePath_required");
  const bytes = await fs.readFile(filePath);
  const inputDetail = choosePdfInputDetail({ pageCount, diagnostics });
  const critical = Boolean(CRITICAL_FIELDS[profile]);
  const context = {
    parser_version: parserVersion,
    requested_fields: critical ? CRITICAL_FIELDS[profile] : pdfFieldNames(),
    parser_and_ocr_candidates: parserCandidates.map(candidateHint),
    source_transport: "original_pdf",
    original_filename: filename,
    document_page_count: Number(pageCount || 0) || null,
    request_profile: profile,
    targeted_questions: critical ? targetedQuestionsForProfile(profile) : [],
  };
  return {
    model,
    store: false,
    max_output_tokens: critical ? 4_800 : inputDetail === "high" ? 6_500 : 4_200,
    input: [
      { role: "system", content: critical ? targetedCriticalPrompt(profile) : SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "input_file",
            filename,
            file_data: `data:application/pdf;base64,${bytes.toString("base64")}`,
          },
          {
            type: "input_text",
            text: `Analyze the PDF using these untrusted parser/OCR hints:\n${JSON.stringify(context)}`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: critical ? `offertalogica_pdf_${profile}` : "offertalogica_pdf_candidates",
        strict: true,
        schema: outputSchemaForProfile(profile),
      },
    },
  };
}

function normalizeImageMime(value) {
  const mime = String(value || "").trim().toLowerCase();
  return ["image/jpeg", "image/png", "image/webp"].includes(mime) ? mime : "image/jpeg";
}


function targetedAnswerSchema(profile, expectedPages = []) {
  const plan = targetedQuestionPlan(profile) || [];
  const pages = [...new Set(expectedPages.map(Number).filter((page) => Number.isInteger(page) && page > 0))];
  return {
    type: "array",
    minItems: plan.length,
    maxItems: plan.length,
    items: {
      type: "object",
      additionalProperties: false,
      required: [
        "query_id", "found", "section_literal", "label_literal", "value_literal",
        "unit_literal", "page", "evidence_literal", "confidence", "not_found_reason",
      ],
      properties: {
        query_id: { type: "string", enum: plan.map((item) => item.id) },
        found: { type: "boolean" },
        section_literal: { type: ["string", "null"], maxLength: 180 },
        label_literal: { type: ["string", "null"], maxLength: 220 },
        value_literal: { type: ["string", "null"], maxLength: 220 },
        unit_literal: { type: ["string", "null"], maxLength: 80 },
        page: pages.length
          ? { type: ["integer", "null"], enum: [null, ...pages] }
          : { type: ["integer", "null"], minimum: 1 },
        evidence_literal: { type: ["string", "null"], maxLength: 520 },
        confidence: { type: "integer", minimum: 0, maximum: 100 },
        not_found_reason: { type: ["string", "null"], maxLength: 180 },
      },
    },
  };
}

function targetedOutputSchema(profile, expectedPages = []) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["document", "quality", "answers", "review_reasons"],
    properties: {
      document: OUTPUT_SCHEMA.properties.document,
      quality: OUTPUT_SCHEMA.properties.quality,
      answers: targetedAnswerSchema(profile, expectedPages),
      review_reasons: {
        type: "array",
        maxItems: 8,
        items: { type: "string", maxLength: 180 },
      },
    },
  };
}

function targetedCriticalPrompt(profile) {
  const plan = targetedQuestionPlan(profile) || [];
  const questions = plan.map((item, index) => ({
    order: index + 1,
    query_id: item.id,
    field: item.field,
    question: item.question,
    accepted_labels: item.accepted_labels || [],
    accepted_sections: item.accepted_sections || [],
  }));
  return `${SYSTEM_PROMPT}

Questa è una lettura mirata campo per campo. Non fare una trascrizione generale e non cercare valori diversi da quelli richiesti.

REGOLE OBBLIGATORIE:
- Rispondi a ogni domanda del piano esattamente una volta, conservando query_id.
- found=true soltanto quando una delle etichette ammesse è realmente visibile nella pagina fornita.
- Copia section_literal, label_literal, value_literal e unit_literal esattamente come stampati. Non correggere, completare o parafrasare.
- evidence_literal deve essere una trascrizione letterale della riga richiesta oppure di due righe adiacenti. Deve contenere sia l'etichetta sia il valore. Non costruire una frase descrittiva.
- Se l'etichetta o il valore non è leggibile con certezza, usa found=false e campi null.
- Non usare un valore vicino appartenente a una riga diversa.
- Per le righe "di cui", usa esclusivamente il valore della riga figlia richiesta, mai il totale della riga padre.
- Quando la domanda richiede il prezzo unitario, copia la colonna prezzo/unità, mai la colonna importo.
- Non calcolare, non annualizzare, non sommare e non dedurre.
- Non usare i suggerimenti del parser/OCR come fonte.
- Monoraria, Bioraria o Multioraria non significano prezzo fisso o variabile.
- Restituisci JSON conforme allo schema, senza testo aggiuntivo.

PIANO DELLE DOMANDE MIRATE:
${JSON.stringify(questions)}`;
}

function normalizeLiteral(value, maxLength = 520) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function comparableLiteral(value) {
  return normalizeLiteral(value, 520)
    .toLocaleLowerCase("it-IT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function literalIncluded(evidence, literal) {
  const haystack = comparableLiteral(evidence);
  const needle = comparableLiteral(literal);
  return Boolean(haystack && needle && haystack.includes(needle));
}

function allowedLiteral(value, accepted = []) {
  const actual = comparableLiteral(value);
  if (!actual) return false;
  return accepted.some((item) => {
    const expected = comparableLiteral(item);
    return expected && (actual === expected || actual.startsWith(`${expected} `));
  });
}

function parseItalianNumber(value) {
  let source = normalizeLiteral(value, 120)
    .replace(/[€$£]/g, "")
    .replace(/\s/g, "")
    .replace(/[^0-9,.-]/g, "");
  if (!source) return null;
  const negative = source.startsWith("-");
  source = source.replace(/-/g, "");
  const comma = source.lastIndexOf(",");
  const dot = source.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    if (comma > dot) source = source.replace(/\./g, "").replace(",", ".");
    else source = source.replace(/,/g, "");
  } else if (comma >= 0) {
    source = source.replace(/\./g, "").replace(",", ".");
  } else if ((source.match(/\./g) || []).length > 1) {
    source = source.replace(/\./g, "");
  } else if (dot >= 0) {
    const decimals = source.length - dot - 1;
    if (decimals === 3 && /^\d{1,3}\.\d{3}$/.test(source)) source = source.replace(".", "");
  }
  const number = Number(source);
  if (!Number.isFinite(number)) return null;
  return negative ? -number : number;
}

function normalizedQuestionCommodity(item) {
  return item?.commodity || "dual";
}

function directCandidateFromTargetedAnswer(item, answer) {
  const valueLiteral = normalizeLiteral(answer?.value_literal, 220);
  const unitLiteral = normalizeLiteral(answer?.unit_literal, 80) || null;
  let valueText = valueLiteral;
  let valueNumber = null;
  if (item.kind === "numeric_candidate") {
    valueNumber = parseItalianNumber(valueLiteral);
    if (!(valueNumber > 0)) return null;
    valueText = null;
  }
  if (item.kind === "price_type") {
    const lower = comparableLiteral(valueLiteral);
    if (/\bvariabil[ei]\b/.test(lower)) valueText = "variabile";
    else if (/\bfiss[oaie]\b/.test(lower)) valueText = "fisso";
    else return null;
  }
  if (item.field === "pdr" && !/^\d{14}$/.test(valueLiteral.replace(/\s/g, ""))) return null;
  if (item.field === "pod" && !/^IT[A-Z0-9]{12,20}$/i.test(valueLiteral.replace(/\s/g, ""))) return null;
  if (item.field === "codice_fiscale") {
    const compactValue = valueLiteral.replace(/\s/g, "");
    if (!/^(?:[A-Z0-9]{11}|[A-Z0-9]{16})$/i.test(compactValue)) return null;
  }
  return {
    field: item.field,
    value_text: valueText,
    value_number: valueNumber,
    unit: unitLiteral,
    commodity: normalizedQuestionCommodity(item),
    page: answer.page,
    label: normalizeLiteral(answer.label_literal, 180),
    evidence: normalizeLiteral(answer.evidence_literal, 360),
    semantic_role: item.semantic_role || "identifier",
    confidence: Number(answer.confidence || 0),
    agrees_with: [],
    contradicts: [],
  };
}

function targetedAnswerEvidence(item, answer) {
  return [
    answer?.section_literal ? `Sezione: ${normalizeLiteral(answer.section_literal, 180)}` : "",
    answer?.label_literal ? `Etichetta: ${normalizeLiteral(answer.label_literal, 220)}` : "",
    normalizeLiteral(answer?.evidence_literal, 420),
  ].filter(Boolean).join(" | ").slice(0, 520);
}

function targetedAnswersToAiResult(parsed, profile) {
  const plan = targetedQuestionPlan(profile) || [];
  const byId = new Map(plan.map((item) => [item.id, item]));
  const candidates = [];
  const consumptionObservations = [];
  const economicRows = [];
  const reviewReasons = [...(parsed.review_reasons || [])];
  const diagnostics = [];

  for (const answer of parsed.answers || []) {
    const item = byId.get(answer?.query_id);
    if (!item) continue;
    const compactAnswer = {
      query_id: item.id,
      field: item.field,
      found: Boolean(answer?.found),
      section_literal: normalizeLiteral(answer?.section_literal, 180) || null,
      label_literal: normalizeLiteral(answer?.label_literal, 220) || null,
      value_literal: normalizeLiteral(answer?.value_literal, 220) || null,
      unit_literal: normalizeLiteral(answer?.unit_literal, 80) || null,
      page: Number(answer?.page || 0) || null,
      evidence_literal: normalizeLiteral(answer?.evidence_literal, 520) || null,
      confidence: Number(answer?.confidence || 0),
      not_found_reason: normalizeLiteral(answer?.not_found_reason, 180) || null,
    };
    diagnostics.push(compactAnswer);
    if (!compactAnswer.found) continue;
    if (!compactAnswer.page || !compactAnswer.label_literal || !compactAnswer.value_literal || !compactAnswer.evidence_literal) {
      reviewReasons.push(`targeted_answer_incomplete:${item.id}`);
      continue;
    }
    if (!allowedLiteral(compactAnswer.label_literal, item.accepted_labels || [])) {
      reviewReasons.push(`targeted_label_not_allowed:${item.id}`);
      continue;
    }
    if ((item.accepted_sections || []).length
      && (!compactAnswer.section_literal
        || !allowedLiteral(compactAnswer.section_literal, item.accepted_sections))) {
      reviewReasons.push(`targeted_section_not_allowed:${item.id}`);
      continue;
    }
    if (!literalIncluded(compactAnswer.evidence_literal, compactAnswer.label_literal)
      || !literalIncluded(compactAnswer.evidence_literal, compactAnswer.value_literal)) {
      reviewReasons.push(`targeted_evidence_not_literal:${item.id}`);
      continue;
    }
    const numberValue = parseItalianNumber(compactAnswer.value_literal);
    const evidence = targetedAnswerEvidence(item, compactAnswer);
    if (item.kind === "annual_consumption") {
      if (!(numberValue > 0) || !compactAnswer.unit_literal) {
        reviewReasons.push(`targeted_number_or_unit_invalid:${item.id}`);
        continue;
      }
      consumptionObservations.push({
        commodity: normalizedQuestionCommodity(item),
        page: compactAnswer.page,
        label: compactAnswer.label_literal,
        value_number: numberValue,
        unit: compactAnswer.unit_literal,
        period_role: "annual",
        evidence,
        confidence: compactAnswer.confidence,
      });
      continue;
    }
    if (["sales_variable", "sales_fixed", "spread"].includes(item.kind)) {
      if (!(numberValue > 0) || !compactAnswer.unit_literal) {
        reviewReasons.push(`targeted_number_or_unit_invalid:${item.id}`);
        continue;
      }
      const unit = compactAnswer.unit_literal;
      const monthly = /(?:mese|mensile|month)/i.test(unit);
      const annual = /(?:anno|annuale|year)/i.test(unit);
      economicRows.push({
        commodity: normalizedQuestionCommodity(item),
        page: compactAnswer.page,
        section_label: compactAnswer.section_literal,
        row_label: compactAnswer.label_literal,
        row_relation: "child",
        quantity_number: null,
        quantity_unit: null,
        amount_number: null,
        amount_unit: null,
        unit_rate_number: numberValue,
        unit_rate_unit: unit,
        period_unit: item.kind === "sales_fixed" ? (monthly ? "month" : annual ? "year" : "unknown") : "none",
        component_role: item.kind === "sales_fixed" ? "sales_fixed" : "sales_variable",
        price_basis: item.kind === "spread" ? "spread" : item.kind === "sales_fixed" ? "fixed_charge" : "total_unit_price",
        validity_role: "current_contract",
        formula_text: null,
        index_reference: null,
        evidence,
        confidence: compactAnswer.confidence,
      });
      continue;
    }
    const candidate = directCandidateFromTargetedAnswer(item, compactAnswer);
    if (candidate) candidates.push(candidate);
    else reviewReasons.push(`targeted_value_invalid:${item.id}`);
  }

  return {
    document: parsed.document,
    quality: parsed.quality,
    page_map: [],
    candidates,
    conflicts: [],
    review_reasons: [...new Set(reviewReasons.filter(Boolean))],
    consumption_observations: consumptionObservations,
    economic_rows: economicRows,
    targeted_answers: diagnostics,
  };
}

function validateExactTargetedAnswers(answers, profile) {
  const expected = (targetedQuestionPlan(profile) || []).map((item) => item.id);
  if (!Array.isArray(answers)) throw new Error("openai_invalid_targeted_answers");
  if (answers.length !== expected.length) throw new Error("openai_invalid_targeted_answer_count");
  const actual = answers.map((item) => String(item?.query_id || ""));
  if (new Set(actual).size !== actual.length) throw new Error("openai_duplicate_targeted_answer");
  const expectedSet = new Set(expected);
  if (actual.some((id) => !expectedSet.has(id))) throw new Error("openai_unknown_targeted_answer");
  if (expected.some((id) => !actual.includes(id))) throw new Error("openai_missing_targeted_answer");
  for (const answer of answers) {
    if (answer?.found) {
      if (!answer?.page || !answer?.label_literal || !answer?.value_literal || !answer?.evidence_literal) {
        throw new Error("openai_incomplete_targeted_found_answer");
      }
    }
  }
}

function outputSchemaForProfile(profile, expectedPages = []) {
  if (profile === "general") return exactGeneralOutputSchema(expectedPages);
  if (targetedQuestionPlan(profile)) return targetedOutputSchema(profile, expectedPages);
  const fields = CRITICAL_FIELDS[profile];
  if (!fields) return OUTPUT_SCHEMA;
  return {
    ...OUTPUT_SCHEMA,
    required: [...OUTPUT_SCHEMA.required, "consumption_observations", "economic_rows"],
    properties: {
      ...OUTPUT_SCHEMA.properties,
      page_map: {
        ...OUTPUT_SCHEMA.properties.page_map,
        maxItems: 8,
      },
      candidates: {
        type: "array",
        maxItems: 24,
        items: {
          ...CANDIDATE_SCHEMA,
          properties: {
            ...CANDIDATE_SCHEMA.properties,
            field: { type: "string", enum: fields },
          },
        },
      },
      conflicts: {
        ...OUTPUT_SCHEMA.properties.conflicts,
        maxItems: 6,
      },
      review_reasons: {
        type: "array",
        maxItems: 6,
        items: { type: "string", maxLength: 180 },
      },
      consumption_observations: {
        type: "array",
        maxItems: 6,
        items: CONSUMPTION_OBSERVATION_SCHEMA,
      },
      economic_rows: {
        type: "array",
        maxItems: 10,
        items: ECONOMIC_ROW_SCHEMA,
      },
    },
  };
}

export async function buildPdfAiImageRequest({
  imageFiles = [],
  filename = "documento.pdf",
  parserVersion = "unknown",
  parserCandidates = [],
  pageCount = 0,
  model = PDF_AI_PRIMARY_MODEL,
  profile = "general",
} = {}) {
  const ordered = [...imageFiles]
    .filter((item) => item?.filePath)
    .sort((left, right) => Number(left.page || 0) - Number(right.page || 0));
  if (!ordered.length) throw new Error("image_files_required");
  if (ordered.length > 8) throw new Error("too_many_image_pages");

  const critical = Boolean(CRITICAL_FIELDS[profile]);
  const context = {
    parser_version: parserVersion,
    requested_fields: critical ? CRITICAL_FIELDS[profile] : profile === "general" ? [] : pdfFieldNames(),
    parser_and_ocr_candidates: parserCandidates.map(candidateHint),
    source_transport: "client_rasterized_pdf_pages",
    original_filename: filename,
    document_page_count: Number(pageCount || ordered.length),
    request_profile: profile,
    targeted_questions: critical ? targetedQuestionsForProfile(profile) : [],
  };
  const content = [];
  for (const [index, item] of ordered.entries()) {
    const bytes = await fs.readFile(item.filePath);
    content.push({
      type: "input_image",
      image_url: `data:${normalizeImageMime(item.mimeType)};base64,${bytes.toString("base64")}`,
      detail: critical ? "high" : "low",
    });
    content.push({
      type: "input_text",
      text: `The preceding image is original page ${Number(item.page || index + 1)}.`,
    });
  }
  content.push({
    type: "input_text",
    text: `Read only the supplied pages under this deterministic plan:\n${JSON.stringify(context)}`,
  });

  return {
    model,
    store: false,
    max_output_tokens: critical ? 4_800 : profile === "general" ? 1_200 : 4_200,
    input: [
      {
        role: "system",
        content: critical ? targetedCriticalPrompt(profile) : GENERAL_RASTER_PROMPT,
      },
      { role: "user", content },
    ],
    text: {
      format: {
        type: "json_schema",
        name: `offertalogica_pdf_${profile}`,
        strict: true,
        schema: outputSchemaForProfile(profile, ordered.map((item) => Number(item.page))),
      },
    },
  };
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

function responseOutputText(body) {
  if (typeof body?.output_text === "string") return body.output_text;
  for (const item of body?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "refusal") {
        throw new Error(`openai_refusal:${content.refusal || "refused"}`);
      }
      if (content?.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return "";
}

function validateExactGeneralPageMap(pageMap, expectedPages = []) {
  const expected = [...new Set(expectedPages.map(Number).filter((page) => Number.isInteger(page) && page > 0))]
    .sort((left, right) => left - right);
  if (!expected.length) return;
  const actual = pageMap.map((item) => Number(item?.page || 0));
  if (actual.length !== expected.length) throw new Error("openai_invalid_page_map_count");
  if (actual.some((page) => !Number.isInteger(page) || page <= 0)) {
    throw new Error("openai_invalid_page_map_page");
  }
  if (new Set(actual).size !== actual.length) throw new Error("openai_duplicate_page_map_page");
  const sorted = [...actual].sort((left, right) => left - right);
  if (sorted.some((page, index) => page !== expected[index])) {
    throw new Error("openai_page_map_pages_mismatch");
  }
}

function validateAiOutput(parsed, { profile = "document", expectedPages = [] } = {}) {
  if (!parsed || typeof parsed !== "object") throw new Error("openai_invalid_output_object");
  if (!parsed.document || !parsed.quality) throw new Error("openai_missing_document_metadata");
  if (targetedQuestionPlan(profile) && Array.isArray(parsed.answers)) {
    if (parsed.review_reasons !== undefined && !Array.isArray(parsed.review_reasons)) {
      throw new Error("openai_invalid_review_reasons");
    }
    validateExactTargetedAnswers(parsed.answers, profile);
    return targetedAnswersToAiResult({
      ...parsed,
      review_reasons: parsed.review_reasons || [],
    }, profile);
  }
  // Backward-compatible validation for existing mocked tests and non-targeted profiles.
  if (!Array.isArray(parsed.page_map)) throw new Error("openai_invalid_page_map");
  if (profile === "general") validateExactGeneralPageMap(parsed.page_map, expectedPages);
  if (parsed.candidates !== undefined && !Array.isArray(parsed.candidates)) {
    throw new Error("openai_invalid_candidates");
  }
  if (parsed.conflicts !== undefined && !Array.isArray(parsed.conflicts)) {
    throw new Error("openai_invalid_conflicts");
  }
  if (parsed.review_reasons !== undefined && !Array.isArray(parsed.review_reasons)) {
    throw new Error("openai_invalid_review_reasons");
  }
  if (parsed.consumption_observations !== undefined && !Array.isArray(parsed.consumption_observations)) {
    throw new Error("openai_invalid_consumption_observations");
  }
  if (parsed.economic_rows !== undefined && !Array.isArray(parsed.economic_rows)) {
    throw new Error("openai_invalid_economic_rows");
  }
  return {
    ...parsed,
    candidates: parsed.candidates || [],
    conflicts: parsed.conflicts || [],
    review_reasons: parsed.review_reasons || [],
    consumption_observations: parsed.consumption_observations || [],
    economic_rows: parsed.economic_rows || [],
    targeted_answers: parsed.targeted_answers || [],
  };
}

async function transportBody(result) {
  if (result && typeof result.json === "function") {
    if (result.ok === false) {
      const responseText = await result.text().catch(() => "");
      throw new Error(`openai_http_${result.status}:${responseText.slice(0, 240)}`);
    }
    return result.json();
  }
  return result;
}

export async function runPdfAiPass({
  requiredMode = null,
  filePath,
  imageFiles = [],
  filename,
  legacyNormalized = {},
  parserCandidates = [],
  deadlineAt = null,
  transport = defaultTransport,
  apiKey = process.env.OPENAI_API_KEY,
  model = null,
  env = process.env,
  profile = "document",
  timeoutMs = null,
} = {}) {
  const mode = pdfAiMode(env);
  if (mode === "off" || (requiredMode && mode !== requiredMode)) {
    return { status: "disabled", model: null, candidates: [], profile };
  }
  const resolvedModel = model || pdfAiConfig(env).model || PDF_AI_PRIMARY_MODEL;
  if (!apiKey) {
    return {
      status: "unavailable",
      reason: "missing_openai_api_key",
      model: resolvedModel,
      candidates: [],
      profile,
    };
  }

  const configuredTimeout = boundedTimeout(timeoutMs ?? env.PDF_AI_TIMEOUT_MS, 12_000);
  const remainingMs = deadlineAt ? Number(deadlineAt) - Date.now() - 750 : configuredTimeout;
  const requestTimeoutMs = Math.min(configuredTimeout, remainingMs);
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 2_000) {
    return {
      status: "skipped",
      reason: "insufficient_time_budget",
      model: resolvedModel,
      candidates: [],
      profile,
      timeout_ms: requestTimeoutMs,
    };
  }

  const request = imageFiles.length
    ? await buildPdfAiImageRequest({
      imageFiles,
      filename,
      parserVersion: legacyNormalized.parser_version,
      parserCandidates,
      pageCount: legacyNormalized.page_count,
      model: resolvedModel,
      profile,
    })
    : await buildPdfAiRequest({
      filePath,
      filename,
      parserVersion: legacyNormalized.parser_version,
      parserCandidates,
      pageCount: legacyNormalized.page_count,
      diagnostics: legacyNormalized.diagnostics,
      model: resolvedModel,
      profile,
    });

  const controller = new AbortController();
  let timeoutId;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error("openai_timeout"));
      }, requestTimeoutMs);
    });
    const raw = await Promise.race([
      transport({ request, apiKey, signal: controller.signal }),
      timeoutPromise,
    ]);
    const body = await transportBody(raw);
    if (body?.status === "incomplete") {
      throw new Error(`openai_incomplete:${body?.incomplete_details?.reason || "unknown"}`);
    }
    const outputText = responseOutputText(body);
    if (!outputText) throw new Error("openai_empty_output");
    const expectedPages = imageFiles.length
      ? imageFiles.map((item) => Number(item?.page || 0)).filter(Boolean)
      : [];
    const parsed = validateAiOutput(JSON.parse(outputText), { profile, expectedPages });
    const sourceVersion = `${resolvedModel}:${profile}:${PDF_AI_ADAPTER_VERSION}`;
    const candidates = aiPdfToCandidates(parsed, sourceVersion).map((candidate) => ({
      ...candidate,
      method: `gpt41_visual_${profile}`,
      source_version: sourceVersion,
    }));
    return {
      status: "completed",
      model: resolvedModel,
      response_id: String(body?.id || "").slice(0, 160) || null,
      candidates,
      timeout_ms: requestTimeoutMs,
      profile,
      document: parsed.document,
      quality: parsed.quality,
      page_map: parsed.page_map,
      conflicts: parsed.conflicts,
      review_reasons: parsed.review_reasons,
      consumption_observations: parsed.consumption_observations || [],
      economic_rows: parsed.economic_rows || [],
      targeted_answers: parsed.targeted_answers || [],
    };
  } catch (error) {
    return {
      status: "failed",
      reason: String(error?.message || "openai_error").slice(0, 300),
      model: resolvedModel,
      candidates: [],
      timeout_ms: requestTimeoutMs,
      profile,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runPdfAiShadow(options = {}) {
  return runPdfAiPass({
    ...options,
    requiredMode: "shadow",
    profile: options.profile || "document",
  });
}

export async function runPdfAiFallback(options = {}) {
  return runPdfAiPass({
    ...options,
    requiredMode: "fallback",
    profile: options.profile || "document",
  });
}
