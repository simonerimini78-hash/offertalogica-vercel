#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export const STEP_8_8_8_FALLBACK_MARKER = "OFFERTALOGICA_STEP_8_8_8_VISUAL_DIRECT_RECOVERY";
export const STEP_8_8_8_READER_MARKER = "OFFERTALOGICA_STEP_8_8_8_FOCUSED_VISUAL_PASS";

function replaceOnce(source, search, replacement, label) {
  const index = typeof search === "string" ? source.indexOf(search) : source.search(search);
  if (index < 0) throw new Error(`Anchor non trovato: ${label}`);
  if (typeof search === "string") {
    if (source.indexOf(search, index + search.length) >= 0) throw new Error(`Anchor non univoco: ${label}`);
    return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
  }
  const match = source.match(search);
  if (!match) throw new Error(`Anchor non trovato: ${label}`);
  return source.replace(search, replacement);
}

export function patchPdfAiFallback(source, filename = "lib/pdfAiFallback.js") {
  if (source.includes(STEP_8_8_8_FALLBACK_MARKER)) return { source, changed: false, reason: "already_patched" };
  const required = [
    'from "./pdfAiReader.js";',
    "function addExplicitTaxIdCandidate(ai)",
    "function effectiveConfidenceThreshold(candidate)",
    "function mergeCompletedAiResult(base, ai, policy)",
  ];
  const missing = required.filter((token) => !source.includes(token));
  if (missing.length) throw new Error(`${filename}: pipeline IA non riconosciuta (${missing.join(", ")})`);

  let output = source;
  const importAnchor = 'import { runPdfAiFallback, runPdfAiFallbackImages } from "./pdfAiReader.js";';
  output = replaceOnce(output, importAnchor, `${importAnchor}\nimport {\n  explicitVisualIdentifierThreshold,\n  recoverItalianTaxIdCandidate,\n} from "./pdfAiVisualRecovery.js";\n\n// ${STEP_8_8_8_FALLBACK_MARKER}`, "import pdfAiReader");

  output = output.replace(
    /export const PDF_AI_FALLBACK_PIPELINE_VERSION = "[^"]+";/,
    'export const PDF_AI_FALLBACK_PIPELINE_VERSION = "v106.8.8-visual-direct-fields-recovery-1";',
  );

  const taxAnchor = `function addExplicitTaxIdCandidate(ai) {\n  if ((ai.candidates || []).some((candidate) => canonicalPdfField(candidate.field) === "codice_fiscale")) return;\n  const evidenceSources = [`;
  const taxReplacement = `function addExplicitTaxIdCandidate(ai) {\n  const existingTaxCandidates = (ai.candidates || [])\n    .filter((candidate) => canonicalPdfField(candidate.field) === "codice_fiscale");\n  if (existingTaxCandidates.some((candidate) => normalizeIdentifier(\n    "codice_fiscale",\n    candidate.normalized_value ?? candidate.value_text ?? candidate.value_number,\n  ))) return;\n\n  const holderCandidate = (ai.candidates || [])\n    .find((candidate) => canonicalPdfField(candidate.field) === "intestatario");\n  const holder = holderCandidate?.normalized_value ?? holderCandidate?.value_text ?? "";\n  const recovered = existingTaxCandidates\n    .map((candidate) => recoverItalianTaxIdCandidate({ candidate, holder }))\n    .filter(Boolean)\n    .sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0))[0];\n  if (recovered) {\n    ai.candidates.push(createPdfCandidate({\n      field: "codice_fiscale",\n      value_text: recovered.value,\n      normalized_value: recovered.value,\n      commodity: recovered.commodity || ai.document?.commodity || "unknown",\n      page: recovered.page || 1,\n      label: recovered.label || "Codice fiscale",\n      evidence: recovered.evidence,\n      semantic_role: "identifier",\n      source: "ai",\n      source_version: recovered.source_version || ai.model || "unknown",\n      confidence: recovered.confidence,\n      method: recovered.method,\n      warnings: recovered.warnings,\n    }, ai.candidates.length));\n    return;\n  }\n\n  const evidenceSources = [`;
  output = replaceOnce(output, taxAnchor, taxReplacement, "recupero codice fiscale");

  const thresholdAnchor = `function effectiveConfidenceThreshold(candidate) {\n  return explicitPowerThreshold(candidate) ?? confidenceThreshold(candidate?.field);\n}`;
  const thresholdReplacement = `function effectiveConfidenceThreshold(candidate) {\n  return explicitPowerThreshold(candidate)\n    ?? explicitVisualIdentifierThreshold(candidate)\n    ?? confidenceThreshold(candidate?.field);\n}`;
  output = replaceOnce(output, thresholdAnchor, thresholdReplacement, "soglia identificativi visuali");

  const metadataAnchor = '    request_profile: ai.request_profile || "full",\n    filled_fields: unique(filledFields).sort(),';
  const metadataReplacement = '    request_profile: ai.request_profile || "full",\n    focused_recovery: ai.focused_recovery || null,\n    filled_fields: unique(filledFields).sort(),';
  output = replaceOnce(output, metadataAnchor, metadataReplacement, "metadati focused recovery");

  return { source: output, changed: true, reason: "patched" };
}

