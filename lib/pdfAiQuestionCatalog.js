export const PDF_AI_QUESTION_CATALOG_VERSION = "step8-question-catalog-v1";

function freezeQuestions(items) {
  return Object.freeze(items.map((item) => Object.freeze({ ...item })));
}

const CLASSIFICATION = freezeQuestions([
  {
    id: "document_kind",
    field: "kind",
    scope: "document",
    valueType: "classification",
    question: "Che tipo di documento è? Rispondi soltanto con bolletta, scheda_offerta oppure unknown.",
    allowedValues: ["bolletta", "scheda_offerta", "unknown"],
  },
  {
    id: "document_commodity",
    field: "commodity",
    scope: "document",
    valueType: "classification",
    question: "Quali forniture sono presenti nel documento? Rispondi soltanto con luce, gas, dual oppure unknown.",
    allowedValues: ["luce", "gas", "dual", "unknown"],
  },
  {
    id: "customer_type",
    field: "customer_type",
    scope: "document",
    valueType: "classification",
    question: "Il cliente indicato nel documento è domestico/privato oppure azienda? Rispondi soltanto con privato, business oppure unknown.",
    allowedValues: ["privato", "business", "unknown"],
  },
]);

const SHARED = freezeQuestions([
  {
    id: "fornitore",
    field: "fornitore",
    scope: "shared",
    valueType: "text",
    question: "Qual è il nome completo scritto accanto a «Società emittente», «Fornitore» o «Società di vendita»? Copialo esattamente.",
    acceptedLabels: ["società emittente", "fornitore", "società di vendita"],
  },
  {
    id: "intestatario",
    field: "intestatario",
    scope: "shared",
    valueType: "text",
    question: "Qual è il nome completo scritto accanto a «Intestata a», «Intestatario» o «Cliente»? Copialo esattamente.",
    acceptedLabels: ["intestata a", "intestatario", "cliente"],
  },
  {
    id: "codice_fiscale",
    field: "codice_fiscale",
    scope: "shared",
    valueType: "tax_id",
    question: "Qual è il codice scritto accanto a «Codice fiscale», «C.F.», «CF», «Partita IVA» o «P. IVA»? Copialo carattere per carattere.",
    acceptedLabels: ["codice fiscale", "c.f.", "cf", "partita iva", "p. iva"],
  },
  {
    id: "codice_cliente",
    field: "codice_cliente",
    scope: "shared",
    valueType: "identifier",
    question: "Qual è il codice scritto accanto a «Codice cliente», «Numero cliente» o «N. cliente»? Copialo carattere per carattere.",
    acceptedLabels: ["codice cliente", "numero cliente", "n. cliente"],
  },
]);

