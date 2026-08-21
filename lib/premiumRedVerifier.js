import fs from "node:fs/promises";
import { evaluatePremiumOfferResolution } from "./premiumOfferResolution.js";

export const PREMIUM_RED_VERIFIER_VERSION = "premium-red-verifier-v0.36.37";

const AUTO_AI_CODES = new Set([
  "prezzo_luce_diverso_dal_contratto",
  "prezzo_gas_diverso_dal_contratto",
  "quota_fissa_luce_diversa",
  "quota_fissa_gas_diversa",
  "indice_luce_diverso_dal_contratto",
  "indice_gas_diverso_dal_contratto",
  "spread_luce_diverso_dal_contratto",
  "spread_gas_diverso_dal_contratto",
]);
const AI_VERIFY_CODES = new Set([
  "tipo_prezzo_diverso_dal_contratto",
  "fornitore_diverso_dal_contratto",
  "documento_doppio_addebito",
  "documento_conguaglio",
  "documento_variazione_prezzo",
  "documento_quota_inattesa",
  "documento_sconto_mancante",
  "documento_importo_inusuale",
]);
const STAFF_REQUIRED_CODES = new Set([
  "documento_penale",
  "documento_altro",
]);
const CONTRACT_REFERENCE_CODES = new Set([
  "prezzo_luce_diverso_dal_contratto",
  "prezzo_gas_diverso_dal_contratto",
  "quota_fissa_luce_diversa",
  "quota_fissa_gas_diversa",
  "indice_luce_diverso_dal_contratto",
  "indice_gas_diverso_dal_contratto",
  "spread_luce_diverso_dal_contratto",
  "spread_gas_diverso_dal_contratto",
  "tipo_prezzo_diverso_dal_contratto",
  "fornitore_diverso_dal_contratto",
]);

function compact(value, maxLength = 800) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
function cleanCode(value) {
  return compact(value, 120).toLowerCase();
}
function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function redRoutingReasons(reasons = []) {
  return safeArray(reasons).filter((reason) => {
    const trafficLight = cleanCode(reason?.trafficLight);
    // Le reason persistite possono contenere insieme rossi e gialli.
    // Per compatibilità storica, una reason senza trafficLight resta instradata
    // con la logica prudenziale precedente; un giallo esplicito invece non
    // deve mai trasformarsi in staff_required.
    return !trafficLight || trafficLight === "red";
  });
}

function onlyContractReferenceReasons(routeInfo) {
  const codes = safeArray(routeInfo?.codes).filter(Boolean);
  return codes.length > 0 && codes.every((code) => CONTRACT_REFERENCE_CODES.has(cleanCode(code)));
}

export function routePremiumRedReasons(reasons = []) {
  const routingReasons = redRoutingReasons(reasons);
  const codes = [...new Set(routingReasons.map((reason) => cleanCode(reason?.code)).filter(Boolean))];
  let route = "auto_ai";
  const classified = codes.map((code) => {
    if (STAFF_REQUIRED_CODES.has(code)) return { code, route: "staff_required" };
    if (AI_VERIFY_CODES.has(code) || code.startsWith("coerenza_")) return { code, route: "ai_verify" };
    if (AUTO_AI_CODES.has(code)) return { code, route: "auto_ai" };
    return { code, route: "staff_required" };
  });
  if (!classified.length) route = "staff_required";
  else if (classified.some((item) => item.route === "staff_required")) route = "staff_required";
  else if (classified.some((item) => item.route === "ai_verify")) route = "ai_verify";
  return { route, codes, classified };
}

function serviceHeaders(config, extra = {}) {
  return {
    apikey: config.serviceKey,
    Authorization: `Bearer ${config.serviceKey}`,
    Accept: "application/json",
    ...extra,
  };
}

