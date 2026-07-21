#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  patchPdfAiFallbackSafe as patchBaseFallback,
  patchPdfAiReaderSafe as patchBaseReader,
  STEP_8_8_8_1_FALLBACK_MARKER,
  STEP_8_8_8_1_READER_MARKER,
} from "./apply-step8_8_8_1.mjs";

export const STEP_8_8_8_3_FALLBACK_MARKER = "OFFERTALOGICA_STEP_8_8_8_3_GENERAL_SEMANTIC_STABILITY";
export const STEP_8_8_8_3_READER_MARKER = "OFFERTALOGICA_STEP_8_8_8_3_NON_BLOCKING_FOCUSED";
export const STEP_8_8_8_3_UI_MARKER = "OFFERTALOGICA_STEP_8_8_8_3_UPLOAD_COPY_REMOVED";

function ensureBaseFallback(source) {
  return source.includes(STEP_8_8_8_1_FALLBACK_MARKER) ? source : patchBaseFallback(source).source;
}

function ensureBaseReader(source) {
  return source.includes(STEP_8_8_8_1_READER_MARKER) ? source : patchBaseReader(source).source;
}

function replaceOnce(source, search, replacement, label) {
  if (typeof search === "string") {
    const count = source.split(search).length - 1;
    if (count !== 1) throw new Error(`${label}: atteso 1 anchor, trovati ${count}`);
    return source.replace(search, replacement);
  }
  const matches = [...source.matchAll(new RegExp(search.source, search.flags.includes("g") ? search.flags : `${search.flags}g`))];
  if (matches.length !== 1) throw new Error(`${label}: atteso 1 anchor, trovati ${matches.length}`);
  return source.replace(search, replacement);
}

export function patchPdfAiFallbackGeneral(source) {
  let output = ensureBaseFallback(source);
  if (output.includes(STEP_8_8_8_3_FALLBACK_MARKER)) return { source: output, changed: false, reason: "already_patched" };

  output = output.replace(
    /export const PDF_AI_FALLBACK_PIPELINE_VERSION = "[^"]+";/,
    'export const PDF_AI_FALLBACK_PIPELINE_VERSION = "v106.8.8.3-general-stability-1";',
  );

  const visualImport = `import {
  prepareSafeAiVisualCandidates,
  recoverItalianTaxIdCandidate,
  safeVisualFieldThreshold,
} from "./pdfAiVisualRecovery.js";`;
  const stabilityImport = `${visualImport}
import {
  inferCommodityFromEvidence,
  isAverageBillPriceLabel,
} from "./pdfAiStability.js";

// ${STEP_8_8_8_3_FALLBACK_MARKER}`;
  output = replaceOnce(output, visualImport, stabilityImport, "import stabilità semantica");

  output = replaceOnce(
    output,
    "&& AVERAGE_UNIT_COST_LABEL_PATTERN.test(visualContext)) {",
    "&& (AVERAGE_UNIT_COST_LABEL_PATTERN.test(visualContext) || isAverageBillPriceLabel(visualContext))) {",
    "blocco prezzi medi",
  );

  output = replaceOnce(
    output,
    /function inferredCommodityFromSupplyIdentifiers\(merged = \{\}\) \{[\s\S]*?\n\}\n\nfunction identifierSelectionForCommodity/,
    `function inferredCommodityFromSupplyIdentifiers(merged = {}, selected = [], ai = {}) {
  return inferCommodityFromEvidence({ merged, selected, ai });
}

function identifierSelectionForCommodity`,
    "inferenza commodity multi-evidenza",
  );

  output = replaceOnce(
    output,
    "function reconcileCommodityWithSupplyIdentifiers({ merged, selected, filledFields, rejected, warnings }) {\n  const inferred = inferredCommodityFromSupplyIdentifiers(merged);",
    "function reconcileCommodityWithSupplyIdentifiers({ merged, selected, filledFields, rejected, warnings, ai }) {\n  const inferred = inferredCommodityFromSupplyIdentifiers(merged, selected, ai);",
    "riconciliazione commodity",
  );

  output = replaceOnce(
    output,
    "    warnings: classificationWarnings,\n  });\n  applySupplySpecificAliases",
    "    warnings: classificationWarnings,\n    ai,\n  });\n  applySupplySpecificAliases",
    "passaggio evidenze IA alla commodity",
  );

  output = output
    .replaceAll("ai_commodity_riallineata_a_identificativo_fornitura", "ai_commodity_riallineata_da_evidenze_fornitura")
    .replaceAll("ai_commodity_derivata_da_identificativo_fornitura", "ai_commodity_derivata_da_evidenze_fornitura")
    .replaceAll("classificazione coerente con l'identificativo di fornitura", "classificazione coerente con le evidenze luce/gas disponibili")
    .replaceAll("Fornitura derivata dall'identificativo", "Fornitura derivata da evidenze coerenti");

  const noMaterialAnchor = `        recovery_timeout_ms: ai.recovery_timeout_ms || null,
        rejected_fields: rejected,
        automatic_fallback: true,`;
  const noMaterialReplacement = `        recovery_timeout_ms: ai.recovery_timeout_ms || null,
        request_profile: ai.request_profile || "full",
        focused_recovery: ai.focused_recovery || null,
        stability_revision: "8.8.8.3",
        rejected_fields: rejected,
        automatic_fallback: true,`;
  output = replaceOnce(output, noMaterialAnchor, noMaterialReplacement, "metadati focused anche senza miglioramento");

  output = output.replace('safety_revision: "8.8.8.1"', 'safety_revision: "8.8.8.3"');
  output = replaceOnce(
    output,
    '    safety_revision: "8.8.8.3",\n    filled_fields:',
    '    safety_revision: "8.8.8.3",\n    stability_revision: "8.8.8.3",\n    filled_fields:',
    "metadato stabilità risultato applicato",
  );

  return { source: output, changed: true, reason: "patched" };
}