const LUCE = freezeQuestions([
  {
    id: "luce_indirizzo_fornitura",
    field: "indirizzo_fornitura_luce",
    scope: "luce",
    valueType: "text",
    question: "Nella sezione della fornitura elettrica, qual è l'indirizzo completo scritto accanto a «Servizio fornito in», «Indirizzo di fornitura» o «Indirizzo fornitura»? Copialo esattamente.",
    acceptedLabels: ["servizio fornito in", "indirizzo di fornitura", "indirizzo fornitura"],
  },
  {
    id: "luce_pod",
    field: "pod",
    scope: "luce",
    valueType: "pod",
    question: "Nella sezione elettrica, qual è il codice scritto accanto a «Punto di prelievo (POD)», «POD» o «Codice POD»? Copialo carattere per carattere.",
    acceptedLabels: ["punto di prelievo (pod)", "pod", "codice pod"],
  },
  {
    id: "luce_consumo_annuo",
    field: "consumo_luce_kwh",
    scope: "luce",
    valueType: "number",
    question: "Nella sezione elettrica, qual è il valore scritto accanto a «Consumo annuo», «Consumo annuale», «Consumo ultimi 12 mesi» o «Consumo degli ultimi 12 mesi»? Non usare il consumo del periodo. Copia valore e unità.",
    acceptedLabels: ["consumo annuo", "consumo annuale", "consumo ultimi 12 mesi", "consumo degli ultimi 12 mesi"],
    unitPatterns: ["kwh"],
    min: 0.01,
    max: 1_000_000,
  },
  {
    id: "luce_potenza_impegnata",
    field: "potenza_impegnata_kw",
    scope: "luce",
    valueType: "number",
    question: "Qual è il valore scritto accanto a «Potenza impegnata» nella sezione elettrica? Copia valore e unità.",
    acceptedLabels: ["potenza impegnata"],
    unitPatterns: ["kw"],
    min: 0.1,
    max: 100,
  },
  {
    id: "luce_prezzo_vendita",
    field: "prezzo_luce_eur_kwh",
    scope: "luce",
    valueType: "number",
    question: "Nella sezione «Quota consumi» o «Quota per consumi» della luce, qual è il prezzo unitario della riga «di cui per la vendita di energia elettrica» oppure «di cui spesa per la vendita di energia elettrica»? Non usare il prezzo medio complessivo e non usare l'importo totale. Copia valore e unità.",
    acceptedLabels: ["di cui per la vendita di energia elettrica", "di cui spesa per la vendita di energia elettrica", "prezzo di vendita energia elettrica"],
    acceptedSections: ["quota consumi", "quota per consumi", "spesa per la vendita di energia elettrica", "spesa per la materia energia"],
    unitPatterns: ["kwh"],
    min: 0.000001,
    max: 5,
  },
  {
    id: "luce_quota_fissa_vendita",
    field: "quota_fissa_vendita_luce_eur_anno",
    scope: "luce",
    valueType: "fixed_fee",
    question: "Nella sezione «Quota fissa» oppure «Quota fissa e quota potenza» della luce, qual è il prezzo unitario della riga «di cui per la vendita di energia elettrica» oppure «di cui spesa per la vendita di energia elettrica»? Non usare la quota fissa complessiva. Copia valore e periodicità, per esempio €/mese o €/anno.",
    acceptedLabels: ["di cui per la vendita di energia elettrica", "di cui spesa per la vendita di energia elettrica", "quota fissa vendita energia elettrica", "commercializzazione e vendita"],
    acceptedSections: ["quota fissa", "quota fissa e quota potenza", "commercializzazione e vendita"],
    unitPatterns: ["mese", "anno", "month", "year", "pod"],
    min: 0.01,
    max: 10_000,
  },
  {
    id: "luce_nome_offerta",
    field: "nome_offerta_luce",
    scope: "luce",
    valueType: "text",
    question: "Qual è il nome completo scritto accanto a «Offerta commerciale in vigore», «Nome offerta» o «Offerta» nella sezione luce? Copialo esattamente.",
    acceptedLabels: ["offerta commerciale in vigore", "nome offerta", "offerta"],
  },
  {
    id: "luce_codice_offerta",
    field: "codice_offerta_luce",
    scope: "luce",
    valueType: "identifier",
    question: "Qual è il codice completo scritto accanto a «Codice offerta» o «Codice dell'offerta» nella sezione luce? Copialo carattere per carattere.",
    acceptedLabels: ["codice offerta", "codice dell'offerta"],
  },
  {
    id: "luce_indice",
    field: "indice_riferimento_luce",
    scope: "luce",
    valueType: "text",
    question: "Qual è il nome letterale scritto accanto a «Indice di riferimento», «Indice» o «Parametro di indicizzazione» nella sezione luce? Copialo esattamente.",
    acceptedLabels: ["indice di riferimento", "indice", "parametro di indicizzazione"],
  },
  {
    id: "luce_spread",
    field: "spread_luce_eur_kwh",
    scope: "luce",
    valueType: "number",
    question: "Nella sezione luce, qual è il valore scritto accanto a «Spread», «Delta» o «Maggiorazione»? Non restituire l'indice né il prezzo totale. Copia valore e unità.",
    acceptedLabels: ["spread", "delta", "maggiorazione"],
    unitPatterns: ["kwh"],
    min: 0.000001,
    max: 5,
  },
  {
    id: "luce_tipo_prezzo",
    field: "tipo_prezzo_luce",
    scope: "luce",
    valueType: "price_type",
    question: "Qual è il valore scritto accanto a «Tipo di prezzo», «Prezzo fisso/variabile» o una dicitura equivalente nella sezione luce? Rispondi con il valore letterale trovato; non dedurlo da PUN, monoraria o bioraria.",
    acceptedLabels: ["tipo di prezzo", "prezzo fisso/variabile", "tipologia prezzo"],
  },
  {
    id: "luce_scadenza_condizioni",
    field: "scadenza_condizioni_economiche_luce",
    scope: "luce",
    valueType: "date_text",
    question: "Qual è la data scritta accanto a «Scadenza condizioni economiche», «Validità condizioni economiche» o «Condizioni economiche valide fino al» nella sezione luce? Copiala esattamente.",
    acceptedLabels: ["scadenza condizioni economiche", "validità condizioni economiche", "condizioni economiche valide fino al"],
  },
]);