async function serviceGet(config, table, params, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.supabaseUrl}/rest/v1/${table}?${params.toString()}`, {
    headers: serviceHeaders(config),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`premium_red_snapshot_http_${response.status}:${text.slice(0, 240)}`);
  }
  return response.json();
}

export async function loadPremiumRedVerificationSnapshot({ config, billId, userId, fetchImpl = fetch } = {}) {
  const billQuery = new URLSearchParams({
    select: "id,user_id,utility_id,contract_id,commodity,original_file_name,file_size,storage_bucket,storage_path,processing_status,customer_status,automatic_screening_status,automatic_screening_reasons,automatic_analysis_run_id,red_verification_state,red_verification_result,red_verification_run_id,red_verified_at",
    id: `eq.${billId}`,
    user_id: `eq.${userId}`,
    limit: "1",
  });
  const bills = await serviceGet(config, "premium_bills", billQuery, fetchImpl);
  const bill = bills?.[0];
  if (!bill) throw new Error("premium_bill_not_found");
  if (bill.automatic_screening_status !== "review_recommended") throw new Error("premium_red_verification_not_requestable");
  if (bill.storage_bucket !== config.bucket || !bill.storage_path) throw new Error("premium_bill_storage_invalid");
  if (Number(bill.file_size || 0) > Number(config.maxPdfBytes || 20_000_000)) throw new Error("premium_pdf_too_large");

  let firstRun = null;
  if (bill.automatic_analysis_run_id) {
    const runQuery = new URLSearchParams({
      select: "id,extracted_data,automatic_reasons,automatic_classification,completed_at",
      id: `eq.${bill.automatic_analysis_run_id}`,
      bill_id: `eq.${bill.id}`,
      user_id: `eq.${userId}`,
      limit: "1",
    });
    const runs = await serviceGet(config, "premium_analysis_runs", runQuery, fetchImpl);
    firstRun = runs?.[0] || null;
  }
  return { bill, firstRun };
}

function economicContext(data = {}) {
  const source = data && typeof data === "object" ? data : {};
  const keys = [
    "commodity", "total_amount_eur", "fornitore", "fornitore_luce", "fornitore_gas",
    "tipo_prezzo_luce", "tipo_prezzo_gas", "prezzo_luce_eur_kwh", "prezzo_gas_eur_smc",
    "quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno",
    "indice_riferimento_luce", "indice_riferimento_gas", "spread_luce_eur_kwh", "spread_gas_eur_smc",
    "formula_prezzo_luce", "formula_prezzo_gas",
    "nome_offerta_luce", "nome_offerta_gas", "codice_offerta_luce", "codice_offerta_gas",
    "billing_period_start", "billing_period_end", "issue_date",
    "document_alerts", "validation",
  ];
  const result = {};
  for (const key of keys) if (source[key] !== undefined) result[key] = source[key];
  return result;
}

function contractContext(contract = null) {
  if (!contract || typeof contract !== "object") return null;
  const keys = [
    "verification_status", "provider_name", "offer_name", "pricing_type",
    "electricity_price_eur_kwh", "gas_price_eur_smc",
    "electricity_fixed_fee_eur_year", "gas_fixed_fee_eur_year",
    "electricity_index_name", "gas_index_name", "electricity_spread_eur_kwh", "gas_spread_eur_smc",
    "electricity_formula", "gas_formula",
  ];
  const result = {};
  for (const key of keys) if (contract[key] !== undefined) result[key] = contract[key];
  return result;
}

function reasonContext(reasons = []) {
  return safeArray(reasons).slice(0, 12).map((reason) => ({
    code: cleanCode(reason?.code),
    title: compact(reason?.title, 180),
    description: compact(reason?.description, 500),
    severity: compact(reason?.severity, 40),
    source: compact(reason?.source, 80),
    expected: reason?.expected ?? null,
    actual: reason?.actual ?? null,
  }));
}

const EVIDENCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["page", "fact"],
  properties: {
    page: { type: ["integer", "null"], minimum: 1 },
    fact: { type: "string", minLength: 1, maxLength: 360 },
  },
};

const OFFER_CANDIDATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["commodity", "provider_name", "offer_name", "offer_code", "pricing_type", "unit_price", "annual_fixed_fee", "index_name", "spread", "formula", "valid_from", "valid_to", "source_url", "source_title", "reference_pcs_gj_smc"],
  properties: {
    commodity: { type: "string", enum: ["electricity", "gas"] },
    provider_name: { type: "string", maxLength: 300 },
    offer_name: { type: "string", maxLength: 300 },
    offer_code: { type: "string", maxLength: 180 },
    pricing_type: { type: "string", enum: ["fixed", "indexed", "mixed", "unknown"] },
    unit_price: { type: ["number", "null"] },
    annual_fixed_fee: { type: ["number", "null"] },
    index_name: { type: "string", maxLength: 100 },
    spread: { type: ["number", "null"] },
    formula: { type: "string", maxLength: 500 },
    valid_from: { type: ["string", "null"], maxLength: 20 },
    valid_to: { type: ["string", "null"], maxLength: 20 },
    source_url: { type: "string", maxLength: 1200 },
    source_title: { type: "string", maxLength: 300 },
    reference_pcs_gj_smc: { type: ["number", "null"] },
  },
};

const OFFER_RESOLUTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["search_performed", "bill_pcs_gj_smc", "bill_coefficient_c", "candidates"],
  properties: {
    search_performed: { type: "boolean" },
    bill_pcs_gj_smc: { type: ["number", "null"] },
    bill_coefficient_c: { type: ["number", "null"] },
    candidates: { type: "array", minItems: 0, maxItems: 5, items: OFFER_CANDIDATE_SCHEMA },
  },
};

const RED_VERIFICATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["issue", "evidence", "verification_result", "confidence", "can_resolve_alone", "customer_reply", "escalation_reason", "missing_data", "offer_resolution"],
  properties: {
    issue: { type: "string", minLength: 1, maxLength: 500 },
    evidence: { type: "array", minItems: 0, maxItems: 8, items: EVIDENCE_SCHEMA },
    verification_result: { type: "string", enum: ["confirmed", "not_confirmed", "inconclusive", "needs_data"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    can_resolve_alone: { type: "string", enum: ["yes", "no"] },
    customer_reply: { type: "string", maxLength: 900 },
    escalation_reason: { type: "string", maxLength: 900 },
    missing_data: { type: "array", minItems: 0, maxItems: 8, items: { type: "string", minLength: 1, maxLength: 220 } },
    offer_resolution: OFFER_RESOLUTION_SCHEMA,
  },
};

function outputText(body) {
  if (typeof body?.output_text === "string") return body.output_text;
  for (const item of body?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "refusal") throw new Error(`openai_refusal:${content.refusal || "refused"}`);
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

function webSourcesFromResponse(body) {
  const sources = [];
  for (const item of safeArray(body?.output)) {
    if (item?.type === "web_search_call") {
      for (const source of safeArray(item?.action?.sources)) {
        const url = compact(source?.url, 1200);
        if (url) sources.push({ url, title: compact(source?.title, 300) });
      }
    }
    for (const content of safeArray(item?.content)) {
      for (const annotation of safeArray(content?.annotations)) {
        const url = compact(annotation?.url || annotation?.url_citation?.url, 1200);
        if (url) sources.push({ url, title: compact(annotation?.title || annotation?.url_citation?.title, 300) });
      }
    }
  }
  return [...new Map(sources.map(source => [source.url, source])).values()];
}

async function responseBody(result) {
  if (result && typeof result.json === "function") {
    if (result.ok === false) {
      const text = await result.text().catch(() => "");
      throw new Error(`openai_http_${result.status}:${text.slice(0, 300)}`);
    }
    return result.json();
  }
  return result;
}

async function uploadOpenAiFile({ filePath, filename, apiKey, fetchImpl, signal }) {
  const bytes = await fs.readFile(filePath);
  const formData = new FormData();
  formData.append("purpose", "user_data");
  formData.append("expires_after[anchor]", "created_at");
  formData.append("expires_after[seconds]", "3600");
  formData.append("file", new Blob([bytes], { type: "application/pdf" }), filename || "bolletta.pdf");
  const response = await fetchImpl("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
    signal,
  });
  if (!response.ok) throw new Error(`openai_file_upload_http_${response.status}`);
  const body = await response.json();
  if (!body?.id) throw new Error("openai_file_upload_invalid_response");
  return body.id;
}

async function deleteOpenAiFile({ fileId, apiKey, fetchImpl }) {
  if (!fileId) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    await fetchImpl(`https://api.openai.com/v1/files/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
  } catch {} finally {
    clearTimeout(timeout);
  }
}