const FOCUSED_PROMPT_BLOCK = `
const FOCUSED_RECOVERY_FIELDS = Object.freeze([
  "codice_fiscale", "pod", "pdr",
  "consumo_luce_kwh", "consumo_gas_smc",
  "prezzo_luce_eur_kwh", "prezzo_gas_eur_smc",
  "quota_fissa_vendita_luce_eur_anno", "quota_fissa_vendita_gas_eur_anno",
  "tipo_prezzo_luce", "tipo_prezzo_gas",
  "indice_riferimento_luce", "indice_riferimento_gas",
  "spread_luce_eur_kwh", "spread_gas_eur_smc",
  "formula_prezzo_luce", "formula_prezzo_gas",
  "codice_offerta_luce", "codice_offerta_gas",
  "scadenza_condizioni_economiche_luce", "scadenza_condizioni_economiche_gas",
]);

const FOCUSED_RECOVERY_SYSTEM_PROMPT = \`You are the focused second-pass visual reader inside OffertaLogica. Re-scan every supplied page of an Italian electricity or gas bill for direct fields missed or malformed by the first visual pass.

Return the same complete JSON structure required by the supplied schema, but keep candidates limited to the requested focused fields.
- Read identifiers character by character. Return codice_fiscale only when the page visibly supports an exact 16-character Italian fiscal code or an exact 11-digit P.IVA. Do not add, drop or silently replace characters.
- Return POD only with its explicit POD or Punto di prelievo label and PDR only with its explicit PDR or Punto di riconsegna label. Preserve every character and digit.
- Scan each electricity and gas summary page separately for the exact label Consumo annuo, Consumi annui, consumo degli ultimi 12 mesi or equivalent rolling-12-month wording.
- When both Consumo annuo and Consumo totale fatturato del periodo are visible, return the annual value as actual_customer_value and the billed-period value only as billing_period. Never substitute one for the other.
- In offer or economic-condition boxes, return a contractual sales price only when the nearby label identifies the sales component, materia energia, materia gas, corrispettivo, spread or an explicit price formula.
- Prezzo medio, costo medio unitario and totals from the bill are observation-only billing_period values and are never contractual sales prices.
- For indexed offers return price type, PUN or PSV index, spread/formula and validity dates when explicitly visible. Do not invent a numeric contractual price when only an index or formula is printed.
- Keep electricity and gas fields separate. Omit anything unreadable or ambiguous.
- Every candidate needs page, nearby label, literal evidence, unit, semantic role and confidence.
- Return JSON only.\`;

// ${STEP_8_8_8_READER_MARKER}
`;

