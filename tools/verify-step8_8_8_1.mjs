#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function syntaxCheck(file) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${path.basename(file)} non compila: ${result.stderr || result.stdout}`);
}

export function verifySources({ fallback, reader, helper }) {
  const checks = {
    pipelineVersion: fallback.includes('PDF_AI_FALLBACK_PIPELINE_VERSION = "v106.8.8.1-safe-consensus-recovery-1"'),
    adapterVersion: reader.includes('PDF_AI_ADAPTER_VERSION = "2.4.5"'),
    safePreparation: fallback.includes("prepareSafeAiVisualCandidates(ai)"),
    safeThreshold: fallback.includes("safeVisualFieldThreshold(candidate)"),
    focusedTagging: reader.includes('"focused_visual_recovery"'),
    pdrConsensusRequired: helper.includes('warnings.includes(CONSENSUS_WARNING)'),
    annualExplicitOnly: helper.includes("EXPLICIT_ANNUAL_LABEL") && helper.includes("BILLED_PERIOD_LABEL"),
    averagePriceBlockPreserved: fallback.includes("average_unit_cost_not_contract_price"),
    periodConsumptionBlockPreserved: fallback.includes("billing_period_consumption_not_annual"),
    noAutomaticOverwrite: helper.includes("requires_explicit_user_confirmation"),
  };
  const failures = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  assertCondition(failures.length === 0, `Verifica fallita: ${failures.join(", ")}`);
  return checks;
}

export function runCli(argv = process.argv.slice(2)) {
  let root = process.cwd();
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") root = path.resolve(argv[++index] || ".");
    else throw new Error(`Argomento non riconosciuto: ${argv[index]}`);
  }

  const fallbackPath = path.join(root, "lib/pdfAiFallback.js");
  const readerPath = path.join(root, "lib/pdfAiReader.js");
  const helperPath = path.join(root, "lib/pdfAiVisualRecovery.js");
  for (const file of [fallbackPath, readerPath, helperPath]) {
    assertCondition(fs.existsSync(file), `File mancante: ${path.relative(root, file)}`);
    syntaxCheck(file);
  }

  const checks = verifySources({
    fallback: fs.readFileSync(fallbackPath, "utf8"),
    reader: fs.readFileSync(readerPath, "utf8"),
    helper: fs.readFileSync(helperPath, "utf8"),
  });
  console.log(JSON.stringify({ ok: true, step: "8.8.8.1", ...checks }, null, 2));
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(`ERRORE verifica Step 8.8.8.1: ${error.message}`);
    process.exitCode = 1;
  }
}
