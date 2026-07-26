import { allQuestionDefinitions } from "./pdfAiQuestionCatalog.js";
import { isMissingPdfValue } from "./pdfOcrPolicy.js";

export const PDF_ANALYSIS_PLAN_VERSION = "step8-question-plan-v2-sequential";

const ORDER = new Map([
  ["document_kind", 10], ["document_commodity", 20], ["customer_type", 30],
  ["fornitore", 40], ["intestatario", 50], ["codice_fiscale", 60], ["codice_cliente", 70],
  ["luce_consumo_annuo", 100], ["luce_pod", 110], ["luce_potenza_impegnata", 120],
  ["luce_indirizzo_fornitura", 130], ["luce_prezzo_vendita", 140], ["luce_quota_fissa_vendita", 150],
  ["luce_nome_offerta", 160], ["luce_codice_offerta", 170], ["luce_indice", 180], ["luce_spread", 190],
  ["luce_tipo_prezzo", 200], ["luce_scadenza_condizioni", 210],
  ["gas_consumo_annuo", 300], ["gas_pdr", 310], ["gas_indirizzo_fornitura", 320],
  ["gas_prezzo_vendita", 330], ["gas_quota_fissa_vendita", 340], ["gas_nome_offerta", 350],
  ["gas_codice_offerta", 360], ["gas_indice", 370], ["gas_spread", 380], ["gas_tipo_prezzo", 390],
  ["gas_scadenza_condizioni", 400],
]);

function shouldInclude(question, baseline = {}, commodity = "unknown") {
  if (!question?.id || !question?.field) return false;
  const value = baseline?.[question.field];
  if (!isMissingPdfValue(value) && value !== "unknown") return false;
  if (question.scope === "luce" && commodity === "gas") return false;
  if (question.scope === "gas" && commodity === "luce") return false;
  return true;
}

export function buildPdfAnalysisPlan({ baseline = {}, commodity = baseline?.commodity || "unknown" } = {}) {
  return allQuestionDefinitions()
    .filter((question) => shouldInclude(question, baseline, commodity))
    .sort((left, right) => (ORDER.get(left.id) || 999) - (ORDER.get(right.id) || 999))
    .map((question) => ({
      id: question.id,
      field: question.field,
      scope: question.scope,
      question: question.question,
      valueType: question.valueType,
      acceptedLabels: question.acceptedLabels || [],
      acceptedSections: question.acceptedSections || [],
      criticalVerification: [
        "tax_id", "pod", "pdr", "number", "fixed_fee", "identifier",
      ].includes(question.valueType),
    }));
}

export function publicPdfAnalysisPlan(plan = []) {
  return plan.map(({ id, field, scope, question, criticalVerification }) => ({
    id, field, scope, question, criticalVerification: Boolean(criticalVerification),
  }));
}