const FOCUSED_RUNTIME_BLOCK = `
function focusedCandidateValue(candidate) {
  return String(candidate?.normalized_value ?? candidate?.value_text ?? candidate?.value_number ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function focusedCandidateContext(candidate) {
  return \`\${candidate?.unit || ""} \${candidate?.label || ""} \${candidate?.evidence || ""}\`;
}

function focusedHasSafeCandidate(result, field) {
  return (result?.candidates || []).some((candidate) => {
    if (candidate?.field !== field) return false;
    const value = focusedCandidateValue(candidate);
    const context = focusedCandidateContext(candidate);
    if (field === "codice_fiscale") return /^(?:[A-Z]{6}\\d{2}[A-Z]\\d{2}[A-Z]\\d{3}[A-Z]|\\d{11})$/.test(value);
    if (field === "pod") return /^IT\\d{3}E[A-Z0-9]{8}$/.test(value) && /(?:\\bPOD\\b|punto\\s+di\\s+prelievo)/i.test(context);
    if (field === "pdr") return /^\\d{14}$/.test(value) && /(?:\\bPDR\\b|punto\\s+di\\s+riconsegna)/i.test(context);
    if (["consumo_luce_kwh", "consumo_gas_smc"].includes(field)) {
      return candidate?.semantic_role === "actual_customer_value"
        && /(?:anno|annuo|annua|annuale|12\\s*mesi|rolling\\s*12|annual)/i.test(context);
    }
    return true;
  });
}

export function missingPdfAiFocusedRecoveryFields(result = {}) {
  const commodity = String(result?.document?.commodity || "unknown").toLowerCase();
  const required = ["codice_fiscale"];
  if (["electricity", "dual"].includes(commodity)) required.push("pod", "consumo_luce_kwh");
  if (["gas", "dual"].includes(commodity)) required.push("pdr", "consumo_gas_smc");
  return required.filter((field) => !focusedHasSafeCandidate(result, field));
}

function focusedRecoveryEnabled(env = process.env) {
  const value = String(env.PDF_AI_FOCUSED_RECOVERY_ENABLED ?? "true").trim();
  return !/^(?:0|false|no|off)$/i.test(value);
}

function mergeFocusedRecovery(primary, recovery, missingFields) {
  return {
    ...primary,
    candidates: [...(primary.candidates || []), ...(recovery.candidates || [])],
    conflicts: [...(primary.conflicts || []), ...(recovery.conflicts || [])],
    review_reasons: [...new Set([...(primary.review_reasons || []), ...(recovery.review_reasons || [])])],
    attempts: Number(primary.attempts || 1) + 1,
    request_profile: "full+focused",
    focused_recovery: {
      attempted: true,
      status: "completed",
      missing_fields: missingFields,
      candidate_count: (recovery.candidates || []).length,
      response_id: recovery.response_id || null,
      timeout_ms: recovery.timeout_ms || null,
    },
  };
}

async function runFocusedPdfAiRecovery(primary, options = {}) {
  const missingFields = missingPdfAiFocusedRecoveryFields(primary);
  if (missingFields.length < 2 || !(options.imageFiles || []).length) return primary;
  if (!focusedRecoveryEnabled(options.env || process.env)) {
    return { ...primary, focused_recovery: { attempted: false, status: "disabled", missing_fields: missingFields } };
  }

  const configured = Number(options.env?.PDF_AI_FOCUSED_RECOVERY_TIMEOUT_MS || process.env.PDF_AI_FOCUSED_RECOVERY_TIMEOUT_MS || 11_000);
  const deadlineAt = Number(options.deadlineAt || 0);
  const remaining = deadlineAt ? deadlineAt - Date.now() - 1_000 : configured;
  const timeoutValue = Math.min(14_000, Number.isFinite(configured) ? Math.max(2_000, configured) : 11_000, remaining);
  if (!Number.isFinite(timeoutValue) || timeoutValue < 5_000) {
    return { ...primary, focused_recovery: { attempted: false, status: "insufficient_time_budget", missing_fields: missingFields } };
  }

  const recovery = await runPdfAi({
    ...options,
    requiredMode: "fallback",
    imageFiles: options.imageFiles,
    parserCandidates: [...(options.parserCandidates || []), ...(primary.candidates || [])],
    imageProfile: "focused",
    timeoutValue,
  });
  if (recovery.status === "completed") return mergeFocusedRecovery(primary, recovery, missingFields);
  return {
    ...primary,
    attempts: Number(primary.attempts || 1) + 1,
    focused_recovery: {
      attempted: true,
      status: recovery.reason || recovery.status || "failed",
      missing_fields: missingFields,
      timeout_ms: recovery.timeout_ms || timeoutValue,
    },
  };
}
`;

