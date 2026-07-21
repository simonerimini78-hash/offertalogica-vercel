import test from "node:test";
import assert from "node:assert/strict";

import {
  patchPdfAiFallbackGeneral,
  patchPdfAiReaderStability,
  patchUploadCopy,
} from "../tools/apply-step8_8_8_3.mjs";

const readerFixture = `import fs from "node:fs/promises";
import { aiPdfToCandidates, pdfFieldNames } from "./pdfReaderContract.js";
export const PDF_AI_ADAPTER_VERSION = "2.4.5";
// OFFERTALOGICA_STEP_8_8_8_1_FOCUSED_TAGGING
const FOCUSED_RECOVERY_SYSTEM_PROMPT = \`- Prezzo medio, costo medio unitario and totals from the bill are observation-only billing_period values and are never contractual sales prices.\`;
function missingPdfAiFocusedRecoveryFields(){ return []; }
function focusedRecoveryEnabled(){ return true; }
function mergeFocusedRecovery(primary, recovery, missingFields) {
  const focusedCandidates = (recovery.candidates || []).map((candidate) => ({ ...candidate }));
  return { ...primary, candidates: [...(primary.candidates || []), ...focusedCandidates] };
}
async function runFocusedPdfAiRecovery(primary, options = {}) {
  const recovery = await runPdfAi(options);
  if (recovery.status === "completed") return mergeFocusedRecovery(primary, recovery, []);
  return primary;
}
export async function runPdfAiFallbackImages(options = {}) { return options; }
`;

const fallbackFixture = `import {
  prepareSafeAiVisualCandidates,
  recoverItalianTaxIdCandidate,
  safeVisualFieldThreshold,
} from "./pdfAiVisualRecovery.js";
// OFFERTALOGICA_STEP_8_8_8_1_SAFE_CONSENSUS
export const PDF_AI_FALLBACK_PIPELINE_VERSION = "v106.8.8.1-safe-consensus-recovery-1";
const AVERAGE_UNIT_COST_LABEL_PATTERN = /costo medio/i;
function candidateRejection(candidate) {
  const visualContext = candidate.label || "";
  if (["prezzo_luce_eur_kwh", "prezzo_gas_eur_smc"].includes(candidate.field)
    && AVERAGE_UNIT_COST_LABEL_PATTERN.test(visualContext)) {
    return "average_unit_cost_not_contract_price";
  }
}
function inferredCommodityFromSupplyIdentifiers(merged = {}) {
  const hasPod = Boolean(merged.pod);
  const hasPdr = Boolean(merged.pdr);
  if (hasPod && hasPdr) return "dual";
  if (hasPod) return "luce";
  if (hasPdr) return "gas";
  return null;
}

function identifierSelectionForCommodity() { return null; }
function reconcileCommodityWithSupplyIdentifiers({ merged, selected, filledFields, rejected, warnings }) {
  const inferred = inferredCommodityFromSupplyIdentifiers(merged);
  warnings.push("ai_commodity_riallineata_a_identificativo_fornitura");
  const evidence = "classificazione coerente con l'identificativo di fornitura";
  const label = "Fornitura derivata dall'identificativo";
}
function mergeCompletedAiResult(base, ai, policy) {
  const classificationWarnings = [];
  const merged = {};
  const selected = [];
  const filledFields = [];
  const rejected = [];
  reconcileCommodityWithSupplyIdentifiers({
    merged,
    selected,
    filledFields,
    rejected,
    warnings: classificationWarnings,
  });
  applySupplySpecificAliases(merged, filledFields, selected, []);
  if (!material) {
    return { ai: {
        recovery_timeout_ms: ai.recovery_timeout_ms || null,
        rejected_fields: rejected,
        automatic_fallback: true,
    }};
  }
  return { ai: {
    safety_revision: "8.8.8.1",
    filled_fields: [],
  }};
}
`;

test("patch reader rende il focused non bloccante e idempotente", () => {
  const first = patchPdfAiReaderStability(readerFixture);
  assert.equal(first.changed, true);
  assert.match(first.source, /PDF_AI_ADAPTER_VERSION = "2\.4\.6"/);
  assert.match(first.source, /failed_non_blocking/);
  assert.match(first.source, /focusedRecoveryBudget/);
  const second = patchPdfAiReaderStability(first.source);
  assert.equal(second.changed, false);
  assert.equal(second.source, first.source);
});

test("patch fallback usa evidenze multiple e rende visibili i metadati anche senza miglioramento", () => {
  const first = patchPdfAiFallbackGeneral(fallbackFixture);
  assert.equal(first.changed, true);
  assert.match(first.source, /v106\.8\.8\.3-general-stability-1/);
  assert.match(first.source, /inferCommodityFromEvidence\(\{ merged, selected, ai \}\)/);
  assert.match(first.source, /isAverageBillPriceLabel\(visualContext\)/);
  assert.match(first.source, /stability_revision: "8\.8\.8\.3"/);
  const second = patchPdfAiFallbackGeneral(first.source);
  assert.equal(second.changed, false);
});

test("patch UI rimuove entrambe le frasi sotto il caricamento senza toccare il titolo", () => {
  const source = `<div class="pdf-lead-panel" id="pdf-upload-panel">
<h3>Carica bolletta o scheda sintetica</h3>
<p>Carica una bolletta o una scheda sintetica: proveremo a leggere consumi, fornitore, prezzi e quote fisse.</p>
<p>Quando la lettura standard e l’OCR non bastano, il sistema tenta automaticamente una lettura visuale AI; i dati ottenuti restano sempre da controllare.</p>
<div class="upload-drop"></div>`;
  const first = patchUploadCopy(source);
  assert.equal(first.changed, true);
  assert.match(first.source, /Carica bolletta o scheda sintetica<\/h3>/);
  assert.doesNotMatch(first.source, /proveremo a leggere/);
  assert.doesNotMatch(first.source, /lettura visuale AI/);
  assert.match(first.source, /OFFERTALOGICA_STEP_8_8_8_3_UPLOAD_COPY_REMOVED/);
  assert.equal(patchUploadCopy(first.source).changed, false);
});
