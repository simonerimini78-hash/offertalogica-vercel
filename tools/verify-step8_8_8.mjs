#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import {
  STEP_8_8_8_FALLBACK_MARKER,
  STEP_8_8_8_READER_MARKER,
} from "./apply-step8_8_8.mjs";

function count(source, token) {
  return source.split(token).length - 1;
}

export function verifySources({ fallback, reader, helper }) {
  const report = {
    fallbackMarkerCount: count(fallback, STEP_8_8_8_FALLBACK_MARKER),
    readerMarkerCount: count(reader, STEP_8_8_8_READER_MARKER),
    importsRecoveryHelper: fallback.includes('from "./pdfAiVisualRecovery.js"'),
    recoversTaxId: fallback.includes("recoverItalianTaxIdCandidate"),
    lowersOnlyExplicitIdentifiers: fallback.includes("explicitVisualIdentifierThreshold(candidate)"),
    preservesAveragePriceBlock: fallback.includes("average_unit_cost_not_contract_price"),
    preservesPeriodConsumptionBlock: fallback.includes("billing_period_consumption_not_annual"),
    focusedSecondPass: reader.includes("runFocusedPdfAiRecovery(primary, options)"),
    focusedPromptAnnual: reader.includes("Consumo annuo") && reader.includes("Consumo totale fatturato del periodo"),
    focusedPromptAveragePrice: reader.includes("Prezzo medio") && reader.includes("never contractual sales prices"),
    helperChecksum: helper.includes("isValidItalianFiscalCode") && helper.includes("ODD_CF_VALUES"),
    helperNoGuessing: helper.includes("requires_explicit_user_confirmation"),
  };
  const failures = Object.entries(report).filter(([, value]) => value !== true && value !== 1);
  if (failures.length) throw new Error(`Verifica Step 8.8.8 fallita: ${failures.map(([key]) => key).join(", ")}`);
  return report;
}

function checkSyntax(file) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${path.basename(file)} non compila: ${result.stderr || result.stdout}`);
}

export function runCli(argv = process.argv.slice(2)) {
  let root = process.cwd();
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") root = path.resolve(argv[++index] || ".");
    else if (argv[index] === "--help" || argv[index] === "-h") {
      console.log("Uso: node tools/verify-step8_8_8.mjs [--root <repository>]");
      return 0;
    } else throw new Error(`Argomento non riconosciuto: ${argv[index]}`);
  }

  const fallbackPath = path.join(root, "lib/pdfAiFallback.js");
  const readerPath = path.join(root, "lib/pdfAiReader.js");
  const helperPath = path.join(root, "lib/pdfAiVisualRecovery.js");
  for (const file of [fallbackPath, readerPath, helperPath]) {
    if (!fs.existsSync(file)) throw new Error(`File richiesto non trovato: ${path.relative(root, file)}`);
  }

  checkSyntax(fallbackPath);
  checkSyntax(readerPath);
  checkSyntax(helperPath);
  const report = verifySources({
    fallback: fs.readFileSync(fallbackPath, "utf8"),
    reader: fs.readFileSync(readerPath, "utf8"),
    helper: fs.readFileSync(helperPath, "utf8"),
  });
  console.log(JSON.stringify({ ok: true, step: "8.8.8", ...report }, null, 2));
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(`ERRORE verifica Step 8.8.8: ${error.message}`);
    process.exitCode = 1;
  }
}