export function normalizePremiumRedVerification(raw, { routeInfo, firstAnalysisRunId = null, trustedContractAvailable = true, offerResolution = null } = {}) {
  let verificationResult = ["confirmed", "not_confirmed", "inconclusive", "needs_data"].includes(raw?.verification_result)
    ? raw.verification_result : "inconclusive";
  const evidence = safeArray(raw?.evidence).slice(0, 8).map((item) => ({
    page: Number.isInteger(Number(item?.page)) && Number(item.page) > 0 ? Number(item.page) : null,
    fact: compact(item?.fact, 360),
  })).filter((item) => item.fact);
  let missingData = safeArray(raw?.missing_data).slice(0, 8).map((item) => compact(item, 220)).filter(Boolean);
  let confidence = ["low", "medium", "high"].includes(raw?.confidence) ? raw.confidence : "low";
  let requestedCanResolve = raw?.can_resolve_alone === "yes" ? "yes" : "no";
  const verifiedOfferReference = offerResolution?.status === "verified" && Boolean(offerResolution?.selected?.auto_verifiable);
  const contractOnlyCase = onlyContractReferenceReasons(routeInfo);
  const missingTrustedReference = trustedContractAvailable === false && !verifiedOfferReference && contractOnlyCase;
  if (verifiedOfferReference && contractOnlyCase) {
    verificationResult = "not_confirmed";
    requestedCanResolve = "yes";
    confidence = "high";
    missingData = missingData.filter((item) => !/contratt|offert|riferiment/i.test(item));
  }
  if (missingTrustedReference) {
    verificationResult = "needs_data";
    requestedCanResolve = "no";
    confidence = confidence === "high" ? "medium" : confidence;
    if (!missingData.some((item) => /contratt|offert|riferiment/i.test(item))) {
      missingData = ["Offerta o contratto verificato relativo a questa bolletta", ...missingData].slice(0, 8);
    }
  }
  const autoResolved = routeInfo?.route === "auto_ai"
    && verificationResult === "confirmed"
    && requestedCanResolve === "yes"
    && evidence.length > 0
    && missingData.length === 0;
  const offerAutoResolved = verifiedOfferReference && contractOnlyCase;
  const decision = offerAutoResolved
    ? "resolved_ai"
    : routeInfo?.route === "staff_required"
    ? "staff_required"
    : autoResolved
      ? "resolved_ai"
      : routeInfo?.route === "ai_verify" && verificationResult === "confirmed" && requestedCanResolve === "yes" && missingData.length === 0
        ? "quick_verify"
        : missingData.length > 0 || verificationResult === "inconclusive" || verificationResult === "needs_data" || verificationResult === "not_confirmed"
          ? "inconclusive"
          : "staff_required";
  const rawEscalationReason = compact(raw?.escalation_reason, 900);
  const escalationReason = missingTrustedReference
    ? "Non è disponibile un'offerta o contratto verificato riferibile a questa bolletta. Prima di attribuire un'anomalia alla bolletta va verificato o corretto il riferimento contrattuale registrato."
    : verificationResult === "not_confirmed" && decision === "inconclusive"
    ? "La seconda verifica non conferma il codice rosso della prima analisi. È necessaria una verifica Staff per risolvere il disaccordo prima di comunicare un esito al cliente."
    : decision === "staff_required" && (!rawEscalationReason || /non\s+(?:è|e)\s+necessaria\s+escalation/i.test(rawEscalationReason))
      ? "La tipologia di anomalia richiede una verifica Staff prima di comunicare un esito al cliente."
      : rawEscalationReason;
  return {
    version: PREMIUM_RED_VERIFIER_VERSION,
    route: routeInfo?.route || "staff_required",
    reason_codes: routeInfo?.codes || [],
    first_analysis_run_id: firstAnalysisRunId,
    issue: offerAutoResolved
      ? "Riferimento offerta verificato: anomalia contrattuale non confermata"
      : missingTrustedReference
        ? "Offerta o contratto di riferimento non verificato"
        : compact(raw?.issue, 500) || "Anomalia rossa da verificare",
    evidence,
    verification_result: verificationResult,
    confidence,
    can_resolve_alone: autoResolved ? "yes" : requestedCanResolve,
    customer_reply: offerAutoResolved
      ? `La bolletta è stata ricontrollata usando l’offerta ${compact(offerResolution?.selected?.offer_name, 220) || "identificata"} verificata per il periodo del documento. Il precedente confronto contrattuale non è confermato.`
      : missingTrustedReference
        ? "La bolletta è leggibile, ma non è disponibile un'offerta o contratto verificato riferibile a questo documento. Il riferimento registrato va verificato prima di attribuire un'anomalia alla bolletta."
        : compact(raw?.customer_reply, 900),
    escalation_reason: offerAutoResolved ? "" : escalationReason,
    missing_data: missingData,
    offer_resolution: offerResolution || { status: "none", candidates: [], selected: null },
    decision,
    agreement_with_first_check: !offerAutoResolved && !missingTrustedReference && verificationResult === "confirmed" && missingData.length === 0,
  };
}

