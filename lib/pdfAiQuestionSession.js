import fs from "node:fs/promises";
import { pdfAiConfig } from "./pdfAiConfig.js";
import {
  classificationQuestions,
  dataQuestionsForCommodity,
  PDF_AI_QUESTION_CATALOG_VERSION,
} from "./pdfAiQuestionCatalog.js";
import {
  PDF_AI_QUESTION_VALIDATION_VERSION,
  questionAnswerNeedsRetry,
  singleQuestionOutputSchema,
  validateQuestionAnswer,
} from "./pdfAiQuestionValidation.js";
import { isMissingPdfValue } from "./pdfOcrPolicy.js";

export const PDF_AI_QUESTION_SESSION_VERSION = "step8-question-session-v1-upload-once";

const RESPONSE_MARGIN_MS = 3_500;

function compact(value, maxLength = 520) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function remainingMs(deadlineAt) {
  if (!deadlineAt) return 55_000;
  return Math.max(0, Number(deadlineAt) - Date.now());
}

function timeoutFor(deadlineAt, preferred, minimum = 2_500) {
  const available = Math.max(0, remainingMs(deadlineAt) - RESPONSE_MARGIN_MS);
  return Math.max(minimum, Math.min(preferred, available));
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
  throw new Error("openai_output_text_missing");
}

async function parseJsonResponse(response, prefix) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = compact(body?.error?.message || body?.error || `${prefix}_${response.status}`, 240);
    throw new Error(`${prefix}_${response.status}:${message}`);
  }
  return body;
}

