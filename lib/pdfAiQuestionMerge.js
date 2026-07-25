import { applyPdfDataContract } from "./pdfDataContract.js";
import { applyPdfFieldValidation } from "./pdfFieldValidation.js";
import { isMissingPdfValue } from "./pdfOcrPolicy.js";
import { pdfAiConfig } from "./pdfAiConfig.js";

export const PDF_AI_QUESTION_PIPELINE_VERSION = "step8-question-pipeline-v1-direct-fields";

const IDENTIFIER_FIELDS = new Set(["pod", "pdr", "codice_fiscale", "codice_cliente"]);

function compact(value, maxLength = 520) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function valueKey(value) {
  if (typeof value === "number" && Number.isFinite(value)) return `number:${value.toPrecision(12)}`;
  return `text:${compact(value, 260).toLocaleLowerCase("it-IT")}`;
}

function inferCommodity(normalized = {}, accepted = []) {
  if (["luce", "gas", "dual"].includes(normalized.commodity)) return normalized.commodity;
  const explicit = accepted.find((item) => item.field === "commodity")?.normalizedValue;
  if (["luce", "gas", "dual"].includes(explicit)) return explicit;
  const fields = new Set(accepted.map((item) => item.field));
  const hasLuce = [...fields].some((field) => field.includes("_luce") || ["pod", "potenza_impegnata_kw"].includes(field));
  const hasGas = [...fields].some((field) => field.includes("_gas") || field === "pdr");
  if (hasLuce && hasGas) return "dual";
  if (hasLuce) return "luce";
  if (hasGas) return "gas";
  return "unknown";
}

function diagnosticFor(result) {
  return {
    field: result.field,
    label: result.label || result.field,
    value: result.normalizedValue,
    status: "review",
    confidence: Number(result.confidence || 0) >= 85 ? "high" : "medium",
    page: result.page || null,
    source_snippet: compact(result.evidence, 420),
    method: "gpt41_targeted_single_question",
    source_version: PDF_AI_QUESTION_PIPELINE_VERSION,
    derivation: result.derivation || null,
    question_id: result.answer?.query_id || null,
  };
}

function fieldReviewReason(field) {
  if (IDENTIFIER_FIELDS.has(field)) return "identificativo_letto_da_domanda_mirata_ia";
  if (["kind", "commodity", "customer_type"].includes(field)) return "classificazione_documento_ia";
  return "valore_letto_da_domanda_mirata_ia";
}

function publicQuestionBatch(item) {
  const result = item?.result || null;
  const answer = item?.raw_answer || result?.answer || null;
  return {
    id: item?.id || item?.field || "question",
    phase: "single_question",
    profile: item?.field || null,
    pages: result?.page ? [result.page] : [],
    page_selection: "complete_uploaded_document",
    status: item?.status || "failed",
    reason: item?.reason || null,
    elapsed_ms: Number(item?.elapsed_ms || 0),
    candidate_count: item?.status === "completed" ? 1 : 0,
    consumption_observation_count: 0,
    economic_row_count: 0,
    targeted_answer_count: answer ? 1 : 0,
    targeted_answers: answer ? [{
      query_id: item?.id || null,
      field: item?.field || null,
      ...answer,
    }] : [],
    document_commodity: null,
    page_map_count: 0,
    page_map: [],
    response_id: item?.response_id || null,
    attempts: Number(item?.attempts || 0),
  };
}