export async function verifyPremiumRedPdf({
  filePath,
  filename = "bolletta.pdf",
  reasons = [],
  firstAnalysis = {},
  firstAnalysisRunId = null,
  contract = null,
  declaredContract = null,
  apiKey,
  model,
  transport,
  fetchImpl = fetch,
  deadlineAt = null,
  env = process.env,
} = {}) {
  if (!apiKey) throw new Error("openai_missing_api_key");
  if (!filePath) throw new Error("premium_red_pdf_required");
  if (typeof transport !== "function") throw new Error("premium_red_transport_required");
  const routeInfo = routePremiumRedReasons(reasons);
  const stats = await fs.stat(filePath);
  const thresholdRaw = Number(env.PDF_AI_FILE_ID_THRESHOLD_BYTES ?? 12_000_000);
  const threshold = Number.isFinite(thresholdRaw) ? Math.max(1_000_000, Math.min(20_000_000, thresholdRaw)) : 12_000_000;
  const useFileId = Number(stats.size || 0) >= threshold;
  const remaining = () => deadlineAt ? Number(deadlineAt) - Date.now() - 2500 : 35_000;
  if (remaining() < 8000) throw new Error("openai_insufficient_time_budget");

  let fileId = "";
  try {
    let fileInput;
    if (useFileId) {
      const uploadController = new AbortController();
      const uploadTimeout = setTimeout(() => uploadController.abort(), Math.min(15_000, Math.max(5000, remaining() - 8000)));
      try {
        fileId = await uploadOpenAiFile({ filePath, filename, apiKey, fetchImpl, signal: uploadController.signal });
      } finally {
        clearTimeout(uploadTimeout);
      }
      fileInput = { type: "input_file", file_id: fileId };
    } else {
      const bytes = await fs.readFile(filePath);
      fileInput = { type: "input_file", filename, file_data: `data:application/pdf;base64,${bytes.toString("base64")}` };
    }

    const systemPrompt = `Sei la seconda verifica indipendente di OffertaLogica per una bolletta già classificata ROSSA. Leggi direttamente il PDF e controlla soltanto le anomalie indicate. La prima analisi è un'ipotesi: non confermarla per inerzia.\n\nRegole vincolanti:\n- confirmed: il PDF e, quando necessario, il contratto verificato supportano la stessa anomalia della prima analisi;\n- not_confirmed: l'evidenza diretta contraddice la prima analisi;\n- inconclusive: il documento non consente una conclusione affidabile;\n- needs_data: manca un dato necessario.\n- can_resolve_alone=yes solo se la conclusione deriva direttamente da dati economici espliciti, non richiede giudizio umano e missing_data è vuoto.\n- Per penali o anomalie generiche ad alta gravità non risolvere autonomamente.\n- Se prima e seconda lettura non concordano, non scegliere arbitrariamente: usa not_confirmed/inconclusive e richiedi escalation o dati.\n- Non inventare importi, non calcolare dati non espliciti, non usare dati personali.\n- evidence deve contenere fatti sintetici e pagina quando disponibile.\n- customer_reply deve essere breve, comprensibile e non più certa delle prove disponibili.\n- Se verified_contract_context è null e tutte le anomalie indicate dipendono dal confronto con un contratto/offerta, usa la ricerca web quando disponibile per cercare l'esatta versione dell'offerta valida nel periodo della bolletta. Priorità: ARERA, Portale Offerte e documentazione ufficiale del fornitore. Non scegliere una soluzione solo perché il prezzo è simile.\n- Per una possibile offerta riporta nei candidates solo dati realmente supportati dalla fonte: codice, fornitore, nome, validità, struttura economica e URL. Se un dato non è disponibile usa stringa vuota o null. Non inventare date/codici.\n- Per il gas leggi dal PDF, quando presenti, Potere Calorifico Superiore P e coefficiente C. Il prezzo di riferimento dell'offerta può essere espresso a P=0,03852 GJ/Smc e quindi non deve coincidere al quarto decimale con il prezzo fatturato. C converte i volumi e non va usato per moltiplicare il prezzo €/Smc.\n- La decisione finale sull'aggiornamento automatico NON spetta a te: il server applica controlli deterministici. Se non esiste già un contratto verificato, non trasformare una semplice somiglianza web in un fatto.\nRestituisci esclusivamente JSON conforme allo schema.`;

    const context = {
      route: routeInfo.route,
      first_red_reasons: reasonContext(redRoutingReasons(reasons)),
      first_analysis_economic_data: economicContext(firstAnalysis),
      trusted_contract_available: Boolean(contract),
      verified_contract_context: contractContext(contract),
      declared_offer_context: contractContext(declaredContract),
    };
    const needsOfferSearch = !contract && onlyContractReferenceReasons(routeInfo);
    const request = {
      model,
      store: false,
      max_output_tokens: 1800,
      input: [
        { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
        { role: "user", content: [
          fileInput,
          { type: "input_text", text: `Contesto della prima analisi e del contratto:\n${JSON.stringify(context)}\n\nEsegui una verifica indipendente delle sole anomalie rosse indicate.` },
        ] },
      ],
      ...(needsOfferSearch ? {
        tools: [{ type: "web_search", search_context_size: "medium" }],
        include: ["web_search_call.action.sources"],
      } : {}),
      text: {
        format: {
          type: "json_schema",
          name: "offertalogica_red_verification",
          description: "Seconda verifica indipendente di una anomalia rossa",
          strict: true,
          schema: RED_VERIFICATION_SCHEMA,
        },
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(35_000, Math.max(8000, remaining())));
    try {
      const rawResponse = await transport({ request, apiKey, signal: controller.signal, attempt: 1, profile: PREMIUM_RED_VERIFIER_VERSION });
      const body = await responseBody(rawResponse);
      if (body?.status === "incomplete") throw new Error(`openai_incomplete:${body?.incomplete_details?.reason || "unknown"}`);
      const text = outputText(body);
      if (!text) throw new Error("openai_empty_output");
      const parsed = JSON.parse(text);
      const webSources = webSourcesFromResponse(body);
      const offerResolution = evaluatePremiumOfferResolution({
        rawResolution: parsed.offer_resolution || {},
        firstAnalysis,
        bill: {},
        webSources,
      });
      return {
        result: normalizePremiumRedVerification(parsed, {
          routeInfo,
          firstAnalysisRunId,
          trustedContractAvailable: Boolean(contract),
          offerResolution,
        }),
        responseId: compact(body?.id, 160) || null,
        offerResolution,
      };
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    await deleteOpenAiFile({ fileId, apiKey, fetchImpl });
  }
}
