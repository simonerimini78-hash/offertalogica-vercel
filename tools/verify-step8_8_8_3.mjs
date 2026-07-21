#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const rootIndex = process.argv.indexOf("--root");
const root = rootIndex >= 0 ? path.resolve(process.argv[rootIndex + 1] || ".") : process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const fallback = read("lib/pdfAiFallback.js");
const reader = read("lib/pdfAiReader.js");
const helper = read("lib/pdfAiStability.js");
const ui = read("public/index.html");

const checks = {
  pipelineVersion: fallback.includes('v106.8.8.3-general-stability-1'),
  adapterVersion: reader.includes('PDF_AI_ADAPTER_VERSION = "2.4.6"'),
  helperVersion: helper.includes('v106.8.8.3-general-stability-1'),
  focusedNonBlocking: reader.includes('status: "failed_non_blocking"') && reader.includes('focusedRecoveryBudget'),
  primaryPreserved: helper.includes('primary_preserved: true'),
  monotonicMerge: helper.includes('candidates: [...primaryCandidates, ...focusedCandidates]'),
  averagePricesBlocked: fallback.includes('isAverageBillPriceLabel(visualContext)'),
  dualFromMultipleEvidence: fallback.includes('inferCommodityFromEvidence({ merged, selected, ai })'),
  noMaterialMetadata: fallback.includes('stability_revision: "8.8.8.3"'),
  uploadCopyRemoved: !ui.includes('Carica una bolletta o una scheda sintetica: proveremo')
    && !ui.includes('Quando la lettura standard e l’OCR non bastano')
    && !ui.includes("Quando la lettura standard e l'OCR non bastano"),
  uiMarker: ui.includes('OFFERTALOGICA_STEP_8_8_8_3_UPLOAD_COPY_REMOVED'),
};

console.log(JSON.stringify(checks, null, 2));
if (Object.values(checks).some((value) => !value)) process.exitCode = 1;
