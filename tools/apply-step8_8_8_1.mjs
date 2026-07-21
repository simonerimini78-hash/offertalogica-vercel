#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  patchPdfAiFallback as patchBaseFallback,
  patchPdfAiReader as patchBaseReader,
  STEP_8_8_8_FALLBACK_MARKER,
  STEP_8_8_8_READER_MARKER,
} from "./apply-step8_8_8.mjs";

export const STEP_8_8_8_1_FALLBACK_MARKER = "OFFERTALOGICA_STEP_8_8_8_1_SAFE_CONSENSUS";
export const STEP_8_8_8_1_READER_MARKER = "OFFERTALOGICA_STEP_8_8_8_1_FOCUSED_TAGGING";

function replaceOnce(source, search, replacement, label) {
  const count = source.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: atteso 1 anchor, trovati ${count}`);
  return source.replace(search, replacement);
}

function ensureBaseFallback(source) {
  return source.includes(STEP_8_8_8_FALLBACK_MARKER) ? source : patchBaseFallback(source).source;
}

function ensureBaseReader(source) {
  return source.includes(STEP_8_8_8_READER_MARKER) ? source : patchBaseReader(source).source;
}

export function patchPdfAiFallbackSafe(source) {
  let output = ensureBaseFallback(source);
  if (output.includes(STEP_8_8_8_1_FALLBACK_MARKER)) return { source: output, changed: false, reason: "already_patched" };

  output = output.replace(
    /export const PDF_AI_FALLBACK_PIPELINE_VERSION = "[^"]+";/,
    'export const PDF_AI_FALLBACK_PIPELINE_VERSION = "v106.8.8.1-safe-consensus-recovery-1";',
  );

  const oldImport = `import {
  explicitVisualIdentifierThreshold,
  recoverItalianTaxIdCandidate,
} from "./pdfAiVisualRecovery.js";`;
  const newImport = `import {
  prepareSafeAiVisualCandidates,
  recoverItalianTaxIdCandidate,
  safeVisualFieldThreshold,
} from "./pdfAiVisualRecovery.js";`;
  output = replaceOnce(output, oldImport, `${newImport}\n\n// ${STEP_8_8_8_1_FALLBACK_MARKER}`, "import helper visuale");

  output = replaceOnce(
    output,
    "    ?? explicitVisualIdentifierThreshold(candidate)\n    ?? confidenceThreshold(candidate?.field);",
    "    ?? safeVisualFieldThreshold(candidate)\n    ?? confidenceThreshold(candidate?.field);",
    "soglia visuale sicura",
  );

  output = replaceOnce(
    output,
    "  addExplicitTaxIdCandidate(ai);\n  const aiConflictFields",
    "  addExplicitTaxIdCandidate(ai);\n  prepareSafeAiVisualCandidates(ai);\n  const aiConflictFields",
    "preparazione consenso visuale",
  );

  output = replaceOnce(
    output,
    '    focused_recovery: ai.focused_recovery || null,\n    filled_fields:',
    '    focused_recovery: ai.focused_recovery || null,\n    safety_revision: "8.8.8.1",\n    filled_fields:',
    "metadato revisione sicurezza",
  );

  return { source: output, changed: true, reason: "patched" };
}

export function patchPdfAiReaderSafe(source) {
  let output = ensureBaseReader(source);
  if (output.includes(STEP_8_8_8_1_READER_MARKER)) return { source: output, changed: false, reason: "already_patched" };

  output = output.replace(
    /export const PDF_AI_ADAPTER_VERSION = "[^"]+";/,
    'export const PDF_AI_ADAPTER_VERSION = "2.4.5";',
  );

  const oldBlock = `function mergeFocusedRecovery(primary, recovery, missingFields) {
  return {
    ...primary,
    candidates: [...(primary.candidates || []), ...(recovery.candidates || [])],`;
  const newBlock = `function mergeFocusedRecovery(primary, recovery, missingFields) {
  const focusedCandidates = (recovery.candidates || []).map((candidate) => ({
    ...candidate,
    warnings: [...new Set([...(candidate.warnings || []), "focused_visual_recovery"])],
  }));
  return {
    ...primary,
    candidates: [...(primary.candidates || []), ...focusedCandidates],`;
  output = replaceOnce(output, oldBlock, `${newBlock}\n    // ${STEP_8_8_8_1_READER_MARKER}`, "tag candidati focused");

  return { source: output, changed: true, reason: "patched" };
}

function backupPathFor(relative) {
  const dir = path.join(os.homedir(), ".offertalogica-backups", "step8.8.8.1");
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
    console.log("Uso: node tools/apply-step8_8_8_1.mjs [--dry-run] [--root <repository>]");
    return 0;
  }

  const targets = [
    { relative: "lib/pdfAiFallback.js", patch: patchPdfAiFallbackSafe },
    { relative: "lib/pdfAiReader.js", patch: patchPdfAiReaderSafe },
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
    console.error(`ERRORE Step 8.8.8.1: ${error.message}`);
    process.exitCode = 1;
  }
}