export function patchPdfAiReader(source, filename = "lib/pdfAiReader.js") {
  if (source.includes(STEP_8_8_8_READER_MARKER)) return { source, changed: false, reason: "already_patched" };
  const required = [
    "const SYSTEM_PROMPT = `",
    "const EMERGENCY_SYSTEM_PROMPT = `",
    "export async function buildPdfAiImageRequest",
    "export async function runPdfAiFallbackImages",
  ];
  const missing = required.filter((token) => !source.includes(token));
  if (missing.length) throw new Error(`${filename}: adapter IA non riconosciuto (${missing.join(", ")})`);

  let output = source;
  output = output.replace(
    /export const PDF_AI_ADAPTER_VERSION = "[^"]+";/,
    'export const PDF_AI_ADAPTER_VERSION = "2.4.4";',
  );

  const evidenceAnchor = "- If evidence is absent or ambiguous, return no candidate.";
  const evidenceReplacement = `- Before finalizing, perform a second visual checklist on every page: exact tax identifier, POD/PDR, annual consumption for each commodity and the offer/economic-condition box. Do not stop after finding a billed-period value.\n- When a page contains both “Consumo annuo” and “Consumo totale fatturato del periodo”, return two separate observations with different semantic roles; the annual value is the only candidate eligible for annual consumption.\n- Read codice fiscale, POD and PDR character by character and preserve their exact length. A malformed identifier must not be silently normalized.\n- In the offer box, distinguish a contractual sales component or PUN/PSV formula from “Prezzo medio”; the latter remains billing_period and is never the contractual price.\n${evidenceAnchor}`;
  output = replaceOnce(output, evidenceAnchor, evidenceReplacement, "checklist prompt principale");

  output = replaceOnce(output, "const EMERGENCY_SYSTEM_PROMPT = `", `${FOCUSED_PROMPT_BLOCK}\nconst EMERGENCY_SYSTEM_PROMPT = \``, "prompt focused recovery");

  output = replaceOnce(
    output,
    '  const emergency = profile === "emergency";',
    '  const emergency = profile === "emergency";\n  const focused = profile === "focused";',
    "profilo focused",
  );

  const fieldsAnchor = `  const requestedFields = emergency\n    ? ["fornitore", "kind", "commodity", "customer_type", "intestatario", "codice_fiscale", "codice_cliente", "pod", "pdr", "indirizzo_fornitura"]\n    : pdfFieldNames();`;
  const fieldsReplacement = `  const requestedFields = emergency\n    ? ["fornitore", "kind", "commodity", "customer_type", "intestatario", "codice_fiscale", "codice_cliente", "pod", "pdr", "indirizzo_fornitura"]\n    : focused\n      ? FOCUSED_RECOVERY_FIELDS\n      : pdfFieldNames();`;
  output = replaceOnce(output, fieldsAnchor, fieldsReplacement, "campi profilo focused");

  output = replaceOnce(
    output,
    '    request_profile: emergency ? "emergency_first_page_identity" : "full_visual_semantic",',
    '    request_profile: emergency ? "emergency_first_page_identity" : focused ? "focused_direct_fields_recovery" : "full_visual_semantic",',
    "nome profilo focused",
  );
  output = replaceOnce(
    output,
    '    max_output_tokens: emergency ? 1_200 : 3_600,',
    '    max_output_tokens: emergency ? 1_200 : focused ? 2_800 : 5_000,',
    "budget output visuale",
  );
  output = replaceOnce(
    output,
    '      { role: "system", content: emergency ? EMERGENCY_SYSTEM_PROMPT : SYSTEM_PROMPT },',
    '      { role: "system", content: emergency ? EMERGENCY_SYSTEM_PROMPT : focused ? FOCUSED_RECOVERY_SYSTEM_PROMPT : SYSTEM_PROMPT },',
    "selezione prompt visuale",
  );

  const userTextAnchor = ': `Analyze these ordered rasterized PDF pages using these untrusted parser/OCR hints:\\n${JSON.stringify(context)}`,';
  const userTextReplacement = ': focused\n                ? `Re-scan all ordered pages only for the focused direct fields that were missing or malformed in the first pass:\\n${JSON.stringify(context)}`\n                : `Analyze these ordered rasterized PDF pages using these untrusted parser/OCR hints:\\n${JSON.stringify(context)}`,';
  output = replaceOnce(output, userTextAnchor, userTextReplacement, "testo richiesta focused");

  output = replaceOnce(
    output,
    'name: emergency ? "offertalogica_pdf_emergency_identity" : "offertalogica_pdf_candidates",',
    'name: emergency ? "offertalogica_pdf_emergency_identity" : focused ? "offertalogica_pdf_focused_recovery" : "offertalogica_pdf_candidates",',
    "nome schema focused",
  );

  output = replaceOnce(
    output,
    "export async function runPdfAiFallbackImages(options = {}) {",
    `${FOCUSED_RUNTIME_BLOCK}\nexport async function runPdfAiFallbackImages(options = {}) {`,
    "runtime focused recovery",
  );

  output = replaceOnce(
    output,
    '  if (primary.status === "completed" || primary.reason !== "openai_timeout") return primary;',
    '  if (primary.status === "completed") return runFocusedPdfAiRecovery(primary, options);\n  if (primary.reason !== "openai_timeout") return primary;',
    "avvio secondo passaggio focused",
  );

  return { source: output, changed: true, reason: "patched" };
}