export function mergePdfAiQuestionSession({
  normalized = {},
  session = {},
  env = process.env,
} = {}) {
  const config = pdfAiConfig(env);
  if (session.status !== "completed") {
    return {
      normalized,
      audit: {
        enabled: true,
        mode: config.mode,
        pipeline_version: PDF_AI_QUESTION_PIPELINE_VERSION,
        config_version: config.version,
        public_output: "step7_preserved_after_question_session_failure",
        reason: session.reason || "question_session_failed",
        ai: {
          status: session.status || "failed",
          reason: session.reason || "question_session_failed",
          model: session.model || config.criticalModel,
          candidate_count: 0,
          partial: Boolean(session.partial),
          plan: {
            mode: "upload_once_independent_questions",
            session_version: session.session_version || null,
            catalog_version: session.catalog_version || null,
            validation_version: session.validation_version || null,
          },
          batches: (session.results || []).map(publicQuestionBatch),
          consumption_observation_count: 0,
          economic_row_count: 0,
          inventory_diagnostics: { consumptions: [], economics: [] },
        },
        arbitration: [],
        promoted: [],
        rejected: [],
        conflicts: [],
      },
    };
  }

  const merged = {
    ...normalized,
    diagnostics: [...(normalized.diagnostics || [])],
    warnings: [...(normalized.warnings || [])],
  };
  const promoted = [];
  const conflicts = [];
  const rejected = [];
  const reviewOverrides = new Map();

  for (const item of session.results || []) {
    if (item?.status !== "completed" || !item?.result?.accepted) {
      if (!["not_found"].includes(item?.status)) {
        rejected.push({
          field: item?.field || null,
          reason: item?.reason || item?.result?.reason || "question_failed",
          page: item?.result?.page || null,
          evidence: compact(item?.result?.evidence || item?.raw_answer?.evidence_literal, 260),
        });
      }
      continue;
    }
    const result = item.result;
    const field = result.field;
    const selectedValue = result.normalizedValue;
    if (!field || isMissingPdfValue(selectedValue) || selectedValue === "unknown") continue;

    if (!isMissingPdfValue(merged[field]) && merged[field] !== "unknown") {
      if (valueKey(merged[field]) !== valueKey(selectedValue)) {
        conflicts.push({
          field,
          reason: "protected_step7_value_conflicts_with_targeted_question",
          values: [valueKey(merged[field]), valueKey(selectedValue)],
          evidence: compact(result.evidence, 300),
        });
      }
      continue;
    }

    merged[field] = selectedValue;
    merged.diagnostics.push(diagnosticFor(result));
    promoted.push({
      field,
      value: selectedValue,
      status: "review",
      page: result.page || null,
      evidence: compact(result.evidence, 300),
      derivation: result.derivation || null,
      question_id: item.id,
    });
    reviewOverrides.set(field, {
      reason: fieldReviewReason(field),
      evidence: compact(result.evidence, 360),
    });
  }

  if (!["bolletta", "scheda_offerta"].includes(merged.kind)) {
    const kind = session.accepted?.find((item) => item.field === "kind")?.normalizedValue;
    if (["bolletta", "scheda_offerta"].includes(kind)) merged.kind = kind;
  }
  merged.commodity = inferCommodity(merged, session.accepted || []);
  if (["bolletta", "scheda_offerta"].includes(merged.kind)
    && ["luce", "gas", "dual"].includes(merged.commodity)) {
    merged.recognized = true;
    merged.confidence = ["high", "medium"].includes(merged.confidence) ? merged.confidence : "medium";
  }

  const validated = applyPdfFieldValidation(merged);
  validated.field_status = { ...(validated.field_status || {}) };
  for (const [field, detail] of reviewOverrides) {
    validated.field_status[field] = {
      status: "da_verificare",
      reason: detail.reason,
      evidence: detail.evidence,
    };
  }
  validated.ai = {
    applied: true,
    pipeline_version: PDF_AI_QUESTION_PIPELINE_VERSION,
    reader_version: session.session_version || null,
    filled_fields: unique(promoted.map((item) => item.field)),
    question_count: Number(session.results?.length || 0),
    completed_question_count: Number(session.results?.filter((item) => item.status === "completed").length || 0),
    file_uploaded_once: true,
  };
  validated.needsReview = Boolean(
    validated.needsReview
    || promoted.length
    || conflicts.length
    || rejected.length,
  );
  validated.warnings = unique([
    ...(validated.warnings || []),
    promoted.length ? "dati_ia_da_verificare" : "",
    "lettura_ia_domande_singole",
    conflicts.length ? "conflitti_ia_non_promossi" : "",
    rejected.length ? "risposte_mirate_ia_scartate" : "",
  ]);

  const contracted = applyPdfDataContract(validated);
  return {
    normalized: contracted,
    audit: {
      enabled: true,
      mode: config.mode,
      pipeline_version: PDF_AI_QUESTION_PIPELINE_VERSION,
      config_version: config.version,
      public_output: "targeted_question_direct_merge",
      reason: "single_field_questions",
      ai: {
        status: "completed",
        reason: null,
        model: session.model || config.criticalModel,
        candidate_count: promoted.length,
        partial: Boolean(session.partial),
        plan: {
          mode: "upload_once_independent_questions",
          file_uploaded_once: true,
          question_count: Number(session.results?.length || 0),
          concurrency: "bounded_parallel",
          session_version: session.session_version || null,
          catalog_version: session.catalog_version || null,
          validation_version: session.validation_version || null,
          elapsed_ms: Number(session.elapsed_ms || 0),
        },
        batches: (session.results || []).map(publicQuestionBatch),
        consumption_observation_count: 0,
        economic_row_count: 0,
        inventory_diagnostics: { consumptions: [], economics: [] },
      },
      arbitration: [],
      promoted,
      rejected,
      conflicts,
    },
  };
}