export function patchPdfAiReaderStability(source) {
  let output = ensureBaseReader(source);
  if (output.includes(STEP_8_8_8_3_READER_MARKER)) return { source: output, changed: false, reason: "already_patched" };

  output = output.replace(
    /export const PDF_AI_ADAPTER_VERSION = "[^"]+";/,
    'export const PDF_AI_ADAPTER_VERSION = "2.4.6";',
  );

  const importAnchor = 'import { aiPdfToCandidates, pdfFieldNames } from "./pdfReaderContract.js";';
  const importReplacement = `${importAnchor}
import {
  focusedRecoveryBudget,
  mergeFocusedVisualResults,
  withFocusedRecoveryStatus,
} from "./pdfAiStability.js";

// ${STEP_8_8_8_3_READER_MARKER}`;
  output = replaceOnce(output, importAnchor, importReplacement, "import stabilità focused");

  output = replaceOnce(
    output,
    /function mergeFocusedRecovery\(primary, recovery, missingFields\) \{[\s\S]*?\n\}\n\s*async function runFocusedPdfAiRecovery/,
    `function mergeFocusedRecovery(primary, recovery, missingFields) {
  return mergeFocusedVisualResults(primary, recovery, missingFields);
}

async function runFocusedPdfAiRecovery`,
    "fusione focused monotona",
  );

  output = replaceOnce(
    output,
    /async function runFocusedPdfAiRecovery\(primary, options = \{\}\) \{[\s\S]*?\n\}\n\s*export async function runPdfAiFallbackImages/,
    `async function runFocusedPdfAiRecovery(primary, options = {}) {
  const missingFields = missingPdfAiFocusedRecoveryFields(primary);
  if (missingFields.length < 2 || !(options.imageFiles || []).length) {
    return withFocusedRecoveryStatus(primary, {
      attempted: false,
      status: "not_needed",
      missing_fields: missingFields,
    });
  }
  if (!focusedRecoveryEnabled(options.env || process.env)) {
    return withFocusedRecoveryStatus(primary, {
      attempted: false,
      status: "disabled",
      missing_fields: missingFields,
    });
  }

  const env = options.env || process.env;
  const allowWithoutDeadline = /^(?:1|true|yes|on)$/i.test(String(env.PDF_AI_FOCUSED_RECOVERY_ALLOW_WITHOUT_DEADLINE || ""));
  const budget = focusedRecoveryBudget({
    deadlineAt: Number(options.deadlineAt || 0),
    configuredMs: Number(env.PDF_AI_FOCUSED_RECOVERY_TIMEOUT_MS || 6_500),
    reserveMs: Number(env.PDF_AI_FOCUSED_RECOVERY_RESERVE_MS || 3_000),
    allowWithoutDeadline,
  });
  if (!budget.attempt) {
    return withFocusedRecoveryStatus(primary, {
      attempted: false,
      status: budget.status,
      missing_fields: missingFields,
      remaining_ms: budget.remaining_ms,
      reserve_ms: budget.reserve_ms,
    });
  }

  try {
    const recovery = await runPdfAi({
      ...options,
      requiredMode: "fallback",
      imageFiles: options.imageFiles,
      parserCandidates: [...(options.parserCandidates || []), ...(primary.candidates || [])],
      imageProfile: "focused",
      timeoutValue: budget.timeout_ms,
    });
    if (recovery.status === "completed") return mergeFocusedRecovery(primary, recovery, missingFields);
    return withFocusedRecoveryStatus(primary, {
      attempted: true,
      status: "failed_non_blocking",
      reason: recovery.reason || recovery.status || "failed",
      missing_fields: missingFields,
      timeout_ms: recovery.timeout_ms || budget.timeout_ms,
    }, true);
  } catch (error) {
    return withFocusedRecoveryStatus(primary, {
      attempted: true,
      status: "failed_non_blocking",
      reason: String(error?.message || "focused_recovery_error").slice(0, 300),
      missing_fields: missingFields,
      timeout_ms: budget.timeout_ms,
    }, true);
  }
}

export async function runPdfAiFallbackImages`,
    "focused non bloccante",
  );

  const pricePrompt = "- Prezzo medio, costo medio unitario and totals from the bill are observation-only billing_period values and are never contractual sales prices.";
  if (output.includes(pricePrompt)) {
    output = output.replace(
      pricePrompt,
      `${pricePrompt} Do not return them in prezzo_luce_eur_kwh or prezzo_gas_eur_smc; omit those price fields unless an explicit contractual sales component, spread or formula is visible.`,
    );
  }

  return { source: output, changed: true, reason: "patched" };
}