export const defaultPdfQuestionTransport = Object.freeze({
  async uploadFile({ filePath, filename, mimeType = "application/pdf", purpose = "user_data", apiKey, signal }) {
    const bytes = await fs.readFile(filePath);
    const form = new FormData();
    form.append("purpose", purpose);
    form.append("file", new Blob([bytes], { type: mimeType }), filename || "documento.pdf");
    const response = await fetch("https://api.openai.com/v1/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal,
    });
    return parseJsonResponse(response, "openai_file_upload_http");
  },

  async createResponse({ request, apiKey, signal }) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal,
    });
    return parseJsonResponse(response, "openai_http");
  },

  async deleteFile({ fileId, apiKey, signal }) {
    if (!fileId) return { deleted: false };
    const response = await fetch(`https://api.openai.com/v1/files/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!response.ok) return { deleted: false, status: response.status };
    return response.json().catch(() => ({ deleted: true }));
  },
});

function oneFieldDeveloperPrompt(question) {
  const labelRule = question.acceptedLabels?.length
    ? `Devi trovare una riga la cui etichetta sia una di queste o una variante letterale chiaramente equivalente: ${question.acceptedLabels.join(" | ")}.`
    : "La risposta riguarda soltanto la classificazione richiesta.";
  const sectionRule = question.acceptedSections?.length
    ? `Per questo campo la riga deve appartenere a una di queste sezioni: ${question.acceptedSections.join(" | ")}. Riporta il nome della sezione dentro evidence_literal.`
    : "";
  return `Sei un lettore letterale di bollette italiane. Devi rispondere a UNA SOLA domanda sul PDF allegato.
Regole obbligatorie:
- Cerca soltanto il campo richiesto.
- Copia carattere per carattere il valore realmente visibile.
- Non calcolare, non dedurre, non correggere e non completare dati mancanti.
- Non usare valori medi, totali o di periodo quando viene richiesto un valore annuo o una componente di vendita.
- evidence_literal deve contenere la riga o il breve blocco realmente visibile con etichetta e valore.
- Se non trovi la dicitura richiesta o non riesci a leggere il valore con precisione, found=false.
- Non inventare mai una frase di evidenza.
${labelRule}
${sectionRule}
Restituisci soltanto JSON conforme allo schema.`;
}

function retryPrompt(question, firstResult) {
  return `Rileggi il PDF esclusivamente per questa domanda:
${question.question}
La risposta precedente è stata scartata per: ${firstResult.reason}.
Controlla la dicitura stampata e copia solo il valore letterale. Se non è leggibile, found=false.`;
}

function requestForQuestion({ fileInputs = [], question, model, retry = false, firstResult = null }) {
  const schemaName = `offertalogica_${question.id}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
  return {
    model,
    store: false,
    max_output_tokens: 420,
    input: [
      {
        role: "developer",
        content: [{ type: "input_text", text: oneFieldDeveloperPrompt(question) }],
      },
      {
        role: "user",
        content: [
          ...fileInputs,
          {
            type: "input_text",
            text: retry ? retryPrompt(question, firstResult) : question.question,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: schemaName,
        strict: true,
        schema: singleQuestionOutputSchema(),
      },
    },
  };
}

async function withAbortTimeout(timeoutMs, operation) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("openai_timeout")), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function askOneQuestion({
  fileInputs,
  question,
  model,
  apiKey,
  transport,
  deadlineAt,
  pageCount,
  allowRetry = true,
  questionTimeoutMs = 14_000,
} = {}) {
  const startedAt = Date.now();
  let attempts = 0;
  let firstResult = null;
  let lastResponseId = null;
  let lastReason = null;

  while (attempts < (allowRetry ? 2 : 1)) {
    attempts += 1;
    if (remainingMs(deadlineAt) < 4_500) {
      return {
        id: question.id,
        field: question.field,
        status: "skipped",
        reason: "insufficient_time_budget",
        attempts,
        elapsed_ms: Date.now() - startedAt,
      };
    }
    const timeoutMs = timeoutFor(deadlineAt, questionTimeoutMs);
    try {
      const body = await withAbortTimeout(timeoutMs, (signal) => transport.createResponse({
        request: requestForQuestion({
          fileInputs,
          question,
          model,
          retry: attempts > 1,
          firstResult,
        }),
        apiKey,
        signal,
      }));
      lastResponseId = body?.id || null;
      const parsed = JSON.parse(responseOutputText(body));
      const validated = validateQuestionAnswer(question, parsed, { pageCount });
      if (validated.accepted || validated.status === "not_found") {
        return {
          id: question.id,
          field: question.field,
          status: validated.accepted ? "completed" : "not_found",
          reason: validated.accepted ? null : validated.reason,
          result: validated,
          raw_answer: validated.answer,
          attempts,
          response_id: lastResponseId,
          elapsed_ms: Date.now() - startedAt,
        };
      }
      firstResult = validated;
      lastReason = validated.reason;
      if (!allowRetry || !questionAnswerNeedsRetry(validated)) break;
    } catch (error) {
      lastReason = compact(error?.message || "question_error", 260);
      if (attempts >= (allowRetry ? 2 : 1)) break;
      firstResult = { reason: lastReason };
    }
  }

  return {
    id: question.id,
    field: question.field,
    status: "failed",
    reason: lastReason || "question_failed",
    attempts,
    response_id: lastResponseId,
    elapsed_ms: Date.now() - startedAt,
  };
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) break;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function shouldAsk(question, normalized = {}) {
  const value = normalized?.[question.field];
  if (question.field === "kind") return !["bolletta", "scheda_offerta"].includes(value);
  if (question.field === "commodity") return !["luce", "gas", "dual"].includes(value);
  if (question.field === "customer_type") return !["privato", "business"].includes(value);
  return isMissingPdfValue(value);
}

function acceptedValue(results, field) {
  return results.find((item) => item?.field === field && item?.status === "completed")?.result?.normalizedValue || null;
}

function resolvedCommodity(normalized, classificationResults) {
  if (["luce", "gas", "dual"].includes(normalized?.commodity)) return normalized.commodity;
  return acceptedValue(classificationResults, "commodity") || "unknown";
}

export async function runPdfAiQuestionSession({
  filePath = "",
  imageFiles = [],
  filename = "documento.pdf",
  normalized = {},
  pageCount = 0,
  deadlineAt = null,
  env = process.env,
  apiKey = process.env.OPENAI_API_KEY,
  transport = defaultPdfQuestionTransport,
  concurrency = null,
} = {}) {
  const config = pdfAiConfig(env);
  const resolvedConcurrency = Number(concurrency || config.questionConcurrency || 10);
  if (!filePath && !imageFiles.length) return { status: "failed", reason: "question_session_file_missing", results: [] };
  if (!apiKey) return { status: "failed", reason: "missing_openai_api_key", results: [] };
  if (remainingMs(deadlineAt) < 10_000) {
    return { status: "skipped", reason: "insufficient_time_budget", results: [] };
  }

  const startedAt = Date.now();
  const uploadedFiles = [];
  let upload = null;
  try {
    const uploadTimeoutMs = timeoutFor(deadlineAt, config.questionUploadTimeoutMs || 12_000);
    if (filePath) {
      upload = await withAbortTimeout(uploadTimeoutMs, (signal) => transport.uploadFile({
        filePath,
        filename,
        mimeType: "application/pdf",
        purpose: "user_data",
        apiKey,
        signal,
      }));
      if (!upload?.id) throw new Error("openai_file_id_missing");
      uploadedFiles.push({ id: upload.id, type: "input_file", filename: upload.filename || filename });
    } else {
      const orderedImages = [...imageFiles]
        .filter((item) => item?.filePath)
        .sort((left, right) => Number(left.page || 0) - Number(right.page || 0));
      const imageUploads = await Promise.all(orderedImages.map(async (image, index) => {
        const mimeType = image.mimeType || "image/jpeg";
        const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
        const imageUpload = await withAbortTimeout(uploadTimeoutMs, (signal) => transport.uploadFile({
          filePath: image.filePath,
          filename: `pagina-${Number(image.page || index + 1)}.${extension}`,
          mimeType,
          purpose: "vision",
          apiKey,
          signal,
        }));
        if (!imageUpload?.id) throw new Error("openai_image_file_id_missing");
        return { id: imageUpload.id, type: "input_image", page: Number(image.page || index + 1) };
      }));
      uploadedFiles.push(...imageUploads);
      upload = { bytes: uploadedFiles.length, filename, purpose: "vision" };
    }
    const fileInputs = uploadedFiles.map((item) => item.type === "input_file"
      ? { type: "input_file", file_id: item.id }
      : { type: "input_image", file_id: item.id, detail: "high" });

    const knownCommodity = ["luce", "gas", "dual"].includes(normalized?.commodity)
      ? normalized.commodity
      : "unknown";
    const plan = [
      ...classificationQuestions(),
      ...dataQuestionsForCommodity(knownCommodity),
    ].filter((question) => shouldAsk(question, normalized));
    const results = await runPool(
      plan,
      resolvedConcurrency,
      (question) => askOneQuestion({
        fileInputs,
        question,
        model: config.criticalModel,
        apiKey,
        transport,
        deadlineAt,
        pageCount,
        allowRetry: question.valueType !== "classification",
        questionTimeoutMs: config.questionTimeoutMs || 14_000,
      }),
    );
    const commodity = resolvedCommodity(normalized, results);
    const completed = results.filter((item) => item?.status === "completed");
    const failed = results.filter((item) => item?.status === "failed");
    return {
      status: completed.length ? "completed" : "failed",
      reason: completed.length ? null : failed[0]?.reason || "all_targeted_questions_failed",
      partial: results.some((item) => !["completed", "not_found"].includes(item?.status)),
      model: config.criticalModel,
      concurrency: resolvedConcurrency,
      file_id: uploadedFiles.length === 1 ? uploadedFiles[0].id : null,
      uploaded_file_count: uploadedFiles.length,
      upload: {
        bytes: Number(upload?.bytes || 0),
        filename: upload?.filename || filename,
        purpose: upload?.purpose || "user_data",
      },
      commodity,
      results,
      accepted: completed.map((item) => item.result),
      elapsed_ms: Date.now() - startedAt,
      catalog_version: PDF_AI_QUESTION_CATALOG_VERSION,
      validation_version: PDF_AI_QUESTION_VALIDATION_VERSION,
      session_version: PDF_AI_QUESTION_SESSION_VERSION,
    };
  } catch (error) {
    return {
      status: "failed",
      reason: compact(error?.message || "question_session_error", 300),
      results: [],
      file_id: uploadedFiles.length === 1 ? uploadedFiles[0].id : null,
      uploaded_file_count: uploadedFiles.length,
      elapsed_ms: Date.now() - startedAt,
      catalog_version: PDF_AI_QUESTION_CATALOG_VERSION,
      validation_version: PDF_AI_QUESTION_VALIDATION_VERSION,
      session_version: PDF_AI_QUESTION_SESSION_VERSION,
    };
  } finally {
    for (const uploaded of uploadedFiles) {
      try {
        const deleteTimeout = Math.max(1_500, Math.min(4_000, remainingMs(deadlineAt) - 500));
        await withAbortTimeout(deleteTimeout, (signal) => transport.deleteFile({
          fileId: uploaded.id,
          apiKey,
          signal,
        }));
      } catch {
        // Best-effort cleanup. Files can also be removed from the OpenAI dashboard.
      }
    }
  }
}