const GAS = freezeQuestions([
  {
    id: "gas_indirizzo_fornitura",
    field: "indirizzo_fornitura_gas",
    scope: "gas",
    valueType: "text",
    question: "Nella sezione della fornitura gas, qual è l'indirizzo completo scritto accanto a «Servizio fornito in», «Indirizzo di fornitura» o «Indirizzo fornitura»? Copialo esattamente.",
    acceptedLabels: ["servizio fornito in", "indirizzo di fornitura", "indirizzo fornitura"],
  },
  {
    id: "gas_pdr",
    field: "pdr",
    scope: "gas",
    valueType: "pdr",
    question: "Nella sezione gas, qual è il codice scritto accanto a «Punto di riconsegna (PDR)», «PDR» o «Codice PDR»? Copialo carattere per carattere.",
    acceptedLabels: ["punto di riconsegna (pdr)", "pdr", "codice pdr"],
  },
  {
    id: "gas_consumo_annuo",
    field: "consumo_gas_smc",
    scope: "gas",
    valueType: "number",
    question: "Nella sezione gas, qual è il valore scritto accanto a «Consumo annuo», «Consumo annuo stimato», «Consumo annuale» o «Consumo ultimi 12 mesi»? Non usare il consumo del periodo. Copia valore e unità.",
    acceptedLabels: ["consumo annuo", "consumo annuo stimato", "consumo annuale", "consumo ultimi 12 mesi", "consumo degli ultimi 12 mesi"],
    unitPatterns: ["smc", "standard m3", "std m3"],
    min: 0.01,
    max: 10_000_000,
  },
  {
    id: "gas_prezzo_vendita",
    field: "prezzo_gas_eur_smc",
    scope: "gas",
    valueType: "number",
    question: "Nella sezione «Quota consumi» o «Quota per consumi» del gas, qual è il prezzo unitario della riga «di cui per la vendita di gas naturale» oppure «di cui spesa per la vendita di gas naturale»? Non usare il prezzo medio complessivo e non usare l'importo totale. Copia valore e unità.",
    acceptedLabels: ["di cui per la vendita di gas naturale", "di cui spesa per la vendita di gas naturale", "prezzo di vendita gas naturale"],
    acceptedSections: ["quota consumi", "quota per consumi", "spesa per la vendita di gas naturale", "spesa per la materia gas naturale"],
    unitPatterns: ["smc"],
    min: 0.000001,
    max: 10,
  },
  {
    id: "gas_quota_fissa_vendita",
    field: "quota_fissa_vendita_gas_eur_anno",
    scope: "gas",
    valueType: "fixed_fee",
    question: "Nella sezione «Quota fissa» del gas, qual è il prezzo unitario della riga «di cui per la vendita di gas naturale» oppure «di cui spesa per la vendita di gas naturale»? Non usare la quota fissa complessiva. Copia valore e periodicità, per esempio €/mese o €/anno.",
    acceptedLabels: ["di cui per la vendita di gas naturale", "di cui spesa per la vendita di gas naturale", "quota fissa vendita gas naturale", "commercializzazione e vendita"],
    acceptedSections: ["quota fissa", "commercializzazione e vendita"],
    unitPatterns: ["mese", "anno", "month", "year", "pdr"],
    min: 0.01,
    max: 10_000,
  },
  {
    id: "gas_nome_offerta",
    field: "nome_offerta_gas",
    scope: "gas",
    valueType: "text",
    question: "Qual è il nome completo scritto accanto a «Offerta commerciale in vigore», «Nome offerta» o «Offerta» nella sezione gas? Copialo esattamente.",
    acceptedLabels: ["offerta commerciale in vigore", "nome offerta", "offerta"],
  },
  {
    id: "gas_codice_offerta",
    field: "codice_offerta_gas",
    scope: "gas",
    valueType: "identifier",
    question: "Qual è il codice completo scritto accanto a «Codice offerta» o «Codice dell'offerta» nella sezione gas? Copialo carattere per carattere.",
    acceptedLabels: ["codice offerta", "codice dell'offerta"],
  },
  {
    id: "gas_indice",
    field: "indice_riferimento_gas",
    scope: "gas",
    valueType: "text",
    question: "Qual è il nome letterale scritto accanto a «Indice di riferimento», «Indice» o «Parametro di indicizzazione» nella sezione gas? Copialo esattamente.",
    acceptedLabels: ["indice di riferimento", "indice", "parametro di indicizzazione"],
  },
  {
    id: "gas_spread",
    field: "spread_gas_eur_smc",
    scope: "gas",
    valueType: "number",
    question: "Nella sezione gas, qual è il valore scritto accanto a «Spread», «Delta» o «Maggiorazione»? Non restituire l'indice né il prezzo totale. Copia valore e unità.",
    acceptedLabels: ["spread", "delta", "maggiorazione"],
    unitPatterns: ["smc"],
    min: 0.000001,
    max: 10,
  },
  {
    id: "gas_tipo_prezzo",
    field: "tipo_prezzo_gas",
    scope: "gas",
    valueType: "price_type",
    question: "Qual è il valore scritto accanto a «Tipo di prezzo», «Prezzo fisso/variabile» o una dicitura equivalente nella sezione gas? Rispondi con il valore letterale trovato; non dedurlo da PSV o monoraria.",
    acceptedLabels: ["tipo di prezzo", "prezzo fisso/variabile", "tipologia prezzo"],
  },
  {
    id: "gas_scadenza_condizioni",
    field: "scadenza_condizioni_economiche_gas",
    scope: "gas",
    valueType: "date_text",
    question: "Qual è la data scritta accanto a «Scadenza condizioni economiche», «Validità condizioni economiche» o «Condizioni economiche valide fino al» nella sezione gas? Copiala esattamente.",
    acceptedLabels: ["scadenza condizioni economiche", "validità condizioni economiche", "condizioni economiche valide fino al"],
  },
]);

export function classificationQuestions() {
  return [...CLASSIFICATION];
}

export function dataQuestionsForCommodity(commodity = "unknown") {
  const normalized = String(commodity || "unknown").toLowerCase();
  if (normalized === "luce") return [...SHARED, ...LUCE];
  if (normalized === "gas") return [...SHARED, ...GAS];
  return [...SHARED, ...LUCE, ...GAS];
}

export function allQuestionDefinitions() {
  return [...CLASSIFICATION, ...SHARED, ...LUCE, ...GAS];
}

export function questionDefinitionById(id) {
  return allQuestionDefinitions().find((item) => item.id === id) || null;
}