function parseArgs(argv) {
  const options = { dryRun: false, root: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--root") options.root = path.resolve(argv[++index] || ".");
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Argomento non riconosciuto: ${arg}`);
  }
  return options;
}

function usage() {
  return `Uso:\n  node tools/apply-step8_8_8.mjs --dry-run\n  node tools/apply-step8_8_8.mjs\n\nOpzioni:\n  --root <cartella>   root del repository\n  --dry-run           verifica gli anchor senza scrivere`;
}

function backupPathFor(file) {
  const safe = file.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const dir = path.join(os.homedir(), ".offertalogica-backups", "step8.8.8");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${Date.now()}-${safe}`);
}

export function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const targets = [
    { relative: "lib/pdfAiFallback.js", patch: patchPdfAiFallback },
    { relative: "lib/pdfAiReader.js", patch: patchPdfAiReader },
  ];
  const reports = [];
  for (const target of targets) {
    const file = path.resolve(options.root, target.relative);
    if (!fs.existsSync(file)) throw new Error(`File richiesto non trovato: ${target.relative}`);
    const source = fs.readFileSync(file, "utf8");
    const result = target.patch(source, target.relative);
    if (!result.changed) {
      reports.push({ file: target.relative, status: "già aggiornato" });
      continue;
    }
    if (options.dryRun) {
      reports.push({ file: target.relative, status: "pronto" });
      continue;
    }
    const backup = backupPathFor(file);
    fs.copyFileSync(file, backup);
    fs.writeFileSync(file, result.source, "utf8");
    reports.push({ file: target.relative, status: "aggiornato", backup });
  }

  reports.forEach((report) => {
    console.log(`${report.status.toUpperCase()}: ${report.file}${report.backup ? ` — backup: ${report.backup}` : ""}`);
  });
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(`ERRORE Step 8.8.8: ${error.message}`);
    process.exitCode = 1;
  }
}