export function patchUploadCopy(source) {
  if (source.includes(STEP_8_8_8_3_UI_MARKER)) return { source, changed: false, reason: "already_patched" };
  const panelAnchor = '<div class="pdf-lead-panel" id="pdf-upload-panel">';
  const panelIndex = source.indexOf(panelAnchor);
  if (panelIndex < 0) throw new Error("public/index.html: pannello caricamento PDF non trovato");

  const windowEnd = Math.min(source.length, panelIndex + 2_500);
  const before = source.slice(0, panelIndex);
  let panelWindow = source.slice(panelIndex, windowEnd);
  const after = source.slice(windowEnd);

  const patterns = [
    /\s*<p(?:\s[^>]*)?>\s*Carica una bolletta o una scheda sintetica:[\s\S]*?<\/p>/i,
    /\s*<p(?:\s[^>]*)?>\s*Quando la lettura standard e l['’]OCR non bastano,[\s\S]*?<\/p>/i,
  ];
  let removed = 0;
  for (const pattern of patterns) {
    if (pattern.test(panelWindow)) {
      panelWindow = panelWindow.replace(pattern, "");
      removed += 1;
    }
  }
  if (!removed) throw new Error("public/index.html: testo informativo sotto il caricamento non trovato");

  panelWindow = panelWindow.replace(
    /(<h3>Carica bolletta o scheda sintetica<\/h3>)/i,
    `$1\n        <!-- ${STEP_8_8_8_3_UI_MARKER} -->`,
  );
  return { source: `${before}${panelWindow}${after}`, changed: true, reason: "patched" };
}

function backupPathFor(relative) {
  const dir = path.join(os.homedir(), ".offertalogica-backups", "step8.8.8.3");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${Date.now()}-${relative.replace(/[^a-zA-Z0-9._-]+/g, "_")}`);
}

function parseArgs(argv) {
  const options = { root: process.cwd(), dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") options.root = path.resolve(argv[++index] || ".");
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Argomento non riconosciuto: ${arg}`);
  }
  return options;
}

export function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log("Uso: node tools/apply-step8_8_8_3.mjs [--dry-run] [--root <repository>]");
    return 0;
  }

  const helper = path.join(options.root, "lib/pdfAiStability.js");
  if (!fs.existsSync(helper)) throw new Error("Copia prima lib/pdfAiStability.js dal pacchetto");

  const targets = [
    { relative: "lib/pdfAiFallback.js", patch: patchPdfAiFallbackGeneral },
    { relative: "lib/pdfAiReader.js", patch: patchPdfAiReaderStability },
    { relative: "public/index.html", patch: patchUploadCopy },
  ];

  for (const target of targets) {
    const file = path.join(options.root, target.relative);
    if (!fs.existsSync(file)) throw new Error(`File richiesto non trovato: ${target.relative}`);
    const source = fs.readFileSync(file, "utf8");
    const result = target.patch(source);
    if (!result.changed) {
      console.log(`GIÀ AGGIORNATO: ${target.relative}`);
      continue;
    }
    if (options.dryRun) {
      console.log(`PRONTO: ${target.relative}`);
      continue;
    }
    const backup = backupPathFor(target.relative);
    fs.copyFileSync(file, backup);
    fs.writeFileSync(file, result.source, "utf8");
    console.log(`AGGIORNATO: ${target.relative} — backup: ${backup}`);
  }
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(`ERRORE Step 8.8.8.3: ${error.message}`);
    process.exitCode = 1;
  }
}
