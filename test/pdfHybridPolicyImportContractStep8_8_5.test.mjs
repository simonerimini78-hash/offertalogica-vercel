import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_EXTRACTABLE_FIELDS,
  applyCrossSourceConsensus,
  buildPdfQualityReport,
  mergeAiDiagnostics,
  mergeAiResult,
  mergeConsensusDiagnostics,
  mergeOcrDiagnostics,
  mergeOcrResult,
  quarantineUnsafeRequiredValues,
  synchronizeCommodityFields,
} from "../lib/pdfHybridPolicy.js";

test("pdfHybrid.js può risolvere tutti gli export nominati", () => {
  assert.ok(Array.isArray(AI_EXTRACTABLE_FIELDS));
  for (const fn of [
    applyCrossSourceConsensus,
    buildPdfQualityReport,
    mergeAiDiagnostics,
    mergeAiResult,
    mergeConsensusDiagnostics,
    mergeOcrDiagnostics,
    mergeOcrResult,
    quarantineUnsafeRequiredValues,
    synchronizeCommodityFields,
  ]) {
    assert.equal(typeof fn, "function");
  }
});
