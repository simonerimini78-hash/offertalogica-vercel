import { defaultPdfQuestionTransport } from "./pdfAiQuestionSession.js";
import { questionDefinitionById } from "./pdfAiQuestionCatalog.js";
import { singleQuestionOutputSchema, validateQuestionAnswer } from "./pdfAiQuestionValidation.js";

export const PDF_AI_FIELD_READER_VERSION = "step8-field-reader-v2-one-page-one-question";
const CRITICAL_TYPES = new Set(["tax_id", "pod", "pdr", "number", "fixed_fee", "identifier"]);

function compact(value, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function comparable(value) {
  return compact(value, 700).toLocaleLowerCase("it-IT").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function outputText(body) {
  if (typeof body?.output_text === "string") return body.output_text;
  for (const item of body?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
      if (content?.type === "refusal") throw new Error(`openai_refusal:${content.refusal || "refused"}`);
    }
  }
  throw new Error("openai_output_text_missing");
}

function developerPrompt(question, page, verification = false) {
  const labels = question.acceptedLabels?.length ? question.acceptedLabels.join(" | ") : "nessuna etichetta obbligatoria";
  const sections = question.acceptedSections?.length ? question.acceptedSections.join(" | ") : "nessuna sezione obbligatoria";
  return `Sei un trascrittore letterale di bollette italiane. Vedi UNA SOLA pagina: pagina ${page}.
Devi rispondere a UNA SOLA domanda. Non ricostruire dati da memoria o da altre pagine.
Etichette ammesse: ${labels}.
Sezioni ammesse: ${sections}.
Regole:
- Copia esattamente etichetta, valore, unità e una breve evidenza realmente visibile.
- Il valore deve comparire dentro evidence_literal.
- Non correggere cifre, non completare indirizzi o codici, non calcolare.
- Se la riga non è chiaramente leggibile su questa pagina, found=false.
- Imposta page=${page}.
${verification ? "Questa è una seconda lettura indipendente. Ignora qualunque risposta precedente e rileggi da zero." : ""}
Restituisci soltanto JSON conforme allo schema.`;
}

function requestFor({ question, pageRecord, model, verification = false }) {
  return {
    model,
    store: false,
    max_output_tokens: 420,
    input: [
      { role: "developer", content: [{ type: "input_text", text: developerPrompt(question, pageRecord.page, verification) }] },
      { role: "user", content: [
        { type: "input_image", file_id: pageRecord.file_id, detail: "high" },
        { type: "input_text", text: question.question },
      ] },
    ],
    text: { format: { type: "json_schema", name: `offertalogica_${question.id}_${pageRecord.page}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60), strict: true, schema: singleQuestionOutputSchema() } },
  };
}

function anchorMatch(pageRecord, question) {
  const anchors = (pageRecord?.index?.anchors || []).map(comparable);
  const labels = (question.acceptedLabels || []).map(comparable);
  return labels.some((label) => anchors.some((anchor) => anchor.includes(label) || label.includes(anchor)));
}

function candidatePages(pages, question) {
  const ordered = [...pages].sort((a, b) => Number(a.page) - Number(b.page));
  if (question.scope === "document") {
    const firstPage = ordered.find((item) => Number(item.page) === 1) || ordered[0];
    return firstPage ? [firstPage] : [];
  }
  const scopeMatches = (page) => question.scope === "shared"
    ? (page.index?.scopes || []).includes("shared")
    : (page.index?.scopes || []).includes(question.scope);
  const exact = ordered.filter((page) => scopeMatches(page) && anchorMatch(page, question));
  if (exact.length) return exact.slice(0, 5);
  const scoped = ordered.filter(scopeMatches);
  if (scoped.length) return scoped.slice(0, 5);
  return ordered.slice(0, 5);
}

async function askPage({ pageRecord, question, apiKey, model, transport, signal, verification = false, pageCount }) {
  const body = await transport.createResponse({ request: requestFor({ question, pageRecord, model, verification }), apiKey, signal });
  const parsed = JSON.parse(outputText(body));
  if (Number(parsed.page) !== Number(pageRecord.page)) {
    return { accepted: false, status: "rejected", reason: "answer_page_mismatch", answer: parsed, response_id: body?.id || null };
  }
  const validated = validateQuestionAnswer(question, parsed, { pageCount });
  return { ...validated, response_id: body?.id || null };
}

function valuesAgree(left, right) {
  if (!left?.accepted || !right?.accepted) return false;
  if (typeof left.normalizedValue === "number" && typeof right.normalizedValue === "number") {
    return Math.abs(left.normalizedValue - right.normalizedValue) <= Math.max(1e-9, Math.abs(left.normalizedValue) * 1e-8);
  }
  return comparable(left.normalizedValue) === comparable(right.normalizedValue);
}

export async function readPdfFieldQuestion({ questionId, pages = [], pageCount = pages.length, apiKey, model, transport = defaultPdfQuestionTransport, signal } = {}) {
  const question = questionDefinitionById(questionId);
  if (!question) throw new Error("pdf_question_unknown");
  const startedAt = Date.now();
  const pageResults = [];
  for (const pageRecord of candidatePages(pages, question)) {
    try {
      const first = await askPage({ pageRecord, question, apiKey, model, transport, signal, pageCount });
      pageResults.push({ page: pageRecord.page, first });
      if (!first.accepted) continue;
      if (CRITICAL_TYPES.has(question.valueType)) {
        const second = await askPage({ pageRecord, question, apiKey, model, transport, signal, verification: true, pageCount });
        pageResults[pageResults.length - 1].second = second;
        if (!valuesAgree(first, second)) continue;
        pageResults[pageResults.length - 1].verified = true;
      }
    } catch (error) {
      pageResults.push({ page: pageRecord.page, error: compact(error?.message || "page_question_failed", 260) });
    }
  }

  const accepted = pageResults.filter((item) => item.first?.accepted && (!CRITICAL_TYPES.has(question.valueType) || item.verified));
  if (!accepted.length) {
    const notFound = pageResults.length && pageResults.every((item) => item.first?.status === "not_found");
    return {
      id: question.id,
      field: question.field,
      status: notFound ? "not_found" : "failed",
      reason: notFound ? "label_not_found_on_selected_pages" : "no_verified_literal_answer",
      page_results: pageResults,
      attempts: pageResults.length,
      elapsed_ms: Date.now() - startedAt,
    };
  }

  const distinct = new Map();
  for (const item of accepted) {
    const key = typeof item.first.normalizedValue === "number"
      ? `n:${item.first.normalizedValue.toPrecision(12)}`
      : `t:${comparable(item.first.normalizedValue)}`;
    if (!distinct.has(key)) distinct.set(key, []);
    distinct.get(key).push(item);
  }
  if (distinct.size > 1) {
    return {
      id: question.id,
      field: question.field,
      status: "conflict",
      reason: "different_literal_values_on_multiple_pages",
      page_results: pageResults,
      attempts: pageResults.length,
      elapsed_ms: Date.now() - startedAt,
    };
  }

  const selected = accepted[0];
  return {
    id: question.id,
    field: question.field,
    status: "completed",
    reason: null,
    result: { ...selected.first, verified: Boolean(selected.verified), corroborated_pages: accepted.map((item) => item.page) },
    raw_answer: selected.first.answer,
    response_id: selected.first.response_id || null,
    verification_response_id: selected.second?.response_id || null,
    page_results: pageResults,
    attempts: pageResults.length + accepted.filter((item) => item.second).length,
    elapsed_ms: Date.now() - startedAt,
    reader_version: PDF_AI_FIELD_READER_VERSION,
  };
}
