#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";

import { STEP_8_8_7_MARKER } from "./apply-step8_8_7.mjs";

function parseArgs(argv) {
  const options = { root: process.cwd(), target: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") options.root = path.resolve(argv[++index] || ".");
    else if (arg === "--target") options.target = argv[++index] || null;
    else throw new Error(`Argomento non riconosciuto: ${arg}`);
  }
  return options;
}

function resolveTarget(root, target) {
  if (target) return path.resolve(root, target);
  const publicIndex = path.resolve(root, "public/index.html");
  if (fs.existsSync(publicIndex)) return publicIndex;
  return path.resolve(root, "index.html");
}

export function verifyHtml(html, filename = "index.html") {
  const markerCount = html.split(STEP_8_8_7_MARKER).length - 1;
  if (markerCount !== 1) throw new Error(`${filename}: marker Step 8.8.7 atteso una volta, trovato ${markerCount}`);

  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((script) => script.includes(STEP_8_8_7_MARKER));
  if (scripts.length !== 1) throw new Error(`${filename}: blocco JavaScript Step 8.8.7 non isolato correttamente`);

  new vm.Script(scripts[0], { filename });

  const required = [
    "commoditySet.has(\"dual\")",
    "activation_review",
    "requires_explicit_selection",
    "average_unit_cost_not_contract_price",
  ];
  const missing = required.filter((token) => {
    if (token === "average_unit_cost_not_contract_price") {
      return html.includes("average_unit_cost_not_contract_price")
        ? false
        : !html.includes("costi medi");
    }
    return !scripts[0].includes(token);
  });
  if (missing.length) throw new Error(`${filename}: controlli Step 8.8.7 mancanti (${missing.join(", ")})`);

  return {
    markerCount,
    scriptBytes: Buffer.byteLength(scripts[0]),
    protectsExplicitSelection: scripts[0].includes("requires_explicit_selection"),
    preservesDualEvidence: scripts[0].includes('commoditySet.has("dual")'),
    keepsDiagnosticOnlyValuesBlocked: scripts[0].includes("Non rende applicabili consumi di periodo, costi medi"),
  };
}

export function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const target = resolveTarget(options.root, options.target);
  if (!fs.existsSync(target)) throw new Error(`File non trovato: ${target}`);
  const report = verifyHtml(fs.readFileSync(target, "utf8"), path.relative(options.root, target));
  console.log(`OK Step 8.8.7: ${path.relative(options.root, target)}`);
  console.log(`Marker: ${report.markerCount}`);
  console.log(`Evidenza duale preservata: ${report.preservesDualEvidence ? "sì" : "no"}`);
  console.log(`Selezione OCR/IA esplicita: ${report.protectsExplicitSelection ? "sì" : "no"}`);
  console.log(`Valori diagnostici bloccati: ${report.keepsDiagnosticOnlyValuesBlocked ? "sì" : "no"}`);
  return 0;
}

try {
  if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
    process.exitCode = runCli();
  }
} catch (error) {
  console.error(`ERRORE verifica Step 8.8.7: ${error.message}`);
  process.exitCode = 1;
}
